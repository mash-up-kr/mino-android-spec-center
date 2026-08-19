/**
 * MASC Cloud Functions (M3·M4) — GitHub 관련 최소 백엔드
 * ----------------------------------------------------------------------
 *  1) githubOAuthExchange — OAuth code → user access token 교환
 *  2) listBaseBranches    — `/issue` 가 만든 `…/base` 브랜치 목록 조회
 *  3) createSpecPR        — `…/spec` 브랜치 생성 → spec.md + quality/spec-checklist.md 커밋
 *                           → base 브랜치로 PR (개발자 명의)
 *  4) githubWebhook       — pull_request 수신(HMAC 검증) → Firestore status 역동기화
 *  5) notifyOnFeatureWrite — 상태 전이 → Discord 알림 (notify.js, P5.2)
 *
 * 시크릿: GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET / GITHUB_WEBHOOK_SECRET / DISCORD_WEBHOOK_URL
 *   firebase functions:secrets:set <NAME> 로 등록 (docs/ops/infra-playbook.md B-2).
 * 사용자 GitHub 토큰: Secret Manager `user-gh-token-{uid}` (token-store.js).
 *   Firestore 평문 저장 폐지 — 레거시 필드는 첫 사용 시 자동 이관.
 *
 * 대상 레포: mash-up-kr/Team-MINO-Android
 * base 브랜치: `develop` 고정이 아니라 이슈별 `<prefix>/<이슈번호>-<slug>/base`.
 *   근거: Mino-Android `docs/conventions/base-branch.md` — spec/plan/task 하위 작업은
 *   develop 이 아니라 이슈 base 브랜치에서 분기하고 그리로 PR 한다.
 */
const crypto = require('crypto');
const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { Octokit } = require('@octokit/rest');
const { compatLevel } = require('./semver');

admin.initializeApp();
const db = admin.firestore();

// ===================== 0) 사용자 토큰 (Secret Manager, token-store.js) =====================
const { getUserToken, storeGithubToken } = require('./token-store');
exports.storeGithubToken = storeGithubToken;

// ===================== 0b) 알림 P5.2 (notify.js) — 상태 전이 → Discord =====================
const { notifyOnFeatureWrite, notifyOnPrdWrite, notifyOnPrdComment } = require('./notify');
exports.notifyOnFeatureWrite = notifyOnFeatureWrite;
// P8 — PRD 등록/개정 알림 + 논의 멘션 알림
exports.notifyOnPrdWrite = notifyOnPrdWrite;
exports.notifyOnPrdComment = notifyOnPrdComment;

const GITHUB_CLIENT_ID = defineSecret('GITHUB_CLIENT_ID');
const GITHUB_CLIENT_SECRET = defineSecret('GITHUB_CLIENT_SECRET');
const GITHUB_WEBHOOK_SECRET = defineSecret('GITHUB_WEBHOOK_SECRET');

const PRD_ID = 'business-context';   // PRD 는 프로젝트당 1개 (docs/prd/business-context.md)
const OWNER = 'mash-up-kr';
const REPO = 'Team-MINO-Android';
// `/issue` 산출 브랜치 형태: <prefix>/<이슈번호>-<slug>/base (branch-naming.md)
const BASE_BRANCH_RE = /^[a-z]+\/(\d+)-([a-z0-9-]+)\/base$/;
// GitHub Pages 도메인 ↔ Functions 도메인 분리 → CORS 허용 (PRD 5장)
const CORS_ORIGIN = 'https://mash-up-kr.github.io';

// base 브랜치(`…/base`) → spec 작업 브랜치(`…/spec`). base-branch.md 권장 네이밍.
const specBranchOf = (base) => String(base || '').replace(/\/base$/, '/spec');

// ===================== 1) OAuth 토큰 교환 =====================
exports.githubOAuthExchange = onRequest(
  { secrets: [GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET], cors: [CORS_ORIGIN] },
  async (req, res) => {
    if (req.method !== 'POST') return res.status(405).send('POST only');
    const code = req.body && req.body.code;
    if (!code) return res.status(400).json({ error: 'missing code' });
    try {
      const r = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID.value(),
          client_secret: GITHUB_CLIENT_SECRET.value(),
          code,
        }),
      });
      const data = await r.json();
      if (data.error) return res.status(400).json({ error: data.error_description || data.error });
      // 클라이언트가 storeGithubToken(callable) 로 전달 → Secret Manager 저장.
      return res.json({ access_token: data.access_token, token_type: data.token_type });
    } catch (e) {
      return res.status(500).json({ error: String(e) });
    }
  }
);

