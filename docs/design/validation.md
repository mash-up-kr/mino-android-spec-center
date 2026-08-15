# 업로드 구조 검증 (구현 명세)

> 출처: [PRD](../PRD.md) 4.2 · Mino-Android `mino-sdd/template/spec-template.md` · `mino-sdd/template/spec-checklist-template.md`
> 상태: **구현 완료** ([js/validate.js](../../js/validate.js) `validateSpec` · `validateChecklist` · `validatePrd`) · v3.1 (문서 2종 첨부) + P8 (PRD) 기준
> 위치: 대시보드 업로드 시 **2차 방어선**. 1차 자가검수는 로컬 `/mino-spec`의 **품질 체크리스트**가 수행하고(통과 시 헤더 `상태: CREATED`), 내용 품질은 컨펌 게이트가 흡수한다. 대시보드는 **기계적 구조 검증만** 한다.
> 단, **미완성 신호(`상태: DRAFT` · `[TBD]` 잔여)는 차단하지 않는다** — 확정되지 않은 항목이야말로 디자이너 검수에 올려야 하는 대상이고, 그게 이 대시보드의 목적이기 때문이다. 경고로 표시하고 저장은 진행한다.

## 0. v2 → v3 무엇이 바뀌었나

spec 템플릿이 전면 교체되면서 검증 대상이 전부 달라졌다.

| | v2 (구 `spec-gen`) | v3 (`mino-sdd/template/spec-template.md`) |
|---|---|---|
| slug 출처 | 첫 줄 `<!-- feature: {slug} -->` 주석 | 헤더 `**대상 스펙 경로**: docs/specs/{slug}` |
| 제목 | `# {기능명}` | `# 스펙 명세서: {기능명}` |
| 필수 H2 | 8개 (한눈에 보기 … 변경 이력) | **4개** (유저 시나리오 · 요구사항 · 범위 · 가정) |
| 화면 근거 | `![](assets/*.png)` 업로드 이미지 | **Figma 노드 URL** (`**Figma**:` 줄) |
| 통제 어휘 | `interactionType`(6) · `확정`(3) | 없음 — 대신 **ID 컨벤션**(FR/UX/SC/TS/EC) |
| 버전 | `## 변경 이력` 표 최신 행 | 헤더 `**버전**: X.Y.Z` |
| 품질 게이트 | `spec-reviewer` 에이전트 | `/mino-spec` 품질 체크리스트 → `상태: CREATED` |

이미지 업로드·Storage·assets 커밋 파이프라인은 **폐기**됐다(구 S3·S5).

## 0-1. v3 → v3.1 — 검증 대상이 문서 2종으로

`/mino-spec` 은 산출물을 **2개** 낸다. 둘 다 업로드하고 둘 다 PR 에 실리되, **디자이너 검수 대상은 spec 하나뿐**이다.

| 문서 | 경로 | 검증 | 검수 |
|---|---|---|---|
| spec | `docs/specs/{slug}/spec.md` | S1–S6 | **디자이너 컨펌 대상** |
| 품질 체크리스트 | `docs/specs/{slug}/quality/spec-checklist.md` | C1–C7 | 읽기 전용 참고 자료 |

업로드는 **붙여넣기가 아니라 파일 첨부**다(v3.1에서 편집창 폐기). 대시보드가 본문을 만들거나 고치지 않는다는 원칙을 UI 로 강제한 것이다. 드롭한 파일은 본문 H1(`# 스펙 명세서:` / `# Spec 품질 체크리스트:`)로 자동 분류되고, 판별에 실패하면 슬롯에서 직접 지정한다.

## 1. 검증 항목 (하드 항목을 모두 통과해야 `spec_draft` 생성·컨펌요청 허용)

