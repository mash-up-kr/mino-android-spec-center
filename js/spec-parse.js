/**
 * MASC spec 파서 (v3 — mino-sdd/template/spec-template.md 기준)
 * ----------------------------------------------------------------------
 * 신 템플릿에서 메타만 추출한다. 본문은 데이터로 파싱하지 않는다.
 *   - slug:        `**대상 스펙 경로**: docs/specs/{slug}` (구 `<!-- feature: -->` 주석 폐기)
 *   - title:       H1 `# 스펙 명세서: {기능명}` 의 기능명
 *   - specVersion: `**버전**: 1.0.0` (버전 소유권은 mino-spec 스킬 — 대시보드는 읽기만)
 *   - status/prdVersion/createdAt/updatedAt: 헤더 메타 필드
 *   - figma:       §1 유저 시나리오의 `**Figma**:` 줄에 있는 링크들
 * 또한 검증기(validate.js)가 공유하는 헤딩/섹션/표 헬퍼를 노출한다.
 */
(function () {
  const NL = (src) => String(src == null ? '' : src).replace(/\r\n/g, '\n').split('\n');

  // 헤딩 제목 정규화: 숫자 접두사 · 괄호 영문 · `*(필수)*` 류 꼬리표 제거 → 핵심 한글 제목만
  function coreTitle(raw) {
    return String(raw || '')
      .replace(/^\d+(?:\.\d+)*\.?\s*/, '')  // "1. " / "2.1 "
      .replace(/\s*\*+\([^)]*\)\*+\s*$/, '') // " *(필수)*"
      .replace(/\s*\([^)]*\)\s*$/, '')       // " (User Scenarios)"
      .trim();
  }

  // 모든 헤딩: { i, level, raw, core }
  function headings(src) {
    const out = [];
    NL(src).forEach((l, i) => {
      const m = l.match(/^(#{1,6})\s+(.+?)\s*$/);
      if (m) out.push({ i, level: m[1].length, raw: m[2].trim(), core: coreTitle(m[2]) });
    });
    return out;
  }

  // H2 목록 (검증기 호환 — { raw, core })
  const h2List = (src) => headings(src).filter((h) => h.level === 2);

  // 헤딩 하나의 본문 블록: 그 줄 다음 ~ 같은/상위 레벨 헤딩 직전
  function blockFrom(src, h) {
    if (!h) return '';
    const lines = NL(src);
    const out = [];
    for (let i = h.i + 1; i < lines.length; i++) {
      const m = lines[i].match(/^(#{1,6})\s+/);
      if (m && m[1].length <= h.level) break;
      out.push(lines[i]);
    }
    return out.join('\n');
  }

  /** 핵심 제목으로 섹션 블록 조회. level 생략 시 H2. 하위 헤딩 포함. */
  function sectionBlock(src, core, level) {
    const lv = level || 2;
    const h = headings(src).find((x) => x.level === lv && x.core === core);
    return blockFrom(src, h);
  }

  /** 원문 헤딩(raw)이 정규식에 매칭되는 첫 블록. `### 2.1 기능적 요구사항` 같은 번호 지정용. */
  function blockByRaw(src, re, level) {
    const h = headings(src).find((x) => (!level || x.level === level) && re.test(x.raw));
    return blockFrom(src, h);
  }

  /** 헤딩 raw 가 정규식에 매칭되는 모든 블록 (유저 플로우 반복 섹션용) */
  function blocksByRaw(src, re, level) {
    return headings(src)
      .filter((h) => (!level || h.level === level) && re.test(h.raw))
      .map((h) => ({ raw: h.raw, block: blockFrom(src, h) }));
  }

  // ---------- 헤더 메타 (`**이름**: 값`) ----------
  // 값에서 감싼 백틱·대괄호 잔재를 벗겨 원값만 남긴다.
  function headerField(src, name) {
    const re = new RegExp(`^\\*\\*\\s*${name}\\s*\\*\\*\\s*[:：]\\s*(.*)$`);
    for (const line of NL(src)) {
      const m = line.match(re);
      if (m) return m[1].trim().replace(/^`+|`+$/g, '').trim();
    }
    return null;
  }

  // H1 `# 스펙 명세서: {기능명}` → 기능명 (접두사 없으면 H1 전체)
  function parseTitle(src) {
    for (const line of NL(src)) {
      const m = line.match(/^#\s+(.+?)\s*$/);
      if (!m) continue;
      const t = m[1].trim();
      const c = t.match(/^스펙\s*명세서\s*[:：]\s*(.+)$/);
      return (c ? c[1] : t).trim();
    }
    return null;
  }

  // `**대상 스펙 경로**: docs/specs/{slug}` → slug
  function parseSlug(src) {
    const v = headerField(src, '대상 스펙 경로');
    if (!v) return null;
    const m = v.match(/docs\/specs\/([^/\s`)\]]+)/);
    return m ? m[1] : null;
  }

  // `**버전**: 1.0.0` → "1.0.0" (선행 v 는 허용하되 벗겨서 보관)
  function parseVersion(src) {
    const v = headerField(src, '버전');
    if (!v) return null;
    const m = v.match(/\bv?(\d+\.\d+\.\d+)\b/);
    return m ? m[1] : null;
  }

  const parseStatus = (src) => {
    const v = headerField(src, '상태');
    if (!v) return null;
    const m = v.match(/\b(DRAFT|CREATED)\b/);
    return m ? m[1] : v;
  };
  const parseDate = (src, name) => {
    const v = headerField(src, name);
    if (!v) return null;
    const m = v.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    return m ? m[1] : v;
  };

  // 본문 링크: [텍스트](url) 의 url 목록. withLabel=true 면 {label, url} 목록.
  function linkRefs(block, withLabel) {
    const out = [];
    const re = /(?:^|[^!])\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g;
    let m;
    while ((m = re.exec(block)) !== null) {
      out.push(withLabel ? { label: m[1].trim(), url: m[2] } : m[2]);
    }
    return out;
  }

  /** §1 유저 시나리오의 `**Figma**:` 줄에서 {label, url} 수집 (중복 제거, 자리표시자 제외) */
  function parseFigmaLinks(src) {
    const sec = sectionBlock(src, '유저 시나리오');
    const out = [];
    NL(sec).forEach((l) => {
      if (!/^\*\*\s*Figma\s*\*\*\s*[:：]/.test(l.trim())) return;
      linkRefs(l, true).forEach((r) => {
        if (!/^https?:\/\//i.test(r.url)) return;
        if (out.some((x) => x.url === r.url)) return;
        out.push({ label: r.label || r.url, url: r.url });
      });
    });
    return out;
  }

  /** §1 유저 시나리오의 `**Figma**:` 줄에서 노드 URL 수집 (중복 제거, 자리표시자 제외) */
  function parseFigmaSources(src) {
    return parseFigmaLinks(src).map((r) => r.url);
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

  // 본문 내 이미지 참조: ![](path) 의 경로 목록 (신 템플릿은 미사용 — 뷰어 호환용)
  function imageRefs(block) {
    const refs = [];
    const re = /!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g;
    let m;
    while ((m = re.exec(block)) !== null) refs.push(m[1]);
    return refs;
  }

  function parseMeta(src) {
    return {
      slug: parseSlug(src),
      title: parseTitle(src),
      specVersion: parseVersion(src),
      specStatus: parseStatus(src),
      prdVersion: headerField(src, '기준 PRD 버전'),
      createdAt: parseDate(src, '최초 작성일'),
      updatedAt: parseDate(src, '최종 수정일'),
      figmaSources: parseFigmaSources(src),
    };
  }

  window.MASCSpec = {
    parseMeta, parseSlug, parseTitle, parseVersion, parseStatus, parseFigmaSources, parseFigmaLinks,
    headerField, headings, h2List, coreTitle,
    sectionBlock, blockByRaw, blocksByRaw, parseTables, imageRefs, linkRefs,
  };
})();
