// 자동 복사: prototypes/hub/src/lib/slots.ts — 수정 금지
// 슬롯 → 목적지 지도 (WORKORDER #12-H H1) — 작업을 "어디에 들어갈 그림인지"로 보여 준다. 앱·웹 공용, 스키마 변경 없음.
// 앱(desktop)은 빌드 때 이 파일을 src/shared/slots.ts로 복사해 같은 값을 쓴다(scripts/sync-tokens.mjs). import 없는 단일 파일로 유지.
// 이름·프레임·비율은 여기서 손으로, 좌표(SLOT_RECTS)는 `pnpm snap:samples`가 실제 화면 DOM에서 재어 아래 생성 블록을 다시 쓴다.
export const SLOT_DEST = {
    "slide-cover": { name: "슬라이드 표지 사진", frame: "slide", ratio: "1:1" },
    "slide-body": { name: "슬라이드 본문 사진", frame: "slide", ratio: "1:1" },
    "slide-extra": { name: "슬라이드 사진", frame: "slide", ratio: "1:1" },
    // 레이아웃 v2 (docs/10 v1.1 · T-09~T-11) — 사진이 주인공
    "cover-full": { name: "표지 전면 사진", frame: "slide", ratio: "16:9" },
    "series": { name: "사물 시리즈 3장", frame: "slide", ratio: "3×1:1" },
    "series-1": { name: "사물 시리즈 ①", frame: "slide", ratio: "1:1" },
    "series-2": { name: "사물 시리즈 ②", frame: "slide", ratio: "1:1" },
    "series-3": { name: "사물 시리즈 ③", frame: "slide", ratio: "1:1" },
    "texture": { name: "데이터 텍스처 배경", frame: "slide", ratio: "1:1" },
    "band": { name: "세로 공간 사진", frame: "slide", ratio: "3:4" },
    // 주제 리워드(#22-보정 18, subjects-v1) — 사진의 '무엇'. 주제 칩·검색어
    "subject-dog": { name: "강아지", frame: "slide", ratio: "1:1" },
    "subject-cat": { name: "고양이", frame: "slide", ratio: "1:1" },
    "subject-character": { name: "캐릭터", frame: "slide", ratio: "1:1" },
    "subject-food": { name: "음식", frame: "slide", ratio: "1:1" },
    "subject-flower": { name: "꽃", frame: "slide", ratio: "1:1" },
    "subject-city": { name: "도시", frame: "slide", ratio: "16:9" },
    "subject-gadget": { name: "전자제품", frame: "slide", ratio: "1:1" },
    "subject-yoga": { name: "요가", frame: "slide", ratio: "1:1" },
    "subject-kids": { name: "아이 놀이", frame: "slide", ratio: "1:1" },
    "subject-retro-poster": { name: "레트로 포스터", frame: "slide", ratio: "1:1" },
    "subject-office": { name: "사무 공간", frame: "slide", ratio: "1:1" },
    "subject-nature-wide": { name: "자연 와이드", frame: "slide", ratio: "16:9" },
    // Task 카탈로그 v1 (#12-O O3) — 갤러리 수요 카테고리. 레이아웃은 카테고리별 디자인 Task로 뒤따른다(미니어처 배경은 레이아웃이 생기면 snap으로)
    "poster-full": { name: "행사·팝업 포스터 · 전면 사진", frame: "slide", ratio: "4:3" },
    "poster-texture": { name: "행사·팝업 포스터 · 텍스처", frame: "slide", ratio: "1:1" },
    "product-series": { name: "제품 상세 · 누끼 정물 3장", frame: "slide", ratio: "3×1:1" },
    "product-scene": { name: "제품 상세 · 사용 장면", frame: "slide", ratio: "16:9" },
    "hero-left": { name: "랜딩 히어로 · 좌측 여백 사진", frame: "slide", ratio: "16:9" },
    "hero-right": { name: "랜딩 히어로 · 우측 여백 사진", frame: "slide", ratio: "16:9" },
    "deck-texture": { name: "발표 표지·섹션 · 배경 3장", frame: "slide", ratio: "16:9" },
    "menu-series": { name: "메뉴·가격표 · 음식 사진 4장", frame: "slide", ratio: "1:1" },
    // 갈래 B · Dynapse 필요 소재 T-12 브랜드 일러스트 세트
    "site-illust-onboard": { name: "브랜드 일러스트 · 온보딩 3장", frame: "app", ratio: "4:3" },
    "site-illust-empty": { name: "브랜드 일러스트 · 빈 상태", frame: "app", ratio: "4:3" },
    "site-illust-error": { name: "브랜드 일러스트 · 오류", frame: "app", ratio: "4:3" },
    "site-banner-partner": { name: "리워드 작업 배너", frame: "page-connect", ratio: "69:10" },
    "site-earn-step-1": { name: "단계 그림 ①", frame: "page-connect", ratio: "4:3" },
    "site-earn-step-2": { name: "단계 그림 ②", frame: "page-connect", ratio: "4:3" },
    "site-earn-step-3": { name: "단계 그림 ③", frame: "page-connect", ratio: "4:3" },
    "site-earn-step-4": { name: "단계 그림 ④", frame: "page-connect", ratio: "4:3" },
    "site-connect-1": { name: "연결 화면 그림 ①", frame: "page-connect", ratio: "4:3" },
    "site-connect-2": { name: "연결 화면 그림 ②", frame: "page-connect", ratio: "4:3" },
    "site-connect-3": { name: "연결 화면 그림 ③", frame: "page-connect", ratio: "4:3" },
    "app-photo-empty": { name: "앱 빈 사진 칸", frame: "app", ratio: "1:1" },
    "app-role-design": { name: "앱 디자인 표시", frame: "app", ratio: "1:1" },
    "app-role-photo": { name: "앱 사진 표시", frame: "app", ratio: "1:1" },
};
// 무드 팔레트 — 레이아웃 토큰(style-qi / style-wa)의 배경·글자·강조
export const MOOD_PALETTE = {
    qi: [{ hex: "#1F2933", name: "그래파이트" }, { hex: "#F5F6F4", name: "본화이트" }, { hex: "#5F7466", name: "세이지" }],
    wa: [{ hex: "#2B2320", name: "먹" }, { hex: "#F6F1E7", name: "크림" }, { hex: "#7D2E3B", name: "버건디" }],
};
// @generated-start — pnpm snap:samples (scripts/snap-samples.mts)가 다시 쓴다. bg의 {mood}는 qi|wa
export const SLOT_RECTS = {
    "slide-cover": { bg: "cover-{mood}.png", rect: [57.5, 22, 35, 62.2] },
    "slide-extra": { bg: "cover-{mood}.png", rect: [57.5, 22, 35, 62.2] },
    "app-photo-empty": { bg: "cover-{mood}.png", rect: [57.5, 22, 35, 62.2] },
    "app-role-design": { bg: "cover-{mood}.png", rect: [7.5, 85.9, 14, 7] },
    "app-role-photo": { bg: "cover-{mood}.png", rect: [78.5, 77.2, 14, 7] },
    "slide-body": { bg: "body-{mood}.png", rect: [7.5, 14.4, 32.5, 71.1] },
    "cover-full": { bg: "v2-cover-full-{mood}.png", rect: [0, 0, 100, 100] },
    "series": { bg: "v2-body-series-{mood}.png", rect: [7.5, 26.6, 85, 47.4] },
    "series-1": { bg: "v2-body-series-{mood}.png", rect: [7.5, 26.6, 26.7, 47.4] },
    "series-2": { bg: "v2-body-series-{mood}.png", rect: [36.7, 26.6, 26.7, 47.4] },
    "series-3": { bg: "v2-body-series-{mood}.png", rect: [65.8, 26.6, 26.7, 47.4] },
    "texture": { bg: "v2-data-texture-{mood}.png", rect: [0, 0, 100, 100] },
    "site-earn-step-1": { bg: "page-earn-1.png", rect: [7.4, 41.8, 13.8, 16.5] },
    "site-earn-step-2": { bg: "page-earn-1.png", rect: [24.5, 41.8, 13.8, 16.5] },
    "site-earn-step-3": { bg: "page-earn-1.png", rect: [41.5, 41.8, 13.8, 16.5] },
    "site-earn-step-4": { bg: "page-earn-1.png", rect: [58.5, 41.8, 13.8, 16.5] },
    "site-connect-1": { bg: "page-connect-1.png", rect: [23.7, 39.9, 16.8, 20.2] },
    "site-connect-2": { bg: "page-connect-1.png", rect: [43.8, 39.9, 16.8, 20.2] },
    "site-connect-3": { bg: "page-connect-1.png", rect: [63.9, 39.9, 16.8, 20.2] },
    "site-banner-partner": { bg: "page-connect-2.png", rect: [22.5, 60.7, 59.4, 12.8] },
};
// @generated-end
// qi-01 → 표지, qi-02 → 본문(v1 템플릿이 재고를 표지·본문 순으로 배치), 그 밖 → 슬라이드 사진
// v2: cover-full-⟨mood⟩ · series-⟨mood⟩(세트) · series-⟨mood⟩-⟨n⟩ · texture-⟨mood⟩
function key(slot) {
    const m = slot.match(/^(qi|wa)-(\d+)$/);
    if (m)
        return { key: m[2] === "01" ? "slide-cover" : m[2] === "02" ? "slide-body" : "slide-extra", mood: m[1] };
    const v2 = slot.match(/^(cover-full|series|texture)-(qi|wa)(?:-([1-3]))?$/);
    if (v2)
        return { key: v2[3] ? `${v2[1]}-${v2[3]}` : v2[1], mood: v2[2] };
    const cat = slot.match(/^(poster-full|poster-texture|product-series|product-scene|hero-left|hero-right|deck-texture|menu-series)-(qi|wa)(?:-\d)?$/);
    if (cat)
        return { key: cat[1], mood: cat[2] };
    const il = slot.match(/^(site-illust-onboard)(?:-\d)?$/);
    if (il)
        return { key: il[1] };
    return { key: slot };
}
// thumbs 경로는 호출하는 쪽이 붙인다(웹: /samples/thumbs/, 앱: thumbs/)
export function slotView(slot, mood = "qi") {
    if (!slot)
        return { slot: "", name: "이미지", frame: null, ratio: null, bg: null, rect: null, mood };
    const k = key(slot);
    const md = k.mood ?? mood;
    const d = SLOT_DEST[k.key];
    const r = SLOT_RECTS[k.key];
    return {
        slot, mood: md,
        name: d?.name ?? `이미지 · ${slot}`,
        frame: d?.frame ?? null, ratio: d?.ratio ?? null,
        bg: r ? r.bg.replace("{mood}", md) : null, rect: r?.rect ?? null,
    };
}
// 실제 산출물 비율(spec.size "2048x2048") → 도형 칩용
export function sizeRatio(size) {
    const m = size?.match(/^(\d+)x(\d+)$/);
    if (!m)
        return null;
    const w = +m[1], h = +m[2], r = w / h;
    const label = Math.abs(r - 1) < 0.02 ? "1:1" : Math.abs(r - 4 / 3) < 0.02 ? "4:3" : Math.abs(r - 16 / 9) < 0.02 ? "16:9" : r > 3 ? "가로 띠" : r > 1 ? "가로" : "세로";
    return { w, h, label };
}
// 프롬프트의 금지·표현 규칙 → 아이콘 칩 (문장 대신)
export function briefRules(prompt) {
    return {
        banned: [
            /텍스트|글자/.test(prompt) && "글자",
            /인물|얼굴|사람/.test(prompt) && "얼굴",
            /로고/.test(prompt) && "로고",
        ].filter(Boolean),
        look: [
            /무광/.test(prompt) && "무광",
            /정물|오브젝트/.test(prompt) && "정물",
            /여백/.test(prompt) && "여백",
            /추상/.test(prompt) && "추상",
        ].filter(Boolean),
    };
}
const MOOD_BRIEF = {
    qi: "차분한 무드(그래파이트·본화이트·세이지), 무광 질감, 북향 자연광",
    wa: "따뜻한 무드(크림·먹·버건디), 종이 물성, 부드러운 그림자",
    "": "Dynapse 차분한 톤(본화이트·세이지·그래파이트), 단순한 정물·오브젝트",
};
export const CATALOG = [
    { id: "brand-intro", name: "가게·브랜드 소개", branch: "A", priority: 1, moods: ["qi", "wa"], slots: [
            { base: "cover-full-{m}", key: "cover-full", size: "1920x1080", kind: "전면", brief: "좌측 45%는 저대비·단순한 배경(글자 안전영역), 우측에 피사체와 깊이 — 가게·브랜드의 대표 정물" },
            { base: "series-{m}", key: "series", size: "1200x1200", set: 3, kind: "시리즈", brief: "같은 물성·같은 광원·같은 카메라 거리로 피사체만 다른 사물 3장" },
            { base: "texture-{m}", key: "texture", size: "1024x1024", kind: "텍스처", brief: "사방 이어붙임 가능한 저대비 텍스처 타일(수치 카드 배경)" },
        ] },
    { id: "dynapse", name: "Dynapse 소재", branch: "B", priority: 2, moods: [""], slots: [
            { base: "site-banner-partner", key: "site-banner-partner", size: "1520x220", kind: "배너", brief: "좌측 2/3는 어두운 톤의 텍스트 여백, 우측에 정물·추상 요소" },
            { base: "site-earn-step-1", key: "site-earn-step-1", size: "960x720", kind: "단계 그림", brief: "조건이 적힌 카드·문서 정물 — '작업 확인'" },
            { base: "site-earn-step-2", key: "site-earn-step-2", size: "960x720", kind: "단계 그림", brief: "무언가를 만드는 기계·도구 정물 — 'AI가 수행'" },
            { base: "site-earn-step-3", key: "site-earn-step-3", size: "960x720", kind: "단계 그림", brief: "돋보기·체크 표시 정물 — '사람이 검토'" },
            { base: "site-earn-step-4", key: "site-earn-step-4", size: "960x720", kind: "단계 그림", brief: "선물 상자·동전 정물 — '포인트 교환'" },
            // T-07(site-connect-1~3)은 보류 — #12-P 조립 그림이 /connect의 숫자 카드를 대체
            { base: "app-photo-empty", key: "app-photo-empty", size: "720x720", kind: "앱 아이콘", brief: "카메라·렌즈 정물 실루엣, 투명 배경" },
            { base: "site-illust-onboard", key: "site-illust-onboard", size: "960x720", set: 3, kind: "브랜드 일러스트", brief: "온보딩 3장 — ① 내 AI들 ② 한 장의 슬라이드 ③ 완성된 결과, 같은 스타일" },
            { base: "site-illust-empty", key: "site-illust-empty", size: "960x720", kind: "브랜드 일러스트", brief: "빈 상태 — 비어 있는 액자·선반 정물" },
            { base: "site-illust-error", key: "site-illust-error", size: "960x720", kind: "브랜드 일러스트", brief: "오류 — 살짝 엎어진 컵 정물(위트, 과장 없이)" },
        ] },
    { id: "poster", name: "행사·팝업 포스터", branch: "A", priority: 3, moods: ["wa"], slots: [
            { base: "poster-full-{m}", key: "poster-full", size: "768x1024", kind: "전면(세로 3:4)", brief: "세로 3:4, 상단 40%는 단순한 배경(제목 안전영역), 하단에 행사 분위기의 정물·공간" },
            { base: "poster-texture-{m}", key: "poster-texture", size: "1024x1024", kind: "텍스처", brief: "포스터 배경용 저대비 종이·천 텍스처 타일" },
        ] },
    { id: "product-detail", name: "제품 상세", branch: "A", priority: 4, moods: ["qi"], slots: [
            { base: "product-series-{m}", key: "product-series", size: "1024x1024", set: 3, kind: "누끼 정물 시리즈", brief: "흰 배경 위 제품 정물 3장(누끼 가능한 단색 배경), 같은 조명·같은 각도" },
            { base: "product-scene-{m}", key: "product-scene", size: "1024x576", kind: "사용 장면", brief: "제품이 쓰이는 책상·주방 장면(사람 없이), 가로 16:9" },
        ] },
    { id: "landing-hero", name: "랜딩 히어로", branch: "A", priority: 4, moods: ["qi"], slots: [
            { base: "hero-left-{m}", key: "hero-left", size: "1920x1080", kind: "전면(좌 여백)", brief: "좌측 45% 단순한 배경(글자 영역), 우측에 피사체" },
            { base: "hero-right-{m}", key: "hero-right", size: "1920x1080", kind: "전면(우 여백)", brief: "우측 45% 단순한 배경(글자 영역), 좌측에 피사체" },
        ] },
    { id: "deck", name: "발표 표지·섹션", branch: "A", priority: 4, moods: ["qi"], slots: [
            { base: "deck-texture-{m}", key: "deck-texture", size: "1600x900", set: 3, kind: "추상 배경 시리즈", brief: "표지·섹션 구분용 저대비 추상 배경 3장, 같은 계열" },
        ] },
    { id: "menu", name: "메뉴·가격표", branch: "A", priority: 4, moods: ["wa"], slots: [
            { base: "menu-series-{m}", key: "menu-series", size: "1024x1024", set: 4, kind: "음식 시리즈", brief: "음식·음료 정물 4장, 같은 테이블·같은 광원·위에서 45°" },
        ] },
];
// 카탈로그 슬롯 → 발주 문안(프롬프트·통과 기준). 무드 문구 + 슬롯 브리프 + 금지 요소
export function catalogBrief(c, mood) {
    const n = c.set ?? 1;
    const prompt = `${c.size} PNG${n > 1 ? ` ${n}장 한 세트` : ""}. ${MOOD_BRIEF[mood] ?? MOOD_BRIEF[""]}. ${c.brief}. 텍스트·인물·로고 금지.`;
    const acceptance_criteria = `규격 ${c.size} PNG${n > 1 ? ` ${n}장(세트 통일성 — 물성·광원·거리)` : ""}. 무드 적합. 금지 요소(텍스트·인물·로고) 없음. 저장하고 싶은 완성도.`;
    return { prompt, acceptance_criteria, set_size: n > 1 ? n : undefined, size: c.size };
}
