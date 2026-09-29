// 자동 복사: prototypes/hub/src/lib/providers.ts — 수정 금지
// Provider(내부 id) → 화면 뱃지 표시명. 커넥터 서비스별 가능 작업이 다르므로 작업 카드에 노출.
const LABELS = {
    claude_code: "Claude",
    cowork: "Claude",
    claude_design: "Claude",
    chatgpt: "ChatGPT",
    codex: "ChatGPT",
    antigravity: "Gemini",
    grok: "Grok",
    genspark: "Genspark",
};
export function providerBadges(providers) {
    return [...new Set(providers.map(p => LABELS[p] ?? p))];
}
export const CAP_LABEL = { photo: "사진", design: "디자인" };
export const RUN_LABEL = { app: "앱 안", ide: "IDE 안" };
export const CAPS = {
    claude: { name: "Claude", runner: "Claude Code", tool: "claude", run: "app", photo: "no", design: "yes" },
    chatgpt: { name: "ChatGPT", runner: "Codex", tool: "codex", run: "app", photo: "yes", design: "yes" }, // 사진: 2026-09-24 codex exec 헤드리스 PNG 저장 실측
    // Gemini: 2026-09-24 실측(#12-M 결과 절) — Antigravity 공식 CLI `agy` 헤드리스 `generate_image`(1024 기준, AspectRatio만). 앱이 직접 부른다.
    // 로그인은 Antigravity 앱 자격증명 재사용. 1024보다 큰 규격 Task엔 배정하지 않는다(업스케일 금지). 디자인(HTML)은 실측 전
    // 디자인: 2026-09-24 실측 추가 — 슬롯 3줄만 정확히 바꿈(24초·53k). 조건: 지침 첫 문단 도구 화이트리스트 + settings.json 폴더 허용 규칙
    gemini: { name: "Gemini", runner: "Antigravity CLI", tool: "agy", run: "app", photo: "yes", design: "yes" },
};
// 서버가 받아 주는 CLI 최소 버전 — 앱이 이보다 낮으면 공식 명령(claude update)을 먼저 자동 실행 (#12-D D1)
// claude: 2026-09-23 실측, 2.1.118은 claude_code_version_too_old(최소 2.1.251)
export const MIN_VERSIONS = { claude: "2.1.251" };
// 작업·템플릿 산출물 → 필요한 능력 (스키마 변경 없이): PNG면 사진, HTML·레이아웃이면 디자인
export function capabilityBadges(task) {
    const spec = (task.spec ?? {});
    const caps = [];
    if (task.type === "image.generate" || spec.format === "png")
        caps.push("photo");
    if (task.type === "design.generate" || spec.format === "html")
        caps.push("design");
    return caps.map(c => CAP_LABEL[c]);
}
// 기기 보고(도구별 로그인 상태)로 지금 쓸 수 있는 능력 → 사람 이름
export function readyFor(cap, tools) {
    return Object.values(CAPS)
        .filter(a => a[cap] === "yes" && tools?.[a.tool]?.loggedIn !== false && tools?.[a.tool]?.loggedIn != null)
        .map(a => a.name);
}
export function whoCan(cap) {
    return Object.values(CAPS).filter(a => a[cap] === "yes").map(a => a.name);
}
export const ROLE_BRAND = { claude: "claude", chatgpt: "openai", gemini: "googlegemini" };
const PRIMARY_ORDER = ["claude", "chatgpt", "gemini"]; // 마무리 우선순위(#12-N N1 · #12-M 추가): Claude Code → Codex → Gemini(agy)
const PHOTO_ORDER = ["gemini", "chatgpt"]; // 사진 우선순위: Gemini → ChatGPT
const node = (ai, roles, extra = {}) => ({ ai, name: CAPS[ai].name, brand: ROLE_BRAND[ai], roles, ...extra });
const missingNode = (role) => ({ ai: null, name: "추가", brand: null, roles: [role], missing: true });
// ready = 지금 로그인돼 쓸 수 있는 AI. prefer = 온보딩에서 먼저 고른 디자인 AI. taskAi = 파트너 Task에 배정된 AI
export function assignRoles(purpose, ready, opts = {}) {
    if (purpose !== "make") {
        const ai = opts.taskAi ?? null;
        return { purpose, primary: null, children: [ai ? node(ai, ["이 작업"]) : missingNode("이 작업")],
            gate: ai ? null : purpose === "task-photo" ? "사진을 할 AI가 없어요 — Gemini나 ChatGPT를 추가하세요" : "디자인을 할 AI가 없어요 — Claude나 ChatGPT를 추가하세요" };
    }
    const team = defaultTeam(ready, opts.prefer);
    if (!team)
        return { purpose, primary: null, children: [missingNode("디자인"), missingNode("사진")], gate: "디자인을 할 AI가 없어요 — Claude·ChatGPT·Gemini 중 하나를 추가하세요" };
    return teamAssignment(team);
}
export function defaultTeam(ready, prefer) {
    const designers = PRIMARY_ORDER.filter(a => ready[a] && CAPS[a].design === "yes");
    const merge = prefer && designers.includes(prefer) ? prefer : designers[0];
    if (!merge)
        return null;
    const photo = PHOTO_ORDER.filter(a => ready[a] && CAPS[a].photo === "yes");
    return { merge, design: [merge], photo };
}
// 트리 = 이번 실행의 팀 그대로(표시 전용). 마무리 한 명이 디자인·사진을 다 하면 한 노드 "마무리 · 디자인 · 사진"
export function teamAssignment(t) {
    const co = t.design.length > 1, cmp = t.photo.length > 1;
    const onlyMerge = t.design.length === 1 && t.design[0] === t.merge && (t.photo.length === 0 ? false : t.photo.length === 1 && t.photo[0] === t.merge);
    if (onlyMerge)
        return { purpose: "make", primary: node(t.merge, ["마무리", "디자인", "사진"]), children: [], gate: null };
    const kids = [
        ...t.design.map(a => node(a, co ? ["디자인", "공동"] : ["디자인"])),
        ...(t.photo.length ? t.photo.map(a => node(a, cmp ? ["사진", "비교"] : ["사진"], cmp && t.chosen === a ? { chosen: true } : {})) : [missingNode("사진")]),
    ];
    return { purpose: "make", primary: node(t.merge, ["마무리"]), children: kids, gate: null };
}
// 사용량 배수 칩(×2) — 공동 편집이나 사진 비교가 켜지면. 숫자만
export const teamCost = (t) => Math.max(t.design.length, t.photo.length, 1);
// 팀을 바꾸는 지시 칩(#12-Q Q1) — 연결 상태에서만 만들어진다(임의 지시 주입 차단). id는 앱이 해석
export function teamChips(t, ready) {
    const out = [];
    for (const a of PHOTO_ORDER)
        if (ready[a] && CAPS[a].photo === "yes")
            out.push({ id: `photo:${a}`, label: `사진 다시 · ${CAPS[a].name}` });
    const photoReady = PHOTO_ORDER.filter(a => ready[a] && CAPS[a].photo === "yes");
    if (photoReady.length > 1 && t.photo.length < 2)
        out.push({ id: "compare", label: "사진 두 장 비교" });
    for (const a of PRIMARY_ORDER) {
        if (!ready[a] || CAPS[a].design !== "yes" || a === t.merge)
            continue;
        if (!t.design.includes(a))
            out.push({ id: `coedit:${a}`, label: `${CAPS[a].name}도 같이 고치기` });
        out.push({ id: `design:${a}`, label: `디자인은 ${CAPS[a].name}가` });
    }
    return out;
}
