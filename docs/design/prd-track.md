# PRD 트랙 (P8 설계 명세)

> 출처: [PRD](../PRD.md) 4.9 · Mino-Android `mino-sdd/template/prd-template.md` · `.claude/skills/mino-prd/SKILL.md`
> 상태: **구현 완료 · 배포됨** (rules·Functions 2026-08-19) — mock 모드 e2e 통과. 실 `/mino-prd` 산출물 e2e 만 남음
> 단위: `docs/prd/business-context.md` **프로젝트당 1개**. spec 이 `features/{id}` 단위로 흐르는 것과 달리 PRD 는 **싱글턴**이다.
> SoT = Firestore(`prds/{id}`). 레포 파일은 스냅샷이며 역수정하지 않는다 — spec 과 같은 원칙.

spec 은 "화면 하나를 어떻게 만들까"를, PRD 는 "이 제품이 무엇인가"를 정의한다. 지금까지 대시보드는 하위 문서(spec)만 다뤘고 상위 문서는 각자 레포에만 있었다. P8 은 **PRD 를 대시보드로 끌어올려 ① 팀 공용 아카이브 ② 전원 논의 공간 ③ spec 과의 버전 정합성 추적**을 만든다.

```
        PRD (docs/prd/business-context.md · 1개)
          │  기준 PRD 버전 ← spec 헤더가 가리키는 조인 키
          ├──────────┬──────────┬──────────
        spec A     spec B     spec C        (docs/specs/{slug}/)
```

---

## 0. 무엇이 새로 필요하고 무엇이 재사용인가

| 요구사항 | 신규 | 재사용 |
|---|---|---|
| ① PRD 업로드 | **표 헤더 파서** · 검증 P1–P7 | 업로드 모달(dropzone·슬롯·프리뷰·검증 리포트) [app.js](../../js/app.js) `openUpload` |
| ② 전원 댓글 | **`comments` 서브컬렉션** | [discussion.md](../v2/discussion.md) §5·§7 스키마·규칙 · `addReviewAnchors`(섹션 💬) |
| ③ 버전 호환 | 호환 등급 계산 | spec 의 `prdVersion` 필드가 **이미 존재** · `/mino-prd` SKILL.md §2 의 등급 정의 |
| ④ Discord 알림 | `notifyOnPrdWrite` | [notify.js](../../functions/notify.js) 트리거·역할 멘션·딥링크 패턴 |
| ⑤ 버전 diff | from/to 선택 · 섹션 요약 · 성능 가드 | [version.js](../../js/version.js) `diffLines` · `diffBodyHtml` · diff 모달 |

**진짜 신규는 파서/검증과 댓글 서브컬렉션 둘뿐**이다. 나머지는 기존 자산의 대상만 바꾼 것이다.

## 1. 범위

**In (v1)**
- PRD 파일 첨부 업로드 + 구조 검증(P1–P7) + 버전 스냅샷
- PRD 뷰(문서 / 버전 이력 / 댓글 / 연결된 스펙)
- 전원 참여 댓글 스레드 — 섹션 앵커 · 본인 수정 · 소프트 삭제
- spec ↔ PRD 버전 호환 등급 + 목록·상세 뱃지 + "영향 스펙" 리포트
- PRD 등록/개정 Discord 알림 (등급별 색 · 역할 멘션 · 영향 spec 목록 동봉)
- 임의 두 버전 diff + 섹션 변경 요약

**Out (확정 결정 · 2026-08-15)**
- **PRD 의 GitHub PR 자동 생성 — 하지 않는다.** PRD 파일은 `/mino-prd` 가 개발자 워킹트리에 직접 쓰므로 평소 PR 경로가 이미 있다. 대시보드가 또 PR 을 만들면 커밋 경로가 둘로 갈려 SoT 가 흐려진다. 대시보드의 역할은 *공유 아카이브 + 논의 + 호환 추적* 으로 한정한다.
- **PRD 컨펌 게이트(승인/반려) 없음** — PRD 는 게이트가 아니라 논의 대상이다. 상태 enum 도 두지 않는다.
- 다중 PRD · 프로젝트 다중화 — `/mino-prd` 가 프로젝트당 1개로 못박았다.

## 2. 데이터 모델

