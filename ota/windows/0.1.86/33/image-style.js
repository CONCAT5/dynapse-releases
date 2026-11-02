export const STYLE_FILE = ".dynapse/image-style.json";
const MEDIUM_TEXT = {
    flat: "flat vector illustration, solid fills, no outlines, soft simple shading, simplified figures",
    photo: "natural photograph, real light, real materials",
    "3d": "soft 3D render, rounded forms, gentle studio light",
};
export function styleSentence(medium, palette) {
    const m = medium ? MEDIUM_TEXT[medium] : "the same medium, line and figure style as the reference image";
    return `Deck image style (keep every image in this deck the same): ${m}${palette.length ? `; palette ${palette.slice(0, 4).join(" ")}` : ""}; no text, no logos.`;
}
// 요청 종류 — 명시가 먼저, 없으면 말로(아이콘 · 실제 사진). 나머지는 일러스트
export function kindOf(brief, kind) {
    if (kind === "photo" || kind === "illustration" || kind === "icon")
        return kind;
    if (/flat icon|\bicon\b|아이콘/i.test(brief))
        return "icon";
    if (/\b(photo|photograph|real (people|event|venue|stage|audience))\b|실제\s*(사진|행사|사람|현장)|현장\s*사진/i.test(brief))
        return "photo";
    return "illustration";
}
// 이 요청만 다른 톤(보정 1) — "이 그림만 다른 톤으로" · 요청 style: "own"
export const OWN_WORDS = /이\s*그림만|이\s*사진만|다른\s*톤|톤\s*상관\s*없|따로\s*그려|own style/i;
export function classify(st) {
    if (st.colors > 900 && st.smooth > 0.3)
        return "photo";
    if (st.colors < 420 || st.smooth < 0.12)
        return "flat";
    return "3d";
}
// 팩 규칙(context/RULES.md "## Style pack — …")의 그림 줄
export function packSentence(rules) {
    const sec = rules.match(/## Style pack — [\s\S]*?(?=\n## |$)/)?.[0] ?? "";
    const line = sec.split("\n").map(l => l.replace(/^\s*[-*]\s*/, "").trim()).find(l => /^(image style|illustration style|photo style|그림체|그림 스타일)\s*[:：]/i.test(l));
    return line ? `Deck image style (keep every image in this deck the same): ${line.replace(/^[^:：]+[:：]\s*/, "")}` : null;
}
