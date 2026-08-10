# 🧑‍💻 개발자 사용 가이드

개발자는 스펙을 **작성·업로드**하고, 디자이너 컨펌을 거쳐 **spec PR까지 배출**하는 주체입니다.
디자이너용 가이드는 [DESIGNER.md](DESIGNER.md)를 참고하세요.

> 파이프라인 상태 정의·전이 규칙은 [state-machine.md](../design/state-machine.md), 아래 액션 권한은 [firestore.rules](../../firestore.rules)로도 강제됩니다.

---

## 0. 로그인 & 화면 구성

1. 대시보드 접속 → **GitHub 로그인**(팝업). 로그인 토큰이 그대로 PR 권한을 가집니다(별도 authorize 없음).
2. 최초 로그인 시 **역할 선택** → `개발자`.
3. 화면 구성
   - **상단 KPI** — 전체 / 작성중 / 검토중 / 승인됨 / PR 열림 / 머지됨
   - **좌측 파이프라인 필터** — 7개 상태별 개수 + 빠른 필터(PR 연결 · **내 담당**)
   - **중앙 목록** — Feature 검색, 상태/버전/PR 컬럼
   - **우측 상세 패널** — 스텝퍼 · **대상 브랜치** · 출처 · 문서 · 버전 스냅샷 · **액션 버튼**
   - 우측 상단 **`스킬 안내`** / **`상태 안내`**에서 스킬 사용법·상태 범례 확인

---

## 1. 이슈와 base 브랜치 만들기 (로컬, 스펙보다 먼저)

Mino-Android 레포에서 **`/issue`** 를 실행하면 이슈와 함께
`<prefix>/<이슈번호>-<slug>/base` 브랜치가 생성됩니다.

이 브랜치가 이 기능의 **작업 루트**입니다. spec·plan·task 모든 하위 작업이 여기서 분기하고 여기로 머지됩니다
(Mino-Android `docs/conventions/base-branch.md`). 대시보드는 spec 업로드 시 이 브랜치를 조회해 선택지로 보여줍니다.

## 2. 스펙 작성 (로컬)

대시보드 밖, **Mino-Android 레포의 로컬 스킬**로 산출물을 만듭니다. `스킬 안내` 버튼에 실행법이 있습니다.

- `git pull` → **`/mino-spec`** 실행 (기능 설명 + Figma URL) → `docs/specs/{feature}/spec.md` + `quality/spec-checklist.md` 생성
- 품질 체크리스트가 **PASS** 해야 spec 헤더가 `**상태**: CREATED`가 됩니다 — 이게 1차 방어선입니다. 다만 **`DRAFT` 상태나 `[TBD]`가 남은 스펙도 업로드할 수 있습니다**: 확정이 안 된 항목일수록 디자이너 검수에 올려서 답을 받는 게 맞기 때문입니다(경고만 표시됩니다)
- 개정도 같은 스킬로 합니다. **버전(MAJOR/MINOR/PATCH)은 스킬이 사용자 승인 하에 판정**하고 헤더 `**버전**`을 올립니다. 대시보드는 그 값을 읽기만 합니다

## 3. 업로드 + 구조 검증

`+ 새 스펙 업로드` → 첨부 모달. **`/mino-spec` 산출물 2개를 모두 올립니다.**

- **파일 첨부 전용입니다** — 붙여넣기 편집창은 없앴습니다. 문서를 만드는 것도 고치는 것도 로컬 스킬의 일이고, 대시보드는 파일을 그대로 받습니다
- **두 파일을 한 번에 드롭**하면 본문 H1으로 자동 분류됩니다(`# 스펙 명세서:` → spec 슬롯, `# Spec 품질 체크리스트:` → 체크리스트 슬롯). 판별에 실패하면 슬롯의 `파일 선택`으로 직접 지정하세요
- 두 슬롯 모두 채워야 저장됩니다. 오른쪽 프리뷰의 **탭**으로 문서를 전환해 렌더 결과를 확인할 수 있습니다
- **대상 base 브랜치 선택** — `/issue`가 만든 `…/base` 목록이 GitHub에서 조회돼 셀렉트로 뜹니다. 선택하지 않으면 저장할 수 없습니다
- 출처 Figma 링크는 **spec 본문 §1의 `**Figma**:` 줄에서 자동 수집**됩니다(수기 입력란 없음)
- 저장 시 **spec S1–S6 · 체크리스트 C1–C7 구조 검증**([validation.md](../design/validation.md))을 통과해야 생성됩니다. 실패하면 어느 파일의 어느 항목인지 인라인 에러로 뜨고 저장이 막힙니다
- **경고(노란 박스)는 저장을 막지 않습니다** — 상태 `DRAFT`, 미해소 `[TBD]`, 체크리스트 `FAILED`·미체크 항목, 버전 불일치입니다. 그대로 올리고 검수에서 확정하세요
- 통과 시 `status = spec_draft`, 버전은 spec 헤더 `**버전**` 값 그대로
- 기존 스펙 수정 시엔 두 슬롯이 `기존 문서 유지`로 채워져 열립니다. 바꿀 문서만 교체하면 됩니다

