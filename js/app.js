/**
 * MASC app — UI 렌더링 & 상호작용
 * 데이터는 전부 window.MASC(store.js)를 통해서만 접근한다.
 */
(function () {
  const { auth, features, tracking } = window.MASC;

  // ---------- 상태 라벨/색상 ----------
  const SPEC_LABEL = { Draft: '초안', Clarify: '확인필요', Confirmed: '확정' };
  const DELIVERY_LABEL = {
    NotStarted: '미시작', Ready: '준비됨', InProgress: '진행중',
    Review: '리뷰', Verified: '검증완료', Blocked: '막힘',
  };
  const SPEC_COLOR = { Draft: 'gray', Clarify: 'amber', Confirmed: 'green' };
  const DELIVERY_COLOR = {
    NotStarted: 'gray', Ready: 'blue', InProgress: 'blue',
    Review: 'amber', Verified: 'green', Blocked: 'red',
  };
  const SPEC_DESC = {
    Draft: 'spec.md를 막 작성한 단계. 미해결 결정(TBD)이 남아있을 수 있음.',
    Clarify: '미해결 결정(TBD)이 있어 기획·디자이너·서버와 합의가 필요.',
    Confirmed: 'TBD가 모두 닫히고 plan/tasks까지 나와 구현을 시작해도 되는 상태.',
  };
  const DELIVERY_DESC = {
    NotStarted: '아직 착수 전. 할당 전이거나 스펙 확정 대기.',
    Ready: '스펙 확정 + 작업자 할당 완료. 착수 가능.',
    InProgress: '담당자가 구현 중 (브랜치 생성·커밋 진행).',
    Review: 'PR이 올라가 코드 리뷰 / QA 대기 중.',
    Verified: '머지 + 수용조건(AC)·근거(스크린샷/테스트) 확인 완료.',
    Blocked: '외부 의존(서버 API·디자인 확정·TBD 미해소)으로 진행 불가.',
  };

  // ---------- 화면 상태 ----------
  const state = {
    module: 'all',
    spec: 'all',
    delivery: 'all',
    assignee: 'all',
    quick: new Set(),
    search: '',
    view: 'table',
    selectedId: null,
  };

  const $ = (sel) => document.querySelector(sel);
  const memberName = (uid) => {
    const m = auth.memberOf(uid);
    return m ? m.name : '';
  };
  const initials = (name) => (name ? name.slice(0, 1) : '?');
  const badge = (text, color, title) =>
    `<span class="badge ${color}"${title ? ` title="${title}"` : ''}>${text}</span>`;
  const specBadge = (s) => badge(SPEC_LABEL[s] || s, SPEC_COLOR[s] || 'gray', SPEC_DESC[s]);
  const deliveryBadge = (s) => badge(DELIVERY_LABEL[s] || s, DELIVERY_COLOR[s] || 'gray', DELIVERY_DESC[s]);

  // ===================== Auth =====================
  function showLogin() {
    $('#login').classList.remove('hidden');
    $('#app').classList.add('hidden');
  }
  function showApp() {
    $('#login').classList.add('hidden');
    $('#app').classList.remove('hidden');
    renderUserChip();
    initControls();
    renderAll();
  }
  function renderUserChip() {
    const u = auth.currentUser();
    if (!u) return;
    $('#user-chip').innerHTML =
      `<span class="avatar">${initials(u.name)}</span><span>${u.name} · ${u.role}</span>`;
  }

  $('#login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const res = auth.login($('#email').value, $('#password').value);
    if (res.ok) {
      $('#login-error').textContent = '';
      showApp();
    } else {
      $('#login-error').textContent = res.error;
    }
  });
  $('#btn-logout').addEventListener('click', () => {
    auth.logout();
    showLogin();
  });

  // ===================== Controls init =====================
  let controlsReady = false;
  function initControls() {
    if (controlsReady) return;
    controlsReady = true;

    const meta = features.meta();
    $('#meta-line').textContent = `${meta.project} · 생성 ${meta.generatedAt}`;

    const enums = features.enums();
    fillSelect($('#f-spec'), enums.specStatus, SPEC_LABEL, '모든 스펙 상태');
    fillSelect($('#f-delivery'), enums.deliveryStatus, DELIVERY_LABEL, '모든 작업 상태');

    const assigneeSel = $('#f-assignee');
    assigneeSel.innerHTML =
      `<option value="all">모든 작업자</option>` +
      `<option value="__none">미할당</option>` +
      auth.members().map((m) => `<option value="${m.uid}">${m.name}</option>`).join('');

    $('#f-spec').addEventListener('change', (e) => { state.spec = e.target.value; renderAll(); });
    $('#f-delivery').addEventListener('change', (e) => { state.delivery = e.target.value; renderAll(); });
    $('#f-assignee').addEventListener('change', (e) => { state.assignee = e.target.value; renderAll(); });
    $('#search').addEventListener('input', (e) => { state.search = e.target.value.toLowerCase(); renderAll(); });

    document.querySelectorAll('#quick-filters .chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const q = chip.dataset.q;
        if (state.quick.has(q)) state.quick.delete(q); else state.quick.add(q);
        chip.classList.toggle('active');
        renderAll();
      });
    });

    $('#view-table').addEventListener('click', () => setView('table'));
    $('#view-board').addEventListener('click', () => setView('board'));
    $('#btn-reset').addEventListener('click', resetFilters);

    renderLegend();
    $('#btn-legend').addEventListener('click', () => $('#legend-modal').classList.remove('hidden'));
    $('#legend-close').addEventListener('click', () => $('#legend-modal').classList.add('hidden'));
    $('#legend-modal').addEventListener('click', (e) => {
      if (e.target.id === 'legend-modal') $('#legend-modal').classList.add('hidden');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeEditor(); $('#legend-modal').classList.add('hidden'); }
    });

    // 편집기
    $('#btn-new').addEventListener('click', () => openEditor(null));
    $('#editor-close').addEventListener('click', closeEditor);
    $('#editor-cancel').addEventListener('click', closeEditor);
    $('#editor-save').addEventListener('click', saveEditor);
    $('#editor-modal').addEventListener('click', (e) => {
      if (e.target.id === 'editor-modal') closeEditor();
    });
  }

  function renderLegend() {
    const enums = features.enums();
    const rowsHtml = (values, labels, colors, descs) =>
      (values || []).map((v) => `<tr>
        <td>${badge(labels[v] || v, colors[v] || 'gray')}</td>
        <td><span class="meaning">${descs[v] || ''}</span></td>
      </tr>`).join('');

    $('#legend-body').innerHTML = `
      <div class="legend-block">
        <h3>스펙 상태 (Spec Status)</h3>
        <p class="desc">문서가 얼마나 확정됐는가 — "이 스펙을 믿고 개발해도 되는가?"</p>
        <table class="legend-table"><tbody>
          ${rowsHtml(enums.specStatus, SPEC_LABEL, SPEC_COLOR, SPEC_DESC)}
        </tbody></table>
      </div>
      <div class="legend-block">
        <h3>작업 상태 (Delivery Status)</h3>
        <p class="desc">구현이 어디까지 갔는가 — 보드 뷰의 레인과 동일.</p>
        <table class="legend-table"><tbody>
          ${rowsHtml(enums.deliveryStatus, DELIVERY_LABEL, DELIVERY_COLOR, DELIVERY_DESC)}
        </tbody></table>
      </div>
      <div class="legend-note">
        <b>게이트 규칙</b> · 스펙이 <b>확정</b>되기 전에는 작업 상태가 <b>준비됨</b> 이상으로 갈 수 없습니다.
        그래서 <b>미해결 TBD</b>가 0이 되어야 구현에 착수합니다.<br>
        <b>TBD 칸</b> = 남은 미해결 결정 수 · <b>근거 칸</b> = 첨부된 스크린샷/테스트 수 (검증완료인데 0이면 점검 필요).
      </div>
    `;
  }

  function fillSelect(sel, values, labels, allLabel) {
    sel.innerHTML =
      `<option value="all">${allLabel}</option>` +
      (values || []).map((v) => `<option value="${v}">${labels[v] || v}</option>`).join('');
  }

  function setView(v) {
    state.view = v;
    $('#view-table').classList.toggle('active', v === 'table');
    $('#view-board').classList.toggle('active', v === 'board');
    renderCenter();
  }

  function resetFilters() {
    state.module = 'all'; state.spec = 'all'; state.delivery = 'all';
    state.assignee = 'all'; state.quick.clear(); state.search = '';
    $('#f-spec').value = 'all'; $('#f-delivery').value = 'all'; $('#f-assignee').value = 'all';
    $('#search').value = '';
    document.querySelectorAll('#quick-filters .chip').forEach((c) => c.classList.remove('active'));
    renderAll();
  }

  // ===================== Filtering =====================
  function rows() {
    return features.all().map((f) => ({ f, t: tracking.get(f.id) }));
  }
  function filtered() {
    return rows().filter(({ f, t }) => {
      if (state.module !== 'all' && f.module !== state.module) return false;
      if (state.spec !== 'all' && t.specStatus !== state.spec) return false;
      if (state.delivery !== 'all' && t.deliveryStatus !== state.delivery) return false;
      if (state.assignee === '__none' && t.assignee) return false;
      if (state.assignee !== 'all' && state.assignee !== '__none' && t.assignee !== state.assignee) return false;
      if (state.quick.has('unassigned') && t.assignee) return false;
      if (state.quick.has('tbd') && (!f.tbds || !f.tbds.length)) return false;
      if (state.quick.has('blocked') && t.deliveryStatus !== 'Blocked') return false;
      if (state.quick.has('pr') && !t.prUrl) return false;
      if (state.search) {
        const hay = `${f.title} ${f.id} ${f.module}`.toLowerCase();
        if (!hay.includes(state.search)) return false;
      }
      return true;
    });
  }

  // ===================== Render: all =====================
  function renderAll() {
    renderKpis();
    renderModules();
    renderCenter();
    renderDetail();
  }

  function renderKpis() {
    const all = rows();
    const total = all.length;
    const notStarted = all.filter((r) => r.t.deliveryStatus === 'NotStarted').length;
    const unassigned = all.filter((r) => !r.t.assignee).length;
    const openTbd = all.reduce((n, r) => n + (r.f.tbds ? r.f.tbds.length : 0), 0);
    const prLinked = all.filter((r) => r.t.prUrl).length;
    const evidenceMissing = all.filter((r) => !r.t.evidence || !r.t.evidence.length).length;
    const kpis = [
      { val: total, lbl: '전체 Feature' },
      { val: notStarted, lbl: '미시작' },
      { val: unassigned, lbl: '미할당', cls: unassigned ? 'warn' : '' },
      { val: openTbd, lbl: '미해결 TBD', cls: openTbd ? 'warn' : '' },
      { val: prLinked, lbl: 'PR 연결' },
      { val: evidenceMissing, lbl: '근거 없음', cls: evidenceMissing ? 'danger' : '' },
    ];
    $('#kpi-row').innerHTML = kpis
      .map((k) => `<div class="kpi ${k.cls || ''}"><div class="val">${k.val}</div><div class="lbl">${k.lbl}</div></div>`)
      .join('');
  }

  function renderModules() {
    const all = rows();
    const counts = {};
    all.forEach((r) => { counts[r.f.module] = (counts[r.f.module] || 0) + 1; });
    const items = [{ id: 'all', name: '전체', count: all.length }].concat(
      features.modules().map((m) => ({ id: m.id, name: m.name, count: counts[m.id] || 0 }))
    );
    $('#module-list').innerHTML = items
      .map((m) => `<div class="mod-item ${state.module === m.id ? 'active' : ''}" data-mod="${m.id}">
          <span>${m.name}</span><span class="count">${m.count}</span></div>`)
      .join('');
    document.querySelectorAll('#module-list .mod-item').forEach((it) => {
      it.addEventListener('click', () => { state.module = it.dataset.mod; renderAll(); });
    });
  }

  function renderCenter() {
    const body = $('#center-body');
    body.innerHTML = state.view === 'table' ? tableHtml() : boardHtml();
    if (state.view === 'table') {
      body.querySelectorAll('tr[data-id]').forEach((tr) =>
        tr.addEventListener('click', () => select(tr.dataset.id)));
    } else {
      body.querySelectorAll('.card[data-id]').forEach((c) =>
        c.addEventListener('click', () => select(c.dataset.id)));
    }
  }

  function tableHtml() {
    const data = filtered();
    if (!data.length) return `<div class="detail-empty">조건에 맞는 Feature가 없습니다.</div>`;
    const head = `<tr>
      <th>Feature</th><th>모듈</th><th>스펙</th><th>작업</th><th>작업자</th><th>근거</th><th>TBD</th>
    </tr>`;
    const body = data.map(({ f, t }) => {
      const sel = state.selectedId === f.id ? 'selected' : '';
      const ev = (t.evidence && t.evidence.length) || 0;
      const tbd = (f.tbds && f.tbds.length) || 0;
      return `<tr class="${sel}" data-id="${f.id}">
        <td><div class="feat-title">${f.title}</div><div class="feat-sub mono">${f.id}</div></td>
        <td><span class="mono">${f.module}</span><div class="feat-sub">${f.type}</div></td>
        <td>${specBadge(t.specStatus)}</td>
        <td>${deliveryBadge(t.deliveryStatus)}</td>
        <td>${t.assignee ? memberName(t.assignee) : '<span class="feat-sub">미할당</span>'}</td>
        <td><span class="pill ${ev ? 'has' : ''}">${ev}</span></td>
        <td><span class="pill ${tbd ? 'has' : ''}">${tbd}</span></td>
      </tr>`;
    }).join('');
    return `<table class="feature-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }

  function boardHtml() {
    const data = filtered();
    const lanes = features.enums().deliveryStatus || [];
    return `<div class="board">` + lanes.map((lane) => {
      const cards = data.filter(({ t }) => t.deliveryStatus === lane);
      return `<div class="lane">
        <div class="lane-h"><span>${DELIVERY_LABEL[lane] || lane}</span><span class="count">${cards.length}</span></div>
        ${cards.map(({ f, t }) => `<div class="card" data-id="${f.id}">
            <div class="t">${f.title}</div>
            <div class="m mono">${f.module}</div>
            <div class="foot">
              <span class="feat-sub">${t.assignee ? memberName(t.assignee) : '미할당'}</span>
              ${specBadge(t.specStatus)}
            </div>
          </div>`).join('') || '<div class="feat-sub">—</div>'}
      </div>`;
    }).join('') + `</div>`;
  }

  // ===================== Detail =====================
  function select(id) {
    state.selectedId = id;
    renderCenter();
    renderDetail();
  }

  // 아주 작은 마크다운 렌더러 (plan 표시용: 헤딩/리스트/볼드/코드)
  function mdToHtml(src) {
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const inline = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
    let html = '', inList = false;
    String(src).split('\n').forEach((line) => {
      const h = line.match(/^(#{1,4})\s+(.*)/);
      if (h) { if (inList) { html += '</ul>'; inList = false; } html += `<h3>${inline(h[2])}</h3>`; return; }
      if (/^\s*[-*]\s+/.test(line)) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += `<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`; return;
      }
      if (!line.trim()) { if (inList) { html += '</ul>'; inList = false; } return; }
      if (inList) { html += '</ul>'; inList = false; }
      html += `<p>${inline(line)}</p>`;
    });
    if (inList) html += '</ul>';
    return html;
  }

  function renderDetail() {
    const panel = $('#detail-panel');
    if (!state.selectedId) {
      panel.innerHTML = `<div class="detail-empty">왼쪽 목록에서 Feature를 선택하세요.</div>`;
      return;
    }
    const f = features.get(state.selectedId);
    const t = tracking.get(state.selectedId);
    if (!f) return;

    const acHtml = (f.acceptanceCriteria || [])
      .map((ac) => `<li><span class="id">${ac.id}</span><span>${ac.text}</span></li>`).join('');

    const nonGoals = (f.nonGoals || []).map((g) => (typeof g === 'string' ? g : (g && g.text) || '')).filter(Boolean);
    const nonGoalHtml = nonGoals.length
      ? `<div class="detail-section"><h3>비목표 (Out of scope)</h3>
          <ul class="ac-list">${nonGoals.map((g) => `<li><span>${g}</span></li>`).join('')}</ul></div>` : '';
    const stateRows = (f.states || []).filter((s) => s && (s.label || s.text));
    const statesHtml = stateRows.length
      ? `<div class="detail-section"><h3>상태 / 예외</h3>
          <ul class="ac-list">${stateRows.map((s) => `<li><span class="id">${s.label || ''}</span><span>${s.text || ''}</span></li>`).join('')}</ul></div>` : '';
    const tbdHtml = (f.tbds || []).length
      ? (f.tbds).map((q) => `<div class="tbd-item"><div class="tbd-q">${q.question}</div>
          <div class="tbd-meta">${q.id} · 결정 주체: ${q.resolver}</div></div>`).join('')
      : '<div class="feat-sub">미해결 항목 없음</div>';

    const memberOptions = `<option value="">미할당</option>` +
      auth.members().map((m) => `<option value="${m.uid}" ${t.assignee === m.uid ? 'selected' : ''}>${m.name} · ${m.role}</option>`).join('');
    const specOptions = (features.enums().specStatus || [])
      .map((s) => `<option value="${s}" ${t.specStatus === s ? 'selected' : ''}>${SPEC_LABEL[s] || s}</option>`).join('');
    const deliveryOptions = (features.enums().deliveryStatus || [])
      .map((s) => `<option value="${s}" ${t.deliveryStatus === s ? 'selected' : ''}>${DELIVERY_LABEL[s] || s}</option>`).join('');

    const src = f.sources || {};
    const link = (label, path) => path
      ? `<a href="#" data-doc="${path}">${label} · ${path.split('/').pop()}</a>`
      : `<a class="disabled">${label} · 없음</a>`;
    const prRow = t.prUrl
      ? `<a href="${t.prUrl}" target="_blank">PR #${t.prNumber || ''}</a>`
      : '<span class="feat-sub">없음</span>';

    // 문서 단계 (spec → plan → tasks) + 게이트
    const specConfirmed = t.specStatus === 'Confirmed';
    const planExists = !!(f.planMd && f.planMd.trim());
    const tasksList = f.tasks || [];
    const doneMap = t.tasksDone || {};
    const doneCount = tasksList.filter((tk) => doneMap[tk.id]).length;

    const stagesHtml = `
      <div class="detail-section">
        <h3>문서 단계 (spec → plan → tasks)</h3>
        <div class="stage-row">
          <div class="stage ok"><b>Spec</b><span>${specConfirmed ? '확정' : '작성됨'}</span>
            <button class="btn-ghost" data-doc="spec">편집</button></div>
          <div class="stage ${planExists ? 'ok' : (specConfirmed ? '' : 'lock')}"><b>Plan</b>
            <span>${planExists ? '작성됨' : (specConfirmed ? '대기' : 'spec 확정 필요')}</span>
            <button class="btn-ghost" data-doc="plan" ${specConfirmed ? '' : 'disabled'}>${planExists ? '편집' : '작성'}</button></div>
          <div class="stage ${tasksList.length ? 'ok' : (planExists ? '' : 'lock')}"><b>Tasks</b>
            <span>${tasksList.length ? `${doneCount}/${tasksList.length}` : (planExists ? '대기' : 'plan 필요')}</span>
            <button class="btn-ghost" data-doc="tasks" ${planExists ? '' : 'disabled'}>${tasksList.length ? '편집' : '작성'}</button></div>
        </div>
      </div>`;

    const planHtml = planExists
      ? `<div class="detail-section"><h3>Plan</h3><div class="md">${mdToHtml(f.planMd)}</div></div>` : '';

    // AC 커버리지: 태스크들이 참조한 AC vs spec의 전체 AC
    const allAcIds = (f.acceptanceCriteria || []).map((ac) => ac.id).filter(Boolean);
    const coveredAcs = new Set();
    tasksList.forEach((tk) => (tk.acs || []).forEach((a) => coveredAcs.add(a)));
    const uncovered = allAcIds.filter((a) => !coveredAcs.has(a));
    const coverageHtml = (tasksList.length && allAcIds.length)
      ? (uncovered.length
        ? `<div class="task-coverage warn">⚠ 태스크가 덮지 않은 AC: ${uncovered.map((a) => `<span class="mono">${a}</span>`).join(' ')}</div>`
        : `<div class="task-coverage ok">✓ 모든 AC가 태스크로 덮였습니다</div>`)
      : '';
    const acChips = (tk) => (tk.acs && tk.acs.length)
      ? ' ' + tk.acs.map((a) => `<span class="ac-chip">${a}</span>`).join('') : '';

    const tasksHtml = tasksList.length
      ? `<div class="detail-section"><h3>Tasks (${doneCount}/${tasksList.length})</h3>
          ${coverageHtml}
          <ul class="task-list">${tasksList.map((tk) => `<li><label>
            <input type="checkbox" data-task="${attr(tk.id)}" ${doneMap[tk.id] ? 'checked' : ''} />
            <span><span class="mono">${tk.id || ''}</span> ${tk.title || ''} ${tk.module ? `<span class="feat-sub">${tk.module}</span>` : ''}${acChips(tk)}</span>
          </label></li>`).join('')}</ul>
          ${(f.tasksMd && f.tasksMd.trim()) ? `<details class="task-detail"><summary>태스크 원문 (동작·디자인·DoD)</summary><div class="md">${mdToHtml(f.tasksMd)}</div></details>` : ''}
        </div>` : '';

    panel.innerHTML = `
      <div class="detail-h">
        <div class="crumb">${f.module} · ${f.type}</div>
        <h2>${f.title}</h2>
        <div class="detail-badges">
          ${specBadge(t.specStatus)}
          ${deliveryBadge(t.deliveryStatus)}
          ${features.isDraft(f.id) ? badge('Draft 저장', 'gray') : ''}
        </div>
        <div class="detail-actions">
          <button class="btn-ghost" id="btn-edit">편집</button>
          <button class="btn-primary" id="btn-confirm" ${t.specStatus === 'Confirmed' ? 'disabled' : ''}>
            ${t.specStatus === 'Confirmed' ? '확정됨' : '확정 → PR'}
          </button>
        </div>
      </div>

      ${stagesHtml}

      <div class="detail-section">
        <h3>작업자 / 상태</h3>
        <div class="assignee-row" style="margin-bottom:10px">
          <span class="k" style="color:var(--muted)">담당</span>
          <select id="sel-assignee">${memberOptions}</select>
        </div>
        <div class="assignee-row" style="margin-bottom:10px">
          <span class="k" style="color:var(--muted)">스펙</span>
          <select id="sel-spec">${specOptions}</select>
        </div>
        <div class="assignee-row">
          <span class="k" style="color:var(--muted)">작업</span>
          <select id="sel-delivery">${deliveryOptions}</select>
        </div>
      </div>

      <div class="detail-section">
        <h3>동작 (Behavior)</h3>
        <div class="kv"><span class="k">트리거</span><span class="v">${f.trigger || '-'}</span></div>
        <div class="kv"><span class="k">동작</span><span class="v">${f.behavior || '-'}</span></div>
        <div class="kv"><span class="k">디자인</span><span class="v">${f.designRef && f.designRef.figmaNode ? 'Figma node ' + f.designRef.figmaNode : '-'}</span></div>
        <div class="kv"><span class="k">브랜치</span><span class="v mono">${t.branch || '-'}</span></div>
        <div class="kv"><span class="k">PR</span><span class="v">${prRow}</span></div>
      </div>

      ${nonGoalHtml}
      ${statesHtml}

      <div class="detail-section">
        <h3>수용 조건 (AC)</h3>
        <ul class="ac-list">${acHtml || '<li>정의된 AC 없음</li>'}</ul>
      </div>

      <div class="detail-section">
        <h3>Open Questions (TBD)</h3>
        ${tbdHtml}
      </div>

      ${planHtml}
      ${tasksHtml}

      <div class="detail-section">
        <h3>원문 문서</h3>
        <div class="source-links">
          ${link('Spec', src.spec)}
          ${link('Plan', src.plan)}
          ${link('Tasks', src.tasks)}
        </div>
      </div>
    `;

    // 편집 / 확정
    $('#btn-edit').addEventListener('click', () => openEditor(f, 'spec'));
    const confirmBtn = $('#btn-confirm');
    if (confirmBtn && !confirmBtn.disabled) confirmBtn.addEventListener('click', () => confirmSpec(f));

    // 문서 단계 편집 (게이트)
    panel.querySelectorAll('.stage button[data-doc]').forEach((b) => {
      if (!b.disabled) b.addEventListener('click', () => openEditor(f, b.dataset.doc));
    });
    // 태스크 체크리스트
    panel.querySelectorAll('input[data-task]').forEach((cb) =>
      cb.addEventListener('change', (e) => {
        tracking.toggleTask(f.id, cb.dataset.task, e.target.checked);
        renderKpis(); renderDetail();
      }));

    // 인터랙션: 할당/상태 변경 → store(추후 Firestore) 반영
    $('#sel-assignee').addEventListener('change', (e) => {
      tracking.setAssignee(f.id, e.target.value);
      renderKpis(); renderCenter(); renderDetail();
    });
    $('#sel-spec').addEventListener('change', (e) => {
      tracking.setSpecStatus(f.id, e.target.value);
      renderCenter(); renderDetail();
    });
    $('#sel-delivery').addEventListener('change', (e) => {
      tracking.setDeliveryStatus(f.id, e.target.value);
      renderCenter(); renderDetail();
    });
    panel.querySelectorAll('a[data-doc]').forEach((a) =>
      a.addEventListener('click', (e) => {
        e.preventDefault();
        alert(`원문 보기는 다음 단계에서 연결됩니다:\n${a.dataset.doc}`);
      }));
  }

  // ===================== Editor (작성/편집) =====================
  let editingId = null;
  let editingDoc = 'spec';
  const attr = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const escTxt = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  function acRow(ac) {
    return `<div class="list-row" data-row="ac">
      <input class="k ac-id" placeholder="AC1" value="${attr(ac && ac.id)}" />
      <input class="grow ac-text" placeholder="수용 조건 텍스트" value="${attr(ac && ac.text)}" />
      <button class="btn-del" type="button" data-del>×</button></div>`;
  }
  function tbdRow(t) {
    return `<div class="list-row" data-row="tbd">
      <input class="k tbd-id" placeholder="TBD-1" value="${attr(t && t.id)}" />
      <input class="k tbd-res" placeholder="결정주체" value="${attr(t && t.resolver)}" />
      <input class="grow tbd-q" placeholder="미해결 질문" value="${attr(t && t.question)}" />
      <button class="btn-del" type="button" data-del>×</button></div>`;
  }
  function taskRow(t) {
    return `<div class="list-row" data-row="task">
      <input class="k task-id" placeholder="T1" value="${attr(t && t.id)}" />
      <input class="k task-mod" placeholder=":core:domain" value="${attr(t && t.module)}" />
      <input class="grow task-title" placeholder="태스크 제목" value="${attr(t && t.title)}" />
      <button class="btn-del" type="button" data-del>×</button></div>`;
  }
  function nonGoalRow(g) {
    const txt = g && (typeof g === 'string' ? g : g.text);
    return `<div class="list-row" data-row="nongoal">
      <input class="grow ng-text" placeholder="이번 스펙에서 하지 않는 범위" value="${attr(txt)}" />
      <button class="btn-del" type="button" data-del>×</button></div>`;
  }
  function stateRow(s) {
    return `<div class="list-row" data-row="state">
      <input class="k st-label" placeholder="로딩/빈/에러" value="${attr(s && s.label)}" />
      <input class="grow st-text" placeholder="해당 상태의 화면·동작" value="${attr(s && s.text)}" />
      <button class="btn-del" type="button" data-del>×</button></div>`;
  }

  function buildFormHtml(f) {
    const enums = features.enums();
    const typeOpts = (enums.type || ['Screen'])
      .map((t) => `<option value="${t}" ${f.type === t ? 'selected' : ''}>${t}</option>`).join('');
    const modOpts = features.modules().map((m) => `<option value="${m.id}">`).join('');
    const dr = f.designRef || {};
    return `
      <div class="form-grid">
        <div class="form-row"><label>ID *</label>
          <input id="ed-id" placeholder="005-now-openchat" value="${attr(f.id)}" ${editingId ? 'disabled' : ''} /></div>
        <div class="form-row"><label>제목 *</label>
          <input id="ed-title" placeholder="지금 - 오픈채팅 목록" value="${attr(f.title)}" /></div>
        <div class="form-row"><label>모듈</label>
          <input id="ed-module" list="ed-modlist" placeholder="feature:now" value="${attr(f.module)}" />
          <datalist id="ed-modlist">${modOpts}</datalist></div>
        <div class="form-row"><label>타입</label><select id="ed-type">${typeOpts}</select></div>
        <div class="form-row full"><label>트리거</label>
          <input id="ed-trigger" placeholder="진입 트리거 한 줄" value="${attr(f.trigger)}" /></div>
        <div class="form-row full"><label>동작 (Behavior)</label>
          <textarea id="ed-behavior" placeholder="이 화면이 무엇을 하는지">${escTxt(f.behavior)}</textarea></div>
        <div class="form-row"><label>Figma node</label>
          <input id="ed-figma-node" placeholder="2001-0001" value="${attr(dr.figmaNode)}" /></div>
        <div class="form-row"><label>Figma URL</label>
          <input id="ed-figma-url" placeholder="https://figma.com/..." value="${attr(dr.url)}" /></div>
        <div class="form-row full"><label>관련 feature (쉼표 구분)</label>
          <input id="ed-related" placeholder="006-now-shorts" value="${attr((f.relatedFeatures || []).join(', '))}" /></div>
      </div>

      <div class="editor-section">
        <div class="h"><span>비목표 (Out of scope)</span><button class="btn-add" type="button" data-add="nongoal">+ 추가</button></div>
        <div id="ed-ng">${(f.nonGoals || []).map(nonGoalRow).join('')}</div>
      </div>
      <div class="editor-section">
        <div class="h"><span>상태 / 예외</span><button class="btn-add" type="button" data-add="state">+ 추가</button></div>
        <div id="ed-state">${(f.states || []).map(stateRow).join('')}</div>
      </div>
      <div class="editor-section">
        <div class="h"><span>수용 조건 (AC)</span><button class="btn-add" type="button" data-add="ac">+ 추가</button></div>
        <div id="ed-ac">${(f.acceptanceCriteria || []).map(acRow).join('')}</div>
      </div>
      <div class="editor-section">
        <div class="h"><span>Open Questions (TBD)</span><button class="btn-add" type="button" data-add="tbd">+ 추가</button></div>
        <div id="ed-tbd">${(f.tbds || []).map(tbdRow).join('')}</div>
      </div>
      <div class="editor-section">
        <div class="h"><span>Tasks</span><button class="btn-add" type="button" data-add="task">+ 추가</button></div>
        <div id="ed-task">${(f.tasks || []).map(taskRow).join('')}</div>
      </div>`;
  }

  function wireFormButtons() {
    const body = $('#editor-body');
    body.querySelectorAll('[data-add]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const kind = btn.dataset.add;
        const cont = { ac: '#ed-ac', tbd: '#ed-tbd', task: '#ed-task', nongoal: '#ed-ng', state: '#ed-state' }[kind];
        const rowFn = { ac: acRow, tbd: tbdRow, task: taskRow, nongoal: nonGoalRow, state: stateRow }[kind];
        body.querySelector(cont).insertAdjacentHTML('beforeend', rowFn());
        wireDeletes();
      }));
    wireDeletes();
  }

  function switchPane(name) {
    $('#pane-paste').classList.toggle('hidden', name !== 'paste');
    $('#pane-form').classList.toggle('hidden', name !== 'form');
    $('#editor-body').querySelectorAll('.editor-tabs button')
      .forEach((b) => b.classList.toggle('active', b.dataset.pane === name));
  }

  const STAGE_LABEL = { spec: 'Spec', plan: 'Plan', tasks: 'Tasks' };

  function openEditor(feature, docType) {
    editingDoc = docType || 'spec';
    const f = feature ? JSON.parse(JSON.stringify(feature)) : features.blank();
    editingId = feature ? feature.id : null;
    $('#editor-title').textContent = `${STAGE_LABEL[editingDoc]} ${feature ? '편집' : '작성'}`;
    msg('', false);
    if (editingDoc === 'spec') renderSpecEditor(f, !feature);
    else renderDocEditor(f, editingDoc);
    $('#editor-modal').classList.remove('hidden');
  }

  function renderSpecEditor(f, startPaste) {
    $('#editor-body').innerHTML = `
      <div class="editor-tabs">
        <button type="button" data-pane="paste" class="${startPaste ? 'active' : ''}">📋 붙여넣기</button>
        <button type="button" data-pane="form" class="${startPaste ? '' : 'active'}">✏️ 양식</button>
      </div>
      <div id="pane-paste" class="${startPaste ? '' : 'hidden'}">
        <div class="paste-help">
          <span>에이전트가 만든 스펙(마크다운)을 붙여넣고 [가져오기]를 누르세요.</span>
          <button class="btn-add" type="button" id="btn-copy-prompt">spec 프롬프트 복사</button>
        </div>
        <textarea id="ed-paste" class="paste-area" placeholder="---&#10;id: 005-now-openchat&#10;title: ...&#10;module: feature:now&#10;---&#10;&#10;## 동작&#10;...&#10;&#10;## 수용 조건&#10;- AC1: ..."></textarea>
        <button class="btn-primary" type="button" id="btn-import">가져오기 →</button>
      </div>
      <div id="pane-form" class="${startPaste ? 'hidden' : ''}">${buildFormHtml(f)}</div>
    `;
    $('#editor-body').querySelectorAll('.editor-tabs button')
      .forEach((b) => b.addEventListener('click', () => switchPane(b.dataset.pane)));
    $('#btn-import').addEventListener('click', doImport);
    $('#btn-copy-prompt').addEventListener('click', copyPrompt);
    wireFormButtons();
  }

  function renderDocEditor(f, docType) {
    const raw = docType === 'plan' ? (f.planMd || '') : (f.tasksMd || '');
    const help = docType === 'plan'
      ? '레포 안 Claude Code로 plan을 생성해 붙여넣으세요 (docs/architecture·기존 모듈·design-system 참조).'
      : '레포 안 Claude Code로 tasks를 생성해 붙여넣으세요 (plan·docs/conventions·Figma node 참조).';
    $('#editor-body').innerHTML = `
      <div class="paste-help">
        <span>${help}</span>
        <button class="btn-add" type="button" id="btn-copy-prompt">${docType} 프롬프트 복사</button>
      </div>
      <textarea id="ed-doc" class="paste-area" placeholder="${docType}.md (마크다운)">${escTxt(raw)}</textarea>
      ${docType === 'tasks' ? '<div id="task-preview" class="task-preview"></div>' : ''}
    `;
    $('#btn-copy-prompt').addEventListener('click', copyPrompt);
    if (docType === 'tasks') {
      const upd = () => {
        const t = window.MASCParseSpec($('#ed-doc').value).tasks;
        $('#task-preview').innerHTML = t.length
          ? `파싱된 태스크 ${t.length}개: ` + t.map((x) => `<span class="mono">${x.id || '?'}</span>`).join(' ')
          : '아직 태스크가 인식되지 않았습니다 — "## Tasks" 섹션 + "- T1 [:module]: 제목" 형식.';
      };
      $('#ed-doc').addEventListener('input', upd);
      upd();
    }
  }

  function doImport() {
    const text = $('#ed-paste').value;
    if (!text.trim()) return msg('붙여넣은 내용이 없습니다.');
    const parsed = window.MASCParseSpec(text);
    if (!parsed.title && !parsed.id) {
      return msg('파싱 실패: 제목/ID를 찾지 못했습니다. frontmatter(--- 블록)나 # 제목을 확인하세요.');
    }
    if (editingId) parsed.id = editingId; // 편집 중엔 ID 고정
    $('#pane-form').innerHTML = buildFormHtml(parsed);
    wireFormButtons();
    switchPane('form');
    const n = parsed.acceptanceCriteria.length, t = parsed.tbds.length, k = parsed.tasks.length;
    const g = parsed.nonGoals.length, s = parsed.states.length;
    msg(`가져왔습니다 — AC ${n} · TBD ${t} · 비목표 ${g} · 상태 ${s} · Tasks ${k}. 검토 후 저장하세요.`, false);
  }

  const STAGE_PROMPTS = {
    spec: [
      '당신은 안드로이드 기능 스펙 작성자입니다. 주어진 기획문서(PRD)와 Figma를 바탕으로',
      '아래 마크다운 형식을 "정확히" 지켜 spec 초안을 출력하세요.',
      '',
      '---',
      'id: <영소문자-숫자-하이픈, 예: 005-now-openchat>',
      'title: <화면/기능 제목>',
      'module: <예: feature:now>',
      'type: Screen | Component | Infra',
      'trigger: <진입 트리거 한 줄>',
      'figmaNode: <노드 id, 선택>',
      'figmaUrl: <Figma URL, 선택>',
      'related: <관련 feature id, 쉼표 구분, 선택>',
      '---',
      '',
      '# <title>',
      '',
      '## 동작',
      '<이 기능이 무엇을/왜 하는지 2~4문장. 진입 전제조건이 있으면 함께>',
      '',
      '## 비목표',
      '<이번 스펙에서 "하지 않는" 범위. 스코프 크립 방지. 없으면 "- 없음">',
      '',
      '## 상태/예외',
      '- 로딩: <데이터 로딩 중 화면>',
      '- 빈 상태: <표시할 데이터가 없을 때>',
      '- 에러: <실패 시 동작 (재시도/메시지 등)>',
      '',
      '## 수용 조건',
      '- AC1: <…할 때> / <…하면> / <…된다>  (Given-When-Then)',
      '',
      '## Open Questions',
      '- TBD-1 (기획/디자인/서버): <확인이 필요한 미해결 질문>',
      '',
      '규칙:',
      '- "어떻게(구현)"가 아니라 "무엇/왜"에 집중. 불명확한 점은 추측 말고 Open Questions에 TBD로.',
      '- 수용 조건은 각 줄을 Given(전제)/When(행동)/Then(결과)으로 측정 가능하게.',
      '- 비목표·상태/예외 항목은 "- 라벨: 내용" 한 줄 불릿으로 (대시보드 파싱용).',
      '- 상태/예외는 Screen 기능이면 반드시 채울 것. Infra면 생략 가능.',
      '- 위 형식 외 다른 텍스트는 출력하지 말 것.',
    ].join('\n'),
    plan: [
      '[Team-MINO-Android 레포 안에서 실행하세요]',
      '당신은 이 안드로이드 프로젝트의 아키텍트입니다. 아래 문서를 직접 읽고 이 기능의 plan.md를 작성하세요:',
      '- docs/architecture/modularization.md, feature-module.md, feature-navigation.md',
      '- 기존 모듈(feature/sample, feature/home) 구현 패턴',
      '- core/design-system/README.md (재사용 컴포넌트 우선)',
      '확정된 spec(아래 첨부)을 기술 설계로 번역하세요. constitution 게이트(모듈 의존성, api/impl 분리,',
      'MVI 타입은 :core:common:android, Compose Lint, 디자인토큰 우선)를 준수.',
      '',
      '출력(마크다운):',
      '## 모듈 구성',
      '## MVI 계약 (Intent / UiState / SideEffect)',
      '   - Intent: 사용자/시스템 액션 (예: OnMarkerClick, OnRetry)',
      '   - UiState: spec의 상태/예외(로딩·빈·에러)를 빠짐없이 반영',
      '   - SideEffect: 일회성 효과 (네비게이션 이동, 토스트 등)',
      '## 데이터 (Repository / UseCase / domain·data 모듈)',
      '   - 호출 흐름과 어느 모듈에 둘지, 신규 vs 기존 재사용',
      '## 네비게이션',
      '## design-system 매핑 (재사용 vs 신규)',
      '## Pre-Implementation Gate 체크',
      '',
      '--- 확정된 spec ---',
      '<여기에 spec 본문 붙여넣기>',
    ].join('\n'),
    tasks: [
      '[Team-MINO-Android 레포 안에서 실행하세요]',
      '당신은 이 기능을 구현 가능한 태스크로 분해합니다. 아래를 참고:',
      '- 이 기능의 plan.md (아래 첨부)',
      '- docs/conventions/* (commit-message, compose-lint, pull-request, branch-naming)',
      '- Figma node (디자인 기준)',
      '',
      '출력(마크다운): "## Tasks" 섹션에 태스크를 나열. 각 줄은 다음 형식을 반드시 지킬 것:',
      '- T1 [:core:domain]: <태스크 제목> (AC1, AC2)',
      '   - 끝의 (AC..)는 이 태스크가 충족하는 수용 조건 번호 (추적성). 없으면 생략.',
      '각 태스크 아래에 동작 명세 / 디자인 기준(Figma node) / 완료 조건(DoD)을 들여쓰기로 적되,',
      '태스크 줄 자체는 위 "- T# [:module]: 제목 (AC..)" 형식 유지 (대시보드 체크리스트 파싱용).',
      '태스크 = 원자적 커밋 단위. 테스트를 앞에 둘 것.',
      'spec의 모든 AC가 최소 하나의 태스크로 덮이도록 할 것.',
      '',
      '--- 이 기능의 plan ---',
      '<여기에 plan 본문 붙여넣기>',
    ].join('\n'),
  };

  function copyPrompt() {
    const text = STAGE_PROMPTS[editingDoc] || STAGE_PROMPTS.spec;
    const done = () => msg(`${STAGE_LABEL[editingDoc]} 프롬프트를 복사했습니다.`, false);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => msg('복사 실패 — 직접 선택해 복사하세요.'));
    } else {
      msg('이 브라우저는 자동 복사를 지원하지 않습니다.');
    }
  }

  function wireDeletes() {
    $('#editor-body').querySelectorAll('[data-del]').forEach((btn) => {
      btn.onclick = () => btn.closest('.list-row').remove();
    });
  }

  function closeEditor() {
    $('#editor-modal').classList.add('hidden');
    editingId = null;
  }

  function collectRows(sel, fields) {
    return [...$('#editor-body').querySelectorAll(`${sel} .list-row`)].map((row) => {
      const o = {};
      Object.entries(fields).forEach(([key, cls]) => {
        const inp = row.querySelector(cls);
        o[key] = inp ? inp.value.trim() : '';
      });
      return o;
    }).filter((o) => Object.values(o).some((v) => v));
  }

  function saveEditor() {
    if (editingDoc === 'spec') return saveSpec();
    return saveDoc();
  }

  function saveDoc() {
    const f = features.get(editingId);
    if (!f) return msg('대상 스펙을 찾지 못했습니다.');
    const raw = $('#ed-doc').value;
    if (editingDoc === 'plan') {
      f.planMd = raw;
      f.sources = Object.assign({}, f.sources, { plan: `docs/specs/${f.id}/plan.md` });
    } else {
      f.tasksMd = raw;
      f.tasks = window.MASCParseSpec(raw).tasks;
      f.sources = Object.assign({}, f.sources, { tasks: `docs/specs/${f.id}/tasks.md` });
    }
    features.save(f);
    closeEditor();
    select(f.id);
    renderAll();
  }

  function saveSpec() {
    const v = (sel) => ($(sel).value || '').trim();
    const id = v('#ed-id');
    const title = v('#ed-title');
    if (!id) return msg('ID는 필수입니다.');
    if (!/^[a-z0-9-]+$/.test(id)) return msg('ID는 영소문자/숫자/하이픈만 사용하세요.');
    if (!title) return msg('제목은 필수입니다.');
    if (!editingId && features.get(id)) return msg('이미 존재하는 ID입니다.');

    const existing = editingId ? features.get(editingId) : null;
    const feature = Object.assign({}, existing || {}, {
      id, title,
      module: v('#ed-module'),
      type: $('#ed-type').value,
      trigger: v('#ed-trigger'),
      behavior: v('#ed-behavior'),
      designRef: { figmaNode: v('#ed-figma-node'), url: v('#ed-figma-url') },
      acceptanceCriteria: collectRows('#ed-ac', { id: '.ac-id', text: '.ac-text' }),
      tbds: collectRows('#ed-tbd', { id: '.tbd-id', resolver: '.tbd-res', question: '.tbd-q' }),
      tasks: collectRows('#ed-task', { id: '.task-id', module: '.task-mod', title: '.task-title' })
        .map((t) => Object.assign({ acs: ((existing && existing.tasks) || []).find((x) => x.id === t.id)?.acs || [] }, t)),
      nonGoals: collectRows('#ed-ng', { text: '.ng-text' }).map((o) => o.text),
      states: collectRows('#ed-state', { label: '.st-label', text: '.st-text' }),
      relatedFeatures: v('#ed-related').split(',').map((s) => s.trim()).filter(Boolean),
      sources: (existing && existing.sources && existing.sources.spec)
        ? existing.sources
        : { spec: `docs/specs/${id}/spec.md`, plan: '', tasks: '' },
    });
    features.save(feature);
    closeEditor();
    select(feature.id);
    renderAll();
  }
  function msg(t, error = true) {
    const el = $('#editor-msg');
    el.textContent = t;
    el.classList.toggle('error', error);
  }

  function confirmSpec(f) {
    const tbdN = (f.tbds || []).length;
    if (tbdN > 0 && !window.confirm(`미해결 TBD ${tbdN}건이 남아있습니다.\n그래도 "확정"하시겠습니까?`)) return;
    tracking.setSpecStatus(f.id, 'Confirmed');
    window.alert('확정되었습니다.\nAndroid 레포 PR 자동 생성은 3단계(Firebase Functions + 봇)에서 연결됩니다.');
    renderAll();
    renderDetail();
  }

  // ===================== Boot =====================
  if (auth.currentUser()) showApp(); else showLogin();
})();
