// 원격 보고(#116 §1) — 실패를 이 PC 메모리에 모았다가 5분마다(보낼 것이 있을 때만) 묶어 보낸다. 턴이 끝날 때·앱을 닫을 때도 한 번.
// 성공은 하루 1건 집계(턴·사진·내보내기 성공·실패 수)만. 사용자 글·파일명·경로·프롬프트는 싣지 않는다(code = 분류, detail = 가린 기계 문자열).
// 기기당 하루 50건·같은 code 3건(서버도 같은 상한). 보내기가 실패하면 버린다(보고가 또 보고를 만들지 않게). 폴링 없음
import { api, S } from "./main.js";
import { redact } from "./diag.js";
import { REPORT_FLUSH_MS } from "./limits.js";
const q = [];
const day = () => new Date().toISOString().slice(0, 10);
let sentDay = "", sentTotal = 0;
const sentCode = new Map();
const norm = (c) => c.toLowerCase().replace(/[^a-z0-9_.]+/g, "_").replace(/^[^a-z]+/, "").replace(/\.{2,}/g, ".").slice(0, 60);
export function report(area, code, detail, stage) {
    let c = norm(code);
    if (!c.includes("."))
        c = `${area}.${c || "unknown"}`;
    if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,3}$/.test(c))
        c = `${area}.unknown`;
    if (sentDay !== day()) {
        sentDay = day();
        sentTotal = 0;
        sentCode.clear();
    }
    if (sentTotal >= 50 || (sentCode.get(c) ?? 0) >= 3)
        return;
    sentTotal++;
    sentCode.set(c, (sentCode.get(c) ?? 0) + 1);
    q.push({ at: Date.now(), area, code: c, stage: stage ?? null, detail: detail ? redact(detail).slice(0, 500) : null });
}
const KEY = "dyn:report-counts";
const load = () => { try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && typeof v.day === "string")
        return v;
}
catch { /* 없음 */ } return { day: day(), counts: {} }; };
let pendingStats = null;
export function tally(name, ok) {
    let cur = load();
    if (cur.day !== day()) {
        if (Object.keys(cur.counts).length)
            pendingStats = cur;
        cur = { day: day(), counts: {} };
    }
    const k = `${name}_${ok ? "ok" : "fail"}`;
    cur.counts[k] = (cur.counts[k] ?? 0) + 1;
    try {
        localStorage.setItem(KEY, JSON.stringify(cur));
    }
    catch { /* 못 씀 */ }
}
let busy = false;
export async function flushReports() {
    if (busy || !S.token)
        return;
    {
        const cur = load();
        if (!pendingStats && cur.day !== day() && Object.keys(cur.counts).length) {
            pendingStats = cur;
            try {
                localStorage.setItem(KEY, JSON.stringify({ day: day(), counts: {} }));
            }
            catch { /* */ }
        }
    }
    if (!q.length && !pendingStats)
        return;
    busy = true;
    const items = q.splice(0, q.length), stats = pendingStats;
    pendingStats = null;
    const { L } = await import("./engines.js"); // 이 PC 엔진 티어·번들 판(#116 규칙의 티어 멈춤이 읽는다)
    const device = { device_id: S.deviceId || null, app_version: S.app?.version ?? null, os: S.app?.os ?? null, ...(L.bundle ? { tier: L.bundle.id, bundle_id: L.bundle.id, bundle_version: L.state?.version ?? null, arch: L.probe?.arch ?? null, ram_gb: L.probe?.ram_gb ?? null, gpu: L.probe?.gpu ?? null } : {}) };
    await api("POST", "/api/device/reports", { device, items, ...(stats ? { stats } : {}) }).catch(() => null); // 실패하면 버린다
    busy = false;
}
setInterval(() => { void flushReports(); }, REPORT_FLUSH_MS);
addEventListener("pagehide", () => { void flushReports(); });