```
prds/{prdId}                      # MVP: 싱글턴 'business-context'
  ├─ title: string                # H1 `# 제품 요구사항 문서 (PRD): {제품명}` 의 제품명
  ├─ version: string              # 헤더 표 `| **버전** | 1.2.0 |` — /mino-prd 소유, 대시보드는 읽기만
  ├─ body: string                 # 원문 (SoT) — 대시보드가 가공하지 않는다
  ├─ createdDate / lastAmendedDate: string     # YYYY-MM-DD
  ├─ prdAuthor / lastAmendedAuthor: string
  ├─ itemIds: string[]            # §2 목표의 [SYS-*]·[SCR-*] — 영향 리포트 보조
  ├─ versionIndex: [{ version, level, at, reason, uploadedBy }]   # 스냅샷 **메타만** (본문 없음)
  │    level: 'init' | 'major' | 'minor' | 'patch' | 'same'       (직전 버전과 semver 비교로 파생)
  ├─ uploadedBy: uid
  ├─ createdAt / updatedAt: timestamp
  │
  ├─ versions/{version}           # ★ 서브컬렉션 — 버전별 **본문** 스냅샷 (불변)
  │    └─ { version, body, at, uploadedBy }
  │
  └─ comments/{msgId}             # 전원 참여 논의
       └─ { body, authorUid, authorRole, anchor|null, replyTo|null,
            mentions[], deleted, createdAt, updatedAt }
```

### 왜 스냅샷을 서브컬렉션으로 빼는가 (spec 과 다른 선택)

spec 은 `versionLog[]` 를 feature 문서 안 배열로 갖는다([data-model.md](data-model.md)). PRD 는 **같은 구조를 쓰지 않는다**:

- PRD 본문은 spec 보다 크다 — 템플릿상 4장 구조 + 도메인/UI 용어 사전이 통째로 들어간다.
- 개정 주기가 짧다 — spec 하나가 바뀌는 빈도보다 PRD 가 바뀌는 빈도가 높고, 모든 spec 이 이 하나를 본다.
- 본문 30KB × 개정 30회 ≈ 900KB → **Firestore 문서 1MB 한도에 실제로 닿는다.** spec 에서는 이론적 위험이지만 PRD 에서는 현실적 위험이다.

서브컬렉션이면 증가 상한이 없고, diff 도 필요한 두 버전만 lazy 로드하면 된다(목록 렌더에는 본문이 필요 없다).

> **구현 중 확정 ①** — 버전 **목록**은 부모 문서의 `versionIndex`(메타만)에 두고, **본문**만 `versions/{version}` 에 둔다. 웹 SDK 에는 서버측 projection(`select()`)이 없어서 서브컬렉션을 구독하면 본문까지 전부 내려받게 되기 때문이다. 이 분리로 "목록은 실시간 구독, 본문은 diff 열 때만 1건씩 읽기"가 성립한다.
>
> **구현 중 확정 ②** — `commentCount` 비정규화 필드는 **두지 않는다**. 부모 문서 갱신 권한은 개발자뿐인데 댓글은 전원이 달 수 있어, 카운터를 부모에 두면 디자이너의 댓글 작성이 규칙에 막힌다. 댓글 수는 이미 구독 중인 댓글 캐시에서 파생한다.

### 기존 데이터 영향

없다. `features.prdVersion` 은 이미 존재하고([data-model.md](data-model.md) `prdVersion`), 호환 계산은 **읽기만** 한다. PRD 문서가 아직 없으면 호환 뱃지를 숨기고 전 화면이 "PRD 미등록"으로 동작한다 — 마이그레이션이 필요 없다.

## 3. 업로드 구조 검증 (P1–P7)

기준: `mino-sdd/template/prd-template.md`. 원칙은 spec S1–S6 · 체크리스트 C1–C7 과 같다 — **골격은 하드 차단, 미확정은 경고.**

| # | 항목 | 규칙 | 차단 |
|---|---|---|---|
| P1 | H1 제목 | `# 제품 요구사항 문서 (PRD): {제품명}` · 제품명 비어있지 않음 | 하드 |
| P2 | 헤더 표 | `버전` = `X.Y.Z` · `생성일`/`최종 수정일` = `YYYY-MM-DD` (뒤 ` - 작성자` 허용) | 하드 |
| P3 | 필수 섹션 4개 | `1. 서비스 개요 및 개발 방향` → `2. 목표 / 비목표` → `3. 화면 플로우별 기능 명세 및 UI/UX 규칙` → `4. 참고 자료` 가 **순서대로** 존재 | 하드 |
| P4 | 항목 ID | §2 목표에 `[SYS-\d{3}]` 또는 `[SCR-\d{3}]` ≥1 | 하드 |
| P4-w | §2 ↔ §3 대응 | 한쪽에만 있는 ID 가 있으면 **경고** (템플릿은 1:1 을 요구하지만 오탐 위험) | 소프트 |
| P5 | 자리표시자 잔여 | `[PRODUCT_NAME]`·`[PRD_VERSION]`·`[CREATED_DATE]`·`[PRD_AUTHOR]`·`[LAST_AMENDED_DATE]`·`[LAST_AMENDED_AUTHOR]`·`[SYS-00X]`·`[SCR-00X]`·`[자료 종류]` 등 0건 | 하드 |
| P6 | `TBD:` 잔여 | `TBD:` 가 남아 있으면 **경고** (저장은 진행) | 소프트 |
| P7 | 버전 정합 | 저장본보다 **낮은 버전 = 하드 차단** · 같은 버전 재업로드 = 확인 다이얼로그 후 마지막 스냅샷 갱신 | 하드/확인 |

