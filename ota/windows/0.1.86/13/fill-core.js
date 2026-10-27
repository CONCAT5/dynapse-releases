const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const SKIP_SLOTS = /^(page_no|brand_logo|logo)$/;
const ent = (s) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function leaves(html) {
    const s0 = html.search(/<section\b/i), s1 = html.search(/<\/section\s*>/i);
    if (s0 < 0)
        return [];
    const stack = [];
    const out = [];
    const count = new Map();
    const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>|<!--[\s\S]*?-->/g;
    re.lastIndex = s0;
    let textFrom = -1;
    for (let m; (m = re.exec(html)) && m.index < (s1 < 0 ? html.length : s1 + 12);) {
        if (!m[2])
            continue;
        const close = m[1] === "/", tag = m[2].toLowerCase();
        if (!close) {
            if (/^(script|style|svg|figure)$/.test(tag)) { // 사진·그림·스크립트 안은 칸이 아니다 — 닫는 태그까지 건너뛴다
                const end = html.indexOf(`</${tag}`, m.index);
                if (end > 0)
                    re.lastIndex = html.indexOf(">", end) + 1;
                if (stack.length)
                    stack[stack.length - 1].kids++;
                continue;
            }
            if (stack.length)
                stack[stack.length - 1].kids++;
            if (VOID.has(tag) || /\/\s*$/.test(m[3]))
                continue;
            const slot = m[3].match(/\bdata-slot\s*=\s*["']([^"']+)["']/)?.[1] ?? null;
            stack.push({ tag, slot, kids: 0 });
            textFrom = m.index + m[0].length;
            continue;
        }
        // 닫힘 — 자식 요소가 없고 글자가 있으면 잎
        const top = stack.pop();
        if (!top || top.tag !== tag) {
            textFrom = -1;
            continue;
        }
        if (top.kids === 0 && textFrom >= 0) {
            const raw = html.slice(textFrom, m.index), text = ent(raw).replace(/\s+/g, " ").trim();
            const slot = top.slot ?? [...stack].reverse().find(x => x.slot)?.slot ?? null;
            // 쪽 번호("03 / 04" — 사선 양옆 빈칸)만 뺀다. 빈칸 없는 "10/3"은 날짜(C3 11회차 Q31 날짜 띠: 칸이 메뉴에서 빠져 견본 날짜 10/3…가 남았다)
            if (text && slot && !SKIP_SLOTS.test(slot) && !/^\d+\s+\/\s+\d+$/.test(text)) {
                const n = (count.get(slot) ?? 0) + 1;
                count.set(slot, n);
                const lead = raw.length - raw.trimStart().length, trail = raw.length - raw.trimEnd().length;
                out.push({ key: top.slot ? (n === 1 ? slot : `${slot}#${n}`) : `${slot}#${n}`, slot, text, start: textFrom + lead, end: m.index - trail, max: Math.max(6, Math.round([...text].length * 1.2) + 3) });
            }
        }
        textFrom = -1;
    }
    return out;
}
// { "<file>": { "<key>": string(maxLength) } } — 칸 하나하나 필수
export function schemaFor(pages) {
    const props = {};
    for (const p of pages)
        props[p.file] = { type: "object", additionalProperties: false, required: p.leaves.map(l => l.key),
            properties: Object.fromEntries(p.leaves.map(l => [l.key, { type: "string", minLength: 1, maxLength: l.max }])) };
    return { type: "object", additionalProperties: false, required: pages.map(p => p.file), properties: props };
}
// 지시(영어 — AI 지시는 영어, 결과 글은 브리프의 언어)
export function fillPrompt(brief, pages, only) {
    const lines = pages.map(p => `${p.file}${p.role ? ` — role: ${p.role}${p.scope ? ` (covers: ${p.scope})` : ""}` : ""}\n${p.leaves.filter(l => !only || (only.file === p.file && only.keys.includes(l.key))).map(l => `  ${l.key} (≤${l.max} chars, now: "${l.text}")`).join("\n")}`);
    return [
        { role: "system", content: "You write the text slots of a presentation deck. Reply with JSON only, matching the schema. Each value is plain text for that slot: no markdown, no emoji, no quotes around it, within its character limit. Titles state a claim. Keep numbers only if the brief gives them; never invent statistics for a real company. Write in the language of the brief." },
        { role: "user", content: `Brief:\n${brief}\n\n${only?.ask ? `Change requested by the user for the listed slots: ${only.ask}\n\n` : ""}Slots (current text is a placeholder from the template — rewrite it for the brief):\n${lines.join("\n")}` },
    ];
}
// 내용 검사(보정 1 §3) — 빈 칸 · 상한 초과 · 줄바꿈·마크다운 흔적 · 이모지. 걸린 칸 열쇠 목록
export function checkFill(values, ls) {
    // 상한에 딱 닿은 값 = 문법(maxLength)이 문장 중간에서 자른 것("…2 톤을") — 다시 묻는다
    return ls.filter(l => { const v = (values[l.key] ?? "").trim(); return !v || [...v].length >= l.max || /[\n*#`]|^["'“]|["'”]$/.test(v) || /\p{Extended_Pictographic}/u.test(v); }).map(l => l.key);
}
// 다시 물어도 상한에서 잘린 값 — 마지막 띄어쓰기·구두점에서 끊고 끝의 조사·쉼표를 뗀다(단어 중간에서 끝나지 않게)
export function uncut(v, max) {
    const s = v.trim();
    if ([...s].length < max)
        return s;
    // 끝 낱말이 조사로 끝나면("2 톤을") 조사만 뗀다 — 낱말은 살린다
    const noJosa = s.replace(/([가-힣]{1,})(에서|으로|하고|을|를|이|가|은|는|의|와|과|에|로)$/, "$1");
    if (noJosa !== s && /[가-힣\d]$/.test(noJosa))
        return noJosa.replace(/[\s,·]+$/, "");
    const cut = Math.max(s.lastIndexOf(" "), s.lastIndexOf(","), s.lastIndexOf("·"));
    if (cut < [...s].length * 0.5)
        return s;
    return s.slice(0, cut).replace(/[\s,·]+$/, "").replace(/([가-힣])(에서|으로|하고|을|를|이|가|은|는|의|와|과|에|로)$/, "$1");
}
// 작은 모델의 띄어쓰기 버릇 — 숫자와 단위 사이 공백("14 일", "100 %")을 붙인다
// 숫자와 단위 사이 공백 — 뒤에 조사가 붙어도("40 곳의", "1,200 명이") 붙인다. 긴 단위 먼저(개월·시간·주년)
export const tidy = (v) => v.trim().replace(/(\d)\s+(%|개월|개국|시간|주년|가지|일|개|명|년|월|시|분|초|원|배|곳|장|건|회|위|주|층|만|천|억|톤|대|잔|권|kg|g|km|m)(?=$|[^가-힣A-Za-z]|[의을를이가에과와은는도만로부까씩])/g, "$1$2");
export function applyFill(html, ls, values) {
    let out = html;
    for (const l of [...ls].sort((a, b) => b.start - a.start)) {
        const v = values[l.key];
        if (typeof v !== "string" || !v.trim())
            continue;
        out = out.slice(0, l.start) + esc(tidy(uncut(v, l.max))) + out.slice(l.end);
    }
    return out;
}
