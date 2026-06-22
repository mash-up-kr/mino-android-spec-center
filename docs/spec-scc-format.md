# MASC 스펙 포맷 재설계 — SCC screen.md 방식

> 상태: 설계(미구현) · 작성일 2026-06-18
> 목적: MASC의 spec 문서를 LinkIt-KMP **Spec Command Center(SCC)** 의 `*-screen.md`
> 구조로 확장하고, spec → plan → tasks 캐스케이드의 단일 원천으로 만든다.

## 1. 배경 / 원칙

- **Figma를 기본 전제**로 둔다. spec의 모든 항목은 Figma description·화면 텍스트·참조 이미지에 근거하며, 추가 기획서(PRD)는 보조 자료로 reconcile 한다.
- **spec = 유일한 원천.** plan은 spec의 설계 번역, tasks는 plan의 커밋 단위 분해. 새 사실이 plan/tasks에서 생기면 spec으로 역류시킨다.
- 화면 1개 = spec 1개. 화면 안의 인터랙션을 **item(원자 단위)** 으로 쪼개고 **subarea(영역)** 로 그룹화한다. (SCC와 동일)
- **가독성 우선 — 줄글 최소화, 가능한 표로.** 한눈에 보기/화면 상태별 읽기/UX 규칙/사용자 흐름/비목표/Open Questions/변경 이력은 모두 표로 작성한다. 산문은 표로 표현하기 어려운 보충 설명에만 쓴다. (예시: `docs/examples/005-now-openchat.spec.md`)

## 2. 현재 모델 (기준점)

`data/feature-list.js` schemaVersion 2 기준, feature 1개:

```
{ id, title, module, type, trigger, behavior, designRef,
  items: [ { id, title, trigger, response, specStatus } ],
  tbds, nonGoals, states, tasks: [ { id, module, title, itemRefs } ],
  relatedFeatures, planMd, tasksMd, sources }
```

부족한 점: 화면 상태 서술/UX 규칙/사용자 흐름/Figma 근거 이미지/버전 메타가 없고, item이 영역(subarea)·이미지 근거·인터랙션 분류를 갖지 않는다.

## 3. SCC `screen.md` 구조 (도입 대상)

`main-screen.md` 기준 실제 섹션:

```
# <화면> 스펙
> 기준 Figma: <node> · 스펙 버전: vX.Y.Z

## 1. 한눈에 보기
## 2. 화면 상태별 읽기      (### 2.1 기본 진입 / 2.2 ... 상태별 산문 + 이미지)
## 3. 핵심 UX 규칙
## 4. 참조 정책 이미지       (### 4.x Figma 근거 이미지 + 4.5 이미지 매핑 표)
## 5. 사용자 흐름
## 6. 상세 기능 명세
   ### 6.1 <subarea: 지도>
   | Feature ID | 기능 | Trigger | 화면 반응 | 확정 수준 | 관련 이미지 |
   ### 6.2 <subarea: 바텀시트> ...
```

## 4. 목표 모델

### 4.1 Feature(=화면)

| 필드 | 타입 | SCC 출처 | 상태 |
|------|------|----------|------|
| `id`, `title`, `module`, `type` | | | 유지 |
| `figmaSection` | string | 기준 Figma node | 신규 |
| `specVersion` | string (vX.Y.Z) | 스펙 버전 | 신규 |
| `overview` | string | 1. 한눈에 보기 | 기존 `behavior` 개명 |
| `screenStates` | `[{ name, description, image }]` | 2. 화면 상태별 읽기 | 기존 `states`(label/text) 확장. 상태마다 이미지 1장 인라인 |
| `uxRules` | `string[]` | 3. 핵심 UX 규칙 | 신규 |
| `userFlow` | string | 5. 사용자 흐름 | 신규 |
| `items` | `[Item]` | 6. 상세 기능 명세 | 확장(아래) |
| `tbds`, `nonGoals` | | Open Questions / 비목표 | 유지 |
| `changeLog` | `[{ version, date, change, basis }]` | 변경 이력 | 신규 |
| `planMd`, `tasksMd`, `sources`, `relatedFeatures` | | | 유지 |