> **`# 5. TBD` 는 선택 섹션이다.** `/mino-prd` SKILL.md §4 는 `TBD:` 항목이 있을 때 Q&A 를 담은 5장을 덧붙인다. P3 은 1–4 장의 존재와 순서만 보고 그 뒤에 오는 섹션은 허용한다.
>
> **`TBD:` 를 막지 않는 이유**는 spec 의 `[TBD]`·`DRAFT` 를 막지 않는 이유와 같다 — 확정되지 않은 정책이야말로 팀이 댓글로 논의해야 할 대상이고, 대시보드가 막으면 물어볼 곳이 사라진다. 표기 형태가 spec(`[TBD]` 대괄호)과 PRD(`TBD:` 접두)로 **다르다**는 점에 주의한다.

### ⚠️ 주석 스트립 (구현 필수)

PRD 템플릿은 `<!-- 작업 필요: … -->` / `<!-- 예시) … -->` 주석 안에 **`[SCR-001]`·`[SYS-004]`·`[PRODUCT_NAME]` 류 문자열을 대량으로** 담고 있다(spec 템플릿에는 없던 규모다). P4·P5 를 원문에 그대로 돌리면 정상 산출물이 전부 걸린다.

→ **검증 전 HTML 주석 블록을 제거한 사본으로 판정한다.** 저장되는 `body` 는 원문 그대로다(뷰어 `mdToHtml` 은 이미 주석 블록을 통째로 건너뛴다 — [app.js](../../js/app.js) `mdBlocks` 의 `<!--` 처리. 마크다운 프리뷰에서도 주석은 보이지 않으므로 결과가 같다).

### 파서가 spec 파서를 재사용할 수 없는 이유

PRD 헤더는 `**키**: 값` 줄이 아니라 **마크다운 표**다.

```markdown
| 항목 | 내용 |
|---|---|
| **버전** | 1.2.0 |
| **생성일** | 2026-06-26 - 재성 |
| **최종 수정일** | 2026-08-15 - 은석 |
```

[spec-parse.js](../../js/spec-parse.js) `headerField` 는 `^\*\*이름\*\*\s*:` 를 찾으므로 **매칭되지 않는다.** `js/prd-parse.js`(`window.MASCPrd`) 에 `tableField(src, name)` 을 새로 뒀다. 헤딩/섹션 헬퍼(`headings`·`coreTitle`)는 그대로 재사용한다.

> 템플릿의 섹션 제목은 H2 가 아니라 **H1**(`# 1. 서비스 개요 및 개발 방향`)이다. 문서 제목도 H1 이라 **첫 H1 = 제목, 이후 H1 = 섹션**으로 구분한다. `coreTitle` 이 `1. ` 숫자 접두사를 벗기므로 비교는 핵심 제목으로 한다.

## 4. 버전 호환 (요구사항 ③)

조인 키는 이미 있다 — spec 헤더 `**기준 PRD 버전**` → `features.prdVersion`. 등급 정의는 `/mino-prd` SKILL.md §2 가 이미 내린 판정을 그대로 옮긴다("이미 갈라져 나간 하위 spec 이 영향을 받는가").

