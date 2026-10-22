// AI 답 다듬기(#279 ② — 대표 리워드 덱: 답에 CSS 이야기·파일 이름(photo-requests.json)·규칙 코드(glyph_contrast · L4)·잘린 문장·브랜드 철자를 되묻는 질문이 섞였다).
// 사람에게 보이는 답 = 쉬운 문장 3개까지. 순수 함수(앱·turn-sim이 같이 쓴다) — 원문은 앱 로그에 그대로 남는다
const CODE = /`[^`]*`/g;
const FILE = /\b[\w.-]+\.(json|html|css|md|mjs|js|ts|png|jpe?g|webp|svg|txt)\b/gi;
const RULE = /\b(L\d|EX\d|PR\d+|[a-z]+_[a-z_]+)\b/g; // 검사 규칙 이름(glyph_contrast · text_budget · L4)
const CSS = /(--[\w-]+|\bvar\(|\b(font-size|font-weight|line-height|letter-spacing|z-index|padding|margin|grid-template|flex|opacity|translate|rgba?\(|#[0-9a-f]{6}\b|\d+px\b))/i;
const END = /[.!?。…]$|[요다죠까네음함됨]$|니다$|어요$|아요$/;
export function cleanReply(text, o = {}) {
    const raw = (text ?? "").replace(/\r/g, "").trim();
    if (!raw)
        return raw;
    // 목록·머리표를 문장으로 · 마크다운 기호 빼기
    let t = raw.replace(/^\s*[-*•]\s+/gm, "").replace(/^#+\s*/gm, "").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\n{2,}/g, "\n");
    const parts = t.split(/(?<=[.!?。])\s+|\n+/).map(x => x.trim()).filter(Boolean);
    // 기술 문장은 통째로 뺀다(코드·파일 이름·규칙 이름·CSS가 든 문장 — 반만 지우면 "경고는 라 그대로" 같은 말이 남았다)
    const tech = (x) => CSS.test(x) || /[{}`]/.test(x) || new RegExp(FILE.source, "i").test(x) || new RegExp(RULE.source).test(x);
    let keep = parts.filter(x => !tech(x)).map(x => x.replace(/\(\s*\)|\[\s*\]/g, "").replace(/\s{2,}/g, " ").trim()).filter(x => x.replace(/[^가-힣A-Za-z0-9]/g, "").length >= 4);
    // 끝의 질문 — 브랜드 표기는 브리프에서 정해 문장으로, 그 밖의 질문은 리워드(묻지 않는 턴)에선 빼고 보통 작업은 하나만 둔다
    const q = (x) => /[?？]$/.test(x) || /(알려\s*주세요|할까요|원하시나요|괜찮을까요|어떠세요)$/.test(x);
    const lastQ = keep.length && q(keep[keep.length - 1]) ? keep.pop() : null;
    // 마지막 문장이 잘렸으면(끝 말이 없음) 뺀다
    while (keep.length > 1 && !END.test(keep[keep.length - 1]))
        keep = keep.slice(0, -1);
    if (lastQ && /브랜드|표기|철자|이름/.test(lastQ) && o.brand)
        keep.push(`브랜드 표기를 ${o.brand}로 맞췄어요.`);
    else if (lastQ && !o.reward && !keep.length)
        keep.push(lastQ);
    keep = keep.filter(x => !q(x) || !o.reward);
    const out = keep.slice(0, 3).join(" ").trim();
    return out || (o.reward ? "끝났어요" : raw.slice(0, 200));
}
// 결정 한 줄(#279 보정 1 ④ — 지침: 고를 일이 있으면 답 끝에 {"ask":"…","options":["…","…"]}): 답에서 떼어 버튼 칸으로. 형식이 틀리면 null(글은 그대로)
export function takeDecision(text) {
    const m = (text ?? "").match(/\{\s*"ask"\s*:\s*"[^"]{1,200}"\s*,\s*"options"\s*:\s*\[[^\]]{1,400}\]\s*\}/);
    if (!m)
        return { text, decision: null };
    try {
        const j = JSON.parse(m[0]);
        const opts = Array.isArray(j.options) ? j.options.filter((x) => typeof x === "string" && !!x.trim()).map(x => x.trim().slice(0, 40)).slice(0, 3) : [];
        if (typeof j.ask !== "string" || opts.length < 2)
            return { text, decision: null };
        return { text: text.replace(m[0], "").replace(/\s{2,}/g, " ").trim(), decision: { ask: j.ask.trim().slice(0, 160), options: opts } };
    }
    catch {
        return { text, decision: null };
    }
}
