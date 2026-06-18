/**
 * MASC 스펙 마크다운 파서 (에이전트 출력 → 구조화 feature)
 * -------------------------------------------------------------
 * 의존성 없음. 브라우저(window.MASCParseSpec) + node(module.exports) 모두 동작.
 * 입력 형식은 docs/spec-format.md 참고.
 */
(function () {
  const SECTION_ALIASES = {
    behavior: ['동작', 'behavior', '개요', '요약', 'summary'],
    nongoal: ['비목표', '비 목표', 'non-goals', 'non goals', 'nongoals', 'out of scope', 'scope'],
    states: ['상태/예외', '상태·예외', '상태', '예외', 'states', 'state', 'edge cases', 'edge case'],
    ac: ['수용 조건', '수용조건', 'acceptance criteria', 'acceptance', 'ac'],
    tbd: ['open questions', 'open question', 'tbd', '미해결', '미해결 결정', 'clarify', 'clarification'],
    tasks: ['tasks', 'task', '작업 목록', '작업'],
  };

  function sectionKind(heading) {
    const h = heading.trim().toLowerCase().replace(/[()]/g, '').trim();
    for (const [kind, arr] of Object.entries(SECTION_ALIASES)) {
      if (arr.some((a) => h === a || h.startsWith(a))) return kind;
    }
    return null;
  }

  function stripQuotes(v) {
    v = v.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      return v.slice(1, -1);
    }
    return v;
  }

  function parse(text) {
    const r = {
      id: '', title: '', module: '', type: 'Screen', trigger: '', behavior: '',
      designRef: { figmaNode: '', url: '' },
      acceptanceCriteria: [], tbds: [], tasks: [], relatedFeatures: [],
      nonGoals: [], states: [],
    };
    if (!text) return r;
    let body = String(text).replace(/\r\n/g, '\n');

    // --- frontmatter (맨 위 --- 블록) ---
    const fm = body.match(/^﻿?---\n([\s\S]*?)\n---\n?/);
    if (fm) {
      fm[1].split('\n').forEach((line) => {
        const i = line.indexOf(':');
        if (i < 0) return;
        const key = line.slice(0, i).trim().toLowerCase();
        const val = stripQuotes(line.slice(i + 1));
        if (key === 'id') r.id = val;
        else if (key === 'title') r.title = val;
        else if (key === 'module') r.module = val;
        else if (key === 'type') r.type = val || 'Screen';
        else if (key === 'trigger') r.trigger = val;
        else if (key === 'figmanode') r.designRef.figmaNode = val;
        else if (key === 'figmaurl') r.designRef.url = val;
        else if (key === 'related' || key === 'relatedfeatures') {
          r.relatedFeatures = val.split(',').map((s) => s.trim()).filter(Boolean);
        }
      });
      body = body.slice(fm[0].length);
    }

    // --- 본문 섹션 ---
    const sections = { behavior: [], nongoal: [], states: [], ac: [], tbd: [], tasks: [] };
    const preamble = [];
    let cur = null;
    body.split('\n').forEach((raw) => {
      const line = raw.replace(/\s+$/, '');
      const h1 = line.match(/^#\s+(.+)/);
      if (h1) { if (!r.title) r.title = h1[1].trim(); cur = null; return; }
      const h2 = line.match(/^##\s+(.+)/);
      if (h2) { cur = sectionKind(h2[1]); return; }
      if (cur) sections[cur].push(line);
      else if (line.trim()) preamble.push(line);
    });

    r.behavior = (sections.behavior.join('\n').trim()) || preamble.join('\n').trim();

    const isBullet = (l) => /^\s*[-*]\s+/.test(l);
    const bulletText = (l) => l.replace(/^\s*[-*]\s+/, '');

    sections.ac.filter(isBullet).forEach((l, n) => {
      const m = bulletText(l).match(/^(AC[-\s]?\d+)?\s*[:：\-]?\s*(.*)$/i);
      r.acceptanceCriteria.push({
        id: (m && m[1] ? m[1] : 'AC' + (n + 1)).replace(/\s/g, ''),
        text: (m ? m[2] : bulletText(l)).trim(),
      });
    });

    sections.tbd.filter(isBullet).forEach((l, n) => {
      const m = bulletText(l).match(/^(TBD[-\s]?\d+)?\s*(?:\(([^)]*)\))?\s*[:：\-]?\s*(.*)$/i);
      r.tbds.push({
        id: (m && m[1] ? m[1] : 'TBD-' + (n + 1)).replace(/\s/g, ''),
        resolver: (m && m[2] ? m[2] : '').trim(),
        question: (m ? m[3] : bulletText(l)).trim(),
      });
    });

    sections.tasks.filter(isBullet).forEach((l, n) => {
      const m = bulletText(l).match(/^(T\d+)?\s*(?:\[([^\]]*)\])?\s*[:：\-]?\s*(.*)$/i);
      let title = (m ? m[3] : bulletText(l)).trim();
      // 제목 끝의 "(AC1, AC2)" → 추적성 acs로 추출하고 제목에서 분리
      const acs = [];
      const am = title.match(/\(([^)]*AC[^)]*)\)\s*$/i);
      if (am) {
        am[1].split(/[,\s]+/).forEach((tok) => {
          const t = tok.trim().toUpperCase().replace(/\s/g, '');
          if (/^AC\d+$/.test(t)) acs.push(t);
        });
        if (acs.length) title = title.slice(0, am.index).trim();
      }
      r.tasks.push({
        id: (m && m[1] ? m[1] : 'T' + (n + 1)),
        module: (m && m[2] ? m[2] : '').trim(),
        title,
        acs,
      });
    });

    // 최상위 불릿만(들여쓴 하위 불릿 제외) — "없음"은 무시
    const topBullet = (l) => /^[-*]\s+/.test(l);
    sections.nongoal.filter(topBullet).forEach((l) => {
      const txt = bulletText(l).trim();
      if (txt && !/^없음\.?$/.test(txt)) r.nonGoals.push(txt);
    });
    sections.states.filter(topBullet).forEach((l) => {
      const txt = bulletText(l).trim();
      const m = txt.match(/^([^:：]{1,20})[:：]\s*(.*)$/);
      if (m) r.states.push({ label: m[1].trim(), text: m[2].trim() });
      else if (txt) r.states.push({ label: '', text: txt });
    });

    return r;
  }

  if (typeof window !== 'undefined') window.MASCParseSpec = parse;
  if (typeof module !== 'undefined' && module.exports) module.exports = parse;
})();
