/**
 * MASC 알림 (P5.2) — 상태 전이 → Discord 웹훅
 * ----------------------------------------------------------------------
 * 설계: docs/v2/notifications/notifications.md
 * 발동은 서버측 Firestore 트리거 — 클라 호출 우회·웹훅발 전이(merged) 누락을 막는다.
 *
 * 설계 문서는 feature/review/discussion 3개 트리거를 나눴지만, 현재 리뷰는
 * feature 문서의 `reviews[]` 배열이라 승인/반려도 status 변경과 **같은 쓰기**로
 * 온다 → onDocumentWritten('features/{id}') 하나로 상태전이+리뷰를 중복 없이
 * 커버한다. discussion 트리거는 P5.1(서브컬렉션) 이후 추가.
 *
 * 시크릿: DISCORD_WEBHOOK_URL (Secret Manager, infra-playbook 참고)
 * 대상 표현: 공용 채널 + 역할 실멘션(<@&roleId>, content 필드). 개인 <@id> 멘션은
 * users.discordId 매핑 후 Tier 2.
 */
const { onDocumentWritten, onDocumentCreated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { levelBetween, compatLevel } = require('./semver');

const DISCORD_WEBHOOK_URL = defineSecret('DISCORD_WEBHOOK_URL');
const DASHBOARD_URL = 'https://mash-up-kr.github.io/mino-android-spec-center/';

// Discord 역할 ID — 멘션은 embed 안에서는 핑이 안 울려서 content 필드에 넣는다.
// 역할 설정에서 "누구나 이 역할을 @mention할 수 있음" 필요.
const ROLE_ANDROID = '1511671340225007736'; // [민호야잘하자] Android (개발자)
const ROLE_DESIGN = '1511671633654317076'; // [민호야잘하자] Design (디자이너)
// PRD 전용 추가 대상 — PRD 는 제품 전체 문서라 Android 팀만의 것이 아니다.
// spec 파이프라인 알림(컨펌요청·승인·반려·무효화·머지)은 MASC 가 안드로이드 spec 만
// 다루므로 아래 두 역할을 태그하지 않는다. PRD 개정에만 붙는다.
const ROLE_IOS = '1511671488464425011';    // [민호야잘하자] iOS
const ROLE_NODE = '1511671713602076693';   // [민호야잘하자] Node
const PRD_EXTRA_ROLES = [ROLE_IOS, ROLE_NODE];

// Discord embed 색 (대시보드 상태 뱃지 색과 톤 맞춤)
const COLORS = {
  review: 0xf59e0b,   // amber — 검토 요청
  approved: 0x22c55e, // green — 승인
  rejected: 0xef4444, // red — 반려
  invalid: 0xf97316,  // orange — 무효화
  merged: 0x8b5cf6,   // purple — 머지(확정)
};

// 무효화로 간주하는 복귀 출발 상태 (state-machine.md §3)
const COMMITTED = ['spec_approved', 'pr_open', 'merged'];

// PRD(P8) 개정 등급별 색 — 하위 spec 이 받는 충격 크기와 같은 순서다.
const PRD_COLORS = {
  init: 0x8b5cf6,   // purple — 최초 등록
  major: 0xef4444,  // red — MVP 경계 변경, 하위 spec 재작성
  minor: 0xf59e0b,  // amber — 항목 추가
  patch: 0x6b7280,  // gray — 표현·링크
  same: 0x6b7280,   // gray — 같은 버전 본문 갱신
};

exports.notifyOnFeatureWrite = onDocumentWritten(
  { document: 'features/{id}', secrets: [DISCORD_WEBHOOK_URL] },
  async (event) => {
    const before = event.data && event.data.before.exists ? event.data.before.data() : null;
    const after = event.data && event.data.after.exists ? event.data.after.data() : null;
    if (!before || !after) return; // 생성/삭제는 알림 대상 아님 (전이만)
    if (before.status === after.status) return; // 가드: 상태 불변 쓰기는 조용히 종료

    const msg = buildMessage(event.params.id, before, after);
    if (!msg) return; // 관심 없는 전이 (pr_open, pr_closed 등)

    // 작성자 이름 해석 — 실패해도 알림은 나간다
    let author = '';
    try {
      const snap = await admin.firestore().doc(`users/${after.createdBy}`).get();
      author = (snap.exists && (snap.data().name || snap.data().githubLogin)) || '';
    } catch (e) { console.error('notify: author lookup 실패', e.message); }

    const embed = {
      title: msg.title,
      description: msg.body || '',
      color: msg.color,
      fields: [
        { name: '버전', value: after.specVersion || '-', inline: true },
        { name: '전이', value: `${before.status} → ${after.status}`, inline: true },
        ...(author ? [{ name: '작성자', value: author, inline: true }] : []),
      ],
      url: `${DASHBOARD_URL}?feature=${encodeURIComponent(event.params.id)}`,
    };

    try {
      const r = await fetch(DISCORD_WEBHOOK_URL.value(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: msg.roles.map((id) => `<@&${id}>`).join(' '),
          embeds: [embed],
          allowed_mentions: { parse: [], roles: msg.roles },
        }),
      });
      if (!r.ok) console.error('notify: Discord 응답', r.status, await r.text());
    } catch (e) {
      console.error('notify: Discord 전송 실패', e.message); // 알림 실패가 파이프라인을 막지 않는다
    }
  }
);

