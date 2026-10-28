// 빈 아이콘 칸에 기본 아이콘(#304 차이 목록 — 앵커 2회차 C: 기능 아이콘 칸에 유리 체스 말 재고 사진, 재고를 끊으면 빈 상자. 빈 상자는 흔한 아이콘보다 나쁘다).
// 아이콘 칸(icon · icon_* · *_icon)은 재고 사진을 받지 않고, 비어 있으면 앱이 data-icon 목록(Lucide, verify.mjs의 ICONS)에서 주변 낱말로 하나 골라 덱 강조색으로 넣는다(AI 0).
// 생성 아이콘이 오면 setSlotImg → stripSlotArt가 이 그림(data-art-slot)을 뗀다. 순수 함수 — photo-runner와 시험이 같이 쓴다
export const ICON_SLOT = /(^|[_-])icons?([_-]|\d|$)/i;
// 낱말 → 아이콘(앞이 먼저). 칸 이름(영어)·설명 글·장 제목(한국어) 순서로 찾는다
const KEYS = [
    [/번역|통역|언어|translat|language|langs?\b/i, "languages"], [/지구|글로벌|세계|해외|국가|globe|global|world/i, "globe"],
    [/마이크|음성|녹음|목소리|말소리|voice|mic|record/i, "mic"], [/스피커|소리|들려|재생|speaker|sound|audio|volume/i, "volume-2"],
    [/기록|노트|메모|문서|저장|원문|note|memo|doc|text|save/i, "file-text"], [/대화|채팅|메시지|말하|chat|message|talk|conversation/i, "message-circle"],
    [/시간|빠른|속도|분\b|초\b|clock|time|speed|fast/i, "clock"], [/보안|안전|개인정보|security|secure|privacy|shield/i, "shield-check"],
    [/팀|사람들|모두|team|people|users/i, "users"], [/사람|사용자|고객|회원|user|person|customer/i, "user"],
    [/돈|비용|가격|요금|지갑|money|cost|price|wallet/i, "wallet"], [/카드|결제|pay|card/i, "credit-card"], [/선물|이벤트|혜택|gift|event|benefit/i, "gift"],
    [/지도|위치|장소|오시는|map|location|place|pin/i, "map-pin"], [/전화|연락|phone|call/i, "phone"], [/메일|이메일|mail|email/i, "mail"],
    [/별|평점|리뷰|star|rating|review/i, "star"], [/성장|증가|상승|growth|trend|increase/i, "trending-up"], [/아이디어|생각|idea|insight/i, "lightbulb"],
    [/설정|맞춤|setting|config/i, "settings"], [/검색|찾|search|find/i, "search"], [/사진|카메라|촬영|photo|camera/i, "camera"], [/영상|동영상|video/i, "video"],
    [/일정|달력|날짜|예약|calendar|schedule|date/i, "calendar"], [/쇼핑|구매|장바구니|shop|cart|buy/i, "shopping-cart"], [/배송|택배|delivery|ship|truck/i, "truck"],
    [/교육|학습|공부|education|learn|study/i, "graduation-cap"], [/건강|좋아|사랑|health|love|heart/i, "heart"], [/확인|체크|완료|check|done|verify/i, "circle-check"],
    [/연결|링크|connect|link/i, "link"], [/클라우드|동기|cloud|sync/i, "cloud"], [/휴대폰|스마트폰|모바일|앱|phone app|mobile|smartphone|\bapp\b/i, "smartphone"],
    [/헤드폰|이어폰|headphone|earphone/i, "headphones"], [/자동|ai|인공지능|auto|magic/i, "sparkles"],
];
export const ICON_FALLBACK = "sparkles";
// verify.mjs의 ICONS 한 줄(/*@icons*/const ICONS = {…};) → {이름: SVG 안쪽}
export function iconsFrom(verifySrc) {
    const m = verifySrc.match(/\/\*@icons\*\/const ICONS = (\{[\s\S]*?\});/);
    if (!m)
        return null;
    try {
        return JSON.parse(m[1]);
    }
    catch {
        return null;
    }
}
export function pickIcon(ctx, have = () => true) {
    for (const t of ctx)
        for (const [re, name] of KEYS)
            if (re.test(t) && have(name))
                return name;
    return have(ICON_FALLBACK) ? ICON_FALLBACK : ctx.length ? "star" : ICON_FALLBACK;
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const text = (h) => h.replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<svg\b[\s\S]*?<\/svg>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
// 칸의 문맥 — ① 칸 이름(icon_globe → globe) ② 칸 바로 뒤 글(같은 카드의 제목·설명, 120자) ③ 장 제목
export function slotContext(html, slot) {
    const re = new RegExp(`<(\\w+)\\b[^>]*\\bdata-slot\\s*=\\s*["']${esc(slot)}["'][^>]*>[\\s\\S]*?<\\/\\1>`, "i"), m = html.match(re);
    const after = m ? text(html.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 900)).slice(0, 120) : "";
    const head = text(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>|<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[0] ?? "");
    return [slot.replace(ICON_SLOT, " ").replace(/[_-]+/g, " ").trim(), after, head].filter(Boolean);
}
// 빈 아이콘 칸(그 안에 src 있는 img·svg가 없음)에 기본 아이콘 — 칸 요소 안쪽을 바꾼다(빈 img는 뺀다). img 자체가 칸이면 건드리지 않는다
export function fillIcon(html, slot, name, inner) {
    const re = new RegExp(`(<(\\w+)\\b[^>]*\\bdata-slot\\s*=\\s*["']${esc(slot)}["'][^>]*>)([\\s\\S]*?)(<\\/\\2>)`, "i"), m = html.match(re);
    // 다른 칸을 품은 묶음(icon_items 같은 바깥 상자)은 아이콘 칸이 아니다
    if (!m || /\bdata-slot\s*=/i.test(m[3]) || /^img$/i.test(m[2]) || /<img\b[^>]*\bsrc\s*=\s*["'][^"']+["']/i.test(m[3]) || /<svg\b/i.test(m[3]))
        return { html, ok: false };
    const svg = `<svg data-icon-default="${name}" data-art-slot="${slot.replace(/[^\w-]/g, "")}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:block;width:64%;height:64%;margin:auto;color:var(--color-semantic-accent-base,currentColor)">${inner}</svg>`;
    return { html: html.replace(re, (_a, open, _t, body, close) => `${open}${body.replace(/<img\b[^>]*\bsrc\s*=\s*["']\s*["'][^>]*>/gi, "")}${svg}${close}`), ok: true };
}
