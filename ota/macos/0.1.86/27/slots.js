// 칸 글 계약(#275 ② — 대표 2026-10-22 "속도 먼저": 지금은 AI가 장 HTML을 통째로 써서 Claude 6장 266초·출력 3.2만 토큰). AI는 장 계획 + 칸 글 JSON만, 조립은 엔진(이 파일).
// 순수 모듈(Tauri 없음) — 앱(chat.ts)과 실측 스크립트(hub/scripts/bench-first.mts)가 같이 쓴다. 칸 = fill-core leaves(레이아웃 뼈대의 글자 잎, 상한 = 견본 글자 × 1.2 + 3)
import { applyFill, leaves } from "./fill-core.js";
// 읽기 먼저(C3 #1 — 디냅스가 놓친 덩어리 8개가 전부 "읽기": 관계를 정하지 않고 레이아웃을 바로 골랐다). 장마다 내용 관계를 먼저, 레이아웃은 그 관계의 모양 안에서만.
// 관계 12개 = engine_analysis_layout 4-2. "구조" = 표지·마무리·섹션·안내(관계 칸 대신). 상자 셋(card-list·icon-row·body-series)은 구성·비교일 때만
export const RELATIONS = {
    "비교": ["report-table", "compare-two", "card-compare", "card-list", "icon-row", "body-series"],
    "위치": ["diagram-frame", "diagram-card", "annotated"],
    "범위·확장": ["rank-bars", "diagram-frame", "diagram-card"],
    "순서·시간": ["timeline", "steps-line", "date-strip", "calendar-month", "closure-notice", "hours-table"],
    "흐름·단계": ["process-steps", "step-bar", "steps-line", "journey-map"],
    "구성·비율": ["ratio-bar", "ratio-sentence", "small-multiples", "card-list", "icon-row", "body-series"],
    "변화": ["before-after", "price-cut", "explain-stat", "big-number", "data-texture"],
    "순위": ["rank-bars", "rows"],
    "원인·결과": ["cause-effect", "split-story", "compare-two"],
    "지역": ["map-directions", "annotated", "gallery-grid"],
    "인용": ["pull-quote", "quote-voice", "card-quote", "card-hook"],
    "한 숫자": ["stat-band", "big-number", "card-number", "explain-stat", "stat-grid", "price-cut"],
};
// "구조"는 표지·마무리만(C3 3차 ② — Q34 5회차 4장 "가격과 배송, 보관"이 구조로 와서 가격·배송·보관이 한 칸에 섞였다). 위치를 모르면(편집 한 장) 표지·마무리 레이아웃이면 맞음
export const relationOk = (relation, layout, pos) => !relation ? true : relation === "구조" ? (pos ? pos.first || pos.last : /^(cover|closing)-/.test(layout)) : (RELATIONS[relation] ?? []).includes(layout);
const relationLines = (menu) => {
    const has = (id) => menu.includes(`- ${id} (`);
    return Object.entries(RELATIONS).map(([r, ids]) => { const ok = ids.filter(has); return ok.length ? `${r}: ${ok.join(", ")}` : null; }).filter(Boolean).join("\n");
};
const READ_FIRST = (menu) => `For every page decide first what its content is — "relation", one of: 비교, 위치, 범위·확장, 순서·시간, 흐름·단계, 구성·비율, 변화, 순위, 원인·결과, 지역, 인용, 한 숫자 (구조 only for the first page and the closing page). A body page carries one relation; if its content has several (price comparison, delivery, storage and allergy), make separate pages. Then pick the layout only from that relation's list (구조 pages: cover-, closing-, section-, info-, contact and price layouts):
${relationLines(menu)}
Write "relation" and "emphasis" first in each page file. emphasis = the value the page is about when it is a number, date, time or distance (e.g. "2.5km", "토 8:00"); otherwise its title — put that value in the layout's biggest text key, not inside a sentence. In a ranking the first item is the strongest.
Subtitles, notes and bullet lines come only from sentences in the user's text; if the text has nothing for a key, leave that key empty — never write a linking or explaining sentence of your own.
Allergy, origin, storage, nutrition, price, period, legal and medical lines: copy the user's words exactly — never rephrase, shorten, soften or split them.
Every page shows one key point big (a deadline, headcount, rate or number): put it in the layout's big value slot, not inside a sentence. info-rows is for a list whose rows weigh the same; when a page has one key date or number, write that row first — the app makes it the big lead line. Keep condition words (추첨, 선착순, 앱 전용, 추정, 예시) next to their value, never in a footer.`;
const freeSlots = (skel) => [...skel.replace(/^[\s\S]*?(?=<section\b)/i, "").matchAll(/<[a-z0-9]+\b[^>]*\bdata-free-draw\b[^>]*\bdata-slot\s*=\s*["']([^"']+)["']|<[a-z0-9]+\b[^>]*\bdata-slot\s*=\s*["']([^"']+)["'][^>]*\bdata-free-draw\b/gi)].map(m => m[1] ?? m[2]);
// 칸 요소 안쪽 갈아 끼우기 — 같은 이름 태그를 깊이로 세어 짝 닫는 태그를 찾는다(안에 div가 겹쳐 있어도). open = 여는 태그를 바꾸는 함수
function replaceSlot(h, slot, inner, open = t => t) {
    const m = new RegExp(`<([a-z0-9]+)\\b[^>]*\\bdata-slot\\s*=\\s*["']${slot.replace(/[^a-z0-9_]/gi, "")}["'][^>]*>`, "i").exec(h);
    if (!m)
        return h;
    const tag = m[1].toLowerCase(), from = m.index + m[0].length, re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
    re.lastIndex = from;
    let depth = 1, end = -1;
    for (let t; (t = re.exec(h));) {
        if (!t[1] && /\/>$/.test(t[0]))
            continue;
        depth += t[1] ? -1 : 1;
        if (depth === 0) {
            end = t.index;
            break;
        }
    }
    if (end < 0)
        return h;
    return h.slice(0, m.index) + open(m[0]) + (inner ?? h.slice(from, end)) + h.slice(end);
}
// 자유 그림 HTML 거르기 — 스크립트·스타일 블록·이벤트 속성·javascript: 주소·외부 iframe/object 없음. 색값은 앱 colorPass가 토큰으로 바꾼다
export function cleanFreeHtml(h) {
    return h.replace(/<(script|style|iframe|object|embed|link|meta)\b[\s\S]*?(<\/\1\s*>|$)/gi, "").replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "").replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, "").slice(0, 8000);
}
// 칸 글 파일 = .dynapse/slot-NN.json(한 층 — 네이티브 경로 계약이 .dynapse 아래엔 photos·out·shots 폴더만 허락하고, 파일 목록도 .dynapse는 한 층만 본다)
export const slotFile = (nn) => `.dynapse/slot-${nn}.json`;
export const SLOT_FILE = /^\.dynapse\/slot-(\d{2})\.json$/;
// AI에게 줄 메뉴 — 레이아웃마다 한 줄: 역할 · 변형 · 칸 열쇠≤상한 "견본"(견본은 12자까지 — 칸의 쓰임만 알게)
// 글자·숫자가 없는 칸(비율 점 ●○ 같은 표시)은 AI 몫이 아니다 — 메뉴에서 빼고 조립 때 견본 그대로
const wordy = (l) => /[\p{L}\p{N}]/u.test(l.text);
export function slotMenu(xs) {
    return xs.map(x => ({ ...x, leaves: x.leaves.filter(wordy) })).filter(x => x.leaves.length).map(x => `- ${x.id} (${x.roles.join("/") || "any"}${x.variants.filter(Boolean).length ? `; variants ${x.variants.filter(Boolean).join("|")}` : ""}): ${x.leaves.map(l => `${l.key}≤${l.max} "${[...l.text].slice(0, 12).join("")}"`).join("; ")}${x.free?.length ? `; free-draw html: ${x.free.map(f => (x.leaves.some(l => l.slot === f) ? `${f} (or its keys)` : `${f} (required)`)).join(", ")}` : ""}`).join("\n");
}
// 자유 그림 칸도 글 칸 열쇠는 그대로(글로 채워도 된다) — 열쇠가 없는 칸(그림 몸)은 html이 꼭 있어야 한다(없으면 견본 그림을 비운다)
export const slotLayout = (id, roles, variants, skeleton) => { const free = freeSlots(skeleton); return { id, roles, variants, leaves: leaves(skeleton), ...(free.length ? { free } : {}) }; };
export function laneSplit(text, pages, lanes = 2) {
    const paras = text.split(/\n\s*\n/).map(x => x.trim()).filter(Boolean), per = Math.ceil(pages / lanes), out = [];
    for (let i = 0; i < lanes; i++) {
        const from = i * per + 1, to = Math.min(pages, (i + 1) * per);
        if (from > to)
            break;
        const a = Math.floor((paras.length * i) / lanes), b = Math.max(a, Math.floor((paras.length * (i + 1)) / lanes) - 1), cut = (t) => [...(t ?? "").replace(/\s+/g, " ")].slice(0, 24).join("");
        out.push({ from, to, of: pages, start: cut(paras[a]), end: cut(paras[b]) });
    }
    return out;
}
const nn = (n) => String(n).padStart(2, "0");
// 첫 턴 지시(영어 — AI 지시는 영어, 결과 글은 원고의 언어)
export function slotsInstruction(o) {
    if (o.lane) {
        const L = o.lane, first = L.from === 1, last = L.to === L.of;
        return `[Slots mode, parallel — the app builds every page; you write only the text, and another writer is doing the other pages at the same time. Do not write or edit any HTML, CSS or tokens file, do not open materials/, layouts.md or the skill bundles, and do not run verify.
The deck has ${L.of} pages. You write only pages ${nn(L.from)}–${nn(L.to)}${first ? " (01 is the cover)" : ""}${last ? ` (${nn(L.to)} is the closing)` : ""}, from the part of the user's text that begins "${L.start}" and ends "${L.end}"; read the whole text for context but do not cover the other part. Your very first tool call writes ${slotFile(nn(L.from))}; then write the rest of your pages in as few tool calls as your tools allow, with no reading in between. Each file:
{"relation":"<one of the relations>","emphasis":"<value or title>","layout":"<id>","variant":"<one of its variants or empty>","slots":{"<key>":"<text>"}}
Use only the layouts and keys below. Fill the keys of the chosen layout from the user's text (never invent numbers, names or dates; a key the text has nothing for stays empty), within each key's character cap, plain text without markdown, emoji or line breaks. Layouts whose id starts with cover- are for page 01 only and closing- for page ${nn(L.of)} only. Avoid the same layout on consecutive pages when another fits.
${READ_FIRST(o.menu)}
When your pages are written, reply in Korean in one short line.]
Layouts (key≤max chars "sample"):
${o.menu}
`;
    }
    return `[Slots mode — the app builds every page; you write only the text. Do not write or edit any HTML, CSS or tokens file, do not open materials/, layouts.md or the skill bundles, and do not run verify: the app assembles, sizes, colours and checks each page the moment you write it.
Speed matters: your very first tool call writes ${slotFile("01")} (the cover) — do not plan the whole deck or think at length before it. Then write the remaining pages (${o.pages ? `about ${o.pages} in all` : "page count from the content"}: one point per body page, a closing last) as .dynapse/slot-02.json, slot-03.json, … in as few tool calls as your tools allow (several files in one call if you can), with no reading in between. Each file:
{"relation":"<one of the relations>","emphasis":"<value or title>","layout":"<id>","variant":"<one of its variants or empty>","slots":{"<key>":"<text>"}}
Use only the layouts and keys below. Fill the keys of the chosen layout from the user's text (never invent numbers, names or dates; a key the text has nothing for stays empty), within each key's character cap, plain text without markdown, emoji or line breaks. A layout's "free-draw html" slot alone may take markup — "html":{"<slot>":"<one SVG or small HTML>"} — and a slot marked (required) must get it: colours only var(--color-semantic-…), text at least 26px, one accent colour, labels placed on the shapes (no legend), no shadow or gradient, everything inside the slot. Layouts whose id starts with cover- are for page 01 only and closing- for the last page only; body pages use the others. Avoid the same layout on consecutive pages when another fits. Photo slots are filled by the app.
${READ_FIRST(o.menu)}${o.detail ? `
This is one long 860-wide product detail page: each slot file is one section, stacked top to bottom in file order — about 5–7 sections, in this order as the user's text supports: hero (product name, one-line promise), points, what is in it / specs, price, delivery and notices, reviews, closing. One section per topic; skip a topic the text does not have.` : ""}
When all pages are written, reply in Korean in one short line.]
Layouts (key≤max chars "sample"):
${o.menu}
`;
}
// 장 하나 조립 — 뼈대(허브 레이아웃 API, 장 번호·토큰·변형이 들어간 것) + 칸 글. 안 준 칸은 견본 글을 비운다(가짜 글이 남지 않게). 토큰은 잠근 덱 토큰으로, 판형은 카드면 data-format
// 강조 뒤집힘 막기(#274 보정 6 ② — C3 Q31 4장: compare-two는 B쪽에 강조색을 고정해 두는데 1위를 A에 써서 2위가 더 강했다).
// B를 강조하는 두 칸 레이아웃에서 1위·강조 값이 A에만 있으면 A·B 글을 바꿔 넣는다(강조는 내용 순위를 따른다)
const ACCENT_B = new Set(["compare-two", "card-compare"]);
export function rankSafe(page) {
    if (!ACCENT_B.has(page.layout))
        return page;
    const side = (x) => Object.entries(page.slots ?? {}).filter(([k]) => k.startsWith(`compare_${x}_`)).map(([, v]) => v).join(" ");
    const A = side("a"), B = side("b"), top = (t) => /(^|[^0-9])1\s*위|첫째|1등/.test(t) || (!!page.emphasis && page.emphasis.length >= 2 && t.includes(page.emphasis));
    if (!(top(A) && !top(B)))
        return page;
    const sw = (k) => k.replace(/^compare_a_/, "compare_\u0000_").replace(/^compare_b_/, "compare_a_").replace(/^compare_\u0000_/, "compare_b_");
    return { ...page, slots: Object.fromEntries(Object.entries(page.slots).map(([k, v]) => [sw(k), v])), ...(page.html ? { html: Object.fromEntries(Object.entries(page.html).map(([k, v]) => [sw(k), v])) } : {}) };
}
// 칸 수 = 내용 수(#300 ① — C3 Q32 5~7장: 4단계 틀에 2개, 3칸 숫자 띠에 2개 → 숫자·틀만 있는 빈 칸). 같은 태그 항목이 둘 이상인 칸에서
// AI가 하나도 채우지 않은 항목은 뼈대에서 뺀다 — 마지막으로 남는 항목은 원래 마지막 항목의 모양을 쓴다(끝 강조 유지). 한 줄 격자(repeat(n,…))면 열 수도 k로
const VOID_T = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
function slotRange(h, slot) {
    const m = new RegExp(`<([a-z0-9]+)\\b[^>]*\\bdata-slot\\s*=\\s*["']${slot.replace(/[^a-z0-9_]/gi, "")}["'][^>]*>`, "i").exec(h);
    if (!m)
        return null;
    const tag = m[1].toLowerCase(), from = m.index + m[0].length, re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
    re.lastIndex = from;
    let depth = 1;
    for (let t; (t = re.exec(h));) {
        if (!t[1] && /\/>$/.test(t[0]))
            continue;
        depth += t[1] ? -1 : 1;
        if (depth === 0)
            return { open: m.index, from, to: t.index };
    }
    return null;
}
function kidsOf(h, from, to) {
    const out = [], re = /<!--[\s\S]*?-->|<(\/?)([a-z][a-z0-9-]*)\b[^>]*?(\/?)>/gi;
    re.lastIndex = from;
    let depth = 0, start = -1, tag0 = "";
    for (let m; (m = re.exec(h)) && m.index < to;) {
        if (!m[2])
            continue;
        const tag = m[2].toLowerCase();
        if (!m[1]) {
            if (depth === 0) {
                start = m.index;
                tag0 = tag;
            }
            if (m[3] || VOID_T.has(tag)) {
                if (depth === 0)
                    out.push({ from: start, to: re.lastIndex, tag });
                continue;
            }
            depth++;
        }
        else {
            depth--;
            if (depth === 0 && start >= 0) {
                out.push({ from: start, to: re.lastIndex, tag: tag0 });
                start = -1;
            }
        }
    }
    return out;
}
export function collapseItems(skel, page) {
    const all = leaves(skel), slotsOf = [...new Set(all.filter(l => /#\d+$/.test(l.key)).map(l => l.slot))];
    const conts = slotsOf.map(slot => ({ slot, r: slotRange(skel, slot) })).filter((x) => !!x.r).sort((a, b) => b.r.from - a.r.from);
    let out = skel, vals = { ...(page.slots ?? {}) };
    const collapsed = [];
    const done = [];
    for (const { slot, r } of conts) {
        if (page.html?.[slot] || done.some(d => d.open >= r.from && d.to <= r.to))
            continue;
        const L = all.filter(l => l.slot === slot && /#\d+$/.test(l.key)), kids = kidsOf(skel, r.from, r.to);
        if (kids.length < 2 || new Set(kids.map(k => k.tag)).size > 1)
            continue;
        const per = kids.map(k => L.filter(l => l.start >= k.from && l.end <= k.to));
        if (per.some(x => !x.length) || per.reduce((a, x) => a + x.length, 0) !== L.length)
            continue;
        // 숫자 칸(값 요소 class "v")에 숫자가 없으면(#294 보정 11 — C3 Q34 숫자 띠 셋째 칸 "화·금") 그 항목은 빈 것으로 본다 — 접힌다
        const isV = (l) => /\bclass\s*=\s*["'](?:[^"']*\s)?v(?:\s[^"']*)?["'][^>]*>\s*$/.test(skel.slice(Math.max(0, l.start - 200), l.start));
        const filled = per.map(x => x.some(l => (page.slots?.[l.key] ?? "").trim() !== "") && x.filter(isV).every(l => /\d/.test(page.slots?.[l.key] ?? ""))), n = kids.length, keep = filled.flatMap((f, i) => (f ? [i] : [])), k = keep.length;
        if (k === 0 || k === n)
            continue;
        const mark = keep.map((i, j) => (j === k - 1 && !filled[n - 1] && per[n - 1].length === per[i].length ? n - 1 : i));
        const sep = skel.slice(kids[0].to, kids[1].from), body = skel.slice(r.from, kids[0].from) + mark.map(i => skel.slice(kids[i].from, kids[i].to)).join(sep) + skel.slice(kids[n - 1].to, r.to);
        let open = skel.slice(r.open, r.from).replace(/>$/, ` data-n="${k}">`);
        // 한 줄 격자(이 레이아웃 CSS에 repeat(n, …)이 있다)면 열 수를 k로 — 2×n 격자는 n이 다르니 건드리지 않는다
        if (new RegExp(`repeat\\(\\s*${n}\\s*,`).test(skel))
            open = /\bstyle\s*=\s*"/.test(open) ? open.replace(/\bstyle\s*=\s*"/, `style="grid-template-columns:repeat(${k},minmax(0,1fr));`) : open.replace(/>$/, ` style="grid-template-columns:repeat(${k},minmax(0,1fr))">`);
        const nv = keep.flatMap(i => per[i].map(l => page.slots?.[l.key] ?? ""));
        const next = out.slice(0, r.open) + open + body + out.slice(r.to), nl = leaves(next).filter(l => l.slot === slot && /#\d+$/.test(l.key));
        if (nl.length !== nv.length)
            continue;
        out = next;
        for (const key of Object.keys(vals))
            if (key.startsWith(`${slot}#`))
                delete vals[key];
        nl.forEach((l, j) => { vals[l.key] = nv[j]; });
        collapsed.push({ slot, n, k });
        done.push({ open: r.open, to: r.to });
    }
    return { skel: out, page: { ...page, slots: vals }, collapsed };
}
// 원문 고정 문구(C3 3차 ① — Q34 5회차: "알레르기: 견과류 포함, 우유·대두 사용 시설에서 제조"가 "견과류가 들어 있어요. 우유·대두를 쓰는 곳에서 만들어요"로 바뀌었다).
// 알레르기·원산지·보관·영양·가격·기간·법적 고지·의료 안내가 든 원고 구절은 글자 그대로. AI가 쓴 칸 글이 그 구절을 옮긴 것(같은 낱말·숫자가 많이 겹침)인데 글자가 다르면 원문으로 되돌린다.
// 칸 글자 상한을 넘으면 되돌리지 않고 센다(자르면 뜻이 바뀐다)
const FIXED_CUE = /알레르기|알러지|원산지|보관|영양|성분|열량|kcal|칼로리|가격|\d[\d,]*\s*원|기간|유통기한|소비기한|까지|부터|~|고지|주의|경고|의료|진료|처방|복용|부작용|환불|교환|반품|약관|법/;
const toks = (t) => new Set((t.match(/\d[\d,.]*|[가-힣A-Za-z]{2,}/g) ?? []).map(w => w.replace(/(으로|에서|에게|까지|부터|처럼|이고|이며|입니다|합니다|해요|이에요|예요|을|를|이|가|은|는|의|로|에|와|과|도|만)$/, "")).filter(w => w.length >= 2 || /\d/.test(w)));
export function fixedClauses(raw) {
    return raw.replace(/^[\s\S]*?원고\s*:\s*/, "").split(/(?<=[.。!?])\s+|\n+/).map(c => c.trim().replace(/[.。]$/, "")).filter(c => c && FIXED_CUE.test(c))
        .map(c => { const m = c.match(/^([가-힣A-Za-z·\s]{1,8})\s*[:：]\s*(.+)$/); return m ? { label: m[1].trim(), value: m[2].trim() } : { label: null, value: c }; });
}
export function verbatimFix(page, raw, caps = {}) {
    if (!raw)
        return { page, fixed: [], over: [] };
    const cl = fixedClauses(raw);
    if (!cl.length)
        return { page, fixed: [], over: [] };
    const slots = { ...(page.slots ?? {}) }, fixed = [], over = [];
    for (const [k, t0] of Object.entries(slots)) {
        const t = (t0 ?? "").trim();
        if (t.length <= 6)
            continue;
        const tt = toks(t);
        if (!tt.size)
            continue;
        // 가장 많이 겹치는 구절 — 구절 낱말의 40% 이상이 이 칸에 있고, 구절의 숫자는 모두 이 칸에도
        let best = null;
        for (const c of cl) {
            const ct = toks(c.value), hit = [...ct].filter(w => tt.has(w)).length, nums = [...ct].filter(w => /\d/.test(w));
            const score = ct.size ? hit / ct.size : 0;
            if (score >= 0.4 && nums.every(n => tt.has(n)) && (!best || score > best.score))
                best = { value: c.value, score };
        }
        // AI 글이 원문 구절의 한 조각 그대로면(라벨을 따로 칸에 둔 "만 19~34세 …") 이미 원문이다 — 되돌리지 않는다(C3 6회차 Q35 "대상 대상 만 19~34세")
        if (!best || best.value === t || t.includes(best.value) || best.value.includes(t))
            continue;
        if (caps[k] && best.value.length > caps[k]) {
            over.push(k);
            continue;
        }
        // 원문 앞머리가 같은 장의 라벨 칸 글이면 뗀다(C3 10회차 "신청 | 신청 센터 홈페이지…" · 6회차 "대상 | 대상 만 19~34세")
        const labels = Object.entries(slots).filter(([kk, vv]) => kk !== k && vv && vv.length <= 8 && !/\d/.test(vv)).map(([, vv]) => vv.trim());
        const lead = labels.find(L => best.value.startsWith(`${L} `)), value = lead ? best.value.slice(lead.length + 1).trim() : best.value;
        if (value === t || t.includes(value) || value.includes(t))
            continue;
        slots[k] = value;
        fixed.push(k);
    }
    return { page: fixed.length ? { ...page, slots } : page, fixed, over };
}
// 숫자 덩어리 라벨에 원고의 방향 말(#300 ② — C3 Q32 4장 "1,840만 원 절감"이 큰 숫자 옆 "현재 사용량 기준 추정"만 남아 비용처럼 읽혔다):
// 그 숫자가 든 원고 구절에 절감·할인·증가… 가 있는데 숫자 덩어리(값 + 라벨 칸) 어디에도 없으면 라벨 칸 앞에 그 말을 붙인다
const DIR_WORDS = /절감|절약|할인|인하|인상|증가|감소|상승|하락|단축|무료|추가|적립|환급|개선|성장/;
export function statLabelFix(page, raw) {
    const v = page.slots?.stat_value?.trim();
    if (!raw || !v)
        return { page, fixed: null };
    const num = v.match(/\d[\d,.]*/)?.[0];
    if (!num)
        return { page, fixed: null };
    const clause = raw.split(/[.\n!?·•]|,\s|\(|\)/).find(c => c.includes(num)) ?? "", word = clause.match(DIR_WORDS)?.[0];
    if (!word)
        return { page, fixed: null };
    const PART = ["stat_label", "stat_change", "stat_caption", "stat_line"], block = [v, ...PART.map(k => page.slots?.[k] ?? "")].join(" ");
    if (block.includes(word))
        return { page, fixed: null };
    const k = PART.find(x => (page.slots?.[x] ?? "").trim());
    if (!k)
        return { page, fixed: null };
    return { page: { ...page, slots: { ...page.slots, [k]: `${word} · ${page.slots[k]}` } }, fixed: `${word}→${k}` };
}
// 요점 줄(C3 4차 ② — Q35: 신청 마감 날짜가 다섯 줄 중 하나로 같은 무게였다). info-rows에서 요점 값(날짜·숫자)이 든 줄을 맨 위로 올리고 .rows에 data-lead(첫 줄 값을 크게).
// 요점 = plan의 emphasis에 숫자가 있으면 그 숫자가 든 줄, 없으면 라벨이 마감·신청·접수·기간·일시·일정·가격·할인인 줄 중 값에 숫자가 있는 첫 줄
const LEAD_LABELS = ["마감", "신청", "접수", "기간", "일시", "일정", "날짜", "가격", "할인"];
export function leadRow(page) {
    if (page.layout !== "info-rows")
        return { page, lead: false };
    const s = page.slots ?? {}, n = Math.max(0, ...Object.keys(s).map(k => Number(k.match(/^info_rows#(\d+)$/)?.[1] ?? 0))), pairs = [];
    for (let i = 1; i + 1 <= n; i += 2)
        pairs.push([s[`info_rows#${i}`] ?? "", s[`info_rows#${i + 1}`] ?? ""]);
    const digits = (t) => t.match(/\d[\d,.]*/g) ?? [], em = digits(page.emphasis ?? "");
    let at = em.length ? pairs.findIndex(([, v]) => em.every(d => v.includes(d))) : -1;
    if (at < 0)
        for (const L of LEAD_LABELS) {
            at = pairs.findIndex(([k, v]) => k.includes(L) && /\d/.test(v));
            if (at >= 0)
                break;
        }
    if (at < 0)
        return { page, lead: false };
    const order = [pairs[at], ...pairs.filter((_, i) => i !== at)], slots = { ...s };
    order.forEach(([k, v], i) => { slots[`info_rows#${2 * i + 1}`] = k; slots[`info_rows#${2 * i + 2}`] = v; });
    return { page: { ...page, slots }, lead: true };
}
// 조건 낱말(C3 4차 ③ — Q35 "선착순 아님(추첨)"이 회색 꼬리말로 내려갔다): 꼬리말·메모 칸의 조건 조각을 원고에서 함께 나온 값 칸 옆으로 옮긴다
const COND = /추첨|선착순|앱\s*전용|추정|예시|예상|한정|조건|별도|부가세|VAT|1인당|1회/;
export function conditionNear(page, raw) {
    if (!raw)
        return { page, moved: [] };
    const slots = { ...(page.slots ?? {}) }, moved = [], clauses = raw.split(/(?<=[.。!?])\s+|\n+/).map(c => c.trim());
    const noteKeys = Object.keys(slots).filter(k => /(^|_)(footer|foot|note|notes|caption|fine|small)(_?\d*)$/.test(k) && slots[k]);
    for (const nk of noteKeys) {
        const frags = slots[nk].split(/(?<=[.。])\s*|\s*·\s*/).map(x => x.trim().replace(/[.。]$/, "")).filter(Boolean);
        let keep = [...frags];
        for (const fr of frags.filter(f => COND.test(f))) {
            const cl = clauses.find(c => c.includes(fr.replace(/[()]/g, "").slice(0, 4)) || (fr.match(COND)?.[0] && c.includes(fr.match(COND)[0])));
            if (!cl)
                continue;
            const tk = Object.keys(slots).find(k => k !== nk && !/title|headline|kicker|label|footer|foot|note/.test(k) && slots[k] && slots[k].length > 4 && cl.includes(slots[k].slice(0, Math.min(8, slots[k].length))));
            if (!tk || slots[tk].includes(fr))
                continue;
            slots[tk] = `${slots[tk]} · ${fr}`;
            keep = keep.filter(x => x !== fr);
            moved.push(`${fr}→${tk}`);
        }
        // 팔 거리 값(#301 보정 1 — Q35 "참가비 무료"가 회색 꼬리말로): 무료·할인·N%·N명·증정은 꼬리말에 두지 않는다 — info-rows면 빈 줄 자리에 "라벨 | 값"으로
        for (const fr of [...keep].filter(f => SELL.test(f) && !COND.test(f))) {
            if (page.layout !== "info-rows")
                continue;
            const n = Math.max(0, ...Object.keys(slots).map(k => Number(k.match(/^info_rows#(\d+)$/)?.[1] ?? 0)), 0), cap = Math.max(n, 10);
            let at = -1;
            for (let i = 1; i + 1 <= cap; i += 2)
                if (!(slots[`info_rows#${i}`] ?? "").trim() && !(slots[`info_rows#${i + 1}`] ?? "").trim()) {
                    at = i;
                    break;
                }
            if (at < 0)
                continue;
            const m = fr.match(/^(.{1,8}?)\s+(\S.*)$/), label = m ? m[1] : "", value = m ? m[2] : fr;
            if (!label)
                continue;
            slots[`info_rows#${at}`] = label;
            slots[`info_rows#${at + 1}`] = value;
            keep = keep.filter(x => x !== fr);
            moved.push(`${fr}→row`);
        }
        slots[nk] = keep.join(". ");
    }
    return { page: moved.length ? { ...page, slots } : page, moved };
}
const SELL = /무료|할인|\d+\s*%|\d+\s*명|증정|1\+1/;
// 요점 줄의 큰 값 = 날짜·숫자 조각만(#301 보정 1 — "11월 5일까지 센터 홈페이지 · 선착순 아님(추첨)" 전체가 두 줄로 커졌다): 나머지는 본문 크기로 그 아래
const LEAD_TOKEN = /\d{1,2}월\s*\d{1,2}일(?:\s*\([^)]{1,3}\))?(?:\s*(?:오전|오후)?\s*\d{1,2}(?::\d{2})?시?)?(?:\s*(?:까지|부터|마감))?|\d[\d,.]*\s*(?:원|명|%|개|회|일|시간|분|kg|g)(?:\s*(?:까지|부터|할인|무료))?|무료/;
export function leadSplit(h) {
    return h.replace(/(<[a-z0-9]+\b[^>]*\bdata-slot\s*=\s*["']info_rows["'][^>]*\bdata-lead\b[^>]*>[\s\S]*?<div class="row">\s*<b\b[^>]*>[^<]*<\/b>\s*<p\b[^>]*>)([^<]+)(<\/p>)/i, (_m, a, v, c) => {
        const t = v.match(LEAD_TOKEN)?.[0];
        if (!t)
            return `${a}<span class="lv">${v}</span>${c}`;
        const rest = v.replace(t, "").replace(/^[\s·,:\-—]+|[\s·,:\-—]+$/g, "").trim();
        return `${a}<span class="lv">${t.trim()}</span>${rest ? `<span class="lr">${rest}</span>` : ""}${c}`;
    });
}
// 요점 값을 크게(C3 4차 ① — 본문 속 날짜·숫자 요점이 본문 크기였다): 첫 결과에서 emphasis(숫자 있는 짧은 값)가 제목·값 칸이 아닌 글 안에 있으면 그 조각을 강조 모양(본문의 1.6배 · 강조색)으로
// C3 9회차 퇴행: "07:40" 속 "7:40"만 키워 "0"이 떨어졌고, 값뿐인 칩("9월 1일~9월 21일")을 또 키워 칩이 깨졌다 —
// 요점이 더 긴 글 속에 묻혀 있을 때만(그 요소 글이 요점보다 6자 이상 김) · 앞뒤가 숫자·콜론·점이 아닐 때만
export function emphLift(h, emphasis) {
    const e = (emphasis ?? "").trim();
    if (!e || e.length > 24 || !/\d/.test(e))
        return h;
    const sec0 = h.search(/<section\b/i);
    if (sec0 < 0)
        return h;
    let i = -1;
    for (let from = sec0; (i = h.indexOf(e, from)) >= 0; from = i + 1) {
        const b = h[i - 1] ?? "", a = h[i + e.length] ?? "";
        if (!/[\d:.,]/.test(b) && !/\d/.test(a))
            break;
    }
    if (i < 0)
        return h;
    const open = h.slice(0, i).match(/<([a-z0-9]+)\b([^>]*)>[^<]*$/i);
    if (!open)
        return h;
    const whole = (h.slice(i - (open[0].length - open[0].indexOf(">") - 1)).match(/^[^<]*/)?.[0] ?? "").trim();
    if (whole.length < e.length + 6)
        return h;
    if (/^h[1-3]$/i.test(open[1]) || /\bclass\s*=\s*["'](?:[^"']*\s)?v(?:\s|["'])|data-slot\s*=\s*["'][^"']*(title|headline|value|number|price)/i.test(open[2]) || /data-emph/.test(h))
        return h;
    return `${h.slice(0, i)}<b data-emph style="font-size:1.6em;line-height:1.15;font-weight:800;color:var(--color-semantic-accent-base)">${e}</b>${h.slice(i + e.length)}`;
}
export function assemble(skel0, page0, o = {}) {
    // 조립은 글을 자르지 않으니(C3 5차 ①) 원문 되돌리기도 길이 상한 없이
    const vf = verbatimFix(statLabelFix(rankSafe(page0), o.raw).page, o.raw).page;
    const ld = leadRow(conditionNear(vf, o.raw).page), c = collapseItems(skel0, ld.page), skel = c.skel, page = c.page;
    // 원고 글은 자르지 않는다(C3 5차 ① — 8회차 Q35 "…, 총 8회"가 "…, 총"으로 잘렸다): 칸 글자 상한은 AI에게 주는 안내일 뿐, 조립은 글을 다 넣는다.
    // 길면 줄을 감고, 넘치면 맞춤(줄 맞춤·크기)과 검사(overflow)가 본다 — "…"·잘라 내기 없음
    const ls = leaves(skel).filter(wordy).map(l => ({ ...l, max: Math.max(l.max, [...(page.slots?.[l.key] ?? "")].length + 1) })), vals = {};
    for (const l of ls) {
        const v = page.slots?.[l.key];
        vals[l.key] = typeof v === "string" ? v : "";
    }
    // 빈 칸 = 보이지 않는 표시(U+2063)로 한 번에 갈아 끼운 뒤 지운다 — 자리(오프셋)가 어긋나지 않게
    // 원고에 없어 비운 줄(C3 #4 채움 문구 금지)은 U+2064로 표시해 그 요소를 숨긴다 — 줄 수가 준다. 제목 칸만 예전대로(빈 채로 두고 뒤에서 채운다)
    let h = applyFill(skel, ls, Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, v.trim() ? v : /title|headline/.test(k) ? "\u2063" : "\u2064"]))).replace(/\u2063/g, "")
        .replace(/<([a-z0-9]+)\b([^>]*)>\u2064<\/\1>/gi, (_m, t, a) => /\bhidden\b/.test(a) ? `<${t}${a}></${t}>` : `<${t}${/\bstyle\s*=\s*"/.test(a) ? a.replace(/\bstyle\s*=\s*"/, 'style="display:none;') : `${a} style="display:none"`} data-slot-empty hidden></${t}>`).replace(/\u2064/g, "");
    // 자유 그림 칸 — 그 칸 안을 걸러진 HTML로 통째로(칸 요소와 data-free-draw는 그대로)
    for (const k of freeSlots(skel).filter(f => !page.html?.[f] && !ls.some(l => l.slot === f))) // 그림 몸에 html이 안 왔다 — 견본 그림을 비우고 빈 칸 표시(검사가 빈 글 칸으로 세지 않는다)
        h = replaceSlot(h, k, "", t => t.replace(/>$/, " data-slot-empty>"));
    for (const [k, v] of Object.entries(page.html ?? {})) {
        if (!freeSlots(skel).includes(k) || typeof v !== "string")
            continue;
        h = replaceSlot(h, k, cleanFreeHtml(v), t => t.replace(/>$/, " data-drawn>"));
    } // data-drawn = AI가 그린 칸(검사 대상)
    if (o.cover)
        h = h.replace(/<([a-z0-9]+)\b[^>]*\bdata-slot\s*=\s*["']page_no["'][^>]*>[^<]*<\/\1>/i, ""); // 표지엔 쪽 번호를 두지 않는다(브랜드 줄과 겹쳤다 · 빈 칸으로 남기면 빈 글자 칸)
    if (o.tokens)
        h = h.replace(/<style\b[^>]*\bdata-tokens\b[^>]*>[\s\S]*?<\/style\s*>/i, () => `<style data-tokens>\n${o.tokens}\n</style>`);
    // 카드 판형 — 레이아웃이 4:5 규칙(data-format="card45")을 가지면 그것, 없으면 1:1 규칙 + 높이만 1350(holdFormat과 같은 블록)
    // 상세페이지(#294 보정 9): 레이아웃의 detail 규칙(폭 860 · 높이 내용만큼)을 쓴다 — 크기 블록을 넣지 않는다
    if (o.format === "detail")
        h = h.replace(/(<section\b[^>]*\bclass\s*=\s*["'][^"']*\bslide\b[^"']*["'])/i, `$1 data-format="detail"`);
    else if (o.format) {
        const own45 = o.format === "card45" && /data-format\s*=\s*\\?["']card45/.test(skel.replace(/<section\b[\s\S]*$/i, ""));
        h = h.replace(/(<section\b[^>]*\bclass\s*=\s*["'][^"']*\bslide\b[^"']*["'])/i, `$1 data-format="${own45 ? "card45" : "card"}"`);
        if (o.format === "card45" && !own45)
            h = h.replace(/<\/head>/i, `<style data-format>section.slide:not(#fm),.slide:not(#fm){width:1080px;height:1350px}</style></head>`);
    }
    if (ld.lead)
        h = leadSplit(h.replace(/(<[a-z0-9]+\b[^>]*\bdata-slot\s*=\s*["']info_rows["'])/i, "$1 data-lead"));
    else if (o.first)
        h = emphLift(h, page.emphasis);
    return barLengths(unitOnce(h));
}
// 단위 한 번(#300 ③ — C3 Q32 2장 "64%%": 값 칸에 AI가 "64%"를 쓰고, 기호뿐이라 AI에게 주지 않은 단위 칸(stat_unit "%")은 견본 글 그대로 남았다).
// 값 글이 단위(숫자 아닌 글자)로 끝나면 짝 단위 칸(<접두>unit ↔ <접두>value)을 숨긴다
export function unitOnce(h) {
    return h.replace(/(<([a-z0-9]+)\b[^>]*\bdata-slot\s*=\s*["']([a-z0-9_]*?)unit["'][^>]*?)>([^<]*)<\/\2>/gi, (m, open, tag, pre, txt) => {
        if (/\bdata-slot-empty\b/.test(open) || !txt.trim())
            return m;
        const v = h.match(new RegExp(`data-slot\\s*=\\s*["']${pre}value["'][^>]*>([^<]*)<`, "i"))?.[1]?.trim() ?? "";
        if (!v || (/\d$/.test(v) && !v.endsWith(txt.trim())))
            return m;
        return `${open} style="display:none" data-slot-empty hidden></${tag}>`;
    });
}
// 막대 길이(C3 #3 — 구성 막대·순위 막대): data-bars="sum"이면 합에 대한 몫, "max"면 가장 큰 값에 대한 몫을 막대마다 --p(0~100)로.
// 값 = 그 data-bar 안(다음 data-bar 전까지) class "v" 요소의 첫 숫자. 숨긴 막대·숫자 없는 막대는 0
export function barLengths(h) {
    const num = (t) => { const m = t.replace(/<[^>]+>/g, "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/); return m ? Math.max(0, Number(m[0])) : 0; };
    const BAR = /<[a-z0-9]+\b[^>]*\bdata-bar(?=[\s>\/])[^>]*>/gi, open = /<([a-z0-9]+)\b[^>]*\bdata-bars\s*=\s*["'](sum|max)["'][^>]*>/gi;
    let out = "", at = 0;
    for (let m; (m = open.exec(h));) {
        const tag = m[1].toLowerCase(), from = m.index + m[0].length, re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
        re.lastIndex = from;
        let depth = 1, end = h.length;
        for (let t; (t = re.exec(h));) {
            if (!t[1] && /\/>$/.test(t[0]))
                continue;
            depth += t[1] ? -1 : 1;
            if (depth === 0) {
                end = t.index;
                break;
            }
        }
        const body = h.slice(from, end), tags = [...body.matchAll(BAR)];
        const vals = tags.map((t, i) => {
            if (/\bdata-slot-empty\b/.test(t[0]))
                return 0;
            const seg = body.slice(t.index + t[0].length, tags[i + 1]?.index ?? body.length);
            const v = seg.match(/<([a-z0-9]+)\b[^>]*\bclass\s*=\s*["'](?:[^"']*\s)?v(?:\s[^"']*)?["'][^>]*>([\s\S]*?)<\/\1>/i);
            return v ? num(v[2]) : 0;
        });
        const base = m[2].toLowerCase() === "sum" ? vals.reduce((x, y) => x + y, 0) : Math.max(0, ...vals);
        let k = 0;
        const body2 = body.replace(BAR, t => {
            const p = base ? Math.round(vals[k] / base * 1000) / 10 : 0;
            k++;
            const t2 = t.replace(/--p:[^;"']*;?/, "");
            return /\bstyle\s*=\s*"/.test(t2) ? t2.replace(/\bstyle\s*=\s*"/, `style="--p:${p};`) : t2.replace(/\s*\/?>$/, x => ` style="--p:${p}"${x}`);
        });
        out += h.slice(at, from) + body2;
        at = end;
        open.lastIndex = end;
    }
    return out + h.slice(at);
}
// AI가 쓴 JSON(쓰는 중일 수 있다) — 모양이 맞을 때만
export function parseSlotPage(t, known) {
    try {
        const j = JSON.parse(t);
        return j && typeof j.layout === "string" && known.has(j.layout) && j.slots && typeof j.slots === "object" ? { layout: j.layout, variant: typeof j.variant === "string" ? j.variant : "", slots: Object.fromEntries(Object.entries(j.slots).filter(([, v]) => typeof v === "string")),
            ...(j.html && typeof j.html === "object" ? { html: Object.fromEntries(Object.entries(j.html).filter(([, v]) => typeof v === "string")) } : {}),
            ...(typeof j.relation === "string" ? { relation: j.relation.slice(0, 12) } : {}), ...(typeof j.emphasis === "string" ? { emphasis: j.emphasis.slice(0, 40) } : {}) } : null;
    }
    catch {
        return null;
    }
}
// 장 파일 이름은 순번만(레이아웃을 바꿔 다시 써도 같은 파일 — 앱엔 파일 지우기가 없다)
export const pageFile = (nn) => `result-${nn}.html`;
// 한 장 고치기 지시(#275 보정 2 ③) — 그 장 JSON만 · 같은 레이아웃이면 앱이 바뀐 칸만 지금 장에, 다른 레이아웃이면 그 장만 새로 조립
export function pageEditInstruction(file, nn, json, menu) {
    return `[Single-page slots edit — ${file} is built by the app from ${slotFile(nn)}. Change only that JSON, in one edit: its "slots" texts for wording, or "layout"/"variant" for another form (keep "relation" and pick a layout that fits it unless the user names another form; fill its keys from the user's text and leave a key empty when the text has nothing for it). Do not open or edit the HTML, any other file or verify; the app rebuilds the page the moment you save. Keys within their character caps, the user's facts only.]\nCurrent ${nn}.json: ${json}\nLayouts (key≤max "sample"):\n${menu}\n`;
}
// 사진을 기다리며 바꿔 둔 변형(nophoto · data-variant-was)은 기다리는 칸(data-photo-wait)이 다 차면 원래 변형으로(#294 보정 9) — photo-runner setSlotImg가 쓴다
export function restoreWaitVariant(h) {
    if (!/\bdata-variant-was\s*=/.test(h) || /\bdata-photo-wait\b/.test(h))
        return h;
    return h.replace(/(<section\b[^>]*?)\s+data-variant\s*=\s*["']nophoto["']([^>]*?)\s+data-variant-was\s*=\s*["']([^"']*)["']/i, (_m, a, b, was) => `${a}${was ? ` data-variant="${was}"` : ""}${b}`);
}