// ===================== 2) base 브랜치 목록 =====================
// data: {}. `/issue` 가 만든 `<prefix>/<이슈번호>-<slug>/base` 브랜치를 최신 커밋 순으로 반환.
// 업로드 모달의 대상 브랜치 셀렉트를 채운다.
exports.listBaseBranches = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  const userSnap = await db.doc(`users/${uid}`).get();
  const user = userSnap.data() || {};
  const token = await getUserToken(uid, user);
  if (!token) throw new HttpsError('permission-denied', 'GITHUB_AUTH: GitHub 연결이 없습니다(토큰 없음). 다시 로그인하세요.');

  const octokit = new Octokit({ auth: token });
  try {
    // 브랜치가 많아질 수 있어 페이지네이션으로 전부 훑고 `…/base` 만 남긴다.
    const all = await octokit.paginate(octokit.repos.listBranches, {
      owner: OWNER, repo: REPO, per_page: 100,
    });
    const matched = all
      .map((b) => ({ b, m: BASE_BRANCH_RE.exec(b.name) }))
      .filter((x) => x.m)
      .map((x) => ({ name: x.b.name, issue: Number(x.m[1]), slug: x.m[2], sha: x.b.commit && x.b.commit.sha }));
    // 이슈 번호 내림차순 = 사실상 최신순 (커밋 날짜 조회는 브랜치당 1콜이라 생략)
    matched.sort((a, b) => b.issue - a.issue);
    return { branches: matched };
  } catch (e) {
    throw githubError(e, 'base 브랜치 조회 실패');
  }
});

// ===================== 3) PR 생성 =====================
// data: { featureId }. 호출자(개발자)의 githubToken 으로 개발자 명의 PR.
// head = <prefix>/<N>-<slug>/spec (base 브랜치에서 분기) · base = feature.baseBranch
exports.createSpecPR = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  const featureId = request.data && request.data.featureId;
  if (!featureId) throw new HttpsError('invalid-argument', 'featureId 누락');

  const [userSnap, featSnap, prdSnap] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    db.doc(`features/${featureId}`).get(),
    db.doc(`prds/${PRD_ID}`).get(),
  ]);
  if (!featSnap.exists) throw new HttpsError('not-found', 'feature 없음');
  // PRD 는 없을 수도 있다(미등록) → 그 경우 정합 줄을 생략한다.
  const prdVersion = prdSnap.exists ? (prdSnap.data().version || '') : '';
  const user = userSnap.data() || {};
  const f = featSnap.data();
  if (user.role !== 'developer') throw new HttpsError('permission-denied', '개발자만 PR 생성');
  if (f.status !== 'spec_approved') throw new HttpsError('failed-precondition', 'spec_approved 상태에서만 PR 생성');
  const baseBranch = f.baseBranch;
  if (!baseBranch || !BASE_BRANCH_RE.test(baseBranch)) {
    throw new HttpsError('failed-precondition',
      'base 브랜치가 없거나 형식이 잘못됐습니다(<prefix>/<이슈번호>-<slug>/base). /issue 로 생성한 브랜치를 spec 수정에서 선택하세요.');
  }
  const token = await getUserToken(uid, user);
  if (!token) throw new HttpsError('permission-denied', 'GITHUB_AUTH: GitHub 연결이 없습니다(토큰 없음). 다시 로그인하세요.');

  const octokit = new Octokit({ auth: token });
  const slug = f.slug;
  const version = f.specVersion || '';
  const branch = specBranchOf(baseBranch);
  const dir = `docs/specs/${slug}`;

  try {
    // ① base 브랜치의 최신 커밋 → spec 작업 브랜치 ref 생성 (develop 아님)
    let baseSha;
    try {
      const baseRef = await octokit.git.getRef({ owner: OWNER, repo: REPO, ref: `heads/${baseBranch}` });
      baseSha = baseRef.data.object.sha;
    } catch (e) {
      if (e.status === 404) {
        throw new HttpsError('failed-precondition',
          `base 브랜치 '${baseBranch}' 가 원격에 없습니다. /issue 로 다시 만들거나 spec 수정에서 다른 브랜치를 선택하세요.`);
      }
      throw e;
    }
    await octokit.git.createRef({ owner: OWNER, repo: REPO, ref: `refs/heads/${branch}`, sha: baseSha }).catch((e) => {
      if (e.status !== 422) throw e; // 이미 존재하면 재사용
    });

    // ② `/mino-spec` 산출물 2개 커밋 (Contents API — 파일당 1커밋).
    //    plan.md·assets 커밋은 폐기 — plan/task 는 같은 base 아래 별도 하위 작업 브랜치가 담당한다.
    await putFile(octokit, branch, `${dir}/spec.md`, f.specBody, `docs(spec): ${slug} ${version}`.trim());
    // 체크리스트는 업로드 필수지만, 도입 이전에 만들어진 레거시 문서는 비어 있을 수 있다 → spec 만 싣는다.
    if (f.checklistBody && f.checklistBody.trim()) {
      await putFile(octokit, branch, `${dir}/quality/spec-checklist.md`, f.checklistBody,
        `docs(spec): ${slug} 품질 체크리스트 ${version}`.trim());
    }

    // ③ PR 생성 — base 는 develop 이 아니라 이슈 base 브랜치
    const pr = await octokit.pulls.create({
      owner: OWNER, repo: REPO, base: baseBranch, head: branch,
      title: `docs(spec): ${slug} ${version}`.trim(),
      body: prTemplate(f, baseBranch, branch, prdVersion),
    });
    await octokit.issues.addLabels({ owner: OWNER, repo: REPO, issue_number: pr.data.number, labels: ['spec'] }).catch(() => {});
    // 작업자(개발자)를 PR 담당자(assignee)로 지정 — 실패해도 PR은 유지
    if (user.githubLogin) {
      await octokit.issues.addAssignees({ owner: OWNER, repo: REPO, issue_number: pr.data.number, assignees: [user.githubLogin] }).catch(() => {});
    }

    await featSnap.ref.update({
      status: 'pr_open', prNumber: pr.data.number, prUrl: pr.data.html_url,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { prNumber: pr.data.number, prUrl: pr.data.html_url };
  } catch (e) {
    if (e instanceof HttpsError) throw e; // 전제조건 위반은 그대로 전달
    throw githubError(e, 'PR 생성 실패');
  }
});

