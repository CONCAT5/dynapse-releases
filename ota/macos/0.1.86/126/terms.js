const STOP = new Set(["I", "A", "The", "And", "Or", "Of", "To", "In", "On", "For", "With", "By", "At", "From", "PDF", "PPTX", "PNG", "JPG", "OK", "AI", "VS", "VAT"]);
// 라틴 이름 후보 — CamelCase(BizCrush) · 약어(SaaS, KPI는 3자 이상 대문자) · 대문자로 시작하는 말(Wordly). 한글 문장 속 라틴 말만(영어 문장 첫 글자 대문자를 이름으로 보지 않게)
const NAME_RE = /(?<![A-Za-z0-9])([A-Z][a-z0-9]*[A-Z][A-Za-z0-9]*|[A-Z]{2,}[a-z]*|[A-Z][a-z]{2,}[A-Za-z0-9]*)(?![A-Za-z0-9])/g;
export function namesIn(text) {
    if (!/[가-힣]/.test(text))
        return []; // 한글이 없는 글(영어판)은 모으지 않는다
    return [...new Set([...text.matchAll(NAME_RE)].map(m => m[1]).filter(t => t.length >= 2 && t.length <= 30 && !STOP.has(t)))];
}
export const KEEP_ASK = /영어로\s*(바꾸지|번역하지)\s*마|그대로\s*(둬|두세요|둬요|놔)|이름\s*(을|은)?\s*바꾸지\s*마|번역하지\s*마|철자\s*그대로|keep\s+(it|the\s+name)?\s*(in\s+English|as\s+is)|don'?t\s+translate/i;
export const RENAME_ASK = /(을|를)\s*["'“‘]?[^\s"'”’]+["'”’]?\s*(으)?로\s*(바꿔|바꾸|변경|고쳐)|rename|change .* to /i;
export function mergeTerms(t, add, src) {
    const out = { keep: [...(t?.keep ?? [])], src: { ...(t?.src ?? {}) } };
    for (const a of add)
        if (a && !out.keep.includes(a)) {
            out.keep.push(a);
            out.src[a] = src;
        }
    out.keep = out.keep.slice(-60);
    return out;
}
export const keepLine = (t) => (t?.keep.length ? `[Keep exactly as written, in every language (never translate, transliterate or re-case): ${t.keep.slice(0, 30).join("; ")}]\n` : "");
// 글 칸 하나의 되돌림 — before에 있던 이름이 after에서 사라졌으면 [바뀐 말 → 원래 이름] 짝: 대소문자만 바뀐 것 · 앞뒤 글이 같고 가운데만 바뀐 것(번역·음역) · 칸 전체가 그 이름이던 것
// 짝으로 돌려주는 까닭 — 칸 안의 굵게·색 태그를 지우지 않고 그 낱말만 바꾸려고
export function restoreLeaf(before, after, keep) {
    const pairs = [], fixed = [];
    for (const k of keep) {
        if (!before.includes(k) || after.includes(k))
            continue;
        const ci = after.toLowerCase().indexOf(k.toLowerCase());
        if (ci >= 0) {
            pairs.push([after.slice(ci, ci + k.length), k]);
            fixed.push(k);
            continue;
        }
        const i = before.indexOf(k), pre = before.slice(0, i), suf = before.slice(i + k.length);
        if (!after.startsWith(pre) || !after.endsWith(suf))
            continue;
        const mid = after.slice(pre.length, after.length - suf.length).trim();
        if (mid && mid.length <= Math.max(24, k.length * 3) && !/\n/.test(mid) && (pre.length + suf.length >= 2 || before.trim() === k)) {
            pairs.push([mid, k]);
            fixed.push(k);
        }
    }
    return { pairs, fixed };
}
