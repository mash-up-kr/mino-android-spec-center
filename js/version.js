/**
 * MASC 자동 버저닝 (window.MASCVersion)
 *
 * 버전 = spec.md `## 변경 이력` 표의 값이지만, 이제 **대시보드가 소유**한다.
 * blast-radius(무효화 파급 범위) 기준으로 상태 전이 이벤트에서 자동 bump:
 *   - PATCH : 승인 전 반려→재제출 라운드 (spec_changes_requested → spec_in_review)
 *   - MINOR : 승인됐지만 미머지 스펙 무효화 (spec_approved/plan_drafted/pr_open → 수정)
 *   - MAJOR : 머지된 스펙 무효화 (merged → 수정)
 * 승격: 최초 머지 시 0.x → v1.0.0 (코드에 착지 = 릴리스 신호).
 * bump 은 저장마다가 아니라 전이 이벤트에서만 발생(변경이력 노이즈 방지).
 */
(function () {
  const INIT = 'v0.1.0';

  function parse(v) {
    const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim());
    return m ? [+m[1], +m[2], +m[3]] : null;
  }
  const fmt = (a) => `v${a[0]}.${a[1]}.${a[2]}`;

  // level: 'patch' | 'minor' | 'major' | 'graduate'
  function bump(current, level) {
    const a = parse(current) || parse(INIT);
    if (level === 'patch') return fmt([a[0], a[1], a[2] + 1]);
    if (level === 'minor') return fmt([a[0], a[1] + 1, 0]);
    if (level === 'major') return fmt([a[0] + 1, 0, 0]);
    if (level === 'graduate') return a[0] === 0 ? 'v1.0.0' : fmt(a); // 이미 릴리스면 그대로
    return fmt(a);
  }

  // 무효화(수정) 시 레벨: 머지된 스펙이면 major, 그 외(승인/plan/PR)면 minor
  const invalidationLevel = (status) => (status === 'merged' ? 'major' : 'minor');

  // 이벤트별 기본 사유 문구 (개발자가 편집 가능)
  const REASONS = {
    init: '최초 작성',
    patch: '반려 반영 후 재검토 요청',
    minor: '승인 후 수정 — 무효화 (재검토 필요)',
    major: '머지된 스펙 수정 — 무효화',
    graduate: '최초 머지 (릴리스)',
  };
  const reason = (event) => REASONS[event] || '';

  // 변경이력 로그 항목 { version, level, reason, at }
  const logEntry = (version, event, at) => ({ version, level: event, reason: reason(event), at });

  window.MASCVersion = { INIT, parse, bump, invalidationLevel, reason, logEntry };
})();