| spec 의 기준 PRD 버전 ↔ 현재 PRD 버전 | `level` | 뱃지 (사용자에게 보이는 문구) | 의미 |
|---|---|---|---|
| 동일 | `same` | ✅ **PRD 최신** | — |
| MAJOR 뒤짐 | `major` | 🔴 **스펙 재작성 필요** | MVP 경계·용어 정의 변경 → `/mino-spec` **재실행 필요** |
| MINOR 뒤짐 | `minor` | 🟡 **스펙 점검 필요** | 추가된 항목과 주제가 겹치는 spec 만 재실행 |
| PATCH 뒤짐 | `patch` | ⚪️ **영향 없음** | 표현·오타·링크 갱신 → 재실행 불필요 |
| spec 이 더 높음 | `ahead` | 🟠 **PRD 등록 필요** | PRD 업로드 누락 — 최신 PRD 를 올려야 함 |
| `없음` · 파싱 실패 | `none` | ⚫️ **기준 PRD 없음** | PRD 이전에 작성된 spec |

> **라벨은 행동 중심으로 재정의**(2026-08-19). 구 라벨(`PRD 비호환`·`PRD 뒤처짐`·`PRD 갱신`·`PRD 미업로드`·`PRD 미연결`)은
> ① 무엇을 해야 하는지 말해주지 않았고 ② **주어가 헷갈렸다** — `PRD 뒤처짐` 은 실제로 *spec* 이 뒤처진 상태인데
> PRD 가 낡은 것처럼 읽혔다. 새 라벨은 **조치 주체**를 담는다: `PRD 등록 필요`(PRD 올릴 사람) vs `스펙 …`(spec 작성자).
> `level` 값은 내부 식별자이므로 그대로다 — 정렬(`COMPAT_ORDER`)·알림(`STALE_LEVELS`)·PR 본문이 참조한다.

- 파싱은 **느슨하게**: `features.prdVersion` 은 헤더 원문 그대로라 `1.0.0` · `v1.0` · `없음` 이 섞인다. `v?(\d+)(\.(\d+))?(\.(\d+))?` 로 읽고 누락 자리는 0 으로 채운다. 숫자를 못 찾으면 미연결.
- **게이트는 걸지 않는다.** 🔴 상태에서 `컨펌 요청` 시 확인 다이얼로그로 경고하되 진행은 허용한다 — "미완성일수록 검수에 올린다"는 [validation.md](validation.md) §1 의 기존 철학과 일관되게. 대신 흔적을 남긴다: 상세 패널 뱃지 + spec PR 본문 얼라인 체크리스트에 미체크 한 줄.

**노출 지점**

| 위치 | 표시 |
|---|---|
| feature 목록 행 | 호환 뱃지 (✅ 는 생략, 🔴🟡🟠 만 — `tbdBadge` 와 같은 "문제만 보여주기" 규칙) |
| feature 상세 | 현재 평문 `기준 PRD {prdVersion}` 을 뱃지로 승격 + 클릭 시 PRD 뷰 |
| PRD 뷰 "연결된 스펙" | slug · spec 버전 · 기준 PRD 버전 · 등급 표 |
| spec PR 본문 | `- [ ] 기준 PRD 버전 최신 — PRD v1.2.0 / spec 기준 v1.0.0` ([functions/index.js](../../functions/index.js) `prTemplate`) |

## 5. 댓글 (요구사항 ②)

[discussion.md](../v2/discussion.md) §5 스키마·§7 규칙을 대상만 PRD 로 바꿔 채택한다. spec 논의와 다른 점 둘:

| 항목 | spec 논의 (P5.1 설계) | **PRD 댓글 (P8)** |
|---|---|---|
| 상태 게이트 | 승인 전(`spec_draft`·`in_review`·`changes_requested`)까지만 | **없음 — 상시 오픈.** PRD 에는 승인 개념이 없다 |
| 앵커 | 선택 (Tier 2) | **1급 기능.** 문서가 길어 섹션이 사실상 스레드 축 |

