# 구현 추적 (Implementation Tracking) — P4 확장 설계

> 기존 파이프라인(M0–M4)에 얹는 **추가 기능**. spec 문서가 `merged`된 이후의 "실제 구현"을 대시보드가 추적한다.
> 설계 기반: [state-machine.md](../design/state-machine.md) · [data-model.md](../design/data-model.md) · [roadmap.md](../ops/roadmap.md)
> 상태(2026-07-07): **설계 확정 · 미착수.** 논의로 상태 모델·감지 방식·연결 키까지 합의됨. (문서화 우선, 개발은 후속.)

범례: `[ ]` 미착수 · `[~]` 진행중 · `[x]` 완료 · `(ops)` 운영작업 · `(BE)` Cloud Functions · `(FE)` 프론트 · `(XR)` 크로스레포(Team-MINO-Android 소관)

---

## 1. 배경 — `merged` 이후의 공백

현재 파이프라인의 종점 `merged`는 **"`docs/specs/{slug}/` 문서 PR이 머지됐다"** 는 뜻이다([state-machine.md](../design/state-machine.md)). 즉 **문서만 확정됐을 뿐 실제 안드로이드 코드는 아직 없을 수 있다.** MASC는 정확히 여기서 손을 뗀다.

```
spec 작성 ─→ 컨펌 ─→ 문서 PR merged   │   ??? (블랙박스)   │
         [MASC가 보는 영역]          [지금 안 보임 — 본 문서의 대상]
```

이 공백을 메우면 MASC는 *문서 도구* → **요구사항→구현 추적 시스템**으로 한 단계 올라간다.

## 2. 목표 / 비목표

**목표**
- 문서 확정(`merged`) 이후, 해당 spec의 **실제 구현 진행 상태**를 대시보드에서 가시화한다.
- spec ↔ 구현을 **구조적으로 연결**해, "이 spec이 어떤 이슈/PR로 구현됐나"를 추적한다.
- 승인된 spec이 바뀌었을 때 **구현이 구버전 기준임(드리프트)** 을 경고한다.

**비목표 (이번 범위 아님 · §11 보류)**
- 릴리스 추적("구현이 실제로 어느 버전에 나갔나").
- "작업 진행중"(브랜치는 있으나 PR 이전) 중간 상태 — 감지 비용 대비 가치가 낮아 제외.
- 대시보드가 로컬 브랜치·작업환경을 원격 세팅하는 것(로컬 `/issue` 소관).

## 3. 핵심 모델 — 2트랙 + 조인 키

구현은 기존 8상태 머신에 상태를 **더 붙이지 않고**, feature에 **병렬 트랙**으로 단다. (개발자는 보통 `spec_approved` 이후 문서 PR과 병렬로 코딩을 시작하며, 검증된 상태 머신을 건드리지 않아 리스크가 낮다.)

```
스펙 트랙 (기존)   spec_draft → … → merged(문서 PR)          ← 무수정
구현 트랙 (신규)   ① 이슈생성 → ② 할당 → ④ PR → ⑤ 머지        ← 본 문서
```

**조인 키 = GitHub 이슈 번호.** Team-MINO-Android의 브랜치 컨벤션이 `feature/{이슈번호}-{설명}`(예: `feature/58-move-mapper-to-repository`)이므로, slug가 아니라 **이슈 번호**가 spec과 구현을 잇는 다리다.

```
spec(slug) ──[대시보드가 이슈 생성]──→ 이슈 #N ──→ feature/N-… 브랜치 ──→ PR ──→ 머지
   [MASC]                            └────────── 기존 웹훅이 관측 ──────────┘
```

> 구현 코드와 문서가 **같은 레포**(`mash-up-kr/Team-MINO-Android`)에 있으므로, [githubWebhook](../../functions/index.js)이 이미 그 레포의 모든 이벤트를 받는다 → 감지에 필요한 추가 인프라가 최소.

## 4. 상태 모델 (4상태) 과 감지

