// 다른 모양 보기(#119 보정 4) — 보고 고르는 것: 그 장의 다른 모양 2~3개를 AI 턴 없이 결정적으로 만들어(compose 뼈대 + 지금 장의 글·숫자·사진 + 같은 토큰)
// verify 렌더러로 실제 썸네일을 찍고, 웹의 장 인스펙터 띠에 보낸다. 고르기 전엔 아무것도 바꾸지 않고 커밋도 없다. [이 모양으로]면 그 파일을 장으로 복사 → 커밋 1.
// 대안 파일은 .dynapse/out/alt--<장>--<형태>.html(커밋 안 함 · 네이티브 경로 규칙상 .dynapse/out 안), 썸네일은 같은 이름의 .png
import { HUB, api, exec, http, T } from "./main.js";
import { postChat, readJson, readTokens, repoCommit, wget, wput } from "./chat.js";
import { leaves } from "./fill-core.js";
import { COVERS, EVIDENCE_FORMS, FORM_BUILD, ROLE_FORMS, roleOf } from "./local-plan.js";
export const FORM_KO = { rows: "번호 줄", "stat-stack": "구분선 숫자", "big-number": "하나 크게", pictogram: "픽토그램", ratio: "비율 막대", "ratio-sentence": "문장형 비율", proportion: "크기 비교",
    "steps-icon": "아이콘 단계", "steps-line": "한 줄 단계", "step-bar": "지금 단계", path: "여정 길", "ring-process": "순환", "ribbon-timeline": "띠 연혁", gantt: "일정표", "before-after": "전후 비교", "pull-quote": "큰 인용",
    "quote-minimal": "한 줄 인용", "grid-gallery": "격자", venn: "벤", agenda: "목차", table: "비교 표", numeral: "큰 장 번호", collage: "콜라주", bar: "막대", line: "선", annotated: "번호 핀", "small-multiples": "작은 차트" };
// 역할 모양 이름(#119 보정 11 추가) — 채팅 줄에도 변주로 읽힌다("마무리 · 색 반전")
const COVER_KO = { "photo-line": "사진 한 줄", split: "반반", band: "사진 띠", "photo-centre": "사진 가운데", "colour-giant": "색면 큰 제목", baseline: "기준선", poster: "포스터", number: "숫자 표지" };
for (const c of COVERS) {
    FORM_KO[`cover-${c.k}`] = COVER_KO[c.k];
    for (const p of ["same", "invert", "swap", "crop"])
        FORM_KO[`closing-${c.k}-${p}`] = `마무리 · ${p === "same" ? "같은 자리 다른 문장" : p === "invert" ? "색 반전" : p === "swap" ? (c.photo ? "색면으로" : "사진 띠") : c.photo ? "다른 크롭" : "다른 자리"}`;
    FORM_KO[`section-${c.k}`] = `섹션 · ${c.k === "colour-giant" ? "색면 1/3" : c.photo ? "아래 사진 띠" : "회색 글자"}`;
}
Object.assign(FORM_KO, { "gallery-one-big": "1 크게", "gallery-two-col": "비대칭 둘", "photo-strip-text": "사진 띠 + 글", "photo-full-caption": "한 장 전면", "map-route": "지도 핀" });
Object.assign(FORM_KO, { "section-numeral": "섹션 · 큰 번호", "section-progress": "섹션 · 진행 목록", "section-title-min": "섹션 · 이름만" });
const GALLERY = ["gallery-one-big", "gallery-two-col", "photo-strip-text", "photo-full-caption", "map-route"]; // 사진 장(#119 보정 12) — 허브 compose gallery 블록
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
// 사진과 캡션(#119 보정 12) — figure의 figcaption, 아니면 사진 바로 뒤의 짧은 글(60자 이하·제목 아님), 아니면 사진만 든 상자 안의 짧은 글 하나. 사진 i ↔ 캡션 i
function photoCaps(html) {
    if (typeof DOMParser === "undefined")
        return [];
    const d = new DOMParser().parseFromString(html, "text/html"), sec = d.querySelector("section") ?? d.body, out = [];
    const short = (e) => { const t = (e?.textContent ?? "").replace(/\s+/g, " ").trim(); return e && !/^H[1-3]$/.test(e.tagName) && !e.querySelector("img") && t.length > 0 && t.length <= 60 ? t : ""; };
    for (const img of Array.from(sec.querySelectorAll("img"))) {
        const src = img.getAttribute("src") ?? "";
        if (!src || /^(data:|https?:)/i.test(src))
            continue;
        const fig = img.closest("figure"), host = fig ?? img.parentElement;
        let cap = fig ? short(fig.querySelector("figcaption")) : "";
        if (!cap)
            cap = short((fig ?? img).nextElementSibling);
        if (!cap && host && host !== sec && host.querySelectorAll("img").length === 1) {
            const txt = Array.from(host.children).filter(c => c !== img && c !== fig && !c.querySelector("img"));
            if (txt.length === 1)
                cap = short(txt[0]);
        }
        out.push({ src, cap });
    }
    return out;
}
const sectionText = (html) => html.slice(Math.max(0, html.search(/<section\b/i))).replace(/<(script|style|svg)\b[\s\S]*?<\/\1\s*>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
function extract(html) {
    const ls0 = leaves(html).filter(l => !/page_no|brand|logo/.test(l.slot)), ls = ls0.length >= 2 ? ls0 : domLeaves(html);
    const isTitle = (s) => /(^|_)(title|headline|product_name|section_title|claim)$/.test(s);
    const t = ls.find(l => isTitle(l.slot)) ?? ls.find(l => l.slot === "stat_line") ?? ls[0];
    const rest = ls.filter(l => l !== t);
    const lead = rest.find(l => /(lead|subtitle|tagline|desc|body|note)$/.test(l.slot) && l.text.length > 8 && l.text !== t?.text);
    const kicker = rest.find(l => /(kicker|label|category|section_label)$/.test(l.slot));
    const pc = photoCaps(html), capSet = new Set(pc.map(p => p.cap).filter(Boolean));
    // 큰 숫자 레이아웃은 값·단위·이름이 독립 칸이다. km를 이름으로 소비하지 않는다.
    const statValue = ls.find(l => l.slot === "stat_value");
    const statUnit = ls.find(l => l.slot === "stat_unit");
    const statLabel = ls.find(l => l.slot === "stat_label");
    const pool = rest.filter(l => !(statValue && (l === statValue || l === statUnit || l === statLabel)) && l !== lead && l !== kicker && !capSet.has(l.text) && !/(^|_)cap(tion)?\d*$/.test(l.slot)); // 캡션은 항목으로 세지 않는다(#119 보정 12)
    const NUM = /^[~약+-]?\s*[$€£₩]?\s*[\d][\d,.]*\s*(%|[KMB]|만|억|천|원|명|개|배|곳|건|점|x|년|위|시간|분|일)?(\s*[\d][\d,.]*\s*(만|천|명|개)?)*\+?$/i; // 통화·K/M/B(#127 보정 1 — "$22.2K")
    const nums = statValue ? [{ v: statValue.text + (statUnit?.text ?? ""), label: statLabel?.text ?? t?.text ?? "" }] : [], items = [];
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
    const photos = pc.length ? pc.map(p => p.src) : [...html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]).filter(s => !/^(data:|https?:)/i.test(s));
    const caps = pc.length ? pc.map(p => p.cap) : photos.map(() => "");
    // 인용 — 태그 속성의 따옴표가 아니라 보이는 글에 사람 말이 있을 때만(#127 보정 1 — class="…"가 인용으로 잡혔다)
    const quote = /<blockquote\b|data-slot\s*=\s*["'][^"']*(quote|testimonial|voice)[^"']*["']/i.test(html.slice(Math.max(0, html.search(/<section\b/i)))) || /[“"「][^”"」]{8,}[”"」]/.test(sectionText(html));
    // 표지 재료(#119 보정 11) — 날짜·발표자 줄, 연락처, 다음 행동 줄(칸 이름으로)
    const meta = ls.find(l => /(date|presenter|author|byline|meta|speaker|when|issuer)/.test(l.slot))?.text ?? "";
    const contact = ls.find(l => /(contact|email|phone|tel|address|url|site)/.test(l.slot))?.text ?? "";
    const line = ls.find(l => /(cta|action|next|line|button)/.test(l.slot) && l !== t)?.text ?? "";
    return { title: t?.text ?? "", lead: lead?.text ?? "", kicker: kicker?.text ?? "", items: items.filter(x => x.head && x.head !== meta && x.head !== contact && x.head !== line), nums, photos, caps, quote, meta, contact, line, secNo: 1, secList: [], stock: null };
}
const numOf = (s) => { const m = s.replace(/,/g, "").match(/[\d.]+/g) ?? []; let v = Number(m[0] ?? 0); if (/만/.test(s))
    v *= 10000; if (/억/.test(s))
    v *= 1e8; if (/천/.test(s) && !/만/.test(s))
    v *= 1000; return v; };
