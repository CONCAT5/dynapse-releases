export const MOTIF_FILE = ".dynapse/motif.json";
export const MOTIF_DEFAULT = { size: "m", corner: "auto" };
// 크기 = 블록 기본(--type-l × 1.5)에 곱 — 작게 0.6 · 보통 1 · 크게 1.3
const K = { s: 0.6, m: 1, l: 1.3 };
const INSET = 48;
// 장마다 같은 블록. 선택자 우선순위 = id 하나 + 속성 하나(조절 블록 [data-…]:not(#tw)과 같다) — 조절 블록이 뒤에 오므로 "이 장만"이 이긴다
export function deckBlock(m) {
    const rules = [];
    if (m.off)
        rules.push("display:none");
    else {
        if (m.size !== "m")
            rules.push(`font-size:calc(var(--type-l, 88px) * ${(1.5 * K[m.size]).toFixed(2)})`);
        if (m.corner !== "auto") {
            const [v, h] = [m.corner[0] === "t" ? "top" : "bottom", m.corner[1] === "l" ? "left" : "right"];
            rules.push("position:fixed", `${v}:${INSET}px`, `${h}:${INSET}px`, `${v === "top" ? "bottom" : "top"}:auto`, `${h === "left" ? "right" : "left"}:auto`, "transform:none", "translate:none");
        }
    }
    return rules.length ? `[data-motif]:not(#dk){${rules.join(";")}}` : "";
}
const BLK = /<style\b[^>]*\bdata-deck\b[^>]*>[\s\S]*?<\/style\s*>\s*/i;
// 장에 블록 싣기 — 조절 블록(data-tweaks)보다 앞에, 없으면 </head> 앞. 모티프가 없는 장·빈 블록이면 지운다
export function stampDeck(html, m) {
    const css = /\bdata-motif\b/.test(html.replace(BLK, "")) ? deckBlock(m) : "";
    const tag = css ? `<style data-deck>${css}</style>\n` : "";
    const base = html.replace(BLK, "");
    if (!tag)
        return base;
    const tw = base.search(/<style\b[^>]*\bdata-tweaks\b/i);
    if (tw >= 0)
        return base.slice(0, tw) + tag + base.slice(tw);
    return /<\/head>/i.test(base) ? base.replace(/<\/head>/i, `${tag}</head>`) : tag + base;
}
// 덱 모티프 말 — 바뀐 설정(없으면 null). "이 장만"은 따로(onlyPage)
const MOTIF_NOUN = /(쪽\s*번호|장\s*번호|페이지\s*번호|큰\s*(숫자|번호)|(?<!전화|계좌|주문|등록|사업자|카드|휴대폰|핸드폰|학)\s*번호|숫자\s*모티프|모티프|page number|numeral|motif)/i;
const NOT_MOTIF = /(전화|계좌|주문|등록|사업자|카드|휴대폰|핸드폰|학)\s*번호/;
export function motifTurn(text, cur) {
    const t = text.trim();
    if (t.length > 80 || !MOTIF_NOUN.test(t) || NOT_MOTIF.test(t))
        return null;
    const only = /이\s*장만|이\s*페이지만|this (page|slide) only/i.test(t);
    let next = null, say = "";
    if (/없애|지워|빼|숨겨|안\s*보이게|끄|remove|hide/i.test(t)) {
        next = { ...cur, off: true };
        say = "쪽 번호를 숨겼어요";
    }
    else if (/다시\s*(보이게|넣어|켜)|살려|보이게|show/i.test(t)) {
        next = { ...cur, off: false };
        say = "쪽 번호를 다시 보이게 했어요";
    }
    else if (/작게|줄여|smaller/i.test(t)) {
        next = { ...cur, off: false, size: cur.size === "l" ? "m" : "s" };
        say = "쪽 번호를 작게 했어요";
    }
    else if (/크게|키워|bigger|larger/i.test(t)) {
        next = { ...cur, off: false, size: cur.size === "s" ? "m" : "l" };
        say = "쪽 번호를 크게 했어요";
    }
    else {
        const c = /왼쪽\s*위|좌상|top.?left/i.test(t) ? "tl" : /오른쪽\s*위|우상|top.?right/i.test(t) ? "tr" : /왼쪽\s*아래|좌하|bottom.?left/i.test(t) ? "bl" : /오른쪽\s*아래|우하|bottom.?right/i.test(t) ? "br" : /원래\s*자리|제자리|기본\s*자리/.test(t) ? "auto" : null;
        if (c) {
            next = { ...cur, off: false, corner: c };
            say = c === "auto" ? "쪽 번호를 원래 자리로 돌렸어요" : `쪽 번호를 ${{ tl: "왼쪽 위", tr: "오른쪽 위", bl: "왼쪽 아래", br: "오른쪽 아래" }[c]}로 옮겼어요`;
        }
    }
    if (!next)
        return null;
    return { next, say, onlyPage: only };
}
// 이 장만(📍 + "이 장만") — 그 장 조절 블록에 [data-motif] 한 줄(크기·숨김). 덱 블록보다 뒤라 이긴다
export function pageOnlyRule(next) {
    return next.off ? "display:none" : `font-size:calc(var(--type-l, 88px) * ${(1.5 * K[next.size]).toFixed(2)})`;
}
// verify의 모티프 자리 계산(#201 ③) → 한 줄 — "03이 차트와 겹쳐 오른쪽 위로 옮겼어요"
export function fitLine(x) {
    const who = x.num ? `${x.num}이` : "쪽 번호가", what = x.near === "차트" ? "차트와" : "글과";
    const how = x.how.startsWith("corner:") ? `${{ tl: "왼쪽 위", tr: "오른쪽 위", bl: "왼쪽 아래", br: "오른쪽 아래" }[x.how.slice(7)] ?? "빈 모서리"}로 옮겼어요` : x.how === "smaller" ? "이 장만 작게 했어요" : "이 장만 흐리게 했어요";
    return `${who} ${what} 겹쳐 ${how}`;
}
