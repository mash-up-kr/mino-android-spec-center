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
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

const DISCORD_WEBHOOK_URL = defineSecret('DISCORD_WEBHOOK_URL');
const DASHBOARD_URL = 'https://mash-up-kr.github.io/mino-android-spec-center/';

// Discord 역할 ID — 멘션은 embed 안에서는 핑이 안 울려서 content 필드에 넣는다.
// 역할 설정에서 "누구나 이 역할을 @mention할 수 있음" 필요.
const ROLE_ANDROID = '1511671340225007736'; // [민호야잘하자] Android (개발자)
const ROLE_DESIGN = '1511671633654317076'; // [민호야잘하자] Design (디자이너)

// Discord embed 색 (대시보드 상태 뱃지 색과 톤 맞춤)
const COLORS = {
  review: 0xf59e0b,   // amber — 검토 요청
  approved: 0x22c55e, // green — 승인
  rejected: 0xef4444, // red — 반려
  invalid: 0xf97316,  // orange — 무효화
  merged: 0x8b5cf6,   // purple — 머지(확정)
};

// 무효화로 간주하는 복귀 출발 상태 (state-machine.md §3)
const COMMITTED = ['spec_approved', 'plan_drafted', 'pr_open', 'merged'];

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
    return { title: `🎉 문서 확정(merged): ${t} ${v}`, roles: [ROLE_ANDROID, ROLE_DESIGN], color: COLORS.merged };
  }
  return null;
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
