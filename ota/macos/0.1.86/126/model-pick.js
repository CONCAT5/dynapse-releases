// 이 턴의 모델(#306 — 대표 10-27: 고른 Opus·GPT-6-Sol이 수정 턴에서 Sonnet·기본으로 바뀌었다).
// 순서: 사용자가 이 작업에서 고른 모델(route.models) → 연결 탭의 기본 모델 → (둘 다 없을 때만) 등급 자동 선택(가벼운 Claude 턴 = Sonnet). 순수 함수 — turn-sim이 직접 시험
export const LIGHT_MODEL = "claude-sonnet-5";
export function modelFor(o) {
    if (o.pick)
        return { model: o.pick, auto: false };
    if (o.dflt)
        return { model: o.dflt, auto: false };
    return o.light && o.ai === "claude" ? { model: LIGHT_MODEL, auto: true } : { model: null, auto: false };
}
