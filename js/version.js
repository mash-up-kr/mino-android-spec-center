/**
 * MASC 버전 유틸 (window.MASCVersion) — v3
 *
 * 버전 소유권은 **로컬 `mino-spec` 스킬**에 있다. 스킬이 spec.md 헤더 `**버전**`을
 * MAJOR/MINOR/PATCH 로 올리고(사용자 승인), 대시보드는 그 값을 **읽기만** 한다.
 *   - 자동 bump · `## 변경 이력` 표 주입 · v0.1.0 강제는 모두 폐기.
 *   - 대시보드가 유지하는 것은 **버전별 본문 스냅샷 로그**뿐 — 재검토 시
 *     "지난 검토 이후 변경분" diff 를 만들기 위한 것이다.
 * MAJOR/MINOR/PATCH 뱃지는 직전 스냅샷과의 semver 비교로 표시 시점에 파생한다.
 */
(function () {
  function parse(v) {
    const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim());
    return m ? [+m[1], +m[2], +m[3]] : null;
  }
  const fmt = (a) => `${a[0]}.${a[1]}.${a[2]}`;

  /** 두 버전의 관계 → 'major' | 'minor' | 'patch' | 'same' | 'unknown' */
  function levelBetween(prev, cur) {
    const a = parse(prev), b = parse(cur);
    if (!a || !b) return 'unknown';
    if (b[0] !== a[0]) return 'major';
    if (b[1] !== a[1]) return 'minor';
    if (b[2] !== a[2]) return 'patch';
    return 'same';
  }

  /** prev 대비 cur 이 뒤로 갔는지 (스킬이 올리지 않고 되돌린 경우 경고용) */
  function isRegression(prev, cur) {
    const a = parse(prev), b = parse(cur);
    if (!a || !b) return false;
    for (let i = 0; i < 3; i++) {
      if (b[i] > a[i]) return false;
      if (b[i] < a[i]) return true;
    }
    return false;
  }

  /**
   * 스냅샷 로그 항목 — { version, level, at, reason, body }
   *   level  : 직전 항목 대비 파생 등급 (첫 항목은 'init')
   *   reason : 개발자가 편집 가능한 메모 (기본 빈 값)
   *   body   : 그 버전 시점의 spec 본문 스냅샷 (재검토 diff 용)
   */
  function logEntry(version, prevVersion, at, body, reason) {
    return {
      version: version || '',
      level: prevVersion ? levelBetween(prevVersion, version) : 'init',
      at: at || '',
      reason: reason || '',
      body: body == null ? '' : String(body).trim(),
    };
  }

  /**
   * 로그에 이번 저장분을 반영한 새 배열을 만든다.
   *   - 로그가 비었으면 최초 항목 생성
   *   - 버전이 올라갔으면 새 항목 append
   *   - 버전이 그대로면 마지막 항목의 스냅샷만 갱신(같은 버전 내 재편집)
   */
  function applySnapshot(log, version, at, body) {
    const list = (log || []).map((e) => Object.assign({}, e));
    const last = list[list.length - 1];
    if (!last) return [logEntry(version, null, at, body)];
    if (last.version !== version) return list.concat(logEntry(version, last.version, at, body));
    last.body = body == null ? '' : String(body).trim();
    last.at = at || last.at;
    return list;
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

  window.MASCVersion = {
    parse, fmt, levelBetween, isRegression, logEntry, applySnapshot, diffLines,
  };
})();
