/**
 * MASC 버전 유틸 (window.MASCVersion) — v3
 *
 * 버전 소유권은 **로컬 `mino-spec` 스킬**에 있다. 스킬이 spec.md 헤더 `**버전**`을
 * MAJOR/MINOR/PATCH 로 올리고(사용자 승인), 대시보드는 그 값을 **읽기만** 한다.
 *   - 자동 bump · `## 변경 이력` 표 주입 · v0.1.0 강제는 모두 폐기.
 *   - 대시보드가 유지하는 것은 **버전별 본문 스냅샷 로그**뿐 — 재검토 시
 *     "지난 검토 이후 변경분" diff 를 만들기 위한 것이다.
 *     스냅샷은 spec 본문과 품질 체크리스트를 함께 담는다(문서별로 diff).
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

  const trimmed = (v) => (v == null ? '' : String(v).trim());

  /**
   * 스냅샷 로그 항목 — { version, level, at, reason, body, checklistBody }
   *   level         : 직전 항목 대비 파생 등급 (첫 항목은 'init')
   *   reason        : 개발자가 편집 가능한 메모 (기본 빈 값)
   *   body          : 그 버전 시점의 spec 본문 스냅샷 (재검토 diff 용)
   *   checklistBody : 같은 시점의 품질 체크리스트 스냅샷 (문서별 diff 용)
   */
  function logEntry(version, prevVersion, at, body, reason, checklistBody) {
    return {
      version: version || '',
      level: prevVersion ? levelBetween(prevVersion, version) : 'init',
      at: at || '',
      reason: reason || '',
      body: trimmed(body),
      checklistBody: trimmed(checklistBody),
    };
  }

  /**
   * 로그에 이번 저장분을 반영한 새 배열을 만든다.
   *   - 로그가 비었으면 최초 항목 생성
   *   - 버전이 올라갔으면 새 항목 append
   *   - 버전이 그대로면 마지막 항목의 스냅샷만 갱신(같은 버전 내 재편집)
   */
  function applySnapshot(log, version, at, body, checklistBody) {
    const list = (log || []).map((e) => Object.assign({}, e));
    const last = list[list.length - 1];
    if (!last) return [logEntry(version, null, at, body, '', checklistBody)];
    if (last.version !== version) return list.concat(logEntry(version, last.version, at, body, '', checklistBody));
    last.body = trimmed(body);
    last.checklistBody = trimmed(checklistBody);
    last.at = at || last.at;
    return list;
  }

  // ---------- PRD ↔ spec 버전 호환 (P8·요구사항 ③) ----------
  // spec 헤더 `**기준 PRD 버전**` 값은 원문 그대로 저장돼 `1.0.0`·`v1.0`·`없음` 이 섞인다.
  // 느슨하게 읽고(누락 자리는 0), 숫자를 못 찾으면 '미연결'로 떨어뜨린다.
  function looseParse(v) {
    const m = /\bv?(\d+)(?:\.(\d+))?(?:\.(\d+))?\b/.exec(String(v == null ? '' : v).trim());
    return m ? [+m[1], +(m[2] || 0), +(m[3] || 0)] : null;
  }

  /**
   * spec 이 근거로 삼은 PRD 버전 ↔ 현재 PRD 버전.
   * 등급 의미는 `/mino-prd` SKILL.md §2 — "이미 갈라져 나간 하위 spec 이 영향을 받는가".
   *
   * **라벨은 행동 중심**(2026-08-19). 이전 라벨(`PRD 비호환`·`PRD 뒤처짐`·`PRD 갱신`)은
   * ① 무엇을 해야 하는지 말해주지 않고 ② 주어가 헷갈렸다 — `PRD 뒤처짐` 은 실제로는
   * **spec 이** 뒤처진 상태인데 PRD 가 낡은 것처럼 읽혔다. 그래서 조치 주체를 라벨에 담는다:
   * `PRD 등록 필요` = PRD 를 올릴 사람 · `스펙 …` = spec 작성자.
   * `level` 값은 내부 식별자이므로 그대로 둔다(정렬·알림·PR 본문이 참조).
   *
   * @returns { level, label, color, hint }  level: none|same|patch|minor|major|ahead
   */
  function prdCompat(specPrdVersion, prdVersion) {
    const a = looseParse(specPrdVersion), b = looseParse(prdVersion);
    if (!a || !b) {
      return { level: 'none', label: '기준 PRD 없음', color: 'gray',
        hint: 'spec 헤더에 `**기준 PRD 버전**` 이 없거나, 대시보드에 PRD 가 아직 등록되지 않았습니다.' };
    }
    if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) {
      return { level: 'same', label: 'PRD 최신', color: 'green',
        hint: `현재 PRD(${prdVersion})를 기준으로 작성된 스펙입니다 — 할 일 없음.` };
    }
    // spec 이 더 높은 버전을 가리킴 = 최신 PRD 가 아직 업로드되지 않음
    for (let i = 0; i < 3; i++) {
      if (a[i] > b[i]) {
        return { level: 'ahead', label: 'PRD 등록 필요', color: 'amber',
          hint: `이 스펙은 PRD ${specPrdVersion} 을 보고 썼는데, 대시보드에는 ${prdVersion} 까지만 올라와 있습니다 — 최신 PRD 를 업로드해 주세요.` };
      }
      if (a[i] < b[i]) break;
    }
    if (a[0] !== b[0]) {
      return { level: 'major', label: '스펙 재작성 필요', color: 'red',
        hint: `이 스펙은 PRD ${specPrdVersion} 기준인데, PRD 가 ${prdVersion} 로 크게 바뀌었습니다(MVP 경계·용어 변경) — \`/mino-spec\` 을 다시 실행해 스펙을 새로 만들어야 합니다.` };
    }
    if (a[1] !== b[1]) {
      return { level: 'minor', label: '스펙 점검 필요', color: 'amber',
        hint: `이 스펙은 PRD ${specPrdVersion} 기준인데, PRD ${prdVersion} 에 항목이 추가됐습니다 — 추가된 내용이 이 스펙과 겹치는지 확인하고, 겹치면 \`/mino-spec\` 을 다시 실행하세요.` };
    }
    return { level: 'patch', label: '영향 없음', color: 'gray',
      hint: `PRD ${prdVersion} 은 표현·링크만 손본 변경입니다(이 스펙 기준 ${specPrdVersion}) — 스펙에 영향 없습니다.` };
  }

  // 재실행 검토가 필요한 등급 (알림·리포트에서 "뒤처진 spec" 으로 추리는 기준)
  const STALE_LEVELS = ['major', 'minor'];

  // 줄 단위 LCS diff → [{ t:'=' | '-' | '+', text }]
  // DP 는 (n+1)×(m+1) 배열이라 PRD 처럼 큰 문서끼리는 그대로 돌릴 수 없다.
  // ① 공통 접두/접미를 먼저 잘라내고(실무 개정은 일부 섹션만 바뀌므로 대개 여기서 해소)
  // ② 그래도 셀 수가 임계를 넘으면 LCS 를 포기하고 거친 diff(전체 교체)로 떨어뜨린다.
  const DIFF_CELL_LIMIT = 4000000; // ≈ 2000줄 × 2000줄

  function lcsDiff(A, B) {
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

  function diffLines(a, b) {
    const split = (s) => String(s == null ? '' : s).replace(/\r\n/g, '\n').split('\n');
    const A = split(a), B = split(b);
    // ① 공통 접두/접미 트리밍
    let s = 0;
    while (s < A.length && s < B.length && A[s] === B[s]) s++;
    let e = 0;
    while (e < A.length - s && e < B.length - s && A[A.length - 1 - e] === B[B.length - 1 - e]) e++;
    const midA = A.slice(s, A.length - e);
    const midB = B.slice(s, B.length - e);
    // ② 임계 초과 시 거친 diff — 정확한 최소 편집 대신 "이 구간이 통째로 바뀜"으로 표시
    let mid, coarse = false;
    if (midA.length * midB.length > DIFF_CELL_LIMIT) {
      coarse = true;
      mid = midA.map((t) => ({ t: '-', text: t })).concat(midB.map((t) => ({ t: '+', text: t })));
    } else {
      mid = lcsDiff(midA, midB);
    }
    const out = A.slice(0, s).map((t) => ({ t: '=', text: t }))
      .concat(mid, A.slice(A.length - e).map((t) => ({ t: '=', text: t })));
    if (coarse) out.coarse = true;   // app.js 가 "정밀 비교 생략" 안내를 띄운다
    return out;
  }

  window.MASCVersion = {
    parse, fmt, levelBetween, isRegression, logEntry, applySnapshot, diffLines,
    looseParse, prdCompat, STALE_LEVELS, DIFF_CELL_LIMIT,
  };
})();
