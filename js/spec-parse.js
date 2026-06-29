/**
 * MASC spec 파서 (v2)
 * ----------------------------------------------------------------------
 * 신 포맷 spec.md에서 메타만 추출한다. 본문은 데이터로 파싱하지 않는다
 * (구 items/frontmatter 모델 폐기 — docs/validation.md).
 *   - slug:        첫 줄 <!-- feature: {slug} --> 주석
 *   - title:       H1 (# ...)
 *   - specVersion: "변경 이력" 표 최신(마지막) 데이터 행의 버전명 (예: v0.1.0)
 * 또한 검증기(validate.js)가 공유하는 섹션/표 헬퍼를 노출한다.
 */
(function () {
  const NL = (src) => String(src == null ? '' : src).replace(/\r\n/g, '\n').split('\n');

  // 첫 줄 슬러그 주석
  function parseSlug(src) {
    const first = (NL(src)[0] || '').trim();
    const m = first.match(/^<!--\s*feature:\s*([^\s>]+)\s*-->$/);
    return m ? m[1] : null;
  }

  // H1 제목
  function parseTitle(src) {
    for (const line of NL(src)) {
      const m = line.match(/^#\s+(.+?)\s*$/);
      if (m) return m[1];
    }
    return null;
  }

  // H2 헤더 목록 (숫자 접두사 보존한 원문 + 정규화 텍스트)
  function h2List(src) {
    return NL(src)
      .map((l) => l.match(/^##\s+(.+?)\s*$/))
      .filter(Boolean)
      .map((m) => ({ raw: m[1], norm: m[1].replace(/^\d+\.\s*/, '').trim() }));
  }

  // 특정 H2 섹션 본문 블록(해당 H2 다음 줄 ~ 다음 H2 직전) 반환
  function sectionBlock(src, normTitle) {
    const lines = NL(src);
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^##\s+(.+?)\s*$/);
      if (m && m[1].replace(/^\d+\.\s*/, '').trim() === normTitle) { start = i + 1; break; }
    }
    if (start < 0) return '';
    const out = [];
    for (let i = start; i < lines.length; i++) {
      if (/^##\s+/.test(lines[i])) break;
      out.push(lines[i]);
    }
    return out.join('\n');
  }

  // 마크다운 표를 {header:[], rows:[[]]} 들로 추출 (구분선 기준)
  function parseTables(block) {
    const lines = NL(block);
    const isRow = (l) => /^\s*\|.*\|\s*$/.test(l);
    const isDiv = (l) => /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes('-');
    const cells = (l) => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
    const tables = [];
    for (let i = 0; i < lines.length; i++) {
      if (isRow(lines[i]) && i + 1 < lines.length && isDiv(lines[i + 1])) {
        const header = cells(lines[i]);
        const rows = [];
        i += 2;
        while (i < lines.length && isRow(lines[i]) && !isDiv(lines[i])) { rows.push(cells(lines[i])); i++; }
        i--;
        tables.push({ header, rows });
      }
    }
    return tables;
  }

  // 본문 내 이미지 참조: ![](path) 의 경로 목록
  function imageRefs(block) {
    const refs = [];
    const re = /!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g;
    let m;
    while ((m = re.exec(block)) !== null) refs.push(m[1]);
    return refs;
  }

  // 변경 이력 표 최신 행 버전명
  function parseVersion(src) {
    const block = sectionBlock(src, '변경 이력');
    const tables = parseTables(block);
    if (!tables.length || !tables[0].rows.length) return null;
    const last = tables[0].rows[tables[0].rows.length - 1];
    const v = (last[0] || '').trim();
    return /^v\d+\.\d+\.\d+$/.test(v) ? v : null;
  }

  function parseMeta(src) {
    return {
      slug: parseSlug(src),
      title: parseTitle(src),
      specVersion: parseVersion(src),
    };
  }

  window.MASCSpec = {
    parseMeta, parseSlug, parseTitle, parseVersion,
    h2List, sectionBlock, parseTables, imageRefs,
  };
})();
