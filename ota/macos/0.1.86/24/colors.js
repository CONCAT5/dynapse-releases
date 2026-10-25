// 색은 토큰으로만(#274 ① — 대표 2026-10-22 20:50: 지시가 없으면 Claude가 미색 바탕 + 붉은·흙빛 강조나 보라로 몰린다). AI 0 · 장 HTML 글자만 바꾼다.
// ① 토큰 밖 색값(AI가 쓴 <style>·<style data-free>·style="" · SVG fill/stroke) → 이 장 <style data-tokens>의 가장 가까운 --color-* (Lab ΔE) · 투명도가 있으면 color-mix
// ② 잠근 덱(.dynapse/palette.json)이면 레이아웃 자기 무드 블록(.style-qi · .style-wa · :root)의 --color-* 선언을 뺀다 — 레이아웃 CSS가 토큰 뒤에 와서 팔레트를 기본 회색·세이지로 덮었다
// 예외: var(…) 폴백 · url(…) · data-* 블록(토큰·브랜드·글꼴·팩·앱 것) · html/body 바깥 틀 · 무채색 그림자·덧막(투명도) · 공지 종류 색(allow) · 앱이 그린 SVG(QR·차트)
const NAMED = { white: "#ffffff", black: "#000000", red: "#ff0000", blue: "#0000ff", green: "#008000", orange: "#ffa500", purple: "#800080", pink: "#ffc0cb", yellow: "#ffff00",
    navy: "#000080", teal: "#008080", gray: "#808080", grey: "#808080", beige: "#f5f5dc", ivory: "#fffff0", gold: "#ffd700", silver: "#c0c0c0", brown: "#a52a2a", maroon: "#800000", crimson: "#dc143c",
    coral: "#ff7f50", salmon: "#fa8072", tomato: "#ff6347", olive: "#808000", lime: "#00ff00", aqua: "#00ffff", cyan: "#00ffff", magenta: "#ff00ff", indigo: "#4b0082", violet: "#ee82ee",
    lavender: "#e6e6fa", khaki: "#f0e68c", tan: "#d2b48c", wheat: "#f5deb3", linen: "#faf0e6", whitesmoke: "#f5f5f5", gainsboro: "#dcdcdc", lightgray: "#d3d3d3", lightgrey: "#d3d3d3", darkgray: "#a9a9a9",
    darkgrey: "#a9a9a9", dimgray: "#696969", slategray: "#708090", darkblue: "#00008b", darkgreen: "#006400", darkred: "#8b0000", skyblue: "#87ceeb", royalblue: "#4169e1", steelblue: "#4682b4",
    firebrick: "#b22222", sienna: "#a0522d", chocolate: "#d2691e", peru: "#cd853f", seagreen: "#2e8b57", forestgreen: "#228b22", hotpink: "#ff69b4", plum: "#dda0dd", orchid: "#da70d6", turquoise: "#40e0d0" };
