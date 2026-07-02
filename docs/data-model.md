# 데이터 모델 (Firestore · Storage)

> 출처: [mino_spec.md](../../mino_prd/mino_spec.md) 5장 · 6장
> 상태: 설계(미구현) · v2 전면 재설계 기준
> SoT(Source of Truth) = **Firestore**. 레포 파일은 스냅샷.

## 1. Firestore

```
features/{featureId}
  ├─ slug: string              # docs/specs/{slug}/ 경로 · spec 첫 줄 <!-- feature: {slug} --> 와 일치
  ├─ title: string             # spec.md H1
  ├─ status: enum              # state-machine.md 8상태
  ├─ planStale: boolean        # 무효화 연쇄 시 true
  ├─ specVersion: string       # 변경 이력 최신 행 버전명 (예: v0.1.0) — frontmatter 없이 파싱
  ├─ figmaSources: string[]    # 컨펌 화면 출처 노출 (업로드 시 입력)
  ├─ prNumber: number | null
  ├─ prUrl: string | null
  ├─ specBody: string          # spec.md 본문 (SoT)
  ├─ planBody: string | null   # plan.md 본문
  ├─ assets: [{ name, storagePath }]   # Storage 경로 (이미지)
  ├─ createdBy: uid
  ├─ createdAt / updatedAt: timestamp
  └─ reviews/{reviewId}        # 서브컬렉션 (디자이너 컨펌 이력)
       ├─ decision: 'approved' | 'changes_requested' | 'comment'  # comment=상태변화 없는 보충 코멘트
       ├─ comments: [{ section, body }]   # 섹션/화면 인라인 코멘트
       ├─ reviewerUid: uid
       └─ reviewedAt: timestamp

users/{uid}
  ├─ role: 'developer' | 'designer'
  ├─ githubLogin: string
  └─ githubToken: string       # MVP 평문, 운영 시 Secret Manager (5.1)
```

### 비고
- `specVersion`은 본문에서 파생되는 **캐시**다. spec 저장 시 `변경 이력` 표 최신 행에서 재파싱해 갱신.
- `assets[].storagePath`는 Storage 경로. 본문 `![](assets/x.png)` 상대경로 ↔ `assets[]` 매핑으로 프리뷰 렌더 + PR 커밋 시 동봉.
- `reviews/`는 append-only 이력. 현재 컨펌 결과는 `features.status`로 판단.

## 2. Storage

```
features/{featureId}/assets/{filename}.png
```
- drag-drop 업로드 → Storage 저장 → `features.assets[]`에 `{name, storagePath}` 기록.
- 원본 = SoT 일부. PR 커밋 시 `docs/specs/{slug}/assets/`에 동봉해 레포에서도 상대경로 렌더.

## 3. 보안 규칙 (스케치)

| 리소스 | read | write |
|---|---|---|
| `features/{id}` | 로그인 사용자 | developer (본인 생성/공유 정책) · status 전이는 role guard |
| `features/{id}/reviews` | 로그인 사용자 | **designer만** create |
| `users/{uid}` | 본인 | 본인 (role은 온보딩/관리자만) |
| Storage `features/**` | 로그인 사용자 | developer |

- `spec_in_review` 동안 `specBody` write 차단(검토 중 잠금) — 규칙 또는 Function에서 강제.
- 상태 전이 guard(role·전이 적법성)는 Firestore 규칙으로 1차, 민감 전이(PR/Webhook)는 Function으로 2차.

## 4. 현재 모델 → 신 모델 매핑 (전면 재작성)

| 현재 (`data/feature-list.js` v2) | 신 모델 | 처리 |
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
