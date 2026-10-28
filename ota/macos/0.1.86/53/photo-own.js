// 순수 함수(photo-runner·chat·시험이 같이 쓴다)
// 사진은 사용자가 넣는다(#304 차이 목록 — 2회차 D "사진은 내가 나중에 넣을 거니까 자리만 비워두고": 앱이 재고 7장을 받아 숨겼고, 사진 자리 표시가 없어 장 가운데가 그냥 비었다)
export const PHOTO_OWN = /사진\s*(은|는)?\s*(?=(내가|제가|직접|따로|나중에))(내가|제가)?\s*(직접|따로)?\s*(나중에)?\s*(넣|올리|올릴|올려|찍|드릴|드려|보낼|보내)|자리만\s*비워|사진\s*자리만|사진은\s*비워|photos?\s+later|i'?ll\s+(add|send)\s+(the\s+)?photos/i; // 내가·제가·직접·따로·나중에 중 하나가 있어야("사진 넣어 줘"는 반대 뜻)
export const PHOTO_OWN_FILE = ".dynapse/photo-own.json";
// 사진 자리 표시 — 칸에 data-photo-placeholder(안내 글)·data-slot-empty. 모양은 verify DYN_BASE(점선 강조색 틀 + 글). 사진이 오면 setSlotImg가 뗀다
export function markPhotoSpot(html, slot, label) {
    const re = new RegExp(`(<[a-z][a-z0-9]*\\b[^>]*\\bdata-slot\\s*=\\s*["']${slot.replace(/[^\w-]/g, "")}["'])([^>]*>)`, "i");
    return html.replace(re, (m, a, b) => /data-photo-placeholder/.test(m) ? m : `${a} data-slot-empty data-photo-placeholder="${label.replace(/["<>&]/g, "").slice(0, 40)}"${b}`);
}
// 사진 없는 변형 되돌리기 — 사용자가 사진을 넣는 작업에서 AI가 빈 사진 오류를 피하려고 nophoto로 바꾼 장(data-variant-was 없음 = 앱이 바꾼 게 아님)은 기본 변형으로(사진 격자가 다시 보이고 자리 표시가 붙는다)
export function unNophoto(html) {
    return html.replace(/<section\b[^>]*\bclass\s*=\s*["'][^"']*\bslide\b[^>]*>/i, t => /\bdata-variant\s*=\s*["']nophoto["']/i.test(t) && !/\bdata-variant-was\b/i.test(t) ? t.replace(/\s+data-variant\s*=\s*["']nophoto["']/i, "") : t);
}
// AI 지시 한 줄(영어)
export const PHOTO_OWN_LINE = "[Photos: the user will add their own photos later. Keep every photo slot and the layout variant that has them; leave the slots empty — the app shows each one as a dashed \"사진 자리\" frame. Never switch to a nophoto variant because a photo is missing. List which photo goes where in your reply.]\n";
