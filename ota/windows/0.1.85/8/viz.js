// 차트 다시 그리기(#102 보정 3) — 그린 SVG가 옛 렌더러 판(data-viz-v 없음·다름)인 장을 AI 없이 다시 그린다: 작업을 열 때·턴 전·리워드 제출 전.
// verify(렌더 포함, 작은 PNG 없이)는 장마다 data-viz를 지금 판으로 다시 그리고 화면에서 칸 크기를 재어 그 크기로 다시 그린다(#102 보정 4 — flex·grid 칸). 작업 폴더에 안 저장한 변경이 있으면 건드리지 않는다(남의 변경을 섞어 커밋하지 않게)
// 차트 칩(§2)도 여기: data-viz JSON의 text·legend·annotate를 바꾸거나 칸 높이를 ±80px — 다시 그려 커밋 1
import { exec, S, T } from "./main.js";
import { ensureVerify, isOriginDevice, postChat, repoCommit, sharedWorks, wget, wput } from "./chat.js";
export const VIZ_V = "5"; // 5 = steps-icon 내용 높이·2줄(#102 보정 6) · 4 = 범례 줄바꿈·끝 라벨 자리·x 라벨 솎기(#102 보정 5)
const RESULT = /^result-[a-z0-9-]+\.html$/;
const stale = (h) => /\sdata-viz\s*=/.test(h) && (!/data-viz-v="(\d+)"/.test(h) || [...h.matchAll(/data-viz-v="(\d+)"/g)].some(m => m[1] !== VIZ_V) || (h.match(/\sdata-viz\s*=/g) ?? []).length > (h.match(/data-viz-v=/g) ?? []).length);
export async function redrawCharts(id, why) {
    if (!S.git)
        return 0;
    if (sharedWorks.has(id) && !(await isOriginDevice(id)))
        return 0; // 함께 쓰는 작업의 멤버 기기 — 자동 커밋 없음(ota18). 원본이 다시 그려 올린 판을 받는다
    const files = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(f => RESULT.test(f));
    // 줄 맞춤(#125)이 아직 안 된 장(<style data-dyn> 없음)도 같은 길로 — 옛 덱은 다음 AI 턴을 기다리지 않고 열 때 맞춘다(대표 2026-10-14 "올라갔다며 왜 아직도")
    const old = [];
    let charts = 0;
    for (const f of files) {
        const h = await wget(id, f);
        if (!h)
            continue;
        const st = stale(h);
        if (st)
            charts++;
        if (st || !/<style\s+data-dyn(?=[\s>=])/i.test(h))
            old.push(f);
    }
    if (!old.length)
        return 0;
    const dirty = (await T().core.invoke("repo_changed", { id }).catch(() => [])).filter(f => RESULT.test(f));
    if (dirty.length)
        return 0;
    // 열 때 맞추기(#215 ① 앱 쪽) — 중간 줄을 채팅에 쓰지 않고 받기 판의 한 단계로(kind download · step fit). 끝나면 채팅엔 한 줄(웹이 걸린 시간을 붙인다). 3초 안에 끝나면 웹이 판을 띄우지 않는다
    const panel = why === "open", step = (p, text = null) => postChat(id, [{ role: "event", text, payload: { kind: "download", ai: "dynapse", step: "fit", ...p } }]).catch(() => { });
    if (panel)
        await step({ state: "run", done: 0, total: old.length });
    let closed = !panel; // 무슨 일이 있어도 판은 닫는다(검사기 받기 실패·폴더 오류)
    try {
        return await fitPass();
    }
    finally {
        if (!closed)
            await step({ state: "done", done: 0, total: old.length });
    }
    async function fitPass() {
        await ensureVerify(id);
        const wd = await T().core.invoke("work_dir", { id });
        await exec("node", [".dynapse/verify.mjs", ...old, "--no-small"], undefined, wd).catch(() => null);
        const changed = (await T().core.invoke("repo_changed", { id }).catch(() => [])).filter(f => RESULT.test(f));
        if (!changed.length) {
            if (panel) {
                closed = true;
                await step({ state: "done", done: old.length, total: old.length });
            }
            return 0;
        }
        await repoCommit(id, charts ? `차트 다시 그림 · 줄 맞춤 · ${changed.length}장` : `줄 맞춤 · ${changed.length}장`);
        if (panel) {
            closed = true;
            await step({ state: "done", done: old.length, total: old.length }, charts ? `차트를 새 크기로 다시 그리고 줄바꿈을 맞췄어요 · ${changed.length}장` : `줄바꿈을 맞췄어요 · ${changed.length}장`);
        }
        else if (why !== "quiet")
            await postChat(id, [{ role: "event", text: charts ? `차트를 새 크기로 다시 그리고 줄바꿈을 맞췄어요 · ${changed.length}장` : `줄바꿈을 맞췄어요 · ${changed.length}장`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
        return changed.length;
    }
}
// 차트 칩(§2) — slot의 data-viz에 patch(text·legend·annotate)를, 또는 칸 높이를 ±dh. 다시 그려 커밋 1
// 좌우 꽉(#102 보정 5) — 칸 폭은 부모(격자·max-width·auto 여백)가 정해 AI가 width:100%를 줘도 안 늘어난다. 그 칸과 section 안 조상의 max-width·auto 여백을 풀고
// 격자면 한 줄 전체(grid-column 1/-1). section 자신의 바깥 여백은 그대로. <style data-dyn-full>에 칸마다 한 규칙(verify 줄 맞춤이 지우지 않는 별도 블록)
export function fullWidthCss(h, slot) {
    const q = `[data-slot="${slot}"]`, rule = `section :has(> ${q}),section :has(${q}),${q}{max-width:none!important;margin-left:0!important;margin-right:0!important;grid-column:1/-1!important;justify-self:stretch!important;align-self:stretch!important}${q}{width:100%!important}`;
    const blk = h.match(/<style\s+data-dyn-full\b[^>]*>([\s\S]*?)<\/style\s*>/i);
    if (blk)
        return blk[1].includes(`${q}{width:100%`) ? h : h.replace(blk[0], () => blk[0].replace(/<\/style\s*>$/i, `${rule}</style>`));
    return /<\/head>/i.test(h) ? h.replace(/<\/head>/i, `<style data-dyn-full>${rule}</style>\n</head>`) : h;
}
// 칩·AI 동작 공통(#102 보정 5) — HTML만 바꾼다(검사·커밋 없음). 바뀐 게 없으면 null
export function patchViz(h0, slot, patch, dh) {
    if (!/^[a-z0-9_-]{1,40}$/i.test(slot))
        return null;
    const full = patch?.full === true;
    if (patch) {
        patch = { ...patch };
        delete patch.full;
        if (!Object.keys(patch).length)
            patch = null;
    }
    const h = full ? fullWidthCss(h0, slot) : h0;
    const re = new RegExp(`(<[a-z][a-z0-9]*\\b[^>]*\\bdata-slot\\s*=\\s*["']${slot}["'][^>]*>)`, "i");
    const m = h.match(re);
    if (!m || !/\sdata-viz\s*=/.test(m[1]))
        return null;
    let tag = m[1];
    if (patch)
        tag = tag.replace(/\sdata-viz\s*=\s*(?:'([^']*)'|"([^"]*)")/, (all, a, b) => {
            try {
                const raw = (a ?? b ?? "").replace(/&quot;/g, '"').replace(/&#0*39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
                const sp = { ...JSON.parse(raw), ...patch };
                return ` data-viz='${JSON.stringify(sp).replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/</g, "&lt;")}'`;
            }
            catch {
                return all;
            }
        });
    if (dh) { // 칸 높이 — 인라인 height가 있으면 그것을, 없으면 새로(아래 요소는 흐름대로 밀린다)
        const cur = Number(tag.match(/\sstyle\s*=\s*["'][^"']*?(?:^|;)\s*height\s*:\s*(\d+(?:\.\d+)?)px/i)?.[1] ?? 0) || 360;
        const nh = Math.max(160, Math.min(860, cur + dh));
        tag = /\sstyle\s*=\s*["']/.test(tag) ? (/(?:^|;|["'])\s*height\s*:/.test(tag.match(/\sstyle\s*=\s*["']([^"']*)/)?.[1] ?? "") ? tag.replace(/(\sstyle\s*=\s*["'][^"']*?)(height\s*:\s*)\d+(?:\.\d+)?px/i, `$1$2${nh}px`) : tag.replace(/(\sstyle\s*=\s*["'])/, `$1height:${nh}px;`)) : tag.replace(/>$/, ` style="height:${nh}px">`);
    }
    if (tag === m[1] && h === h0)
        return null;
    return h.replace(m[1], () => tag);
}
export async function setViz(id, file, slot, patch, dh) {
    const h0 = await wget(id, file);
    if (!h0)
        return;
    const full = patch?.full === true, out = patchViz(h0, slot, patch, dh);
    if (!out)
        return;
    await wput(id, file, out);
    const wd = await T().core.invoke("work_dir", { id });
    await ensureVerify(id);
    await exec("node", [".dynapse/verify.mjs", file, "--no-small"], undefined, wd).catch(() => null);
    const what = full ? "좌우 꽉" : patch?.text ? `글자 ${patch.text === "xl" ? "아주 크게" : patch.text === "l" ? "크게" : "보통"}` : patch?.legend === false ? "범례 끔" : patch?.annotate === false ? "값 표시 끔" : patch?.legend ? "범례 켬" : patch?.annotate ? "값 표시 켬" : dh > 0 ? "칸 높게" : "칸 낮게";
    await repoCommit(id, `차트 · ${what} · ${file.replace(/^result-|\.html$/g, "")}`);
}
// AI가 고른 차트 동작(#102 보정 5) — 에이전트는 차트 CSS를 쓰지 않고 .dynapse/viz-actions.json에 동작 이름만: [{"file","slot","do":["full-width","text:l","box:+","legend:off",…]}].
// 턴 끝 검사 전에 앱이 적용한다(턴 커밋에 함께). 모르는 이름은 버린다. 적용한 수
export async function applyVizActions(id) {
    const raw = await wget(id, ".dynapse/viz-actions.json");
    if (!raw)
        return 0;
    let list = [];
    try {
        const j = JSON.parse(raw);
        list = Array.isArray(j) ? j : [];
    }
    catch { /* */ }
    let n = 0;
    for (const a of list.slice(0, 12)) {
        if (!/^result-[a-z0-9-]+\.html$/.test(a.file ?? "") || !a.slot)
            continue;
        let h = await wget(id, a.file);
        if (!h)
            continue;
        for (const d of (a.do ?? []).slice(0, 6)) {
            const p = d === "full-width" ? { full: true } : /^text:(m|l|xl)$/.test(d) ? { text: d.slice(5) } : d === "legend:off" ? { legend: false } : d === "legend:on" ? { legend: true } : d === "values:off" ? { annotate: false } : d === "values:on" ? { annotate: true } : null;
            const dh = d === "box:+" ? 80 : d === "box:-" ? -80 : 0;
            if (!p && !dh)
                continue;
            const out = patchViz(h, a.slot, p, dh);
            if (out) {
                h = out;
                n++;
            }
        }
        await wput(id, a.file, h);
    }
    await wput(id, ".dynapse/viz-actions.json", "[]").catch(() => { });
    return n;
}
let vizRules = null;
async function rulesOf() {
    if (vizRules && Date.now() - vizRules.at < 600_000)
        return vizRules.j;
    const { HUB, http } = await import("./main.js");
    const r = await http("GET", `${HUB}/skills/viz-intents.json`).catch(() => null);
    let j = null;
    try {
        j = r?.status === 200 ? JSON.parse(r.body) : null;
    }
    catch { /* */ }
    vizRules = { at: Date.now(), j: j ?? vizRules?.j ?? null };
    return vizRules.j;
}
// 문장 → 동작 id들(위에서부터, 맞은 부분은 지워 다음 규칙이 다시 못 쓰게) · 남은 말
export function parseVizWords(text, j) {
    let s = ` ${text.toLowerCase()} `;
    const pm = s.match(new RegExp(j.page_ref, "i")), page = pm ? Number(pm[1] ?? pm[2]) || null : null;
    if (pm)
        s = s.replace(pm[0], " ");
    const target = new RegExp(j.targets.table, "i").test(s) ? "table" : new RegExp(j.targets.chart, "i").test(s) || /범례|legend/i.test(s) ? "chart" : null;
    for (const t of Object.values(j.targets))
        s = s.replace(new RegExp(`(${t})`, "gi"), " ");
    const ids = [];
    for (const it of j.intents) {
        if (target && !it.on.includes(target))
            continue;
        const re = new RegExp(it.match, "gi");
        if (re.test(s)) {
            ids.push(it.id);
            s = s.replace(new RegExp(it.match, "gi"), " ");
        }
    }
    const rest = s.replace(new RegExp(`(${j.filler})`, "gi"), " ").replace(/\s+/g, "").trim();
    return { target, page, ids, rest };
}
const TABLE_K = { l: 1.2, xl: 1.4 };
function tableCss(h, p) {
    const blk = h.match(/<style\s+data-dyn-table\b[^>]*>([\s\S]*?)<\/style\s*>/i);
    let css = blk?.[1] ?? "";
    if (p.text) {
        css = css.replace(/section table :is\(th,td,caption\)\{zoom:[\d.]+\}/g, "");
        if (TABLE_K[p.text])
            css += `section table :is(th,td,caption){zoom:${TABLE_K[p.text]}}`;
    }
    if (p.full && !css.includes("section table{width:100%"))
        css += "section table{width:100%!important;max-width:none!important}section :has(> table){max-width:none!important;width:100%!important;margin-left:0!important;margin-right:0!important;grid-column:1/-1!important}";
    const tag = `<style data-dyn-table>${css}</style>`;
    return blk ? h.replace(blk[0], () => tag) : h.replace(/<\/head>/i, `${tag}\n</head>`);
}
export async function vizByWords(id, text, ctx) {
    if (text.length > 80 || /\n/.test(text.trim()))
        return false;
    const j = await rulesOf();
    if (!j)
        return false;
    const q = parseVizWords(text, j);
    const { actionMetric } = await import("./chat.js");
    const miss = () => { if (q.target)
        void actionMetric(id, "viz_words_miss", Date.now(), { target: q.target, ids: q.ids, len: text.length }).catch(() => { }); return false; }; // 글 없이 분류만
    if (!q.ids.length || q.rest.length > 2)
        return miss();
    const file = ctx.file ?? (q.page ? (await ctx.order())[q.page - 1] : null) ?? ctx.selPage ?? null;
    if (!file || !RESULT.test(file.replace(/\.[a-z]{2}\.html$/, ".html")))
        return miss();
    const h0 = await wget(id, file);
    if (!h0)
        return false;
    const vizSlots = [...h0.matchAll(/<[a-z][a-z0-9]*\b([^>]*\sdata-viz\s*=[^>]*)>/gi)].map(m => m[1].match(/\bdata-slot\s*=\s*["']([a-z0-9_-]+)["']/i)?.[1]).filter((x) => !!x);
    const hasTable = /<table\b/i.test(h0.slice(Math.max(0, h0.search(/<section\b/i))));
    const target = q.target ?? (ctx.slot && vizSlots.includes(ctx.slot) ? "chart" : null); // "글자 키워줘"처럼 차트·표를 말하지 않았으면 📍로 차트를 짚었을 때만(아니면 장 글자 — AI)
    if (!target)
        return miss();
    const its = q.ids.map(x => j.intents.find(i => i.id === x)).filter(i => i.on.includes(target));
    if (its.length !== q.ids.length)
        return miss();
    let h = h0;
    if (target === "chart") {
        const slots = ctx.slot && vizSlots.includes(ctx.slot) ? [ctx.slot] : vizSlots.slice(0, 3);
        if (!slots.length)
            return miss();
        for (const s of slots)
            for (const it of its) {
                const c = it.chart ?? {};
                const { dh = 0, ...patch } = c;
                const out = patchViz(h, s, Object.keys(patch).length ? patch : null, dh);
                if (out)
                    h = out;
            }
    }
    else {
        if (!hasTable)
            return miss();
        for (const it of its)
            if (it.table)
                h = tableCss(h, it.table);
    }
    if (h === h0) {
        await postChat(id, [{ role: "event", text: "이미 그렇게 되어 있어요", payload: { kind: "stage", ai: "dynapse" } }, { role: "event", text: null, payload: { kind: "turn-end", ai: "dynapse" } }]).catch(() => { });
        return true;
    }
    await wput(id, file, h);
    const wd = await T().core.invoke("work_dir", { id });
    await ensureVerify(id);
    await exec("node", [".dynapse/verify.mjs", file, "--no-small"], undefined, wd).catch(() => null);
    const say = its.map(i => i.say).join(" · ");
    const what = target === "table" ? "표" : "차트";
    await repoCommit(id, `${what} · ${its.map(i => i.id).join(" ")} · ${file.replace(/^result-|\.html$/g, "")}`);
    await postChat(id, [{ role: "event", text: `${what} ${say} · 되돌리기 ⌘Z`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
    void actionMetric(id, "viz_words", Date.now(), { target, ids: q.ids }).catch(() => { });
    await postChat(id, [{ role: "event", text: null, payload: { kind: "turn-end", ai: "dynapse" } }]).catch(() => { }); // AI 턴 없이 끝난 요청(#128)
    return true;
}
