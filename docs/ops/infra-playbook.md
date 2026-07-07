# 인프라 실등록 플레이북 (M0)

> 출처: [PRD](../PRD.md) 7장 · 5.1
> 의존 순서: **A(GitHub App 골격) → B(Firebase+Functions) → C(Webhook 역기입) → D(레포 CODEOWNERS)**
> 산출물(시크릿)은 **절대 커밋 금지** — `js/firebase-config.js`(공개 web config는 OK) / Functions 환경변수에만 보관.

각 단계 끝의 **→ 산출물**을 다음 단계 입력으로 넘긴다. 콘솔 작업(admin)은 사람이, 코드/배포는 이 레포에서.

---

## A. GitHub App 등록 (조직 `mash-up-kr`, admin)

GitHub → Organization `mash-up-kr` → Settings → Developer settings → **GitHub Apps → New GitHub App**.

| 설정 | 값 |
|------|-----|
| GitHub App name | `mino-spec-center` (유니크) |
| Homepage URL | `https://mash-up-kr.github.io/mino-android-spec-center/` |
| **Callback URL** | `https://mash-up-kr.github.io/mino-android-spec-center/` (OAuth 교환 후 복귀) |
| Expire user authorization tokens | **체크 해제(OFF)** — refresh 불필요 |
| Request user authorization (OAuth) during installation | **체크(ON)** |
| Webhook · Active | **ON** |
| Webhook URL | (B 배포 후 채움 — 일단 임시 `https://example.com` 후 C에서 수정) |
| Webhook secret | 랜덤 생성(`openssl rand -hex 32`) → 보관 |
| **Permissions → Repository → Contents** | **Read and write** |
| **Permissions → Repository → Pull requests** | **Read and write** |
| **Subscribe to events** | **Pull request** |
| Where can this be installed | Only on this account |

생성 후 **Install App** → `Team-MINO-Android` 레포에 설치(또는 All repos).

→ **산출물**: `App ID` · `Client ID` · `Client Secret`(Generate) · `Webhook secret`

---

## B. Firebase 프로젝트 + Functions

### B-1. 콘솔 (admin)
1. [Firebase 콘솔](https://console.firebase.google.com) → 프로젝트 생성 (예: `mino-spec-center`).
2. **요금제 → Blaze**로 업그레이드 (Functions 아웃바운드 호출 전제).
3. **Build → Authentication → 시작 → Sign-in method → GitHub 사용 설정**
   - GitHub의 **Client ID / Client Secret**(A 산출물) 입력.
   - Firebase가 주는 **인증 콜백 URL**(`https://<project>.firebaseapp.com/__/auth/handler`)을
     A의 GitHub App **Callback URL 목록에 추가**(여러 개 등록 가능).
4. **Build → Firestore Database → 생성**(프로덕션 모드, 리전 `asia-northeast3`).
5. **Build → Storage → 생성**(같은 리전).
6. 프로젝트 설정 → 일반 → **웹 앱 추가(</>)** → **firebaseConfig** 복사.

→ **산출물**: `firebaseConfig`(apiKey 등, 공개 OK) → [js/firebase-config.js](../../js/firebase-config.js)에 붙여넣고 `enabled: true`

### B-2. 레포 (이 디렉터리)
```bash
npm i -g firebase-tools          # 1회
firebase login
# .firebaserc 의 "your-project-id" 를 실제 프로젝트 ID로 교체
cd functions && npm install && cd ..

# Functions 시크릿 등록 (커밋 금지)
firebase functions:secrets:set GITHUB_CLIENT_ID
firebase functions:secrets:set GITHUB_CLIENT_SECRET
firebase functions:secrets:set GITHUB_WEBHOOK_SECRET

# 배포
firebase deploy --only firestore:rules,storage:rules
firebase deploy --only functions
```

→ **산출물**: 배포된 함수 URL 3개 (`githubOAuthExchange` / `createSpecPR` / `githubWebhook`)

---

## C. Webhook 연결 (A ↔ B 잇기)

1. B에서 배포된 **`githubWebhook` URL**을 A의 GitHub App → **Webhook URL**에 역기입.
2. `Pull request` 이벤트 수신 + HMAC(`GITHUB_WEBHOOK_SECRET`) 검증 동작 확인.
3. 테스트 PR을 열고/머지해 Firestore `features/{id}.status`가 `pr_open`→`merged`로 갱신되는지 확인.

---

## D. 대상 레포 CODEOWNERS ([mino_android.md] 소관)

`Team-MINO-Android` 레포 `.github/CODEOWNERS`:
```
docs/specs/** @<리뷰 담당 핸들>
```

---

## E. 사용자 GitHub 토큰 → Secret Manager (Post-MVP 운영 전환)

> 코드: [functions/token-store.js](../../functions/token-store.js) — 로그인 팝업 토큰을
> `storeGithubToken`(callable)이 사용자별 시크릿 `user-gh-token-{uid}` 로 저장.
> Firestore `users/{uid}.githubToken` 평문 저장 폐지. 레거시 필드는 첫 PR 생성/close 시 자동 이관 후 삭제.

1. **(ops) 함수 런타임 SA 에 Secret Manager 권한 부여** — 시크릿 생성/버전추가/파기/접근이 필요하므로 admin 롤:
   ```bash
   # PROJECT_NUMBER 확인: gcloud projects describe mino-spec-center --format='value(projectNumber)'
   gcloud projects add-iam-policy-binding mino-spec-center \
     --member=serviceAccount:<PROJECT_NUMBER>-compute@developer.gserviceaccount.com \
     --role=roles/secretmanager.admin
   ```
   (Secret Manager API 는 기존 `functions:secrets:set` 사용으로 이미 활성화됨)
2. **배포**: `cd functions && npm install && cd ..` → `firebase deploy --only functions,firestore:rules`
3. **검증**: 재로그인 → Functions 로그에 `storeGithubToken` 성공 + Firestore `users/{uid}` 에 `githubToken` 필드 없음 → PR 생성 1회 동작 확인
4. **(ops) 잔여 평문 정리**: 재로그인/PR 생성을 안 거친 사용자 문서에 `githubToken` 이 남아 있으면 Firebase 콘솔에서 필드 수동 삭제 (수 명 규모)

→ **산출물**: 토큰이 Secret Manager 로만 흐름 (Firestore 평문 0)

---

## 체크 (완료 표시)
- [x] A: GitHub App 등록 + 설치 → App ID/Client ID/Secret/Webhook secret 확보
- [x] B-1: Firebase 프로젝트 + Blaze + Auth(GitHub)/Firestore/Storage + webConfig
- [x] B-2: firebase-config.js 채움 · secrets 등록 · rules/functions 배포
- [x] C: Webhook URL 역기입 + PR 라운드트립 확인 — 역기입·HMAC + **PR 라운드트립 e2e 완료**(PR #55: pr_open→pr_closed). merged 경로만 실 머지 미검증
- [x] D: CODEOWNERS (`docs/specs/** @JaesungLeee @simeunseok @KateteDeveloper`) — PR #54 머지 완료
- [ ] E: 사용자 토큰 Secret Manager — 코드 완료, IAM 부여·배포·잔여 평문 정리 남음
