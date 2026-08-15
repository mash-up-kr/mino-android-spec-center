/**
 * MASC 붙여넣기 구조 검증 (v3) — docs/design/validation.md S1–S6
 * ----------------------------------------------------------------------
 * 대시보드 2차 방어선. 본문을 데이터로 파싱하지 않고 구조만 기계 검사한다.
 * 기준 템플릿: Mino-Android `mino-sdd/template/spec-template.md`
 * 1차 방어선은 로컬 `mino-spec` 스킬의 품질 체크리스트(상태 CREATED = PASS).
 * 다만 미완성 신호(상태 DRAFT · `[TBD]` 잔여)는 **차단하지 않고 경고**한다 —
 * 오히려 디자이너 검수가 필요한 상태이므로 대시보드에 올라오는 것이 이 도구의 목적이다.
 * validateSpec(body)      → { ok, errors: [{code,msg}], warnings: [{code,msg}], meta }
 * validateChecklist(body) → 같은 형태 (C1–C7). 기준 템플릿: `mino-sdd/template/spec-checklist-template.md`
 *   체크리스트도 같은 원칙이다 — 골격은 하드 차단, 미통과(FAILED/DRAFT·미체크 항목)는 경고.
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

  // C4: 체크리스트 필수 H2 4개 (순서·핵심 제목). 괄호 영문 병기는 coreTitle 이 벗긴다.
  const REQUIRED_CHECKLIST_H2 = ['스펙 품질', '요구사항 완전성', '스펙 완성도', '비고'];
  // C3: 체크리스트 헤더 상태 통제 어휘. FAILED/DRAFT 도 업로드 가능(경고).
  const CHECKLIST_STATUSES = ['PASS', 'FAILED', 'DRAFT'];
  // C6: 체크리스트 템플릿 자리표시자
  const CHECKLIST_PLACEHOLDERS = [
    '[FEATURE NAME]', '[날짜]', '[PASS/FAILED/DRAFT]', '[spec.md 링크]',
    '[해당 spec 버전 (예 : v1.0)]',
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

  // ===================== 품질 체크리스트 (C1–C7) =====================

  // 버전 비교는 major.minor 까지만 — 템플릿 예시가 `v1.0`(2자리)인데 spec 헤더는 `1.0.0`(3자리)라
  // 엄격 비교하면 정상 산출물이 전부 걸린다. PATCH 차이는 오탐이므로 무시한다.
  const majorMinor = (v) => {
    const m = /^v?(\d+)\.(\d+)/.exec(String(v || '').trim());
    return m ? `${m[1]}.${m[2]}` : null;
  };

  /**
   * @param body      spec-checklist.md 원문
   * @param specMeta  같이 업로드되는 spec 의 메타(MASCSpec.parseMeta 결과). 없으면 C7 생략.
   */
  function validateChecklist(body, specMeta) {
    const errors = [];
    const warnings = [];
    const add = (code, msg) => errors.push({ code, msg });
    const warn = (code, msg) => warnings.push({ code, msg });
    const meta = S.parseChecklistMeta(body);

    // ── C1 — H1 제목 ──
    const h1 = (S.headings(body).find((h) => h.level === 1) || {}).raw;
    if (!h1) {
      add('C1', 'H1 제목(`# Spec 품질 체크리스트: {기능명}`)이 없습니다.');
    } else if (!/^Spec\s*품질\s*체크리스트\s*[:：]/i.test(h1)) {
      add('C1', `H1 "${h1}" 형식 오류 — \`# Spec 품질 체크리스트: {기능명}\` 이어야 합니다.`);
    }

    // ── C2 — 헤더 메타 (작성일 · 대상 스펙) ──
    const created = S.headerField(body, '작성일');
    if (!created) add('C2', '헤더에 `**작성일**` 이 없습니다.');
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(created)) add('C2', `작성일 "${created}" 형식 오류 — YYYY-MM-DD 여야 합니다.`);
    if (!meta.targetRaw) {
      add('C2', '헤더에 `**대상 스펙**: [spec.md](../spec.md) - {버전}` 이 없습니다.');
    } else if (!meta.targetVersion) {
      add('C2', `대상 스펙 "${meta.targetRaw}" 에서 spec 버전을 찾지 못했습니다 — \`[spec.md](../spec.md) - 1.0.0\` 형식이어야 합니다.`);
    }

    // ── C3 — 상태 (FAILED/DRAFT 는 경고) ──
    if (!meta.status) {
      add('C3', '헤더에 `**상태**` 가 없습니다.');
    } else if (!CHECKLIST_STATUSES.includes(meta.status)) {
      add('C3', `상태 "${meta.status}" 무효 — ${CHECKLIST_STATUSES.join('/')} 중 하나여야 합니다.`);
    } else if (meta.status !== 'PASS') {
      warn('C3', `체크리스트 상태가 \`${meta.status}\` 입니다 — 품질 검증을 통과하지 못한 스펙으로 업로드됩니다.`);
    }

    // ── C4 — 필수 H2 4개 (순서·제목 일치) ──
    const got = S.h2List(body).map((h) => h.core);
    let cursor = 0;
    const missing = [];
    REQUIRED_CHECKLIST_H2.forEach((title) => {
      const idx = got.indexOf(title, cursor);
      if (idx < 0) missing.push(title);
      else cursor = idx + 1;
    });
    if (missing.length) {
      add('C4', `필수 H2 누락/순서 오류: ${missing.join(' · ')} (${REQUIRED_CHECKLIST_H2.join(' → ')} 순서여야 함).`);
    }

    // ── C5 — 체크박스 항목 (미체크는 경고) ──
    if (!meta.total) {
      add('C5', '`- [ ]` / `- [x]` 형식의 검증 항목이 하나도 없습니다.');
    } else if (meta.checked < meta.total) {
      warn('C5', `미통과 항목 ${meta.total - meta.checked}건 (${meta.checked}/${meta.total} 통과) — 검수에서 확인이 필요합니다.`);
    }

    // ── C6 — 자리표시자 잔여 ──
    const left = CHECKLIST_PLACEHOLDERS.filter((p) => body.indexOf(p) >= 0);
    if (left.length) add('C6', `치환되지 않은 템플릿 자리표시자: ${left.join(' · ')}`);

    // ── C7 — spec 버전과 대조 (경고) ──
    if (specMeta && specMeta.specVersion && meta.targetVersion) {
      const a = majorMinor(specMeta.specVersion), b = majorMinor(meta.targetVersion);
      if (a && b && a !== b) {
        warn('C7', `체크리스트 대상 버전(${meta.targetVersion})이 spec 버전(${specMeta.specVersion})과 다릅니다 — 이전 버전 기준 체크리스트일 수 있습니다.`);
      }
    }

    return { ok: errors.length === 0, errors, warnings, meta };
  }

  // ===================== PRD (P1–P7) =====================
  // 기준 템플릿: `mino-sdd/template/prd-template.md` · 상세: docs/design/prd-track.md §3
  // spec·체크리스트와 같은 원칙 — 골격은 하드 차단, 미확정(TBD:)은 경고.

  // P3: 필수 섹션 4개 (H1, 순서). 숫자 접두사는 coreTitle 이 벗기고, 비교는 공백 무시.
  const REQUIRED_PRD_SECTIONS = [
    '서비스 개요 및 개발 방향', '목표 / 비목표', '화면 플로우별 기능 명세 및 UI/UX 규칙', '참고 자료',
  ];
  // P5: 템플릿 자리표시자. 여는 대괄호만 있는 항목은 접두 매칭(문장형 자리표시자).
  const PRD_PLACEHOLDERS = [
    '[PRODUCT_NAME]', '[PRD_VERSION]', '[CREATED_DATE]', '[PRD_AUTHOR]',
    '[LAST_AMENDED_DATE]', '[LAST_AMENDED_AUTHOR]', '$ARGUMENTS',
    '[SYS-00X]', '[SCR-00X]',
    '[이 제품을 평이하게', '[개발 원칙 이름', '[도메인 명사', '[UI 컴포넌트',
    '[제외하는 기능 이름]', '[가로지르는 경험 이름]', '[자료 종류]', '[플로우 이름]',
  ];

  /**
   * @param body        PRD 원문 (`docs/prd/business-context.md`)
   * @param prevVersion 저장돼 있는 현재 버전 (없으면 신규). P7 대조용.
   * @returns { ok, errors, warnings, meta, sameVersion }
   */
  function validatePrd(body, prevVersion) {
    const errors = [];
    const warnings = [];
    const add = (code, msg) => errors.push({ code, msg });
    const warn = (code, msg) => warnings.push({ code, msg });
    const P = window.MASCPrd;
    const V = window.MASCVersion;
    // ★ 주석을 걷어낸 사본으로 검사한다 — 템플릿 주석의 예시가 자리표시자로 오탐되는 걸 막는다.
    const src = P.strip(body);
    const meta = P.parseMeta(body);

    // ── P1 — H1 제목 ──
    const first = P.h1List(src)[0];
    if (!first) {
      add('P1', 'H1 제목(`# 제품 요구사항 문서 (PRD): {제품명}`)이 없습니다.');
    } else if (!/^제품\s*요구사항\s*문서\s*(?:\(\s*PRD\s*\))?\s*[:：]/i.test(first.raw)) {
      add('P1', `H1 "${first.raw}" 형식 오류 — \`# 제품 요구사항 문서 (PRD): {제품명}\` 이어야 합니다.`);
    } else if (!meta.title) {
      add('P1', 'H1 제목에서 제품명을 찾지 못했습니다.');
    }

    // ── P2 — 헤더 표 (버전 · 생성일 · 최종 수정일) ──
    if (!meta.versionRaw) {
      add('P2', '헤더 표에 `| **버전** | X.Y.Z |` 행이 없습니다.');
    } else if (!meta.version) {
      add('P2', `버전 "${meta.versionRaw}" 형식 오류 — \`X.Y.Z\` (semver) 여야 합니다.`);
    }
    [['생성일', meta.createdDate], ['최종 수정일', meta.lastAmendedDate]].forEach(([name, date]) => {
      const raw = P.tableField(src, name);
      if (!raw) add('P2', `헤더 표에 \`| **${name}** | … |\` 행이 없습니다.`);
      else if (!date) add('P2', `${name} "${raw}" 에서 날짜를 찾지 못했습니다 — \`YYYY-MM-DD - {작성자}\` 형식이어야 합니다.`);
    });

    // ── P3 — 필수 섹션 4개 (순서) ──
    const got = meta.sections.map((s) => s.key);
    let cursor = 0;
    const missing = [];
    REQUIRED_PRD_SECTIONS.forEach((title) => {
      const idx = got.indexOf(P.normTitle(title), cursor);
      if (idx < 0) missing.push(title);
      else cursor = idx + 1; // 순서 보장
    });
    if (missing.length) {
      add('P3', `필수 섹션 누락/순서 오류: ${missing.join(' · ')} (${REQUIRED_PRD_SECTIONS.join(' → ')} 순서여야 함).`);
    }
    // `# 5. TBD` 등 뒤따르는 선택 섹션은 허용한다 (/mino-prd 가 TBD Q&A 로 덧붙임).

    // ── P4 — 항목 ID ([SYS-00X]·[SCR-00X]) ──
    if (!meta.goalIds.length) {
      add('P4', '§2 목표에 `[SYS-001]` / `[SCR-001]` 형식 항목이 1개 이상 필요합니다.');
    } else {
      // P4-w: §2 ↔ §3 대응. 템플릿은 1:1 을 요구하지만 오탐 여지가 있어 경고로만 남긴다.
      const onlyGoal = meta.goalIds.filter((id) => meta.specIds.indexOf(id) < 0);
      const onlySpec = meta.specIds.filter((id) => meta.goalIds.indexOf(id) < 0);
      if (onlyGoal.length) warn('P4', `§2 목표에만 있고 §3 명세에 없는 항목: ${onlyGoal.join(' · ')}`);
      if (onlySpec.length) warn('P4', `§3 명세에만 있고 §2 목표에 없는 항목: ${onlySpec.join(' · ')}`);
    }

    // ── P5 — 자리표시자 잔여 (하드) ──
    const left = PRD_PLACEHOLDERS.filter((p) => src.indexOf(p) >= 0);
    if (left.length) {
      add('P5', `치환되지 않은 템플릿 자리표시자: ${left.join(' · ')}`);
    }

    // ── P6 — `TBD:` 잔여 (경고) ──
    // spec 은 `[TBD]` 대괄호, PRD 는 `TBD:` 접두다 (/mino-prd SKILL.md §4).
    if (meta.tbdCount) {
      warn('P6', `미해소 \`TBD:\` ${meta.tbdCount}건 — 확정이 필요한 정책입니다. 댓글로 논의하세요.`);
    }

    // ── P7 — 버전 정합 (회귀 차단 · 동일 버전은 확인) ──
    let sameVersion = false;
    if (prevVersion && meta.version) {
      if (V.isRegression(prevVersion, meta.version)) {
        add('P7', `버전이 뒤로 갔습니다 — 저장본 ${prevVersion} → 업로드 ${meta.version}. 최신 PRD 를 올리거나 \`/mino-prd\` 로 개정하세요.`);
      } else if (V.levelBetween(prevVersion, meta.version) === 'same') {
        sameVersion = true;
        warn('P7', `저장본과 같은 버전(${meta.version})입니다 — 새 스냅샷을 만들지 않고 현재 버전의 본문만 갱신합니다.`);
      }
    }

    return { ok: errors.length === 0, errors, warnings, meta, sameVersion };
  }

  window.MASCValidate = {
    validateSpec, validateChecklist, validatePrd,
    REQUIRED_H2, SPEC_STATUSES, PLACEHOLDERS,
    REQUIRED_CHECKLIST_H2, CHECKLIST_STATUSES, CHECKLIST_PLACEHOLDERS,
    REQUIRED_PRD_SECTIONS, PRD_PLACEHOLDERS,
  };
})();
