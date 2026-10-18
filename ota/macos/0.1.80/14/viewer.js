const T = window.__TAURI__;
const inv = (c, a, o) => T.core.invoke(c, a, o);
const qs = new URLSearchParams(location.search), id = qs.get("work") ?? "", back = qs.get("to") ?? "";
const PAGE = /^result-[a-z0-9-]+\.html$/;
const $ = (s) => document.getElementById(s);
const pages = [];
let editing = false, pickFor = null;
const rank = (f) => (/^result-cover/.test(f) ? 0 : /^result-closing/.test(f) ? 2 : 1);
async function order() {
    const all = await inv("work_files", { id }).catch(e => { mark(`files ${String(e)}`); return []; });
    const files = all.map(f => f.name).filter(f => PAGE.test(f));
    let listed = [];
    try {
        listed = JSON.parse(await inv("work_read", { id, file: ".dynapse/pages.json" })).filter(f => files.includes(f));
    }
    catch { /* 순서 파일 없음 */ }
    let hidden = [];
    try {
        hidden = JSON.parse(await inv("work_read", { id, file: ".dynapse/hidden.json" }));
    }
    catch { /* 없음 */ }
    return [...listed, ...files.filter(f => !listed.includes(f)).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, undefined, { numeric: true }))].filter(f => !hidden.includes(f));
}
// 상대 주소 → data: 주소(그리기 전용)
const cache = new Map();
const rel = (u) => (u && !/^(data:|https?:|blob:|#|\/|about:)/i.test(u.trim()) ? decodeURI(u.trim().split(/[?#]/)[0]).replace(/^\.\//, "") : null);
const dataUrl = async (p) => { if (!cache.has(p))
    cache.set(p, await inv("work_data_url", { id, file: p }).catch(() => "")); return cache.get(p) ?? ""; };
const cssText = (u) => { try {
    return new TextDecoder().decode(Uint8Array.from(atob(u.split(",")[1] ?? ""), c => c.charCodeAt(0)));
}
catch {
    return "";
} };
async function cssUrls(css) {
    const ms = [...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)];
    for (const m of ms) {
        const r = rel(m[2]);
        if (r) {
            const u = await dataUrl(r);
            if (u)
                css = css.split(m[0]).join(`url("${u}")`);
        }
    }
    return css;
}
async function prepare(html) {
    const d = new DOMParser().parseFromString(html, "text/html");
    d.querySelectorAll("script").forEach(s => s.remove());
    for (const el of Array.from(d.querySelectorAll("[src]"))) {
        const r = rel(el.getAttribute("src"));
        if (r) {
            const u = await dataUrl(r);
            if (u)
                el.setAttribute("src", u);
        }
    }
    for (const l of Array.from(d.querySelectorAll("link[rel~=stylesheet][href]"))) {
        const r = rel(l.getAttribute("href"));
        if (!r)
            continue;
        const st = d.createElement("style");
        st.textContent = await cssUrls(cssText(await dataUrl(r)));
        l.replaceWith(st);
    }
    for (const st of Array.from(d.querySelectorAll("style")))
        st.textContent = await cssUrls(st.textContent ?? "");
    for (const el of Array.from(d.querySelectorAll("[style*='url(']")))
        el.setAttribute("style", await cssUrls(el.getAttribute("style") ?? ""));
    return `<!doctype html>${d.documentElement.outerHTML}`;
}
const sizeOf = (html) => { const m = html.match(/\.slide(?:\[[^\]]*\])*\s*\{[^}]*?\bwidth\s*:\s*(\d{3,4})px[^}]*?\bheight\s*:\s*(\d{3,4})px/); return m ? { w: Number(m[1]), h: Number(m[2]) } : { w: 1600, h: 900 }; };
const label = (f) => { const k = f.replace(/^result-|\.html$/g, ""); return { cover: "표지", closing: "마무리", body: "본문", data: "데이터" }[k] ?? k; };
// 고칠 수 있는 칸 — 글자만 든 data-slot(쪽번호 빼고) · 사진 칸(figure[data-slot])
const textSlots = (d) => Array.from(d.querySelectorAll("[data-slot]")).filter(e => e.tagName !== "FIGURE" && !e.closest("figure") && e.children.length === 0 && e.getAttribute("data-slot") !== "page_no");
function wire(pg) {
    const d = pg.frame?.contentDocument;
    if (!d)
        return;
    for (const e of textSlots(d)) {
        e.contentEditable = editing ? "true" : "false";
        e.style.outline = editing ? "1px dashed #2F6FEB" : "";
        e.oninput = () => save(pg);
    }
    for (const f of Array.from(d.querySelectorAll("figure[data-slot]"))) {
        f.style.cursor = editing ? "pointer" : "";
        f.style.outline = editing ? "2px dashed #2F6FEB" : "";
        f.onclick = editing ? () => { pickFor = { pg, slot: f.getAttribute("data-slot") ?? "" }; $("vfile").click(); } : null;
    }
}
// 저장 — 원래 장(디스크)을 다시 읽어 고친 글자 칸만 그 자리에(같은 칸 이름의 n번째), 1.2초 모아서
function save(pg) {
    clearTimeout(pg.timer);
    pg.timer = window.setTimeout(async () => {
        const d = pg.frame?.contentDocument;
        if (!d)
            return;
        const o = new DOMParser().parseFromString(pg.orig, "text/html");
        const seen = new Map();
        for (const e of textSlots(d)) {
            const k = e.getAttribute("data-slot"), n = seen.get(k) ?? 0;
            seen.set(k, n + 1);
            const t = Array.from(o.querySelectorAll(`[data-slot="${CSS.escape(k)}"]`)).filter(x => x.tagName !== "FIGURE")[n];
            if (t && t.children.length === 0)
                t.textContent = e.textContent ?? "";
        }
        await write(pg, `<!doctype html>\n${o.documentElement.outerHTML}\n`);
    }, 1200);
}
async function write(pg, html) {
    const ok = await inv("page_write", { id, path: pg.file, html }).then(() => true).catch(() => false);
    if (ok) {
        pg.orig = html;
        void inv("app_action", { name: "viewer-save", ai: id, model: pg.file }).catch(() => { });
        status("저장했어요 · 연결되면 올라가요");
    }
    else
        status("저장하지 못했어요 · 이 PC 사본이 잠겨 있어요");
}
// 사진 바꾸기 — 고른 파일을 materials/에(사진 원본 그대로) · 그 칸의 <img>를 그 파일로
$("vfile").onchange = async (e) => {
    const f = e.target.files?.[0], tgt = pickFor;
    e.target.value = "";
    pickFor = null;
    if (!f || !tgt)
        return;
    const ext = f.type === "image/png" ? "png" : f.type === "image/webp" ? "webp" : "jpg", path = `materials/${tgt.slot.replace(/[^\w-]/g, "") || "photo"}-off${Date.now().toString(36)}.${ext}`;
    const ok = await inv("material_write", new Uint8Array(await f.arrayBuffer()), { headers: { "x-id": id, "x-path": encodeURIComponent(path) } }).then(() => true).catch(() => false);
    if (!ok) {
        status("사진을 넣지 못했어요 · 앱을 새 버전으로 받아 주세요");
        return;
    }
    const o = new DOMParser().parseFromString(tgt.pg.orig, "text/html"), fig = o.querySelector(`figure[data-slot="${CSS.escape(tgt.slot)}"]`);
    if (!fig)
        return;
    let img = fig.querySelector("img");
    if (!img) {
        img = o.createElement("img");
        img.setAttribute("alt", "");
        fig.appendChild(img);
    }
    img.setAttribute("src", path);
    await write(tgt.pg, `<!doctype html>\n${o.documentElement.outerHTML}\n`);
    const live = tgt.pg.frame?.contentDocument?.querySelector(`figure[data-slot="${CSS.escape(tgt.slot)}"] img`);
    if (live)
        live.src = URL.createObjectURL(f);
};
const status = (t) => { $("vs").textContent = t; };
function fit() { for (const pg of pages) {
    const fr = pg.frame;
    if (!fr?.parentElement)
        continue;
    const k = fr.parentElement.clientWidth / pg.w;
    fr.style.transform = `scale(${k})`;
} }
// 발표 — 한 장씩 화면에 맞춰 · ←/→/누르기 다음 · Esc 끝
let at = 0;
function present(i) {
    at = Math.max(0, Math.min(pages.length - 1, i));
    const pg = pages[at], box = $("vpresent"), fr = $("vpf");
    box.hidden = false;
    fr.srcdoc = pg.shown;
    fr.style.width = `${pg.w}px`;
    fr.style.height = `${pg.h}px`;
    fr.style.transform = `scale(${Math.min(innerWidth / pg.w, innerHeight / pg.h)})`;
    $("vpn").textContent = `${at + 1} / ${pages.length}`;
    void document.documentElement.requestFullscreen?.().catch(() => { });
}
addEventListener("keydown", e => { if ($("vpresent").hidden)
    return; if (e.key === "Escape") {
    $("vpresent").hidden = true;
    void document.exitFullscreen?.().catch(() => { });
}
else if (["ArrowRight", "ArrowDown", " ", "PageDown"].includes(e.key))
    present(at + 1);
else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key))
    present(at - 1); });
