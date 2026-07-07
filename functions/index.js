/**
 * MASC Cloud Functions (M3·M4) — GitHub 관련 최소 백엔드
 * ----------------------------------------------------------------------
 *  1) githubOAuthExchange — OAuth code → user access token 교환
 *  2) createSpecPR        — 브랜치 생성 → spec/plan/assets 커밋 → PR 생성 (개발자 명의)
 *  3) githubWebhook       — pull_request 수신(HMAC 검증) → Firestore status 역동기화
 *
 * 시크릿: GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET / GITHUB_WEBHOOK_SECRET
 *   firebase functions:secrets:set <NAME> 로 등록 (docs/infra-playbook.md B-2).
 * 대상 레포: mash-up-kr/Team-MINO-Android · base 브랜치: develop
 */
const crypto = require('crypto');
const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { Octokit } = require('@octokit/rest');

admin.initializeApp();
const db = admin.firestore();

const GITHUB_CLIENT_ID = defineSecret('GITHUB_CLIENT_ID');
const GITHUB_CLIENT_SECRET = defineSecret('GITHUB_CLIENT_SECRET');
const GITHUB_WEBHOOK_SECRET = defineSecret('GITHUB_WEBHOOK_SECRET');

const OWNER = 'mash-up-kr';
const REPO = 'Team-MINO-Android';
const BASE = 'develop';
const BUCKET = 'mino-spec-center.firebasestorage.app'; // spec 이미지 Storage 버킷
// GitHub Pages 도메인 ↔ Functions 도메인 분리 → CORS 허용 (PRD 5장)
const CORS_ORIGIN = 'https://mash-up-kr.github.io';

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
      // 클라이언트가 users/{uid}.githubToken 에 저장. (MVP 평문 — 운영 시 Secret Manager)
      return res.json({ access_token: data.access_token, token_type: data.token_type });
    } catch (e) {
      return res.status(500).json({ error: String(e) });
    }
  }
);

