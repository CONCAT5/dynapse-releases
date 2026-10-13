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
            if (text && slot && !SKIP_SLOTS.test(slot) && !/^\d+\s*\/\s*\d+$/.test(text)) {
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
    return ls.filter(l => { const v = (values[l.key] ?? "").trim(); return !v || [...v].length > l.max || /[\n*#`]|^["'“]|["'”]$/.test(v) || /\p{Extended_Pictographic}/u.test(v); }).map(l => l.key);
}
// 작은 모델의 띄어쓰기 버릇 — 숫자와 단위 사이 공백("14 일", "100 %")을 붙인다
export const tidy = (v) => v.trim().replace(/(\d)\s+(%|일|개|명|년|월|시|분|초|원|배|곳|장|건|회|위|주|층|kg|g|km|m)(?![가-힣A-Za-z])/g, "$1$2");
export function applyFill(html, ls, values) {
    let out = html;
    for (const l of [...ls].sort((a, b) => b.start - a.start)) {
        const v = values[l.key];
        if (typeof v !== "string" || !v.trim())
            continue;
        out = out.slice(0, l.start) + esc(tidy(v)) + out.slice(l.end);
    }
    return out;
}