> 검증 항목 요약 — **spec**: S1 대상 스펙 경로·제목 · S2 필수 H2 4개 · S3 헤더 메타(상태·버전·날짜·기준 PRD) · S4 FR/UX/SC ID · S5 유저 플로우 구조(진입/완료 조건·TS 표) · S6 템플릿 자리표시자 잔여 0건.
> **체크리스트**: C1 H1 제목 · C2 헤더 메타(작성일·대상 스펙) · C3 상태 어휘 · C4 필수 H2 4개 · C5 체크박스 존재 · C6 자리표시자 잔여 0건.
> 경고(비차단): spec 상태가 `CREATED`가 아님 · `[TBD]` 잔여 · 체크리스트가 `PASS`가 아님 · 미체크 항목 · 체크리스트 대상 버전 불일치(C7).

## 4. 컨펌 요청

`spec_draft`(또는 반려된 `spec_changes_requested`) 상세에서 **`컨펌 요청`** →
`spec_in_review`로 전환되고 **spec이 read-only로 잠깁니다**(검토 중 수정 불가).

## 5. 반려 반영 → 재요청

디자이너가 반려하면 `spec_changes_requested`가 됩니다.

- 로컬에서 **`/mino-spec`** 으로 코멘트를 반영해 개정(버전 등급은 스킬이 판정)
- **`spec 수정`**으로 재업로드 → **`컨펌 요청`**으로 재제출

## 6. PR 생성

승인(`spec_approved`)되면 **`PR 생성`** 이 열립니다 →

- `<prefix>/<이슈번호>-<slug>/spec` 브랜치를 **base 브랜치에서 분기**
- `docs/specs/{slug}/spec.md` + `docs/specs/{slug}/quality/spec-checklist.md` 커밋 (plan·이미지 커밋 없음). Contents API 라 파일당 1커밋이므로 커밋 2개가 올라갑니다
- **PR 생성 — base는 `develop`이 아니라 그 이슈의 `…/base` 브랜치** (라벨 `spec`, assignee=본인)
- 상태 `pr_open`, PR 번호/링크 기록

## 7. 이후 단계 (plan / task)

spec PR이 base 브랜치에 머지되면 대시보드의 역할은 끝납니다. **plan·task는 대시보드를 거치지 않고**
같은 base 브랜치 아래에서 **`/mino-plan`** · **`/mino-task`** 로 진행하고, 각 하위 브랜치의 PR도 base 브랜치를 타겟합니다.

## 8. 무효화 (승인/PR 이후 수정)

승인 이후(`spec_approved`/`pr_open`/`merged`)에 **`spec 수정`**을 하면 자동으로:

- `spec_draft`로 **복귀**(재컨펌 필요)
- 열린 PR이 있으면 **자동 close**(무효화 코멘트)
- 헤더 버전이 그대로면 **버전 미변경 경고** — 로컬 `/mino-spec` 개정으로 버전을 올린 뒤 다시 올리세요

## 9. 버전 스냅샷 & 재검토 diff

상세 패널의 **버전 스냅샷**에서 각 버전의 메모를 확인·편집할 수 있고, 재검토 시 **"지난 검토 이후 변경분"** diff를 열어볼 수 있습니다. MAJOR/MINOR/PATCH 뱃지는 직전 스냅샷과의 semver 비교로 표시되는 파생값이며, 버전 값 자체는 `/mino-spec`이 소유합니다.

---

## 상태별 개발자 액션 (한눈에)

| 상태 | 버튼 | 다음 |
|---|---|---|
| `spec_draft` · `spec_changes_requested` | `spec 수정` · **`컨펌 요청`** | → `spec_in_review` |
| `spec_approved` | `spec 수정` · **`PR 생성`** | → `pr_open` |
| `pr_open` | `spec 수정`(→무효화) · `PR 보기` | 웹훅으로 `merged`/`pr_closed` |
| `merged` | `spec 수정`(→무효화) · `PR 보기` | 새 PR 라운드 |

```
/issue → base 브랜치        업로드(S1–S6 + base 선택) → spec_draft ──컨펌요청──▶ spec_in_review
                               ▲                                                    │ 디자이너 검토
                               │  (반려 반영 후 재요청)                              ▼
                               └── spec_changes_requested ◀──반려── ┐   승인 → spec_approved
                                                                         │        │ PR 생성
                                                                         │        ▼
                                                                         │      pr_open ──웹훅──▶ merged / pr_closed
                                                                         │                          │
   승인 이후 spec 수정 = 무효화(→spec_draft 복귀 · PR 자동 close)          머지 후: /mino-plan · /mino-task
```

관련 문서: [상태머신](../design/state-machine.md) · [구조 검증](../design/validation.md) · [데이터 모델](../design/data-model.md) · [디자이너 가이드](DESIGNER.md)
