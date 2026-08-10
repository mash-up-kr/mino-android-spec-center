# 데이터 모델 (Firestore)

> 출처: [PRD](../PRD.md) 5장 · 6장
> 상태: **구현 완료** ([js/store-firebase.js](../../js/store-firebase.js) · [firestore.rules](../../firestore.rules)) · v3 (신 템플릿 · plan 제거 · base 브랜치) 기준
> SoT(Source of Truth) = **Firestore**. 레포 파일은 스냅샷.

## 1. Firestore

```
features/{featureId}
  ├─ slug: string              # docs/specs/{slug}/ 경로 · 헤더 `**대상 스펙 경로**` 에서 파싱
  ├─ title: string             # spec.md H1 (`# 스펙 명세서: {기능명}` 의 기능명)
  ├─ status: enum              # state-machine.md 7상태 (plan_drafted 폐기)
  ├─ specVersion: string       # 현재 버전 (예: 1.0.0) — 헤더 `**버전**` 값. /mino-spec 스킬이 소유
  ├─ specStatus: string        # 헤더 `**상태**` (DRAFT | CREATED) — DRAFT 도 업로드 허용(경고 표시)
  ├─ prdVersion: string        # 헤더 `**기준 PRD 버전**` (PRD 없으면 '없음')
  ├─ baseBranch: string        # PR 타겟 `<prefix>/<이슈번호>-<slug>/base` — 업로드 시 GitHub API 목록에서 선택
  ├─ versionLog: [{ version, level, reason, at, body }]  # 버전별 본문 스냅샷(append-only)
  │    ├─ level: 'init' | 'major' | 'minor' | 'patch' | 'same'   # 직전 항목과의 semver 비교로 파생
  │    ├─ reason: string       # 개발자가 편집하는 메모 (기본 빈 값)
  │    └─ body: string         # 그 버전 시점의 spec 본문 → 재검토 diff 용
  ├─ figmaSources: string[]    # §1 `**Figma**:` 줄에서 자동 수집한 노드 URL
  ├─ prNumber: number | null   # Functions(Admin)만 설정 — 클라이언트는 그대로/null만 허용
  ├─ prUrl: string | null
  ├─ specBody: string          # spec.md 본문 (SoT) — 업로드된 원문 그대로. 대시보드가 가공하지 않는다
  ├─ reviews: [{ decision, comments, reviewerUid, reviewedAt }]  # 디자이너 컨펌 이력 (MVP: 배열 필드, 서브컬렉션 전환은 후속)
  │    ├─ decision: 'approved' | 'changes_requested' | 'comment'  # comment=상태변화 없는 보충 코멘트
  │    └─ comments: [{ section, body }]   # 섹션 인라인 코멘트
  ├─ createdBy: uid
  └─ createdAt / updatedAt: timestamp

users/{uid}
  ├─ role: 'developer' | 'designer'
  └─ githubLogin: string
     # GitHub 토큰은 Firestore 에 저장하지 않는다 — Secret Manager `user-gh-token-{uid}` (token-store.js)
```

### v2 → v3 필드 변경

| 필드 | 처리 | 이유 |
|---|---|---|
| `planBody` | **삭제** | plan 검토 단계 폐기 — plan 은 base 브랜치 하위 작업 |
| `planStale` | **삭제** | 위와 동일 |
| `assets[]` | **삭제** | 신 템플릿은 화면 근거를 Figma 노드 URL 로 적는다 |
| `baseBranch` | **신설** | PR 타겟이 `develop` 고정에서 이슈 base 브랜치로 바뀜 |
| `specStatus`·`prdVersion` | **신설** | 신 템플릿 헤더 메타 (품질 게이트·PRD 추적) |
| `specVersion` | 의미 변경 | 대시보드 소유 → **`/mino-spec` 소유**. 헤더 값을 읽기만 함 |
| `versionLog[]` | 의미 축소 | 자동 버저닝 이력 → **본문 스냅샷 로그**(diff 전용). `level` 은 파생값 |

> 기존 문서는 lazy migration 으로 정리된다: 다음 spec 업로드 시 새 필드가 채워지고 삭제 필드는 참조하지 않는다. 남은 `planBody`/`assets` 값은 읽히지 않는 잔여 데이터다.

### 비고
- **버저닝 소유권은 스킬**: `specVersion`은 헤더 `**버전**` 값을 그대로 반영한다. 대시보드는 bump 하지 않고 `## 변경 이력` 표를 만들지도 주입하지도 않는다. 상세는 [state-machine.md](state-machine.md) §3.
- `versionLog[].body`는 재검토 diff 전용 스냅샷이다. 같은 버전으로 재업로드하면 새 항목을 만들지 않고 마지막 항목의 스냅샷만 갱신한다.
- `baseBranch`는 대시보드가 추측하지 않는다. `listBaseBranches`(Functions → GitHub API)가 `<prefix>/<번호>-<slug>/base` 패턴 브랜치를 조회해 주고, 개발자가 업로드 시 고른 값을 저장한다.
- `reviews[]`는 append-only 이력(현재 배열 필드, `arrayUnion`). 현재 컨펌 결과는 `features.status`로 판단.