// GitHub(Octokit) 에러를 유형별 HttpsError 로 변환.
// 401/403/404 = 권한/토큰 문제 → 'permission-denied' + GITHUB_AUTH 마커(프론트가 안내 모달로 분기).
function githubError(e, prefix) {
  const st = e && (e.status || (e.response && e.response.status));
  if (st === 401 || st === 403 || st === 404) {
    return new HttpsError('permission-denied',
      `GITHUB_AUTH: GitHub 권한이 없거나 연결이 만료됐습니다(${st}). 다시 로그인하거나 대상 레포 push 권한을 확인하세요.`);
  }
  return new HttpsError('internal', `${prefix}: ${e && e.message}`);
}

// ============ 3b) PR close (무효화 연쇄) ============
// data: { featureId, prNumber, reason }. 개발자 토큰으로 열린 spec PR 을 닫는다.
// 호출 전 클라이언트가 Firestore prNumber 를 null 로 비워둔다 → close 웹훅이 매칭 실패해
// pr_closed 로 덮어쓰지 않고 무효화 결과(spec_draft)가 유지된다.
exports.closeSpecPR = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  const { featureId, prNumber, reason } = request.data || {};
  if (!featureId || !prNumber) throw new HttpsError('invalid-argument', 'featureId/prNumber 누락');

  const [userSnap, featSnap] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    db.doc(`features/${featureId}`).get(),
  ]);
  const user = userSnap.data() || {};
  if (user.role !== 'developer') throw new HttpsError('permission-denied', '개발자만 PR close');
  const token = await getUserToken(uid, user);
  if (!token) throw new HttpsError('permission-denied', 'GITHUB_AUTH: GitHub 연결이 없습니다(토큰 없음). 다시 로그인하세요.');
  const baseBranch = (featSnap.exists && featSnap.data().baseBranch) || '';

  const octokit = new Octokit({ auth: token });
  try {
    const pr = await octokit.pulls.get({ owner: OWNER, repo: REPO, pull_number: prNumber });
    // 안전장치: 이 PR 이 정말 해당 feature 의 spec 브랜치(base→spec)인지 확인
    if (baseBranch && pr.data.head.ref !== specBranchOf(baseBranch)) {
      throw new HttpsError('failed-precondition', 'PR 브랜치가 이 spec 과 일치하지 않습니다.');
    }
    if (pr.data.state === 'closed') return { closed: true, already: true };
    const msg = reason || 'spec 이 수정되어 기존 승인이 해제되었습니다.';
    await octokit.issues.createComment({
      owner: OWNER, repo: REPO, issue_number: prNumber,
      body: `🔄 ${msg} 재컨펌 후 새 PR 이 생성됩니다.`,
    }).catch(() => {});
    await octokit.pulls.update({ owner: OWNER, repo: REPO, pull_number: prNumber, state: 'closed' });
    return { closed: true, prNumber };
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw githubError(e, 'PR close 실패');
  }
});

