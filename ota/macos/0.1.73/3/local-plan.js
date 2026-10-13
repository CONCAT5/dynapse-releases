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
    return `Option A — a fixed layout (mode "layout"): give its id in "layout" and one of ITS variants in "variant" ("" = default); leave "blocks" empty.\n${ls}\n\nOption B — composed blocks (mode "blocks"): "blocks" is a row list such as "title,cards:3" or "title,photo+compare" (rows separated by commas, side by side with +, item count with :k); set "layout" to any id and "variant" to "".\nBlocks: ${m.block_catalog}${numbers ? "" : "\nThis page has no numbers: do not use the viz or stats blocks."}\nThere is no free CSS layout — use blocks for anything custom.`;
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
// 칸 채우기 — 옮길 내용을 함께 주고, 걸린 칸만 2번까지. 차트 칸(data-viz)은 그 장 숫자로만, 숫자가 없으면 칸을 뺀다
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
    // 차트 — data-viz 칸마다 그 장 숫자로(없으면 칸 제거: 가짜 숫자를 남기지 않는다)
    const vizRe = /<div\b[^>]*\bdata-viz\s*=\s*'[^']*'[^>]*>\s*<\/div>/gi;
    const vz = out.match(vizRe) ?? [];
    for (const tag of vz) {
        if (!numbersIn(keep)) {
            out = out.replace(tag, "");
            continue;
        }
        const spec = await ask(id, b, [
            { role: "system", content: "You turn numbers from a presentation page into one chart spec. Reply with JSON only. Use only numbers that appear in the content; never invent any. labels and values have the same length." },
            { role: "user", content: `User request: ${request}\n\nContent:\n${keep.slice(0, 1600)}` },
        ], { type: "object", additionalProperties: false, required: ["type", "takeaway", "unit", "labels", "values"], properties: {
                type: { type: "string", enum: ["bar", "line", "donut", "big-number"] }, takeaway: { type: "string", minLength: 1, maxLength: 60 }, unit: { type: "string", maxLength: 8 },
                labels: { type: "array", minItems: 1, maxItems: 6, items: { type: "string", minLength: 1, maxLength: 16 } }, values: { type: "array", minItems: 1, maxItems: 6, items: { type: "number" } }
            } }, 600).catch(() => null);
        if (!spec || !spec.values.length) {
            out = out.replace(tag, "");
            continue;
        }
        const n = Math.min(spec.labels.length, spec.values.length);
        const data = spec.type === "big-number" ? { type: "big-number", value: spec.values[0], unit: spec.unit, label: spec.labels[0], takeaway: spec.takeaway }
            : { type: spec.type, takeaway: spec.takeaway, unit: spec.unit, labels: spec.labels.slice(0, n), values: spec.values.slice(0, n), series: [{ name: "", values: spec.values.slice(0, n) }] };
        out = out.replace(tag, () => tag.replace(/\bdata-viz\s*=\s*'[^']*'/i, `data-viz='${JSON.stringify(data).replace(/'/g, "&#39;").replace(/</g, "\\u003c")}'`));
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
        const sch = { type: "object", additionalProperties: false, required: ["pages"], properties: { pages: { type: "array", minItems: slots.length, maxItems: slots.length, items: choiceSchema(m) } } };
        const j = await ask(id, b, [
            { role: "system", content: "You plan the layout of every page of a presentation deck. Reply with JSON only, matching the schema: one choice per page, in order." },
            { role: "user", content: `User request: ${request}\n${brief ? `Original brief: ${brief.slice(0, 600)}\n` : ""}\nThe deck will have ${slots.length} pages with these roles:\n${slots.map((s, i) => `${i + 1}. ${s.role} (covers: ${s.scope}; density ${s.density}; default layout ${s.layout})`).join("\n")}\n\nContent of the current deck:\n${source.slice(0, 1800)}\nNumbers in the deck: ${numbersIn(source)}.\n\n${menuText(m, numbersIn(source) > 0)}\n\nVary the layouts; keep the default when unsure.` },
        ], sch, 1600).catch(() => null);
        const picks = j?.pages ?? [];
        plan = { request, goal, n: slots.length, mood: moodOf(htmls[0] ?? ""), look: lookOf(htmls[0] ?? ""), source, photos: htmls.flatMap(photosOf), done: [], at: Date.now(),
            pages: slots.map((s, i) => ({ ...(picks[i] ?? { mode: "layout", layout: s.layout, variant: "", blocks: "" }), file: s.file, role: s.role, fallback: s.layout })) };
        await wput(id, PLAN, JSON.stringify(plan, null, 2));
        await postChat(id, [
            { role: "event", text: `계획 · ${plan.pages.map((p, i) => `${i + 1} ${p.role}${p.mode === "blocks" ? `(${p.blocks})` : `(${p.layout}${p.variant ? `·${p.variant}` : ""})`}`).join(" · ")}`.slice(0, 600), payload: { kind: "stage", ai: "local" } },
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
