export const LANES_DEFAULT = 2, LANES_MAX = 3;
const PAGE_RE = /^result-[a-z0-9-]+\.html$/;
// 공유 파일 — 장 턴은 읽기만(쓰면 덱 전체 요청이라 앞 턴 뒤로)
export const SHARED = [".dynapse/pages.json", ".dynapse/plan.json", ".dynapse/outline.json", ".dynapse/bundles.json", ".dynapse/appendix.json", ".dynapse/team.json", ".dynapse/photo-treat.json", "tokens.css", "result-tokens.css"];
// 이 턴이 고치는 장 하나 — 📍가 한 장이면 그 장, "N장"이면 차례의 N번째, "이 장"이면 웹이 보던 장. 못 정하면 null(병렬 안 함)
export function turnPageOf(text, pts, selPage, pages) {
    const files = [...new Set(pts.map(p => p.file))];
    if (files.length === 1 && PAGE_RE.test(files[0].replace(/\.[a-z]{2}\.html$/, ".html")))
        return files[0].replace(/\.[a-z]{2}\.html$/, ".html");
    if (files.length > 1)
        return null;
    const nums = [...text.matchAll(/(^|[^\d])(\d{1,2})\s*(장|페이지|번\s*장|번째\s*장|p\b)/g)].map(m => Number(m[2]));
    if (new Set(nums).size === 1 && nums[0] >= 1 && nums[0] <= pages.length)
        return pages[nums[0] - 1];
    if (new Set(nums).size > 1)
        return null;
    if (/이\s*장|이\s*페이지|이\s*슬라이드|this (page|slide)/i.test(text) && selPage && PAGE_RE.test(selPage))
        return selPage;
    return null;
}
export function laneOk(o) {
    if (!o.busy.length || !o.page || !o.feature || o.capLow || o.tool !== "claude")
        return false;
    if (o.scope !== "page" && o.scope !== "slot")
        return false;
    if (o.busy.some(b => !b.page || (b.scope !== "page" && b.scope !== "slot") || b.page === o.page))
        return false; // 덱 턴이 돌거나 같은 장이면 줄
    return o.busy.length < Math.min(LANES_MAX, Math.max(1, o.max));
}
// 이 장과 그 언어판·사진만 — 커밋·검사 대상
export function ownFile(page) {
    const stem = page.replace(/^result-/, "").replace(/\.html$/, "");
    return f => f === page || (f.startsWith(`result-${stem}.`) && /\.[a-z]{2}\.html$/.test(f)) || f.startsWith(`materials/${stem}-`) || f.startsWith(`materials/${stem}.`);
}
// 두 번째 세션이 쓰면 안 되는 것 — 다른 장(언어판 포함)·공유 파일
export function laneDeny(page, files) {
    const own = ownFile(page);
    const others = files.filter(f => (PAGE_RE.test(f) || /^result-[a-z0-9-]+\.[a-z]{2}\.html$/.test(f)) && !own(f));
    return [...others, ...SHARED].flatMap(f => [`Edit(${f})`, `Write(${f})`, `MultiEdit(${f})`]);
}
