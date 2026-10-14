// 차트 다시 그리기(#102 보정 3) — 그린 SVG가 옛 렌더러 판(data-viz-v 없음·다름)인 장을 AI 없이 다시 그린다: 작업을 열 때·턴 전·리워드 제출 전.
// verify(렌더 포함, 작은 PNG 없이)는 장마다 data-viz를 지금 판으로 다시 그리고 화면에서 칸 크기를 재어 그 크기로 다시 그린다(#102 보정 4 — flex·grid 칸). 작업 폴더에 안 저장한 변경이 있으면 건드리지 않는다(남의 변경을 섞어 커밋하지 않게)
// 차트 칩(§2)도 여기: data-viz JSON의 text·legend·annotate를 바꾸거나 칸 높이를 ±80px — 다시 그려 커밋 1
import { exec, S, T } from "./main.js";
import { ensureVerify, postChat, repoCommit, wget, wput } from "./chat.js";
export const VIZ_V = "3";
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
        if (st || !/<style\s+data-dyn\b/i.test(h))
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
export async function setViz(id, file, slot, patch, dh) {
    const h = await wget(id, file);
    if (!h || !/^[a-z0-9_-]{1,40}$/i.test(slot))
        return;
    const re = new RegExp(`(<[a-z][a-z0-9]*\\b[^>]*\\bdata-slot\\s*=\\s*["']${slot}["'][^>]*>)`, "i");
    const m = h.match(re);
    if (!m || !/\sdata-viz\s*=/.test(m[1]))
        return;
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
    if (tag === m[1])
        return;
    await wput(id, file, h.replace(m[1], () => tag));
    const wd = await T().core.invoke("work_dir", { id });
    await ensureVerify(id);
    await exec("node", [".dynapse/verify.mjs", file, "--no-small"], undefined, wd).catch(() => null);
    const what = patch?.text ? `글자 ${patch.text === "xl" ? "아주 크게" : patch.text === "l" ? "크게" : "보통"}` : patch?.legend === false ? "범례 끔" : patch?.annotate === false ? "값 표시 끔" : patch?.legend ? "범례 켬" : patch?.annotate ? "값 표시 켬" : dh > 0 ? "칸 높게" : "칸 낮게";
    await repoCommit(id, `차트 · ${what} · ${file.replace(/^result-|\.html$/g, "")}`);
}
