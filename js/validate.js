/**
 * MASC 붙여넣기 구조 검증 (v2) — docs/validation.md S1–S6
 * ----------------------------------------------------------------------
 * 대시보드 2차 방어선. 본문을 데이터로 파싱하지 않고 구조만 기계 검사한다.
 * validateSpec(body, assetNames?) → { ok, errors: [{code,msg}], meta }
 *   assetNames: 업로드된 파일명 배열(있으면 S5 1:1 정합 검사, 없으면 S5 skip)
 */
(function () {
  const S = window.MASCSpec;

  // S2: 필수 H2 8개 (순서·핵심 제목). 숫자 접두사 무시.
  const REQUIRED_H2 = [
    '한눈에 보기', '화면 상태별 읽기', '핵심 UX 규칙', '사용자 흐름',
    '상세 기능 명세', '비목표', 'Open Questions', '변경 이력',
  ];
  // S4: 통제 어휘
  const INTERACTION_TYPES = ['display_state', 'user_action', 'navigation', 'async_process', 'validation', 'modal_dialog'];
  const CONFIRM_VALUES = ['confirmed', 'partial', 'needs_policy'];

  function validateSpec(body, assetNames) {
    const errors = [];
    const add = (code, msg) => errors.push({ code, msg });
    const meta = S.parseMeta(body);

    // S1 — slug 주석
    if (!meta.slug) {
      add('S1', '첫 줄에 `<!-- feature: {slug} -->` 주석이 없습니다.');
    } else if (!/^[a-z0-9-]+$/.test(meta.slug)) {
      add('S1', `slug "${meta.slug}" 형식 오류 — 영소문자/숫자/하이픈만 허용.`);
    }

    // S2 — 필수 H2 8개 (순서·제목 일치)
    const got = S.h2List(body).map((h) => h.norm);
    let cursor = 0;
    const missing = [];
    REQUIRED_H2.forEach((title) => {
      const idx = got.indexOf(title, cursor);
      if (idx < 0) missing.push(title);
      else cursor = idx + 1; // 순서 보장
    });
    if (missing.length) {
      add('S2', `필수 H2 누락/순서 오류: ${missing.join(' · ')} (8개가 순서대로 있어야 함).`);
    }

    // S3 — section 2 이미지 ≥ 1 (assets/*.png)
    const sec2 = S.sectionBlock(body, '화면 상태별 읽기');
    const sec2imgs = S.imageRefs(sec2).filter((r) => /assets\/.+\.png$/i.test(r));
    if (sec2imgs.length < 1) {
      add('S3', '`화면 상태별 읽기`에 `![](assets/*.png)` 이미지가 1개 이상 필요합니다.');
    }

    // S4 — 5.x 표 interactionType(6종)·확정(3종) enum
    const sec5 = S.sectionBlock(body, '상세 기능 명세');
    const tables = S.parseTables(sec5).filter((t) =>
      t.header.includes('interactionType') && t.header.includes('확정'));
    if (!tables.length && sec5.trim()) {
      add('S4', '`상세 기능 명세`에 interactionType·확정 컬럼을 가진 표가 없습니다.');
    }
    tables.forEach((t) => {
      const itIdx = t.header.indexOf('interactionType');
      const cfIdx = t.header.indexOf('확정');
      t.rows.forEach((r, i) => {
        const it = (r[itIdx] || '').trim();
        const cf = (r[cfIdx] || '').trim();
        if (!INTERACTION_TYPES.includes(it)) {
          add('S4', `상세 명세 ${i + 1}행 interactionType "${it || '(빈값)'}" 무효 — ${INTERACTION_TYPES.join('/')} 중 하나.`);
        }
        if (!CONFIRM_VALUES.includes(cf)) {
          add('S4', `상세 명세 ${i + 1}행 확정 "${cf || '(빈값)'}" 무효 — ${CONFIRM_VALUES.join('/')} 중 하나.`);
        }
      });
    });

    // S5 — 이미지 정합 (업로드 파일과 1:1). assetNames 없으면 skip.
    if (Array.isArray(assetNames)) {
      const refNames = S.imageRefs(body)
        .map((r) => (r.match(/assets\/([^)]+)$/) || [])[1])
        .filter(Boolean);
      const refSet = new Set(refNames);
      const upSet = new Set(assetNames);
      const broken = [...refSet].filter((n) => !upSet.has(n));
      const unused = [...upSet].filter((n) => !refSet.has(n));
      if (broken.length) add('S5', `본문이 참조하나 업로드 안 된 이미지: ${broken.join(', ')}`);
      if (unused.length) add('S5', `업로드됐으나 본문에서 미참조: ${unused.join(', ')}`);
    }

    // S6 — 버전 파싱
    if (!meta.specVersion) {
      add('S6', '`변경 이력` 최신 행에서 버전(vX.Y.Z)을 파싱하지 못했습니다.');
    }

    return { ok: errors.length === 0, errors, meta };
  }

  window.MASCValidate = { validateSpec, REQUIRED_H2, INTERACTION_TYPES, CONFIRM_VALUES };
})();
