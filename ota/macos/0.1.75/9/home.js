// 상태 창 두 줄 (WORKORDER #12-G · #12-Z Z4) — 내 AI 줄 + 실행 줄(진행 1줄·대기 확인·최근 3). 문장 0, 로고·점·칩만.
// 결과·고치기·공개·역할 그림은 웹 /works/⟨id⟩(인앱 창). 목적형 한 줄은 AI 팝오버 안에서만.
// 순수 렌더 함수(상태 → HTML) — 앱(main.ts)과 단어 예산 검사(scripts/word-budget.mts)가 같은 코드를 쓴다. Tauri 의존 없음.
import { slotView } from "./shared/slots.js";
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pos = (r) => `left:${r[0]}%;top:${r[1]}%;width:${r[2]}%;height:${r[3]}%`;
const brand = (file, cls = "brand") => `<i class="${cls}" style="-webkit-mask-image:url(brands/${file}.svg);mask-image:url(brands/${file}.svg)"></i>`;
const CAMERA = `<svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M4 8h3l1.6-2.2h6.8L17 8h3v11H4z"/><circle cx="12" cy="13.2" r="3.6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
// Gemini(agy)는 로그인 확인이 끝나야(true) 준비됨 — 확인 전(null)은 ○
const ready = (a) => a.installed && (a.key === "gemini" ? a.loggedIn === true : a.loggedIn !== false);
const dot = (a) => `<i class="dot ${a.busy ? "dot--busy" : ready(a) ? "dot--on" : ""}"></i>`;
const capChips = (caps) => caps.map(c => `<span class="chip">${c}</span>`).join("");
// 팝오버 한 줄 = "⟨무엇을 하면⟩ ⟨AI⟩로 ⟨능력⟩ — [버튼 하나]" (목적형 문장이 허용되는 유일한 자리)
function aiLine(a, cap) {
    const b = (act, label) => `<button class="pill pill--sm" data-act="${act}" data-id="${a.key}">${label}</button>`;
    let line, btn = "";
    // Gemini도 다른 AI와 같은 문법(#12-M): 설치 ↗ / 로그인 / ✓ — 앱이 agy를 직접 부른다
    if (!a.installed) {
        line = `${a.runner}를 설치하면 ${a.name}로 ${cap}`;
        btn = b("install", "설치 ↗");
    }
    else if (!ready(a)) {
        line = `${a.name}로 ${cap}`;
        btn = b("login", "로그인");
    }
    else {
        line = `${a.name}로 ${cap}`;
        btn = `<span class="ok">✓</span>`;
    }
    return `<div class="pop__row">${dot(a)}${brand(a.brand)}<span>${esc(line)}</span>${btn}</div>`;
}
function popover(h, id, style) {
    if (h.pop !== id)
        return "";
    let body = "";
    if (id.startsWith("ai:")) {
        const a = h.ais.find(x => `ai:${x.key}` === id);
        // 모델 고르기(#21 보정 12 — 웹 AI 줄과 같은 목록) — 칩 하나 = 기본 모델. 작업에서 따로 고르면 그게 우선
        const role = a.key === "claude" ? "claude" : a.key === "codex" ? "chatgpt" : "gemini";
        const opts = h.models?.[role] ?? [];
        const cur = h.defaultModels?.[role] ?? "";
        const models = opts.length ? `<div class="pop__row pop__models">${[{ id: "", name: "기본" }, ...opts].map(o => `<button class="chip${cur === o.id ? " chip--on" : ""}" data-act="pick-model" data-id="${role}|${esc(o.id)}">${esc(o.name)}</button>`).join("")}</div>` : "";
        body = ready(a)
            ? `<div class="pop__row">${capChips(a.caps)}<button class="pill pill--soft pill--sm" data-act="logout-help" data-id="${a.key}">로그아웃 안내 ↗</button></div>${models}`
            : aiLine(a, a.caps.join("·"));
    }
    // 연결된 브라우저(#20) — "● Chrome · macOS · 이 PC  ○ Safari · macOS(3일 전)"
    const ago = (t) => { if (!t)
        return ""; const m = Math.round((Date.now() - t) / 60_000); return m < 10 ? "" : m < 60 ? ` (${m}분 전)` : m < 1440 ? ` (${Math.round(m / 60)}시간 전)` : ` (${Math.round(m / 1440)}일 전)`; };
    const brs = (h.browsers ?? []).map(b => `<div class="pop__br"><i class="dot${b.lastSeenAt && Date.now() - b.lastSeenAt < 10 * 60_000 ? " dot--on" : ""}"></i>${esc([b.family, b.os].filter(Boolean).join(" · "))}${b.deviceId && b.deviceId === h.deviceId ? " · 이 PC" : ""}${esc(ago(b.lastSeenAt))}</div>`).join("");
    if (id === "profile")
        body = `<div class="pop__col">${brs ? `<span class="ais__label">브라우저</span>${brs}` : ""}
      <button class="pill pill--soft pill--sm" data-act="web" data-id="/me">아이디 변경</button>
      <button class="pill pill--soft pill--sm" data-act="web" data-id="/me#devices">기기</button>
      <button class="pill pill--soft pill--sm" data-act="hub-logout">연결 해제</button></div>`;
    return `<div class="pop" style="${style}">${body}</div>`;
}
// 상태 줄(#20 데이터 위치 · 보정) — 좌측이 아니라 헤더 우측 묶음에: [◉ 이 PC에서만] (● dyn-3xen)
const whereChip = (h) => h.where === "sync" ? `<span class="where where--sync">☁ 비공개</span>` : `<span class="where">💻 로컬</span>`; // 상태 어휘(#21 보정 5)
export function headerHtml(h) {
    const badge = h.updateReady ? `<button class="pill pill--sm update-badge" data-act="update-install">새 버전 · 다시 시작</button>` : "";
    const prof = h.connected
        ? `<div class="popwrap"><button class="profile" data-act="pop" data-id="profile"><i class="dot dot--on"></i>${esc(h.handle ?? "")}</button>${popover(h, "profile", "right:0;top:34px")}</div>`
        : `<button class="profile" data-act="hub-login" ${h.hubBusy ? "disabled" : ""}><i class="dot ${h.hubBusy ? "dot--busy" : ""}"></i>Dynapse 연결</button>`;
    // 창 툴바(#21 보정 12) — ‹ › ⟳ ⌂. 여기(홈)에선 ⌂가 지금 화면, ›는 보던 작업(웹)으로
    const nav = h.connected ? `<span class="tnav"><button disabled aria-label="뒤로">‹</button><button data-act="go-web" aria-label="작업으로">›</button><button data-act="home-reload" aria-label="새로고침">⟳</button><button class="tnav--on" disabled aria-label="홈">⌂</button></span>` : "";
    return `${nav}<button class="brandmark" data-act="web" data-id="/" title="웹 열기"><img src="symbol.svg" alt="" class="top__logo" /><b>Dynapse</b></button>
    <div class="top__right">${badge}${whereChip(h)}${prof}</div>`;
}
// 내 AI 줄 (#12-G G1) — 로고 + 상태 점 + 역할 칩. 카드·상태 문장 없음
function aiRow(h) {
    return `<div class="ais"><span class="ais__label">내 AI</span>
    ${h.ais.map(a => `<div class="popwrap"><button class="ai${ready(a) ? " ai--on" : ""}${h.primaryKey === a.key ? " ai--primary" : ""}" data-act="pop" data-id="ai:${a.key}" title="${esc(a.name)}">${dot(a)}${brand(a.brand)}${capChips(a.caps)}</button>${popover(h, `ai:${a.key}`, "left:0;top:44px")}</div>`).join("")}
    <button class="ai ai--add" data-act="ob-add" title="AI 추가">+</button></div>`;
}
// 실행 줄 — 확인 카드·진행 1줄은 main.ts가 만들어 넣는다(exec). 비어 있으면 웹으로 가는 버튼 하나
export function homeHtml(h, exec = "") {
    const recent = h.recent.length
        ? `<div class="ais ais--recent"><span class="ais__label">최근</span>${h.recent.map(r => `<button class="chip chip--recent" ${r.work ? `data-act="open-work" data-id="${esc(r.work)}"` : "disabled"}>${esc(r.t)}</button>`).join("")}</div>` : "";
    // 유휴 = [템플릿 고르기 ↗] 하나(#20). 도는 턴이 있으면 main.ts가 exec로 한 줄(작업 · 단계 · [보기])
    const idle = h.idle && h.connected ? `<button class="pill pill--soft pill--sm" data-act="web" data-id="/">템플릿 고르기 ↗</button> <button class="pill pill--soft pill--sm" data-act="import-folder">폴더 가져오기</button>`
        : h.idle ? `<button class="pill pill--soft pill--sm" data-act="hub-login">Dynapse 연결</button>` : "";
    const beta = h.beta ? ` · <button class="linkish" data-act="channel">${h.beta === "on" ? "베타 끄기" : "베타"}</button>` : "";
    const loc = h.location ? `<span class="warn">${esc(h.location)}</span> · ` : "";
    return `${aiRow(h)}<section class="exec"><span class="ais__label">실행</span><div class="exec__body">${exec}${idle}</div></section>${recent}<div class="corner">${loc}${esc(h.version)}${beta}</div>`;
}
// 목적지 미니어처 (#12-H) — 웹 작업 카드와 같은 그림을 실행 확인 화면에
export function destMini(slot, mood) {
    const v = slotView(slot, mood);
    if (!v.bg || !v.rect)
        return "";
    return `<div class="dest"><img src="thumbs/${v.bg}" alt="" /><span class="dest__slot" style="${pos(v.rect)}"><b>여기</b></span></div>`;
}
export const destName = (slot, mood) => slotView(slot, mood).name;
// 조립 그림 축소판(#12-P) — 온보딩 "어떤 AI를 쓰세요?" 위. 고르기 전에 왜 여러 AI인지: 사진 AI(디자인 ✕) + 디자인 AI(사진 ✕) → Dynapse(옮기기·읽기·배치) → 완성 슬라이드. 문장 0
export function assemblyHtml(mood = "qi") {
    const card = (logo, role, body, lack) => `<div class="asm__card"><div class="asm__head">${brand(logo)}<span class="rt__role">${role}</span></div>${body}<span class="asm__lack">${lack}<b>✕</b></span></div>`;
    const LAYOUT = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3.5 9.5h17M10 9.5v10" stroke="currentColor" stroke-width="1.7"/></svg>`;
    const CAM = CAMERA.replace('width="34" height="34"', 'width="14" height="14"');
    return `<section class="assembly" aria-label="여러 AI의 재료를 Dynapse가 한 장으로">
    <div class="asm__src">${card("googlegemini", "사진", `<img class="asm__photo" src="assembly/photo.jpg" alt="" />`, LAYOUT)}
      ${card("claude", "편집", `<span class="asm__wire"><i></i><i></i><i></i></span>`, CAM)}</div>
    <span class="asm__arrow">→</span><div class="asm__hub"><img src="symbol.svg" alt="Dynapse" /></div><span class="asm__arrow">→</span>
    <div class="asm__out"><img src="thumbs/v2-cover-full-${mood}.png" alt="" /><img class="asm__done" src="thumbs/assembly-filled-${mood}.png" alt="" /></div>
    <img class="asm__fly" src="assembly/photo.jpg" alt="" aria-hidden="true" /></section>`;
}
