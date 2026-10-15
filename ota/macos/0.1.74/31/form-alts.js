// 다른 모양 보기(#119 보정 4) — 보고 고르는 것: 그 장의 다른 모양 2~3개를 AI 턴 없이 결정적으로 만들어(compose 뼈대 + 지금 장의 글·숫자·사진 + 같은 토큰)
// verify 렌더러로 실제 썸네일을 찍고, 웹의 장 인스펙터 띠에 보낸다. 고르기 전엔 아무것도 바꾸지 않고 커밋도 없다. [이 모양으로]면 그 파일을 장으로 복사 → 커밋 1.
// 대안 파일은 .dynapse/out/alt--<장>--<형태>.html(커밋 안 함 · 네이티브 경로 규칙상 .dynapse/out 안), 썸네일은 같은 이름의 .png
import { HUB, exec, http, T } from "./main.js";
import { postChat, readJson, repoCommit, wget, wput } from "./chat.js";
import { leaves } from "./fill-core.js";
import { EVIDENCE_FORMS, FORM_BUILD } from "./local-plan.js";
export const FORM_KO = { rows: "번호 줄", "stat-stack": "구분선 숫자", "big-number": "하나 크게", pictogram: "픽토그램", ratio: "비율 막대", "ratio-sentence": "문장형 비율", proportion: "크기 비교",
    "steps-icon": "아이콘 단계", "steps-line": "한 줄 단계", "step-bar": "지금 단계", path: "여정 길", "ring-process": "순환", "ribbon-timeline": "띠 연혁", gantt: "일정표", "before-after": "전후 비교", "pull-quote": "큰 인용",
    "quote-minimal": "한 줄 인용", "grid-gallery": "격자", venn: "벤", agenda: "목차", table: "비교 표", numeral: "큰 장 번호", collage: "콜라주", bar: "막대", line: "선", annotated: "번호 핀", "small-multiples": "작은 차트" };
