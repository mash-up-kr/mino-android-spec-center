# 붙여넣기 구조 검증 (구현 명세)

> 출처: [mino_spec.md](../../mino_prd/mino_spec.md) 4.2 · `mino_prd/skills/VALIDATION.md` S1–S6
> 상태: 설계(미구현) · v2 전면 재설계 기준
> 위치: 대시보드 업로드 시 **2차 방어선**. 1차 자가검수는 로컬 `spec-reviewer`가 수행, 내용 품질은 컨펌 게이트가 흡수. 대시보드는 **기계적 구조 검증만** 한다.

검증 기준은 `spec-reviewer` 검수 체크포인트(S1–S9)의 **A(자동) 항목과 동일**해야 한다. 아래 6개가 대시보드 구현 대상.

## 검증 항목 (모두 통과해야 `spec_draft` 생성·컨펌요청 허용)

| # | 항목 | 규칙 | 차단 |
|---|---|---|---|
| S1 | slug 주석 | 첫 줄 `<!-- feature: {slug} -->`, slug = `^[a-z0-9-]+$` | 하드(없으면 거부) |
| S2 | 필수 H2 8개 | 아래 8개가 **순서대로·제목 일치** 존재 | 하드 |
| S3 | section 2 이미지 | `2. 화면 상태별 읽기` 블록에 `![](assets/*.png)` ≥ 1 | 하드 |
| S4 | enum 유효성 | 5.x 표 `interactionType`(6종)·`확정`(3종) 컬럼 = 통제 어휘만, 빈 값 없음 | 하드 |
| S5 | 이미지 정합 | 본문 참조 `assets/x.png` ↔ 업로드 파일 1:1 (깨진 링크 0) | 하드 |
| S6 | 버전 파싱 | `변경 이력` 최신 행 버전명 = `v\d+\.\d+\.\d+`, 브랜치 suffix로 파싱 가능 | 하드 |

> S7(ID 컨벤션)·S8(사실 기반)·S9(이미지 export)는 **H(사람 판단)** → 대시보드 자동 검증 대상 아님. `spec-reviewer` + 디자이너 컨펌이 담당.

## 필수 H2 8개 (S2) — 순서·제목

`spec-gen` 출력 템플릿과 일치:

```
## 1. 한눈에 보기
## 2. 화면 상태별 읽기
## 3. 핵심 UX 규칙
## 4. 사용자 흐름
## 5. 상세 기능 명세
## 비목표
## Open Questions
## 변경 이력
```

> 주의: 1–5는 숫자 접두사 있음, 뒤 3개(비목표/Open Questions/변경 이력)는 접두사 없음. 매칭은 **숫자 접두사 무시 + 핵심 제목 텍스트** 기준으로 한다.

## 통제 어휘 (S4)

- `interactionType` (6종): `display_state` · `user_action` · `navigation` · `async_process` · `validation` · `modal_dialog`
- `확정` (3종): `confirmed` · `partial` · `needs_policy`

## 구현 메모

- 파서는 **본문을 데이터로 파싱하지 않는다** (구 items 모델 폐기). H2 헤더 추출 + 정규식 검사만.
- `js/validate.js` 신설: `validateSpec(body, uploadedAssetNames) → { ok, errors: [{code, msg}] }`.
- 검증 실패 시 항목별 메시지를 업로드 UI에 인라인 표시하고 저장/컨펌요청 버튼 비활성화.
- S5는 업로드된 파일명 집합과 본문 `![](assets/...)` 참조 집합의 양방향 차집합으로 검출.
- 버전(S6) 파싱 결과는 `features.specVersion`에 캐시 → PR 브랜치 `docs/spec-{slug}-v{n}`에 사용.

## 검증 ↔ 자동화 추적성

VALIDATION.md 합격 기준: A 항목 전부 통과 + H 치명 결함 0. 대시보드 S1–S6 = `spec-reviewer`와 동일 기준이므로, 스킬 자가검수를 통과한 산출물은 대시보드 검증도 통과해야 정상(불일치 시 스킬/검증기 중 하나의 버그).
