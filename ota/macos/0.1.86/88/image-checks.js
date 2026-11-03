// 생성 그림 검사(순수 함수 · 의존성 없음 — 앱과 turn-sim이 같은 함수, #343 보정 8)
// ① 흰 바탕 칸: 생성기가 배경 줄(BG_LINE)을 무시하고 불투명한 흰 바탕을 그린 그림(13회차 C 5장 — 어두운 장 위 흰 네모 칸)
// ② 그림 속 글자: 아이콘 크기 그림은 글자 상자 하나만 보여도 "글자 없이" 다시(작은 글자를 OCR 두 상자 기준이 놓쳤다)
import { bbox, keyOut } from "./hero-sheet.js";
// 둘레(위·아래 두 줄, 양옆 두 열)를 고르게 훑어 거의 흰색(채널 ≥ 228)·불투명(알파 ≥ 250)이 85% 이상이면 흰 바탕
export function whiteBackdrop(px, w, h) {
    if (w < 4 || h < 4)
        return false;
    const near = (i) => px[i + 3] >= 250 && px[i] >= 228 && px[i + 1] >= 228 && px[i + 2] >= 228;
    let n = 0, wht = 0;
    const sx = Math.max(1, Math.floor(w / 64)), sy = Math.max(1, Math.floor(h / 64));
    for (let x = 0; x < w; x += sx)
        for (const y of [0, 1, h - 2, h - 1]) {
            n++;
            if (near((y * w + x) * 4))
                wht++;
        }
    for (let y = 0; y < h; y += sy)
        for (const x of [0, 1, w - 2, w - 1]) {
            n++;
            if (near((y * w + x) * 4))
                wht++;
        }
    return wht / n >= 0.85;
}
// 흰 바탕을 투명으로(hero-sheet keyOut — 가장자리에서 이어진 비슷한 색만) · 남은 그림이 판의 2~97%면 성공, 아니면 false(그대로 두고 다시 그리기로)
export function cutWhite(px, w, h) {
    keyOut(px, w, h, 30);
    const b = bbox(px, w, h);
    if (!b)
        return false;
    const a = (b.w * b.h) / (w * h);
    return a >= 0.02 && a <= 0.97;
}
// OCR 결과(verify ocr-files: 글자 상자 수·넓이 비율) → 글자 있음. 작은 그림(아이콘·1:1)은 상자 하나만으로
export function textHit(o, small) {
    if (!o)
        return false;
    return small ? o.boxes >= 1 : o.boxes >= 2 || o.area >= 0.01;
}
// 바탕이 어두운 장인지 — 장 안 토큰(또는 tokens.css)의 --color-semantic-bg-base 밝기 < 0.35
export function darkGround(css) {
    const m = css.match(/--color-semantic-bg-base\s*:\s*#([0-9a-f]{6}|[0-9a-f]{3})\b/i);
    if (!m)
        return false;
    const h = m[1].length === 3 ? m[1].split("").map(c => c + c).join("") : m[1], v = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2] < 0.35;
}
