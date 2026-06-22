---
id: 005-now-openchat
title: 지금 - 오픈채팅 목록
module: feature:now
type: Screen
trigger: "지금" 탭의 오픈채팅 세그먼트 진입
figmaNode: 2001-0001
figmaUrl: https://www.figma.com/design/xxxx?node-id=2001-0001
figmaSection: 2001:0001 지금 / 오픈채팅
specVersion: v0.1.0
related: 006-now-shorts
---

# 지금 - 오픈채팅 목록

## 1. 한눈에 보기

| 항목 | 내용 |
|---|---|
| 목적 | 참여 중인 오픈채팅방을 핀 고정 + 최근 활동 순으로 보여주고 방으로 진입 |
| 진입점 | "지금" 탭 → 오픈채팅 세그먼트 |
| 대상 | 오픈채팅에 참여 중인 사용자 |
| 핵심 규칙 | 핀 고정 최상단 · 안읽음 300+ 표기 · 신규 메시지 시 상단 갱신 |

## 2. 화면 상태별 읽기

| 상태 | 설명 | 이미지 |
|---|---|---|
| 기본 진입 | 참여 방이 있을 때의 기본 목록. 핀 고정 최상단, 그 외 마지막 메시지 시각 내림차순 | ![](https://figma.com/.../2001-0001.png) |
| 로딩 | 목록 로드 중 스켈레톤 리스트 표시 | ![](https://figma.com/.../2001-0002.png) |
| 빈 상태 | 참여 방 0개일 때 안내 문구 + "오픈채팅 탐색" 버튼 | ![](https://figma.com/.../2001-0003.png) |
| 에러 | 로드 실패 시 에러 메시지 + 재시도 버튼 | ![](https://figma.com/.../2001-0004.png) |

## 3. 핵심 UX 규칙

| 규칙 | 내용 |
|---|---|
| 핀 고정 | 핀 고정 방은 항상 최상단 유지 |
| 안읽음 상한 | 안읽음 300 초과 시 "300+"로 표기 |
| 실시간 갱신 | 신규 메시지 수신 시 해당 방을 목록 상단으로 이동 |
| 스크롤 유지 | 탭 재진입 시 목록 스크롤 위치 유지 |

## 4. 사용자 흐름

| 단계 | 동작 | 결과 |
|---|---|---|
| 1 | "지금" 탭 → 오픈채팅 세그먼트 선택 | 목록 로딩 시작 |
| 2 | 로딩 완료 | 목록 표시 |
| 3 | 방 항목 탭 | 채팅방 진입 |
| 4 | 신규 메시지 수신 | 해당 방 상단 갱신 |

## 5. 상세 기능 명세

### 5.1 목록
| ID | 기능 | Trigger | 화면 반응 | interactionType | 확정 | 이미지 |
|---|---|---|---|---|---|---|
| LIST_LOAD | 목록 로드 | 오픈채팅 세그먼트 진입 | 참여 방 목록을 1초 이내 표시, 실패 시 재시도 UI | async_process | confirmed | ![](https://figma.com/.../list-load.png) |
| LIST_SORT | 정렬 규칙 | 목록 렌더 시 | 핀 고정 최상단, 그 외 마지막 메시지 시각 내림차순 | display_state | confirmed | ![](https://figma.com/.../list-sort.png) |
| ROOM_ENTER | 채팅방 진입 | 방 항목 탭 | 해당 오픈채팅방으로 이동 | navigation | confirmed | ![](https://figma.com/.../room-enter.png) |
| LIST_EMPTY | 빈 상태 | 참여 방 0개 | 안내 문구 + "오픈채팅 탐색" 버튼 표시 | display_state | confirmed | ![](https://figma.com/.../list-empty.png) |

### 5.2 안읽음
| ID | 기능 | Trigger | 화면 반응 | interactionType | 확정 | 이미지 |
|---|---|---|---|---|---|---|
| UNREAD_CAP | 안읽음 카운트 표기 | 안읽음 수 300 초과 | 안읽음 카운트를 "300+"로 표기 | display_state | confirmed | ![](https://figma.com/.../unread-cap.png) |
| TAB_UNREAD_BADGE | 탭 합산 뱃지 | 오픈채팅 탭 표시 시 | 전체 방 안읽음 합산을 탭 뱃지로 표시 | display_state | partial | |

### 5.3 실시간
| ID | 기능 | Trigger | 화면 반응 | interactionType | 확정 | 이미지 |
|---|---|---|---|---|---|---|
| NEW_MESSAGE_BUMP | 신규 메시지 수신 | 새 메시지 수신 | 해당 방을 목록 상단으로 이동하고 안읽음 +1 | display_state | needs_policy | |

## 비목표

| 제외 항목 | 사유/연결 |
|---|---|
| 인라인 광고 영역 | 이번 스펙 범위 아님 |
| 오픈채팅방 생성/나가기 | 별도 스펙에서 다룸 |

## Open Questions

| ID | 결정 주체 | 질문 |
|---|---|---|
| TBD-1 | 기획 | 인라인 광고 삽입 주기 N = ? |
| TBD-2 | 서버 | 실시간 갱신 = 폴링 / WebSocket / FCM? |
| TBD-3 | 기획 | 페이징 페이지 크기 = 20? |

## 변경 이력

| 버전 | 날짜 | 변경 | 근거 |
|---|---|---|---|
| v0.1.0 | 2026-06-18 | 최초 작성 | Figma 2001-0001 description + 화면 텍스트 |
