# 배포 원장

스크립트(publish·promote·rollback)만 줄을 추가한다. 손으로 고치지 않는다.

| 일시 (UTC) | 플랫폼 | 채널 | 버전 | 태그 | 결과 | 메모 |
|---|---|---|---|---|---|---|
| 2026-09-23T22:08:14.532Z | macos | beta | 0.1.0 | macos-v0.1.0 | beta-served-verified | 첫 베타 |
| 2026-09-23T22:10:04Z | macos | beta | 0.1.0 | macos-v0.1.0 | dmg-notarized-replaced | dmg가 공증 없이 올라가 Gatekeeper 거부 → notarytool 공증·staple 후 같은 Release의 dmg만 교체 (업데이트 피드 tar.gz는 그대로) |
| 2026-09-23T22:12:46.081Z | macos | stable | 0.1.0 | macos-v0.1.0 | stable-served-verified |  |
| 2026-09-23T22:25:13.932Z | macos | beta | 0.1.1 | macos-v0.1.1 | beta-served-verified | 처음 실행할 때 쓰는 AI를 고르고 바로 로그인해요 |
| 2026-09-23T22:48:17.323Z | macos | beta | 0.1.2 | macos-v0.1.2 | beta-served-verified | 사진·디자인 AI를 나눠 쓰고, 만든 작업을 피드에 공개할 수 있어요 |
| 2026-09-23T22:49:40.035Z | macos | stable | 0.1.2 | macos-v0.1.2 | stable-served-verified |  |
| 2026-09-23T23:27:55.753Z | macos | beta | 0.1.3 | macos-v0.1.3 | beta-served-verified | Gemini(Antigravity) 연결 · AI 도구를 알아서 최신으로 맞춤 · 피드 표시 개선 |
| 2026-09-23T23:29:16.531Z | macos | stable | 0.1.3 | macos-v0.1.3 | stable-served-verified |  |
| 2026-09-23T23:56:11.877Z | macos | beta | 0.1.4 | macos-v0.1.4 | beta-served-verified | 협업 슬라이드 첫 화면 · 내 AI 한 줄 · 작업 목적지 미리보기 |
| 2026-09-23T23:57:37.021Z | macos | stable | 0.1.4 | macos-v0.1.4 | stable-served-verified |  |
| 2026-09-24T00:20:39.381Z | macos | beta | 0.1.5 | macos-v0.1.5 | beta-served-verified | 세트 작업(사진 3장) 실행 · 표지 전면 사진 |
| 2026-09-24T00:21:50.212Z | macos | stable | 0.1.5 | macos-v0.1.5 | stable-served-verified |  |
| 2026-09-24T00:32:53.325Z | macos | beta | 0.1.6 | macos-v0.1.6 | beta-served-verified | Gemini 맡기기 · 연결 창 간소화 |
| 2026-09-24T00:34:04.299Z | macos | stable | 0.1.6 | macos-v0.1.6 | stable-served-verified |  |
| 2026-09-24T00:54:08.959Z | macos | beta | 0.1.7 | macos-v0.1.7 | beta-served-verified | Gemini 사진을 앱이 직접 만들어요 |
| 2026-09-24T00:55:19.421Z | macos | stable | 0.1.7 | macos-v0.1.7 | stable-served-verified |  |
| 2026-09-24T01:06:01.243Z | macos | beta | 0.1.8 | macos-v0.1.8 | beta-served-verified | AI 한 명이 총괄하고 나머지에 맡겨요 · 역할 그림 |
| 2026-09-24T01:07:41.864Z | macos | stable | 0.1.8 | macos-v0.1.8 | stable-served-verified |  |
| 2026-09-24T01:27:46.448Z | macos | beta | 0.1.9 | macos-v0.1.9 | beta-served-verified | 사진 두 장 비교 · 조립 그림 · 팀 칩 |
| 2026-09-24T01:28:56.892Z | macos | stable | 0.1.9 | macos-v0.1.9 | stable-served-verified |  |
| 2026-09-24T01:47:02.557Z | macos | beta | 0.1.10 | macos-v0.1.10 | beta-served-verified | Gemini도 디자인 · 품질/가성비 선택 |
| 2026-09-24T01:48:43.131Z | macos | stable | 0.1.10 | macos-v0.1.10 | stable-served-verified |  |
| 2026-09-24T08:19:33.636Z | macos | beta | 0.1.11 | macos-v0.1.11 | beta-served-verified | 웹이 결과 화면 하나가 됩니다: 앱은 두 줄 상태 창, 결과·고치기·공개는 Dynapse 창(웹 /works). 로컬 브릿지·기기 등록·동기화(선택) |
| 2026-09-24T09:13:24.562Z | macos | beta | 0.1.12 | macos-v0.1.12 | beta-served-verified | 고치기가 대화가 됩니다: 웹에서 페이지별로 말하면 같은 AI 대화를 이어서 고쳐요. 버전 되돌리기·터미널 수정 기록 |
| 2026-09-24T10:03:30.370Z | macos | beta | 0.1.13 | macos-v0.1.13 | beta-served-verified | 예전 작업도 웹에서 보이게: 시작할 때 썸네일·기록을 채워요 |
| 2026-09-24T10:31:22.204Z | macos | beta | 0.1.14 | macos-v0.1.14 | beta-served-verified | 파트너 모드를 켜면 앱이 바로 알아요. 앱에서 다음 사진 작업을 바로 수락할 수 있어요 |
| 2026-09-24T12:28:13.150Z | macos | beta | 0.1.15 | macos-v0.1.15 | beta-served-verified | 고치기가 Claude Code처럼: 고치고, 직접 확인하고, 다시 고쳐요. 버전마다 전/후 사진 |
| 2026-09-24T13:30:58.828Z | macos | beta | 0.1.16 | macos-v0.1.16 | beta-served-verified | 작업실이 대화 하나가 됩니다: 웹에서 문장으로 시키면 이 PC의 Claude Code가 이어서 처리해요 |
| 2026-09-24T23:52:01.334Z | macos | stable | 0.1.16 | macos-v0.1.16 | stable-served-verified |  |
| 2026-09-25T00:02:17.038Z | macos | beta | 0.1.17 | macos-v0.1.17 | beta-served-verified | 웹에서 디자인·사진 AI를 골라 시켜요. 파트너 작업 결과가 사진으로 보여요 |
| 2026-09-25T00:03:27.637Z | macos | stable | 0.1.17 | macos-v0.1.17 | stable-served-verified |  |
| 2026-09-25T00:38:23.294Z | macos | beta | 0.1.18 | macos-v0.1.18 | beta-served-verified | 작업실 AI 줄: 누가 사진·슬라이드를 맡을지 눌러서 바꿔요 |
| 2026-09-25T00:39:34.280Z | macos | stable | 0.1.18 | macos-v0.1.18 | stable-served-verified |  |
| 2026-09-25T01:08:05.301Z | macos | beta | 0.1.19 | macos-v0.1.19 | beta-served-verified | 작업실 파일 줄·폴더 열기·내보내기, AI별 모델·강도, 턴 사용량 |
| 2026-09-25T01:09:16.148Z | macos | stable | 0.1.19 | macos-v0.1.19 | stable-served-verified |  |
| 2026-09-25T11:11:18.411Z | macos | beta | 0.1.20 | macos-v0.1.20 | beta-served-verified | 앱이 대화 엔진 하나로: 웹 작업실에서 시키면 바로 돌아요 |
| 2026-09-25T11:12:31.014Z | macos | stable | 0.1.20 | macos-v0.1.20 | stable-served-verified |  |
| 2026-09-25T11:24:45.491Z | macos | beta | 0.1.21 | macos-v0.1.21 | beta-served-verified | 버전을 커밋으로 동기화, 연결 전에도 채팅이 기다렸다가 시작 |
| 2026-09-25T11:25:56.323Z | macos | stable | 0.1.21 | macos-v0.1.21 | stable-served-verified |  |
| 2026-09-25T13:00:30.443Z | macos | beta | 0.1.22 | macos-v0.1.22 | beta-served-verified | 모델 표기·진행 정보, 초대·공동 작업, 가져오기(폴더·붙여넣기·끌어놓기), 브라우저 연결(앱으로 로그인), 상태 줄 우측 |
| 2026-09-25T13:03:49.723Z | macos | stable | 0.1.22 | macos-v0.1.22 | stable-served-verified |  |
| 2026-09-25T13:12:53.908Z | macos | beta | 0.1.23 | macos-v0.1.23 | beta-served-verified | 트레이 새 작업, 사진 칸 표시, 내보내기·가져오기·브라우저 연결 포함 |
| 2026-09-25T13:14:05.569Z | macos | stable | 0.1.23 | macos-v0.1.23 | stable-served-verified |  |
| 2026-09-25T13:42:31.983Z | macos | beta | 0.1.24 | macos-v0.1.24 | beta-served-verified | 합치기 질문 턴, 가져오기 받기, 운영자 채팅 검수 |
| 2026-09-25T13:44:43.437Z | macos | stable | 0.1.24 | macos-v0.1.24 | stable-served-verified |  |
| 2026-09-25T14:02:52.995Z | macos | beta | 0.1.25 | macos-v0.1.25 | beta-served-verified | 강제 업데이트, 템플릿 가져다 놓기, 실행 줄 모델 표시 |
| 2026-09-25T14:04:04.584Z | macos | stable | 0.1.25 | macos-v0.1.25 | stable-served-verified |  |
| 2026-09-25T14:48:41.907Z | macos | beta | 0.1.26 | macos-v0.1.26 | beta-served-verified | 무재시작 업데이트·새 버전 즉시 알림 |
| 2026-09-25T14:49:54.433Z | macos | stable | 0.1.26 | macos-v0.1.26 | stable-served-verified |  |
| 2026-09-25T14:54:54.289Z | macos | ota | 0.1.26+ota1 | - | ota-served-verified | OTA 경로 첫 확인 |
| 2026-09-25T15:21:08.545Z | macos | beta | 0.1.27 | macos-v0.1.27 | beta-served-verified | 창 하나, 참고 폴더·위치 참조, 휴지통, 뒤로가기 |
| 2026-09-25T15:22:19.665Z | macos | stable | 0.1.27 | macos-v0.1.27 | stable-served-verified |  |
| 2026-09-25T18:07:43.006Z | macos | beta | 0.1.28 | macos-v0.1.28 | beta-served-verified | 홈은 네이티브, 작업은 같은 창에서 웹 |
| 2026-09-25T18:09:24.612Z | macos | stable | 0.1.28 | macos-v0.1.28 | stable-served-verified |  |
| 2026-09-25T21:05:18.161Z | macos | beta | 0.1.29 | macos-v0.1.29 | beta-served-verified | 앱 창 하나(웹), 연결 탭 상태 화면 |
| 2026-09-25T21:06:31.371Z | macos | stable | 0.1.29 | macos-v0.1.29 | stable-served-verified |  |
| 2026-09-25T21:40:35.472Z | macos | beta | 0.1.30 | macos-v0.1.30 | beta-served-verified | 올리는 상태, 이미지 버전, 초대 수락 |
| 2026-09-25T21:42:16.725Z | macos | stable | 0.1.30 | macos-v0.1.30 | stable-served-verified |  |
| 2026-09-25T23:55:36.631Z | macos | beta | 0.1.31 | macos-v0.1.31 | beta-served-verified | 사진 러너, 멈춤 카드 |
| 2026-09-25T23:56:48.281Z | macos | stable | 0.1.31 | macos-v0.1.31 | stable-served-verified |  |
| 2026-09-26T02:37:43.600Z | macos | ota | 0.1.31+ota1 | - | ota-served-verified | 가져오기는 저장만, out.png 제거 |
| 2026-09-26T02:57:23.798Z | macos | ota | 0.1.31+ota2 | - | ota-served-verified | 리워드 작업 행에 제출 상태 |
| 2026-09-26T03:18:49.542Z | macos | ota | 0.1.31+ota3 | - | ota-served-verified | 내 작업에 넣기 |
| 2026-09-26T03:41:17.106Z | macos | ota | 0.1.31+ota4 | - | ota-served-verified | 카드 썸네일 = 파일 줄 첫 항목, 커밋마다 갱신 |
| 2026-09-26T04:05:41.894Z | macos | ota | 0.1.31+ota5 | - | ota-served-verified | 진행 문구는 결과물에 닿는 것만, 내부 작업은 로그로 |
| 2026-09-26T04:25:01.264Z | macos | ota | 0.1.31+ota6 | - | ota-served-verified | AI 카드에 로그인 계정 표시, 다른 계정으로 전환 |
| 2026-09-26T06:14:13.407Z | macos | ota | 0.1.31+ota7 | - | ota-served-verified | 작업실 AI 팝오버에서 계정 전환 |
| 2026-09-26T06:20:07.497Z | macos | beta | 0.1.32 | macos-v0.1.32 | beta-served-verified | 숨은 창이 멈추지 않게 — 연결 상태·메시지 수신 안정화 |
| 2026-09-26T06:21:19.155Z | macos | stable | 0.1.32 | macos-v0.1.32 | stable-served-verified |  |
| 2026-09-26T07:05:56.628Z | macos | beta | 0.1.33 | macos-v0.1.33 | beta-served-verified | PDF·MD 등 문서만 가져와도 작업이 생겨요 |
| 2026-09-26T07:07:09.090Z | macos | stable | 0.1.33 | macos-v0.1.33 | stable-served-verified |  |
| 2026-09-26T10:36:21.456Z | macos | beta | 0.1.34 | macos-v0.1.34 | beta-served-verified | 사진은 요청에 맞게 — 맞는 재고가 없으면 내 사진 AI로 만들어요 |
| 2026-09-26T10:37:32.365Z | macos | stable | 0.1.34 | macos-v0.1.34 | stable-served-verified |  |
| 2026-09-26T10:46:14.487Z | macos | ota | 0.1.34+ota1 | - | ota-served-verified | 추천 사진 교체 · 생성은 필요할 때만 |
| 2026-09-26T11:02:52.524Z | macos | beta | 0.1.35 | macos-v0.1.35 | beta-served-verified | 가져온 HTML이 원본 모습 그대로 · 작업실 레이아웃 정리 |
| 2026-09-26T11:04:03.454Z | macos | stable | 0.1.35 | macos-v0.1.35 | stable-served-verified |  |
| 2026-09-26T11:43:51.483Z | macos | beta | 0.1.36 | macos-v0.1.36 | beta-served-verified | 캔버스 작업실 · 짚어서 말하기 · 글자 직접 수정 · 자동 승인 |
| 2026-09-26T11:45:02.223Z | macos | stable | 0.1.36 | macos-v0.1.36 | stable-served-verified |  |
| 2026-09-26T12:06:02.791Z | macos | ota | 0.1.36+ota1 | - | ota-served-verified | 새 설정으로 다시 붙을 때 턴이 끊기던 문제 |
| 2026-09-26T12:19:22.721Z | macos | ota | 0.1.36+ota2 | - | ota-served-verified | 토큰 표시에서 캐시 재사용 제외 |
| 2026-09-26T12:26:16.564Z | macos | ota | 0.1.36+ota3 | - | ota-served-verified | 자동 승인이 다시 묻지 않게 · 기본 강도 보통 |
| 2026-09-26T12:39:02.511Z | macos | beta | 0.1.37 | macos-v0.1.37 | beta-served-verified | PDF로 내보내기 · 자동 승인 개선 |
| 2026-09-26T12:40:13.586Z | macos | stable | 0.1.37 | macos-v0.1.37 | stable-served-verified |  |
| 2026-09-26T12:47:20.322Z | macos | ota | 0.1.37+ota1 | - | ota-served-verified | 열기 화면 없이 바로 작업 화면으로 |
| 2026-09-26T13:00:25.580Z | macos | ota | 0.1.37+ota2 | - | ota-served-verified | 턴 비용 기록 정확하게 |
| 2026-09-26T13:09:55.619Z | macos | ota | 0.1.37+ota3 | - | ota-served-verified | 턴마다 한도 사용량 표시 |
| 2026-09-26T13:24:12.543Z | macos | ota | 0.1.37+ota4 | - | ota-served-verified | 고른 사진 AI로 먼저 · 대체하면 알려줌 |
| 2026-09-26T13:53:41.682Z | macos | beta | 0.1.38 | macos-v0.1.38 | beta-served-verified | Gemini 한도 때 다른 Google 계정으로 |
| 2026-09-26T13:54:52.788Z | macos | stable | 0.1.38 | macos-v0.1.38 | stable-served-verified |  |
| 2026-09-27T05:47:43.226Z | macos | ota | 0.1.38+ota1 | - | ota-served-verified | AI 지시문 영어로 |
| 2026-09-27T06:31:23.132Z | macos | ota | 0.1.38+ota2 | - | ota-served-verified | 새 지침 받기(슬라이드 리워드) |
| 2026-09-27T06:38:47.592Z | macos | ota | 0.1.38+ota3 | - | ota-served-verified | ChatGPT(Codex) 실행 오류 수정 |
| 2026-09-27T07:18:57.636Z | macos | ota | 0.1.38+ota4 | - | ota-served-verified | 시작 못 한 요청 이어받기 |
| 2026-09-27T07:38:24.446Z | macos | ota | 0.1.38+ota5 | - | ota-served-verified | Codex 토큰 계산·검증 Chrome 오류 수정 |
| 2026-09-27T09:07:53.848Z | macos | beta | 0.1.39 | macos-v0.1.39 | beta-served-verified | ChatGPT 사진: 권한 창(구글 드라이브·문서·오디오) 없이 앱이 직접 사진을 가져와요 |
| 2026-09-27T09:09:12.621Z | macos | stable | 0.1.39 | macos-v0.1.39 | stable-served-verified |  |
| 2026-09-27T09:30:59.326Z | macos | ota | 0.1.39+ota1 | - | ota-served-verified | 사진 버전 고르기가 AI 없이 바로 바뀌어요 |
| 2026-09-27T09:50:11.727Z | macos | ota | 0.1.39+ota2 | - | ota-served-verified | 토큰 절약: 사진은 앱이 만들고 넣어요 · 바뀐 페이지만 확인 · 지침 가볍게 |
| 2026-09-27T10:10:17.028Z | macos | ota | 0.1.39+ota3 | - | ota-served-verified | ChatGPT 사진이 바로 끊기던 문제 수정 |
| 2026-09-27T10:16:52.315Z | macos | ota | 0.1.39+ota4 | - | ota-served-verified | 버전에 화면 번호까지 보여요 |
| 2026-09-27T10:26:09.955Z | macos | ota | 0.1.39+ota5 | - | ota-served-verified | 멈춤 카드: 'Gemini로 다시' |
| 2026-09-27T10:40:34.472Z | macos | beta | 0.1.40 | macos-v0.1.40 | beta-served-verified | 사진 작업: [사진 받기] · 새로고침 중 받은 메시지를 잃지 않아요 |
| 2026-09-27T10:42:15.530Z | macos | stable | 0.1.40 | macos-v0.1.40 | stable-served-verified |  |
| 2026-09-27T10:52:03.124Z | macos | ota | 0.1.40+ota1 | - | ota-served-verified | Gemini 한도면 ChatGPT로 이어서 |
| 2026-09-27T11:02:35.018Z | macos | beta | 0.1.41 | macos-v0.1.41 | beta-served-verified | 요청 하나 = 버전 하나 · 실패하면 원래대로 · [이 버전으로] |
| 2026-09-27T11:03:45.843Z | macos | stable | 0.1.41 | macos-v0.1.41 | stable-served-verified |  |
| 2026-09-27T11:21:17.522Z | macos | ota | 0.1.41+ota1 | - | ota-served-verified | 사진 패널: 내 것 · 재고 · 새로 만들기 |
| 2026-09-27T11:23:59.241Z | macos | ota | 0.1.41+ota2 | - | ota-served-verified | 끝난 턴의 진행 카드가 멈춰요 |
| 2026-09-27T11:31:44.621Z | macos | ota | 0.1.41+ota3 | - | ota-served-verified | 리워드 절차 파일 위치 수정 |
| 2026-09-27T11:46:10.866Z | macos | ota | 0.1.41+ota4 | - | ota-served-verified | 검색 태그 · 리워드 사진 뒤 자동 제출 |
| 2026-09-27T12:06:41.264Z | macos | ota | 0.1.41+ota5 | - | ota-served-verified | 리워드 [제출하기] 버튼 |
| 2026-09-28T01:15:32.248Z | windows | beta | 0.1.41 | windows-v0.1.41 | beta-served-verified | unsigned · Windows 첫 베타 — 서명 없음(SmartScreen 경고 시 [추가 정보 → 실행]) |
| 2026-09-28T01:23:13.582Z | windows | stable | 0.1.41 | windows-v0.1.41 | stable-served-verified |  |
| 2026-09-28T03:38:32.793Z | windows | beta | 0.1.42 | windows-v0.1.42 | beta-served-verified | unsigned · Windows: 설치 직후 ChatGPT(Codex)·Gemini가 계속 '설치 필요'로 보이던 문제 수정(한글 사용자 폴더) |
| 2026-09-28T03:44:33.164Z | windows | stable | 0.1.42 | windows-v0.1.42 | stable-served-verified |  |
| 2026-09-28T06:52:01.550Z | windows | beta | 0.1.43 | windows-v0.1.43 | beta-served-verified | unsigned · Windows: [설치하기] 한 번으로 공식 설치가 진행돼요(ChatGPT·Gemini·Claude). 데스크톱 앱만 있을 때는 무엇을 더 설치하면 되는지 알려 줘요 |
| 2026-09-28T06:56:56.834Z | windows | beta | 0.1.44 | windows-v0.1.44 | beta-served-verified | unsigned · Windows: [설치하기] 원클릭 설치 · 데스크톱 앱만 있을 때 안내 · 설치·로그인 뒤 연결 탭 모델 선택이 비던 문제 수정 |
| 2026-09-28T06:58:24.544Z | windows | stable | 0.1.44 | windows-v0.1.44 | stable-served-verified |  |
| 2026-09-28T07:44:00.908Z | macos | beta | 0.1.44 | macos-v0.1.44 | beta-served-verified | CLI 한 번에 설치 · 사진 패널이 AI 줄의 모델·강도로 만들어요 |
| 2026-09-28T07:45:12.053Z | macos | stable | 0.1.44 | macos-v0.1.44 | stable-served-verified |  |
| 2026-09-28T07:50:54.096Z | macos | ota | 0.1.44+ota1 | - | ota-served-verified | 최신 버전 공개를 앱이 바로 |
| 2026-09-28T08:07:54.682Z | macos | ota | 0.1.44+ota2 | - | ota-served-verified | 브라우저에서 열기, 최신으로 공개가 정확한 버전을 공개 |
| 2026-09-28T08:21:15.951Z | windows | beta | 0.1.45 | windows-v0.1.45 | beta-served-verified | unsigned · Windows: 기본 PowerShell(5.1)에서도 ChatGPT(Codex) 원클릭 설치 · 미리보기 웹폰트 허용 |
| 2026-09-28T08:22:29.030Z | windows | stable | 0.1.45 | windows-v0.1.45 | stable-served-verified |  |
| 2026-09-28T08:50:33.504Z | macos | beta | 0.1.45 | macos-v0.1.45 | beta-served-verified | dynapse.ai 주소로 이전, 글꼴 패널, 리워드 교체 제출, 브라우저에서 열기, 웹폰트 미리보기 |
| 2026-09-28T08:53:10.951Z | macos | stable | 0.1.45 | macos-v0.1.45 | stable-served-verified |  |
| 2026-09-28T08:54:26.428Z | macos | ota | 0.1.45+ota1 | - | ota-served-verified | 덱 사진 합계, 빈 칸 채우기 |
| 2026-09-28T08:59:14.734Z | windows | beta | 0.1.46 | windows-v0.1.46 | beta-served-verified | unsigned · 새 주소 dynapse.ai로 연결 |
| 2026-09-28T09:01:10.137Z | windows | stable | 0.1.46 | windows-v0.1.46 | stable-served-verified |  |
| 2026-09-28T09:21:06.215Z | macos | beta | 0.1.46 | macos-v0.1.46 | beta-served-verified | 새 주소가 안 열리는 PC에서 옛 주소로 자동 전환(흰 창 해결) |
| 2026-09-28T09:23:49.773Z | macos | stable | 0.1.46 | macos-v0.1.46 | stable-served-verified |  |
| 2026-09-29T00:02:16.218Z | macos | beta | 0.1.47 | macos-v0.1.47 | beta-served-verified | 버전 보기 즉시(읽기만), 되돌리기만 새 버전 |
| 2026-09-29T00:03:25.300Z | macos | stable | 0.1.47 | macos-v0.1.47 | stable-served-verified |  |
| 2026-09-29T00:12:44.931Z | macos | ota | 0.1.47+ota1 | - | ota-served-verified | 대화로 고른 글꼴 기록 |
| 2026-09-29T00:23:30.652Z | macos | beta | 0.1.48 | macos-v0.1.48 | beta-served-verified | 내 PC 글꼴 찾기, 없는 글꼴 안내 |
| 2026-09-29T00:24:41.065Z | macos | stable | 0.1.48 | macos-v0.1.48 | stable-served-verified |  |
| 2026-09-29T00:30:51.244Z | windows | beta | 0.1.49 | windows-v0.1.49 | beta-served-verified | unsigned · 버전 보기, 내 PC 글꼴, dynapse.ai 연결 안정화 |
| 2026-09-29T00:32:22.163Z | windows | stable | 0.1.49 | windows-v0.1.49 | stable-served-verified |  |
| 2026-09-29T02:25:31.822Z | macos | beta | 0.1.49 | macos-v0.1.49 | beta-served-verified | 작업별 공유(포인트), 공유 켜면 바로 올리기 |
| 2026-09-29T02:31:43.551Z | macos | stable | 0.1.49 | macos-v0.1.49 | stable-served-verified |  |
| 2026-09-29T02:36:39.792Z | windows | beta | 0.1.50 | windows-v0.1.50 | beta-served-verified | unsigned · 작업 공유 켜기 반영 |
| 2026-09-29T02:37:54.890Z | windows | stable | 0.1.50 | windows-v0.1.50 | stable-served-verified |  |
| 2026-09-29T08:54:08.434Z | macos | beta | 0.1.51 | macos-v0.1.51 | beta-served-verified | 덱 사진 수정이 그 장표에만 적용 |
| 2026-09-29T08:55:19.314Z | macos | stable | 0.1.51 | macos-v0.1.51 | stable-served-verified |  |
| 2026-09-29T11:42:12.878Z | macos | ota | 0.1.51+ota1 | - | ota-served-verified | 서버 연결이 끊기면 주소를 다시 골라 자동 복구 |
| 2026-09-29T12:38:20.934Z | macos | ota | 0.1.51+ota2 | - | ota-served-verified | 카드뉴스 리워드 제출 |
| 2026-09-29T22:04:13.240Z | macos | ota | 0.1.51+ota3 | - | ota-served-verified | 받자마자 '받았어요', 준비 단계 표시, 레이아웃 자동 갱신 |
| 2026-09-29T23:31:42.298Z | windows | beta | 0.1.51 | windows-v0.1.51 | beta-served-verified | unsigned · Codex 설치가 막히면 기다렸다 이어서 · 브라우저 연결 확인 창이 앞에 · 사진 수정은 그 장표에만 · 카드뉴스 · 받자마자 '받았어요' |
| 2026-09-29T23:33:30.272Z | windows | stable | 0.1.51 | windows-v0.1.51 | stable-served-verified |  |
| 2026-09-30T09:41:02.975Z | macos | beta | 0.1.52 | macos-v0.1.52 | beta-served-verified | 사진 크래시 수정·자동 축소, 직접 수정 묶음, 공개 즉시, 작업 중단(■) |
| 2026-09-30T09:42:43.661Z | macos | stable | 0.1.52 | macos-v0.1.52 | stable-served-verified |  |
| 2026-09-30T09:46:15.600Z | windows | beta | 0.1.52 | windows-v0.1.52 | beta-served-verified | unsigned · 실행 중인 턴 멈추기, 직접 수정 모아서 저장, 공개 즉시 반영, 사진 자동 줄이기 |
| 2026-09-30T09:47:35.236Z | windows | stable | 0.1.52 | windows-v0.1.52 | stable-served-verified |  |
| 2026-09-30T10:11:47.341Z | macos | ota | 0.1.52+ota1 | - | ota-served-verified | 시간 분해, 사진 2장 동시, 글자만 고친 턴 빠르게 |
| 2026-09-30T10:25:36.683Z | macos | ota | 0.1.52+ota2 | - | ota-served-verified | #52 운영 지표 — 턴마다 메타 한 줄(시간·토큰·검사·사진·중단) |
| 2026-09-30T13:02:23.816Z | macos | beta | 0.1.53 | macos-v0.1.53 | beta-served-verified | #54 속도 — 답을 사진보다 먼저, 검사는 앱이 한 번(Chrome 하나), 글자만 고친 턴 검사 버그 수정 · #51 §2 부하 보고 사진 동시 수 |
| 2026-09-30T14:12:40.519Z | macos | stable | 0.1.53 | macos-v0.1.53 | stable-served-verified |  |
| 2026-09-30T14:42:56.753Z | macos | ota | 0.1.53+ota1 | - | ota-served-verified | #54 보정 1 — 덱 전 장 프리필 · 도구 시간 실측 |
| 2026-09-30T20:17:42.243Z | macos | ota | 0.1.53+ota2 | - | ota-served-verified | #55 검증 실패해도 되돌리지 않음 · #54 보정 2 프리필 파일별 · 준비 오류 표시 |
| 2026-09-30T21:52:38.219Z | macos | ota | 0.1.53+ota3 | - | ota-served-verified | #54 보정 3 — 리워드 마무리 안내 |
| 2026-09-30T23:34:14.717Z | macos | ota | 0.1.53+ota4 | - | ota-served-verified | 기본 강도 낮음 |
| 2026-10-01T07:35:45.265Z | macos | ota | 0.1.53+ota5 | - | ota-served-verified | #56 받기 결과 표시·재시도 |
| 2026-10-01T08:17:50.729Z | macos | ota | 0.1.53+ota6 | - | ota-served-verified | #58 웹폰트 주소 붙여넣기 (JS만 · 0.1.54 네이티브는 공증 대기) |
| 2026-10-01T08:36:07.532Z | macos | ota | 0.1.53+ota7 | - | ota-served-verified | #56 보정 1 가져온 덱 = 편집 턴 · 복제 · 매니저 글꼴 목록 |
| 2026-10-01T09:03:00.619Z | macos | ota | 0.1.53+ota8 | - | ota-served-verified | src 9d849c002 · #54 C8 모델별 프로세스 · #53 살아 있는 캔버스 · 속도 정리 · 글자 수정 자리 정확히 |
| 2026-10-01T09:07:48.364Z | macos | beta | 0.1.54 | macos-v0.1.54 | beta-served-verified | src 9d849c002 · #58 OS 글꼴 목록 · #54 C12 무거운 명령 메인 스레드 밖 · 크래시 심볼 · tokens.css 쓰기 |
| 2026-10-01T09:09:18.500Z | macos | stable | 0.1.54 | macos-v0.1.54 | stable-served-verified |  |
| 2026-10-01T23:32:58.857Z | windows | beta | 0.1.55 | windows-v0.1.55 | beta-served-verified | src afa4accc7 · unsigned · 답 먼저 · 사진은 뒤에, 작업 중 캔버스 실시간, 가져온 덱 열기 수정, PC 글꼴 전부 목록에(DirectWrite), 사진 동시 2는 부하 보고 |
| 2026-10-01T23:35:48.158Z | windows | stable | 0.1.55 | windows-v0.1.55 | stable-served-verified |  |
| 2026-10-02T02:11:00.001Z | macos | ota | 0.1.54+ota1 | - | ota-served-verified | src a2fbdad50 · #49-보정 1 재고에 공유 · #58 보정 1 (JS · 소스 a2fbdad) |
| 2026-10-02T02:49:24.196Z | macos | beta | 0.1.56 | macos-v0.1.56 | beta-served-verified | src ddea4b2b2 · #61 앱 창: 끌어놓기·새 탭 링크·다운로드·dynapse 링크·발표 전체화면·내보내기 결과 채팅·Dock 복귀·큰 파일 바이트 |
| 2026-10-02T02:50:40.151Z | macos | stable | 0.1.56 | macos-v0.1.56 | stable-served-verified |  |
| 2026-10-02T06:02:32.527Z | windows | beta | 0.1.56 | windows-v0.1.56 | beta-served-verified | src 87d9b7bf8 · unsigned · 앱 창에 파일 끌어놓기, 새 창 링크는 브라우저로, 받은 파일 탐색기에서 보기, 큰 파일 가져오기, 덱 사진 재고화 |
| 2026-10-02T06:03:55.174Z | windows | stable | 0.1.56 | windows-v0.1.56 | stable-served-verified |  |
| 2026-10-02T23:15:14.864Z | macos | ota | 0.1.56+ota1 | - | ota-served-verified | src 9f35fe88f · #62: 리워드 검사 --reward(빈 사진 칸·사진 칸 빼기) |
| 2026-10-03T01:42:13.841Z | macos | ota | 0.1.56+ota2 | - | ota-served-verified | src fd0d55e39 · #63: 사진 하루 상한을 서버(코호트) 값으로, 리워드 사진은 상한 밖 |
| 2026-10-03T05:44:23.322Z | macos | ota | 0.1.56+ota3 | - | ota-served-verified | src f189cbf4e · #62 보정 1: 제출 전 리워드 검사, 반려 카드 |
| 2026-10-03T06:01:17.528Z | macos | ota | 0.1.56+ota4 | - | ota-served-verified | src 3f19bace2 · 리워드 작업은 항상 리워드 규칙으로 검사 |
| 2026-10-03T06:35:23.162Z | macos | ota | 0.1.56+ota5 | - | ota-served-verified | src 54abc25e9 · #67 첫 화면 위치 한 줄 |
| 2026-10-03T07:52:20.329Z | windows | ota | 0.1.56+ota1 | - | ota-served-verified | src 54abc25e9 · #62 리워드 검사·반려 카드, #63 사진 하루 상한(서버 값), #67 첫 화면 위치 한 줄 |
| 2026-10-03T09:28:32.332Z | macos | beta | 0.1.57 | macos-v0.1.57 | beta-served-verified | src eca832cc0 · #70 문서 색인(PDF·Word·PPT·엑셀) |
| 2026-10-03T09:30:26.498Z | macos | stable | 0.1.57 | macos-v0.1.57 | stable-served-verified |  |
| 2026-10-03T09:59:43.149Z | macos | ota | 0.1.57+ota1 | - | ota-served-verified | src 01429c2e3 · 글자 없는 문서는 내 AI가 읽어 저장 |
| 2026-10-04T11:32:03.334Z | macos | ota | 0.1.57+ota2 | - | ota-served-verified | src 7519e0458 · 리워드 작업은 앱을 다시 켜도 리워드 규칙으로 검사 |
| 2026-10-04T12:04:05.921Z | windows | beta | 0.1.58 | windows-v0.1.58 | beta-served-verified | src b744c2496 · unsigned · 넣은 문서(PDF·Word·PPT·엑셀) 색인, PPTX·PNG 2배 내보내기, 리워드 검사 수정 |
| 2026-10-04T12:05:23.580Z | windows | stable | 0.1.58 | windows-v0.1.58 | stable-served-verified |  |
| 2026-10-04T12:06:23.519Z | macos | beta | 0.1.58 | macos-v0.1.58 | beta-served-verified | src a9719f1f5 · PPTX 가져오기(내용·표·그림)·PPTX 내보내기(편집 가능)·PNG 2배 · 리워드 검사 옵션 허용 |
| 2026-10-04T12:08:10.010Z | macos | stable | 0.1.58 | macos-v0.1.58 | stable-served-verified |  |
| 2026-10-04T12:17:34.522Z | macos | ota | 0.1.58+ota1 | - | ota-served-verified | src 45f3c6ef0 · 폰트 요청·긴 문서 요약을 Sonnet 보조 호출로(메인 세션 그대로) |
| 2026-10-04T12:35:08.454Z | macos | ota | 0.1.58+ota2 | - | ota-served-verified | src 22a3bfb8f · 보조 작업이 편집 AI를 따른다(ChatGPT 편집이면 Codex 가벼운 모델) |
| 2026-10-04T13:16:30.311Z | macos | ota | 0.1.58+ota3 | - | ota-served-verified | src d275512f9 · 연결·설치 실패 진단(요약 자동, 로그는 [보고하기]로) |
| 2026-10-04T13:39:16.866Z | windows | beta | 0.1.59 | windows-v0.1.59 | beta-served-verified | src 5bf72e6db · unsigned · 긴 문서 요약은 보조 호출로, 보조 작업이 편집 AI를 따름, 연결·설치 실패 진단 |
| 2026-10-04T13:40:36.518Z | windows | stable | 0.1.59 | windows-v0.1.59 | stable-served-verified |  |
| 2026-10-04T13:53:06.439Z | macos | beta | 0.1.59 | macos-v0.1.59 | beta-served-verified | src 30c8eaed5 · PPTX 왕복(글·사진 칸만 되돌리기) · 트레이 의견 보내기 · 진단 보고 · 문서 요약 보조 |
| 2026-10-04T13:54:36.091Z | macos | stable | 0.1.59 | macos-v0.1.59 | stable-served-verified |  |
| 2026-10-04T14:02:00.689Z | macos | ota | 0.1.59+ota1 | - | ota-served-verified | src 667102c18 · 번역 턴(글자 칸만, 서식 그대로) |
| 2026-10-04T23:16:55.696Z | macos | beta | 0.1.60 | macos-v0.1.60 | beta-served-verified | src 32a035c8d · GitHub·Vercel 계정 연결(배포 준비) · 내보낸 HTML에 이 덱 사용량 한 줄 |
| 2026-10-04T23:18:19.371Z | macos | stable | 0.1.60 | macos-v0.1.60 | stable-served-verified |  |
| 2026-10-04T23:21:26.170Z | windows | beta | 0.1.60 | windows-v0.1.60 | beta-served-verified | src 05c4594da · unsigned · GitHub·Vercel 계정 확인·로그인, 내보낸 HTML 레시피 줄, PPTX 왕복 편집, 내 사진 무드 톤, 트레이 의견 보내기 |
| 2026-10-04T23:22:46.952Z | windows | stable | 0.1.60 | windows-v0.1.60 | stable-served-verified |  |
| 2026-10-04T23:50:27.047Z | macos | ota | 0.1.60+ota1 | - | ota-served-verified | src 374b23813 · 직접 수정: 되돌리기·다시 하기 한 걸음씩, 칩 하나로 저장 |
| 2026-10-05T00:39:30.538Z | windows | ota | 0.1.60+ota1 | - | ota-served-verified | src 55f2e5109 · #78 보정 6: 편집 패널이 고른 요소에 맞춘 검사기, 다시 하기 |
| 2026-10-05T11:57:46.238Z | macos | ota | 0.1.60+ota2 | - | ota-served-verified | src 8b35c69f6 · 원고 그대로 모드 · 우리 회사 틀 적용 |
| 2026-10-05T21:59:40.219Z | macos | beta | 0.1.61 | macos-v0.1.61 | beta-served-verified | src 47519ae47 · PPTX 호환 보고·호환 세팅 · PDF·인스타·상세페이지 내보내기 |
| 2026-10-05T22:01:07.514Z | macos | stable | 0.1.61 | macos-v0.1.61 | stable-served-verified |  |
| 2026-10-06T12:15:28.499Z | macos | ota | 0.1.61+ota1 | - | ota-served-verified | src b0c5fde18 · 공개 실패 시 이유를 보여 줌 |
| 2026-10-06T12:37:02.596Z | macos | beta | 0.1.62 | macos-v0.1.62 | beta-served-verified | src 7c9ae1e68 · 내보낸 파일 이름을 작업 제목으로 · PPTX 안내 파일 하나로(다시 넣는 법 포함) |
| 2026-10-06T12:38:21.630Z | macos | stable | 0.1.62 | macos-v0.1.62 | stable-served-verified |  |
