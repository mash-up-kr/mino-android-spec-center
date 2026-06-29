/**
 * MASC Store — Firebase 백엔드 (v2)
 * ----------------------------------------------------------------------
 * window.MASC_FIREBASE.enabled === true 일 때만 활성화되어 window.MASC 를 설정한다.
 * mock(store.js)과 동일한 인터페이스를 노출하되:
 *   - features.all()/get() 은 onSnapshot 실시간 캐시에서 동기 반환 (app.js 무수정)
 *   - 쓰기 메서드는 Promise 반환 (app.js 가 await)
 *   - auth.onAuthChange(cb) / features.subscribe(cb) 로 재렌더 구동
 * reviews 는 MVP 단계에서 feature 문서의 배열 필드로 보관(서브컬렉션 전환은 후속).
 */
(function () {
  if (!window.MASC_FIREBASE || !window.MASC_FIREBASE.enabled) return;
  if (window.MASC) return; // 이미 설정됐으면(이론상 없음) 건너뜀

  firebase.initializeApp(window.MASC_FIREBASE.config);
  const fbAuth = firebase.auth();
  const db = firebase.firestore();
  const META = window.MASCSpec;
  const today = () => new Date().toISOString().slice(0, 10);
  const serverTs = () => firebase.firestore.FieldValue.serverTimestamp();
  const arrayUnion = (v) => firebase.firestore.FieldValue.arrayUnion(v);

  const ENUMS = {
    status: ['spec_draft', 'spec_in_review', 'spec_changes_requested', 'spec_approved',
      'plan_drafted', 'pr_open', 'merged', 'pr_closed'],
    role: ['developer', 'designer'],
    interactionType: ['display_state', 'user_action', 'navigation', 'async_process', 'validation', 'modal_dialog'],
    confirm: ['confirmed', 'partial', 'needs_policy'],
  };

  let cache = [];            // features 캐시
  let usersCache = [];       // users 캐시 (리뷰어 이름 표시용)
  let current = null;        // { uid, name, githubLogin, role }
  let pendingLogin = null;   // 팝업 로그인 직후 { username, token }
  const authCbs = [], dataCbs = [];
  let unsubFeatures = null, unsubUsers = null;

  const notifyAuth = () => authCbs.forEach((cb) => cb(current));
  const notifyData = () => dataCbs.forEach((cb) => cb());

  function normalize(id, d) {
    return {
      featureId: id, slug: d.slug || id, title: d.title || id, status: d.status || 'spec_draft',
      planStale: !!d.planStale, specVersion: d.specVersion || '', figmaSources: d.figmaSources || [],
      prNumber: d.prNumber || null, prUrl: d.prUrl || null,
      specBody: d.specBody || '', planBody: d.planBody || null,
      assets: d.assets || [], reviews: d.reviews || [], createdBy: d.createdBy || '',
    };
  }
  const findCache = (id) => cache.find((f) => f.featureId === id) || null;

  // ---------- auth state ----------
  fbAuth.onAuthStateChanged(async (u) => {
    if (!u) {
      current = null; cache = [];
      if (unsubFeatures) { unsubFeatures(); unsubFeatures = null; }
      if (unsubUsers) { unsubUsers(); unsubUsers = null; }
      notifyAuth(); return;
    }
    const ref = db.doc('users/' + u.uid);
    let snap;
    try { snap = await ref.get(); } catch (e) { console.error('users.get', e); }
    const role = snap && snap.exists ? (snap.data().role || null) : null;
    const login = (pendingLogin && pendingLogin.username)
      || (snap && snap.exists && snap.data().githubLogin)
      || (u.email ? u.email.split('@')[0] : u.uid);
    current = {
      uid: u.uid,
      name: u.displayName || login,
      githubLogin: login,
      role,
    };
    // 프로필 기본 필드 + (있으면) GitHub 토큰 갱신
    const data = { name: current.name, githubLogin: login };
    if (pendingLogin && pendingLogin.token) data.githubToken = pendingLogin.token;
    try {
      if (snap && snap.exists) await ref.set(data, { merge: true });
      else await ref.set(Object.assign({ role: null, createdAt: serverTs() }, data), { merge: true });
    } catch (e) { console.error('users.set', e); }
    pendingLogin = null;
    subscribeAll();
    notifyAuth();
  });

  function subscribeAll() {
    if (!unsubFeatures) {
      unsubFeatures = db.collection('features').onSnapshot(
        (qs) => { cache = qs.docs.map((d) => normalize(d.id, d.data())); notifyData(); },
        (err) => console.error('features.snapshot', err)
      );
    }
    if (!unsubUsers) {
      unsubUsers = db.collection('users').onSnapshot(
        (qs) => { usersCache = qs.docs.map((d) => Object.assign({ uid: d.id }, d.data())); notifyData(); },
        (err) => console.error('users.snapshot', err)
      );
    }
  }

  // ===================== auth =====================
  const auth = {
    users() { return usersCache.slice(); },
    userOf(uid) {
      if (current && current.uid === uid) return current;
      return usersCache.find((u) => u.uid === uid) || null;
    },
    currentUser() { return current; },
    isDeveloper() { return !!current && current.role === 'developer'; },
    isDesigner() { return !!current && current.role === 'designer'; },
    onAuthChange(cb) { authCbs.push(cb); if (current !== undefined) cb(current); },
    async loginGithub() {
      const provider = new firebase.auth.GithubAuthProvider();
      provider.addScope('read:user'); // 식별용. PR 권한은 GitHub App 설치 권한에서 옴.
      try {
        const res = await fbAuth.signInWithPopup(provider);
        const cred = res.credential; // compat: 결과의 credential 에 accessToken 포함
        pendingLogin = {
          username: res.additionalUserInfo && res.additionalUserInfo.username,
          token: cred && cred.accessToken,
        };
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
    async setRole(role) {
      if (!current) return { ok: false, error: '로그인 필요' };
      if (!ENUMS.role.includes(role)) return { ok: false, error: '잘못된 역할' };
      await db.doc('users/' + current.uid).set({ role }, { merge: true });
      current.role = role; notifyAuth();
      return { ok: true };
    },
    logout() { return fbAuth.signOut(); },
    // mock 호환용(미사용)
    loginAs() { return { ok: false, error: 'Firebase 모드에서는 GitHub 로그인 사용' }; },
  };

  // ===================== features =====================
  function reviewObj(decision, comments) {
    return {
      reviewId: 'r' + Date.now(), decision, comments: comments || [],
      reviewerUid: current ? current.uid : '', reviewedAt: today(),
    };
  }

  const features = {
    enums() { return ENUMS; },
    meta() { return { project: 'Team-MINO-Android', generatedAt: 'live(Firestore)' }; },
    all() { return cache.map((f) => JSON.parse(JSON.stringify(f))); },
    get(id) { const f = findCache(id); return f ? JSON.parse(JSON.stringify(f)) : null; },
    subscribe(cb) { dataCbs.push(cb); },

    async saveSpec(input) {
      if (!auth.isDeveloper()) return { ok: false, error: 'spec 작성은 개발자만 가능합니다.' };
      const m = META.parseMeta(input.specBody);
      const id = input.featureId || m.slug;
      if (!id) return { ok: false, error: 'slug를 찾지 못했습니다.' };
      const ref = db.doc('features/' + id);
      const existing = findCache(id);
      const assets = (input.assets || []).map((a) => ({ name: a.name, storagePath: a.storagePath || '' }));

      if (!existing) {
        await ref.set({
          slug: m.slug, title: m.title || id, status: 'spec_draft', planStale: false,
          specVersion: m.specVersion || '', figmaSources: input.figmaSources || [],
          prNumber: null, prUrl: null, specBody: input.specBody, planBody: null,
          assets, reviews: [], createdBy: current.uid,
          createdAt: serverTs(), updatedAt: serverTs(),
        });
        return { ok: true, feature: { featureId: id }, created: true };
      }

      const wasApprovedOrLater = ['spec_approved', 'plan_drafted', 'pr_open'].includes(existing.status);
      const patch = {
        slug: m.slug || existing.slug, title: m.title || existing.title,
        specVersion: m.specVersion || existing.specVersion, specBody: input.specBody,
        updatedAt: serverTs(),
      };
      if (input.figmaSources) patch.figmaSources = input.figmaSources;
      if (input.assets) patch.assets = assets;
      let invalidated = false;
      if (wasApprovedOrLater) {
        patch.status = 'spec_draft'; patch.planStale = true; invalidated = true;
        // TODO: 열린 PR 자동 close 는 createSpecPR/Function 연계 후 (M4)
      }
      await ref.update(patch);
      return { ok: true, feature: { featureId: id }, invalidated };
    },

    async savePlan(id, planBody) {
      const f = findCache(id); if (!f) return { ok: false, error: 'feature 없음' };
      if (!auth.isDeveloper()) return { ok: false, error: '개발자만 가능' };
      if (!['spec_approved', 'plan_drafted'].includes(f.status)) {
        return { ok: false, error: 'plan은 spec 승인 후에만 작성할 수 있습니다.' };
      }
      const patch = { planBody, planStale: false, updatedAt: serverTs() };
      if (f.status === 'spec_approved') patch.status = 'plan_drafted';
      await db.doc('features/' + id).update(patch);
      return { ok: true, feature: { featureId: id } };
    },

    async requestReview(id) {
      const f = findCache(id); if (!f) return { ok: false, error: 'feature 없음' };
      if (!auth.isDeveloper()) return { ok: false, error: '개발자만 컨펌 요청 가능' };
      if (!['spec_draft', 'spec_changes_requested'].includes(f.status)) {
        return { ok: false, error: `현재 상태(${f.status})에서는 컨펌 요청 불가` };
      }
      await db.doc('features/' + id).update({ status: 'spec_in_review', updatedAt: serverTs() });
      return { ok: true, feature: { featureId: id } };
    },

    async approve(id) {
      const f = findCache(id); if (!f) return { ok: false, error: 'feature 없음' };
      if (!auth.isDesigner()) return { ok: false, error: '디자이너만 승인 가능' };
      if (f.status !== 'spec_in_review') return { ok: false, error: '검토 중 상태가 아닙니다.' };
      await db.doc('features/' + id).update({
        status: 'spec_approved', reviews: arrayUnion(reviewObj('approved', [])), updatedAt: serverTs(),
      });
      return { ok: true, feature: { featureId: id } };
    },

    async requestChanges(id, comments) {
      const f = findCache(id); if (!f) return { ok: false, error: 'feature 없음' };
      if (!auth.isDesigner()) return { ok: false, error: '디자이너만 반려 가능' };
      const list = (comments || []).filter((c) => c && c.body && c.body.trim());
      if (!list.length) return { ok: false, error: '반려 시 코멘트가 1개 이상 필요합니다.' };
      if (f.status !== 'spec_in_review') return { ok: false, error: '검토 중 상태가 아닙니다.' };
      await db.doc('features/' + id).update({
        status: 'spec_changes_requested', reviews: arrayUnion(reviewObj('changes_requested', list)), updatedAt: serverTs(),
      });
      return { ok: true, feature: { featureId: id } };
    },

    async addComments(id, comments) {
      const f = findCache(id); if (!f) return { ok: false, error: 'feature 없음' };
      if (!auth.isDesigner()) return { ok: false, error: '디자이너만 코멘트 가능' };
      const list = (comments || []).filter((c) => c && c.body && c.body.trim());
      if (!list.length) return { ok: false, error: '코멘트가 1개 이상 필요합니다.' };
      if (!['spec_changes_requested', 'spec_in_review'].includes(f.status)) {
        return { ok: false, error: '코멘트를 추가할 수 있는 상태가 아닙니다.' };
      }
      await db.doc('features/' + id).update({
        reviews: arrayUnion(reviewObj('comment', list)), updatedAt: serverTs(),
      });
      return { ok: true, feature: { featureId: id } };
    },

    /** PR 생성 → Cloud Function createSpecPR 호출 (개발자 명의). 함수 미배포면 에러. */
    async createPr(id) {
      const f = findCache(id); if (!f) return { ok: false, error: 'feature 없음' };
      if (!auth.isDeveloper()) return { ok: false, error: '개발자만 PR 생성 가능' };
      if (f.status !== 'plan_drafted') return { ok: false, error: 'plan 작성 후에만 PR 생성 가능' };
      try {
        const fn = firebase.functions().httpsCallable('createSpecPR');
        const res = await fn({ featureId: id });
        return { ok: true, feature: { featureId: id }, pr: res.data };
      } catch (e) {
        return { ok: false, error: 'PR 생성 실패(Function): ' + e.message };
      }
    },

    /** 실 Webhook이 처리하지만, 테스트 편의로 직접 상태를 갱신(개발자). */
    async syncFromWebhook(id, kind) {
      const f = findCache(id); if (!f) return { ok: false, error: 'feature 없음' };
      if (f.status !== 'pr_open') return { ok: false, error: 'PR 열림 상태가 아닙니다.' };
      await db.doc('features/' + id).update({
        status: kind === 'merged' ? 'merged' : 'pr_closed', updatedAt: serverTs(),
      });
      return { ok: true, feature: { featureId: id } };
    },
  };

  window.MASC = { auth, features, STATUS: ENUMS.status, BACKEND: 'firebase' };
})();
