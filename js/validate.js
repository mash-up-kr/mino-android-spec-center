/**
 * MASC 붙여넣기 구조 검증 (v3) — docs/design/validation.md S1–S6
 * ----------------------------------------------------------------------
 * 대시보드 2차 방어선. 본문을 데이터로 파싱하지 않고 구조만 기계 검사한다.
 * 기준 템플릿: Mino-Android `mino-sdd/template/spec-template.md`
 * 1차 방어선은 로컬 `mino-spec` 스킬의 품질 체크리스트(상태 CREATED = PASS).
 * 다만 미완성 신호(상태 DRAFT · `[TBD]` 잔여)는 **차단하지 않고 경고**한다 —
 * 오히려 디자이너 검수가 필요한 상태이므로 대시보드에 올라오는 것이 이 도구의 목적이다.
 * validateSpec(body) → { ok, errors: [{code,msg}], warnings: [{code,msg}], meta }
 */
(function () {
  const S = window.MASCSpec;

  // S2: 필수 H2 4개 (순서·핵심 제목). 숫자 접두사·영문 병기·`*(필수)*` 는 무시.
  const REQUIRED_H2 = ['유저 시나리오', '요구사항', '범위', '가정'];
  // S3: 헤더 상태 통제 어휘. DRAFT 도 업로드 가능(경고) — 검수 대상이기 때문.
  const SPEC_STATUSES = ['DRAFT', 'CREATED'];
  // S6: 템플릿에서 그대로 남은 자리표시자 (치환되지 않으면 미완성 — mino-spec 완료 조건)
  const PLACEHOLDERS = [
    '[FEATURE NAME]', '{SPEC_DIR}', '[날짜]', '[DRAFT, CREATED]', '$ARGUMENTS',
    '[간단한 제목]', '[필요에 따라 유저 플로우를 추가]',
  ];

  function validateSpec(body) {
    const errors = [];
    const warnings = [];
    const add = (code, msg) => errors.push({ code, msg });
    const warn = (code, msg) => warnings.push({ code, msg });
    const meta = S.parseMeta(body);

    // ── S1 — 대상 스펙 경로 → slug ──
    const pathField = S.headerField(body, '대상 스펙 경로');
    if (!pathField) {
      add('S1', '헤더에 `**대상 스펙 경로**: docs/specs/{feature-name}` 이 없습니다.');
    } else if (!meta.slug) {
      add('S1', `대상 스펙 경로 "${pathField}" 에서 slug를 찾지 못했습니다 — \`docs/specs/{feature-name}\` 형식이어야 합니다.`);
    } else if (!/^[a-z0-9-]+$/.test(meta.slug)) {
      add('S1', `slug "${meta.slug}" 형식 오류 — 영소문자/숫자/하이픈만 허용.`);
    }
    if (!meta.title) add('S1', 'H1 제목(`# 스펙 명세서: {기능명}`)이 없습니다.');

    // ── S2 — 필수 H2 4개 (순서·제목 일치) ──
    const got = S.h2List(body).map((h) => h.core);
    let cursor = 0;
    const missing = [];
    REQUIRED_H2.forEach((title) => {
      const idx = got.indexOf(title, cursor);
      if (idx < 0) missing.push(title);
      else cursor = idx + 1; // 순서 보장
    });
    if (missing.length) {
      add('S2', `필수 H2 누락/순서 오류: ${missing.join(' · ')} (${REQUIRED_H2.join(' → ')} 순서여야 함).`);
    }

    // ── S3 — 헤더 메타 (상태·버전·날짜·기준 PRD 버전) ──
    if (!meta.specStatus) {
      add('S3', '헤더에 `**상태**` 가 없습니다.');
    } else if (!SPEC_STATUSES.includes(meta.specStatus)) {
      add('S3', `상태 "${meta.specStatus}" 무효 — ${SPEC_STATUSES.join('/')} 중 하나여야 합니다.`);
    } else if (meta.specStatus !== 'CREATED') {
      warn('S3', '상태가 `DRAFT` 입니다 — 미완성 스펙으로 업로드됩니다. 디자이너 검수에서 확정해 주세요.');
    }
    if (!meta.specVersion) {
      add('S3', '헤더 `**버전**` 에서 버전(X.Y.Z)을 파싱하지 못했습니다.');
    }
    ['최초 작성일', '최종 수정일'].forEach((name) => {
      const v = S.headerField(body, name);
      if (!v) add('S3', `헤더에 \`**${name}**\` 이 없습니다.`);
      else if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) add('S3', `${name} "${v}" 형식 오류 — YYYY-MM-DD 여야 합니다.`);
    });
    if (!meta.prdVersion) {
      add('S3', '헤더에 `**기준 PRD 버전**` 이 없습니다 (PRD가 없는 프로젝트면 `없음`).');
    }

    // ── S4 — 요구사항 ID 컨벤션 (FR/UX/SC) ──
    const idCheck = [
      { code: 'FR', re: /\bFR-\d{3}\b/, block: S.blockByRaw(body, /^2\.1\b/, 3), where: '§2.1 기능적 요구사항' },
      { code: 'UX', re: /\bUX-\d{3}\b/, block: S.blockByRaw(body, /^2\.2\b/, 3), where: '§2.2 핵심 UX 규칙' },
      { code: 'SC', re: /\bSC-\d{3}\b/, block: S.blockByRaw(body, /^3\.1\b/, 3), where: '§3.1 측정 가능한 성과' },
    ];
    idCheck.forEach((c) => {
      if (!c.block.trim()) add('S4', `${c.where} 섹션이 없습니다.`);
      else if (!c.re.test(c.block)) add('S4', `${c.where} 에 \`${c.code}-001\` 형식 항목이 1개 이상 필요합니다.`);
    });
    // 3.2 비목표는 ID 없이 항목만 요구
    const outOfScope = S.blockByRaw(body, /^3\.2\b/, 3);
    if (!outOfScope.trim()) add('S4', '§3.2 비목표 항목 섹션이 없습니다.');
    else if (!/^\s*[-*]\s+\S/m.test(outOfScope)) add('S4', '§3.2 비목표 항목에 항목이 1개 이상 필요합니다.');

    // ── S5 — 유저 플로우 구조 (진입/완료 조건 + 테스트 시나리오) ──
    const flows = S.blocksByRaw(body, /^유저\s*플로우/, 3);
    if (!flows.length) {
      add('S5', '§1 유저 시나리오에 `### 유저 플로우 N - {제목}` 이 1개 이상 필요합니다.');
    }
    flows.forEach((f) => {
      const label = f.raw;
      if (!/\*\*\s*진입 조건\s*\*\*/.test(f.block)) add('S5', `"${label}" 에 \`**진입 조건**\` 이 없습니다.`);
      if (!/\*\*\s*완료 조건\s*\*\*/.test(f.block)) add('S5', `"${label}" 에 \`**완료 조건**\` 이 없습니다.`);
      const tsTable = S.parseTables(f.block).find((t) =>
        t.header.includes('Given') && t.header.includes('When') && t.header.includes('Then'));
      if (!tsTable) {
        add('S5', `"${label}" 에 Given/When/Then 컬럼을 가진 테스트 시나리오 표가 없습니다.`);
      } else if (!tsTable.rows.some((r) => r.some((c) => /\bTS-\d{3}\b/.test(c)))) {
        add('S5', `"${label}" 테스트 시나리오 표에 \`TS-001\` 형식 행이 1개 이상 필요합니다.`);
      }
    });

    // ── S6 — 자리표시자 잔여 (하드) · [TBD] 잔여 (경고) ──
    // 자리표시자는 템플릿을 손대지 않은 흔적이라 여전히 차단하고,
    // `[TBD]` 는 "디자이너에게 물어볼 지점"이므로 경고로만 남긴다.
    const left = PLACEHOLDERS.filter((p) => body.indexOf(p) >= 0);
    if (left.length) {
      add('S6', `치환되지 않은 템플릿 자리표시자: ${left.join(' · ')}`);
    }
    const tbd = (body.match(/\[TBD\b[^\]]*\]/g) || []);
    if (tbd.length) {
      warn('S6', `미해소 \`[TBD]\` ${tbd.length}건 — 검수에서 확정이 필요한 항목입니다. (예: ${tbd[0]})`);
    }

    return { ok: errors.length === 0, errors, warnings, meta };
  }

  window.MASCValidate = { validateSpec, REQUIRED_H2, SPEC_STATUSES, PLACEHOLDERS };
})();
