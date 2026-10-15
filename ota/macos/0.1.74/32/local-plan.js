// 이 PC 큰 수정(#113 보정 5) — 장·덱 범위 요청을 앱이 작은 결정적 단계로 쪼갠다. 모델은 매번 도구 없는 JSON 하나만:
// 장: ① 배치 고르기(고정 레이아웃 id + variant | compose 블록 문자열) ② 뼈대는 허브 레이아웃·compose API로(결정적) ③ 칸 채우기 ④ verify → 걸린 칸만 2번까지
// 덱: ① 장별 계획(장 수만큼) ② 장마다 위 ②~④ · 진행 줄 `3/8장`. 자유 배치는 compose 블록으로만(작은 모델에게 CSS를 쓰게 하지 않는다)
// 상태는 .dynapse/local-plan.json. 한 요청 상한 모델 호출 40회·10분 — 넘으면 거기까지 저장하고 "이어서"로 다음 장부터
import { api, HUB, http } from "./main.js";
import { appVerify, postChat, readJson, wget, wput } from "./chat.js";
import { applyFill, checkFill, leaves, schemaFor } from "./fill-core.js";
import { L, llamaJson } from "./engines.js";
import { placePhoto } from "./photo-runner.js";
const PLAN = ".dynapse/local-plan.json";
export class Budget {
    max;
    ms;
    calls = 0;
    tokens = 0;
    t0 = Date.now();
    constructor(max = 40, ms = 600_000) {
        this.max = max;
        this.ms = ms;
    }
    ok() { return this.calls < this.max && Date.now() - this.t0 < this.ms; }
}
async function ask(id, b, msgs, schema, maxTokens = 1500) {
    if (!b.ok())
        return null;
    b.calls++;
    const r = await llamaJson(id, msgs, schema, maxTokens);
    b.tokens += r.tokens;
    return r.json;
}
// 범위 — 덱(장 수·전체·순서) · 장(배치·차트·비교…) · 그 밖은 칸 채우기(기존 길)
const DECK = /전체|처음부터|모든\s*장|덱\s*(을|를)?\s*다시|다시\s*만들|\d{1,2}\s*장으로|장\s*(을|를)?\s*(추가|더\s*(넣|만들)|빼|없애|나눠|합쳐)|한\s*장\s*(더|추가)|순서/;
const PAGE = /레이아웃|배치|구성\s*(을|를)?\s*바꿔|차트|그래프|도표|표로|비교로|카드로|단계로|숫자로|블록|디자인\s*(을|를)?\s*바꿔|layout|chart/i;
export function scopeOf(request, files, points) {
    if (/^\s*이어서/.test(request))
        return { kind: "deck", n: 0 };
    if (DECK.test(request)) {
        const want = Number(request.match(/(\d{1,2})\s*장으로/)?.[1]);
        const n = want || files.length + (/추가|더|한\s*장/.test(request) ? 1 : /빼|없애|합쳐/.test(request) ? -1 : 0);
        return { kind: "deck", n: Math.max(2, Math.min(12, n || files.length || 4)) };
    }
    if (!PAGE.test(request))
        return null;
    const pt = points.map(p => p.file).filter(f => files.includes(f));
    if (pt.length)
        return { kind: "page", files: [...new Set(pt)] };
    const nums = [...request.matchAll(/(\d{1,2})\s*(?:번째\s*)?장(?!\s*으로)/g)].map(m => Number(m[1])).filter(k => k >= 1 && k <= files.length);
    if (nums.length)
        return { kind: "page", files: [...new Set(nums.map(k => files[k - 1]))] };
    return { kind: "deck", n: files.length }; // 장을 짚지 않은 배치 바꾸기 = 덱 전체를 같은 장 수로
}
// 장 요약 — 칸 글(모델에게 옮길 내용) · 숫자 수 · 사진 · 무드
const contentOf = (html) => leaves(html).map(l => `${l.slot}: ${l.text}`).join("\n");
const numbersIn = (s) => (s.match(/\d[\d,.]*/g) ?? []).filter(x => /\d/.test(x) && !/^\d\s*\/\s*\d+$/.test(x)).length;
const photosOf = (html) => [...html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]).filter(s => !/^(data:|https?:|\/\/)/i.test(s));
const moodOf = (html) => (/\bstyle-wa\b/.test(html) ? "wa" : "qi");
const emptyFigures = (html) => [...html.matchAll(/<figure\b[^>]*\bdata-slot\s*=\s*["']([a-z0-9_]+)["'][^>]*>([\s\S]*?)<\/figure>/gi)].filter(m => !/<img\b[^>]*\bsrc\s*=\s*["'][^"']+["']/i.test(m[2])).map(m => m[1]);
// 덱의 생김새 — 토큰·글꼴 블록을 새 뼈대에 그대로(배치만 바뀌고 색·글꼴은 그 덱)
const LOOK = /<style\b[^>]*\bdata-(tokens|fonts)\b[^>]*>[\s\S]*?<\/style>/gi;
const lookOf = (html) => (html.match(LOOK) ?? []).join("\n");
function keepLook(skel, look) {
    if (!look)
        return skel;
    let out = skel;
    for (const blk of look.match(LOOK) ?? []) {
        const kind = blk.match(/\bdata-(tokens|fonts)\b/i)?.[1];
        if (!kind)
            continue;
        const re = new RegExp(`<style\\b[^>]*\\bdata-${kind}\\b[^>]*>[\\s\\S]*?<\\/style>`, "i");
        out = re.test(out) ? out.replace(re, () => blk) : out.replace(/<\/head>/i, () => `${blk}\n</head>`);
    }
    return out;
}
let menuCache = null;
async function menu(kind) {
    if (menuCache && menuCache.kind === kind && Date.now() - menuCache.at < 300_000)
        return menuCache.m;
    const r = await api("GET", `/api/engines/menu?kind=${kind}`).catch(() => null);
    if (!r?.data?.layouts?.length)
        return null;
    menuCache = { at: Date.now(), kind, m: r.data };
    return r.data;
}
const variantIds = (m) => [...new Set(["", ...m.layouts.flatMap(l => l.variants.map(v => v.id))])];
const choiceSchema = (m) => ({ type: "object", additionalProperties: false, required: ["mode", "layout", "variant", "blocks"], properties: {
        mode: { type: "string", enum: ["layout", "blocks"] }, layout: { type: "string", enum: m.layouts.map(l => l.id) }, variant: { type: "string", enum: variantIds(m) }, blocks: { type: "string", maxLength: 80 }
    } });
function menuText(m, numbers) {
    const ls = m.layouts.map(l => `- ${l.id} (${l.name}; roles ${l.roles.join("/") || "any"}; density ${l.density}) slots: ${l.slots}${l.variants.length ? `; variants: ${l.variants.map(v => `${v.id || '""'}${v.use ? ` = ${v.use}` : ""}`).join(", ")}` : ""}`).join("\n");
    return `Option A — a fixed layout (mode "layout"): give its id in "layout" and one of ITS variants in "variant" ("" = default); leave "blocks" empty.\n${ls}\n\nOption B — composed blocks (mode "blocks"): "blocks" is a row list such as "title,cards:3" or "title,photo+compare" (rows separated by commas, side by side with +, item count with :k); set "layout" to any id and "variant" to "".\nBlocks: ${m.block_catalog}${numbers ? "" : "\nThis page has no numbers: do not use the viz or stats blocks or the number forms (pictogram, proportion, ratio, stat-stack)."}\nThere is no free CSS layout — use blocks for anything custom.`;
}
// 뼈대(결정적) — 허브 API. compose가 문법 오류면 {error}로 모델에게 돌려준다
async function skeleton(c, mood, no, of, m) {
    const lay = m.layouts.find(l => l.id === c.layout);
    const url = c.mode === "blocks" && c.blocks.trim()
        ? `${HUB}/api/layouts/compose?blocks=${encodeURIComponent(c.blocks.trim())}&mood=${mood}&no=${no}&of=${of}`
        : `${HUB}/api/layouts/${encodeURIComponent(lay?.id ?? m.layouts[0].id)}?mood=${mood}&no=${no}&of=${of}&tokens=1${lay?.variants.some(v => v.id === c.variant) && c.variant ? `&variant=${encodeURIComponent(c.variant)}` : ""}`;
    const r = await http("GET", url).catch(() => null);
    if (!r)
        return { error: "network" };
    if (r.status !== 200)
        return { error: r.body.slice(0, 200) || `status ${r.status}` };
    return { html: r.body };
}
// 그림 자리 데이터 → JSON schema(#119): 글자는 글자(짧게), 숫자는 숫자, 배열 길이 고정, type·icon·좌표·강조는 그대로(const)
// 작은 모델의 숫자를 그릴 수 있게(#119) — 픽토그램은 10칸 기준으로 줄이고(1만 2천 명 중 7천 → 10 중 6), 비율 문장은 1000까지, 값은 전체를 넘지 않게
function fixViz(d) {
    const n = (x) => (typeof x === "number" && Number.isFinite(x) ? x : Number(String(x ?? "").replace(/[^\d.]/g, "")) || 0);
    if (d.type === "pictogram" || d.type === "ratio-sentence") {
        let t = Math.round(n(d.total)) || 10, v = n(d.value);
        const cap = d.type === "pictogram" ? 20 : 1000;
        if (t > cap || t < 2) {
            v = t > 0 ? Math.round(v / t * 10) : 7;
            t = 10;
        }
        d.total = t;
        d.value = Math.max(0, Math.min(t, Math.round(v)));
    }
    if (Array.isArray(d.values))
        d.values = d.values.map(n);
    return d;
}
const NUMERIC_FORMS = new Set(["bar", "line", "area", "donut", "big-number", "slope", "funnel", "pictogram", "proportion", "ratio", "stat-stack"]);
const VIZ_TEXT_FORMS = new Set(["steps-icon", "path", "ring-process", "grid-gallery", "before-after", "pull-quote", "annotated", "ribbon-timeline", "timeline", "flow"]);
const KEEP_KEYS = new Set(["type", "icon", "x", "y", "highlight", "weight", "src", "id"]);
function specSchema(v, key = "") {
    if (KEEP_KEYS.has(key))
        return { const: v };
    if (typeof v === "number")
        return { type: "number" };
    if (typeof v === "string")
        return { type: "string", minLength: 1, maxLength: key === "text" ? 80 : key === "takeaway" ? 50 : key === "sub" ? 30 : 24 };
    if (Array.isArray(v))
        return { type: "array", minItems: v.length, maxItems: v.length, items: specSchema(v[0], key) };
    if (v && typeof v === "object") {
        const o = v;
        return { type: "object", additionalProperties: false, required: Object.keys(o), properties: Object.fromEntries(Object.entries(o).map(([k, x]) => [k, specSchema(x, k)])) };
    }
    return { type: "string" };
}
// 칸 채우기 — 옮길 내용을 함께 주고, 걸린 칸만 2번까지. 차트·그림 칸(data-viz)은 자리 데이터 모양 그대로 그 장 내용으로
async function fill(id, b, html, file, request, keep) {
    const ls = leaves(html);
    let out = html;
    if (ls.length) {
        const msgs = (only, fix) => [
            { role: "system", content: "You write the text slots of one presentation page. Reply with JSON only, matching the schema. Each value is plain text for that slot: no markdown, no emoji, no quotes around it, within its character limit. Titles state a claim. Use only facts and numbers from the content given; never invent statistics. Write in the language of the content." },
            { role: "user", content: `User request: ${request}\n\nContent to carry over (from the page or deck before the change):\n${keep.slice(0, 2400)}\n\n${fix ? `Fix these slots: ${fix}\n\n` : ""}Slots (current text is a template placeholder — rewrite it):\n${file}\n${only.map(l => `  ${l.key} (≤${l.max} chars, now: "${l.text}")`).join("\n")}` },
        ];
        const vals = {};
        const j = await ask(id, b, msgs(ls), schemaFor([{ file, leaves: ls }]));
        Object.assign(vals, j?.[file] ?? {});
        for (let k = 0; k < 2; k++) {
            const bad = ls.filter(l => checkFill(vals, [l]).length);
            if (!bad.length)
                break;
            const r = await ask(id, b, msgs(bad, bad.map(l => `${l.key} (empty, too long or has markdown)`).join(", ")), schemaFor([{ file, leaves: bad }])).catch(() => null);
            if (!r)
                break;
            Object.assign(vals, r[file] ?? {});
        }
        out = applyFill(html, ls, vals);
    }
    // 차트·그림 칸(data-viz, #119 형태 어휘 포함) — 자리 데이터의 모양 그대로 JSON schema를 만들어 그 장 내용으로 채운다(type·icon·좌표는 그대로).
    // 숫자가 필요한 그림인데 장에 숫자가 없으면 칸을 뺀다(가짜 숫자를 남기지 않는다)
    const vizRe = /<div\b[^>]*\bdata-viz\s*=\s*'([^']*)'[^>]*>\s*<\/div>/gi;
    for (const m of [...out.matchAll(vizRe)]) {
        const tag = m[0];
        let ph;
        try {
            ph = JSON.parse(m[1].replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&amp;/g, "&"));
        }
        catch {
            out = out.replace(tag, "");
            continue;
        }
        const numeric = NUMERIC_FORMS.has(String(ph.type)) || (!VIZ_TEXT_FORMS.has(String(ph.type)) && !ph.items);
        if (numeric && !numbersIn(keep)) {
            out = out.replace(tag, "");
            continue;
        }
        const filled = await ask(id, b, [
            { role: "system", content: "You fill one chart spec of a presentation page with the page's own content. Reply with JSON only, matching the schema (same shape as the example). Use only numbers that appear in the content; never invent any. Short labels." },
            { role: "user", content: `User request: ${request}\n\nContent:\n${keep.slice(0, 1600)}\n\nExample to replace (placeholders):\n${JSON.stringify(ph)}` },
        ], specSchema(ph), 800).catch(() => null);
        if (!filled) {
            out = out.replace(tag, "");
            continue;
        }
        const data = fixViz({ ...filled, type: ph.type });
        out = out.replace(tag, () => tag.replace(/\bdata-viz\s*=\s*'[^']*'/i, `data-viz='${JSON.stringify(data).replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/</g, "&lt;")}'`));
    }
    return out;
}
// 확인 — verify 오류 중 칸이 있는 것만 그 칸에 돌려준다(2번까지)
async function check(id, b, file, request, keep) {
    for (let k = 0; k < 2 && b.ok(); k++) {
        const v = await appVerify(id, [file]).catch(() => null);
        const errs = (v?.errors ?? []).filter(e => e.page === file);
        const bySlot = new Map();
        for (const e of errs)
            for (const s of [e.slot, ...(e.slots ?? [])].filter((x) => !!x))
                bySlot.set(s, `${e.rule}: ${e.msg.slice(0, 80)}`);
        if (!bySlot.size)
            return;
        const html = (await wget(id, file)) ?? "";
        const ls = leaves(html).filter(l => bySlot.has(l.slot));
        if (!ls.length)
            return;
        const r = await ask(id, b, [
            { role: "system", content: "You fix the text slots of one presentation page that failed a layout check. Reply with JSON only, matching the schema. Plain text, shorter than before, same facts." },
            { role: "user", content: `User request: ${request}\n\nContent:\n${keep.slice(0, 1600)}\n\nProblems:\n${[...bySlot].map(([s, m]) => `- ${s}: ${m}`).join("\n")}\n\nSlots:\n${file}\n${ls.map(l => `  ${l.key} (≤${Math.max(4, Math.round(l.max * 0.8))} chars, now: "${l.text}")`).join("\n")}` },
        ], schemaFor([{ file, leaves: ls.map(l => ({ ...l, max: Math.max(4, Math.round([...l.text].length * 0.85)) })) }])).catch(() => null);
        if (!r?.[file])
            return;
        await wput(id, file, applyFill(html, ls, r[file]));
    }
}
// 사진 옮기기 — 새 뼈대의 빈 사진 칸에 앞 배치의 사진을 순서대로(새로 만들지 않는다)
async function carryPhotos(id, file, pool) {
    const html = (await wget(id, file)) ?? "";
    for (const slot of emptyFigures(html)) {
        const src = pool.shift();
        if (!src)
            break;
        await placePhoto(id, file, slot, src, { runtime: "local", title: "앞 배치에서" }).catch(() => []);
    }
}
// 한 장 다시 배치 — 고르기 → 뼈대 → 채우기 → 사진 → 확인
async function relayout(id, b, file, request, no, of, m, say) {
    const old = (await wget(id, file)) ?? "";
    if (!old)
        return false;
    const keep = contentOf(old), mood = moodOf(old);
    await say(`${no}장 배치 고르는 중`);
    let c = null, err = "", last = null;
    for (let k = 0; k < 3 && !c; k++) {
        const pick = k < 2 || !last ? await ask(id, b, [
            { role: "system", content: "You choose the layout for one presentation page. Reply with JSON only, matching the schema." },
            { role: "user", content: `User request: ${request}\n\nPage ${no} of ${of}. Current content:\n${keep.slice(0, 1400)}\nNumbers on the page: ${numbersIn(keep)}. Photos: ${photosOf(old).length}.\n\n${menuText(m, numbersIn(keep) > 0)}${err ? `\n\nThe previous choice failed: ${err} — choose again.` : ""}` },
        ], choiceSchema(m), 400).catch(() => null) : { mode: "layout", layout: last.layout, variant: "", blocks: "" }; // 블록이 두 번 틀리면 그 장만 고정 레이아웃(고른 id)으로
        if (!pick)
            break;
        last = pick;
        const sk = await skeleton(pick, mood, no, of, m);
        if ("error" in sk) {
            err = sk.error;
            continue;
        }
        c = pick;
        await say(`${no}장 채우는 중`);
        const html = await fill(id, b, keepLook(sk.html, lookOf(old)), file, request, keep);
        await wput(id, file, html);
    }
    if (!c)
        return false;
    await carryPhotos(id, file, photosOf(old));
    await say(`${no}장 확인 중`);
    await check(id, b, file, request, keep);
    return true;
}
const estMin = (pages) => Math.max(1, Math.round(pages * (L.bundle?.est?.deck_s ?? 90) / 360)); // 실측(M 시리즈 9B): 6장 39초 · 장당 호출 1~2번 — deck_s는 4장 한 번 채우기 기준이라 여유를 둔다
// 장 범위 — 짚은 장마다 relayout
export async function runPages(id, request, files, all, say) {
    const b = new Budget(), kind = all.some(f => /card/.test(f)) ? "card" : "slide", m = await menu(kind);
    if (!m)
        return null;
    if (files.length > 1)
        await postChat(id, [{ role: "event", text: `이 PC로 ${files.length}장을 나눠서 해요 · 약 ${estMin(files.length)}분`, payload: { kind: "stage", ai: "local" } }]).catch(() => { });
    const changed = [];
    for (const f of files) {
        if (!b.ok())
            break;
        if (await relayout(id, b, f, request, all.indexOf(f) + 1, all.length, m, say))
            changed.push(f);
    }
    const partial = !b.ok() && changed.length < files.length, failed = files.filter(f => !changed.includes(f)).map(f => `${all.indexOf(f) + 1}장`);
    const did = changed.length ? `${changed.map(f => `${all.indexOf(f) + 1}장`).join("·")}의 배치를 바꿨어요.` : "";
    return { changed, partial, tokens: b.tokens, text: partial ? `여기까지 했어요(${changed.length}/${files.length}장) · 다시 보내면 나머지 장도 해요.` : failed.length ? `${did ? `${did} ` : ""}${failed.join("·")}은 이 PC가 배치를 만들지 못했어요 · 다른 말로 다시 보내 주세요.` : did };
}
// 형태 샘플러(#119 보정 3 §3) — verify.mjs --plan과 같은 표·같은 식: 모델은 장마다 증거 종류와 후보 2~4개(적합도)만, 고르는 건 여기서
// (작업 id 시드 + 많이 받아들여진 형태는 낮춘 가중치 + 직전 두 장과 같은 형태 제외). 뽑힌 형태는 이 PC가 지을 수 있는 compose 블록·고정 레이아웃으로 바꾼다
export const EVIDENCE_FORMS = {
    number: ["stat-stack", "big-number", "pictogram", "ratio", "ratio-sentence", "proportion", "bar", "donut", "small-multiples"],
    change: ["line", "slope", "area", "before-after", "big-number", "small-multiples", "bar"],
    comparison: ["before-after", "bar", "table", "proportion", "matrix-2x2", "slope", "venn", "small-multiples"],
    sequence: ["steps-icon", "steps-line", "step-bar", "path", "ring-process", "timeline", "ribbon-timeline", "flow", "gantt", "rows"],
    voice: ["pull-quote", "quote-minimal", "photo-headline", "annotated"],
    structure: ["grid-gallery", "matrix-2x2", "flow", "venn", "rows", "agenda", "table", "layers"],
    place: ["annotated", "photo-full", "grid-gallery", "photo-headline", "collage"],
    none: ["photo-full", "colour-page", "numeral", "collage", "photo-headline", "quote-minimal"],
};
const ALL_FORMS = [...new Set(Object.values(EVIDENCE_FORMS).flat())];
const DIST = (f) => ["photo-full", "colour-page", "collage"].includes(f) ? "far" : ["big-number", "pull-quote", "quote-minimal", "numeral", "ratio-sentence"].includes(f) ? "close" : "mid";
const seedOf = (x) => { let h = 2166136261; for (const c of x)
    h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h; };
