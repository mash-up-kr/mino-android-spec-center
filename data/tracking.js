/**
 * MASC Tracking (작업 추적 소스)
 * -------------------------------------------------------------
 * feature별 할당자·진행상태·PR·근거. 자주 바뀌는 데이터.
 * v1에서는 mock 이며, 변경 사항은 store.js가 localStorage에 덮어씁니다.
 * 향후 Cloud Firestore 컬렉션으로 대체됩니다.
 */
window.MASC_TRACKING = {
  '005-now-openchat': {
    specStatus: 'Clarify',
    deliveryStatus: 'InProgress',
    assignee: 'jaesung',
    branch: 'feature/now-openchat',
    prUrl: 'https://github.com/mash-up-kr/Team-MINO-Android/pull/42',
    prNumber: 42,
    evidence: [{ label: '오픈채팅 목록 화면', url: '' }],
    blockedReason: '',
    updatedAt: '2026-06-16',
    updatedBy: 'jaesung',
  },
  '006-now-shorts': {
    specStatus: 'Draft',
    deliveryStatus: 'NotStarted',
    assignee: '',
    branch: '',
    prUrl: '',
    prNumber: null,
    evidence: [],
    blockedReason: '',
    updatedAt: '2026-06-10',
    updatedBy: '',
  },
  '002-home-feed': {
    specStatus: 'Confirmed',
    deliveryStatus: 'Review',
    assignee: 'eunseok',
    branch: 'feature/home-feed',
    prUrl: 'https://github.com/mash-up-kr/Team-MINO-Android/pull/38',
    prNumber: 38,
    evidence: [{ label: '홈 피드 스크린샷', url: '' }],
    blockedReason: '',
    updatedAt: '2026-06-15',
    updatedBy: 'eunseok',
  },
  sample: {
    specStatus: 'Confirmed',
    deliveryStatus: 'Verified',
    assignee: 'yunji',
    branch: 'feature/sample',
    prUrl: '',
    prNumber: null,
    evidence: [],
    blockedReason: '',
    updatedAt: '2026-06-01',
    updatedBy: 'yunji',
  },
};
