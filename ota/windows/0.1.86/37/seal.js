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
// 가운데 글자 — 이름(성 뺀 것): 김도윤 → 도윤 · 이준 → 준 · 라틴은 첫 이름. 두 사람을 위아래로(연구 시안 design_proto f4)
export const sealGiven = (n) => (/^[가-힣]{3,4}$/.test(n) ? n.slice(1) : /^[가-힣]{2}$/.test(n) ? n.slice(1) : (n.split(/\s+/)[0] ?? n)).slice(0, 4);
export const sealInitial = (n) => sealGiven(n).charAt(0);
export function sealDate(t) {
    const m = t.match(/(\d{4})\s*[.년/-]\s*(\d{1,2})\s*[.월/-]\s*(\d{1,2})/);
    return m ? `${m[1]}.${Number(m[2])}.${Number(m[3])}` : null;
}
// v2(2026-10-22 연구 시안대로): 강조색 원판 · 안쪽 가는 테 · 둘레에 날짜 세 번 · 가운데 두 이름. 색은 currentColor(원판), 글자는 바탕색
const SEAL_REV = "2";
export function sealSvg(names, date) {
    const nm = sealNames(names);
    if (!nm)
        return null;
    const d = sealDate(date) ?? "", key = `${SEAL_REV}|${nm.join("|")}|${d}`, h = hash(key), id = `sp${h.toString(36)}`;
    const a = sealGiven(nm[0]), b = sealGiven(nm[1]), fs = Math.max(a.length, b.length) >= 3 ? 18 : 22, ink = "fill:var(--color-semantic-bg-surface,#fff)";
    const ring = d ? `${d} · ${d} · ${d} ·` : "";
    return `<svg viewBox="0 0 120 120" role="img" aria-label="${esc(`${nm[0]} · ${nm[1]}${d ? ` · ${d}` : ""}`)}" data-seal="${h.toString(36)}"><defs><path id="${id}" d="M60,60 m-45,0 a45,45 0 1,1 90,0 a45,45 0 1,1 -90,0"/></defs>`
        + `<circle cx="60" cy="60" r="57" fill="currentColor"/><circle cx="60" cy="60" r="52" fill="none" stroke-width="0.8" style="stroke:var(--color-semantic-bg-surface,#fff);opacity:.7"/>`
        + (ring ? `<text font-size="8.5" letter-spacing="2.2" style="${ink}"><textPath href="#${id}" startOffset="0">${esc(ring)}</textPath></text>` : "")
        + `<text x="60" y="${fs === 22 ? 57 : 56}" text-anchor="middle" font-size="${fs}" style="${ink};font-family:var(--typography-font-family-display,serif)">${esc(a)}</text>`
        + `<text x="60" y="${fs === 22 ? 80 : 77}" text-anchor="middle" font-size="${fs}" style="${ink};font-family:var(--typography-font-family-display,serif)">${esc(b)}</text></svg>`;
}
// 장 HTML의 인장 칸(cover_seal)을 지금 이름·날짜로 — 표지 변형이 seal일 때만. 이름·날짜가 같으면 그대로(같은 해시) · 사람이 넣은 그림(img)은 건드리지 않는다
export function fillSealHtml(html) {
    if (!/<section\b[^>]*\bdata-variant\s*=\s*["'](seal|envelope)["']/i.test(html))
        return { html, changed: false }; // 봉투 덮개에도 같은 인장
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
