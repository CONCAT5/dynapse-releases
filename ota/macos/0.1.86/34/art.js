// 그림 재고(image_stock README §2·§5 — 2026-10-25, 판정 2에서 디냅스 이미지 맞춤 0/3): 사진이 없을 때 글·도형만 내지 않는다.
// 첫 결과에서 앱이(AI 턴 없이) 장 글과 원고에 같이 있는 명사 → 사물 그림 사전(허브 /stock/fluent/index.json, Microsoft Fluent Emoji · MIT)으로 그림 하나를 고르고,
// verify가 잰 빈 띠(내용 상자 아래·오른쪽, 쪽 번호·꼬리말 피함)에 놓는다. 사전에 없으면 그림 없음. 사람·손·얼굴 그림은 재고에 없다(fluent-stock.mjs가 거른다).
// 규칙: 덱 하나에 스타일 하나(3D · 팔레트 색이 크게 다르면 덱 전체를 팔레트로 칠한 플랫) · 장당 큰 그림 1개 · 사진 있는 장은 건너뜀 · 덱에 3장까지 · 같은 그림 두 번 안 씀
import { HUB, T, http } from "./main.js";
import { report } from "./report.js";
import { appVerify, postChat, readJson, wget, wput } from "./chat.js";
import { artClash, artRect, pickArt, placeArtHtml, recolourable, recolourSvg } from "./art-core.js";
export { artClash, artRect, pickArt, placeArtHtml, recolourable, recolourSvg, stripArt } from "./art-core.js";
const ART_FILE = ".dynapse/art.json";
const tok = (h, k) => h.match(new RegExp(`--color-semantic-${k}\\s*:\\s*(#[0-9a-f]{6})`, "i"))?.[1] ?? null;
const textOf = (h) => (h.match(/<section\b[\s\S]*<\/section>/i)?.[0] ?? "").replace(/<(style|script|svg)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
// 사진이 실제로 들어간 장(재고·생성·내 사진 — 색면 판·기다리는 칸은 아님)은 사진이 먼저(README §4)
const hasPhoto = (h) => [...h.matchAll(/<([a-z]+)\b([^>]*\bdata-slot\s*=\s*["'][\w-]+["'][^>]*)>([\s\S]*?)<\/\1>/gi)].some(m => !/data-abstract|data-photo-wait|display:\s*none/.test(m[2]) && /<img\b[^>]*\bsrc\s*=\s*["'](?!data:)[^"']+/i.test(m[3]));
let ixCache = null;
async function loadIndex() {
    if (ixCache && Date.now() - ixCache.at < 6 * 3600_000)
        return ixCache.ix;
    const r = await http("GET", `${HUB}/stock/fluent/index.json`).catch(() => null);
    if (r?.status !== 200)
        return null;
    try {
        ixCache = { at: Date.now(), ix: JSON.parse(r.body) };
        return ixCache.ix;
    }
    catch {
        return null;
    }
}
const BAD = (v, file) => [...(v.errors ?? []), ...(v.warnings ?? [])].filter(x => x.page === file && /overflow|clip|outside|overlap|margin|cut|tiny|box|text_over|photo_out|art_/.test(x.rule)).length;
// 첫 결과에 그림 놓기 — pages = 빈 공간 장(coverage·underfill) + 표지. 반환 = 그림을 놓은 장(이 장은 키우기를 건너뛴다)
export async function placeArts(id, v, pages, manuscript) {
    // 장마다 왜 그림이 없는지도 남긴다(.dynapse/art.json log — 벤치 record.json이 읽는다 · round 15 Q32 그림 0의 이유를 몰랐다)
    const log = [];
    const prev = (await readJson(id, ART_FILE).catch(() => null)) ?? {};
    const save = (items, style) => wput(id, ART_FILE, JSON.stringify({ ...(style ?? prev.style ? { style: style ?? prev.style } : {}), items, log: log.slice(0, 20), at: Date.now() }, null, 1)).catch(() => { });
    const ix = await loadIndex();
    if (!ix || !v.spaces) {
        log.push({ page: "*", why: !ix ? "no_index" : "no_spaces" });
        await save(prev.items ?? []);
        return [];
    }
    const used = (prev.items ?? []).map(x => x.id), plan = [];
    for (const page of pages) {
        if (plan.length + (prev.items?.length ?? 0) >= 3)
            break;
        const sp = v.spaces[page], html = await wget(id, page).catch(() => null);
        if (!sp || !html || hasPhoto(html) || /\bdata-art\s*=/.test(html)) {
            log.push({ page, why: !sp ? "no_space_map" : !html ? "no_page" : hasPhoto(html) ? "has_photo" : "has_art" });
            continue;
        }
        const nn = page.match(/^result-(\d{2})\.html$/)?.[1], emph = nn ? String((await readJson(id, `.dynapse/slot-${nn}.json`).catch(() => null))?.emphasis ?? "") : "";
        const pick = pickArt(ix, textOf(html), manuscript, emph, [...used, ...plan.map(p => p.pick.id)]);
        if (!pick) {
            report("turn", "art.no_noun", page);
            log.push({ page, why: "no_noun" });
            continue;
        }
        const rect = artRect(sp);
        if (!rect) {
            report("turn", "art.no_space", `${page}|${pick.id}`);
            log.push({ page, why: "no_space", detail: `${pick.id} box ${sp.box.join(",")}` });
            continue;
        }
        plan.push({ page, html, pick, rect });
    }
    if (!plan.length) {
        await save(prev.items ?? []);
        return [];
    }
    // 덱 스타일 하나 — 이미 정했으면 그대로, 아니면 고른 그림 중 하나라도 팔레트와 부딪히면 플랫
    // 재채색은 색이 상관없는 사물(트럭·시계·전구)만(대표 결정 2026-10-26 — round 14 민트색 빵): 음식·식물·동물·국기는 원래 색 플랫이고, 이것들은 플랫으로 바꾸는 이유도 되지 않는다
    const h0 = plan[0].html, style = prev.style ?? (plan.some(p => recolourable(ix.items[p.pick.id]) && artClash(ix.items[p.pick.id].colors, tok(h0, "accent-base"), tok(h0, "bg-base"))) ? "flat" : "3d");
    const dir = await T().core.invoke("work_dir", { id });
    const placed = [];
    for (const p of plan) {
        let art;
        if (style === "flat") {
            const r = await http("GET", `${HUB}/stock/fluent/${p.pick.id}/flat.svg`).catch(() => null);
            if (r?.status !== 200)
                continue;
            art = { ...p.pick, style, svg: recolourable(ix.items[p.pick.id]) ? recolourSvg(r.body) : r.body.replace(/<\?xml[^>]*>\s*/i, "") };
        }
        else {
            const file = `materials/art-${p.pick.id}.png`, g = await http("GET", `${HUB}/stock/fluent/${p.pick.id}/3d.png`, { out: `${dir}/${file}` }).catch(() => null);
            if (g?.status !== 200)
                continue;
            art = { ...p.pick, style, src: file };
        }
        const before = BAD(v, p.page), next = placeArtHtml(p.html, art, p.rect);
        await wput(id, p.page, next);
        const v2 = await appVerify(id, [p.page]).catch(() => null);
        if (!v2 || BAD(v2, p.page) > before) {
            await wput(id, p.page, p.html);
            report("turn", "art.reverted", `${p.page}|${p.pick.id}`);
            const was = new Set([...v.errors, ...v.warnings].filter(x => x.page === p.page).map(x => x.rule));
            log.push({ page: p.page, why: "reverted", detail: `${p.pick.id} · ${v2 ? [...new Set([...v2.errors, ...v2.warnings].filter(x => x.page === p.page && !was.has(x.rule)).map(x => x.rule))].join(",") || "same rules, more hits" : "verify failed"}` });
            continue;
        }
        placed.push({ page: p.page, source: "fluent", id: p.pick.id, noun: p.pick.noun, style, size: "big" });
        report("turn", "art.placed", `${p.page}|${p.pick.id}|${style}`);
    }
    if (!placed.length) {
        await save(prev.items ?? []);
        return [];
    }
    await save([...(prev.items ?? []).filter(x => !placed.some(p => p.page === x.page)), ...placed], style);
    // 따로 커밋하지 않는다 — 턴 커밋에 같이(2026-10-26 round 17: 턴 중 커밋이 뒤의 빈 사진 칸 채우기(repo_changed 기준)를 막아 사진이 하나도 안 들어갔다)
    await postChat(id, [{ role: "event", text: `빈 자리에 그림을 넣었어요(${placed.map(p => p.noun).join(", ")})`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
    return placed.map(p => p.page);
}