| # | 항목 | 규칙 | 차단 |
|---|---|---|---|
| S1 | 경로·제목 | 헤더 `**대상 스펙 경로**: docs/specs/{slug}` 존재 · slug = `^[a-z0-9-]+$` · H1 존재 | 하드 |
| S2 | 필수 H2 4개 | `유저 시나리오` → `요구사항` → `범위` → `가정` 이 **순서대로** 존재 | 하드 |
| S3 | 헤더 메타 | `상태` ∈ {DRAFT, CREATED} · `버전` = `X.Y.Z` · `최초 작성일`/`최종 수정일` = `YYYY-MM-DD` · `기준 PRD 버전` 비어있지 않음 | 하드 |
| S3-w | 상태 DRAFT | `상태`가 `CREATED`가 아니면 **경고** (저장은 진행) | 소프트 |
| S4 | 요구사항 ID | §2.1에 `FR-\d{3}` ≥1 · §2.2에 `UX-\d{3}` ≥1 · §3.1에 `SC-\d{3}` ≥1 · §3.2에 항목 ≥1 | 하드 |
| S5 | 유저 플로우 구조 | `### 유저 플로우 N` ≥1개, 각각 `**진입 조건**`·`**완료 조건**` + Given/When/Then 표에 `TS-\d{3}` ≥1 | 하드 |
| S6 | 자리표시자 잔여 | 템플릿 자리표시자(`[FEATURE NAME]`·`{SPEC_DIR}`·`[날짜]`·`$ARGUMENTS` 등) 0건 | 하드 |
| S6-w | `[TBD]` 잔여 | `[TBD…]`가 남아 있으면 **경고** (저장은 진행) | 소프트 |

> **미완성 스펙은 반려 대상이 아니라 검수 대상이다.** `상태: DRAFT`거나 `[TBD]`가 남아 있다는 건 "디자이너와 확정해야 할 지점이 있다"는 뜻이므로, 대시보드가 막으면 정작 물어볼 곳이 사라진다. 두 신호는 경고로 표시하고 업로드는 통과시키며, 상세 패널·spec PR 체크리스트에 "확정 필요"로 남는다.
>
> 반면 **템플릿 자리표시자(S6)는 계속 하드 차단**이다 — 이건 판단이 필요한 미확정 항목이 아니라 템플릿을 손대지 않은 흔적이다. 헤더 상태 필드가 `[DRAFT, CREATED]` 그대로면 이 규칙에 걸려 여전히 막힌다.

## 1-1. 품질 체크리스트 검증 항목 (C1–C7)

기준: `mino-sdd/template/spec-checklist-template.md`. spec 과 같은 원칙 — **골격은 하드 차단, 미통과는 경고**.

| # | 항목 | 규칙 | 차단 |
|---|---|---|---|
| C1 | H1 제목 | `# Spec 품질 체크리스트: {기능명}` | 하드 |
| C2 | 헤더 메타 | `작성일` = `YYYY-MM-DD` · `대상 스펙` 에서 spec 버전 파싱 가능 | 하드 |
| C3 | 상태 어휘 | `상태` ∈ {PASS, FAILED, DRAFT} | 하드 |
| C3-w | 미통과 상태 | `상태`가 `PASS`가 아니면 **경고** (저장은 진행) | 소프트 |
| C4 | 필수 H2 4개 | `스펙 품질` → `요구사항 완전성` → `스펙 완성도` → `비고` 가 **순서대로** 존재 | 하드 |
| C5 | 체크박스 | `- [ ]` / `- [x]` 항목 ≥1 | 하드 |
| C5-w | 미체크 항목 | 미체크가 있으면 **경고** (`N/M 통과` 로 표시) | 소프트 |
| C6 | 자리표시자 잔여 | `[FEATURE NAME]`·`[날짜]`·`[PASS/FAILED/DRAFT]`·`[spec.md 링크]` 등 0건 | 하드 |
| C7 | spec 버전 대조 | 체크리스트 `대상 스펙` 버전 ↔ spec 헤더 `버전` | 소프트 |

> **C7은 `major.minor` 까지만 비교한다.** 체크리스트 템플릿의 예시 표기가 `v1.0`(2자리)인데 spec 헤더는 `1.0.0`(3자리)이라 엄격 비교하면 정상 산출물이 전부 걸린다. PATCH 차이는 오탐이므로 무시하고, MAJOR/MINOR 가 어긋날 때만 "이전 버전 기준 체크리스트일 수 있음"을 경고한다. 하드로 올리려면 `js/validate.js` 의 `majorMinor` 비교를 원문 비교로 바꾸고 `warn` → `add` 로 바꾸면 된다.
>
> `상태: FAILED` 를 막지 않는 이유는 DRAFT spec 을 막지 않는 이유와 같다 — 자가검증에서 걸린 항목이야말로 디자이너와 확정해야 할 지점이다. 대신 상세 패널 요약과 spec PR 본문 체크리스트에 미체크로 남는다.

