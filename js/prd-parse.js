/**
 * MASC PRD 파서 (P8) — mino-sdd/template/prd-template.md 기준
 * ----------------------------------------------------------------------
 * spec 파서(spec-parse.js)와 두 가지가 결정적으로 다르다:
 *
 *   1) 헤더가 `**키**: 값` 줄이 아니라 **마크다운 표**다.
 *        | **버전** | 1.2.0 |
 *      → `headerField` 재사용 불가 → `tableField` 신설.
 *
 *   2) 섹션 제목이 H2 가 아니라 **H1** 이다 (`# 1. 서비스 개요 및 개발 방향`).
 *      문서 제목도 H1 이므로 **첫 H1 = 제목, 이후 H1 = 섹션**으로 나눈다.
 *
 * 또한 PRD 템플릿은 `<!-- 예시) … -->` 주석 안에 `[SCR-001]`·`[PRODUCT_NAME]` 류
 * 문자열을 대량으로 담고 있다. 검증기는 반드시 `strip(src)` 로 주석을 걷어낸 사본을
 * 봐야 한다 — 원문에 그대로 돌리면 정상 산출물이 전부 자리표시자로 걸린다.
 * 저장되는 본문은 원문 그대로다(뷰어 mdToHtml 이 주석을 건너뛴다).
 */
(function () {
  const S = window.MASCSpec;
  const NL = (src) => String(src == null ? '' : src).replace(/\r\n/g, '\n').split('\n');

  /** HTML 주석 블록 제거 — 검증·ID 수집은 전부 이 사본 위에서 한다. */
  function strip(src) {
    return String(src == null ? '' : src).replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  }

  // ---------- 헤더 표 (`| **이름** | 값 |`) ----------
  function tableField(src, name) {
    const re = new RegExp(`^\\s*\\|\\s*\\*\\*\\s*${name}\\s*\\*\\*\\s*\\|\\s*(.*?)\\s*\\|\\s*$`);
    for (const line of NL(src)) {
      const m = line.match(re);
      if (m) return m[1].trim().replace(/^`+|`+$/g, '').trim();
    }
    return null;
  }

  // `2026-06-26 - 재성` → { date, author }. 날짜만 있으면 author 는 빈 값.
  function splitDated(v) {
    if (!v) return { date: null, author: '', raw: null };
    const d = v.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    const a = v.replace(/\b\d{4}-\d{2}-\d{2}\b/, '').replace(/^[\s-–—]+/, '').trim();
    return { date: d ? d[1] : null, author: a, raw: v };
  }

  // ---------- 제목 · 섹션 ----------
  const h1List = (src) => S.headings(src).filter((h) => h.level === 1);

  /** 첫 H1 = 문서 제목. `# 제품 요구사항 문서 (PRD): {제품명}` → 제품명 */
  function parseTitle(src) {
    const first = h1List(src)[0];
    if (!first) return null;
    const m = first.raw.match(/^제품\s*요구사항\s*문서\s*(?:\(\s*PRD\s*\))?\s*[:：]\s*(.+)$/i);
    return (m ? m[1] : first.raw).trim();
  }

  /** 첫 H1(제목)을 뺀 나머지 H1 = 본문 섹션. { raw, core, key } */
  function sectionList(src) {
    return h1List(src).slice(1).map((h) => ({ raw: h.raw, core: h.core, key: normTitle(h.core) }));
  }

  // 제목 비교는 공백을 무시한다 — `목표 / 비목표` 와 `목표/비목표` 를 같게 본다.
  const normTitle = (s) => String(s || '').replace(/\s+/g, '');

  /** 섹션 본문 블록 (하위 헤딩 포함). 핵심 제목 기준, 공백 무시 매칭. */
  function sectionBody(src, core) {
    const want = normTitle(core);
    const lines = NL(src);
    const hs = S.headings(src).filter((h) => h.level === 1);
    for (let k = 1; k < hs.length; k++) {         // k=0 은 문서 제목
      if (normTitle(hs[k].core) !== want) continue;
      const end = k + 1 < hs.length ? hs[k + 1].i : lines.length;
      return lines.slice(hs[k].i + 1, end).join('\n');
    }
    return '';
  }

  // ---------- 항목 ID ([SYS-001] · [SCR-001]) ----------
  function itemIds(block) {
    const out = [];
    const re = /\[(SYS|SCR)-(\d{3})\]/g;
    let m;
    while ((m = re.exec(String(block || ''))) !== null) {
      const id = `${m[1]}-${m[2]}`;
      if (out.indexOf(id) < 0) out.push(id);
    }
    return out;
  }

  // ---------- 섹션 다이제스트 (diff 변경 섹션 요약용) ----------
  /** [{ title, body }] — H1 섹션 단위. 제목이 같은 섹션끼리 비교한다. */
  function sectionDigest(src) {
    const lines = NL(src);
    const hs = S.headings(src).filter((h) => h.level === 1);
    if (!hs.length) return [{ title: '(본문)', body: lines.join('\n') }];
    const out = [];
    hs.forEach((h, k) => {
      const end = k + 1 < hs.length ? hs[k + 1].i : lines.length;
      out.push({ title: h.raw, body: lines.slice(h.i, end).join('\n') });
    });
    return out;
  }

  /** 두 본문의 변경 섹션 제목 목록 → { changed: [], added: [], removed: [] } */
  function changedSections(fromBody, toBody) {
    const A = sectionDigest(fromBody), B = sectionDigest(toBody);
    const byTitle = (list) => {
      const m = new Map();
      list.forEach((s) => { if (!m.has(s.title)) m.set(s.title, s.body); });
      return m;
    };
    const ma = byTitle(A), mb = byTitle(B);
    const changed = [], added = [], removed = [];
    mb.forEach((body, title) => {
      if (!ma.has(title)) added.push(title);
      else if (ma.get(title).trim() !== body.trim()) changed.push(title);
    });
    ma.forEach((_, title) => { if (!mb.has(title)) removed.push(title); });
    return { changed, added, removed };
  }

  // ---------- 메타 ----------
  function parseMeta(src) {
    const s = strip(src);
    const created = splitDated(tableField(s, '생성일'));
    const amended = splitDated(tableField(s, '최종 수정일'));
    const versionRaw = tableField(s, '버전');
    const vm = versionRaw ? versionRaw.match(/\bv?(\d+\.\d+\.\d+)\b/) : null;
    const goals = sectionBody(s, '목표 / 비목표');
    const specsBlock = sectionBody(s, '화면 플로우별 기능 명세 및 UI/UX 규칙');
    return {
      title: parseTitle(s),
      version: vm ? vm[1] : null,
      versionRaw,
      createdDate: created.date,
      prdAuthor: created.author,
      lastAmendedDate: amended.date,
      lastAmendedAuthor: amended.author,
      sections: sectionList(s),
      goalIds: itemIds(goals),
      specIds: itemIds(specsBlock),
      itemIds: itemIds(goals),
      tbdCount: (s.match(/\bTBD\s*[:：]/g) || []).length,
    };
  }

  window.MASCPrd = {
    strip, tableField, splitDated, parseTitle, parseMeta,
    sectionList, sectionBody, sectionDigest, changedSections,
    itemIds, normTitle, h1List,
  };
})();
