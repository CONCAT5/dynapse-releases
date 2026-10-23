// 칸 글 계약(#275 ② — 대표 2026-10-22 "속도 먼저": 지금은 AI가 장 HTML을 통째로 써서 Claude 6장 266초·출력 3.2만 토큰). AI는 장 계획 + 칸 글 JSON만, 조립은 엔진(이 파일).
// 순수 모듈(Tauri 없음) — 앱(chat.ts)과 실측 스크립트(hub/scripts/bench-first.mts)가 같이 쓴다. 칸 = fill-core leaves(레이아웃 뼈대의 글자 잎, 상한 = 견본 글자 × 1.2 + 3)
import { applyFill, leaves } from "./fill-core.js";
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
{"layout":"<id>","variant":"<one of its variants or empty>","slots":{"<key>":"<text>"}}
Use only the layouts and keys below. Fill every key of the chosen layout from the user's text (never invent numbers, names or dates), within each key's character cap, plain text without markdown, emoji or line breaks. Layouts whose id starts with cover- are for page 01 only and closing- for page ${nn(L.of)} only. Avoid the same layout on consecutive pages when another fits.
When your pages are written, reply in Korean in one short line.]
Layouts (key≤max chars "sample"):
${o.menu}
`;
    }
    return `[Slots mode — the app builds every page; you write only the text. Do not write or edit any HTML, CSS or tokens file, do not open materials/, layouts.md or the skill bundles, and do not run verify: the app assembles, sizes, colours and checks each page the moment you write it.
Speed matters: your very first tool call writes ${slotFile("01")} (the cover) — do not plan the whole deck or think at length before it. Then write the remaining pages (${o.pages ? `about ${o.pages} in all` : "page count from the content"}: one point per body page, a closing last) as .dynapse/slot-02.json, slot-03.json, … in as few tool calls as your tools allow (several files in one call if you can), with no reading in between. Each file:
{"layout":"<id>","variant":"<one of its variants or empty>","slots":{"<key>":"<text>"}}
Use only the layouts and keys below. Fill every key of the chosen layout from the user's text (never invent numbers, names or dates), within each key's character cap, plain text without markdown, emoji or line breaks. A layout's "free-draw html" slot alone may take markup — "html":{"<slot>":"<one SVG or small HTML>"} — and a slot marked (required) must get it: colours only var(--color-semantic-…), text at least 26px, one accent colour, labels placed on the shapes (no legend), no shadow or gradient, everything inside the slot. Layouts whose id starts with cover- are for page 01 only and closing- for the last page only; body pages use the others. Avoid the same layout on consecutive pages when another fits. Photo slots are filled by the app.
When all pages are written, reply in Korean in one short line.]
Layouts (key≤max chars "sample"):
${o.menu}
`;
}
// 장 하나 조립 — 뼈대(허브 레이아웃 API, 장 번호·토큰·변형이 들어간 것) + 칸 글. 안 준 칸은 견본 글을 비운다(가짜 글이 남지 않게). 토큰은 잠근 덱 토큰으로, 판형은 카드면 data-format
export function assemble(skel, page, o = {}) {
    const ls = leaves(skel).filter(wordy), vals = {};
    for (const l of ls) {
        const v = page.slots?.[l.key];
        vals[l.key] = typeof v === "string" ? v : "";
    }
    // 빈 칸 = 보이지 않는 표시(U+2063)로 한 번에 갈아 끼운 뒤 지운다 — 자리(오프셋)가 어긋나지 않게
    let h = applyFill(skel, ls, Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, v.trim() ? v : "\u2063"]))).replace(/\u2063/g, "");
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
    return h;
}
// AI가 쓴 JSON(쓰는 중일 수 있다) — 모양이 맞을 때만
export function parseSlotPage(t, known) {
    try {
        const j = JSON.parse(t);
        return j && typeof j.layout === "string" && known.has(j.layout) && j.slots && typeof j.slots === "object" ? { layout: j.layout, variant: typeof j.variant === "string" ? j.variant : "", slots: Object.fromEntries(Object.entries(j.slots).filter(([, v]) => typeof v === "string")),
            ...(j.html && typeof j.html === "object" ? { html: Object.fromEntries(Object.entries(j.html).filter(([, v]) => typeof v === "string")) } : {}) } : null;
    }
    catch {
        return null;
    }
}
// 장 파일 이름은 순번만(레이아웃을 바꿔 다시 써도 같은 파일 — 앱엔 파일 지우기가 없다)
export const pageFile = (nn) => `result-${nn}.html`;
// 한 장 고치기 지시(#275 보정 2 ③) — 그 장 JSON만 · 같은 레이아웃이면 앱이 바뀐 칸만 지금 장에, 다른 레이아웃이면 그 장만 새로 조립
export function pageEditInstruction(file, nn, json, menu) {
    return `[Single-page slots edit — ${file} is built by the app from ${slotFile(nn)}. Change only that JSON, in one edit: its "slots" texts for wording, or "layout"/"variant" for another form (then fill every key of that layout). Do not open or edit the HTML, any other file or verify; the app rebuilds the page the moment you save. Keys within their character caps, the user's facts only.]\nCurrent ${nn}.json: ${json}\nLayouts (key≤max "sample"):\n${menu}\n`;
}
