// C #72 [작업에 넣기](-81 §1-17 · Fable 결정 A 2026-11-08) — 순수 부분(Tauri 없이 시험).
// 사람이 누르면 앱이 AI에게 칸 값만 JSON으로 받는다(쓰기 도구 없음). 값마다 그 값을 읽은 관찰 id(⟨탭⟩:rev:⟨n⟩)가 있어야 하고, 앱이 그 관찰 글에 값이 있는지 본다(#304 사실 규칙 · NFKC 정규화).
// 없거나 관찰 id가 없으면 그 칸은 손대지 않고 빈칸으로 센다(지어내지 않는다). 그다음 장 수 · 스타일 팩 · 형식 · 손대지 않은 장을 원래와 견주고(#72-2), 통과해야 앱이 사람의 직접 수정과 같은 길로 저장한다
import { applyFill, leaves } from "./fill-core.js";
import { squash } from "./text-norm.js";
// AI and applyFill must agree on the same capacity; never infer a smaller
// research budget from a short placeholder and then silently truncate on save.
export const putLimit = (leaf) => Math.max(leaf.max, 400);
// 넣기 지시문 판(run.json puts.instruction · #372 결과 11 — 과제 B에서 효과를 본다). 지시 줄을 바꾸면 판도 바꾼다
export const PUT_INSTRUCTION_V = "put-2026-11-08c";
// AI에게 보내는 말(영어) — 칸 목록(지금 글) + 사람 원문. 쓰기 도구를 쓰지 말고 JSON만
export function putInstruction(ask, pages, auto = false) {
    const lines = pages.map(p => `${p.file}\n${p.leaves.map(l => `  ${l.key} (≤${putLimit(l)} chars, now: "${l.text.slice(0, 60)}")`).join("\n")}`).join("\n");
    return [
        auto ? "The person asked in this sentence to put what you read into their Dynapse deck, so the app now asks for the slot values ([작업에 넣기] on their behalf). Keep the target and preservation requirements of their request."
            : "The person has NOW pressed [작업에 넣기]. This is their follow-up instruction to prepare the slot values from your completed research. Any earlier request to research first or wait for this button has now been fulfilled; retain the original target and preservation requirements.",
        "Do not call any write or save tools (no put_work_revision, no save_work) and do not open pages. Reply with JSON only:",
        '{"values":[{"file":"result-02.html","key":"title#1","value":"…","kind":"quote","obs":"tab_3:rev:5"},{"file":"result-02.html","key":"body#1","value":"…","kind":"summary","evidence":["tab_3:rev:5","tab_4:rev:2"]}]}',
        "Rules: fill only slots that the person's request is about. kind quote = copied exactly as shown, with obs = tab_id:rev:N of the observe call where you read it. kind summary or translation = your own words from what you read, with evidence = those observation ids; every number, date and name must come from them. kind inference = your own conclusion from them (evidence required; the app marks it for the person).",
        "Never invent numbers, names or dates. Leave out any slot you cannot fill from what you read. Keep each value within its character limit.",
        `Person's request: ${ask.slice(0, 600)}`,
        `Slots:\n${lines}`,
    ].join("\n");
}
const OBS_ID = /^tab_\d{1,6}:rev:\d{1,9}$/;
// 답에서 JSON 하나 — 앞뒤 글 · 코드 울타리는 버린다. 모양이 틀린 줄은 버린다
export function parsePut(answer) {
    const s = answer.indexOf("{"), e = answer.lastIndexOf("}");
    if (s < 0 || e <= s)
        return [];
    let v;
    try {
        v = JSON.parse(answer.slice(s, e + 1));
    }
    catch {
        return [];
    }
    const vals = v?.values;
    if (!Array.isArray(vals))
        return [];
    return vals.slice(0, 200).filter((x) => !!x && typeof x === "object")
        .map(x => {
        const kind = ["summary", "translation", "inference"].includes(String(x.kind)) ? x.kind : "quote";
        const ev = (Array.isArray(x.evidence) ? x.evidence : []).map(String).filter(e => OBS_ID.test(e)).slice(0, 8);
        return { file: String(x.file ?? ""), key: String(x.key ?? ""), value: String(x.value ?? "").slice(0, 2000), obs: typeof x.obs === "string" && OBS_ID.test(x.obs) ? x.obs : ev[0] ?? null, kind, evidence: kind === "quote" ? [] : ev };
    })
        .filter(x => /^result-[a-z0-9-]+\.html$/.test(x.file) && x.key && x.value.trim());
}
// Log only shape/count, never the proposed private text.
export function putShape(answer) {
    if (!answer.trim())
        return "empty_answer";
    let value;
    try {
        value = JSON.parse(answer.slice(answer.indexOf("{"), answer.lastIndexOf("}") + 1));
    }
    catch {
        return "invalid_json";
    }
    if (!Array.isArray(value?.values))
        return "missing_values";
    return value.values.length === 0 ? "empty_values" : parsePut(answer).length ? "values" : "unsupported_values";
}
// 관찰 글 안에 그 값이 낱말로 있나(정규화 · 앞뒤가 숫자 · 쉼표 · 점이 아님 — "2,340"이 "12,340"에 걸리지 않게)
export function numIn(value, text) {
    const v = squash(value), t = squash(text);
    if (!v)
        return false;
    for (let k = t.indexOf(v); k >= 0; k = t.indexOf(v, k + 1)) {
        const a = t[k - 1] ?? "", b = t[k + v.length] ?? "";
        if (!/[0-9.,]/.test(a) && !/[0-9]/.test(b) && !(/[.,]/.test(b) && /[0-9]/.test(t[k + v.length + 1] ?? "")))
            return true;
    }
    return false;
}
// #374-3 summary · translation · inference — 근거 관찰이 모두 있고, 값의 숫자(날짜 포함) · 라틴 고유명사가 근거 글에 있어야(한국어 이름 · 의미는 판정하지 않는다). 지어낸 숫자 · 이름은 막는다(#304)
export function claimsIn(value, evidence, obsText) {
    if (!evidence.length || evidence.some(e => !obsText[e]))
        return "no_evidence";
    const src = evidence.map(e => obsText[e]).join("\n");
    for (const n of value.match(/\d[\d,.]*\d|\d/g) ?? [])
        if (!numIn(n, src))
            return "number";
    const low = squash(src).toLowerCase();
    for (const w of value.match(/\b[A-Z][A-Za-z0-9&.'-]{1,40}\b/g) ?? [])
        if (!low.includes(squash(w).toLowerCase()))
            return "name";
    return "ok";
}
// 사실 대조 — 값(정규화)이 그 관찰 글(정규화) 안에 있어야
export const factIn = (value, obsText) => !!obsText && squash(value).length > 0 && squash(obsText).includes(squash(value));
export function planPut(pages, items, obsText) {
    const blanks = [], out = [];
    for (const p of pages) {
        const mine = items.filter(i => i.file === p.file);
        if (!mine.length)
            continue;
        const vals = {}, filled = [];
        for (const i of mine) {
            if (!p.leaves.some(l => l.key === i.key)) {
                blanks.push({ file: p.file, key: i.key, why: "no_slot" });
                continue;
            }
            const leaf = p.leaves.find(l => l.key === i.key);
            if (i.value.length > putLimit(leaf)) {
                blanks.push({ file: p.file, key: i.key, why: "too_long" });
                continue;
            }
            if ((i.kind ?? "quote") !== "quote") {
                const c = claimsIn(i.value, i.evidence ?? [], obsText);
                if (c !== "ok") {
                    blanks.push({ file: p.file, key: i.key, why: c });
                    continue;
                }
                vals[i.key] = i.value;
                filled.push({ key: i.key, obs: i.evidence[0], kind: i.kind, evidence: i.evidence });
                continue;
            }
            if (!i.obs) {
                blanks.push({ file: p.file, key: i.key, why: "no_obs" });
                continue;
            }
            if (!factIn(i.value, obsText[i.obs])) {
                blanks.push({ file: p.file, key: i.key, why: "not_in_obs" });
                continue;
            }
            vals[i.key] = i.value;
            filled.push({ key: i.key, obs: i.obs, kind: "quote" });
        }
        // 사실은 자르지 않는다(템플릿 칸 길이 상한은 채우기용) — 넉넉한 상한으로 넣는다
        if (filled.length) {
            const after = applyFill(p.html, p.leaves.map(l => ({ ...l, max: putLimit(l) })), vals);
            if (after !== p.html)
                out.push({ file: p.file, before: p.html, after, filled });
        }
    }
    for (const i of items)
        if (!pages.some(p => p.file === i.file))
            blanks.push({ file: i.file, key: i.key, why: "no_slot" });
    return { pages: out, blanks };
}
export function nativeCheck(base, cand, allowed) {
    const out = [];
    if (base.format !== cand.format)
        out.push({ what: "format" });
    if ((base.style_pack ?? null) !== (cand.style_pack ?? null))
        out.push({ what: "style_pack" });
    const b = base.slides ?? [], c = cand.slides ?? [];
    if (b.length !== c.length)
        out.push({ what: "slides" });
    const changed = b.filter(s => !allowed.includes(s.id) && c.find(x => x.id === s.id)?.html !== s.html).map(s => s.id);
    if (changed.length)
        out.push({ what: "pages", ids: changed });
    return out;
}
export const pageId = (file) => file.replace(/^result-/, "").replace(/\.html$/, "");
export { leaves };
