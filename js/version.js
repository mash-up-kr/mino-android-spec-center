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

  // 변경이력 로그 항목 { version, level, reason, at, body? }
  // body = 그 버전 시점의 스펙 스냅샷(변경이력 표 제거한 content-only) — 재검토 diff 용
  const logEntry = (version, event, at, body) =>
    ({ version, level: event, reason: reason(event), at, body: body == null ? '' : body });

  // 본문에서 `## 변경 이력` 섹션 제거(diff 노이즈·스냅샷 크기 절감). injectVersionHistory 의 역.
  function stripHistory(body) {
    const lines = String(body || '').replace(/\r\n/g, '\n').split('\n');
    const isHist = (l) => /^##\s+(?:\d+\.\s*)?변경\s*이력\s*$/.test(l);
    const start = lines.findIndex(isHist);
    if (start < 0) return String(body || '').trim();
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) { if (/^##\s+/.test(lines[i])) { end = i; break; } }
    return lines.slice(0, start).concat(lines.slice(end)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // 줄 단위 LCS diff → [{ t:'=' | '-' | '+', text }]
  function diffLines(a, b) {
    const A = String(a || '').split('\n'), B = String(b || '').split('\n');
    const n = A.length, m = B.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const out = []; let i = 0, j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { out.push({ t: '=', text: A[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: '-', text: A[i] }); i++; }
      else { out.push({ t: '+', text: B[j] }); j++; }
    }
    while (i < n) { out.push({ t: '-', text: A[i] }); i++; }
    while (j < m) { out.push({ t: '+', text: B[j] }); j++; }
    return out;
  }

  // versionLog → 마크다운 `## 변경 이력` 표(버전=1열, 최신=마지막 행: spec-parse 규약).
  // functions/index.js 의 buildHistoryTable/injectVersionHistory 와 동일 로직(미러).
  function buildHistoryTable(versionLog) {
    const rows = (versionLog || []).map((e) =>
      `| ${e.version} | ${e.at || ''} | ${String(e.reason || '').replace(/\|/g, '/')} |`);
    return ['| 버전 | 날짜 | 변경 내용 |', '|------|------|-----------|'].concat(rows).join('\n');
  }
  // spec 본문의 `## 변경 이력` 섹션을 versionLog 표로 교체(없으면 말미 추가). 번호 접두사 보존. 멱등.
  function injectVersionHistory(specBody, versionLog) {
    if (!versionLog || !versionLog.length) return specBody;
    const table = buildHistoryTable(versionLog);
    const lines = String(specBody).replace(/\r\n/g, '\n').split('\n');
    const isHist = (l) => /^##\s+(?:\d+\.\s*)?변경\s*이력\s*$/.test(l);
    const start = lines.findIndex(isHist);
    if (start < 0) return String(specBody).replace(/\n*$/, '') + `\n\n## 변경 이력\n\n${table}\n`;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) { if (/^##\s+/.test(lines[i])) { end = i; break; } }
    const pm = lines[start].match(/^##\s+(\d+\.\s*)?/);
    const prefix = pm && pm[1] ? pm[1] : '';
    const before = lines.slice(0, start).join('\n').replace(/\n*$/, '');
    const after = lines.slice(end).join('\n').replace(/^\n*/, '');
    let out = `${before}\n\n## ${prefix}변경 이력\n\n${table}\n`;
    if (after) out += `\n${after}`;
    return out;
  }

  window.MASCVersion = {
    INIT, parse, bump, invalidationLevel, reason, logEntry, injectVersionHistory,
    stripHistory, diffLines,
  };
})();