// ===================== 2) PR 생성 =====================
// data: { featureId }. 호출자(개발자)의 githubToken 으로 개발자 명의 PR.
exports.createSpecPR = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  const featureId = request.data && request.data.featureId;
  if (!featureId) throw new HttpsError('invalid-argument', 'featureId 누락');

  const [userSnap, featSnap] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    db.doc(`features/${featureId}`).get(),
  ]);
  if (!featSnap.exists) throw new HttpsError('not-found', 'feature 없음');
  const user = userSnap.data() || {};
  const f = featSnap.data();
  if (user.role !== 'developer') throw new HttpsError('permission-denied', '개발자만 PR 생성');
  if (f.status !== 'plan_drafted') throw new HttpsError('failed-precondition', 'plan_drafted 상태에서만 PR 생성');
  if (!user.githubToken) throw new HttpsError('permission-denied', 'GITHUB_AUTH: GitHub 연결이 없습니다(토큰 없음). 다시 로그인하세요.');

  const octokit = new Octokit({ auth: user.githubToken });
  const slug = f.slug;
  const version = f.specVersion || 'v0.1.0';
  const branch = `docs/spec-${slug}-${version}`;
  const dir = `docs/specs/${slug}`;

  try {
    // ① base develop 의 최신 커밋 → 새 브랜치 ref 생성
    const baseRef = await octokit.git.getRef({ owner: OWNER, repo: REPO, ref: `heads/${BASE}` });
    const baseSha = baseRef.data.object.sha;
    await octokit.git.createRef({ owner: OWNER, repo: REPO, ref: `refs/heads/${branch}`, sha: baseSha }).catch((e) => {
      if (e.status !== 422) throw e; // 이미 존재하면 재사용
    });

    // ② 파일 커밋 (Contents API). spec.md / plan.md
    // 변경 이력 표는 대시보드 versionLog 로 자동 생성/주입(개발자 수기 표 대체).
    const specBody = injectVersionHistory(f.specBody, f.versionLog);
    await putFile(octokit, branch, `${dir}/spec.md`, specBody, `docs(spec): ${slug} ${version}`);
    if (f.planBody) await putFile(octokit, branch, `${dir}/plan.md`, f.planBody, `docs(plan): ${slug} ${version}`);

    // ②-b assets 이미지: Storage features/{id}/assets/* → ${dir}/assets/ 커밋
    const assets = Array.isArray(f.assets) ? f.assets : [];
    for (const a of assets) {
      if (!a || !a.name || !a.storagePath) continue; // 업로드 안 된(경로없는) asset은 건너뜀
      try {
        const [buf] = await admin.storage().bucket(BUCKET).file(a.storagePath).download();
        await putBinary(octokit, branch, `${dir}/assets/${a.name}`, buf, `docs(spec): ${slug} asset ${a.name}`);
      } catch (e) {
        console.error('asset commit 실패:', a.name, e.message); // 개별 실패는 PR 생성을 막지 않음
      }
    }

    // ③ PR 생성
    const pr = await octokit.pulls.create({
      owner: OWNER, repo: REPO, base: BASE, head: branch,
      title: `docs(spec): ${slug} ${version}`,
      body: prTemplate(f),
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

// ============ 2b) PR close (무효화 연쇄) ============
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
  if (!user.githubToken) throw new HttpsError('permission-denied', 'GITHUB_AUTH: GitHub 연결이 없습니다(토큰 없음). 다시 로그인하세요.');
  const slug = (featSnap.exists && featSnap.data().slug) || '';

  const octokit = new Octokit({ auth: user.githubToken });
  try {
    const pr = await octokit.pulls.get({ owner: OWNER, repo: REPO, pull_number: prNumber });
    // 안전장치: 이 PR 이 정말 해당 spec 브랜치인지 확인
    if (slug && !pr.data.head.ref.startsWith(`docs/spec-${slug}-`)) {
      throw new HttpsError('failed-precondition', 'PR 브랜치가 이 spec 과 일치하지 않습니다.');
    }
    if (pr.data.state === 'closed') return { closed: true, already: true };
    const msg = reason || 'spec 이 수정되어 무효화되었습니다.';
    await octokit.issues.createComment({
      owner: OWNER, repo: REPO, issue_number: prNumber,
      body: `⚠️ ${msg} 새 버전으로 다시 PR 이 생성됩니다.`,
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

// 바이너리(이미지) 커밋 — Buffer 를 그대로 base64 로 올린다.
async function putBinary(octokit, branch, path, buffer, message) {
  let sha;
  try {
    const cur = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path, ref: branch });
    sha = cur.data.sha;
  } catch (e) { if (e.status !== 404) throw e; }
  await octokit.repos.createOrUpdateFileContents({
    owner: OWNER, repo: REPO, path, message, branch, sha,
    content: Buffer.from(buffer).toString('base64'),
  });
}

// ===================== 자동 버저닝 (js/version.js 서버측 미러) =====================
const VER_INIT = 'v0.1.0';
const VER_REASONS = {
  init: '최초 작성', patch: '반려 반영 후 재검토 요청',
  minor: '승인 후 수정 — 무효화 (재검토 필요)', major: '머지된 스펙 수정 — 무효화',
  graduate: '최초 머지 (릴리스)',
};
function parseVer(v) {
  const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim());
  return m ? [+m[1], +m[2], +m[3]] : null;
}
function bumpVersion(current, level) {
  const a = parseVer(current) || parseVer(VER_INIT);
  if (level === 'patch') return `v${a[0]}.${a[1]}.${a[2] + 1}`;
  if (level === 'minor') return `v${a[0]}.${a[1] + 1}.0`;
  if (level === 'major') return `v${a[0] + 1}.0.0`;
  if (level === 'graduate') return a[0] === 0 ? 'v1.0.0' : `v${a[0]}.${a[1]}.${a[2]}`;
  return `v${a[0]}.${a[1]}.${a[2]}`;
}
function versionLogEntry(version, event, body) {
  return {
    version, level: event, reason: VER_REASONS[event] || '',
    at: new Date().toISOString().slice(0, 10), body: body == null ? '' : body,
  };
}
// 본문에서 `## 변경 이력` 섹션 제거 — js/version.js stripHistory 미러(스냅샷용)
function stripHistory(body) {
  const lines = String(body || '').replace(/\r\n/g, '\n').split('\n');
  const isHist = (l) => /^##\s+(?:\d+\.\s*)?변경\s*이력\s*$/.test(l);
  const start = lines.findIndex(isHist);
  if (start < 0) return String(body || '').trim();
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) { if (/^##\s+/.test(lines[i])) { end = i; break; } }
  return lines.slice(0, start).concat(lines.slice(end)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// versionLog → 마크다운 `## 변경 이력` 표(버전=1열, 최신=마지막 행: spec-parse 규약).
function buildHistoryTable(versionLog) {
  const rows = (versionLog || []).map((e) =>
    `| ${e.version} | ${e.at || ''} | ${String(e.reason || '').replace(/\|/g, '/')} |`);
  return ['| 버전 | 날짜 | 변경 내용 |', '|------|------|-----------|', ...rows].join('\n');
}
// spec.md 의 `## 변경 이력` 섹션을 versionLog 기반 표로 교체(없으면 말미에 추가). 번호 접두사 보존.
function injectVersionHistory(specBody, versionLog) {
  if (!versionLog || !versionLog.length) return specBody;
  const table = buildHistoryTable(versionLog);
  const lines = String(specBody).replace(/\r\n/g, '\n').split('\n');
  const isHist = (l) => /^##\s+(?:\d+\.\s*)?변경\s*이력\s*$/.test(l);
  const start = lines.findIndex(isHist);
  if (start < 0) {
    return String(specBody).replace(/\n*$/, '') + `\n\n## 변경 이력\n\n${table}\n`;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) { if (/^##\s+/.test(lines[i])) { end = i; break; } }
  const prefixMatch = lines[start].match(/^##\s+(\d+\.\s*)?/);
  const prefix = prefixMatch && prefixMatch[1] ? prefixMatch[1] : '';
  const before = lines.slice(0, start).join('\n').replace(/\n*$/, '');
  const after = lines.slice(end).join('\n').replace(/^\n*/, '');
  let out = `${before}\n\n## ${prefix}변경 이력\n\n${table}\n`;
  if (after) out += `\n${after}`;
  return out;
}

function prTemplate(f) {
  return [
    `## 스펙 PR — ${f.title}`,
    '',
    '### 얼라인 체크리스트',
    '- [x] spec 컨펌됨 (디자이너 승인)',
    `- [${f.planBody ? 'x' : ' '}] plan 작성됨`,
    `- [ ] 담당자 확인`,
    '',
    `> slug: \`${f.slug}\` · 버전: \`${f.specVersion || ''}\``,
    f.figmaSources && f.figmaSources.length ? `> 출처: ${f.figmaSources.join(' , ')}` : '',
  ].join('\n');
}

// ===================== 3) Webhook 역동기화 =====================
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
    const doc = q.docs[0];
    const fdata = doc.data() || {};
    const patch = {
      status: pr.merged ? 'merged' : 'pr_closed',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    // 최초 머지 → 0.x 를 v1.0.0 으로 승격(코드 착지 = 릴리스). syncFromWebhook(프론트 테스트)과 동일.
    if (pr.merged) {
      const nv = bumpVersion(fdata.specVersion, 'graduate');
      if (nv !== fdata.specVersion) {
        patch.specVersion = nv;
        const resultLog = (Array.isArray(fdata.versionLog) ? fdata.versionLog : []).concat(versionLogEntry(nv, 'graduate', stripHistory(fdata.specBody)));
        patch.versionLog = resultLog;
        patch.specBody = injectVersionHistory(fdata.specBody, resultLog);
      }
    }
    await doc.ref.update(patch);
    return res.status(200).send('ok');
  }
);