| 항목 | 정책 |
|---|---|
| 작성자 | 로그인한 **개발자·디자이너 누구나** (`authorUid == auth.uid`) |
| 본문 | 비어있지 않은 마크다운 (`mdToHtml` 재활용) |
| 수정/삭제 | 작성자 본인만. 삭제는 소프트(`deleted:true`)로 순서 보존 |
| 앵커 | `anchor = {section}` — 제목 옆 💬([app.js](../../js/app.js) `addReviewAnchors` 재사용). 앵커 없는 전체 댓글도 허용 |
| 답글 | `replyTo` 1단. v1 은 평면 렌더 + 들여쓰기 |
| @멘션 | `@` 입력 시 `users` 컬렉션 기반 자동완성 드롭다운(↑↓·Enter/Tab·Esc). 삽입 토큰은 **`@githubLogin`** — `mentionsOf` 정규식이 ASCII 전용이라 한글 이름을 넣으면 `mentions[]` 가 비어 알림이 누락된다. 표시는 반대로 핸들→이름 해석, 미등록 핸들은 회색. 실제 Discord 개인 멘션은 도입하지 않는다(채널 알림으로 충분) |

> **의도**: 이 스레드 컴포넌트를 `features/{id}/discussion` 에도 그대로 꽂을 수 있게 분리해 만든다. P8.4 를 끝내면 **P5.1(spec 논의)이 사실상 반쯤 완성**된다 — 남는 건 상태 게이트와 `reviews[]` 서브컬렉션 전환뿐이다.

## 6. Discord 알림 (요구사항 ④)

[notify.js](../../functions/notify.js) 에 `notifyOnPrdWrite`(`onDocumentWritten('prds/{id}')`)를 추가한다. 발동을 서버측 트리거로 두는 이유는 기존과 같다 — 클라 우회 방지.

| 이벤트 | 멘션 | 색 | 본문 |
|---|---|---|---|
| 신규 등록 | Android + Design + **iOS + Node** | purple | 제품명 · 버전 |
| **MAJOR** 개정 | Android + Design + **iOS + Node** | red | `1.0.0 → 2.0.0` + **뒤처진 spec 목록**(전부 재실행 대상) |
| **MINOR** 개정 | Android + Design + **iOS + Node** | amber | 뒤처진 spec 목록 (주제 겹침 확인 필요) |
| **PATCH** 개정 | 멘션 없음 | gray | 버전 변화만 |

> **등록·MAJOR·MINOR 는 4개 역할 전부 태그한다** — PRD 는 제품 전체 문서라 범위가 바뀌면(신설이든 확장이든) 모든 플랫폼과 디자인이 알아야 한다. PATCH·본문 갱신만 무멘션이다.
>
> **iOS·Node 는 PRD 알림에만 붙는다** (2026-08-15). PRD 는 제품 전체 문서라 플랫폼을 가리지 않지만, spec 파이프라인 알림(컨펌요청·승인·반려·무효화·머지)은 MASC 가 **안드로이드 spec 만** 다루므로 기존대로 Android/Design 만 태그한다. PATCH·본문 갱신은 무멘션 유지 — 표현 수준 변경까지 4개 역할을 울리면 소음이 된다.
>
> 동봉되는 "뒤처진 spec 목록"은 `features` 컬렉션 기준이라 **안드로이드 spec 만** 나온다. iOS·Node 는 "PRD 가 바뀌었다"는 신호를 받는 것이고, 각 팀의 후속 조치는 각자 레포 소관이다.

여기가 ③과 만나는 지점이다 — `/mino-prd` 가 로컬에서 실행자 **개인에게만** 보고하던 "기준 PRD 버전이 뒤처진 spec 목록"(SKILL.md §5)을 서버가 재현해 **팀 전체에 방송**한다. PRD 개정을 놓쳐 낡은 spec 이 검수에 올라오는 경로가 원천 차단된다.

- 딥링크: `?prd={id}` — [app.js](../../js/app.js) `pendingDeepLink`(현 `?feature=`)를 확장한다.
- (선택) `notifyOnPrdComment` — 댓글 알림. 소음 방지를 위해 **멘션이 포함된 댓글만** 발송한다.

## 7. 버전 diff (요구사항 ⑤)

[version.js](../../js/version.js) `diffLines`(줄 단위 LCS) + [app.js](../../js/app.js) `diffBodyHtml`(6줄 이상 동일 구간 접기) + diff 모달을 그대로 쓴다. PRD 전용 보강 3가지:

