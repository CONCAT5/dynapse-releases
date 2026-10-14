// 차트 다시 그리기(#102 보정 3) — 그린 SVG가 옛 렌더러 판(data-viz-v 없음·다름)인 장을 AI 없이 다시 그린다: 작업을 열 때·턴 전·리워드 제출 전.
// verify(렌더 포함, 작은 PNG 없이)는 장마다 data-viz를 지금 판으로 다시 그리고 화면에서 칸 크기를 재어 그 크기로 다시 그린다(#102 보정 4 — flex·grid 칸). 작업 폴더에 안 저장한 변경이 있으면 건드리지 않는다(남의 변경을 섞어 커밋하지 않게)
// 차트 칩(§2)도 여기: data-viz JSON의 text·legend·annotate를 바꾸거나 칸 높이를 ±80px — 다시 그려 커밋 1
import { exec, S, T } from "./main.js";
import { ensureVerify, postChat, repoCommit, wget, wput } from "./chat.js";
export const VIZ_V = "4"; // 4 = 범례 줄바꿈·끝 라벨 자리·x 라벨 솎기(#102 보정 5)
const RESULT = /^result-[a-z0-9-]+\.html$/;
const stale = (h) => /\sdata-viz\s*=/.test(h) && (!/data-viz-v="(\d+)"/.test(h) || [...h.matchAll(/data-viz-v="(\d+)"/g)].some(m => m[1] !== VIZ_V) || (h.match(/\sdata-viz\s*=/g) ?? []).length > (h.match(/data-viz-v=/g) ?? []).length);
export async function redrawCharts(id, why) {
    if (!S.git)
        return 0;
    const files = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(f => RESULT.test(f));
    // 줄 맞춤(#125)이 아직 안 된 장(<style data-dyn> 없음)도 같은 길로 — 옛 덱은 다음 AI 턴을 기다리지 않고 열 때 맞춘다(대표 2026-10-14 "올라갔다며 왜 아직도")
    const old = [];
    let charts = 0;
    for (const f of files) {
        const h = await wget(id, f);
        if (!h)
            continue;
        const st = stale(h);
        if (st)
            charts++;
        if (st || !/<style\s+data-dyn(?=[\s>])/i.test(h))
            old.push(f);
    }
    if (!old.length)
        return 0;
    const dirty = (await T().core.invoke("repo_changed", { id }).catch(() => [])).filter(f => RESULT.test(f));
    if (dirty.length)
        return 0;
    await ensureVerify(id);
    const wd = await T().core.invoke("work_dir", { id });
    await exec("node", [".dynapse/verify.mjs", ...old, "--no-small"], undefined, wd).catch(() => null);
    const changed = (await T().core.invoke("repo_changed", { id }).catch(() => [])).filter(f => RESULT.test(f));
    if (!changed.length)
        return 0;
    await repoCommit(id, charts ? `차트 다시 그림 · 줄 맞춤 · ${changed.length}장` : `줄 맞춤 · ${changed.length}장`);
    if (why !== "quiet")
        await postChat(id, [{ role: "event", text: charts ? `차트를 새 크기로 다시 그리고 줄바꿈을 맞췄어요 · ${changed.length}장` : `줄바꿈을 맞췄어요 · ${changed.length}장`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
    return changed.length;
}
// 차트 칩(§2) — slot의 data-viz에 patch(text·legend·annotate)를, 또는 칸 높이를 ±dh. 다시 그려 커밋 1
// 좌우 꽉(#102 보정 5) — 칸 폭은 부모(격자·max-width·auto 여백)가 정해 AI가 width:100%를 줘도 안 늘어난다. 그 칸과 section 안 조상의 max-width·auto 여백을 풀고
// 격자면 한 줄 전체(grid-column 1/-1). section 자신의 바깥 여백은 그대로. <style data-dyn-full>에 칸마다 한 규칙(verify 줄 맞춤이 지우지 않는 별도 블록)
export function fullWidthCss(h, slot) {
    const q = `[data-slot="${slot}"]`, rule = `section :has(> ${q}),section :has(${q}),${q}{max-width:none!important;margin-left:0!important;margin-right:0!important;grid-column:1/-1!important;justify-self:stretch!important;align-self:stretch!important}${q}{width:100%!important}`;
    const blk = h.match(/<style\s+data-dyn-full\b[^>]*>([\s\S]*?)<\/style\s*>/i);
    if (blk)
        return blk[1].includes(`${q}{width:100%`) ? h : h.replace(blk[0], () => blk[0].replace(/<\/style\s*>$/i, `${rule}</style>`));
    return /<\/head>/i.test(h) ? h.replace(/<\/head>/i, `<style data-dyn-full>${rule}</style>\n</head>`) : h;
}
// 칩·AI 동작 공통(#102 보정 5) — HTML만 바꾼다(검사·커밋 없음). 바뀐 게 없으면 null
export function patchViz(h0, slot, patch, dh) {
    if (!/^[a-z0-9_-]{1,40}$/i.test(slot))
        return null;
    const full = patch?.full === true;
    if (patch) {
        patch = { ...patch };
        delete patch.full;
        if (!Object.keys(patch).length)
            patch = null;
    }
    const h = full ? fullWidthCss(h0, slot) : h0;
    const re = new RegExp(`(<[a-z][a-z0-9]*\\b[^>]*\\bdata-slot\\s*=\\s*["']${slot}["'][^>]*>)`, "i");
    const m = h.match(re);
    if (!m || !/\sdata-viz\s*=/.test(m[1]))
        return null;
    let tag = m[1];
    if (patch)
        tag = tag.replace(/\sdata-viz\s*=\s*(?:'([^']*)'|"([^"]*)")/, (all, a, b) => {
            try {
                const raw = (a ?? b ?? "").replace(/&quot;/g, '"').replace(/&#0*39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
                const sp = { ...JSON.parse(raw), ...patch };
                return ` data-viz='${JSON.stringify(sp).replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/</g, "&lt;")}'`;
            }
            catch {
                return all;
            }
        });
    if (dh) { // 칸 높이 — 인라인 height가 있으면 그것을, 없으면 새로(아래 요소는 흐름대로 밀린다)
        const cur = Number(tag.match(/\sstyle\s*=\s*["'][^"']*?(?:^|;)\s*height\s*:\s*(\d+(?:\.\d+)?)px/i)?.[1] ?? 0) || 360;
        const nh = Math.max(160, Math.min(860, cur + dh));
        tag = /\sstyle\s*=\s*["']/.test(tag) ? (/(?:^|;|["'])\s*height\s*:/.test(tag.match(/\sstyle\s*=\s*["']([^"']*)/)?.[1] ?? "") ? tag.replace(/(\sstyle\s*=\s*["'][^"']*?)(height\s*:\s*)\d+(?:\.\d+)?px/i, `$1$2${nh}px`) : tag.replace(/(\sstyle\s*=\s*["'])/, `$1height:${nh}px;`)) : tag.replace(/>$/, ` style="height:${nh}px">`);
    }
    if (tag === m[1] && h === h0)
        return null;
    return h.replace(m[1], () => tag);
}
export async function setViz(id, file, slot, patch, dh) {
    const h0 = await wget(id, file);
    if (!h0)
        return;
    const full = patch?.full === true, out = patchViz(h0, slot, patch, dh);
    if (!out)
        return;
    await wput(id, file, out);
    const wd = await T().core.invoke("work_dir", { id });
    await ensureVerify(id);
    await exec("node", [".dynapse/verify.mjs", file, "--no-small"], undefined, wd).catch(() => null);
    const what = full ? "좌우 꽉" : patch?.text ? `글자 ${patch.text === "xl" ? "아주 크게" : patch.text === "l" ? "크게" : "보통"}` : patch?.legend === false ? "범례 끔" : patch?.annotate === false ? "값 표시 끔" : patch?.legend ? "범례 켬" : patch?.annotate ? "값 표시 켬" : dh > 0 ? "칸 높게" : "칸 낮게";
    await repoCommit(id, `차트 · ${what} · ${file.replace(/^result-|\.html$/g, "")}`);
}
// AI가 고른 차트 동작(#102 보정 5) — 에이전트는 차트 CSS를 쓰지 않고 .dynapse/viz-actions.json에 동작 이름만: [{"file","slot","do":["full-width","text:l","box:+","legend:off",…]}].
// 턴 끝 검사 전에 앱이 적용한다(턴 커밋에 함께). 모르는 이름은 버린다. 적용한 수
export async function applyVizActions(id) {
    const raw = await wget(id, ".dynapse/viz-actions.json");
    if (!raw)
        return 0;
    let list = [];
    try {
        const j = JSON.parse(raw);
        list = Array.isArray(j) ? j : [];
    }
    catch { /* */ }
    let n = 0;
    for (const a of list.slice(0, 12)) {
        if (!/^result-[a-z0-9-]+\.html$/.test(a.file ?? "") || !a.slot)
            continue;
        let h = await wget(id, a.file);
        if (!h)
            continue;
        for (const d of (a.do ?? []).slice(0, 6)) {
            const p = d === "full-width" ? { full: true } : /^text:(m|l|xl)$/.test(d) ? { text: d.slice(5) } : d === "legend:off" ? { legend: false } : d === "legend:on" ? { legend: true } : d === "values:off" ? { annotate: false } : d === "values:on" ? { annotate: true } : null;
            const dh = d === "box:+" ? 80 : d === "box:-" ? -80 : 0;
            if (!p && !dh)
                continue;
            const out = patchViz(h, a.slot, p, dh);
            if (out) {
                h = out;
                n++;
            }
        }
        await wput(id, a.file, h);
    }
    await wput(id, ".dynapse/viz-actions.json", "[]").catch(() => { });
    return n;
}