// 전이 → 알림 매핑 (notifications.md §3 전이표). null 반환 = 알림 없음.
function buildMessage(id, before, after) {
  const t = after.title || id;
  const v = after.specVersion || '';

  if (after.status === 'spec_in_review') {
    return { title: `🔍 리뷰 요청: ${t} ${v}`, roles: [ROLE_DESIGN], color: COLORS.review };
  }
  if (after.status === 'spec_approved' && before.status === 'spec_in_review') {
    return { title: `✅ 승인됨: ${t}`, roles: [ROLE_ANDROID], color: COLORS.approved };
  }
  if (after.status === 'spec_changes_requested' && before.status === 'spec_in_review') {
    return {
      title: `🔁 반려: ${t}`, roles: [ROLE_ANDROID], color: COLORS.rejected,
      body: rejectionSummary(before, after),
    };
  }
  if (after.status === 'spec_draft' && COMMITTED.includes(before.status)) {
    return { title: `⚠️ 무효화: ${t} — 재작업 필요`, roles: [ROLE_ANDROID], color: COLORS.invalid };
  }
  if (after.status === 'merged') {
    return {
      title: `🎉 spec 확정(merged): ${t} ${v}`, roles: [ROLE_ANDROID, ROLE_DESIGN], color: COLORS.merged,
      body: after.baseBranch ? `base 브랜치 \`${after.baseBranch}\` 에 반영 — 이어서 \`/mino-plan\` 진행` : '',
    };
  }
  return null;
}

// ===================== PRD (P8) =====================
// 요구사항 ④ — PRD 업로드/개정 시 Discord 알림.
// ③(버전 호환)과 만나는 지점: `/mino-prd` 가 로컬에서 실행자 **개인에게만** 보고하던
// "기준 PRD 버전이 뒤처진 spec 목록"을 서버가 재현해 **팀 전체에 방송**한다.
exports.notifyOnPrdWrite = onDocumentWritten(
  { document: 'prds/{id}', secrets: [DISCORD_WEBHOOK_URL] },
  async (event) => {
    const before = event.data && event.data.before.exists ? event.data.before.data() : null;
    const after = event.data && event.data.after.exists ? event.data.after.data() : null;
    if (!after) return;                                   // 삭제는 규칙상 불가
    const prev = before ? (before.version || '') || null : null;
    const cur = after.version || '';
    if (!cur) return;
    const level = prev ? levelBetween(prev, cur) : 'init';
    // 같은 버전 + 본문 동일 = 메모 편집 등 부수 쓰기 → 조용히 종료
    if (level === 'same' && before && (before.body || '') === (after.body || '')) return;

    const title = after.title || event.params.id;
    // MAJOR/MINOR 개정은 하위 spec 이 뒤처진다 → 재실행 대상을 추려 함께 알린다.
    const stale = (level === 'major' || level === 'minor') ? await staleSpecs(cur) : [];
    // 등록·MAJOR·MINOR 는 **4개 역할 전부** 태그한다 — PRD 는 제품 전체 문서라
    // 범위가 바뀌면(신설이든 확장이든) 모든 플랫폼과 디자인이 알아야 한다.
    // PATCH·본문 갱신만 무멘션 — 표현 수준 변경까지 울리면 정작 MAJOR 를 놓친다.
    const roles = ['init', 'major', 'minor'].includes(level)
      ? [ROLE_ANDROID, ROLE_DESIGN, ...PRD_EXTRA_ROLES]
      : [];

    const head = level === 'init' ? `📘 PRD 등록: ${title} ${cur}`
      : level === 'same' ? `📘 PRD 본문 갱신: ${title} ${cur}`
        : `📘 PRD ${level.toUpperCase()} 개정: ${title} ${prev} → ${cur}`;
    const body = [
      level === 'major' ? '⚠️ MVP 경계·용어가 바뀌었습니다 — 아래 spec 은 `/mino-spec` 재실행이 필요합니다.'
        : level === 'minor' ? '항목이 추가됐습니다 — 주제가 겹치는 spec 은 재실행을 검토하세요.'
          : level === 'patch' ? '표현·링크 수준 변경입니다 — spec 재실행은 불필요합니다.' : '',
      stale.length ? staleList(stale) : '',
    ].filter(Boolean).join('\n\n');

    await postDiscord({
      roles,
      embed: {
        title: head,
        description: body,
        color: PRD_COLORS[level] || PRD_COLORS.patch,
        fields: [
          { name: '버전', value: prev ? `${prev} → ${cur}` : cur, inline: true },
          { name: '항목', value: String((after.itemIds || []).length), inline: true },
          ...(after.lastAmendedAuthor ? [{ name: '개정자', value: after.lastAmendedAuthor, inline: true }] : []),
        ],
        url: `${DASHBOARD_URL}?prd=1`,
      },
    });
  }
);