const COLOR_PROP = /^(color|background|background-color|background-image|border|border-(?:top|right|bottom|left|block|inline)(?:-color)?|border-color|outline|outline-color|fill|stroke|box-shadow|text-shadow|text-decoration|text-decoration-color|caret-color|column-rule|column-rule-color|stop-color|flood-color|lighting-color|accent-color|-webkit-text-stroke|-webkit-text-stroke-color|-webkit-text-fill-color|filter|scrollbar-color)$/i;
const LIT = new RegExp(`#[0-9a-f]{3,8}\\b|rgba?\\([^()]*\\)|hsla?\\([^()]*\\)|\\b(?:${Object.keys(NAMED).join("|")})\\b`, "gi");
export function parseColor(s) {
    const t = s.trim().toLowerCase();
    let m;
    if (NAMED[t])
        return parseColor(NAMED[t]);
    if ((m = t.match(/^#([0-9a-f]{3,8})$/))) {
        let x = m[1];
        if (x.length === 3 || x.length === 4)
            x = x.split("").map(c => c + c).join("");
        if (x.length !== 6 && x.length !== 8)
            return null;
        return { r: parseInt(x.slice(0, 2), 16), g: parseInt(x.slice(2, 4), 16), b: parseInt(x.slice(4, 6), 16), a: x.length === 8 ? parseInt(x.slice(6, 8), 16) / 255 : 1 };
    }
    const al = (v) => (v === undefined ? 1 : v.endsWith("%") ? parseFloat(v) / 100 : parseFloat(v));
    if ((m = t.match(/^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/))) {
        const c = (v) => (v.endsWith("%") ? parseFloat(v) * 2.55 : parseFloat(v));
        return { r: c(m[1]), g: c(m[2]), b: c(m[3]), a: al(m[4]) };
    }
    if ((m = t.match(/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/))) {
        const h = +m[1] % 360, sa = +m[2] / 100, l = +m[3] / 100, k = (n) => (n + h / 30) % 12, f = (n) => l - sa * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
        return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255, a: al(m[4]) };
    }
    return null;
}
const lab = ({ r, g, b }) => {
    const n = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const [R, G, B] = [n(r), n(g), n(b)];
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116), x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047), y = f(R * 0.2126 + G * 0.7152 + B * 0.0722), z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
};
const neutral = (c) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) <= 3;
const TOK = /<style\b[^>]*\bdata-tokens\b[^>]*>([\s\S]*?)<\/style\s*>/i;
// 토큰 블록의 색 변수(마지막 선언이 이긴다) — semantic이 있으면 그것만
export function tokenVars(tok) {
    const m = new Map();
    for (const x of tok.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--color-[\w-]+)\s*:\s*([^;}]+)/g)) {
        const c = parseColor(x[2]);
        if (c && c.a === 1)
            m.set(x[1], c);
    }
    const all = [...m].map(([name, c]) => ({ name, c, L: lab(c) })), sem = all.filter(v => v.name.startsWith("--color-semantic-"));
    return sem.length ? sem : all;
}
// var(…)·url(…)(괄호 중첩)을 가린다 — 그 안의 색은 폴백·파일 이름이다
const mask = (v) => {
    const out = [];
    let s = v, i;
    while ((i = s.search(/\b(?:var|url)\(/i)) >= 0) {
        let d = 0, j = s.indexOf("(", i);
        for (; j < s.length; j++) {
            if (s[j] === "(")
                d++;
            else if (s[j] === ")" && --d === 0)
                break;
        }
        out.push(s.slice(i, j + 1));
        s = `${s.slice(0, i)}\u0000${out.length - 1}\u0000${s.slice(j + 1)}`;
    }
    return { s, back: (t) => t.replace(/\u0000(\d+)\u0000/g, (_m, k) => out[Number(k)]) };
};
// 장 배경 그라데이션 → 첫 색 한 면(#274 ② — AI 기본색: 보라→파랑 바탕). 글 뒤 덧막(shade·overlay·scrim)은 그대로
const PAGE_SEL = { test: (sel) => sel.split(",").some(x => /^(?:body|:root|section|\.slide)(?:[.[:#][^\s>+~]*)?$/i.test(x.trim().split(/[\s>+~]+/).pop() ?? "")) }, SCRIM = /shade|overlay|scrim/i;
const flatten = (body, hit) => body.replace(/(background(?:-image)?\s*:\s*)([^;}]*\b(?:linear|radial|conic)-gradient\([^;}]*)/gi, (m, p, v) => {
    const { s, back } = mask(v.replace(/^[\s\S]*?-gradient\(/i, ""));
    const first = s.match(new RegExp(`\u0000\\d+\u0000|${LIT.source}`, "i"))?.[0];
    if (!first)
        return m;
    hit();
    return `${p.replace(/-image/i, "")}${back(first)}`;
});
export function fixRawColors(html, o = {}) {
    const tb = html.match(TOK)?.[1];
    const r = { html, n: 0, mood: 0, flat: 0, sample: [] };
    if (!tb)
        return r;
    const vars = tokenVars(tb);
    if (!vars.length)
        return r;
    const allow = new Set((o.allow ?? []).map(x => x.toLowerCase()));
    // 유채색은 유채색 토큰(강조·면·연한 면)에서, 무채색은 무채색에서 가장 가까운 것 — 빨강이 흰 바탕으로 가지 않게
    const chroma = (L) => Math.hypot(L[1], L[2]), hue = vars.filter(v => chroma(v.L) >= 12), gray = vars.filter(v => chroma(v.L) < 12);
    const near = (c) => { const L = lab(c), pool = chroma(L) >= 12 ? (hue.length ? hue : vars) : (gray.length ? gray : vars); let best = pool[0], d = Infinity; for (const v of pool) {
        const e = Math.hypot(L[0] - v.L[0], L[1] - v.L[1], L[2] - v.L[2]);
        if (e < d) {
            d = e;
            best = v;
        }
    } return best.name; };
    const lit = (prop, value, shadow) => {
        const { s, back } = mask(value);
        const t = s.replace(LIT, (x) => {
            if (/^[a-z]/i.test(x) && !COLOR_PROP.test(prop))
                return x;
            if (allow.has(x.toLowerCase()))
                return x;
            const c = parseColor(x);
            if (!c)
                return x;
            if (neutral(c) && (c.a < 1 || shadow))
                return x; // 무채색 그림자·덧막
            const v = near(c);
            r.n++;
            if (r.sample.length < 6)
                r.sample.push(`${x}→${v.replace("--color-semantic-", "")}`);
            return c.a < 1 ? `color-mix(in srgb, var(${v}) ${Math.round(c.a * 100)}%, transparent)` : `var(${v})`;
        });
        return back(t);
    };
    const decls = (body) => body.replace(/(^|[;{\s])([a-z-]+)(\s*:\s*)([^;{}]+)/gi, (m, a, p, c, v) => p.startsWith("--") ? m : `${a}${p}${c}${lit(p, v, /shadow|filter/i.test(p))}`);
    const MOOD = /^\s*(?:(?:html|body|:root|(?:body)?\.style-[a-z]+)\s*,?\s*)+$/i, tokNames = new Set(vars.map(v => v.name));
    const css = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/([^{}]*)\{([^{}]*)\}/g, (m, sel, body) => {
        if (/^\s*(?:html|body|html\s*,\s*body)\s*$/i.test(sel))
            return m; // 바깥 틀(장 밖 배경)
        let b = body;
        if (PAGE_SEL.test(sel) && !SCRIM.test(sel))
            b = flatten(b, () => r.flat++);
        if (o.stripMood && MOOD.test(sel))
            b = b.replace(/(--color-[\w-]+)\s*:\s*[^;}]+;?/g, (d, k) => (tokNames.has(k) ? (r.mood++, "") : d));
        return `${sel}{${decls(b)}}`;
    });
    let h = html.replace(/(<style\b([^>]*)>)([\s\S]*?)(<\/style\s*>)/gi, (m, open, at, body, close) => /\bdata-(?!free\b)[\w-]+/i.test(at) ? m : `${open}${css(body)}${close}`);
    // style="" — 앱이 그린 차트·QR 안은 그대로
    const svgs = [];
    h = h.replace(/<svg\b[^>]*(?:aria-label="QR"|data-viz-out)[^>]*>[\s\S]*?<\/svg>/gi, x => { svgs.push(x); return `\u0001${svgs.length - 1}\u0001`; });
    h = h.replace(/<div\b[^>]*\bdata-viz-out\b[\s\S]*?<\/svg>/gi, x => { svgs.push(x); return `\u0001${svgs.length - 1}\u0001`; });
    h = h.replace(/<section\b[^>]*>/gi, t => SCRIM.test(t) ? t : t.replace(/(\sstyle\s*=\s*")([^"]*)"/i, (_m, a, v) => `${a}${flatten(v, () => r.flat++)}"`));
    h = h.replace(/(\sstyle\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi, (_m, a, d, s) => d !== undefined ? `${a}"${decls(` ${d}`).slice(1)}"` : `${a}'${decls(` ${s ?? ""}`).slice(1)}'`);
    // SVG 속성 fill="#…" — 속성엔 var()가 안 먹는다: 그 속성을 빼고 style로
    h = h.replace(/<(path|rect|circle|ellipse|line|polyline|polygon|text|tspan|g|stop|use)\b([^>]*?)(\/?)>/gi, (m, tag, at, sl) => {
        const add = [];
        const at2 = at.replace(/\s(fill|stroke|stop-color)\s*=\s*(["'])([^"']+)\2/gi, (x, p, _q, v) => { const nv = lit(p, v, false); if (nv === v)
            return x; add.push(`${p}:${nv}`); return ""; });
        if (!add.length)
            return m;
        const st = at2.match(/\sstyle\s*=\s*(["'])([^"']*)\1/i);
        return st ? `<${tag}${at2.replace(st[0], ` style="${st[2].replace(/;?\s*$/, ";")}${add.join(";")}"`)}${sl}>` : `<${tag}${at2} style="${add.join(";")}"${sl}>`;
    });
    h = h.replace(/\u0001(\d+)\u0001/g, (_m, k) => svgs[Number(k)]);
    r.html = r.n || r.mood || r.flat ? h : html;
    return r;
}
// 덱 잠금 토큰(.dynapse/palette.json의 tokens)의 선택자를 모든 장에 맞게 — 장에 .style-qi가 없어도(자유 장·구성 장) 같은 색
export const lockSelectors = (tok) => tok.replace(/(^|\n)(\s*)\.style-(qi|wa)\s*\{/g, (_m, a, b) => `${a}${b}:root,.style-qi,.style-wa{`);
// AI 기본색(#274 ② — verify ai_palette와 같은 문턱): 미색 바탕 + 흙빛·세이지 강조 · 보라·남보라 강조 · 검정 바탕 + 형광 강조 하나. 덱 토큰의 bg-base·accent-base로 본다
export function aiDefault(tok) {
    const m = new Map();
    for (const x of tok.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/--color-semantic-(bg-base|accent-base)\s*:\s*([^;}]+)/g)) {
        const c = parseColor(x[2]);
        if (c)
            m.set(x[1], c);
    }
    const hsl = (c) => {
        if (!c)
            return null;
        const r = c.r / 255, g = c.g / 255, b = c.b / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
        if (!d)
            return { h: 0, s: 0, l: l * 100 };
        let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
        h = (h * 60 + 360) % 360;
        return { h, s: (d / (1 - Math.abs(2 * l - 1))) * 100, l: l * 100 };
    };
    const bg = hsl(m.get("bg-base")), ac = hsl(m.get("accent-base"));
    if (!bg || !ac)
        return null;
    const cream = bg.l >= 92 && bg.s >= 8 && bg.h >= 25 && bg.h <= 70, earthy = (ac.h <= 45 || ac.h >= 340) && ac.s >= 25 && ac.s <= 75 && ac.l >= 20 && ac.l <= 52, sage = ac.h >= 70 && ac.h <= 160 && ac.s >= 4 && ac.s <= 22 && ac.l >= 30 && ac.l <= 55;
    if (cream && (earthy || sage))
        return "cream_earthy";
    if (ac.h >= 240 && ac.h <= 285 && ac.s >= 60 && ac.l > 15 && ac.l < 85)
        return "purple";
    if (bg.l <= 12 && ac.s >= 90 && ac.l >= 45 && ac.l <= 70)
        return "black_neon";
    return null;
}