async function putFile(octokit, branch, path, content, message) {
  let sha;
  try {
    const cur = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path, ref: branch });
    sha = cur.data.sha; // 기존 파일 있으면 업데이트
  } catch (e) { if (e.status !== 404) throw e; }
  await octokit.repos.createOrUpdateFileContents({
    owner: OWNER, repo: REPO, path, message, branch, sha,
    content: Buffer.from(content, 'utf8').toString('base64'),
  });
}

// 체크리스트 본문에서 상태·통과 개수를 읽는다 (`quality/spec-checklist.md` 헤더 + 체크박스).
// 대시보드의 spec-parse.js 와 같은 규칙이지만, Functions 는 브라우저 코드를 공유하지 않아 최소 구현만 둔다.
function checklistSummary(body) {
  const src = String(body || '');
  if (!src.trim()) return null;
  const st = /^\*\*\s*상태\s*\*\*\s*[:：]\s*(.*)$/m.exec(src);
  const status = st ? ((/\b(PASS|FAILED|DRAFT)\b/i.exec(st[1]) || [])[1] || '').toUpperCase() : '';
  let checked = 0, total = 0;
  src.split('\n').forEach((l) => {
    const m = /^\s*[-*]\s+\[([ xX])\]\s/.exec(l);
    if (!m) return;
    total++;
    if (m[1] !== ' ') checked++;
  });
  return { status, checked, total };
}

// 기준 PRD 정합 (P8·요구사항 ③) — 게이트가 아니라 **머지 전 확인 항목**으로 남긴다.
function prdAlignLine(f, prdVersion) {
  if (!prdVersion) return null;                       // PRD 미등록이면 줄 자체를 생략
  const base = f.prdVersion || '없음';
  const level = compatLevel(f.prdVersion, prdVersion);
  if (level === 'same' || level === 'patch') return `- [x] 기준 PRD 최신 (PRD \`${prdVersion}\`)`;
  if (level === 'ahead') {
    return `- [ ] PRD 미업로드 — spec 기준 \`${base}\` / 등록된 PRD \`${prdVersion}\` (최신 PRD를 대시보드에 올려주세요)`;
  }
  if (level === 'none') return `- [ ] 기준 PRD 미연결 — spec 헤더 \`**기준 PRD 버전**\` 확인 필요`;
  const what = level === 'major'
    ? 'MVP 경계·용어가 바뀌었습니다 — `/mino-spec` 재실행 필요'
    : '항목이 추가됐습니다 — 주제가 겹치면 재실행 검토';
  return `- [ ] 기준 PRD 뒤처짐 (${level.toUpperCase()}) — spec 기준 \`${base}\` / 현재 PRD \`${prdVersion}\` · ${what}`;
}

// 얼라인 체크리스트 첫 줄은 승인 경로에 따라 갈린다. 상태는 둘 다 `spec_approved` 라
// 구분은 `reviews[]` 의 마지막 승인 항목에만 남는다. 개발자 자체 승인(P9)은 디자이너가
// 보지 않은 승인이므로 **미체크 + 사유**로 남겨 CODEOWNERS 리뷰어가 알아채게 한다.
function approvalLine(f) {
  const list = (Array.isArray(f.reviews) ? f.reviews : [])
    .filter((r) => r && (r.decision === 'approved' || r.decision === 'self_approved'));
  const last = list.length ? list[list.length - 1] : null;
  if (!last || last.decision !== 'self_approved') return '- [x] spec 컨펌됨 (디자이너 승인)';
  const why = String((((last.comments || [])[0] || {}).body) || '').replace(/\s+/g, ' ').trim();
  return `- [ ] spec 컨펌 — **개발자 자체 승인**(디자이너 컨펌 생략)${why ? ` · 사유: ${why}` : ''}`;
}

