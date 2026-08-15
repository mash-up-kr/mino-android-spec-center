/**
 * MASC Store (v3) — 데이터 접근 추상화 계층
 * ----------------------------------------------------------------------
 * UI(app.js)는 오직 이 계층을 통해서만 데이터에 접근한다.
 * mock-first: seed(window.MASC_SEED) + localStorage 오버레이.
 * 파이프라인: spec_draft → spec_in_review → spec_approved → pr_open → merged
 *   (plan 검토 단계 폐기 — plan/task 는 base 브랜치 하위 작업으로 분리)
 * 버전은 로컬 `mino-spec` 스킬 소유 — 대시보드는 헤더 값을 읽고 스냅샷만 남긴다.
 */
(function () {
  if (window.MASC) return; // Firebase 백엔드가 이미 설정됐으면 mock 비활성화
  const SESSION_KEY = 'masc.v2.session';
  const FEATURES_KEY = 'masc.v3.features';
  const seed = window.MASC_SEED || { features: [], users: [], enums: {} };

  const STATUS = seed.enums.status || [];
  // KST(UTC+9) 기준 날짜 — UTC 로 찍으면 한국 새벽 0~9시 작업이 전날로 기록된다.
  const today = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

  // ===================== 저장소 =====================
  function loadFeatures() {
    try {
      const raw = localStorage.getItem(FEATURES_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) { /* fallthrough */ }
    // 최초: seed 깊은 복사
    const init = JSON.parse(JSON.stringify(seed.features || []));
    localStorage.setItem(FEATURES_KEY, JSON.stringify(init));
    return init;
  }
  let store = loadFeatures();
  function persist() { localStorage.setItem(FEATURES_KEY, JSON.stringify(store)); }
  function idxOf(id) { return store.findIndex((f) => f.featureId === id); }

  // ===================== Auth (mock GitHub) =====================
  // 실연결: Firebase Auth(GitHub provider) + users/{uid}.role 로 교체.
  const auth = {
    users() { return (seed.users || []).slice(); },
    userOf(uid) { return (seed.users || []).find((u) => u.uid === uid) || null; },
    currentUser() {
      const uid = localStorage.getItem(SESSION_KEY);
      return uid ? this.userOf(uid) : null;
    },
    // mock: uid 선택 = GitHub 로그인 (role은 users 시드에서 결정)
    loginAs(uid) {
      if (!this.userOf(uid)) return { ok: false, error: '알 수 없는 사용자' };
      localStorage.setItem(SESSION_KEY, uid);
      return { ok: true, user: this.userOf(uid) };
    },
    logout() { localStorage.removeItem(SESSION_KEY); },
    isDesigner() { const u = this.currentUser(); return !!u && u.role === 'designer'; },
    isDeveloper() { const u = this.currentUser(); return !!u && u.role === 'developer'; },
    // 통합 인터페이스(firebase 호환) — mock에선 즉시 호출
    onAuthChange(cb) { cb(this.currentUser()); },
    setRole() { return Promise.resolve({ ok: true }); }, // mock 역할은 seed 고정
  };

  // ===================== Features =====================
  const META = window.MASCSpec;
  const VER = window.MASCVersion;

  // 무효화 대상 상태 (승인 이후 = 이미 커밋된 약속)
  const COMMITTED = ['spec_approved', 'pr_open', 'merged'];

  const features = {
    enums() { return seed.enums || {}; },
    meta() { return { project: seed.project, generatedAt: seed.generatedAt }; },
    subscribe() { /* mock: 쓰기 후 app.js가 직접 renderAll (no-op) */ },
    all() { return JSON.parse(JSON.stringify(store)); },
    get(id) { const i = idxOf(id); return i < 0 ? null : JSON.parse(JSON.stringify(store[i])); },

    /** base 브랜치 목록 (실연결: listBaseBranches → GitHub API). mock 은 seed 고정. */
    listBaseBranches() { return Promise.resolve({ ok: true, branches: (seed.baseBranches || []).slice() }); },

    blank() {
      return {
        featureId: '', slug: '', title: '', status: 'spec_draft',
        specVersion: '', specStatus: '', prdVersion: '', baseBranch: '', figmaSources: [],
        prNumber: null, prUrl: null, specBody: '',
        checklistBody: '', checklistStatus: '', checklistTargetVersion: '',
        reviews: [], versionLog: [], createdBy: '', createdAt: today(), updatedAt: today(),
      };
    },

    /** spec + 품질 체크리스트 업로드/생성 또는 수정. validate는 app.js(UI)에서 선행. */
    saveSpec(input) {
      // input: { featureId?, specBody, checklistBody, baseBranch, figmaSources? }
      const m = META.parseMeta(input.specBody);
      const id = input.featureId || m.slug;
      if (!id) return { ok: false, error: '대상 스펙 경로에서 slug를 찾지 못했습니다.' };
      if (!input.baseBranch) return { ok: false, error: 'base 브랜치를 선택하세요 (/issue 로 만든 `…/base`).' };
      const me = auth.currentUser();
      const i = idxOf(id);
      // 버전은 스킬 소유 — 헤더 값을 그대로 쓴다.
      const version = m.specVersion || '';
      const figma = mergeFigma(m.figmaSources, input.figmaSources);
      // 체크리스트는 신규 업로드 필수. 수정 시 새로 첨부하지 않으면 기존 본문을 유지한다.
      const checklistBody = (input.checklistBody && input.checklistBody.trim())
        ? input.checklistBody : (i < 0 ? '' : store[i].checklistBody || '');
      if (i < 0 && !checklistBody) {
        return { ok: false, error: '품질 체크리스트(quality/spec-checklist.md)를 함께 첨부해야 합니다.' };
      }

      if (i < 0) {
        const f = Object.assign(this.blank(), {
          featureId: id, slug: m.slug, title: m.title || id,
          specVersion: version, specStatus: m.specStatus || '', prdVersion: m.prdVersion || '',
          baseBranch: input.baseBranch, specBody: input.specBody, checklistBody,
          figmaSources: figma,
          versionLog: VER.applySnapshot([], version, today(), input.specBody, checklistBody),
          createdBy: me ? me.uid : '', status: 'spec_draft',
        }, checklistFields(checklistBody));
        store.push(f); persist();
        return { ok: true, feature: this.get(id), created: true };
      }

      // 기존 수정 — 무효화 연쇄 판단. 머지된 스펙 수정도 무효화.
      const f = store[i];
      const wasCommitted = COMMITTED.includes(f.status);
      // 승인 이후 본문을 고쳤는데 스킬이 버전을 올리지 않았으면 경고 (하위 문서 추적 근거가 흐려짐)
      const versionStale = wasCommitted && !!version && f.specVersion === version;
      f.slug = m.slug || f.slug;
      f.title = m.title || f.title;
      f.specVersion = version || f.specVersion;
      f.specStatus = m.specStatus || f.specStatus;
      f.prdVersion = m.prdVersion || f.prdVersion;
      f.baseBranch = input.baseBranch;
      f.figmaSources = figma;
      f.specBody = input.specBody;
      f.checklistBody = checklistBody;
      Object.assign(f, checklistFields(checklistBody));
      f.versionLog = VER.applySnapshot(f.versionLog, f.specVersion, today(), input.specBody, checklistBody);
      f.updatedAt = today();

      let invalidated = false;
      if (wasCommitted) {
        // 무효화: spec_draft 복귀 + 열린 PR 자동 close (실연결: closeSpecPR)
        f.status = 'spec_draft';
        if (f.prNumber) f._prAutoClosedAt = today();
        invalidated = true;
      }
      persist();
      return { ok: true, feature: this.get(id), invalidated, versionStale };
    },

    // ---------- 상태 전이 (state-machine.md) ----------
    /** 컨펌 요청: spec_draft|spec_changes_requested → spec_in_review (개발자) */
    requestReview(id) {
      const i = idxOf(id); if (i < 0) return { ok: false, error: 'feature 없음' };
      if (!auth.isDeveloper()) return { ok: false, error: '개발자만 컨펌 요청 가능' };
      const f = store[i];
      if (!['spec_draft', 'spec_changes_requested'].includes(f.status)) {
        return { ok: false, error: `현재 상태(${f.status})에서는 컨펌 요청 불가` };
      }
      f.status = 'spec_in_review'; f.updatedAt = today(); persist();
      return { ok: true, feature: this.get(id) };
    },

    /** 디자이너 승인 → spec_approved */
    approve(id) {
      const i = idxOf(id); if (i < 0) return { ok: false, error: 'feature 없음' };
      if (!auth.isDesigner()) return { ok: false, error: '디자이너만 승인 가능' };
      const f = store[i];
      if (f.status !== 'spec_in_review') return { ok: false, error: '검토 중 상태가 아닙니다.' };
      f.status = 'spec_approved';
      f.reviews.push(review('approved', []));
      f.updatedAt = today(); persist();
      return { ok: true, feature: this.get(id) };
    },

    /** 디자이너 반려 + 코멘트 → spec_changes_requested */
    requestChanges(id, comments) {
      const i = idxOf(id); if (i < 0) return { ok: false, error: 'feature 없음' };
      if (!auth.isDesigner()) return { ok: false, error: '디자이너만 반려 가능' };
      const list = (comments || []).filter((c) => c && c.body && c.body.trim());
      if (!list.length) return { ok: false, error: '반려 시 코멘트가 1개 이상 필요합니다.' };
      const f = store[i];
      if (f.status !== 'spec_in_review') return { ok: false, error: '검토 중 상태가 아닙니다.' };
      f.status = 'spec_changes_requested';
      f.reviews.push(review('changes_requested', list));
      f.updatedAt = today(); persist();
      return { ok: true, feature: this.get(id) };
    },

    /** 추가 코멘트 (상태 변화 없음). 반려됨/검토중에서 디자이너가 보충 코멘트. decision='comment' */
    addComments(id, comments) {
      const i = idxOf(id); if (i < 0) return { ok: false, error: 'feature 없음' };
      if (!auth.isDesigner()) return { ok: false, error: '디자이너만 코멘트 가능' };
      const list = (comments || []).filter((c) => c && c.body && c.body.trim());
      if (!list.length) return { ok: false, error: '코멘트가 1개 이상 필요합니다.' };
      const f = store[i];
      if (!['spec_changes_requested', 'spec_in_review'].includes(f.status)) {
        return { ok: false, error: '코멘트를 추가할 수 있는 상태가 아닙니다.' };
      }
      f.reviews.push(review('comment', list));
      f.updatedAt = today(); persist();
      return { ok: true, feature: this.get(id) };
    },

    /** PR 생성 (spec_approved → pr_open). mock: stub PR 정보. 실연결: createSpecPR. */
    createPr(id) {
      const i = idxOf(id); if (i < 0) return { ok: false, error: 'feature 없음' };
      if (!auth.isDeveloper()) return { ok: false, error: '개발자만 PR 생성 가능' };
      const f = store[i];
      if (f.status !== 'spec_approved') return { ok: false, error: 'spec 승인(spec_approved) 후에만 PR 생성 가능' };
      if (!f.baseBranch) return { ok: false, error: 'base 브랜치가 지정되지 않았습니다. spec 수정에서 선택하세요.' };
      const n = 100 + Math.floor(Math.random() * 900); // stub
      f.status = 'pr_open';
      f.prNumber = n;
      f.prUrl = `https://github.com/mash-up-kr/Team-MINO-Android/pull/${n}`;
      f.updatedAt = today(); persist();
      return { ok: true, feature: this.get(id), stub: true };
    },

    /** Webhook 역동기화 (mock: 수동 트리거). merged | pr_closed */
    syncFromWebhook(id, kind) {
      const i = idxOf(id); if (i < 0) return { ok: false, error: 'feature 없음' };
      const f = store[i];
      if (f.status !== 'pr_open') return { ok: false, error: 'PR 열림 상태가 아닙니다.' };
      f.status = kind === 'merged' ? 'merged' : 'pr_closed';
      f.updatedAt = today(); persist();
      return { ok: true, feature: this.get(id) };
    },

    /** 스냅샷 메모 편집(개발자). 최신 매칭 버전의 reason 갱신. */
    editVersionReason(id, version, reason) {
      const i = idxOf(id); if (i < 0) return { ok: false, error: 'feature 없음' };
      if (!auth.isDeveloper()) return { ok: false, error: '개발자만 편집 가능' };
      const f = store[i];
      const log = f.versionLog || [];
      for (let k = log.length - 1; k >= 0; k--) {
        if (log[k].version === version) { log[k].reason = reason; break; }
      }
      f.updatedAt = today(); persist();
      return { ok: true, feature: this.get(id) };
    },
  };

  // 체크리스트 헤더 메타 → 저장 필드. 본문이 비면 필드도 비운다(레거시 문서 호환).
  function checklistFields(body) {
    if (!body || !body.trim()) return { checklistStatus: '', checklistTargetVersion: '' };
    const c = META.parseChecklistMeta(body);
    return { checklistStatus: c.status || '', checklistTargetVersion: c.targetVersion || '' };
  }

  // 본문에서 뽑은 Figma 링크 + 수기 입력을 합친다 (중복 제거, 본문 우선)
  function mergeFigma(fromBody, manual) {
    const out = [];
    (fromBody || []).concat(manual || []).forEach((u) => {
      const v = String(u || '').trim();
      if (v && out.indexOf(v) < 0) out.push(v);
    });
    return out;
  }

  function review(decision, comments) {
    const me = auth.currentUser();
    return {
      reviewId: 'r' + Date.now(),
      decision, comments: comments || [],
      reviewerUid: me ? me.uid : '', reviewedAt: today(),
    };
  }

  // ===================== PRD (P8) =====================
  // spec 의 상위 문서. 프로젝트당 1개(싱글턴)이고 컨펌 게이트가 없다 — status 필드도 없다.
  // 설계: docs/design/prd-track.md
  const PRD_KEY = 'masc.v3.prd';
  const PRD_ID = 'business-context';
  const PRDP = window.MASCPrd;

  function loadPrd() {
    try {
      const raw = localStorage.getItem(PRD_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) { /* fallthrough */ }
    const init = seed.prd ? JSON.parse(JSON.stringify(seed.prd)) : null;
    if (init) localStorage.setItem(PRD_KEY, JSON.stringify(init));
    return init;
  }
  let prdStore = loadPrd();
  function persistPrd() { localStorage.setItem(PRD_KEY, JSON.stringify(prdStore)); }
  const clone = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));

  // 저장 문서에서 본문 스냅샷·댓글을 뺀 메타만 노출 (firebase 어댑터와 같은 모양)
  function prdView(d) {
    if (!d) return null;
    const { versions, comments, ...meta } = d;
    return clone(meta);
  }

  let msgSeq = 0;
  const nextMsgId = () => 'm' + Date.now() + '-' + (++msgSeq);

  const prd = {
    id: PRD_ID,
    get() { return prdView(prdStore); },
    subscribe() { /* mock: 쓰기 후 app.js 가 직접 renderAll (no-op) */ },
    versionIndex() { return prdStore ? clone(prdStore.versionIndex || []) : []; },
    /** 버전 본문은 지연 로드 — 목록 렌더에는 본문이 필요 없다(firebase 는 서브컬렉션 1건 읽기). */
    versionBody(version) {
      const v = prdStore && prdStore.versions ? prdStore.versions[version] : null;
      return Promise.resolve(v == null ? null : v);
    },

    /**
     * 업로드/개정. 검증(validatePrd)은 app.js 가 선행한다.
     * @param input { body, expectedVersion } — expectedVersion 은 낙관적 잠금(동시 업로드 방지)
     */
    save(input) {
      if (!auth.isDeveloper()) return Promise.resolve({ ok: false, error: 'PRD 업로드는 개발자만 가능합니다.' });
      const body = String((input && input.body) || '');
      if (!body.trim()) return Promise.resolve({ ok: false, error: 'PRD 본문이 비어 있습니다.' });
      const m = PRDP.parseMeta(body);
      if (!m.version) return Promise.resolve({ ok: false, error: '헤더 표에서 버전을 찾지 못했습니다.' });
      const me = auth.currentUser();
      const cur = prdStore;

      // 낙관적 잠금 — 내가 받아본 버전이 그 사이 바뀌었으면 덮어쓰지 않는다.
      const expected = input && input.expectedVersion;
      if (cur && expected !== undefined && expected !== null && cur.version !== expected) {
        return Promise.resolve({
          ok: false, conflict: true,
          error: `그 사이 PRD 가 ${cur.version} 로 갱신됐습니다. 최신본을 받아 다시 개정해 주세요.`,
        });
      }

      const level = cur ? VER.levelBetween(cur.version, m.version) : 'init';
      const base = {
        prdId: PRD_ID,
        title: m.title || (cur ? cur.title : PRD_ID),
        version: m.version,
        body,
        createdDate: m.createdDate || (cur ? cur.createdDate : ''),
        lastAmendedDate: m.lastAmendedDate || today(),
        prdAuthor: m.prdAuthor || (cur ? cur.prdAuthor : ''),
        lastAmendedAuthor: m.lastAmendedAuthor || '',
        itemIds: m.goalIds || [],
        uploadedBy: me ? me.uid : '',
        updatedAt: today(),
      };

      if (!cur) {
        prdStore = Object.assign(base, {
          createdAt: today(),
          versionIndex: [{ version: m.version, level: 'init', at: today(), reason: '', uploadedBy: base.uploadedBy }],
          versions: { [m.version]: body },
          comments: [],
        });
        persistPrd();
        return Promise.resolve({ ok: true, prd: prdView(prdStore), created: true, level: 'init' });
      }

      Object.assign(cur, base);
      cur.versions = cur.versions || {};
      cur.versions[m.version] = body;
      const idx = cur.versionIndex || (cur.versionIndex = []);
      const last = idx[idx.length - 1];
      if (last && last.version === m.version) {
        last.at = today();                    // 같은 버전 재업로드 = 스냅샷만 갱신
      } else {
        idx.push({ version: m.version, level, at: today(), reason: '', uploadedBy: base.uploadedBy });
      }
      persistPrd();
      return Promise.resolve({ ok: true, prd: prdView(prdStore), created: false, level });
    },

    editVersionReason(version, reason) {
      if (!auth.isDeveloper()) return Promise.resolve({ ok: false, error: '개발자만 편집 가능' });
      if (!prdStore) return Promise.resolve({ ok: false, error: 'PRD 없음' });
      const idx = prdStore.versionIndex || [];
      for (let k = idx.length - 1; k >= 0; k--) {
        if (idx[k].version === version) { idx[k].reason = reason; break; }
      }
      persistPrd();
      return Promise.resolve({ ok: true });
    },

    // ---------- 댓글 — 로그인한 누구나 (요구사항 ②) ----------
    comments: {
      list() {
        if (!prdStore) return [];
        return clone(prdStore.comments || []).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      },
      post(input) {
        const me = auth.currentUser();
        if (!me) return Promise.resolve({ ok: false, error: '로그인이 필요합니다.' });
        if (!prdStore) return Promise.resolve({ ok: false, error: 'PRD 가 아직 등록되지 않았습니다.' });
        const body = String((input && input.body) || '').trim();
        if (!body) return Promise.resolve({ ok: false, error: '내용을 입력하세요.' });
        prdStore.comments = prdStore.comments || [];
        prdStore.comments.push({
          msgId: nextMsgId(), body,
          authorUid: me.uid, authorRole: me.role || '',
          anchor: (input && input.anchor) || null,
          replyTo: (input && input.replyTo) || null,
          mentions: mentionsOf(body),
          deleted: false,
          createdAt: new Date().toISOString(), updatedAt: null,
        });
        persistPrd();
        return Promise.resolve({ ok: true });
      },
      edit(msgId, body) {
        const me = auth.currentUser();
        const c = (prdStore && prdStore.comments || []).find((x) => x.msgId === msgId);
        if (!c) return Promise.resolve({ ok: false, error: '댓글 없음' });
        if (!me || c.authorUid !== me.uid) return Promise.resolve({ ok: false, error: '작성자만 수정할 수 있습니다.' });
        const next = String(body || '').trim();
        if (!next) return Promise.resolve({ ok: false, error: '내용을 입력하세요.' });
        c.body = next; c.mentions = mentionsOf(next); c.updatedAt = new Date().toISOString();
        persistPrd();
        return Promise.resolve({ ok: true });
      },
      remove(msgId) {
        const me = auth.currentUser();
        const c = (prdStore && prdStore.comments || []).find((x) => x.msgId === msgId);
        if (!c) return Promise.resolve({ ok: false, error: '댓글 없음' });
        if (!me || c.authorUid !== me.uid) return Promise.resolve({ ok: false, error: '작성자만 삭제할 수 있습니다.' });
        c.deleted = true; c.body = ''; c.updatedAt = new Date().toISOString();  // 소프트 삭제 — 순서 보존
        persistPrd();
        return Promise.resolve({ ok: true });
      },
    },
  };

  // 본문에서 `@handle` 추출 (알림 대상 · v1 은 표시용)
  function mentionsOf(body) {
    const out = [];
    const re = /@([A-Za-z0-9_-]{2,39})/g;
    let m;
    while ((m = re.exec(String(body || ''))) !== null) {
      if (out.indexOf(m[1]) < 0) out.push(m[1]);
    }
    return out;
  }

  window.MASC = { auth, features, prd, STATUS, BACKEND: 'mock' };
})();
