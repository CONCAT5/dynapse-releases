// 연결·설치 진단(대표 2026-10-04: 로컬 환경 때문에 안 되는 걸 우리가 알 수 있게) — 실패를 모아 서버로.
// 자동 = 요약만(단계·코드·끝 몇 줄, 가린 채) · 같은 도구·코드는 1시간에 한 번. 로그 전체는 사용자가 [보고하기]를 누를 때만.
// 가리기: 사용자 폴더 경로 → ~ · 이메일 · 토큰처럼 보이는 긴 문자열. 작업 내용·파일은 보내지 않는다
import { api, S } from "./main.js";
export function redact(s) {
    return s
        .replace(/\/Users\/[^/"'\n]+/g, "~").replace(/\/home\/[^/"'\n]+/g, "~").replace(/[A-Za-z]:\\Users\\[^\\"'\n]+/gi, "~") // 이름에 공백이 있어도(Kim Jae) 다음 구분자까지
        .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "•@•")
        .replace(/\b(sk|pk|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{10,}/g, "•key•")
        .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{10,}/gi, "Bearer •")
        .replace(/\b[A-Za-z0-9+/_-]{32,}={0,2}/g, "•");
}
const tail = (s, n) => { const t = redact(s).trim(); return t.length > n ? `…${t.slice(-n)}` : t; };
// 최근 실패(로그 전체 포함) — 이 PC 메모리에만. [보고하기]가 여기서 꺼내 보낸다
const ring = [];
const sentAt = new Map();
export async function diagAuto(d) {
    const ev = { ...d, at: Date.now(), summary: tail(d.summary ?? d.log ?? "", 300), log: d.log ? tail(d.log, 8000) : undefined };
    ring.push(ev);
    if (ring.length > 30)
        ring.shift();
    const key = `${d.tool}|${d.code}`;
    if (Date.now() - (sentAt.get(key) ?? 0) < 3600_000)
        return;
    sentAt.set(key, Date.now());
    await api("POST", "/api/device/diag", { events: [{ source: "auto", tool: ev.tool, stage: ev.stage, code: ev.code, summary: ev.summary, work: ev.work ?? null, cli: ev.cli ?? null, os: S.app?.os ?? null, app: S.app?.version ?? null, device: S.deviceId ?? null }] }).catch(() => { });
}
// 사용자가 누른 보고 — 그 도구(또는 그 작업)의 최근 실패를 로그 전체와 함께. 메모 한 줄은 있으면
export async function diagReport(o) {
    const pick = ring.filter(e => (o.tool ? e.tool === o.tool : true) && (o.work ? e.work === o.work || !e.work : true)).slice(-5);
    const events = [...pick, ...(o.extra ? [{ ...o.extra, at: Date.now() }] : [])].map(e => ({ source: "user", tool: e.tool, stage: e.stage, code: e.code, summary: tail(e.summary ?? "", 300), log: e.log ? tail(e.log, 8000) : null, work: e.work ?? null, cli: e.cli ?? null, os: S.app?.os ?? null, app: S.app?.version ?? null, device: S.deviceId ?? null, note: o.note?.slice(0, 300) ?? null }));
    if (!events.length)
        events.push({ source: "user", tool: o.tool ?? "app", stage: "other", code: "user_report", summary: "", log: null, work: o.work ?? null, cli: null, os: S.app?.os ?? null, app: S.app?.version ?? null, device: S.deviceId ?? null, note: o.note?.slice(0, 300) ?? null });
    const r = await api("POST", "/api/device/diag", { events }).catch(() => null);
    return r?.status === 200;
}
