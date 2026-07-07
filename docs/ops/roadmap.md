# 작업 체크리스트 (v2 전면 재설계)

> 출처: [PRD](../PRD.md) 8장 마일스톤
> 설계: [state-machine.md](../design/state-machine.md) · [data-model.md](../design/data-model.md) · [validation.md](../design/validation.md)
> 진행 원칙: 문서/설계 → 프론트 전면 재작성(mock-first) → Firebase/Functions 실연결.
> M0–M4 = MVP (8개 상태 전부 도달·전이 완결).
> **현황(2026-07-07): M0–M4 MVP 완료 + P3 보안규칙 강제 + 자동 버저닝 + Post-MVP UX 3건 완료.** 실 백엔드 1바퀴 검증(PR #55/#56/#57/#62).

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
- [x] ~~개발자 App authorize 토큰으로 PR~~ — **폐기**: 로그인 토큰이 이미 PR-capable(user-to-server). createPr는 로그인 토큰으로 직동작
### ops (7장 플레이북 — admin 직접 실행, docs/infra-playbook.md)
- [x] (ops) A. GitHub App 등록 → App ID/Client ID/Secret/Webhook secret
- [x] (ops) B-1. Firebase 프로젝트 + **Blaze** + Auth(GitHub)/Firestore/Storage + webConfig
- [x] (ops) B-2. firebase-config.js 채움 · secrets 등록 · rules/functions 배포
- [x] (ops) C. Webhook URL 역기입 + PR 라운드트립 확인 — 역기입·HMAC 확인 + **PR 라운드트립 e2e 완료**(PR #55: pr_open→웹훅→pr_closed). merged 경로만 실 머지 미검증
- [x] (ops) GitHub Pages ↔ Functions CORS — Pages 활성화(mash-up-kr.github.io/mino-android-spec-center) · CORS_ORIGIN 일치 · Auth 승인 도메인 등록. 앱 로드·함수 호출 e2e 확인(PR #55)

> 범례 추가: `[m]` = mock(localStorage) 구현 완료, **실연결(Firebase/Functions) 남음**.

## M1 · spec 작성 루프
- [x] 스킬 사용 안내 화면 (git pull → `spec-gen`/`spec-reviewer` 실행법, Figma URL 입력 안내)
- [x] drag-drop 업로드 — spec.md + 이미지 파일 (파일명 수집)
- [x] 이미지 → Firebase Storage 실 업로드 + `assets[]` 기록 — 함수가 내려받아 PR에 base64 커밋 (**검증 PR #57**)
- [x] figmaSources 입력 → 저장
- [x] 경량 구조 검증 S1–S6 (validation.md) — 실패 시 인라인 에러·저장 차단
- [x] `status = spec_draft` feature 생성
- [x] specVersion 파싱 캐시 (변경 이력 최신 행)

## M2 · 컨펌 게이트 — mock 완료
- [x] 컨펌요청 전이 `spec_draft`/`spec_changes_requested` → `spec_in_review`
- [x] `spec_in_review` 동안 spec read-only 잠금 — UI 가드 + **Firestore 규칙 강제(P3)**
- [x] 디자이너 승인 → `spec_approved` (plan 잠금 해제)
- [x] 디자이너 반려+코멘트 → `spec_changes_requested`
- [x] `reviews` 기록 (decision·comments·reviewer) — feature 내 배열 필드(`arrayUnion`). 서브컬렉션 전환은 후속(선택)
- [x] 섹션/화면 인라인 코멘트 (+ 반려 후 보충 코멘트)
- [x] 출처 Figma 메타(figmaSources) 컨펌 화면 노출
- [x] role 기반 액션 가드 — UI + **Firestore 보안규칙 강제(P3): 역할별 전이 허용목록·필드 잠금**

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
- [~] merged → `merged` / 미머지 close → `pr_closed` — **close 경로 검증 완료**(PR #55 → `pr_closed`). merged 경로 코드 완비(웹훅 `pr.merged` 분기 + `graduate` 승격 → v1.0.0)이나 실 머지 e2e는 미검증(더미 PR을 develop에 머지 안 함)
- [x] 무효화 연쇄 — approved 후 spec 수정 시: `spec_draft` 복귀 + `planStale=true` (로직)
- [x] 무효화 시 열린 PR 자동 close — **함수 `closeSpecPR`** (개발자 토큰, 코멘트+close, head 브랜치 검증). saveSpec이 Firestore `prNumber=null` 선갱신 후 호출 → close 웹훅 매칭 실패로 `spec_draft` 유지(레이스 방지). **e2e 검증 완료(2026-07-06, PR #62: close+무효화 코멘트, spec_draft 복귀, 레이스 방지 확인)**. UI: pr_open 상세에 'spec 수정' 버튼 추가(app.js)
- [x] specVersion 증가(새 브랜치/PR) — 재PR 시 `createSpecPR`가 `docs/spec-{slug}-{새버전}` 브랜치 자동 생성(추가 코드 불필요)
- [x] (ops) `Team-MINO-Android` CODEOWNERS `docs/specs/** @안드3인` — **PR #54 머지 완료**. (강제하려면 develop 브랜치 보호에 "Require review from Code Owners" 활성화 필요) ([mino_android.md] 소관)

→ **M0–M4 완료 = MVP.** 8개 상태 전부 도달·전이 완결.
> **2026-07-04**: 실 백엔드로 파이프라인 1바퀴 완주 검증(PR #55). spec 업로드→반려→재검토→승인→plan→실 PR 생성(pr_open)→PR close→웹훅→pr_closed.
> **2026-07-06~07**: assets 실 커밋(PR #57)·무효화 자동 close(PR #62)·specVersion 자동 버저닝·**P3 보안규칙 강제** 완료. 잔여=merged 경로 실 머지 e2e, 토큰 Secret Manager 이관.

---

## P3 · 보안 규칙 강제 — 완료 (2026-07-06)
- [x] `firestore.rules` 실 강제: 역할별 전이 허용목록(`devTransitionOk`/`desTransitionOk`) · 필드 잠금(prNumber/prUrl) · `spec_in_review` read-only · 위조 차단(`pr_open`/`merged`/`pr_closed`는 Functions 전용)
- [x] 자동 버저닝: 대시보드가 `versionLog` 소유 → 전이 이벤트에서 bump(init/patch/minor/major/graduate) → `## 변경 이력` 표 자동 주입(specBody·PR 커밋 미러)

## Post-MVP (happy path 밖 · UX/운영)
- [x] 재검토 diff — "지난 검토 이후 변경분" 표시 (4.5) — **방식 B: 버전별 스냅샷 + 변경분 뷰**
- [x] revoke UI / 403 권한부족 우아한 폴백 (5.1)
- [x] 라이브 마크다운 프리뷰 (업로드 편집기, 이미지 렌더)
- [x] 토큰 평문 → Secret Manager 마이그레이션 (5.1 운영 전환) — **완료(2026-07-08 검증)**: functions/token-store.js(`storeGithubToken` callable + 레거시 자동 이관) + rules 평문 재유입 차단 + IAM/배포. 재로그인 실호출 성공·필드 미재생성 확인. 미로그인 팀원의 잔여 평문 필드는 다음 PR 생성 시 자동 이관(또는 콘솔 수동 삭제) ([infra-playbook E](infra-playbook.md))
- [ ] merged 경로 실 머지 e2e (더미 PR develop 머지)
- [ ] `reviews` 배열 → 서브컬렉션 전환 (선택) — **P5.1(아래)로 편입**

---

## 확장 로드맵 (Post-MVP 설계 · 전부 미착수)

> MVP(M0–M4) 이후 추가 기능. **문서만 확정**됐고 코드 착수 전. 상세는 각 설계 문서에.

| 트랙 | 설계 문서 | 요지 | 상태 |
|---|---|---|---|
| **P4** 구현 추적 | [v2/impl-tracking.md](../v2/impl-tracking.md) | `merged` 이후 실제 안드로이드 구현(이슈→할당→PR→머지)을 병렬 트랙으로 추적. 조인 키=GitHub 이슈 번호 | 설계 확정·미착수 |
| **P5.1** 논의 스레드 | [v2/discussion.md](../v2/discussion.md) | 승인 전 자유 논의 스레드 + `reviews[]`→서브컬렉션 전환 + 활동 타임라인 | 설계 확정·미착수 |
| **P5.2** 알림 | [v2/notifications.md](../v2/notifications.md) | 상태 전이·리뷰·논의를 Discord로 알림(Firestore 트리거 3개). P5.1 선행 | 설계 확정·미착수 |

## 의존 / 비고
- 생성 스킬·검수 에이전트 정의는 **Mino-Android 레포 `.claude/` 소관** ([mino_android.md]) — 본 레포는 사용법 안내 + 산출물 업로드만.
- 대시보드 검증(S1–S6) = `spec-reviewer` 체크포인트와 동일 기준 (2차 방어선).
- 7장 의존 순서: `A(App 골격) → B(Firebase+Functions) → C(Webhook 역기입) → D(레포 CODEOWNERS)`.