const unitOf = (s) => s.match(/(%|만 명|만|억|원|명|개|곳|건|점|배)\s*$/)?.[1] ?? "";
// 증거 종류(#119 보정 12) — 한 곳에서, 사진부터: 사진 ≥ 2 → place · 사진 1 + 사람 말 → voice · 숫자 ≥ 2 → number · 단계 말과 항목 ≥ 3 → sequence · 대비 말 → comparison · 항목 ≥ 3 → structure.
// 웹 띠의 본보기도 이 판단을 쓴다(앱이 early 이벤트로 보낸다). 캡션은 항목으로 세지 않는다(extract)
export function evidenceOf(c, html) {
    const t = sectionText(html);
    if (c.photos.length >= 2)
        return "place";
    if (c.photos.length === 1 && c.quote)
        return "voice";
    if (c.nums.length >= 1)
        return "number";
    if (/단계|순서|먼저|다음|절차|\bstep\b|→/i.test(t) && c.items.length >= 3)
        return "sequence";
    if (/\bvs\.?\b|전후|기존|우리|대비|before|after/i.test(t))
        return "comparison";
    if (c.items.length >= 3)
        return "structure";
    return c.photos.length ? "place" : c.quote ? "voice" : "structure";
}
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
    if (WILD[form])
        return form === "wild-number" ? (c.nums.length ? WILD[form].spec : null) : form === "wild-pair" ? (c.items.length >= 2 ? WILD[form].spec : null) : form === "wild-photo" ? (c.photos.length ? WILD[form].spec : null) : WILD[form].spec;
    if (form === "big-number")
        return c.nums.length === 1 ? "cover-number" : c.nums.length >= 2 ? "numeral,stat-stack" : null;
    if (form === "numeral")
        return "numeral";
    if (form === "collage")
        return c.photos.length ? "collage" : null;
    // 사진 장(#119 보정 12) — 사진 수로 거른다: 1 크게 ≥ 4 · 비대칭 = 3 이상 · 사진 띠 ≥ 2 · 한 장 전면 ≥ 1 · 지도 핀 = 사진 1 + 장소 이름 2 이상
    const P = c.photos.length;
    if (form === "gallery-one-big")
        return P >= 4 ? `gallery-one-big:${Math.min(6, P)}` : null;
    if (form === "gallery-two-col")
        return P >= 3 ? "gallery-two-col:3" : null;
    if (form === "photo-strip-text")
        return P >= 2 ? `photo-strip-text:${Math.min(4, P)}` : null;
    if (form === "photo-full-caption")
        return P >= 1 ? "photo-full-caption" : null;
    if (form === "map-route")
        return P >= 1 && c.items.length >= 2 && /도시|지역|장소|지점|센터|역|점\b|시$|군$|구$/.test(c.items.map(x => x.head).join(" ")) ? `map-route:${Math.min(5, c.items.length)}` : null;
    const b = FORM_BUILD[form];
    return b?.mode === "blocks" ? b.blocks : null;
}
// 본보기에도 실제 제작과 같은 재료 조건을 적용한다. 데이터 없는 형태는 누르기 전에 제외.
function canBuildForm(form, c) {
    const spec = specOf(form, c);
    if (!spec)
        return false;
    const plain = /^(title|numeral|rows|agenda|collage|cover-|section-|closing-|gallery-|photo-|map-route)/;
    const blocks = spec.split(",").map(b => b.split(":")[0]);
    return blocks.every(b => plain.test(b)) || vizData(form === "big-number" ? "stat-stack" : form, c) !== null;
}
// compose 뼈대(글 없음) 기억 — 같은 블록·무드·장 번호면 다시 받지 않는다(이 앱이 켜져 있는 동안, 120개까지)
const composeCache = new Map();
// 대안 하나 짓기 — 뼈대 + 글 꽂기(빈 자리는 비운다) + 자리 데이터 + 사진 + 같은 토큰. 상대 경로가 루트를 보게 <base href="../../">
async function build(id, file, html, form, c, no, of) {
    if (form === "wild-word" && c.title)
        c = { ...c, lead: c.title, title: keyWord(c.title) }; // 한 단어 — 제목의 핵심 낱말을 장 가득, 원래 제목은 부제로
    const spec = specOf(form, c);
    if (!spec || !canBuildForm(form, c))
        return null;
    const mood = /\bstyle-wa\b/.test(html) ? "wa" : "qi";
    // 덱 판형(#166 ① — 크기 없이 불러 카드 덱에 1600×900 장이 들어갔다): 이 장의 .slide 크기를 넘기고, 응답의 크기가 다르면 쓰지 않는다
    const sz = (h) => { const m = h.match(/\.slide(?:\[[^\]]*\])*\s*\{[^}]*?\bwidth\s*:\s*(\d{3,4})px[^}]*?\bheight\s*:\s*(\d{3,4})px/); return m ? `${m[1]}x${m[2]}` : "1600x900"; };
    const want = sz(html), [ww, hh] = want.split("x");
    const url = `${HUB}/api/layouts/compose?blocks=${encodeURIComponent(spec)}&mood=${mood}&no=${no}&of=${of}&w=${ww}&h=${hh}`;
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
    if (sz(body) !== want)
        return null;
    let out = body;
    // 글 — 슬롯 이름으로: 제목·리드·머리말, 항목 h/p·w·값/이름 차례로
    const vals = new Map();
    let ii = 0, ni = 0;
    for (const l of leaves(out)) {
        const s = l.slot;
        {
            const m = s.match(/^compare_\d+_(l|r)(h|p)$/);
            if (m) {
                const it = c.items[m[1] === "l" ? 0 : 1];
                vals.set(l.key, m[2] === "h" ? it?.head ?? "" : it?.desc ?? "");
                continue;
            }
        } // 짝 만들기(#119 보정 13)
        {
            const m = s.match(/^gallery_\d+_(cap|pin)(\d)$/);
            if (m) {
                const i = Number(m[2]) - 1;
                vals.set(l.key, m[1] === "cap" ? c.caps[i] ?? "" : c.items[i]?.head ?? "");
                continue;
            }
        } // 캡션은 사진을 따라(#119 보정 12)
        if (/^cover_\d+_/.test(s)) { // 역할 모양(#119 보정 11) — 제목 하나면 짓는다
            const k = s.replace(/^cover_\d+_/, ""), hi = k.match(/^h(\d)$/)?.[1];
            vals.set(l.key, k === "title" ? c.title : k === "lead" ? c.lead : k === "kicker" ? c.kicker : k === "meta" ? c.meta || (["big-number", "wild-number"].includes(form) ? [c.kicker, c.lead, ...c.items.map(x => [x.head, x.desc].filter(Boolean).join(" · "))].filter(Boolean).join(" · ") : "") : k === "contact" ? c.contact : k === "line" ? c.line || c.lead
                : k === "num" ? (["cover-number", "big-number", "wild-number"].includes(form) ? (c.nums.find(n => /[%만억배명원KMB]/.test(n.v)) ?? c.nums[0])?.v ?? "" : String(c.secNo).padStart(2, "0")) : hi ? ((form === "section-progress" ? c.secList[Number(hi) - 1] : c.items[Number(hi) - 1]?.head) ?? "") : "");
            continue;
        }
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
    // 사진이 없는 표지에 사진형을 낼 때(#119 보정 11)는 재고 사진 1장을 미리 넣어 보인다(data-stock — 고르면 앱이 받아 내려 그 칸에 둔다)
    let pi = 0;
    out = out.replace(/(<figure\b[^>]*\bdata-slot\s*=\s*["'][^"']+["'][^>]*>)(\s*)(<\/figure>|<figcaption\b)/gi, (m, a, sp, z) => (c.photos[pi] ? `${a}<img src="${c.photos[pi++]}" alt="">${z}` : c.stock && /cover_\d+_img/.test(a) ? `${a}<img src="${c.stock.url}" alt="" data-stock="${c.stock.id ?? ""}">${z}` : m));
    // 같은 토큰·글꼴(장의 생김새)
    for (const kind of ["tokens", "fonts"]) {
        const blk = html.match(new RegExp(`<style\\b[^>]*\\bdata-${kind}\\b[^>]*>[\\s\\S]*?<\\/style>`, "i"))?.[0], re = new RegExp(`<style\\b[^>]*\\bdata-${kind}\\b[^>]*>[\\s\\S]*?<\\/style>`, "i");
        if (blk)
            out = re.test(out) ? out.replace(re, () => blk) : out.replace(/<\/head>/i, () => `${blk}\n</head>`);
    }
    if (/-poster(-|$)/.test(form) && c.title.replace(/\s/g, "").length > 4)
        out = out.replace(/(<div\b[^>]*\bdata-block\s*=\s*["']cover_\d+["'])/, '$1 data-len="long"'); // 다섯 자 넘는 포스터 제목은 한 단계 작게
    if (form === "section-progress")
        out = out.replace(/(<div\b[^>]*\bdata-block\s*=\s*["']cover_\d+["'])/, `$1 data-current="${Math.min(6, c.secNo)}"`); // 지금 섹션만 진하게
    return out.replace(/<head>/i, '<head>\n<base href="../../">');
}
// 후보 — plan.json의 candidates(지금 형태 빼고 적합도 순), 없으면 증거 종류(장 내용으로 어림)의 표에서. 지을 수 있는 것만 · 3개까지
async function candidatesOf(id, file, html, c) {
    const plan = await readJson(id, ".dynapse/plan.json").catch(() => null);
    const pg = plan?.pages?.find(p => p.page === file);
    // 역할이 먼저(#119 보정 11) — 표지·섹션·마무리는 증거 표가 아니라 역할 표. 사진이 있으면 사진형 먼저, 포스터는 제목이 짧을 때만, 숫자 표지는 숫자가 있을 때만, 핵심 셋은 항목이 셋일 때만
    const order = ((await readJson(id, ".dynapse/pages.json").catch(() => null)) ?? []).filter(x => typeof x === "string");
    const role = roleOf(file, order, pg?.role);
    if (role !== "body") {
        const cur0 = pg?.form ?? null, cov = order[0] && order[0] !== file ? (await wget(id, order[0]).catch(() => null)) ?? "" : html;
        // 표지의 지금 모양(cover 블록 data-form, 예전 레이아웃 표지면 사진 유무) — 마무리·섹션은 여기서 파생(#119 보정 11 추가)
        const cf = cov.match(/data-block\s*=\s*["']cover_\d+["'][^>]*\bdata-form\s*=\s*["']cover-([a-z-]+)["']/i)?.[1];
        const coverPhotos = [...cov.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]).filter(x => !/^(data:|https?:)/i.test(x));
        const cv = COVERS.find(x => x.k === cf) ?? (coverPhotos.length ? COVERS[0] : COVERS[4]);
        if (role === "closing" && !c.photos.length)
            c.photos = coverPhotos; // 같은 사진 다른 크롭 — 마무리에 사진이 없으면 표지 사진
        const has = c.photos.length > 0, secs = order.filter(f => roleOf(f, order) === "section");
        const ok = (f) => f !== cur0 && (!/-poster(-|$)/.test(f) || (c.title.length <= 8 && c.title.trim().split(/\s+/).length <= 2)) && (!/-number(-|$)/.test(f) || c.nums.length > 0) && (f !== "section-progress" || secs.length >= 2);
        let pool;
        if (role === "cover")
            pool = COVERS.map(x => ({ f: `cover-${x.k}`, photo: x.photo })).sort((a, b) => Number(b.photo === has) - Number(a.photo === has)).map(x => x.f);
        else if (role === "closing") {
            const mine = ["same", "invert", cv.photo ? "crop" : "swap", cv.photo ? "swap" : "crop"].map(p => `closing-${cv.k}-${p}`);
            pool = [...mine, ...ROLE_FORMS.closing.map(x => x.form).filter(f => !mine.includes(f))];
        } // 표지 지금 모양의 짝 셋이 먼저
        else
            pool = [`section-${cv.k}`, "section-progress", "section-title-min", "section-numeral", ...COVERS.map(x => `section-${x.k}`)];
        if (role === "section") {
            c.secNo = Math.max(1, secs.indexOf(file) + 1);
            c.secList = await Promise.all(secs.slice(0, 6).map(async (f) => extract((await wget(id, f).catch(() => null)) ?? "").title.slice(0, 30)));
        }
        const fav = role === "cover" ? Object.entries((await readJson(id, PREFS).catch(() => null))?.forms ?? {}).filter(([f, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([f]) => f) : [];
        pool = [...new Set(pool)].filter(ok);
        return { forms: [...new Set([...fav.filter(f => pool.includes(f)), ...pool])], evidence: role, cur: cur0, role };
    }
    const lay = html.match(/<section\b[^>]*\bdata-layout\s*=\s*["']([a-z0-9-]+)/i)?.[1] ?? "";
    void lay;
    const kind = pg?.evidence?.kind ?? evidenceOf(c, html); // 계획의 판단이 먼저, 없으면 한 함수(#119 보정 12)
    const cur = pg?.form ?? null;
    const fromPlan = (pg?.candidates ?? []).filter(x => x.form !== cur).sort((a, b) => b.fit - a.fit).map(x => x.form);
    const table = (EVIDENCE_FORMS[kind] ?? []).filter(f => f !== cur);
    // 재료가 있는 형태만(#119 보정 5) — 인용은 장에 사람 말이 있을 때, 사진 형태는 사진이 있을 때
    const fits = (f) => (/quote/.test(f) ? c.quote : /photo|collage|annotated/.test(f) ? c.photos.length > 0 : true);
    // 이 작업에서 두 번 이상 고른 형태가 앞으로(#119 보정 9 §3 — 로컬 .dynapse/out/prefs.json, 서버 저장 없음)
    const fav = Object.entries((await readJson(id, PREFS).catch(() => null))?.forms ?? {}).filter(([f, n]) => n >= 2 && f !== cur).sort((a, b) => b[1] - a[1]).map(([f]) => f);
    const all = [...new Set([...fav, ...fromPlan, ...table, "rows", "big-number"])].filter(f => (BUILDABLE.has(f) || ["rows", "agenda", "big-number", "numeral", "collage", ...GALLERY].includes(f)) && fits(f) && canBuildForm(f, c));
    return { forms: all, evidence: kind, cur, role };
}
// 지금 모양 칸(#150 ③ — 대표: '거대 숫자'를 적용해 저장하면 띠에서 사라졌다) — 띠 첫 칸에 지금 모양(선택 표시) + [이전으로] = 그 모양을 넣기 전 판(applyAlt가 적어 둔 커밋)
const FORM_PREV = ".dynapse/out/form-prev.json";
const prevOf = async (id, file) => ((await readJson(id, FORM_PREV).catch(() => null)) ?? {})[file]?.sha ?? null;
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
async function keyOf(id, html, forms) { return sha1(`form-alts-v2\n${html}\n${(await readTokens(id).catch(() => null)) ?? ""}\n${forms.join(",")}`); }
// 확인(#119 보정 13) — 뻔한 대안은 띠에 내지 않는다. 가족 · 차이 점수(verify가 잰 서명) · 드문 것 먼저 · 한 칸은 프레임 수(다르게 보기). AI 없음
const FAM = {
    number: ["stat-stack", "big-number", "pictogram", "ratio", "proportion", "ratio-sentence", "small-multiples"],
    chart: ["bar", "line", "area", "slope", "donut"],
    flow: ["steps-icon", "steps-line", "step-bar", "path", "ring-process", "timeline", "ribbon-timeline", "flow", "gantt"],
    compare: ["before-after", "table", "matrix-2x2", "venn", "rows", "agenda", "layers", "grid-gallery"],
    photo: ["gallery-one-big", "gallery-two-col", "photo-strip-text", "photo-full-caption", "map-route", "annotated", "collage", "photo-full", "photo-headline"],
    type: ["pull-quote", "quote-minimal", "numeral", "colour-page"],
};
// 다르게 보기(research/references/frame_moves.md) — 형태가 아니라 보는 법: 거대 숫자(수 4) · 짝 만들기(수 11) · 사진이 말하게(수 7) · 한 단어(수 9)
const WILD = {
    "wild-number": { spec: "cover-number", fam: "type", base: "cover-number", ko: "다르게 보기 · 거대 숫자" },
    "wild-pair": { spec: "title,compare", fam: "compare", base: "before-after", ko: "다르게 보기 · 짝 만들기" },
    "wild-photo": { spec: "photo-full-caption", fam: "photo", base: "photo-full-caption", ko: "다르게 보기 · 사진이 말하게" },
    "wild-word": { spec: "cover-poster", fam: "type", base: "cover-poster", ko: "다르게 보기 · 한 단어" },
};
for (const [k, w] of Object.entries(WILD))
    FORM_KO[k] = w.ko;
const famOf = (f) => {
    if (!f)
        return "";
    if (WILD[f])
        return WILD[f].fam;
    for (const [k, v] of Object.entries(FAM))
        if (v.includes(f))
            return k;
    // verify가 잰 형태 이름(FORM_FN) — 지금 장의 가족
    if (/^chart:/.test(f))
        return "chart";
    if (/process|timeline|steps/.test(f))
        return "flow";
    if (/quote|text-only|numeral/.test(f))
        return "type";
    if (/big-number|stat/.test(f))
        return "number";
    if (/compare|card-grid|box-row|rows|table|agenda|gallery-grid/.test(f))
        return "compare";
    if (/photo|split|gallery|collage|annotated|map/.test(f))
        return "photo";
    return /^(cover|closing|section)-/.test(f) ? "type" : "";
};
// 차이 점수 — 주인공 칸 다름 +2 · 주인공 크기 20%p 이상 +1 · 사진 면적 25%p 이상 +1 · 거리 다름 +2 · 가족 다름 +2. 4점 미만은 겉보기 같은 장
export function diffScore(a, fa, b, fb) {
    return (a.cell !== b.cell ? 2 : 0) + (Math.abs(a.hero - b.hero) >= 20 ? 1 : 0) + (Math.abs(a.photo - b.photo) >= 25 ? 1 : 0) + (a.dist && b.dist && a.dist !== b.dist ? 2 : 0) + (fa && fb && fa !== fb ? 2 : 0);
}
const wildOf = (c, evidence) => evidence === "place" && c.photos.length ? "wild-photo" : c.nums.length ? "wild-number" : c.items.length === 2 ? "wild-pair" : c.photos.length ? "wild-photo" : "wild-word";
// 한 단어 — 제목에서 조사를 뗀 가장 긴 낱말(6자까지)
const keyWord = (t) => t.split(/\s+/).map(w => w.replace(/[.,!?·]+$/, "").replace(/(은|는|이|가|을|를|의|에|에서|도|로|으로|과|와|만|까지)$/, "")).filter(w => w.length >= 2 && w.length <= 6).sort((a, b) => b.length - a.length)[0] ?? t.slice(0, 4);
let weightsCache = null;
async function formWeights() {
    if (weightsCache && Date.now() - weightsCache.at < 3600_000)
        return weightsCache.w; // 서버도 1시간 캐시
    const r = await api("GET", "/api/forms/weights").catch(() => null);
    weightsCache = { at: Date.now(), w: r?.data?.weights ?? weightsCache?.w ?? {} };
    return weightsCache.w;
}
async function bumpDrop(id, why, n = 1) {
    if (!n)
        return;
    const m = (await readJson(id, METRICS).catch(() => null)) ?? {};
    m.drop = { ...(m.drop ?? {}), [why]: (m.drop?.[why] ?? 0) + n };
    await wput(id, METRICS, JSON.stringify(m)).catch(() => { });
}
// 사진이 없는 표지·섹션·마무리(#119 보정 11) — 사진형을 보이려고 재고 1장. 글은 안 보낸다(무드로만, #119 보정 9 §4)
async function addStock(id, html, c, forms) {
    if (c.photos.length || c.stock || !forms.some(f => Object.values(ROLE_FORMS).flat().find(x => x.form === f)?.photo))
        return;
    const mood = /\bstyle-wa\b/.test(html) ? "wa" : "qi";
    const r = await api("GET", `/api/recommend?work_id=${encodeURIComponent(id)}&slot=cover_image&mood=${mood}&k=1`).catch(() => null);
    const it = r?.data?.items?.[0];
    if (it?.url)
        c.stock = { url: it.url, id: it.asset_id ?? null };
}
export async function makeAlts(id, file, o = {}) {
    const html = await wget(id, file);
    if (!html)
        return false;
    // 불러온 원본 장(#130)은 다른 모양이 없다 — "다시 쓰기부터" 한 줄
    if (/<section\b[^>]*\bdata-import\s*=/i.test(html)) {
        if (!o.quiet)
            await postChat(id, [{ role: "event", text: null, payload: { kind: "form-alts", ai: "dynapse", file, evidence: "import", items: [] } }]).catch(() => { });
        return true;
    }
    const c = extract(html);
    const { forms, evidence, cur, role } = await candidatesOf(id, file, html, c);
    const key = await keyOf(id, html, forms);
    const cache = (await readJson(id, CACHE).catch(() => null)) ?? { pages: {} };
    const hit = cache.pages[file];
    if (hit?.key === key) { // 적중 — 렌더 없이 바로
        if (!o.quiet) {
            await bump(id, "hit");
            await postChat(id, [{ role: "event", text: null, payload: { kind: "form-alts", ai: "dynapse", ...hit.p, now: { png: hit.p.now?.png ?? null, prev: await prevOf(id, file) }, cached: true } }]).catch(() => { });
        }
        return true;
    }
    if (!o.quiet)
        await bump(id, "miss");
    // 판단을 먼저 웹에(#119 보정 12) — 띠의 본보기가 앱과 같은 증거 종류·후보로(짓기 전, 글 없이 형태 id와 종류만)
    if (!o.quiet)
        await postChat(id, [{ role: "event", text: null, payload: { kind: "form-alts", ai: "dynapse", file, evidence, cur, forms: forms.slice(0, 8), early: true } }]).catch(() => { });
    if (role !== "body")
        await addStock(id, html, c, forms);
    const order = (await readJson(id, ".dynapse/pages.json").catch(() => null)) ?? [file];
    const no = Math.max(1, order.indexOf(file) + 1), of = Math.max(no, order.length);
    const made = [];
    // 원래 글의 절반도 못 옮긴 대안(빈 틀)은 버린다 — 렌더 오류가 없어도(#119 보정 5)
    const chars = (h) => leaves(h).filter(l => !/page_no|brand|logo/.test(l.slot)).reduce((a, l) => a + l.text.length, 0) + [...h.matchAll(/\bdata-viz\s*=\s*'([^']*)'/g)].reduce((a, m) => a + (m[1].replace(/&[a-z#0-9]+;/gi, " ").match(/"[a-z_]+"\s*:\s*"([^"]*)"/gi) ?? []).filter(x => !/"(type|icon|src|unit|highlight)"/.test(x)).reduce((b, x) => b + (x.split(":").slice(1).join(":").length - 2), 0), 0);
    // 글 20자 미만(빈 틀)은 언제나 버린다(#127 보정 1)
    const chars2 = (h) => chars(h) || sectionText(h).replace(/\b\d+\s*\/\s*\d+\b/g, "").length; // 칸 없는 장은 보이는 글 길이로
    const base = chars2(html);
    // 역할 장은 제목 하나면 충분(#119 보정 11) — 본문 장만 옮긴 글 양을 본다
    // 본문 장(#119 보정 13): 드문 것 먼저(/api/forms/weights 높은 순) · 이 덱에서 쓴 형태와 기본 셋은 뒤로 · 가족마다 하나씩 먼저 지어 셋이 다른 가족이 되게 + 다르게 보기 한 칸
    let order2 = forms;
    if (role === "body") {
        const w = await formWeights(), plan = await readJson(id, ".dynapse/plan.json").catch(() => null);
        const used = new Set((plan?.pages ?? []).filter(p => p.page !== file).map(p => p.form).filter((x) => !!x)), DEF = ["grid-gallery", "rows", "big-number"];
        const rank = (f) => (DEF.includes(f) ? 2 : used.has(f) ? 1 : 0) * 10 - (w[f] ?? 1);
        const sorted = [...forms].sort((a, b) => rank(a) - rank(b)), firsts = [], seen = new Set();
        for (const f of sorted) {
            const fm = famOf(f) || f;
            if (!seen.has(fm)) {
                seen.add(fm);
                firsts.push(f);
            }
        }
        order2 = [...new Set([...firsts, ...sorted])];
    }
    const wild = role === "body" ? wildOf(c, evidence) : null;
    for (const f of order2) {
        if (made.length >= (role === "body" ? 6 : 5) || o.abort?.())
            break;
        const h = await build(id, file, html, f, c, no, of).catch(() => null);
        if (!h)
            continue;
        const ch = chars2(h);
        if (role === "body" ? ch < 20 || (base > 0 && ch < base * 0.5) : !c.title)
            continue;
        const alt = altName(file, f);
        await wput(id, alt, h);
        made.push({ form: f, file: alt });
    } // 5개까지 짓고, 렌더에서 넘침·겹침이 없는 3개만 띠에
    if (wild && !o.abort?.()) {
        const h = await build(id, file, html, wild, c, no, of).catch(() => null);
        if (h && chars2(h) >= 8) {
            const alt = altName(file, wild);
            await wput(id, alt, h);
            made.push({ form: wild, file: alt });
        }
    }
    if (o.abort?.())
        return false;
    // 지금 장도 같이 잰다(서명 — 차이 점수의 기준, 띠에는 안 나온다)
    const nowFile = altName(file, "now");
    if (role === "body")
        await wput(id, nowFile, html.replace(/<head>/i, '<head>\n<base href="../../">'));
    await wput(id, ".dynapse/thumbs.json", JSON.stringify({ files: [...(role === "body" ? [nowFile] : []), ...made.map(m => m.file)] }));
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
    const all = made.map(m => ({ form: m.form, label: FORM_KO[m.form] ?? m.form, html: m.file, png: pngOf(m.file), errors: th.find(t => t.file === m.file)?.errors ?? 0 })).filter(x => x.png && (role !== "body" || (sizes.get(x.png) ?? 99999) > 6000)); // 거의 빈 그림(6KB 이하)은 띠에 내지 않는다 — 여백이 모양인 역할 장은 빼고(#119 보정 11)
    let items = [...all.filter(x => !x.errors), ...all.filter(x => x.errors)].slice(0, 3);
    // 확인(#119 보정 13) — 지금 장과 차이 4점 미만·서로 4점 미만은 버리고, 셋은 서로 다른 가족(지금 장의 가족이 아닌 것 먼저), 세 번째는 다르게 보기
    const nowSig = th.find(t => t.file === nowFile)?.sig;
    if (role === "body" && nowSig) {
        const sigOf = (f) => th.find(t => t.file === f)?.sig, nowFam = famOf(cur) || famOf(nowSig.form);
        const drop = { score: 0, family: 0, render: made.length - all.length }; // render = 렌더 실패·빈 그림
        const scored = all.map(x => ({ ...x, fam: famOf(x.form), s: sigOf(x.html) })).filter(x => x.s).map(x => ({ ...x, score: diffScore(x.s, x.fam, nowSig, nowFam) }));
        const keep = [];
        for (const x of scored.sort((a, b) => Number(!!a.errors) - Number(!!b.errors) || b.score - a.score)) {
            if (x.score < 4 || keep.some(k => diffScore(k.s, k.fam, x.s, x.fam) < 4)) {
                drop.score++;
                continue;
            }
            if (keep.some(k => k.fam === x.fam)) {
                drop.family++;
                continue;
            }
            keep.push(x);
        }
        const wildIt = keep.find(x => WILD[x.form]), table = keep.filter(x => !WILD[x.form]).sort((a, b) => Number(a.fam === nowFam) - Number(b.fam === nowFam) || order2.indexOf(a.form) - order2.indexOf(b.form));
        const pick = [...table.slice(0, wildIt ? 2 : 3), ...(wildIt ? [wildIt] : [])];
        const hsh = (x) => `${x.cell}${Math.round(x.hero / 10)}${Math.round(x.photo / 25)}${x.dist?.[0] ?? "-"}`;
        items = pick.map(({ s: sg, score: _sc, ...x }) => ({ ...x, sig: hsh(sg) }));
        await bumpDrop(id, "score", drop.score);
        await bumpDrop(id, "family", drop.family);
        await bumpDrop(id, "render", drop.render);
    }
    const p = { file, evidence, cur, items, ...(items.length < 2 ? { few: true } : {}), now: { png: role === "body" ? pngOf(nowFile) : null, prev: await prevOf(id, file) } };
    // 색인 — 장 10개 넘으면 가장 오래된 장의 대안 파일을 비운다
    const c2 = (await readJson(id, CACHE).catch(() => null)) ?? { pages: {} };
    c2.pages[file] = { key, src: await sha1(html), at: Date.now(), p, files: [...made.map(m => m.file), ...(role === "body" ? [nowFile] : [])].flatMap(f => [f, pngOf(f)].filter((x) => !!x)) };
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
    {
        const head = await T().core.invoke("repo_head", { id }).catch(() => null); // [이전으로]의 판(#150 ③)
        if (head) {
            const m = (await readJson(id, FORM_PREV).catch(() => null)) ?? {};
            m[file] = { sha: head, form };
            await wput(id, FORM_PREV, JSON.stringify(m)).catch(() => { });
        }
    }
    // 본보기에서 고른 것(fresh)은 남은 옛 대안 파일을 쓰지 않는다 — 지금 장 내용으로 새로
    let h = fresh ? null : await wget(id, altName(file, form)).catch(() => null);
    if (!h) { // 본보기 칸에서 고름(#119 보정 9 §1) — 아직 이 장의 모양이 없으면 지금 짓는다
        const src = await wget(id, file);
        if (!src)
            return;
        const order = (await readJson(id, ".dynapse/pages.json").catch(() => null)) ?? [file];
        const no = Math.max(1, order.indexOf(file) + 1), of = Math.max(no, order.length);
        const c = extract(src), { role } = await candidatesOf(id, file, src, c);
        if (role !== "body")
            await addStock(id, src, c, [form]); // 섹션 번호·재고 사진(#119 보정 11)
        h = await build(id, file, src, form, c, no, of).catch(() => null);
        if (!h) {
            await postChat(id, [{ role: "event", text: `이 장은 재료가 적어 ${FORM_KO[form] ?? form}(으)로 바꾸지 못했어요`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
            return;
        }
    }
    await writeAlt(id, file, form, h);
    const pf = (await readJson(id, PREFS).catch(() => null)) ?? {};
    (pf.forms ??= {})[form] = (pf.forms[form] ?? 0) + 1;
    await wput(id, PREFS, JSON.stringify(pf)).catch(() => { });
    await repoCommit(id, `모양: ${FORM_KO[form] ?? form}`);
    await postChat(id, [{ role: "event", text: `${file.replace(/^result-|\.html$/g, "")} 모양을 ${FORM_KO[form] ?? form}(으)로 바꿨어요 · 되돌리기 ⌘Z`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
}
// 지은 모양을 장에 — 기준 경로를 빼고, <section>에 data-form(서버 L0·앱이 읽는다 — #127 보정 7), 언어판·plan.json 형태, 미리 넣은 재고 사진은 이 PC로 받아 내린다(커밋은 부르는 쪽)
async function writeAlt(id, file, form, h, fixed = false) {
    let out = h.replace(/\n?<base href="\.\.\/\.\.\/">/, "");
    // 제출용(지정 형태 — fixed)은 빈 글자 칸을 뺀다(#127 보정 7 — 짓기가 비워 둔 머리말·날짜 칸을 서버 L0가 "빈 글자 칸"으로 반려). 그림·사진 칸은 그대로
    if (fixed)
        for (let k = 0; k < 3; k++)
            out = out.replace(/<(p|span|small|b|strong|em|h[1-6]|li|div)\b([^>]*\bdata-slot\s*=\s*["'][^"']+["'][^>]*)>\s*<\/\1>/gi, (m, _t, a) => (/\bdata-viz\s*=|\bdata-kind\s*=\s*["']photo/i.test(a) ? m : ""));
    out = out.replace(/<section\b([^>]*)>/i, (_m, a) => `<section${/\bdata-form\s*=/.test(a) ? a.replace(/\bdata-form\s*=\s*["'][^"']*["']/, `data-form="${form}"`) : `${a} data-form="${form}"`}>`);
    await wput(id, file, out);
    {
        const { syncLangs } = await import("./chat.js");
        await syncLangs(id, [file]).catch(() => { });
    } // 언어판에도 바로(#119 보정 16 — 한국어판을 보며 고른 모양이 그 장에 안 보였다)
    const plan = await readJson(id, ".dynapse/plan.json").catch(() => null);
    const pg = plan?.pages?.find(p => p.page === file);
    if (pg && plan) {
        pg.form = WILD[form]?.base ?? form;
        if (fixed)
            pg.fixed = form;
        await wput(id, ".dynapse/plan.json", JSON.stringify(plan, null, 2)).catch(() => { });
    }
    else if (plan && fixed) {
        (plan.pages ??= []).push({ page: file, form, fixed: form });
        await wput(id, ".dynapse/plan.json", JSON.stringify(plan, null, 2)).catch(() => { });
    }
    h = out;
    // 재고 사진을 미리 넣은 사진형 표지(#119 보정 11) — 이 PC로 받아 내려 그 칸에 두고(swapPhoto), 그 칸의 사진 요청을 남긴다(사진 AI가 있으면 다음 턴에 내 사진으로)
    const st = h.match(/<figure\b[^>]*\bdata-slot\s*=\s*["'](cover_\d+_img)["'][^>]*>\s*<img\b[^>]*\bsrc\s*=\s*["'](https:[^"']+)["'][^>]*\bdata-stock\s*=\s*["']([^"']*)["']/i);
    if (st) {
        const { swapPhoto } = await import("./chat.js");
        await swapPhoto(id, file, st[1], st[2], st[3] || null).catch(() => { });
        const req = ((await readJson(id, ".dynapse/photo-requests.json").catch(() => null)) ?? []).filter(x => !(x.file === file && x.slot === st[1]));
        const title = extract(h).title.slice(0, 80);
        await wput(id, ".dynapse/photo-requests.json", JSON.stringify([...req, { file, slot: st[1], brief: `${form.startsWith("closing") ? "closing" : form.startsWith("section") ? "section" : "cover"} photo for: ${title}`, ratio: form === "cover-split" ? "4:5" : "16:9" }], null, 2)).catch(() => { });
    }
}
// 지정 형태 적용(#127 보정 7 — 제출 전 사다리) — 발주가 정한 형태로 그 장을 결정적으로 다시 짓는다(AI 0, 장의 글·숫자·사진 그대로). 재료가 모자라 못 지으면 false(부르는 쪽이 AI 장 턴 한 번). 커밋은 부르는 쪽
// 사진을 버리는 모양이면 짓지 않는다("photo") — 첫 카드 사진 필수(훅) 같은 다른 규칙과 부딪힌다(wrk_88a8…: 카드 1 = cover-baseline은 사진 없는 표지)
export async function buildAssigned(id, file, form) {
    const src = await wget(id, file);
    if (!src)
        return false;
    const order = (await readJson(id, ".dynapse/pages.json").catch(() => null)) ?? [file];
    const no = Math.max(1, order.indexOf(file) + 1), of = Math.max(no, order.length);
    const c = extract(src), { role } = await candidatesOf(id, file, src, c);
    if (role !== "body")
        await addStock(id, src, c, [form]);
    const h = await build(id, file, src, form, c, no, of).catch(() => null);
    if (!h)
        return false;
    const imgs = (x) => [...x.slice(Math.max(0, x.search(/<section\b/i))).matchAll(/<img\b[^>]*\bsrc\s*=\s*["'](?!https?:)[^"']+["']/gi)].length;
    if (imgs(src) > imgs(h))
        return "photo";
    await writeAlt(id, file, form, h, true);
    return true;
}
// 제출 전 채움 사다리 ②(#127 보정 5) — underfill인 장에 이미 지은(없으면 지금 짓는) 다른 모양을 하나씩 넣어 재 보고, 가장 채운 것을 남긴다(AI 0).
// measure = 그 장 하나만 리워드 검사 → 채움 %(underfill이 없으면 100). 나아지지 않으면 원래 장으로 되돌린다. 바꿨으면 plan.json 형태 + 커밋 1
export async function fillLadder(id, file, measure) {
    const orig = await wget(id, file);
    if (!orig)
        return { before: null, after: null, form: null };
    const before = await measure();
    // 이미 지은 대안이 지금 장에서 나온 것(src = 장 HTML의 sha1)이면 그대로, 아니면 지금 짓는다(적중이면 렌더 없이 끝남)
    let cache = (await readJson(id, CACHE).catch(() => null)) ?? { pages: {} };
    if (cache.pages[file]?.src !== await sha1(orig)) {
        await makeAlts(id, file, { quiet: true }).catch(() => false);
        cache = (await readJson(id, CACHE).catch(() => null)) ?? { pages: {} };
    }
    const alts = (cache.pages[file]?.files ?? []).filter(f => /\.html$/.test(f) && !/--now\.html$/.test(f));
    let best = { fill: before ?? 0, form: null, html: orig };
    for (const a of alts) {
        const h = await wget(id, a).catch(() => null);
        if (!h || !/<section\b/i.test(h))
            continue; // 비운 옛 대안(장 10개 넘어 지운 것)은 건너뜀
        const html = h.replace(/\n?<base href="\.\.\/\.\.\/">/, "");
        await wput(id, file, html);
        const f = await measure();
        if (f !== null && f > best.fill)
            best = { fill: f, form: a.match(/--([a-z0-9-]+)\.html$/)?.[1] ?? null, html };
        if (f !== null && f >= 100)
            break;
    }
    await wput(id, file, best.html);
    if (!best.form)
        return { before, after: before, form: null };
    const plan = await readJson(id, ".dynapse/plan.json").catch(() => null);
    const pg = plan?.pages?.find(p => p.page === file);
    if (pg && plan) {
        pg.form = WILD[best.form]?.base ?? best.form;
        await wput(id, ".dynapse/plan.json", JSON.stringify(plan, null, 2)).catch(() => { });
    }
    await repoCommit(id, `제출 전 모양: ${file.replace(/^result-|\.html$/g, "")} → ${FORM_KO[best.form] ?? best.form}`);
    return { before, after: best.fill, form: best.form };
}
