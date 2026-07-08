# 논의 스레드 (Discussion) — P5.1 확장 설계

> 기존 파이프라인(M0–M4) + 자동 버저닝 + P3 보안규칙 위에 얹는 **협업 확장 C1**.
> spec마다 자유 논의 스레드를 열고, 그 과정에서 비대해진 `reviews[]` 배열을 서브컬렉션으로 전환한다.
> 짝 문서: [notifications.md](./notifications/notifications.md) — 여기서 만드는 상태 전이·새 논의 이벤트가 Discord 알림의 트리거가 된다.
> 설계 기반: [state-machine.md](../design/state-machine.md) · [data-model.md](../design/data-model.md) · [firestore.rules](../../firestore.rules) · [store-firebase.js](../../js/store-firebase.js)
> 상태(2026-07-07): **설계 확정 · 미착수.** (문서화 우선, 개발은 후속.)

범례: `[ ]` 미착수 · `[~]` 진행중 · `[x]` 완료 · `(ops)` 운영작업 · `(BE)` Cloud Functions · `(FE)` 프론트 · `(rules)` 보안규칙

**확정 결정(2026-07-07 논의):** ① 논의 범위 = **승인(`spec_approved`) 전 단계까지만** · ② **`reviews` 배열 → 서브컬렉션 전환을 이번에 함께 수행**.

---

## 1. 배경 — 협업이 "게이트 코멘트"에 갇혀 있다

현재 spec에 남길 수 있는 유일한 대화는 `reviews[]` 배열이고, 그마저도 **디자이너 전용**(`addComments`가 `isDesigner()` 강제)이며 **`spec_in_review`/`spec_changes_requested` 상태에서만** 가능하다([store-firebase.js](../../js/store-firebase.js) `addComments`). 즉:

- 개발자는 spec에 코멘트를 **못 남긴다** (반려에 답하거나 맥락을 적을 공간이 없음).
- 초안(`spec_draft`) 단계의 사전 논의를 담을 곳이 없다.

```
지금:  [디자이너] ──반려 코멘트──▶ reviews[]        (개발자는 못 씀)
목표:  [누구나]  ◀──논의 스레드──▶ discussion       (승인 전, 자유)
```

C1은 **논의 공간**을 연다. spec을 "혼자 열어보는 문서" → **팀이 맥락을 남기는 대화 대상**으로 바꾼다.

## 2. 목표 / 비목표

**목표**
- spec마다 **자유 논의 스레드** — 개발자·디자이너 누구나, **승인 전 단계**에서.
- 문서 크기 부담이 큰 `reviews[]` 배열을 **서브컬렉션으로 전환**(로드맵의 "선택" 항목을 이 기회에 해소).

**비목표 (이번 범위 아님 · §9 보류)**
- 승인 이후(`spec_approved` 이상) 논의 — **잠금**. 확정된 spec의 변경 논의는 별도 변경요청(C2, 후속)으로 유도.
- 알림(Discord) — 짝 문서 [notifications.md](./notifications/notifications.md) 소관.
- resolve 토글·인라인 앵커 — Tier 2(§8.3).

## 3. 저장 구조 — 2개 서브컬렉션 + 활동 타임라인

`reviews[]`를 문서 밖으로 빼고, 논의를 별도 스트림으로 신설한다. **둘 다 `features/{id}` 하위 서브컬렉션.**

```
features/{id}
 ├─ reviews/{reviewId}      ← 게이트 결정만: approved | changes_requested   (기존 배열에서 이관)
 └─ discussion/{msgId}      ← 자유 논의: 누구나, 승인 전 단계               (신규)
```

**왜 서브컬렉션인가:** `reviews[]`는 이미 재검토 diff용 스냅샷을 인라인으로 안고 있어 문서가 비대하다([roadmap.md](../ops/roadmap.md) Post-MVP "reviews 배열 → 서브컬렉션"). 자유 논의까지 배열에 쌓으면 1MB 문서 한도가 현실적 위험이 된다. 서브컬렉션은 무제한 증가 + 개별 규칙 적용 + `onDocumentCreated` 트리거(→ 알림)를 자연히 얹을 수 있다.

**역할 분담(중요):**
- `reviews` = **공식 게이트 결정** `approved` / `changes_requested` 만. 재검토 배너·diff·감사추적의 근거라 의미를 흐리지 않는다.
- `discussion` = 그 외 모든 대화. 기존 디자이너 전용 `decision='comment'`(보충 코멘트)는 **discussion으로 흡수**(누구나·자유·승인 전).

**활동 타임라인(UI):** 상세 패널에서 `reviews` + `discussion` + `versionLog`(버전 bump 이벤트)를 **시각순으로 병합**해 한 줄기로 렌더. 상태 전이는 이 세 소스로 대부분 유추 가능(별도 이벤트 로그는 MVP 범위 밖).