$("vpresent").onclick = () => present(at + 1);
$("vshow").onclick = () => present(0);
$("vedit").onclick = () => { editing = !editing; $("vedit").setAttribute("aria-pressed", String(editing)); $("vedit").textContent = editing ? "고치기 끝" : "글·사진 고치기"; pages.forEach(wire); status(editing ? "글자를 눌러 고치고 · 사진 칸을 눌러 바꿔요 · 저절로 저장" : "오프라인 · 이 PC 사본이에요 · 고친 것은 연결되면 올라가요"); };
// 연결이 돌아오면 사이트로(우리 주소만)
const online = () => { const ok = navigator.onLine && /^https:\/\/(dynapse\.ai|ai-task-hub-nu\.vercel\.app)\//.test(back); $("vback").hidden = !ok; };
$("vback").onclick = () => { if (/^https:\/\/(dynapse\.ai|ai-task-hub-nu\.vercel\.app)\//.test(back))
    location.replace(back); };
addEventListener("online", online);
addEventListener("offline", online);
addEventListener("resize", fit);
const mark = (t) => { try {
    history.replaceState(null, "", `#${encodeURIComponent(t.slice(0, 80))}`);
}
catch { /* */ } }; // 자가 점검이 창 주소(#…)로 이유를 읽는다
addEventListener("error", e => mark(`err ${String(e.message)}`));
addEventListener("unhandledrejection", e => mark(`err ${String(e.reason?.message ?? e.reason)}`));
(async () => {
    if (!/^wrk_[A-Za-z0-9_-]{4,40}$/.test(id)) {
        $("vp").innerHTML = `<p class="vempty">열 작업이 없어요</p>`;
        return;
    }
    const list = await order();
    if (!list.length) {
        if (!location.hash.includes("files"))
            mark("empty");
        $("vp").innerHTML = `<p class="vempty">이 PC에 이 작업의 장이 없어요 · 연결되면 받아 와요</p>`;
        return;
    }
    $("vp").innerHTML = "";
    for (const file of list) {
        const orig = await inv("work_read", { id, file }).catch(() => "");
        if (!orig)
            continue;
        const { w, h } = sizeOf(orig), pg = { file, orig, shown: await prepare(orig), w, h };
        const sec = document.createElement("section");
        sec.className = "vpage";
        sec.dataset.file = file;
        const cap = document.createElement("small");
        cap.textContent = label(file);
        const box = document.createElement("div");
        box.className = "vframe";
        box.style.paddingTop = `${(h / w) * 100}%`;
        const fr = document.createElement("iframe");
        fr.title = label(file);
        fr.style.width = `${w}px`;
        fr.style.height = `${h}px`;
        fr.srcdoc = pg.shown;
        fr.onload = () => wire(pg);
        pg.frame = fr;
        box.appendChild(fr);
        sec.append(cap, box);
        $("vp").appendChild(sec);
        pages.push(pg);
        if (pages.length === 1) {
            const t = new DOMParser().parseFromString(orig, "text/html").querySelector("h1,h2")?.textContent?.trim();
            if (t) {
                $("vt").textContent = t.slice(0, 40);
                document.title = `${t.slice(0, 40)} · 이 PC 사본`;
            }
        }
    }
    fit();
    online();
    window.__DYN_VIEWER__ = { pages: pages.length };
    mark(`drawn ${pages.length}`);
    if (pages.length)
        void inv("inapp_alive").catch(e => mark(`alive ${String(e)}`)); // 장을 그렸다 — 자가 점검(offline_viewer)이 이 심장박동을 기다린다
})();
export {};
