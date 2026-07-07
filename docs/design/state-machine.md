# 파이프라인 상태머신 (구현 명세)

> 출처: [PRD](../PRD.md) 4.5 · 4.8 · 6장 · 8장
> 상태: **구현 완료 (M0–M4 MVP, 실 백엔드 검증)** · v2 재설계 기준
> 단위: `docs/specs/{feature}/` 한 묶음(spec.md + plan.md)이 **단일 `status`** 를 가진다.

문서 "진실"은 Firestore(`features/{id}`)다. 레포 파일은 스냅샷이며 역수정하지 않는다.

## 1. 상태(enum) — 8개

| status | 의미 | 편집 권한 | spec | plan |
|---|---|---|---|---|
| `spec_draft` | spec 작성/수정 중 (초기 상태) | 개발자 | 편집가능 | 잠금 |
| `spec_in_review` | 디자이너 검토 중 | **read-only** | 잠금 | 잠금 |
| `spec_changes_requested` | 반려됨 | 개발자 | 편집가능 | 잠금 |
| `spec_approved` | spec 컨펌 완료 → plan 잠금 해제 | (수정 시 무효화) | read-only* | 편집가능 |
| `plan_drafted` | plan 작성 완료, PR 준비 | 개발자 | read-only* | 편집가능 |
| `pr_open` | 문서 PR 열림 | — | — | — |
| `merged` | 머지 완료 (종료 → 구현 단계로) | — | — | — |
| `pr_closed` | PR 미머지 종료 | — | — | — |

\* `spec_approved`/`plan_drafted`에서 spec을 **어떤 수정이든** 하면 무효화 연쇄(§3) 발동.

## 2. 전이표 (trigger → guard → 결과)

| from | trigger | guard | to | 부수효과 |
|---|---|---|---|---|
| `spec_draft` | 컨펌요청 | 구조검증 통과(validation.md) · role=developer | `spec_in_review` | spec read-only 잠금 |
| `spec_changes_requested` | 컨펌요청(재요청) | 위와 동일 | `spec_in_review` | — |
| `spec_in_review` | 승인 | role=designer | `spec_approved` | `reviews/` 기록 · plan 잠금 해제 |
| `spec_in_review` | 반려+코멘트 | role=designer · 코멘트≥1 | `spec_changes_requested` | `reviews/` 기록 |
| `spec_approved` | plan 붙여넣기 | role=developer · planBody 존재 | `plan_drafted` | — |
| `plan_drafted` | PR 생성 | role=developer · 로그인 토큰이 PR 권한 보유 | `pr_open` | `createSpecPR` 호출 · prNumber/prUrl 기록 |
| `pr_open` | Webhook: merged | HMAC 검증 | `merged` | 최초 머지 시 specVersion 승격(→v1.0.0) |
| `pr_open` | Webhook: closed(미머지) | HMAC 검증 | `pr_closed` | — |
| `pr_closed` | 재오픈/재PR | role=developer | `pr_open` | 새 PR 또는 재오픈 |

> **PR 권한 정정(2026-07-04)**: Firebase Auth GitHub provider가 GitHub App client로 설정돼 있어 **로그인 토큰이 이미 PR-capable**(user-to-server). 별도 `authorize`/`githubOAuthExchange` 온보딩은 폐기됐다 — 로그인=신원+PR권한 겸함.

### 무효화 전이 (어느 상태에서든)
| from | trigger | to | 부수효과 |
|---|---|---|---|
| `spec_approved` · `plan_drafted` · `pr_open` · `merged` | spec 수정 | `spec_draft` | `planStale=true` · 열린 PR 자동 close(`closeSpecPR`, 새 버전 링크 코멘트) · specVersion bump(승인후=minor / 머지후=major) |

## 3. 무효화 연쇄 (4.5 · 4.8 · M4)

`spec_approved`(또는 `plan_drafted`/`pr_open`/`merged`) 이후 spec 본문을 수정하면:
1. `status → spec_draft` 복귀 (재컨펌 필수)
2. `planStale = true` (하위 plan에 "오래됨" 표시)
3. 열린 PR(`pr_open`)이 있으면 **자동 close**(`closeSpecPR`) + 코멘트에 새 버전 링크
4. `specVersion` **자동 bump** — 대시보드가 소유(§ 아래). 파급범위 기준: 승인후 수정=minor, 머지후 수정=major. 새 항목이 `versionLog`에 append되고 `변경 이력` 표는 이 로그로부터 재생성.

> **버저닝 소유권(2026-07-06)**: `specVersion`은 더 이상 본문 `변경 이력` 표에서 **파싱하지 않는다**. 대시보드가 `versionLog[]`(버전·이벤트·사유·날짜·스냅샷)를 소유하고, 상태 전이 이벤트에서만 bump한다(저장마다 X — 노이즈 방지). `## 변경 이력` 표는 이 로그로부터 자동 생성돼 specBody·PR 커밋 파일에 주입된다(`js/version.js`·`functions/index.js` 미러). bump 레벨: `init`(최초) · `patch`(반려→재제출) · `minor`(승인후 무효화) · `major`(머지후 무효화) · `graduate`(최초 머지 → v1.0.0).

> plan은 별도 대시보드 컨펌 게이트가 **없다**. plan 검증은 PR 리뷰(얼라인)가 흡수. 디자이너는 spec에만 관여.

## 4. 다이어그램

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
  └──[무효화] spec_approved 이후 spec 수정 시 → spec_draft 복귀
            (planStale=true, 열린 PR 자동 close)
```

## 5. 마일스톤 매핑 (어느 전이가 어느 M에서 동작하는가)

| 전이 | M |
|---|---|
| `spec_draft` 생성 · 구조검증 | M1 |
| `→spec_in_review`/`→spec_approved`/`→spec_changes_requested` (컨펌 게이트) | M2 |
| `→plan_drafted` · `→pr_open` (createSpecPR) | M3 |
| `→merged`/`→pr_closed` (Webhook) · 무효화 연쇄 | M4 |

→ **8개 상태 전부 도달·전이 완결 = MVP 정의.**
