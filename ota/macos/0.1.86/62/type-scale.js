const RULE = /([^{}]+)\{([^{}]*)\}/g;
const css = (html) => [...html.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi)].filter(m => !/\bdata-mood\b/i.test(m[1])).map(m => m[2]).join("\n");
const num = (v) => { const m = String(v ?? "").trim().match(/^(\d+(?:\.\d+)?)px$/); return m ? Number(m[1]) : null; };
function vars(text) {
    const out = {};
    for (const m of text.matchAll(RULE))
        if (/(^|,)\s*(:root|html|body|\.slide|section)\b/i.test(m[1]))
            for (const d of m[2].matchAll(/--type-([a-z0-9-]+)\s*:\s*([^;]+)/gi)) {
                const v = num(d[2]);
                if (v !== null)
                    out[d[1].toLowerCase()] = v;
            }
    return out;
}
const TITLE_SEL = /(^|[\s>+~,])h1\b|\[data-slot\s*=\s*["']?title["']?\]/i;
const BODY_SEL = /(^|[\s>+~,])(p|li)\b|\[data-slot\s*=\s*["']?(body|lead)["']?\]/i;
function sizeOf(text, sel, v) {
    let px = null, literal = false;
    for (const m of text.matchAll(RULE)) {
        if (!m[1].split(",").some(x => sel.test(x.trim())))
            continue;
        const fs = m[2].match(/(?:^|;)\s*font-size\s*:\s*([^;]+)/i)?.[1]?.trim();
        if (!fs)
            continue;
        const vr = fs.match(/^var\(\s*--type-([a-z0-9-]+)\s*(?:,\s*([^)]+))?\)$/i);
        if (vr) {
            px = v[vr[1].toLowerCase()] ?? num(vr[2]) ?? px;
            literal = false;
        }
        else {
            const n = num(fs);
            if (n !== null) {
                px = n;
                literal = true;
            }
        }
    }
    return { px, literal };
}
const EXC_FILE = /^result-(?:cover|closing|end|section|divider|toc|card-1)\b|-(?:cover|closing|section)\.html$/i;
export function measurePage(file, html, tokens, hand = []) {
    const page = css(html), v = { ...vars(tokens), ...vars(page) };
    // 인라인 제목 크기(<h1 style="font-size:60px">)가 있으면 그것이 이긴다
    const inl = html.match(/<h1\b[^>]*\bstyle\s*=\s*"[^"]*font-size\s*:\s*(\d+(?:\.\d+)?)px/i);
    const t = sizeOf(page, TITLE_SEL, v), b = sizeOf(page, BODY_SEL, v);
    const title = inl ? Number(inl[1]) : t.px ?? v.l ?? v.xl ?? null;
    const font = [...page.matchAll(RULE)].filter(m => m[1].split(",").some(x => TITLE_SEL.test(x.trim()) || /(^|,)\s*(\.slide|body|section)\s*$/i.test(x.trim()))).map(m => m[2].match(/font-family\s*:\s*([^;]+)/i)?.[1]?.trim()).find(f => f && !/^var\(/i.test(f)) ?? null;
    const sec = html.match(/<section\b[^>]*>/i)?.[0] ?? "";
    const exception = hand.includes(file) ? "hand" : /\bdata-type-exception\b/i.test(sec) ? "marked" : /\bdata-role\s*=\s*["'](cover|closing|section)["']/i.exec(sec)?.[1] ?? (EXC_FILE.test(file) ? "frame" : null);
    // 중간 단계는 장이 스스로 --type-m을 선언했을 때만 본다(레이아웃마다 h2 규칙이 다른 것은 어긋남이 아니다 — 대표 덱 드라이런: 24-demo05·23-market이 h2만 달라 잡혔다)
    const own = vars(page);
    return { file, title, m: own.m ?? v.m ?? null, s: b.px ?? v.s ?? null, titleLiteral: !!inl || t.literal, font: font ? font.replace(/["']/g, "").split(",")[0].trim() : null, exception };
}
// 최빈값(같으면 큰 값) — 둘째와 장 수가 1 이내로 비슷하면 tie(앱이 작은 턴 한 번으로 고른다)
export function modeOf(xs) {
    const c = new Map();
    for (const x of xs)
        c.set(x, (c.get(x) ?? 0) + 1);
    const s = [...c].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    if (!s.length)
        return { value: null, tie: [] };
    return { value: s[0][0], tie: s.length > 1 && s[0][1] - s[1][1] <= 1 && s[0][1] < xs.length * 0.6 ? s.slice(0, 3).map(([value, n]) => ({ value, n })) : [] };
}
export function planUnify(pages, pick) {
    const body = pages.filter(p => !p.exception);
    const L = modeOf(body.map(p => p.title).filter((x) => x !== null)), M = modeOf(body.map(p => p.m).filter((x) => x !== null)), S = modeOf(body.map(p => p.s).filter((x) => x !== null));
    const F = (() => { const c = new Map(); for (const p of body)
        if (p.font)
            c.set(p.font, (c.get(p.font) ?? 0) + 1); return [...c].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null; })();
    const l = pick ?? L.value;
    const off = body.map(p => ({ file: p.file, why: [...(l !== null && p.title !== null && p.title !== l ? [`제목 ${p.title}px`] : []), ...(M.value !== null && p.m !== null && p.m !== M.value ? [`중간 ${p.m}px`] : []), ...(F && p.font && p.font !== F ? [`글꼴 ${p.font}`] : [])] })).filter(x => x.why.length);
    return { scale: { l, m: M.value, s: S.value, font: F }, off, skipped: pages.filter(p => p.exception).map(p => ({ file: p.file, why: p.exception })), tie: pick ? [] : L.tie };
}
// 덱 척도를 tokens.css에(있으면 바꾸고 없으면 :root 블록 하나)
export function scaleTokens(tokens, sc) {
    const want = [["l", sc.l], ["m", sc.m], ["s", sc.s]];
    let t = tokens;
    for (const [k, v] of want) {
        if (v === null)
            continue;
        const re = new RegExp(`(--type-${k}\\s*:\\s*)[^;}]+`, "i");
        t = re.test(t) ? t.replace(re, `$1${v}px`) : t;
    }
    const missing = want.filter(([k, v]) => v !== null && !new RegExp(`--type-${k}\\s*:`, "i").test(t));
    if (missing.length)
        t = `${t.trimEnd()}\n:root{${missing.map(([k, v]) => `--type-${k}:${v}px`).join(";")}}\n`;
    return t;
}
// 어긋난 장 하나를 덱 척도로: 장 안의 --type-* 선언 지우기 · 제목 크기 리터럴 → var(--type-l) · 인라인 제목 크기 지우기 · 리터럴 글꼴 → 변수
export function unifyPage(html) {
    return html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (all, attrs, body) => /\bdata-mood\b/i.test(attrs) ? all : `<style${attrs}>${body
        .replace(RULE, (r, sel, decl) => {
        let d = decl;
        if (/(^|,)\s*(:root|html|body|\.slide|section)\b/i.test(sel))
            d = d.replace(/\s*--type-[a-z0-9-]+\s*:[^;]*;?/gi, "");
        if (sel.split(",").some(x => TITLE_SEL.test(x.trim())))
            d = d.replace(/(font-size\s*:\s*)\d+(?:\.\d+)?px/i, "$1var(--type-l)");
        if (sel.split(",").some(x => TITLE_SEL.test(x.trim())))
            d = d.replace(/(font-family\s*:\s*)(?!var\()[^;]+/i, "$1var(--typography-font-family-display)");
        else if (/(^|,)\s*(\.slide|body|section)\s*$/i.test(sel))
            d = d.replace(/(font-family\s*:\s*)(?!var\()[^;]+/i, "$1var(--typography-font-family-body)");
        return `${sel}{${d}}`;
    })}</style>`).replace(/(<h1\b[^>]*\bstyle\s*=\s*"[^"]*?)\s*font-size\s*:\s*\d+(?:\.\d+)?px;?/i, "$1");
}
// 보고 표(작은 턴·"보여 줘"용) — 크기별 장 수·장 종류
export function scaleTable(pages) {
    const c = new Map();
    for (const p of pages)
        if (!p.exception && p.title !== null)
            c.set(p.title, [...(c.get(p.title) ?? []), p.file]);
    return [...c].sort((a, b) => b[1].length - a[1].length).map(([px, fs]) => `${px}px × ${fs.length}장`).join(" · ");
}