### 4.2 Item(=Feature 표 행)

| 필드 | 타입 | 설명 | 상태 |
|------|------|------|------|
| `id` | string | 대문자 스네이크 (LIST_LOAD) | 유지 |
| `title`, `trigger`, `response` | string | 기능 / 언제 / 화면 반응 | 유지 |
| `specStatus` | enum | confirmed/partial/needs_policy/inferred/variant/out_of_scope | 유지 |
| `subarea` | string | 6.x 그룹 (지도/바텀시트…) | 신규 |
| `image` | string | 이 항목 디자인 이미지 1장(URL/경로). 참조 ID 없이 항목에 직접 삽입 | 신규 |
| `interactionType` | enum | 인터랙션 분류 → plan 파생용 (아래 5장). Feature.type(Screen/Component/Infra)과는 다름 | 신규 |

> 이미지 모델: 중앙 갤러리(IMG-id) + 참조 방식을 쓰지 않고 **각 item·screenState에 이미지를 1장씩 직접 인라인**한다. 따라서 §11 결정 4(IMG-id 부여)는 불필요해져 폐기. 같은 이미지를 여러 항목이 공유하면 중복 삽입되지만 Phase 0(URL)에선 부담 없음.

`interactionType` enum(안드로이드 맥락): `display_state` / `user_action` / `navigation` / `async_process` / `validation` / `modal_dialog`.

## 5. 캐스케이드 매핑 (spec → plan → tasks)

```
spec item / feature              plan(MVI·데이터)             task
──────────────────────────────────────────────────────────────────────
item.trigger              →  Intent: OnXxx                →  Intent 처리 task
item.response             →  UiState 변화 / SideEffect     →  상태·효과 구현 task
item.interactionType=async_process →  Repository/UseCase       →  UseCase+테스트 task
item.interactionType=navigation    →  SideEffect.NavigateTo+네비 →  네비 연결 task
feature.screenStates      →  UiState(Loading/Empty/Error)  →  상태 UI task
feature.uxRules           →  불변 제약(Pre-Impl Gate)       →  task DoD 제약
item.image                →  ─                             →  task 디자인 기준(DoD)
item.id                   →  ─                             →  task.itemRefs (커버리지)
```

`interactionType`이 있으면 plan의 Intent/UiState/SideEffect/데이터가 item에서 규칙적으로 도출된다(→ 추후 plan 초안 자동 생성 여지).

## 6. 파서 변경 (`js/spec-parse.js`)

문서가 표 중심이므로 파서도 **마크다운 표 파싱**이 핵심이다. 공통 헬퍼: 표 헤더 라벨로 열 인덱스를 찾고(고정 순서 가정 X), 셀의 인라인 이미지 `![](url)`는 URL만 추출.

- **subarea 인식**: `## 상세 기능 명세` 하위의 `### <subarea>` 헤딩을 읽어, 그 아래 표 행의 `subarea`로 채운다.
- **상세 기능 표**: `| ID | 기능 | Trigger | 화면 반응 | interactionType | 확정 | 이미지 |` → `items[]`. "이미지" 열의 `![](url)`→`item.image`, "확정"→`specStatus`(별칭 정규화), interactionType 열은 선택.
- **신규 섹션(모두 표)**:
  - `## 한눈에 보기`: `| 항목 | 내용 |` → `overview`(요약 객체 또는 합본 문자열).
  - `## 화면 상태별 읽기`: `| 상태 | 설명 | 이미지 |` → `screenStates[]`(name/description/image).
  - `## 핵심 UX 규칙`: `| 규칙 | 내용 |` → `uxRules[]`.
  - `## 사용자 흐름`: `| 단계 | 동작 | 결과 |` → `userFlow[]`(단계 배열).
  - `## 비목표`: `| 제외 항목 | 사유 |` → `nonGoals[]`.
  - `## Open Questions`: `| ID | 결정 주체 | 질문 |` → `tbds[]`.
  - `## 변경 이력`: `| 버전 | 날짜 | 변경 | 근거 |` → `changeLog[]`.
  - frontmatter에 `figmaSection`, `specVersion` 추가.
