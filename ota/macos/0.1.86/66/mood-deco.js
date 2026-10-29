const A2 = "var(--color-semantic-accent-alt,var(--color-semantic-accent-base))"; // 보조색(3색 체계의 셋째 — 표 6)
const STICKERS = { kitsch: ["burst", "ticket", "tape"], grotesque: ["stamp", "hazard"], street: ["hazard", "tape", "burst"], cute: ["sparkle", "burst"], pop: ["burst", "sparkle"],
    retro: ["ticket", "stamp"], y2k: ["sparkle", "ticket"], vintage: ["stamp", "ticket"], traditional: ["stamp"], dreamy: ["sparkle"], warm: ["tape"] };
// 둘이면 뒷 분위기 먼저(장식은 뒷 낱말), 셋까지
export function stickersOf(moodId) {
    const [a, b] = moodId.split("+");
    return [...new Set([...(b ? STICKERS[b] ?? [] : []), ...(STICKERS[a] ?? [])])].slice(0, 3);
}
const svg = (d) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${d}</svg>`)}")`;
const BURST = svg(`<polygon points="${Array.from({ length: 32 }, (_, i) => { const r = i % 2 ? 36 : 50, t = (i / 32) * Math.PI * 2; return `${(50 + r * Math.sin(t)).toFixed(1)},${(50 - r * Math.cos(t)).toFixed(1)}`; }).join(" ")}"/>`);
const SPARK = svg(`<path d="M50 0C54 38 62 46 100 50C62 54 54 62 50 100C46 62 38 54 0 50C38 46 46 38 50 0Z"/>`);
const STK = (k) => `[data-orn="${k}"]:not([data-orn-app])`;
const STICKER_CSS = {
    burst: `${STK("burst")}{position:absolute;z-index:2;display:flex;align-items:center;justify-content:center;width:5.2em;height:5.2em;padding:1em;box-sizing:border-box;text-align:center;font:800 28px/1.05 var(--typography-font-family-display,var(--typography-font-family-body,sans-serif));color:var(--color-semantic-on-accent-alt,var(--color-semantic-text-strong));background:${A2};-webkit-mask:${BURST} center/contain no-repeat;mask:${BURST} center/contain no-repeat;transform:rotate(-8deg)}`,
    stamp: `${STK("stamp")}{position:absolute;z-index:2;display:flex;align-items:center;justify-content:center;width:4.8em;height:4.8em;box-sizing:border-box;padding:.6em;border:.14em solid var(--color-semantic-accent-base);border-radius:50%;outline:.06em dashed var(--color-semantic-accent-base);outline-offset:-.42em;text-align:center;font:800 26px/1.1 var(--typography-font-family-display,var(--typography-font-family-body,sans-serif));color:var(--color-semantic-accent-base);transform:rotate(-12deg)}`,
    tape: `${STK("tape")}{position:absolute;z-index:2;display:inline-block;padding:.35em 1.3em;font:700 26px/1.2 var(--typography-font-family-label,var(--typography-font-family-body,sans-serif));color:var(--color-semantic-on-accent-alt,var(--color-semantic-text-strong));background:${A2};transform:rotate(-4deg);clip-path:polygon(0 8%,4% 0,8% 10%,12% 0,88% 0,92% 9%,96% 0,100% 10%,100% 90%,96% 100%,92% 91%,88% 100%,12% 100%,8% 90%,4% 100%,0 92%)}`,
    ticket: `${STK("ticket")}{position:absolute;z-index:2;display:inline-block;padding:.5em 1.5em;font:800 26px/1.2 var(--typography-font-family-label,var(--typography-font-family-body,sans-serif));color:var(--color-semantic-on-accent,#fff);background:var(--color-semantic-accent-base);-webkit-mask:radial-gradient(circle at 0 50%,transparent .45em,#000 .47em) left/51% 100% no-repeat,radial-gradient(circle at 100% 50%,transparent .45em,#000 .47em) right/51% 100% no-repeat;mask:radial-gradient(circle at 0 50%,transparent .45em,#000 .47em) left/51% 100% no-repeat,radial-gradient(circle at 100% 50%,transparent .45em,#000 .47em) right/51% 100% no-repeat}`,
    hazard: `${STK("hazard")}{position:absolute;z-index:2;display:inline-block;padding:.4em .9em;font:800 26px/1.2 var(--typography-font-family-label,var(--typography-font-family-body,sans-serif));letter-spacing:.04em;color:var(--color-semantic-bg-base);background:var(--color-semantic-text-strong);border:.32em solid transparent;border-image:repeating-linear-gradient(-45deg,${A2} 0 .45em,var(--color-semantic-text-strong) .45em .9em) 1}`,
    sparkle: `${STK("sparkle")}{position:absolute;z-index:2;display:block;width:1.8em;height:1.8em;font-size:24px;background:${A2};-webkit-mask:${SPARK} center/contain no-repeat;mask:${SPARK} center/contain no-repeat}`,
};
// AI 지시 한 줄(영어 · 매 턴 — 덱 모티프 줄과 같은 자리). 스티커가 없는 분위기면 빈 글
export function stickerLine(moodId) {
    const ks = stickersOf(moodId);
    if (!ks.length)
        return "";
    return `[Mood stickers (optional): at most 2 per page, e.g. <span data-orn="${ks[0]}" style="left:120px;top:80px">한정 30개</span> — kinds for this deck: ${ks.join(", ")}${ks.includes("sparkle") ? " (sparkle has no text)" : ""}. Position with left/top inside the slide only; the app draws the shape and colours. Text ≤ 10 characters and only facts from the brief. Never over other text — verify blocks overlaps.]\n`;
}
export const MOOD_FILE = ".dynapse/mood.json";
// "장식 빼"(#312 보정 3 ④ — raw 레인에서도 분위기 장식을 앱이 덧씌우므로, 사용자가 끄면 그 작업에서 다시 넣지 않는다 · engine.json decor:false). 짧은 한 문장만
export const DECOR_OFF = /^(분위기\s*)?(장식|띠|스티커|꾸밈)(\s*(다|전부|모두|은|는|을|를))?\s*(빼|없애|지워|떼|꺼)(\s*줘|\s*주세요|\s*줄래)?[\s.!~요]*$/;
// 장식 개수 한 줄(턴 끝 — raw 레인): 띠 장 수 · 레터링 · 장치 · 엔진 스티커
export function decorCount(pages) {
    let band = 0, letter = 0, device = 0, sticker = 0;
    for (const h of pages) {
        if (/<(div|i) data-orn="frame-(top|bottom)" data-orn-app/.test(h))
            band++;
        if (/<section\b[^>]*\bdata-letter="/.test(h))
            letter++;
        device += (h.match(/<i data-orn="(ink|torn)" data-orn-app/g) ?? []).length;
        sticker += (h.match(/data-orn-eng aria-hidden/g) ?? []).length;
    }
    return { band, letter, device, sticker };
}
// 사진 검색어(#309 ④ — C3 10회차 S3: 할로윈 록 팝업 2장에 눈 오는 창가 커플 재고). 주제 영어 낱말 둘 → 분위기 낱말 둘 → 나머지(서버는 앞의 영어 낱말 셋으로 공개 사진을 찾는다)
export function moodPhotoReq(en, rest, photo) {
    const w = [...new Set(en.trim().toLowerCase().split(/\s+/).filter(Boolean))], t = (photo?.terms ?? []).map(x => x.toLowerCase()).filter(x => !w.includes(x)).slice(0, 2);
    return [[...w.slice(0, 2), ...t].join(" "), w.slice(2).join(" "), rest].filter(x => x.trim()).join(" · ").trim().slice(0, 300);
}
// 제외어가 든 글(재고 이름·태그·공개 사진 제목) — 낱말 단위, 끝말 s·es·y·ies·ing·ed까지(snowy · couples). snowboard는 다른 낱말
// 한국어 대응어(#314 ① — 재고의 주제 글은 한국어라 "wedding"이 "결혼식 안내"를 못 잡았다). hub lib/mood.ts와 desktop mood-deco.ts가 /*@avoid*/ 줄을 똑같이 갖는다(sync-sim이 비교)
/*@avoid*/ const AVOID_KO = { neon: ["네온"], wedding: ["웨딩", "결혼", "청첩", "신랑", "신부", "예식", "상견례"], party: ["파티"], horror: ["공포", "호러"], skull: ["해골"], snow: ["눈 오는", "눈 내리", "눈길", "설경", "눈사람", "함박눈"], cozy: ["아늑"], baby: ["아기", "돌잔치", "신생아"], futuristic: ["미래"], cyber: ["사이버"], plastic: ["플라스틱"], dark: ["어두운"], couple: ["커플", "연인", "부부", "상견례"], rustic: ["시골풍", "러스틱"], farm: ["농장", "농촌"], office: ["사무실", "오피스", "사무소"], clutter: ["어수선"], crowd: ["군중", "인파"], glitter: ["글리터", "반짝이"], landscape: ["풍경"], "modern office": ["사무실", "오피스"], wood: ["원목"], cartoon: ["만화", "카툰"], toy: ["장난감"], cheap: ["싸구려"], cold: ["차가운"], weapon: ["무기", "총기"], gothic: ["고딕"], "city night": ["야경"], funeral: ["장례", "추모"], gloomy: ["우울"] };
export const avoidHit = (text, avoid = []) => avoid.find(a => new RegExp(`(^|[^a-z])${a.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(s|es|y|ies|ing|ed)?($|[^a-z])`).test(text.toLowerCase()) || (AVOID_KO[a.toLowerCase()] ?? []).some(k => text.includes(k))) ?? null;
const DEV_MAP = [[/잉크|번진|번짐/, "ink"], [/찢/, "torn"], [/오프셋|어긋난/, "offset"]];
export function devicesOf(devices = []) {
    const out = [];
    for (const d of devices)
        for (const [re, k] of DEV_MAP)
            if (re.test(d) && !out.includes(k))
                out.push(k);
    return out.slice(0, 2);
}
// 엔진 스티커(#309 ⑤ — 라이브에서 AI가 스티커를 0개 뒀다): 글 없는 모양만(별 폭발·반짝임·경고 줄·테이프 — 사실을 지어내지 않게). 표지 둘 · 마무리 하나
const BLANK = ["burst", "sparkle", "hazard", "tape"];
export function engineStickers(moodId) {
    const ks = stickersOf(moodId).filter(k => BLANK.includes(k));
    return ks.length ? [...new Set([...ks, ks.includes("burst") ? "sparkle" : "burst"])].slice(0, 2) : [];
}
// 자리 — 표지: 오른쪽 가운데·오른쪽 아래 / 마무리: 왼쪽 위(띠 아래). 레이아웃마다 글 자리가 달라 겹치면 verify ornament_overlap → 앱이 그 스티커만 뗀다
const ENG_AT = { cover: ["right:72px;top:40%", "right:220px;top:62%"], close: ["left:64px;top:96px"] };
const ENG_CSS = {
    burst: `width:132px;height:132px;background:${A2};-webkit-mask:${BURST} center/contain no-repeat;mask:${BURST} center/contain no-repeat;transform:rotate(-10deg)`,
    sparkle: `width:64px;height:64px;background:${A2};-webkit-mask:${SPARK} center/contain no-repeat;mask:${SPARK} center/contain no-repeat`,
    hazard: `width:200px;height:30px;background:repeating-linear-gradient(-45deg,var(--color-semantic-text-strong) 0 12px,${A2} 12px 24px);transform:rotate(-6deg)`,
    tape: `width:170px;height:36px;background:color-mix(in srgb,${A2} 85%,transparent);transform:rotate(5deg);clip-path:polygon(0 8%,4% 0,8% 10%,12% 0,88% 0,92% 9%,96% 0,100% 10%,100% 90%,96% 100%,92% 91%,88% 100%,12% 100%,8% 90%,4% 100%,0 92%)`,
    stamp: "", ticket: "",
};
// 사전의 장식 말(한국어) → 엔진 장식. 앞(뒷 분위기 장식이 먼저 온다 — 서버 detectMood)부터 둘까지
const MAP = [[/스티커|외곽선|오프셋|그림자/, "sticker"], [/그레인|질감|하프톤|반점|잉크/, "grain"], [/줄무늬|띠/, "stripes"]];
export function decosOf(devices = []) {
    const out = [];
    for (const d of devices)
        for (const [re, k] of MAP)
            if (re.test(d) && !out.includes(k)) {
                out.push(k);
                break;
            }
    return out.slice(0, 2);
}
// 분위기 → 아래 띠 모티프(앞 분위기 = 팔레트를 정한 분위기 기준). 줄무늬 장식이 잡혔는데 정해 둔 모티프가 선이면 대각 줄
const BANDS = { kitsch: "checker", street: "hazard", retro: "stripes3", cute: "dots", pop: "dots", grotesque: "stripes", y2k: "dots", dreamy: "line", minimal: "line", luxury: "line", calm: "line", vintage: "line", traditional: "line", nature: "line", warm: "line" };
// 분위기 → 레터링(둘이면 뒷 분위기 먼저 — 글꼴·장식을 정하는 쪽). 희원 키치+그로테스크 = 흘러내림(PINK WIG WIZ 레퍼런스의 흘러내리는 제목)
const LETTERS = { kitsch: "extrude", retro: "extrude", pop: "extrude", grotesque: "drip", street: "outline", cute: "outline", y2k: "chrome" };
export function letterOf(moodId) {
    const [a, b] = moodId.split("+");
    return (b && LETTERS[b]) || LETTERS[a] || null;
}
export function bandOf(moodId, decos = []) {
    const b = BANDS[moodId.split("+")[0]] ?? "line";
    return b === "line" && decos.includes("stripes") ? "stripes" : b;
}
const TITLE = `:is(h1,[data-slot="title"],[data-slot="headline"])`;
const BAND_CSS = {
    checker: `height:18px;background:repeating-conic-gradient(${A2} 0 25%,var(--color-semantic-bg-base) 0 50%) 0 0/18px 18px`,
    hazard: `height:16px;background:repeating-linear-gradient(-45deg,var(--color-semantic-text-strong) 0 12px,${A2} 12px 24px)`,
    stripes3: `height:24px;background:linear-gradient(var(--color-semantic-accent-base) 0 33%,${A2} 33% 66%,var(--color-semantic-text-strong) 66%)`,
    stripes: `height:16px;background:repeating-linear-gradient(-45deg,var(--color-semantic-accent-base) 0 14px,${A2} 14px 28px)`,
    dots: `height:16px;background:radial-gradient(circle,${A2} 3px,transparent 3.5px) 0 0/16px 16px`,
    line: `height:2px;background:${A2}`,
};
// 번진 잉크 — 얼룩 하나 + 흘러내린 자국 + 튄 점 · 찢긴 가장자리 — 위가 들쭉날쭉한 띠(아래 띠 밑). 색은 보조색(3색 체계의 셋째 — 덱 글자색은 강조색 변형 표지에서 바탕과 같은 쪽이라 안 보였고,
// 장 글자색은 제목에만 걸려 있다) · 층은 1(레이아웃의 아래 판이 덮었다) — 글자와 겹치면 verify ornament_overlap → 그 장식만 뗀다
const INK = svg(`<path d="M52 8c14-2 30 6 34 20s-4 22 4 32-6 26-22 28c-6 1-8 6-8 16s-2 18-5 18-4-8-4-17-3-14-9-14c-12 0-26-8-30-20S6 50 12 38 26 10 52 8z"/><circle cx="86" cy="86" r="5"/><circle cx="16" cy="82" r="3"/><circle cx="90" cy="14" r="2.5"/>`);
const TORN = `polygon(0 100%,${Array.from({ length: 41 }, (_, i) => `${(i * 2.5).toFixed(1)}% ${[34, 6, 40, 14, 0, 28, 10, 44, 18, 4][i % 10]}%`).join(",")},100% 100%)`;
const DEV_CSS = {
    ink: `[data-orn="ink"][data-orn-app]{position:absolute;right:0;bottom:40px;width:300px;height:300px;z-index:1;pointer-events:none;background:${A2};-webkit-mask:${INK} center/contain no-repeat;mask:${INK} center/contain no-repeat;transform:rotate(14deg)}`,
    torn: `[data-orn="torn"][data-orn-app]{position:absolute;left:0;right:0;bottom:0;height:46px;z-index:1;pointer-events:none;background:${A2};clip-path:${TORN}}`,
    offset: "",
};
const SEC = `section.slide[data-orn-cover]`, SHADE = "color-mix(in srgb,var(--color-semantic-text-strong) 40%,transparent)";
const LETTER_CSS = {
    // 3D 돌출: 보조색 층 넷 + 옅은 그림자 — 한글 9자 이상이면 외곽선으로(그림자 금지 규칙)
    extrude: `${SEC}[data-letter="extrude"]:not([data-orn-long]) ${TITLE}{text-shadow:.02em .02em 0 ${A2},.04em .04em 0 ${A2},.06em .06em 0 ${A2},.08em .08em 0 ${A2},.11em .11em 0 ${SHADE}}
${SEC}[data-letter="extrude"][data-orn-long] ${TITLE}{-webkit-text-stroke:.05em ${A2};paint-order:stroke fill}`,
    // 흘러내림: 글자 아래로 보조색 방울 두 겹(글자 자체는 그대로 — 대비·고치기 그대로)
    drip: `${SEC}[data-letter="drip"] ${TITLE}::after{content:"";display:block;width:min(100%,var(--orn-drip-w,8em));height:.55em;margin-top:-.24em;pointer-events:none;background:radial-gradient(.07em .26em at 50% 0,${A2} 98%,transparent) .1em 0/.95em .55em repeat-x,radial-gradient(.05em .4em at 50% 0,${A2} 98%,transparent) .5em 0/1.7em .55em repeat-x,radial-gradient(.09em .16em at 50% 0,${A2} 98%,transparent) .3em 0/1.25em .55em repeat-x}`,
    outline: `${SEC}[data-letter="outline"] ${TITLE}{-webkit-text-stroke:.055em ${A2};paint-order:stroke fill}`,
    // 크롬: 얇은 어두운 테 + 위 밝은 빛 + 보조색 번짐(흐림 있는 그림자 — 오프셋 그림자 규칙 밖)
    chrome: `${SEC}[data-letter="chrome"] ${TITLE}{-webkit-text-stroke:.02em ${SHADE};paint-order:stroke fill;text-shadow:0 .025em .02em var(--color-semantic-bg-surface),0 0 .35em color-mix(in srgb,${A2} 60%,transparent)}`,
};
// 사진 없는 표지 채움(#304 차이 목록 — 앵커 A: 표지 사진이 빠진 뒤 가운데가 비었다). 키치·팝 계열 띠(체커·점·경고 줄·3색)인 덱의 첫 장에 사진이 없으면
// 가운데 오른쪽에 보조색 하프톤 점 면 하나(::before · 모든 내용 아래 · 흐린 가장자리). 장식 요소가 아니라 장 바탕이라 겹침 검사 밖 — 글자 대비는 옅게(.45)로 지킨다
// 보이는 사진이 있나 — 사진 없는 변형(data-variant="nophoto")인 장 · src 빈 그림 · 기다리는 칸(data-photo-wait·data-slot-empty)·숨긴 칸 안 그림은 없는 것으로(2회차 A 표지: nophoto 변형인데 숨은 img가 남아 채움이 안 켜졌다)
export function visiblePhoto(sec) {
    const tag = sec.match(SLIDE)?.[0] ?? "";
    if (/\bdata-variant\s*=\s*["']nophoto["']/i.test(tag))
        return false;
    const body = sec.replace(/<([a-z][a-z0-9]*)\b[^>]*(\bdata-photo-wait\b|\bdata-slot-empty\b|display\s*:\s*none)[^>]*>[\s\S]*?<\/\1>/gi, "");
    return /<img\b(?=[^>]*\bsrc\s*=\s*["'][^"']+["'])(?![^>]*display\s*:\s*none)[^>]*>/i.test(body);
}
export const FILL_BANDS = new Set(["checker", "dots", "hazard", "stripes3"]);
export function moodCss(decos, band = null, letter = null, dripW = null, stickers = [], devices = [], eng = [], fill = false) {
    const r = [];
    // 장을 쌓임 맥락으로(isolation) 만들고 점 면은 z-index -1 — 장 바탕 위·모든 내용 아래(레이아웃의 절대 위치 요소는 그대로)
    if (fill)
        r.push(`section.slide[data-orn-nophoto]{position:relative;isolation:isolate}`, `section.slide[data-orn-nophoto]::before{content:"";position:absolute;left:40%;right:5%;top:20%;bottom:22%;z-index:-1;pointer-events:none;opacity:.45;background:radial-gradient(${A2} 30%,transparent 33%) 0 0/24px 24px;-webkit-mask:radial-gradient(closest-side,#000 55%,transparent);mask:radial-gradient(closest-side,#000 55%,transparent)}`);
    for (const d of devices)
        if (DEV_CSS[d])
            r.push(DEV_CSS[d]);
    // 어긋난 그림자 — 표지·마무리 제목(레터링이 없고 한글 9자 미만일 때만: verify shadow_long)
    if (devices.includes("offset") && !letter)
        r.push(`${SEC}:not([data-orn-long]) ${TITLE}{text-shadow:.06em .06em 0 ${A2}}`);
    for (const k of eng)
        if (ENG_CSS[k])
            r.push(`[data-orn="${k}"][data-orn-app][data-orn-eng]{position:absolute;z-index:2;pointer-events:none;${ENG_CSS[k]}}`);
    if (devices.some(d => d !== "offset") || eng.length)
        r.push(`section.slide:has(>[data-orn-app]){overflow:hidden}`);
    for (const k of stickers)
        r.push(STICKER_CSS[k]);
    if (letter)
        r.push(LETTER_CSS[letter]);
    if (letter === "drip" && dripW)
        r.push(`${SEC}{--orn-drip-w:${dripW}em}`); // 이 장 제목 길이만큼(블록은 장마다 찍는다)
    if (decos.includes("sticker") && !letter)
        r.push(`section.slide[data-orn-cover] ${TITLE}{-webkit-text-stroke:.035em currentColor;paint-order:stroke fill;text-shadow:.07em .07em 0 ${A2}}`, `section.slide[data-orn-cover][data-orn-long] ${TITLE}{text-shadow:none}`);
    if (decos.includes("grain"))
        r.push(`section.slide{background-image:radial-gradient(color-mix(in srgb,var(--color-semantic-text-strong) 10%,transparent) 1px,transparent 1.3px);background-size:6px 6px}`);
    if (band)
        r.push(`section.slide:has(>[data-orn-app]){position:relative}`, 
        // 띠 글자 하한 22~24px(#314 ⑧ — 앵커 A에서 띠 "PINK WIG WIZ"가 18px로 읽혔다) · 띠 높이 52px
        `[data-orn="frame-top"][data-orn-app]{position:absolute;left:0;right:0;top:0;height:52px;padding:0 28px;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:16px;z-index:1;pointer-events:none;background:var(--color-semantic-accent-base);color:var(--color-semantic-on-accent,#fff);font:700 23px/1 var(--typography-font-family-label,var(--typography-font-family-body,sans-serif));letter-spacing:.08em;white-space:nowrap;overflow:hidden}`, 
        // 줄 띠(data-band="line")는 장 바탕색을 깐다(#314 보정 3 — 3회차 C 03: 투명 띠의 흐린 글이 AI가 깐 하늘색 머리 위에서 안 보였다). 띠 아래가 무엇이든 글색 = 바탕 위 muted
        `[data-orn="frame-top"][data-orn-app][data-band="line"]{background:color-mix(in srgb,var(--color-semantic-bg-base) 92%,transparent);color:var(--color-semantic-text-muted);border-bottom:1px solid ${A2}}`, `[data-orn="frame-bottom"][data-orn-app]{position:absolute;left:0;right:0;bottom:0;z-index:1;pointer-events:none;${BAND_CSS[band]}}`);
    return r.join("\n");
}
const BLK = /<style\b[^>]*\bdata-mood\b[^>]*>[\s\S]*?<\/style\s*>\s*/gi, ORN = /<(i|div)\b[^>]*\bdata-orn-app\b[^>]*>[\s\S]*?<\/\1>/gi;
const SLIDE = /<section\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bslide\b)[^>]*>/i;
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// 시리즈 라벨 = 표지 장 제목(지어내지 않는다 — 장에 있는 글). 28자까지
export function labelOf(coverHtml) {
    const m = coverHtml.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>|<([a-z0-9]+)\b[^>]*\bdata-slot\s*=\s*["'](?:title|headline)["'][^>]*>([\s\S]*?)<\/\2>/i);
    return (m?.[1] ?? m?.[3] ?? "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;|\s+/g, " ").replace(/&amp;/g, "&").trim().slice(0, 28);
}
// 한 장에 — 예전 분위기 블록·앱 요소·표시를 지우고 새로. cover = 표지·마무리 장(스티커 자리) · off = 그 장은 띠 없이(겹침으로 뗀 장)
// frame = 시리즈 틀(라벨·쪽 번호·전체 쪽 수) — band가 있으면 위·아래 띠, 쪽 번호는 레이아웃의 쪽번호 칸(data-slot="page_no")이 없을 때만
// devices = 그로테스크 장치(표지·마무리만) · eng = 엔진 스티커(표지 둘·마무리 하나) · offOrn = 이 장에서 겹쳐 뗀 앱 장식 종류(frame-top·frame-bottom이면 띠 전체)
export function stampMood(html, o) {
    let h = html.replace(BLK, "").replace(ORN, "");
    h = h.replace(SLIDE, t => t.replace(/\s+data-orn-(cover|long|nophoto)(\s*=\s*["'][^"']*["'])?/gi, "").replace(/\s+data-letter\s*=\s*["'](extrude|drip|outline|chrome)["']/i, "").replace(/\s+data-stroke-ok\s*=\s*["']mood["']/i, ""));
    const band = o.band ?? null, letter = o.letter ?? null;
    // 흘러내림 띠 길이 = 표지 제목 한 줄 길이 어림(한글 0.82em · 그 밖 0.5em, 2~9em) — 말 끝 너머로 방울이 이어지지 않게
    const tt = o.cover && letter === "drip" ? labelOf(h.slice(Math.max(0, h.search(SLIDE)))) : "", dripW = tt ? Math.max(2, Math.min(9, Math.round([...tt].reduce((a, c) => a + (/[가-힣]/.test(c) ? 0.82 : /\s/.test(c) ? 0.3 : 0.5), 0) * 10) / 10)) : null;
    const offK = new Set(o.offOrn ?? []), off = !!o.off || offK.has("frame-top") || offK.has("frame-bottom");
    const devs = o.cover ? (o.devices ?? []).filter(d => !offK.has(d)) : [], first = !!o.frame && o.frame.no === 1, at = ENG_AT[first || !o.frame ? "cover" : "close"];
    const eng = o.cover ? (o.eng ?? []).slice(0, at.length).filter(k => !offK.has(k)) : [];
    const at0 = h.search(SLIDE), fill = !!o.cover && first && !!band && FILL_BANDS.has(band) && at0 >= 0 && !visiblePhoto(h.slice(at0)) && !offK.has("fill"); // 사진 없는 첫 장(#304 차이 목록)
    const css = moodCss(o.decos, band, letter, dripW, o.stickers ?? [], devs, eng, fill);
    if (!css)
        return h;
    const m = h.match(SLIDE);
    if (m) {
        let t = m[0];
        if (o.cover && (o.decos.includes("sticker") || letter || devs.includes("offset"))) {
            const ko = (labelOf(h.slice(h.indexOf(m[0]))).match(/[가-힣]/g) ?? []).length;
            // 스티커 외곽선은 분위기가 요청한 것 — verify title_stroke가 보는 표시(data-stroke-ok)를 "mood" 값으로(다시 찍을 때 이 값만 뗀다)
            t = t.replace(/>$/, ` data-orn-cover${ko >= 9 ? " data-orn-long" : ""}${letter ? ` data-letter="${letter}"` : ""}${/\bdata-stroke-ok\b/i.test(t) ? "" : ' data-stroke-ok="mood"'}>`);
        }
        if (fill)
            t = t.replace(/>$/, " data-orn-nophoto>");
        let add = "";
        if (band && !off) {
            const f = o.frame, no = f && f.total > 1 && !/\bdata-slot\s*=\s*["']page_no["']/i.test(h) ? `<span>${String(f.no).padStart(2, "0")} / ${String(f.total).padStart(2, "0")}</span>` : "";
            // 표지엔 라벨 없이(제목이 곧 시리즈 이름 — #309 ⑥: 라벨·제목·칩에 "PINK WIG WIZ" 세 번). 속 장은 라벨 = 시리즈 이름
            const lab = f && f.no === 1 ? "" : f?.label ?? "";
            if (f && (lab || no))
                add += `<div data-orn="frame-top" data-orn-app data-band="${band}" aria-hidden="true">${lab ? `<b>${esc(lab)}</b>` : ""}${no}</div>`;
            add += `<i data-orn="frame-bottom" data-orn-app data-band="${band}" aria-hidden="true"></i>`;
        }
        for (const d of devs)
            if (d !== "offset")
                add += `<i data-orn="${d}" data-orn-app aria-hidden="true"></i>`;
        eng.forEach((k, i) => { add += `<i data-orn="${k}" data-orn-app data-orn-eng aria-hidden="true" style="${at[i]}"></i>`; });
        h = h.replace(m[0], t + add);
    }
    const tag = `<style data-mood>${css}</style>\n`;
    return /<\/head>/i.test(h) ? h.replace(/<\/head>/i, `${tag}</head>`) : tag + h;
}
