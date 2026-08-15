/**
 * 서버측 semver 헬퍼 (P8) — 브라우저 `js/version.js` 와 같은 규칙의 미러.
 * ----------------------------------------------------------------------
 * Functions 는 프론트 코드를 공유하지 않으므로 최소 구현만 둔다
 * (`index.js` 의 checklistSummary 와 같은 사정).
 * notify.js(PRD 개정 알림)와 index.js(PR 본문 얼라인 체크리스트)가 함께 쓴다.
 */

/** `1.2.3` · `v1.2` · `1` 을 모두 받아 [major, minor, patch]. 숫자가 없으면 null. */
function looseParse(v) {
  const m = /\bv?(\d+)(?:\.(\d+))?(?:\.(\d+))?\b/.exec(String(v == null ? '' : v).trim());
  return m ? [+m[1], +(m[2] || 0), +(m[3] || 0)] : null;
}

/** 두 버전의 관계 → major | minor | patch | same | unknown */
function levelBetween(prev, cur) {
  const a = looseParse(prev), b = looseParse(cur);
  if (!a || !b) return 'unknown';
  if (a[0] !== b[0]) return 'major';
  if (a[1] !== b[1]) return 'minor';
  if (a[2] !== b[2]) return 'patch';
  return 'same';
}

/**
 * spec 의 `기준 PRD 버전` 이 현재 PRD 대비 얼마나 뒤처졌는가.
 * 등급 의미는 `/mino-prd` SKILL.md §2 — "이미 갈라져 나간 하위 spec 이 영향을 받는가".
 * @returns none | same | patch | minor | major | ahead
 */
function compatLevel(specPrdVersion, prdVersion) {
  const a = looseParse(specPrdVersion), b = looseParse(prdVersion);
  if (!a || !b) return 'none';
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return 'ahead';                                   // spec 이 더 최신 = PRD 미업로드
    if (a[i] < b[i]) return i === 0 ? 'major' : i === 1 ? 'minor' : 'patch';
  }
  return 'same';
}

// 재실행 검토가 필요한 등급
const STALE_LEVELS = ['major', 'minor'];

module.exports = { looseParse, levelBetween, compatLevel, STALE_LEVELS };
