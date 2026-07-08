/**
 * MASC app (v2) — UI 렌더링 & 상호작용
 * 데이터는 전부 window.MASC(store.js)를 통해서만 접근.
 * 파이프라인 상태머신: docs/design/state-machine.md · 검증: docs/design/validation.md
 */
(function () {
  const { auth, features } = window.MASC;
  const V = window.MASCValidate;
  const V2 = window.MASCVersion;
  const FB = window.MASC.BACKEND === 'firebase';

  // ---------- 상태 라벨/색상/설명 ----------
  const STATUS_LABEL = {
    spec_draft: '작성중', spec_in_review: '검토중', spec_changes_requested: '반려됨',
    spec_approved: '승인됨', plan_drafted: 'plan 작성', pr_open: 'PR 열림',
    merged: '머지됨', pr_closed: 'PR 종료',
  };
  const STATUS_COLOR = {
    spec_draft: 'gray', spec_in_review: 'amber', spec_changes_requested: 'red',
    spec_approved: 'green', plan_drafted: 'blue', pr_open: 'blue',
    merged: 'green', pr_closed: 'gray',
  };
  const STATUS_DESC = {
    spec_draft: 'spec 작성/수정 중 (초기). 개발자 편집 가능.',
    spec_in_review: '디자이너 검토 중. spec read-only 잠금.',
    spec_changes_requested: '디자이너가 반려. 개발자가 수정 후 재요청.',
    spec_approved: 'spec 컨펌 완료. plan 작성 잠금 해제.',
    plan_drafted: 'plan 작성 완료. PR 생성 준비.',
    pr_open: '문서 PR 열림. Webhook 머지/종료 대기.',
    merged: '머지 완료 — 구현 단계로 종료.',
    pr_closed: 'PR 미머지 종료.',
  };

  // 파이프라인 스텝퍼 (직선 흐름)
  const STEPS = [
    { key: 'spec_draft', label: 'spec 작성' },
    { key: 'spec_in_review', label: '검토' },
    { key: 'spec_approved', label: '승인' },
    { key: 'plan_drafted', label: 'plan' },
    { key: 'pr_open', label: 'PR' },
    { key: 'merged', label: '머지' },
  ];
  const STEP_INDEX = {
    spec_draft: 0, spec_changes_requested: 0, spec_in_review: 1,
    spec_approved: 2, plan_drafted: 3, pr_open: 4, merged: 5, pr_closed: 4,
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
    $('#plan-save').addEventListener('click', savePlan);
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
  const closeModal = (id) => {
    if (id === 'upload-modal') clearUploadObjUrls(); // 프리뷰 objectURL 누수 방지
    $('#' + id).classList.add('hidden');
  };

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
      <p class="desc">specs/{feature} 한 묶음이 단일 status를 가진다. 디자이너는 spec에만 관여.</p>
      <table class="legend-table"><tbody>${rows}</tbody></table>
      <div class="legend-note">
        <b>게이트</b> · spec <b>승인(spec_approved)</b> 전에는 plan 작성 불가.
        승인 후 spec을 수정하면 <b>무효화</b> — 작성중으로 복귀하고 plan은 "오래됨" 표시,
        열린 PR은 자동 종료됩니다.
      </div>`;
  }

  function renderSkillGuide() {
    $('#skill-body').innerHTML = `
      <p class="desc">문서 <b>생성은 대시보드가 아니라 로컬 Claude Code 스킬</b>로 합니다.
      정의는 Mino-Android 레포 <code>.claude/</code>에 있습니다.</p>
      <ol class="skill-steps">
        <li><b>설치</b> — Mino-Android 레포에서 <code>git pull</code> (스킬/에이전트 최신화)</li>
        <li><b>spec 생성</b> — <code>spec-gen</code> 실행 · 입력: Figma URL + 기획서 →
          <code>./spec.md</code> + <code>./assets/*.png</code> 산출 (자가검수 <code>spec-reviewer</code> 포함)</li>
        <li><b>업로드</b> — 산출물을 이 대시보드에 drag-drop ([+ 새 스펙 업로드]) → 구조 검증 → 디자이너 컨펌</li>
        <li><b>plan 생성</b> — spec 승인 후 <code>plan-gen</code> 실행 (레포 체크아웃 안에서) → plan 붙여넣기 → PR 생성</li>
      </ol>
      <div class="legend-note">대시보드는 입력값 치환을 하지 않습니다. 스킬 실행 시 직접 Figma URL·기획서를 전달하세요.</div>`;
  }

  // ===================== 역할별 사용법 =====================
  const ROLE_GUIDE = {
    developer: {
      intro: `개발자는 스펙을 <b>작성·업로드</b>하고, 디자이너 컨펌을 거쳐 <b>문서 PR까지 배출</b>하는 주체입니다.
        문서 생성은 대시보드가 아니라 로컬 Claude Code 스킬(<code>스킬 안내</code> 참고)로 합니다.`,
      steps: [
        `<b>스펙 작성 (로컬)</b> — Mino-Android 레포에서 <code>git pull</code> → <code>spec-gen</code>(+Figma URL)로 <code>spec.md</code>·이미지 생성, <code>spec-reviewer</code>로 자가검수`,
        `<b>업로드 + 검증</b> — <code>+ 새 스펙 업로드</code>에 spec 붙여넣기·이미지 drag-drop·figmaSources 입력 → S1–S6 구조 검증 통과 시 <code>spec_draft</code> / <code>v0.1.0</code> 생성`,
        `<b>컨펌 요청</b> — 상세에서 <code>컨펌 요청</code> → <code>spec_in_review</code> 전환 + spec이 read-only로 잠김`,
        `<b>반려 반영 → 재요청</b> — 반려(<code>spec_changes_requested</code>) 시 <code>spec 수정</code>으로 코멘트 반영 후 <code>컨펌 요청</code>(버전 patch bump)`,
        `<b>plan 작성</b> — 승인(<code>spec_approved</code>)되면 잠금 해제. <code>plan 붙여넣기</code>로 <code>plan.md</code> 저장 → <code>plan_drafted</code>`,
        `<b>PR 생성</b> — <code>plan_drafted</code>에서 <code>PR 생성</code> → <code>docs/spec-{slug}-{version}</code> 브랜치·커밋·PR 자동 생성(base <code>develop</code>) → <code>pr_open</code>`,
        `<b>무효화</b> — 승인 이후 <code>spec 수정</code> 시 자동으로 <code>spec_draft</code> 복귀 + planStale + 열린 PR close + 버전 bump(승인후=minor·머지후=major)`,
      ],
      note: `상세 패널의 <b>변경 이력(자동)</b>에서 버전별 사유를 확인·편집하고, 재검토 시 "지난 검토 이후 변경분" diff를 열 수 있습니다.`,
    },
    designer: {
      intro: `디자이너는 <b>spec 컨펌 게이트</b>를 담당합니다. 검토 중인 스펙을 화면 단위로 확인하고 <b>승인 / 반려</b>로 파이프라인을 통과시킵니다.
        plan·PR에는 관여하지 않습니다(문서 생성 스킬도 사용하지 않습니다).`,
      steps: [
        `<b>검토 대기 확인</b> — 좌측 <code>검토중</code> 필터 또는 상단 KPI <b>검토중</b>으로 <code>spec_in_review</code>만 추려 대상 Feature 선택`,
        `<b>스펙 검토</b> — 상세의 <code>📝 스펙 검토</code>로 리뷰 모드 열기. <b>출처(Figma) 링크</b>로 원본과 대조하고, 제목 옆 <b>💬</b>로 화면·규칙에 인라인 코멘트`,
        `<b>승인</b> — <code>spec_approved</code>로 전환, 개발자의 plan 잠금 해제`,
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
      if (state.quick.has('planStale') && !f.planStale) return false;
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
      { val: c((f) => ['spec_approved', 'plan_drafted'].includes(f.status)), lbl: '승인됨' },
      { val: c((f) => f.status === 'pr_open'), lbl: 'PR 열림' },
      { val: c((f) => f.status === 'merged'), lbl: '머지됨' },
      { val: c((f) => f.planStale), lbl: 'plan 오래됨', cls: c((f) => f.planStale) ? 'danger' : '' },
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
        <td>${statusBadge(f.status)}${f.planStale ? ' ' + badge('stale', 'red', 'plan 오래됨') : ''}</td>
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
    let html = '', inList = false;
    const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
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
      if (/^<!--/.test(line.trim())) continue; // slug 주석 숨김
      if (!line.trim()) { closeList(); continue; }
      closeList(); html += `<p>${inline(line)}</p>`;
    }
    closeList(); return html;
  }

  // spec 본문의 `assets/{name}` 상대경로 img → Storage 다운로드 URL 로 치환.
  // (마크다운은 assets/ 상대경로로 커밋되지만 대시보드엔 그 경로가 없어 404 나던 문제)
  function resolveAssetImgs(root, f) {
    if (!f || !features.assetUrl) return;
    root.querySelectorAll('img').forEach((img) => {
      const raw = img.getAttribute('src') || '';
      const m = raw.match(/^\.?\/?assets\/(.+)$/);
      if (!m) return;
      const name = m[1];
      img.removeAttribute('src'); // 상대경로 그대로 두면 404 깜빡임 → 즉시 제거 후 해석
      img.classList.add('asset-loading');
      Promise.resolve(features.assetUrl(f.featureId, name)).then((url) => {
        img.classList.remove('asset-loading');
        if (url) { img.src = url; }
        else { img.replaceWith(brokenAsset(name)); }
      });
    });
  }
  function brokenAsset(name) {
    const el = document.createElement('div');
    el.className = 'asset-missing feat-sub';
    el.textContent = `🖼️ 이미지 없음: assets/${name}`;
    return el;
  }

  // 리뷰 모드 상태 (디자이너가 spec_in_review spec에 코멘트 달 때)
  let reviewState = null; // { featureId, comments: [{section, body}] }

  function openDoc(f, kind) {
    const body = kind === 'plan' ? f.planBody : f.specBody;
    // 검토중 = 결정(승인/반려) 모드, 반려됨 = 보충 코멘트(append) 모드
    const decisionMode = kind === 'spec' && auth.isDesigner() && f.status === 'spec_in_review';
    const appendMode = kind === 'spec' && auth.isDesigner() && f.status === 'spec_changes_requested';
    const reviewMode = decisionMode || appendMode;
    $('#doc-modal-title').textContent = `${f.title} · ${kind === 'plan' ? 'plan' : 'spec'}`;
    const bodyEl = $('#doc-modal-body');
    bodyEl.innerHTML = (body && body.trim()) ? mdToHtml(body) : '<div class="feat-sub">본문 없음.</div>';
    resolveAssetImgs(bodyEl, f);

    // 재검토: 직전 버전 대비 변경분 바로가기 (디자이너 리뷰 모드 · 버전 2개 이상)
    const vlog = f.versionLog || [];
    if (reviewMode && kind === 'spec' && vlog.length >= 2) {
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
    if (!confirm('이 spec을 승인합니다. 이후 plan 작성이 가능해집니다.')) return;
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
    const planExists = !!(f.planBody && f.planBody.trim());

    panel.innerHTML = `
      <div class="detail-h">
        <div class="crumb mono">${esc(f.slug)} · ${esc(f.specVersion || '')}</div>
        <h2>${esc(f.title)}</h2>
        <div class="detail-badges">
          ${statusBadge(f.status)}
          ${f.planStale ? badge('plan stale', 'red') : ''}
          ${f.prNumber ? badge('PR #' + f.prNumber, 'blue') : ''}
        </div>
      </div>
      ${stepperHtml(f)}
      ${actionsHtml(f, isDev, isDesigner, planExists)}
      <div class="detail-section">
        <h3>출처 (Figma)</h3>
        ${(f.figmaSources && f.figmaSources.length)
          ? f.figmaSources.map((u) => `<div class="kv"><span class="v"><a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a></span></div>`).join('')
          : '<div class="feat-sub">없음</div>'}
      </div>
      <div class="detail-section">
        <h3>문서</h3>
        <div class="doc-row">
          <button class="btn-primary" data-doc="spec">📄 spec 보기</button>
          ${planExists ? `<button class="btn-ghost" data-doc="plan">📄 plan 보기</button>` : '<span class="feat-sub">plan 없음</span>'}
        </div>
        <div class="feat-sub" style="margin-top:6px">이미지 ${f.assets ? f.assets.length : 0}개 · 작성자 ${esc(userName(f.createdBy))}</div>
      </div>
      ${versionHistoryHtml(f, isDev)}
      ${reviewsHtml(f)}`;

    // 문서 보기
    panel.querySelectorAll('button[data-doc]').forEach((b) => b.addEventListener('click', () => openDoc(f, b.dataset.doc)));
    // 변경이력 사유 편집(개발자)
    panel.querySelectorAll('button[data-edit-ver]').forEach((b) =>
      b.addEventListener('click', () => editVersionReason(f, b.dataset.editVer, b.dataset.reason)));
    // 버전 변경분 diff
    panel.querySelectorAll('button[data-diff-from]').forEach((b) =>
      b.addEventListener('click', () => openDiff(f, b.dataset.diffFrom, b.dataset.diffTo)));
    // 액션 와이어링
    wireActions(panel, f);
  }

  function stepperHtml(f) {
    const cur = STEP_INDEX[f.status];
    const branch = f.status === 'spec_changes_requested' ? '반려됨' : (f.status === 'pr_closed' ? 'PR 종료' : '');
    return `<div class="stepper">${STEPS.map((s, i) => {
      const cls = i < cur ? 'done' : (i === cur ? 'active' : '');
      return `<div class="step ${cls}"><span class="dot"></span><span class="slabel">${s.label}</span></div>`;
    }).join('<span class="sline"></span>')}
    ${branch ? `<div class="step-branch">${branch}</div>` : ''}</div>`;
  }

  function actionsHtml(f, isDev, isDesigner, planExists) {
    const btns = [];
    // 개발자 액션
    if (isDev) {
      if (['spec_draft', 'spec_changes_requested'].includes(f.status)) {
        btns.push(`<button class="btn-ghost" data-act="edit-spec">spec 수정</button>`);
        btns.push(`<button class="btn-primary" data-act="request-review">컨펌 요청</button>`);
      } else if (f.status === 'spec_approved') {
        btns.push(`<button class="btn-ghost" data-act="edit-spec">spec 수정</button>`);
        btns.push(`<button class="btn-primary" data-act="edit-plan">plan 붙여넣기</button>`);
      } else if (f.status === 'plan_drafted') {
        btns.push(`<button class="btn-ghost" data-act="edit-spec">spec 수정</button>`);
        btns.push(`<button class="btn-ghost" data-act="edit-plan">plan 수정</button>`);
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
    on('edit-plan', () => openPlan(f));
    on('request-review', () => doTransition(() => features.requestReview(f.featureId)));
    on('review-spec', () => openDoc(f, 'spec'));
    on('create-pr', () => {
      if (!confirm('Team-MINO-Android(base: develop)에 PR을 생성합니다.\n(mock: 실제 PR 대신 stub 정보)')) return;
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

  // 변경 이력(버전 로그) — 대시보드 자동 관리, 개발자는 사유 편집 가능
  const VER_TAG = {
    init: badge('최초', 'gray'), patch: badge('PATCH', 'blue'),
    minor: badge('MINOR', 'amber'), major: badge('MAJOR', 'red'), graduate: badge('릴리스', 'green'),
  };
  function versionHistoryHtml(f, isDev) {
    let log = f.versionLog || [];
    // 자동 버저닝 이전 스펙: 로그가 없으면 현재 버전을 표시 전용 한 줄로 폴백(편집 불가).
    const legacy = !log.length;
    if (legacy) log = [{ version: f.specVersion || 'v0.1.0', level: 'legacy', at: '', reason: '자동 이력 도입 이전 스펙' }];
    const items = log.map((e, idx) => ({ e, idx })).reverse().map(({ e, idx }) => {
      const tag = VER_TAG[e.level] || badge(e.level === 'legacy' ? '현재' : e.level, 'gray');
      const editBtn = (isDev && !legacy)
        ? `<button class="ver-edit" data-edit-ver="${esc(e.version)}" data-reason="${esc(e.reason || '')}" title="사유 편집">✏️</button>`
        : '';
      // 직전 버전과의 변경분 (첫 버전 제외)
      const prev = idx > 0 ? log[idx - 1] : null;
      const diffBtn = (!legacy && prev)
        ? `<button class="ver-diff" data-diff-from="${esc(prev.version)}" data-diff-to="${esc(e.version)}">변경분</button>`
        : '';
      return `<div class="ver-item">
        <span class="ver-num mono">${esc(e.version)}</span> ${tag}
        <span class="feat-sub">${esc(e.at || '')}</span>${editBtn}${diffBtn}
        <div class="ver-reason">${esc(e.reason || '')}</div>
      </div>`;
    }).join('');
    return `<div class="detail-section"><h3>변경 이력 <span class="feat-sub">(자동)</span></h3>${items}</div>`;
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
    const next = prompt(`변경 사유 (${version})`, current || '');
    if (next == null) return; // 취소
    const r = await features.editVersionReason(f.featureId, version, next.trim());
    if (!r.ok) { alert(r.error); return; }
    if (window.MASC.BACKEND === 'mock') renderAll();
  }

  // ===================== Upload (spec drag-drop + 검증) =====================
  let uploadCtx = null; // { featureId|null, assets:[{name}] }
  function openUpload(f) {
    if (!auth.isDeveloper()) { alert('spec 업로드/수정은 개발자만 가능합니다.'); return; }
    uploadCtx = { featureId: f ? f.featureId : null, assets: f ? (f.assets || []).map((a) => ({ name: a.name, storagePath: a.storagePath || '' })) : [] };
    $('#upload-title').textContent = f ? `spec 수정 · ${f.title}` : '새 스펙 업로드';
    uploadMsg('', false);
    const body = f ? f.specBody : '';
    const figma = f ? (f.figmaSources || []).join('\n') : '';
    $('#upload-body').innerHTML = `
      <div class="paste-help">
        <span>로컬 <code>spec-gen</code> 산출물 <code>spec.md</code> 전문을 붙여넣거나 파일을 드롭하세요.
        첫 줄 <code>&lt;!-- feature: slug --&gt;</code> 주석이 필요합니다.</span>
      </div>
      <div class="upload-grid">
        <div class="upload-editor">
          <div id="dropzone" class="dropzone">spec.md / 이미지 파일을 여기로 drag-drop
            <input type="file" id="file-input" multiple accept=".md,.png,.jpg,.jpeg" hidden />
            <button class="btn-add" type="button" id="btn-pick">파일 선택</button></div>
          <textarea id="up-spec" class="paste-area paste-tall" placeholder="<!-- feature: now-openchat -->\n# 제목\n\n## 1. 한눈에 보기\n...">${esc(body)}</textarea>
          <div class="up-assets-wrap"><div class="lbl">업로드 이미지 (assets/)</div><div id="up-assets" class="up-assets"></div></div>
          <label class="lbl" style="margin-top:8px">출처 Figma URL (줄당 1개)</label>
          <textarea id="up-figma" class="paste-area" style="min-height:54px" placeholder="https://www.figma.com/design/...">${esc(figma)}</textarea>
          <div id="up-errors" class="up-errors"></div>
        </div>
        <div class="upload-preview">
          <div class="lbl">미리보기</div>
          <div id="up-preview" class="md up-preview"></div>
        </div>
      </div>`;
    renderUpAssets();
    wireDropzone();
    $('#up-spec').addEventListener('input', schedulePreview);
    renderPreview();
    openModal('upload-modal');
  }

  // ── 라이브 마크다운 프리뷰 (업로드 모달) ──
  let previewTimer = null;
  const uploadObjUrls = new Set();
  function clearUploadObjUrls() { uploadObjUrls.forEach((u) => URL.revokeObjectURL(u)); uploadObjUrls.clear(); }
  function schedulePreview() { clearTimeout(previewTimer); previewTimer = setTimeout(renderPreview, 180); }
  function renderPreview() {
    const el = $('#up-preview'); if (!el) return;
    clearUploadObjUrls();
    const body = ($('#up-spec') && $('#up-spec').value) || '';
    el.innerHTML = body.trim() ? mdToHtml(body) : '<div class="feat-sub">내용을 입력하면 여기에 렌더됩니다.</div>';
    resolveUploadImgs(el);
  }
  // 프리뷰의 assets/* 이미지 → 새로 드롭한 File(objectURL) 또는 기존 Storage(assetUrl) 로 해석
  function resolveUploadImgs(root) {
    root.querySelectorAll('img').forEach((img) => {
      const raw = img.getAttribute('src') || '';
      const m = raw.match(/^\.?\/?assets\/(.+)$/);
      if (!m) return;
      const name = m[1];
      img.removeAttribute('src');
      img.classList.add('asset-loading');
      const a = (uploadCtx.assets || []).find((x) => x.name === name);
      if (a && a.file) {
        const u = URL.createObjectURL(a.file); uploadObjUrls.add(u);
        img.src = u; img.classList.remove('asset-loading');
      } else if (a && a.storagePath && features.assetUrl && uploadCtx.featureId) {
        Promise.resolve(features.assetUrl(uploadCtx.featureId, name)).then((url) => {
          img.classList.remove('asset-loading');
          if (url) img.src = url; else img.replaceWith(brokenAsset(name));
        });
      } else {
        img.classList.remove('asset-loading'); img.replaceWith(brokenAsset(name));
      }
    });
  }
  function renderUpAssets() {
    const el = $('#up-assets');
    if (!uploadCtx.assets.length) { el.innerHTML = '<span class="feat-sub">없음</span>'; return; }
    el.innerHTML = uploadCtx.assets.map((a, i) =>
      `<span class="asset-chip mono">${esc(a.name)}<button data-rm="${i}" aria-label="삭제">×</button></span>`).join('');
    el.querySelectorAll('button[data-rm]').forEach((b) =>
      b.addEventListener('click', () => { uploadCtx.assets.splice(+b.dataset.rm, 1); renderUpAssets(); }));
    schedulePreview(); // 이미지 추가/삭제 → 프리뷰 재해석
  }
  function addAssets(files) {
    files.forEach((f) => { if (!uploadCtx.assets.some((a) => a.name === f.name)) uploadCtx.assets.push({ name: f.name, file: f }); });
    renderUpAssets();
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
    const files = Array.from(fileList || []);
    const imgs = [];
    files.forEach((file) => {
      if (/\.md$/i.test(file.name)) {
        const reader = new FileReader();
        reader.onload = () => { $('#up-spec').value = reader.result; renderPreview(); };
        reader.readAsText(file);
      } else if (/\.(png|jpe?g)$/i.test(file.name)) {
        imgs.push(file);
      }
    });
    if (imgs.length) addAssets(imgs);
  }
  function uploadMsg(t, err = true) { const el = $('#upload-msg'); el.textContent = t; el.classList.toggle('error', err); }

  async function saveUpload() {
    const specBody = $('#up-spec').value || '';
    if (!specBody.trim()) return uploadMsg('붙여넣은 내용이 없습니다.');
    const assetNames = uploadCtx.assets.map((a) => a.name);
    const res = V.validateSpec(specBody, assetNames);
    const errBox = $('#up-errors');
    if (!res.ok) {
      errBox.innerHTML = '<div class="lbl">구조 검증 실패</div>' +
        res.errors.map((e) => `<div class="up-err"><span class="ecode">${e.code}</span> ${esc(e.msg)}</div>`).join('');
      uploadMsg(`검증 실패 ${res.errors.length}건 — 수정 후 다시 저장하세요.`);
      return;
    }
    errBox.innerHTML = '';
    uploadMsg('저장 중…', false);
    const figmaSources = ($('#up-figma').value || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const r = await features.saveSpec({
      featureId: uploadCtx.featureId, specBody,
      figmaSources, assets: uploadCtx.assets.map((a) => ({ name: a.name, file: a.file || null, storagePath: a.storagePath || '' })),
    });
    if (!r.ok) return uploadMsg(r.error || '저장 실패');
    clearUploadObjUrls();
    closeModal('upload-modal');
    if (r.invalidated) alert('승인된 spec을 수정해 무효화되었습니다 → 작성중으로 복귀, plan은 stale 처리됩니다.');
    select(r.feature.featureId); renderAll();
  }

  // ===================== Plan 붙여넣기 =====================
  let planCtx = null;
  function openPlan(f) {
    planCtx = f.featureId;
    $('#plan-title').textContent = `plan 붙여넣기 · ${f.title}`;
    $('#plan-msg').textContent = '';
    $('#plan-body').innerHTML = `
      <div class="paste-help"><span>레포 체크아웃 안에서 <code>plan-gen</code>으로 생성한 plan.md를 붙여넣으세요
      (<code>## 참고 문서</code> 포함). spec 승인 후에만 가능합니다.</span></div>
      <textarea id="pl-body" class="paste-area paste-tall" placeholder="## 모듈 구성\n## MVI 계약\n...">${esc(f.planBody || '')}</textarea>`;
    openModal('plan-modal');
  }
  async function savePlan() {
    const body = $('#pl-body').value || '';
    if (!body.trim()) { $('#plan-msg').textContent = '내용이 없습니다.'; return; }
    $('#plan-msg').textContent = '저장 중…';
    const r = await features.savePlan(planCtx, body);
    if (!r.ok) { $('#plan-msg').textContent = r.error; return; }
    closeModal('plan-modal'); select(planCtx); renderAll();
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