논의 결과 "작업 진행중"을 뺀 **4상태**만 추적한다.

| 상태 | `implStatus` | 감지 신호 | GitHub 이벤트 | 추가 인프라 |
|---|---|---|---|---|
| **① 이슈 생성됨** | `impl_todo` | MASC가 직접 생성 (self-set) | — | 없음 |
| **② 이슈 할당** (담당+브랜치) | `impl_assigned` | `action=assigned`, `issue.number==N` | `issues` | **구독 1개 추가** |
| **④ PR·리뷰 대기** | `impl_pr_open` | `action=opened`, `feature/N-` 매칭 | `pull_request` | 없음 (기존) |
| **⑤ 병합 완료** | `impl_merged` | `action=closed` + `merged:true` | `pull_request` | 없음 (기존) |

- **추가되는 인프라는 `issues` 이벤트 구독 하나뿐.** `pull_request`(④⑤)는 이미 수신 중.
- 브랜치 매칭: `pr.head.ref.match(/^feature\/(\d+)-/)` → `N` → `implIssueNumber == N`인 feature. `feature/N-ui`, `feature/N-data`처럼 쪼개져도 같은 접두라 자연히 묶인다.

## 5. 연결 플로우 — 버튼 → 이슈 자동 생성

문서 PR이 `merged`되면 대시보드가 **[🔗 구현 이슈 생성]** 버튼을 노출한다. 클릭 시 `createSpecPR`과 동일 패턴의 Cloud Function이 GitHub 이슈를 만든다.

```
문서 PR merged ─→ [🔗 구현 이슈 생성] 클릭
                   │
                   ▼  createImplIssue (BE)
        Team-MINO-Android 이슈 #N 생성 (담당자 비움)  +  feature.implIssueNumber = N
                   │
   개발자: /issue N 로 기존 이슈 pick + self-assign + feature/N-… 브랜치
                   │
        웹훅: issues.assigned → ② / PR opened → ④ / merged → ⑤
```

**이슈 본문(`implIssueBody`)에 spec·plan에서 자동 구성**할 것:
- `docs/specs/{slug}/spec.md` · `plan.md` 원문 링크(merged 경로)
- spec 버전, `figmaSources`
- spec의 인수 조건/화면 목록을 체크리스트로 (S1–S6 구조라 파싱 가능)

> **중요 디테일:** `createImplIssue`는 **담당자를 비워** 생성한다. 그래야 `/issue` pick 시의 self-assign이 `issues.assigned`로 발화되어 ①(생성)과 ②(할당)가 구분된다. 생성 시점에 담당자를 박으면 할당 이벤트가 뛰지 않는다.

## 6. 드리프트 — `implStale` (기존 machinery 재활용)

`planStale`([js/app.js](../../js/app.js) `renderKpis`)과 동일한 개념을 구현 트랙에 적용한다.

- 구현 이슈/PR 생성 시 `implSpecVersion = 현재 specVersion` 을 기록(대상 버전 고정).
- 승인 후 spec 수정 → 무효화 연쇄([js/store-firebase.js](../../js/store-firebase.js) `saveSpec`의 bump)에서, `implSpecVersion < 현재 specVersion` 이면 `implStale = true`.
- UI: `planStale` 빨간 뱃지 패턴 그대로 → "구현이 구버전(v1.2.0) 기준".

## 7. UI 표면

### 7.1 상세 패널 "구현" 섹션 (기존 "문서" 섹션 아래)

`merged` + `implIssueNumber` 없음 → **[🔗 구현 이슈 생성]** 버튼. 생성 후 아래 목업처럼 노출:

