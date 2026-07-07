# mino-android-spec-center — PRD

> 작성일: 2026-06-26 · 상태: **확정** · 상위 기획: `mino.md` (SDD 파이프라인)
> 대상 프로젝트: **mino-android-spec-center** — SDD 문서를 작성·아카이빙하는 대시보드
> Repo: https://github.com/mash-up-kr/mino-android-spec-center

> 📌 이 문서는 본 프로젝트의 **정본 PRD**다. 각 설계 문서([docs/design/](design/)) · 운영 문서([docs/ops/](ops/))가 "출처"로 인용하는 원천이며, 구현과의 차이는 설계 문서 쪽에 최신화되어 있다.
> `mino.md`(상위 기획) · `mino_android.md` · `skills/*`(생성 스킬·검수 에이전트)는 **기획/Mino-Android 레포 소관**이라 이 레포에는 포함되지 않는다(본문에서 코드체로 표기).

---

## 1. 개요

### 1.1 목적
spec-center는 **Spec Driven Development(SDD) 문서 파이프라인의 컨트롤 타워**다. 화면 동작 정의(spec)와 안드로이드 설계(plan) 문서를 팀원이 일관된 형식으로 생성·검토·아카이빙하고, 컨펌이 끝난 문서를 Mino-Android 레포로 PR화하는 흐름을 관장한다.

핵심 설계 결정: **문서 "생성"은 백엔드가 아니라 각 팀원의 로컬 Claude Code에서 수행**한다. 생성 방식은 복사-붙여넣기 프롬프트가 아니라 **Claude Code 스킬**(`spec-gen`·`plan-gen`) + **검수 서브에이전트**(`spec-reviewer`)이며, 이 스킬/에이전트 정의는 Mino-Android 레포 `.claude/`에 단일 소스로 둔다(상세: 4.1). spec-center는 생성 자체를 하지 않고 ① 스킬 사용 안내 ② 붙여넣기 저장 ③ 컨펌 게이트 ④ PR 생성/추적만 담당한다. 이로써 Anthropic 키·백엔드 추론 루프·CORS·스트리밍 서버가 전부 불필요해진다.

### 1.2 문서 체계 (spec-center 소관 = 2종)
| 문서 | 질문 | 내용 | 원천 |
|------|------|------|------|
| **spec.md** | 무엇을 만들까 | 화면 동작 정의 (기준 문서) | Figma (유일 원천) |
| **plan.md** | 어떻게 만들까 | spec → 안드로이드 설계(MVI·데이터) 번역 | Mino-Android docs |

> `tasks.md`(커밋 단위 작업 큐)는 **구현 단계로 이관**, spec-center 범위 밖. 무효화 연쇄는 spec↔plan 2단계로 단순화.

### 1.3 Source of Truth
- 문서의 진실은 **대시보드(Firestore)**. 레포 파일은 스냅샷이며 레포에서 직접 수정/보정하지 않는다.

---

## 2. 목표 / 비목표

### 2.1 목표
- 팀원이 **일관된 형식의 spec/plan을 최소 마찰로 생성·저장**하게 한다 (생성 스킬 + 붙여넣기).
- **디자이너 컨펌 게이트**로 spec 품질을 보장하고, 컨펌 전 plan 진행을 차단한다.
- 컨펌 완료 문서를 **개발자 본인 명의의 PR**로 Mino-Android `develop`에 반영한다.
- feature 단위 문서 묶음의 **상태를 단일 파이프라인 상태머신**으로 추적한다.

### 2.2 비목표
- AI 추론/생성을 서버에서 수행하지 않는다 (로컬 Claude Code 위임).
- 팀 공용 Figma PAT, Anthropic 키 등 민감 시크릿을 보관하지 않는다 (GitHub 사용자 토큰만 예외).
- plan에 대한 별도 대시보드 컨펌 게이트를 만들지 않는다 (PR 리뷰가 검증).
- 풀 WYSIWYG 에디터를 제공하지 않는다 (소스=마크다운, 사용자=개발자).

---

## 3. 사용자 / 역할

