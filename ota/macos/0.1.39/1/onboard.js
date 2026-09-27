// 앱 창의 네이티브 화면(#21 보정 13) — 온보딩과 "연결 전" 한 장만. 연결된 뒤의 상태(내 AI·실행·기기)는 웹 /connect가 보여 준다(home.ts 삭제).
// 순수 렌더 함수(상태 → HTML) — 앱(main.ts)과 단어 예산 검사(scripts/word-budget.mts)가 같은 코드를 쓴다. Tauri 의존 없음.
import { slotView } from "./shared/slots.js";
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pos = (r) => `left:${r[0]}%;top:${r[1]}%;width:${r[2]}%;height:${r[3]}%`;
const brand = (file, cls = "brand") => `<i class="${cls}" style="-webkit-mask-image:url(brands/${file}.svg);mask-image:url(brands/${file}.svg)"></i>`;
const CAMERA = `<svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M4 8h3l1.6-2.2h6.8L17 8h3v11H4z"/><circle cx="12" cy="13.2" r="3.6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
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
// 연결 전(토큰 없음) 한 장 — 로고 + [Dynapse 연결] + 버전. 연결되면 같은 창이 웹을 로드한다
export function mainHtml(st) {
    // 연결됨 = 버튼 없이 곧바로 웹(대표: "열기 페이지 없이") — 잠깐 보이는 동안 로고만, 넘어가지 않으면 작은 글 링크
    const body = st.connected
        ? `<button class="linkbtn solo__go" data-act="go-web">작업 화면으로</button>`
        : `<button class="pill" data-act="hub-login" ${st.hubBusy ? "disabled" : ""}>Dynapse 연결</button>`;
    return `<section class="solo"><img src="symbol.svg" alt="Dynapse" class="solo__logo" />${body}</section><div class="corner">${st.location ? `<span class="warn">${esc(st.location)}</span> · ` : ""}${esc(st.version)}</div>`;
}
