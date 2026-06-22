(function () {
  const SECTION_ALIASES = {
    behavior: ['동작', 'behavior', '개요', '요약', 'summary'],
    nongoal: ['비목표', '비 목표', 'non-goals', 'non goals', 'nongoals', 'out of scope', 'scope'],
    states: ['상태/예외', '상태·예외', '상태', '예외', 'states', 'state', 'edge cases', 'edge case'],
    items: ['상세 기능 명세', '기능 명세', '상세 기능', '기능 목록', 'spec items', 'items', '수용 조건', '수용조건', 'acceptance criteria', 'acceptance', 'ac'],
    tbd: ['open questions', 'open question', 'tbd', '미해결', '미해결 결정', 'clarify', 'clarification'],
    tasks: ['tasks', 'task', '작업 목록', '작업'],
  };

  const ITEM_STATUS = ['confirmed', 'partial', 'needs_policy', 'inferred', 'variant', 'out_of_scope'];
  const STATUS_ALIASES = {
    confirmed: ['confirmed', '확정'],
    partial: ['partial', '일부확정', '일부 확정', '일부'],
    needs_policy: ['needs_policy', 'needs policy', '정책필요', '정책 필요', '정책'],
    inferred: ['inferred', '추론'],
    variant: ['variant', '후보안', '후보', '대안'],
    out_of_scope: ['out_of_scope', 'out of scope', '범위외', '범위 외', '제외'],
  };

  function normStatus(v) {
    const s = String(v || '').trim().toLowerCase();
    if (!s) return 'confirmed';
    for (const [kind, arr] of Object.entries(STATUS_ALIASES)) {
      if (arr.some((a) => s === a || s.startsWith(a))) return kind;
    }
    return ITEM_STATUS.includes(s) ? s : 'confirmed';
  }

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
      items: [], tbds: [], tasks: [], relatedFeatures: [],
      nonGoals: [], states: [],
    };
    if (!text) return r;
    let body = String(text).replace(/\r\n/g, '\n');

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

    const sections = { behavior: [], nongoal: [], states: [], items: [], tbd: [], tasks: [] };
    const preamble = [];
    let cur = null;
    body.split('\n').forEach((raw) => {
      const line = raw.replace(/\s+$/, '');
      const h1 = line.match(/^#\s+(.+)/);
      if (h1) { if (!r.title) r.title = h1[1].trim(); cur = null; return; }
      const h2 = line.match(/^#{2,4}\s+(.+)/);
      if (h2) { cur = sectionKind(h2[1]); return; }
      if (cur) sections[cur].push(line);
      else if (line.trim()) preamble.push(line);
    });

    r.behavior = (sections.behavior.join('\n').trim()) || preamble.join('\n').trim();

    const isBullet = (l) => /^\s*[-*]\s+/.test(l);
    const bulletText = (l) => l.replace(/^\s*[-*]\s+/, '');
    const isTableRow = (l) => /^\s*\|/.test(l);
    const isDivider = (l) => /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes('-');
    const cells = (l) => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());

    // --- items: 테이블(| ID | 기능 | Trigger | 화면 반응 | 확정 |) 우선, 없으면 불릿(레거시 AC) ---
    const itemTableRows = sections.items.filter(isTableRow).filter((l) => !isDivider(l));
    if (itemTableRows.length) {
      itemTableRows.forEach((l, n) => {
        const c = cells(l);
        const first = (c[0] || '').toLowerCase();
        if (n === 0 && /(^id$|feature id|기능 id|^기능$)/.test(first)) return; // 헤더 스킵
        const id = (c[0] || '').replace(/`/g, '').trim();
        if (!id) return;
        r.items.push({
          id,
          title: (c[1] || '').trim(),
          trigger: (c[2] || '').trim(),
          response: (c[3] || '').trim(),
          specStatus: normStatus(c[4]),
        });
      });
    } else {
      sections.items.filter(isBullet).forEach((l, n) => {
        const m = bulletText(l).match(/^([A-Z][A-Z0-9_]+|AC[-\s]?\d+)?\s*[:：\-]?\s*(.*)$/i);
        const id = (m && m[1] ? m[1] : 'ITEM_' + (n + 1)).replace(/\s/g, '');
        r.items.push({ id, title: '', trigger: '', response: (m ? m[2] : bulletText(l)).trim(), specStatus: 'confirmed' });
      });
    }

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
      const itemRefs = [];
      const am = title.match(/\(([^)]*)\)\s*$/);
      if (am) {
        am[1].split(/[,\s]+/).forEach((tok) => {
          const t = tok.trim().toUpperCase().replace(/\s/g, '');
          if (/^[A-Z][A-Z0-9_]+$/.test(t)) itemRefs.push(t);
        });
        if (itemRefs.length) title = title.slice(0, am.index).trim();
      }
      r.tasks.push({
        id: (m && m[1] ? m[1] : 'T' + (n + 1)),
        module: (m && m[2] ? m[2] : '').trim(),
        title,
        itemRefs,
      });
    });

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