## 4. 논의 규칙 (누가·언제·무엇)

| 항목 | 정책 |
|---|---|
| **작성자** | 로그인한 개발자·디자이너 **누구나** (`authorUid == auth.uid`) |
| **허용 상태** | `spec_draft` · `spec_in_review` · `spec_changes_requested` — **승인 전까지만.** `spec_approved` 이상에서는 **읽기 전용**(기존 스레드는 보이되 새 글 불가) |
| **본문** | 비어있지 않은 마크다운 (라이브 프리뷰 mdToHtml 재활용 가능) |
| **수정/삭제** | 작성자 본인만. 삭제는 소프트(`deleted:true`)로 타임라인 순서 보존 권장 |
| **@멘션** | 본문에서 `@handle` 추출 → `mentions[]` (알림 대상). MVP는 이름 텍스트, 실제 Discord 멘션은 [notifications.md](./notifications/notifications.md) Tier 2 |
| **해결(resolve)** | 코멘트/스레드 `resolved` 토글(기획 TODO 관리). 선택 — §8.3 |
| **앵커** | 기존 spec 섹션 인라인 코멘트처럼 `anchor`(섹션/화면) 연결 재활용 가능 — 선택 |

> **왜 "승인 전까지만"인가:** 확정된 spec에 자유 논의가 계속 붙으면 "확정" 의미가 흐려진다. 승인 후 바꿔야 할 게 생기면 무효화 연쇄(→ `spec_draft` 복귀)를 거치므로, 그때 스레드가 자연히 다시 열린다. 확정본을 향한 정식 변경요청(C2)은 후속 별도 기능.

## 5. discussion 문서 스키마

| 필드 | 타입 | 설명 |
|---|---|---|
| `msgId` | string | `m` + timestamp (문서 id) |
| `body` | string | 마크다운 본문 |
| `authorUid` | string | 작성자 uid (이름은 `auth.userOf`로 매핑) |
| `authorRole` | enum | `developer` / `designer` (뱃지 표시용, 스냅샷) |
| `mentions` | string[] | 멘션된 handle (알림 대상) |
| `replyTo` | string\|null | 부모 msgId (평면 + 1단 답글). MVP는 평면 |
| `anchor` | object\|null | `{section, screen?}` 선택 |
| `resolved` | bool | 선택 (§8.3) |
| `createdAt` | ts | serverTimestamp |

**store 메서드 (mock + firebase 양쪽):**
- `discussion.list(featureId)` — onSnapshot 캐시(기존 sync 인터페이스 유지)
- `discussion.post(featureId, {body, replyTo?, anchor?})` — 상태 게이트 검사 후 서브컬렉션 add
- `discussion.remove(featureId, msgId)` — 작성자 소프트 삭제

## 6. reviews 서브컬렉션 전환 (동반 작업)

`approve` / `requestChanges` 는 지금 **feature 문서 update 하나에 `arrayUnion(reviewObj)` 를 얹어 원자적**이다([store-firebase.js](../../js/store-firebase.js):313,325). 서브컬렉션이 되면 **① 상태 전이(feature update)** 와 **② review 문서 생성**이 두 쓰기로 갈라진다 → **WriteBatch로 원자화**한다.

```
requestChanges(id, comments):
  batch = writeBatch(db)
  batch.update(features/id, { status: 'spec_changes_requested', updatedAt })
  batch.set(features/id/reviews/{rid}, { decision:'changes_requested', comments, reviewerUid, reviewedAt })
  await batch.commit()          // 둘 다 성공하거나 둘 다 실패
```

- `reviews[]` 를 읽던 곳(재검토 배너·활동 타임라인)은 서브컬렉션 onSnapshot으로 교체.
- **재검토 diff는 그대로**: 버전별 스냅샷은 `versionLog`에 있지 `reviews`가 아니므로 diff 로직 무관. `reviews`는 결정 기록만 이관.
- `decision='comment'`(보충 코멘트) 데이터는 **discussion으로 이관**(§3).
- 기존 feature 문서 `reviews[]` → 서브컬렉션 **일회성 마이그레이션**(스크립트/함수).

## 7. 보안 규칙 (firestore.rules 추가/변경)

기존 `reviews` 서브컬렉션 스켈레톤(`create: if isDesigner()`)을 실사용에 맞게 강화 + `discussion` 신설.