const prng = (a) => () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
export function sampleForms(pages, seed, weights = {}) {
    const rnd = prng(seedOf(seed)), picks = [];
    for (const pg of pages) {
        if (pg.fixed) {
            picks.push(pg.fixed);
            continue;
        }
        const allowed = EVIDENCE_FORMS[pg.kind] ?? EVIDENCE_FORMS.none;
        let c = pg.candidates.filter(x => allowed.includes(x.form)).map(x => ({ form: x.form, fit: Math.max(0, Math.min(1, x.fit || 0)) }));
        if (!c.length)
            c = allowed.slice(0, 3).map((f, k) => ({ form: f, fit: 0.5 - k * 0.05 }));
        // 콘티(#119 보정 3 §2) — 직전 장과 다른 거리를 먼저, 원경 없이 3장이 지나면 원경 후보를 먼저
        const pool0 = c.filter(x => !picks.slice(-2).includes(x.form)), prevD = picks.length ? DIST(picks[picks.length - 1]) : "", gap = (() => { let g = 0; for (let k = picks.length - 1; k >= 0 && DIST(picks[k]) !== "far"; k--)
            g++; return g; })();
        const far = gap >= 3 ? pool0.filter(x => DIST(x.form) === "far") : [], diff = pool0.filter(x => DIST(x.form) !== prevD);
        const use = far.length ? far : diff.length ? diff : pool0.length ? pool0 : c, sc = (x) => x.fit * (weights[x.form] > 0 ? weights[x.form] : 1);
        let r = rnd() * (use.reduce((a, x) => a + sc(x), 0) || 1), pick = use[use.length - 1];
        for (const x of use) {
            r -= sc(x);
            if (r <= 0) {
                pick = x;
                break;
            }
        }
        picks.push(pick.form);
    }
    return picks;
}
// 역할 모양(#119 보정 11) — 표지·섹션·마무리는 증거 종류가 아니라 이 표(허브 form-names ROLE_FORMS와 같은 표). photo = 사진이 있어야 제 모양
export const ROLE_FORMS = {
    cover: [{ form: "cover-photo-line", photo: true }, { form: "cover-split", photo: true }, { form: "cover-band", photo: true }, { form: "cover-photo-centre", photo: true }, { form: "cover-colour-giant", photo: false }, { form: "cover-baseline", photo: false }, { form: "cover-poster", photo: false }, { form: "cover-number", photo: false }],
    section: [{ form: "section-numeral", photo: false }, { form: "section-colour", photo: false }, { form: "section-photo-strip", photo: true }],
    closing: [{ form: "closing-photo-line", photo: true }, { form: "closing-colour-cta", photo: false }, { form: "closing-thanks-min", photo: false }, { form: "closing-recap-three", photo: false }],
};
// 장의 역할 — plan.json role → 파일 이름 → 순서(첫 장 = 표지 · 셋 이상일 때 마지막 장 = 마무리)
export function roleOf(file, order, planRole) {
    if (planRole === "cover" || planRole === "section" || planRole === "closing" || planRole === "body")
        return planRole;
    const b = file.replace(/^result-/, "").replace(/(\.[a-z]{2})?\.html$/, "");
    if (/(^|-)(cover|title|hook)(-|$)/.test(b))
        return "cover";
    if (/(^|-)(closing|close|end|outro|thanks|cta)(-|$)/.test(b))
        return "closing";
    if (/(^|-)(section|divider|chapter)(-|$)/.test(b))
        return "section";
    const i = order.indexOf(file);
    if (i === 0)
        return "cover";
    if (i >= 2 && i === order.length - 1)
        return "closing";
    return "body";
}
// 형태 → 이 PC가 짓는 것(compose 블록 · 고정 레이아웃). 없는 형태는 가장 가까운 것으로
export const FORM_BUILD = Object.fromEntries([
    ...["pictogram", "proportion", "ratio", "ratio-sentence", "ring-process", "steps-icon", "before-after", "annotated", "ribbon-timeline", "pull-quote", "stat-stack", "grid-gallery", "path", "gantt", "venn", "small-multiples", "steps-line", "step-bar"].map(f => [f, { mode: "blocks", layout: "", variant: "", blocks: `title,${f}` }]),
    ["quote-minimal", { mode: "blocks", layout: "", variant: "", blocks: "quote-minimal" }],
    ["big-number", { mode: "blocks", layout: "", variant: "", blocks: "numeral,stat-stack" }],
    ["rows", { mode: "blocks", layout: "", variant: "", blocks: "title,rows:3" }], ["agenda", { mode: "blocks", layout: "", variant: "", blocks: "title,agenda:4" }], ["table", { mode: "blocks", layout: "", variant: "", blocks: "title,table:3" }],
    ["numeral", { mode: "blocks", layout: "", variant: "", blocks: "numeral" }], ["collage", { mode: "blocks", layout: "", variant: "", blocks: "collage" }],
    ["bar", { mode: "blocks", layout: "", variant: "", blocks: "title,viz" }], ["line", { mode: "blocks", layout: "", variant: "", blocks: "title,viz" }], ["area", { mode: "blocks", layout: "", variant: "", blocks: "title,viz" }],
    ["slope", { mode: "blocks", layout: "", variant: "", blocks: "title,small-multiples:2" }], ["donut", { mode: "blocks", layout: "", variant: "", blocks: "title,ratio" }], ["matrix-2x2", { mode: "blocks", layout: "", variant: "", blocks: "title,table:3" }],
    ["timeline", { mode: "blocks", layout: "", variant: "", blocks: "title,ribbon-timeline:4" }], ["flow", { mode: "blocks", layout: "", variant: "", blocks: "title,steps-line:4" }], ["layers", { mode: "blocks", layout: "", variant: "", blocks: "title,rows:3" }],
    ["photo-full", { mode: "layout", layout: "cover-full", variant: "", blocks: "" }], ["colour-page", { mode: "layout", layout: "cover-full", variant: "nophoto", blocks: "" }], ["photo-headline", { mode: "layout", layout: "split-story", variant: "", blocks: "" }],
    // 역할 모양(#119 보정 11) — 허브 compose의 cover 블록 하나(장 전체) + data-form
    ...Object.values(ROLE_FORMS).flat().map(x => [x.form, { mode: "blocks", layout: "", variant: "", blocks: x.form }]),
]);
// 덱 범위 — 계획(1회) → 장마다 뼈대·채우기·사진·확인. 상한에 걸리면 거기까지, "이어서"면 local-plan.json에서
const GOALS = [[/카드\s*뉴스|인스타|카드/, "cards"], [/보고|리포트|실적|분석/, "report"], [/제안|기획안|프로포절/, "proposal"], [/사업\s*계획|투자|IR|피치/i, "business"], [/포트폴리오/, "portfolio"]];
export async function runDeck(id, request, n, all, say) {
    const b = new Budget();
    let plan = /^\s*이어서/.test(request) ? await readJson(id, PLAN) : null;
    if (plan && plan.done.length >= plan.pages.length)
        plan = null;
    if (!plan) {
        if (/^\s*이어서/.test(request))
            return { changed: [], partial: false, tokens: 0, text: "이어서 할 계획이 없어요 · 하고 싶은 걸 다시 말해 주세요." };
        const htmls = await Promise.all(all.map(f => wget(id, f).then(h => h ?? "")));
        const goal = GOALS.find(([re]) => re.test(request))?.[1] ?? (all.some(f => /card/.test(f)) ? "cards" : "company");
        const kind = goal === "cards" ? "card" : "slide", m = await menu(kind);
        if (!m)
            return null;
        const base = await api("GET", `/api/engines/plan?goal=${goal}&pages=${n}`).catch(() => null);
        const slots = base?.data?.pages ?? [];
        if (!slots.length)
            return null;
        const source = htmls.map((h, i) => `[page ${i + 1}]\n${contentOf(h)}`).join("\n").slice(0, 3000);
        const brief = (await readJson(id, ".dynapse/local-brief.json").catch(() => null))?.text ?? "";
        await say("장 계획 세우는 중");
        // 카피 규칙 + 후보(#119 보정 3 §1·§3) — 장마다 주장 하나·증거 하나(종류)와 형태 후보 2~4개, 고르는 건 샘플러
        const sch = { type: "object", additionalProperties: false, required: ["pages"], properties: { pages: { type: "array", minItems: slots.length, maxItems: slots.length, items: { type: "object", additionalProperties: false, required: ["claim", "evidence", "candidates"], properties: {
                            claim: { type: "string", minLength: 1, maxLength: 60 }, evidence: { type: "string", enum: Object.keys(EVIDENCE_FORMS) },
                            candidates: { type: "array", minItems: 2, maxItems: 4, items: { type: "object", additionalProperties: false, required: ["form", "fit"], properties: { form: { type: "string", enum: ALL_FORMS }, fit: { type: "number" } } } }
                        } } } } };
        const j = await ask(id, b, [
            { role: "system", content: "You plan a presentation deck page by page. Reply with JSON only, matching the schema. For every page: one claim sentence (the title), the kind of the ONE piece of evidence that proves it (number, change, comparison, sequence, voice, structure, place or none), and 2-4 candidate forms that fit that evidence with a fit score 0-1. Do not default to three parallel items; never pick a single form yourself." },
            { role: "user", content: `User request: ${request}\n${brief ? `Original brief: ${brief.slice(0, 600)}\n` : ""}\nThe deck will have ${slots.length} pages with these roles:\n${slots.map((s, i) => `${i + 1}. ${s.role} (covers: ${s.scope})`).join("\n")}\n\nContent of the current deck:\n${source.slice(0, 1800)}\nNumbers in the deck: ${numbersIn(source)}.${numbersIn(source) ? "" : " There are no numbers: do not use number or change evidence."}\nForms by evidence: ${Object.entries(EVIDENCE_FORMS).map(([k, v]) => `${k}: ${v.join(", ")}`).join(" | ")}. Start with a far page (photo-full or colour-page) and end with a calm one.` },
        ], sch, 2000).catch(() => null);
        const weights = (await api("GET", "/api/forms/weights").catch(() => null))?.data?.weights ?? {};
        const rows = j?.pages ?? [];
        // 표지·마무리는 원경(쉼) — 모델이 원경 후보를 안 냈으면 표지는 사진 전면, 마무리는 색면 한 문장(콘티 §2: 원경 3~4장마다)
        const farOf = (i) => (rows[i]?.candidates ?? []).some(c => DIST(c.form) === "far");
        const forms = sampleForms(slots.map((_, i) => ({ kind: rows[i]?.evidence ?? "none", candidates: rows[i]?.candidates ?? [], fixed: i === 0 && !farOf(0) ? "photo-full" : i === slots.length - 1 && slots.length >= 5 && !farOf(i) ? "colour-page" : null })), id, weights);
        const picks = forms.map((f, i) => FORM_BUILD[f] ?? { mode: "layout", layout: slots[i].layout, variant: "", blocks: "" });
        plan = { request, goal, n: slots.length, mood: moodOf(htmls[0] ?? ""), look: lookOf(htmls[0] ?? ""), source, photos: htmls.flatMap(photosOf), done: [], at: Date.now(),
            pages: slots.map((s, i) => ({ ...picks[i], file: s.file, role: rows[i]?.claim ? `${s.role} — ${rows[i].claim}` : s.role, fallback: s.layout, form: forms[i], evidence: rows[i]?.evidence ?? "none" })) };
        await wput(id, PLAN, JSON.stringify(plan, null, 2));
        await postChat(id, [
            { role: "event", text: `계획 · ${plan.pages.map((p, i) => `${i + 1} ${p.form ?? (p.mode === "blocks" ? p.blocks : p.layout)}`).join(" · ")}`.slice(0, 600), payload: { kind: "stage", ai: "local" } },
            { role: "event", text: `이 PC로 ${plan.n}장을 나눠서 해요 · 약 ${estMin(plan.n)}분`, payload: { kind: "stage", ai: "local" } },
        ]).catch(() => { });
    }
    const m = await menu(plan.goal === "cards" ? "card" : "slide");
    if (!m)
        return null;
    const pool = [...plan.photos];
    const changed = [];
    for (const [i, p] of plan.pages.entries()) {
        if (plan.done.includes(p.file))
            continue;
        if (!b.ok())
            break;
        await say(`${i + 1}/${plan.n}장 채우는 중`);
        let sk = await skeleton(p, plan.mood, i + 1, plan.n, m);
        if ("error" in sk)
            sk = await skeleton({ mode: "layout", layout: p.fallback, variant: "", blocks: "" }, plan.mood, i + 1, plan.n, m); // 블록이 모자라면 그 장만 고정 레이아웃
        if ("error" in sk)
            continue;
        if (p.form === "line" || p.form === "area")
            sk = { html: sk.html.replace('"type":"bar"', `"type":"${p.form}"`) }; // 선·면 차트는 자리 데이터의 종류만 바꾼다
        const keep = `This page: ${p.role}\n${plan.source}`;
        await wput(id, p.file, await fill(id, b, keepLook(sk.html, plan.look), p.file, plan.request, keep));
        await carryPhotos(id, p.file, pool);
        await check(id, b, p.file, plan.request, keep);
        plan.done.push(p.file);
        changed.push(p.file);
        await wput(id, PLAN, JSON.stringify(plan, null, 2));
    }
    const order = plan.pages.map(p => p.file).filter(f => plan.done.includes(f));
    await wput(id, ".dynapse/pages.json", JSON.stringify(order));
    const partial = plan.done.length < plan.pages.length;
    return { changed, partial, tokens: b.tokens, text: partial ? `여기까지 했어요(${plan.done.length}/${plan.n}장) · "이어서"라고 보내면 다음 장부터 해요.` : `이 PC로 ${plan.n}장을 다시 짰어요.` };
}