| 역할 | 권한 | 주요 행위 |
|------|------|-----------|
| **개발자** | spec/plan 작성·수정, 생성 스킬 실행, 붙여넣기, PR 생성 | 로컬 Claude Code 스킬로 생성·자가검수 → 대시보드 붙여넣기 → 컨펌 요청 → PR |
| **디자이너** | spec 승인/반려/코멘트 (PR·GitHub 미관여) | 대시보드 로그인 → spec 검토 → 결정 |

- Role 모델은 Firebase Auth(GitHub provider) 기반으로 디자이너/개발자 권한을 분리한다 (5.1).

---

## 4. 핵심 기능 요구사항

### 4.1 생성 스킬 안내 (spec-center 측 책임)
- 생성은 **로컬 Claude Code 스킬**(`spec-gen`·`plan-gen`) + **검수 서브에이전트**(`spec-reviewer`)로 수행한다. 복사-붙여넣기 프롬프트도, 서버 측 추론도 아니다.
- **스킬/에이전트 정의는 spec-center가 아니라 Mino-Android 레포 `.claude/`에 단일 소스로 존재**한다(정의·검증은 `mino_android.md` 소관). spec-center는 정의를 보관·작성하지 않는다.
- spec-center가 하는 일은 **사용법 안내 + 산출물 수신**뿐:
  - 대시보드 화면에 스킬 사용 가이드(설치 = 레포 `git pull`, 실행 = `spec-gen`/`plan-gen`, 입력 = Figma URL·기획서)를 노출한다.
  - 입력값 치환은 하지 않는다 — 개발자가 스킬 실행 시 직접 전달한다.
  - 산출물(spec.md/plan.md/assets)은 **drag-drop 업로드**로 받는다(4.2). 스킬은 Firestore에 직접 쓰지 않는다.
  - 출처 Figma URL은 컨펌 메타 노출용으로 **업로드 시 함께 입력**해 `figmaSources`로 저장한다(4.5).

### 4.2 붙여넣기 & 구조 검증
- spec.md 텍스트 + 이미지 파일을 함께 업로드(drag-drop).
- **가벼운 구조 검증** (1차 자가검수는 `spec-reviewer`가 이미 수행 → 대시보드는 2차 방어선. 내용 품질은 컨펌 게이트가 흡수):
  - 맨 첫 줄 `<!-- feature: {slug} -->` 주석 존재
  - 필수 H2 제목 8개 존재
  - `2. 화면 상태별 읽기`에 이미지 ≥ 1
  - `interactionType` / 확정 enum 유효, 빈 값 아님
- 검증 항목 정의·드라이런 시나리오: `skills/VALIDATION.md` (대시보드 자동 검증 항목 = `spec-reviewer` 검수 체크포인트와 동일 기준).

### 4.3 이미지 업로드 & 보관
- drag-drop 업로드 → **Firebase Storage** 저장 (프리뷰 렌더 + 원본 = source of truth 일부).
- 상대경로 `![](assets/x.png)`가 레포 `specs/{feature}/`에서도 그대로 렌더되도록 PR 커밋 시 `assets/`에 동봉.

### 4.4 편집 UI
- textarea 기반 편집. 소스=마크다운, 사용자=개발자이므로 풀 WYSIWYG 불필요.
- 라이브 마크다운 프리뷰(이미지 렌더 포함)는 **Post-MVP**(8장) — 이미지 확인용으로 우선순위 높음.

### 4.5 디자이너 컨펌 게이트
- 디자이너가 대시보드에서 승인/반려/코멘트. **spec 컨펌 전 plan 불가.**
- 승인 단위: **spec 문서 전체** (화면별 X).
- **검토 중 잠금**: `in_review` 동안 spec read-only.
- **무효화**: `approved` spec을 어떤 수정이든 하면 → `draft` 복귀, 재컨펌 필수, 하위 plan `stale` 표시.
- **코멘트**: 디자이너 결정 + spec **섹션(제목) 앵커 인라인 코멘트**(Notion식). 미리보기에서 각 H2/H3 옆 💬로 코멘트를 달고, 코멘트별 개별 삭제 가능. 반려 제출 시 코멘트 ≥1 필수.
- **반려 후 보충 코멘트**: `changes_requested` 상태에서도 디자이너가 스펙을 다시 열어 **상태 변화 없이** 코멘트를 추가할 수 있다(리뷰 결정 `decision=comment`). 승인/반려 "결정"과 구분되어 이력에 누적된다.
- **출처 링크 첨부**: spec이 어떤 Figma 링크 기반인지 source URL을 메타로 첨부해 컨펌 화면에 노출.
- **재검토 diff**("지난 검토 이후 변경분")·**알림**: Post-MVP / 없음.

