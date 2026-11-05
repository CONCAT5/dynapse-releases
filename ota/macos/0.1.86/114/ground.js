const ORDER = ["gradient", "pattern", "texture"];
const tok = (n) => { const k = String(n ?? "").replace(/[^a-z-]/gi, ""); return `var(--color-semantic-${k === "accent" ? "accent-base" : k || "bg-surface"})`; };
const soft = (n, p = 22) => `color-mix(in srgb, ${tok(n)} ${p}%, var(--color-semantic-bg-surface, #fff))`;
const op = (v, d = 0.08) => Math.max(0.03, Math.min(0.14, typeof v === "number" ? v : d));
const ink = (o) => `color-mix(in srgb, var(--color-semantic-accent-base, #555) ${Math.round(o * 100)}%, transparent)`;
// 분위기 세트 → 사다리 칸(gradient → pattern → texture 순). 세트가 없거나 비면 기본 세 칸(옅은 그라데이션 · 점 · 종이결)
export function ladderOf(layers) {
    const xs = (layers ?? []).filter(l => ORDER.includes(l.layer)).sort((a, b) => ORDER.indexOf(a.layer) - ORDER.indexOf(b.layer));
    const out = [];
    for (const k of ORDER) {
        const hit = xs.find(l => l.layer === k);
        if (hit)
            out.push(hit);
    }
    const dflt = { gradient: { layer: "gradient", dir: "180deg", from: "bg-surface", to: "bg-base" }, pattern: { layer: "pattern", kind: "dots", opacity: 0.06 }, texture: { layer: "texture", kind: "paper", opacity: 0.08 } };
    for (const k of ORDER)
        if (!out.some(l => l.layer === k))
            out.push(dflt[k]);
    return out.sort((a, b) => ORDER.indexOf(a.layer) - ORDER.indexOf(b.layer));
}
const NOISE = (base, o) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='${base}' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ${o} 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>`)}")`;
function images(l) {
    if (l.layer === "gradient")
        return { img: `linear-gradient(${/^\d{1,3}deg$/.test(l.dir ?? "") ? l.dir : "180deg"}, ${soft(l.from)}, ${soft(l.to, 30)})` };
    const o = op(l.opacity), c = ink(o);
    if (l.layer === "texture")
        return { img: NOISE(l.kind === "grain" || l.kind === "noise" ? 0.9 : 0.55, Math.min(0.5, o * 3).toFixed(2)) };
    switch (l.kind) {
        case "stripes": return { img: `repeating-linear-gradient(135deg, ${c} 0 2px, transparent 2px 22px)` };
        case "grid": return { img: `linear-gradient(${c} 1px, transparent 1px), linear-gradient(90deg, ${c} 1px, transparent 1px)`, size: "48px 48px" };
        case "waves": return { img: `repeating-radial-gradient(circle at 0 100%, transparent 0 18px, ${c} 18px 20px)` };
        default: return { img: `radial-gradient(${c} 1.6px, transparent 1.8px)`, size: l.kind === "halftone" ? "14px 14px" : "26px 26px" };
    }
}
// rung칸까지 쌓은 CSS(1 = 첫 칸). 위 층이 앞에 온다(CSS background 목록은 앞이 위)
export function groundCss(ladder, rung, pseudo = "before") {
    const use = ladder.slice(0, Math.max(0, Math.min(ladder.length, rung))).map(images).reverse();
    if (!use.length)
        return "";
    const sizes = use.map(x => x.size ?? "auto");
    return `:where(section.slide){position:relative;isolation:isolate}section.slide::${pseudo}{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;background-image:${use.map(x => x.img).join(",")};background-size:${sizes.join(",")}}`;
}
const BLOCK = /<style\b[^>]*\bdata-ground\b[^>]*>[\s\S]*?<\/style>\s*/i;
// 장 하나에 바탕 층을 넣거나 바꾼다. 장이 이미 slide의 ::before·::after를 둘 다 쓰면 건드리지 않는다(null)
export function applyGround(html, ladder, rung) {
    const own = html.replace(BLOCK, "");
    const uses = (p) => new RegExp(`slide[^{}]*::?${p}\\b`, "i").test(own.replace(/<style\b[^>]*\bdata-ground\b[\s\S]*?<\/style>/gi, ""));
    const pseudo = !uses("before") ? "before" : !uses("after") ? "after" : null;
    if (!pseudo || !/<section\b[^>]*class="[^"]*\bslide\b/i.test(own))
        return null;
    const css = groundCss(ladder, rung, pseudo);
    if (!css)
        return removeGround(html);
    const tag = `<style data-ground="${rung}">${css}</style>\n`;
    return /<\/head>/i.test(own) ? own.replace(/<\/head>/i, `${tag}</head>`) : tag + own;
}
export const removeGround = (html) => html.replace(BLOCK, "");
export const groundRung = (html) => Number(html.match(/<style\b[^>]*\bdata-ground="(\d)"/i)?.[1] ?? 0);
// 편집 말(#328 ② — "배경 다듬어 줘·밀도 올려 줘") · 끄기("장식 빼") — 짧은 말만(긴 편집 문장은 AI 턴)
export const GROUND_UP = /^(?:(?:이\s*장|전체|덱)\s*)?(?:배경\s*(?:좀\s*)?(?:다듬어|채워|풍성하게)|밀도\s*(?:좀\s*)?(?:올려|높여|채워)|바탕\s*(?:좀\s*)?(?:다듬어|채워))\s*(?:줘|주세요|줄래|봐)?[.!~\s]*$/;
export const GROUND_OFF = /^(?:배경\s*)?(?:장식|바탕\s*층|배경\s*층)\s*(?:다\s*)?(?:빼|없애|지워|꺼)\s*(?:줘|주세요)?[.!~\s]*$/;
