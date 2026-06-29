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
  if (!user.githubToken) throw new HttpsError('failed-precondition', 'GitHub App 연결 필요(토큰 없음)');

  const octokit = new Octokit({ auth: user.githubToken });
  const slug = f.slug;
  const version = f.specVersion || 'v0.1.0';
  const branch = `docs/spec-${slug}-${version}`;
  const dir = `specs/${slug}`;

  try {
    // ① base develop 의 최신 커밋 → 새 브랜치 ref 생성
    const baseRef = await octokit.git.getRef({ owner: OWNER, repo: REPO, ref: `heads/${BASE}` });
    const baseSha = baseRef.data.object.sha;
    await octokit.git.createRef({ owner: OWNER, repo: REPO, ref: `refs/heads/${branch}`, sha: baseSha }).catch((e) => {
      if (e.status !== 422) throw e; // 이미 존재하면 재사용
    });

    // ② 파일 커밋 (Contents API). spec.md / plan.md
    await putFile(octokit, branch, `${dir}/spec.md`, f.specBody, `docs(spec): ${slug} ${version}`);
    if (f.planBody) await putFile(octokit, branch, `${dir}/plan.md`, f.planBody, `docs(plan): ${slug} ${version}`);
    // TODO(assets): Storage features/{id}/assets/* 를 base64로 받아 ${dir}/assets/ 에 커밋

    // ③ PR 생성
    const pr = await octokit.pulls.create({
      owner: OWNER, repo: REPO, base: BASE, head: branch,
      title: `docs(spec): ${slug} ${version}`,
      body: prTemplate(f),
    });
    await octokit.issues.addLabels({ owner: OWNER, repo: REPO, issue_number: pr.data.number, labels: ['spec'] }).catch(() => {});

    await featSnap.ref.update({
      status: 'pr_open', prNumber: pr.data.number, prUrl: pr.data.html_url,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { prNumber: pr.data.number, prUrl: pr.data.html_url };
  } catch (e) {
    throw new HttpsError('internal', `PR 생성 실패: ${e.message}`);
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
    await q.docs[0].ref.update({
      status: pr.merged ? 'merged' : 'pr_closed',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return res.status(200).send('ok');
  }
);
