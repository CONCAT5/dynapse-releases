export const CONV_ID = /^[A-Za-z0-9_-]{4,60}$/;
export const convKey = (conversation, cli, device) => `conv.session.v1:${conversation}:${cli}:${device}`;
// 대화 실행의 앱 쪽 작업 자리 이름(Rust work id) — 대화마다 하나 · 덱이 아니다 · 허브 동기화 · 목록 · 검사에 들어가지 않는다(cv_ 접두사)
export const convWork = (conversation) => `cv_${conversation}`.slice(0, 64);
export const isConvWork = (work) => typeof work === "string" && work.startsWith("cv_");
// MIG 6 · 8 — 앱이 기기 보고에 낸 판(beta.workspace) · 서버가 답한 판. 1 = 작업에 묶인 독립 화면 실행(BR18) · 2 = Work 없는 대화 실행(#379 C1)
export const WS_CONV = 2;
let serverWs = 0;
export const setServerWorkspace = (n) => { serverWs = typeof n === "number" && Number.isFinite(n) ? n : 0; };
// 시험(browser-sim)만 __DYN_WS_SERVER로 서버 판을 정한다
export const serverWorkspace = () => serverWs || Number(globalThis.__DYN_WS_SERVER ?? 0) || 0;
export async function loadConv(store, conversation, cli, device) {
    if (!CONV_ID.test(conversation) || !device)
        return null;
    const s = await store.get(convKey(conversation, cli, device)).catch(() => null);
    return s && s.v === 1 && s.conversation === conversation && s.cli === cli && s.device === device && /^[A-Za-z0-9_-]{8,128}$/.test(s.thread) ? s : null;
}
const workKey = (work, cli, device) => `work.session.v1:${work}:${cli}:${device}`;
export async function saveWorkSession(store, s) {
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(s.work) || !s.device || !/^[A-Za-z0-9_-]{8,128}$/.test(s.thread))
        return;
    await store.set(workKey(s.work, s.cli, s.device), s);
    await store.save().catch(() => { });
}
// 대화가 옛 작업 채팅에서 왔으면(서버가 알려 준 옛 Work들) 그 작업의 세션을 별칭으로 이어 간다 — 이미 대화 세션이 있으면 그대로 · 옛 세션이 하나이고 cwd가 그 작업 폴더 안일 때만.
// 여럿이면 합치지 않고 고르게 남긴다(ambiguous) · 원본 키는 그대로 둔다
export async function aliasConv(store, conversation, legacy, cli, device, dirOf) {
    if (await loadConv(store, conversation, cli, device))
        return { state: "kept" };
    const found = [];
    for (const w of legacy.filter(x => /^[A-Za-z0-9_-]{4,64}$/.test(x)).slice(0, 20)) {
        const s = await store.get(workKey(w, cli, device)).catch(() => null);
        const dir = s && s.v === 1 && s.work === w && s.cli === cli ? await dirOf(w).catch(() => null) : null;
        if (s && dir && s.cwd.startsWith(dir))
            found.push(s);
    }
    if (found.length > 1)
        return { state: "ambiguous", works: found.map(x => x.work) };
    if (!found.length)
        return { state: "none" };
    await saveConv(store, { v: 1, conversation, cli, device, thread: found[0].thread, cwd: found[0].cwd, alias: found[0].work, at: new Date().toISOString() });
    return { state: "aliased", works: [found[0].work] };
}
// MIG 3 — 도는 브라우저 실행(차례 · 승인 대기 · 넣기)이 있으면 OTA 새로고침을 미룬다(그 실행은 원래 실행 · 대상 · 요청 id로 끝난다). browser-run이 등록한다
let busyProbe = () => false;
export const setBrowserBusy = (f) => { busyProbe = f; };
export const browserBusy = () => { try {
    return busyProbe();
}
catch {
    return false;
} };
export async function saveConv(store, s) {
    if (!CONV_ID.test(s.conversation) || !s.device || !/^[A-Za-z0-9_-]{8,128}$/.test(s.thread))
        return;
    await store.set(convKey(s.conversation, s.cli, s.device), s);
    await store.save().catch(() => { });
}
