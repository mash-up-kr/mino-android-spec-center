/**
 * MASC Store — 데이터 접근 추상화 계층
 * -------------------------------------------------------------
 * UI(app.js)는 오직 이 계층을 통해서만 데이터에 접근한다.
 * v1: mock(window.MASC_*) + localStorage.
 * 추후: 이 파일의 auth/tracking 구현만 Firebase Auth/Firestore로 교체하면
 *       app.js 는 손대지 않아도 된다.
 */
(function () {
  const SESSION_KEY = 'masc.session';
  const TRACKING_OVERRIDE_KEY = 'masc.tracking.overrides';

  // --- 팀 멤버 (추후 Firebase Auth 사용자로 대체) ---
  const MEMBERS = [
    { uid: 'jaesung', name: '재성', role: 'Android', email: 'jaesung@mino.team' },
    { uid: 'eunseok', name: '은석', role: 'Android', email: 'eunseok@mino.team' },
    { uid: 'yunji', name: '윤지', role: 'Android', email: 'yunji@mino.team' },
    { uid: 'designer', name: '디자이너', role: 'Design', email: 'designer@mino.team' },
  ];

  // ===================== Auth (mock) =====================
  const auth = {
    members() {
      return MEMBERS.slice();
    },
    memberOf(uid) {
      return MEMBERS.find((m) => m.uid === uid) || null;
    },
    currentUser() {
      const uid = localStorage.getItem(SESSION_KEY);
      return uid ? this.memberOf(uid) : null;
    },
    /** mock: 등록된 이메일 + 아무 비밀번호(1자 이상)면 성공 */
    login(email, password) {
      const member = MEMBERS.find((m) => m.email.toLowerCase() === String(email).trim().toLowerCase());
      if (!member) return { ok: false, error: '등록되지 않은 이메일입니다.' };
      if (!password) return { ok: false, error: '비밀번호를 입력하세요.' };
      localStorage.setItem(SESSION_KEY, member.uid);
      return { ok: true, user: member };
    },
    logout() {
      localStorage.removeItem(SESSION_KEY);
    },
  };

  // ===================== Features (작성/편집 가능) =====================
  // seed(window.MASC_FEATURE_LIST) 위에 draft(localStorage)를 얹는다.
  // 추후 draft 저장소를 Firestore로 교체하면 된다.
  const FEATURES_KEY = 'masc.features.drafts';
  const seed = window.MASC_FEATURE_LIST || { features: [], modules: [], enums: {} };

  function loadDrafts() {
    try {
      return JSON.parse(localStorage.getItem(FEATURES_KEY) || '{}');
    } catch {
      return {};
    }
  }
  function saveDrafts(d) {
    localStorage.setItem(FEATURES_KEY, JSON.stringify(d));
  }
  let drafts = loadDrafts();

  const MODULE_NAMES = {};
  (seed.modules || []).forEach((m) => { MODULE_NAMES[m.id] = m.name; });

  const features = {
    enums() {
      return seed.enums || {};
    },
    /** seed.features + draft 을 id 기준으로 병합 (draft 우선) */
    all() {
      const map = new Map();
      (seed.features || []).forEach((f) => map.set(f.id, f));
      Object.values(drafts).forEach((f) => map.set(f.id, f));
      return [...map.values()];
    },
    get(id) {
      return drafts[id] || (seed.features || []).find((f) => f.id === id) || null;
    },
    /** 현재 feature들에서 모듈 목록을 동적으로 산출 (이름은 seed 기준, 없으면 id) */
    modules() {
      const ids = new Set((seed.modules || []).map((m) => m.id));
      this.all().forEach((f) => { if (f.module) ids.add(f.module); });
      return [...ids].map((id) => ({ id, name: MODULE_NAMES[id] || id }));
    },
    /** 빈 스펙 템플릿 */
    blank() {
      return {
        id: '', title: '', module: '', type: 'Screen', trigger: '', behavior: '',
        designRef: { figmaNode: '', url: '' },
        acceptanceCriteria: [], tbds: [], tasks: [], relatedFeatures: [],
        nonGoals: [], states: [],
        planMd: '', tasksMd: '',
        sources: { spec: '', plan: '', tasks: '' },
        origin: 'draft',
      };
    },
    /** draft 저장(생성/수정 공통) */
    save(feature) {
      drafts[feature.id] = Object.assign({ origin: 'draft' }, feature);
      saveDrafts(drafts);
      return drafts[feature.id];
    },
    isDraft(id) {
      return Object.prototype.hasOwnProperty.call(drafts, id);
    },
    meta() {
      return { project: seed.project, generatedAt: seed.generatedAt };
    },
  };

  // ===================== Tracking (mock + localStorage) =====================
  function loadOverrides() {
    try {
      return JSON.parse(localStorage.getItem(TRACKING_OVERRIDE_KEY) || '{}');
    } catch {
      return {};
    }
  }
  function saveOverrides(o) {
    localStorage.setItem(TRACKING_OVERRIDE_KEY, JSON.stringify(o));
  }

  const base = window.MASC_TRACKING || {};
  const overrides = loadOverrides();

  function defaults() {
    return {
      specStatus: 'Draft',
      deliveryStatus: 'NotStarted',
      assignee: '',
      branch: '',
      prUrl: '',
      prNumber: null,
      evidence: [],
      blockedReason: '',
      tasksDone: {}, // { taskId: true } — 태스크 체크리스트 완료 여부 (live 추적)
      updatedAt: '',
      updatedBy: '',
    };
  }

  const tracking = {
    get(featureId) {
      return Object.assign(defaults(), base[featureId] || {}, overrides[featureId] || {});
    },
    /** 단일 필드 변경 → localStorage 반영 (추후 Firestore write로 교체) */
    update(featureId, patch) {
      const cur = overrides[featureId] || {};
      const me = auth.currentUser();
      overrides[featureId] = Object.assign({}, cur, patch, {
        updatedBy: me ? me.uid : '',
        updatedAt: new Date().toISOString().slice(0, 10),
      });
      saveOverrides(overrides);
      return this.get(featureId);
    },
    setAssignee(featureId, uid) {
      return this.update(featureId, { assignee: uid });
    },
    setSpecStatus(featureId, status) {
      return this.update(featureId, { specStatus: status });
    },
    setDeliveryStatus(featureId, status) {
      return this.update(featureId, { deliveryStatus: status });
    },
    toggleTask(featureId, taskId, done) {
      const cur = this.get(featureId).tasksDone || {};
      const next = Object.assign({}, cur);
      if (done) next[taskId] = true; else delete next[taskId];
      return this.update(featureId, { tasksDone: next });
    },
  };

  window.MASC = { auth, features, tracking };
})();