```
┌─ 구현 ─────────────────────────────────────────────┐
│ 상태  [② 할당됨]              구현 이슈 #123 ↗       │
│ 이슈생성 ─●─ 할당 ─●─ PR ─○─ 머지                   │ ← 미니 스텝퍼
│ 담당자   🧑 김은석 @eunseok                          │
│ 브랜치   feature/123-now-openchat-ui ↗              │
│          └ 마지막 커밋 2시간 전 · 8 commits          │ (Tier2)
│ PR       #124 "구현: 오픈챗 진입" [리뷰중] ↗         │
│          └ 코드리뷰 1/2 승인 · CI ✅ · +340 −50      │ (Tier2)
│ 대상버전 v1.2.0   ⚠️ 현재 spec v1.3.0 (stale)        │
└─────────────────────────────────────────────────────┘
```

**Tier 1 — 웹훅/보유 데이터로 공짜 (추가 인프라 0)**

| 요소 | 내용 | 출처 |
|---|---|---|
| 담당자 | 아바타 + 이름 + `@githubLogin`. 미할당 시 "미할당" | `issues.assigned` (이름은 `auth.userOf`로 uid↔이름 매핑) |
| 작업 브랜치 | `feature/N-…` + GitHub 링크. 여러 개면 목록 | PR `head.ref` |
| 구현 PR | #번호 + 제목 + 상태 뱃지(open/merged/closed) + 링크 | `pull_request` |
| 미니 스텝퍼 | 이슈생성→할당→PR→머지, 각 단계 완료 시각 | 상태 전이 타임스탬프 |
| 대상 버전 / stale | `implSpecVersion` + 현재 spec과 다르면 ⚠️ | 기존 versionLog |
| 리드타임 | "문서 머지 후 5일째 구현 중" 경과 뱃지 | 타임스탬프 차 |

**Tier 2 — GitHub API 추가 조회 필요 (선택 · 온디맨드 또는 웹훅 캐시)**

| 요소 | 내용 | API |
|---|---|---|
| 코드리뷰 상태 | "1/2 승인" · changes_requested · 리뷰 대기 (`/review` 플로우와 직결) | PR reviews |
| CI 상태 | ✅/❌ | check-runs |
| 변경 규모 | +files · +/−lines | PR |
| 브랜치 활동성 | 마지막 커밋 시각 · commit 수 | commits |
| 아바타 이미지 | 담당자 GitHub 아바타 | avatar URL |

### 7.2 목록 · KPI 레벨

- **feature 목록 행에 구현 상태 뱃지** — 표에서 한눈에 (상태/버전/PR 컬럼 옆)
- **KPI 확장** — `renderKpis`에 "구현 대기 / 구현중 / 구현완료"
- **필터칩 확장** — "구현중" + **"내가 구현 담당"**(assignee=나 → 개발자의 "내 할 일" 뷰)
- **정체 경고(aging)** — 문서 머지 후 *N일째 이슈 생성 안 됨* / *이슈만 있고 착수 안 됨* → `planStale` 빨간 뱃지 패턴 재사용

## 8. 데이터 모델 (신규 필드)

feature 문서에 추가:

| 필드 | 타입 | 설명 | 출처 |
|---|---|---|---|
| `implIssueNumber` | number\|null | 구현 이슈 번호 N (조인 키) | createImplIssue |
| `implIssueUrl` | string | 이슈 링크 | createImplIssue |
| `implStatus` | enum | `impl_todo`/`impl_assigned`/`impl_pr_open`/`impl_merged` | 웹훅 롤업 |
| `implAssignee` | string\|null | 담당자 githubLogin (미할당=null). 이름은 `auth.userOf`로 매핑 | `issues.assigned` |
| `implBranch` | string\|string[] | 작업 브랜치 `feature/N-…` (여러 개 가능) | PR `head.ref` |
| `implPrNumber` / `implPrUrl` | number/string | 구현 PR (여러 개면 대표 또는 배열) | `pull_request` |
| `implTimestamps` | object | `{ issueAt, assignedAt, prAt, mergedAt }` — 스텝퍼·리드타임·aging용 | 각 전이 시각 |
| `implSpecVersion` | string | 구현이 대상한 spec 버전 (드리프트 기준) | PR 생성 시점 specVersion |
| `implStale` | bool | spec가 그 이후 bump되어 구현이 낡음 | 무효화 연쇄 |