1. **from/to 임의 선택** — spec 은 직전 버전만 비교하지만, PRD 는 "v1.0 대비 지금" 처럼 여러 개정을 건너뛴 비교가 잦다. 버전 셀렉트 2개.
2. **섹션 변경 요약** — diff 상단에 "변경 섹션: 2. 목표/비목표 · 3. [SCR-004]". 긴 문서에서 어디를 봐야 하는지 먼저 알려준다.
3. **성능 가드 (필수)** — 현재 `diffLines` 는 `O(n·m)` DP 로 `(n+1)×(m+1)` 배열을 통째로 만든다. spec(수백 줄)에서는 무해하지만 PRD 2000줄끼리면 400만 셀 → 수 초 + 수십 MB 다. **앞뒤 공통 라인을 먼저 트리밍하고, 그래도 임계(≈1500줄)를 넘으면 섹션 단위로 나눠 diff** 한다. 트리밍만으로도 실무 개정(일부 섹션만 변경)은 대부분 임계 아래로 떨어진다.

diff 모달의 문서 탭(spec/체크리스트)은 PRD 단일 문서이므로 숨긴다.

## 8. 보안 규칙

```
match /prds/{prdId} {
  allow read: if signedIn();
  // 업로드는 개발자 한정 (확정 결정) — /mino-prd 산출물 파일을 가진 주체
  allow create, update: if isDeveloper()
    && request.resource.data.uploadedBy == request.auth.uid
    && request.resource.data.version is string && request.resource.data.version != ''
    && request.resource.data.body is string && request.resource.data.body != '';
  allow delete: if false;

  match /versions/{version} {
    allow read: if signedIn();
    allow create: if isDeveloper();
    allow update, delete: if false;          // 스냅샷 불변 (감사 기록)
  }

  match /comments/{msgId} {
    allow read: if signedIn();
    // 논의는 전원 — 본인 명의로만
    allow create: if signedIn()
      && request.resource.data.authorUid == request.auth.uid
      && request.resource.data.body is string && request.resource.data.body != '';
    // 본인 글의 본문·삭제표시만 수정 가능 (작성자·시각 위조 차단)
    allow update: if signedIn()
      && resource.data.authorUid == request.auth.uid
      && request.resource.data.authorUid == resource.data.authorUid
      && request.resource.data.createdAt == resource.data.createdAt;
    allow delete: if false;                   // 소프트 삭제만
  }
}
```

- `versions/{version}` 문서 id 를 버전 문자열로 두면 **같은 버전 중복 생성이 구조적으로 불가**하다(덮어쓰기는 `update: false` 로 차단 → P7 의 "같은 버전 재업로드"는 클라이언트가 명시적으로 마지막 스냅샷을 갱신하는 경로로만 처리).
- `commentCount` 비정규화 필드는 규칙으로 정합을 강제하기 어렵다 — spec 의 `versionLog` 와 같은 수준(클라 신뢰)으로 두고, 표시 전용이라 위조돼도 파이프라인에 영향이 없다.

## 9. UI 표면

기존 3분할 워크스페이스(상태 목록 / feature 목록 / 상세)는 feature 전용이다. PRD 는 **헤더 진입 + 전용 모달**로 얹어 레이아웃을 건드리지 않는다.

```
헤더:  📘 PRD v1.2.0 · 💬 3 │ [역할별 사용법] [스킬 안내] [상태 · 배지 안내] [필터 초기화] …
       └─ 클릭 → PRD 모달
┌─ PRD 모달 (modal-xwide, 2단) ──────────────────────────────┐
│ 제품 요구사항 문서 v1.2.0        [문서] [버전 이력] [연결된 스펙] │
├──────────────────────────┬─────────────────────────────────┤
│ 본문 (mdToHtml)           │ 💬 논의                          │
│  # 2. 목표 / 비목표    💬 │  [은석·개발자] 2장 SCR-004 …      │
│  - [SCR-004] …           │    ↳ [민호·디자이너] 확인했습니다   │
│  # 3. 화면 플로우별…   💬 │  [재성·개발자] @민호 …            │
│                          │  ─────────────────────────────  │
│                          │  [ 댓글 입력 …            ] [등록] │
└──────────────────────────┴─────────────────────────────────┘
```

