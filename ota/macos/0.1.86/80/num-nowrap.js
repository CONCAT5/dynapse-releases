// 숫자+단위 한 덩어리(#314 ⑧ — 앵커 C "120만 건"이 줄바꿈으로 갈렸다). 바뀐 장의 글 조각에서 띄어 쓴 숫자+단위를 <span data-nw>로 묶고 머리에 <style data-nw> 한 줄(AI 0).
// 띄어쓰기가 있는 것만(붙여 쓴 "120만건"은 keep-all이면 이미 안 갈린다) · body 밖·svg·style·script·textarea·이미 묶은 것은 그대로 · 글자는 바뀌지 않는다(사실 대조·쪽 번호 그대로)
const UNIT = "(?:만원|억원|천원|원|건|명|개|배|시간|분|초|년|개월|주|일|회|점|곳|위|대|층|호|번|살|세|%|kg|km|cm|mm|GB|MB|TB|g|m)";
const NUM = new RegExp(`\\d[\\d,.]*(?:\\s?(?:천|만|억|조))?\\s${UNIT}(?![가-힣A-Za-z])|\\d[\\d,.]*\\s(?:천|만|억|조)${UNIT}?(?![가-힣A-Za-z])`, "g");
export const NW_STYLE = `<style data-nw>[data-nw]{white-space:nowrap}</style>`;
const SKIP_OPEN = /^<(svg|textarea|title)\b/i, SKIP_CLOSE = /^<\/(svg|textarea|title)\s*>/i;
export function nowrapNumbers(html) {
    const b0 = html.search(/<body\b/i);
    if (b0 < 0)
        return { html, n: 0 };
    const head = html.slice(0, b0), parts = html.slice(b0).split(/(<!--[\s\S]*?-->|<style\b[\s\S]*?<\/style\s*>|<script\b[\s\S]*?<\/script\s*>|<[^>]+>)/i);
    let n = 0, skip = 0;
    for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (!p)
            continue;
        if (p.startsWith("<")) {
            if (SKIP_OPEN.test(p) && !/\/>$/.test(p))
                skip++;
            else if (SKIP_CLOSE.test(p))
                skip = Math.max(0, skip - 1);
            continue;
        }
        if (skip || /^<span\b[^>]*\bdata-nw\b/i.test(parts[i - 1] ?? ""))
            continue; // svg 글·이미 묶은 조각
        const out = p.replace(NUM, m => (n++, `<span data-nw>${m}</span>`));
        parts[i] = out;
    }
    if (!n)
        return { html, n };
    const h = head + parts.join("");
    return { html: /<style\b[^>]*\bdata-nw\b/i.test(h) ? h : h.replace(/<\/head>/i, `${NW_STYLE}\n</head>`), n };
}
