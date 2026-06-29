# 파이프라인 상태머신 (구현 명세)

> 출처: [mino_spec.md](../../mino_prd/mino_spec.md) 4.5 · 4.8 · 6장 · 8장
> 상태: 설계(미구현) · v2 전면 재설계 기준
> 단위: `specs/{feature}/` 한 묶음(spec.md + plan.md)이 **단일 `status`** 를 가진다.

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
| `plan_drafted` | PR 생성 | role=developer · GitHub App authorized | `pr_open` | `createSpecPR` 호출 · prNumber/prUrl 기록 |
| `pr_open` | Webhook: merged | HMAC 검증 | `merged` | (종료) |
| `pr_open` | Webhook: closed(미머지) | HMAC 검증 | `pr_closed` | — |
| `pr_closed` | 재오픈/재PR | role=developer | `pr_open` | 새 PR 또는 재오픈 |

### 무효화 전이 (어느 상태에서든)
| from | trigger | to | 부수효과 |
|---|---|---|---|
| `spec_approved` · `plan_drafted` · `pr_open` | spec 수정 | `spec_draft` | `planStale=true` · 열린 PR 자동 close(새 버전 링크 코멘트) · specVersion 증가 |

## 3. 무효화 연쇄 (4.5 · 4.8 · M4)

`spec_approved` 이후 spec 본문을 수정하면:
1. `status → spec_draft` 복귀 (재컨펌 필수)
2. `planStale = true` (하위 plan에 "오래됨" 표시)
3. 열린 PR(`pr_open`)이 있으면 **자동 close** + 코멘트에 새 버전 링크
4. `specVersion`은 spec.md `변경 이력` 최신 행 버전명으로 재파싱

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
