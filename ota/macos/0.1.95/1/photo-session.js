// #382-3 — 이어가기 실패 분류(순수 — photo-runner가 쓰고 turn-sim이 부른다): 새 대화는 다른 세션 id를 받았거나(other_thread) 세션 없음 · 문맥 한도(session_dead)일 때만. 빈 id · 모르는 실패는 멈춤
export function sessClass(o) {
    const cls = o.quota ? "quota" : o.login ? "login" : o.update ? "update" : o.thread && o.thread !== o.old ? "other_thread" : o.dead ? "session_dead" : !o.thread ? (o.exc ? "spawn_failed" : o.code === 0 ? "no_response" : "exit_nonzero") : "unknown";
    return { cls, renew: cls === "other_thread" || cls === "session_dead" };
}