- **문서 탭**: 본문 + 섹션 앵커 💬 (앵커 클릭 시 우측 스레드가 해당 섹션으로 필터)
- **버전 이력 탭**: 버전 목록(등급 뱃지 · 날짜 · 메모) + from/to 선택 → 변경분
- **연결된 스펙 탭**: 호환 등급 표 (🔴 먼저 정렬)
- **업로드**: 개발자에게만 `PRD 업로드` 버튼 노출. 기존 업로드 모달을 슬롯 1개 구성으로 재사용
- **진입 지점 2곳(구현)**: ① 헤더 칩 — 등록 전이면 `📘 PRD 미등록`(warn 표시)이고 **개발자에게만** 보인다(디자이너에게는 올릴 것도 볼 것도 없으므로 숨김) · ② feature 상세의 `기준 PRD {버전}` 줄에 붙은 호환 뱃지 + `PRD 보기` 링크. 설계 초안의 "좌측 사이드바 한 줄"은 진입점이 셋으로 늘어 중복이라 **넣지 않았다**

## 10. 단계 체크리스트 (P8)

범례: `[ ]` 미착수 · `[~]` 진행중 · `[x]` 완료 · `(BE)` Cloud Functions · `(FE)` 프론트 · `(rules)` 보안규칙

### P8.0 · 설계 — 완료
- [x] 본 문서 (`docs/design/prd-track.md`)
- [x] [data-model.md](data-model.md) `prds` 컬렉션 반영
- [x] [PRD.md](../PRD.md) §4.9 · [roadmap.md](../ops/roadmap.md) P8 트랙 추가

### P8.1 · 업로드 + 검증 (요구사항 ①) — P8.0 의존
- [x] `(FE)` `js/prd-parse.js` — `parseTableField` · `parseMeta` · 섹션/ID 수집 · **주석 스트립**
- [x] `(FE)` [validate.js](../../js/validate.js) `validatePrd(body, prev)` — P1–P7
- [x] `(FE)` store `prd.get/subscribe/save` — mock·firebase 양쪽. 저장은 **버전 낙관적 잠금**(§11-3)
- [x] `(FE)` 업로드 모달(슬롯 1개) + 헤더 PRD 칩 + feature 상세 `PRD 보기` 링크 (사이드바 한 줄은 미채택 — §9)
- [x] `(rules)` `prds/{id}` create/update — 개발자 한정
- [x] `(FE)` [data/seed.js](../../data/seed.js) PRD 시드 (mock 모드 동작)

### P8.2 · 버전 이력 + diff (요구사항 ⑤) — P8.1 의존
- [x] `(FE)` `versions/{version}` 스냅샷 기록 + 목록 렌더(등급 뱃지·메모 편집)
- [x] `(FE)` from/to 선택 diff + 섹션 변경 요약
- [x] `(FE)` `diffLines` 성능 가드 — 공통 접두/접미 트리밍 + 섹션 분할 폴백
- [x] `(rules)` `versions/{version}` 불변 규칙

### P8.3 · 버전 호환 (요구사항 ③) — P8.1 의존
- [x] `(FE)` 호환 등급 계산 유틸(느슨한 semver 파싱) + 단위 케이스
- [x] `(FE)` feature 목록 뱃지 · 상세 `기준 PRD` 줄 승격 · PRD 뷰 "연결된 스펙" 표
- [x] `(FE)` 🔴 `스펙 재작성 필요`(MAJOR) 상태에서 `컨펌 요청` 시 확인 다이얼로그
- [x] `(BE)` [functions/index.js](../../functions/index.js) `prTemplate` 에 기준 PRD 체크 줄 추가

### P8.4 · 댓글 (요구사항 ②) — P8.1 의존
- [x] `(FE)` `comments` 서브컬렉션 store(`list`/`post`/`edit`/`remove`) — mock·firebase
- [x] `(FE)` 스레드 UI — 섹션 앵커 · 1단 답글 · 본인 수정/소프트 삭제 · `@handle` 하이라이트
- [x] `(FE)` 앵커 클릭 ↔ 스레드 필터 연동 (카운트는 댓글 캐시에서 파생)
- [x] `(FE)` `@` 자동완성 드롭다운 — 작성·수정 textarea 공용, 서버 변경 없음(`users` 는 이미 구독 중)
- [x] `(rules)` `comments` 규칙(전원·본인 명의·작성자 위조 차단)
- [x] **컴포넌트 분리** — `features/{id}/discussion` 에 재사용 가능한 형태로 (P5.1 발판)

