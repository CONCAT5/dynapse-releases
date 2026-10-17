// 강조색은 표지 사진에서(#119 보정 8 §3 · van Nes 제너레이티브 요소) — 체계(토큰·글자·격자)는 그대로, 강조색 하나만 이 덱의 표지 사진에서 이유 있게.
// 표지(첫 장)의 첫 사진을 64px로 줄여 색을 묶고, 많은 순서로: 회색·거의 흰색/검정 제외 → 바탕(bg-base)과 대비 4.5:1이 될 때까지 명도만 내린 첫 색을 --color-semantic-accent-base로.
// tokens.css와 장마다 <style data-tokens> 끝에 한 규칙(표시 data-accent-from="photo"). 리워드·사용자가 색을 바꾼 덱·이미 한 덱은 건드리지 않는다. AI 없음, 커밋 1
import { HUB, http, S, T } from "./main.js";
import { readJson, repoCommit, wget, wput } from "./chat.js";
const MARK = "/* data-accent-from=\"photo\" */";
const lum = (r, g, b) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const hex = (r, g, b) => `#${[r, g, b].map(x => Math.round(x).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
const rgbOf = (h) => { const m = h.replace("#", ""); return [0, 2, 4].map(i => parseInt(m.slice(i, i + 2), 16)); };
function hsl(r, g, b) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn; const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)); return { s, l }; }
const defaults = new Map();
async function defaultAccent(mood) {
    if (!defaults.has(mood)) {
        const r = await http("GET", `${HUB}/api/layouts/tokens.css?mood=${mood}`).catch(() => null);
        const m = r?.status === 200 ? r.body.match(/--color-semantic-accent-base:\s*(#[0-9a-f]{6})/i)?.[1] : null;
        if (m)
            defaults.set(mood, m.toUpperCase());
    }
    return defaults.get(mood) ?? null;
}
// 사진 → 강조색 후보(명도만 낮춰 바탕과 4.5:1). 맞는 색이 없으면 null
async function pickAccent(id, file, bg) {
    const buf = await T().core.invoke("work_bytes", { id, file }).catch(() => null);
    if (!buf)
        return null;
    const url = URL.createObjectURL(new Blob([buf])), img = new Image();
    img.src = url;
    try {
        await img.decode();
    }
    catch {
        URL.revokeObjectURL(url);
        return null;
    }
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = Math.max(1, Math.round(64 * img.naturalHeight / Math.max(1, img.naturalWidth)));
    const x = c.getContext("2d");
    if (!x)
        return null;
    x.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    const d = x.getImageData(0, 0, c.width, c.height).data, bins = new Map();
    for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 200)
            continue;
        const k = (d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4), e = bins.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
        e.n++;
        e.r += d[i];
        e.g += d[i + 1];
        e.b += d[i + 2];
        bins.set(k, e);
    }
    const [br, bgG, bb] = rgbOf(bg), lb = lum(br, bgG, bb);
    for (const e of [...bins.values()].sort((a, b) => b.n - a.n).slice(0, 24)) {
        let [r, g, b] = [e.r / e.n, e.g / e.n, e.b / e.n];
        const h = hsl(r, g, b);
        if (h.s < 0.25 || h.l < 0.12 || h.l > 0.9)
            continue; // 회색·거의 검정·흰색은 강조가 아니다
        for (let k = 0; k < 12 && ratio(lum(r, g, b), lb) < 4.5; k++) {
            r *= 0.88;
            g *= 0.88;
            b *= 0.88;
        }
        if (ratio(lum(r, g, b), lb) >= 4.5 && hsl(r, g, b).s >= 0.2)
            return hex(r, g, b);
    }
    return null;
}
export async function accentFromCover(id) {
    if (!S.git)
        return false;
    const tok = await wget(id, "tokens.css").catch(() => null);
    if (!tok || tok.includes(MARK))
        return false;
    const order = ((await readJson(id, ".dynapse/pages.json").catch(() => null)) ?? []).filter(x => typeof x === "string");
    const files = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name);
    const pages = (order.length ? order : files.filter(f => /^result-[a-z0-9-]+\.html$/.test(f)).sort((a, b) => Number(b === "result-cover.html") - Number(a === "result-cover.html"))).filter(f => files.includes(f));
    const cover = pages[0] ? await wget(id, pages[0]).catch(() => null) : null;
    if (!cover)
        return false;
    if (/\bdata-(pack|brand)\b/.test(cover))
        return false; // 회사 틀·팩 색은 그대로
    const mood = /\bstyle-wa\b/.test(cover) ? "wa" : "qi", def = await defaultAccent(mood);
    if (!def)
        return false;
    const block = tok.match(new RegExp(`\\.style-${mood}\\s*\\{[^}]*\\}`))?.[0] ?? tok, cur = block.match(/--color-semantic-accent-base:\s*(#[0-9a-f]{6})/i)?.[1]?.toUpperCase();
    if (cur && cur !== def)
        return false; // 사용자가 정한 색
    const photo = [...cover.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]).find(s => !/^(data:|https?:)/i.test(s) && /\.(png|jpe?g|webp)$/i.test(s));
    if (!photo)
        return false;
    const bg = block.match(/--color-semantic-bg-base:\s*(#[0-9a-f]{6})/i)?.[1] ?? "#F5F6F4";
    const acc = await pickAccent(id, photo.replace(/^\.\//, ""), bg);
    if (!acc)
        return false;
    const rule = `${MARK}\n:root,.style-qi,.style-wa{--color-semantic-accent-base:${acc}}`;
    await wput(id, "tokens.css", `${tok.trimEnd()}\n${rule}\n`);
    for (const p of files.filter(f => /^result-[a-z0-9-]+(\.[a-z]{2})?\.html$/.test(f))) {
        const h = await wget(id, p).catch(() => null);
        if (!h || h.includes(MARK))
            continue;
        const n = h.replace(/(<style\b[^>]*\bdata-tokens\b[^>]*>)([\s\S]*?)(<\/style>)/i, (_m, a, body, z) => `${a}${body.trimEnd()}\n${rule}\n${z}`);
        if (n !== h)
            await wput(id, p, n);
    }
    await repoCommit(id, `강조색 · 표지 사진에서 ${acc}`);
    return true;
}
