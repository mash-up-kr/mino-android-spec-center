# 작업 체크리스트 (v2 전면 재설계)

> 출처: [mino_spec.md](../../mino_prd/mino_spec.md) 8장 마일스톤
> 설계: [state-machine.md](state-machine.md) · [data-model.md](data-model.md) · [validation.md](validation.md)
> 진행 원칙: 문서/설계 → 프론트 전면 재작성(mock-first) → Firebase/Functions 실연결.
> M0–M4 = MVP (8개 상태 전부 도달·전이 완결).

범례: `[ ]` 미착수 · `[~]` 진행중 · `[x]` 완료 · `(ops)` 코드 아닌 운영작업 · `(BE)` Cloud Functions

---

## 0. 설계 (선행) — 완료
- [x] 파이프라인 상태머신 명세 (state-machine.md)
- [x] 데이터 모델 (Firestore/Storage) (data-model.md)
- [x] 붙여넣기 구조 검증 명세 S1–S6 (validation.md)
- [x] 본 체크리스트 (roadmap.md)
- [x] 구 문서 정리 (spec-scc-format.md 제거)

## 프론트 재작성 골격 (mock-first, Firebase 없이 동작) — 완료
> store.js 추상화 계층 유지 → 이후 Firebase 어댑터로 교체 시 app.js 무수정 목표.
- [x] data seed 교체 — feature-list.js·tracking.js 제거, seed.js(신 모델 2개 데모)
- [x] `js/store.js` 재작성 — features(8상태)·reviews·users(role)·mock auth, localStorage, 전이/무효화 로직
- [x] `js/spec-parse.js` — slug 주석·title·specVersion 추출(본문 비파싱)
- [x] `js/validate.js` — S1–S6 구조 검증 `validateSpec(body, assetNames)`
- [x] `index.html` — 로그인(GitHub mock)·헤더/KPI·목록·상세·모달 재구성
- [x] `js/app.js` — 8상태 렌더·role 분기·업로드·컨펌 게이트·PR(stub)
- [x] `styles.css` — 파이프라인 스텝퍼·업로드 dropzone·리뷰 코멘트 UI
- [x] 로컬 미리보기 동작 확인 (브라우저 확인 완료)
- [x] 디자이너 업로드 차단 (개발자만 spec 작성)
- [x] spec 미리보기 인라인 코멘트(섹션 앵커) + 개별 삭제 + IME Enter 가드
- [x] 반려 후 보충 코멘트(decision=`comment`, 상태변화 없음)

---

## M0 · 기반 인프라
### 코드 — 스캐폴딩 완료, 어댑터/SDK 연결 남음
- [x] 인프라 실등록 플레이북 (docs/infra-playbook.md)
- [x] `firestore.rules` / `storage.rules` (role·검토중 잠금 1차 가드)
- [x] `firebase.json` / `.firebaserc`(project id 플레이스홀더)
- [x] Cloud Functions 스켈레톤 — `githubOAuthExchange`/`createSpecPR`/`githubWebhook` (functions/)
- [x] `js/firebase-config.js` 플레이스홀더 (enabled 플래그)
- [x] Firebase 클라이언트 SDK(compat CDN) 로드 + 초기화
- [x] `store-firebase.js` 어댑터 (onSnapshot 캐시로 sync 인터페이스 유지) · mock과 플래그 전환
- [x] GitHub 로그인(팝업) + `users.role` 온보딩(역할 선택 모달)
- [ ] (M3) 개발자 App authorize 토큰으로 PR — createPr는 Function 연결, 토큰 검증 남음
### ops (7장 플레이북 — admin 직접 실행, docs/infra-playbook.md)
- [x] (ops) A. GitHub App 등록 → App ID/Client ID/Secret/Webhook secret
- [x] (ops) B-1. Firebase 프로젝트 + **Blaze** + Auth(GitHub)/Firestore/Storage + webConfig
- [x] (ops) B-2. firebase-config.js 채움 · secrets 등록 · rules/functions 배포
- [~] (ops) C. Webhook URL 역기입 + PR 라운드트립 확인 — **웹훅 URL 역기입·HMAC ping 204 확인 완료**, 전체 PR 라운드트립(pr_open→merged)은 M3(PR 생성 배선) 후 검증
- [~] (ops) GitHub Pages ↔ Functions CORS — **Pages 활성화(main/root, mash-up-kr.github.io/mino-android-spec-center)**, CORS_ORIGIN 일치. 빌드 후 앱 로드·함수 호출 최종 확인 남음(+ Firebase Auth 승인 도메인에 `mash-up-kr.github.io` 추가 필요)

