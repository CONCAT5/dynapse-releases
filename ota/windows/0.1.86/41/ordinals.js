// 순번 다시 매기기(#189 — 대표 2026-10-19 "순서를 바꾸면 번호도") — 장 순서가 바뀐 뒤, 순번만 담은 칸(card_no·section_no·step_no·numeral 등)과
// 제목 칸 맨 앞의 순번("1 자동차 경로 조회"의 1)을 새 순서대로. AI 호출 0 · 순수 함수(턴 끝 정리·내보내기 전·turn-sim이 같은 것을 쓴다).
// 바꾸는 조건(의미 있는 숫자 보호): 같은 종류의 칸이 장마다 하나씩, 둘 이상의 장에 있고, 지금 숫자들이 겹침 없는 연속(m, m+1, …)일 때만.
// 그래서 2.5km·48점·2026 같은 숫자, 한 장 안의 1·2·3 단계는 건드리지 않는다. 형식(앞 0·"STEP "·끝 ".")은 칸마다 그대로
const ORD_SLOTS = ["card_no", "section_no", "step_no", "numeral", "chapter_no", "part_no"];
const TITLE_SLOTS = ["title", "section_title", "headline"];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const slotRe = (slot) => new RegExp(`(<[a-z][a-z0-9]*\\b[^>]*\\bdata-slot\\s*=\\s*["']${esc(slot)}["'][^>]*>)([^<]*)(<)`, "gi");
// 순번만: "01" · "1" · "1." · "STEP 1" · "No. 3" · "#2"
const ONLY = /^(\s*(?:step|no\.?|#|part|chapter)?\s*)(\d{1,2})(\.?\s*)$/i;
// 제목 맨 앞: "1 자동차…" · "01. 시장" — 숫자 뒤에 점·공백이 있고 글이 이어진다(2.5km·48점은 아님)
const LEAD = /^(\s*)(\d{1,2})(\.?\s+)(\S[\s\S]*)$/;
function find(html, slot, re) {
    const out = [];
    for (const m of html.matchAll(slotRe(slot))) {
        const t = re.exec(m[2]);
        if (t)
            out.push({ n: Number(t[2]), width: t[2].length });
    }
    return out;
}
function rewrite(html, slot, re, n) {
    return html.replace(slotRe(slot), (all, a, text, c) => {
        const t = re.exec(text);
        if (!t)
            return all;
        const num = String(n).padStart(t[2].length, "0");
        return re === LEAD ? `${a}${t[1]}${num}${t[3]}${t[4]}${c}` : `${a}${t[1]}${num}${t[3]}${c}`;
    });
}
// pages = 새 순서의 장(원문). 돌려주는 것 = 바뀐 장만 { file → 장별 새 순번 표 } — 언어판에도 같은 번호를 쓰도록 표로 준다
export function ordinalPlan(pages) {
    const plan = new Map();
    for (const [slot, lead] of [...ORD_SLOTS.map(s => [s, false]), ...TITLE_SLOTS.map(s => [s, true])]) {
        const re = lead ? LEAD : ONLY;
        const rows = pages.map(p => ({ file: p.file, hits: find(p.html, slot, re) })).filter(r => r.hits.length);
        if (rows.length < 2 || rows.some(r => r.hits.length !== 1))
            continue;
        const nums = rows.map(r => r.hits[0].n), min = Math.min(...nums);
        if (new Set(nums).size !== nums.length || Math.max(...nums) - min !== nums.length - 1)
            continue; // 겹침 없는 연속만
        rows.forEach((r, i) => { if (r.hits[0].n !== min + i)
            plan.set(r.file, [...(plan.get(r.file) ?? []), { slot, lead, n: min + i }]); });
    }
    return plan;
}
export function applyOrdinals(html, rows) {
    let out = html;
    for (const r of rows)
        out = rewrite(out, r.slot, r.lead ? LEAD : ONLY, r.n);
    return out;
}