const BUILDABLE = new Set(Object.entries(FORM_BUILD).filter(([, c]) => c.mode === "blocks").map(([f]) => f));
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const altName = (file, form) => `.dynapse/out/alt--${file.replace(/\.html$/, "")}--${form}.html`;
function domLeaves(html) {
    if (typeof DOMParser === "undefined")
        return [];
    const d = new DOMParser().parseFromString(html, "text/html"), sec = d.querySelector("section") ?? d.body, out = [];
    let titled = false;
    for (const e of Array.from(sec.querySelectorAll("h1,h2,h3,p,li,strong,b,blockquote"))) {
        if (e.closest("svg,[data-viz],[data-slot=page_no],.pageno") || (e.tagName !== "LI" && e.querySelector("p,li,h1,h2,h3")))
            continue;
        if (/^(STRONG|B)$/.test(e.tagName) && e.closest("h1,h2,h3,p,li"))
            continue; // 문장 안 강조는 그 문장으로
        const t = (e.textContent ?? "").replace(/\s+/g, " ").trim();
        if (!t || t.length > 300)
            continue;
        const slot = /^H[12]$/.test(e.tagName) && !titled ? (titled = true, "title") : /^H/.test(e.tagName) ? "item_h" : e.tagName === "BLOCKQUOTE" ? "quote" : e.tagName === "P" ? "body" : e.tagName === "LI" ? "item_h" : "num";
        out.push({ slot, text: t });
    }
    return out;
}
const sectionText = (html) => html.slice(Math.max(0, html.search(/<section\b/i))).replace(/<(script|style|svg)\b[\s\S]*?<\/\1\s*>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
function extract(html) {
    const ls0 = leaves(html).filter(l => !/page_no|brand|logo/.test(l.slot)), ls = ls0.length >= 2 ? ls0 : domLeaves(html);
    const isTitle = (s) => /(^|_)(title|headline|product_name|section_title|claim)$/.test(s);
    const t = ls.find(l => isTitle(l.slot)) ?? ls[0];
    const rest = ls.filter(l => l !== t);
    const lead = rest.find(l => /(lead|subtitle|tagline|desc|body|note)$/.test(l.slot) && l.text.length > 8 && l.text !== t?.text);
    const kicker = rest.find(l => /(kicker|label|category|section_label)$/.test(l.slot));
    const pool = rest.filter(l => l !== lead && l !== kicker);
    const NUM = /^[~약+-]?\s*[$€£₩]?\s*[\d][\d,.]*\s*(%|[KMB]|만|억|천|원|명|개|배|곳|건|점|x|년|위|시간|분|일)?(\s*[\d][\d,.]*\s*(만|천|명|개)?)*\+?$/i; // 통화·K/M/B(#127 보정 1 — "$22.2K")
    const nums = [], items = [];
    for (let i = 0; i < pool.length; i++) {
        const a = pool[i], b = pool[i + 1];
        if (NUM.test(a.text.trim()) && b && !NUM.test(b.text.trim())) {
            nums.push({ v: a.text.trim(), label: b.text.trim() });
            i++;
            continue;
        }
        const m = a.text.match(/([\d][\d,.]*\s*(%|만|억|천|명|개|곳|건|점|배)+)/);
        if (m && a.text.length <= 40)
            nums.push({ v: m[1].trim(), label: a.text.replace(m[1], "").replace(/[,·:\s]+$/, "").trim() || a.slot });
        if (b && b.slot.replace(/\d+$/, "").replace(/_?[hp]$/, "") === a.slot.replace(/\d+$/, "").replace(/_?[hp]$/, "") && /h\d*$/.test(a.slot) && /p\d*$/.test(b.slot)) {
            items.push({ head: a.text, desc: b.text });
            i++;
            continue;
        }
        items.push({ head: a.text, desc: "" }); // 원문 그대로(#119 보정 5 — 옮긴 칸은 글을 자르지 않는다)
    }
    const photos = [...html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]).filter(s => !/^(data:|https?:)/i.test(s));
    // 인용 — 태그 속성의 따옴표가 아니라 보이는 글에 사람 말이 있을 때만(#127 보정 1 — class="…"가 인용으로 잡혔다)
    const quote = /<blockquote\b|data-slot\s*=\s*["'][^"']*(quote|testimonial|voice)[^"']*["']/i.test(html.slice(Math.max(0, html.search(/<section\b/i)))) || /[“"「][^”"」]{8,}[”"」]/.test(sectionText(html));
    return { title: t?.text ?? "", lead: lead?.text ?? "", kicker: kicker?.text ?? "", items: items.filter(x => x.head), nums, photos, quote };
}
const numOf = (s) => { const m = s.replace(/,/g, "").match(/[\d.]+/g) ?? []; let v = Number(m[0] ?? 0); if (/만/.test(s))
    v *= 10000; if (/억/.test(s))
    v *= 1e8; if (/천/.test(s) && !/만/.test(s))
    v *= 1000; return v; };
