let state = "online", since = Date.now();
const subs = new Set();
export const netState = () => state;
export const netSince = () => since;
export const onNet = (f) => { subs.add(f); return () => { subs.delete(f); }; };
let probe = null;
export const setProbe = (f) => { probe = f; };
export function netMark(n) {
    if (n === state)
        return;
    const prev = state;
    state = n;
    since = Date.now();
    for (const f of subs) {
        try {
            f(n, prev);
        }
        catch { /* 구독자 오류는 무시 */ }
    }
    if (n !== "online")
        probeSoon(true);
}
// curl 종료 코드 → 상태. 6 이름 못 찾음 · 7 연결 못 함 · 28 시간 초과 · 52 빈 답 · 55/56 주고받기 실패 = 끊김 / 5 프록시 이름 · 35·51·58·60·77 TLS·인증서 · 프록시 = 회사망
export function netFromCurl(code, stderr = "") {
    if ([5, 35, 51, 58, 60, 77].includes(code) || /proxy|certificate|SSL/i.test(stderr))
        return "blocked";
    if ([6, 7, 28, 52, 55, 56].includes(code))
        return "offline";
    return null;
}
let probeT = null, gap = 5_000, probeDay = "", probes = 0;
export function probeSoon(reset = false) {
    if (reset)
        gap = 5_000;
    if (probeT || state === "online")
        return;
    probeT = setTimeout(async () => {
        probeT = null;
        if (state === "online") {
            gap = 5_000;
            return;
        }
        const d = new Date().toLocaleDateString("sv");
        if (d !== probeDay) {
            probeDay = d;
            probes = 0;
        }
        if (++probes > 1_440)
            return; // 하루 상한
        const ok = await (probe?.() ?? Promise.resolve(false)).catch(() => false);
        if (ok) {
            netMark("online");
            gap = 5_000;
            return;
        }
        gap = Math.min(60_000, gap * 2);
        probeSoon();
    }, gap);
}
export const probeCount = () => probes;
if (typeof addEventListener === "function") {
    addEventListener("offline", () => netMark("offline"));
    addEventListener("online", () => { if (state !== "online") {
        if (probeT) {
            clearTimeout(probeT);
            probeT = null;
        }
        gap = 5_000;
        void (probe?.() ?? Promise.resolve(false)).then(ok => { if (ok)
            netMark("online");
        else
            probeSoon(true); }).catch(() => probeSoon(true));
    } });
}
// ── 대기열 ──
let q = { push: [], pull: [], held: [], chat: [], tries: 0, next: 0 };
let save = null;
export function netQueueInit(saved, persist) {
    if (saved)
        q = { push: saved.push ?? [], pull: saved.pull ?? [], held: saved.held ?? [], chat: saved.chat ?? [], tries: 0, next: 0 };
    save = persist;
}
const keep = () => { void save?.(q).catch(() => { }); };
export const netQueue = () => q;
export const queuedCount = () => q.push.length + q.pull.length + q.held.length;
// 대화 줄(앱 → 작업실) — 끊긴 동안 못 보낸 것을 차례로(최대 200)
export function queueChat(id, messages) { q.chat.push({ id, messages }); if (q.chat.length > 200)
    q.chat.splice(0, q.chat.length - 200); keep(); }
export function queuePush(id) { if (!q.push.includes(id)) {
    q.push.push(id);
    keep();
} }
export function queuePull(id) { if (!q.pull.includes(id)) {
    q.pull.push(id);
    keep();
} }
// 보관 요청(#146 §3) — 연결되면 바로 시작(같은 작업·같은 글은 한 번)
export function holdTurn(id, text) { if (!q.held.some(h => h.id === id && h.text === text)) {
    q.held.push({ id, text, at: Date.now() });
    keep();
} }
export function takeQueue() { const t = q; q = { push: [], pull: [], held: [], chat: [], tries: t.tries, next: t.next }; keep(); return t; }
export function requeue(t) { for (const id of t.push ?? [])
    queuePush(id); for (const id of t.pull ?? [])
    queuePull(id); for (const h of t.held ?? [])
    holdTurn(h.id, h.text); for (const c of t.chat ?? [])
    queueChat(c.id, c.messages); }
// 다시 보내기 간격(지수 · 최대 1시간)
export function backoff() { q.tries = Math.min(q.tries + 1, 12); const ms = Math.min(3_600_000, 5_000 * 2 ** (q.tries - 1)); q.next = Date.now() + ms; return ms; }
export function backoffReset() { q.tries = 0; q.next = 0; }
// 허브 주소 → 대기열(동기화 코드를 고치지 않고 길만 본다): POST …/commits = 올리기, GET …/commits·…/sync = 받기
export function queueFromUrl(method, url) {
    const m = url.match(/\/api\/works\/(wrk_[A-Za-z0-9_-]+)\/(commits|sync)\b/);
    if (!m)
        return;
    if (method === "POST" && m[2] === "commits")
        queuePush(m[1]);
    else if (method === "GET")
        queuePull(m[1]);
}
