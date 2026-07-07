# 🧑‍💻 개발자 사용 가이드

개발자는 스펙을 **작성·업로드**하고, 디자이너 컨펌을 거쳐 **문서 PR까지 배출**하는 주체입니다.
디자이너용 가이드는 [DESIGNER.md](DESIGNER.md)를 참고하세요.

> 파이프라인 상태 정의·전이 규칙은 [state-machine.md](../design/state-machine.md), 아래 액션 권한은 [firestore.rules](../../firestore.rules)로도 강제됩니다.

---

## 0. 로그인 & 화면 구성

1. 대시보드 접속 → **GitHub 로그인**(팝업). 로그인 토큰이 그대로 PR 권한을 가집니다(별도 authorize 없음).
2. 최초 로그인 시 **역할 선택** → `개발자`.
3. 화면 구성
   - **상단 KPI** — 전체 / 작성중 / 검토중 / 승인됨 / PR 열림 / 머지됨 / plan 오래됨
   - **좌측 파이프라인 필터** — 8개 상태별 개수 + 빠른 필터(plan 오래됨 · PR 연결 · **내 담당**)
   - **중앙 목록** — Feature 검색, 상태/버전/PR 컬럼
   - **우측 상세 패널** — 스텝퍼 · 출처 · 문서 · 변경 이력 · **액션 버튼**
   - 우측 상단 **`스킬 안내`** / **`상태 안내`**에서 스킬 사용법·상태 범례 확인

---

## 1. 스펙 작성 (로컬)

대시보드 밖, **Mino-Android 레포의 로컬 스킬**로 산출물을 만듭니다. `스킬 안내` 버튼에 실행법이 있습니다.

- `git pull` → `spec-gen` 실행(+ Figma URL) → `spec.md` · 이미지 생성
- `spec-reviewer`로 1차 자가검수 (대시보드 검증과 동일 기준의 사전 방어선)

## 2. 업로드 + 구조 검증

`+ 새 스펙 업로드` → 편집기 모달.

- **spec.md 붙여넣기**(라이브 마크다운 프리뷰 제공) + **이미지 drag-drop**
- **figmaSources**(Figma URL) 입력
- 저장 시 **S1–S6 구조 검증**([validation.md](../design/validation.md)) 통과해야 생성됩니다. 실패하면 항목별 인라인 에러가 뜨고 저장이 막힙니다.
- 통과 시 `status = spec_draft`, 버전 `v0.1.0`으로 생성.

> 검증 항목 요약: S1 slug 주석 · S2 필수 H2 8개 · S3 화면 이미지 · S4 통제 어휘(interactionType·확정) · S5 이미지 정합 · S6 변경이력 버전.

## 3. 컨펌 요청

`spec_draft`(또는 반려된 `spec_changes_requested`) 상세에서 **`컨펌 요청`** →
`spec_in_review`로 전환되고 **spec이 read-only로 잠깁니다**(검토 중 수정 불가).

## 4. 반려 반영 → 재요청

디자이너가 반려하면 `spec_changes_requested`가 됩니다.

- **`spec 수정`**으로 코멘트를 반영해 다시 업로드
- **`컨펌 요청`**으로 재제출 → 버전이 **patch** bump(예: `v0.1.0 → v0.1.1`)

## 5. plan 작성

승인(`spec_approved`)되면 plan 잠금이 풀립니다. **`plan 붙여넣기`**로 `plan.md`를 저장 → `plan_drafted`.

## 6. PR 생성

`plan_drafted`에서 **`PR 생성`** →
`docs/spec-{slug}-{version}` 브랜치 생성 → spec·plan·이미지 커밋 → **PR 자동 생성**(base `develop`, 라벨 `spec`, assignee=본인). 상태 `pr_open`, PR 번호/링크 기록.

## 7. 무효화 (승인/PR 이후 수정)

승인 이후(`spec_approved`/`plan_drafted`/`pr_open`/`merged`)에 **`spec 수정`**을 하면 자동으로:

- `spec_draft`로 **복귀**(재컨펌 필요) · `planStale = true`
- 열린 PR이 있으면 **자동 close**(새 버전 링크 코멘트)
- 버전 bump — 승인 후 수정=**minor**, 머지 후 수정=**major**

## 8. 변경 이력 & 재검토 diff

상세 패널의 **변경 이력(자동)**에서 각 버전의 사유를 확인·편집할 수 있고, 재검토 시 **"지난 검토 이후 변경분"** diff를 열어볼 수 있습니다. `변경 이력` 표는 대시보드가 소유해 커밋 파일에도 자동 주입됩니다.

---

## 상태별 개발자 액션 (한눈에)

| 상태 | 버튼 | 다음 |
|---|---|---|
| `spec_draft` · `spec_changes_requested` | `spec 수정` · **`컨펌 요청`** | → `spec_in_review` |
| `spec_approved` | `spec 수정` · **`plan 붙여넣기`** | → `plan_drafted` |
| `plan_drafted` | `spec 수정` · `plan 수정` · **`PR 생성`** | → `pr_open` |
| `pr_open` | `spec 수정`(→무효화) · `PR 보기` | 웹훅으로 `merged`/`pr_closed` |
| `merged` | `spec 수정`(→major 무효화) · `PR 보기` | 새 PR 라운드 |

```
업로드(S1–S6) → spec_draft ──컨펌요청──▶ spec_in_review
   ▲                                          │ 디자이너 검토
   │  (반려 반영 후 재요청)                     ▼
   └── spec_changes_requested ◀──반려── ┐   승인 → spec_approved
                                             │        │ plan 붙여넣기
                                             │        ▼
                                             │   plan_drafted ──PR 생성──▶ pr_open
                                             │                    웹훅 → merged / pr_closed
   승인 이후 spec 수정 = 무효화(→spec_draft 복귀 · PR 자동 close · 버전 bump)
```

관련 문서: [상태머신](../design/state-machine.md) · [구조 검증](../design/validation.md) · [데이터 모델](../design/data-model.md) · [디자이너 가이드](DESIGNER.md)
