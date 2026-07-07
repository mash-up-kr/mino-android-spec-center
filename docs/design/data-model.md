# 데이터 모델 (Firestore · Storage)

> 출처: [PRD](../PRD.md) 5장 · 6장
> 상태: **구현 완료** ([js/store-firebase.js](../../js/store-firebase.js) · [firestore.rules](../../firestore.rules)) · v2 재설계 기준
> SoT(Source of Truth) = **Firestore**. 레포 파일은 스냅샷.

## 1. Firestore

```
features/{featureId}
  ├─ slug: string              # docs/specs/{slug}/ 경로 · spec 첫 줄 <!-- feature: {slug} --> 와 일치
  ├─ title: string             # spec.md H1
  ├─ status: enum              # state-machine.md 8상태
  ├─ planStale: boolean        # 무효화 연쇄 시 true
  ├─ specVersion: string       # 현재 버전 (예: v0.1.0) — 대시보드가 소유·전이 이벤트에서 bump
  ├─ versionLog: [{ version, level, reason, at, body }]  # 자동 버저닝 이력(append-only). body=그 시점 스냅샷(변경이력 표 제거) → 재검토 diff 용
  ├─ figmaSources: string[]    # 컨펌 화면 출처 노출 (업로드 시 입력)
  ├─ prNumber: number | null   # Functions(Admin)만 설정 — 클라이언트는 그대로/null만 허용
  ├─ prUrl: string | null
  ├─ specBody: string          # spec.md 본문 (SoT) — `## 변경 이력` 표는 versionLog 로부터 자동 주입
  ├─ planBody: string | null   # plan.md 본문
  ├─ assets: [{ name, storagePath }]   # Storage 경로 (이미지, 실 업로드)
  ├─ reviews: [{ decision, comments, reviewerUid, reviewedAt }]  # 디자이너 컨펌 이력 (MVP: 배열 필드, 서브컬렉션 전환은 후속)
  │    ├─ decision: 'approved' | 'changes_requested' | 'comment'  # comment=상태변화 없는 보충 코멘트
  │    └─ comments: [{ section, body }]   # 섹션/화면 인라인 코멘트
  ├─ createdBy: uid
  └─ createdAt / updatedAt: timestamp

users/{uid}
  ├─ role: 'developer' | 'designer'
  ├─ githubLogin: string
  └─ githubToken: string       # MVP 평문, 운영 시 Secret Manager (5.1)
```

### 비고
- **버저닝은 대시보드가 소유**: `specVersion`/`versionLog`는 본문에서 파싱하지 않고 대시보드가 상태 전이 이벤트에서 bump·append한다. `## 변경 이력` 표는 `versionLog`로부터 생성해 `specBody`와 PR 커밋 파일에 주입(`js/version.js` ↔ `functions/index.js` 미러). 상세는 [state-machine.md](state-machine.md) §3.
- `assets[].storagePath`는 Storage 경로. 본문 `![](assets/x.png)` 상대경로 ↔ `assets[]` 매핑으로 프리뷰 렌더(Storage 다운로드 URL 치환) + PR 커밋 시 base64로 `docs/specs/{slug}/assets/`에 동봉.
- `reviews[]`는 append-only 이력(현재 배열 필드, `arrayUnion`). 현재 컨펌 결과는 `features.status`로 판단.

## 2. Storage

```
features/{featureId}/assets/{filename}.png
```
- drag-drop 업로드 → Storage 저장 → `features.assets[]`에 `{name, storagePath}` 기록.
- 원본 = SoT 일부. PR 커밋 시 `docs/specs/{slug}/assets/`에 동봉해 레포에서도 상대경로 렌더.

## 3. 보안 규칙 — 구현됨 ([firestore.rules](../../firestore.rules) · [storage.rules](../../storage.rules))

> P3(2026-07-06)에서 스케치 → 실 강제로 전환. 전이 허용목록·필드 잠금·위조 차단 포함.

| 리소스 | read | write |
|---|---|---|
| `features/{id}` | 로그인 사용자 | create=developer(본인·`spec_draft`·PR필드 null) · update=역할별 전이 허용목록 |
| `users/{uid}` | 로그인 사용자(리뷰어 이름 표시) | 본인만 |
| Storage `features/**` | 로그인 사용자 | developer |

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
| (없음) | `reviews/` · `planStale` · `specVersion` · `role` | **신설** |

`data/feature-list.js`·`data/tracking.js` seed는 제거하고 Firestore로 대체한다.
