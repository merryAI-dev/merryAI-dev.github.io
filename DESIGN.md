# Design System — MYSCube Engineering

## Product Context

- **What this is:** MYSCube를 만들며 발견한 기술적 문제와 선택 근거를 기록하는 기술 블로그
- **Who it's for:** MYSC 구성원, 협력 개발자, 임팩트 조직의 운영 시스템에 관심 있는 독자
- **Project type:** Editorial technology blog with a non-developer editor

## Aesthetic Direction

- **Direction:** Editorial Ledger
- **Decoration:** intentional — 원장 격자, 여백선, 손으로 그은 듯한 한 개의 밑줄만 사용
- **Mood:** 신뢰할 수 있는 기술 문서이면서 실제 워크숍 화이트보드의 흔적이 남아 있는 화면
- **Signature:** 게시물의 왼쪽 ledger margin과 실제 시리즈 순번

## Typography

- **Display:** Gowun Batang — 긴 한글 제목에 편집물의 인상을 부여
- **Body/UI:** Pretendard Variable — 긴 기술 문서의 가독성 확보
- **Data/Code:** IBM Plex Mono — 키, 숫자, 코드와 시리즈 라벨에 사용
- **Scale:** 12 / 14 / 17 / 21 / 28 / 40 / 74px

## Color

- **Navy:** `#062E61` — MYSC 로고에서 이어지는 주요 브랜드색
- **Deep navy:** `#031F43` — 제목과 코드 배경
- **Sky:** `#59BDD8` — 로고 심벌, 링크와 구조 강조
- **Orange:** `#FF7A1A` — 경고, 현재 순번, 손그림 밑줄
- **Paper:** `#F7FBFC` — 차가운 종이색 배경
- **Text:** `#172536` / muted `#5F7082`

## Spacing & Layout

- **Base unit:** 8px
- **Reading width:** 760px
- **Wide layout:** 1180px
- **Density:** 본문은 넉넉하게, 목록과 메타 정보는 간결하게
- **Radius:** 4px 기본. 둥근 카드 반복은 사용하지 않음

## Motion

- 링크와 버튼의 150ms 피드백만 사용
- `prefers-reduced-motion`을 존중
- 스크롤 애니메이션은 사용하지 않음

## Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-07-22 | Editorial Ledger 시스템 채택 | MYSC 공식 브랜드와 Excalidraw 다이어그램을 한 화면에서 충돌 없이 연결하기 위해 |
