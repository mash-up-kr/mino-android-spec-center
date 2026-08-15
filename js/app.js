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

  // `/mino-spec` 산출물 2종. 둘 다 업로드하고 둘 다 PR 에 실리지만,
  // **디자이너 검수 대상은 spec 하나뿐**이다 (체크리스트는 개발자 자가검증 결과).
  const DOC_KINDS = [
    {
      kind: 'spec', icon: '📄', label: 'spec.md', path: 'docs/specs/{slug}/spec.md',
      bodyKey: 'specBody', snapKey: 'body', hint: '디자이너 검수 대상',
    },
    {
      kind: 'checklist', icon: '📋', label: 'spec-checklist.md', path: 'quality/spec-checklist.md',
      bodyKey: 'checklistBody', snapKey: 'checklistBody', hint: '품질 검증 결과 · 검수 대상 아님',
    },
  ];

  const state = { status: 'all', quick: new Set(), search: '', selectedId: null };
  // Discord 알림 딥링크 — ?feature={id}(notifications.md §4) · ?prd=1(P8 알림)
  const qs = new URLSearchParams(location.search);
  let pendingDeepLink = qs.get('feature');
  let pendingPrdLink = qs.has('prd');
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
    $('#btn-prd').addEventListener('click', () => openPrd());
    $('#prd-upload-save').addEventListener('click', savePrdUpload);
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
          <code>docs/specs/{feature}/spec.md</code> + <code>quality/spec-checklist.md</code> 산출.
          상태가 <code>DRAFT</code>이거나 <code>[TBD]</code>가 남아 있어도 업로드할 수 있습니다
          (경고만 표시 — 검수로 확정할 항목)</li>
        <li><b>업로드</b> — 산출된 <b>두 파일을 그대로 첨부</b> ([+ 새 스펙 업로드]) →
          구조 검증(spec S1–S6 · 체크리스트 C1–C7) → base 브랜치 선택 → 디자이너 컨펌.
          <b>검수 대상은 spec.md 뿐</b>이고 체크리스트는 참고 자료로 함께 보관됩니다</li>
        <li><b>PR</b> — 승인되면 <code>PR 생성</code>으로 <code>…/spec</code> 브랜치를 만들어
          <b>spec.md와 체크리스트를 함께</b> 커밋하고 base 브랜치로 PR</li>
        <li><b>이후 단계</b> — <code>/mino-plan</code>·<code>/mino-task</code>는 대시보드를 거치지 않고
          같은 base 브랜치 아래 하위 작업으로 진행합니다</li>
      </ol>
      <div class="legend-note">대시보드는 입력값 치환을 하지 않습니다 — 문서를 만들지도 고치지도 않고
        파일을 그대로 받습니다. 스킬 실행 시 직접 Figma URL·기획서를 전달하세요.</div>`;
  }

  // ===================== 역할별 사용법 =====================
  const ROLE_GUIDE = {
    developer: {
      intro: `개발자는 스펙을 <b>작성·업로드</b>하고, 디자이너 컨펌을 거쳐 <b>spec PR까지 배출</b>하는 주체입니다.
        문서 생성은 대시보드가 아니라 로컬 Claude Code 스킬(<code>스킬 안내</code> 참고)로 합니다.`,
      steps: [
        `<b>이슈·base 브랜치</b> — Mino-Android 레포에서 <code>git pull</code> → <code>/issue</code>로 이슈와 <code>&lt;prefix&gt;/&lt;이슈번호&gt;-&lt;slug&gt;/base</code> 브랜치 생성`,
        `<b>스펙 작성 (로컬)</b> — <code>/mino-spec</code>으로 <code>docs/specs/{feature}/spec.md</code>와 <code>quality/spec-checklist.md</code> 생성. 헤더 <code>상태: DRAFT</code>거나 <code>[TBD]</code>가 남아 있어도 업로드 가능 — 확정이 필요한 항목일수록 검수에 올리세요`,
        `<b>업로드 + 검증</b> — <code>+ 새 스펙 업로드</code>에 <b>두 파일을 함께 첨부</b>(드롭하면 자동 분류) → <b>base 브랜치 선택</b> → spec S1–S6 · 체크리스트 C1–C7 구조 검증 통과 시 <code>spec_draft</code> 생성 (DRAFT·<code>[TBD]</code>·체크리스트 <code>FAILED</code>는 경고로만 표시되고 저장은 진행됨. 버전은 헤더 <code>**버전**</code> 값을 그대로 사용)`,
        `<b>컨펌 요청</b> — 상세에서 <code>컨펌 요청</code> → <code>spec_in_review</code> 전환 + spec이 read-only로 잠김`,
        `<b>반려 반영 → 재요청</b> — 반려(<code>spec_changes_requested</code>) 시 로컬에서 <code>/mino-spec</code>으로 개정(버전 bump는 스킬이 판정) → <code>spec 수정</code>으로 재업로드 후 <code>컨펌 요청</code>`,
        `<b>PR 생성</b> — 승인(<code>spec_approved</code>)되면 <code>PR 생성</code> → <code>&lt;prefix&gt;/&lt;이슈번호&gt;-&lt;slug&gt;/spec</code> 브랜치에 <code>docs/specs/{slug}/spec.md</code> + <code>docs/specs/{slug}/quality/spec-checklist.md</code> 커밋 → <b>base 브랜치로 PR</b> → <code>pr_open</code>`,
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
        `<b>스펙 검토</b> — 상세의 <code>📝 스펙 검토</code>로 리뷰 모드 열기. 유저 플로우의 <b>Figma 링크</b>로 원본과 대조하고, 제목 옆 <b>💬</b>로 플로우·요구사항에 인라인 코멘트. <b>검수 대상은 spec.md 하나</b>이고, 함께 올라온 <code>📋 체크리스트 보기</code>는 개발자 자가검증 결과라 읽기 전용 참고 자료입니다`,
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
  function renderAll() { applyDeepLink(); renderPrdChip(); renderKpis(); renderStatusList(); renderCenter(); renderDetail(); }

  // ?feature={id} 진입 — 해당 feature가 로드되어 있으면 선택하고 소비, 없으면 다음 렌더에서 재시도
  function applyDeepLink() {
    // ?prd= 는 PRD 모달을 연다 (데이터가 아직 없으면 다음 렌더에서 재시도)
    if (pendingPrdLink && prdDoc()) { pendingPrdLink = false; openPrd('doc'); }
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
        <td><div class="status-cell">${statusBadge(f.status)}${tbdBadge(f)}${compatBadge(f)}</div></td>
        <td class="mono">${esc(f.specVersion || '-')}</td>
        <td>${pr}</td></tr>`;
    }).join('');
    body.innerHTML = `<table class="feature-table"><thead>${head}</thead><tbody>${rows}</tbody></table>`;
    body.querySelectorAll('tr[data-id]').forEach((tr) =>
      tr.addEventListener('click', () => select(tr.dataset.id)));
  }

  function select(id) { state.selectedId = id; renderCenter(); renderDetail(); }

  // ---------- 마크다운 렌더러 (문서 뷰어·업로드 프리뷰 공용) ----------
  // 목표는 GitHub·IDE 의 마크다운 프리뷰와 같은 그림이다. 원문의 HTML 태그는 escape 한다 —
  // 업로드 본문은 남이 만든 파일이라 태그가 살아나면 안 된다. 예외는 `<!-- -->` 주석으로,
  // 프리뷰에서도 보이지 않으므로 블록째 건너뛴다(템플릿 안내문 제거를 겸한다).

  // 섹션 앵커용 — 제목은 h1~h6 이 모두 나온다(예전 렌더러는 전부 h3 였다)
  const MD_HEADS = 'h1, h2, h3, h4, h5, h6';
  // 저장된 코멘트의 anchor 는 그때의 렌더 결과라, 렌더러가 바뀌어도 섹션을 잃지 않게 마커를 털고 비교한다
  const sameSection = (a, b) => {
    const key = (s) => String(s == null ? '' : s).replace(/[*_~`#]/g, '').replace(/\s+/g, ' ').trim();
    return !!a && !!b && key(a) === key(b);
  };

  const MD_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
  // 문단이 끊기는 자리 — 제목·인용·펜스·목록·구분선·주석
  const MD_BREAK = /^ {0,3}(#{1,6}\s|>|`{3,}|~{3,}|<!--|([-*+]|\d{1,9}[.)])\s|([-*_])\s*(\3\s*){2,}\s*$)/;
  const MD_SETEXT = /^ {0,3}(=+|-+)\s*$/;   // 윗줄 문단을 제목으로 올리는 밑줄
  // 링크 목적지 — 괄호 한 겹까지 품는다 (…/wiki/Foo_(bar) 같은 URL)
  const MD_IMG = /!\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)[^)]*\)/g;
  const MD_LINK = /\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)[^)]*\)/g;
  const mdIndent = (l) => l.replace(/\t/g, '    ').match(/^ */)[0].length;
  const mdOrdered = (l) => { const m = MD_ITEM.exec(l); return !!m && /\d/.test(m[2]); };
  const mdRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  const mdDiv = (l) => /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes('-');
  const mdCells = (l) => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
  const mdEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // `javascript:` 처럼 실행되는 스킴은 링크로 만들지 않는다 (입력은 남이 올린 문서다)
  const mdUrl = (u) => {
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(u);
    return !scheme || /^(https?|mailto)$/i.test(scheme[1]) ? u : '#';
  };

  function mdInline(src) {
    const hold = [];
    const keep = (html) => `\u0000${hold.push(html) - 1}\u0000`;
    // 1) 코드 스팬 — 안쪽은 어떤 치환도 받으면 안 되므로 escape 전에 먼저 빼 둔다
    let s = String(src).replace(/(`+)([^`]+)\1(?!`)/g, (m, t, code) =>
      keep(`<code>${mdEsc(code.replace(/^ (.*) $/, '$1'))}</code>`));
    s = mdEsc(s);
    // 2) 이미지·링크. 링크는 여는 태그만 빼 두고 텍스트는 스트림에 남긴다(안쪽 강조가 살아난다)
    s = s.replace(MD_IMG, (m, alt, url) =>
      keep(`<img src="${mdUrl(url)}" alt="${alt}" loading="lazy" />`));
    s = s.replace(MD_LINK, (m, text, url) =>
      keep(`<a href="${mdUrl(url)}" target="_blank" rel="noopener">`) + text + '</a>');
    // 3) 맨 URL 자동 링크 — 위에서 만든 링크의 href 는 빠져 있어 두 번 걸리지 않는다
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]*[^\s<).,;:!?])/g, (m, pre, url) =>
      pre + keep(`<a href="${url}" target="_blank" rel="noopener">${url}</a>`));
    // 4) 강조. `_` 는 단어 안(spec_in_review)에서 기울이면 안 되므로 경계를 함께 본다
    s = s
      .replace(/\*\*\*([^*]+)\*\*\*/g, '<b><i>$1</i></b>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^\w*])\*([^\s*][^*]*?)\*(?!\w)/g, '$1<i>$2</i>')
      .replace(/(^|[\s([{'‘])__([^_]+)__(?=$|[\s).,!?:;\]}'’])/g, '$1<b>$2</b>')
      .replace(/(^|[\s([{'‘])_([^\s_][^_]*?)_(?=$|[\s).,!?:;\]}'’])/g, '$1<i>$2</i>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>');
    // 5) 줄 끝 공백 2개(또는 `\`)만 강제 줄바꿈. 그 외 이어지는 줄은 프리뷰처럼 한 문단으로 합친다
    s = s.replace(/(?: {2,}|\\)\n/g, '<br />').replace(/\n/g, ' ');
    return s.replace(/\u0000(\d+)\u0000/g, (m, n) => hold[+n]);
  }

  function mdToHtml(src) {
    // 들여쓰기 탭은 프리뷰와 같이 4칸으로 편다 — 블록 판정이 공백 기준이다
    return mdBlocks(String(src).replace(/\r\n?/g, '\n').split('\n')
      .map((l) => l.replace(/^[ \t]+/, (w) => w.replace(/\t/g, '    '))));
  }

  function mdBlocks(lines) {
    let html = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      if (/^\s*<!--/.test(line)) { while (i < lines.length && !/-->/.test(lines[i])) i++; continue; }

      // 코드 블록 — 안쪽은 원문 그대로 (마크다운 문법이 살아나면 안 된다)
      const fence = /^ {0,3}(`{3,}|~{3,})\s*(.*)$/.exec(line);
      if (fence) {
        const close = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}\\s*$`);
        const body = [];
        while (++i < lines.length && !close.test(lines[i])) body.push(lines[i]);
        const lang = fence[2].trim().split(/\s+/)[0];
        html += `<pre><code${lang ? ` class="lang-${mdEsc(lang)}"` : ''}>${mdEsc(body.join('\n'))}</code></pre>`;
        continue;
      }
      if (/^ {0,3}([-*_])\s*(\1\s*){2,}\s*$/.test(line)) { html += '<hr />'; continue; }

      const h = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (h) { html += `<h${h[1].length}>${mdInline(h[2])}</h${h[1].length}>`; continue; }

      // 인용 — 안쪽을 다시 블록으로 파싱한다(인용 안의 표·목록도 프리뷰처럼 산다)
      if (/^ {0,3}>/.test(line)) {
        const quote = [];
        while (i < lines.length && lines[i].trim()
          && (/^ {0,3}>/.test(lines[i]) || !MD_BREAK.test(lines[i]))) {
          quote.push(lines[i].replace(/^ {0,3}>[ \t]?/, '')); i++;
        }
        i--;
        html += `<blockquote>${mdBlocks(quote)}</blockquote>`;
        continue;
      }

      // 표 — 구분선 행의 `:` 로 정렬까지 읽는다
      if (mdRow(line) && mdDiv(lines[i + 1] || '')) {
        const head = mdCells(line);
        const align = mdCells(lines[i + 1]).map((c) =>
          /^:.*:$/.test(c) ? ' style="text-align:center"' : /:$/.test(c) ? ' style="text-align:right"' : '');
        const rows = [];
        i += 2;
        while (i < lines.length && mdRow(lines[i]) && !mdDiv(lines[i])) { rows.push(mdCells(lines[i])); i++; }
        i--;
        html += '<table><thead><tr>'
          + head.map((c, n) => `<th${align[n] || ''}>${mdInline(c)}</th>`).join('')
          + '</tr></thead><tbody>'
          + rows.map((r) => '<tr>' + head.map((_, n) => `<td${align[n] || ''}>${mdInline(r[n] || '')}</td>`).join('') + '</tr>').join('')
          + '</tbody></table>';
        continue;
      }

      // 목록 — 항목 줄 + 그보다 깊게 들여쓴 이어짐 줄을 한 블록으로 모아 재귀 파싱한다
      if (MD_ITEM.test(line)) {
        const base = mdIndent(line);
        const ordered = mdOrdered(line);
        // 같은 높이에서 글머리 종류가 바뀌면(`-` ↔ `1.`) 프리뷰처럼 별개의 목록으로 끊는다
        const sameKind = (l) => mdIndent(l) > base || mdOrdered(l) === ordered;
        const block = [];
        while (i < lines.length) {
          const cur = lines[i];
          if (!cur.trim()) {
            const nx = lines[i + 1] || '';
            if (!nx.trim() || (mdIndent(nx) <= base && !MD_ITEM.test(nx)) || !sameKind(nx)) break;   // 목록 끝
            block.push(''); i++; continue;
          }
          if (block.length && ((!MD_ITEM.test(cur) && mdIndent(cur) <= base) || !sameKind(cur))) break;
          block.push(cur); i++;
        }
        i--;
        html += mdList(block, base);
        continue;
      }

      // 문단 — 이어지는 줄은 프리뷰와 같이 한 문단으로 합친다
      const para = [];
      while (i < lines.length && lines[i].trim() && !MD_BREAK.test(lines[i])
        && !(mdRow(lines[i]) && mdDiv(lines[i + 1] || ''))
        && !(para.length && MD_SETEXT.test(lines[i]))) { para.push(lines[i]); i++; }
      // 위 어느 블록도 아닌데 문단으로도 안 걸리는 줄 — 한 줄 문단으로 흘려보낸다(무한 루프 방지)
      if (!para.length) { html += `<p>${mdInline(line)}</p>`; continue; }
      // setext 제목 (`제목` 다음 줄이 `===` / `---`)
      const setext = MD_SETEXT.exec(lines[i] || '');
      if (setext) {
        const n = setext[1][0] === '=' ? 1 : 2;
        html += `<h${n}>${mdInline(para.join('\n'))}</h${n}>`;
        continue;
      }
      i--;
      html += `<p>${mdInline(para.join('\n'))}</p>`;
    }
    return html;
  }

  function mdList(block, base) {
    const first = MD_ITEM.exec(block[0]);
    const ordered = /\d/.test(first[2]);
    const items = [];
    let cur = null, loose = false, blanks = 0;
    for (const raw of block) {
      const m = MD_ITEM.exec(raw);
      if (m && mdIndent(raw) <= base) {
        if (cur && blanks) loose = true;
        const task = /^\[([ xX])\]\s+/.exec(m[3]);
        cur = {
          lines: [task ? m[3].slice(task[0].length) : m[3]],
          pad: m[1].length + m[2].length + 1,
          task: task ? task[1] !== ' ' : null,
        };
        items.push(cur); blanks = 0; continue;
      }
      if (!cur) continue;
      if (!raw.trim()) { blanks++; cur.lines.push(''); continue; }
      blanks = 0;
      cur.lines.push(raw.replace(new RegExp(`^ {0,${cur.pad}}`), ''));
    }
    const start = ordered ? +first[2].replace(/\D/g, '') : 0;
    const tag = ordered ? 'ol' : 'ul';
    const open = ordered && start !== 1 ? `<ol start="${start}">` : `<${tag}>`;
    return open + items.map((it) => {
      let inner = mdBlocks(it.lines);
      if (!loose) inner = inner.replace(/^<p>([\s\S]*?)<\/p>/, '$1');   // 촘촘한 목록은 <p> 를 벗긴다
      // 체크박스 목록 — 프리뷰처럼 실제 체크박스로 (문서는 읽기 전용이라 disabled)
      if (it.task !== null) {
        return `<li class="task"><input type="checkbox" disabled${it.task ? ' checked' : ''} /> ${inner}</li>`;
      }
      return `<li>${inner}</li>`;
    }).join('') + `</${tag}>`;
  }

  // ---------- 문서 다운로드 ----------
  // 업로드 본문은 Storage 가 아니라 Firestore 필드에 **마크다운 원문 그대로** 들어 있다.
  // 화면이 이미 들고 있는 문자열을 그대로 파일로 내보내면 되므로 서버를 거치지 않는다.

  // 윈도우·macOS 양쪽에서 안전한 파일명으로 — slug 에 이미 공백/특수문자가 섞여 들어온다
  const fileSafe = (s) => String(s == null ? '' : s)
    .replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '');

  // 받는 쪽이 어느 기능·어느 버전인지 알아보게 slug·버전을 접두로 붙인다.
  // 뒷부분은 레포에 커밋되는 실제 파일명(DOC_KINDS.path)을 그대로 쓴다.
  const docFileName = (f, kind, version) => [
    fileSafe(f.slug || f.featureId),
    fileSafe(version || f.specVersion),
    kind === 'checklist' ? 'spec-checklist' : 'spec',
  ].filter(Boolean).join('_') + '.md';

  const prdFileName = (version) => ['prd', fileSafe(version)].filter(Boolean).join('_') + '.md';

  function downloadText(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // 저장이 시작되기 전에 URL 을 회수하면 빈 파일이 떨어진다 — 넉넉히 두고 푼다
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  /**
   * 문서 여러 개를 한 번에 저장 (spec + 체크리스트). 내용이 있는 것만 내려간다.
   * 브라우저는 연속 저장을 "여러 파일 다운로드" 로 묶어 한 번 확인을 받으므로 사이를 조금 띄운다.
   */
  function downloadDocs(f, docs) {
    docs.filter((d) => d.body && d.body.trim()).forEach((d, i) => {
      const go = () => downloadText(docFileName(f, d.kind, d.version), d.body);
      if (i === 0) go(); else setTimeout(go, 350 * i);
    });
  }

  // 리뷰 모드 상태 (디자이너가 spec_in_review spec에 코멘트 달 때)
  let reviewState = null; // { featureId, comments: [{section, body}] }

  // kind: 'spec' | 'checklist'. 디자이너 컨펌 게이트는 **spec 전용** —
  // 품질 체크리스트는 개발자 자가검증 산출물이라 코멘트·승인/반려 없이 읽기만 한다.
  function openDoc(f, kind) {
    const isChecklist = kind === 'checklist';
    const body = isChecklist ? f.checklistBody : f.specBody;
    // 검토중 = 결정(승인/반려) 모드, 반려됨 = 보충 코멘트(append) 모드
    const decisionMode = !isChecklist && auth.isDesigner() && f.status === 'spec_in_review';
    const appendMode = !isChecklist && auth.isDesigner() && f.status === 'spec_changes_requested';
    const reviewMode = decisionMode || appendMode;
    $('#doc-modal-title').textContent = isChecklist
      ? `${f.title} · 품질 체크리스트`
      : `${f.title} · spec ${f.specVersion || ''}`;
    const bodyEl = $('#doc-modal-body');
    bodyEl.innerHTML = (body && body.trim()) ? mdToHtml(body) : '<div class="feat-sub">본문 없음.</div>';

    // 다운로드 — 버튼이 모달에 고정돼 있어(매번 새로 그리지 않는다) 핸들러는 덮어쓴다
    const dl = $('#doc-download');
    dl.disabled = !(body && body.trim());
    dl.onclick = () => downloadText(docFileName(f, kind), body || '');

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
    container.querySelectorAll(MD_HEADS).forEach((h) => {
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
          <button class="btn-ghost" data-doc="checklist"${f.checklistBody ? '' : ' disabled'}>📋 체크리스트 보기</button>
          <button class="btn-ghost" data-dl="docs"${f.specBody ? '' : ' disabled'}
            title="spec·체크리스트를 .md 파일로 저장">⬇ 문서 받기</button>
        </div>
        <div class="feat-sub" style="margin-top:6px">
          상태 ${esc(f.specStatus || '-')} · 작성자 ${esc(userName(f.createdBy))}
        </div>
        <div class="prd-line">
          기준 PRD <span class="mono">${esc(f.prdVersion || '없음')}</span>
          ${compatBadge(f, true)}
          <button class="btn-link" data-act="open-prd">PRD 보기</button>
        </div>
        ${checklistNoticeHtml(f)}
        ${draftNoticeHtml(f)}
      </div>
      ${versionHistoryHtml(f, isDev)}
      ${reviewsHtml(f)}`;

    // 문서 보기 — spec 은 (역할·상태에 따라) 리뷰 모드, 체크리스트는 항상 읽기 전용
    panel.querySelectorAll('button[data-doc]').forEach((b) =>
      b.addEventListener('click', () => openDoc(f, b.dataset.doc)));
    // 문서 다운로드 — 최신 spec + 체크리스트를 한 번에 (있는 것만)
    panel.querySelectorAll('button[data-dl]').forEach((b) =>
      b.addEventListener('click', () => downloadDocs(f, [
        { kind: 'spec', body: f.specBody },
        { kind: 'checklist', body: f.checklistBody },
      ])));
    // 과거 버전 다운로드 — 그 시점의 스냅샷 (versionLog 가 본문을 함께 보관한다)
    panel.querySelectorAll('button[data-dl-ver]').forEach((b) =>
      b.addEventListener('click', () => {
        const snap = (f.versionLog || []).find((e) => e.version === b.dataset.dlVer);
        if (!snap) return;
        downloadDocs(f, [
          { kind: 'spec', body: snap.body, version: snap.version },
          { kind: 'checklist', body: snap.checklistBody, version: snap.version },
        ]);
      }));
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

  // 품질 체크리스트 요약 — `/mino-spec` 의 1차 방어선 결과. 검수 대상은 아니지만 판단 재료로 노출한다.
  function checklistNoticeHtml(f) {
    if (!f.checklistBody) {
      return `<div class="spec-draft-note">품질 체크리스트 없음 — <code>spec 수정</code>에서
        <code>quality/spec-checklist.md</code> 를 함께 첨부하세요.</div>`;
    }
    const c = SPEC.parseChecklistMeta(f.checklistBody);
    const st = c.status === 'PASS'
      ? badge('체크리스트 PASS', 'green', '로컬 /mino-spec 품질 검증 통과')
      : badge(`체크리스트 ${c.status || '-'}`, 'amber', '품질 검증을 통과하지 못한 스펙입니다');
    const ver = c.targetVersion ? ` · 대상 ${esc(c.targetVersion)}` : '';
    return `<div class="checklist-line">${st}
      <span class="feat-sub">${c.checked}/${c.total} 통과${ver}</span></div>`;
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
    on('open-prd', () => openPrd('doc'));
    on('request-review', () => {
      // 게이트는 걸지 않는다 — PRD 가 뒤처졌다는 사실만 알리고 진행 여부는 개발자가 정한다.
      const c = compatOf(f);
      if (c.level === 'major' && !confirm(
        `${c.hint}\n\n그대로 검수에 올릴까요?`)) return;
      doTransition(() => features.requestReview(f.featureId));
    });
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
      // 스냅샷이 있는 버전만 — 자동 버저닝 이전 항목은 본문을 갖고 있지 않다
      const dlBtn = (!legacy && (e.body || e.checklistBody))
        ? `<button class="ver-diff" data-dl-ver="${esc(e.version)}" title="이 버전의 문서 받기">⬇</button>`
        : '';
      return `<div class="ver-item">
        <span class="ver-num mono">${esc(e.version)}</span> ${tag}
        <span class="feat-sub">${esc(e.at || '')}</span>${editBtn}${diffBtn}${dlBtn}
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
  // 스냅샷은 spec 본문과 체크리스트를 함께 담으므로 문서별로 변경분을 나눠 본다.
  let diffCtx = null; // { f, fromVer, toVer, tab: 'spec'|'checklist' }
  function openDiff(f, fromVer, toVer) {
    diffCtx = { f, fromVer, toVer, tab: 'spec' };
    $('#diff-modal-title').textContent = `변경분 · ${fromVer} → ${toVer}`;
    renderDiff();
    openModal('diff-modal');
  }
  function renderDiff() {
    const { f, fromVer, toVer, tab } = diffCtx;
    const log = f.versionLog || [];
    const from = log.find((e) => e.version === fromVer);
    const to = log.find((e) => e.version === toVer);
    const el = $('#diff-modal-body');
    const key = tab === 'checklist' ? 'checklistBody' : 'body';
    const has = (e, k) => !!(e && e[k]);
    const tabs = DOC_KINDS.map((d) => {
      const enabled = has(from, d.snapKey) || has(to, d.snapKey);
      return `<button class="doc-tab ${tab === d.kind ? 'active' : ''}" data-difftab="${d.kind}"${enabled ? '' : ' disabled'}>${d.icon} ${esc(d.label)}</button>`;
    }).join('');
    let inner;
    if (!from || !to) {
      inner = '<div class="feat-sub">버전을 찾을 수 없습니다.</div>';
    } else if (!from[key] && !to[key]) {
      inner = tab === 'checklist'
        ? '<div class="feat-sub">이 버전들에는 체크리스트 스냅샷이 없습니다(체크리스트 업로드 도입 이전 생성).</div>'
        : '<div class="feat-sub">이 버전들에는 스냅샷이 없습니다(자동 버저닝 이전 생성). 이후 버전부터 변경분을 볼 수 있습니다.</div>';
    } else {
      const rows = V2.diffLines(from[key] || '', to[key] || '');
      inner = rows.some((r) => r.t !== '=')
        ? `<div class="diff-legend"><span class="del">− ${esc(fromVer)}</span> <span class="add">+ ${esc(toVer)}</span></div>`
          + `<div class="diff-view">${diffBodyHtml(rows)}</div>`
        : '<div class="feat-sub">두 버전의 본문이 동일합니다.</div>';
    }
    el.innerHTML = `<div class="doc-tabs">${tabs}</div>${inner}`;
    el.querySelectorAll('[data-difftab]').forEach((b) =>
      b.addEventListener('click', () => { diffCtx.tab = b.dataset.difftab; renderDiff(); }));
  }

  async function editVersionReason(f, version, current) {
    const next = prompt(`버전 메모 (${version})`, current || '');
    if (next == null) return; // 취소
    const r = await features.editVersionReason(f.featureId, version, next.trim());
    if (!r.ok) { alert(r.error); return; }
    if (window.MASC.BACKEND === 'mock') renderAll();
  }

  // ===================== Upload (문서 2종 첨부 + 검증 + base 브랜치 선택) =====================
  // 붙여넣기 편집창은 폐기했다 — 문서를 만드는 것도 고치는 것도 로컬 `/mino-spec` 의 일이고,
  // 대시보드는 그 산출물 파일을 그대로 받아 검증·검수·PR 로 흘려보내기만 한다.
  let uploadCtx = null; // { featureId|null, baseBranch, specBody, checklistBody, names, kept }
  let previewTab = 'spec';
  let pickTarget = null; // 슬롯의 [파일 선택] 이 지정한 대상 (null = 파일명·본문으로 자동 판별)

  function openUpload(f) {
    if (!auth.isDeveloper()) { alert('spec 업로드/수정은 개발자만 가능합니다.'); return; }
    uploadCtx = {
      featureId: f ? f.featureId : null,
      baseBranch: f ? (f.baseBranch || '') : '',
      specBody: f ? (f.specBody || '') : '',
      checklistBody: f ? (f.checklistBody || '') : '',
      names: {},                                          // 이번에 첨부한 파일명
      kept: { spec: !!(f && f.specBody), checklist: !!(f && f.checklistBody) }, // 기존 문서 유지 여부
    };
    previewTab = 'spec';
    pickTarget = null;
    $('#upload-title').textContent = f ? `spec 수정 · ${f.title}` : '새 스펙 업로드';
    uploadMsg('', false);
    $('#upload-body').innerHTML = `
      <div class="paste-help">
        <span>로컬 <code>/mino-spec</code> 산출물 <b>2개를 모두</b> 첨부하세요 —
        <code>docs/specs/{feature}/spec.md</code> 와 <code>quality/spec-checklist.md</code>.
        spec 헤더 <code>**대상 스펙 경로**</code>에서 slug를, <code>**버전**</code>에서 버전을 읽습니다.
        <code>**상태**: DRAFT</code>·<code>[TBD]</code> 잔여·체크리스트 <code>FAILED</code> 여도 업로드할 수 있습니다 —
        경고만 표시되며, 오히려 디자이너 검수가 필요한 상태입니다.</span>
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
          <div id="dropzone" class="dropzone">두 파일을 여기로 drag-drop (한 번에 선택 가능)
            <input type="file" id="file-input" accept=".md" multiple hidden />
            <button class="btn-add" type="button" id="btn-pick">파일 선택</button></div>
          <div class="up-slots" id="up-slots"></div>
        </div>
        <div class="upload-preview">
          <div class="preview-head">
            <div class="lbl">미리보기</div>
            <div class="doc-tabs" id="up-tabs"></div>
          </div>
          <div id="up-preview" class="md up-preview"></div>
        </div>
      </div>`;
    wireDropzone();
    $('#up-base').addEventListener('change', () => {
      uploadCtx.baseBranch = $('#up-base').value;
      renderBaseHint();
    });
    $('#btn-base-reload').addEventListener('click', () => loadBaseBranches(true));
    renderSlots(); renderTabs(); renderPreview();
    loadBaseBranches(false);
    openModal('upload-modal');
  }

  // ── 첨부 슬롯 ──
  const bodyOf = (kind) => uploadCtx[kind === 'spec' ? 'specBody' : 'checklistBody'] || '';

  // 첨부된 문서에서 한 줄 요약을 만든다 — 잘못된 파일을 넣었는지 저장 전에 눈으로 잡기 위함.
  function slotSummary(kind, body) {
    if (kind === 'spec') {
      const m = SPEC.parseMeta(body);
      return [m.slug || 'slug ?', m.specVersion ? `v${m.specVersion}` : '버전 ?', `상태 ${m.specStatus || '?'}`]
        .map(esc).join(' · ');
    }
    const c = SPEC.parseChecklistMeta(body);
    return [`상태 ${c.status || '?'}`, `${c.checked}/${c.total} 통과`,
      c.targetVersion ? `대상 v${c.targetVersion}` : '대상 버전 ?'].map(esc).join(' · ');
  }

  function renderSlots() {
    $('#up-slots').innerHTML = DOC_KINDS.map((d) => {
      const body = bodyOf(d.kind);
      const filled = !!body.trim();
      const tag = !filled ? badge('미첨부', 'red')
        : (uploadCtx.kept[d.kind] ? badge('기존 문서 유지', 'gray') : badge('첨부됨', 'green'));
      const line = filled
        ? `<div class="slot-name mono">${esc(uploadCtx.names[d.kind] || d.path)}</div>
           <div class="slot-meta feat-sub">${slotSummary(d.kind, body)}</div>`
        : `<div class="slot-meta feat-sub">${esc(d.path)} — 필수</div>`;
      return `<div class="up-slot ${filled ? 'filled' : 'empty'}">
        <div class="slot-ico">${d.icon}</div>
        <div class="slot-main">
          <div class="slot-title">${esc(d.label)} ${tag}<span class="slot-hint feat-sub">${esc(d.hint)}</span></div>
          ${line}
        </div>
        <button class="btn-add" type="button" data-pick="${d.kind}">${filled ? '교체' : '파일 선택'}</button>
      </div>`;
    }).join('');
    $('#up-slots').querySelectorAll('[data-pick]').forEach((b) =>
      b.addEventListener('click', () => { pickTarget = b.dataset.pick; $('#file-input').click(); }));
  }

  // ── 프리뷰 탭 (렌더러는 문서 뷰어와 동일한 mdToHtml) ──
  function renderTabs() {
    // 비어 있는 문서 탭이 선택돼 있으면 내용이 있는 쪽으로 옮긴다
    if (!bodyOf(previewTab).trim()) {
      const other = DOC_KINDS.find((d) => bodyOf(d.kind).trim());
      if (other) previewTab = other.kind;
    }
    $('#up-tabs').innerHTML = DOC_KINDS.map((d) =>
      `<button class="doc-tab ${previewTab === d.kind ? 'active' : ''}" data-tab="${d.kind}"${bodyOf(d.kind).trim() ? '' : ' disabled'}>${d.icon} ${esc(d.label)}</button>`).join('');
    $('#up-tabs').querySelectorAll('[data-tab]').forEach((b) =>
      b.addEventListener('click', () => { previewTab = b.dataset.tab; renderTabs(); renderPreview(); }));
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

  function renderPreview() {
    const el = $('#up-preview'); if (!el) return;
    const body = bodyOf(previewTab);
    el.innerHTML = body.trim() ? mdToHtml(body) : '<div class="feat-sub">파일을 첨부하면 여기에 렌더됩니다.</div>';
  }

  function wireDropzone() {
    const dz = $('#dropzone'); const fi = $('#file-input');
    $('#btn-pick').addEventListener('click', () => { pickTarget = null; fi.click(); });
    fi.addEventListener('change', () => { handleFiles(fi.files, pickTarget); fi.value = ''; pickTarget = null; });
    // 드롭은 모달 본문 전체에서 받는다 — 두 파일을 한 번에 던질 수 있게.
    const zone = $('#upload-body');
    ['dragover', 'dragenter'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
    zone.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files, null));
  }

  // 어느 슬롯에 넣을지 판별한다. 파일명보다 본문 H1 을 먼저 믿는다 —
  // 파일명은 사용자가 바꿔도 템플릿 H1 은 스킬이 고정하기 때문.
  function classifyDoc(name, text) {
    if (/^#\s*Spec\s*품질\s*체크리스트/im.test(text)) return 'checklist';
    if (/^#\s*스펙\s*명세서/im.test(text)) return 'spec';
    if (/checklist/i.test(name)) return 'checklist';
    if (/(^|\/)spec\.md$/i.test(name)) return 'spec';
    return null;
  }

  function handleFiles(fileList, forceKind) {
    const files = Array.from(fileList || []).filter((f) => /\.md$/i.test(f.name));
    if (!files.length) return uploadMsg('.md 파일만 첨부할 수 있습니다.');
    let pending = files.length;
    const unknown = [];
    const done = () => {
      if (--pending) return;
      renderSlots(); renderTabs(); renderPreview();
      uploadMsg(unknown.length
        ? `판별할 수 없는 파일: ${unknown.join(' · ')} — 슬롯의 [파일 선택]으로 직접 지정하세요.`
        : '', !!unknown.length);
    };
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || '');
        const kind = forceKind || classifyDoc(file.name, text);
        if (!kind) unknown.push(file.name);
        else {
          uploadCtx[kind === 'spec' ? 'specBody' : 'checklistBody'] = text;
          uploadCtx.names[kind] = file.name;
          uploadCtx.kept[kind] = false;
          previewTab = kind;
        }
        done();
      };
      reader.onerror = () => { unknown.push(file.name); done(); };
      reader.readAsText(file);
    });
  }

  function uploadMsg(t, err = true) { const el = $('#upload-msg'); el.textContent = t; el.classList.toggle('error', err); }

  // 검증 결과를 문서별로 묶어 보여준다 — 어느 파일을 고쳐야 하는지가 바로 보이게.
  function issuesHtml(groups) {
    const block = (cls, label, list) =>
      `<div class="${cls}"><div class="lbl">${label}</div>` +
      groups.filter((g) => g[list].length).map((g) =>
        `<div class="up-doc-group"><div class="up-doc-label mono">${esc(g.label)}</div>` +
        g[list].map((x) => `<div class="${cls === 'up-errors-box' ? 'up-err' : 'up-warn'}"><span class="ecode">${x.code}</span> ${esc(x.msg)}</div>`).join('') +
        '</div>').join('') + '</div>';
    const n = (list) => groups.reduce((a, g) => a + g[list].length, 0);
    let html = '';
    if (n('errors')) html += block('up-errors-box', `구조 검증 실패 ${n('errors')}건`, 'errors');
    // 경고(DRAFT · [TBD] · 체크리스트 미통과)는 저장을 막지 않는다 — 미완성일수록 검수가 필요하다는 게 이 대시보드의 목적.
    if (n('warnings')) html += block('up-warns', `검수 필요 항목 ${n('warnings')}건 (업로드는 진행됩니다)`, 'warnings');
    return html;
  }

  async function saveUpload() {
    const specBody = uploadCtx.specBody || '';
    const checklistBody = uploadCtx.checklistBody || '';
    if (!specBody.trim()) return uploadMsg('spec.md 를 첨부하세요.');
    if (!checklistBody.trim()) return uploadMsg('품질 체크리스트(quality/spec-checklist.md)를 함께 첨부하세요.');
    if (!uploadCtx.baseBranch) return uploadMsg('대상 base 브랜치를 선택하세요.');

    const rs = V.validateSpec(specBody);
    const rc = V.validateChecklist(checklistBody, rs.meta);
    const groups = [
      { label: 'spec.md', errors: rs.errors, warnings: rs.warnings || [] },
      { label: 'quality/spec-checklist.md', errors: rc.errors, warnings: rc.warnings || [] },
    ];
    const errBox = $('#up-errors');
    errBox.innerHTML = issuesHtml(groups);
    const errCount = rs.errors.length + rc.errors.length;
    if (errCount) {
      uploadMsg(`검증 실패 ${errCount}건 — 로컬에서 수정한 뒤 다시 첨부하세요.`);
      errBox.scrollIntoView({ block: 'nearest' }); // 모달이 스크롤돼 있어도 실패 사유가 보이게
      return;
    }
    const warnCount = (rs.warnings || []).length + (rc.warnings || []).length;
    uploadMsg(warnCount ? `경고 ${warnCount}건과 함께 저장 중…` : '저장 중…', false);
    const r = await features.saveSpec({
      featureId: uploadCtx.featureId, specBody, checklistBody, baseBranch: uploadCtx.baseBranch,
    });
    if (!r.ok) return uploadMsg(r.error || '저장 실패');
    closeModal('upload-modal');
    if (r.invalidated) {
      alert('승인된 spec을 수정해 무효화되었습니다 → 작성중으로 복귀하고 열린 PR은 종료됩니다.'
        + (r.versionStale ? '\n\n⚠️ 버전이 그대로입니다. 로컬 /mino-spec 개정으로 버전을 올린 뒤 다시 올리세요.' : ''));
    }
    select(r.feature.featureId); renderAll();
  }

  // ===================== PRD (P8) =====================
  // spec 의 상위 문서. 컨펌 게이트가 없어 상태 전이도 없다 — 업로드·논의·버전 추적만.
  // 설계: docs/design/prd-track.md
  const PRD = window.MASC.prd;
  let prdTab = 'doc';          // doc | versions | specs
  let prdAnchor = null;        // 선택된 섹션 앵커(댓글 필터 + 새 댓글의 anchor)
  let prdReplyTo = null;       // 답글 대상 msgId
  let prdEditingMsg = null;    // 편집 중인 댓글 msgId

  const prdDoc = () => (PRD ? PRD.get() : null);
  const prdComments = () => (PRD ? PRD.comments.list().filter((c) => !c.deleted || hasReply(c)) : []);
  // 소프트 삭제된 댓글이라도 답글이 달려 있으면 자리를 남긴다(스레드 끊김 방지)
  const hasReply = (c) => PRD.comments.list().some((x) => x.replyTo === c.msgId && !x.deleted);

  /** feature 의 기준 PRD 버전 ↔ 현재 PRD 버전 호환 등급 */
  function compatOf(f) {
    const p = prdDoc();
    return V2.prdCompat(f && f.prdVersion, p ? p.version : '');
  }
  // 목록에서는 **문제만** 보여준다 (tbdBadge 와 같은 규칙) — 최신·무해·미연결은 침묵.
  function compatBadge(f, always) {
    const c = compatOf(f);
    if (!always && ['same', 'patch', 'none'].includes(c.level)) return '';
    return badge(c.label, c.color, c.hint);
  }

  // 헤더 PRD 칩 — 등록 전이면 개발자에게만 업로드 유도
  function renderPrdChip() {
    const btn = $('#btn-prd'); if (!btn) return;
    const p = prdDoc();
    const n = PRD ? PRD.comments.list().filter((c) => !c.deleted).length : 0;
    btn.innerHTML = p
      ? `📘 PRD <span class="mono">${esc(p.version)}</span>${n ? ` · 💬 ${n}` : ''}`
      : '📘 PRD 미등록';
    btn.classList.toggle('warn', !p);
    btn.style.display = (p || auth.isDeveloper()) ? '' : 'none';
  }

  function openPrd(tab) {
    if (tab) prdTab = tab;
    if (!prdDoc()) { prdTab = 'doc'; }
    renderPrd();
    openModal('prd-modal');
  }

  function renderPrd() {
    const p = prdDoc();
    $('#prd-modal-title').textContent = p ? `${p.title} · PRD ${p.version}` : 'PRD';
    const TABS = [
      { key: 'doc', label: '📄 문서' },
      { key: 'versions', label: '🧬 버전 이력' },
      { key: 'specs', label: '🔗 연결된 스펙' },
    ];
    $('#prd-tabs').innerHTML = TABS.map((t) =>
      `<button class="doc-tab ${prdTab === t.key ? 'active' : ''}" data-prdtab="${t.key}"${p ? '' : ' disabled'}>${t.label}</button>`).join('');
    $('#prd-tabs').querySelectorAll('[data-prdtab]').forEach((b) =>
      b.addEventListener('click', () => { prdTab = b.dataset.prdtab; renderPrd(); }));

    const body = $('#prd-modal-body');
    if (!p) {
      body.innerHTML = `<div class="prd-empty">
        <p class="desc">아직 PRD 가 등록되지 않았습니다.</p>
        <div class="legend-note">로컬 <code>/mino-prd</code> 로 만든
          <code>docs/prd/business-context.md</code> 를 업로드하세요.
          PRD 는 프로젝트당 1개이고, spec 헤더의 <code>**기준 PRD 버전**</code> 이 이 문서를 가리킵니다.</div>
        ${auth.isDeveloper() ? '<div class="detail-actions"><button class="btn-primary" id="prd-upload-open">PRD 업로드</button></div>' : ''}
      </div>`;
      const up = $('#prd-upload-open');
      if (up) up.addEventListener('click', () => { closeModal('prd-modal'); openPrdUpload(); });
      return;
    }
    if (prdTab === 'versions') return renderPrdVersions(p, body);
    if (prdTab === 'specs') return renderPrdSpecs(p, body);
    return renderPrdDocTab(p, body);
  }

  // ── 문서 탭: 좌 본문(섹션 앵커) / 우 논의 스레드 ──
  function renderPrdDocTab(p, body) {
    body.innerHTML = `
      <div class="prd-head">
        <div class="feat-sub">
          최초 ${esc(p.createdDate || '-')} ${esc(p.prdAuthor || '')} ·
          최종 ${esc(p.lastAmendedDate || '-')} ${esc(p.lastAmendedAuthor || '')} ·
          항목 ${(p.itemIds || []).length}개
        </div>
        <button class="btn-ghost" id="prd-dl" title="PRD 본문을 .md 파일로 저장">⬇ 다운로드</button>
        ${auth.isDeveloper() ? '<button class="btn-ghost" id="prd-edit">PRD 개정 업로드</button>' : ''}
      </div>
      <div class="prd-grid">
        <div class="prd-doc md" id="prd-doc"></div>
        <div class="prd-thread" id="prd-thread"></div>
      </div>`;
    $('#prd-doc').innerHTML = mdToHtml(p.body || '');
    addPrdAnchors($('#prd-doc'));
    $('#prd-dl').addEventListener('click', () => downloadText(prdFileName(p.version), p.body || ''));
    const edit = $('#prd-edit');
    if (edit) edit.addEventListener('click', () => { closeModal('prd-modal'); openPrdUpload(); });
    renderPrdThread();
  }

  // 제목 옆 💬 — 클릭하면 그 섹션으로 논의를 좁힌다(새 댓글의 anchor 도 그 섹션이 된다)
  function addPrdAnchors(container) {
    container.querySelectorAll(MD_HEADS).forEach((h) => {
      const section = h.textContent.trim();
      const n = PRD.comments.list().filter((c) => !c.deleted && sameSection(c.anchor, section)).length;
      const btn = document.createElement('button');
      btn.className = 'cmt-add' + (sameSection(prdAnchor, section) ? ' on' : '') + (n ? ' has' : '');
      btn.type = 'button';
      btn.textContent = n ? `💬 ${n}` : '💬';
      btn.title = '이 섹션의 논의';
      h.appendChild(btn);
      btn.addEventListener('click', () => {
        prdAnchor = sameSection(prdAnchor, section) ? null : section;
        renderPrd();
      });
    });
  }

  function renderPrdThread() {
    const el = $('#prd-thread'); if (!el) return;
    mpClose();   // 아래 innerHTML 이 textarea 를 갈아끼우므로 열려 있던 멘션 팝오버는 버린다
    const all = PRD.comments.list();
    const visible = all.filter((c) => !prdAnchor || sameSection(c.anchor, prdAnchor));
    const roots = visible.filter((c) => !c.replyTo);
    const me = auth.currentUser();

    const bubble = (c, isReply) => {
      const mine = me && c.authorUid === me.uid;
      if (c.deleted) {
        return `<div class="pc ${isReply ? 'reply' : ''} deleted"><span class="feat-sub">삭제된 댓글</span></div>`;
      }
      if (prdEditingMsg === c.msgId) {
        return `<div class="pc ${isReply ? 'reply' : ''} editing">
          <textarea class="pc-edit-input" data-edit="${esc(c.msgId)}">${esc(c.body)}</textarea>
          <div class="pc-actions">
            <button class="btn-add" data-edit-save="${esc(c.msgId)}">저장</button>
            <button class="btn-ghost" data-edit-cancel="1">취소</button>
          </div></div>`;
      }
      return `<div class="pc ${isReply ? 'reply' : ''}">
        <div class="pc-h">
          <span class="pc-who">${esc(userName(c.authorUid))}</span>
          <span class="lu-role ${esc(c.authorRole || '')}">${c.authorRole === 'designer' ? '디자이너' : '개발자'}</span>
          <span class="feat-sub">${esc(shortTime(c.createdAt))}${c.updatedAt ? ' (수정됨)' : ''}</span>
          ${!prdAnchor && c.anchor ? `<span class="pc-anchor" title="${esc(c.anchor)}">§ ${esc(c.anchor)}</span>` : ''}
        </div>
        <div class="pc-body">${mentionHtml(c.body)}</div>
        <div class="pc-actions">
          ${isReply ? '' : `<button class="btn-link" data-reply="${esc(c.msgId)}">답글</button>`}
          ${mine ? `<button class="btn-link" data-edit-start="${esc(c.msgId)}">수정</button>
                    <button class="btn-link danger" data-del="${esc(c.msgId)}">삭제</button>` : ''}
        </div></div>`;
    };

    const list = roots.map((c) => {
      const replies = all.filter((r) => r.replyTo === c.msgId);
      return bubble(c, false) + replies.map((r) => bubble(r, true)).join('');
    }).join('');

    const replyTarget = prdReplyTo ? all.find((c) => c.msgId === prdReplyTo) : null;
    el.innerHTML = `
      <div class="prd-thread-h">
        <b>💬 논의</b>
        <span class="feat-sub">${visible.filter((c) => !c.deleted).length}건</span>
        ${prdAnchor ? `<span class="pc-anchor on">§ ${esc(prdAnchor)}<button class="pc-anchor-x" id="prd-anchor-clear" title="전체 보기">×</button></span>` : ''}
      </div>
      <div class="prd-thread-list">${list || '<div class="feat-sub">아직 논의가 없습니다. 첫 코멘트를 남겨보세요.</div>'}</div>
      <div class="prd-compose">
        ${replyTarget ? `<div class="pc-replying">↳ <b>${esc(userName(replyTarget.authorUid))}</b> 에게 답글
          <button class="pc-anchor-x" id="prd-reply-clear">×</button></div>` : ''}
        ${prdAnchor ? `<div class="feat-sub">§ ${esc(prdAnchor)} 에 남깁니다</div>` : ''}
        <textarea id="prd-cmt-input" placeholder="PRD 에 대한 의견을 남기세요. @ 를 입력하면 팀원 목록이 뜹니다."></textarea>
        <div class="prd-compose-foot">
          <span class="editor-msg" id="prd-cmt-msg"></span>
          <div class="spacer"></div>
          <button class="btn-primary" id="prd-cmt-send">등록</button>
        </div>
      </div>`;

    const clear = $('#prd-anchor-clear');
    if (clear) clear.addEventListener('click', () => { prdAnchor = null; renderPrd(); });
    const rclear = $('#prd-reply-clear');
    if (rclear) rclear.addEventListener('click', () => { prdReplyTo = null; renderPrdThread(); });
    el.querySelectorAll('[data-reply]').forEach((b) =>
      b.addEventListener('click', () => { prdReplyTo = b.dataset.reply; renderPrdThread(); $('#prd-cmt-input').focus(); }));
    el.querySelectorAll('[data-edit-start]').forEach((b) =>
      b.addEventListener('click', () => { prdEditingMsg = b.dataset.editStart; renderPrdThread(); }));
    el.querySelectorAll('[data-edit-cancel]').forEach((b) =>
      b.addEventListener('click', () => { prdEditingMsg = null; renderPrdThread(); }));
    el.querySelectorAll('[data-edit-save]').forEach((b) =>
      b.addEventListener('click', async () => {
        const ta = el.querySelector(`[data-edit="${b.dataset.editSave}"]`);
        const r = await PRD.comments.edit(b.dataset.editSave, ta.value);
        if (!r.ok) { alert(r.error); return; }
        prdEditingMsg = null; afterPrdWrite();
      }));
    el.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm('이 댓글을 삭제할까요?')) return;
        const r = await PRD.comments.remove(b.dataset.del);
        if (!r.ok) { alert(r.error); return; }
        afterPrdWrite();
      }));
    $('#prd-cmt-send').addEventListener('click', postPrdComment);
    $('#prd-cmt-input').addEventListener('keydown', (e) => {
      // 한글 IME 조합 중 Enter 는 글자 확정용 (기존 인라인 코멘트와 같은 가드)
      if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || e.isComposing || e.keyCode === 229) return;
      e.preventDefault(); postPrdComment();
    });
    // 작성·수정 두 입력 모두 @자동완성 대상 (attachMention 이 중복 바인딩을 막는다)
    attachMention($('#prd-cmt-input'));
    el.querySelectorAll('.pc-edit-input').forEach((ta) => attachMention(ta));
  }

  async function postPrdComment() {
    const ta = $('#prd-cmt-input');
    const body = (ta.value || '').trim();
    if (!body) { $('#prd-cmt-msg').textContent = '내용을 입력하세요.'; return; }
    $('#prd-cmt-msg').textContent = '등록 중…';
    const r = await PRD.comments.post({ body, anchor: prdAnchor, replyTo: prdReplyTo });
    if (!r.ok) { $('#prd-cmt-msg').textContent = r.error; return; }
    prdReplyTo = null;
    afterPrdWrite();
  }

  // mock 은 구독이 없으므로 직접 다시 그린다 (firebase 는 onSnapshot 이 renderAll 을 부른다)
  function afterPrdWrite() { renderPrd(); renderPrdChip(); if (!FB) renderAll(); }

  // 저장은 `@githubLogin`, 표시는 실제 이름 — 팀원이 아닌 핸들(오타·외부인)은 회색으로 구분한다.
  // esc() 를 먼저 통과시킨 문자열 위에서 치환한다(핸들 문자셋이 ASCII 라 재이스케이프 불필요).
  function mentionHtml(body) {
    const byHandle = new Map(auth.users().filter((u) => u.githubLogin)
      .map((u) => [String(u.githubLogin).toLowerCase(), u]));
    return esc(body)
      .replace(/@([A-Za-z0-9_-]{2,39})/g, (full, h) => {
        const u = byHandle.get(h.toLowerCase());
        return u
          ? `<span class="mention" title="@${u.githubLogin}">@${esc(u.name || u.githubLogin)}</span>`
          : `<span class="mention unknown">${full}</span>`;
      })
      .replace(/\n/g, '<br />');
  }

  // ---------- @멘션 자동완성 (댓글 작성·수정 textarea 공용) ----------
  // 삽입 토큰은 **githubLogin** 이다 — store 의 mentionsOf 정규식이 ASCII 전용이라
  // `@민호` 처럼 한글을 넣으면 mentions[] 가 비고 notifyOnPrdComment 가 조용히 건너뛴다.
  // 사람이 읽는 이름은 위 mentionHtml 이 렌더 시점에 되돌린다.
  // 팝오버는 body 에 fixed 로 띄운다 — .prd-thread-list·.modal 의 overflow 에 잘리지 않게.
  const MENTION_MAX = 6;
  // 검색어에는 한글도 받는다 — 팀원을 `@은석` 으로 찾는 게 자연스럽다. 삽입되는 토큰은
  // 그래도 ASCII 핸들이다. ㄱ-ㅣ 은 IME 조합 중간의 낱자(ㅇ, ㅡ …)까지 커버.
  const MENTION_RE = /(^|[\s([{>])@([A-Za-z0-9_\-가-힣ㄱ-ㅣ]*)$/;
  const mp = { el: null, ta: null, items: [], sel: 0, at: -1 };

  function mentionUsers(q) {
    const key = q.toLowerCase();
    const rank = (u) => {
      const h = String(u.githubLogin).toLowerCase(), n = String(u.name || '').toLowerCase();
      if (!key) return 2;                                        // `@` 만 친 상태 = 전원
      if (h.startsWith(key) || n.startsWith(key)) return 2;      // 접두 일치가 위
      return (h.includes(key) || n.includes(key)) ? 1 : 0;
    };
    return auth.users().filter((u) => u.githubLogin)
      .map((u) => ({ u, r: rank(u) })).filter((x) => x.r > 0)
      .sort((a, b) => b.r - a.r).slice(0, MENTION_MAX).map((x) => x.u);
  }

  function mpEl() {
    if (mp.el) return mp.el;
    const el = document.createElement('div');
    el.className = 'mention-pop hidden';
    // click 은 blur 뒤에 와서 늦다 — mousedown 으로 잡고 포커스 이동을 막는다.
    el.addEventListener('mousedown', (e) => {
      const it = e.target.closest('.mp-item');
      if (!it) return;
      e.preventDefault();
      mpPick(Number(it.dataset.i));
    });
    document.body.appendChild(el);
    window.addEventListener('scroll', () => { if (mp.ta) mpPlace(); }, true);
    window.addEventListener('resize', () => { if (mp.ta) mpPlace(); });
    mp.el = el;
    return el;
  }

  function mpClose() {
    mp.ta = null; mp.items = []; mp.at = -1;
    if (mp.el) mp.el.classList.add('hidden');
  }

  function mpDraw() {
    mp.el.innerHTML = mp.items.map((u, i) => `
      <div class="mp-item${i === mp.sel ? ' on' : ''}" data-i="${i}">
        <span class="mp-name">${esc(u.name || u.githubLogin)}</span>
        <span class="mp-handle">@${esc(u.githubLogin)}</span>
        <span class="lu-role ${esc(u.role || '')}">${u.role === 'designer' ? '디자이너' : '개발자'}</span>
      </div>`).join('');
    mp.el.classList.remove('hidden');
    mpPlace();
  }

  // textarea 위쪽에 붙이되, 위 공간이 모자라면 아래로 뒤집는다.
  function mpPlace() {
    if (!mp.ta || !mp.el) return;
    const r = mp.ta.getBoundingClientRect();
    mp.el.style.left = r.left + 'px';
    mp.el.style.width = r.width + 'px';
    if (r.top > mp.el.offsetHeight + 8) {
      mp.el.style.top = '';
      mp.el.style.bottom = (window.innerHeight - r.top + 4) + 'px';
    } else {
      mp.el.style.bottom = '';
      mp.el.style.top = (r.bottom + 4) + 'px';
    }
  }

  function mpPick(i) {
    const u = mp.items[i], ta = mp.ta;
    if (!u || !ta) return;
    const token = '@' + u.githubLogin + ' ';
    ta.value = ta.value.slice(0, mp.at) + token + ta.value.slice(ta.selectionStart);
    const caret = mp.at + token.length;
    mpClose();
    ta.focus();
    ta.setSelectionRange(caret, caret);
  }

  function attachMention(ta) {
    if (!ta || ta.dataset.mention) return;
    ta.dataset.mention = '1';
    mpEl();

    const refresh = () => {
      if (ta.selectionStart !== ta.selectionEnd) return mpClose();
      const m = MENTION_RE.exec(ta.value.slice(0, ta.selectionStart));
      if (!m) return mpClose();
      const items = mentionUsers(m[2]);
      if (!items.length) return mpClose();
      mp.ta = ta; mp.items = items; mp.sel = 0;
      mp.at = ta.selectionStart - m[2].length - 1;   // `@` 의 인덱스
      mpDraw();
    };
    ta.addEventListener('input', refresh);
    ta.addEventListener('click', refresh);
    // ↑↓ 는 열려 있을 때 목록 이동에 쓰므로 여기서 다시 열지 않는다(선택이 0으로 리셋됨).
    ta.addEventListener('keyup', (e) => { if (/^(ArrowLeft|ArrowRight|Home|End)$/.test(e.key)) refresh(); });
    ta.addEventListener('blur', () => setTimeout(() => { if (mp.ta === ta) mpClose(); }, 0));
    ta.addEventListener('keydown', (e) => {
      if (mp.ta !== ta || !mp.items.length) return;
      // 한글 조합 중 Enter 는 글자 확정용 — 가로채면 입력이 깨진다 (전송 핸들러와 같은 가드)
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        mp.sel = (mp.sel + (e.key === 'ArrowDown' ? 1 : mp.items.length - 1)) % mp.items.length;
        mpDraw();
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (e.metaKey || e.ctrlKey) return;                    // Cmd+Enter 는 전송으로 넘긴다
        e.preventDefault(); e.stopPropagation(); mpPick(mp.sel);
      } else if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation(); mpClose();     // 모달까지 닫히지 않게
      }
    });
  }
  // 저장은 UTC(ISO), 표시는 KST(UTC+9 고정, 서머타임 없음).
  // 뷰어 로컬 시간이 아니라 팀 기준 시각으로 고정한다.
  function shortTime(iso) {
    if (!iso) return '';
    const s = String(iso);
    if (s.length < 16) return s;          // 날짜만 있는 값(YYYY-MM-DD)은 그대로
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    const kst = new Date(d.getTime() + 9 * 3600 * 1000).toISOString();
    return kst.slice(0, 10) + ' ' + kst.slice(11, 16);
  }

  // ── 버전 이력 탭 ──
  function renderPrdVersions(p, body) {
    const idx = PRD.versionIndex();
    const items = idx.map((e, i) => ({ e, i })).reverse().map(({ e, i }) => {
      const tag = VER_TAG[e.level] || badge(e.level || '-', 'gray');
      const editBtn = auth.isDeveloper()
        ? `<button class="ver-edit" data-prd-ver="${esc(e.version)}" data-reason="${esc(e.reason || '')}" title="메모 편집">✏️</button>` : '';
      const diffBtn = i > 0
        ? `<button class="ver-diff" data-prd-from="${esc(idx[i - 1].version)}" data-prd-to="${esc(e.version)}">변경분</button>` : '';
      const dlBtn = `<button class="ver-diff" data-prd-dl="${esc(e.version)}" title="이 버전 본문 받기">⬇</button>`;
      return `<div class="ver-item">
        <span class="ver-num mono">${esc(e.version)}</span> ${tag}
        <span class="feat-sub">${esc(e.at || '')} ${esc(userName(e.uploadedBy) || '')}</span>${editBtn}${diffBtn}${dlBtn}
        <div class="ver-reason">${esc(e.reason || '')}</div>
      </div>`;
    }).join('');
    const opts = (sel) => idx.map((e) =>
      `<option value="${esc(e.version)}"${e.version === sel ? ' selected' : ''}>${esc(e.version)}</option>`).join('');
    const from = idx.length >= 2 ? idx[idx.length - 2].version : (idx[0] || {}).version;
    const to = (idx[idx.length - 1] || {}).version;
    body.innerHTML = `
      <div class="prd-vercompare">
        <span class="lbl">두 버전 비교</span>
        <select id="prd-diff-from" class="base-select">${opts(from)}</select>
        <span>→</span>
        <select id="prd-diff-to" class="base-select">${opts(to)}</select>
        <button class="btn-primary" id="prd-diff-go"${idx.length >= 2 ? '' : ' disabled'}>변경분 보기</button>
      </div>
      <div class="detail-section"><h3>버전 스냅샷 <span class="feat-sub">(버전은 /mino-prd 소유)</span></h3>${items}</div>`;
    $('#prd-diff-go').addEventListener('click', () =>
      openPrdDiff($('#prd-diff-from').value, $('#prd-diff-to').value));
    body.querySelectorAll('[data-prd-from]').forEach((b) =>
      b.addEventListener('click', () => openPrdDiff(b.dataset.prdFrom, b.dataset.prdTo)));
    // 과거 버전 다운로드 — 본문은 versions/ 서브컬렉션에 있어 이때 한 건만 읽어온다
    body.querySelectorAll('[data-prd-dl]').forEach((b) =>
      b.addEventListener('click', async () => {
        const v = b.dataset.prdDl;
        b.disabled = true;
        const text = await PRD.versionBody(v);
        b.disabled = false;
        if (text == null) { alert(`${v} 본문 스냅샷을 찾지 못했습니다.`); return; }
        downloadText(prdFileName(v), text);
      }));
    body.querySelectorAll('[data-prd-ver]').forEach((b) =>
      b.addEventListener('click', async () => {
        const next = prompt(`버전 메모 (${b.dataset.prdVer})`, b.dataset.reason || '');
        if (next == null) return;
        const r = await PRD.editVersionReason(b.dataset.prdVer, next.trim());
        if (!r.ok) { alert(r.error); return; }
        renderPrd();
      }));
  }

  // ── 연결된 스펙 탭: 호환 등급 리포트 ──
  const COMPAT_ORDER = { major: 0, ahead: 1, minor: 2, patch: 3, same: 4, none: 5 };
  function renderPrdSpecs(p, body) {
    const rows = features.all()
      .map((f) => ({ f, c: compatOf(f) }))
      .sort((a, b) => (COMPAT_ORDER[a.c.level] - COMPAT_ORDER[b.c.level]) || a.f.title.localeCompare(b.f.title));
    if (!rows.length) { body.innerHTML = '<div class="detail-empty">등록된 스펙이 없습니다.</div>'; return; }
    const stale = rows.filter((r) => V2.STALE_LEVELS.includes(r.c.level));
    body.innerHTML = `
      ${stale.length
        ? `<div class="up-warns"><div class="lbl">재실행 검토 대상 ${stale.length}건</div>
           <div class="up-warn">PRD ${esc(p.version)} 개정 이후 <code>/mino-spec</code> 을 다시 돌리지 않은 스펙입니다.</div></div>`
        : '<div class="legend-note">모든 스펙이 현재 PRD 버전과 정합합니다.</div>'}
      <table class="feature-table"><thead>
        <tr><th>Feature</th><th>spec 버전</th><th>기준 PRD</th><th>정합</th></tr></thead>
        <tbody>${rows.map(({ f, c }) => `
          <tr data-id="${esc(f.featureId)}">
            <td><div class="feat-title">${esc(f.title)}</div><div class="feat-sub mono">${esc(f.slug)}</div></td>
            <td class="mono">${esc(f.specVersion || '-')}</td>
            <td class="mono">${esc(f.prdVersion || '없음')}</td>
            <td>${badge(c.label, c.color, c.hint)}</td>
          </tr>`).join('')}</tbody></table>`;
    body.querySelectorAll('tr[data-id]').forEach((tr) =>
      tr.addEventListener('click', () => { closeModal('prd-modal'); select(tr.dataset.id); }));
  }

  // ── PRD 버전 diff (본문은 지연 로드) ──
  async function openPrdDiff(fromVer, toVer) {
    if (!fromVer || !toVer || fromVer === toVer) { alert('서로 다른 두 버전을 선택하세요.'); return; }
    $('#diff-modal-title').textContent = `PRD 변경분 · ${fromVer} → ${toVer}`;
    $('#diff-modal-body').innerHTML = '<div class="feat-sub">스냅샷을 불러오는 중…</div>';
    openModal('diff-modal');
    const [a, b] = await Promise.all([PRD.versionBody(fromVer), PRD.versionBody(toVer)]);
    const el = $('#diff-modal-body');
    if (a == null || b == null) {
      el.innerHTML = '<div class="feat-sub">해당 버전의 스냅샷을 찾을 수 없습니다.</div>';
      return;
    }
    const rows = V2.diffLines(a, b);
    if (!rows.some((r) => r.t !== '=')) {
      el.innerHTML = '<div class="feat-sub">두 버전의 본문이 동일합니다.</div>';
      return;
    }
    const cs = window.MASCPrd.changedSections(a, b);
    const chip = (t, cls) => `<span class="sec-chip ${cls}">${esc(t)}</span>`;
    const summary = (cs.changed.length || cs.added.length || cs.removed.length)
      ? `<div class="diff-sections"><span class="lbl">변경 섹션</span>
          ${cs.added.map((t) => chip(t, 'add')).join('')}
          ${cs.changed.map((t) => chip(t, 'chg')).join('')}
          ${cs.removed.map((t) => chip(t, 'del')).join('')}</div>`
      : '';
    const coarse = rows.coarse
      ? '<div class="legend-note">문서가 커서 정밀 비교(LCS)를 생략하고 변경 구간을 통째로 표시합니다.</div>'
      : '';
    el.innerHTML = summary + coarse
      + `<div class="diff-legend"><span class="del">− ${esc(fromVer)}</span> <span class="add">+ ${esc(toVer)}</span></div>`
      + `<div class="diff-view">${diffBodyHtml(rows)}</div>`;
  }

  // ── PRD 업로드 (개발자 한정) ──
  let prdUpload = null; // { body, name, expectedVersion }

  function openPrdUpload() {
    if (!auth.isDeveloper()) { alert('PRD 업로드는 개발자만 가능합니다.'); return; }
    const p = prdDoc();
    prdUpload = { body: '', name: '', expectedVersion: p ? p.version : null };
    $('#prd-upload-title').textContent = p ? `PRD 개정 업로드 (현재 ${p.version})` : 'PRD 업로드';
    prdUploadMsg('', false);
    $('#prd-upload-body').innerHTML = `
      <div class="paste-help">
        <span>로컬 <code>/mino-prd</code> 산출물 <code>docs/prd/business-context.md</code> 를 첨부하세요.
        버전은 헤더 표의 <code>**버전**</code> 값을 그대로 읽습니다 — 대시보드는 버전을 올리지 않습니다.
        <code>TBD:</code> 가 남아 있어도 업로드할 수 있습니다(경고만 표시 — 댓글로 논의할 항목).</span>
      </div>
      <div class="upload-grid">
        <div class="upload-editor">
          <div id="prd-errors" class="up-errors"></div>
          <div id="prd-dropzone" class="dropzone">PRD 파일을 여기로 drag-drop
            <input type="file" id="prd-file" accept=".md" hidden />
            <button class="btn-add" type="button" id="prd-pick">파일 선택</button></div>
          <div class="up-slots" id="prd-slot"></div>
        </div>
        <div class="upload-preview">
          <div class="preview-head"><div class="lbl">미리보기</div></div>
          <div id="prd-preview" class="md up-preview"></div>
        </div>
      </div>`;
    wirePrdDropzone();
    renderPrdSlot();
    openModal('prd-upload-modal');
  }

  function renderPrdSlot() {
    const filled = !!(prdUpload.body || '').trim();
    const m = filled ? window.MASCPrd.parseMeta(prdUpload.body) : null;
    const line = filled
      ? `<div class="slot-name mono">${esc(prdUpload.name || 'business-context.md')}</div>
         <div class="slot-meta feat-sub">${esc([m.title || '제목 ?', m.version ? `v${m.version}` : '버전 ?',
        `항목 ${(m.goalIds || []).length}개`].join(' · '))}</div>`
      : '<div class="slot-meta feat-sub">docs/prd/business-context.md — 필수</div>';
    $('#prd-slot').innerHTML = `<div class="up-slot ${filled ? 'filled' : 'empty'}">
      <div class="slot-ico">📘</div>
      <div class="slot-main">
        <div class="slot-title">business-context.md ${filled ? badge('첨부됨', 'green') : badge('미첨부', 'red')}
          <span class="slot-hint feat-sub">프로젝트당 1개 · 전원 논의 대상</span></div>
        ${line}
      </div>
      <button class="btn-add" type="button" id="prd-pick2">${filled ? '교체' : '파일 선택'}</button>
    </div>`;
    $('#prd-pick2').addEventListener('click', () => $('#prd-file').click());
    $('#prd-preview').innerHTML = filled ? mdToHtml(prdUpload.body) : '<div class="feat-sub">파일을 첨부하면 여기에 렌더됩니다.</div>';
  }

  function wirePrdDropzone() {
    const dz = $('#prd-dropzone'), fi = $('#prd-file');
    $('#prd-pick').addEventListener('click', () => fi.click());
    fi.addEventListener('change', () => { readPrdFile(fi.files[0]); fi.value = ''; });
    const zone = $('#prd-upload-body');
    ['dragover', 'dragenter'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
    zone.addEventListener('drop', (e) => readPrdFile(e.dataTransfer.files[0]));
  }

  function readPrdFile(file) {
    if (!file) return;
    if (!/\.md$/i.test(file.name)) return prdUploadMsg('.md 파일만 첨부할 수 있습니다.');
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      // spec/체크리스트를 잘못 던진 경우를 본문 H1 으로 잡아준다
      if (/^#\s*(스펙\s*명세서|Spec\s*품질\s*체크리스트)/im.test(text)) {
        return prdUploadMsg('spec 또는 체크리스트 파일입니다 — PRD(`business-context.md`)를 첨부하세요.');
      }
      prdUpload.body = text; prdUpload.name = file.name;
      prdUploadMsg('', false);
      renderPrdSlot();
    };
    reader.onerror = () => prdUploadMsg('파일을 읽지 못했습니다.');
    reader.readAsText(file);
  }

  function prdUploadMsg(t, err = true) {
    const el = $('#prd-upload-msg'); el.textContent = t; el.classList.toggle('error', err);
  }

  async function savePrdUpload() {
    const body = (prdUpload && prdUpload.body) || '';
    if (!body.trim()) return prdUploadMsg('PRD 파일을 첨부하세요.');
    const r = V.validatePrd(body, prdUpload.expectedVersion);
    const groups = [{ label: 'docs/prd/business-context.md', errors: r.errors, warnings: r.warnings }];
    const box = $('#prd-errors');
    box.innerHTML = issuesHtml(groups);
    if (r.errors.length) {
      prdUploadMsg(`검증 실패 ${r.errors.length}건 — 로컬에서 수정한 뒤 다시 첨부하세요.`);
      box.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (r.sameVersion && !confirm(
      `저장본과 같은 버전(${r.meta.version})입니다.\n새 스냅샷을 만들지 않고 현재 버전의 본문만 갱신합니다. 계속할까요?`)) return;
    prdUploadMsg(r.warnings.length ? `경고 ${r.warnings.length}건과 함께 저장 중…` : '저장 중…', false);
    const res = await PRD.save({ body, expectedVersion: prdUpload.expectedVersion });
    if (!res.ok) {
      prdUploadMsg(res.error || 'PRD 저장 실패');
      if (res.conflict) prdUpload.expectedVersion = (prdDoc() || {}).version || null;
      return;
    }
    closeModal('prd-upload-modal');
    const lv = { init: '등록', major: 'MAJOR 개정', minor: 'MINOR 개정', patch: 'PATCH 개정', same: '본문 갱신' };
    const stale = features.all().filter((f) => V2.STALE_LEVELS.includes(compatOf(f).level));
    alert(`PRD ${res.created ? '등록' : lv[res.level] || '갱신'} 완료 — ${r.meta.version}`
      + (stale.length ? `\n\n기준 PRD 버전이 뒤처진 스펙 ${stale.length}건이 있습니다:\n`
        + stale.map((f) => `· ${f.title} (기준 ${f.prdVersion || '없음'})`).join('\n')
        + '\n\n[연결된 스펙] 탭에서 확인하세요.' : ''));
    renderPrdChip(); renderAll();
    openPrd(stale.length ? 'specs' : 'doc');
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
