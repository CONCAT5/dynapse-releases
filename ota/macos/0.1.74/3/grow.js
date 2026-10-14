// 키우기(#121 §3) — 작게 나온 장(underfill)을 AI 없이 키운다: 장의 <style>(토큰·글꼴·블록 CSS 제외)과 section 안 style 속성에서
// 크기·간격 값(px·rem)만 k배(위치 top·left·%·vw는 그대로, 장 자체 크기도 그대로). 검사해서 새로 넘치거나 겹치면 k를 0.9씩 줄여 3번까지 → 커밋 "키우기 ×k"
// 구성 장(블록 CSS는 해시로 잠김)은 바꾸지 않는다 — 블록을 바꿔야 한다고 알린다. 리워드 턴엔 쓰지 않는다(재고는 사람이 쓴 크기)
import { appVerify, postChat, repoCommit, wget, wput } from "./chat.js";
const PROPS = /^(font-size|width|height|min-width|min-height|max-width|max-height|gap|row-gap|column-gap|padding(-[a-z]+)?|margin-(top|bottom)|line-height|border-radius|flex-basis|letter-spacing|grid-template-columns|grid-template-rows|--[a-z0-9-]*(size|gap|space)[a-z0-9-]*)$/i;
const SLIDE_SEL = /^(html|body|:root|\*|\.slide|section|section\.slide)(\[[^\]]*\])*$/i;
const mul = (v, k) => v.replace(/(-?\d*\.?\d+)(px|rem)\b/g, (_m, n, u) => `${Math.round(Number(n) * k * (u === "rem" ? 100 : 1)) / (u === "rem" ? 100 : 1)}${u}`);
const growDecls = (body, k) => body.replace(/([a-z-]+)\s*:\s*([^;{}]+)/gi, (m, prop, val) => (PROPS.test(prop.trim()) ? `${prop}:${mul(val, k)}` : m));
export function growHtml(html, k) {
    const out = html.replace(/(<style\b([^>]*)>)([\s\S]*?)(<\/style>)/gi, (m, open, attrs, css, close) => {
        if (/\bdata-(tokens|fonts|block|brand)\b/i.test(attrs))
            return m;
        const next = css.replace(/([^{}]+)\{([^{}]*)\}/g, (r, sel, body) => (sel.trim().startsWith("@") || sel.split(",").every(x => SLIDE_SEL.test(x.trim())) ? r : `${sel}{${growDecls(body, k)}}`));
        return open + next + close;
    });
    // section 안쪽 요소의 style 속성(section 자신은 그대로)
    const a = out.search(/<section\b/i);
    if (a < 0)
        return out;
    const secOpen = out.indexOf(">", a) + 1, b = out.search(/<\/section\s*>/i);
    const inner = out.slice(secOpen, b > 0 ? b : undefined).replace(/(\sstyle\s*=\s*")([^"]*)(")/gi, (_m, p1, v, p3) => p1 + growDecls(v, k) + p3);
    return out.slice(0, secOpen) + inner + (b > 0 ? out.slice(b) : "");
}
const BAD = (v, file) => [...(v.errors ?? []), ...(v.warnings ?? [])].filter(x => x.page === file && /overflow|clip|outside|overlap|margin|cut|tiny|box/.test(x.rule)).length;
export async function growPage(id, file, k0) {
    const say = (text) => postChat(id, [{ role: "event", text, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
    const name = file.replace(/^result-|\.html$/g, "");
    const orig = await wget(id, file);
    if (!orig)
        return;
    if (/<section\b[^>]*\bdata-grid\s*=\s*["']12["']/i.test(orig)) {
        await say("블록으로 짠 장은 크기를 바꿀 수 없어요 · 블록을 더 큰 것으로 바꿔 달라고 말해 주세요");
        return;
    }
    // 한 번에 ×1.8까지(지시서 상한) — 그래도 작으면 같은 동작 안에서 한 번 더(검사를 거쳐), 커밋은 끝에 한 번
    let cur = orig, total = 1, steps = 0;
    let v0 = await appVerify(id, [file]);
    for (; steps < 2; steps++) {
        const uf = [...(v0.warnings ?? []), ...(v0.errors ?? [])].find(x => x.page === file && x.rule === "underfill");
        if (steps > 0 && !uf)
            break;
        let k = Math.max(1.05, Math.min(1.8, (steps === 0 ? k0 : null) ?? uf?.k ?? 1.4)), ok = false;
        const base = BAD(v0, file);
        for (let t = 0; t < 4; t++) {
            const next = growHtml(cur, k);
            await wput(id, file, next);
            const v = await appVerify(id, [file]);
            if (BAD(v, file) <= base) {
                cur = next;
                total *= k;
                v0 = v;
                ok = true;
                break;
            }
            k = Math.max(1.05, k * 0.9);
        }
        if (!ok) {
            await wput(id, file, cur);
            break;
        }
    }
    if (cur !== orig) {
        await repoCommit(id, `키우기 ×${total.toFixed(2)} · ${name}`);
        await say(`${name}을 ×${total.toFixed(2)} 키웠어요 · 되돌리기 ⌘Z`);
        return;
    }
    await wput(id, file, orig);
    await say("키우면 넘쳐서 그대로 뒀어요 · 줄을 장 폭에 맞춰 다시 짜 달라고 말해 주세요");
}