## 1-2. PRD 검증 항목 (P1–P7) — P8

같은 `js/validate.js` 의 `validatePrd(body, prevVersion)` 이 상위 문서 PRD 를 검증한다. **정본 표는 [prd-track.md](prd-track.md) §3** 이고 여기서는 spec 검증과의 차이만 짚는다.

| # | 항목 | 차단 |
|---|---|---|
| P1 | H1 `# 제품 요구사항 문서 (PRD): {제품명}` | 하드 |
| P2 | 헤더 **표** (`버전` semver · `생성일`/`최종 수정일`) | 하드 |
| P3 | 필수 섹션 4개 (H1, 순서) | 하드 |
| P4 / P4-w | §2 목표의 `[SYS-00X]`·`[SCR-00X]` ≥1 / §2↔§3 대응 | 하드 / 소프트 |
| P5 | 템플릿 자리표시자 잔여 0건 | 하드 |
| P6 | `TBD:` 잔여 | 소프트 |
| P7 | 버전 역행 차단 · 동일 버전은 확인 후 본문만 갱신 | 하드/확인 |

spec 검증과 다른 점 넷:

1. **헤더가 `**키**: 값` 줄이 아니라 마크다운 표**다. [spec-parse.js](../../js/spec-parse.js) `headerField` 로는 잡히지 않아 [prd-parse.js](../../js/prd-parse.js) `parseTableField` 를 따로 둔다. 섹션 제목도 H2 가 아니라 **H1**(첫 H1 = 문서 제목, 이후 H1 = 섹션).
2. **검증 전 HTML 주석을 스트립한다.** PRD 템플릿은 `<!-- 예시) … -->` 안에 `[SCR-001]`·`[PRODUCT_NAME]` 류를 대량으로 담고 있어, 원문에 그대로 P4·P5 를 돌리면 정상 산출물이 전부 차단된다. 저장되는 `body` 는 원문 그대로다.
3. **미확정 표기가 spec 과 다르다** — spec 은 `[TBD]`(대괄호), PRD 는 `TBD:`(접두). 둘 다 경고이고 차단하지 않는 이유는 §1 과 같다.
4. **P7 은 저장본과의 대조**라 다른 항목처럼 문서 하나만 보고 판정할 수 없다. PRD 는 프로젝트당 1개라 버전 역행이 곧 덮어쓰기이기 때문이다(동시 업로드는 store 의 낙관적 잠금이 따로 막는다 — [prd-track.md](prd-track.md) §11-3).

## 2. 필수 H2 4개 (S2) — 순서·제목

```
## 1. 유저 시나리오 (User Scenarios) *(필수)*
## 2. 요구사항 (Requirements) *(필수)*
## 3. 범위 (Scope) *(필수)*
## 4. 가정 (Assumptions)
```

매칭은 **정규화된 핵심 제목** 기준이다: 숫자 접두사(`1. `), 괄호 영문 병기(` (User Scenarios)`), `*(필수)*` 꼬리표를 벗기고 남는 한글 제목만 비교한다(`js/spec-parse.js` `coreTitle`). 따라서 영문 병기나 필수 표기를 지워도 통과한다.

## 3. ID 컨벤션 (S4·S5)

| 접두사 | 위치 | 뜻 |
|---|---|---|
| `FR-001` | §2.1 기능적 요구사항 | 기능 요구사항 |
| `UX-001` | §2.2 핵심 UX 규칙 | UX 규칙 |
| `SC-001` | §3.1 측정 가능한 성과 | 성공 기준 |
| `TS-001` | 유저 플로우의 테스트 시나리오 표 | Given/When/Then 시나리오 |
| `EC-001` | 유저 플로우의 엣지 케이스 표 | 엣지 케이스 (검증 대상 아님 — 표 존재만 권장) |