**spec 상태머신**
```
draft ──(컨펌요청)──▶ in_review ──(승인)──▶ approved ──▶ [plan 잠금 해제]
  ▲                      │
  │                      └──(반려+코멘트)──▶ changes_requested
  └──────(개발자 수정)──────────────────────────┘
```

### 4.6 plan ↔ docs 참조 정책
plan 프롬프트에 docs 선별 규칙을 강제한다. (로컬 Claude Code가 레포 docs를 직접 읽음)
- **항상 참조**: `docs/architecture/*` (모듈화·feature 모듈 패턴·네비게이션)
- **선별 참조**: spec이 건드리는 관련 `core/{모듈}` docs만
- **무시**: `docs/diagrams/`, `docs/operations/` (CD 파이프라인 — 노이즈)
- **출력**: plan.md에 `## 참고 문서` 목록 명시 (검증 추적성)

### 4.7 PR 생성 & 추적
- 붙여넣기·컨펌 완료 후 대시보드가 GitHub API로 PR 생성. **PR 생성만 최소 백엔드(Cloud Function)가 사용자 토큰으로 수행** → PR=개발자 명의.
- 메커니즘: ① 브랜치 생성(`git/refs`) → ② 파일 커밋(Contents/Git Data API) → ③ PR 생성(`pulls`)

**PR 컨벤션** (개발 PR과 별도)
| 항목 | 값 |
|------|------|
| 브랜치명 | `docs/spec-{feature}-v{n}` (`{n}`=풀 버전명, 예: `docs/spec-openchat-list-v0.1.0`) |
| base | `develop` |
| 라벨 | `spec` |
| PR 제목 | `docs(spec): {feature} v{n}` |
| PR 템플릿 | 얼라인 체크리스트 (spec 컨펌됨 / plan 검증됨 / 담당자) |

- **버저닝**: spec 버전이 올라갈 때마다 새 브랜치/PR. 버전 원천은 spec.md `변경 이력` 표 최신 행 버전명(frontmatter 없이 파싱).
- **역방향 동기화**: GitHub `pull_request` Webhook → Cloud Function(HMAC 검증) → Firestore 상태 갱신. `merged`→`merged` / 미머지 close→`closed`.

### 4.8 전체 파이프라인 상태머신
**단위**: `specs/{feature}/` 한 묶음(spec.md + plan.md)이 단일 `status`를 가진다.

```
spec_draft ──(컨펌요청)──▶ spec_in_review ──(승인)──▶ spec_approved
  ▲                            │                          │ (plan 붙여넣기)
  │                            └──(반려)──▶ spec_changes_requested
  │                                              │ (수정 후 재요청)
  │                                              └──▶ spec_in_review
  │                                                        ▼
  │                                                  plan_drafted ──(PR 생성)──▶ pr_open
  │                                          ┌──(Webhook: merged)──▶ merged ✅      │
  │                                          └──(Webhook: closed)──▶ pr_closed ◀────┘
  └──[무효화] spec_approved 이후 spec 수정 시 → spec_draft 복귀(planStale=true, 열린 PR 자동 close)
```

| status | 의미 | 편집 |
|---|---|---|
| `spec_draft` | spec 작성/수정 중 (초기 상태) | 개발자 |
| `spec_in_review` | 디자이너 검토 중 | 잠금 |
| `spec_changes_requested` | 반려됨 | 개발자 |
| `spec_approved` | spec 컨펌 완료 → plan 잠금 해제 | (수정 시 무효화) |
| `plan_drafted` | plan 작성 완료, PR 준비 | 개발자 |
| `pr_open` | 문서 PR 열림 | - |
| `merged` | 머지 완료 (종료 → 구현 단계로) | - |
| `pr_closed` | PR 미머지 종료 | - |

