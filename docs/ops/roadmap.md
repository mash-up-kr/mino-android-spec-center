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
- [x] ~~`plan-gen` 안내 + plan 붙여넣기 (`spec_approved` 후) → `plan_drafted`~~ — **P6(2026-08-10)에서 폐기**
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
- [x] 무효화 연쇄 — approved 후 spec 수정 시: `spec_draft` 복귀 + `planStale=true` (로직) — P6에서 `planStale` 제거
- [x] 무효화 시 열린 PR 자동 close — **함수 `closeSpecPR`** (개발자 토큰, 코멘트+close, head 브랜치 검증). saveSpec이 Firestore `prNumber=null` 선갱신 후 호출 → close 웹훅 매칭 실패로 `spec_draft` 유지(레이스 방지). **e2e 검증 완료(2026-07-06, PR #62: close+무효화 코멘트, spec_draft 복귀, 레이스 방지 확인)**. UI: pr_open 상세에 'spec 수정' 버튼 추가(app.js)
- [x] specVersion 증가(새 브랜치/PR) — 재PR 시 `createSpecPR`가 `docs/spec-{slug}-{새버전}` 브랜치 자동 생성(추가 코드 불필요)
- [x] (ops) `Team-MINO-Android` CODEOWNERS `docs/specs/** @안드3인` — **PR #54 머지 완료**. (강제하려면 develop 브랜치 보호에 "Require review from Code Owners" 활성화 필요) ([mino_android.md] 소관)

→ **M0–M4 완료 = MVP.** 8개 상태 전부 도달·전이 완결.
> **2026-07-04**: 실 백엔드로 파이프라인 1바퀴 완주 검증(PR #55). spec 업로드→반려→재검토→승인→plan→실 PR 생성(pr_open)→PR close→웹훅→pr_closed.
> **2026-07-06~07**: assets 실 커밋(PR #57)·무효화 자동 close(PR #62)·specVersion 자동 버저닝·**P3 보안규칙 강제** 완료. 잔여=merged 경로 실 머지 e2e, 토큰 Secret Manager 이관.

---

## P6 · SDD 스킬 개편 반영 — 완료 (2026-08-10)

> Mino-Android 쪽 SDD 개편(신 spec 템플릿 · `/issue` base 브랜치 워크플로우) 3건을 대시보드에 반영.
> 근거: `mino-sdd/template/spec-template.md` · `.claude/skills/mino-spec/SKILL.md` · `docs/conventions/base-branch.md`

- [x] **plan 검토 단계 제거** — `plan_drafted` 상태·plan 붙여넣기 모달·`planBody`/`planStale`·plan.md 커밋 폐기. `spec_approved → pr_open` 직행. plan/task는 base 브랜치 하위 작업으로 이관 ([state-machine.md](../design/state-machine.md) §0)
- [x] **spec 템플릿 교체** — 필수 H2 8개 → 4개(유저 시나리오·요구사항·범위·가정). slug 출처가 `<!-- feature: -->` 주석 → 헤더 `**대상 스펙 경로**`. `interactionType`/`확정` 통제 어휘 → FR/UX/SC/TS ID 컨벤션. S1–S6 전면 재작성 ([validation.md](../design/validation.md) §0)
- [x] **이미지 업로드·Storage·assets 커밋 폐기** — 화면 근거는 본문 `**Figma**:` 노드 URL. `figmaSources`는 본문에서 자동 수집(수기 입력란 제거). `storage.rules`는 레거시 읽기 전용으로 축소
- [x] **버전 소유권 이관** — 대시보드 자동 bump·`## 변경 이력` 표 주입·`v0.1.0` 강제·머지 승격 전부 폐기. 헤더 `**버전**` 값을 읽기만 하고, 남기는 건 재검토 diff용 본문 스냅샷뿐. MAJOR/MINOR/PATCH는 semver 비교로 파생 표시
- [x] **머지 타겟 브랜치 변경** — base `develop` 고정 → 이슈별 `<prefix>/<번호>-<slug>/base`. head도 `docs/spec-{slug}-{version}` → `<prefix>/<번호>-<slug>/spec`. `listBaseBranches`(Functions→GitHub API) 신설 + 업로드 모달 셀렉트 + `features.baseBranch` 필드 + 보안규칙 create 가드
- [x] 품질 게이트 — 템플릿 자리표시자 잔여는 하드 차단. ~~헤더 `**상태**: CREATED`가 아니면 업로드 차단 · `[TBD]` 잔여 하드 차단~~ → **경고로 완화**: DRAFT·`[TBD]`는 디자이너 검수가 필요한 상태이므로 올라와야 한다. 상세 패널 안내 + spec PR 체크리스트 미체크로 추적 ([validation.md](../design/validation.md) §1)
- [ ] 신 파이프라인 실 e2e (base 브랜치 선택 → spec PR → base 머지) — 코드 완비, 실 검증 대기

## P7 · `/mino-spec` 산출물 2종 업로드 — 완료 (2026-08-10)

> `/mino-spec` 은 `spec.md` 와 `quality/spec-checklist.md` 를 함께 낸다. 둘 다 대시보드에 올리고 둘 다 PR 에 실리되,
> **디자이너 검수 대상은 spec 하나**로 유지한다. 업로드 방식은 붙여넣기 → **파일 첨부**로 전환.
> 근거: `.claude/skills/mino-spec/SKILL.md` §2·§5.1 · `mino-sdd/template/spec-checklist-template.md`

- [x] **데이터 모델** — `checklistBody`·`checklistStatus`·`checklistTargetVersion` 신설, `versionLog[].checklistBody` 스냅샷 추가 ([data-model.md](../design/data-model.md) v3→v3.1)
- [x] **체크리스트 검증 C1–C7** — H1·헤더 메타·상태 어휘·필수 H2 4개·체크박스·자리표시자는 하드, `FAILED`/미체크/버전 불일치는 경고. C7은 `major.minor` 까지만 비교(템플릿 예시가 `v1.0` 2자리라 엄격 비교 시 오탐) ([validation.md](../design/validation.md) §1-1)
- [x] **붙여넣기 편집창 폐기** — 업로드는 첨부 슬롯 2개뿐. 드롭한 파일은 본문 H1으로 자동 분류(파일명보다 H1 우선), 판별 실패 시 슬롯에서 직접 지정. 프리뷰는 문서별 탭으로 유지
- [x] **검수 범위 고정** — 체크리스트 뷰어는 항상 읽기 전용(💬 앵커·승인/반려 없음). 보안규칙 `desContentLocked` 에 체크리스트 3필드 추가 → 디자이너가 값 변경 불가
- [x] **업로드 필수화** — 신규 생성 시 체크리스트 누락이면 클라이언트(`saveSpec`)와 `allow create` 양쪽에서 차단. 기존 feature 수정 시 미첨부면 직전 본문 유지(레거시 lazy migration)
- [x] **PR 2파일 커밋** — `docs/specs/{slug}/spec.md` + `.../quality/spec-checklist.md`. PR 본문에 포함 문서 목록 + 실제 체크리스트 상태·통과 개수 반영(기존엔 spec 헤더 `CREATED` 로 추정하던 것을 교체)
- [x] mock 모드 e2e 스모크(첨부→자동분류→검증→저장→상세 반영) 통과
- [ ] 실 e2e — 실제 `/mino-spec` 산출물로 업로드 → 컨펌 → PR 2파일 확인 (Functions·rules 재배포 필요)

## P8 · PRD 트랙 (상위 문서) — 코드 완료·배포 대기 (2026-08-15)

> spec 의 상위 문서인 **PRD**(`docs/prd/business-context.md` · `/mino-prd` 산출물 · 프로젝트당 1개)를 대시보드로 끌어올린다.
> 업로드 · 전원 댓글 · spec 과의 버전 호환 추적 · Discord 알림 · 버전 diff 5건.
> **상세 설계와 단계별 세부 체크리스트는 [design/prd-track.md](../design/prd-track.md) §10.** 아래는 단계 요약이다.
> 근거: `mino-sdd/template/prd-template.md` · `.claude/skills/mino-prd/SKILL.md`

- [x] **P8.0 설계** — [prd-track.md](../design/prd-track.md) 신설 + [data-model.md](../design/data-model.md) `prds` 반영 + [PRD.md](../PRD.md) §4.9
- [x] **P8.1 업로드 + 검증** — `js/prd-parse.js`(표 헤더 파서·주석 스트립) · `validatePrd` P1–P7 · store `prd.*` · 업로드 모달 재사용 · `(rules)` 개발자 한정
- [x] **P8.2 버전 이력 + diff** — `versions/{version}` 스냅샷 서브컬렉션 · from/to 임의 비교 · 섹션 변경 요약 · `diffLines` 성능 가드
- [x] **P8.3 버전 호환** — 호환 등급 계산 · 목록/상세 뱃지 · "연결된 스펙" 표 · `prTemplate` 체크 줄. **표시 전용(차단 없음)**
- [x] **P8.4 댓글** — `comments` 서브컬렉션(전원·섹션 앵커·1단 답글·소프트 삭제) + `@` **자동완성 드롭다운**(삽입 토큰은 GitHub 핸들 — `mentions[]` 정규식이 ASCII 전용) + `(rules)`. **P5.1 스레드 컴포넌트의 발판**
- [x] **P8.5 알림** — `(BE)` `notifyOnPrdWrite`(등급별 색·역할 멘션·뒤처진 spec 목록 동봉) · `notifyOnPrdComment`(멘션 포함분만) · `?prd=` 딥링크. **등록·MAJOR·MINOR 는 Android·Design·iOS·Node 4개 역할**(2026-08-15) — PRD 는 제품 전체 문서. spec 파이프라인 알림은 Android/Design 그대로
- [~] **P8.6 배포·e2e** — rules/Functions 재배포 **완료(2026-08-19, P9 와 함께)** · 실 `/mino-prd` 산출물 e2e 만 남음

**확정 결정(2026-08-15)**: ① **PRD 의 PR 자동 생성은 하지 않는다**(커밋 경로가 `/mino-prd`+평상시 PR 로 이미 존재 — 두 번째 경로는 SoT 를 가른다) · ② **업로드 권한은 개발자 한정**(댓글은 전원이므로 요구사항 충족).

의존: `P8.1 → {P8.2 ∥ P8.3 ∥ P8.4} → P8.5 → P8.6`. 가운데 셋은 서로 독립이라 병렬 가능.

**검증(2026-08-15)**: 파서/검증/호환/diff 하니스 48건 · mock store 하니스 32건 · headless Chrome e2e 5스텝(문서 21 · 버전diff 17 · 연결된스펙 13 · 디자이너권한 13 · 업로드 27) **전부 통과**. 빈 `prd-template.md` 원본은 P5 로 차단되고, 템플릿 주석 속 예시(`[SCR-00X]` 등)는 주석 스트립으로 오탐되지 않음을 회귀 케이스로 고정.

## P9 · 자체 승인 (컨펌 왕복 제거) — 완료 (2026-08-19)

> PRD 개정 때마다 `/mino-spec` 재실행 → 재업로드 → 승인 해제 → **영향이 없어도 디자이너 재검수** 라는 왕복이
> 피로 요인이라는 의견에서 출발. 개발자가 `⚡ 자체 승인`(사유 필수)으로 `spec_draft → spec_approved` 를 직접 통과한다.
> 상세 설계는 [state-machine.md](../design/state-machine.md) §2.1.

- [x] `(rules)` `devTransitionOk` 에 `spec_draft → spec_approved` 추가 — **`spec_changes_requested` 는 제외**(반려 뒤집기 차단)
- [x] `(FE)` store 2종 `selfApprove(id, reason)` — 가드 ①`spec_draft` 한정 ②디자이너 `approved` 이력 필수 ③사유 필수
- [x] `(FE)` 상세 `⚡ 자체 승인` 버튼(가드 충족 시에만 노출) · 사유 입력 · 목록/상세 **자체 승인** 뱃지 · 컨펌 이력 태그 · 범례/역할 가이드
- [x] `(BE)` [notify.js](../../functions/notify.js) `⚡ 자체 승인` 알림 — **Design 역할 태그 + 사유 동봉**(철회 경로가 없으므로 이 알림이 디자이너의 사후 확인 지점)
- [x] `(BE)` [functions/index.js](../../functions/index.js) `approvalLine` — 자체 승인 건은 PR 얼라인 체크리스트에서 **미체크 + 사유**로 표기(하드코딩된 `- [x] spec 컨펌됨` 을 대체)
- [x] mock 하니스 10건(권한·상태·사유·이력 가드·반려 뒤집기 차단) + Functions 헬퍼 8건 통과
- [x] `(ops)` rules 재배포 · Functions 재배포 · 캐시 버스팅 — **완료(2026-08-19)**. P8 미배포분(PRD 규칙·`notifyOnPrd*`)도 같이 나감
- [ ] 실 e2e — 승인된 스펙에 PRD 개정본 재업로드 → 자체 승인 → PR 본문·Discord 문구 확인

**확정 결정(2026-08-19)**: ① **사유 필수** · ② **첫 승인은 디자이너**(승인 이력 없는 스펙은 자체 승인 불가) → **P9.1 에서 철회**(아래) · ③ **디자이너 승인 철회 미채택**(이견은 Discord 알림 → 개발자에게 재컨펌 요청으로 처리).

## P9.1 · 무검토 승인 (기능 스펙은 컨펌 게이트 자체를 건너뜀) — 완료 (2026-08-19)

> P9 은 "이미 승인된 스펙의 재승인"만 열었다. 남은 요구는 **단순 기능 스펙** — 화면이 없어 디자이너가
> 볼 것이 없는 spec 을 업로드 직후 바로 PR 까지 보내는 것. 실제 변경은 P9 가드 ②(**디자이너 승인 이력 필수**)
> 를 **뺀 것 하나**이고, 그 자리를 자가검증 산출물이 대신 선다. 설계는 [state-machine.md](../design/state-machine.md) §2.1–2.2.

- [x] `(FE)` 가드 재편 — `selfApproveBlock(f)` 하나로 모아 store 2종과 UI 가 **같은 규칙**을 쓴다: `spec_draft` 한정 · 사유 필수 · **체크리스트 `PASS`** · (승인 이력 없을 때) **`[TBD]` 0건**
- [x] `(rules)` `spec_draft → spec_approved` 에 서버측 보상 통제 추가 — `checklistStatus == 'PASS'` + `reviews` **+1 append**(사유 없는 맨 상태 플립 차단). `[TBD]`·승인 이력 판정은 배열/본문 순회가 필요해 클라이언트 담당
- [x] `(FE)` 버튼 라벨 자동 분기(`⚡ 자체 승인` ↔ `⚡ 무검토 승인`) · **가드 미충족은 숨기지 않고 비활성 + 이유 툴팁** · Figma 근거가 있는 스펙엔 오조작 재확인 confirm
- [x] `(FE)` 무검토 승인 표시 3종 — 빨간 `무검토 승인` 배지(목록·상세·컨펌 이력) · 스테퍼 `검토` 단계 **skipped**(점선·취소선) · 상세 이력 태그
- [x] `(BE)` `notifyOnFeatureWrite` 문구 분기 — `⚡ 무검토 승인`(red, "디자이너 검토 이력이 없는 스펙") vs `⚡ 자체 승인`(sky). 둘 다 **Design 태그 + 사유**
- [x] `(BE)` `approvalLine` 3분기 — 무검토 건은 `- [ ] spec 컨펌 **없음** — 개발자 무검토 승인(디자이너 검토 이력 없음)`
- [x] `(FE)` **디자인 스펙 / 기능 스펙 탭**(목록 위 · 건수 표시 · 다른 필터와 AND) — `figmaSources` 유무 파생, **전용 필드 없음**. 배타 축이라 퀵필터 칩(가산 토글)에서 **탭으로 교체**(2026-08-19) · 종류 배지는 행에서 빼고 상세 헤더에만
- [x] `(fix)` 재로그인 시 `initControls` 가 같은 DOM 에 리스너를 겹쳐 붙여 **퀵필터 토글이 무효화**되던 기존 버그 — 배선은 1회, 역할별 UI 만 매 로그인 적용(`applyRoleUi`)
- [x] `(seed)` 기능 스펙 데모 `now-feed-log` 추가 — Figma 근거 0건 · 체크리스트 PASS · S1–S6/C1–C7 통과(무검토 승인 해피패스가 mock 에서 재현됨)
- [x] 검증: Functions 헬퍼 19건 + mock 가드·UI 45건 통과
- [ ] `(ops)` rules · Functions 재배포 — **미배포**(P9.1 코드는 배포 전)
- [ ] 실 e2e — 기능 스펙 업로드 → 무검토 승인 → PR 생성 → PR 본문·Discord 문구 확인

**확정 결정(2026-08-19)**: ① **전용 상태·전용 `decision` 값을 만들지 않는다** — 유지/무검토 구분은 `reviews[]` 에서 파생(앞에 디자이너 `approved` 가 있었는가) · ② **`reviewPolicy` 같은 전용 필드 미채택** — 디자인/기능 구분은 `figmaSources` 파생, 오분류는 표시 전용 + 재확인 confirm 으로 흡수 · ③ **"첫 승인은 디자이너" 원칙은 체크리스트 `PASS` + `[TBD]` 0건으로 대체**한다.

## P3 · 보안 규칙 강제 — 완료 (2026-07-06)
- [x] `firestore.rules` 실 강제: 역할별 전이 허용목록(`devTransitionOk`/`desTransitionOk`) · 필드 잠금(prNumber/prUrl) · `spec_in_review` read-only · 위조 차단(`pr_open`/`merged`/`pr_closed`는 Functions 전용)
- [x] 자동 버저닝: 대시보드가 `versionLog` 소유 → 전이 이벤트에서 bump(init/patch/minor/major/graduate) → `## 변경 이력` 표 자동 주입(specBody·PR 커밋 미러)

## Post-MVP (happy path 밖 · UX/운영)
- [x] 재검토 diff — "지난 검토 이후 변경분" 표시 (4.5) — **방식 B: 버전별 스냅샷 + 변경분 뷰**
- [x] revoke UI / 403 권한부족 우아한 폴백 (5.1)
- [x] 라이브 마크다운 프리뷰 (업로드 편집기, 이미지 렌더)
- [x] 토큰 평문 → Secret Manager 마이그레이션 (5.1 운영 전환) — **완료(2026-07-08 검증)**: functions/token-store.js(`storeGithubToken` callable + 레거시 자동 이관) + rules 평문 재유입 차단 + IAM/배포. 재로그인 실호출 성공·필드 미재생성 확인. 미로그인 팀원의 잔여 평문 필드는 다음 PR 생성 시 자동 이관(또는 콘솔 수동 삭제) ([infra-playbook E](infra-playbook.md))
- [ ] merged 경로 실 머지 e2e (더미 PR을 base 브랜치에 머지)
- [ ] `reviews` 배열 → 서브컬렉션 전환 (선택) — **P5.1(아래)로 편입**

---

## 확장 로드맵 (Post-MVP 설계)

> MVP(M0–M4) 이후 추가 기능. 상세는 각 설계 문서에.

| 트랙 | 설계 문서 | 요지 | 상태 |
|---|---|---|---|
| **P4** 구현 추적 | [v2/impl-tracking.md](../v2/impl-tracking.md) | `merged` 이후 실제 안드로이드 구현(이슈→할당→PR→머지)을 병렬 트랙으로 추적. 조인 키=GitHub 이슈 번호 | 설계 확정·미착수 |
| **P5.1** 논의 스레드 | [v2/discussion.md](../v2/discussion.md) | 승인 전 자유 논의 스레드 + `reviews[]`→서브컬렉션 전환 + 활동 타임라인 | 설계 확정·미착수 |
| **P5.2** 알림 | [v2/notifications.md](../v2/notifications/notifications.md) | 상태 전이·리뷰·논의를 Discord로 알림. 현 구조(`reviews[]` 배열)에선 feature 트리거 1개가 상태전이+리뷰를 커버 | **1차 완료(2026-07-08, 실알림 검증됨)** — `functions/notify.js` + 역할 실멘션 + `?feature=` 딥링크. 잔여: discussion 알림·"내 멘션"칩(P5.1 후), 개인 discordId 멘션(Tier 2) |
| **P8** PRD 트랙 | [design/prd-track.md](../design/prd-track.md) | spec 의 **상위 문서** PRD 를 대시보드로. 업로드·전원 댓글·spec 버전 호환 추적·Discord 알림·버전 diff | **코드 완료(2026-08-15)** · 배포/실 e2e 대기 |

## 의존 / 비고
- 생성 스킬·검수 에이전트 정의는 **Mino-Android 레포 `.claude/` 소관** ([mino_android.md]) — 본 레포는 사용법 안내 + 산출물 업로드만.
- 대시보드 검증(spec S1–S6 · 체크리스트 C1–C7) = 산출물의 **구조** 재확인 (2차 방어선). 품질 1차는 스킬의 체크리스트(PASS → 헤더 `상태: CREATED`). 미완성(DRAFT·`[TBD]`·체크리스트 `FAILED`)은 차단 대상이 아니라 검수 대상이다.
- `/mino-spec` §6 완료 보고는 파일 경로 2개를 알려주는 데서 끝난다 — "둘 다 대시보드에 첨부" 안내를 스킬에 한 줄 추가하면 체크리스트 누락 경로가 원천 차단된다. **Mino-Android 레포 수정 사항이라 미반영**.
- 7장 의존 순서: `A(App 골격) → B(Firebase+Functions) → C(Webhook 역기입) → D(레포 CODEOWNERS)`.