// 기준 PRD 버전이 현재 PRD 보다 뒤처진 spec 목록 (major/minor 만 대상 — patch 는 무해)
async function staleSpecs(currentVersion) {
  try {
    const qs = await admin.firestore().collection('features').get();
    return qs.docs.map((d) => d.data())
      .map((f) => ({ f, level: compatLevel(f.prdVersion, currentVersion) }))
      .filter((x) => x.level === 'major' || x.level === 'minor')
      .map((x) => ({ title: x.f.title || x.f.slug, base: x.f.prdVersion || '없음', level: x.level }));
  } catch (e) {
    console.error('notify: stale spec 조회 실패', e.message);
    return [];
  }
}

function staleList(stale) {
  const shown = stale.slice(0, 5).map((s) => `• ${s.title} — 기준 \`${s.base}\``);
  const more = stale.length > 5 ? `\n…외 ${stale.length - 5}건` : '';
  return `**뒤처진 spec ${stale.length}건**\n${shown.join('\n')}${more}`;
}

// (선택) 논의 알림 — 멘션이 포함된 댓글만. 역할 핑은 하지 않는다(개인 매핑 전까지 소음 방지).
exports.notifyOnPrdComment = onDocumentCreated(
  { document: 'prds/{id}/comments/{msgId}', secrets: [DISCORD_WEBHOOK_URL] },
  async (event) => {
    const c = event.data && event.data.data();
    if (!c || c.deleted) return;
    const mentions = Array.isArray(c.mentions) ? c.mentions : [];
    if (!mentions.length) return;                        // 일반 댓글은 알리지 않는다

    let who = '';
    try {
      const snap = await admin.firestore().doc(`users/${c.authorUid}`).get();
      who = (snap.exists && (snap.data().name || snap.data().githubLogin)) || '';
    } catch (e) { console.error('notify: 댓글 작성자 조회 실패', e.message); }

    const text = String(c.body || '');
    await postDiscord({
      roles: [],
      embed: {
        title: `💬 PRD 논의에서 멘션: ${mentions.map((h) => '@' + h).join(' ')}`,
        description: (who ? `**${who}**\n` : '') + (text.length > 300 ? text.slice(0, 300) + '…' : text),
        color: 0x2563eb,
        fields: c.anchor ? [{ name: '섹션', value: String(c.anchor).slice(0, 100), inline: false }] : [],
        url: `${DASHBOARD_URL}?prd=1`,
      },
    });
  }
);

// ---------- Discord 전송 (전이 알림과 공유) ----------
async function postDiscord({ roles, embed }) {
  try {
    const r = await fetch(DISCORD_WEBHOOK_URL.value(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: (roles || []).map((id) => `<@&${id}>`).join(' '),
        embeds: [embed],
        allowed_mentions: { parse: [], roles: roles || [] },
      }),
    });
    if (!r.ok) console.error('notify: Discord 응답', r.status, await r.text());
  } catch (e) {
    console.error('notify: Discord 전송 실패', e.message); // 알림 실패가 파이프라인을 막지 않는다
  }
}

// 반려 쓰기에 함께 담겨온 새 리뷰의 코멘트 요약 (최대 3건, 각 80자)
function rejectionSummary(before, after) {
  const prev = Array.isArray(before.reviews) ? before.reviews.length : 0;
  const cur = Array.isArray(after.reviews) ? after.reviews : [];
  const added = cur.slice(prev).filter((r) => r && r.decision === 'changes_requested');
  const comments = added.flatMap((r) => r.comments || [])
    .map((c) => String((c && c.body) || '').trim()).filter(Boolean);
  if (!comments.length) return '';
  const shown = comments.slice(0, 3).map((b) => `• ${b.length > 80 ? b.slice(0, 80) + '…' : b}`);
  const more = comments.length > 3 ? `\n…외 ${comments.length - 3}건` : '';
  return `코멘트 ${comments.length}건\n${shown.join('\n')}${more}`;
}
