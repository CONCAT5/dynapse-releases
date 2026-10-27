const A2 = "var(--color-semantic-accent-alt,var(--color-semantic-accent-base))"; // 보조색(3색 체계의 셋째 — 표 6)
const STICKERS = { kitsch: ["burst", "ticket", "tape"], grotesque: ["stamp", "hazard"], street: ["hazard", "tape", "burst"], cute: ["sparkle", "burst"], pop: ["burst", "sparkle"],
    retro: ["ticket", "stamp"], y2k: ["sparkle", "ticket"], vintage: ["stamp", "ticket"], traditional: ["stamp"], dreamy: ["sparkle"], warm: ["tape"] };
// 둘이면 뒷 분위기 먼저(장식은 뒷 낱말), 셋까지
export function stickersOf(moodId) {
    const [a, b] = moodId.split("+");
    return [...new Set([...(b ? STICKERS[b] ?? [] : []), ...(STICKERS[a] ?? [])])].slice(0, 3);
}
const svg = (d) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${d}</svg>`)}")`;
const BURST = svg(`<polygon points="${Array.from({ length: 32 }, (_, i) => { const r = i % 2 ? 36 : 50, t = (i / 32) * Math.PI * 2; return `${(50 + r * Math.sin(t)).toFixed(1)},${(50 - r * Math.cos(t)).toFixed(1)}`; }).join(" ")}"/>`);
const SPARK = svg(`<path d="M50 0C54 38 62 46 100 50C62 54 54 62 50 100C46 62 38 54 0 50C38 46 46 38 50 0Z"/>`);
const STK = (k) => `[data-orn="${k}"]:not([data-orn-app])`;
const STICKER_CSS = {
    burst: `${STK("burst")}{position:absolute;z-index:2;display:flex;align-items:center;justify-content:center;width:5.2em;height:5.2em;padding:1em;box-sizing:border-box;text-align:center;font:800 28px/1.05 var(--typography-font-family-display,var(--typography-font-family-body,sans-serif));color:var(--color-semantic-on-accent-alt,var(--color-semantic-text-strong));background:${A2};-webkit-mask:${BURST} center/contain no-repeat;mask:${BURST} center/contain no-repeat;transform:rotate(-8deg)}`,
    stamp: `${STK("stamp")}{position:absolute;z-index:2;display:flex;align-items:center;justify-content:center;width:4.8em;height:4.8em;box-sizing:border-box;padding:.6em;border:.14em solid var(--color-semantic-accent-base);border-radius:50%;outline:.06em dashed var(--color-semantic-accent-base);outline-offset:-.42em;text-align:center;font:800 26px/1.1 var(--typography-font-family-display,var(--typography-font-family-body,sans-serif));color:var(--color-semantic-accent-base);transform:rotate(-12deg)}`,
    tape: `${STK("tape")}{position:absolute;z-index:2;display:inline-block;padding:.35em 1.3em;font:700 26px/1.2 var(--typography-font-family-label,var(--typography-font-family-body,sans-serif));color:var(--color-semantic-on-accent-alt,var(--color-semantic-text-strong));background:${A2};transform:rotate(-4deg);clip-path:polygon(0 8%,4% 0,8% 10%,12% 0,88% 0,92% 9%,96% 0,100% 10%,100% 90%,96% 100%,92% 91%,88% 100%,12% 100%,8% 90%,4% 100%,0 92%)}`,
    ticket: `${STK("ticket")}{position:absolute;z-index:2;display:inline-block;padding:.5em 1.5em;font:800 26px/1.2 var(--typography-font-family-label,var(--typography-font-family-body,sans-serif));color:var(--color-semantic-on-accent,#fff);background:var(--color-semantic-accent-base);-webkit-mask:radial-gradient(circle at 0 50%,transparent .45em,#000 .47em) left/51% 100% no-repeat,radial-gradient(circle at 100% 50%,transparent .45em,#000 .47em) right/51% 100% no-repeat;mask:radial-gradient(circle at 0 50%,transparent .45em,#000 .47em) left/51% 100% no-repeat,radial-gradient(circle at 100% 50%,transparent .45em,#000 .47em) right/51% 100% no-repeat}`,
    hazard: `${STK("hazard")}{position:absolute;z-index:2;display:inline-block;padding:.4em .9em;font:800 26px/1.2 var(--typography-font-family-label,var(--typography-font-family-body,sans-serif));letter-spacing:.04em;color:var(--color-semantic-bg-base);background:var(--color-semantic-text-strong);border:.32em solid transparent;border-image:repeating-linear-gradient(-45deg,${A2} 0 .45em,var(--color-semantic-text-strong) .45em .9em) 1}`,
    sparkle: `${STK("sparkle")}{position:absolute;z-index:2;display:block;width:1.8em;height:1.8em;font-size:24px;background:${A2};-webkit-mask:${SPARK} center/contain no-repeat;mask:${SPARK} center/contain no-repeat}`,
};
// AI 지시 한 줄(영어 · 매 턴 — 덱 모티프 줄과 같은 자리). 스티커가 없는 분위기면 빈 글
export function stickerLine(moodId) {
    const ks = stickersOf(moodId);
    if (!ks.length)
        return "";
    return `[Mood stickers (optional): at most 2 per page, e.g. <span data-orn="${ks[0]}" style="left:120px;top:80px">한정 30개</span> — kinds for this deck: ${ks.join(", ")}${ks.includes("sparkle") ? " (sparkle has no text)" : ""}. Position with left/top inside the slide only; the app draws the shape and colours. Text ≤ 10 characters and only facts from the brief. Never over other text — verify blocks overlaps.]\n`;
}
export const MOOD_FILE = ".dynapse/mood.json";
// 사전의 장식 말(한국어) → 엔진 장식. 앞(뒷 분위기 장식이 먼저 온다 — 서버 detectMood)부터 둘까지
const MAP = [[/스티커|외곽선|오프셋|그림자/, "sticker"], [/그레인|질감|하프톤|반점|잉크/, "grain"], [/줄무늬|띠/, "stripes"]];
export function decosOf(devices = []) {
    const out = [];
    for (const d of devices)
        for (const [re, k] of MAP)
            if (re.test(d) && !out.includes(k)) {
                out.push(k);
                break;
            }
    return out.slice(0, 2);
}
// 분위기 → 아래 띠 모티프(앞 분위기 = 팔레트를 정한 분위기 기준). 줄무늬 장식이 잡혔는데 정해 둔 모티프가 선이면 대각 줄
const BANDS = { kitsch: "checker", street: "hazard", retro: "stripes3", cute: "dots", pop: "dots", grotesque: "stripes", y2k: "dots", dreamy: "line", minimal: "line", luxury: "line", calm: "line", vintage: "line", traditional: "line", nature: "line", warm: "line" };
// 분위기 → 레터링(둘이면 뒷 분위기 먼저 — 글꼴·장식을 정하는 쪽). 희원 키치+그로테스크 = 흘러내림(PINK WIG WIZ 레퍼런스의 흘러내리는 제목)
const LETTERS = { kitsch: "extrude", retro: "extrude", pop: "extrude", grotesque: "drip", street: "outline", cute: "outline", y2k: "chrome" };
export function letterOf(moodId) {
    const [a, b] = moodId.split("+");
    return (b && LETTERS[b]) || LETTERS[a] || null;
}
export function bandOf(moodId, decos = []) {
    const b = BANDS[moodId.split("+")[0]] ?? "line";
    return b === "line" && decos.includes("stripes") ? "stripes" : b;
}
const TITLE = `:is(h1,[data-slot="title"],[data-slot="headline"])`;
const BAND_CSS = {
    checker: `height:18px;background:repeating-conic-gradient(${A2} 0 25%,var(--color-semantic-bg-base) 0 50%) 0 0/18px 18px`,
    hazard: `height:16px;background:repeating-linear-gradient(-45deg,var(--color-semantic-text-strong) 0 12px,${A2} 12px 24px)`,
    stripes3: `height:24px;background:linear-gradient(var(--color-semantic-accent-base) 0 33%,${A2} 33% 66%,var(--color-semantic-text-strong) 66%)`,
    stripes: `height:16px;background:repeating-linear-gradient(-45deg,var(--color-semantic-accent-base) 0 14px,${A2} 14px 28px)`,
    dots: `height:16px;background:radial-gradient(circle,${A2} 3px,transparent 3.5px) 0 0/16px 16px`,
    line: `height:2px;background:${A2}`,
};
const SEC = `section.slide[data-orn-cover]`, SHADE = "color-mix(in srgb,var(--color-semantic-text-strong) 40%,transparent)";
const LETTER_CSS = {
    // 3D 돌출: 보조색 층 넷 + 옅은 그림자 — 한글 9자 이상이면 외곽선으로(그림자 금지 규칙)
    extrude: `${SEC}[data-letter="extrude"]:not([data-orn-long]) ${TITLE}{text-shadow:.02em .02em 0 ${A2},.04em .04em 0 ${A2},.06em .06em 0 ${A2},.08em .08em 0 ${A2},.11em .11em 0 ${SHADE}}
${SEC}[data-letter="extrude"][data-orn-long] ${TITLE}{-webkit-text-stroke:.05em ${A2};paint-order:stroke fill}`,
    // 흘러내림: 글자 아래로 보조색 방울 두 겹(글자 자체는 그대로 — 대비·고치기 그대로)
    drip: `${SEC}[data-letter="drip"] ${TITLE}::after{content:"";display:block;width:min(100%,var(--orn-drip-w,8em));height:.55em;margin-top:-.24em;pointer-events:none;background:radial-gradient(.07em .26em at 50% 0,${A2} 98%,transparent) .1em 0/.95em .55em repeat-x,radial-gradient(.05em .4em at 50% 0,${A2} 98%,transparent) .5em 0/1.7em .55em repeat-x,radial-gradient(.09em .16em at 50% 0,${A2} 98%,transparent) .3em 0/1.25em .55em repeat-x}`,
    outline: `${SEC}[data-letter="outline"] ${TITLE}{-webkit-text-stroke:.055em ${A2};paint-order:stroke fill}`,
    // 크롬: 얇은 어두운 테 + 위 밝은 빛 + 보조색 번짐(흐림 있는 그림자 — 오프셋 그림자 규칙 밖)
    chrome: `${SEC}[data-letter="chrome"] ${TITLE}{-webkit-text-stroke:.02em ${SHADE};paint-order:stroke fill;text-shadow:0 .025em .02em var(--color-semantic-bg-surface),0 0 .35em color-mix(in srgb,${A2} 60%,transparent)}`,
};
export function moodCss(decos, band = null, letter = null, dripW = null, stickers = []) {
    const r = [];
    for (const k of stickers)
        r.push(STICKER_CSS[k]);
    if (letter)
        r.push(LETTER_CSS[letter]);
    if (letter === "drip" && dripW)
        r.push(`${SEC}{--orn-drip-w:${dripW}em}`); // 이 장 제목 길이만큼(블록은 장마다 찍는다)
    if (decos.includes("sticker") && !letter)
        r.push(`section.slide[data-orn-cover] ${TITLE}{-webkit-text-stroke:.035em currentColor;paint-order:stroke fill;text-shadow:.07em .07em 0 ${A2}}`, `section.slide[data-orn-cover][data-orn-long] ${TITLE}{text-shadow:none}`);
    if (decos.includes("grain"))
        r.push(`section.slide{background-image:radial-gradient(color-mix(in srgb,var(--color-semantic-text-strong) 10%,transparent) 1px,transparent 1.3px);background-size:6px 6px}`);
    if (band)
        r.push(`section.slide:has(>[data-orn-app]){position:relative}`, `[data-orn="frame-top"][data-orn-app]{position:absolute;left:0;right:0;top:0;height:44px;padding:0 28px;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:16px;z-index:1;pointer-events:none;background:var(--color-semantic-accent-base);color:var(--color-semantic-on-accent,#fff);font:700 15px/1 var(--typography-font-family-label,var(--typography-font-family-body,sans-serif));letter-spacing:.08em;white-space:nowrap;overflow:hidden}`, `[data-orn="frame-top"][data-orn-app][data-band="line"]{background:transparent;color:var(--color-semantic-text-muted);border-bottom:1px solid ${A2}}`, `[data-orn="frame-bottom"][data-orn-app]{position:absolute;left:0;right:0;bottom:0;z-index:1;pointer-events:none;${BAND_CSS[band]}}`);
    return r.join("\n");
}
const BLK = /<style\b[^>]*\bdata-mood\b[^>]*>[\s\S]*?<\/style\s*>\s*/gi, ORN = /<(i|div)\b[^>]*\bdata-orn-app\b[^>]*>[\s\S]*?<\/\1>/gi;
const SLIDE = /<section\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bslide\b)[^>]*>/i;
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// 시리즈 라벨 = 표지 장 제목(지어내지 않는다 — 장에 있는 글). 28자까지
export function labelOf(coverHtml) {
    const m = coverHtml.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>|<([a-z0-9]+)\b[^>]*\bdata-slot\s*=\s*["'](?:title|headline)["'][^>]*>([\s\S]*?)<\/\2>/i);
    return (m?.[1] ?? m?.[3] ?? "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;|\s+/g, " ").replace(/&amp;/g, "&").trim().slice(0, 28);
}
// 한 장에 — 예전 분위기 블록·앱 요소·표시를 지우고 새로. cover = 표지·마무리 장(스티커 자리) · off = 그 장은 띠 없이(겹침으로 뗀 장)
// frame = 시리즈 틀(라벨·쪽 번호·전체 쪽 수) — band가 있으면 위·아래 띠, 쪽 번호는 레이아웃의 쪽번호 칸(data-slot="page_no")이 없을 때만
export function stampMood(html, o) {
    let h = html.replace(BLK, "").replace(ORN, "");
    h = h.replace(SLIDE, t => t.replace(/\s+data-orn-(cover|long)(\s*=\s*["'][^"']*["'])?/gi, "").replace(/\s+data-letter\s*=\s*["'](extrude|drip|outline|chrome)["']/i, "").replace(/\s+data-stroke-ok\s*=\s*["']mood["']/i, ""));
    const band = o.band ?? null, letter = o.letter ?? null;
    // 흘러내림 띠 길이 = 표지 제목 한 줄 길이 어림(한글 0.82em · 그 밖 0.5em, 2~9em) — 말 끝 너머로 방울이 이어지지 않게
    const tt = o.cover && letter === "drip" ? labelOf(h.slice(Math.max(0, h.search(SLIDE)))) : "", dripW = tt ? Math.max(2, Math.min(9, Math.round([...tt].reduce((a, c) => a + (/[가-힣]/.test(c) ? 0.82 : /\s/.test(c) ? 0.3 : 0.5), 0) * 10) / 10)) : null;
    const css = moodCss(o.decos, band, letter, dripW, o.stickers ?? []);
    if (!css)
        return h;
    const m = h.match(SLIDE);
    if (m) {
        let t = m[0];
        if (o.cover && (o.decos.includes("sticker") || letter)) {
            const ko = (labelOf(h.slice(h.indexOf(m[0]))).match(/[가-힣]/g) ?? []).length;
            // 스티커 외곽선은 분위기가 요청한 것 — verify title_stroke가 보는 표시(data-stroke-ok)를 "mood" 값으로(다시 찍을 때 이 값만 뗀다)
            t = t.replace(/>$/, ` data-orn-cover${ko >= 9 ? " data-orn-long" : ""}${letter ? ` data-letter="${letter}"` : ""}${/\bdata-stroke-ok\b/i.test(t) ? "" : ' data-stroke-ok="mood"'}>`);
        }
        let add = "";
        if (band && !o.off) {
            const f = o.frame, no = f && f.total > 1 && !/\bdata-slot\s*=\s*["']page_no["']/i.test(h) ? `<span>${String(f.no).padStart(2, "0")} / ${String(f.total).padStart(2, "0")}</span>` : "";
            if (f && (f.label || no))
                add += `<div data-orn="frame-top" data-orn-app data-band="${band}" aria-hidden="true"><b>${esc(f.label)}</b>${no}</div>`;
            add += `<i data-orn="frame-bottom" data-orn-app data-band="${band}" aria-hidden="true"></i>`;
        }
        h = h.replace(m[0], t + add);
    }
    const tag = `<style data-mood>${css}</style>\n`;
    return /<\/head>/i.test(h) ? h.replace(/<\/head>/i, `${tag}</head>`) : tag + h;
}