### P8.5 · Discord 알림 (요구사항 ④) — P8.1·P8.3 의존
- [x] `(BE)` [notify.js](../../functions/notify.js) `notifyOnPrdWrite` — 등록/개정 · 등급별 색·멘션
- [x] `(BE)` 개정 시 뒤처진 spec 목록 조회·동봉 (§6)
- [x] `(FE)` `?prd=1` 딥링크
- [x] `(BE)` (선택) `notifyOnPrdComment` — 멘션 포함 댓글만

### P8.6 · 배포 · e2e
- [x] `(ops)` rules·Functions 재배포 · 캐시 버스팅([index.html](../../index.html) `?v=`) — **완료(2026-08-19)**
- [ ] 실 `/mino-prd` 산출물로 e2e — 업로드 → 개정 → diff → 댓글 → 알림 수신
- [ ] MAJOR 개정 시 뒤처진 spec 목록이 정확한지 대조

**의존 그래프**: `P8.0 → P8.1 → {P8.2 ∥ P8.3 ∥ P8.4} → P8.5 → P8.6`
P8.2 · P8.3 · P8.4 는 P8.1 이후 서로 독립이라 병렬 진행 가능하다.

## 11. 리스크

1. **템플릿 주석 오탐** (§3) — 검증 전 주석 스트립을 빠뜨리면 정상 산출물이 전부 차단된다. 회귀 케이스: 빈 `prd-template.md` 원본은 P5 로 **차단**돼야 하고, 주석이 남아 있는 정상 PRD 는 **통과**해야 한다.
2. **문서 1MB 한도** (§2) — 스냅샷을 서브컬렉션으로 뺀 이유. spec 의 `versionLog[]` 를 그대로 따라하면 개정 수십 회 후 쓰기가 실패한다.
3. **단일 문서 동시 업로드 충돌** — PRD 는 하나뿐이라 두 개발자가 서로 다른 버전을 올리면 조용히 덮어쓴다. spec 은 feature 별로 갈려 없던 문제다. → `save` 를 **트랜잭션 + `expectedVersion` 낙관적 잠금**으로 구현하고, 충돌 시 "그 사이 v1.3.0 이 등록됐습니다. 다시 받아 개정하세요"로 안내한다.
4. **알림 소음** — PATCH 개정과 일반 댓글까지 역할 멘션하면 채널이 시끄러워져 정작 MAJOR 를 놓친다. §6 표대로 등급별 차등, 댓글은 멘션 포함분만.
5. **`prdVersion` 표기 흔들림** — spec 헤더 값은 원문 그대로 저장돼 `1.0.0`/`v1.0`/`없음` 이 섞인다. 호환 계산은 느슨한 파싱 + 미연결 폴백으로 처리하고, **호환 등급을 근거로 무언가를 차단하지 않는다**(§4).

## 12. 의사결정 로그

- **PR 생성 안 함** (2026-08-15 확정) — PRD 파일의 커밋 경로는 `/mino-prd` + 개발자 평상시 PR 로 이미 존재한다. 대시보드가 두 번째 경로를 만들면 SoT 가 갈린다. spec 과의 일관성 논거는 인정하되, 필요해지면 후속 트랙에서 `createPrdPR` 로 추가한다.
- **업로드 권한 = 개발자 한정** (2026-08-15 확정) — 산출물 파일을 가진 주체가 개발자이고, `users.role` 은 developer/designer 둘뿐이다. 기획 역할이 생기면 그때 확장한다. **댓글은 전원**이라 요구사항 ②는 충족된다.
- **컨펌 게이트 없음** — PRD 는 승인 대상이 아니라 논의 대상. 상태 enum 을 두지 않아 상태머신도 건드리지 않는다.
- **스냅샷 = 서브컬렉션** (spec 과 다름) — 문서 크기·개정 빈도 차이 때문. §2.
- **호환 등급은 표시 전용** — 차단하지 않는다. [validation.md](validation.md) §1 의 "미완성일수록 검수 대상" 철학과 일관.
- **댓글 컴포넌트를 spec 논의와 공유** — P8.4 가 [discussion.md](../v2/discussion.md)(P5.1)의 발판이 되도록 설계한다.
