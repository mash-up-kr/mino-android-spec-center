/**
 * MASC Feature List (생성물 / 읽기 전용)
 * -------------------------------------------------------------
 * 향후 docs/specs/<feature>/{spec,plan,tasks}.md 를 파싱하는
 * 생성기(generate-feature-list)의 산출물로 대체됩니다.
 * v1에서는 손으로 작성한 mock 데이터입니다.
 *
 * 스펙(무엇/왜/어떻게)만 담습니다. 할당자·진행상태 등 "작업 추적"은
 * tracking.js(=추후 Firestore)에서 별도로 관리합니다.
 */
window.MASC_FEATURE_LIST = {
  schemaVersion: 1,
  project: 'Team-MINO-Android',
  generatedAt: '2026-06-17',
  enums: {
    specStatus: ['Draft', 'Clarify', 'Confirmed'],
    deliveryStatus: ['NotStarted', 'Ready', 'InProgress', 'Review', 'Verified', 'Blocked'],
    type: ['Screen', 'Component', 'Infra'],
  },
  modules: [
    { id: 'feature:now', name: '지금(Now)' },
    { id: 'feature:home', name: '홈(Home)' },
    { id: 'feature:sample', name: '샘플(Sample)' },
  ],
  features: [
    {
      id: '005-now-openchat',
      title: '지금 - 오픈채팅 목록',
      module: 'feature:now',
      type: 'Screen',
      trigger: '"지금" 탭의 오픈채팅 세그먼트 진입',
      behavior:
        '참여 중인 오픈채팅방을 핀 고정 우선 + 최근 활동 순으로 표시하고, 항목 탭 시 채팅방으로 진입한다. 안읽음은 300 초과 시 "300+"로 표기.',
      designRef: {
        figmaNode: '2001-0001',
        url: 'https://www.figma.com/design/xxxx?node-id=2001-0001',
      },
      acceptanceCriteria: [
        { id: 'AC1', text: '진입 시 목록을 1초 이내 표시, 실패 시 재시도 UI' },
        { id: 'AC2', text: '정렬: 핀 고정 방 최상단 → 마지막 메시지 시각 내림차순' },
        { id: 'AC3', text: '안읽음 카운트 300 초과 시 "300+" 표기' },
        { id: 'AC7', text: '오픈채팅 탭에 전체 안읽음 합산 뱃지 표시' },
        { id: 'AC11', text: '새 메시지 수신 시 해당 방 상단 이동 + 안읽음 +1' },
      ],
      tbds: [
        { id: 'TBD-1', question: '인라인 광고 삽입 주기 N = ?', resolver: '기획' },
        { id: 'TBD-2', question: '실시간 갱신 = 폴링 / WebSocket / FCM?', resolver: '서버' },
        { id: 'TBD-3', question: '페이징 페이지 크기 = 20?', resolver: '기획' },
      ],
      tasks: [
        { id: 'T2', title: 'GetOpenChatRoomsUseCase(페이징) + 테스트', module: ':core:domain' },
        { id: 'T8', title: 'ChatRoomItem 컴포넌트', module: ':core:design-system' },
        { id: 'T12', title: 'NowViewModel (MVI)', module: ':feature:now:impl' },
        { id: 'T15', title: '오픈채팅 리스트 화면', module: ':feature:now:impl' },
      ],
      relatedFeatures: ['006-now-shorts'],
      sources: {
        spec: 'docs/specs/005-now-openchat/spec.md',
        plan: 'docs/specs/005-now-openchat/plan.md',
        tasks: 'docs/specs/005-now-openchat/tasks.md',
      },
    },
    {
      id: '006-now-shorts',
      title: '지금 - 숏폼',
      module: 'feature:now',
      type: 'Screen',
      trigger: '"지금" 탭의 숏폼 세그먼트 진입',
      behavior: '숏폼 콘텐츠를 세로 스와이프로 탐색한다.',
      designRef: { figmaNode: '2002-0001', url: '' },
      acceptanceCriteria: [{ id: 'AC1', text: '세로 스와이프로 다음/이전 숏폼 전환' }],
      tbds: [{ id: 'TBD-1', question: '자동재생 정책 = ?', resolver: '기획' }],
      tasks: [],
      relatedFeatures: ['005-now-openchat'],
      sources: { spec: 'docs/specs/006-now-shorts/spec.md', plan: '', tasks: '' },
    },
    {
      id: '002-home-feed',
      title: '홈 피드',
      module: 'feature:home',
      type: 'Screen',
      trigger: '앱 진입 시 첫 화면',
      behavior: '홈 피드를 표시한다.',
      designRef: { figmaNode: '1001-0001', url: '' },
      acceptanceCriteria: [{ id: 'AC1', text: '피드 로딩 1초 이내' }],
      tbds: [],
      tasks: [{ id: 'T1', title: 'HomeViewModel', module: ':feature:home:impl' }],
      relatedFeatures: [],
      sources: {
        spec: 'docs/specs/002-home-feed/spec.md',
        plan: 'docs/specs/002-home-feed/plan.md',
        tasks: 'docs/specs/002-home-feed/tasks.md',
      },
    },
    {
      id: 'sample',
      title: 'Sample (데모/레퍼런스)',
      module: 'feature:sample',
      type: 'Screen',
      trigger: '아키텍처 검증용 데모 진입',
      behavior:
        '상태 전이(Idle→Loading→Success/Error)와 feature 간/내 네비게이션, 1회성 SideEffect 처리 패턴을 시연한다.',
      designRef: { figmaNode: '', url: '' },
      acceptanceCriteria: [
        { id: 'AC2', text: '"팀원 소개 완료" → Loading 후 Success 목록 표시' },
        { id: 'AC4', text: '"에러 강제 발생" → Loading 후 Error 표시' },
      ],
      tbds: [],
      tasks: [{ id: 'T10', title: 'SampleViewModel : MviContainer', module: ':feature:sample:impl' }],
      relatedFeatures: [],
      sources: {
        spec: 'docs/specs/sample/spec.md',
        plan: 'docs/specs/sample/plan.md',
        tasks: 'docs/specs/sample/tasks.md',
      },
    },
  ],
};