§2.3 주요 도메인은 데이터를 다루는 기능일 때만 포함하므로 **검증하지 않는다**(선택 섹션).

## 4. 구현 메모

- 파서는 **본문을 데이터로 파싱하지 않는다**. 헤딩 추출 + 헤더 필드(`**이름**: 값`) + 정규식 검사만.
- `js/spec-parse.js`: `parseMeta(body)` → `{ slug, title, specVersion, specStatus, prdVersion, createdAt, updatedAt, figmaSources }`. 체크리스트는 같은 헬퍼(`headings`/`headerField`/`coreTitle`)를 재사용하는 `parseChecklistMeta(body)` → `{ title, status, createdAt, targetSpecLink, targetVersion, checked, total }`.
- `js/prd-parse.js`(`window.MASCPrd`): PRD 전용 파서. `tableField(src, name)`(표 헤더 한 행) · `parseMeta(body)` → `{ title, version, versionRaw, createdDate, prdAuthor, lastAmendedDate, lastAmendedAuthor, sections, goalIds, specIds, itemIds, tbdCount }`. 헤딩 헬퍼(`S.headings`·`coreTitle`)는 `spec-parse.js` 것을 재사용하고, `strip(src)` 으로 **HTML 주석을 먼저 제거한 사본**에서 판정한다(§1-2). 섹션 diff 보조(`sectionDigest`·`changedSections`)도 여기 있다.
- `js/validate.js`: `validateSpec(body)` · `validateChecklist(body, specMeta)` · `validatePrd(body, prevVersion)` → `{ ok, errors: [{code, msg}], warnings: [{code, msg}], meta }`. 두 결과를 문서별로 묶어 한 박스에 표시한다. `errors`가 하나라도 있으면 저장을 막고, `warnings`는 노란 박스로 표시만 하고 저장은 진행한다(`ok`에 영향 없음). `specMeta`는 C7 대조용이라 생략하면 C7만 건너뛴다.
- 업로드 후에도 미완성 신호는 계속 보인다: 상세 패널 문서 섹션의 `spec-draft-note`(상태 DRAFT · 미해소 `[TBD]` N건)와 `checklist-line`(체크리스트 상태 · N/M 통과), 그리고 spec PR 본문 체크리스트의 미체크 항목(`functions/index.js` `prTemplate`).
- **figmaSources 자동 수집**: §1의 `**Figma**:` 줄에 있는 `http(s)` 링크를 모아 `features.figmaSources`에 저장한다. 자리표시자(`(노드 URL)`)는 http 가 아니라 자동으로 걸러진다. 수기 입력란은 폐기됐다 — 출처는 본문이 단일 소스다.
- 버전은 **구조만 확인**하고 값은 그대로 저장한다. bump·표 주입은 하지 않는다(소유권은 `/mino-spec`). 상세는 [state-machine.md](state-machine.md) §3.

## 5. 검증 ↔ 자동화 추적성

`/mino-spec` 품질 체크리스트 합격 = 체크리스트 상태 `PASS` = spec 헤더 상태 `CREATED`. 대시보드 S1–S6·C1–C7은 그 산출물이 템플릿 골격을 유지했는지만 재확인하므로, 스킬을 정상 완료한 산출물은 대시보드 검증도 통과해야 정상이다(불일치 시 스킬/검증기 중 하나의 버그). 반대로 체크리스트를 통과하지 못한 `DRAFT`/`FAILED` 산출물도 **골격만 갖췄으면 올라온다** — 검수에서 확정할 항목을 안고 올라오는 게 정상 경로다.

회귀 확인용 기준 케이스:

- 빈 템플릿 원본(`spec-template.md` / `spec-checklist-template.md`)을 그대로 올리면 자리표시자(S6 / C6)에서 걸려 **반드시 차단**된다.
- 골격을 채운 `DRAFT` + `[TBD]` spec 과 `FAILED` + 미체크 체크리스트는 경고와 함께 **통과해야** 한다.
- 체크리스트 `대상 스펙` 버전을 spec 버전과 다르게 두면 C7 경고 1건이 뜨고 저장은 진행돼야 한다.