const unitOf = (s) => s.match(/(%|만 명|만|억|원|명|개|곳|건|점|배)\s*$/)?.[1] ?? "";
// 형태별 자리 데이터 — 장에 그 재료가 없으면 null(그 형태는 띠에 안 나온다)
function vizData(form, c) {
    const take = c.lead || c.title, its = c.items.length ? c.items : c.nums.map(n => ({ head: n.label, desc: n.v }));
    switch (form) {
        case "stat-stack": return c.nums.length >= 2 ? { type: form, takeaway: take, value: c.nums[0].v.replace(/\s*(명|개|곳|건)$/, ""), unit: unitOf(c.nums[0].v) === "%" ? "%" : "", label: c.nums[0].label, items: c.nums.slice(1, 4).map(n => ({ value: n.v, label: n.label })) } : null;
        case "pictogram":
        case "ratio-sentence": {
            const p = c.nums.find(n => /%/.test(n.v));
            if (!p)
                return null;
            const v = Math.round(numOf(p.v) / 10);
            return { type: form, takeaway: take, value: Math.max(0, Math.min(10, v)), total: 10, ...(form === "ratio-sentence" ? { unit: "명" } : {}), icon: "user", label: p.label };
        }
        case "ratio":
        case "proportion": {
            const u0 = unitOf(c.nums[0]?.v ?? ""), ns = c.nums.filter(n => numOf(n.v) > 0 && unitOf(n.v) === u0).slice(0, form === "ratio" ? 4 : 3); // 같은 단위끼리만 — 비율 막대는 % 일 때만
            if ((form === "ratio" && u0 !== "%") || !u0)
                return null; // 단위 없는 숫자(별점·개수 섞임)는 넓이로 비교하지 않는다
            return ns.length >= 2 ? { type: form, takeaway: take, labels: ns.map(n => n.label.slice(0, 16)), values: ns.map(n => numOf(n.v)), unit: unitOf(ns[0].v) } : null;
        }
        case "bar":
        case "line": {
            const ns = c.nums.filter(n => numOf(n.v) > 0).slice(0, 8);
            return ns.length >= 2 ? { type: form, takeaway: take, labels: ns.map(n => n.label.slice(0, 12)), series: [{ name: c.title.slice(0, 16) || "값", values: ns.map(n => numOf(n.v)) }] } : null;
        }
        case "steps-icon":
        case "path":
        case "ring-process":
        case "steps-line":
        case "step-bar": {
            const s = its.slice(0, 6);
            if (s.length < 3)
                return null;
            const ic = ["search", "map-pin", "route", "star", "check", "flag"];
            return { type: form, takeaway: take, items: s.map((x, i) => ({ label: x.head.slice(0, 24), ...(form === "steps-icon" ? { icon: ic[i], sub: x.desc.slice(0, 30) } : form === "path" || form === "step-bar" ? { sub: x.desc.slice(0, 30) } : {}) })), ...(form === "step-bar" ? { current: 0 } : {}), ...(form === "steps-line" ? { top: c.title.slice(0, 12) } : {}), ...(form === "ring-process" ? { center: c.title.slice(0, 16) } : {}) };
        }
        case "ribbon-timeline": {
            const s = its.slice(0, 8);
            if (s.length < 2)
                return null;
            return { type: form, takeaway: take, items: s.map((x, i) => ({ when: x.head.match(/(19|20)\d\d/)?.[0] ?? String(i + 1).padStart(2, "0"), label: x.head.replace(/(19|20)\d\d년?\s*/, "").slice(0, 24) || x.desc.slice(0, 24), weight: 1 })) };
        }
        case "before-after": {
            const s = its.slice(0, 8);
            if (s.length < 2)
                return null;
            const h = Math.ceil(s.length / 2);
            return { type: form, takeaway: take, before: { label: "지금", items: s.slice(0, h).map(x => x.head.slice(0, 30)) }, after: { label: "바꾼 뒤", items: s.slice(h).map(x => x.head.slice(0, 30)) } };
        }
        case "pull-quote":
        case "quote-minimal": {
            const q = [c.lead, ...c.items.map(x => x.desc || x.head)].filter(Boolean).sort((a, b) => b.length - a.length)[0] ?? c.title;
            return { type: form, text: q.slice(0, form === "quote-minimal" ? 60 : 120), who: c.kicker || "" };
        }
        case "grid-gallery": {
            const s = its.slice(0, 9);
            if (s.length < 4)
                return null;
            const ic = ["star", "heart", "users", "camera", "sun", "compass", "leaf", "gift", "smile"];
            return { type: form, takeaway: take, highlight: 0, items: s.map((x, i) => ({ icon: ic[i], label: x.head.slice(0, 16) })) };
        }
        case "venn": {
            const s = its.slice(0, 3);
            if (s.length < 2)
                return null;
            return { type: form, takeaway: take, sets: s.map(x => ({ label: x.head.slice(0, 14) })), center: c.title.slice(0, 16), items: s.map(x => x.desc).filter(Boolean).slice(0, 3) };
        }
        case "annotated": {
            if (!c.photos.length || c.items.length < 2)
                return null;
            const s = c.items.slice(0, 4);
            const pos = [[0.3, 0.3], [0.65, 0.45], [0.4, 0.7], [0.7, 0.8]];
            return { type: form, takeaway: take, src: c.photos[0], items: s.map((x, i) => ({ x: pos[i][0], y: pos[i][1], label: x.head.slice(0, 24) })) };
        }
        default: return null;
    }
}
// 블록 구성 — 항목 수를 장 내용에 맞춘다(자리 글이 남지 않게)
function specOf(form, c) {
    const n = c.items.length || c.nums.length;
    if (form === "rows")
        return n >= 2 ? `title,rows:${Math.min(5, n)}` : null;
    if (form === "agenda")
        return n >= 3 ? `title,agenda:${Math.min(6, n)}` : null;
    if (form === "table")
        return null; // 표는 비교 데이터(기존·우리)가 있어야 — 장에서 확실히 못 뽑으니 띠에 안 낸다
    if (form === "big-number")
        return c.nums.length ? "numeral,stat-stack" : null;
    if (form === "numeral")
        return "numeral";
    if (form === "collage")
        return c.photos.length ? "collage" : null;
    const b = FORM_BUILD[form];
    return b?.mode === "blocks" ? b.blocks : null;
}
// compose 뼈대(글 없음) 기억 — 같은 블록·무드·장 번호면 다시 받지 않는다(이 앱이 켜져 있는 동안, 120개까지)
const composeCache = new Map();
// 대안 하나 짓기 — 뼈대 + 글 꽂기(빈 자리는 비운다) + 자리 데이터 + 사진 + 같은 토큰. 상대 경로가 루트를 보게 <base href="../../">
async function build(id, file, html, form, c, no, of) {
    const spec = specOf(form, c);
    if (!spec)
        return null;
    const mood = /\bstyle-wa\b/.test(html) ? "wa" : "qi";
    const url = `${HUB}/api/layouts/compose?blocks=${encodeURIComponent(spec)}&mood=${mood}&no=${no}&of=${of}`;
    let body = composeCache.get(url);
    if (body === undefined) {
        const r = await http("GET", url).catch(() => null);
        if (!r || r.status !== 200)
            return null;
        body = r.body;
        if (composeCache.size > 120)
            composeCache.delete(composeCache.keys().next().value);
        composeCache.set(url, body);
    }
    let out = body;
    // 글 — 슬롯 이름으로: 제목·리드·머리말, 항목 h/p·w·값/이름 차례로
    const vals = new Map();
    let ii = 0, ni = 0;
    for (const l of leaves(out)) {
        const s = l.slot;
        if (/_title$/.test(s))
            vals.set(l.key, c.title);
        else if (/_lead$/.test(s))
            vals.set(l.key, c.lead);
        else if (/_kicker$/.test(s))
            vals.set(l.key, c.kicker);
        else if (/_(h|w)\d+$/.test(s))
            vals.set(l.key, c.items[ii]?.head ?? c.nums[ii]?.label ?? "");
        else if (/_p\d+$/.test(s)) {
            vals.set(l.key, c.items[ii]?.desc ?? c.nums[ii]?.v ?? "");
            ii++;
        }
        else if (/_v\d+$/.test(s))
            vals.set(l.key, c.nums[ni]?.v ?? "");
        else if (/_l\d+$/.test(s)) {
            vals.set(l.key, c.nums[ni]?.label ?? "");
            ni++;
        }
        else
            vals.set(l.key, "");
    }
    const ls = leaves(out).sort((a, b) => b.start - a.start);
    for (const l of ls)
        out = out.slice(0, l.start) + esc(vals.get(l.key) ?? "") + out.slice(l.end);
    // 그림 자리 데이터
    if (/\bdata-viz=/.test(out)) {
        const d = vizData(form === "big-number" ? "stat-stack" : form, c);
        if (!d && !["rows", "agenda", "numeral", "collage"].includes(form))
            return null;
        if (d)
            out = out.replace(/\bdata-viz\s*=\s*'[^']*'/, () => `data-viz='${JSON.stringify(d).replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/</g, "&lt;")}'`);
    }
    // 사진 — 빈 사진 칸에 지금 장의 사진을 차례로
    let pi = 0;
    out = out.replace(/(<figure\b[^>]*\bdata-slot\s*=\s*["'][^"']+["'][^>]*>)(\s*)(<\/figure>)/gi, (m, a, sp, z) => (c.photos[pi] ? `${a}<img src="${c.photos[pi++]}" alt="">${z}` : m));
    // 같은 토큰·글꼴(장의 생김새)
    for (const kind of ["tokens", "fonts"]) {
        const blk = html.match(new RegExp(`<style\\b[^>]*\\bdata-${kind}\\b[^>]*>[\\s\\S]*?<\\/style>`, "i"))?.[0], re = new RegExp(`<style\\b[^>]*\\bdata-${kind}\\b[^>]*>[\\s\\S]*?<\\/style>`, "i");
        if (blk)
            out = re.test(out) ? out.replace(re, () => blk) : out.replace(/<\/head>/i, () => `${blk}\n</head>`);
    }
    return out.replace(/<head>/i, '<head>\n<base href="../../">');
}
// 후보 — plan.json의 candidates(지금 형태 빼고 적합도 순), 없으면 증거 종류(장 내용으로 어림)의 표에서. 지을 수 있는 것만 · 3개까지
async function candidatesOf(id, file, html, c) {
    const plan = await readJson(id, ".dynapse/plan.json").catch(() => null);
    const pg = plan?.pages?.find(p => p.page === file);
    const lay = html.match(/<section\b[^>]*\bdata-layout\s*=\s*["']([a-z0-9-]+)/i)?.[1] ?? "";
    const byLayout = /process|steps|timeline|journey/.test(lay) ? "sequence" : /compare|versus/.test(lay) ? "comparison" : /quote|voice/.test(lay) ? "voice" : /gallery|team/.test(lay) ? "structure" : null;
    const kind = pg?.evidence?.kind ?? byLayout ?? (c.nums.length >= 2 ? "number" : /단계|순서|먼저|다음/.test(html) || c.items.length >= 3 ? "sequence" : c.items.length >= 2 ? "comparison" : "voice");
    const cur = pg?.form ?? null;
    const fromPlan = (pg?.candidates ?? []).filter(x => x.form !== cur).sort((a, b) => b.fit - a.fit).map(x => x.form);
    const table = (EVIDENCE_FORMS[kind] ?? []).filter(f => f !== cur);
    // 재료가 있는 형태만(#119 보정 5) — 인용은 장에 사람 말이 있을 때, 사진 형태는 사진이 있을 때
    const fits = (f) => (/quote/.test(f) ? c.quote : /photo|collage|annotated/.test(f) ? c.photos.length > 0 : true);
    // 이 작업에서 두 번 이상 고른 형태가 앞으로(#119 보정 9 §3 — 로컬 .dynapse/out/prefs.json, 서버 저장 없음)
    const fav = Object.entries((await readJson(id, PREFS).catch(() => null))?.forms ?? {}).filter(([f, n]) => n >= 2 && f !== cur).sort((a, b) => b[1] - a[1]).map(([f]) => f);
    const all = [...new Set([...fav, ...fromPlan, ...table, "rows", "big-number"])].filter(f => (BUILDABLE.has(f) || ["rows", "agenda", "big-number", "numeral", "collage"].includes(f)) && fits(f));
    return { forms: all, evidence: kind, cur };
}
// 취향·지표도 .dynapse/out/ — 무시 목록이라 커밋·동기화·업로드되지 않는다(.dynapse 루트 JSON은 작업 커밋에 들어가 서버로 간다)
const CACHE = ".dynapse/out/alt-cache.json", PREFS = ".dynapse/out/prefs.json", METRICS = ".dynapse/out/metrics.json";
const sha1 = async (t) => [...new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(t)))].map(b => b.toString(16).padStart(2, "0")).join("");
const today = () => new Date().toISOString().slice(0, 10);
async function bump(id, k) {
    const m = (await readJson(id, METRICS).catch(() => null)) ?? {};
    if (m.day !== today()) {
        m.day = today();
        m.pre = 0;
    }
    m[k] = (m[k] ?? 0) + 1;
    if (k === "pre")
        m.pre_total = (m.pre_total ?? 0) + 1;
    await wput(id, METRICS, JSON.stringify(m)).catch(() => { });
}
async function keyOf(id, html, forms) { return sha1(`${html}\n${(await wget(id, "tokens.css").catch(() => null)) ?? ""}\n${forms.join(",")}`); }
export async function makeAlts(id, file, o = {}) {
    const html = await wget(id, file);
    if (!html)
        return false;
    const c = extract(html);
    const { forms, evidence, cur } = await candidatesOf(id, file, html, c);
    const key = await keyOf(id, html, forms);
    const cache = (await readJson(id, CACHE).catch(() => null)) ?? { pages: {} };
    const hit = cache.pages[file];
    if (hit?.key === key) { // 적중 — 렌더 없이 바로
        if (!o.quiet) {
            await bump(id, "hit");
            await postChat(id, [{ role: "event", text: null, payload: { kind: "form-alts", ai: "dynapse", ...hit.p, cached: true } }]).catch(() => { });
        }
        return true;
    }
    if (!o.quiet)
        await bump(id, "miss");
    const order = (await readJson(id, ".dynapse/pages.json").catch(() => null)) ?? [file];
    const no = Math.max(1, order.indexOf(file) + 1), of = Math.max(no, order.length);
    const made = [];
    // 원래 글의 절반도 못 옮긴 대안(빈 틀)은 버린다 — 렌더 오류가 없어도(#119 보정 5)
    const chars = (h) => leaves(h).filter(l => !/page_no|brand|logo/.test(l.slot)).reduce((a, l) => a + l.text.length, 0) + [...h.matchAll(/\bdata-viz\s*=\s*'([^']*)'/g)].reduce((a, m) => a + (m[1].replace(/&[a-z#0-9]+;/gi, " ").match(/"[a-z_]+"\s*:\s*"([^"]*)"/gi) ?? []).filter(x => !/"(type|icon|src|unit|highlight)"/.test(x)).reduce((b, x) => b + (x.split(":").slice(1).join(":").length - 2), 0), 0);
    // 글 20자 미만(빈 틀)은 언제나 버린다(#127 보정 1)
    const chars2 = (h) => chars(h) || sectionText(h).replace(/\b\d+\s*\/\s*\d+\b/g, "").length; // 칸 없는 장은 보이는 글 길이로
    const base = chars2(html);
    for (const f of forms) {
        if (made.length >= 5 || o.abort?.())
            break;
        const h = await build(id, file, html, f, c, no, of).catch(() => null);
        if (!h)
            continue;
        const ch = chars2(h);
        if (ch < 20 || (base > 0 && ch < base * 0.5))
            continue;
        const alt = altName(file, f);
        await wput(id, alt, h);
        made.push({ form: f, file: alt });
    } // 5개까지 짓고, 렌더에서 넘침·겹침이 없는 3개만 띠에
    if (o.abort?.())
        return false;
    // "지금" 칸은 없다(#119 보정 10 — [원래대로]가 대신) — 대안만 렌더
    await wput(id, ".dynapse/thumbs.json", JSON.stringify({ files: made.map(m => m.file) }));
    const wd = await T().core.invoke("work_dir", { id });
    const r = made.length ? await exec("node", [".dynapse/verify.mjs"], undefined, wd).catch(() => null) : null;
    const line = (r?.stdout ?? "").trim().split("\n").pop() ?? "";
    let th = [];
    try {
        th = JSON.parse(line).thumbs ?? [];
    }
    catch { /* 예전 verify — 썸네일 없음 */ }
    const pngOf = (f) => th.find(t => t.file === f)?.png ?? null;
    const sizes = new Map((await T().core.invoke("work_files", { id }).catch(() => [])).map(f => [f.name, f.size]));
    const all = made.map(m => ({ form: m.form, label: FORM_KO[m.form] ?? m.form, html: m.file, png: pngOf(m.file), errors: th.find(t => t.file === m.file)?.errors ?? 0 })).filter(x => x.png && (sizes.get(x.png) ?? 99999) > 6000); // 거의 빈 그림(6KB 이하)은 띠에 내지 않는다
    const items = [...all.filter(x => !x.errors), ...all.filter(x => x.errors)].slice(0, 3);
    const p = { file, evidence, cur, items, ...(items.length < 2 ? { few: true } : {}) };
    // 색인 — 장 10개 넘으면 가장 오래된 장의 대안 파일을 비운다
    const c2 = (await readJson(id, CACHE).catch(() => null)) ?? { pages: {} };
    c2.pages[file] = { key, at: Date.now(), p, files: made.flatMap(m => [m.file, pngOf(m.file)].filter((x) => !!x)) };
    const old = Object.entries(c2.pages).sort((a, b) => a[1].at - b[1].at);
    while (old.length > 10) {
        const [f0, e] = old.shift();
        for (const x of e.files)
            await wput(id, x, "").catch(() => { });
        delete c2.pages[f0];
    }
    await wput(id, CACHE, JSON.stringify(c2)).catch(() => { });
    if (!o.quiet)
        await postChat(id, [{ role: "event", text: null, payload: { kind: "form-alts", ai: "dynapse", ...p } }]).catch(() => { });
    return true;
}
// 미리 만들기(#119 보정 9 §2) — 턴 끝 저장 뒤 유휴 8초가 지나면 이번 턴에 바뀐 장(최대 3장)의 대안을 미리 짓는다(AI 0 토큰, 렌더는 이 PC).
// 타이머 하나(주기 루프 아님) · 새 메시지·턴 시작이면 즉시 중단 · 하루 작업당 30장까지(넘으면 누를 때만) · 서버 호출 = compose GET(뼈대, 글 없음) 장당 ≤5, 기억한 뼈대는 다시 안 받는다(#115)
// 배터리 20% 미만으로 전원 없이 돌면 건너뜀 — 웹뷰가 배터리를 알려 줄 때만(Windows WebView2). macOS WKWebView는 알려 주지 않아 확인 없이 돈다
const pre = new Map();
export function cancelPrerender(id) { const x = pre.get(id); if (x) {
    clearTimeout(x.timer);
    x.abort = true;
    pre.delete(id);
} }
async function lowBattery() {
    const nav = navigator;
    if (!nav.getBattery)
        return false;
    const b = await nav.getBattery().catch(() => null);
    return !!b && !b.charging && b.level < 0.2;
}
export function schedulePrerender(id, files) {
    cancelPrerender(id);
    const want = [...new Set(files.filter(f => /^result-[a-z0-9-]+\.html$/.test(f)))].slice(0, 3);
    if (!want.length)
        return;
    const st = { timer: undefined, abort: false };
    st.timer = setTimeout(() => void (async () => {
        try {
            if (await lowBattery())
                return;
            for (const f of want) {
                if (st.abort)
                    return;
                const m = (await readJson(id, METRICS).catch(() => null)) ?? {};
                if (m.day === today() && (m.pre ?? 0) >= 30)
                    return;
                if (await makeAlts(id, f, { quiet: true, abort: () => st.abort }).catch(() => false))
                    await bump(id, "pre");
            }
        }
        finally {
            if (pre.get(id) === st)
                pre.delete(id);
        }
    })(), 8000);
    pre.set(id, st);
}
// [이 모양으로] — 고른 대안을 그 장으로(base 빼고) · 커밋 1 · plan.json의 형태도
export async function applyAlt(id, file, form, fresh = false) {
    // 본보기에서 고른 것(fresh)은 남은 옛 대안 파일을 쓰지 않는다 — 지금 장 내용으로 새로
    let h = fresh ? null : await wget(id, altName(file, form)).catch(() => null);
    if (!h) { // 본보기 칸에서 고름(#119 보정 9 §1) — 아직 이 장의 모양이 없으면 지금 짓는다
        const src = await wget(id, file);
        if (!src)
            return;
        const order = (await readJson(id, ".dynapse/pages.json").catch(() => null)) ?? [file];
        const no = Math.max(1, order.indexOf(file) + 1), of = Math.max(no, order.length);
        h = await build(id, file, src, form, extract(src), no, of).catch(() => null);
        if (!h) {
            await postChat(id, [{ role: "event", text: `이 장은 재료가 적어 ${FORM_KO[form] ?? form}(으)로 바꾸지 못했어요`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
            return;
        }
    }
    await wput(id, file, h.replace(/\n?<base href="\.\.\/\.\.\/">/, ""));
    const plan = await readJson(id, ".dynapse/plan.json").catch(() => null);
    const pg = plan?.pages?.find(p => p.page === file);
    if (pg && plan) {
        pg.form = form;
        await wput(id, ".dynapse/plan.json", JSON.stringify(plan, null, 2)).catch(() => { });
    }
    const pf = (await readJson(id, PREFS).catch(() => null)) ?? {};
    (pf.forms ??= {})[form] = (pf.forms[form] ?? 0) + 1;
    await wput(id, PREFS, JSON.stringify(pf)).catch(() => { });
    await repoCommit(id, `모양: ${FORM_KO[form] ?? form}`);
    await postChat(id, [{ role: "event", text: `${file.replace(/^result-|\.html$/g, "")} 모양을 ${FORM_KO[form] ?? form}(으)로 바꿨어요 · 되돌리기 ⌘Z`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
}