- **보조 메타**: `planStale`, `specVersion`, `prNumber`, `prUrl`, `figmaSources`.
- **무효화**: `spec_approved` 이후 spec 수정 시 → `spec_draft` 복귀, `planStale=true`, 열린 PR 자동 close(코멘트로 새 버전 링크).
- **plan 검증 게이트 없음**: plan은 PR 리뷰(얼라인)에서 검증. 디자이너는 spec만 관여.

### 4.8.1 두 게이트의 관계 (디자이너 컨펌 ↔ CODEOWNERS PR 리뷰)
파이프라인에는 게이트가 둘 있고 **권위가 비중첩**이다.

| 게이트 | 위치·시점 | 검증 대상 | 권한자 |
|---|---|---|---|
| 디자이너 컨펌 | 대시보드 · PR **전**(`spec_in_review`) | spec = "무엇"(Figma·기획 대조) | 디자이너 |
| CODEOWNERS 리뷰 | GitHub PR · PR **후**(`pr_open`) | plan = "어떻게"(MVI 설계 타당성) + 팀 얼라인 | `specs/**` owner(안드 개발자/리드) |

- **권위 분리**: PR 리뷰어는 spec을 **재심의하지 않는다**(이미 디자이너 통과). 디자이너는 GitHub 미관여(5.1)라 CODEOWNERS owner 부적격.
- **PR 정체성 = spec 버전**: 같은 spec 버전 안의 plan 반복은 같은 PR, spec 버전이 오르면 새 PR(브랜치 `v{n}`).
- **PR 리뷰 결과 → 전이** (신규 상태 없음 — 기존 엣지 재사용):

| 결과 | 처리 | 전이 | 디자이너 재컨펌 |
|---|---|---|---|
| Approve → merge | — | `pr_open → merged` | — |
| **plan 수정 요청** | PR close → 대시보드서 plan 재생성 → 재PR | `pr_open → pr_closed → plan_drafted → pr_open` | 불필요(spec 버전 동일) |
| **spec 결함 발견** | 에스컬레이션: 코멘트만 남기고 개발자가 대시보드서 spec 수정 = 무효화 | 무효화 체인 → `spec_draft` | 필요 |

> plan 인플레이스 커밋 업데이트(PR 닫지 않고 새 커밋)는 Post-MVP. MVP는 close+재PR로 단순화.

---

## 5. 기술 아키텍처

생성이 로컬로 빠지면서 백엔드는 **GitHub 관련 일만 하는 최소 규모**.

| 조각 | 담당 | 역할 |
|------|------|------|
| **GitHub Pages** | 프론트엔드 | 대시보드 화면 + 생성 스킬 사용 안내 + 붙여넣기 UI (Functions와 도메인 분리 → CORS 설정 필요) |
| Firebase **클라이언트 SDK** (Firestore + Auth) | BaaS | 문서·상태·버전·컨펌 게이트, 로그인/역할 — 정적 프론트에서 직접 |
| Firebase **Storage** | BaaS | spec 화면 이미지 보관 |
| **최소 Cloud Functions** | 백엔드 | ① OAuth 토큰 교환(폴백 — 5.1) ② PR 생성(커밋+PR) ③ Webhook 수신 |

- 흐름: `브라우저(Pages) ↔ Firebase(SDK 직접)`, PR 단계만 `브라우저 → Cloud Function → GitHub`.
- **Cloud Run 불필요**. **Blaze 플랜 필요**(Functions 아웃바운드 호출). 백엔드 시크릿은 **GitHub 사용자 토큰**뿐.

