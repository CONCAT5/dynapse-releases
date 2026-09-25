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