> **Tier 2 요소(코드리뷰·CI·변경규모·커밋활동·아바타)는 저장하지 않고** feature 열 때 GitHub API 온디맨드 조회 또는 웹훅 이벤트 시 캐시. MVP는 위 저장 필드만.
> 확장성 고려 시 `implementations[]`를 **서브컬렉션**으로 두는 선택지도 있다(한 feature ⇄ 다수 PR·브랜치). MVP는 대표 필드로 시작.

## 9. 크로스레포 의존 (Team-MINO-Android 소관, MASC 밖)

- `(XR)` `/issue` — **이슈 번호 인자로 기존 이슈 pick + self-assign + 브랜치 생성** 지원하도록 수정 ([.claude/commands/issue.md](https://github.com/mash-up-kr/Team-MINO-Android))
- `(ops)` GitHub App — **`issues` 이벤트 구독 추가** (기존 `pull_request`에 더해)

## 10. 단계별 체크리스트

### P4.1 · 연결 + 감지 (MVP)
- [ ] `(XR)` `/issue` 기존 이슈 pick 지원 (선행 의존)
- [ ] `(ops)` GitHub App `issues` 이벤트 구독 추가
- [ ] `(BE)` `createImplIssue` — spec·plan 기반 이슈 본문, 담당자 비움, `implIssueNumber` 기록
- [ ] `(BE)` `githubWebhook` 확장 — `issues.assigned`(②, `implAssignee`·`implTimestamps`) + `feature/N-` PR `opened`(④, `implBranch`·`implPrNumber`)/`merged`(⑤) 분기 → `implStatus` 롤업
- [ ] `(FE)` 상세 "구현" 섹션 (Tier 1) — [🔗 구현 이슈 생성] 버튼 · 미니 스텝퍼 · **담당자 · 작업 브랜치 · 구현 PR·상태 · 대상버전** (§7.1 목업)
- [ ] `(FE)` 목록 행 구현 상태 뱃지 + KPI(구현 대기/중/완료) + 필터칩("구현중"·"내가 구현 담당")

### P4.2 · 드리프트 + aging
- [ ] `(BE/FE)` `implSpecVersion` 기록 + 무효화 연쇄에서 `implStale` 판정
- [ ] `(FE)` `implStale` 뱃지 + 리드타임·정체 경고 (`planStale` 패턴 재사용)

### P4.3 · Tier 2 리치 정보 (선택 · GitHub API 온디맨드)
- [ ] `(FE/BE)` 코드리뷰 상태(`/review` 결과) · CI 상태 · 변경 규모(+/−) · 브랜치 마지막 커밋 · 담당자 아바타

## 11. 보류 / 후속

- **릴리스 추적** — 구현 PR 머지 후 GitHub Release/milestone 연결("v3.4.0에 나감"). 별도 논의(P4.3 후보).
- **"작업 진행중" 상태** — draft PR 또는 `push` 감지로 가능하나 이번 범위 제외(§2).
- **다중 이슈/PR 롤업** — 한 feature가 여러 이슈로 쪼개질 때. 현재는 1 feature ⇄ 1 이슈 ⇄ (접두 매칭으로) 다수 PR 가정.

## 12. 의사결정 로그

- **조인 키 = 이슈 번호** (slug 아님) — 실제 브랜치 컨벤션이 `feature/{이슈번호}-…`이기 때문.
- **연결 = 대시보드가 이슈 생성** (버튼) → `/issue`가 pick. 개발자 수동 역링크(B안)·커밋 트레일러(C안)는 미채택.
- **상태 = 4점**(①②④⑤). "작업 진행중"(③) 제외.
- **감지 = 기존 웹훅 확장** + `issues` 구독 하나. 온디맨드 조회·`create`/`push` 구독은 미채택.
- **릴리스 추적 = 보류**, 앞 단계부터 순차 진행.
