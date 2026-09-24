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
