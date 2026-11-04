// 순수 함수(photo-runner·chat·시험이 같이 쓴다)
// 사진은 사용자가 넣는다(#304 차이 목록 — 2회차 D "사진은 내가 나중에 넣을 거니까 자리만 비워두고": 앱이 재고 7장을 받아 숨겼고, 사진 자리 표시가 없어 장 가운데가 그냥 비었다)
// 5회차 F(처음 보는 원고) "사무실 사진 2장 내가 넣을 거라 자리만" — 예전 식은 D 원고 말투("사진은 내가 …")에만 맞아 "사진 2장"·"자리만"(비워 없이)을 놓쳤다(과적합). 사진과 주어·부사 사이 15자, 사진 뒤 30자 안의 "자리만"도 받는다
export const PHOTO_OWN = /사진[^.\n]{0,15}?(내가|제가|직접|따로|나중에)[^.\n]{0,12}?(넣|올리|올릴|올려|찍|드릴|드려|보낼|보내)|사진[^.\n]{0,30}?자리만|자리만\s*비워|사진은\s*비워|photos?\s+later|i'?ll\s+(add|send)\s+(the\s+)?photos/i; // 내가·제가·직접·따로·나중에 중 하나가 있어야("사진 넣어 줘"는 반대 뜻)
export const PHOTO_OWN_FILE = ".dynapse/photo-own.json";
// 사진 자리 표시 — 칸에 data-photo-placeholder(안내 글)·data-slot-empty. 모양은 verify DYN_BASE(점선 강조색 틀 + 글). 사진이 오면 setSlotImg가 뗀다
// 틀 모양을 장 안에도(#314 보정 3 — 3회차 D: 표시는 verify DYN_BASE에만 있어 raw 레인 장·PNG·내보내기엔 안 보였다). verify DYN_BASE의 자리 표시 세 줄과 같다
// 칸 모양은 :where()(특이도 0 — AI의 position·크기를 이기지 않게) · 라벨은 높은 특이도 + !important(8회차 F-1: AI의 .photo:empty:after{inset:0}이 내 left/top을 0으로 되돌리고 translate만 남아 라벨이 왼쪽 위로 잘렸다). 라벨 = 바탕 칩(bg-surface + text-strong · 26px) · 틀은 안쪽 20px(7회차 D-1 장 전체 표지 자리가 장 테두리처럼 보였다)
export const SPOT_STYLE = `<style data-photo-spot>:where([data-photo-placeholder]:not(:has(>img[src]:not([src=''])))){background:color-mix(in srgb,var(--color-semantic-accent-base,#888) 7%,var(--color-semantic-bg-surface,#FFFFFF))!important;position:relative;outline:2px dashed color-mix(in srgb,var(--color-semantic-accent-base,#888) 65%,transparent);outline-offset:-20px}:where([data-photo-placeholder]:not(:has(>img[src]:not([src='']))))>img{display:none}html body [data-photo-placeholder]:not(:has(>img[src]:not([src=''])))::after{content:attr(data-photo-placeholder)!important;position:absolute!important;inset:auto!important;left:50%!important;top:50%!important;transform:translate(-50%,-50%)!important;display:block!important;width:auto!important;height:auto!important;max-width:min(80%,640px)!important;padding:.35em .8em!important;border-radius:.5em!important;text-align:center!important;white-space:normal!important;font:600 26px/1.35 var(--typography-font-family-base,sans-serif)!important;color:var(--color-semantic-text-strong,#111)!important;background:var(--color-semantic-bg-surface,#FFFFFF)!important}</style>`;
export function markPhotoSpot(html, slot, label) {
    const re = new RegExp(`(<[a-z][a-z0-9]*\\b[^>]*\\bdata-slot\\s*=\\s*["']${slot.replace(/[^\w-]/g, "")}["'])([^>]*>)`, "i");
    const out = html.replace(re, (m, a, b) => /data-photo-placeholder/.test(m) ? m : `${a} data-slot-empty data-photo-placeholder="${label.replace(/["<>&]/g, "").slice(0, 40)}"${b}`);
    return out === html || /<style\b[^>]*\bdata-photo-spot\b/i.test(out) ? out : /<\/head>/i.test(out) ? out.replace(/<\/head>/i, `${SPOT_STYLE}\n</head>`) : `${SPOT_STYLE}\n${out}`;
}
// 사진 없는 변형 되돌리기 — 사용자가 사진을 넣는 작업에서 AI가 빈 사진 오류를 피하려고 nophoto로 바꾼 장(data-variant-was 없음 = 앱이 바꾼 게 아님)은 기본 변형으로(사진 격자가 다시 보이고 자리 표시가 붙는다)
export function unNophoto(html) {
    return html.replace(/<section\b[^>]*\bclass\s*=\s*["'][^"']*\bslide\b[^>]*>/i, t => /\bdata-variant\s*=\s*["']nophoto["']/i.test(t) && !/\bdata-variant-was\b/i.test(t) ? t.replace(/\s+data-variant\s*=\s*["']nophoto["']/i, "") : t);
}
// AI 지시 한 줄(영어)
export const PHOTO_OWN_LINE = "[Photos: the user will add their own photos later. Keep every photo slot and the layout variant that has them; leave the slots empty — the app shows each one as a dashed \"사진 자리\" frame. Never switch to a nophoto variant because a photo is missing. List which photo goes where in your reply.]\n";
