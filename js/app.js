/**
 * MASC app (v2) — UI 렌더링 & 상호작용
 * 데이터는 전부 window.MASC(store.js)를 통해서만 접근.
 * 파이프라인 상태머신: docs/design/state-machine.md · 검증: docs/design/validation.md
 */
(function () {
  const { auth, features } = window.MASC;
  const V = window.MASCValidate;
  const V2 = window.MASCVersion;
  const SPEC = window.MASCSpec;
  const FB = window.MASC.BACKEND === 'firebase';

  // ---------- 상태 라벨/색상/설명 ----------
  const STATUS_LABEL = {
    spec_draft: '작성중', spec_in_review: '검토중', spec_changes_requested: '반려됨',
    spec_approved: '승인됨', pr_open: 'PR 열림',
    merged: '머지됨', pr_closed: 'PR 종료',
  };
  const STATUS_COLOR = {
    spec_draft: 'gray', spec_in_review: 'amber', spec_changes_requested: 'red',
    spec_approved: 'green', pr_open: 'blue',
    merged: 'green', pr_closed: 'gray',
  };
  const STATUS_DESC = {
    spec_draft: 'spec 작성/수정 중 (초기). 개발자 편집 가능.',
    spec_in_review: '디자이너 검토 중. spec read-only 잠금.',
    spec_changes_requested: '디자이너가 반려. 개발자가 수정 후 재요청.',
    spec_approved: 'spec 컨펌 완료. PR 생성 잠금 해제.',
    pr_open: 'spec PR 열림(base 브랜치 타겟). Webhook 머지/종료 대기.',
    merged: 'base 브랜치에 머지 완료 — plan/task 단계로 이어짐.',
    pr_closed: 'PR 미머지 종료.',
  };

  // 파이프라인 스텝퍼 (직선 흐름)
  const STEPS = [
    { key: 'spec_draft', label: 'spec 작성' },
    { key: 'spec_in_review', label: '검토' },
    { key: 'spec_approved', label: '승인' },
    { key: 'pr_open', label: 'PR' },
    { key: 'merged', label: '머지' },
  ];
  const STEP_INDEX = {
    spec_draft: 0, spec_changes_requested: 0, spec_in_review: 1,
    spec_approved: 2, pr_open: 3, merged: 4, pr_closed: 3,
  };

  const state = { status: 'all', quick: new Set(), search: '', selectedId: null };
  // Discord 알림 딥링크(?feature={id}, notifications.md §4) — 데이터 로드 후 1회 적용
  let pendingDeepLink = new URLSearchParams(location.search).get('feature');
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const userName = (uid) => { const u = auth.userOf(uid); return u ? u.name : (uid || ''); };
  const badge = (text, color, title) =>
    `<span class="badge ${color}"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</span>`;
  const statusBadge = (s) => badge(STATUS_LABEL[s] || s, STATUS_COLOR[s] || 'gray', STATUS_DESC[s]);
  // 미해소 `[TBD]` 건수 — 검수에서 확정이 필요한 항목의 개수 (validate.js S6와 같은 패턴)
  const tbdCount = (f) => ((f && f.specBody) || '').match(/\[TBD\b[^\]]*\]/g)?.length || 0;
  // 0건이면 아무것도 노출하지 않는다 — 확정이 남은 스펙만 눈에 띄게.
  const tbdBadge = (f) => {
    const n = tbdCount(f);
    return n ? badge(`TBD ${n}건`, 'amber', `미해소 [TBD] ${n}건 — 검수에서 확정이 필요한 항목입니다`) : '';
  };

  // ===================== Auth =====================
  function renderLoginUsers() {
    $('#login-users').innerHTML = auth.users().map((u) =>
      `<button class="login-user" data-uid="${u.uid}">
        <span class="avatar">${esc(u.name.slice(0, 1))}</span>
        <span class="lu-name">${esc(u.name)}</span>
        <span class="lu-role ${u.role}">${u.role === 'designer' ? '디자이너' : '개발자'}</span>
        <span class="lu-gh mono">@${esc(u.githubLogin)}</span>
      </button>`).join('');
    document.querySelectorAll('#login-users .login-user').forEach((b) =>
      b.addEventListener('click', () => { auth.loginAs(b.dataset.uid); showApp(); }));
  }
  // Firebase 로그인 화면 — 단일 GitHub 버튼
  function renderGithubLogin() {
    $('#login-users').innerHTML =
      `<button class="login-user" id="gh-login">
        <span class="avatar">GH</span><span class="lu-name">GitHub로 로그인</span>
      </button>`;
    $('#gh-login').addEventListener('click', async () => {
      const r = await auth.loginGithub();
      if (!r.ok) alert('로그인 실패: ' + r.error);
    });
  }

  let onboardWired = false;
  function showOnboarding() {
    $('#login').classList.add('hidden'); $('#app').classList.add('hidden');
    openModal('onboard-modal');
    if (onboardWired) return; onboardWired = true;
    const pick = async (role) => {
      $('#onboard-msg').textContent = '저장 중…';
      const r = await auth.setRole(role);
      if (!r.ok) { $('#onboard-msg').textContent = r.error; return; }
      closeModal('onboard-modal'); // onAuthChange가 showApp 재호출
    };
    $('#onboard-dev').addEventListener('click', () => pick('developer'));
    $('#onboard-designer').addEventListener('click', () => pick('designer'));
  }

  function showLogin() { $('#login').classList.remove('hidden'); $('#app').classList.add('hidden'); }
  let subscribed = false;
  function showApp() {
    const u = auth.currentUser();
    if (FB && u && !u.role) { showOnboarding(); return; } // 첫 로그인 역할 선택
    $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
    renderUserChip(); initControls();
    if (!subscribed) { subscribed = true; features.subscribe(() => { if (!$('#app').classList.contains('hidden')) renderAll(); }); }
    renderAll();
  }
  function renderUserChip() {
    const u = auth.currentUser(); if (!u) return;
    const roleKo = u.role === 'designer' ? '디자이너' : '개발자';
    $('#user-chip').innerHTML =
      `<span class="avatar">${esc(u.name.slice(0, 1))}</span><span>${esc(u.name)} · ${roleKo}</span>`;
  }

  // ===================== Controls =====================
  let controlsReady = false;
  function initControls() {
    if (controlsReady) return; controlsReady = true;
    const meta = features.meta();
    $('#meta-line').textContent = `${meta.project} · seed ${meta.generatedAt}`;

    $('#search').addEventListener('input', (e) => { state.search = e.target.value.toLowerCase(); renderAll(); });
    document.querySelectorAll('#quick-filters .chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const q = chip.dataset.q;
        if (state.quick.has(q)) state.quick.delete(q); else state.quick.add(q);
        chip.classList.toggle('active'); renderAll();
      });
    });
    $('#btn-reset').addEventListener('click', resetFilters);
    $('#btn-logout').addEventListener('click', () => { auth.logout(); controlsReady = false; showLogin(); });
    $('#btn-new').addEventListener('click', () => openUpload(null));

    renderLegend(); renderSkillGuide();
    $('#btn-legend').addEventListener('click', () => openModal('legend-modal'));
    $('#btn-skill').addEventListener('click', () => openModal('skill-modal'));

    // 역할별 사용법 — 클릭 시 현재 역할 탭을 기본으로 열고, 탭으로 상대 역할도 확인
    $('#btn-roleguide').addEventListener('click', () => {
      renderRoleGuide(auth.isDeveloper() ? 'developer' : 'designer');
      openModal('roleguide-modal');
    });
    document.querySelectorAll('#roleguide-tabs .role-tab').forEach((tab) =>
      tab.addEventListener('click', () => renderRoleGuide(tab.dataset.role)));

    // 디자이너는 문서 생성 스킬을 쓰지 않으므로 스킬 안내 버튼 숨김
    $('#btn-skill').style.display = auth.isDeveloper() ? '' : 'none';

    document.querySelectorAll('[data-close]').forEach((b) =>
      b.addEventListener('click', () => closeModal(b.dataset.close)));
    document.querySelectorAll('.modal-overlay').forEach((m) =>
      m.addEventListener('click', (e) => { if (e.target === m) closeModal(m.id); }));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') document.querySelectorAll('.modal-overlay:not(.hidden)').forEach((m) => closeModal(m.id));
    });

    $('#upload-save').addEventListener('click', saveUpload);
    $('#auth-relogin').addEventListener('click', async () => {
      closeModal('auth-help-modal');
      if (auth.loginGithub) { await auth.loginGithub(); } // 토큰 갱신 → 이후 PR 재시도
    });
    $('#doc-approve').addEventListener('click', approveFromReview);
    $('#doc-reject').addEventListener('click', rejectFromReview);

    // 디자이너는 spec을 작성/업로드하지 않는다 (PRD 3장: 승인/반려만 관여)
    $('#btn-new').style.display = auth.isDeveloper() ? '' : 'none';
  }
  const openModal = (id) => $('#' + id).classList.remove('hidden');
  const closeModal = (id) => $('#' + id).classList.add('hidden');

  function resetFilters() {
    state.status = 'all'; state.quick.clear(); state.search = '';
    $('#search').value = '';
    document.querySelectorAll('#quick-filters .chip').forEach((c) => c.classList.remove('active'));
    renderAll();
  }

  function renderLegend() {
    const rows = (features.enums().status || []).map((s) =>
      `<tr><td>${statusBadge(s)}</td><td><span class="meaning">${esc(STATUS_DESC[s] || '')}</span></td></tr>`).join('');
    $('#legend-body').innerHTML = `
      <p class="desc">docs/specs/{feature} 한 묶음이 단일 status를 가진다. 디자이너는 spec에만 관여.</p>
      <table class="legend-table"><tbody>${rows}</tbody></table>
      <div class="legend-note">
        <b>게이트</b> · spec <b>승인(spec_approved)</b> 전에는 PR 생성 불가.
        승인 후 spec을 수정하면 <b>무효화</b> — 작성중으로 복귀하고 열린 PR은 자동 종료됩니다.
        spec PR은 <code>develop</code>이 아니라 이슈의 <b>base 브랜치</b>(<code>…/base</code>)를 타겟합니다.
      </div>`;
  }

  function renderSkillGuide() {
    $('#skill-body').innerHTML = `
      <p class="desc">문서 <b>생성은 대시보드가 아니라 로컬 Claude Code 스킬</b>로 합니다.
      정의는 Mino-Android 레포 <code>.claude/</code>에 있습니다.</p>
      <ol class="skill-steps">
        <li><b>설치</b> — Mino-Android 레포에서 <code>git pull</code> (스킬/에이전트 최신화)</li>
        <li><b>이슈·base 브랜치 생성</b> — <code>/issue</code> 실행 →
          <code>&lt;prefix&gt;/&lt;이슈번호&gt;-&lt;slug&gt;/base</code> 브랜치가 자동 생성됩니다
          (업로드 시 이 브랜치를 고릅니다)</li>
        <li><b>spec 생성</b> — <code>/mino-spec</code> 실행 · 입력: 기능 설명 + Figma URL →
          <code>docs/specs/{feature}/spec.md</code> + 품질 체크리스트 산출.
          상태가 <code>DRAFT</code>이거나 <code>[TBD]</code>가 남아 있어도 업로드할 수 있습니다
          (경고만 표시 — 검수로 확정할 항목)</li>
        <li><b>업로드</b> — spec.md를 이 대시보드에 붙여넣기/드롭 ([+ 새 스펙 업로드]) →
          구조 검증(S1–S6) → base 브랜치 선택 → 디자이너 컨펌</li>
        <li><b>PR</b> — 승인되면 <code>PR 생성</code>으로 <code>…/spec</code> 브랜치를 만들어 base 브랜치로 PR</li>
        <li><b>이후 단계</b> — <code>/mino-plan</code>·<code>/mino-task</code>는 대시보드를 거치지 않고
          같은 base 브랜치 아래 하위 작업으로 진행합니다</li>
      </ol>
      <div class="legend-note">대시보드는 입력값 치환을 하지 않습니다. 스킬 실행 시 직접 Figma URL·기획서를 전달하세요.</div>`;
  }

  // ===================== 역할별 사용법 =====================
  const ROLE_GUIDE = {
    developer: {
      intro: `개발자는 스펙을 <b>작성·업로드</b>하고, 디자이너 컨펌을 거쳐 <b>spec PR까지 배출</b>하는 주체입니다.
        문서 생성은 대시보드가 아니라 로컬 Claude Code 스킬(<code>스킬 안내</code> 참고)로 합니다.`,
      steps: [
        `<b>이슈·base 브랜치</b> — Mino-Android 레포에서 <code>git pull</code> → <code>/issue</code>로 이슈와 <code>&lt;prefix&gt;/&lt;이슈번호&gt;-&lt;slug&gt;/base</code> 브랜치 생성`,
        `<b>스펙 작성 (로컬)</b> — <code>/mino-spec</code>으로 <code>docs/specs/{feature}/spec.md</code> 생성. 헤더 <code>상태: DRAFT</code>거나 <code>[TBD]</code>가 남아 있어도 업로드 가능 — 확정이 필요한 항목일수록 검수에 올리세요`,
        `<b>업로드 + 검증</b> — <code>+ 새 스펙 업로드</code>에 spec.md 붙여넣기/드롭 → <b>base 브랜치 선택</b> → S1–S6 구조 검증 통과 시 <code>spec_draft</code> 생성 (DRAFT·<code>[TBD]</code>는 경고로만 표시되고 저장은 진행됨. 버전은 헤더 <code>**버전**</code> 값을 그대로 사용)`,
        `<b>컨펌 요청</b> — 상세에서 <code>컨펌 요청</code> → <code>spec_in_review</code> 전환 + spec이 read-only로 잠김`,
        `<b>반려 반영 → 재요청</b> — 반려(<code>spec_changes_requested</code>) 시 로컬에서 <code>/mino-spec</code>으로 개정(버전 bump는 스킬이 판정) → <code>spec 수정</code>으로 재업로드 후 <code>컨펌 요청</code>`,
        `<b>PR 생성</b> — 승인(<code>spec_approved</code>)되면 <code>PR 생성</code> → <code>&lt;prefix&gt;/&lt;이슈번호&gt;-&lt;slug&gt;/spec</code> 브랜치에 <code>docs/specs/{slug}/spec.md</code> 커밋 → <b>base 브랜치로 PR</b> → <code>pr_open</code>`,
        `<b>이후 단계</b> — 머지되면 같은 base 브랜치에서 <code>/mino-plan</code>·<code>/mino-task</code>를 진행합니다. plan은 대시보드 검토 대상이 아닙니다`,
        `<b>무효화</b> — 승인 이후 <code>spec 수정</code> 시 자동으로 <code>spec_draft</code> 복귀 + 열린 PR close`,
      ],
      note: `상세 패널의 <b>버전 스냅샷</b>에서 버전별 메모를 확인·편집하고, 재검토 시 "지난 검토 이후 변경분" diff를 열 수 있습니다. 버전 값 자체는 <code>/mino-spec</code>이 소유합니다.`,
    },
    designer: {
      intro: `디자이너는 <b>spec 컨펌 게이트</b>를 담당합니다. 검토 중인 스펙을 유저 플로우 단위로 확인하고 <b>승인 / 반려</b>로 파이프라인을 통과시킵니다.
        PR·이후 구현 단계에는 관여하지 않습니다(문서 생성 스킬도 사용하지 않습니다).`,
      steps: [
        `<b>검토 대기 확인</b> — 좌측 <code>검토중</code> 필터 또는 상단 KPI <b>검토중</b>으로 <code>spec_in_review</code>만 추려 대상 Feature 선택`,
        `<b>스펙 검토</b> — 상세의 <code>📝 스펙 검토</code>로 리뷰 모드 열기. 유저 플로우의 <b>Figma 링크</b>로 원본과 대조하고, 제목 옆 <b>💬</b>로 플로우·요구사항에 인라인 코멘트`,
        `<b>승인</b> — <code>spec_approved</code>로 전환, 개발자의 PR 생성 잠금 해제`,
        `<b>반려</b> — <code>spec_changes_requested</code>로 전환. <b>코멘트가 1개 이상</b> 있어야 반려 가능(무엇을 고칠지 없이 반려 불가)`,
        `<b>보충 코멘트</b> — 이미 반려된 스펙에 상태 변경 없이 코멘트만 더할 때 <code>💬 코멘트 추가</code> 사용`,
      ],
      note: `검토 중(<code>spec_in_review</code>)에는 개발자가 spec을 수정할 수 없습니다. 개발자가 승인 이후 spec을 수정하면 자동 무효화되어 다시 검토 대기로 돌아올 수 있습니다.`,
    },
  };

  function renderRoleGuide(role) {
    const g = ROLE_GUIDE[role] || ROLE_GUIDE.developer;
    document.querySelectorAll('#roleguide-tabs .role-tab').forEach((t) =>
      t.classList.toggle('active', t.dataset.role === role));
    const steps = g.steps.map((s) => `<li>${s}</li>`).join('');
    $('#roleguide-body').innerHTML = `
      <p class="desc">${g.intro}</p>
      <ol class="skill-steps">${steps}</ol>
      <div class="legend-note">${g.note}</div>`;
  }

  // ===================== Filtering =====================
  function filtered() {
    const me = auth.currentUser();
    return features.all().filter((f) => {
      if (state.status !== 'all' && f.status !== state.status) return false;
      if (state.quick.has('pr') && !f.prNumber) return false;
      if (state.quick.has('mine') && (!me || f.createdBy !== me.uid)) return false;
      if (state.search) {
        const hay = `${f.title} ${f.slug}`.toLowerCase();
        if (!hay.includes(state.search)) return false;
      }
      return true;
    });
  }

  // ===================== Render =====================
  function renderAll() { applyDeepLink(); renderKpis(); renderStatusList(); renderCenter(); renderDetail(); }

  // ?feature={id} 진입 — 해당 feature가 로드되어 있으면 선택하고 소비, 없으면 다음 렌더에서 재시도
  function applyDeepLink() {
    if (!pendingDeepLink) return;
    if (!features.get(pendingDeepLink)) return;
    state.selectedId = pendingDeepLink;
    pendingDeepLink = null;
  }

  function renderKpis() {
    const all = features.all();
    const c = (pred) => all.filter(pred).length;
    const kpis = [
      { val: all.length, lbl: '전체' },
      { val: c((f) => ['spec_draft', 'spec_changes_requested'].includes(f.status)), lbl: '작성중' },
      { val: c((f) => f.status === 'spec_in_review'), lbl: '검토중', cls: c((f) => f.status === 'spec_in_review') ? 'warn' : '' },
      { val: c((f) => f.status === 'spec_approved'), lbl: '승인됨' },
      { val: c((f) => f.status === 'pr_open'), lbl: 'PR 열림' },
      { val: c((f) => f.status === 'merged'), lbl: '머지됨' },
    ];
    $('#kpi-row').innerHTML = kpis.map((k) =>
      `<div class="kpi ${k.cls || ''}"><div class="val">${k.val}</div><div class="lbl">${k.lbl}</div></div>`).join('');
  }

  function renderStatusList() {
    const all = features.all();
    const counts = {};
    all.forEach((f) => { counts[f.status] = (counts[f.status] || 0) + 1; });
    const items = [{ id: 'all', name: '전체', count: all.length }].concat(
      (features.enums().status || []).map((s) => ({ id: s, name: STATUS_LABEL[s] || s, count: counts[s] || 0 })));
    $('#status-list').innerHTML = items.map((s) =>
      `<div class="mod-item ${state.status === s.id ? 'active' : ''}" data-st="${s.id}">
        <span>${esc(s.name)}</span><span class="count">${s.count}</span></div>`).join('');
    document.querySelectorAll('#status-list .mod-item').forEach((it) =>
      it.addEventListener('click', () => { state.status = it.dataset.st; renderAll(); }));
  }

  function renderCenter() {
    const data = filtered();
    const body = $('#center-body');
    if (!data.length) { body.innerHTML = `<div class="detail-empty">조건에 맞는 Feature가 없습니다.</div>`; return; }
    const head = `<tr><th>Feature</th><th>상태</th><th>버전</th><th>PR</th></tr>`;
    const rows = data.map((f) => {
      const sel = state.selectedId === f.featureId ? 'selected' : '';
      const pr = f.prNumber ? `<a href="${f.prUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()">#${f.prNumber}</a>` : '<span class="feat-sub">—</span>';
      return `<tr class="${sel}" data-id="${f.featureId}">
        <td><div class="feat-title">${esc(f.title)}</div><div class="feat-sub mono">${esc(f.slug)}</div></td>
        <td><div class="status-cell">${statusBadge(f.status)}${tbdBadge(f)}</div></td>
        <td class="mono">${esc(f.specVersion || '-')}</td>
        <td>${pr}</td></tr>`;
    }).join('');
    body.innerHTML = `<table class="feature-table"><thead>${head}</thead><tbody>${rows}</tbody></table>`;
    body.querySelectorAll('tr[data-id]').forEach((tr) =>
      tr.addEventListener('click', () => select(tr.dataset.id)));
  }

  function select(id) { state.selectedId = id; renderCenter(); renderDetail(); }

  // ---------- 작은 마크다운 렌더러 (문서 뷰어용) ----------
  function mdToHtml(src) {
    const e = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const inline = (s) => e(s)
      .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, '<img src="$2" alt="$1" loading="lazy" />')
      .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
    const isRow = (l) => /^\s*\|.*\|\s*$/.test(l);
    const isDiv = (l) => /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes('-');
    const cells = (l) => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
    const lines = String(src).replace(/\r\n/g, '\n').split('\n');
    let html = '', inList = false, inComment = false;
    const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // 템플릿 안내 주석(`<!-- 작업 필요: … -->`)은 여러 줄이라 블록으로 건너뛴다
      if (inComment) { if (/-->/.test(line)) inComment = false; continue; }
      if (/^\s*<!--/.test(line)) { if (!/-->/.test(line)) inComment = true; continue; }
      if (/^\s*---+\s*$/.test(line)) { closeList(); html += '<hr />'; continue; }
      if (isRow(line) && i + 1 < lines.length && isDiv(lines[i + 1])) {
        closeList(); const head = cells(line); let rows = []; i += 2;
        while (i < lines.length && isRow(lines[i]) && !isDiv(lines[i])) { rows.push(cells(lines[i])); i++; } i--;
        html += '<table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>'
          + rows.map((r) => '<tr>' + head.map((_, n) => `<td>${inline(r[n] || '')}</td>`).join('') + '</tr>').join('')
          + '</tbody></table>'; continue;
      }
      const h = line.match(/^(#{1,4})\s+(.*)/);
      if (h) { closeList(); html += `<h3>${inline(h[2])}</h3>`; continue; }
      if (/^\s*[-*]\s+/.test(line)) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`; continue; }
      if (!line.trim()) { closeList(); continue; }
      closeList(); html += `<p>${inline(line)}</p>`;
    }
    closeList(); return html;
  }

  // 리뷰 모드 상태 (디자이너가 spec_in_review spec에 코멘트 달 때)
  let reviewState = null; // { featureId, comments: [{section, body}] }

  function openDoc(f) {
    const body = f.specBody;
    // 검토중 = 결정(승인/반려) 모드, 반려됨 = 보충 코멘트(append) 모드
    const decisionMode = auth.isDesigner() && f.status === 'spec_in_review';
    const appendMode = auth.isDesigner() && f.status === 'spec_changes_requested';
    const reviewMode = decisionMode || appendMode;
    $('#doc-modal-title').textContent = `${f.title} · spec ${f.specVersion || ''}`;
    const bodyEl = $('#doc-modal-body');
    bodyEl.innerHTML = (body && body.trim()) ? mdToHtml(body) : '<div class="feat-sub">본문 없음.</div>';

    // 재검토: 직전 버전 대비 변경분 바로가기 (디자이너 리뷰 모드 · 버전 2개 이상)
    const vlog = f.versionLog || [];
    if (reviewMode && vlog.length >= 2) {
      const prev = vlog[vlog.length - 2], cur = vlog[vlog.length - 1];
      bodyEl.insertAdjacentHTML('afterbegin',
        `<div class="rereview-banner">🔍 지난 검토(${esc(prev.version)}) 이후 변경분이 있습니다.
         <button class="btn-ghost" id="rereview-diff">변경분 보기</button></div>`);
      $('#rereview-diff').addEventListener('click', () => openDiff(f, prev.version, cur.version));
    }

    const foot = $('#doc-foot'), hint = $('#doc-review-hint');
    if (reviewMode) {
      reviewState = { featureId: f.featureId, comments: [], mode: decisionMode ? 'decision' : 'append' };
      bodyEl.classList.add('review-mode');
      foot.classList.remove('hidden'); hint.classList.remove('hidden');
      $('#doc-msg').textContent = '';
      // 버튼 구성: 검토중 → 승인 + 반려 제출 / 반려됨 → 코멘트 추가만
      $('#doc-approve').classList.toggle('hidden', !decisionMode);
      $('#doc-reject').textContent = decisionMode ? '반려 제출' : '코멘트 추가';
      addReviewAnchors(bodyEl);
      updateReviewCount();
    } else {
      reviewState = null;
      bodyEl.classList.remove('review-mode');
      foot.classList.add('hidden'); hint.classList.add('hidden');
    }
    openModal('doc-modal');
  }

  // 각 제목 옆에 💬 코멘트 버튼 + 섹션 스레드를 붙인다 (Notion식)
  function addReviewAnchors(container) {
    container.querySelectorAll('h3').forEach((h) => {
      const section = h.textContent.trim();
      const btn = document.createElement('button');
      btn.className = 'cmt-add'; btn.type = 'button'; btn.textContent = '💬';
      btn.title = '이 섹션에 코멘트';
      h.appendChild(btn);
      const thread = document.createElement('div');
      thread.className = 'cmt-thread';
      h.insertAdjacentElement('afterend', thread);
      btn.addEventListener('click', () => toggleCmtInput(section, thread));
    });
  }

  function toggleCmtInput(section, thread) {
    // 이미 입력창이 있으면 제거하지 않고 재포커스 (추가 코멘트 계속 입력 가능)
    let row = thread.querySelector('.cmt-input');
    if (!row) {
      row = document.createElement('div');
      row.className = 'cmt-input';
      row.innerHTML = `<input type="text" placeholder="${esc(section)} 코멘트…" />
        <button class="btn-add" type="button">추가</button>`;
      thread.appendChild(row);
      const input = row.querySelector('input');
      const add = () => {
        const v = input.value.trim();
        if (!v) return;
        const c = { section, body: v };
        reviewState.comments.push(c);
        thread.insertBefore(makeBubble(c, thread), row); // 입력창은 그대로 두고 위에 쌓음
        input.value = '';
        updateReviewCount();
        input.focus(); // 연속 입력
      };
      row.querySelector('button').addEventListener('click', add);
      input.addEventListener('keydown', (e) => {
        // 한글 IME 조합 중 Enter는 글자 확정용이므로 무시 (중복/조각 입력 방지)
        if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        add();
      });
    }
    row.querySelector('input').focus();
  }

  function makeBubble(c, thread) {
    const bubble = document.createElement('div');
    bubble.className = 'cmt-bubble';
    bubble.innerHTML = `<span class="cmt-sec">${esc(c.section)}</span><span class="cmt-body">${esc(c.body)}</span>
      <button class="cmt-del" type="button" title="삭제">×</button>`;
    bubble.querySelector('.cmt-del').addEventListener('click', () => {
      const i = reviewState.comments.indexOf(c);
      if (i >= 0) reviewState.comments.splice(i, 1);
      bubble.remove();
      updateReviewCount();
    });
    return bubble;
  }

  function updateReviewCount() {
    const n = reviewState ? reviewState.comments.length : 0;
    $('#doc-review-count').textContent = `코멘트 ${n}`;
    $('#doc-reject').disabled = n === 0;
  }

  async function approveFromReview() {
    if (!reviewState) return;
    if (!confirm('이 spec을 승인합니다. 이후 개발자가 base 브랜치로 spec PR을 생성할 수 있습니다.')) return;
    $('#doc-msg').textContent = '처리 중…';
    const r = await features.approve(reviewState.featureId);
    if (!r.ok) { $('#doc-msg').textContent = r.error; return; }
    const id = reviewState.featureId;
    closeModal('doc-modal'); select(id); renderAll();
  }

  async function rejectFromReview() {
    if (!reviewState) return;
    if (!reviewState.comments.length) {
      $('#doc-msg').textContent = '코멘트가 1개 이상 필요합니다.'; return;
    }
    $('#doc-msg').textContent = '처리 중…';
    const r = reviewState.mode === 'append'
      ? await features.addComments(reviewState.featureId, reviewState.comments)   // 반려 후 보충 코멘트
      : await features.requestChanges(reviewState.featureId, reviewState.comments); // 검토중 반려
    if (!r.ok) { $('#doc-msg').textContent = r.error; return; }
    const id = reviewState.featureId;
    closeModal('doc-modal'); select(id); renderAll();
  }

  // ===================== Detail =====================
  function renderDetail() {
    const panel = $('#detail-panel');
    if (!state.selectedId) { panel.innerHTML = `<div class="detail-empty">왼쪽 목록에서 Feature를 선택하세요.</div>`; return; }
    const f = features.get(state.selectedId);
    if (!f) { panel.innerHTML = `<div class="detail-empty">없는 Feature.</div>`; return; }

    const isDev = auth.isDeveloper();
    const isDesigner = auth.isDesigner();

    panel.innerHTML = `
      <div class="detail-h">
        <div class="crumb mono">${esc(f.slug)} · ${esc(f.specVersion || '')}</div>
        <h2>${esc(f.title)}</h2>
        <div class="detail-badges">
          ${statusBadge(f.status)}
          ${f.prNumber ? badge('PR #' + f.prNumber, 'blue') : ''}
        </div>
      </div>
      ${stepperHtml(f)}
      ${actionsHtml(f, isDev, isDesigner)}
      <div class="detail-section">
        <h3>대상 브랜치</h3>
        ${f.baseBranch
          ? `<div class="kv"><span class="v mono">${esc(f.baseBranch)}</span></div>
             <div class="feat-sub">spec PR은 <span class="mono">${esc(specBranchOf(f.baseBranch))}</span> → 이 base 브랜치로 열립니다.</div>`
          : '<div class="feat-sub">미지정 — <code>spec 수정</code>에서 <code>/issue</code>로 만든 <code>…/base</code> 브랜치를 선택하세요.</div>'}
      </div>
      <div class="detail-section">
        <h3>출처 (Figma)</h3>
        ${figmaSourcesHtml(f)}
      </div>
      <div class="detail-section">
        <h3>문서</h3>
        <div class="doc-row">
          <button class="btn-primary" data-doc="spec">📄 spec 보기</button>
        </div>
        <div class="feat-sub" style="margin-top:6px">
          상태 ${esc(f.specStatus || '-')} · 기준 PRD ${esc(f.prdVersion || '-')} · 작성자 ${esc(userName(f.createdBy))}
        </div>
        ${draftNoticeHtml(f)}
      </div>
      ${versionHistoryHtml(f, isDev)}
      ${reviewsHtml(f)}`;

    // 문서 보기
    panel.querySelectorAll('button[data-doc]').forEach((b) => b.addEventListener('click', () => openDoc(f)));
    // 변경이력 사유 편집(개발자)
    panel.querySelectorAll('button[data-edit-ver]').forEach((b) =>
      b.addEventListener('click', () => editVersionReason(f, b.dataset.editVer, b.dataset.reason)));
    // 버전 변경분 diff
    panel.querySelectorAll('button[data-diff-from]').forEach((b) =>
      b.addEventListener('click', () => openDiff(f, b.dataset.diffFrom, b.dataset.diffTo)));
    // 액션 와이어링
    wireActions(panel, f);
  }

  // Figma 출처 — spec 본문의 링크 텍스트(`[002-4-1 …](url)`)를 라벨로 살려 인라인 나열.
  // 라벨을 못 찾으면 node-id, 그것도 없으면 URL 자체로 폴백.
  function figmaSourcesHtml(f) {
    const urls = f.figmaSources || [];
    if (!urls.length) return '<div class="feat-sub">없음</div>';
    const labels = new Map();
    if (f.specBody) SPEC.parseFigmaLinks(f.specBody).forEach((r) => labels.set(r.url, r.label));
    const html = urls.map((u) => {
      const label = labels.get(u) || nodeIdOf(u) || u;
      return `<li><a href="${esc(u)}" target="_blank" rel="noopener" title="${esc(u)}">${esc(label)}</a></li>`;
    }).join('');
    return `<ul class="figma-links">${html}</ul>`;
  }

  function nodeIdOf(url) {
    const m = /[?&]node-id=([^&#]+)/.exec(url);
    return m ? decodeURIComponent(m[1]) : '';
  }

  // 미완성 신호(DRAFT · [TBD] 잔여)를 상세에 노출 — 검수자가 "무엇을 확정해야 하는지" 바로 알게 한다.
  function draftNoticeHtml(f) {
    const tbd = tbdCount(f);
    const bits = [];
    if (f.specStatus && f.specStatus !== 'CREATED') bits.push('상태 <code>DRAFT</code>');
    if (tbd) bits.push(`미해소 <code>[TBD]</code> ${tbd}건`);
    if (!bits.length) return '';
    return `<div class="spec-draft-note">${bits.join(' · ')} — 검수에서 확정이 필요한 스펙입니다.</div>`;
  }

  // 분기 상태(반려됨 · PR 종료)는 제목 아래 상태 칩이 이미 표시하므로 스테퍼에서는 중복 표기하지 않는다.
  function stepperHtml(f) {
    const cur = STEP_INDEX[f.status];
    return `<div class="stepper">${STEPS.map((s, i) => {
      const cls = i < cur ? 'done' : (i === cur ? 'active' : '');
      return `<div class="step ${cls}"><span class="dot"></span><span class="slabel">${s.label}</span></div>`;
    }).join('<span class="sline"></span>')}</div>`;
  }

  // base 브랜치(`…/base`) → spec 작업 브랜치(`…/spec`). base-branch.md 권장 네이밍.
  const specBranchOf = (base) => String(base || '').replace(/\/base$/, '/spec');

  function actionsHtml(f, isDev, isDesigner) {
    const btns = [];
    // 개발자 액션
    if (isDev) {
      if (['spec_draft', 'spec_changes_requested'].includes(f.status)) {
        btns.push(`<button class="btn-ghost" data-act="edit-spec">spec 수정</button>`);
        btns.push(`<button class="btn-primary" data-act="request-review">컨펌 요청</button>`);
      } else if (f.status === 'spec_approved') {
        btns.push(`<button class="btn-ghost" data-act="edit-spec">spec 수정</button>`);
        btns.push(`<button class="btn-primary" data-act="create-pr">PR 생성</button>`);
      } else if (f.status === 'pr_open') {
        // spec 수정 시 무효화 연쇄(closeSpecPR로 PR 자동 close + spec_draft 복귀)
        btns.push(`<button class="btn-ghost" data-act="edit-spec">spec 수정</button>`);
        btns.push(`<a class="btn-primary" href="${f.prUrl}" target="_blank" rel="noopener">PR #${f.prNumber} 보기</a>`);
        // Webhook 시뮬레이션은 mock 전용 — firebase 는 실 웹훅(Admin)이 merged/closed 처리(보안규칙상 클라 전이 불가)
        if (!FB) {
          btns.push(`<button class="btn-ghost" data-act="sim-merged">[mock] merged</button>`);
          btns.push(`<button class="btn-ghost" data-act="sim-closed">[mock] closed</button>`);
        }
      } else if (f.status === 'merged') {
        // 머지된 스펙 수정 → MAJOR 무효화(코드 반영본 변경). 새 PR 라운드로 이어짐.
        btns.push(`<button class="btn-ghost" data-act="edit-spec">spec 수정</button>`);
        if (f.prUrl) btns.push(`<a class="btn-primary" href="${f.prUrl}" target="_blank" rel="noopener">PR #${f.prNumber} 보기</a>`);
      }
    }
    // 디자이너 액션 — 스펙 미리보기에서 코멘트 + 승인/반려
    if (isDesigner && f.status === 'spec_in_review') {
      btns.push(`<button class="btn-primary" data-act="review-spec">📝 스펙 검토</button>`);
    } else if (isDesigner && f.status === 'spec_changes_requested') {
      btns.push(`<button class="btn-ghost" data-act="review-spec">💬 코멘트 추가</button>`);
    }
    if (!btns.length) return '';
    return `<div class="detail-actions">${btns.join('')}</div>`;
  }

  function wireActions(panel, f) {
    const on = (act, fn) => { const b = panel.querySelector(`[data-act="${act}"]`); if (b) b.addEventListener('click', fn); };
    on('edit-spec', () => openUpload(f));
    on('request-review', () => doTransition(() => features.requestReview(f.featureId)));
    on('review-spec', () => openDoc(f));
    on('create-pr', () => {
      const head = specBranchOf(f.baseBranch);
      if (!confirm(`Team-MINO-Android 에 spec PR 을 생성합니다.\n\n  ${head}\n  → ${f.baseBranch}\n\n${FB ? '' : '(mock: 실제 PR 대신 stub 정보)'}`)) return;
      doTransition(() => features.createPr(f.featureId));
    });
    on('sim-merged', () => doTransition(() => features.syncFromWebhook(f.featureId, 'merged')));
    on('sim-closed', () => doTransition(() => features.syncFromWebhook(f.featureId, 'closed')));
  }

  async function doTransition(fn) {
    const r = await fn();
    if (!r.ok) {
      if (r.authIssue) return showAuthHelp(r.error); // GitHub 권한/토큰 문제 → 안내 모달
      alert(r.error || '실패'); return;
    }
    renderAll();
  }

  // GitHub 권한/토큰 실패 시 우아한 안내(재로그인·권한 확인)
  function showAuthHelp(msg) {
    const el = $('#auth-help-detail');
    if (el) el.textContent = msg || 'GitHub 권한이 없거나 연결이 만료됐습니다.';
    openModal('auth-help-modal');
  }

  function reviewsHtml(f) {
    if (!f.reviews || !f.reviews.length) return '';
    const TAG = { approved: badge('승인', 'green'), changes_requested: badge('반려', 'red'), comment: badge('코멘트', 'blue') };
    const items = f.reviews.slice().reverse().map((r) => {
      const tag = TAG[r.decision] || badge(r.decision, 'gray');
      const cs = (r.comments || []).map((c) => `<li><b>${esc(c.section || '전체')}</b> — ${esc(c.body)}</li>`).join('');
      return `<div class="review-item">${tag} <span class="feat-sub">${esc(userName(r.reviewerUid))} · ${esc(r.reviewedAt)}</span>
        ${cs ? `<ul class="review-comments">${cs}</ul>` : ''}</div>`;
    }).join('');
    return `<div class="detail-section"><h3>컨펌 이력</h3>${items}</div>`;
  }

  // 버전 스냅샷 — 버전 값은 `/mino-spec` 스킬 소유. 대시보드는 업로드 시점 본문만 보관하고
  // 등급(MAJOR/MINOR/PATCH) 뱃지는 직전 스냅샷과의 semver 비교로 파생한다.
  const VER_TAG = {
    init: badge('최초', 'gray'), patch: badge('PATCH', 'blue'),
    minor: badge('MINOR', 'amber'), major: badge('MAJOR', 'red'),
    same: badge('재업로드', 'gray'), unknown: badge('-', 'gray'),
  };
  function versionHistoryHtml(f, isDev) {
    let log = f.versionLog || [];
    // 스냅샷 도입 이전 스펙: 로그가 없으면 현재 버전을 표시 전용 한 줄로 폴백(편집 불가).
    const legacy = !log.length;
    if (legacy) log = [{ version: f.specVersion || '-', level: 'legacy', at: '', reason: '스냅샷 도입 이전 스펙' }];
    const items = log.map((e, idx) => ({ e, idx })).reverse().map(({ e, idx }) => {
      const prev = idx > 0 ? log[idx - 1] : null;
      const level = e.level || (prev ? V2.levelBetween(prev.version, e.version) : 'init');
      const tag = VER_TAG[level] || badge(level === 'legacy' ? '현재' : level, 'gray');
      const editBtn = (isDev && !legacy)
        ? `<button class="ver-edit" data-edit-ver="${esc(e.version)}" data-reason="${esc(e.reason || '')}" title="메모 편집">✏️</button>`
        : '';
      // 직전 버전과의 변경분 (첫 버전 제외)
      const diffBtn = (!legacy && prev)
        ? `<button class="ver-diff" data-diff-from="${esc(prev.version)}" data-diff-to="${esc(e.version)}">변경분</button>`
        : '';
      return `<div class="ver-item">
        <span class="ver-num mono">${esc(e.version)}</span> ${tag}
        <span class="feat-sub">${esc(e.at || '')}</span>${editBtn}${diffBtn}
        <div class="ver-reason">${esc(e.reason || '')}</div>
      </div>`;
    }).join('');
    return `<div class="detail-section">
      <h3>버전 스냅샷 <span class="feat-sub">(버전은 /mino-spec 소유)</span></h3>${items}</div>`;
  }

  // ── 버전 간 diff (재검토 변경분) ──
  function diffLineHtml(r) {
    const cls = r.t === '+' ? 'add' : r.t === '-' ? 'del' : 'same';
    const sign = r.t === '+' ? '+' : r.t === '-' ? '−' : ' ';
    return `<div class="diff-line ${cls}"><span class="diff-sign">${sign}</span><span>${esc(r.text) || ' '}</span></div>`;
  }
  function diffBodyHtml(rows) {
    const out = []; let i = 0;
    while (i < rows.length) {
      if (rows[i].t === '=') {
        let j = i; while (j < rows.length && rows[j].t === '=') j++;
        const run = rows.slice(i, j);
        if (run.length > 6) {
          run.slice(0, 2).forEach((r) => out.push(diffLineHtml(r)));
          out.push(`<div class="diff-gap">⋯ ${run.length - 4}줄 동일 ⋯</div>`);
          run.slice(-2).forEach((r) => out.push(diffLineHtml(r)));
        } else run.forEach((r) => out.push(diffLineHtml(r)));
        i = j;
      } else { out.push(diffLineHtml(rows[i])); i++; }
    }
    return out.join('');
  }
  function openDiff(f, fromVer, toVer) {
    const log = f.versionLog || [];
    const from = log.find((e) => e.version === fromVer);
    const to = log.find((e) => e.version === toVer);
    $('#diff-modal-title').textContent = `변경분 · ${fromVer} → ${toVer}`;
    const el = $('#diff-modal-body');
    if (!from || !to) {
      el.innerHTML = '<div class="feat-sub">버전을 찾을 수 없습니다.</div>';
    } else if (!from.body && !to.body) {
      el.innerHTML = '<div class="feat-sub">이 버전들에는 스냅샷이 없습니다(자동 버저닝 이전 생성). 이후 버전부터 변경분을 볼 수 있습니다.</div>';
    } else {
      const rows = V2.diffLines(from.body || '', to.body || '');
      const changed = rows.some((r) => r.t !== '=');
      el.innerHTML = changed
        ? `<div class="diff-legend"><span class="del">− ${esc(fromVer)}</span> <span class="add">+ ${esc(toVer)}</span></div>`
          + `<div class="diff-view">${diffBodyHtml(rows)}</div>`
        : '<div class="feat-sub">두 버전의 본문이 동일합니다(변경 이력 표 제외).</div>';
    }
    openModal('diff-modal');
  }

  async function editVersionReason(f, version, current) {
    const next = prompt(`버전 메모 (${version})`, current || '');
    if (next == null) return; // 취소
    const r = await features.editVersionReason(f.featureId, version, next.trim());
    if (!r.ok) { alert(r.error); return; }
    if (window.MASC.BACKEND === 'mock') renderAll();
  }

  // ===================== Upload (spec 붙여넣기 + 검증 + base 브랜치 선택) =====================
  let uploadCtx = null; // { featureId|null, baseBranch }
  function openUpload(f) {
    if (!auth.isDeveloper()) { alert('spec 업로드/수정은 개발자만 가능합니다.'); return; }
    uploadCtx = { featureId: f ? f.featureId : null, baseBranch: f ? (f.baseBranch || '') : '' };
    $('#upload-title').textContent = f ? `spec 수정 · ${f.title}` : '새 스펙 업로드';
    uploadMsg('', false);
    const body = f ? f.specBody : '';
    const placeholder = '# 스펙 명세서: 기능 이름\\n\\n**대상 스펙 경로**: `docs/specs/now-openchat`\\n\\n**상태**: CREATED\\n\\n**버전**: 1.0.0\\n\\n## 1. 유저 시나리오 …';
    $('#upload-body').innerHTML = `
      <div class="paste-help">
        <span>로컬 <code>/mino-spec</code> 산출물 <code>docs/specs/{feature}/spec.md</code> 전문을 붙여넣거나 파일을 드롭하세요.
        헤더 <code>**대상 스펙 경로**</code>에서 slug를, <code>**버전**</code>에서 버전을 읽습니다.
        <code>**상태**: DRAFT</code>이거나 <code>[TBD]</code>가 남아 있어도 업로드할 수 있습니다 — 경고만 표시되며,
        오히려 디자이너 검수가 필요한 상태입니다.</span>
      </div>
      <div class="upload-grid">
        <div class="upload-editor">
          <div id="up-errors" class="up-errors"></div>
          <label class="lbl">대상 base 브랜치 <span class="feat-sub">(/issue 가 만든 <code>…/base</code>)</span></label>
          <div class="base-branch-row">
            <select id="up-base" class="base-select"><option value="">불러오는 중…</option></select>
            <button class="btn-add" type="button" id="btn-base-reload" title="다시 조회">↻</button>
          </div>
          <div id="up-base-hint" class="feat-sub" style="margin-bottom:10px"></div>
          <div id="dropzone" class="dropzone">spec.md 파일을 여기로 drag-drop
            <input type="file" id="file-input" accept=".md" hidden />
            <button class="btn-add" type="button" id="btn-pick">파일 선택</button></div>
          <textarea id="up-spec" class="paste-area paste-tall" placeholder="${placeholder}">${esc(body)}</textarea>
        </div>
        <div class="upload-preview">
          <div class="lbl">미리보기</div>
          <div id="up-preview" class="md up-preview"></div>
        </div>
      </div>`;
    wireDropzone();
    $('#up-spec').addEventListener('input', schedulePreview);
    $('#up-base').addEventListener('change', () => {
      uploadCtx.baseBranch = $('#up-base').value;
      renderBaseHint();
    });
    $('#btn-base-reload').addEventListener('click', () => loadBaseBranches(true));
    renderPreview();
    loadBaseBranches(false);
    openModal('upload-modal');
  }

  // base 브랜치 목록 — GitHub API 조회(Functions). 실패해도 업로드 자체는 막지 않고 수기 입력 폴백.
  let baseBranchCache = null;
  async function loadBaseBranches(force) {
    const sel = $('#up-base'); if (!sel) return;
    if (force) baseBranchCache = null;
    if (!baseBranchCache) {
      sel.innerHTML = '<option value="">불러오는 중…</option>';
      const r = await features.listBaseBranches();
      if (!r.ok) {
        baseBranchCache = null;
        sel.innerHTML = '<option value="">조회 실패</option>';
        $('#up-base-hint').innerHTML =
          `⚠️ base 브랜치를 불러오지 못했습니다 — ${esc(r.error || '')} · ↻ 로 다시 시도하세요.`;
        return;
      }
      baseBranchCache = r.branches || [];
    }
    const cur = uploadCtx.baseBranch;
    // 저장된 브랜치가 목록에 없으면(이미 삭제됨) 선택지로 유지해 값이 날아가지 않게 한다
    const list = baseBranchCache.slice();
    if (cur && !list.some((b) => b.name === cur)) list.unshift({ name: cur, stale: true });
    sel.innerHTML = ['<option value="">— 선택 —</option>'].concat(list.map((b) =>
      `<option value="${esc(b.name)}"${b.name === cur ? ' selected' : ''}>${esc(b.name)}${b.stale ? ' (원격에 없음)' : ''}</option>`)).join('');
    if (!list.length) {
      $('#up-base-hint').innerHTML =
        '열린 <code>…/base</code> 브랜치가 없습니다 — Mino-Android 레포에서 <code>/issue</code>를 먼저 실행하세요.';
      return;
    }
    renderBaseHint();
  }
  function renderBaseHint() {
    const el = $('#up-base-hint'); if (!el) return;
    const b = uploadCtx.baseBranch;
    el.innerHTML = b
      ? `spec PR: <span class="mono">${esc(specBranchOf(b))}</span> → <span class="mono">${esc(b)}</span>`
      : 'base 브랜치를 선택해야 저장할 수 있습니다.';
  }

  // ── 라이브 마크다운 프리뷰 (업로드 모달) ──
  let previewTimer = null;
  function schedulePreview() { clearTimeout(previewTimer); previewTimer = setTimeout(renderPreview, 180); }
  function renderPreview() {
    const el = $('#up-preview'); if (!el) return;
    const body = ($('#up-spec') && $('#up-spec').value) || '';
    el.innerHTML = body.trim() ? mdToHtml(body) : '<div class="feat-sub">내용을 입력하면 여기에 렌더됩니다.</div>';
  }
  function wireDropzone() {
    const dz = $('#dropzone'); const fi = $('#file-input');
    $('#btn-pick').addEventListener('click', () => fi.click());
    fi.addEventListener('change', () => handleFiles(fi.files));
    ['dragover', 'dragenter'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
    dz.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));
  }
  function handleFiles(fileList) {
    Array.from(fileList || []).forEach((file) => {
      if (!/\.md$/i.test(file.name)) return;
      const reader = new FileReader();
      reader.onload = () => { $('#up-spec').value = reader.result; renderPreview(); };
      reader.readAsText(file);
    });
  }
  function uploadMsg(t, err = true) { const el = $('#upload-msg'); el.textContent = t; el.classList.toggle('error', err); }

  async function saveUpload() {
    const specBody = $('#up-spec').value || '';
    if (!specBody.trim()) return uploadMsg('붙여넣은 내용이 없습니다.');
    if (!uploadCtx.baseBranch) return uploadMsg('대상 base 브랜치를 선택하세요.');
    const res = V.validateSpec(specBody);
    const errBox = $('#up-errors');
    const warns = res.warnings || [];
    // 경고(DRAFT · [TBD])는 저장을 막지 않는다 — 미완성일수록 검수가 필요하다는 게 이 대시보드의 목적.
    const warnHtml = warns.length
      ? `<div class="up-warns"><div class="lbl">검수 필요 항목 ${warns.length}건 (업로드는 진행됩니다)</div>` +
        warns.map((w) => `<div class="up-warn"><span class="ecode">${w.code}</span> ${esc(w.msg)}</div>`).join('') + '</div>'
      : '';
    if (!res.ok) {
      errBox.innerHTML = '<div class="up-errors-box"><div class="lbl">구조 검증 실패</div>' +
        res.errors.map((e) => `<div class="up-err"><span class="ecode">${e.code}</span> ${esc(e.msg)}</div>`).join('') +
        '</div>' + warnHtml;
      uploadMsg(`검증 실패 ${res.errors.length}건 — 수정 후 다시 저장하세요.`);
      errBox.scrollIntoView({ block: 'nearest' }); // 모달이 스크롤돼 있어도 실패 사유가 보이게
      return;
    }
    errBox.innerHTML = warnHtml;
    uploadMsg(warns.length ? `경고 ${warns.length}건과 함께 저장 중…` : '저장 중…', false);
    const r = await features.saveSpec({
      featureId: uploadCtx.featureId, specBody, baseBranch: uploadCtx.baseBranch,
    });
    if (!r.ok) return uploadMsg(r.error || '저장 실패');
    closeModal('upload-modal');
    if (r.invalidated) {
      alert('승인된 spec을 수정해 무효화되었습니다 → 작성중으로 복귀하고 열린 PR은 종료됩니다.'
        + (r.versionStale ? '\n\n⚠️ 버전이 그대로입니다. 로컬 /mino-spec 개정으로 버전을 올린 뒤 다시 올리세요.' : ''));
    }
    select(r.feature.featureId); renderAll();
  }

  // ===================== Boot =====================
  if (FB) {
    renderGithubLogin();
    auth.onAuthChange((user) => { if (user) showApp(); else showLogin(); });
  } else {
    renderLoginUsers();
    if (auth.currentUser()) showApp(); else showLogin();
  }
})();