> 범례 추가: `[m]` = mock(localStorage) 구현 완료, **실연결(Firebase/Functions) 남음**.

## M1 · spec 작성 루프
- [x] 스킬 사용 안내 화면 (git pull → `spec-gen`/`spec-reviewer` 실행법, Figma URL 입력 안내)
- [x] drag-drop 업로드 — spec.md + 이미지 파일 (파일명 수집)
- [m] 이미지 → Firebase Storage 저장 + `assets[]` 기록 — **현재 파일명만, 실제 업로드 없음**
- [x] figmaSources 입력 → 저장
- [x] 경량 구조 검증 S1–S6 (validation.md) — 실패 시 인라인 에러·저장 차단
- [x] `status = spec_draft` feature 생성
- [x] specVersion 파싱 캐시 (변경 이력 최신 행)

## M2 · 컨펌 게이트 — mock 완료
- [x] 컨펌요청 전이 `spec_draft`/`spec_changes_requested` → `spec_in_review`
- [m] `spec_in_review` 동안 spec read-only 잠금 — UI 가드만, **Firestore 규칙 강제 남음**
- [x] 디자이너 승인 → `spec_approved` (plan 잠금 해제)
- [x] 디자이너 반려+코멘트 → `spec_changes_requested`
- [m] `reviews/` 기록 (decision·comments·reviewer) — 현재 feature 내 배열, **서브컬렉션 전환 남음**
- [x] 섹션/화면 인라인 코멘트 (+ 반려 후 보충 코멘트)
- [x] 출처 Figma 메타(figmaSources) 컨펌 화면 노출
- [m] role 기반 액션 가드 — UI만, **Firestore 보안규칙 남음**

## M3 · plan + PR 생성
- [x] `plan-gen` 안내 + plan 붙여넣기 (`spec_approved` 후) → `plan_drafted`
- [ ] (BE) `githubOAuthExchange` — OAuth code → user token 교환
- [ ] (BE) `createSpecPR` — 브랜치 생성 → 파일 커밋(spec/plan/assets) → PR 생성
- [m] PR 생성 → `pr_open` — **현재 stub(랜덤 PR번호)**, 실 PR 생성 남음
- [ ] PR 컨벤션: 브랜치 `docs/spec-{slug}-v{n}` · base develop · 라벨 spec · 제목 `docs(spec): {feature} v{n}`
- [ ] PR 템플릿 (얼라인 체크리스트) → prNumber/prUrl 기록(실값)
- [ ] 개발자 GitHub App authorize 온보딩 강제 (디자이너 제외)

## M4 · 상태머신 완결
- [ ] (BE) `githubWebhook` — `pull_request` 수신 + HMAC 검증
- [m] merged → `merged` / 미머지 close → `pr_closed` — **현재 mock 버튼**, 실 Webhook 남음
- [x] 무효화 연쇄 — approved 후 spec 수정 시: `spec_draft` 복귀 + `planStale=true` (로직)
- [m] 무효화 시 열린 PR 자동 close + 새 버전 링크 코멘트 — 플래그만, **실제 GitHub close 남음**
- [ ] specVersion 증가(새 브랜치/PR) 처리
- [~] (ops) `Team-MINO-Android` CODEOWNERS `docs/specs/** @안드3인` — **PR #54 오픈**, 머지 대기 ([mino_android.md] 소관)

→ **M0–M4 완료 = MVP.** 8개 상태 전부 도달·전이 완결.
> 현재: 8상태 전부 mock으로 도달·전이 가능(파이프라인 1바퀴 검증됨). 남은 건 **실 백엔드 연결**.

---

## Post-MVP (happy path 밖 · UX/운영)
- [ ] 재검토 diff — "지난 검토 이후 변경분" 표시 (4.5)
- [ ] revoke UI / 403 권한부족 우아한 폴백 (5.1)
- [ ] 라이브 마크다운 프리뷰 (이미지 렌더, 우선순위 ↑)
- [ ] 토큰 평문 → Secret Manager 마이그레이션 (5.1 운영 전환)

## 의존 / 비고
- 생성 스킬·검수 에이전트 정의는 **Mino-Android 레포 `.claude/` 소관** ([mino_android.md]) — 본 레포는 사용법 안내 + 산출물 업로드만.
- 대시보드 검증(S1–S6) = `spec-reviewer` 체크포인트와 동일 기준 (2차 방어선).
- 7장 의존 순서: `A(App 골격) → B(Firebase+Functions) → C(Webhook 역기입) → D(레포 CODEOWNERS)`.
