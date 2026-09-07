# Desktop visual refresh

작성: 2026-09-07 14:00 (KST)

사용자가 제공한 다크 작업 관리 화면을 #37의 시각 기준으로 사용한다. Electron/React 및 기존 IPC·서버 API·데이터 모델·동기화/마이그레이션 경로를 유지한다.

## Palette

| 역할 | 색 |
| --- | --- |
| Canvas | #101216 |
| Sidebar / panel | #15181e |
| Elevated input / card | #1c2028 |
| Hover | #252b36 |
| Border | #2b303b |
| Primary text | #edf1f7 |
| Secondary text | #a0aaba |
| Muted text | #8792a4 |
| Accent / focus | #6294ff |
| Selected background | #253858 |
| Secondary accent | #a18aff |
| Success / warning / danger | #70d5a0 / #edbc72 / #f0838b |

## Layout and behavior

- 42px 상단: 26px Thread 로고, 28px 검색창(Ctrl/Cmd+K), 기존 창 제어.
- 232px 사이드바: 오늘/전체, 기존 카테고리 및 보안 카테고리 관리, 계정과 설정.
- 현재 시간은 22px, 시계 아래 여백은 기존보다 10px 추가한다. 오늘/전체 버튼은 36px 높이다.
- 목록 요약과 캘린더 항목은 12px 남은 시간을 가장 큰 단위 하나로 내림 표시한다(1시간 35분 → 1시간 남음). 지난 기한은 같은 규칙으로 지남을 표시하고 펼친 상세 타이머는 기존 다중 단위를 유지한다.
- 캘린더 항목 제목은 12px이며 날짜 셀의 콘텐츠 폭이 150px 이상일 때만 남은 시간을 표시한다. 월/년의 시간 환산은 기존 포맷터를 유지한다.
- 분할 목록은 카드 바깥 삭제 버튼의 7px 돌출 폭을 수용하는 우측 8px 여백으로 가로 스크롤을 방지한다.
- 작업 영역: 제목/설명, 기존 보기 및 정렬 선택, 전체/진행 중/완료 필터, 상단 추가 입력.
- 기본 보기는 작업 목록과 월간 캘린더의 두 열. 좁은 창에서는 세로로 배치하고 각 기능에 스크롤로 접근한다.
- 검색은 이미 접근 가능한 작업의 제목·메모·카테고리명에 적용하는 renderer 필터다. 보안 카테고리 필터를 우회하지 않는다.
- 중요/즐겨찾기/휴지통처럼 현재 저장 모델에 없는 기능은 시각적 버튼만 만들지 않는다.
- 날짜 선택 상세는 현재 필터의 작업만 보여준다. 완료/수정/삭제/정렬/반복/하위 작업은 기존 콜백을 사용한다.
- 설정·컨텍스트 메뉴·날짜 선택·로그인·로딩/오류 표면은 같은 토큰을 사용한다.
- 키보드 focus ring, 검색 Escape, 실제 button, reduced-motion을 반영한다.

## Verification

실제 사용자 데이터 대신 synthetic fixture로 주요 화면·빈 상태·좁은 창·검색/필터·기존 편집 콜백을 검증한다. 최종 사용자 시각 검수 전에는 #37을 WIP로 유지한다.

검증 결과: 2026-09-07 14:29 (KST)

- Renderer Jest 31개 통과. 검색·완료 필터가 보안 카테고리 가시성을 유지하고 추가/완료가 기존 IPC 인자를 전달함을 회귀 테스트로 확인했다.
- 실제 Edge headless에 synthetic Task/Category와 IPC fixture를 연결해 Ctrl+K/Escape 검색, 비공개 검색 제외, 카테고리/완료 필터, 추가/완료/제목 수정 호출, 상세 편집, 월 이동/날짜 상세, 설정의 v2 상태, 중요도 정렬/타임라인, 사이드바 접기, 빈 상태를 확인했다.
- 1600×1000과 1280×800에서는 두 열, 900×800에서는 세로 배치를 확인했다. 가로 페이지 넘침과 JS runtime error가 없었다.
- Production renderer build 통과. 기존 lint/React test-utils deprecation 경고는 남아 있다.
- 변경은 renderer와 디자인 문서 범위다. Electron main/IPC 서비스·서버·DB·모바일은 변경하지 않았다. 실제 사용자 데이터, 로그인 세션 또는 운영 API로 브라우저 검증하지 않았다.
- 설치 파일 패키징과 사용자 시각 검수는 이번 검증에 포함하지 않는다. 현재 dev 실행에서 화면을 확인할 수 있다.

## Preview

추가 피드백 검증: 2026-09-07 14:59 (KST)

- Renderer 40개 테스트 통과. 단일 단위 내림 경계와 기존 다중 단위 포맷 유지 포함.
- 실제 브라우저에서 상단 42px·로고 26px·검색창 28px·시계 22px·기본 메뉴 36px·시계 하단 padding 26px을 측정했다.
- 900/1280/1600px에서 분할 목록에 hover해 내부 가로 넘침이 없는지 검사했다. 이전에는 목록 clientWidth 599px 대비 scrollWidth 602px이었으며 수정 후 넘침이 없다.
- 캘린더 단독 넓은 보기에서 남은 시간 표시, 좁은 보기에서 숨김, 항목 12px 및 목록 단일 단위 표시를 확인했다. 기존 검색/추가/완료/편집/설정/보기 전환 검증도 통과했다.
- Production renderer build 통과(기존 lint 경고). 상세 타이머 구현과 데이터/IPC는 변경하지 않았다.

아래 이미지는 실제 변경된 React 컴포넌트에 가짜 데이터를 넣어 촬영한 화면이다.

![Desktop workspace](assets/desktop-refresh-wide.jpg)

![Narrow workspace](assets/desktop-refresh-narrow.jpg)

![Settings](assets/desktop-refresh-settings.jpg)
