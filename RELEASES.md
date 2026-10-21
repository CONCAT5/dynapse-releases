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
| 2026-10-06T21:42:40.246Z | macos | ota | 0.1.62+ota1 | - | ota-served-verified | src b72570f80 · 글 주소로 카드뉴스 · 다음 회차 · 내 사진 우선 |
| 2026-10-06T21:47:31.220Z | macos | ota | 0.1.62+ota2 | - | ota-served-verified | src 39efdaf96 · 원고 장 나누기 |
| 2026-10-07T07:04:53.194Z | windows | beta | 0.1.62 | windows-v0.1.62 | beta-served-verified | src 6920d3601 · unsigned · 내보낸 파일 이름 = 작업 제목, PPTX 안내 파일 하나, 인스타·상세페이지 내보내기, 글 주소로 카드뉴스, 원고 장 나누기 (git 작성자 미설정으로 6단계에서 멈춰 손으로 마무리) |
| 2026-10-07T07:06:33.812Z | windows | stable | 0.1.62 | windows-v0.1.62 | stable-served-verified |  |
| 2026-10-07T10:57:06.455Z | macos | ota | 0.1.62+ota3 | - | ota-served-verified | src 25b07adf2 · 글로 만들 때 사진 규칙 |
| 2026-10-07T11:00:45.531Z | macos | ota | 0.1.62+ota4 | - | ota-served-verified | src 25b07adf2 · 사진 없으면 사진 없음 배치 |
| 2026-10-07T11:44:01.485Z | macos | ota | 0.1.62+ota5 | - | ota-served-verified | src 5659bcf9a · 사진 반영 확인 |
| 2026-10-07T13:02:06.837Z | macos | ota | 0.1.62+ota6 | - | ota-served-verified | src 1b07da0f5 · 내 자료함 |
| 2026-10-07T13:24:27.428Z | macos | ota | 0.1.62+ota7 | - | ota-served-verified | src 2cc8bc99b · 자료함 연결·이어하기 |
| 2026-10-07T13:44:22.891Z | macos | ota | 0.1.62+ota8 | - | ota-served-verified | src 4dac70843 · 폴더: 목적별 묶음 — 여러 출처 기억, 쓰인 작업 기록, 초대받은 폴더 받기 |
| 2026-10-08T02:31:35.235Z | macos | ota | 0.1.62+ota9 | - | ota-served-verified | src 9455c5312 · 폴더 사진을 덱에 먼저 · 사진 인덱스(보이는 것·비율·맞는 칸) |
| 2026-10-08T02:47:45.204Z | macos | ota | 0.1.62+ota10 | - | ota-served-verified | src 5b8d15a8d · 레이아웃 등록부 · 새 레이아웃 14종을 작업 폴더에 |
| 2026-10-08T03:01:18.735Z | windows | ota | 0.1.62+ota1 | - | ota-served-verified | src 5b8d15a8d · 내 자료함·폴더(목적별 묶음), 폴더 사진을 덱에, 브랜드 저장, 사진 없으면 사진 없는 레이아웃, 새 레이아웃 14종 |
| 2026-10-08T03:08:46.940Z | macos | ota | 0.1.62+ota11 | - | ota-served-verified | src 2da495185 · 사진 실패 이유와 다른 AI로 다시 |
| 2026-10-08T03:33:22.351Z | macos | ota | 0.1.62+ota12 | - | ota-served-verified | src 83b1fefeb · 메시지의 블로그 주소도 앱이 열어 본문·사진까지 |
| 2026-10-08T03:37:19.415Z | macos | ota | 0.1.62+ota13 | - | ota-served-verified | src f9f2129e4 · 글을 먼저 읽고(Sonnet) 그 읽기로 만들기 |
| 2026-10-08T03:46:19.163Z | macos | ota | 0.1.62+ota14 | - | ota-served-verified | src 91b29c97b · 글 속 그림은 자르지 않고 통째로 |
| 2026-10-08T03:56:30.057Z | windows | ota | 0.1.62+ota2 | - | ota-served-verified | src 91b29c97b · 메시지 속 블로그 주소도 읽기, 글을 먼저 읽고 만들기, 글 속 그림은 통째로, 사진 채우기 실패 이유 표시 |
| 2026-10-08T06:13:06.183Z | macos | ota | 0.1.62+ota15 | - | ota-served-verified | src 3e7927e8a · 스타일 팩 14종 |
| 2026-10-08T08:29:14.675Z | windows | ota | 0.1.62+ota3 | - | ota-served-verified | src 3e7927e8a · 스타일 팩 14종 |
| 2026-10-09T06:37:37.349Z | macos | beta | 0.1.63 | macos-v0.1.63 | beta-served-verified | src 00420c413 · PDF 장 순서·카드 크기 · PPTX 번호 목록 · 글 가져오기 보안(#88) |
| 2026-10-09T07:18:37.812Z | macos | beta | 0.1.64 | macos-v0.1.64 | beta-served-verified | src e86b93aea · Drive 링크 바로 확인·연결 · ChatGPT(Codex) 연결 · PDF 순서·크기 · PPTX 번호 · 글 가져오기 보안 · 글 모으기 |
| 2026-10-09T07:20:16.401Z | macos | stable | 0.1.64 | macos-v0.1.64 | stable-served-verified |  |
| 2026-10-09T07:44:51.237Z | macos | ota | 0.1.64+ota1 | - | ota-served-verified | src f60047c03 · 승인한 명령이 건드린 폴더도 함께 열기 |
| 2026-10-09T09:01:31.914Z | macos | ota | 0.1.64+ota2 | - | ota-served-verified | src 7538e7605 · 작업에서도 내 Claude 커넥터(메일·캘린더 등) |
| 2026-10-09T09:59:48.803Z | macos | ota | 0.1.64+ota3 | - | ota-served-verified | src 9046d2d20 · 폴더 ↔ 작업 자료 양방향 |
| 2026-10-09T11:41:27.360Z | windows | beta | 0.1.64 | windows-v0.1.64 | beta-served-verified | src 689475ec0 · unsigned · 새 앱 아이콘, PDF 장 순서·카드 크기, PPTX 숫자 기호, 글 가져오기 안전장치, Drive·커넥터 연결, 폴더 자료 양방향 |
| 2026-10-09T11:43:17.892Z | windows | stable | 0.1.64 | windows-v0.1.64 | stable-served-verified |  |
| 2026-10-09T23:14:00.711Z | macos | ota | 0.1.64+ota4 | - | ota-served-verified | src 1da085f87 · 작업 상한 멈춤을 선택 카드로 · <img> 사진 칸 채우기 |
| 2026-10-09T23:18:48.800Z | macos | ota | 0.1.64+ota5 | - | ota-served-verified | src 483eef7e0 · 멈춘 이유 표시 · 단계 한도도 이어서 카드 |
| 2026-10-10T00:41:14.659Z | macos | ota | 0.1.64+ota6 | - | ota-served-verified | src cd08d808f · 앱 화면 공유 링크(Aside 등) 읽기 |
| 2026-10-10T21:11:15.068Z | macos | ota | 0.1.64+ota7 | - | ota-served-verified | src 862fdc2ea · 장이 쓰는 assets 사진도 동기화·복제 |
| 2026-10-11T07:14:12.219Z | windows | ota | 0.1.64+ota1 | - | ota-served-verified | src 862fdc2ea · 멈춘 턴은 이유 표시·[그래도 시작] 수정, 앱 화면 공유 링크(Aside 등) 읽기, 장이 쓰는 사진도 동기화 |
| 2026-10-11T07:26:49.627Z | macos | ota | 0.1.64+ota8 | - | ota-served-verified | src ca1c6eb56 · 턴 결과 종류 기록 |
| 2026-10-11T09:24:57.337Z | macos | ota | 0.1.64+ota9 | - | ota-served-verified | src 869c4824a · 장 점검 배지(대비) |
| 2026-10-11T09:42:57.085Z | macos | ota | 0.1.64+ota10 | - | ota-served-verified | src 0481b4ad7 · 한글 줄바꿈 묶기 |
| 2026-10-11T09:47:54.846Z | macos | ota | 0.1.64+ota11 | - | ota-served-verified | src bb11a1e38 · 숨긴 장은 내보내기에서 빼기 |
| 2026-10-11T09:56:02.620Z | macos | beta | 0.1.65 | macos-v0.1.65 | beta-served-verified | src 90edbd723 · 숨긴 장은 PDF·PNG·HTML 내보내기에서 빠져요 |
| 2026-10-11T10:00:23.260Z | windows | beta | 0.1.65 | windows-v0.1.65 | beta-served-verified | src a82159c51 · unsigned · 숨긴 장은 내보내기에서 빼기, 사진 위 글자 대비 점검, 한글 줄바꿈 묶기, 턴 결과 기록 |
| 2026-10-11T10:01:36.157Z | windows | stable | 0.1.65 | windows-v0.1.65 | stable-served-verified |  |
| 2026-10-11T11:13:54.199Z | macos | stable | 0.1.65 | macos-v0.1.65 | stable-served-verified |  |
| 2026-10-11T11:15:13.215Z | macos | ota | 0.1.65+ota1 | - | ota-served-verified | src 03cc827d3 · 사람이 끈 보정은 다시 넣지 않기 |
| 2026-10-11T11:15:17.186Z | windows | ota | 0.1.65+ota1 | - | ota-served-verified | src 03cc827d3 · #91 보정 1: 사람이 고른 것이 점검보다 우선(대비 경고 무시 표시) |
| 2026-10-12T04:40:37.208Z | macos | ota | 0.1.65+ota2 | - | ota-served-verified | src 038a68d48 · ChatGPT 모델 400 자동 재시도 |
| 2026-10-12T04:54:44.915Z | windows | ota | 0.1.65+ota2 | - | ota-served-verified | src 038a68d48 · #95 ChatGPT 사진: 계정이 못 쓰는 모델이면 모델 없이 다시, 내보내기 확인 카드 버튼 수정 |
| 2026-10-12T12:28:16.508Z | macos | ota | 0.1.65+ota3 | - | ota-served-verified | src 4d8b4da24 · 장 순서·쪽번호를 앱이 정리 |
| 2026-10-12T12:44:52.106Z | windows | ota | 0.1.65+ota3 | - | ota-served-verified | src 599073aed · #97 장 순서는 앱이 정리(턴마다 pages.json) |
| 2026-10-12T12:51:20.163Z | macos | ota | 0.1.65+ota4 | - | ota-served-verified | src 39287bc8e · 턴 끝에 AI가 덱 그림을 보고 고침(검토 꼼꼼히) |
| 2026-10-12T13:12:05.756Z | macos | ota | 0.1.65+ota5 | - | ota-served-verified | src 48decef33 · 복제 시 장 순서·숨김·글꼴 유지 |
| 2026-10-12T13:28:35.640Z | macos | ota | 0.1.65+ota6 | - | ota-served-verified | src f4bbc6d92 · PDF 파일 이름·넘친 글자 검사 |
| 2026-10-12T13:48:28.212Z | windows | ota | 0.1.65+ota4 | - | ota-served-verified | src f4bbc6d92 · 턴 끝에 AI가 결과 그림을 보고 고침, 복제 시 장 순서·숨김·글꼴 유지, PDF 파일 이름·넘친 글자 검사 |
| 2026-10-12T16:27:20.768Z | macos | ota | 0.1.65+ota7 | - | ota-served-verified | src fe837494d · 요청 범위(칸·장·덱)·사진 활용 |
| 2026-10-12T22:36:16.383Z | macos | ota | 0.1.65+ota8 | - | ota-served-verified | src b82d2d2a6 · 직접 고친 글자 저장 보장·줄바꿈 |
| 2026-10-12T22:48:56.258Z | macos | ota | 0.1.65+ota9 | - | ota-served-verified | src b1ebba554 · 시각화(차트·아이콘·페르소나) |
| 2026-10-12T23:05:38.421Z | macos | beta | 0.1.66 | macos-v0.1.66 | beta-served-verified | src 7cb4a13eb · 언어판(한 작업 안에 영어판)·시각화·검토 |
| 2026-10-13T00:14:07.744Z | macos | beta | 0.1.67 | macos-v0.1.67 | beta-served-verified | src 3e93145cb · Windows 설치 TLS·ChatGPT 사진 모델 재시도·연결 문구 |
| 2026-10-13T00:29:34.188Z | windows | beta | 0.1.67 | windows-v0.1.67 | beta-served-verified | src 20f05a003 · unsigned · 설치 TLS 1.2·curl 폴백, ChatGPT 사진 재시도, 언어판(영어판 등), 요청 범위별 권한, 직접 고친 글자 보존, 차트는 앱이 그림 |
| 2026-10-13T00:31:17.696Z | windows | stable | 0.1.67 | windows-v0.1.67 | stable-served-verified |  |
| 2026-10-13T00:37:04.585Z | macos | beta | 0.1.68 | macos-v0.1.68 | beta-served-verified | src b0ff47da6 · 사진 턴 기본 모델·팀원 요청·연결 안내 |
| 2026-10-13T01:43:56.515Z | macos | beta | 0.1.69 | macos-v0.1.69 | beta-served-verified | src cc890e37d · 장 삭제·⌘Z 복원 |
| 2026-10-13T01:51:48.822Z | windows | beta | 0.1.68 | windows-v0.1.68 | beta-served-verified | src b0ff47da6 · unsigned · 사진 생성이 /connect에서 고른 모델을 씀(작업에서 안 고르면) |
| 2026-10-13T01:53:35.400Z | windows | stable | 0.1.68 | windows-v0.1.68 | stable-served-verified |  |
| 2026-10-13T03:34:33.548Z | macos | beta | 0.1.70 | macos-v0.1.70 | beta-served-verified | src 739a0341a · 발표용 움직임 |
| 2026-10-13T03:40:04.403Z | macos | stable | 0.1.70 | macos-v0.1.70 | stable-served-verified |  |
| 2026-10-13T04:12:24.665Z | windows | beta | 0.1.70 | windows-v0.1.70 | beta-served-verified | src 83611220c · unsigned · 캔버스에서 장 삭제·⌘Z 복원, 발표 모션(덱 만들 때 고름), 도형을 가로지르는 글자 검사, 복제는 보이는 덱 그대로 |
| 2026-10-13T04:13:36.127Z | windows | stable | 0.1.70 | windows-v0.1.70 | stable-served-verified |  |
| 2026-10-13T04:20:25.253Z | macos | ota | 0.1.70+ota1 | - | ota-served-verified | src 83611220c · 복제 시 보이는 덱 그대로·서버 사본 매 턴 |
| 2026-10-13T10:16:57.333Z | macos | ota | 0.1.70+ota2 | - | ota-served-verified | src bc59ed465 · 실제 모델 표시·첫 턴 글꼴 후보 |
| 2026-10-13T10:36:24.020Z | macos | ota | 0.1.70+ota3 | - | ota-served-verified | src 2119ec1c3 · 앱 창 로그인이 풀리면 자동으로 다시 이어 붙임 |
| 2026-10-13T10:54:04.119Z | macos | ota | 0.1.70+ota4 | - | ota-served-verified | src 716f2842b · 한가할 때 서버 연결을 줄여 DB를 쉬게 함 · 손대면 바로 다시 연결 |
| 2026-10-13T11:29:59.655Z | macos | ota | 0.1.70+ota5 | - | ota-served-verified | src 7e9741cfb · 플립북 PDF(표시한 자리만 중간 장) · 자유 레이아웃 검사 이름 |
| 2026-10-13T11:33:53.041Z | windows | ota | 0.1.70+ota1 | - | ota-served-verified | src 4ac60387f · 실제 도는 모델 표시(기본 · 모델), 앱 창 로그인 자동 복구, DB 쉬게 하기, 플립북 PDF는 표시한 곳만, 리워드 덱 자유 배치 |
| 2026-10-13T11:38:03.747Z | macos | ota | 0.1.70+ota6 | - | ota-served-verified | src f0f153cc2 · 위치 참조: ~/ 경로 인식 |
| 2026-10-13T12:07:00.222Z | macos | ota | 0.1.70+ota7 | - | ota-served-verified | src fedfe4ff1 · 서버 연결 비용 줄이기 · 같은 PC 메시지 바로 받기 |
| 2026-10-13T12:12:42.127Z | macos | ota | 0.1.70+ota8 | - | ota-served-verified | src 1567a11d6 · 실패 보고 묶어 보내기 |
| 2026-10-13T12:26:05.753Z | macos | ota | 0.1.70+ota9 | - | ota-served-verified | src 2a2d303ff · 리워드 검증 실패해도 만든 장 보이기 |
| 2026-10-13T13:09:01.108Z | macos | beta | 0.1.71 | macos-v0.1.71 | beta-served-verified | src d7c881b7c · 구독 AI 없이 이 PC에서 덱 글과 사진을 만드는 이 PC 엔진 · 플립북 PDF · 영어판 내보내기 고침 |
| 2026-10-13T13:12:48.315Z | macos | stable | 0.1.71 | macos-v0.1.71 | stable-served-verified |  |
| 2026-10-13T13:20:38.025Z | windows | beta | 0.1.72 | windows-v0.1.72 | beta-served-verified | src d1125be04 · unsigned · 이 PC 엔진(구독 없이) Windows 예외 처리: NVIDIA 찾기, 종량제 확인, 백신 격리 안내, 사용 중 파일, 드라이버·메모리 오류; 연결 탭 이 PC 칩 문구 수정 |
| 2026-10-13T13:22:30.506Z | windows | stable | 0.1.72 | windows-v0.1.72 | stable-served-verified |  |
| 2026-10-13T13:25:03.331Z | macos | beta | 0.1.72 | macos-v0.1.72 | beta-served-verified | src 6fe820f7c · 이 PC 엔진 예외 처리 보강 · 이야기 덱 스토리보드 |
| 2026-10-13T13:27:53.180Z | macos | stable | 0.1.72 | macos-v0.1.72 | stable-served-verified |  |
| 2026-10-13T13:29:15.521Z | macos | ota | 0.1.72+ota1 | - | ota-served-verified | src f051e60d8 · 자동 조치 받기 · 엔진 받기 실패 보고 |
| 2026-10-13T13:31:56.886Z | windows | ota | 0.1.72+ota1 | - | ota-served-verified | src f051e60d8 · 자동 보고·규칙 처리(#116), 이야기 플립북 검사(#111) |
| 2026-10-13T13:49:29.810Z | macos | beta | 0.1.73 | macos-v0.1.73 | beta-served-verified | src a90c04304 · 자유 배치 카드 PDF 크기 고침 |
| 2026-10-13T13:51:13.181Z | macos | stable | 0.1.73 | macos-v0.1.73 | stable-served-verified |  |
| 2026-10-13T14:20:06.154Z | macos | ota | 0.1.73+ota1 | - | ota-served-verified | src 3a5164950 · 졸라맨 플립북(#117): 작업 지시에 플립북 설명서 포함 |
| 2026-10-13T19:03:14.672Z | macos | ota | 0.1.73+ota2 | - | ota-served-verified | src 142abef36 · 연속 레이아웃 검사 수치를 운영 지표로 |
| 2026-10-13T23:41:43.479Z | windows | beta | 0.1.73 | windows-v0.1.73 | beta-served-verified | src 5eda3e363 · unsigned · 자유 장 카드 크기로 내보내기, 차트 크기 보정, 모션 재생 수정, 이 PC 엔진이 장·덱 요청도 처리, 이야기 덱 연속 배치 |
| 2026-10-13T23:45:12.158Z | windows | stable | 0.1.73 | windows-v0.1.73 | stable-served-verified |  |
| 2026-10-13T23:55:19.573Z | macos | ota | 0.1.73+ota3 | - | ota-served-verified | src a4848ac78 · 이 PC 엔진이 배치·장 수 바꾸기도 단계로 나눠 처리 |
| 2026-10-14T00:01:06.882Z | macos | ota | 0.1.73+ota4 | - | ota-served-verified | src 8ab41d782 · 리워드 제출: 장 수만큼 파일을 올리도록(12장 덱 5/13 오류) |
| 2026-10-14T00:18:04.414Z | macos | ota | 0.1.73+ota5 | - | ota-served-verified | src 710327463 · 형태 판단 질문·예시, 이 PC 엔진이 새 그림 형태도 채움 |
| 2026-10-14T00:24:52.794Z | macos | ota | 0.1.73+ota6 | - | ota-served-verified | src 69aef3998 · 검토에 레퍼런스 본보기 2장 + 피할 예 1장 |
| 2026-10-14T00:40:32.264Z | windows | beta | 0.1.74 | windows-v0.1.74 | beta-served-verified | src 4f215b222 · unsigned · 이 PC 엔진 Windows: Intel·AMD GPU(Vulkan) 탐지, 사진 설명의 ... 수정 |
| 2026-10-14T00:42:01.518Z | windows | stable | 0.1.74 | windows-v0.1.74 | stable-served-verified |  |
| 2026-10-14T01:14:02.314Z | macos | beta | 0.1.74 | macos-v0.1.74 | beta-served-verified | src 8c29892af · 앱이 장마다 모양을 고르고(후보·적합도→시드 샘플), 원경·중경·근경 콘티, 글자 3단계·강조색 하나·모티프 고정, 다른 모양 보기, 새 블록·그림, 이 PC 엔진 큰 수정 |
| 2026-10-14T01:15:53.621Z | macos | stable | 0.1.74 | macos-v0.1.74 | stable-served-verified |  |
| 2026-10-14T01:17:13.195Z | windows | ota | 0.1.74+ota1 | - | ota-served-verified | src 15d764593 · 이 PC 글: 숫자·단위 붙임(조사 뒤도), 잘린 문장 다시 묻고 깔끔히 끊기 |
| 2026-10-14T01:57:09.096Z | macos | ota | 0.1.74+ota1 | - | ota-served-verified | src b7da03f0d · 다른 모양 보기: 실제 미리보기 2~3개를 보고 고른 뒤에만 바뀜 |
| 2026-10-14T02:10:20.671Z | macos | ota | 0.1.74+ota2 | - | ota-served-verified | src 32b2ede51 · 리워드 턴 예산 8분·검사 2회·땜질 금지·구간 시간 |
| 2026-10-14T02:19:22.327Z | macos | ota | 0.1.74+ota3 | - | ota-served-verified | src a0c5a263f · 작게 나온 장 키우기·작은 글자 점검, 차트 실제 크기로 |
| 2026-10-14T02:28:42.724Z | macos | ota | 0.1.74+ota4 | - | ota-served-verified | src ba9c62c59 · 차트 자동 다시 그리기·차트 칩 |
| 2026-10-14T02:34:02.429Z | macos | ota | 0.1.74+ota5 | - | ota-served-verified | src de7320256 · AI 말투 검사·자동 다듬기 |
| 2026-10-14T02:41:14.744Z | windows | ota | 0.1.74+ota2 | - | ota-served-verified | src c5f8af7c9 · 다른 모양 보기(썸네일로 고르기), 빈 공간 [키우기], 차트 다시 그리기·손잡이, 턴 예산, AI 말투 다듬기 |
| 2026-10-14T02:52:37.368Z | macos | ota | 0.1.74+ota6 | - | ota-served-verified | src 772dc36e6 · 핫픽스: 차트 칸 실제 크기로 그리기 |
| 2026-10-14T03:00:02.275Z | macos | ota | 0.1.74+ota7 | - | ota-served-verified | src 7814e99d3 · 승인 카드 없이 앱 몫 경로 읽기는 거부로 넘어가요 · 리워드 턴엔 승인 카드를 띄우지 않아요 |
| 2026-10-14T03:21:17.744Z | macos | ota | 0.1.74+ota8 | - | ota-served-verified | src 41c37d10b · 가벼운 수정이 토큰 상한으로 바로 끊기지 않아요 · 상한에 닿으면 여기까지 저장하고 이어서 할 수 있어요 |
| 2026-10-14T03:24:03.040Z | macos | ota | 0.1.74+ota9 | - | ota-served-verified | src ee5a24021 · 📍로 고른 곳에 항목 더·다른 배열을 말하면 그 장 전체로 바로 고쳐요 · 범위 때문에 거절한 답은 장 범위로 한 번 더 해요 |
| 2026-10-14T03:29:28.232Z | windows | ota | 0.1.74+ota3 | - | ota-served-verified | src 554d6f994 · 턴 등급별 예산(가벼운 턴 토큰 상한 수정), 마지막 줄 외톨이 단어 줄 맞춤, 차트 상자 실측, 핀은 대상·요청이 범위 |
| 2026-10-14T03:31:32.282Z | macos | ota | 0.1.74+ota10 | - | ota-served-verified | src df2945e59 · 작업을 열면 마지막 줄에 한 단어만 넘어간 줄을 바로 맞춰요 |
| 2026-10-14T03:39:59.609Z | macos | ota | 0.1.74+ota11 | - | ota-served-verified | src f7ebaf1da · 차트 범례·끝 숫자가 겹치거나 잘리지 않아요 · 차트 칩에 '좌우 꽉'이 생겼어요 |
| 2026-10-14T04:01:06.369Z | macos | ota | 0.1.74+ota12 | - | ota-served-verified | src cc8f7d385 · 직접 정한 장 순서를 AI가 바꾸지 않아요 · 다른 모양 보기에 빈 틀이 나오지 않아요 |
| 2026-10-14T04:05:22.577Z | windows | ota | 0.1.74+ota4 | - | ota-served-verified | src 1e9419a80 · 장 순서 잠금, 다른 모양 보기에 실제 내용, 차트 범례·라벨 맞춤·좌우 꽉, 기존 덱도 줄 맞춤 |
| 2026-10-14T04:25:11.515Z | macos | ota | 0.1.74+ota13 | - | ota-served-verified | src e47935b2f · 가려지거나 잘리거나 겹친 글자를 앱이 몇 px 조정해 바로 맞춰요 |
| 2026-10-14T05:01:26.742Z | macos | ota | 0.1.74+ota14 | - | ota-served-verified | src d6f983394 · '한국어판 만들어 줘'나 ··· 메뉴로 언어판을 바로 만들어요 |
| 2026-10-14T06:33:34.851Z | windows | ota | 0.1.74+ota5 | - | ota-served-verified | src 5ad469bba · 가려진·잘린·겹친 글자 자동 맞춤, 언어판은 어떤 말로든···· 메뉴에서, 함께 하는 사람은 최신 버전으로 |
| 2026-10-14T06:35:12.504Z | macos | ota | 0.1.74+ota15 | - | ota-served-verified | src 5ad469bba · 함께 쓰는 작업을 열면 다른 사람이 올린 최신 판으로 맞춰요 |
| 2026-10-14T07:00:52.205Z | macos | ota | 0.1.74+ota16 | - | ota-served-verified | src 752376928 · 함께 쓰는 작업을 자동으로 받거나 올리지 않아요 · 새 판 카드에서 가져오기나 서버 판으로 덮어쓰기를 골라요 |
| 2026-10-14T07:02:32.076Z | windows | ota | 0.1.74+ota6 | - | ota-served-verified | src 752376928 · 긴급: 기기가 스스로 받거나 올리지 않음 — 새 버전 카드에서 받기(깨끗할 때만) 또는 버리기 |
| 2026-10-14T07:12:47.918Z | macos | ota | 0.1.74+ota17 | - | ota-served-verified | src 702b38356 · 올리는 중에는 받지 않고, 원본 PC에는 새 판 카드가 뜨지 않아요 |
| 2026-10-14T07:27:39.098Z | macos | ota | 0.1.74+ota18 | - | ota-served-verified | src a95a7dc43 · 단계 차트 글이 잘리지 않고 두 줄로 · 함께 쓰는 작업에서 멤버 PC는 열 때 자동 저장을 하지 않아요 |
| 2026-10-14T07:31:24.150Z | macos | ota | 0.1.74+ota19 | - | ota-served-verified | src aec5f1cd8 · 언어판 토글이 원문 언어로 보여요(EN · 한) |
| 2026-10-14T07:34:52.226Z | macos | ota | 0.1.74+ota20 | - | ota-served-verified | src e4d974cd1 · 언어판에서 차트 글도 번역돼요 |
| 2026-10-14T07:42:04.463Z | windows | ota | 0.1.74+ota7 | - | ota-served-verified | src 97ec7d3d4 · 긴급: 작업당 올리기 한 번·올리는 중엔 받기/버리기 없음, 함께 하는 사람 기기는 열 때 자동 커밋 없음, 언어판 차트 글자·원문 언어 표시·한국어판 교정 반영, 단계 아이콘 크기 |
| 2026-10-14T07:43:33.558Z | macos | ota | 0.1.74+ota21 | - | ota-served-verified | src 97ec7d3d4 · 한국어판 번역이 용어집·원칙을 따르고, 언어판에서 직접 고친 표현을 기억해요 |
| 2026-10-14T07:48:49.054Z | macos | ota | 0.1.74+ota22 | - | ota-served-verified | src c395fd965 · 언어판을 만든 뒤 전체를 한 번 검사하고 다듬어요 |
| 2026-10-14T10:45:18.067Z | macos | ota | 0.1.74+ota23 | - | ota-served-verified | src 06387cbb8 · 사진이 박힌 큰 장도 올라가요 · 못 올리면 이유를 보여 줘요 |
| 2026-10-14T10:50:42.483Z | macos | ota | 0.1.74+ota24 | - | ota-served-verified | src 397a999aa · 공유를 끈 작업은 올리기 실패로 뜨지 않아요 · 짚은 자리가 다음 메시지에도 이어져요 |
| 2026-10-14T12:16:52.646Z | macos | ota | 0.1.74+ota25 | - | ota-served-verified | src ae31a205b · 여러 장이 든 HTML 하나를 가져오면 장마다 나눠요 |
| 2026-10-14T12:41:23.158Z | macos | ota | 0.1.74+ota26 | - | ota-served-verified | src 932f5176b · 리워드 제작에 본보기 그림을 함께 보여 줘요 |
| 2026-10-14T12:51:48.250Z | macos | ota | 0.1.74+ota27 | - | ota-served-verified | src 1b65c530d · 덱을 만들 때 먼저 이 덱이 무엇에 관한 것인지(프레임)를 정하고, 카드로 보여 줘요 |
| 2026-10-15T00:04:15.447Z | macos | ota | 0.1.74+ota28 | - | ota-served-verified | src f3e8ad855 · 다른 모양 보기에 빈 대안이 나오지 않아요 |
| 2026-10-15T00:11:41.268Z | macos | ota | 0.1.74+ota29 | - | ota-served-verified | src acc0e9ace · 이번 요청이 만든 오류만 실패로 보여요 · 손대지 않은 장을 매번 다시 쓰지 않아요 |
| 2026-10-15T04:51:13.591Z | macos | ota | 0.1.74+ota30 | - | ota-served-verified | src 967af907a · 리워드 제출 전에 남은 오류를 한 번 고치고 제출해요 |
| 2026-10-15T05:30:15.034Z | macos | ota | 0.1.74+ota31 | - | ota-served-verified | src 9f32e4624 · 장 위 줄 정리(다른 모양···· 셋만) · 다른 모양 미리 만들기와 제자리 미리보기 · 차트·표는 말로 바로 바꾸기 |
| 2026-10-15T06:04:58.789Z | macos | ota | 0.1.74+ota32 | - | ota-served-verified | src 20d2bab84 · 표지·섹션·마무리 장의 다른 모양(표지 8 · 섹션 3 · 마무리 4) |
| 2026-10-15T06:18:18.513Z | macos | ota | 0.1.74+ota33 | - | ota-served-verified | src 740c15918 · 마무리는 표지와 짝(같은 자리·색 반전·사진/색면·다른 크롭), 섹션은 표지 축소·진행 목록·이름만 |
| 2026-10-15T07:02:16.000Z | macos | ota | 0.1.74+ota34 | - | ota-served-verified | src 6731571f1 · 작업실 위쪽 줄 정리 · 오래된 진행 표시 지움 · 4MB 넘는 사진 앱이 먼저 줄임 · 함께 하는 사람이 지금 하는 일 |
| 2026-10-15T07:17:51.876Z | macos | ota | 0.1.74+ota35 | - | ota-served-verified | src 759419ab3 · 사진 장의 다른 모양(사진 하나 크게·비대칭·사진 띠·한 장 전면·지도 핀), 사진 설명은 사진과 함께 |
| 2026-10-15T07:42:08.961Z | macos | ota | 0.1.74+ota36 | - | ota-served-verified | src c95b89b3a · 다른 모양: 뻔한 대안 거르기·서로 다른 종류 셋·다르게 보기 한 칸 · 막힌 명령 다시 실행시키지 않음 |
| 2026-10-15T07:53:12.646Z | macos | ota | 0.1.74+ota37 | - | ota-served-verified | src 2150e0273 · 리워드: 발주가 정한 모양을 계획에 먼저 적고, 제출 전 자동 고침 최대 2회 |
| 2026-10-15T08:00:36.391Z | macos | ota | 0.1.74+ota38 | - | ota-served-verified | src c71c5ea85 · 표지 사진에서 강조색 · 숫자 모양으로 장 모양 고르기 |
| 2026-10-15T08:17:24.561Z | macos | ota | 0.1.74+ota39 | - | ota-served-verified | src 3d8852ce4 · 빈 작업에 규칙 문서가 장처럼 뜨던 것 고침 · 빈 규칙 파일 만들지 않음 |
| 2026-10-15T08:27:45.263Z | macos | ota | 0.1.74+ota40 | - | ota-served-verified | src 94ecf53cb · 덱마다 글꼴 짝 · 글꼴 바꿔줘 · 굵게/가늘게 |
| 2026-10-15T08:52:52.670Z | macos | ota | 0.1.74+ota41 | - | ota-served-verified | src 27f4147fd · PDF를 넣으면 페이지마다 원본 그대로의 장으로 불러옵니다(글은 바로 고치고, 그림은 사진처럼 바꿀 수 있어요) |
| 2026-10-15T09:04:34.533Z | macos | ota | 0.1.74+ota42 | - | ota-served-verified | src ee1727331 · 새로 만들기·가져오기가 열어 둔 폴더 안에 생겨요 · 하위 폴더 사진이 깨져 보이던 문제 · 장 추가 요청이 멈추던 문제 |
| 2026-10-15T09:11:49.365Z | macos | ota | 0.1.74+ota43 | - | ota-served-verified | src f00af3f50 · 큰 사진은 올릴 때 자동으로 줄여요 · 발표 움직임에서 제목·본문은 움직이지 않아요 |
| 2026-10-15T09:20:19.726Z | macos | ota | 0.1.74+ota44 | - | ota-served-verified | src 32df2ee8b · 큰 사진·장은 올라갈 수 있게 앱이 맞춰요 · 큰 참고 문서는 이름으로 알려요 |
| 2026-10-15T10:04:27.626Z | macos | ota | 0.1.74+ota45 | - | ota-served-verified | src e37499d28 · CSS가 장에 글자로 찍히던 문제를 고쳐요 |
| 2026-10-15T14:05:51.712Z | windows | ota | 0.1.74+ota8 | - | ota-served-verified | src 0544f3c01 · PDF를 장으로 가져오기, 큰 사진 자동 줄이기(원본 보관), 장 다른 모양(역할별·차이 검사), 글꼴 쌍, 작업실 상단 정리, 장 추가 요청 처리, 턴 실패 범위 축소 |
| 2026-10-16T01:25:21.540Z | macos | ota | 0.1.74+ota46 | - | ota-served-verified | src 4a09f6f08 · 함께 하는 작업에서 멤버도 올리고, 서로 다른 장은 자동으로 합쳐요 · 새 판은 고치던 게 없으면 바로 받아요 |
| 2026-10-16T01:51:57.625Z | macos | beta | 0.1.75 | macos-v0.1.75 | beta-served-verified | src c57baa366 · 작업 화면이 흰 화면으로 멈추지 않게 첫 화면·다시 시도 · AI 설치를 창 없이 먼저 시도 · 설치 뒤 그 작업이 바로 열려요 · 사진 하위 폴더 · 차트 숫자 글꼴 |
| 2026-10-16T02:08:00.168Z | macos | stable | 0.1.75 | macos-v0.1.75 | stable-served-verified |  |
| 2026-10-16T02:09:02.973Z | windows | beta | 0.1.75 | windows-v0.1.75 | beta-served-verified | src 5ebb83dc2 · unsigned · AI 도구 조용히 설치(창 없이, 막히면 이식형 Node+npm), 시작 흰 화면 대신 첫 화면·다시 시도, 동기화 빨리감기·자동 합치기, 차트 숫자 글꼴, 사진 하위 폴더 |
| 2026-10-16T02:11:33.118Z | windows | stable | 0.1.75 | windows-v0.1.75 | stable-served-verified |  |
| 2026-10-16T02:17:41.219Z | macos | ota | 0.1.75+ota1 | - | ota-served-verified | src d736e90c8 · 묻는 카드 대신 바로 하고 되돌리기 · 길어진 작업은 알아서 이어서 |
| 2026-10-16T02:19:43.308Z | macos | ota | 0.1.75+ota2 | - | ota-served-verified | src 63df35981 · 짚은 자리에 짧은 말만 보내도 그 글로 바꿔요 · 어디냐고 되묻지 않아요 |
| 2026-10-16T02:30:43.129Z | macos | ota | 0.1.75+ota3 | - | ota-served-verified | src 0019e3d1c · 언어판을 보며 바꾼 사진이 그 장에도 바로 들어가요 |
| 2026-10-16T02:58:52.385Z | macos | ota | 0.1.75+ota4 | - | ota-served-verified | src 209653766 · 서버 판으로 맞출 때 내 변경은 보관해요 |
| 2026-10-16T03:12:03.492Z | macos | ota | 0.1.75+ota5 | - | ota-served-verified | src 87e7fe29b · 함께 하는 작업에서 고르라는 카드 없이 · 같은 장은 나중에 올린 판, 덮인 사람에게 [내 판으로] |
| 2026-10-16T03:52:55.973Z | macos | ota | 0.1.75+ota6 | - | ota-served-verified | src a2faecde2 · 언어판에서도 다른 모양을 고를 수 있어요 |
| 2026-10-16T03:58:01.285Z | macos | ota | 0.1.75+ota7 | - | ota-served-verified | src 52dfaffa1 · 언어판에서 키우기·차트 조절 · 검사가 못 돈 순간 장을 되돌리지 않아요 |
| 2026-10-16T04:08:47.665Z | macos | ota | 0.1.75+ota8 | - | ota-served-verified | src bb9462c4b · 장 순서 바꾸기 요청(예: 1~10번 재조정)이 다시 되돌려지지 않아요 · 바뀌면 '순서 바꿈 · N장 이동' · 장을 지운 뒤 언어판 쪽번호도 맞춰요 |
| 2026-10-16T04:22:13.164Z | macos | ota | 0.1.75+ota9 | - | ota-served-verified | src 97ff055dc · 4MB 넘는 참고 문서가 있어도 작업이 함께 쓰는 사람에게 올라가요(그 문서만 이 PC에 둬요) · 올리는 사이 장이 바뀌어도 다시 올려요 |
| 2026-10-16T04:36:46.868Z | windows | ota | 0.1.75+ota1 | - | ota-served-verified | src 97ff055dc · 확인 창 없이 내보내기·공개, 같은 장 충돌은 나중 버전으로(카드 없이), 큰 파일 하나가 올리기를 막지 않음, 순서 바꾸기 요청, 언어판 다른 모양·사진 구조 |
| 2026-10-16T05:47:32.300Z | windows | ota | 0.1.75+ota2 | - | ota-served-verified | src eda1c71e8 · 앱 안에서 이메일 코드로 Dynapse 로그인(온보딩 1단계), 같은 폴더 = 같은 디자인, 큰 덱(목차·묶음·검토), 묶음 끊기·다시 잇기, 연결 실패 안내 |
| 2026-10-16T05:50:25.407Z | macos | ota | 0.1.75+ota10 | - | ota-served-verified | src a83fe2645 · 덱 사진 색 통일·신뢰 장 사진 요청·카드뉴스 글꼴 · 장 묶음·빼기/다시 넣기·묶음만 복제/내보내기 · 큰 덱 개요·묶음 큐·찾기 검토 · 폴더 디자인 · 앱 안 이메일 코드 로그인 · 터미널 없는 AI 로그인 |
| 2026-10-16T05:54:42.977Z | macos | beta | 0.1.76 | macos-v0.1.76 | beta-served-verified | src 799e7cf74 · 작업 화면 감시·자동 다시 열기 · ⇧⌘R 처음부터 · 숨긴 화면 20분 뒤 닫기 · 터미널 없는 AI 로그인 · 앱 안 이메일 코드 로그인 |
| 2026-10-16T07:06:14.667Z | macos | beta | 0.1.77 | macos-v0.1.77 | beta-served-verified | src 516d613c3 · 작업 화면 감시·자동 다시 열기(멈춘 화면 복구 고침) · ⇧⌘R 처음부터 · 숨긴 화면 20분 뒤 닫기 · 터미널 없는 AI 로그인 · 앱 안 이메일 코드 로그인 · 배포 전 자가 점검 |
| 2026-10-16T07:15:00.545Z | macos | stable | 0.1.77 | macos-v0.1.77 | stable-served-verified |  |
| 2026-10-16T07:22:24.150Z | windows | beta | 0.1.77 | windows-v0.1.77 | beta-served-verified | src 516d613c3 · unsigned · AI 로그인 터미널 없이, 작업 창 멈춤 감시·자동 복구, 자가 점검 |
| 2026-10-16T07:24:57.958Z | windows | stable | 0.1.77 | windows-v0.1.77 | stable-served-verified |  |
| 2026-10-16T12:32:47.508Z | macos | beta | 0.1.78 | macos-v0.1.78 | beta-served-verified | src 1d4624abf · AI 연결 쉽게(편집·사진 두 줄, 하나면 충분) · 로그인 진행 표시·겹침 방지 · 회사망 프록시를 AI 프로그램에 넘김 · 회사 계정 사진 막힘 안내 |
| 2026-10-16T12:34:35.831Z | macos | stable | 0.1.78 | macos-v0.1.78 | stable-served-verified |  |
| 2026-10-16T12:47:20.443Z | macos | beta | 0.1.79 | macos-v0.1.79 | beta-served-verified | src f53f67c54 · 회사망 자동 맞춤(PAC·인증서) · 막히면 이 PC로 이어서 |
| 2026-10-16T12:49:11.260Z | macos | stable | 0.1.79 | macos-v0.1.79 | stable-served-verified |  |
| 2026-10-16T12:56:08.684Z | windows | beta | 0.1.79 | windows-v0.1.79 | beta-served-verified | src f53f67c54 · unsigned · 회사망에서 멈추지 않게(시스템 프록시·회사 보안 인증서를 AI 도구에), AI 연결 안내 쉽게, 화면 묶음 실패 시 되돌리기 |
| 2026-10-16T12:59:11.502Z | macos | ota | 0.1.79+ota1 | - | ota-served-verified | src 415196994 · 이미 로그인된 AI는 바로 시작 · AI 없으면 첫 요청에 ChatGPT 로그인이 바로 열리고 연결되면 그 요청이 저절로 · 한 번에 연결 · OTA 지킴이 |
| 2026-10-16T12:59:34.762Z | windows | stable | 0.1.79 | windows-v0.1.79 | stable-served-verified |  |
| 2026-10-16T13:19:04.644Z | windows | ota | 0.1.79+ota1 | - | ota-served-verified | src 245910fd3 · 이미 로그인된 Claude·ChatGPT는 첫 실행에 조용히 연결 |
| 2026-10-16T13:36:19.975Z | macos | ota | 0.1.79+ota2 | - | ota-served-verified | src eeab6c8ed · 디냅스 로그인 없이 첫 실행 · 초대 작업 [앱에서 열기] 한 번 · 새 PC는 계정이 쓰던 AI만 조용히 설치 · AI 줄에 편집·사진 역할 · 첫 대기 중 안내 세 줄 |
| 2026-10-16T13:44:57.399Z | windows | ota | 0.1.79+ota2 | - | ota-served-verified | src eeab6c8ed · #142 마무리: 끊김 없는 연결(이미 로그인된 AI 자동 연결 · Dynapse 로그인은 필요할 때) |
| 2026-10-16T14:16:22.962Z | macos | ota | 0.1.79+ota3 | - | ota-served-verified | src 418a87a49 · 장을 말없이 되돌리지 않음([턴 시작으로]) · 직접 고친 것은 자동 정리가 못 덮음 · 한국어판에서 누른 장 동작이 보고 있는 판에 · 경고는 장마다 3개 · 순서만 바꾸는 요청은 빠르게 |
| 2026-10-16T23:02:47.466Z | windows | ota | 0.1.79+ota3 | - | ota-served-verified | src 794102271 · 장 동작 한 입구, 앱이 고친 장의 새 오류는 되돌리지 않고 [턴 시작으로], 작업실 '내 PC' 칩·팀 공유/공개 기여 구분 |
| 2026-10-16T23:59:49.942Z | macos | ota | 0.1.79+ota4 | - | ota-served-verified | src 7523c0f5e · 새로 만들기 입력 하나·크기 알아서·A4로 바꿔줘 · 온보딩 문구 · AI 계정 없이 이 PC로 시작 · ChatGPT 하나로 사진까지 · 끊겨도 요청·올리기 보관 후 이어서 · 공개 기여 안내 |
| 2026-10-17T01:36:19.722Z | windows | ota | 0.1.79+ota4 | - | ota-served-verified | src a357a9c38 · 오프라인에서도 멈추지 않게(대기 요청·다시 보내기), 온보딩 문구 정리·계정 없이 이 PC 모델, 새 작업 한 칸 입력, 디자인 점검 추가 |
| 2026-10-17T01:39:29.519Z | macos | ota | 0.1.79+ota5 | - | ota-served-verified | src 9c82c0052 · 리워드 제출이 검사에서 멈추던 문제 — 빈 장은 다른 모양으로 채우고, 남으면 [그래도 제출] |
| 2026-10-17T04:25:18.491Z | macos | ota | 0.1.79+ota6 | - | ota-served-verified | src 77bc7688a · 웹에서 누른 동작이 설치 뒤 앱에서 그 덱으로 이어져요 · 설치 뒤 막히면 도움 한 줄 |
| 2026-10-17T04:29:33.674Z | windows | ota | 0.1.79+ota5 | - | ota-served-verified | src 77bc7688a · 이탈 없는 퍼널(단계별 기록·멈춘 단계 안내), 온보딩 보정 |
| 2026-10-17T06:00:18.449Z | macos | ota | 0.1.79+ota7 | - | ota-served-verified | src f475ffdf9 · 지시서를 덱으로 만들지 않아요 · 큰 덱은 한 번 확인 · 숫자 하나인 장도 다른 모양으로 바꿔요 |
| 2026-10-17T07:32:14.856Z | macos | beta | 0.1.80 | macos-v0.1.80 | beta-served-verified | src a98dfc81a · 인터넷이 없어도 이 PC 사본을 보고 발표·고쳐요 · AI가 고친 것도 ⌘Z로 · 지시서를 덱으로 만들지 않아요 |
| 2026-10-17T07:38:39.557Z | macos | stable | 0.1.80 | macos-v0.1.80 | stable-served-verified |  |
| 2026-10-17T08:06:59.585Z | windows | beta | 0.1.80 | windows-v0.1.80 | beta-served-verified | src c1d4613ec · unsigned · 오프라인 보기(사이트가 안 열려도 이 PC 사본으로 보기·발표·고치기), AI 턴도 되돌리기(Ctrl+Z), PPTX 제목 굵기 유지, 자가 점검이 사용자 턴을 끊지 않음 |
| 2026-10-17T08:08:39.005Z | windows | stable | 0.1.80 | windows-v0.1.80 | stable-served-verified |  |
| 2026-10-17T08:38:57.162Z | windows | ota | 0.1.80+ota1 | - | ota-served-verified | src b2874851f · 작업 위치 표시 문구 하나로('나만 보는 중'), 포인트는 생길 때만 표시 |
| 2026-10-17T10:29:38.733Z | macos | ota | 0.1.80+ota1 | - | ota-served-verified | src 9c752ff55 · 첫 덱 사진 칸을 비워 두지 않음 · 늦게 온 사진 뒤에서 교체(⌘Z) · 공개 사진 찾기 출처 줄 · 뒤에서 도는 일 한 줄 |
| 2026-10-17T10:47:05.864Z | macos | ota | 0.1.80+ota2 | - | ota-served-verified | src c00ae5deb · OTA 지킴이 고침 · 예전 건너뛰기 번호가 새 묶음을 막던 문제 |
| 2026-10-17T11:24:12.488Z | windows | ota | 0.1.80+ota2 | - | ota-served-verified | src e872c7807 · 덱 사진은 한 번에 만들어 빈 칸 없이, 뒤에서 하는 일 한곳에, 화면 묶음 보호 수정, 작은 글자 규칙 |
| 2026-10-17T11:46:27.119Z | macos | ota | 0.1.80+ota3 | - | ota-served-verified | src d14a941b6 · Gemini 편집 · 내 글 그대로 · AI 사용 기록 · 주제 맞는 사진 · 학교·회사 PC용 PPTX · 글꼴 안내 |
| 2026-10-17T11:50:20.520Z | windows | ota | 0.1.80+ota3 | - | ota-served-verified | src d14a941b6 · Gemini로도 편집, 내 문장 그대로 두기, AI 사용 기록, 주제에 맞는 사진·PPTX 글꼴·걸린 시간 표시 |
| 2026-10-17T12:30:41.740Z | macos | ota | 0.1.80+ota4 | - | ota-served-verified | src c5e9050b2 · 리워드 제출 멈춤 고침 · 주제와 맞지 않는 재고 사진 막음 · 사진 만드는 동안 진행 표시 |
| 2026-10-17T12:47:03.563Z | macos | ota | 0.1.80+ota5 | - | ota-served-verified | src ae7e5367e · 리워드 제출: tokens.css가 없으면 앱이 만들고 올려요 · 올리기 실패 이유를 말해요 |
| 2026-10-17T13:28:35.505Z | macos | ota | 0.1.80+ota6 | - | ota-served-verified | src f555118b9 · 지정 모양이 있는 리워드 제출 고침 · PPTX 줄바꿈이 앱과 같게 · 회전·외곽선 글자는 글자로 |
| 2026-10-17T14:00:20.534Z | macos | ota | 0.1.80+ota7 | - | ota-served-verified | src 7ed1d8821 · 사진 AI가 없어도 이 PC에서 사진을 만들어요 |
| 2026-10-17T23:13:08.836Z | windows | ota | 0.1.80+ota4 | - | ota-served-verified | src 6eff40c12 · 리워드 제출 오류 수정(tokens.css·영어 작업 글), 서버·앱 같은 덱 검사, PPTX 줄·글자 유지, 이 PC 사진, 진행 문구 정리 |
| 2026-10-17T23:40:27.038Z | macos | ota | 0.1.80+ota8 | - | ota-served-verified | src 00778d020 · 오류가 개발자 문장으로 보이던 문제 · '내 글 그대로'는 그 요청에만 |
| 2026-10-17T23:49:45.463Z | macos | ota | 0.1.80+ota9 | - | ota-served-verified | src d31fcc35a · 공개 기여 안내를 바뀐 정책에 맞췄어요 |
| 2026-10-18T00:26:28.308Z | macos | ota | 0.1.80+ota10 | - | ota-served-verified | src cdf7771c7 · 글꼴에 없는 글자가 있으면 다른 글꼴로 바꾸고, 학생회 공지 색을 색약에도 구분되게 했어요 |
| 2026-10-18T00:45:12.362Z | macos | ota | 0.1.80+ota11 | - | ota-served-verified | src 1d57799a6 · 시리즈 다음 회차는 지난 회차 디자인 그대로, QR은 링크로 만들어요 |
| 2026-10-18T07:35:34.800Z | macos | ota | 0.1.80+ota12 | - | ota-served-verified | src 63071f694 · 리워드 제출이 검사에서 계속 반려되던 문제를 고쳤어요 |
| 2026-10-18T09:35:05.794Z | macos | ota | 0.1.80+ota13 | - | ota-served-verified | src 99f1e1cd4 · PowerPoint에서 줄이 앱과 같게 열려요 |
| 2026-10-18T10:12:13.063Z | macos | ota | 0.1.80+ota14 | - | ota-served-verified | src 11a98b016 · PPTX에 글꼴을 넣어 글꼴 없는 PC에서도 같게 열려요 |
| 2026-10-18T10:48:35.035Z | macos | ota | 0.1.80+ota15 | - | ota-served-verified | src abadb5de1 · PPTX에 글꼴이 빠지던 문제를 고쳤어요 |
| 2026-10-18T11:18:20.072Z | macos | ota | 0.1.80+ota16 | - | ota-served-verified | src a62125efe · 앱이 다시 켜지면 못 받은 요청을 이어서 받고, 카드뉴스 장 크기를 지켜요 |
| 2026-10-18T11:40:14.570Z | macos | ota | 0.1.80+ota17 | - | ota-served-verified | src 4954834a8 · AI가 읽는 지시를 줄여 턴이 가벼워져요 |
| 2026-10-18T12:02:58.481Z | macos | ota | 0.1.80+ota18 | - | ota-served-verified | src 3d0d02832 · 글꼴을 넣었을 때 안내를 바로잡고, 모양 바꾼 뒤에도 후보가 보여요 |
| 2026-10-18T17:28:38.887Z | macos | ota | 0.1.80+ota19 | - | ota-served-verified | src 2d7641d37 · 다른 모양 띠가 비던 문제를 고쳤어요 |
| 2026-10-18T18:07:43.439Z | macos | ota | 0.1.80+ota20 | - | ota-served-verified | src ad052fb5e · 다른 모양 띠에 후보가 셋 보여요 |
| 2026-10-18T18:47:27.812Z | macos | ota | 0.1.80+ota21 | - | ota-served-verified | src ccce76185 · 모양을 바꿔도 문장이 사라지지 않아요 |
| 2026-10-18T21:45:17.624Z | macos | ota | 0.1.80+ota22 | - | ota-served-verified | src 2f3075142 · 받은 직후에도 다른 모양이 보여요 |
| 2026-10-18T23:22:51.332Z | macos | ota | 0.1.80+ota23 | - | ota-served-verified | src c7d34a266 · 받은 직후에도 다른 모양이 보여요 |
| 2026-10-19T00:21:14.981Z | macos | ota | 0.1.80+ota24 | - | ota-served-verified | src 08896719e · 다른 모양으로 바꿔도 쪽 번호가 그대로 남아요 |
| 2026-10-19T00:30:02.209Z | windows | ota | 0.1.80+ota5 | - | ota-served-verified | src 08896719e · 덱 리워드 제출 반려 수정(tokens.css), PPTX 글꼴 넣기·줄 유지, 카드뉴스 시리즈·학생/단체, 받지 못한 턴 다시 보내기, 모양 바꾸기 문장 보존, 재고 덱 색 유지 |
| 2026-10-19T01:09:04.746Z | windows | ota | 0.1.80+ota6 | - | ota-served-verified | src dc6227e2a · 깨진 장 목록 복구·모양 바꾸기 ⌘Z·PPTX 브라우저 대기·보상 제출 중복 방지(#177 #178) |
| 2026-10-19T01:25:51.138Z | macos | ota | 0.1.80+ota25 | - | ota-served-verified | src 506aaa6d8 · 모양을 바꾼 뒤 ⌘Z로 되돌리기 · 제목 고침에도 장 순서 그대로 · Gemini PC 리워드 제출 고침 · 공유 끈 작업 받기 고침 |
| 2026-10-19T02:28:16.831Z | windows | ota | 0.1.80+ota7 | - | ota-served-verified | src 7a1867d66 · 첫 방문 카드뉴스 채우기·주제별 색·채택 즉시 공개(#175 #179) |
| 2026-10-19T03:54:34.263Z | macos | ota | 0.1.80+ota26 | - | ota-served-verified | src 9a5ef1ac8 · 모양을 바꾼 뒤 ⌘Z가 보던 장 그대로 돌아와요 |
| 2026-10-19T04:16:51.255Z | macos | beta | 0.1.81 | macos-v0.1.81 | beta-served-verified | src fa1ca97e4 · 사진 넣기·색면 채우기 고침 · 설치가 막힌 이유 안내 · 장 목록 복구 |
| 2026-10-19T04:18:18.338Z | macos | stable | 0.1.81 | macos-v0.1.81 | stable-served-verified |  |
| 2026-10-19T04:38:29.486Z | macos | ota | 0.1.81+ota1 | - | ota-served-verified | src 0f7b439c5 · 한 문장뿐인 장도 다른 모양을 셋 골라요 |
| 2026-10-19T05:33:47.516Z | macos | ota | 0.1.81+ota2 | - | ota-served-verified | src 5ded053c9 · 다른 모양 후보 중복·한 단어 빈 그림 고침 |
| 2026-10-19T05:40:15.797Z | windows | beta | 0.1.81 | windows-v0.1.81 | beta-served-verified | src 4e23a9b5a · unsigned · 사진 넣기·자료 가져오기 수정(CSP ipc), 설치 실패 사유 전달, 장 목록 복구, 카드 한 문장 모양(#181) |
| 2026-10-19T05:42:09.728Z | windows | stable | 0.1.81 | windows-v0.1.81 | stable-served-verified |  |
| 2026-10-19T05:55:10.988Z | windows | ota | 0.1.81+ota1 | - | ota-served-verified | src 5ded053c9 · 카드 한 문장 모양 후보 중복·빈 썸네일 수정(#181 보정) |
| 2026-10-19T08:03:03.932Z | macos | ota | 0.1.81+ota3 | - | ota-served-verified | src f31c21003 · AI 로그인이 풀리면 한 줄과 [다시 로그인] |
| 2026-10-19T08:36:51.713Z | macos | ota | 0.1.81+ota4 | - | ota-served-verified | src d8d2576fa · 사진 저장 확인 · 멤버가 아닐 때 한 줄 · 초대 링크를 앱 계정으로 |
| 2026-10-19T09:10:10.026Z | windows | ota | 0.1.81+ota2 | - | ota-served-verified | src 696caa8c1 · 업데이트가 막히면 이유+설치 파일 받기·AI 로그인 풀림 다시 잇기·사진 저장 확인·초대 계정 합치기(#185 #186) |
| 2026-10-19T09:29:58.588Z | macos | ota | 0.1.81+ota5 | - | ota-served-verified | src 059c28b6c · 업데이트가 안 되면 [설치 파일 받기] 한 줄 · 옛 판 안내 |
| 2026-10-19T09:50:24.540Z | macos | ota | 0.1.81+ota6 | - | ota-served-verified | src 46c0ee705 · 바꾼 장 순서대로 내보내기 · 순서를 바꾸면 장 번호도 |
| 2026-10-19T10:48:41.610Z | windows | ota | 0.1.81+ota3 | - | ota-served-verified | src e468accdd · 바꾼 장 순서대로 내보내기·무거운 턴 바로 시작·속성 패널 글꼴/크기·업데이트 실패 시 설치 파일 줄(#185 #187 #189 #190) |
| 2026-10-19T13:05:49.359Z | macos | beta | 0.1.82 | macos-v0.1.82 | beta-served-verified | src b379ca6c2 · 내보내기 중 앱이 멈추지 않아요 · 바꾼 장 순서대로 내보내기 · 두 장 동시에 고치기 · 앱 첫 화면 정리 |
| 2026-10-19T13:07:40.524Z | macos | stable | 0.1.82 | macos-v0.1.82 | stable-served-verified |  |
| 2026-10-19T13:48:38.949Z | macos | ota | 0.1.82+ota1 | - | ota-served-verified | src 31edd651b · 덱 그림 톤을 하나로 맞춰요 · 이 장 그림으로 설명되게 · 보고서 문장을 발표 문구로 |
| 2026-10-19T19:01:07.882Z | windows | beta | 0.1.82 | windows-v0.1.82 | beta-served-verified | src bf57eee2c · unsigned · PDF 내보내기 멈춤·창 크기 되돌림 수정(긴 작업을 화면 밖에서, #188), 업데이트 실패 시 설치 파일 받기, 온보딩 한 화면 한 일(#184) |
| 2026-10-19T19:03:31.853Z | windows | stable | 0.1.82 | windows-v0.1.82 | stable-served-verified |  |
| 2026-10-19T19:51:32.150Z | windows | ota | 0.1.82+ota1 | - | ota-served-verified | src 57a4746e7 · 덱 그림 톤 하나로·이 장 그림으로 설명·📍 요청은 그 칸 안에서·보상 바로 공개·발표 순서 수정(#192~#198) |
| 2026-10-19T23:51:08.604Z | macos | ota | 0.1.82+ota2 | - | ota-served-verified | src 700b7f7df · 사진 AI가 막히면 다른 AI·이 PC로 이어서 · 만들 길이 없을 때만 카드 하나 · 사진 진행 표시 |
| 2026-10-20T00:37:11.723Z | macos | ota | 0.1.82+ota3 | - | ota-served-verified | src 4e3df8d59 · 리워드 19세 확인을 작업실 안에서 · Gemini 로그인 코드 자동 넣기 · 리워드는 앱이 먼저 맡아요 |
| 2026-10-20T00:51:47.283Z | macos | ota | 0.1.82+ota4 | - | ota-served-verified | src d59ff313a · ChatGPT 로그인이 중간에 끊기지 않아요 |
| 2026-10-20T01:55:36.479Z | windows | beta | 0.1.83 | windows-v0.1.83 | beta-served-verified | src d2b969c4c · unsigned · 업데이트가 회사망에서도(우리 주소로) · 창 없이 조용히 설치 · 쓰는 중엔 다시 시작하지 않음 · 장별 동시 작업(#191) |
| 2026-10-20T01:57:30.835Z | windows | stable | 0.1.83 | windows-v0.1.83 | stable-served-verified |  |
| 2026-10-20T03:37:15.558Z | macos | beta | 0.1.83 | macos-v0.1.83 | beta-served-verified | src f10773420 · 0.1.83 — 리워드는 계획 뒤 한 장씩 만들고 알아서 제출 · 제출 확인은 한 번만(막는 건 계약 위반뿐) · 카드 덱은 카드 크기 그대로 · 업데이트 주소를 우리 서버로 · 쪽 번호를 덱 전체에서 · ChatGPT 로그인 끊김 고침 |
| 2026-10-20T03:39:04.556Z | macos | stable | 0.1.83 | macos-v0.1.83 | stable-served-verified |  |
| 2026-10-20T04:29:13.646Z | windows | beta | 0.1.84 | windows-v0.1.84 | beta-served-verified | src e1d384b09 · unsigned · 리워드는 계획 뒤 한 장씩 만들고 알아서 제출 · 제출 확인 한 번 · 카드 덱은 카드 크기 그대로 · ChatGPT 로그인 끊김 고침 · 사진 사다리 · 덱 모티프 · 대화 바꾸기(#199 #201 #204 #205 #211~#214) |
| 2026-10-20T04:30:37.447Z | windows | stable | 0.1.84 | windows-v0.1.84 | stable-served-verified |  |
| 2026-10-20T06:56:44.330Z | macos | beta | 0.1.85 | macos-v0.1.85 | beta-served-verified | src 7d575fd45 · 0.1.85 — 내보내기 버튼이 작업 형식에 맞는 파일을 골라요 · 인쇄 작업은 인쇄소에 보낼 PDF로 · Gemini 로그인을 앱 안에서 |
| 2026-10-20T06:58:26.301Z | macos | stable | 0.1.85 | macos-v0.1.85 | stable-served-verified |  |
| 2026-10-20T07:25:42.775Z | windows | beta | 0.1.85 | windows-v0.1.85 | beta-served-verified | src 92c491ccd · unsigned · Gemini 로그인을 창 없이 — 브라우저에서 로그인하고 코드를 복사만 하면 앱이 넣어요 · Windows 리워드 제출 실패(명령줄 길이) 고침 · 홈 입력 하나·인쇄 리워드(#217 #220 #221) |
| 2026-10-20T07:29:48.674Z | windows | stable | 0.1.85 | windows-v0.1.85 | stable-served-verified |  |
| 2026-10-20T08:10:37.500Z | macos | ota | 0.1.85+ota1 | - | ota-served-verified | src def66e937 · 제출 전 사진 묶기·빈 칸 자동 처리, Gemini 로그인 확인 표시, 접는 인쇄물 제출 |
| 2026-10-20T08:25:11.072Z | windows | ota | 0.1.85+ota1 | - | ota-served-verified | src def66e937 · 리워드 사진 칸 연결 고침·빈 글 칸 앱이 정리·연결 필요 카드 하나로·리워드 장 묶어 만들기(#211 #214 #225) |
| 2026-10-20T09:38:25.140Z | macos | ota | 0.1.85+ota2 | - | ota-served-verified | src 3565afbca · AI 제출 거절 시 앱이 다시 제출, 사진 장 정리, 리워드 덱 묶음 턴 |
| 2026-10-20T10:50:55.205Z | macos | ota | 0.1.85+ota3 | - | ota-served-verified | src f23c67826 · 인쇄 판 계약 오류 자동 고침·제출 한 번으로 끝까지, 카드 쪽 번호 기본 숨김, 밝은 사진 기본, 제출 중 단계 표시 |
| 2026-10-20T23:45:16.518Z | macos | ota | 0.1.85+ota4 | - | ota-served-verified | src 8ca9ff348 · 청첩장 인물 사진 대신 내 사진 자리, 리워드 브리프 보관 |
| 2026-10-21T00:24:00.616Z | macos | ota | 0.1.85+ota5 | - | ota-served-verified | src 2d29a5858 · 계획만 말하고 멈춘 턴을 앱이 이어서, 짧은 승낙은 같은 등급으로 |
| 2026-10-21T00:57:20.739Z | macos | ota | 0.1.85+ota6 | - | ota-served-verified | src 18ee1c1e6 · 내 청첩장 인물 사진 다시 만듦 · 빈 사진 파일은 다음 AI로 · 사진 자리 표시 정리 · 긴 대화 오류 없이 새 대화로 이어감 · 20턴이면 미리 정리 |
| 2026-10-21T01:04:23.433Z | windows | ota | 0.1.85+ota2 | - | ota-served-verified | src 64a19aa3b · 계획만 하고 멈추던 턴 없앰·청첩장/인쇄 리워드 규칙·색 팔레트 다양화·리워드 계약 자동 고침(#211 #217 #227 #228 #229) |
| 2026-10-21T02:25:04.658Z | macos | ota | 0.1.85+ota7 | - | ota-served-verified | src c2cba3266 · 계획만 적고 멈춘 턴 이어서 · 언어판 제목 어긋남 알림 · 미루는 답 막기 |
| 2026-10-21T03:13:03.148Z | macos | ota | 0.1.85+ota8 | - | ota-served-verified | src 091ac4921 · 준비 파일 깨짐 자동 복구 · 고치기+검토 함께 · 📍 짚은 자리 확인과 다시 고치기 |
| 2026-10-21T04:06:09.046Z | macos | ota | 0.1.85+ota9 | - | ota-served-verified | src 1ffb3ef2f · 답 없는 턴 알림 · 여기=지난 자리 · 배치 말은 꼼꼼한 모델 · 되돌리기 실패 정직하게 · 영어판 자동 따라가기 · 영어 이름 지키기 |
| 2026-10-21T04:30:48.565Z | windows | ota | 0.1.85+ota3 | - | ota-served-verified | src 25b922bfd · '이거' 같은 말을 마지막 고친 칸으로·지킬 말 자동 보존·빈 공간 다시 채우기·모바일 청첩장(#230 #233 #234 #235) |
| 2026-10-21T04:32:25.265Z | macos | ota | 0.1.85+ota10 | - | ota-served-verified | src 73cbcc79e · 번역 뒤 작아지던 글자 고침 · 빈 공간 앱이 바로 채움 · 짚은 상자 이어서 · 짚은 말은 범위 안 넓힘 |
| 2026-10-21T05:27:33.051Z | macos | ota | 0.1.85+ota11 | - | ota-served-verified | src a2800d1f2 · 장 크기 지키기(직접 말하면 허용) · 조금 옮기기 앱이 바로 · 한국어판 남은 영어 다시 번역 |