```
match /features/{featureId} {
  ...
  match /reviews/{reviewId} {
    allow read: if signedIn();
    // 디자이너만, 본인 명의, 결정은 approved|changes_requested 만
    allow create: if isDesigner()
      && request.resource.data.reviewerUid == request.auth.uid
      && request.resource.data.decision in ['approved','changes_requested'];
    allow update, delete: if false;   // 감사기록 불변
  }

  match /discussion/{msgId} {
    allow read: if signedIn();
    // 누구나(로그인), 본인 명의, 승인 전 상태에서만
    allow create: if signedIn()
      && request.resource.data.authorUid == request.auth.uid
      && get(/databases/$(database)/documents/features/$(featureId)).data.status
         in ['spec_draft','spec_in_review','spec_changes_requested'];
    // 작성자 본인만 소프트 삭제/수정
    allow update, delete: if signedIn()
      && resource.data.authorUid == request.auth.uid;
  }
}
```

> 서브컬렉션 create 시 부모 상태를 `get()`으로 읽으므로 규칙당 문서읽기 1회 비용. 트래픽이 낮아 무해.
> `@firebase/rules-unit-testing` 하니스(기존 25 케이스)에 discussion/reviews 서브컬렉션 케이스 추가.

## 8. UI 표면

### 8.1 상세 패널 "활동" 섹션 (기존 리뷰 UI 대체·확장)

```
┌─ 활동 ──────────────────────────────────────────────┐
│ v0.1.0 초안 등록 · 재성                     2일 전     │  ← versionLog
│ 🔍 컨펌 요청                                 2일 전     │  ← 상태 전이
│ 💬 재성  "로그인 실패 케이스 문구 확인 필요"  1일 전     │  ← discussion
│    ↳ 💬 은석 @재성 "1.2 참고"                 1일 전     │
│ 🔁 반려 · minnhokim  "AC3 화면 누락"          20시간    │  ← reviews
│ v0.1.1 재제출                                18시간    │
│ ✅ 승인 · minnhokim                           3시간     │
│ ─── 승인 후 논의 잠금 ───                               │  ← spec_approved 이상
├─────────────────────────────────────────────────────┤
│ [ 댓글 입력 … @멘션 ]                        (승인 전만) │
└─────────────────────────────────────────────────────┘
```

- 논의 입력창은 **승인 전 상태에서만** 노출. 승인 후엔 "논의 잠금" 구분선 + 읽기 전용.
- 라이브 마크다운 프리뷰(업로드 편집기) 컴포넌트를 댓글 입력에 재활용.

### 8.2 목록 · KPI

- feature 행에 **미해결 논의 뱃지**("💬 3", resolve 도입 시 "미해결 1").
- KPI/필터칩: **"논의 있음"**. ("내 멘션" 필터는 알림과 연동 — [notifications.md](./notifications/notifications.md))
- (선택) `lastActivityAt` 비정규화 필드로 "최근 활동순" 정렬.

### 8.3 리치/선택 (Tier 2)

- resolve 토글(미해결 논의 추적) + 앵커 인라인 코멘트 확장(섹션/화면 연결).

## 9. 단계별 체크리스트 (P5.1)

- [ ] `(FE)` `discussion` 서브컬렉션 스키마 + store 메서드(`list`/`post`/`remove`) — mock·firebase 양쪽
- [ ] `(FE)` `reviews[]` → 서브컬렉션 전환: `approve`/`requestChanges`를 **WriteBatch**(전이+review 원자화)로, 읽기 onSnapshot 교체
- [ ] `(FE)` `decision='comment'` → discussion 흡수 + 기존 데이터 이관
- [ ] `(FE)` 상세 "활동" 타임라인 병합 렌더(reviews+discussion+versionLog) + 승인 전 입력창·승인 후 잠금
- [ ] `(rules)` `discussion` 규칙(누구나·본인명의·승인 전) + `reviews` 규칙 강화(결정 enum·본인명의) + 유닛테스트
- [ ] `(ops)` 기존 feature 문서 `reviews[]` → 서브컬렉션 **일회성 마이그레이션**(스크립트/함수)
- [ ] `(FE)` 목록 논의 뱃지 + KPI/필터칩("논의 있음")
- [ ] 캐시 버스팅(store-firebase/store/app/css)

## 10. 보류 / 후속

- **변경요청(C2)** — 확정(`merged`) spec을 정식 사유·영향범위와 함께 바꾸는 워크플로우. 승인 후 논의 잠금과 짝을 이루는 후속.
- **resolve·앵커** — §8.3, Tier 2.

## 11. 의사결정 로그

- **논의 범위 = 승인 전까지만** — 확정본 오염 방지. 승인 후 변경은 무효화 연쇄 또는 C2로.
- **reviews 서브컬렉션 전환 = 이번에 동반** — 문서 비대 해소 + 트리거 발판. 재검토 diff는 `versionLog` 기반이라 무관.
- **reviews vs discussion 분리** — 게이트 결정(감사)과 자유 논의(협업)를 섞지 않음. UI만 타임라인으로 병합.
- **알림은 별도 문서** — [notifications.md](./notifications/notifications.md)로 분리(2026-07-07).
