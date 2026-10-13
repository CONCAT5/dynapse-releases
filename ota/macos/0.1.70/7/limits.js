// 앱이 서버·배포 피드를 주기적으로 부르는 간격 — 한 곳에(#115, 2026-10-13 Neon 한도 초과 뒤). 줄마다 하루 호출 수(기기 1대, 켜 둔 채 24시간).
// 규칙(CLAUDE.md): 1초 미만 금지, 5초 미만은 지시서 근거 번호 필요. 새 루프는 여기에 줄을 더하고 중단 조건을 같이 쓴다.
export const HEARTBEAT_MS = 10 * 60_000; // 기기 심장박동 POST /api/device — 144/일. 턴 중·연결 쉼(2시간) 중엔 건너뜀
export const IDLE_SLOW_MS = 20 * 60_000; // 손대지 않은 지 20분 → 서버 연결 idle=1(순번 확인 60초 — 1,440/일, 평소 15초 5,760/일은 서버 쪽 상수)
export const IDLE_STOP_MS = 2 * 3600_000; // 2시간 → 서버 연결을 다시 붙지 않음(0/일). 창·트레이·딥링크·메시지·웹 활동이 깨운다
export const EVENTS_RETRY_MS = 500; // 서버가 연결을 정상 종료(약 280초)했을 때 다시 붙기 — 연결당 1회, ≈309/일
export const EVENTS_FAIL_MS = 5_000; // 연결 실패 뒤 다시 — 실패가 이어질 때만(최대 17,280/일이지만 서버가 없을 때뿐 — 서버 쿼리 0)
export const PULL_MIN_MS = 1_000; // 같은 PC 웹 nudge → 한 번 가져가기의 최소 간격(nudge가 있을 때만, 근거 #115 §1-①)
export const UPDATE_FIRST_MS = 30_000; // 새 버전 확인 첫 회(배포 피드 — 우리 DB 아님)
export const UPDATE_EVERY_MS = 60 * 60_000; // 새 버전 확인 — 24/일(배포 피드)
export const OTA_FIRST_MS = 15_000, OTA_EVERY_MS = 30 * 60_000; // 화면 묶음 확인 — 48/일(배포 피드)
export const CHAT_FLUSH_MS = 2_000; // 턴 출력 묶어 보내기 POST /api/works/*/messages — 턴이 도는 동안·보낼 것이 있을 때만(근거 #14 진행 미러). 한가하면 0
export const DETECT_MS = 3_000; // AI 도구 감지 — 이 PC 안(서버 호출 없음)