### 5.1 GitHub 인증 (GitHub App, user-to-server)
- GitHub App + 사용자 인증 토큰 → PR이 **개발자 본인 명의** (클래식 OAuth 광범위 권한 회피).
- 권한: **Contents r/w + Pull requests write** (이 레포 한정).
- **"Expire user authorization tokens" OFF** → 한 번 인증하면 만료 없이 사용, refresh 불필요.
- **로그인 = GitHub 통합**: Firebase Auth GitHub provider **팝업 로그인**으로 단일화. 팝업 결과의 `credential.accessToken`(user-to-server 토큰)을 **직접** `users/{uid}.githubToken`에 저장해 PR 생성에 재사용한다 → 로그인과 PR 토큰을 한 흐름에. Client Secret은 Firebase Auth 설정에만 두고 프론트 노출 금지.
  - 콜백 = Firebase 핸들러 `https://<project>.firebaseapp.com/__/auth/handler` (GitHub App Callback URL 목록에 등록). Pages `/auth/callback` 아님.
  - `githubOAuthExchange` Function은 **팝업 토큰이 Contents/PR 권한을 못 가질 경우의 폴백**으로만 둔다(M3에서 검증해 필요 여부 확정).
- **역할 분기**(디자이너 예외): 디자이너도 GitHub 계정으로 **로그인만** 한다. PR을 여는 개발자만 GitHub App 권한(Contents/PR)이 필요. `users.role`로 기능 분기(디자이너=승인/반려/코멘트, 개발자=작성/plan/PR).
- **온보딩**: 첫 로그인 시 **역할 선택**(개발자/디자이너) 모달로 `users/{uid}.role` 설정. (※ 현재는 자가선택. "개발자만 App authorize로 자동 식별"은 후속 강화 항목.)
- **권한 정책**: 팀 전원(개발자) Mino-Android write 권한 유도. 403이면 명확한 에러 안내(폴백).
- **토큰 저장**: 현재 평문 저장(MVP), 운영 전환 시 Secret Manager + revoke UI.

---

## 6. 데이터 모델 (Firestore)

```
features/{featureId}
  ├─ slug: string              # specs/{slug}/ 경로
  ├─ status: enum              # 4.8 상태머신
  ├─ planStale: boolean
  ├─ specVersion: string       # 변경 이력 최신 행 버전명
  ├─ figmaSources: string[]    # 컨펌 화면 출처 노출
  ├─ prNumber: number | null
  ├─ prUrl: string | null
  ├─ specBody: string          # spec.md 본문 (SoT)
  ├─ planBody: string | null   # plan.md 본문
  ├─ assets: [{ name, storagePath }]
  └─ reviews: [{ reviewId, decision, comments, reviewerUid, reviewedAt }]
       # MVP: feature 문서 내 배열 필드(서브컬렉션 전환은 후속).
       # decision: approved | changes_requested | comment
       #   comment = 상태 변화 없는 보충 코멘트(4.5)
       # comments: [{ section, body }]  · section = spec H2/H3 제목 앵커

users/{uid}
  ├─ role: developer | designer
  └─ githubToken: string       # MVP 평문, 운영 시 Secret Manager
```

---

## 7. 인프라 셋업 플레이북

> 결정: **Auth = GitHub 로그인 통합**(5.1), **Hosting = GitHub Pages**(5장). 실등록 작업의 실행 순서·산출물·의존성.
> 의존 순서: `A(App 골격) → B(Firebase+Functions) → C(Webhook 역기입) → D(레포)`.

### A. GitHub App 등록 (조직 `mash-up-kr`, admin 권한 필요)
| 설정 | 값 | 비고 |
|------|-----|------|
| 종류 | GitHub App (OAuth App ❌) | user-to-server = 개발자 명의 |
| 권한 | **Contents R/W + Pull requests R/W** | 대상 레포 한정 최소 권한 |
| Expire user tokens | **OFF** | refresh 불필요 |
| Callback URL | `https://<project>.firebaseapp.com/__/auth/handler` | Firebase Auth 핸들러(B에서 확보해 등록) |
| Webhook URL | (C에서 `githubWebhook` 배포 후 채움) | ⚠️ 닭-달걀 → 골격만 먼저 |
| Webhook secret | 랜덤 생성·보관 | HMAC 검증, 백엔드 1개 |
| 구독 이벤트 | `Pull requests` | 역방향 동기화(4.7) |
| 설치 대상 | `Team-MINO-Android` 레포 | PR 생성 대상 |

→ 산출물: **Client ID / Client Secret / Webhook secret**

