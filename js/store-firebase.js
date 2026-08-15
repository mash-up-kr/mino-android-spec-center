/**
 * MASC Store — Firebase 백엔드 (v3)
 * ----------------------------------------------------------------------
 * window.MASC_FIREBASE.enabled === true 일 때만 활성화되어 window.MASC 를 설정한다.
 * mock(store.js)과 동일한 인터페이스를 노출하되:
 *   - features.all()/get() 은 onSnapshot 실시간 캐시에서 동기 반환 (app.js 무수정)
 *   - 쓰기 메서드는 Promise 반환 (app.js 가 await)
 *   - auth.onAuthChange(cb) / features.subscribe(cb) 로 재렌더 구동
 * reviews 는 MVP 단계에서 feature 문서의 배열 필드로 보관(서브컬렉션 전환은 후속).
 * plan 검토 단계·이미지(assets) 업로드는 폐기 — 화면 근거는 spec 본문의 Figma 링크.
 */
(function () {
  if (!window.MASC_FIREBASE || !window.MASC_FIREBASE.enabled) return;
  if (window.MASC) return; // 이미 설정됐으면(이론상 없음) 건너뜀

  firebase.initializeApp(window.MASC_FIREBASE.config);
  const fbAuth = firebase.auth();
  const db = firebase.firestore();
  const META = window.MASCSpec;
  const VER = window.MASCVersion;
  // 체크리스트 헤더 메타 → 저장 필드. 본문이 비면 필드도 비운다(레거시 문서 호환).
  const checklistFields = (body) => {
    if (!body || !body.trim()) return { checklistStatus: '', checklistTargetVersion: '' };
    const c = META.parseChecklistMeta(body);
    return { checklistStatus: c.status || '', checklistTargetVersion: c.targetVersion || '' };
  };
  // KST(UTC+9) 기준 날짜 — UTC 로 찍으면 한국 새벽 0~9시 작업이 전날로 기록된다.
  const today = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const serverTs = () => firebase.firestore.FieldValue.serverTimestamp();
  const arrayUnion = (v) => firebase.firestore.FieldValue.arrayUnion(v);

  const ENUMS = {
    status: ['spec_draft', 'spec_in_review', 'spec_changes_requested', 'spec_approved',
      'pr_open', 'merged', 'pr_closed'],
    role: ['developer', 'designer'],
  };

  // 무효화 대상 상태 (승인 이후 = 이미 커밋된 약속)
  const COMMITTED = ['spec_approved', 'pr_open', 'merged'];

  // 본문에서 뽑은 Figma 링크 + 수기 입력 병합 (중복 제거, 본문 우선)
  function mergeFigma(fromBody, manual) {
    const out = [];
    (fromBody || []).concat(manual || []).forEach((u) => {
      const v = String(u || '').trim();
      if (v && out.indexOf(v) < 0) out.push(v);
    });
    return out;
  }

  let cache = [];            // features 캐시
  let usersCache = [];       // users 캐시 (리뷰어 이름 표시용)
  let prdCache = null;       // PRD 싱글턴 캐시 (본문 스냅샷 제외 — versions/ 는 지연 로드)
  let prdCommentsCache = []; // PRD 댓글 캐시
  let current = null;        // { uid, name, githubLogin, role }
  let pendingLogin = null;   // 팝업 로그인 직후 { username, token }
  const authCbs = [], dataCbs = [];
  let unsubFeatures = null, unsubUsers = null, unsubPrd = null, unsubPrdComments = null;

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
      specVersion: d.specVersion || '', specStatus: d.specStatus || '', prdVersion: d.prdVersion || '',
      baseBranch: d.baseBranch || '', figmaSources: d.figmaSources || [],
      prNumber: d.prNumber || null, prUrl: d.prUrl || null,
      specBody: d.specBody || '',
      checklistBody: d.checklistBody || '',
      checklistStatus: d.checklistStatus || '', checklistTargetVersion: d.checklistTargetVersion || '',
      reviews: d.reviews || [], versionLog: d.versionLog || [],
      createdBy: d.createdBy || '',
    };
  }
  const findCache = (id) => cache.find((f) => f.featureId === id) || null;

  // ---------- auth state ----------
  fbAuth.onAuthStateChanged(async (u) => {
    await redirectReady; // 리다이렉트 로그인 시 pendingLogin 준비 대기
    if (!u) {
      current = null; cache = []; prdCache = null; prdCommentsCache = [];
      if (unsubFeatures) { unsubFeatures(); unsubFeatures = null; }
      if (unsubUsers) { unsubUsers(); unsubUsers = null; }
      if (unsubPrd) { unsubPrd(); unsubPrd = null; }
      if (unsubPrdComments) { unsubPrdComments(); unsubPrdComments = null; }
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
    // PRD 는 싱글턴 문서 1건 + 댓글 서브컬렉션. 버전 본문 스냅샷은 구독하지 않는다(지연 로드).
    if (!unsubPrd) {
      unsubPrd = prdRef().onSnapshot(
        (s) => { prdCache = s.exists ? normalizePrd(s.data()) : null; notifyData(); },
        (err) => console.error('prd.snapshot', err)
      );
    }
    if (!unsubPrdComments) {
      unsubPrdComments = db.collection(`prds/${PRD_ID}/comments`).orderBy('createdAt').onSnapshot(
        (qs) => {
          prdCommentsCache = qs.docs.map((d) => {
            const c = d.data();
            const ts = c.createdAt && c.createdAt.toDate ? c.createdAt.toDate().toISOString() : '';
            return Object.assign({}, c, { msgId: d.id, createdAt: ts });
          });
          notifyData();
        },
        (err) => console.error('prd.comments.snapshot', err)
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

    /** `/issue` 가 만든 `…/base` 브랜치 목록 (Functions → GitHub API) */
    async listBaseBranches() {
      try {
        const res = await firebase.functions().httpsCallable('listBaseBranches')({});
        return { ok: true, branches: (res.data && res.data.branches) || [] };
      } catch (e) {
        const msg = /GITHUB_AUTH:\s*/.test(e.message || '')
          ? (e.message || '').replace(/^.*GITHUB_AUTH:\s*/, '') : (e.message || 'base 브랜치 조회 실패');
        return { ok: false, error: msg, branches: [] };
      }
    },

    async saveSpec(input) {
      if (!auth.isDeveloper()) return { ok: false, error: 'spec 작성은 개발자만 가능합니다.' };
      const m = META.parseMeta(input.specBody);
      const id = input.featureId || m.slug;
      if (!id) return { ok: false, error: '대상 스펙 경로에서 slug를 찾지 못했습니다.' };
      if (!input.baseBranch) return { ok: false, error: 'base 브랜치를 선택하세요 (/issue 로 만든 `…/base`).' };
      const ref = db.doc('features/' + id);
      const existing = findCache(id);
      // 버전 소유권은 mino-spec 스킬 — 헤더 값을 그대로 반영한다.
      const version = m.specVersion || '';
      const figma = mergeFigma(m.figmaSources, input.figmaSources);
      // 체크리스트는 신규 업로드 필수. 수정 시 새로 첨부하지 않으면 기존 본문을 유지한다.
      const checklistBody = (input.checklistBody && input.checklistBody.trim())
        ? input.checklistBody : (existing ? existing.checklistBody : '');
      if (!existing && !checklistBody) {
        return { ok: false, error: '품질 체크리스트(quality/spec-checklist.md)를 함께 첨부해야 합니다.' };
      }

      if (!existing) {
        await ref.set(Object.assign({
          slug: m.slug, title: m.title || id, status: 'spec_draft',
          specVersion: version, specStatus: m.specStatus || '', prdVersion: m.prdVersion || '',
          baseBranch: input.baseBranch, figmaSources: figma,
          prNumber: null, prUrl: null, specBody: input.specBody, checklistBody,
          reviews: [], versionLog: VER.applySnapshot([], version, today(), input.specBody, checklistBody),
          createdBy: current.uid, createdAt: serverTs(), updatedAt: serverTs(),
        }, checklistFields(checklistBody)));
        return { ok: true, feature: { featureId: id }, created: true };
      }

      // 승인 이후(머지 포함) 수정은 무효화 — spec_draft 복귀 + 열린 PR close.
      const wasCommitted = COMMITTED.includes(existing.status);
      const nextVersion = version || existing.specVersion;
      const patch = Object.assign({
        slug: m.slug || existing.slug, title: m.title || existing.title,
        specVersion: nextVersion,
        specStatus: m.specStatus || existing.specStatus,
        prdVersion: m.prdVersion || existing.prdVersion,
        baseBranch: input.baseBranch,
        figmaSources: figma,
        specBody: input.specBody,
        checklistBody,
        versionLog: VER.applySnapshot(existing.versionLog, nextVersion, today(), input.specBody, checklistBody),
        updatedAt: serverTs(),
      }, checklistFields(checklistBody));
      let invalidated = false;
      let closePr = null;
      // 승인 이후 본문을 고쳤는데 스킬이 버전을 올리지 않았으면 경고
      const versionStale = wasCommitted && !!version && existing.specVersion === version;
      if (wasCommitted) {
        patch.status = 'spec_draft'; invalidated = true;
        if (existing.status === 'pr_open' && existing.prNumber) {
          closePr = existing.prNumber;
          patch.prNumber = null; patch.prUrl = null; // 웹훅 매칭 방지 위해 먼저 비운다
        }
      }
      await ref.update(patch);
      // Firestore 를 먼저 갱신(prNumber=null)한 뒤 실제 GitHub PR close → 웹훅이 매칭 못 해 상태 유지
      if (closePr) {
        try {
          await firebase.functions().httpsCallable('closeSpecPR')(
            { featureId: id, prNumber: closePr, reason: 'spec 수정으로 무효화' });
        } catch (e) { console.error('closeSpecPR 실패(무효화는 진행됨):', e.message); }
      }
      return { ok: true, feature: { featureId: id }, invalidated, versionStale };
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
      if (f.status !== 'spec_approved') return { ok: false, error: 'spec 승인(spec_approved) 후에만 PR 생성 가능' };
      if (!f.baseBranch) return { ok: false, error: 'base 브랜치가 지정되지 않았습니다. spec 수정에서 선택하세요.' };
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
      await db.doc('features/' + id).update({
        status: kind === 'merged' ? 'merged' : 'pr_closed', updatedAt: serverTs(),
      });
      return { ok: true, feature: { featureId: id } };
    },

    /** 스냅샷 메모 편집(개발자). 최신 매칭 버전의 reason 갱신. */
    async editVersionReason(id, version, reason) {
      const f = findCache(id); if (!f) return { ok: false, error: 'feature 없음' };
      if (!auth.isDeveloper()) return { ok: false, error: '개발자만 편집 가능' };
      const log = (f.versionLog || []).map((e) => ({ ...e }));
      for (let k = log.length - 1; k >= 0; k--) {
        if (log[k].version === version) { log[k].reason = reason; break; }
      }
      await db.doc('features/' + id).update({ versionLog: log, updatedAt: serverTs() });
      return { ok: true, feature: { featureId: id } };
    },
  };

  // ===================== PRD (P8) =====================
  // spec 의 상위 문서. 싱글턴 `prds/business-context` + versions/ · comments/ 서브컬렉션.
  // 컨펌 게이트가 없어 status 필드도 없다. 설계: docs/design/prd-track.md
  const PRD_ID = 'business-context';
  const PRDP = window.MASCPrd;
  const prdRef = () => db.doc('prds/' + PRD_ID);

  // 본문 스냅샷은 versions/{version} 서브컬렉션에 두고, 부모 문서에는 **메타만**
  // (`versionIndex`) 담는다 — 목록 렌더에 본문을 내려받지 않기 위한 분리다.
  function normalizePrd(d) {
    return {
      prdId: PRD_ID,
      title: d.title || '', version: d.version || '', body: d.body || '',
      createdDate: d.createdDate || '', lastAmendedDate: d.lastAmendedDate || '',
      prdAuthor: d.prdAuthor || '', lastAmendedAuthor: d.lastAmendedAuthor || '',
      itemIds: d.itemIds || [], versionIndex: d.versionIndex || [],
      uploadedBy: d.uploadedBy || '',
    };
  }

  const prd = {
    id: PRD_ID,
    get() { return prdCache ? JSON.parse(JSON.stringify(prdCache)) : null; },
    subscribe(cb) { dataCbs.push(cb); },
    versionIndex() { return prdCache ? JSON.parse(JSON.stringify(prdCache.versionIndex || [])) : []; },

    /** 버전 본문 지연 로드 — diff 를 열 때 필요한 두 건만 읽는다. */
    async versionBody(version) {
      try {
        const s = await db.doc(`prds/${PRD_ID}/versions/${version}`).get();
        return s.exists ? (s.data().body || '') : null;
      } catch (e) { console.error('prd.versionBody', e); return null; }
    },

    /**
     * 업로드/개정. 검증(validatePrd)은 app.js 가 선행한다.
     * 부모 문서 갱신 + 스냅샷 생성을 **트랜잭션**으로 묶고, `expectedVersion` 으로
     * 낙관적 잠금을 건다 — PRD 는 싱글턴이라 두 개발자가 동시에 올리면 실제로 덮어쓴다.
     */
    async save(input) {
      if (!auth.isDeveloper()) return { ok: false, error: 'PRD 업로드는 개발자만 가능합니다.' };
      const body = String((input && input.body) || '');
      if (!body.trim()) return { ok: false, error: 'PRD 본문이 비어 있습니다.' };
      const m = PRDP.parseMeta(body);
      if (!m.version) return { ok: false, error: '헤더 표에서 버전을 찾지 못했습니다.' };
      const expected = input && input.expectedVersion;
      const uid = current ? current.uid : '';

      try {
        const result = await db.runTransaction(async (tx) => {
          const snap = await tx.get(prdRef());
          const cur = snap.exists ? snap.data() : null;
          if (cur && expected !== undefined && expected !== null && (cur.version || '') !== expected) {
            return { conflict: true, current: cur.version || '' };
          }
          const level = cur ? VER.levelBetween(cur.version || '', m.version) : 'init';
          const index = (cur && cur.versionIndex ? cur.versionIndex.map((e) => Object.assign({}, e)) : []);
          const last = index[index.length - 1];
          if (last && last.version === m.version) last.at = today();
          else index.push({ version: m.version, level, at: today(), reason: '', uploadedBy: uid });

          const data = {
            title: m.title || (cur && cur.title) || PRD_ID,
            version: m.version,
            body,
            createdDate: m.createdDate || (cur && cur.createdDate) || '',
            lastAmendedDate: m.lastAmendedDate || today(),
            prdAuthor: m.prdAuthor || (cur && cur.prdAuthor) || '',
            lastAmendedAuthor: m.lastAmendedAuthor || '',
            itemIds: m.goalIds || [],
            versionIndex: index,
            uploadedBy: uid,
            updatedAt: serverTs(),
          };
          if (!cur) data.createdAt = serverTs();
          tx.set(prdRef(), data, { merge: true });
          // 스냅샷은 버전 문자열을 문서 id 로 — 같은 버전 중복 생성이 구조적으로 불가능하다.
          tx.set(db.doc(`prds/${PRD_ID}/versions/${m.version}`),
            { version: m.version, body, at: today(), uploadedBy: uid });
          return { created: !cur, level };
        });
        if (result.conflict) {
          return {
            ok: false, conflict: true,
            error: `그 사이 PRD 가 ${result.current} 로 갱신됐습니다. 최신본을 받아 다시 개정해 주세요.`,
          };
        }
        return { ok: true, created: result.created, level: result.level };
      } catch (e) {
        return { ok: false, error: e.message || 'PRD 저장 실패' };
      }
    },

    async editVersionReason(version, reason) {
      if (!auth.isDeveloper()) return { ok: false, error: '개발자만 편집 가능' };
      if (!prdCache) return { ok: false, error: 'PRD 없음' };
      const index = (prdCache.versionIndex || []).map((e) => Object.assign({}, e));
      for (let k = index.length - 1; k >= 0; k--) {
        if (index[k].version === version) { index[k].reason = reason; break; }
      }
      await prdRef().update({ versionIndex: index, updatedAt: serverTs() });
      return { ok: true };
    },

    // ---------- 댓글 — 로그인한 누구나 (요구사항 ②) ----------
    comments: {
      list() { return prdCommentsCache.map((c) => JSON.parse(JSON.stringify(c))); },
      async post(input) {
        if (!current) return { ok: false, error: '로그인이 필요합니다.' };
        const body = String((input && input.body) || '').trim();
        if (!body) return { ok: false, error: '내용을 입력하세요.' };
        try {
          await db.collection(`prds/${PRD_ID}/comments`).add({
            body,
            authorUid: current.uid, authorRole: current.role || '',
            anchor: (input && input.anchor) || null,
            replyTo: (input && input.replyTo) || null,
            mentions: mentionsOf(body),
            deleted: false,
            createdAt: serverTs(), updatedAt: null,
          });
          return { ok: true };
        } catch (e) { return { ok: false, error: e.message || '댓글 등록 실패' }; }
      },
      async edit(msgId, body) {
        const next = String(body || '').trim();
        if (!next) return { ok: false, error: '내용을 입력하세요.' };
        try {
          await db.doc(`prds/${PRD_ID}/comments/${msgId}`)
            .update({ body: next, mentions: mentionsOf(next), updatedAt: serverTs() });
          return { ok: true };
        } catch (e) { return { ok: false, error: '작성자만 수정할 수 있습니다.' }; }
      },
      async remove(msgId) {
        try {
          // 소프트 삭제 — 타임라인 순서를 보존한다(하드 delete 는 규칙에서 차단).
          await db.doc(`prds/${PRD_ID}/comments/${msgId}`)
            .update({ deleted: true, body: '', updatedAt: serverTs() });
          return { ok: true };
        } catch (e) { return { ok: false, error: '작성자만 삭제할 수 있습니다.' }; }
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

  window.MASC = { auth, features, prd, STATUS: ENUMS.status, BACKEND: 'firebase' };
})();