## 2. Storage — 사용 안 함

이미지 업로드 파이프라인이 폐기되면서 Storage 는 신규 쓰기 경로가 없다. [storage.rules](../../storage.rules)는 과거 업로드분 **읽기만** 허용하고 쓰기를 차단한다.

## 3. 보안 규칙 — 구현됨 ([firestore.rules](../../firestore.rules) · [storage.rules](../../storage.rules))

> P3(2026-07-06)에서 스케치 → 실 강제로 전환. 전이 허용목록·필드 잠금·위조 차단 포함.

| 리소스 | read | write |
|---|---|---|
| `features/{id}` | 로그인 사용자 | create=developer(본인·`spec_draft`·PR필드 null·`baseBranch` 지정) · update=역할별 전이 허용목록 |
| `users/{uid}` | 로그인 사용자(리뷰어 이름 표시) | 본인만 |
| Storage `features/**` | 로그인 사용자 | **금지** (레거시 읽기 전용) |

- **전이 허용목록**: 개발자/디자이너 각각 허용된 `(from→to)` 조합만 통과(`devTransitionOk`/`desTransitionOk`). `spec_in_review` 는 read-only(상태유지 수정 차단).
- **필드 잠금**: `prNumber`/`prUrl` 등 PR 필드는 클라이언트가 임의값 못 넣음(그대로거나 null만). `pr_open`/`merged`/`pr_closed` 로의 전이는 **Functions(Admin SDK, 규칙 우회)** 전용 → 클라이언트 위조 불가.
- `reviews` create(승인/반려/보충코멘트)는 designer만. 상태 전이 guard는 규칙으로 1차, 민감 전이(PR/Webhook)는 Function으로 2차.

## 4. 구 모델 → 신 모델 매핑 (완료된 마이그레이션 기록)

> v2 전면 재작성 시 수행 완료. 구 `data/feature-list.js`·`data/tracking.js`는 제거되고 `data/seed.js`(mock) + Firestore로 대체됨. 이력 참고용.

| 구 (`data/feature-list.js` v2) | 신 모델 | 처리 |
|---|---|---|
| `id` | `featureId` / `slug` | slug 주석 기반으로 변경 |
| `title` | `title` | 유지 |
| `specMd` | `specBody` | 유지(rename) |
| `planMd` | `planBody` | 유지(rename) |
| `tasksMd` | — | **삭제** (구현단계 이관) |
| `items[]` | — | **삭제** (본문 파싱 안 함, 검증만) |
| `designRef` | `figmaSources[]` | 배열로 일반화 |
| `sources` | — | 삭제 |
| tracking: `deliveryStatus`·`assignee`·`evidence`·`tasksDone` | — | **삭제** (구현추적 범위 밖) |
| tracking: `specStatus`(3) | `status`(8) | 단일 파이프라인으로 통합 |
| tracking: `prState`·`prNumber`·`prUrl` | `status`·`prNumber`·`prUrl` | 통합 |
| (없음) | `reviews/` · `specVersion` · `role` | **신설** |

`data/feature-list.js`·`data/tracking.js` seed는 제거하고 Firestore로 대체한다.