### B. Firebase 프로젝트
- [ ] **Blaze 플랜** 활성화 (Functions 아웃바운드 호출 전제)
- [ ] **Firestore** — `features/`, `users/` 컬렉션 (6장 모델) + 보안 규칙(role 기반)
- [ ] **Auth** — GitHub provider 활성화 (Client ID/Secret 등록), 디자이너/개발자 `role` 분기
- [ ] **Storage** — spec 이미지 버킷 + 업로드 규칙
- [ ] **Functions 배포** — `githubOAuthExchange` / `createSpecPR` / `githubWebhook`
- [ ] **CORS** — Pages 도메인 → Functions 호출 허용(도메인 분리 대응)

### C. Webhook 연결 (A↔B 잇기)
- [ ] `githubWebhook` 배포 URL 확보 → **A의 Webhook URL/secret 역기입**
- [ ] `pull_request` 이벤트 수신 + HMAC 검증 → Firestore 상태 갱신 동작 확인

### D. CODEOWNERS (대상 레포 작업 — `mino_android.md` 소관)
- [ ] `Team-MINO-Android` 레포에 `specs/** @owner` 추가

> 후순위: 토큰 평문 → Secret Manager 마이그레이션(운영 전환 시).
> 생성 스킬 실전 검증(실제 Figma+기획서 드라이런)은 `skills/VALIDATION.md` 참조.

---

## 8. 구현 로드맵 (MVP 마일스톤)

> 컷 기준: **"이게 빠지면 파이프라인이 한 바퀴 못 도는가?"** — happy path 우선, 의존 순서대로.
> Webhook 자동 동기화·무효화 연쇄까지 **MVP 포함** (상태머신 8개 상태 전부 도달이 MVP 정의).

| | 마일스톤 | 핵심 산출물 | 의존 |
|---|----------|------------|------|
| **M0** | 기반 | 7장 인프라(GitHub App·Firebase·Blaze)·GitHub 로그인+`role`·Firestore 스키마 | — |
| **M1** | spec 작성 루프 | 생성 스킬(`spec-gen`+`spec-reviewer`) 사용 안내 / 붙여넣기 저장(textarea) / 이미지 drag-drop→Storage / 출처 Figma URL 입력 / 경량 구조 검증 / status=`spec_draft` 생성 | M0 |
| **M2** | 컨펌 게이트 | 디자이너 승인·반려·코멘트 / 전이(`in_review`·`approved`·`changes_requested`) / 검토 중 잠금 / 출처 Figma 메타 노출 | M1 |
| **M3** | plan + PR 생성 | `plan-gen` 스킬 실행+붙여넣기(`approved` 후) / `githubOAuthExchange` / `createSpecPR` → `pr_open` | M2 |
| **M4** | 상태머신 완결 | `githubWebhook`(HMAC→Firestore) `merged`/`pr_closed` / **무효화 연쇄**(`spec_draft` 복귀 + `planStale=true` + 열린 PR 자동 close + 새 버전 링크 코멘트) | M3 |

→ **M0–M4 = MVP.** 8개 상태(4.8) 전부 도달·전이 완결.

**Post-MVP** (happy path 밖 · UX 품질/운영):
- 재검토 diff — "지난 검토 이후 변경분" 표시 (4.5)
- revoke UI / 403 권한부족 **우아한** 폴백 안내 (5.1)
- 라이브 마크다운 프리뷰 (4.4 — textarea로 동작하나 이미지 확인용이라 Post-MVP 중 우선순위 ↑)
- 토큰 평문 → Secret Manager 마이그레이션 (5.1 운영 전환)

> 원칙: M0–M4로 **한 번 끝까지 통과**를 먼저 증명하고, UX 품질·운영 기능은 그 위에 얹는다.

---

## 부록: 참조

- 생성 스킬·검수 에이전트(`spec-gen`/`plan-gen`/`spec-reviewer`) 정의와 검증 시나리오는 **Mino-Android 레포 `.claude/` 소관** → `mino_android.md`. spec-center는 이를 사용법으로 안내하고 산출물을 업로드받을 뿐, 정의를 보관·작성하지 않는다.
- spec-center가 구현하는 붙여넣기 구조 검증(4.2)의 항목 기준은 `spec-reviewer` 검수 체크포인트와 동일하다.
