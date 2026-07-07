/**
 * 사용자 GitHub 토큰 저장소 — Secret Manager
 * ----------------------------------------------------------------------
 * users/{uid}.githubToken 평문 저장(Firestore)을 대체한다.
 *  - 사용자별 시크릿 1개(`user-gh-token-{uid}`), 활성 버전 1개 유지.
 *  - storeGithubToken(callable): 로그인 직후 클라이언트가 팝업 토큰을 전달.
 *  - getUserToken: PR 생성/close 시 조회. 레거시 평문 필드는 발견 즉시 이관 후 삭제.
 * IAM: 함수 런타임 SA 에 roles/secretmanager.admin 필요 (docs/ops/infra-playbook.md).
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

const sm = new SecretManagerServiceClient();
const SM_PROJECT = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
const secretId = (uid) => `user-gh-token-${uid}`;
const secretName = (uid) => `projects/${SM_PROJECT}/secrets/${secretId(uid)}`;

async function storeUserToken(uid, token) {
  const name = secretName(uid);
  try {
    await sm.createSecret({
      parent: `projects/${SM_PROJECT}`,
      secretId: secretId(uid),
      secret: { replication: { automatic: {} } },
    });
  } catch (e) {
    if (e.code !== 6) throw e; // 6 = ALREADY_EXISTS → 기존 시크릿에 버전만 추가
  }
  const [version] = await sm.addSecretVersion({
    parent: name, payload: { data: Buffer.from(token, 'utf8') },
  });
  // 이전 활성 버전 파기 — 노출 면적·과금(버전당) 최소화
  const [versions] = await sm.listSecretVersions({ parent: name });
  await Promise.all(versions
    .filter((v) => v.name !== version.name && v.state === 'ENABLED')
    .map((v) => sm.destroySecretVersion({ name: v.name }).catch(() => {})));
}

// 토큰 조회: Secret Manager 우선. 레거시 Firestore 평문 필드(userData.githubToken)는
// 발견 즉시 Secret Manager 로 이관하고 필드를 지운다 (무중단 마이그레이션).
async function getUserToken(uid, userData) {
  try {
    const [v] = await sm.accessSecretVersion({ name: `${secretName(uid)}/versions/latest` });
    const t = v.payload && v.payload.data && v.payload.data.toString('utf8');
    if (t) return t;
  } catch (e) {
    if (e.code !== 5) console.error('accessSecretVersion', uid, e.message); // 5 = NOT_FOUND
  }
  const legacy = userData && userData.githubToken;
  if (legacy) {
    try {
      await storeUserToken(uid, legacy);
      await admin.firestore().doc(`users/${uid}`)
        .update({ githubToken: admin.firestore.FieldValue.delete() });
    } catch (e) { console.error('레거시 토큰 이관 실패', uid, e.message); }
    return legacy;
  }
  return null;
}

// 로그인 직후 클라이언트가 팝업 토큰을 전달한다 (Firestore 평문 저장 대체).
const storeGithubToken = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  const token = request.data && request.data.token;
  // GitHub 토큰 형태(gho_/ghu_/ghp_ 접두)만 수용 — 임의 데이터로 시크릿 오염 방지
  if (typeof token !== 'string' || token.length < 20 || token.length > 255 || !/^gh[a-z]_/.test(token)) {
    throw new HttpsError('invalid-argument', '유효한 GitHub 토큰이 아닙니다.');
  }
  await storeUserToken(uid, token);
  // 레거시 평문 필드가 남아 있으면 제거 (문서 없으면 무시)
  await admin.firestore().doc(`users/${uid}`)
    .update({ githubToken: admin.firestore.FieldValue.delete() }).catch(() => {});
  return { stored: true };
});

module.exports = { getUserToken, storeGithubToken };
