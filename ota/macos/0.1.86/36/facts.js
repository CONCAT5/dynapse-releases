// 빠진 사실(#302 B — 희원 PINK WIG WIZ: 원고에 굿즈·가격·날짜·장소가 없어 AI가 지어내고 → 다듬기가 [대괄호]로 비우고 → 산문으로 4번 다시 물었다).
// 순수 함수만(chat.ts가 쓰고 turn-sim이 시험): 장 글 속 [빈칸] 찾기 · 예시 표기(data-example)로 감싸기 · 받은 값 넣기(엔진 · AI 0)
export const BLANK = /\[([^[\]<>\n]{1,24})\]/g;
const SKIP = /^(?:첨부|attach|x|\s*)$|^\d+$/i;
// 태그 밖 글 조각에만 손댄다(속성·스타일·스크립트는 그대로)
const mapText = (html, f) => {
    const parts = html.split(/(<style\b[\s\S]*?<\/style>|<script\b[\s\S]*?<\/script>|<[^>]+>)/i);
    return parts.map(p => (p.startsWith("<") ? p : f(p))).join("");
};
// 장의 빈칸 이름들(순서대로·중복 없이) — 예시 표기로 이미 감싼 것도 센다
export function blanksOf(html) {
    const body = html.match(/<body\b[\s\S]*<\/body>/i)?.[0] ?? html, out = [];
    mapText(body, t => { for (const m of t.matchAll(BLANK)) {
        const k = m[1].trim();
        if (!SKIP.test(k) && !out.includes(k))
            out.push(k);
    } return t; });
    return out;
}
// 예시 표기 — [이름]을 흐린 글씨 + "예시" 띠로(검사는 의도된 빈칸으로 센다). 한 번만 감싸고 스타일은 머리에 한 번
export const EXAMPLE_STYLE = `<style data-example-style>[data-example]{opacity:.45}[data-example]::after{content:"예시";font-size:.42em;font-weight:600;letter-spacing:0;margin-left:.35em;padding:.05em .4em;border:1px solid currentColor;border-radius:.4em;vertical-align:.35em}</style>`;
export function markExamples(html) {
    let n = 0;
    const out = mapText(html.replace(/(<body\b[\s\S]*<\/body>)/i, b => b), t => t.replace(BLANK, (all, k) => (SKIP.test(k.trim()) ? all : (n++, `<span data-example="${k.trim().replace(/"/g, "")}">${all}</span>`))));
    // 이미 감싼 칸 안의 [이름]을 또 감싸지 않게 — 감싼 span 안이면 되돌린다
    const fixed = out.replace(/(<span data-example="[^"]*">)<span data-example="[^"]*">(\[[^\]]*\])<\/span>(<\/span>)/g, "$1$2$3");
    if (!n)
        return html;
    return /data-example-style/.test(fixed) ? fixed : fixed.replace(/<\/head>/i, `${EXAMPLE_STYLE}\n</head>`);
}
// 받은 값 넣기 — [이름]과 그 예시 표기를 값으로(HTML 이스케이프). 남은 빈칸 수도
export function fillBlanks(html, values) {
    const esc = (s) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    let n = 0, h = html;
    for (const [k, v0] of Object.entries(values)) {
        const v = String(v0 ?? "").trim();
        if (!v)
            continue;
        const kk = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        h = h.replace(new RegExp(`<span data-example="${kk}">\\[${kk}\\]</span>`, "g"), () => (n++, esc(v)));
        h = mapText(h, t => t.replace(new RegExp(`\\[${kk}\\]`, "g"), () => (n++, esc(v))));
    }
    if (!/data-example="/.test(h))
        h = h.replace(/\s*<style data-example-style>[\s\S]*?<\/style>/i, "");
    return { html: h, n };
}
// "남은 고칠 것 고쳐"(웹 [고쳐 줘] 버튼 · #302 B ③) — 검사 오류 목록을 그대로 하라는 말. 사실 요청으로 읽지 않는다
export const FIX_REMAINING = /남은\s*(?:고칠|수정할|오류)|고칠\s*것(?:을|들)?\s*(?:다\s*)?(?:고쳐|수정)|오류(?:를|들)?\s*(?:다\s*)?고쳐|fix (?:the )?remaining/i;