function prTemplate(f, baseBranch, headBranch, prdVersion) {
  const issue = (BASE_BRANCH_RE.exec(baseBranch || '') || [])[1];
  // DRAFT·[TBD] 스펙도 업로드·컨펌이 가능하므로 체크 상태를 실제 산출물 값으로 반영한다.
  const dir = `docs/specs/${f.slug}`;
  const tbd = ((f.specBody || '').match(/\[TBD\b[^\]]*\]/g) || []).length;
  const c = checklistSummary(f.checklistBody);
  const quality = !c
    ? '- [ ] 품질 체크리스트 첨부 — **누락** (`/mino-spec`의 `quality/spec-checklist.md`를 올려주세요)'
    : c.status === 'PASS'
      ? `- [x] 품질 체크리스트 통과 (로컬 \`/mino-spec\` · ${c.checked}/${c.total})`
      : `- [ ] 품질 체크리스트 통과 — 상태 \`${c.status || '미상'}\` · ${c.checked}/${c.total} (머지 전 \`/mino-spec\`으로 확정 필요)`;
  // 조건부로 빠지는 줄은 null, 의도한 빈 줄은 ''. 빈 줄까지 걸러내면 목록 바로 뒤의
  // 인용문이 리스트 항목으로 흡수돼 GitHub 렌더가 깨진다.
  return [
    `## 스펙 PR — ${f.title}`,
    '',
    '### 포함 문서',
    `- \`${dir}/spec.md\` — 디자이너 컨펌 대상`,
    c ? `- \`${dir}/quality/spec-checklist.md\` — 품질 검증 결과` : null,
    '',
    '### 얼라인 체크리스트',
    approvalLine(f),
    quality,
    prdAlignLine(f, prdVersion),
    f.specStatus === 'CREATED' ? null : `- [ ] spec 헤더 상태 확정 — 현재 \`${f.specStatus || '미상'}\``,
    tbd ? `- [ ] 미해소 \`[TBD]\` ${tbd}건 확정` : null,
    '- [ ] 담당자 확인',
    '',
    `> \`${headBranch}\` → \`${baseBranch}\``,
    `> slug: \`${f.slug}\` · 버전: \`${f.specVersion || ''}\` · 기준 PRD: \`${f.prdVersion || '없음'}\`${prdVersion ? ` (현재 PRD \`${prdVersion}\`)` : ''}`,
    issue ? `> 관련 이슈: #${issue}` : null,
    f.figmaSources && f.figmaSources.length ? `> 출처: ${f.figmaSources.join(' , ')}` : null,
    '',
    '머지 후 같은 base 브랜치에서 `/mino-plan` · `/mino-task` 를 이어서 진행합니다.',
  ].filter((l) => l !== null).join('\n');
}

// ===================== 4) Webhook 역동기화 =====================
exports.githubWebhook = onRequest(
  { secrets: [GITHUB_WEBHOOK_SECRET] },
  async (req, res) => {
    // HMAC-SHA256 서명 검증
    const sig = req.get('x-hub-signature-256') || '';
    const mac = 'sha256=' + crypto.createHmac('sha256', GITHUB_WEBHOOK_SECRET.value())
      .update(req.rawBody).digest('hex');
    if (sig.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(mac))) {
      return res.status(401).send('bad signature');
    }
    if (req.get('x-github-event') !== 'pull_request') return res.status(204).send();

    const { action, pull_request: pr } = req.body;
    if (action !== 'closed' || !pr) return res.status(204).send();

    const q = await db.collection('features').where('prNumber', '==', pr.number).limit(1).get();
    if (q.empty) return res.status(204).send();
    // 버전은 `/mino-spec` 스킬 소유 — 머지 시 대시보드가 bump 하지 않는다(상태만 반영).
    await q.docs[0].ref.update({
      status: pr.merged ? 'merged' : 'pr_closed',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return res.status(200).send('ok');
  }
);
