export const DECK_FILE = ".dynapse/deck.json";
export const DECK_PAGE_RE = /^result-[a-z0-9-]+\.html$/;
export const DECK_LANG_RE = /^result-([a-z0-9-]+)\.(en|ko|ja|zh|es|fr|de|vi|th|id|pt|it|ru|ar|hi)\.html$/;
// 표지 = result-cover · result-NN-cover(서버 coverFirst와 같은 규칙). 없으면(카드 덱) 첫 본편 장
export const DECK_COVER_RE = /^result-(?:\d+-)?cover\b/;
const iso = (t) => new Date(t).toISOString();
// 장 번호 키(앱 chat.ts orderKey와 같은 규칙) — 01·02a·card-3 · 표지 -1 · 마무리 1e6 · 번호 없으면 null
export const deckOrderKey = (f) => { const m = f.match(/^result-(?:card-)?(\d+)([a-z]?)/); if (m)
    return Number(m[1]) + (m[2] ? (m[2].charCodeAt(0) - 96) / 100 : 0); return f === "result-cover.html" ? -1 : f === "result-closing.html" ? 1e6 : null; };
const live = (p) => !p.deleted;
const isLang = (p) => !!p.lang;
// 순서를 가진 원문 장 = 살아 있고 언어판·옛 장이 아님
const ordered = (p) => live(p) && !isLang(p) && !p.stale;
// 기존 파일들 → 매니페스트(고치지 않은 날것 — deckCheck가 고친다)
export function deckFromLegacy(l, now = Date.now()) {
    const folder = new Set(l.files), apx = new Set((l.appendix ?? []).filter(f => typeof f === "string"));
    const hid = new Set((l.hidden ?? []).filter(f => typeof f === "string"));
    // 순서 = 앱 normalizeOrder와 같게: 본편 = pages.json ∩ 폴더 − 부록, 부록 = appendix.json ∩ 폴더(그 순서로 맨 뒤). pages.json이 없으면 폴더의 장을 번호 순(표지 앞·마무리 뒤)으로
    const isPage = (f) => typeof f === "string" && DECK_PAGE_RE.test(f) && !DECK_LANG_RE.test(f);
    const appx = [...new Set((l.appendix ?? []).filter(f => isPage(f) && folder.has(f)))];
    const main = [...new Set((l.pages ?? []).filter(f => isPage(f) && folder.has(f) && !apx.has(f)))];
    if (l.pages === null)
        for (const f of l.files.filter(f => isPage(f) && !main.includes(f) && !appx.includes(f)).sort((a, b) => (deckOrderKey(a) ?? 5e5) - (deckOrderKey(b) ?? 5e5) || a.localeCompare(b))) {
            const k = deckOrderKey(f);
            let at = main.length;
            if (k !== null) {
                const i = main.findIndex(x => { const kx = deckOrderKey(x); return kx !== null && kx > k; });
                if (i >= 0)
                    at = i;
            }
            else {
                const ci = main.indexOf("result-closing.html");
                if (ci >= 0)
                    at = ci;
            }
            main.splice(at, 0, f);
        }
    // 옛 장(#98 · #338 보정 1) — pages.json이 있는데 거기 없는 폴더의 장: 본편 뒤·부록 앞에 stale로(보이지 않고 번호 없음)
    const stale = l.pages === null ? [] : l.files.filter(f => isPage(f) && !main.includes(f) && !appx.includes(f)).sort();
    const pages = [...main.map(f => ({ file: f, role: "body" })), ...stale.map(f => ({ file: f, role: "body", stale: true })), ...appx.map(f => ({ file: f, role: "appendix" }))].map(p => (hid.has(p.file) && !p.stale ? { ...p, hidden: true } : p));
    const cv = pages.find(p => !p.stale && p.role !== "appendix" && DECK_COVER_RE.test(p.file)) ?? pages.find(p => !p.stale && p.role !== "appendix");
    if (cv)
        cv.role = "cover";
    // 뺀 장(deleted.json) — 폴더에 다시 있으면(다시 넣음) 기록은 무시
    const listed = new Set(pages.map(p => p.file));
    for (const d of l.deleted ?? []) {
        const f = d?.file;
        if (typeof f !== "string" || folder.has(f) || listed.has(f))
            continue;
        listed.add(f);
        pages.push({ file: f, role: apx.has(f) ? "appendix" : "body", deleted: iso(Number(d.when) || now) });
    }
    // 언어판 = 원문 장 바로 뒤(자리는 뜻이 없다 — 보이는 장은 원문 순서를 따른다)
    for (const f of [...folder].filter(f => DECK_LANG_RE.test(f)).sort()) {
        const m = f.match(DECK_LANG_RE), of = `result-${m[1]}.html`, at = pages.findIndex(p => p.file === of && !isLang(p));
        const e = { file: f, role: at >= 0 ? (pages[at].role === "cover" ? "cover" : pages[at].role) : "body", lang: m[2], of };
        let k = at;
        while (k >= 0 && k + 1 < pages.length && pages[k + 1].of === of)
            k++;
        if (at >= 0)
            pages.splice(k + 1, 0, e);
        else
            pages.push(e);
    }
    const primary = l.primary && /^[a-z]{2}$/.test(l.primary) ? l.primary : "ko";
    return { v: 1, frame: l.frame || "slide", measured: l.measured && /^\d{3,4}x\d{3,4}$/.test(l.measured) ? l.measured : null, pages,
        lock: { order: !!l.lock?.order?.length, by: l.lock?.order?.length ? "user" : null },
        lang: { primary, export: l.exportLang && /^[a-z]{2}$/.test(l.exportLang) ? l.exportLang : primary }, updated_by: "app", updated_at: iso(now) };
}
// 불변식 ①~⑦ — 거부하지 않고 고친다. files = 지금 폴더의 이름들. prev·by: AI 쓰기(⑦ 잠긴 순서는 AI가 못 바꾼다)
export function deckCheck(d0, files, o = {}) {
    const healed = {}, hit = (k, n = 1) => { healed[k] = (healed[k] ?? 0) + n; };
    const now = o.now ?? Date.now(), folder = new Set(files);
    let pages = (Array.isArray(d0.pages) ? d0.pages : []).filter(p => p && typeof p.file === "string").map(p => ({ ...p }));
    // ④ 중복 없음 — 먼저 나온 것을 남긴다
    {
        const seen = new Set(), out = [];
        for (const p of pages) {
            if (seen.has(p.file)) {
                hit("4");
                continue;
            }
            seen.add(p.file);
            out.push(p);
        }
        pages = out;
    }
    // ③ 폴더에 없는 장 → deleted
    for (const p of pages)
        if (live(p) && !folder.has(p.file)) {
            p.deleted = new Date(now).toISOString();
            hit("3");
        }
    // ② 폴더의 장이 목록에 없음 → 본편 끝(첫 부록 앞)에 body로 · 언어판은 맨 끝(자리는 뜻이 없다)
    const inList = new Set(pages.filter(live).map(p => p.file));
    for (const f of files.filter(f => DECK_PAGE_RE.test(f) && !DECK_LANG_RE.test(f) && !inList.has(f)).sort()) {
        const gone = pages.findIndex(p => p.file === f);
        if (gone >= 0)
            pages.splice(gone, 1);
        const ax = pages.findIndex(p => ordered(p) && p.role === "appendix");
        pages.splice(ax >= 0 ? ax : pages.length, 0, { file: f, role: "body" });
        inList.add(f);
        hit("2");
    }
    for (const f of files.filter(f => DECK_LANG_RE.test(f) && !inList.has(f)).sort()) {
        const m = f.match(DECK_LANG_RE), gone = pages.findIndex(p => p.file === f);
        if (gone >= 0)
            pages.splice(gone, 1);
        pages.push({ file: f, role: "body", lang: m[2], of: `result-${m[1]}.html` });
        inList.add(f);
        hit("2");
    }
    // ⑥ 언어판의 of는 살아 있는 원문 장
    const bases = new Set(pages.filter(p => live(p) && !isLang(p)).map(p => p.file));
    for (const p of pages)
        if (live(p) && isLang(p) && !(p.of && bases.has(p.of))) {
            const m = p.file.match(DECK_LANG_RE), of = m ? `result-${m[1]}.html` : null;
            if (of && bases.has(of))
                p.of = of;
            else
                p.deleted = new Date(now).toISOString();
            hit("6");
        }
    // ⑦ 잠긴 순서 — AI 쓰기는 원문 장의 상대 순서를 바꾸지 못한다(새 장·뺀 장은 그대로)
    if (o.by === "ai" && o.prev?.lock?.order) {
        const was = o.prev.pages.filter(ordered).map(p => p.file), cur = pages.filter(p => ordered(p) && was.includes(p.file));
        const want = was.filter(f => cur.some(p => p.file === f));
        if (cur.map(p => p.file).join() !== want.join()) {
            const slots = pages.map((p, i) => (ordered(p) && was.includes(p.file) ? i : -1)).filter(i => i >= 0), byFile = new Map(cur.map(p => [p.file, p]));
            const next = [...pages];
            slots.forEach((at, k) => { next[at] = byFile.get(want[k]); });
            pages = next;
            hit("7");
        }
    }
    // ⑤ 부록은 본편 뒤(살아 있는 원문 장 기준 · 언어판은 원문을 따라간다)
    {
        const main = pages.filter(p => ordered(p) && p.role !== "appendix"), apx = pages.filter(p => ordered(p) && p.role === "appendix");
        const lastMain = Math.max(-1, ...main.map(p => pages.indexOf(p))), firstApx = apx.length ? Math.min(...apx.map(p => pages.indexOf(p))) : Infinity;
        if (firstApx < lastMain) {
            const rest = pages.filter(p => !(ordered(p) && p.role === "appendix"));
            pages = [...rest, ...apx];
            hit("5", apx.length);
        }
    }
    // ① 첫 원문 장은 cover — 이름이 표지인 장이 있으면 맨 앞으로, 없으면 첫 본편 장이 cover. hidden(내보내기에서 뺀 장)은 자리를 바꾸지 않는다
    {
        const main = pages.filter(p => ordered(p) && p.role !== "appendix"), named = main.find(p => DECK_COVER_RE.test(p.file));
        if (named && main[0] !== named) {
            pages = [named, ...pages.filter(p => p !== named)];
            hit("1");
        }
        const first = named ?? main[0];
        for (const p of pages)
            if (!isLang(p) && p.role === "cover" && p !== first) {
                p.role = "body";
                if (!p.stale)
                    hit("1");
            }
        if (first && first.role !== "cover")
            first.role = "cover";
        for (const p of pages)
            if (isLang(p)) {
                const b = pages.find(x => x.file === p.of && !isLang(x));
                if (b && p.role !== b.role)
                    p.role = b.role;
            }
    }
    return { deck: { ...d0, v: 1, pages }, healed };
}
// 보이는 장 = cover·body·appendix ∧ 숨김·옛 장·지움 아님, 원문 순서 · 내보내는 언어판이 있으면 그 판으로(없으면 원문)
export function deckVisible(d) {
    const xl = d.lang?.export && d.lang.export !== d.lang.primary ? d.lang.export : null;
    return d.pages.filter(p => ordered(p) && !p.hidden).map(p => (xl ? d.pages.find(v => live(v) && v.of === p.file && v.lang === xl)?.file ?? p.file : p.file));
}
// 기존 순서(pages.json) = 지움·옛 장 아닌 원문 장 순서(본편 → 부록). 그림자 비교용
export function deckOrder(d) { return d.pages.filter(ordered).map(p => p.file); }
// 같은 내용인지(updated_at·updated_by 빼고) — 바뀐 게 없으면 다시 쓰지 않는다
export const deckSame = (a, b) => !!a && JSON.stringify({ ...a, updated_at: 0, updated_by: 0 }) === JSON.stringify({ ...b, updated_at: 0, updated_by: 0 });
