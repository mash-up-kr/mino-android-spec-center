/**
 * MASC Store (v2) — 데이터 접근 추상화 계층
 * ----------------------------------------------------------------------
 * UI(app.js)는 오직 이 계층을 통해서만 데이터에 접근한다.
 * mock-first: seed(window.MASC_SEED) + localStorage 오버레이.
 * 이후 이 파일의 auth/features 구현만 Firebase Auth/Firestore로 교체하면
 * app.js는 손대지 않는다 (docs/data-model.md · state-machine.md).
 */
(function () {
  if (window.MASC) return; // Firebase 백엔드가 이미 설정됐으면 mock 비활성화
  const SESSION_KEY = 'masc.v2.session';
  const FEATURES_KEY = 'masc.v2.features';
  const seed = window.MASC_SEED || { features: [], users: [], enums: {} };

  const STATUS = seed.enums.status || [];
  const today = () => new Date().toISOString().slice(0, 10);

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

  const features = {
    enums() { return seed.enums || {}; },
    meta() { return { project: seed.project, generatedAt: seed.generatedAt }; },
    subscribe() { /* mock: 쓰기 후 app.js가 직접 renderAll (no-op) */ },
    all() { return JSON.parse(JSON.stringify(store)); },
    get(id) { const i = idxOf(id); return i < 0 ? null : JSON.parse(JSON.stringify(store[i])); },
    // mock: Storage 없음 — seed의 data:/http URL 이면 그대로, 아니면 미해석('').
    assetUrl(featureId, name) {
      const f = store[idxOf(featureId)];
      const a = f && (f.assets || []).find((x) => x.name === name);
      return Promise.resolve(a && /^(data:|https?:)/.test(a.storagePath || '') ? a.storagePath : '');
    },

    blank() {
      return {
        featureId: '', slug: '', title: '', status: 'spec_draft',
        planStale: false, specVersion: '', figmaSources: [],
        prNumber: null, prUrl: null, specBody: '', planBody: null,
        assets: [], reviews: [], versionLog: [], createdBy: '', createdAt: today(), updatedAt: today(),
      };
    },

    /** spec 업로드/생성 또는 수정. validate는 app.js(UI)에서 선행. */
    saveSpec(input) {
      // input: { featureId?, specBody, figmaSources?, assets? }
      const m = META.parseMeta(input.specBody);
      const id = input.featureId || m.slug;
      if (!id) return { ok: false, error: 'slug를 찾지 못했습니다.' };
      const me = auth.currentUser();
      const i = idxOf(id);

      if (i < 0) {
        // 신규 생성 → spec_draft. 버전은 대시보드 소유 — 항상 v0.1.0 시작(0.x→머지 시 1.0.0 승격).
        const initVer = VER.INIT;
        const initLog = [VER.logEntry(initVer, 'init', today(), VER.stripHistory(input.specBody))];
        const f = Object.assign(this.blank(), {
          featureId: id, slug: m.slug, title: m.title || id,
          specVersion: initVer, specBody: VER.injectVersionHistory(input.specBody, initLog),
          figmaSources: input.figmaSources || [], assets: (input.assets || []).map((a) => ({ name: a.name, storagePath: a.storagePath || '' })),
          versionLog: initLog,
          createdBy: me ? me.uid : '', status: 'spec_draft',
        });
        store.push(f); persist();
        return { ok: true, feature: this.get(id), created: true };
      }

      // 기존 수정 — 무효화 연쇄 판단. 머지된 스펙 수정도 무효화(major).
      const f = store[i];
      const wasCommitted = ['spec_approved', 'plan_drafted', 'pr_open', 'merged'].includes(f.status);
      f.slug = m.slug || f.slug;
      f.title = m.title || f.title;
      // 버전은 대시보드 소유 — 마크다운 파싱값으로 덮지 않음(bump만 반영)
      if (input.figmaSources) f.figmaSources = input.figmaSources;
      if (input.assets) f.assets = input.assets.map((a) => ({ name: a.name, storagePath: a.storagePath || '' }));
      f.updatedAt = today();

      let invalidated = false;
      if (wasCommitted) {
        // 무효화: 버전 bump(minor/major) + spec_draft 복귀 + planStale + 열린 PR 자동 close
        const level = VER.invalidationLevel(f.status);
        f.specVersion = VER.bump(f.specVersion, level);
        f.versionLog = (f.versionLog || []).concat(VER.logEntry(f.specVersion, level, today(), VER.stripHistory(input.specBody)));
        f.status = 'spec_draft';
        f.planStale = true;
        if (f.prNumber) {
          f.reviews = f.reviews || [];
          // 실연결: createSpecPR가 연 PR을 close + 새 버전 링크 코멘트
          f._prAutoClosedAt = today();
        }
        invalidated = true;
      } else if (f.status === 'spec_changes_requested') {
        // 반려 후 수정은 draft로 되돌릴 필요 없음(재요청 가능) — 상태 유지. bump은 재제출 시(requestReview).
      }
      // 저장본에 변경 이력 표 주입(업로드 원본의 수기 표 대체 → 대시보드·커밋 파일 일치)
      f.specBody = VER.injectVersionHistory(input.specBody, f.versionLog);
      persist();
      return { ok: true, feature: this.get(id), invalidated };
    },

    /** plan 붙여넣기 (spec_approved 후) → plan_drafted */
    savePlan(id, planBody) {
      const i = idxOf(id);
      if (i < 0) return { ok: false, error: 'feature 없음' };
      const f = store[i];
      if (!['spec_approved', 'plan_drafted'].includes(f.status)) {
        return { ok: false, error: 'plan은 spec 승인(spec_approved) 후에만 작성할 수 있습니다.' };
      }
      f.planBody = planBody;
      f.planStale = false;
      if (f.status === 'spec_approved') f.status = 'plan_drafted';
      f.updatedAt = today();
      persist();
      return { ok: true, feature: this.get(id) };
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
      // 반려 후 재제출 = PATCH bump (승인 전 반복 라운드). 최초 검토요청은 bump 없음.
      if (f.status === 'spec_changes_requested') {
        f.specVersion = VER.bump(f.specVersion, 'patch');
        f.versionLog = (f.versionLog || []).concat(VER.logEntry(f.specVersion, 'patch', today(), VER.stripHistory(f.specBody)));
        f.specBody = VER.injectVersionHistory(f.specBody, f.versionLog);
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

    /** PR 생성 (plan_drafted → pr_open). mock: stub PR 정보. 실연결: createSpecPR. */
    createPr(id) {
      const i = idxOf(id); if (i < 0) return { ok: false, error: 'feature 없음' };
      if (!auth.isDeveloper()) return { ok: false, error: '개발자만 PR 생성 가능' };
      const f = store[i];
      if (f.status !== 'plan_drafted') return { ok: false, error: 'plan 작성(plan_drafted) 후에만 PR 생성 가능' };
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
      // 최초 머지 → 0.x 를 v1.0.0 으로 승격(코드 착지 = 릴리스)
      if (kind === 'merged') {
        const nv = VER.bump(f.specVersion, 'graduate');
        if (nv !== f.specVersion) {
          f.specVersion = nv;
          f.versionLog = (f.versionLog || []).concat(VER.logEntry(nv, 'graduate', today(), VER.stripHistory(f.specBody)));
          f.specBody = VER.injectVersionHistory(f.specBody, f.versionLog);
        }
      }
      f.updatedAt = today(); persist();
      return { ok: true, feature: this.get(id) };
    },

    /** 변경이력 항목 사유 편집(개발자). 최신 매칭 버전의 reason 갱신. */
    editVersionReason(id, version, reason) {
      const i = idxOf(id); if (i < 0) return { ok: false, error: 'feature 없음' };
      if (!auth.isDeveloper()) return { ok: false, error: '개발자만 편집 가능' };
      const f = store[i];
      const log = f.versionLog || [];
      for (let k = log.length - 1; k >= 0; k--) {
        if (log[k].version === version) { log[k].reason = reason; break; }
      }
      // 사유 갱신 후 저장본에도 재주입 → 'spec 보기'·커밋 파일과 일치
      f.specBody = VER.injectVersionHistory(f.specBody, log);
      f.updatedAt = today(); persist();
      return { ok: true, feature: this.get(id) };
    },
  };

  function review(decision, comments) {
    const me = auth.currentUser();
    return {
      reviewId: 'r' + Date.now(),
      decision, comments: comments || [],
      reviewerUid: me ? me.uid : '', reviewedAt: today(),
    };
  }

  window.MASC = { auth, features, STATUS, BACKEND: 'mock' };
})();