- 하위호환: 기존 불릿 형식(구 AC/TBD 등)도 표가 없을 때 폴백 파싱 유지.

## 7. 편집기 변경 (`js/app.js`)

- 상위 폼: `figmaSection`, `specVersion`, `overview`, `userFlow` 입력 + `uxRules`/`screenStates`(상태마다 이미지 URL) 리스트 행.
- item 행: 기존 5필드 + `subarea`(text/datalist) + `image`(URL 입력 + 썸네일 미리보기) + `interactionType`(select).
- 상세 패널: items를 **subarea별로 그룹**해 렌더, 각 item·screenState에 **이미지 썸네일 인라인**, 상단에 버전/기준 Figma 표시, "화면 상태별 읽기"·"핵심 UX 규칙" 섹션.

## 8. 프롬프트 변경 (`STAGE_PROMPTS.spec`)

출력 템플릿을 SCC screen.md 골격 + **표 중심**으로 교체. 각 섹션을 표로 출력하게 강제:
1·한눈에 보기(항목/내용 표) → 2·화면 상태별 읽기(상태/설명/이미지 표) → 3·핵심 UX 규칙(규칙/내용 표) → 4·사용자 흐름(단계/동작/결과 표) → 5·상세 기능 명세(subarea별 ID/기능/Trigger/화면반응/interactionType/확정/이미지 표) → 비목표·Open Questions·변경 이력(각 표).
규칙: 줄글 최소화·표 우선, Figma 근거 우선, 미정은 TBD, item ID 대문자 스네이크, 이미지는 항목·상태마다 1장 인라인(`![](url)`). 완성 예시는 `docs/examples/005-now-openchat.spec.md`.

## 9. 이미지 자산 (단계 분리)

- **Phase 0(현재 정적/localStorage)**: `item.image`·`screenState.image`를 **URL/경로 텍스트**로 입력. 썸네일은 `<img src>`로 인라인 표시(업로드 없음).
- **Phase 1(Firebase)**: Storage 업로드 → 업로드된 URL을 그대로 `image`에 저장. 항목별 인라인 유지.

## 10. 마이그레이션

- schemaVersion 2 → 3.
- `store.js migrate()` 확장: `behavior`→`overview` 보존, `states`(label/text) → `screenStates`(name=label, description=text, image=''), 없는 신규 필드는 기본값(`uxRules:[]`, `userFlow:''`, `figmaSection:''`, `specVersion:''`, `changeLog:[]`), item에 `subarea:''`,`image:''`,`interactionType:''` 보강.
- 기존 items 모델(v2)·구 AC(v1) 모두 무손실 흡수.

## 11. 결정 사항 (2026-06-18 확정)

1. **`interactionType` enum = 6분류**: `display_state` / `user_action` / `navigation` / `async_process` / `validation` / `modal_dialog`. (SCC 11종 중 지도 특화 제외, MVI 매핑에 충분)
2. **subarea = 자유 텍스트 + 자동완성**: 자유 입력하되 같은 feature 내 기존 subarea를 `datalist`로 제안해 오타로 인한 그룹 분리 방지.
3. **screenStates ↔ UiState = 권장만(현재)**: `STAGE_PROMPTS.plan`으로 "모든 화면 상태를 UiState로 반영" 안내만 하고 검증은 하지 않는다. plan이 마크다운 산문이라 구조 검증 불가 → plan 구조화 이후 게이트 재검토.
4. ~~IMG-id 부여~~ **폐기**: 중앙 갤러리+참조 대신 **각 item·screenState에 이미지를 1장씩 직접 인라인**하기로 변경(2026-06-18). 참조 ID가 없으므로 부여 규칙 불필요. 같은 이미지를 여러 항목이 쓰면 중복 입력되지만 허용.

## 12. 구현 순서(설계 승인 후)

1. 모델/마이그레이션(`feature-list.js` mock 1건 SCC식으로 재작성, `store.js`)
2. 파서(subarea/이미지/신규 섹션)
3. 편집기 + 상세 렌더(subarea 그룹·이미지)
4. `STAGE_PROMPTS.spec` 골격 교체
5. plan/tasks 프롬프트에 캐스케이드 매핑 규칙 반영
