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
> **2026-07-04 발견**: Firebase Auth GitHub provider가 A(GitHub App) client로 설정돼 있어, **로그인 토큰이 이미 PR-capable**(스모크 테스트: `permissions.push=true`, `x-oauth-scopes` 비어있음 = App user-to-server 토큰). → **별도 `githubOAuthExchange`/authorize 온보딩 불필요**. createPr는 로그인 토큰으로 바로 동작. 남은 건 **e2e 검증 + assets 커밋**.
- [x] `plan-gen` 안내 + plan 붙여넣기 (`spec_approved` 후) → `plan_drafted`
- [~] (BE) `githubOAuthExchange` — **배포됨·미사용**(로그인 토큰이 대체). 다른 개발자 push권한 없을 때만 대안으로 보류
- [x] (BE) `createSpecPR` — 브랜치 생성 → 파일 커밋(spec/plan) → PR 생성. **e2e 검증 완료(2026-07-04, PR #55)**
- [x] PR 생성 → `pr_open` — store-firebase가 `createSpecPR` 실호출(실 prNumber/prUrl). **e2e 검증 완료(PR #55)**
- [x] PR 컨벤션: 브랜치 `docs/spec-{slug}-{version}` · base develop · 라벨 spec · 제목 `docs(spec): {slug} {version}` (PR #55로 확인)
- [x] PR 템플릿 (얼라인 체크리스트) → prNumber/prUrl 기록 (PR #55로 확인)
- [x] ~~개발자 App authorize 온보딩 강제~~ — **불필요**(로그인 토큰이 PR 권한 보유). 로그인=신원+PR권한 겸함
- [x] **e2e 검증** — PR #55: `docs/specs/e2e-smoke/spec.md·plan.md` 생성, 컨벤션 일치, 디자이너(minnhokim) 반려→재검토→승인 경유
- [x] assets 이미지 커밋 — 프론트가 이미지를 실제 Storage 업로드(store-firebase.uploadAssets) + 함수가 내려받아 `docs/specs/{slug}/assets/`에 base64 커밋(putBinary). **검증 완료(PR #57: `docs/specs/e2e-assets/assets/hero.png`)**
- [x] PR assignee = 작업자(개발자 githubLogin) 지정 — **검증 완료(PR #56/#57)**

→ **M3 완료.** 실 PR·컨벤션·assets·assignee 전부 검증됨.

## M4 · 상태머신 완결
- [x] (BE) `githubWebhook` — `pull_request` 수신 + HMAC 검증 — **e2e 검증 완료(PR #55 close → delivery 200)**
- [~] merged → `merged` / 미머지 close → `pr_closed` — **close 경로 검증 완료**(PR #55 → `pr_closed`). merged 경로는 동일 코드분기지만 미검증(더미 PR을 develop에 머지 안 함)
- [x] 무효화 연쇄 — approved 후 spec 수정 시: `spec_draft` 복귀 + `planStale=true` (로직)
- [x] 무효화 시 열린 PR 자동 close — **함수 `closeSpecPR` 배포**(개발자 토큰, 코멘트+close, head 브랜치 검증). saveSpec이 Firestore `prNumber=null` 선갱신 후 호출 → close 웹훅 매칭 실패로 `spec_draft` 유지(레이스 방지). e2e 검증 남음
- [x] specVersion 증가(새 브랜치/PR) — 재PR 시 `createSpecPR`가 `docs/spec-{slug}-{새버전}` 브랜치 자동 생성(추가 코드 불필요)
- [x] (ops) `Team-MINO-Android` CODEOWNERS `docs/specs/** @안드3인` — **PR #54 머지 완료**. (강제하려면 develop 브랜치 보호에 "Require review from Code Owners" 활성화 필요) ([mino_android.md] 소관)

→ **M0–M4 완료 = MVP.** 8개 상태 전부 도달·전이 완결.
> **2026-07-04**: 실 백엔드로 파이프라인 1바퀴 완주 검증(PR #55). spec 업로드→반려→재검토→승인→plan→실 PR 생성(pr_open)→PR close→웹훅→pr_closed. M3 잔여=assets 커밋, M4 잔여=merged 경로 검증·무효화 실 close·specVersion 증가. 이후는 P3(보안 규칙 강제) 중심.

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
