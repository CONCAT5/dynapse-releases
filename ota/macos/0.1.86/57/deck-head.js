// 기존 덱에 새 장을 쓸 때의 머리 줄(#310 ⑥ — BizCrush IR 412차: 새 마일스톤 장이 font-family:Pretendard를 직접 쓰고, 라벨이 "마 일 스 톤"으로 남았다(대표: 영한 모두 "Milestone"),
// 다른 장의 로고 그림도 따라 들어갔다). 순수 함수 — 앱의 턴 머리(chat.ts)와 시험이 같이 쓴다. AI 지시는 영어
// 새 장 요청 — "장 하나 추가" · "페이지 더 만들어" · "새 슬라이드" · "add a slide". 고치기("이 장 제목 바꿔")는 아니다
export const ADD_PAGE = /(장|페이지|슬라이드)\s*(을|를|하나|한\s*장|더)?\s*(추가|더\s*만들|새로\s*만들|만들어|넣어)|새\s*(장|페이지|슬라이드)|\badd\s+(a\s+|one\s+|new\s+)*(page|slide)s?\b/i;
// 낱말 통일 — "영한 모두 Milestone으로" · "같은 말로" · "통일해"("둘 다 키워"·"양쪽 여백"은 아니다)
export const UNIFY = /통일|똑같이|같은\s*말로|영한|한영|모든\s*언어|both\s+(editions|languages)/i;
// 덱의 구획 라벨 한 개(새 장이 따라 쓸 모양) — data-slot이나 class에 label·kicker·eyebrow가 든 짧은 글 요소. 없으면 null
export function labelSample(pages) {
    const re = /<(div|span|p|small)\b([^>]*\b(?:class|data-slot)\s*=\s*["'][^"']*(?:label|kicker|eyebrow)[^"']*["'][^>]*)>([^<]{1,30})<\/\1>/i;
    for (const h of pages) {
        const m = h.match(re);
        if (!m)
            continue;
        const cls = m[2].match(/\bclass\s*=\s*["']([^"']+)["']/i)?.[1]?.trim(), t = m[3].replace(/\s+/g, " ").trim();
        if (t)
            return `<${m[1].toLowerCase()}${cls ? ` class="${cls.slice(0, 60)}"` : ""}>${t}</${m[1].toLowerCase()}>`;
    }
    return null;
}
export function newPageLine(sample) {
    return `[New page in this deck: wear the deck's tokens — text in font-family: var(--typography-font-family-body), titles in var(--typography-font-family-display), colours only through var(--color-semantic-…); never write a font name or a hex. Section labels follow the deck's existing labels${sample ? ` — same markup and class as ${sample}` : ""}, worded as the user asked. Do not copy logos or images from other pages unless asked.]\n`;
}
export const UNIFY_LINE = `[Wording: the user is making a word the same everywhere — change it in every language edition of each page (the .ko.html and .en.html files as well as the base page) and inside letter-spaced labels too (e.g. "마 일 스 톤" → "Milestone").]\n`;
