// 이름·날짜 인장(#230 보정 17 1b — 표지 변형 seal) — 두 이름과 날짜로 결정적으로 그리는 SVG(AI 0 · 리워드 불필요). 같은 글이면 언제나 같은 그림.
// 바깥 두 줄 원 · 둘레 글(두 이름 · 날짜) · 점 꽃(개수·회전은 글의 해시) · 가운데 두 이름의 첫 글자. 색은 currentColor(표지의 강조색). 허브 src/lib/seal.ts와 같은 내용
const esc = (v) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function hash(t) { let h = 2166136261; for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 16777619);
} return h >>> 0; }
// "김새말 · 이한결" → ["김새말", "이한결"] · "신랑 임하준 · 신부 조수아" → ["임하준", "조수아"]
export function sealNames(names) {
    const xs = names.replace(/\([^)]*\)/g, "").split(/\s*[·&♥,]\s*|\s+그리고\s+/).map(x => x.replace(/^(신랑|신부)\s+/, "").trim()).filter(Boolean);
    return xs.length >= 2 ? [xs[0].slice(0, 12), xs[1].slice(0, 12)] : null;
}
// 가운데 글자 — 한글 이름은 성 다음 첫 글자(새말 → 새), 두 글자 이름은 둘째(이준 → 준), 라틴은 첫 글자
export const sealInitial = (n) => (/^[가-힣]{2,4}$/.test(n) ? n.charAt(1) : (n.match(/[A-Za-z가-힣]/)?.[0] ?? "").toUpperCase());
export function sealDate(t) {
    const m = t.match(/(\d{4})\s*[.년/-]\s*(\d{1,2})\s*[.월/-]\s*(\d{1,2})/);
    return m ? `${m[1]}. ${Number(m[2])}. ${Number(m[3])}` : null;
}
export function sealSvg(names, date) {
    const nm = sealNames(names);
    if (!nm)
        return null;
    const d = sealDate(date) ?? "", key = `${nm.join("|")}|${d}`, h = hash(key), id = `sp${h.toString(36)}`;
    const n = 8 + (h % 9), rot = (h >>> 8) % 30, dots = [];
    for (let i = 0; i < n; i++) {
        const a = ((360 / n) * i + rot) * Math.PI / 180;
        dots.push(`<circle cx="${(100 + 64 * Math.cos(a)).toFixed(2)}" cy="${(100 + 64 * Math.sin(a)).toFixed(2)}" r="${i % 2 ? 1.6 : 2.6}"/>`);
    }
    const ring = `${nm[0]} · ${nm[1]}${d ? ` · ${d}` : ""}`;
    return `<svg viewBox="0 0 200 200" role="img" aria-label="${esc(ring)}" data-seal="${h.toString(36)}"><defs><path id="${id}" d="M100,100 m-78,0 a78,78 0 1,1 156,0 a78,78 0 1,1 -156,0"/></defs>`
        + `<g fill="none" stroke="currentColor"><circle cx="100" cy="100" r="96" stroke-width="2"/><circle cx="100" cy="100" r="90" stroke-width="0.8"/><circle cx="100" cy="100" r="54" stroke-width="0.8"/></g>`
        + `<g fill="currentColor">${dots.join("")}</g>`
        + `<text fill="currentColor" font-size="12.5" letter-spacing="2" text-anchor="middle"><textPath href="#${id}" startOffset="25%">${esc(ring)}</textPath></text>`
        + `<text x="100" y="114" fill="currentColor" font-size="34" font-weight="700" text-anchor="middle" font-family="var(--typography-font-family-display,inherit)">${esc(sealInitial(nm[0]))}<tspan font-size="18" font-weight="400" dx="4" dy="-6">·</tspan><tspan dx="4" dy="6">${esc(sealInitial(nm[1]))}</tspan></text></svg>`;
}
// 장 HTML의 인장 칸(cover_seal)을 지금 이름·날짜로 — 표지 변형이 seal일 때만. 이름·날짜가 같으면 그대로(같은 해시) · 사람이 넣은 그림(img)은 건드리지 않는다
export function fillSealHtml(html) {
    if (!/<section\b[^>]*\bdata-variant\s*=\s*["']seal["']/i.test(html))
        return { html, changed: false };
    const slot = html.match(/(<(div|figure)\b[^>]*\bdata-slot\s*=\s*["']cover_seal["'][^>]*>)([\s\S]*?)(<\/\2>)/i);
    if (!slot || /<img\b/i.test(slot[3]))
        return { html, changed: false };
    const text = (s) => (html.match(new RegExp(`<[a-z0-9]+\\b[^>]*\\bdata-slot\\s*=\\s*["']${s}["'][^>]*>([\\s\\S]*?)</`, "i"))?.[1] ?? "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();
    const svg = sealSvg(text("names"), text("when") || text("big_date"));
    if (!svg)
        return { html, changed: false };
    const cur = slot[3].match(/data-seal="([a-z0-9]+)"/)?.[1], next = svg.match(/data-seal="([a-z0-9]+)"/)?.[1];
    if (cur && cur === next)
        return { html, changed: false };
    const open = slot[1].replace(/\s+data-slot-empty(?:=["'][^"']*["'])?/i, ""); // 채운 인장은 빈 칸이 아니다
    return { html: html.replace(slot[0], () => `${open}${svg}${slot[4]}`), changed: true };
}
