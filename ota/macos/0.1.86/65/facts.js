// 빠진 사실(#302 B — 희원 PINK WIG WIZ: 원고에 굿즈·가격·날짜·장소가 없어 AI가 지어내고 → 다듬기가 [대괄호]로 비우고 → 산문으로 4번 다시 물었다).
// 순수 함수만(chat.ts가 쓰고 turn-sim이 시험): 장 글 속 [빈칸] 찾기 · 예시 표기(data-example)로 감싸기 · 받은 값 넣기(엔진 · AI 0)
import { normText } from "./text-norm.js";
// [이름] 또는 [이름: 예시](#304 보정 2 ⑤ · 대표 10-27 "예시로 해서 넣어주면 좋지" — 빈 괄호 대신 그럴듯한 흐린 예시 글로 첫인상을 채운다)
export const BLANK = /\[([^[\]<>\n:：]{1,24})(?:\s*[:：]\s*([^[\]<>\n]{1,60}))?\]/g;
const SKIP = /^(?:첨부|attach|x|\s*)$|^\d+$/i;
// 태그 밖 글 조각에만 손댄다(속성·스타일·스크립트는 그대로)
// SVG 그림 안 글(<text>)은 HTML span을 그리지 않는다(5회차 A2: AI가 손으로 그린 약도의 [큰길 이름]·[역 이름]을 <span data-example>로 감싸 이름표 8개가 다 사라졌다) — 감싸기는 SVG 밖에서만
const SVG_BLOCK = /<svg\b[\s\S]*?<\/svg>/gi;
export const unwrapSvgExamples = (html) => html.replace(SVG_BLOCK, sv => sv.replace(/<span data-example="[^"]*">([^<]*)<\/span>/g, "$1"));
const mapText = (html, f, svg = true) => {
    const parts = html.split(svg ? /(<style\b[\s\S]*?<\/style>|<script\b[\s\S]*?<\/script>|<[^>]+>)/i : /(<svg\b[\s\S]*?<\/svg>|<style\b[\s\S]*?<\/style>|<script\b[\s\S]*?<\/script>|<[^>]+>)/i);
    return parts.map(p => (p.startsWith("<") ? p : f(p))).join("");
};
// 장의 빈칸 이름들(순서대로·중복 없이) — 예시 표기로 이미 감싼 것도 센다
export function blanksOf(html) {
    const body = html.match(/<body\b[\s\S]*<\/body>/i)?.[0] ?? html, out = [];
    // 예시 글로 감싼 칸(괄호 없음)도 — 그 자리를 [이름]으로 바꿔 장 순서대로 센다
    mapText(body.replace(/<span data-example="([^"]{1,24})">[^<]*<\/span>/g, (_a, k) => `[${k}]`), t => { for (const m of t.matchAll(BLANK)) {
        const k = m[1].trim();
        if (!SKIP.test(k) && !out.includes(k))
            out.push(k);
    } return t; });
    return out;
}
// 예시 표기 — [이름]을 점선 상자 + 강조색 글자로(#312 ④ — 회색 글자만이면 빈칸인지 모른다: BizCrush 12-seed-use.ko. Aside 판처럼 상자로). 검사는 의도된 빈칸으로 센다.
// 칩은 제 바탕(bg-surface · 불투명)에 본문 글자색(text-strong) — 글자에 쓰라고 정한 토큰 짝이라 어느 바탕 위에서도 읽힌다(8회차 A-1: AI 색 #325에서 강조색 분홍 면 위 분홍 섞인 글자가 거의 안 보였다 · 예전 판 "2"는 강조 70% + 7% 투명 바탕). 강조색은 점선 테두리만. AI가 쓴 [data-example] 규칙보다 앞서게 한 단계 높인다. 스타일은 머리에 한 번(예전 판 블록은 바꾼다)
export const EXAMPLE_STYLE = `<style data-example-style="3">html body [data-example]{opacity:1;padding:.02em .4em;border:.08em dashed var(--color-semantic-accent-base,currentColor);border-radius:.3em;color:var(--color-semantic-text-strong,#111);background:var(--color-semantic-bg-surface,#FFFFFF);-webkit-box-decoration-break:clone;box-decoration-break:clone}html body [data-example]::after{content:none}</style>`;
const EX_BLOCK = /<style\b[^>]*\bdata-example-style\b[^>]*>[\s\S]*?<\/style\s*>/i;
// 숫자 예시는 만들지 않는다(#314 ② — 앵커 C: 원고에 없는 "4.8점·누적 50만·120만 건"이 점선 예시로 성과처럼 읽혔다) · 표지의 날짜·장소 예시는 사실처럼 읽힌다("11월 3일"·"10월 31일 홍대") → 이름표만
const COVER_FACT = /날짜|일시|일자|기간|요일|시간|장소|위치|주소|place|date|time|venue/i;
// 예시 자리에 "예시"·"샘플"·"내용" 같은 말만 쓴 것은 예시가 아니라 빈칸(8회차 B-1r — [거주 조건: 예시]가 "예시" 칩으로)
const PLACEHOLDER_EX = /^(예시|예|샘플|내용|입력|텍스트|example|sample|text|tbd|xxx|…|\.{2,})$/i;
const labelOnly = (k, ex, cover) => /\d/.test(ex) || (cover && COVER_FACT.test(k)) || PLACEHOLDER_EX.test(ex.trim());
export function markExamples(html, o = {}) {
    let n = 0;
    const cover = !!o.cover;
    // 앞 턴에 감싼 예시도 같은 규칙으로(이름표로 되돌린다)
    // 빈칸 안의 빈칸은 하나로(8회차 B-1r — [나이 조건: [나이]]가 "나이 조건" 칩 안에 "[나이]" 칩으로 겹쳤다): 바깥 이름표 하나
    const pre = unwrapSvgExamples(html).replace(/<span data-example="([^"]{1,24})">\s*<span data-example="[^"]*">[^<]*<\/span>\s*<\/span>/g, (_a, k) => (n++, `<span data-example="${k}">[${k}]</span>`)).replace(/<span data-example="([^"]{1,24})">([^<[]+)<\/span>/g, (all, k, ex) => (labelOnly(k, ex, cover) ? (n++, `<span data-example="${k}">[${k}]</span>`) : all));
    const out = mapText(pre.replace(/(<body\b[\s\S]*<\/body>)/i, b => b), t => t.replace(BLANK, (all, k, ex) => (SKIP.test(k.trim()) ? all : (n++, `<span data-example="${k.trim().replace(/"/g, "")}">${ex?.trim() && !labelOnly(k.trim(), ex.trim(), cover) ? ex.trim() : `[${k.trim()}]`}</span>`))), false);
    // 이미 예시 표기인 요소(우리 span · AI가 쓴 <strong data-example>) 안의 [이름]을 또 감싸지 않게 되돌린다
    const fixed = out.replace(/(<([a-z][a-z0-9]*)\b[^>]*\bdata-example\b[^>]*>)<span data-example="[^"]*">(\[[^\]]*\])<\/span>/gi, "$1$3");
    if (!n && !/\bdata-example\b/.test(html.replace(EX_BLOCK, "")))
        return html;
    const base = n ? fixed : html;
    if (base.includes(EXAMPLE_STYLE))
        return base;
    return EX_BLOCK.test(base) ? base.replace(EX_BLOCK, EXAMPLE_STYLE) : base.replace(/<\/head>/i, `${EXAMPLE_STYLE}\n</head>`);
}
// 받은 값 넣기 — [이름]과 그 예시 표기를 값으로(HTML 이스케이프). 남은 빈칸 수도
export function fillBlanks(html, values) {
    const esc = (s) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    let n = 0, h = html;
    for (const [k, v0] of Object.entries(values)) {
        const v = String(v0 ?? "").trim();
        if (!v)
            continue;
        const kk = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        h = h.replace(new RegExp(`<span data-example="${kk}">[^<]*</span>`, "g"), () => (n++, esc(v)));
        h = mapText(h, t => t.replace(new RegExp(`\\[${kk}(?:\\s*[:：][^[\\]<>\\n]{1,60})?\\]`, "g"), () => (n++, esc(v))));
    }
    if (!/data-example="/.test(h))
        h = h.replace(/\s*<style data-example-style>[\s\S]*?<\/style>/i, "");
    return { html: h, n };
}
// 예시 그대로 쓰기(빈칸 카드 [예시 그대로 쓰기]) — 예시 글이 있는 칸은 표시만 떼고 글은 남긴다. 괄호만 있는 칸([이름])은 그대로
export function keepExamples(html) {
    let n = 0;
    let h = html.replace(/<span data-example="[^"]*">([^<[]*)<\/span>/g, (_a, t) => (n++, t));
    if (!/data-example="/.test(h))
        h = h.replace(/\s*<style\b[^>]*\bdata-example-style\b[^>]*>[\s\S]*?<\/style>/i, ""); // 예전 판·2판 블록 둘 다
    return { html: h, n };
}
// 남은 예시 칸 수 — 내보내기·공개는 0일 때만(#304 보정 2 ⑤). 우리 span과 AI가 쓴 <strong data-example> 둘 다(#312 ④ — 12-seed-use.ko의 AI 표기가 경고에서 빠졌다), 스타일 블록은 아니다
export const exampleCount = (html) => (html.replace(/<style\b[\s\S]*?<\/style\s*>/gi, "").match(/<[a-z][a-z0-9]*\b[^>]*\sdata-example(?=[\s=>])/gi) ?? []).length;
// 예시 글 모으기(카드 입력칸의 흐린 안내 글)
export function examplesOf(html) {
    const out = {};
    for (const m of html.matchAll(/<span data-example="([^"]{1,24})">([^<[]{1,60})<\/span>/g))
        out[m[1]] ??= normText(m[2]);
    return out;
}
// "남은 고칠 것 고쳐"(웹 [고쳐 줘] 버튼 · #302 B ③) — 검사 오류 목록을 그대로 하라는 말. 사실 요청으로 읽지 않는다
export const FIX_REMAINING = /남은\s*(?:고칠|수정할|오류)|고칠\s*것(?:을|들)?\s*(?:다\s*)?(?:고쳐|수정)|오류(?:를|들)?\s*(?:다\s*)?고쳐|fix (?:the )?remaining/i;
const PLACE = /역|출구|카페|빌딩|층\b|센터|홀|공원|광장|거리|길\s*\d|로\s*\d|동\s*\d|호점|매장|스튜디오|갤러리|극장|학교|캠퍼스|라운지/;
export function factsFromText(text) {
    const t = text.replace(/\[첨부:[^\]]*\]/g, " ").split("\n").map(normText).join("\n"), out = []; // 전각 숫자·NBSP·줄 묶음 표시(text-norm) — 줄은 그대로(장소 나누기)
    for (const m of t.matchAll(/(\d{1,2})\s*월\s*(\d{1,2})\s*일(?:\s*\(?[월화수목금토일]\)?(?:요일)?)?|(?<![\d/.])(\d{1,2})\/(\d{1,2})(?:\s*\([월화수목금토일]\))?(?![\d/])/g))
        out.push({ kind: "날짜", value: m[0].trim() });
    for (const m of t.matchAll(/(?:오전|오후|저녁|아침|밤)\s*\d{1,2}\s*시(?:\s*\d{1,2}\s*분|\s*반)?|(?<![\d.])\d{1,2}:\d{2}(?:\s*[~\-–]\s*\d{1,2}:\d{2})?/g))
        out.push({ kind: "시간", value: m[0].trim() });
    for (const m of t.matchAll(/\d[\d,]*\s*(?:만\s*)?원/g))
        out.push({ kind: "가격", value: m[0].replace(/\s+/g, "") });
    for (const m of t.matchAll(/(?<!\d)0\d{1,2}-?\d{3,4}-?\d{4}(?!\d)/g))
        out.push({ kind: "연락처", value: m[0] });
    for (const seg of t.split(/[,，.\n·]|그리고|이고|이에요|입니다/)) {
        const s = seg.trim();
        if (s.length >= 3 && s.length <= 40 && PLACE.test(s) && !/만들|해\s*줘|바꿔|고쳐/.test(s))
            out.push({ kind: "장소", value: s.replace(/^(?:장소는?|위치는?|곳은?)\s*/, "") });
    }
    const seen = new Set();
    return out.filter(f => { const k = `${f.kind}|${f.value}`; if (seen.has(k))
        return false; seen.add(k); return true; }).slice(0, 12);
}
// 일정·장소 이야기가 없는 원고(앵커 6회차 B-1 정책 카드 · C-1 앱 소개 — 표지에 [날짜]·[장소] 견본 칩이 남았다): 첫 결과에서 날짜·장소 빈칸만 든 칸을 앱이 지운다(AI 0)
export const EVENT_TALK = /날짜|일시|언제|기간|일정|장소|위치|오시는|찾아오|약도|지도|팝업|행사|이벤트|축제|세미나|컨퍼런스|콘퍼런스|공연|전시|박람회|모집|마감|신청|접수|오픈|개업|설명회|워크숍|강연|강의|모임|파티|운영\s*시간|영업\s*시간|\bevents?\b|\bdates?\b|\bvenue\b/i;
export const noEventTalk = (text) => !!text.trim() && !EVENT_TALK.test(text) && !factsFromText(text).some(f => f.kind === "날짜" || f.kind === "시간" || f.kind === "장소");
const CHIP_K = "날짜|일시|시간|운영시간|기간|장소|위치";
const CHIP = new RegExp(`<(div|span|p|li)\\b([^>]*\\bdata-slot\\s*=\\s*["'][^"']+["'][^>]*)>\\s*((?:(?:<span data-example="(?:${CHIP_K})">\\[[^\\]<]{1,40}\\]</span>|\\[(?:${CHIP_K})(?:\\s*[:：][^\\]<]{0,60})?\\])\\s*(?:[·|/,–-]\\s*)?)+)</\\1>`, "g");
export function dropEventChips(html) { let n = 0; const out = html.replace(CHIP, () => { n++; return ""; }); return { html: out, n }; }
// 사실만 준 말(요청 동사 없음) — 빈칸에 넣고 AI 턴 없이 끝낸다
export const factsOnly = (text, facts) => facts.length > 0 && !/해\s*줘|해줘|해\s*주세요|만들|바꿔|고쳐|넣어|추가|지워|빼\s*줘|키워|줄여|옮겨|\?|？/.test(text);
// 빈칸 이름 ↔ 사실 종류
export function blankKind(label) {
    return /날짜|일시|일자|언제|기간|date/i.test(label) ? "날짜" : /시간|시각|time/i.test(label) ? "시간" : /장소|위치|주소|오시는\s*길|어디|place|venue/i.test(label) ? "장소" : /가격|금액|원\b|price/i.test(label) ? "가격" : /연락처|전화|문의|phone/i.test(label) ? "연락처" : null;
}
// AI 답이 사실을 다시 묻나 — 묻는 말 + 사실 종류
const ASKING = /알려\s*주|보내\s*주|주시면|말씀해\s*주|입력해\s*주|정해\s*주시|확인해\s*주시|필요해요|필요합니다|please (?:send|share|provide|tell)/i;
export function asksFor(reply0) {
    const reply = normText(reply0);
    if (!ASKING.test(reply))
        return [];
    const k = [];
    if (/날짜|일시|언제|일정|date/i.test(reply))
        k.push("날짜");
    if (/시간|몇\s*시|time/i.test(reply))
        k.push("시간");
    if (/장소|위치|주소|어디|오시는\s*길|place|venue|address/i.test(reply))
        k.push("장소");
    if (/가격|금액|price/i.test(reply))
        k.push("가격");
    if (/연락처|전화|phone|contact/i.test(reply))
        k.push("연락처");
    return k;
}
// ── C5 ⑤ 한도 — 영어 원문 대신 사람 말 + 이어서 하기 ──
export const LIMIT_TEXT = /hit your (?:session|usage|weekly|daily|5-hour|five-hour|opus(?: weekly)?) limit|opus (?:weekly )?limit|usage limit (?:reached|exceeded)|reached your (?:usage )?limit|rate[- ]limit(?:ed| exceeded)|limit reached|quota (?:exceeded|exhausted)|You've hit|too many requests|429/i;
export function limitInfo(text) {
    if (!text || !LIMIT_TEXT.test(text))
        return null;
    const m = text.match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (!m)
        return { reset: null };
    const h = Number(m[1]), pm = (m[3] ?? "").toLowerCase() === "pm";
    return { reset: `${m[3] ? (pm ? "오후 " : "오전 ") : ""}${h}${m[2] ? `:${m[2]}` : "시"}` };
}
// "그럼 지피티가 해"·"GPT로 이어서" — 다른 AI로 하던 일 이어 가기
export function switchTo(text) {
    if (text.length > 40 || !/해|이어|계속|넘겨|바꿔/.test(text))
        return null;
    return /지피티|gpt|chatgpt|챗지피티|코덱스|codex|오픈ai/i.test(text) ? "chatgpt" : /클로드|claude/i.test(text) ? "claude" : /제미나이|gemini|구글/i.test(text) ? "gemini" : null;
}
