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
  const VER = window.MASCVersion;
  const today = () => new Date().toISOString().slice(0, 10);
  const serverTs = () => firebase.firestore.FieldValue.serverTimestamp();
  const arrayUnion = (v) => firebase.firestore.FieldValue.arrayUnion(v);
  const storage = firebase.storage();

  // 새로 드롭된 File 은 Storage(features/{id}/assets/{name})에 올리고 storagePath 를 채운다.
  // 이미 storagePath 가 있는 기존 asset 은 재업로드하지 않는다.
  async function uploadAssets(id, list) {
    const out = [];
    for (const a of (list || [])) {
      if (a.storagePath) { out.push({ name: a.name, storagePath: a.storagePath }); continue; }
      if (a.file) {
        const path = `features/${id}/assets/${a.name}`;
        await storage.ref(path).put(a.file);
        out.push({ name: a.name, storagePath: path });
      } else {
        out.push({ name: a.name, storagePath: '' }); // File 없이 이름만 — 폴백
      }
    }
    return out;
  }

  // spec 본문의 `assets/{name}` 이미지 → Storage 다운로드 URL(토큰 포함) 해석.
  // 결과를 storagePath 기준으로 캐시해 재열람 시 재요청하지 않는다.
  const urlCache = new Map();
  async function assetUrl(featureId, name) {
    const path = `features/${featureId}/assets/${name}`;
    if (urlCache.has(path)) return urlCache.get(path);
    try {
      const url = await storage.ref(path).getDownloadURL();
      urlCache.set(path, url);
      return url;
    } catch (e) {
      console.error('assetUrl', path, e && e.code);
      return '';
    }
  }

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

  // 리다이렉트 로그인 결과 준비 신호 — onAuthStateChanged 가 pendingLogin 을
  // 소비하기 전에 getRedirectResult 가 끝나도록 보장한다.
  let redirectDone;
  const redirectReady = new Promise((res) => { redirectDone = res; });
  fbAuth.getRedirectResult()
    .then((res) => {
      if (res && res.user) {
        const cred = res.credential; // compat: accessToken 포함
        pendingLogin = {
          username: res.additionalUserInfo && res.additionalUserInfo.username,
          token: cred && cred.accessToken,
        };
      }
    })
    .catch((e) => console.error('getRedirectResult', e))
    .finally(() => redirectDone());

  const notifyAuth = () => authCbs.forEach((cb) => cb(current));
  const notifyData = () => dataCbs.forEach((cb) => cb());

  function normalize(id, d) {
    return {
      featureId: id, slug: d.slug || id, title: d.title || id, status: d.status || 'spec_draft',
      planStale: !!d.planStale, specVersion: d.specVersion || '', figmaSources: d.figmaSources || [],
      prNumber: d.prNumber || null, prUrl: d.prUrl || null,
      specBody: d.specBody || '', planBody: d.planBody || null,
      assets: d.assets || [], reviews: d.reviews || [], versionLog: d.versionLog || [],
      createdBy: d.createdBy || '',
    };
  }
  const findCache = (id) => cache.find((f) => f.featureId === id) || null;

  // ---------- auth state ----------
  fbAuth.onAuthStateChanged(async (u) => {
    await redirectReady; // 리다이렉트 로그인 시 pendingLogin 준비 대기
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
    // 프로필 기본 필드 갱신 (토큰은 Firestore 에 저장하지 않는다 — 아래 Secret Manager 경유)
    const data = { name: current.name, githubLogin: login };
    try {
      if (snap && snap.exists) await ref.set(data, { merge: true });
      else await ref.set(Object.assign({ role: null, createdAt: serverTs() }, data), { merge: true });
    } catch (e) { console.error('users.set', e); }
    // GitHub 토큰 → storeGithubToken(callable) → Secret Manager. 로그인을 막지 않는다 —
    // 실패 시 PR 생성 시점의 GITHUB_AUTH 에러가 재로그인을 유도(기존 폴백 경로).
    if (pendingLogin && pendingLogin.token) {
      firebase.functions().httpsCallable('storeGithubToken')({ token: pendingLogin.token })
        .catch((e) => console.error('storeGithubToken', e));
    }
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
        // 팝업이 브라우저에 막히거나 중복 호출되면 리다이렉트로 폴백.
        // 리다이렉트는 페이지를 떠났다가 돌아오며, 결과는 getRedirectResult 가 받는다.
        if (e.code === 'auth/popup-blocked'
          || e.code === 'auth/cancelled-popup-request'
          || e.code === 'auth/operation-not-supported-in-this-environment') {
          try {
            await fbAuth.signInWithRedirect(provider);
            return { ok: true }; // 리다이렉트 진행 — 이 반환값은 사실상 도달 안 함
          } catch (e2) {
            return { ok: false, error: e2.message };
          }
        }
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
    assetUrl,

    async saveSpec(input) {
      if (!auth.isDeveloper()) return { ok: false, error: 'spec 작성은 개발자만 가능합니다.' };
      const m = META.parseMeta(input.specBody);
      const id = input.featureId || m.slug;
      if (!id) return { ok: false, error: 'slug를 찾지 못했습니다.' };
      const ref = db.doc('features/' + id);
      const existing = findCache(id);
      const assets = await uploadAssets(id, input.assets);

      if (!existing) {
        // 버전은 대시보드 소유 — 항상 v0.1.0 시작(0.x→머지 시 1.0.0 승격).
        const initVer = VER.INIT;
        const initLog = [VER.logEntry(initVer, 'init', today(), VER.stripHistory(input.specBody))];
        await ref.set({
          slug: m.slug, title: m.title || id, status: 'spec_draft', planStale: false,
          specVersion: initVer, figmaSources: input.figmaSources || [],
          prNumber: null, prUrl: null, specBody: VER.injectVersionHistory(input.specBody, initLog), planBody: null,
          assets, reviews: [], versionLog: initLog,
          createdBy: current.uid, createdAt: serverTs(), updatedAt: serverTs(),
        });
        return { ok: true, feature: { featureId: id }, created: true };
      }

      // 머지된 스펙 수정도 무효화(major). 버전은 대시보드 소유 — 마크다운값으로 덮지 않음.
      const wasCommitted = ['spec_approved', 'plan_drafted', 'pr_open', 'merged'].includes(existing.status);
      const patch = {
        slug: m.slug || existing.slug, title: m.title || existing.title,
        updatedAt: serverTs(),
      };
      if (input.figmaSources) patch.figmaSources = input.figmaSources;
      if (input.assets) patch.assets = assets;
      let invalidated = false;
      let closePr = null;
      let resultLog = existing.versionLog || [];
      if (wasCommitted) {
        const level = VER.invalidationLevel(existing.status); // minor|major
        patch.specVersion = VER.bump(existing.specVersion, level);
        resultLog = resultLog.concat(VER.logEntry(patch.specVersion, level, today(), VER.stripHistory(input.specBody)));
        patch.versionLog = resultLog;
        patch.status = 'spec_draft'; patch.planStale = true; invalidated = true;
        if (existing.status === 'pr_open' && existing.prNumber) {
          closePr = existing.prNumber;
          patch.prNumber = null; patch.prUrl = null; // 웹훅 매칭 방지 위해 먼저 비운다
        }
      }
      // 저장본에 변경 이력 표 주입(대시보드·커밋 파일 일치)
      patch.specBody = VER.injectVersionHistory(input.specBody, resultLog);
      await ref.update(patch);
      // Firestore 를 먼저 갱신(prNumber=null)한 뒤 실제 GitHub PR close → 웹훅이 매칭 못 해 상태 유지
      if (closePr) {
        try {
          await firebase.functions().httpsCallable('closeSpecPR')(
            { featureId: id, prNumber: closePr, reason: 'spec 수정으로 무효화' });
        } catch (e) { console.error('closeSpecPR 실패(무효화는 진행됨):', e.message); }
      }
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
      const patch = { status: 'spec_in_review', updatedAt: serverTs() };
      // 반려 후 재제출 = PATCH bump. 최초 검토요청은 bump 없음.
      if (f.status === 'spec_changes_requested') {
        patch.specVersion = VER.bump(f.specVersion, 'patch');
        const resultLog = (f.versionLog || []).concat(VER.logEntry(patch.specVersion, 'patch', today(), VER.stripHistory(f.specBody)));
        patch.versionLog = resultLog;
        patch.specBody = VER.injectVersionHistory(f.specBody, resultLog);
      }
      await db.doc('features/' + id).update(patch);
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
        // GitHub 권한/토큰 문제(401/403/404·토큰없음)는 authIssue 로 표시 → 프론트가 안내 모달
        const authIssue = (e.code || '').indexOf('permission-denied') >= 0
          || /GITHUB_AUTH/.test(e.message || '');
        const msg = /GITHUB_AUTH:\s*/.test(e.message || '')
          ? (e.message || '').replace(/^.*GITHUB_AUTH:\s*/, '') : (e.message || 'PR 생성 실패');
        return { ok: false, error: msg, authIssue };
      }
    },

    /** 실 Webhook이 처리하지만, 테스트 편의로 직접 상태를 갱신(개발자). */
    async syncFromWebhook(id, kind) {
      const f = findCache(id); if (!f) return { ok: false, error: 'feature 없음' };
      if (f.status !== 'pr_open') return { ok: false, error: 'PR 열림 상태가 아닙니다.' };
      const patch = { status: kind === 'merged' ? 'merged' : 'pr_closed', updatedAt: serverTs() };
      // 최초 머지 → 0.x 를 v1.0.0 으로 승격
      if (kind === 'merged') {
        const nv = VER.bump(f.specVersion, 'graduate');
        if (nv !== f.specVersion) {
          patch.specVersion = nv;
          const resultLog = (f.versionLog || []).concat(VER.logEntry(nv, 'graduate', today(), VER.stripHistory(f.specBody)));
          patch.versionLog = resultLog;
          patch.specBody = VER.injectVersionHistory(f.specBody, resultLog);
        }
      }
      await db.doc('features/' + id).update(patch);
      return { ok: true, feature: { featureId: id } };
    },

    /** 변경이력 항목 사유 편집(개발자). 최신 매칭 버전의 reason 갱신. */
    async editVersionReason(id, version, reason) {
      const f = findCache(id); if (!f) return { ok: false, error: 'feature 없음' };
      if (!auth.isDeveloper()) return { ok: false, error: '개발자만 편집 가능' };
      const log = (f.versionLog || []).map((e) => ({ ...e }));
      for (let k = log.length - 1; k >= 0; k--) {
        if (log[k].version === version) { log[k].reason = reason; break; }
      }
      // 사유 갱신 후 저장본에도 재주입 → 'spec 보기'·커밋 파일과 일치
      await db.doc('features/' + id).update({
        versionLog: log, specBody: VER.injectVersionHistory(f.specBody, log), updatedAt: serverTs(),
      });
      return { ok: true, feature: { featureId: id } };
    },
  };

  window.MASC = { auth, features, STATUS: ENUMS.status, BACKEND: 'firebase' };
})();
