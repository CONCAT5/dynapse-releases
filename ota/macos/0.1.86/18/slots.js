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
export const relationOk = (relation, layout) => !relation || relation === "구조" ? true : (RELATIONS[relation] ?? []).includes(layout);
const relationLines = (menu) => {
    const has = (id) => menu.includes(`- ${id} (`);
    return Object.entries(RELATIONS).map(([r, ids]) => { const ok = ids.filter(has); return ok.length ? `${r}: ${ok.join(", ")}` : null; }).filter(Boolean).join("\n");
};
const READ_FIRST = (menu) => `For every page decide first what its content is — "relation", one of: 비교, 위치, 범위·확장, 순서·시간, 흐름·단계, 구성·비율, 변화, 순위, 원인·결과, 지역, 인용, 한 숫자 (cover, closing, section and info pages: 구조). Then pick the layout only from that relation's list (구조 pages: cover-, closing-, section-, info-, contact and price layouts):
${relationLines(menu)}
Write "relation" and "emphasis" first in each page file. emphasis = the value the page is about when it is a number, date, time or distance (e.g. "2.5km", "토 8:00"); otherwise its title — put that value in the layout's biggest text key, not inside a sentence. In a ranking the first item is the strongest.
Subtitles, notes and bullet lines come only from sentences in the user's text; if the text has nothing for a key, leave that key empty — never write a linking or explaining sentence of your own.`;
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
${READ_FIRST(o.menu)}
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
        const filled = per.map(x => x.some(l => (page.slots?.[l.key] ?? "").trim() !== "")), n = kids.length, keep = filled.flatMap((f, i) => (f ? [i] : [])), k = keep.length;
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
export function assemble(skel0, page0, o = {}) {
    const c = collapseItems(skel0, statLabelFix(rankSafe(page0), o.raw).page), skel = c.skel, page = c.page;
    const ls = leaves(skel).filter(wordy), vals = {};
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
    if (o.format) {
        const own45 = o.format === "card45" && /data-format\s*=\s*\\?["']card45/.test(skel.replace(/<section\b[\s\S]*$/i, ""));
        h = h.replace(/(<section\b[^>]*\bclass\s*=\s*["'][^"']*\bslide\b[^"']*["'])/i, `$1 data-format="${own45 ? "card45" : "card"}"`);
        if (o.format === "card45" && !own45)
            h = h.replace(/<\/head>/i, `<style data-format>section.slide:not(#fm),.slide:not(#fm){width:1080px;height:1350px}</style></head>`);
    }
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
