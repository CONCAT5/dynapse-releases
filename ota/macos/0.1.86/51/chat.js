// 작업실 대화 엔진 (WORKORDER #14 · #20) — 앱의 실행 경로는 이것 하나: 메시지 수신 → 세션 확보 → stdin → 이벤트 배치 → 턴 종료(검증·버전·사진·동기화).
// 한 작업 = 살아 있는 Claude Code 세션 하나(Codex는 메시지마다 exec/resume). 사진은 에이전트가 지침대로 agy를 직접 부른다(앱 안 사진 호출 없음)
import { fixRawColors } from "./colors.js";
import * as BS from "./bundle-small.js";
import { taskInstruction } from "./shared/intent.js";
import { CHAT_FLUSH_MS } from "./limits.js";
import { flushReports, report, tally } from "./report.js";
import { bgAct, bgDone, bgSet } from "./bg.js";
import { holdTurn, netState, queueChat } from "./net.js";
import { ONB } from "./shared/onb.js";
import { localReady } from "./engines.js";
import { LAYOUT_REGISTRY } from "./shared/layout-registry.js";
import { formPages } from "./shared/forms.js";
import { CODEX_UNSUP, codexModelOk, markCodexUnsupported, PAGE_RE, anyPhotoReady, genSlotPhoto, nextMaterial, pageKey, photoReady, placePhoto, readSlots, resolvePage, photoStats, runPhotoRequests, fillEmptySlots, addCredit, runPhotoTurn, setSlotImg, slotKey, stopAnswer, editionsOf } from "./photo-runner.js";
import { diagAuto, diagReport } from "./diag.js";
import { importArticle } from "./article.js";
import { QR_DEFAULT_URL, isQrSlot } from "./qr-default.js";
import { HUB, MCP_URL, S, T, WORK_ID, agyCode, agyLogin, loginPaste, api, deviceBody, exec, http, mcp, openLogin, pullOnce, render, spawn, store, switchAccount } from "./main.js";
export const AI_LABEL = { claude: "Claude", chatgpt: "ChatGPT", gemini: "Gemini" };
export let skillCache = null;
let skillAt = 0;
// 지침은 10분마다 다시 확인(#54 D18 — 예전엔 앱 세션 동안 메모리 사본만 써서 지침을 바꿔도 재시작 전엔 옛 것). 바뀌었을 때만 저장
// 턴의 레이아웃(#167 ①) — 묶음에서 뺀 슬롯 지도 대신 이 덱 판형(첫 장 .slide 폭 1080 = 카드)에 맞는 레이아웃 이름 + 지정 형태. 슬롯은 .dynapse/layouts.md에서 필요할 때만 읽는다
export async function layoutsLine(id) {
    const ix = TIER_BUNDLES?.index;
    if (!ix)
        return "";
    const files = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name);
    const forms = (await readJson(id, ".dynapse/reward-forms.json").catch(() => null)) ?? {};
    const first = files.find(n => n === "result-cover.html") ?? files.find(n => /^result-[a-z0-9-]+\.html$/.test(n));
    const fh = first ? (await wget(id, first).catch(() => null)) ?? "" : "", w = Number(fh.match(/\.slide(?:\[[^\]]*\])*\s*\{[^}]*?\bwidth\s*:\s*(\d{3,4})px/)?.[1] ?? 0);
    const pr = fh.match(/<section\b[^>]*\bdata-format\s*=\s*["'](print:[a-z0-9_]+)["']/i)?.[1] ?? null; // 인쇄 판(#217) — 그 형식의 인쇄 레이아웃만
    const kind = pr ?? (w === 1080 || Object.keys(forms).some(f => /card-\d+/.test(f)) ? "card" : "slide");
    const ids = Object.entries(ix).filter(([, v]) => (v.formats ?? []).includes(kind)).map(([k]) => k);
    const assigned = [...new Set(Object.values(forms))].filter(f => ix[f] && !ids.includes(f));
    return `[Layouts for this ${pr ? `print (${pr.slice(6)}, sizes in mm/pt)` : kind === "card" ? "card-news" : "slide"} deck: ${[...ids, ...assigned].join(" · ")}. Copy from materials/<id>.html; each layout's slots are in .dynapse/layouts.md — read only the lines you use.]\n`;
}
// 등급별 지침 묶음(#123) — hub skills/bundles/{light,normal,heavy}.md. 받으면 CLAUDE.md = 가벼움(+ 안내), .dynapse/skill-normal|heavy.md = 큰 묶음. 못 받으면 예전처럼 전체를 CLAUDE.md로
export let TIER_BUNDLES = null;
let bundleAt = 0;
async function tierBundles() {
    if (TIER_BUNDLES && Date.now() - bundleAt < 600_000)
        return TIER_BUNDLES;
    const got = {};
    for (const n of ["light", "normal", "heavy", "layouts"]) {
        const r = await http("GET", `${HUB}/skills/bundles/${n}.md`).catch(() => null);
        if (r?.status === 200 && r.body.startsWith("#"))
            got[n] = r.body;
    }
    // 레이아웃 색인(#167 ①) — 묶음에서 뺀 슬롯 지도의 판형·역할. 턴 머리말에 이 턴의 판형에 맞는 이름만
    let index;
    {
        const r = await http("GET", `${HUB}/skills/bundles/layouts.json`).catch(() => null);
        if (r?.status === 200)
            try {
                index = JSON.parse(r.body);
            }
            catch { /* 없음 */ }
    }
    // 상황별 규칙 파일(#167 — 차트·변형·보고서 문체·compose·사진·계획·미디어): 묶음엔 "언제 열지" 한 줄, 내용은 .dynapse/rules-<주제>.md
    const rules = {};
    {
        const r = await http("GET", `${HUB}/skills/bundles/rules.json`).catch(() => null);
        let names = [];
        try {
            names = r?.status === 200 ? JSON.parse(r.body) : [];
        }
        catch { /* 없음 */ }
        for (const n of names.filter(x => /^[a-z]{2,20}$/.test(x))) {
            const g = await http("GET", `${HUB}/skills/bundles/rules-${n}.md`).catch(() => null);
            if (g?.status === 200 && g.body.startsWith("#"))
                rules[n] = g.body;
        }
    }
    if (got.light && got.normal && got.heavy) {
        TIER_BUNDLES = { ...got, ...(index ? { index } : {}), ...(Object.keys(rules).length ? { rules } : {}) };
        bundleAt = Date.now();
        await store.set("tier_bundles", TIER_BUNDLES);
        await store.save();
    }
    else
        TIER_BUNDLES ??= (await store.get("tier_bundles")) ?? null;
    return TIER_BUNDLES;
}
export async function workflowSkill() {
    if (skillCache && Date.now() - skillAt < 600_000)
        return skillCache;
    const r = await http("GET", `${HUB}/skills/dynapse-workflow.md`).catch(() => null);
    if (r?.status === 200 && r.body.includes("turn.json")) {
        skillAt = Date.now();
        if (r.body !== skillCache) {
            skillCache = r.body;
            await store.set("skill_md", r.body);
            await store.save();
        }
        return r.body;
    }
    if (skillCache)
        return skillCache;
    return (skillCache = (await store.get("skill_md")) ?? null); // 오프라인이면 마지막으로 받은 지침
}
// team.json(#12-V V1 모양): design.order(순차) · photo.compare(병렬) | photo.single
export const teamToFile = (t) => ({ merge: t.merge, design: { order: t.design }, photo: t.photo.length > 1 ? { compare: t.photo } : { single: t.photo[0] ?? null }, chosen: t.chosen ?? null });
// 직접 수정 가드(#143 §2) — 장 파일 쓰기는 모두 여기를 지난다. 그 장에 아직 저장 안 된 직접 수정(pending-edits)이 있고 이 쓰기가 그걸 지우면 다시 얹는다
// (턴 뒤 정리·언어판 따라가기·사진 채우기·쪽번호 등 어떤 자동 경로도 사용자의 글·사진·조절을 덮지 못한다). 사용자 자신의 경로(되돌리기·다시 하기·사진 바꾸기)는 handPut
const PAGE_W = /^result-[a-z0-9-]+(?:\.[a-z]{2})?\.html$/;
export const handPut = (id, file, text) => T().core.invoke("work_write", { id, file, text });
export const wput = async (id, file, text) => T().core.invoke("work_write", { id, file, text: PAGE_W.test(file) ? await keepHand(id, file, text).catch(() => text) : text });
export const wget = (id, file) => T().core.invoke("work_read", { id, file }).catch(() => null);
// 장이 가리키는 재료(2026-10-11 대표 "복제하면 이미지가 다 깨진다 · 상대방도 깨진다") — 앱 파일 목록(work_files)은 정해진 폴더만 보여서
// AI가 만든 assets/ev/….jpg 같은 재료가 동기화·복제에서 빠졌다. 결과 장의 src·href·url()이 가리키는 상대경로(가져온 HTML 재료 폴더)를 목록에 더한다
const REF_DIR = /^(assets|images|img|fonts|css|js|media)\/([\w .()-]{1,100}\/)?[\w .()-]{1,120}\.(png|jpe?g|webp|gif|svg|ttf|otf|woff2?|css|js)$/i;
export async function pageRefs(id, list) {
    const have = new Set(list.map(x => x.name)), want = new Set();
    for (const pg of list.filter(x => /^result-[a-z0-9-]+\.html$/.test(x.name))) {
        const h = await wget(id, pg.name);
        if (!h)
            continue;
        for (const m of h.matchAll(/(?:src|href)\s*=\s*["']([^"'#?]+)[^"']*["']|url\(\s*["']?([^"')#?]+)[^)]*\)/gi)) {
            let r = (m[1] ?? m[2] ?? "").trim();
            if (!r || /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(r))
                continue;
            try {
                r = decodeURIComponent(r);
            }
            catch { /* 그대로 */ }
            r = r.replace(/^\.\//, "");
            if (!r.includes("..") && REF_DIR.test(r) && !have.has(r))
                want.add(r);
        }
    }
    const dir = want.size ? await T().core.invoke("work_dir", { id }).catch(() => null) : null;
    const out = [];
    for (const r of [...want].slice(0, 200)) { // 크기 = curl -I file://(OS 공통) · 없는 파일은 뺀다
        const h = dir ? await exec("curl", ["-sI", `file:///${encodeURI(`${dir}/${r}`.replace(/\\/g, "/").replace(/^\//, ""))}`]).catch(() => null) : null;
        const n = Number(h?.code === 0 ? h.stdout.match(/content-length:\s*(\d+)/i)?.[1] : NaN);
        if (Number.isFinite(n) && n > 0)
            out.push({ name: r, size: n });
    }
    return out;
}
export async function readJson(id, file) {
    const r = await wget(id, file);
    let v;
    try {
        v = r ? JSON.parse(r) : null;
    }
    catch {
        v = null;
    }
    if (r && META_SHAPE[file]) {
        const n = META_SHAPE[file](v);
        if (n.bad) {
            report("turn", "meta.repair", `${file} ${typeof v}`);
            await wput(id, file.replace(/\.json$/, ".bak.json"), r).catch(() => { });
            await wput(id, file, JSON.stringify(n.v)).catch(() => { });
        }
        return n.v;
    }
    return v;
}
// 준비 파일 꼴(#229 보정 3 — BizCrush: AI가 bundles.json을 객체로 써서 매 턴 "준비하다 멈췄어요" · find is not a function): 앱이 읽는 .dynapse/*.json은 꼴을 맞춰 읽는다.
// 맨 위 꼴이 틀리면(배열 자리에 객체 등) 원본은 *.bak.json으로 두고(pages.json은 readPages가 따로 — 오류 본문은 '차례 없음'으로) 맞춘 판으로 고쳐 쓴다(같은 오류가 다음 턴에 또 나지 않게). 항목 하나가 틀린 건 읽을 때만 걸러낸다
const strs = (x) => (Array.isArray(x) ? x.filter((y) => typeof y === "string") : []);
const arrOf = (v, keys) => (Array.isArray(v) ? v : v && typeof v === "object" ? keys.map(k => v[k]).find(Array.isArray) : undefined);
const META_SHAPE = {
    ".dynapse/bundles.json": v => {
        const a = arrOf(v, ["bundles", "groups", "items"]) ?? (v && typeof v === "object" && !Array.isArray(v) ? Object.entries(v).filter(([, p]) => Array.isArray(p)).map(([name, pages]) => ({ name, pages })) : []);
        return { v: a.filter(b => b && typeof b.name === "string").map(b => ({ name: b.name, pages: strs(b.pages) })), bad: !Array.isArray(v) };
    },
    ".dynapse/appendix.json": v => ({ v: strs(arrOf(v, ["pages", "appendix", "files"])), bad: !Array.isArray(v) }),
    ".dynapse/photo-requests.json": v => ({ v: (arrOf(v, ["requests", "photos", "items"]) ?? []).filter(x => x && typeof x === "object" && !Array.isArray(x)), bad: !Array.isArray(v) }),
    ".dynapse/review.json": v => { const it = arrOf(v, ["items"]) ?? []; return { v: { ...(v && typeof v === "object" && !Array.isArray(v) ? v : {}), items: it.filter(x => x && typeof x === "object") }, bad: !!v && (Array.isArray(v) || !Array.isArray(v.items)) }; },
};
// 준비 실패 뒤(#229 보정 3) — 알려진 준비 파일을 모두 한 번 읽어 고친다(읽기 = 고치기)
async function repairMeta(id) { for (const f of Object.keys(META_SHAPE))
    await readJson(id, f).catch(() => null); }
// 장 차례(.dynapse/pages.json) 읽기(#170) — 배열 또는 {pages:[…]}만 받는다. 그 밖(받기가 서버의 오류 본문 {"error":…}을 이 파일로 쓴 경우 등)은 없는 것으로(null) — 부르는 쪽이 파일 목록으로 대신한다
export async function readPages(id) { const j = await readJson(id, ".dynapse/pages.json"); const a = Array.isArray(j) ? j : Array.isArray(j?.pages) ? j.pages : null; return a ? a.filter((x) => typeof x === "string") : null; }
export const summaryLines = (t) => {
    if (!t)
        return undefined;
    const after = t.split(/바뀐 것\s*[:：]/)[1] ?? t;
    const ls = after.split("\n").map(l => l.replace(/^[\s\-*•\d.)]+/, "").trim()).filter(l => l && !/^verify/i.test(l)).slice(0, 3).map(l => l.slice(0, 140));
    return ls.length ? ls : undefined;
};
// 검증 스크립트 — hub가 배포(skills/verify.mjs), 앱이 받아 두고 작업 폴더 .dynapse/verify.mjs로 넣는다
export let verifyCache = null;
let verifyAt = 0;
// 검사기 깔기 — 깔았으면 true(#173 보정 1: 앱 파일 목록은 .dynapse 아래 .json만 보여 "있나"를 목록으로 볼 수 없다 — 이 결과를 믿는다)
export async function ensureVerify(id) {
    if (!verifyCache || Date.now() - verifyAt > 600_000) { // 10분마다 다시 확인(#54 D18)
        verifyAt = Date.now();
        const r = await http("GET", `${HUB}/skills/verify.mjs`).catch(() => null);
        if (r?.status === 200 && r.body.includes("dynapse-verify")) {
            if (r.body !== verifyCache) {
                verifyCache = r.body;
                await store.set("verify_mjs", r.body);
                await store.save();
            }
        }
        else
            verifyCache ??= (await store.get("verify_mjs")) ?? null;
    }
    if (!verifyCache)
        return false;
    return await wput(id, ".dynapse/verify.mjs", verifyCache).then(() => true).catch(() => false);
}
// 앱의 독립 검증 — node가 있으면 같은 스크립트, 없으면 앱 안의 최소 L0(파일·빈 파일·외부 URL·section). 렌더 사진은 node 경로에서만
// 글꼴이 못 그리는 글자(#48 F) — 페이지의 글꼴 블록(제목·본문)과 글자를 앱이 대조(이 PC 글꼴 · 받아 둔 웹폰트 TTF). 경고만
const TITLE_RE = /<(h1|h2|h3)\b[^>]*>([\s\S]*?)<\/\1>|<(\w+)\b[^>]*data-slot\s*=\s*["'](?:product_name|section_title|title|headline|[\w]+_title)["'][^>]*>([\s\S]*?)<\/\3>/gi;
const textOf = (h) => h.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ");
async function fontRef(block, role) {
    const id = block.match(new RegExp(`data-${role}="([^"]+)"`))?.[1] ?? "";
    if (id.startsWith("local:"))
        return { family: id.slice(6), name: id.slice(6) };
    const name = block.match(new RegExp(`--typography-font-family-${role}:\\s*'?([^',;]+)`))?.[1]?.trim();
    if (!name || /pretendard/i.test(name))
        return null; // Pretendard는 한글 전체
    const dir = await T().core.invoke("font_cache_dir").catch(() => null);
    if (!dir)
        return null;
    const file = `${dir}/${name.replace(/[^a-z0-9]+/gi, "-")}.ttf`;
    const have = fontHave.has(file) || await exec("curl", ["-sI", `file:///${file.replace(/\\/g, "/").replace(/^\//, "")}`]).then(r => Number(r.stdout.match(/content-length:\s*(\d+)/i)?.[1] ?? 0) > 1000).catch(() => false); // 받아 둔 것이 있으면 다시 받지 않는다
    if (!have) {
        const css = await http("GET", `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, "+")}`).catch(() => null);
        const url = css?.status === 200 ? css.body.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.ttf)\)/)?.[1] : null;
        if (!url || (await http("GET", url, { out: file }).catch(() => null))?.status !== 200)
            return null;
    }
    fontHave.add(file);
    return { file, name };
}
// 글리프 검사 캐시(#54 B7) — 받아 둔 폰트 파일 · (장 글자 + 글꼴 블록)이 같으면 지난 결과 그대로(사진만 바뀐 턴·재검사에서 폰트 파싱 없음)
const fontHave = new Set();
const glyphMemo = new Map();
async function glyphWarnings(id, pages) {
    const names = pages ?? (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(f => /^result-[a-z0-9-]+\.html$/.test(f));
    const out = [];
    for (const page of names) {
        const h = await wget(id, page);
        if (!h)
            continue;
        const block = h.match(/<style\b[^>]*\bdata-fonts\b[^>]*>[\s\S]*?<\/style>/i)?.[0];
        if (!block)
            continue;
        const titles = [...h.matchAll(TITLE_RE)].map(m => textOf(m[2] ?? m[4] ?? "")).join(" ");
        const all = textOf(h.replace(/<style\b[\s\S]*?<\/style>/gi, ""));
        const key = `${id}|${page}|${reqHash(block)}${reqHash(titles)}${reqHash(all)}${all.length}`;
        const memo = glyphMemo.get(key);
        if (memo) {
            out.push(...memo);
            continue;
        }
        const mark = out.length;
        for (const [role, text, label] of [["display", titles, "제목"], ["body", all, "본문"]]) {
            const f = await fontRef(block, role).catch(() => null);
            if (!f || !text.trim())
                continue;
            const [miss] = await T().core.invoke("glyph_missing", { reqs: [{ family: f.family ?? null, file: f.file ?? null, text }] }).catch(() => [""]);
            // 한글·한자·가나만 센다(#267 보정 1 — 검사의 78%에 걸렸다: 기호·문장부호·라틴은 브라우저가 다음 글꼴로 그려 깨지지 않는다). 그 밖은 로그만
            const cjk = [...(miss ?? "")].filter(ch => /[\uAC00-\uD7A3\u3131-\u318E\u4E00-\u9FFF\u3040-\u30FF]/.test(ch));
            if (cjk.length)
                out.push({ page, rule: "glyph", msg: `'${cjk.slice(0, 3).join("")}' ${cjk.length}자를 ${label} 폰트(${f.name})가 못 그려요 · 글꼴 패널에서 바꿔 주세요` });
        }
        if (glyphMemo.size > 400)
            glyphMemo.clear();
        glyphMemo.set(key, out.slice(mark));
    }
    return out;
}
// 📍 경계 검사(#193) — 시작 판(.dynapse/out/bound-before.html, <base>로 같은 자료)과 지금 장을 verify --tidboxes로 같이 그려 상자·글 비교. 못 재면 null(막지 않는다)
async function boundCheck(id, b, start) {
    const B = await import("./bound.js");
    await wput(id, ".dynapse/out/bound-before.html", B.withBase(start));
    await ensureVerify(id);
    const dir = await T().core.invoke("work_dir", { id }).catch(() => null);
    if (!dir)
        return null;
    const r = await verifyExec(id, ["--tidboxes", ".dynapse/out/bound-before.html", b.file], dir).catch(() => null);
    let j = null;
    try {
        j = JSON.parse(String(r?.stdout ?? "").trim().split("\n").at(-1) ?? "null");
    }
    catch {
        j = null;
    }
    if (!j?.ok || !j.boxes)
        return null;
    return B.violations(j.boxes[".dynapse/out/bound-before.html"] ?? {}, j.boxes[b.file] ?? {}, B.exemptKeys(start, b.sels));
}
// 넘침 먼저 맞추기(#193 ③) — 📍 요소의 넘침·줄바꿈 불만이면 verify의 맞춤(글자 −1px·폭·줄 묶기)으로 그 장을 고치고, 넘침이 없어졌으면 AI 없이 저장. 그래도 넘치면 false(AI 턴으로)
// 빈 공간 채우기(#235) — 장을 그려 띠 지도(제목·본문 덩이·바닥, 빈 띠 px)를 먼저. 본문이 띠의 70% 미만이거나 빈 띠가 8%를 넘으면 앱이 결정적으로 채운다(AI 0):
// 장 세로 flex · 본문 flex:1 · 안쪽 격자 행 1fr · 남는 띠 40px 이하 → <style data-fill>로 장에 쓴다. 못 채우면 띠 지도를 AI 턴 머리에 싣는다
export const FILL_WORDS = /빈\s*공간|빈\s*자리|빈\s*칸|비어\s*(있|보)|비는데|비어요|공간이\s*(남|비)|여백이\s*(많|커|남)|배치\s*다시|꽉\s*채워|채워\s*줘|위가\s*비|아래(\s*칸)?(이|가)?\s*비|위아래\s*(조금\s*)?넉넉|empty space|fill the (space|page)/i; // "아래 칸이 비는데"·"위아래 조금 넉넉하게"(#262 보정 1)
export async function bandsOf(id, file) {
    await ensureVerify(id);
    const dir = await T().core.invoke("work_dir", { id }).catch(() => null);
    if (!dir)
        return null;
    const r = await verifyExec(id, ["--tidboxes", "--bands", file], dir).catch(() => null);
    try {
        const j = JSON.parse(String(r?.stdout ?? "").trim().split("\n").at(-1) ?? "null");
        const b = j?.ok ? j.boxes?.[file] : null;
        return b && b.before ? b : null;
    }
    catch {
        return null;
    }
}
export async function fillFirst(id, file) {
    const b = await bandsOf(id, file).catch(() => null);
    if (!b)
        return { done: false, head: "" };
    const pct = (n) => Math.round(n / b.H * 100), lim = b.H * 0.08;
    if (b.before.top <= lim && b.before.bottom <= lim && b.before.content >= b.before.band * 0.7 && !b.inner)
        return { done: false, head: "" };
    if (b.ok && b.css) {
        const h = await wget(id, file).catch(() => null);
        if (!h)
            return { done: false, head: "" };
        const blk = `<style data-fill>${b.css}</style>`, out = /<style\b[^>]*\bdata-fill\b[^>]*>[\s\S]*?<\/style>/i.test(h) ? h.replace(/<style\b[^>]*\bdata-fill\b[^>]*>[\s\S]*?<\/style>/i, blk) : h.replace(/<\/head>/i, `${blk}\n</head>`);
        await wput(id, file, out);
        await repoCommit(id, `빈 공간 채움 · ${pageLabel(file)}`);
        void afterSave(id);
        report("turn", "fill.app", `top=${b.before.top}->${b.after.top} bottom=${b.before.bottom}->${b.after.bottom}`);
        await postChat(id, [{ role: "event", text: b.inner ? `빈 아래를 채웠어요 · ${b.inner.before}→${b.inner.after}px · 고정 높이를 풀고 줄을 고르게 · 글자 크기 그대로 · AI 없이 · 되돌리기 ⌘Z` : `빈 공간을 채웠어요 · 위 ${b.before.top}→${b.after.top}px · 아래 ${b.before.bottom}→${b.after.bottom}px · AI 없이 · 되돌리기 ⌘Z`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
        return { done: true, head: "" };
    }
    report("turn", "fill.ai", `top=${b.before.top} bottom=${b.before.bottom}${b.inner ? ` inner=${b.inner.before}->${b.inner.after}` : ""}`);
    // 앱이 못 채운 안쪽 빈 아래(#262 보정 1 ③) — 측정값과 바꿀 선택자를 그대로 넣는다. 글자 크기 변경 금지 문장은 반드시
    if (b.inner)
        return { done: false, head: `[The bottom ${b.inner.after}px of the ${b.H}px page is empty inside the content block. Fixed px heights inside a flex:1 column cause it; the app tried: ${b.inner.css.slice(0, 600) || "(no fixed-height box found)"}. Make the boxes fill the column (flex:1 with the old height as min-height) and spread the rows of the other column (justify-content:space-between). Do not change font sizes.]\n` };
    return { done: false, head: `[Band map of ${file} (page ${b.H}px tall): title→content gap ${b.before.top}px (${pct(b.before.top)}%), content→footer gap ${b.before.bottom}px (${pct(b.before.bottom)}%), content block ${b.before.content}px of the ${b.before.band}px band. Make the content block fill the band between title and footer (gaps ≤ ${Math.round(lim)}px); do not change page size, format or frame margins.]\n` };
}
export async function fitFirst(id, file) {
    const v = await appVerify(id, [file], { noRender: false }).catch(() => null);
    if (!v || v.errors.some(e => e.page === file && /^(overflow|overflow_x)$/.test(e.rule)))
        return false;
    const ch = S.git ? await T().core.invoke("repo_changed", { id }).catch(() => []) : [];
    if (!ch.includes(file))
        return false; // 고칠 게 없었다 — 사용자가 본 문제는 AI에게
    await repoCommit(id, `넘친 글 맞춤 · ${pageLabel(file)}`);
    void afterSave(id);
    await postChat(id, [{ role: "event", text: "넘친 글을 칸에 맞췄어요 · AI 없이 · 되돌리기 ⌘Z", payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
    report("turn", "bound.fit_first", "ok");
    return true;
}
export async function appVerify(id, pages, o = {}) {
    const v = await appVerify0(id, pages, o.noRender, o.reward, o.board);
    const g = await glyphWarnings(id, pages).catch(() => []);
    const out = g.length ? { ...v, warnings: [...(v.warnings ?? []), ...g] } : v;
    void postChecks(id, out, pages, !!o.noRender).catch(() => { });
    // 줄 맞춤(#125) — verify가 고친 곳 수(턴의 사용량 카드 "줄 맞춤 N곳")
    const fit = v.fit;
    if (fit)
        fitCount.set(id, Object.values(fit).reduce((a, n) => a + (Number(n) || 0), 0));
    return out;
}
const fitCount = new Map();
// 장 순서(#97) — 순서의 주인은 앱. 턴 끝마다(그리고 장 띠에서 끌었을 때) .dynapse/pages.json을 정리한다: 있는 파일만(AI·사용자가 쓴 순서 유지) + 목록에 없는 새 파일은
// 이름의 숫자 접두 자리에(03b는 03 뒤) · 부록(.dynapse/appendix.json)은 맨 뒤. 그 순서로 모든 장의 page_no("03 / 13")를 다시 쓴다. AI 호출 0
const orderKey = (f) => { const m = f.match(/^result-(?:card-)?(\d+)([a-z]?)/); if (m)
    return Number(m[1]) + (m[2] ? (m[2].charCodeAt(0) - 96) / 100 : 0); return f === "result-cover.html" ? -1 : f === "result-closing.html" ? 1e6 : null; };
const orderUnlock = new Set(), orderRestored = new Set();
// 순서 요청 턴(#139 A) — 턴 시작 순서 · 엄격하게 다시 했는지. 턴 끝에 pages.json이 그대로면 한 번 다시, 그다음엔 묻는 줄
const orderAsk = new Map();
// 할 일 목록 대조(C4 B ③) — 장을 대고 말한 AI 할 일이 턴 끝에 그 장을 하나도 안 바꿨으면 한 번 이어서(Claude), 아니면 "못 함" 한 줄
const todoAsk = new Map();
// 빠진 사실(#302 B) — 물은 빈칸·받은 값·[나중에]. brief.md에 받은 사실·남은 빈칸을 적어 AI가 바뀌어도(세션 한도·GPT) 같은 답
// 마지막 요청(C5 ⑤) — 한도·AI 전환 때 그대로 다른 AI로
const lastReq = new Map();
const FACTS = ".dynapse/facts.json";
async function writeFactsBrief(id, got, left, told) {
    const all = [...Object.entries(got).map(([k, v]) => `- ${k}: ${v}`), ...(told ?? []).map(x => `- ${x.kind}: ${x.value}`)];
    const cur = (await wget(id, ".dynapse/brief.md").catch(() => null)) ?? "", sec = `## 받은 사실 · 남은 빈칸(앱이 관리 — 산문으로 다시 묻지 않는다)\n${[...new Set(all)].join("\n") || "- (없음)"}\n- 남은 [빈칸]: ${left}개 — 앱 카드로 받는다\n`;
    const out = /## 받은 사실 · 남은 빈칸/.test(cur) ? cur.replace(/## 받은 사실 · 남은 빈칸[\s\S]*?(?=\n## |$)/, sec.trimEnd()) : `${cur.trimEnd()}${cur ? "\n\n" : ""}${sec}`;
    await wput(id, ".dynapse/brief.md", out).catch(() => { });
}
// 묶음·부록까지 한 덩어리로 비교(#139 §2)
const groupsOf = async (id) => JSON.stringify([(await readJson(id, BUNDLES).catch(() => null)) ?? [], (await readJson(id, ".dynapse/appendix.json").catch(() => null)) ?? []]);
const DIFF_FEEL = /다른\s*(느낌|스타일|톤|디자인)|폴더\s*디자인\s*(말고|빼|끄)|새\s*스타일로/;
export async function folderDesign(folder, exclude) {
    const r = await api("GET", "/api/works").catch(() => null);
    const rows = r?.data?.works ?? [], pin = rows.find(w => w.id === folder)?.meta?.design_from;
    const cands = rows.filter(w => w.meta?.folder === folder && w.id !== exclude);
    let best = null;
    for (const w of cands.slice(0, 30)) {
        const files = (await T().core.invoke("work_files", { id: w.id }).catch(() => [])).map(x => x.name), n = files.filter(x => PAGE_RE.test(x)).length;
        if (n < 2)
            continue;
        const rounds = ((await readJson(w.id, ".dynapse/TRACE.json").catch(() => null))?.rounds ?? []).length, hand = ((await readJson(w.id, ".dynapse/hand-edits.json").catch(() => null)) ?? []).length;
        const score = w.id === pin ? 1e6 : rounds * 2 + hand + (w.taskState === "accepted" ? 20 : 0) + Math.min(n, 20) / 10;
        if (!best || score > best.score)
            best = { id: w.id, title: String(w.title ?? ""), score };
    }
    if (!best)
        return null;
    const id = best.id, order = ((await readPages(id).catch(() => null)) ?? []).filter(x => PAGE_RE.test(x));
    const pages = order.length ? order : (await T().core.invoke("work_files", { id }).catch(() => [])).map(x => x.name).filter(x => PAGE_RE.test(x)).sort();
    const h0 = (await wget(id, pages[0] ?? "").catch(() => null)) ?? "";
    const htmls = await Promise.all(pages.slice(0, 6).map(p => wget(id, p).catch(() => null).then(x => x ?? "")));
    const tokens = await readTokens(id).catch(() => null);
    const plan = (await readJson(id, ".dynapse/plan.json").catch(() => null))?.pages ?? [];
    const forms = [...new Set(plan.filter(p => p.role !== "cover" && p.form).map(p => String(p.form)))].slice(0, 8);
    const fp = await readJson(id, ".dynapse/font-pair.json").catch(() => null);
    const pairAttr = h0.match(/<style\b[^>]*\bdata-fonts\b[^>]*\bdata-pair\s*=\s*["']([\w-]+)["']/i)?.[1] ?? fp?.id ?? null;
    const motifEl = h0.match(/<([a-z0-9]+)\b[^>]*\bdata-motif\b[^>]*>/i)?.[0] ?? null;
    const d = { from: id, title: best.title, at: Date.now(), kind: /\.slide(?:\[[^\]]*\])*\s*\{[^}]*?\bwidth\s*:\s*1080px/.test(h0) ? "cards" : "slides", pair: pairAttr, pairName: fp?.name ?? null,
        accent: ((tokens ?? h0).match(/--color-semantic-accent-base\s*:\s*(#[0-9a-f]{3,8})/i)?.[1]) ?? null, motif: motifEl ? (motifEl.match(/data-slot\s*=\s*["']([\w-]+)/)?.[1] ?? motifEl.match(/class\s*=\s*["']([\w-]+)/)?.[1] ?? "motif") : null,
        treat: (await readJson(id, ".dynapse/photo-treat.json").catch(() => null))?.treat ?? null,
        cover: plan.find(p => p.role === "cover")?.form ?? null, forms,
        titles: htmls.map(h => titleOf(h)).filter(Boolean).slice(0, 3),
        bodies: htmls.map(h => (h.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).filter(x => x.length > 8).slice(0, 2).map(x => x.slice(0, 90)),
        tokens: tokens && tokens.length < 60_000 ? tokens : null };
    await wput(folder, ".dynapse/folder-design.json", JSON.stringify(d)).catch(() => { });
    const line = [d.pairName ?? d.pair, d.accent ? `강조 ${d.accent}` : "", d.cover ? `표지 ${d.cover}` : "", d.motif ? `모티프 ${d.motif}` : ""].filter(Boolean).join(" · ");
    void api("POST", `/api/works/${encodeURIComponent(folder)}/design`, { line, from: id, title: d.title }).catch(() => null);
    return d;
}
const folderDesignHead = (d, kind) => `[This folder's design system (from the folder's most-worked deck "${d.title}"): tokens.css is already in this work — use it as-is, never rewrite it. The app sets the same font pair${d.pairName ? ` (${d.pairName})` : ""} after your turn.${d.accent ? ` Accent ${d.accent}.` : ""}${d.motif ? ` Motif: put the deck motif (${d.motif}) on every page as that deck does.` : ""}${d.cover && (!kind || kind === d.kind) ? ` Cover grammar: ${d.cover}.` : ""}${d.forms.length && (!kind || kind === d.kind) ? ` Pick page forms from this list first: ${d.forms.join(", ")}.` : ""}${d.titles.length ? ` Match the copy tone of these titles: ${d.titles.map(t => `"${t}"`).join(" · ")}` : ""}${d.bodies.length ? ` and body lines: ${d.bodies.map(t => `"${t}"`).join(" · ")}` : ""}. Keep this look unless the user asks for a different feel.]\n`;
// ── 큰 덱(#140) ── AI는 덱 전체를 읽지 않는다. 개요(.dynapse/outline.json, 장마다 한 줄)로 구조를, 묶음(≤15장) 턴으로 내용을. 덱 전체 내용 요청은 묶음별로 줄 세운다(.dynapse/queue.json)
export const BIG_DECK = 40;
// 시험 고리(__DYN_SIM_SEND__ — sync-sim·turn-sim만 넣는다). 운영에서는 없음 = 늘 chatSend. 묶음 큐와 보통 요청의 마지막 보내기가 여기를 지난다
const simOrSend = () => globalThis.__DYN_SIM_SEND__ ?? chatSend;
const DECK_STRUCT = /순서|흐름|구조|묶어|묶음|부록|빼|없애|중복|빈\s*자리|정리|다시\s*넣|reorder|structure|duplicate|remove/i;
const REVIEW_ASK = /검토|점검|봐\s*줘|봐\s*주|살펴|이상한\s*(데|곳)|고칠\s*(데|곳)|review|check/i;
// 고치라는 말(#229 보정 2 — BizCrush 40장+: "2027년 목표로 바꿔 … 검토"가 찾기 턴으로 가 review.json만, 제목은 그대로 2028년): 같은 메시지에 이게 있으면 찾기 턴이 아니라 고치는 턴
export const EDIT_ASK = /바꿔|바꾸|고쳐|수정|넣어|빼\s*(줘|고|서)?|지워|추가|삭제|옮겨|키워|줄여|늘려|(으)?로\s*해|\d{4}\s*년|["'“‘「][^"'”’」]{1,40}["'”’」]|\b(change|fix|edit|replace|remove|add|delete|move)\b/i;
export const pureReview = (t) => REVIEW_ASK.test(t) && !EDIT_ASK.test(t);
const FIX_ALL = /^(다\s*|전부\s*|셋\s*다\s*|모두\s*)?고쳐(\s*줘|\s*주세요)?[\s.!~요]*$/; // 찾기 목록 뒤 짧은 "고쳐" = [전부 고치기]
const CHUNK = 15, OUTLINE = ".dynapse/outline.json", QUEUE = ".dynapse/queue.json";
// 개요 — 순서(본편·묶음·부록) 그대로 한 줄씩. 장 파일의 수정 시각이 같으면 지난 줄을 그대로(장 220개도 바뀐 장만 읽는다)
export async function writeOutline(id) {
    const files = await T().core.invoke("work_files", { id }).catch(() => []);
    const mt = new Map(files.map(f => [f.name, f.mtime ?? 0]));
    const bs = await bundlesOf(id), prev = new Map(((await readJson(id, OUTLINE).catch(() => null)) ?? []).map(x => [x.file, x]));
    const tags = (await readJson(id, ".dynapse/tags.json").catch(() => null)) ?? {};
    const out = [];
    for (const b of bs)
        for (const file of b.pages) {
            if (!mt.has(file))
                continue;
            const p = prev.get(file), m = mt.get(file) ?? 0;
            if (p && p.m === m && p.bundle === b.name) {
                out.push({ ...p, tag: (tags[file] ?? []).slice(0, 3).join("·") || p.tag });
                continue;
            }
            const h = (await wget(id, file).catch(() => null)) ?? "";
            const body = h.replace(/<(script|style|svg)\b[\s\S]*?<\/\1\s*>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
            const num = h.match(/<[^>]*\bdata-slot\s*=\s*["'][^"']*(?:number|stat|value|big)[^"']*["'][^>]*>([^<]{1,30})</i)?.[1]?.trim();
            const hero = num ? `숫자 ${num}` : /<img\b/i.test(h) ? "사진" : /\bdata-viz\b/.test(h) ? "차트" : "";
            out.push({ file, title: titleOf(h) || pageLabel(file), tag: (tags[file] ?? []).slice(0, 3).join("·"), hero, bundle: b.name, words: body ? body.split(" ").length : 0, m });
        }
    if (JSON.stringify(out) !== JSON.stringify([...prev.values()]))
        await wput(id, OUTLINE, JSON.stringify(out)).catch(() => { });
    return out;
}
// 큰 덱 안내(#140 §6) — 덱 범위 요청 때 작업마다 한 번
async function bigDeckNotice(id, n) {
    const k = `bignote:${id}`;
    if (await store.get(k).catch(() => null))
        return;
    await store.set(k, true).catch(() => { });
    await postChat(id, [{ role: "event", text: `이 덱은 ${n}장이라 묶음 단위로 고쳐요 · 순서·흐름은 개요로 한 번에 · 전체 요청은 줄 세워 돌리고 중간에 멈출 수 있어요`, payload: { kind: "stage", ai: "dynapse", big: n } }]).catch(() => { });
}
const pendingQueue = new Map(); // 개요 턴이 적은 묶음 일(turn.json "queue") — 그 턴이 끝나면 큐로
const eta = (q) => { const d = q.items.filter(x => x.state === "done" && x.ms), left = q.items.filter(x => x.state === "wait").length; if (!d.length || !left)
    return ""; const m = Math.max(1, Math.round(d.reduce((t, x) => t + (x.ms ?? 0), 0) / d.length * left / 60_000)); return ` · 남은 시간 ≈ ${m}분`; };
// 덱 전체 내용 요청 → 묶음별 항목(부록 빼고, 큰 묶음은 15장씩). 거부하지 않고 쪼갠다
export async function startQueue(id, ask, route, only) {
    const items = [];
    if (only?.length) {
        const bs = await bundlesOf(id), order = bs.flatMap(b => b.pages);
        for (const o of only.slice(0, 40)) {
            const pages = o.pages?.filter(f => order.includes(f)) ?? bs.find(b => b.name === o.bundle)?.pages ?? [];
            for (let i = 0; i < pages.length; i += CHUNK)
                items.push({ name: `${o.bundle ?? pages[0]}${pages.length > CHUNK ? ` ${i / CHUNK + 1}/${Math.ceil(pages.length / CHUNK)}` : ""}`, pages: pages.slice(i, i + CHUNK), state: "wait", ...(o.ask ? { ask: String(o.ask).slice(0, 500) } : {}) });
        }
    }
    else
        for (const b of (await bundlesOf(id)).filter(x => x.name !== "부록"))
            for (let i = 0; i < b.pages.length; i += CHUNK) {
                const k = Math.ceil(b.pages.length / CHUNK);
                items.push({ name: k > 1 ? `${b.name} ${i / CHUNK + 1}/${k}` : b.name, pages: b.pages.slice(i, i + CHUNK), state: "wait" });
            }
    if (!items.length)
        return false;
    await writeOutline(id).catch(() => null);
    await wput(id, QUEUE, JSON.stringify({ ask: ask.slice(0, 2000), items, paused: false, at: Date.now(), ...(route ? { route } : {}) }));
    await postChat(id, [{ role: "event", text: `${items.length}묶음으로 나눠 차례로 해요 · 첫 묶음부터`, payload: { kind: "queue", ai: "dynapse", total: items.length, done: 0, paused: false } }]).catch(() => { });
    report("turn", "queue.start", `items=${items.length}`);
    await queueNext(id);
    return true;
}
export async function queueNext(id) {
    const q = await readJson(id, QUEUE).catch(() => null);
    if (!q?.items?.length || q.paused)
        return;
    if (q.items.some(x => x.state === "run"))
        return;
    const i = q.items.findIndex(x => x.state === "wait"), n = q.items.length;
    if (i < 0) {
        const bad = q.items.filter(x => x.state === "fail").length;
        await postChat(id, [{ role: "event", text: `전체 끝 · 묶음 ${n}개${bad ? ` · 못 한 묶음 ${bad}개([다시])` : ""}`, payload: { kind: "queue", ai: "dynapse", total: n, done: n - bad, end: true, failed: bad } }]).catch(() => { });
        report("turn", "queue.end", `items=${n} fail=${bad} tok=${q.items.reduce((t, x) => t + (x.tok ?? 0), 0)}`);
        await wput(id, QUEUE, JSON.stringify({ ...q, end: Date.now() })).catch(() => { });
        return;
    }
    // 이 작업에 AI 턴이 돌고 있으면 10초 뒤 다시(간격 10초 · 중단 = 그 턴이 끝나 finishTurn이 다음을 부르면 · 큐가 있을 때만, 하루 수십 번)
    if (sessions.get(id)?.busy) {
        setTimeout(() => void queueNext(id), 10_000);
        return;
    }
    const it = q.items[i];
    it.state = "run";
    await wput(id, QUEUE, JSON.stringify(q)).catch(() => { });
    await postChat(id, [{ role: "event", text: `묶음 ${i + 1}/${n} 고치는 중 · ${it.name} ${it.pages.length}장${eta(q)}`, payload: { kind: "queue", ai: "dynapse", total: n, done: q.items.filter(x => x.state === "done").length, at: i, paused: false } }]).catch(() => { });
    const prompt = `[Bundle ${i + 1}/${n} "${it.name}" of a ${q.items.reduce((t, x) => t + x.pages.length, 0)}-page deck. Edit ONLY these pages: ${it.pages.join(", ")}. Do not open, read or edit any other page; .dynapse/outline.json has one line per page if you need the deck's context. Do not reorder, add or remove pages. Apply the request below to these pages only; keep each page's layout unless the request asks otherwise. Reply in one or two Korean lines.]\n${it.ask ? `${it.ask}\n(Whole request: ${q.ask})` : q.ask}`;
    await simOrSend()(id, prompt, { scope: "page", queueItem: i, raw: q.ask, ...(q.route ? { route: q.route } : {}) });
}
export async function queueAfter(id, i, ok, tok, ms) {
    const q = await readJson(id, QUEUE).catch(() => null);
    const it = q?.items?.[i];
    if (!q || !it)
        return;
    it.state = ok ? "done" : "fail";
    it.tok = tok;
    it.ms = ms;
    await wput(id, QUEUE, JSON.stringify(q)).catch(() => { });
    report("turn", "queue.item", `i=${i} ok=${ok} tok=${tok} pages=${it.pages.length}`);
    if (!q.paused)
        await queueNext(id);
}
// 큰 덱 만들기(#140 §3) — "200장 덱"처럼 40장 넘게 새로 만들 때: ① 가벼운 턴이 개요만(.dynapse/outline-plan.json) ② 앱이 제목만 든 자리 장을 만들어 띠에 보이고 ③ [만들기 시작]이 묶음별 생성 큐
export const planTurn = new Set();
// 판형(#145) — 장 크기(웹 lib/frame.ts FRAMES와 같은 값). [w, h, AI에 쓰는 이름, 사용자 이름]
const FRAME_PX = { slide: [1600, 900, "16:9 slides", "발표 16:9"], card45: [1080, 1350, "4:5 card news", "카드뉴스"], card: [1080, 1080, "1:1 square cards", "카드 1:1"], a4: [794, 1123, "A4 portrait document page", "A4"], detail: [860, 1200, "860-wide product detail page", "상세페이지"] };
export const frameTurn = new Map(); // 판형 바꾸기 턴 → 턴 카드 첫 이름("A4 판")   // 큰 덱 개요 턴(#140 §3) — turn-sim도 읽는다
const CARDS_WORDS = /카드\s*뉴스|cardnews|인스타|instagram/i;
const BIG_MAKE = /(\d{2,3})\s*(장|페이지|쪽|p\b|pages?|slides?)/i;
export async function bigPlanHead(id, text) {
    const n = Number(text.match(BIG_MAKE)?.[1] ?? 0);
    if (!(n > BIG_DECK && n <= 400))
        return "";
    const have = (await T().core.invoke("work_files", { id }).catch(() => [])).filter(f => PAGE_RE.test(f.name)).length;
    if (have > 3)
        return "";
    planTurn.add(id);
    return `[Big deck — ${n} pages. Plan first, build later: in this turn do not create any result-*.html page. Write .dynapse/outline-plan.json = [{"file":"result-p001.html","title":"the page's claim, one sentence","tag":"role or kind","hero":"its one piece of evidence","bundle":"section name"}] with exactly ${n} entries, files numbered result-p001 … in order, grouped into 8–20 bundles of at most 15 pages (sections of the story). Use the user's facts only; mark unknown numbers as "(확인 필요)". Reply in Korean in two lines: the sections and what you need from the user. The app shows the outline as pages and builds them bundle by bundle when the user says so.]\n`;
}
const stubPage = (title, no, n) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>.slide{width:1600px;height:900px;display:flex;flex-direction:column;justify-content:center;padding:96px;box-sizing:border-box;font-family:Pretendard,sans-serif;background:#fafafa;color:#555}.slide h2{font-size:48px;margin:0}</style></head><body><section class="slide" data-stub="1" data-layout="free"><h2 data-slot="title">${title.replace(/[<>&]/g, "")}</h2><div data-slot="page_no">${String(no).padStart(2, "0")} / ${String(n).padStart(2, "0")}</div></section></body></html>\n`;
// 찾기 턴(#140 추가 1) — 큰 덱의 "검토해 줘"는 고치지 않고 고칠 곳을 찾는다. 앱이 신호로 장을 골라(≤15) 개요와 그 장만 읽게 하고, 결과는 .dynapse/review.json 목록
const reviewTurn = new Set();
export async function reviewHead(id, text, only) {
    const ol = await writeOutline(id), n = ol.length;
    const errs = (await readJson(id, ".dynapse/last-errors.json").catch(() => null)) ?? {};
    const st = (await readJson(id, ".dynapse/lang-status.json").catch(() => null))?.stale ?? {};
    const stale = new Set(Object.values(st).flat());
    const dup = new Map();
    for (const x of ol)
        if (x.title.length >= 4)
            dup.set(x.title, [...(dup.get(x.title) ?? []), x.file]);
    const dupF = new Set([...dup.values()].filter(v => v.length > 1).flat());
    const ms = ol.map(x => x.m ?? 0).sort((a, b) => a - b), old = ms[Math.floor(ms.length * 0.2)] ?? 0;
    const pool = only ? ol.filter(x => x.bundle === only) : ol;
    const score = (x) => (errs[x.file]?.length ?? 0) * 3 + (stale.has(x.file) ? 2 : 0) + (dupF.has(x.file) ? 2 : 0) + (!x.hero ? 1 : 0) + ((x.m ?? 0) <= old ? 1 : 0) + (x.words < 8 ? 1 : 0);
    const sample = pool.map((x, i) => ({ x, s: score(x), i })).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, 15).sort((a, b) => a.i - b.i).map(o => o.x.file);
    const sig = [Object.keys(errs).length ? `check errors: ${Object.entries(errs).slice(0, 12).map(([f, r]) => `${f} (${r.slice(0, 3).join(", ")})`).join("; ")}` : "",
        stale.size ? `untranslated editions of: ${[...stale].slice(0, 10).join(", ")}` : "",
        dupF.size ? `duplicate titles: ${[...dup.entries()].filter(([, v]) => v.length > 1).slice(0, 6).map(([t, v]) => `"${t.slice(0, 24)}" ${v.join("/")}`).join("; ")}` : ""].filter(Boolean).join(" · ");
    reviewTurn.add(id);
    return `[Review request on a ${n}-page deck${only ? ` — bundle "${only}" only` : ""}: find what to fix, do not fix it. Do not edit any page. Read .dynapse/outline.json (one line per page) and only these pages the app picked by its signals: ${sample.join(", ")}.${sig ? ` App signals: ${sig}.` : ""} Use the user's criteria if the request names any. Write .dynapse/review.json = {"items":[{"file":"result-….html","where":"slot name or the sentence","what":"what to change","why":"why","severity":"high|mid|low"}],"more":["<bundle you suspect but did not read>"]} — at most 30 items, each located on one page. Reply in Korean in two lines: what you checked and the three to fix first. If the message also asks for a change, make it first.]\n`;
}
const ORDER_HEAD = "[Reorder request. Write the complete new page order to .dynapse/pages.json as a JSON array of the existing result-*.html names (every page now in it, each once). To group pages, write .dynapse/bundles.json as a bare array [{\"name\":\"…\",\"pages\":[…]}] (pages not in a bundle stay in the main part, first); to send pages to the appendix, list them in .dynapse/appendix.json. Do not edit, add, delete or rename page files — the app renumbers the pages. Reply in Korean, one line per moved page: \"file → position · why\".]\n";
// 묶음(#139 §2) — .dynapse/bundles.json [{name, pages}] = 본편 순서 안의 이름 붙은 구간. 어느 묶음에도 없는 장 = "본편"(맨 앞), 부록(appendix.json) = "부록"(맨 뒤 · 이전 호환)
const BUNDLES = ".dynapse/bundles.json";
const MAIN_B = "본편", APX_B = "부록";
async function namedBundles(id, order, apx) {
    const raw = await readJson(id, BUNDLES).catch(() => null), seen = new Set(), out = [];
    for (const b of Array.isArray(raw) ? raw : []) {
        const name = typeof b?.name === "string" ? b.name.trim().slice(0, 30) : "";
        if (!name || name === MAIN_B || name === APX_B || out.some(x => x.name === name))
            continue;
        const pages = (Array.isArray(b.pages) ? b.pages : []).filter(f => typeof f === "string" && order.includes(f) && !apx.includes(f) && !seen.has(f));
        pages.forEach(f => seen.add(f));
        if (pages.length)
            out.push({ name, pages });
    }
    return out;
}
export async function bundlesOf(id) {
    const order = ((await readPages(id).catch(() => null)) ?? []).filter(x => typeof x === "string");
    const apx = ((await readJson(id, ".dynapse/appendix.json").catch(() => null)) ?? []).filter(x => typeof x === "string");
    const named = await namedBundles(id, order, apx), inN = new Set(named.flatMap(b => b.pages));
    const main = order.filter(f => !apx.includes(f) && !inN.has(f));
    return [...(main.length ? [{ name: MAIN_B, pages: main }] : []), ...named.map(b => ({ name: b.name, pages: order.filter(f => b.pages.includes(f)) })), ...(apx.length ? [{ name: APX_B, pages: order.filter(f => apx.includes(f)) }] : [])];
}
// 같은 묶음끼리 붙게(본편 → 묶음 순서 → 부록) · bundles.json을 있는 장만으로 다시 쓴다. 순서가 바뀌면 true
export async function normalizeBundles(id) {
    const raw = await readJson(id, BUNDLES).catch(() => null);
    if (!Array.isArray(raw))
        return false;
    const order = ((await readPages(id).catch(() => null)) ?? []).filter(x => typeof x === "string");
    const apx = ((await readJson(id, ".dynapse/appendix.json").catch(() => null)) ?? []).filter(x => typeof x === "string");
    const named = await namedBundles(id, order, apx);
    if (JSON.stringify(named) !== JSON.stringify(raw))
        await wput(id, BUNDLES, JSON.stringify(named)).catch(() => { });
    const k = (f) => named.findIndex(b => b.pages.includes(f));
    const main = order.filter(f => !apx.includes(f)), sorted = main.map((f, i) => ({ f, i, b: k(f) })).sort((a, b) => a.b - b.b || a.i - b.i).map(x => x.f);
    if (sorted.join() === main.join())
        return false;
    await normalizeOrder(id, sorted);
    return true;
}
export async function normalizeOrder(id, wanted, fresh) {
    const files = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(f => PAGE_RE.test(f));
    if (!files.length)
        return null;
    let prev = wanted ?? (await readJson(id, ".dynapse/pages.json"));
    if (!wanted && prev && !Array.isArray(prev) && Array.isArray(prev.pages))
        prev = prev.pages; // {pages:[…]} 꼴도 같은 순서(#189 — readPages 규칙)
    // 장 목록이 목록이 아니면(#178 — 18차: 서버 오류 응답 {"error":…}이 들어 있어 이름 순으로 다시 짜다 표지→마무리→본문이 됐다) 마지막 커밋의 목록으로
    const corrupt = !wanted && prev !== null && !Array.isArray(prev);
    if (corrupt) {
        const head = await T().core.invoke("repo_head", { id }).catch(() => null);
        const t = head ? await T().core.invoke("repo_read_at", { id, sha: head, file: ".dynapse/pages.json" }).catch(() => null) : null;
        let j = null;
        try {
            j = t ? JSON.parse(t) : null;
        }
        catch { /* 커밋본도 깨짐 */ }
        report("sync", "pages.corrupt", Array.isArray(j) ? "head" : "names");
        prev = Array.isArray(j) ? j : null;
    }
    const arr = Array.isArray(prev) ? [...new Set(prev.filter((x) => typeof x === "string"))] : [];
    const app = (await readJson(id, ".dynapse/appendix.json")) ?? [];
    const appx = Array.isArray(app) ? app.filter(f => files.includes(f)) : [];
    const main = arr.filter(f => files.includes(f) && !appx.includes(f));
    // 순서 파일에 없는 장 — 이번 턴에 새로 생긴(fresh) 장만 넣는다. 나머지는 옛 장(#98 보정 1 stale_pages: 순서·쪽번호에서 빠지고 검사가 알린다)
    const stale = (f) => !wanted && Array.isArray(prev) && !!fresh && !fresh.includes(f);
    // 번호 없는 장(본문 등)은 마무리 앞(#178 — 1e7이라 마무리 1e6 뒤로 갔다)
    for (const f of files.filter(f => !main.includes(f) && !appx.includes(f) && !stale(f)).sort((a, b) => (orderKey(a) ?? 5e5) - (orderKey(b) ?? 5e5) || a.localeCompare(b))) {
        const k = orderKey(f);
        let at = main.length;
        if (k !== null) {
            const i = main.findIndex(x => { const kx = orderKey(x); return kx !== null && kx > k; });
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
    // 순서 잠금(#97 보정 2) — 사용자가 직접 정한 순서(장 띠 끌기·"N장을 앞으로" 같은 요청)는 .dynapse/order-lock.json. 턴 끝 정리에서 AI가 바꾼 순서를 되돌린다:
    // 잠긴 장들이 차지한 자리에 잠긴 순서대로 다시 앉힌다(새 장·뺀 장은 그대로 — 추가·삭제는 허용). 이번 요청이 장 이름을 대며 옮겨 달라고 했으면 풀고 새 순서로 다시 잠근다
    if (!wanted) {
        const lock = await readJson(id, ".dynapse/order-lock.json").catch(() => null);
        if (orderUnlock.delete(id)) {
            if (lock)
                await wput(id, ".dynapse/order-lock.json", JSON.stringify({ order: main, at: Date.now() })).catch(() => { });
        }
        else if (lock?.order?.length) {
            const locked = lock.order.filter(f => main.includes(f)), slots = main.map((f, i) => (locked.includes(f) ? i : -1)).filter(i => i >= 0);
            const before = main.join();
            slots.forEach((at, k) => { main[at] = locked[k]; });
            if (main.join() !== before)
                orderRestored.add(id);
        }
    }
    const order = [...main, ...appx];
    const prevJson = Array.isArray(prev) ? JSON.stringify(prev) : "";
    if (wanted || corrupt || JSON.stringify(order) !== prevJson) {
        await wput(id, ".dynapse/pages.json", JSON.stringify(order)).catch(() => { });
        if (JSON.stringify(order) !== prevJson) {
            await wput(id, ".dynapse/order-at.json", JSON.stringify({ at: Date.now() })).catch(() => { });
            if (S.token)
                void api("POST", `/api/works/${encodeURIComponent(id)}/hidden`, { order }).then(async (r) => {
                    const fo = r?.data?.order;
                    if (!r?.data?.fixed || !Array.isArray(fo))
                        return;
                    await wput(id, ".dynapse/pages.json", JSON.stringify(fo)).catch(() => { });
                    await postChat(id, [{ role: "event", text: "표지를 첫 장으로 맞췄어요", payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
                }).catch(() => null);
        }
    } // 서버 순서도(#195 — 발표·웹이 같은 순서)   // order-at = 이 PC에서 순서가 마지막으로 바뀐 때(#189 — 내보내기 전 서버 순서와 어느 쪽이 새것인지)
    const pad = (n) => String(n).padStart(2, "0"), N = order.length;
    const pnOn = !!(await readJson(id, ".dynapse/page-numbers.json").catch(() => null))?.on;
    // 언어판도 같은 번호로(#139 B — 장을 지운 뒤 원문은 40, 한국어판은 41로 남아 "쪽번호 분모가 장마다 달라요")
    const allNames = (await T().core.invoke("work_files", { id }).catch(() => [])).map(x => x.name);
    // 순번만 담은 칸·제목 맨 앞 순번도 새 순서로(#189) — 본편 장 기준으로 표를 짜 언어판에도 같은 번호
    const { ordinalPlan, applyOrdinals } = await import("./ordinals.js");
    const ordPlan = ordinalPlan((await Promise.all(main.map(async (f) => ({ file: f, html: (await wget(id, f)) ?? "" })))).filter(x => x.html));
    for (const [i, f] of order.entries()) {
        const stem = f.replace(/\.html$/, "");
        for (const g of [f, ...allNames.filter(n => n.startsWith(`${stem}.`) && LANG_PAGE.test(n) && n.replace(/\.[a-z]{2}\.html$/, ".html") === f)]) {
            const h0 = await wget(id, g);
            if (!h0)
                continue;
            const h = ordPlan.has(f) ? applyOrdinals(h0, ordPlan.get(f)) : h0;
            // 카드뉴스 쪽 번호는 기본 숨김(#227 보정 1 A2 — 덱 11개 전부 "01 / 06"이 AI 티였다). 번호는 그대로 쓰고 칸만 data-slot-empty로(검사·서버가 빈 칸으로 세지 않는다). .dynapse/page-numbers.json {on:true}면 보인다
            const hide = /^result-card-\d+/.test(f) && !pnOn;
            const out = h.replace(/(<[a-z][a-z0-9]*\b[^>]*\bdata-slot\s*=\s*["']page_no["'][^>]*>)([^<]*)(<)/i, (_m, a, _t, c) => {
                const a2 = a.replace(/\s+data-slot-empty(?:=["'][^"']*["'])?/i, "").replace(/\s+hidden(?=[\s>])/i, "");
                return `${hide ? a2.replace(/>$/, " data-slot-empty hidden>") : a2}${pad(i + 1)} / ${pad(N)}${c}`;
            });
            if (out !== h0)
                await wput(id, g, out).catch(() => { });
        }
    }
    return order;
}
// 사람이 정한 것(#91 보정 1) — <section data-lint-ok="contrast …">에 규칙 하나 더하기(웹 overlay.ts addLintOk와 같은 규칙)
function addLintOk(html, rule) {
    return html.replace(/<section\b[^>]*\bclass\s*=\s*["'][^"']*\bslide\b[^"']*["'][^>]*>/i, tag => {
        const cur = tag.match(/\sdata-lint-ok\s*=\s*["']([^"']*)["']/i)?.[1] ?? "", list = [...new Set([...cur.split(/[\s,]+/).filter(Boolean), rule])].join(" ");
        return /\sdata-lint-ok\s*=/i.test(tag) ? tag.replace(/\sdata-lint-ok\s*=\s*["'][^"']*["']/i, ` data-lint-ok="${list}"`) : tag.replace(/>$/, ` data-lint-ok="${list}">`);
    });
}
// 한글 줄바꿈 묶기(#91 §5) — 결과 장의 글자(태그·script·style 밖)에서 숫자+단위(6장·30분)와 가운뎃점 고유명사(Claude·ChatGPT, PNG·HTML) 사이에 word joiner(U+2060).
// 렌더·내보내기 둘 다 그 자리에서 끊기지 않는다. 바뀌는 바이트는 그 문자뿐 — 먼저 지우고 다시 넣어 몇 번을 돌려도 같다. 글자 크기·문장은 건드리지 않는다
const WJ = "\u2060";
const UNIT = "장|분|초|시간|일|개|명|건|원|만|억|천|배|회|곳|년|월|주|위|%|kg|km|cm|mm|px|MB|GB|TB";
// 영어(#91 보정 2) — 숫자 뒤 띄어 쓴 단위(3 min · 40 languages)는 줄바꿈 없는 공백(U+00A0), 주소·메일은 끊길 자리마다 U+2060
const UNIT_LAT = "min|mins|minutes?|hours?|hrs?|sec|secs|seconds?|ms|days?|weeks?|months?|years?|yrs?|x|pt|px|kg|km|GB|MB|TB|bn|languages?|people|users?|countries|cities|pages?|slides?|%";
const joinText = (t) => !/[0-9·@/]/.test(t) ? t : t.replace(/\u2060/g, "")
    .replace(/([0-9A-Za-z가-힣])·(?=[0-9A-Za-z가-힣])/g, `$1${WJ}·${WJ}`)
    .replace(new RegExp(`(\\d)(?=(?:${UNIT})(?![A-Za-z]))`, "g"), `$1${WJ}`)
    .replace(new RegExp(`(\\d) (?=(?:${UNIT_LAT})(?![A-Za-z]))`, "gi"), "$1\u00a0")
    .replace(/\b(?:https?:\/\/|www\.)[^\s<]+|\b[\w.+-]+@[\w-]+\.[\w.]+/g, u => u.replace(/([/.@?&=_-])(?=.)/g, `$1${WJ}`));
// 코드 가리기(#91 보정 2) — 글자 패스(줄바꿈 묶기·움직임 떼기·번역 비교) 전에 <style>·<script>·주석을 자리표로 바꾸고 끝나면 되돌린다. 패스가 CSS를 글로 보지 않게
export function maskCode(html) {
    const keep = [];
    const text = html.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->/gi, m => `\u0000${keep.push(m) - 1}\u0000`);
    return { text, restore: t => t.replace(/\u0000(\d+)\u0000/g, (_m, i) => keep[Number(i)] ?? "") };
}
// CSS가 글로 새어 나온 장 고치기(#91 보정 2 — 세일즈맵 10장: 블록이 중간에 닫혀 `.shot h4 span{…}`이 글자로 PDF에 찍혔다) — </style> 뒤 CSS 같은 글(선택자{…})을
// 앞 블록 안으로 되돌리고 그 뒤 홀로 남은 </style>을 하나 뺀다 · style 안의 U+2060·U+200B(줄바꿈 묶기가 넣은 것)는 지운다. 고친 곳 수
export function repairStyleLeak(h) {
    let n = 0;
    let out = h.replace(/<\/style\s*>(\s*)((?:[^<{}]+\{[^{}<]*\}\s*)+)(<\/style\s*>)?/gi, (_m, ws, css) => { n++; return `${ws}${css}</style>`; });
    out = out.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (m, a, b, c) => (/[\u2060\u200b]/.test(b) ? (n++, `${a}${b.replace(/[\u2060\u200b]/g, "")}${c}`) : m));
    return { html: out, n };
}
export function joinWords(html) {
    let out = "", i = 0;
    const re = /<(script|style)\b[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->|<[^>]+>/gi;
    for (let m; (m = re.exec(html));) {
        out += joinText(html.slice(i, m.index)) + m[0];
        i = m.index + m[0].length;
    }
    return out + joinText(html.slice(i));
}
// 줄바꿈 규칙(#91 보정 2) — 자동 하이픈 끊기 없음 · 제목은 줄 길이를 고르게(balance) · 본문은 마지막 줄 한 단어를 피하게(pretty). 지원하지 않는 브라우저는 무시
const WRAP_CSS = `<style data-wrap>html{hyphens:manual;-webkit-hyphens:manual}h1,h2,h3,[data-slot$="title"],[data-slot$="_title"]{text-wrap:balance}p,li,[data-slot$="line"],[data-slot$="desc"]{text-wrap:pretty}</style>`;
const addWrapCss = (h) => /<style\b[^>]*\bdata-wrap\b/i.test(h) || !/<\/head\s*>/i.test(h) ? h : h.replace(/<\/head\s*>/i, m => `${WRAP_CSS}\n${m}`);
// 글은 움직이지 않는다(#106 보정 3) — 제목·소제목·본문 글 블록(h1~h3·p·*_title·*_lead)의 data-step·data-tid·data-flip을 뗀다(숫자 칸은 그대로). 뗀 곳 수
const TXT_TAG = /<(h[1-3]|p)\b[^>]*>|<[a-z][a-z0-9]*\b[^>]*\bdata-slot\s*=\s*["'](?:title|subtitle|[^"']*_title|[^"']*_lead)["'][^>]*>/gi;
// 덱 사진 처리(#119 보정 15 ③ — 높은 채도가 AI 티의 주요 단서) — 올린 사진·생성 사진 모두 같은 filter 하나. 값은 덱마다 한 번 정해 .dynapse/photo-treat.json에:
// 스타일 팩이 톤을 정했으면 그 톤, 아니면 saturate(.85)(바탕·강조색이 따뜻하면 sepia(.05) 더함). 선택자는 :where(특이도 0) — 칸별 [톤 맞춤] 끄기(tweak filter:none)가 이긴다
export function photoTreatOf(h) {
    const tone = h.match(/<style\b[^>]*\bdata-pack\b[^>]*>[\s\S]*?--photo-tone\s*:\s*([^;}]+)/i)?.[1]?.trim();
    if (tone && tone !== "none" && !/var\(/.test(tone))
        return tone;
    const hex = [...h.matchAll(/--color-semantic-(?:bg-base|accent-base)\s*:\s*#([0-9a-f]{6})\b/gi)].map(m => m[1]);
    const warm = hex.some(x => {
        const [r, g, b] = [0, 2, 4].map(i => parseInt(x.slice(i, i + 2), 16) / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx - mn < 0.08)
            return false;
        const hue = mx === r ? (60 * ((g - b) / (mx - mn)) + 360) % 360 : mx === g ? 60 * ((b - r) / (mx - mn)) + 120 : 60 * ((r - g) / (mx - mn)) + 240;
        return hue >= 15 && hue <= 60;
    });
    return warm ? "saturate(.85) sepia(.05)" : "saturate(.85)";
}
export function putPhotoTreat(h, treat) {
    if (!/<img\b/i.test(h) || !/^[a-z0-9().,%\s-]{1,80}$/i.test(treat))
        return h;
    const block = `<style data-photo-treat>:root,body[class]{--photo-treat:${treat};--photo-tone:var(--photo-treat)}:where(.slide [data-slot]:not([data-slot="brand"])) img:where(:not([src$=".svg"]):not([data-icon]):not([data-locked])){filter:var(--photo-treat)}</style>`; // 기관 로고·브랜드 자산은 색 보정 없음(#157 ④)
    const cur = h.match(/<style\b[^>]*\bdata-photo-treat\b[^>]*>[\s\S]*?<\/style>/i);
    if (cur)
        return cur[0] === block ? h : h.replace(cur[0], block);
    return /<\/head>/i.test(h) ? h.replace(/<\/head>/i, `${block}\n</head>`) : h;
}
export function stripTextMotion(h) {
    let n = 0;
    const mk = maskCode(h);
    const html = mk.restore(mk.text.replace(TXT_TAG, tag => {
        if (!/\sdata-(step|tid|flip)\s*=/.test(tag) || /data-slot\s*=\s*["'][^"']*(_num|_v[^"']*)["']|class\s*=\s*["'][^"']*\b(value|b-value|b-num|b-numeral)\b/.test(tag))
            return tag;
        n++;
        return tag.replace(/\s+data-(step|tid|flip)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g, "");
    }));
    return { html, n };
}
async function joinPages(id, pages) {
    for (const pg of pages.filter(f => /^result-[a-z0-9-]+\.html$/.test(f) || LANG_PAGE.test(f))) {
        const h = await wget(id, pg);
        if (!h)
            continue;
        const j = addWrapCss(joinWords(h));
        if (j !== h)
            await wput(id, pg, j).catch(() => { });
    }
}
// 경고 종류별 개수(#97 §5) — 완료 카드 "경고 45"를 "밀도 20 · 줄바꿈 15 …"로 접어 보이게
const warnKinds = (ws = []) => { const c = {}; for (const w of ws)
    c[w.rule] = (c[w.rule] ?? 0) + 1; return c; };
// 장 점검 배지(#91) — 대비·폰 글자 수·잘림·같은 사진·밀도·줄바꿈 결과만 장 단위로 웹에(채팅엔 안 보이는 이벤트). 웹은 검사한 장 × 검사한 규칙만 바꾼다
// 렌더가 필요한 규칙은 렌더를 건너뛴 검사(글자만 바뀐 턴)에선 그대로 둔다
const CHECK_RENDER = ["contrast", "mobile_text", "image_text_cut", "widow", "render_empty", "underfill", "small_text", "small_icon"], // underfill·작은 글자·작은 아이콘(#121) — 점 하나, underfill은 [키우기]
CHECK_STATIC = ["dup_photo", "density", "emoji", "no_numbers", "same_layout", "copy_ai"]; // copy_ai = AI 말투(#122)
// 리워드 장 차례 중(#278 ④ — 1/8 턴 뒤 아직 뼈대인 7장의 경고 18개가 떴다): 쓴 장만 보이고 덱 전체(*) 경고는 마지막 장 뒤에. 아니면 null
const seqWritten = (id) => { const q = seqReward.get(id); return q && q.phase === "pages" && q.i < q.pages.length ? new Set(q.pages.slice(0, q.i)) : null; };
async function postChecks(id, v, pages, noRender) {
    if (v.engine !== "node")
        return;
    {
        const done = seqWritten(id);
        if (done) {
            const q = seqReward.get(id);
            v = { ...v, errors: v.errors.filter(e => done.has(e.page)), warnings: v.warnings.filter(w => done.has(w.page)) };
            pages = (pages ?? []).filter(f => done.has(f));
            await postChat(id, [{ role: "event", text: `${q.i}/${q.pages.length} · 나머지 ${q.pages.length - q.i}장은 차례로 채워져요`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
            if (!pages.length)
                return;
        }
    }
    const names = pages?.length ? pages : (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(f => /^result-[a-z0-9-]+\.html$/.test(f));
    const rules = noRender ? CHECK_STATIC : [...CHECK_RENDER, ...CHECK_STATIC];
    // 취향 배지는 사용자 작업에서 띄우지 않는다(#296 ② — 같은 사진·밀도·이모지·숫자 없음·같은 틀·AI 말투·빈 공간 점: 사용자가 고칠 이유를 받아들이기 어렵다). 리워드는 그대로.
    // rules는 그대로 보낸다 — 웹이 그 규칙의 예전 점을 지운다
    const TASTE = new Set(["dup_photo", "density", "emoji", "no_numbers", "same_layout", "copy_ai", "underfill"]), reward = rewardWorks.has(id);
    const items = [...(v.errors ?? []), ...(v.warnings ?? [])].filter(x => rules.includes(x.rule) && (reward || !TASTE.has(x.rule))).slice(0, 60)
        .map(x => { const a = x; return { page: x.page, rule: x.rule, msg: String(x.msg).split(" — ")[0].slice(0, 120), ...(typeof a.slot === "string" ? { slot: a.slot } : {}), ...(typeof a.photo === "string" ? { photo: a.photo } : {}), ...(typeof a.fix === "string" ? { fix: a.fix } : {}), ...(typeof a.focus === "string" ? { focus: a.focus } : {}), ...(a.tone === "dark" || a.tone === "light" ? { tone: a.tone } : {}) }; });
    await postChat(id, [{ role: "event", text: null, payload: { kind: "checks", ai: "dynapse", pages: names, rules, items } }]);
}
const agentRuns = new Map(); // 이 턴 AI의 --reward 실행 시각(#120 §3)
// 묶음 사진 줄이기(#281 — 사진 넷을 품은 청첩장 묶음 2.3MB를 앱이 읽지 못해 빈 글이 서버 검사로 갔다): 리워드 검사 전에 장이 쓰는 큰 사진의 작은 판을
// .dynapse/out/inline-small.json으로 — verify가 묶음에 그것을 넣는다. 같은 파일·크기면 지난 값(검사마다 다시 줄이지 않는다)
// 리워드 제출 전 다른 사이트 사진 받기(#296 — 재고 장은 자기완결이어야 해서 외부 사진이 오류였다): 장의 https 사진(img·url())을 materials/ext-⟨해시⟩로 받고 주소를 바꾼다.
// 우리 Blob·웹폰트는 그대로. 못 받은 것만 한 줄로 알린다(받으면 말하지 않는다)
const OWN_BLOB_RE = /^https:\/\/023vvhcpzdx5krbf\.public\.blob\.vercel-storage\.com\//i, FONT_HOST_RE = /^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net\/gh\/orioncactus)\//i;
export async function pullExternalForReward(id, pages) {
    const dir = await T().core.invoke("work_dir", { id }).catch(() => null);
    if (!dir)
        return { pulled: 0, left: 0 };
    const list = pages?.length ? pages : (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(n => PAGE_RE.test(n));
    let pulled = 0, left = 0;
    const got = new Map();
    for (const f of list) {
        const h = await wget(id, f).catch(() => null);
        if (!h)
            continue;
        const urls = [...new Set([...h.matchAll(/<img\b[^>]*\bsrc\s*=\s*["'](https:\/\/[^"'\s>]+)["']|url\(\s*["']?(https:\/\/[^)"'\s]+)["']?\s*\)/gi)].map(m => m[1] ?? m[2]))].filter(u => !OWN_BLOB_RE.test(u) && !FONT_HOST_RE.test(u));
        if (!urls.length)
            continue;
        let x = h;
        for (const u of urls.slice(0, 12)) {
            if (!got.has(u)) {
                let k = 5381;
                for (const c of u)
                    k = ((k * 33) ^ c.charCodeAt(0)) >>> 0;
                const ext = (u.split("?")[0].match(/\.(png|jpe?g|webp|gif|avif|svg)$/i)?.[1] ?? "jpg").toLowerCase().replace("jpeg", "jpg"), rel = `materials/ext-${k.toString(16)}.${ext}`;
                const g = await http("GET", u, { out: `${dir}/${rel}`, keep: true }).catch(() => null);
                got.set(u, g?.status === 200 ? rel : null);
            }
            const rel = got.get(u);
            if (rel) {
                x = x.split(u).join(rel);
                pulled++;
            }
            else
                left++;
        }
        if (x !== h)
            await wput(id, f, x).catch(() => { });
    }
    if (pulled || left)
        report("turn", "reward.pull_external", `pulled=${pulled} left=${left}`);
    return { pulled, left };
}
async function smallFor(id, pages) {
    const all = await T().core.invoke("work_files", { id }).catch(() => []);
    const pg = pages ?? all.map(f => f.name).filter(f => /^result-[a-z0-9-]+\.html$/.test(f));
    const r = await BS.smallPhotos({ pages: pg, read: f => wget(id, f), sizes: async () => Object.fromEntries(all.map(f => [f.name, f.size])),
        bytes: f => T().core.invoke("work_bytes", { id, file: f }).then(b => new Uint8Array(b)), shrink: BS.shrinker(),
        prev: await readJson(id, BS.SMALL_FILE).catch(() => null), write: j => wput(id, BS.SMALL_FILE, j) });
    if (r.n)
        report("export", "bundle.small", `n=${r.n} saved_kb=${Math.round(r.saved / 1024)}`);
}
async function appVerify0(id, pages, noRender = false, reward = false, board = false) {
    const dir = await T().core.invoke("work_dir", { id });
    // 리워드 표시(대표: 검증 실패가 계속 뜬다) — 0.1.57 이하 실행기는 --reward 옵션을 거부해 일반 검사로 돌았다. 표시 파일이면 옵션 없이도 verify.mjs가 리워드 규칙으로(에이전트가 직접 돌려도 같다)
    if (reward)
        await wput(id, ".dynapse/reward.json", JSON.stringify({ task: rewardWorks.get(id) ?? null })).catch(() => { });
    if (reward) { // AI의 --reward 실행 기록(#120) — 앱 검사 전에 옮겨 두고 지운다(앱 검사가 세 번째로 세어 멈추지 않게 · 사용량 카드의 쓰기·고치기 구간)
        const vr = await readJson(id, ".dynapse/verify-runs.json").catch(() => null);
        if (vr?.runs?.length && !agentRuns.has(id))
            agentRuns.set(id, vr.runs);
        await wput(id, ".dynapse/verify-runs.json", "{}").catch(() => { });
    }
    if (reward) {
        const px = await pullExternalForReward(id, pages).catch(() => null);
        if (px?.left)
            await postChat(id, [{ role: "event", text: `다른 사이트 사진 ${px.left}장을 받지 못했어요 · 그 사진만 바꿔 주세요`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
    } // 외부 사진 받기(#296)
    if (reward)
        await smallFor(id, pages).catch(() => { }); // 묶음 사진 작은 판(#281) — verify가 묶음을 만들기 전에
    if (verifyCache) {
        // --no-small: 앱은 작은 PNG를 안 쓴다(#54 B5). 옛 네이티브(0.1.52 이하)는 옵션 인자를 거부 → 옵션 없이 한 번 더(#54 B6)
        const run = (flags) => verifyExec(id, [...(pages ?? []), ...flags], dir).catch(() => null);
        // --reward(#62): 공개 재고 규칙 — 빈 사진 칸은 오류(사진 요청에 적힌 칸은 대기), 사진 칸을 빼도 된다
        // --board(#98): 보는 검토 — 스토리보드 + 바뀐 장 작은 PNG(그래서 --no-small 없이)
        // --app(#155) — 앱의 자기 검사는 AI의 --reward 횟수 상한에 세지 않는다(예전 verify는 모르는 옵션을 무시)
        const flags = [...(board && !noRender ? ["--board"] : ["--no-small"]), ...(noRender ? ["--no-render"] : []), ...(reward ? ["--reward", "--app"] : [])];
        let r = await run(flags);
        if (!r?.stdout?.trim())
            r = await run([]);
        let line = r?.stdout?.trim().split("\n").at(-1);
        // 횟수 상한 답(max_runs — errors가 없는 답, #155 제출이 v.errors.map에서 멈췄다)이면 기록을 지우고 한 번 더
        if (/"stop"\s*:\s*"max_runs"/.test(line ?? "")) {
            await wput(id, ".dynapse/verify-runs.json", "{}").catch(() => { });
            r = await run(flags);
            line = r?.stdout?.trim().split("\n").at(-1);
        }
        try {
            const v = JSON.parse(line ?? "");
            if (typeof v.ok === "boolean")
                return { ...v, errors: Array.isArray(v.errors) ? v.errors : v.ok ? [] : [{ page: "*", rule: "verify", msg: String(v.error ?? v.msg ?? "검사가 끝나지 않았어요") }], warnings: Array.isArray(v.warnings) ? v.warnings : [], shots: Array.isArray(v.shots) ? v.shots : [], engine: "node" };
        }
        catch { /* node 없음 → 아래 */ }
    }
    const names = pages ?? (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(f => /^result-[a-z0-9-]+\.html$/.test(f));
    const errors = [];
    for (const page of names) {
        const h = await wget(id, page);
        if (!h) {
            errors.push({ page, rule: "exists", msg: "파일이 없거나 비어 있어요" });
            continue;
        }
        if (!/<section[\s>]/i.test(h))
            errors.push({ page, rule: "section", msg: "<section>이 없어요" });
        // 웹폰트 허용 목록은 verify.mjs FONT_OK와 같게(2026-10-16 — node 검사가 못 돈 순간 이 대체 검사가 Google Fonts를 "외부"로 잡아 16장을 되돌렸다)
        const FONT_OK = /^(?:https?:)?\/\/(fonts\.googleapis\.com\/css2?\?|fonts\.gstatic\.com\/|cdn\.jsdelivr\.net\/gh\/orioncactus\/pretendard[@/]|cdn\.jsdelivr\.net\/npm\/pretendard[@/]|cdn\.jsdelivr\.net\/gh\/sun-typeface\/SUIT[@/]|cdn\.jsdelivr\.net\/gh\/wanteddev\/wanted-sans[@/]|dynapse\.ai\/fonts\/)/i;
        const ext = [...h.replace(/<!--[\s\S]*?-->/g, "").matchAll(/(?:src|href)\s*=\s*["']?\s*((?:https?:)?\/\/[^"'\s>]+)|url\(\s*["']?\s*((?:https?:)?\/\/[^)"']+)|@import\s+(?:url\()?\s*["']?((?:https?:)?\/\/[^)"';\s]+)/gi)].map(m => m[1] ?? m[2] ?? m[3]).filter(u => u && !FONT_OK.test(u) && !/^(?:https?:)?\/\/fonts\.(googleapis|gstatic)\.com\/?$/i.test(u));
        if (ext.length)
            errors.push({ page, rule: "external", msg: `외부 URL: ${ext[0].slice(0, 60)}` });
    }
    return { ok: !errors.length, errors, warnings: [{ page: "*", rule: "render", msg: "node가 없어 렌더 검사를 못 했어요" }], shots: [], engine: "app" };
}
// verify 실행(#241) — 네이티브 0.1.85의 인자 허용 목록(--no-render·--no-small·--reward·--pptx·--png2x·--detail·--board·--flippdf · result-*.html · --lang xx · --name 이름) 밖의 인자가 있으면
// 인자 전부를 .dynapse/verify-args.json(60초)에 적고 인자 없이 부른다 — verify.mjs가 읽고 지운다(--tidboxes·--bands·--printpdf·--marks·--recordpdf·--app이 조용히 거부되던 것)
const NATIVE_FLAGS = new Set(["--no-render", "--no-small", "--reward", "--pptx", "--png2x", "--detail", "--board", "--flippdf"]);
export async function verifyExec(id, args, dir) {
    let ok = true;
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "--lang" || a === "--name") {
            i++;
            continue;
        }
        if (!NATIVE_FLAGS.has(a) && !/^result-[\w.-]+\.html$/.test(a)) {
            ok = false;
            break;
        }
    }
    if (ok)
        return exec("node", [".dynapse/verify.mjs", ...args], undefined, dir);
    await wput(id, ".dynapse/verify-args.json", JSON.stringify({ at: Date.now(), args }));
    return exec("node", [".dynapse/verify.mjs"], undefined, dir);
}
// 내보내기 렌더(#73 §2) — verify.mjs의 --pptx(편집 가능한 PPTX + fonts.txt) · --png2x(2배 PNG). node·Chrome이 있어야 한다. 실패하면 이유 한 줄
export async function exportRender(id, mode, lang, extra = []) {
    await ensureVerify(id);
    if (!verifyCache)
        return { ok: false, error: "검증 스크립트를 받지 못했어요" };
    const dir = await T().core.invoke("work_dir", { id });
    await T().core.invoke("work_write", { id, file: ".dynapse/out/export-still.json", text: "{}" }).catch(() => { });
    const r = await verifyExec(id, [`--${mode}`, ...(lang && LANG_NAME[lang] ? ["--lang", lang] : []), ...extra], dir).catch(e => ({ stdout: "", stderr: String(e) }));
    const line = r?.stdout?.trim().split("\n").at(-1) ?? "";
    // 멈춘 화면으로 다시 찍은 장(#308) — 세 번에도 움직임이 남아 정지 CSS를 강제한 장이 있으면 한 줄
    {
        const st = await readJson(id, ".dynapse/out/export-still.json").catch(() => null);
        if (st?.forced?.length) {
            report("export", "export.still_forced", st.forced.slice(0, 6).join(","));
            await postChat(id, [{ role: "event", text: `움직이는 장 ${st.forced.length}개를 멈춘 화면으로 내보냈어요`, payload: { kind: "stage", ai: "dynapse", detail: st.forced.map(pageLabel).join(" · ") } }]).catch(() => { });
        }
    }
    try {
        const v = JSON.parse(line);
        return v;
    }
    catch { /* 아래 */ }
    const why = String(r?.stderr ?? "");
    return { ok: false, error: /검증 스크립트만/.test(why) ? `앱을 업데이트해야 ${{ printpdf: "인쇄용 PDF", recordpdf: "AI 사용 기록", flippdf: "플립북 PDF", png2x: "PNG", detail: "상세 그림", pptx: "PPTX" }[mode] ?? "이 파일"}로 내보낼 수 있어요` : /찾지 못했어요|not found|ENOENT/i.test(why) ? "PPTX를 만들려면 Node.js가 필요해요" : "PPTX를 만들지 못했어요" };
}
// 라운드 저장(AE1): 커밋(없으면 스냅샷 폴더) → 부모와 diff 요약 → 검증 결과·전후 사진(서버 비공개)
export async function repoCommit(id, message, paths) {
    if (!S.git)
        return null;
    return T().core.invoke("repo_commit", { id, message, ...(paths?.length ? { paths } : {}) }).catch(() => null); // paths(#191) = 그 파일만(병렬 장 턴)
}
export async function saveRound(id, r, message, v, paths) {
    const parent = S.git ? await T().core.invoke("repo_head", { id }).catch(() => null) : null;
    const sha = await repoCommit(id, `r${r.n} · ${message}`, paths);
    if (!S.git)
        await T().core.invoke("work_snapshot", { id, round: `r${r.n}` }).catch(() => { });
    if (sha) {
        r.commit = sha;
        if (parent)
            r.parent = parent;
    }
    if (sha && parent && sha !== parent) {
        const stat = await T().core.invoke("repo_diffstat", { id, from: parent, to: sha }).catch(() => "");
        r.diffstat = stat.split("\n").filter(Boolean).slice(-4).join("\n").slice(0, 400);
    }
    if (v) {
        r.verify = { ok: v.ok, errors: v.errors.slice(0, 5), warnings: v.warnings.length, engine: v.engine };
        // 데이터 위치(#20): 라운드 사진은 이 PC에 보관(.dynapse/shots). 서버 업로드는 동기화를 켰을 때만
        const pages = v.shots.map(x => x.split(/[\\/]/).pop().replace(/\.png$/, "")).filter(pg => /^[a-z0-9-]+$/.test(pg));
        for (const pg of pages)
            await T().core.invoke("work_keep_shot", { id, page: pg, round: r.n }).catch(() => { });
        r.shots = pages;
        r.uploaded = S.sync ? (await uploadShots(id, r.n, v.shots)).length > 0 : false;
    }
}
export async function uploadShots(id, n, shots) {
    if (!S.token)
        return [];
    const dir = await T().core.invoke("work_dir", { id });
    const done = [];
    for (const rel of shots) {
        const page = rel.split(/[\\/]/).pop().replace(/\.png$/, "");
        if (!/^[a-z0-9-]+$/.test(page))
            continue;
        const u = await http("PUT", `${HUB}/api/works/${encodeURIComponent(id)}/shot?round=${n}&page=${page}`, { file: `${dir}/${rel}`, contentType: "image/png", auth: true }).catch(() => null);
        if (u?.status === 200)
            done.push(page);
    }
    return done;
}
// 카드 썸네일 = 파일 줄 첫 항목(#22-보정 11) — 페이지가 있으면 첫 페이지 렌더(표지 먼저), 사진 작업이면 칸에 걸린 최신 이미지. 커밋마다(2초 디바운스)
export async function firstItem(id, files) {
    const names = files.map(f => f.name);
    const pages = names.filter(n => /^result-[a-z0-9-]+\.html$/.test(n)).sort((a, b) => (a === "result-cover.html" ? -1 : b === "result-cover.html" ? 1 : a.localeCompare(b)));
    for (const pg of pages) {
        const png = `.dynapse/out/${pg.replace(/^result-|\.html$/g, "")}.png`;
        if (names.includes(png))
            return png;
    }
    if (pages.length)
        return null;
    const bound = (await readJson(id, ".dynapse/slots.json").catch(() => null))?.photo;
    if (bound && names.includes(bound))
        return bound;
    const VER = /-v(\d+)\.[a-z0-9]+$/i;
    const imgs = names.filter(n => /^(materials|context\/assets|\.dynapse\/photos)\/[^/]+\.(png|jpe?g)$/i.test(n)).sort((a, b) => Number(b.match(VER)?.[1] ?? 0) - Number(a.match(VER)?.[1] ?? 0));
    return imgs[0] ?? null;
}
const thumbTimers = new Map();
// 함께 하는 작업(#20 초대) — 초대가 곧 올리기 동의라 동기화를 켜지 않아도 이 작업의 커밋은 올리고 받는다
export const sharedWorks = new Set();
const storySent = new Map(); // 스토리보드 카드(#111) — 같은 내용은 한 번만
export const sessions = new Map();
// Gemini 편집(#153 ①) — 기본 모델 · 첫 줄(이 세션엔 Dynapse 도구가 없다: 앱이 사진·검사·저장을 한다) · 예전 앱이 전역에 남긴 dynapse MCP 항목은 한 번 지운다(토큰을 agy 설정에 두지 않는다)
const AGY_MODEL = "gemini-3.8-flash-high";
const AGY_HEAD = "[You are editing a Dynapse work folder with Gemini. Read AGENTS.md in this folder first — it is your contract. Dynapse MCP tools are not available in this session and you must not try to reach the Dynapse server (no curl, no tokens): edit only the files in this folder; the app makes photos from .dynapse/photo-requests.json, runs checks and saves after your turn. You may run node .dynapse/verify.mjs. Reply to the user in Korean.]\n";
let agyMcpChecked = false;
async function dropAgyMcp() {
    if (agyMcpChecked)
        return;
    agyMcpChecked = true;
    const r = await exec("agy", ["mcp", "list"]).catch(() => null);
    const ours = (r?.stdout ?? "").split("\n").some(l => /^dynapse\s/.test(l) && /(dynapse\.ai|ai-task-hub-nu\.vercel\.app)\/api\/mcp/.test(l));
    if (!ours)
        return;
    const x = await exec("agy", ["mcp", "remove", "dynapse"]).catch(() => null);
    report("turn", "agy.mcp_removed", `ok=${x?.code === 0}`);
}
// TRACE·세션 기록의 런타임 이름 — Gemini 편집은 antigravity(spec runtime 이름)
const rtOf = (t) => (t === "claude" ? "claude_code" : t === "agy" ? "antigravity" : "codex");
const LIGHT_SONNET = true; // #51 §4 — #54 C8(모델별 프로세스 1개 유지) 뒤에 true
const mxNext = new Map();
export const reqHash = (t) => { let h = 0x811c9dc5; for (const c of t.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 300)) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
} return h.toString(16).padStart(8, "0"); };
const newTid = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
async function sendMetric(id, row) {
    await api("POST", `/api/works/${encodeURIComponent(id)}/metrics`, { ...row, os: S.app?.os ?? null, app: S.app?.version ?? null }).catch(() => { });
}
// 편집 AI 없는 요청(채우기·공개·리워드 제출) — 종류·시간·사진만
export async function actionMetric(id, kind, t0, extra = {}) {
    const ps = photoStats.get(id);
    photoStats.delete(id);
    await sendMetric(id, { tid: newTid(), kind, ai: null, t: { total: Math.round((Date.now() - t0) / 1000), photo: ps ? Math.round((Date.now() - t0) / 1000) : 0 }, photo: ps ?? null, ...extra });
}
// 지침이 쓰라는 것은 미리 허용(#29 A7 — 거부 → "다시 실행" 추가 턴 없게). 찾기·목록은 Grep·Glob 도구로(Bash grep·ls·find·cat 대신). 사진 생성은 앱 러너(#29 C3)라 agy·codex 직접 호출은 없다
export const CHAT_TOOLS = "Read Write Edit Grep Glob mcp__dynapse Bash(node .dynapse/verify.mjs) Bash(node .dynapse/verify.mjs *) Bash(node .dynapse/tmp/*) Bash(git *) Bash(curl *) Bash(cp *) Bash(mkdir *) Bash(codex exec *) Bash(claude -p *)";
export const MCP_STAGE = {
    // 보이는 것은 제출·공개뿐(#22-보정 14) — 나머지 Dynapse 도구는 로그로
    publish_work: "제출됨", submit_work: "제출됨",
};
// 처리 중인 메시지·사진 턴 수 — 화면 묶음 새로고침(OTA)이 받은 메시지를 잃지 않게(대표: 편집 진행 카드가 안 나옴 — 받자마자 새로고침돼 2분 뒤 다시 받았다)
let active = 0;
export const chatActive = () => active > 0 || [...sessions.values()].some(s => s.busy);
// 같은 본문 두 번(#165 ① — 예전 [다시 보내기]가 같은 user 행을 또 만들었다): 한 작업에 3분 안 같은 글의 user 메시지는 한 번만 돈다(리워드 수락 지시가 두 번 돌면 TRACE·증빙이 흐려진다)
const recentUser = new Map();
// 덱 그림 톤 다루기(#196 보정 1) — style-from: 그 그림을 기준으로 다시 뽑고 다른 그림도 다시 만들지 묻는다 · style-regen: 칸마다 마지막 brief로 다시(기준 그림 칸 빼고, 한 장씩)
// style-off: 끄기/켜기 · style-set: 문장 바꾸기(regen이면 바로 다시 — #187대로 알리고 진행)
async function styleAction(id, a) {
    const IS = await import("./image-style.js"), PR = await import("./photo-runner.js");
    const cur = (await readJson(id, IS.STYLE_FILE).catch(() => null));
    if (a.action === "style-off") {
        await wput(id, IS.STYLE_FILE, JSON.stringify({ ...(cur ?? { sentence: "", medium: null, palette: [], ref: null, from: "user", at: Date.now() }), off: a.off !== false }, null, 1));
        await postChat(id, [{ role: "event", text: a.off !== false ? "덱 그림 톤 맞추기를 껐어요" : "덱 그림 톤 맞추기를 켰어요", payload: { kind: "stage", ai: "dynapse" } }]);
        return;
    }
    if (a.action === "style-from") {
        const file = String(a.file ?? "");
        if (!/^materials\/[\w.-]+\.(png|jpe?g|webp)$/i.test(file))
            return;
        await PR.rebaseStyle(id, file);
        await postChat(id, [{ role: "event", text: "덱 그림 톤을 이 그림으로 맞췄어요", payload: { kind: "style-rebased", ai: "dynapse", file } }]);
        return;
    }
    if (a.action === "style-set") {
        const sentence = String(a.sentence ?? "").trim().slice(0, 400);
        if (!sentence)
            return;
        await wput(id, IS.STYLE_FILE, JSON.stringify({ ...(cur ?? { medium: null, palette: [], ref: null, at: Date.now() }), sentence, medium: null, ref: a.regen ? null : cur?.ref ?? null, from: "user", off: false, at: Date.now() }, null, 1));
        if (!a.regen) {
            await postChat(id, [{ role: "event", text: "덱 그림 톤 문장을 바꿨어요", payload: { kind: "stage", ai: "dynapse" } }]);
            return;
        }
    }
    // 다시 만들기 — 칸마다 마지막 brief(일러스트·아이콘만, 기준 그림 칸은 빼고), 한 장씩 · ⌘Z는 그림마다
    const briefs = (await readJson(id, ".dynapse/image-briefs.json").catch(() => null)) ?? {};
    const ref = (await readJson(id, IS.STYLE_FILE).catch(() => null))?.ref ?? null;
    const todo = Object.entries(briefs).filter(([, v]) => v.kind !== "photo").map(([k, v]) => ({ page: k.split("|")[0], slot: k.split("|")[1], brief: v.brief }))
        .filter(x => PAGE_RE.test(x.page) && !(ref && ref.startsWith(`materials/${x.page.replace(/^result-/, "").replace(/\.html$/, "")}-${x.slot}`)));
    if (!todo.length) {
        await postChat(id, [{ role: "event", text: "다시 만들 그림이 없어요", payload: { kind: "stage", ai: "dynapse" } }]);
        return;
    }
    await postChat(id, [{ role: "event", text: `덱 톤으로 그림 ${todo.length}장을 다시 만들어요 · 그림마다 ⌘Z로 되돌릴 수 있어요`, payload: { kind: "stage", ai: "dynapse" } }]);
    const ais = ["chatgpt", "gemini"].filter(x => PR.photoReady(x));
    for (const t of todo) {
        const r = await PR.genSlotPhoto(id, t.page, t.slot, ais.slice(0, 1), t.brief, "16:9").catch(() => ({ ais: [], files: [] }));
        if (r.files.length)
            await clickRound(id, `${pageLabel(t.page)} · 덱 톤으로 다시`, r.ais);
    }
    void afterSave(id);
}
// 나눠 온 긴 메시지(#192 — 웹이 16,000자 상한을 넘는 글을 문단 경계에서 나눠 같은 무리로 보낸다) — 조각을 다 모은 뒤 한 턴으로. 30초 안에 다 안 오면 받은 만큼 + 한 줄
const splitBuf = new Map();
async function flushSplit(g, partial) {
    const b = splitBuf.get(g);
    if (!b)
        return;
    splitBuf.delete(g);
    clearTimeout(b.t);
    const ps = b.parts.filter((x) => !!x);
    if (!ps.length)
        return;
    if (partial)
        await postChat(ps[0].work, [{ role: "event", text: `긴 메시지 ${b.parts.length}조각 중 ${ps.length}개만 받았어요 · 받은 만큼으로 시작해요`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
    const { split_part: _sp, ...pl } = (ps[0].payload ?? {});
    void _sp;
    await onChatMessage({ ...ps[0], text: ps.map(p => p.text ?? "").join("\n\n"), payload: pl });
}
export async function onChatMessage(m) {
    {
        const sp = m.payload?.split_part;
        if (m.role === "user" && sp?.group && sp.n && sp.i) {
            const b = splitBuf.get(sp.group) ?? { parts: new Array(Math.min(8, sp.n)), t: setTimeout(() => void flushSplit(sp.group, true), 30_000) };
            b.parts[sp.i - 1] = m;
            splitBuf.set(sp.group, b);
            if (b.parts.filter(Boolean).length < b.parts.length)
                return;
            await flushSplit(sp.group, false);
            return;
        }
    }
    if (m.role === "user" && m.text && m.text.length >= 8) {
        const k = `${m.work}|${m.text}`, at = recentUser.get(k);
        recentUser.set(k, Date.now());
        if (at && Date.now() - at < 180_000)
            return;
        if (recentUser.size > 200)
            for (const [k2, t] of recentUser)
                if (Date.now() - t > 180_000)
                    recentUser.delete(k2);
    }
    active++;
    // 준비 중 예외는 조용히 죽지 않게 한 줄(#54 보정 2 — 프리필 실패로 "장 채우는 중"에서 영원히 멈췄다)
    try {
        return await handleChat(m);
    }
    // 개발자 문장은 보이지 않는다(#159 A③ — "준비 중 오류 · undefined is not an object"): 한국어 한 줄 + 원인은 자동 보고(오류 경계 #141 §3)
    // 준비 실패(#229 보정 3) — 보이기 전에 준비 파일을 고치고 같은 메시지를 한 번 더. 또 실패하면 "준비 파일이 깨져 고쳤어요 · [다시]"
    catch (e) {
        const msg = String(e?.message ?? e).slice(0, 160);
        report("turn", "turn.prep_crash", `${msg} @ ${String(e?.stack ?? "").split("\n")[1]?.trim().slice(0, 120) ?? ""}`);
        if (WORK_ID.test(m.work)) {
            await repairMeta(m.work).catch(() => { });
            const again = await handleChat(m).then(() => true).catch(e2 => { report("turn", "turn.prep_crash2", String(e2?.message ?? e2).slice(0, 160)); return false; });
            if (!again)
                await postChat(m.work, [{ role: "event", text: "준비 파일이 깨져 고쳤어요 · 다시 보내 주세요", payload: { kind: "error", ai: "dynapse", retry: true } }]).catch(() => { });
        }
    }
    finally {
        active--;
    }
}
async function handleChat(m) {
    if (!WORK_ID.test(m.work))
        return;
    if (m.role === "user" && !String(m.id).startsWith("auto:")) {
        autoCont.delete(m.work);
        carryReply.delete(m.work);
        if (m.text || m.payload?.action === "continue-with")
            stoppedAt.delete(m.work);
    } // 사용자가 새로 말하면 [중단]이 풀린다(#311)
    // 다른 AI로 이어서(C5 ⑤ — 한도 카드 [이어서 하기] · "그럼 지피티가 해"): 마지막 요청을 그 AI로 다시. 받은 사실은 장부가 첫 줄에 싣는다
    if (m.role === "user" || m.payload?.action === "continue-with") {
        const F5 = await import("./facts.js"), to = m.payload?.action === "continue-with" ? String(m.payload.ai ?? "") : m.text ? F5.switchTo(m.text) : null, lr = lastReq.get(m.work);
        if (to && lr && ["chatgpt", "claude", "gemini"].includes(to)) {
            report("turn", "limit.continue", `to=${to}`);
            const cm = m.payload?.action === "continue-with" ? String(m.payload.model ?? "") : "", r0 = (lr.payload?.route ?? m.payload?.route ?? {});
            m = { ...m, role: "user", text: lr.text, payload: { ...(lr.payload ?? {}), route: { ...r0, ...(cm ? { models: { ...(r0.models ?? {}), [to]: { ...((r0.models ?? {})[to] ?? {}), model: cm } } } : {}), photo: (lr.payload?.route ?? m.payload?.route)?.photo ?? [], design: [to] }, continued: true } };
            await postChat(m.work, [{ role: "event", text: `${AI_LABEL[to]}로 하던 일을 이어서 해요`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
        }
        else if (m.role === "user" && m.text && lr && /^기본 모델로 다시 해 줘$/.test(m.text.trim())) {
            const r0 = (lr.payload?.route ?? m.payload?.route ?? {}), ai0 = (r0.design?.[0] ?? "chatgpt"), ms = { ...(r0.models ?? {}) };
            delete ms[ai0];
            report("turn", "model.default_retry", `ai=${ai0}`);
            m = { ...m, text: lr.text, payload: { ...(lr.payload ?? {}), route: { ...r0, models: ms } } };
        }
        else if (m.role === "user" && m.text && /^모델은 그대로 둘게요$/.test(m.text.trim())) {
            await postChat(m.work, [{ role: "agent", text: "그대로 둘게요 · 모델은 AI 줄에서 바꿀 수 있어요", payload: { ai: "dynapse", engine: true } }]).catch(() => { });
            return;
        }
        else if (m.role === "user" && m.text && !F5.factsOnly(m.text, F5.factsFromText(m.text)) && !F5.FIX_REMAINING.test(m.text))
            lastReq.set(m.work, { text: m.text, payload: m.payload });
    }
    // 장 동작은 모두 한 입구로(#143 §1) — 보고 있는 판·원문·언어판 따라가기는 pageOp가
    {
        const a = String(m.payload?.action ?? "");
        if (Object.hasOwn(PAGE_OPS, a)) {
            await pageOp(m.work, a, (m.payload ?? {}));
            return;
        }
    }
    if (m.payload?.action === "pull" && m.payload.round) {
        await pullCopy(m.work, m.payload.round);
        return;
    }
    if (m.payload?.shared)
        sharedWorks.add(m.work);
    // 휴지통 완전 삭제 + [이 PC 파일도 삭제](#21 보정 4) — 이 작업 폴더만 지우고 서버 마무리
    // [다시 올리기](#21 보정 14 C) — 이 작업의 마지막 커밋을 다시
    // 가져오기 저장(#22-보정 5) — 폴더에 넣은(또는 받아 올) 파일을 커밋하고 한 줄. 턴 없음
    if (m.payload?.action === "import-commit") {
        const p = m.payload;
        await importStart(m.work, { source: p.source, pull: p.pull, folder: p.folder });
        return;
    }
    if (m.payload?.action === "redo-edit") {
        await redoPending(m.work);
        return;
    }
    if (m.payload?.action === "open-claim") {
        await T().shell.open(`${HUB}/works/${encodeURIComponent(m.work)}?claim=1`).catch(() => { });
        return;
    } // 시스템 브라우저(초대를 연 계정의 쿠키) — 앱 창은 이 PC 계정이라 안 된다   // [계정 합치기](#186) — 브라우저(초대받은 계정)에서 잇기
    if (m.payload?.action === "adult-ok") {
        const h = heldAdult.get(m.work);
        if (h) {
            heldAdult.delete(m.work);
            await postChat(m.work, [{ role: "event", text: "확인했어요 · 이어서 할게요", payload: { kind: "stage", ai: "dynapse" } }]);
            await handleChat(h);
        }
        return;
    } // 19+ 확인 뒤 같은 요청 그대로(#205)
    if (m.payload?.action === "motif-set") {
        const q = m.payload;
        await applyMotif(m.work, { ...(q.size ? { size: q.size } : {}), ...(q.corner ? { corner: q.corner } : {}), ...(typeof q.off === "boolean" ? { off: q.off } : {}) });
        return;
    } // 패널의 쪽 번호 줄(#201)
    if (m.payload?.action === "photo-engine") {
        await photoEngine(m.work);
        return;
    } // 사진 카드 [이 PC 엔진 받기](#199)
    if (m.payload?.action === "photo-skip") {
        await photoSkip(m.work);
        return;
    } // 사진 카드 [사진 없이 계속](#199)
    if (m.payload?.action === "relogin") {
        const t = String(m.payload.tool ?? "claude");
        if (/^(claude|codex|agy)$/.test(t))
            await relogin(m.work, t);
        return;
    } // AI 로그인 풀림(#185)
    if (m.payload?.action === "undo-turn") {
        await undoTurn(m.work);
        return;
    } // ⌘Z가 AI 턴도(#150 ①)
    if (m.payload?.action === "redo-turn") {
        await redoTurn(m.work);
        return;
    }
    if (m.payload?.action === "compat") {
        await setCompat(m.work, !!m.payload.on);
        return;
    }
    if (m.payload?.action === "style-pack") {
        await applyStylePack(m.work, String(m.payload.pack ?? ""));
        return;
    }
    if (m.payload?.action === "brand-pack") {
        await applyBrandPack(m.work, String(m.payload.pack_id ?? ""));
        return;
    }
    if (m.payload?.action === "restore") {
        const sha = String(m.payload.sha ?? "");
        if (/^[0-9a-f]{7,40}$/.test(sha))
            await restoreTo(m.work, sha);
        return;
    }
    // 사진 패널(#31) — 내 것 고르기 · 새로 만들기(사진 AI만) · 한 줄 수정. 각각 요청 1 = 커밋 1(#30)
    // [제출하기](대표: "제출해줘"라고 말하는 건 어렵다) — 편집 리워드(표지 한 장·덱)를 앱이 결정적으로: 확인 → Claim → 올리기 → 제출. AI 호출 0
    // 글꼴(#36) — 모든 결과 페이지의 <style data-fonts> 블록을 바꾼다(AI 0 · 커밋 1)
    // 재고에 공유 토글(#49-보정 1) — 이 작업에 기억(사진 러너가 읽는다)
    // 넣은 문서(#70) — 긴 문서 요약 끄기(이 작업) · 못 읽은 문서 다시 색인
    if (m.payload?.action === "doc-summary-off") {
        await wput(m.work, ".dynapse/no-doc-summary.json", "true").catch(() => { });
        return;
    }
    if (m.payload?.action === "doc-reindex") {
        const n = m.payload.name;
        const r = await T().core.invoke("doc_index", { id: m.work, name: n ?? null }).catch(() => null);
        await postChat(m.work, [{ role: "event", text: r?.ok ? `색인했어요 · ${n}` : `읽지 못했어요 · ${n}${r?.reason ? ` · ${r.reason}` : ""}`, payload: { kind: r?.ok ? "stage" : "error", ai: "dynapse" } }]).catch(() => { });
        return;
    }
    if (m.payload?.action === "photo-share") {
        await wput(m.work, ".dynapse/photo-share.json", JSON.stringify({ on: m.payload.on === true })).catch(() => { });
        return;
    }
    // [복제](#56 보정 1) — 원본 폴더가 이 PC에 있으면 통째로 복사(받기 없이 바로 편집 · NOTES·TRACE·사진 포함), 없으면 서버 버전 받기
    if (m.payload?.action === "duplicate-from") {
        const from = String(m.payload.from ?? "");
        const series = m.payload.series ?? null;
        if (series)
            await wput(m.work, ".dynapse/series.json", JSON.stringify({ ...series, from, used: false })).catch(() => { });
        const srcAll = WORK_ID.test(from) ? await T().core.invoke("work_files", { id: from }).catch(() => []) : [];
        // 복사 범위(#56 보정 2) — 순서 파일(본편 + 부록)에 있는 장과 그 언어판만. 목록 밖의 옛 장은 원본에 두고 온다(복제본에서 AI가 "정리"하지 않게)
        // 묶음만 복사(#139 §4 — "Osaka 제출판" = 본편+부록만) — 고른 묶음의 장만. 기본 = 전체
        const pick = m.payload.bundles?.filter((x) => typeof x === "string") ?? [];
        const srcB = srcAll.length && pick.length ? (await bundlesOf(from).catch(() => [])).filter(b => pick.includes(b.name)) : [];
        const listed = srcB.length ? srcB.flatMap(b => b.pages) : srcAll.length ? [...((await readPages(from).catch(() => null)) ?? []), ...((await readJson(from, ".dynapse/appendix.json").catch(() => null)) ?? [])].filter(x => typeof x === "string") : [];
        const keepPage = (n) => !listed.length || listed.includes(baseOf(n));
        const isPg = (n) => PAGE_RE.test(n) || LANG_PAGE.test(n);
        const srcFiles0 = srcAll.filter(f => !isPg(f.name) || keepPage(f.name));
        const leftBehind = srcAll.filter(f => PAGE_RE.test(f.name) && !keepPage(f.name)).length;
        const srcFiles = srcFiles0.length ? [...srcFiles0, ...(await pageRefs(from, srcFiles0))] : srcFiles0; // 장이 가리키는 assets/… 재료도 함께
        const src = srcFiles.length ? await T().core.invoke("work_dir", { id: from }).catch(() => null) : null;
        if (!src) {
            await pullWork(m.work).catch(() => false);
            return;
        }
        active++;
        try {
            const dst = await T().core.invoke("work_dir", { id: m.work });
            await T().core.invoke("repo_init", { id: m.work }).catch(() => { });
            const fileUrl = (p) => `file:///${encodeURI(p.replace(/\\/g, "/").replace(/^\//, ""))}`;
            let n = 0, bad = 0;
            for (const f of srcFiles) {
                if (/^\.dynapse\/(session\.json|out\/|shots\/|tmp\/|pending-edits\.json|hand-edits\.json|photo-requests\.json|known-fonts\.json|pc-fonts\.json|series\.json|verbatim\.json)/.test(f.name))
                    continue;
                if (series && /^context\/(refs\/(url-[^/]+\.md|[^/]+\.url)|assets\/url-[^/]+|\.index\/url-)/.test(f.name))
                    continue; // 다음 회차(#83 §2) — 지난 회차의 글·대표 사진은 빼고
                const ok = await http("GET", fileUrl(`${src}/${f.name}`), { out: `${dst}/${f.name}` }).then(() => true).catch(() => false);
                if (ok)
                    n++;
                else
                    bad++;
            }
            // 고른 묶음만이면 순서·부록·묶음 파일을 그 장들로(#139 §4)
            if (srcB.length) {
                const apxB = srcB.find(b => b.name === "부록")?.pages ?? [];
                await wput(m.work, ".dynapse/appendix.json", JSON.stringify(apxB)).catch(() => { });
                await wput(m.work, BUNDLES, JSON.stringify(srcB.filter(b => b.name !== "본편" && b.name !== "부록"))).catch(() => { });
                await wput(m.work, ".dynapse/pages.json", JSON.stringify(listed)).catch(() => { });
                await wput(m.work, ".dynapse/order-lock.json", JSON.stringify({ order: listed, at: Date.now() })).catch(() => { });
                await normalizeOrder(m.work, listed.filter(f => !apxB.includes(f))).catch(() => null);
            }
            await repoCommit(m.work, `복제 · ${from}${srcB.length ? ` · ${srcB.map(b => b.name).join("+")}` : ""}`);
            await api("POST", "/api/works", { id: m.work, status: "done", local_path: dst, device_id: S.deviceId }).catch(() => { });
            // 서버 사본은 원본의 마지막 저장 버전이다 — 이 PC 사본(보이던 그대로: 저장 전 글꼴·직접 수정 포함)을 곧바로 올려 둘이 같게(2026-10-12 "복제하니 폰트가 바뀌었다")
            if (m.payload.server || m.payload.origin_synced || S.sync || sharedWorks.has(from))
                await pushWork(m.work, dst).catch(() => { });
            const nApx = srcB.length ? (srcB.find(b => b.name === "부록")?.pages.length ?? 0) : ((await readJson(from, ".dynapse/appendix.json").catch(() => null)) ?? []).length, nMain = srcFiles0.filter(f => PAGE_RE.test(f.name)).length - nApx;
            await postChat(m.work, [{ role: "event", text: `이 PC에 복사했어요 · 장 ${nMain}${nApx ? ` · 부록 ${nApx}` : ""}${leftBehind ? ` · 옛 파일 ${leftBehind}개는 두고 옴` : ""}${bad ? ` · ${bad}개 실패` : ""}`, payload: { kind: "download", ai: "dynapse", state: "done", done: n, total: n + bad } }]);
            void afterSave(m.work);
        }
        catch (e) {
            await postChat(m.work, [{ role: "event", text: `복사하지 못했어요 · ${String(e).slice(0, 60)}`, payload: { kind: "download", ai: "dynapse", state: "fail", reason: "복사 실패" } }]);
            await pullWork(m.work).catch(() => false);
        }
        finally {
            active--;
        }
        return;
    }
    // 글꼴 패널 열기·↻(#58) — 이 PC 글꼴 전부를 그 작업 폴더 .dynapse/pc-fonts.json에(웹이 이 PC에서 읽는다)
    if (m.payload?.action === "fonts-scan") {
        await pcFontsFor(m.work, !!m.payload.force).catch(() => { });
        return;
    }
    // 웹폰트 주소(#58) — 폰트 패널에 붙여넣은 주소를 받아 이 작업의 글꼴로(AI 0)
    // 덱 그림 톤(#196 보정 1) — [이 그림 톤으로 덱 통일] · 다른 그림 다시 · 끄기 · 문장 바꾸기("덱 전체 그림 톤을 ○○로")
    if (m.payload?.action === "style-from" || m.payload?.action === "style-regen" || m.payload?.action === "style-off" || m.payload?.action === "style-set") {
        active++;
        try {
            await styleAction(m.work, m.payload);
        }
        finally {
            active--;
        }
        return;
    }
    if (m.role === "user" && m.text) {
        const sm = m.text.match(/(덱|전체|모든)[^\n]{0,12}(그림|이미지|일러스트)[^\n]{0,6}톤[을를]?\s*(.{2,80}?)\s*(으로|로)\s*(바꿔|맞춰|통일|해)/);
        if (sm) {
            active++;
            try {
                await styleAction(m.work, { action: "style-set", sentence: `Deck image style (keep every image in this deck the same): ${sm[3]}; no text, no logos.`, regen: true });
            }
            finally {
                active--;
            }
            return;
        }
    }
    if (m.payload?.action === "font-url") {
        const url = String(m.payload.url ?? "");
        active++;
        try {
            const r = await importWebFont(m.work, url);
            await postChat(m.work, [{ role: "event", text: r.ok ? `글꼴 받았어요 · ${r.families.slice(0, 3).join(", ")} · 글꼴 패널 "이 작업 글꼴"에서 고르세요` : `글꼴을 받지 못했어요 · ${r.why}`, payload: { kind: r.ok ? "stage" : "error", ai: "dynapse", ...(r.ok ? { fonts: r.families } : {}) } }]);
            if (r.ok)
                void afterSave(m.work);
        }
        finally {
            active--;
        }
        return;
    }
    // 칸 글 제안(#276 보정 1 ⑤) — 패널의 [줄이기 제안]·[제목 다른 표현]: 그 칸 글만 같은 회사 AI에 한 번(도구 없음 · JSON) → 고를 것 셋을 이벤트로(캔버스가 패널에 보인다). 장은 고치지 않는다
    if (m.payload?.action === "slot-suggest") {
        const q = m.payload;
        const text = String(q.text ?? "").slice(0, 400), max = Math.max(4, Math.min(200, Number(q.max) || Math.ceil([...text].length * 0.7))), titles = q.mode === "titles";
        if (text && q.slot && /^[a-z0-9_#]{1,40}$/i.test(q.slot) && PAGE_RE.test(q.file ?? "")) {
            active++;
            try {
                const prompt = titles ? `Give three alternative titles for this slide title, each at most ${max} characters, same language and facts, different angles (a number, a benefit, a question or a plain claim). Answer {"options":["…","…","…"]}.\nTitle: ${JSON.stringify(text)}${q.context ? `\nPage context: ${JSON.stringify(String(q.context).slice(0, 300))}` : ""}`
                    : `Shorten this text to at most ${max} characters, same meaning and language, keep numbers and names; give three versions from mildest to shortest. Answer {"options":["…","…","…"]}.\nText: ${JSON.stringify(text)}`;
                const r = await auxRun(m.work, prompt, (await readJson(m.work, ".dynapse/team.json").catch(() => null))?.merge === "chatgpt" ? "chatgpt" : "claude").catch(() => null);
                const opts = Array.isArray(r?.json?.options) ? r.json.options.filter((x) => typeof x === "string" && !!x.trim() && [...x].length <= max + 4).slice(0, 3) : [];
                await postChat(m.work, [{ role: "event", text: null, payload: { kind: "slot-suggest", ai: "dynapse", file: q.file, slot: q.slot, mode: titles ? "titles" : "shorten", options: opts, ms: r?.ms ?? null } }]).catch(() => { });
                report("turn", "slot.suggest", `mode=${titles ? "titles" : "shorten"} n=${opts.length} ms=${r?.ms ?? -1}`);
            }
            finally {
                active--;
            }
        }
        return;
    }
    // 덱 색(#273 ② 디자인 띠) — 서버가 만든 토큰 글을 모든 장(언어판 포함)의 토큰 블록에 · 잠금(from user) · 직접 수정 한 건(⌘Z 한 번). AI 0
    if (m.payload?.action === "set-palette") {
        const q = m.payload;
        if (q.tokens && /--color-semantic-/.test(q.tokens) && q.tokens.length < 20_000 && !/<\/?style/i.test(q.tokens)) {
            active++;
            const t0 = Date.now();
            try {
                const e = { t: "palette", tokens: q.tokens.trim(), id: String(q.id ?? "custom").slice(0, 40), label: String(q.label ?? "색").slice(0, 40) };
                const names = (await T().core.invoke("work_files", { id: m.work }).catch(() => [])).filter(f => f.size > 0).map(f => f.name).filter(n => PAGE_RE.test(n) || LANG_PAGE.test(n));
                let n = 0;
                for (const f of names) {
                    const h = await wget(m.work, f).catch(() => null);
                    if (!h || /<style\b[^>]*\bdata-brand\b/i.test(h))
                        continue;
                    const out = applyEdit(h, e);
                    if (out !== h) {
                        await wput(m.work, f, out);
                        n++;
                    }
                }
                if (n) {
                    await syncPaletteLock(m.work);
                    await addPending(m.work, e);
                }
                report("turn", "palette.user", `id=${e.id} pages=${n} ms=${Date.now() - t0}`);
            }
            finally {
                active--;
            }
        }
        return;
    }
    if (m.payload?.action === "set-font") {
        const q = m.payload;
        if (q.block && /^<style data-fonts\b/.test(q.block)) {
            active++;
            try {
                const blk = await expandWorkFonts(m.work, q.block);
                if (await setFonts(m.work, blk))
                    await addPending(m.work, { t: "font", block: blk, label: String(q.label ?? "글꼴").replace(/^글꼴 · /, "Aa ").slice(0, 40) });
            }
            finally {
                active--;
            }
        }
        return;
    } // 모아 저장(#46)
    // 직접 수정 묶음(#46) — [보내기](빈 입력) = 저장 · 칩 × = 그 항목만 되돌리기
    if (m.payload?.action === "save-edits") {
        await savePending(m.work);
        return;
    }
    // [보고하기](진단, 대표 2026-10-04) — 이 작업의 최근 실패를 로그 전체와 함께 보낸다(사용자가 누를 때만)
    if (m.payload?.action === "report-error") {
        const ok = await diagReport({ work: m.work, note: String(m.payload.note ?? "") });
        await postChat(m.work, [{ role: "event", text: ok ? "보고했어요 · 고마워요" : "보고하지 못했어요 · 연결을 확인해 주세요", payload: { kind: ok ? "stage" : "error", ai: "dynapse", reported: true } }]).catch(() => { });
        return;
    }
    if (m.payload?.action === "stop") {
        await stopWork(m.work);
        return;
    } // ■ 중단(#50)
    if (m.payload?.action === "undo-edit") {
        if (m.payload.last) {
            await undoLast(m.work);
            return;
        }
        const i = Number(m.payload.i);
        if (Number.isInteger(i) && i >= 0)
            await undoPending(m.work, i);
        return;
    }
    // [이 버전으로 교체] — 통과한 리워드를 지금 버전으로 교체 제출(검토 뒤 공개본이 바뀐다 · Reward 없음)
    if (m.payload?.action === "replace-reward") {
        const q = m.payload;
        const t = String(q.task_id ?? ""), r = String(q.replaces ?? "");
        if (/^task_[a-z0-9]+$/i.test(t) && /^sub_[a-z0-9]+$/i.test(r)) {
            active++;
            try {
                await submitReward(m.work, t, r);
            }
            finally {
                active--;
            }
        }
        return;
    }
    if (m.payload?.action === "submit-reward") {
        const t = String(m.payload.task_id ?? "");
        if (/^task_[a-z0-9]+$/i.test(t)) {
            const t0 = Date.now();
            active++;
            try {
                await submitReward(m.work, t, undefined, m.payload.force === true);
            }
            finally {
                active--;
                void actionMetric(m.work, "reward", t0);
            }
        }
        return;
    }
    // [공개]·[최신 버전 공개](대표: 처음 것이 공개돼 있다 — 최신으로 바꾸려면?) — 앱이 결정적으로: 확인 → 올릴 파일(사진 넣음·큰 사진 JPEG) → 페이지 전부 PUT → 공개 신청. AI 0
    if (m.payload?.action === "publish-latest") {
        const t0 = Date.now();
        active++;
        try {
            await publishLatest(m.work);
        }
        finally {
            active--;
            void actionMetric(m.work, "publish", t0);
        }
        return;
    }
    // [1장]·[2장]·[전부](#49 B) — 남겨 둔 사진 칸을 누른 만큼(사진 AI만 · 커밋 1)
    if (m.payload?.action === "fill-photos") {
        const n = Math.max(1, Math.min(8, Number(m.payload.n) || 1));
        const t0 = Date.now();
        active++;
        try {
            const ais = await runPhotoRequests(m.work, m.payload.route, { pending: true, cap: n });
            if (ais.length) {
                await clickRound(m.work, `사진 ${n >= 8 ? "전부" : `${n}장`}`, ais);
                void afterSave(m.work);
            }
        }
        finally {
            active--;
            void actionMetric(m.work, "fill", t0, { points: n, ok: photoStats.get(m.work)?.n ? true : false });
        }
        return;
    }
    // 회사 자료함의 사진을 이 작업 칸에(2026-10-07) — 자료함 폴더에서 이 작업 context/assets로 복사(같은 이름이면 -2…) 뒤 use-file과 같은 길. 자료함 원본은 그대로
    // 자료함 출처 상태(2026-10-07) — 웹이 자료함을 열 때 묻는다. 지금 커넥터 상태 카드 하나(Google Drive · 이 PC의 다운로드 폴더)
    if (m.payload?.action === "connector-status") {
        await postConnectorStatus(m.work, true);
        return;
    }
    // [다시 확인] — 연결하고 돌아온 사용자가 누른다. 연결됐으면 기다리던 요청을 이어서
    // [Drive 없이 진행]·[요청 취소](2026-10-09 대표 "잘 되고 있는 거 맞아?" — Drive 연결을 기다리는 요청이 "살펴보는 중"으로만 보였다).
    // 진행 = 웹이 그 요청 글을 다시 보낸다(기다리던 요청은 앱 메모리에만 있어 재시작·화면 업데이트 뒤엔 없을 수 있다) — Drive 링크는 출처로만 적고 나머지를 한다
    if (m.payload?.action === "connector-skip") {
        const q = m.payload;
        const h = held.get(m.work);
        held.delete(m.work);
        const text = String(q.text ?? h?.text ?? "").slice(0, 8000);
        if (!text)
            return;
        await postChat(m.work, [{ role: "event", text: "Drive 없이 진행해요 · Drive 링크는 출처로만 적어 둬요", payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
        await handleChat({ ...(h ?? m), role: "user", text, payload: { ...(h?.payload ?? {}), library: true, no_drive: true, ...(q.route ? { route: q.route } : {}) } });
        return;
    }
    // ChatGPT(Codex)로 Drive 연결 — 터미널에 Codex를 열고 /plugins 안내(공식 Google Drive 플러그인). 돌아오면 저절로 다시 확인
    if (m.payload?.action === "connect-drive") {
        await T().core.invoke("open_login", { tool: "codex-drive" }).catch(() => postChat(m.work, [{ role: "event", text: "Codex 창을 열지 못했어요 · 앱을 업데이트해 주세요", payload: { kind: "error", ai: "dynapse" } }]));
        void watchConnector(m.work);
        return;
    }
    if (m.payload?.action === "connector-cancel") {
        held.delete(m.work);
        await postChat(m.work, [{ role: "event", text: "기다리던 요청을 취소했어요", payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
        return;
    }
    if (m.payload?.action === "connector-recheck") {
        const v = await driveConnector(true);
        await postConnectorStatus(m.work, false, v);
        if (v === "ok")
            await resumeHeld(m.work);
        return;
    }
    // 폴더 자료를 새 작업으로(이 자료로 만들기) — 문서는 context/refs, 사진은 context/assets로 복사. 폴더 원본은 그대로, 폴더 자료에 "쓰인 작업"(used_in)으로 남긴다
    if (m.payload?.action === "copy-library") {
        const q = m.payload;
        if (!q.from || !WORK_ID.test(q.from) || !Array.isArray(q.files))
            return;
        await ensureFolderHere(q.from);
        const src = await T().core.invoke("work_dir", { id: q.from }).catch(() => null), dst = await T().core.invoke("work_dir", { id: m.work }).catch(() => null);
        if (!src || !dst)
            return;
        const fileUrl = (p) => `file:///${encodeURI(p.replace(/\\/g, "/").replace(/^\//, ""))}`;
        let n = 0;
        for (const f of q.files.slice(0, 40)) {
            if (!/^context\/(refs|assets)\/[^/]+$/.test(f) || f.includes(".."))
                continue;
            if (await http("GET", fileUrl(`${src}/${f}`), { out: `${dst}/${f}` }).then(() => true).catch(() => false))
                n++;
        }
        await postChat(m.work, [{ role: "event", text: `폴더에서 ${n}개 가져왔어요`, payload: { kind: "stage", ai: "dynapse" } }]);
        await markUsed(q.from, q.files, m.work);
        void T().core.invoke("doc_index", { id: m.work, name: null }).catch(() => { }); // 가져온 문서 색인(다음 턴 머리 줄)
        return;
    }
    // 장 띠에서 끌어 순서 바꾸기(#97) — pages.json을 그 순서로 쓰고 쪽번호를 다시 매긴 뒤 커밋(되돌리기 = 버전)
    // 아래가 빈 장 답(#314 ③) — [채우기]는 그 장들을 채우라는 AI 요청으로, [그대로 두기]는 AI 없이 한 줄. 물어본 뒤에만
    if (m.role === "user" && (m.text?.trim() === FILL_YES || m.text?.trim() === FILL_NO)) {
        const of = await readJson(m.work, FILL_FILE).catch(() => null);
        if (of?.pages?.length && Date.now() - (of.at ?? 0) < 86_400_000) {
            await wput(m.work, FILL_FILE, JSON.stringify({ ...of, pages: [], answered: m.text.trim(), at: Date.now() })).catch(() => { });
            if (m.text.trim() === FILL_NO) {
                report("turn", "underfill.keep", "");
                await postChat(m.work, [{ role: "agent", text: "그대로 둘게요", payload: { ai: "dynapse", engine: true } }]).catch(() => { });
                return;
            }
            report("turn", "underfill.fill", `n=${of.pages.length}`);
            m = { ...m, text: `[Fill request — the lower part of these pages is empty: ${of.pages.join(", ")}. Fill each with content from the user's text (another item, a short summary row, a supporting visual) or label-only blanks like [가격] for missing facts. Keep the layout and the type sizes — do not scale text up to fill. Edit only these pages.] 아래가 빈 장을 채워 줘` };
        }
    }
    // 주인공 시트 답(#304 보정 2 ②) — 결정 칸의 [주인공 그림 만들기]·[그림 없이]. 물어본 뒤에만(그 밖의 같은 글은 보통 요청)
    {
        const H = await import("./hero-sheet.js"), t = (m.text ?? "").trim();
        if (m.role === "user" && (t === H.HERO_MAKE || t === H.HERO_SKIP)) {
            const hf = await readJson(m.work, H.HERO_FILE).catch(() => null);
            // 이미 만든(만드는) 뒤 같은 버튼 글은 AI로 보내지 않는다(#314 ⑤) · 실패 뒤 [주인공 그림 만들기]는 다시 만들기
            if (hf?.status === "made" && Date.now() - (hf.at ?? 0) < 600_000) {
                report("turn", "hero.dup", t === H.HERO_SKIP ? "skip" : "make");
                return;
            }
            if (hf?.status === "fail" && t === H.HERO_MAKE) {
                await heroMake(m.work, hf);
                return;
            }
            if (hf?.status === "ask") {
                if (t === H.HERO_SKIP) {
                    await wput(m.work, H.HERO_FILE, JSON.stringify({ ...hf, status: "skip", at: Date.now() })).catch(() => { });
                    report("turn", "hero.skip", "");
                    await postChat(m.work, [{ role: "agent", text: "주인공 그림 없이 갈게요", payload: { ai: "dynapse", engine: true } }]).catch(() => { });
                    return;
                }
                await heroMake(m.work, hf);
                return;
            }
        }
    }
    // 빠진 사실 카드(#302 B ①) — 받은 값은 엔진이 [빈칸]에 바로(AI 0) · [나중에]는 지금 빈칸을 다시 묻지 않음
    if (m.payload?.action === "facts-fill" || m.payload?.action === "facts-later" || m.payload?.action === "facts-keep") {
        const F = await import("./facts.js"), fj = (await readJson(m.work, FACTS).catch(() => null)) ?? { asked: [], got: {} };
        // [예시 그대로 쓰기] — 예시 글을 사용자가 받아들였다: 표시만 떼고 글은 남긴다(엔진 · AI 0) · 내보내기·공개가 풀린다
        if (m.payload.action === "facts-keep") {
            const pages = (await T().core.invoke("work_files", { id: m.work }).catch(() => [])).map(f => f.name).filter(n => /^result-[a-z0-9-]+(\.[a-z]{2})?\.html$/.test(n));
            let n = 0;
            for (const f of pages) {
                const h = await wget(m.work, f).catch(() => null);
                if (!h)
                    continue;
                const r = F.keepExamples(h);
                if (r.n) {
                    n += r.n;
                    await wput(m.work, f, r.html).catch(() => { });
                }
            }
            if (n) {
                await repoCommit(m.work, `예시 그대로 쓰기 · ${n}곳`);
                void afterSave(m.work);
            }
            report("turn", "facts.keep", `n=${n}`);
            await postChat(m.work, [{ role: "agent", text: n ? `예시 ${n}곳을 그대로 썼어요 · 이제 내보낼 수 있어요` : "그대로 쓸 예시가 없어요", payload: { ai: "dynapse", summary: [`예시 ${n}곳`], engine: true } }]).catch(() => { });
            return;
        }
        if (m.payload.action === "facts-later") {
            await wput(m.work, FACTS, JSON.stringify({ ...fj, later: [...new Set([...(fj.later ?? []), ...fj.asked])] })).catch(() => { });
            return;
        }
        const vals = Object.fromEntries(Object.entries((m.payload.values ?? {})).map(([k, v]) => [String(k).slice(0, 24), String(v ?? "").slice(0, 200).trim()]).filter(([, v]) => v));
        if (!Object.keys(vals).length)
            return;
        const pages = (await T().core.invoke("work_files", { id: m.work }).catch(() => [])).map(f => f.name).filter(n => /^result-[a-z0-9-]+(\.[a-z]{2})?\.html$/.test(n));
        let n = 0, left = 0;
        for (const f of pages) {
            const h = await wget(m.work, f).catch(() => null);
            if (!h)
                continue;
            const r = F.fillBlanks(h, vals);
            if (r.n) {
                n += r.n;
                await wput(m.work, f, r.html).catch(() => { });
            }
            left += F.blanksOf(r.n ? r.html : h).length;
        }
        const got = { ...fj.got, ...vals };
        await wput(m.work, FACTS, JSON.stringify({ ...fj, got })).catch(() => { });
        await writeFactsBrief(m.work, got, left);
        if (n) {
            await repoCommit(m.work, `빈칸 채우기 · ${n}곳`);
            void afterSave(m.work);
        }
        report("turn", "facts.fill", `n=${n} left=${left}`);
        await postChat(m.work, [{ role: "agent", text: n ? `빈칸 ${n}곳에 넣었어요${left ? ` · 남은 빈칸 ${left}개` : ""}` : "넣을 빈칸을 찾지 못했어요", payload: { ai: "dynapse", summary: [`빈칸 ${n}곳`], engine: true } }]).catch(() => { });
        return;
    }
    if (m.payload?.action === "page-restore-last") {
        await restoreLastPage(m.work);
        return;
    }
    // [만들기 시작](#140 §3) — 묶음별 생성 큐(자리 장을 개요대로 진짜 장으로)
    if (m.payload?.action === "plan-build") {
        const plan = (await readJson(m.work, ".dynapse/outline-plan.json").catch(() => null)) ?? [];
        const by = new Map(plan.map(x => [String(x.file), x]));
        const only = (await bundlesOf(m.work)).filter(b => b.name !== "부록").map(b => ({ bundle: b.name, pages: b.pages, ask: `Build these pages from the outline (they are placeholders now — replace each whole file with a real page; keep the file names): ${b.pages.map(f => `${f}: ${by.get(f)?.title ?? ""}${by.get(f)?.hero ? ` [evidence: ${by.get(f).hero}]` : ""}`).join(" | ")}` }));
        await startQueue(m.work, "개요대로 만들기", undefined, only);
        return;
    }
    // 찾기 결과 고치기(#140 추가 1) — 고른 항목(없으면 전부)을 묶음별 큐로(장 전체를 다시 쓰지 않는다) · [더 볼 묶음] = 그 묶음으로 찾기 턴 한 번 더
    if (m.payload?.action === "review-fix" || m.payload?.action === "review-more") {
        if (m.payload.action === "review-more") {
            const b = String(m.payload.bundle ?? "").slice(0, 30);
            if (b)
                void handleChat({ id: `auto:${Date.now()}`, work: m.work, role: "user", text: `검토해 줘 · ${b} 묶음`, payload: { review_bundle: b } });
            return;
        }
        const rv = await readJson(m.work, ".dynapse/review.json").catch(() => null);
        const all = rv?.items ?? [];
        const pick = (m.payload.items ?? []).filter(i => Number.isInteger(i) && all[i]);
        const its = (pick.length ? pick.map(i => all[i]) : all).filter(x => PAGE_RE.test(String(x.file)));
        if (!its.length)
            return;
        const bs = await bundlesOf(m.work), by = new Map();
        for (const x of its) {
            const b = bs.find(z => z.pages.includes(x.file))?.name ?? "본편";
            by.set(b, [...(by.get(b) ?? []), x]);
        }
        const only = [...by].map(([bundle, xs]) => ({ bundle, pages: [...new Set(xs.map(x => x.file))], ask: `Fix only these review items (change only what each says; keep everything else): ${xs.map(x => `${x.file} · ${x.where ?? ""} — ${x.what ?? ""}`).join(" | ")}` }));
        await startQueue(m.work, `검토에서 찾은 ${its.length}곳 고치기`, undefined, only);
        return;
    }
    // 묶음 큐(#140 §2) — [멈춤]은 지금 묶음이 끝나면 멈춘다 · [이어서]는 같은 자리부터 · [다시]는 못 한 묶음만 · [그만]은 남은 묶음을 버린다
    if (m.payload?.action === "queue-pause" || m.payload?.action === "queue-resume" || m.payload?.action === "queue-retry" || m.payload?.action === "queue-cancel") {
        const q = await readJson(m.work, QUEUE).catch(() => null);
        if (!q?.items?.length)
            return;
        const a = m.payload.action, n = q.items.length, done = q.items.filter(x => x.state === "done").length;
        if (a === "queue-pause")
            q.paused = true;
        if (a === "queue-resume")
            q.paused = false;
        if (a === "queue-retry") {
            q.paused = false;
            for (const x of q.items)
                if (x.state === "fail")
                    x.state = "wait";
        }
        if (a === "queue-cancel") {
            q.paused = true;
            q.items = q.items.filter(x => x.state !== "wait");
        }
        await wput(m.work, QUEUE, JSON.stringify(q)).catch(() => { });
        await postChat(m.work, [{ role: "event", text: a === "queue-pause" ? `멈춤 · 묶음 ${done}/${n} 끝 · 지금 묶음이 끝나면 멈춰요` : a === "queue-cancel" ? `남은 묶음을 그만뒀어요 · ${done}/${n} 끝` : `이어서 해요 · 묶음 ${done + 1}/${n}부터`, payload: { kind: "queue", ai: "dynapse", total: n, done, paused: q.paused, ...(a === "queue-cancel" ? { end: true } : {}) } }]).catch(() => { });
        if (!q.paused)
            await queueNext(m.work);
        return;
    }
    // 다시 넣기·묶음 옮기기·숨긴 장 정리(#139 §2·§3) — AI 없이 순서·묶음 파일 → 커밋 1
    // 다른 모양 보기(#119 보정 4) — 대안 2~3개를 AI 없이 짓고 썸네일까지(띠) · [이 모양으로]면 그때 장에 넣고 커밋 1
    // 차트(#102 보정 3) — 옛 판 다시 그리기(작업을 열 때) · 차트 칩(글자 단계·범례·값 표시·칸 높이)
    if (m.payload?.action === "viz-redraw") {
        await syncLatest(m.work, "open").catch(() => { });
        void catchUpLangs(m.work).catch(() => { });
        const { redrawCharts } = await import("./viz.js");
        await redrawCharts(m.work, "open").catch(() => 0);
        return;
    }
    // 키우기(#121 §3) — AI 없이: 장의 px·rem 크기를 k배로 다시 써서 검사, 넘치면 k를 0.9씩(3번까지) · 커밋 "키우기 ×k"
    // 다른 모양 보기에서 "이전으로"(#119 보정 3 §5) — 그 장만 칩 직전 커밋의 내용으로
    // 언어판 추가(#100 보정 2) — 캔버스 ··· 메뉴. 말로 한 요청과 같은 길(앱이 장을 복사하고 글만 번역)
    // 뒤에서 도는 일의 버튼(#151 보정 2) — [멈춤]·[지금 교체]·[건너뛰기]. 그 일을 맡은 곳이 등록한 동작만(없으면 아무것도)
    if (m.payload?.action === "bg-act") {
        const q = m.payload;
        bgAct(m.work, String(q.k ?? "").slice(0, 80), String(q.act ?? ""));
        return;
    }
    if (m.payload?.action === "lang-add") {
        const lg = langByCode(String(m.payload.lang ?? ""));
        if (lg) {
            active++;
            bgSet(m.work, { k: `lang:${lg.code}`, kind: "lang", text: `${lg.name}판 · 번역 중`, state: "run" });
            let ok = false;
            try {
                ok = await translateTurn(m.work, lg, m.payload?.route?.design?.[0] === "chatgpt" ? "chatgpt" : "claude").then(x => x !== false);
            }
            finally {
                active--;
                bgDone(m.work, `lang:${lg.code}`, `${lg.name}판 · ${ok ? "번역 끝" : "번역 못 함"}`);
            }
        }
        return;
    }
    if (m.payload?.action === "extract-inline") {
        const n = await extractInline(m.work, true).catch(() => 0);
        await postChat(m.work, [{ role: "event", text: n ? `장 안에 박힌 사진 ${n}장을 파일로 뺐어요 · 다시 올려요` : "뺄 사진이 없어요", payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
        const dir = await T().core.invoke("work_dir", { id: m.work }).catch(() => null);
        if (dir)
            await pushWork(m.work, dir);
        return;
    }
    // 덱 프레임 고치기(#119 보정 7) — 카드에서 고친 세 줄을 plan.json deck.frame에(AI 없음). 다음 무거운 턴부터 따른다
    if (m.payload?.action === "frame-set") {
        const q = m.payload;
        const pl = (await readJson(m.work, ".dynapse/plan.json").catch(() => null)) ?? {};
        const deck = { ...(pl.deck ?? {}), frame: { about: String(q.about ?? "").slice(0, 200), metaphor: String(q.metaphor ?? "").slice(0, 100), rule: String(q.rule ?? "").slice(0, 200) } };
        await wput(m.work, ".dynapse/plan.json", JSON.stringify({ ...pl, deck }, null, 2));
        await wput(m.work, ".dynapse/frame-shown.json", JSON.stringify([deck.frame.about, deck.frame.metaphor, deck.frame.rule])).catch(() => { });
        await postChat(m.work, [{ role: "event", text: "덱 프레임을 바꿨어요 · 다음 큰 수정부터 따라요", payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
        return;
    }
    if (m.payload?.action === "split-html") {
        await splitImported(m.work, true).catch(() => { });
        return;
    }
    if (m.payload?.action === "split-undo") {
        await splitUndo(m.work).catch(() => { });
        return;
    }
    if (m.payload?.action === "import-page") {
        const q = m.payload;
        if (typeof q.html === "string")
            await importPage(m.work, q.html, String(q.name ?? ""), typeof q.replace === "string" && PAGE_RE.test(q.replace) ? q.replace : undefined, q.explicit === true || typeof q.replace === "string").catch(e => postChat(m.work, [{ role: "event", text: `장으로 넣지 못했어요 · ${String(e?.message ?? e).slice(0, 80)}`, payload: { kind: "error", ai: "dynapse" } }]).catch(() => { }));
        return;
    }
    if (m.payload?.action === "pull-merge")
        return; // ota16 — 합쳐 올리기 없음
    if (m.payload?.action === "pull-take") {
        await syncLatest(m.work, "take").catch(() => { });
        return;
    }
    // 같은 장 카드(#56 보정 7) — [내 것으로 바꾸기] = 보관한 내 판을 그 장에 쓰고 커밋·올린다(지금 head 위라 빨리 감기) · [그대로]는 웹에서 닫기만
    if (m.payload?.action === "proposal-take") {
        const p = m.payload, file = String(p.file ?? ""), keep = String(p.saved ?? "");
        if (!/^(result-[a-z0-9-]+(\.[a-z]{2})?\.html|\.dynapse\/pages\.json)$/.test(file) || !/^\.dynapse\/out\/proposal--[^/]+$/.test(keep))
            return;
        const h = await wget(m.work, keep).catch(() => null);
        if (h == null) {
            await postChat(m.work, [{ role: "event", text: "보관한 내 판을 찾지 못했어요 · 버전 기록에서 되돌릴 수 있어요", payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
            return;
        }
        await wput(m.work, file, h);
        await repoCommit(m.work, `${pageLabel(file)} · 내 판으로 바꿈`);
        slog(m.work, "merge.take_mine", { file });
        const dir = await T().core.invoke("work_dir", { id: m.work }).catch(() => null);
        if (dir)
            await pushWork(m.work, dir).catch(() => { });
        return;
    }
    // [내 판으로](#56 보정 10) — 덮인 장을 이 PC 기록(그때 올린 커밋)의 판으로 되살려 새 커밋으로 올린다(빨리 감기 · 그 사이 바뀌었으면 합침)
    if (m.payload?.action === "page-mine") {
        const q = m.payload, file = String(q.file ?? ""), sha = String(q.sha ?? "");
        if (!/^result-[a-z0-9-]+(\.[a-z]{2})?\.html$/.test(file) || !/^[0-9a-f]{7,40}$/.test(sha))
            return;
        const h = await T().core.invoke("repo_show", { id: m.work, sha, file }).catch(() => null);
        if (h == null) {
            await postChat(m.work, [{ role: "event", text: "이 PC 기록에서 그 판을 찾지 못했어요 · 버전 띠에서 고를 수 있어요", payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
            return;
        }
        await syncLatest(m.work, "open").catch(() => false); // 먼저 지금 판으로(덮어쓸 장 말고는 최신이게)
        await wput(m.work, file, h);
        await repoCommit(m.work, `${pageLabel(file)} · 내 판으로`);
        slog(m.work, "page.mine", { file, sha: short(sha) });
        const dir = await T().core.invoke("work_dir", { id: m.work }).catch(() => null);
        if (dir)
            await pushWork(m.work, dir).catch(() => { });
        return;
    }
    // 작업을 열거나 새로고침할 때(#56 보정 6 추가) — 알림이 안 왔어도 서버 판을 확인해 같은 규칙으로 받는다
    if (m.payload?.action === "sync-check") {
        await syncLatest(m.work, "open").catch(() => { });
        return;
    }
    if (m.payload?.action === "meta-sync") {
        await metaSync(m.work).catch(() => { });
        return;
    } // 숨김·순서가 바뀌었다(#256 보정 1 ③)
    if (m.payload?.action === "pull-discard") {
        await syncLatest(m.work, "discard").catch(() => { });
        return;
    }
    // 무엇이 큰지 이름으로(#128 보정 5) — 사진이 아니면 그 파일 이름·크기
    if (m.payload?.action === "shrink-big") {
        const n = await shrinkBig(m.work).catch(() => 0);
        if (!n) {
            const big = (await T().core.invoke("work_files", { id: m.work }).catch(() => [])).filter(f => f.size > 4 * 1024 * 1024).sort((a, b) => b.size - a.size)[0];
            await postChat(m.work, [{ role: "event", text: big ? `사진은 다 4MB 아래예요 · 큰 것은 ${/^context\/refs\//.test(big.name) ? "참고 문서 " : ""}${big.name.split("/").pop()} ${(big.size / 1048576).toFixed(1)}MB예요` : "4MB 넘는 파일이 없어요", payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
        }
        else {
            const dir = await T().core.invoke("work_dir", { id: m.work }).catch(() => null);
            if (dir)
                await pushWork(m.work, dir).catch(() => { });
        }
        return;
    } // 옛 웹의 [작게 줄이기] — 결과 한 줄은 shrinkBig이
    if (m.payload?.action === "push") {
        const dir = await T().core.invoke("work_dir", { id: m.work }).catch(() => null);
        if (dir)
            await pushWork(m.work, dir);
        // [다시](#56 보정 8) — 동기화 기록 마지막 50개를 보고에 붙인다(이름·코드만, 글 없음 · 보고 한도 500자라 "사건:이유" 줄임)
        const tail = (await slogTail(m.work, 50).catch(() => []));
        report("sync", "sync.retry_log", `work=${m.work} ${tail.map(e => [e.ev, e.why ?? e.status ?? ""].filter(x => x !== "" && x != null).join(":")).join(" ")}`.slice(0, 500));
        return;
    } // 실패한 커밋은 remote_heads에 안 적혀 그대로 다시 올라간다
    // 이전 버전도 함께(#21 보정 15 B) — 작업별 옵션(상태 창). 켜면 이미지 버전 전부를 다음 올리기부터
    // 공유 켬(#38 — 작업실에서 −10P · 30일) — 이 작업을 지금 올리고, 앞으로 저장마다 올린다
    if (m.payload?.action === "share-on") {
        sharedWorks.add(m.work);
        const dir = await T().core.invoke("work_dir", { id: m.work }).catch(() => null);
        if (dir) {
            await shrinkBig(m.work).catch(() => 0);
            await pushWork(m.work, dir).catch(() => { });
        }
        return;
    } // 공유 켜기 — 큰 사진 먼저(#128 보정 3)
    if (m.payload?.action === "share-history") {
        await wput(m.work, ".dynapse/share.json", JSON.stringify({ history: !!m.payload.on }));
        const dir = await T().core.invoke("work_dir", { id: m.work }).catch(() => null);
        if (dir && (S.sync || sharedWorks.has(m.work)))
            await pushWork(m.work, dir);
        return;
    }
    // [편집 작업으로 가져가기](#22) — 사진 작업의 지금 사진(slots.json의 photo)을 새 편집 작업의 context/assets로
    // 내 작업에 넣기(#22-보정 9 B) — 서버가 확인한 공개 파일을 context/assets로 받아 커밋 + 한 줄(턴 없음)
    if (m.payload?.action === "copy-asset") {
        const p = m.payload;
        const name = (p.name ?? "photo.png").replace(/[^\p{L}\p{N}\-_. ()]/gu, "_").slice(0, 80);
        const dir = await T().core.invoke("work_dir", { id: m.work }).catch(() => null);
        if (!dir || !p.url || !/^https:\/\//.test(p.url))
            return;
        const g = await http("GET", p.url, { out: `${dir}/context/assets/${name}` }).catch(() => null);
        if (g?.status === 200) {
            await repoCommit(m.work, `가져옴 · ${name}`);
            await postChat(m.work, [{ role: "event", text: "사진 1장 추가", payload: { kind: "stage", ai: "dynapse", file: `context/assets/${name}` } }]);
        }
        return;
    }
    if (m.payload?.action === "copy-photo") {
        const from = String(m.payload.from ?? "");
        const slots = WORK_ID.test(from) ? await readJson(from, ".dynapse/slots.json").catch(() => null) : null;
        const file = slots?.photo;
        await T().core.invoke("work_dir", { id: m.work }).catch(() => { });
        // 파일 복사는 앱이 바로(#48 A — 사진을 base64로 IPC에 싣지 않는다)
        const ok = file ? await T().core.invoke("work_copy_file", { from, file, to: m.work, dest: "context/assets/photo.png" }).then(() => true).catch(() => false) : false;
        if (ok) {
            await repoCommit(m.work, "가져옴 · 사진 1장"); // 저장만(#22-보정 5)
            await postChat(m.work, [{ role: "event", text: "사진 1장 추가", payload: { kind: "stage", ai: "dynapse", file: "context/assets/photo.png" } }]);
        }
        return;
    }
    if (m.payload?.action === "delete-local") {
        await T().core.invoke("work_remove", { id: m.work }).catch(() => { });
        await api("DELETE", `/api/works/${encodeURIComponent(m.work)}`).catch(() => { });
        return;
    }
    // 위치 참조(#21 보정 7 B) — 웹 📎 [위치 참조] 또는 에이전트 요청 → 확인 창(경로가 오면)·폴더 고르기 → 링크 + 인덱스
    if (m.payload?.action === "link-folder") {
        // ~/… 는 홈으로(네이티브 canonicalize는 ~를 모른다 — "경로가 없어요"로 끝나던 것). 홈 = 작업 폴더(~/Dynapse/works/⟨id⟩)의 위
        let lp = m.payload.path ?? null;
        if (lp && /^~[\\/]/.test(lp)) {
            const wd = await T().core.invoke("work_dir", { id: m.work }).catch(() => "");
            const home = wd.replace(/[\\/]Dynapse[\\/]works[\\/][^\\/]+$/, "");
            if (home && home !== wd)
                lp = home + lp.slice(1);
        }
        const l = await T().core.invoke("link_add", { id: m.work, path: lp }).catch(e => { void postChat(m.work, [{ role: "event", text: String(e), payload: { kind: "error", ai: "dynapse" } }]); return null; });
        if (l) {
            await postChat(m.work, [{ role: "event", text: `참조 · ${l.name}`, payload: { kind: "stage", ai: "dynapse" } }]);
            await resolveRefs(m.work, true);
        }
        return;
    }
    // 서버가 합친 커밋·A안/B안 선택(#20 초대) → 최신 매니페스트대로 받아 이 기기 git에 커밋
    // 가져오기(#21, fork:true)는 받기만 — 올리기는 동기화·초대일 때만
    // 새 판 알림(#56 보정 3) — head가 실려 오면 내 판과 비교해 깨끗하면 바로 받고, 내 변경이 있으면 [가져오기] 카드
    if (m.payload?.action === "pull-latest" && typeof m.payload.head === "string") {
        sharedWorks.add(m.work);
        await syncLatest(m.work, "notice", m.payload.head).catch(() => { });
        return;
    }
    if (m.payload?.action === "pull-latest") {
        if (!m.payload.fork)
            sharedWorks.add(m.work);
        await pullWork(m.work).catch(e => postChat(m.work, [{ role: "event", text: `받지 못했어요 · ${String(e).slice(0, 60)}`, payload: { kind: "download", ai: "dynapse", state: "fail" } }]));
        return;
    }
    // 웹 채팅 카드 [Claude 로그인](#20 연결 전 CTA) — 공식 로그인 창만 연다(실행 없음). 로그인되면 기다리던 메시지가 이어서 돈다
    if (m.payload?.action === "login" && m.payload.switch) {
        const ai = m.payload.ai;
        await switchAccount(ai === "chatgpt" ? "codex" : ai === "gemini" ? "gemini" : "claude");
        return;
    }
    // 한 번에 연결(#142 추가 2) · 지금 단계 건너뛰기
    if (m.payload?.action === "login-all") {
        void import("./main.js").then(x => x.loginAll(m.work));
        return;
    }
    if (m.payload?.action === "login-skip") {
        void import("./main.js").then(x => x.loginSkip());
        return;
    }
    if (m.payload?.action === "login-code") {
        const q = m.payload;
        const c = String(q.code ?? "").trim();
        if (c) {
            if (q.ai === "gemini")
                await agyCode(c);
            else
                await loginPaste(q.ai === "chatgpt" ? "codex" : "claude", c);
        }
        return;
    } // 웹 연결 줄의 코드 칸(#204)
    if (m.payload?.action === "login") {
        const ai = m.payload.ai;
        if (ai === "gemini")
            await agyLogin();
        else
            await openLogin(ai === "chatgpt" ? "codex" : "claude");
        return;
    }
    // 대기 중인 직접 수정이 있으면 먼저 저장 커밋 → 그다음 이 요청(#46 순서 보장)
    if (m.role === "user")
        void import("./form-alts.js").then(x => x.cancelPrerender(m.work)).catch(() => { }); // 새 입력이면 미리 만들기 중단(#119 보정 9 §2)
    if (m.role === "user" && m.text)
        await savePending(m.work).catch(() => null);
    if (m.role === "user" && m.text)
        receivedAt.set(m.work, Date.now()); // 시간 분해 "받기"(#51)
    // 리워드 작업(#62 보정 1) — 서버가 요청마다 작업 번호를 붙인다. 이 작업의 턴은 리워드 규칙으로 검사(사진 칸 빼기 허용·빈 사진 칸 오류)
    {
        const rt = m.payload?.reward_task;
        if (m.role === "user" && rt)
            rewardWorks.set(m.work, rt);
    }
    {
        const rf = m.payload?.reward_forms;
        if (m.role === "user" && rf && Object.keys(rf).length)
            await seedPlan(m.work, rf).catch(() => { });
    } // 발주가 정한 형태(#127 보정 4)
    // 작업 지시는 덱 재료가 아니다(#140 추가 2) — 녹화·합치기·설치·지시서·명령어 블록이면 덱을 만들지 않고 한 줄 + [지시 복사] [이 글로 덱 만들기](force_deck). 장을 가리킨 요청·리워드·채우기는 그대로
    if (m.role === "user" && m.text && !m.payload?.force_deck && !rewardWorks.has(m.work) && !m.payload?.point?.length && !m.payload?.prefill?.length) {
        const ti = taskInstruction(m.text);
        if (ti) {
            await postChat(m.work, [{ role: "event", text: "디냅스는 덱을 만들어요 · 이 일은 Codex나 Claude Code 터미널에서 돼요", payload: { kind: "not-deck", ai: "dynapse", why: ti.why } }]);
            return;
        }
    }
    // 받는 즉시 한 줄(#45) — 첫 도구 이벤트까지 조용해 웹이 "앱이 받는 중"으로 오해하던 것. 앞에 이 작업의 턴이 돌고 있으면 "앞에 n개"
    if (m.role === "user" && m.text) {
        let ahead = 0;
        for (const [k, x] of sessions)
            if (k.startsWith(`${m.work}|`))
                ahead += (x.busy ? 1 : 0) + x.queue.length;
        await postChat(m.work, [{ role: "event", text: ahead ? `받았어요 · 앞에 ${ahead}개` : "받았어요", payload: { kind: "tool", ai: "dynapse", ack: true } }]).catch(() => { });
    }
    if (m.role === "user" && m.payload?.import)
        await importStart(m.work, m.payload.import);
    if (m.role === "user" && m.payload?.prefill?.length) {
        const tk = m.payload.prefill_tokens;
        if (tk)
            m.payload.prefill = [...m.payload.prefill, { file: "tokens.css", url: tk }];
        await postChat(m.work, [{ role: "event", text: m.payload.prefill.filter(p => p.file.endsWith(".html")).length > 1 ? "장 채우는 중" : "표지 채우는 중", payload: { kind: "tool", ai: "dynapse" } }]).catch(() => { });
        await applyPrefill(m.work, m.payload.prefill);
    }
    // 사진 작업(#22) — 편집 AI 없이 앱의 사진 러너가(작업마다 한 턴씩 차례로). 사진 AI가 없으면 연결되면 이어서
    if (m.role === "user" && m.text && m.payload?.kind === "photo") {
        // 사진 AI가 없으면 사다리(#199) — 일반 사진은 러너가 이 PC 엔진(받기 1회)까지 가고, 아무것도 안 될 때만 카드 하나("need" → 기다렸다가 이어서). 리워드는 발주의 AI만이라 연결을 기다린다
        if (!anyPhotoReady() && m.payload.task_id) {
            waiting.push({ id: m.work, text: m.text, opts: { route: m.payload?.route }, photo: m.payload.task_id });
            await postChat(m.work, [{ role: "event", text: null, payload: { kind: "need-ai", ai: "dynapse", cap: "photo", ways: { chatgpt: true, engine: null, skip: false } } }]);
            return;
        }
        // 멈춤 카드의 답(#22-보정 3) — "Gemini: ChatGPT로 이어서" → 그 AI로 같은 프롬프트 · 로그인 → 공식 로그인 뒤 이어서 · 다시 · 그만(아무것도 안 함)
        const ans = stopAnswer(m.text);
        if (ans?.stop)
            return;
        if (ans?.use && !photoReady(ans.use))
            ans.login = ans.use; // "Gemini로 다시"인데 연결 전 → 로그인 뒤 그 AI로
        if (ans?.login) {
            if (ans.login === "gemini")
                await agyLogin();
            else
                await openLogin("codex");
        }
        if (ans?.switch) {
            await postChat(m.work, [{ role: "event", text: "Google 계정 바꾸는 중 · 터미널에서 로그인해 주세요", payload: { kind: "stage", ai: "gemini" } }]);
            if (!(await switchAccount("gemini"))) {
                await postChat(m.work, [{ role: "event", text: "계정을 바꾸지 못했어요", payload: { kind: "error", ai: "gemini" } }]);
                return;
            }
        }
        const force = ans?.use ?? ans?.login ?? ans?.switch;
        const prev = photoQueue.get(m.work) ?? Promise.resolve();
        const pt0 = Date.now();
        const next = prev.then(() => runPhotoTurn(m.work, m.text, { route: m.payload?.route, taskId: m.payload?.task_id ?? null, ...(ans?.brief ? { briefOnly: true } : ans ? { resume: true, ...(force ? { force } : {}) } : {}) }))
            .then(r => { if (r === "need")
            waiting.push({ id: m.work, text: m.text, opts: { route: m.payload?.route }, photo: "" }); }).catch(e => postChat(m.work, [{ role: "event", text: String(e).slice(0, 80), payload: { kind: "error", ai: "dynapse" } }]));
        photoQueue.set(m.work, next);
        await next;
        void actionMetric(m.work, "photo_work", pt0, { len: m.text.length, ph: reqHash(m.text) });
        return;
    }
    // 가져다 놓은 템플릿의 첫 메시지(#21 보정) — 템플릿 지시를 턴 앞에 붙인다(사용자가 말했을 때만 첫 턴)
    const tpl = m.payload?.template;
    // 짚어서 말하기(#25 A) — 📍 요소가 붙어 오면 "그 요소만" 계약을 턴 앞에(파일 전체 읽기 금지 · 끝나면 전/후 한 줄)
    let pts = (m.payload?.point ?? []).slice(0, 5);
    // 짚기 확인(#299 — 대표가 Co-founder 줄을 짚었는데 장 전체(section.slide)로 잡혀 AI가 30초 쓰고 "그 글이 없어요"라고 했다).
    // 그릇으로 잡힌 짚기는 센다(0이어야 한다). 그릇 짚기에서 요청의 고유명사(대문자·하이픈 영문)가 그 장에 하나도 없으면 AI 없이 다시 짚기를 부탁한다
    if (m.role === "user" && pts.some(p => p.container))
        report("turn", "point.container_fallback", `${pts[0]?.file ?? "-"} ${String(pts[0]?.selector ?? "").slice(0, 60)}`);
    // 그릇 짚기만 · 따옴표 안 글은 넣을 글이라 보지 않는다(turn-sim pinWords — "“토요일 오후 2시”"는 글자 교체다)
    if (m.role === "user" && m.text && pts.length && pts.every(p => p.container)) {
        const words = [...new Set((m.text.replace(/["“‘「][^"”’」]*["”’」]/g, " ").match(/\b[A-Za-z]*[A-Z-][A-Za-z0-9-]*\b/g) ?? []).filter(w => /[A-Za-z]{2}/.test(w)))].map(w => w.toLowerCase());
        if (words.length) {
            const html = (await wget(m.work, pts[0].file).catch(() => null)) ?? "", txt = html.replace(/<style\b[\s\S]*?<\/style\s*>|<script\b[\s\S]*?<\/script\s*>/gi, " ").replace(/<[^>]+>/g, " ").toLowerCase();
            if (html && !words.some(w => txt.includes(w))) {
                report("turn", "point.precheck_miss", words.slice(0, 4).join(","));
                await postChat(m.work, [{ role: "event", text: `짚은 장에 ${words.slice(0, 2).map(w => `"${w}"`).join("·")} 글이 없어요 · 그 줄을 다시 짚어 주세요`, payload: { kind: "stage", ai: "dynapse", repin: true } }]).catch(() => { });
                return;
            }
        }
    }
    // 그대로 둘 이름(#234 ①) — 사용자가 쓴 라틴 이름은 모은다 · "영어로 바꾸지 마"·"그대로 둬"는 그 말(📍 글 포함)의 이름을 더하고, 그 말뿐이면 AI 턴 없이 한 줄
    let keepHead = "";
    if (m.role === "user" && m.text && WORK_ID.test(m.work)) {
        const TM = await import("./terms.js"), t0 = await readJson(m.work, ".dynapse/terms.json").catch(() => null);
        const said = [...TM.namesIn(m.text), ...(m.text.match(/["'“‘「]([A-Za-z][A-Za-z0-9 .&-]{1,28})["'”’」]/g) ?? []).map(x => x.slice(1, -1).trim())];
        const asked = TM.KEEP_ASK.test(m.text) ? [...said, ...pts.flatMap(p => TM.namesIn(`가 ${p.text ?? ""}`))] : said;
        let t1 = asked.length ? TM.mergeTerms(t0, asked, TM.KEEP_ASK.test(m.text) ? "fixed" : "user") : t0;
        if (t1 && TM.RENAME_ASK.test(m.text)) {
            const gone = t1.keep.filter(k => m.text.includes(k) && !said.slice(-1).includes(k));
            if (gone.length)
                t1 = { keep: t1.keep.filter(k => !gone.includes(k)), src: t1.src };
        }
        if (t1 && JSON.stringify(t1) !== JSON.stringify(t0))
            await wput(m.work, ".dynapse/terms.json", JSON.stringify(t1, null, 1)).catch(() => { });
        if (TM.KEEP_ASK.test(m.text) && m.text.replace(TM.KEEP_ASK, "").replace(/[A-Za-z0-9"'“”‘’「」.,!~\s·은는이가을를도요]/g, "").length < 6) {
            await postChat(m.work, [{ role: "event", text: asked.length ? `그대로 둘게요 · ${[...new Set(asked)].slice(0, 6).join("·")} · 모든 언어판에서` : "그대로 둘 이름을 따옴표로 적어 주세요 · 예: \"BizCrush\" 그대로 둬", payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
            return;
        }
        keepHead = TM.keepLine(t1);
    }
    // 가리키는 말인데 📍가 없으면(#233 ① — "여기 섹션"·"이 항목 위에"·"저 서비스들", point:null로 AI가 선택 파일을 찾아 헤맸다): 지난 턴에 고친 자리(30분 안)를 대상으로 + 한 줄 "여기 맞아요?"(토큰 0)
    let guessed = false;
    if (m.role === "user" && !pts.length && m.text && DEMON.test(m.text) && !DECK_STRUCT.test(m.text)) {
        const le = lastEdit.get(m.work);
        if (le && Date.now() - le.at < 30 * 60_000) {
            pts = [le.pt];
            guessed = true;
            report("turn", "turn.point_guess", le.pt.slot ?? "page");
            await postChat(m.work, [{ role: "event", text: `📍 ${pageKey(le.pt.file)}${le.pt.slot ? ` · ${le.pt.slot}` : ""} — 여기 맞아요? 아니면 장에서 다시 짚어 주세요`, payload: { kind: "stage", ai: "dynapse", points: [le.pt] } }]).catch(() => { });
        }
    }
    if (m.role === "user" && pts.length)
        lastPin.set(m.work, { pts, at: Date.now(), route: m.payload?.route ?? null }); // 같은 자리 이어서(#99 보정 2)
    let pointed = pts.length ? `[📍 skill §3-0: find by selector; new photo → .dynapse/photo-requests.json; reply first "📍 <page> · <slot>: <what changed>". A pointed chart (an element with data-viz) changes its data only in its data-viz JSON; for its look, write the action names to .dynapse/viz-actions.json as [{\"file\":\"result-….html\",\"slot\":\"<data-slot>\",\"do\":[…]}] and the app applies them: 좌우로 꽉·넓게·제목에 맞춰 → \"full-width\"; 글씨 키워 → \"text:l\" (아주 크게 → \"text:xl\", 보통 → \"text:m\"); 그림 크게·높게 → \"box:+\"; 줄여·낮게 → \"box:-\"; 범례 빼 → \"legend:off\" (넣어 → \"legend:on\"); 값 빼 → \"values:off\" (넣어 → \"values:on\"). Never write chart CSS or width/max-width/margin on the box yourself; the app redraws it; never claim a chart change you could not make. Reply to the user in Korean.]\n${pts.map((p, i) => `${i + 1}. file=${p.file} selector=${p.selector}${p.slot ? ` slot=${p.slot}` : ""}\n   source: ${(p.snippet ?? "").replace(/\s+/g, " ").slice(0, 400)}`).join("\n")}\nRequest: ` : "";
    // 📍 + 짧은 말만(2026-10-16 대표 "위치를 찍어서 지시했는데 아직도" — "언어 음성 제공"을 보냈더니 AI가 "어느 페이지, 어느 부분에?"라고 되물었다):
    // 동사 없는 짧은 말은 그 자리에 들어갈 글이다 — 그렇게 못 박고, 📍가 있으면 어디냐고 묻지 않게
    let pinHint = "";
    if (m.role === "user" && pts.length && m.text) {
        const t0 = m.text.trim();
        // 글자 교체는 따옴표로 감싼 문구만(#192 — "제대로 위치 잡아봐"·"…안 보이는데"를 교체 글로 읽고 멈췄다). 명령·불만·질문·애매하면 지시로(⌘Z가 있다)
        const qm = t0.match(/^\s*["“'‘«「『]([^\n]{1,200})["”'’»」』]\s*$/), bare = !!qm;
        pinHint = `[The 📍 is the place — never ask which page, slide or element.${bare ? ` The user typed only this phrase while pointing: replace the text of the pointed element with «${(qm?.[1] ?? t0).replace(/[«»]/g, "")}» (keep its style; if it is a list item, replace that item).` : ""}]\n`;
    }
    // 글꼴 한 줄(#36) — 카탈로그 안에서 두 id만 고르게. 페이지를 열지 않는다(토큰 적게)
    const font = m.payload?.font;
    // 이 PC 글꼴도 카탈로그에(#49 C · #36 추가 2) · 지금 폰트를 알려 말하지 않은 쪽(제목/본문)은 그대로 두게
    const pcFonts = font ? (await pcFontsFor(m.work).catch(() => [])).filter(f => f.kr).slice(0, 30).map(f => `local:${f.family} (${f.family}, 이 PC)`).join(", ") : "";
    const workFonts = font ? (await T().core.invoke("work_files", { id: m.work }).catch(() => [])).map(f => f.name.match(/^context\/fonts\/([^/]+)\/font\.json$/)?.[1]).filter((x) => !!x).map(d => `work:${d.replace(/_/g, " ")} (${d.replace(/_/g, " ")}, 이 작업)`).join(", ") : "";
    const curBlock = font ? ((await wget(m.work, "result-cover.html").catch(() => null)) ?? "").match(/<style\b[^>]*\bdata-fonts\b[^>]*>/i)?.[0] ?? "" : "";
    const cur = curBlock ? `current: display=${curBlock.match(/data-display="([^"]+)"/)?.[1] ?? "?"}, body=${curBlock.match(/data-body="([^"]+)"/)?.[1] ?? "?"}` : "current: layout default";
    const fontAsk = font ? `[Font request — change fonts only. Do not open, read or edit any page or tokens file. Pick a display (titles) and a body font only from this catalog: ${font}${pcFonts ? `, ${pcFonts}` : ""}${workFonts ? `, ${workFonts}` : ""}. ${cur}; keep the one the user did not mention. Match names loosely (spaces, case, Korean/English: 나눔고딕 = nanum-gothic, 프리텐다드 = pretendard). Write .dynapse/font-pick.json as {"display":"<id>","body":"<id>","why":"<one Korean line>"}; the app applies it to every page after your turn. If the named font is not in the catalog, pick the closest and say so in Korean ("이 폰트는 없어요 · 비슷한 ⟨이름⟩으로 바꿨어요"). Reply to the user in Korean with that one line.]\nRequest: ` : "";
    const hand = m.role === "user" && m.text ? (await handEditsPrefix(m.work).catch(() => "")) + (await lintOkPrefix(m.work).catch(() => "")) : "";
    // 배치·구조를 바꾸라는 말이면 그 장은 "손으로 고친 장"에서 뺀다(2026-10-22 21-landscape — 손 고친 장이라 verify hand_lost가 "옛 id를 되살려라"고 해서
    // AI가 옛 카드 레이아웃 전체를 새 행 아래에 다시 붙여 겹쳤다). 손 글자 고침(hand-edits)은 그대로 다시 얹는다
    if (m.role === "user" && m.text && LAYOUT_ASK.test(m.text)) {
        const le = lastEdit.get(m.work), tgt = new Set([...pts.map(p => p.file), ...(!pts.length && le && Date.now() - le.at < 30 * 60_000 ? [le.pt.file] : [])].map(f => f.replace(/\.[a-z]{2}\.html$/, ".html")));
        const cur = ((await readJson(m.work, HAND_PAGES).catch(() => null)) ?? []).filter(x => typeof x === "string");
        const next = cur.filter(f => !tgt.has(f));
        if (next.length !== cur.length) {
            await wput(m.work, HAND_PAGES, JSON.stringify(next)).catch(() => { });
            report("turn", "hand_pages.release", [...tgt].join(",").slice(0, 120));
        }
    }
    const handPages = m.role === "user" && m.text ? await handPagesPrefix(m.work).catch(() => "") : "";
    // 보고 있는 언어판(#100) — 그 언어판 파일을 고치게. 구조 변경은 앱이 다른 언어판에 옮긴다
    const vl = String(m.payload?.view_lang ?? "");
    // 발표용 움직임(#106 보정 1) — 켠 작업만. 앱이 발표에서 같은 이름의 요소를 옮긴다(매직 무브) · data-step은 키마다 드러난다
    const motionOn = m.role === "user" && !!m.text && m.payload?.motion === true;
    // 첫 턴 글꼴 후보(#108) — 목록 전체 대신 3개. 고르면 앱이 블록을 넣는다(font-pick.json)
    const fc = m.payload?.font_candidates;
    // 글꼴 짝(#129) — 서버가 덱마다 고른 짝(리워드면 발주가 정한 짝). 앱이 블록을 넣고 AI에는 이름과 이유만
    // 폴더 디자인(#136) — 폴더 안 새 작업의 첫 턴(리워드·복제 제외). "다른 느낌으로"면 이 작업만 끈다
    let designHead = "", fdes = null;
    {
        const fo = m.payload?.folder;
        if (m.role === "user" && m.text && fo && WORK_ID.test(fo) && !m.payload?.task_id && !tpl && !/\((?:slide|deck) reward, task_id=/i.test(m.text)) {
            if (DIFF_FEEL.test(m.text)) {
                if (!(await readJson(m.work, ".dynapse/design-override.json").catch(() => null))?.off) {
                    await wput(m.work, ".dynapse/design-override.json", JSON.stringify({ off: true, at: Date.now() })).catch(() => { });
                    await postChat(m.work, [{ role: "event", text: "이 작업은 폴더 디자인을 따르지 않아요", payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
                    report("turn", "folder_design.off", null);
                }
            }
            else if (!((await readJson(m.work, ".dynapse/TRACE.json").catch(() => null))?.rounds?.length) && !(await readJson(m.work, ".dynapse/series.json").catch(() => null)) && !(await readJson(m.work, ".dynapse/design-override.json").catch(() => null))?.off
                && !(await T().core.invoke("work_files", { id: m.work }).catch(() => [])).some(f => PAGE_RE.test(f.name))) {
                await ensureFolderHere(fo).catch(() => { });
                fdes = await folderDesign(fo, m.work).catch(() => null);
                if (fdes) {
                    if (fdes.tokens && !(await readTokens(m.work).catch(() => null))) {
                        await wput(m.work, "tokens.css", fdes.tokens).catch(() => { });
                        await wput(m.work, PALETTE_FILE, JSON.stringify({ tokens: (await import("./colors.js")).lockSelectors(fdes.tokens.trim()), from: "folder", at: Date.now() })).catch(() => { });
                    } // 폴더 디자인 = 첫 덱 색으로 잠금(#274 보정 2)
                    if (fdes.treat)
                        await wput(m.work, ".dynapse/photo-treat.json", JSON.stringify({ treat: fdes.treat, at: Date.now(), from: fdes.from })).catch(() => { });
                    designHead = folderDesignHead(fdes, CARDS_WORDS.test(m.text) ? "cards" : /덱|슬라이드|발표|IR|deck|slides?/i.test(m.text) ? "slides" : null);
                    await postChat(m.work, [{ role: "event", text: `폴더 디자인을 따라요 · 「${fdes.title.slice(0, 30)}」 기준 · 다른 느낌을 원하면 "다른 느낌으로"`, payload: { kind: "stage", ai: "dynapse", folder_design: fdes.from } }]).catch(() => { });
                    report("turn", "folder_design.on", `kind=${fdes.kind}`);
                }
            }
        }
    }
    // 시리즈 회차(#157 ①) — 지난 회차의 짝(복사된 font-pair.json)을 그대로. 서버가 새로 고른 짝·스타터 팔레트로 바꾸지 않는다(시리즈는 같은 틀에 글만 바꾼다)
    const seriesPair = m.role === "user" && (m.payload?.font_pair || m.payload?.palette) && (await readJson(m.work, ".dynapse/series.json").catch(() => null)) ? await readJson(m.work, ".dynapse/font-pair.json").catch(() => null) : null;
    const fpair = m.payload?.reward_font ?? fdes?.pair ?? seriesPair?.id ?? m.payload?.font_pair?.id;
    if (m.role === "user" && fpair && /^[A-Za-z0-9-]{2,30}$/.test(fpair)) {
        await wput(m.work, ".dynapse/font-pick.json", JSON.stringify({ pair: fpair })).catch(() => { });
        if (m.payload.reward_font)
            await wput(m.work, ".dynapse/reward-font.json", JSON.stringify({ pair: fpair })).catch(() => { });
    }
    const fpInfo = fdes?.pair ? { name: fdes.pairName ?? fdes.pair, why: "폴더 디자인" } : seriesPair?.id && fpair === seriesPair.id ? { name: seriesPair.name ?? seriesPair.id, why: "지난 회차 그대로" } : m.payload?.font_pair;
    if (m.role === "user" && fpair && fpInfo?.name)
        await wput(m.work, ".dynapse/font-pair.json", JSON.stringify({ id: fpair, name: fpInfo.name, why: fpInfo.why ?? "" })).catch(() => { }); // 덱 프레임 카드의 "글꼴 · …"
    const fontHead = m.role === "user" && m.text && fpair ? `[Fonts: the app sets the typeface pair ${fpInfo?.name ?? fpair}${fpInfo?.why ? ` (${fpInfo.why})` : ""} on every page after your turn — roles display, title, body, label, numeral with their weights. Never set font-family or font-weight on text yourself; if a page's own CSS needs them, use var(--typography-font-family-display|title|body|label|numeral) and var(--typography-weight-display|body).]\n` : m.role === "user" && m.text && fc?.length ? `[Font candidates for this deck: ${fc.map(f => `${f.id} (${f.name}${f.tags?.length ? ` · ${f.tags.join("·")}` : ""})`).join(", ")}. Choose the display and the body font only from these and write .dynapse/font-pick.json {"display":"<id>","body":"<id>"}; the app puts the font block on every page. Never set font-family yourself.]\n` : "";
    // 판형(#145) — 서버가 작업의 판형을 매 요청에 싣는다. frame_change = "A4로 바꿔줘" 같은 판형 바꾸기(서버가 판형을 이미 바꿔 둠) — 같은 작업의 판형 버전(턴 카드·버전 띠에 "A4 판")
    const fq = m.payload, fx = FRAME_PX[fq?.frame_change ?? fq?.frame ?? ""];
    // 상세페이지(#294 보정 9): 폭만 고정, 높이는 내용만큼 — 장 = 위에서 아래로 쌓이는 구간
    let frameHead = m.role === "user" && fx ? (fq?.frame === "detail" ? `[Frame: ${fx[2]} — every page is one section of one long page: <section class="slide" data-format="detail"> exactly 860px wide, height grows with its content (no fixed height); the sections stack top to bottom in page order.]\n` : `[Frame: ${fx[2]} — every page is one <section class="slide"> exactly ${fx[0]}×${fx[1]}px; nothing sits outside it.${fq?.frame === "card45" ? ' On registry card layouts add data-format="card45" to the section.' : ""}]\n`) : "";
    {
        const sb = m.payload?.start_brief; // 새로 만들기의 장수·자료(#151 ⑤ — 말풍선엔 사용자 글만, 이건 메타로)
        if (m.role === "user" && sb)
            frameHead += `[New deck: ${sb.count ? `about ${sb.count} pages` : "page count from the content"}${sb.docs?.length ? `; source files to read first: ${sb.docs.slice(0, 8).join(", ")}` : ""}.]\n`;
    }
    // 판형 고정(#212 보정 1) — 작업의 판형을 한 번 적어 두고(판형 바꾸기 때만 바꾼다) 모든 장 쓰기 뒤 그 크기로 되돌린다
    if (m.role === "user" && fx) {
        const k = fq?.frame_change ?? fq?.frame ?? "";
        const had = await readJson(m.work, FORMAT_FILE).catch(() => null);
        if (!had?.frame || fq?.frame_change)
            await wput(m.work, FORMAT_FILE, JSON.stringify({ frame: k })).catch(() => { });
    }
    if (m.role === "user" && fx && fq?.frame_change) {
        frameHead = `[Frame change to ${fx[2]} ${fx[0]}×${fx[1]}px. Resize every page to exactly that and re-seat its content for the new frame: free pages reflow and refit; registry layouts use the same layout's variant for this frame${fq.frame_change === "card45" ? ' (data-format="card45")' : ""}. Keep every page, the order, all text, the design tokens and the photos — do not add, remove or rewrite content. The app checks every page after your turn.]\n`;
        frameTurn.set(m.work, `${fx[3]} 판`);
    }
    // 스타터 팔레트(#119 보정 17 ①) — 첫 요청에 서버가 고른 것. 사진·덱 톤이 없을 때만 쓰는 마지막 출처. 시리즈 회차·폴더 디자인이면 안 준다(#157 ①)
    {
        const pal = m.payload?.palette;
        // 색은 앱이 정한다(#274 ①) — 새 덱(tokens.css 없음)이면 첫 턴 전에 그 팔레트의 실제 토큰을 tokens.css에 쓰고 잠근다(.dynapse/palette.json). AI는 색값을 쓰지 않는다
        let locked = !!(await readJson(m.work, PALETTE_FILE).catch(() => null))?.tokens;
        if (m.role === "user" && pal?.id && /^[a-z0-9-]{2,40}$/.test(pal.id) && !locked && !seriesPair && !fdes && !rewardWorks.has(m.work) && !/--[\w-]+\s*:/.test((await wget(m.work, "tokens.css").catch(() => null)) ?? "")) {
            const r = await http("GET", `${HUB}/api/layouts/tokens.css?mood=${encodeURIComponent(pal.id)}${/mobile/.test(fq?.frame ?? "") ? "&format=mobile" : ""}`).catch(() => null);
            if (r?.status === 200 && /--color-semantic-/.test(r.body)) {
                const tok = (await import("./colors.js")).lockSelectors(r.body.trim());
                locked = await wput(m.work, "tokens.css", `${tok}\n`).then(() => true).catch(() => false);
                // 분위기 팔레트(#303)는 사용자가 말한 색과 같이 친다(from "mood") — 첫 턴의 AI 기본색 갈아입히기가 x-grotesque(검정+산성 라임)를 바꾸지 않게
                if (locked) {
                    const fr = pal.from === "mood" ? "mood" : "starter";
                    await wput(m.work, PALETTE_FILE, JSON.stringify({ id: pal.id, tokens: tok, from: fr, at: Date.now() })).catch(() => { });
                    report("turn", fr === "mood" ? "color.mood" : "color.starter", pal.id);
                }
            }
        }
        if (m.role === "user" && locked)
            frameHead += `[Colours: the app has set this deck's palette in tokens.css. Embed tokens.css verbatim as <style data-tokens> on every page and never edit it unless the user asks for other colours. Colours only via var(--color-semantic-…) — never write a hex, rgb, hsl or named colour anywhere else; the app replaces any it finds with the nearest token. Coloured bands and boxes use zone-fill, zone-fill-alt, tint and on-accent.]\n`;
        else if (m.role === "user" && pal?.id && pal.colors && !seriesPair && !fdes)
            frameHead += `[Starter palette "${pal.id}" (use only if the user's photos and the deck tone give none): ${Object.entries(pal.colors).map(([k, v]) => `${k} ${v}`).join(" · ")}. Accent small, one place per page.]\n`;
    }
    // 분위기(#303) — 서버가 첫 요청 글에서 잡은 분위기. 색·글꼴은 앱이 이미 정했고(위 팔레트 · 글꼴 짝), AI에는 제목만 장식 글꼴 · 장식은 장당 1~2개 · 글 상자와 겹치지 않게 한 줄
    {
        const md = m.payload?.mood;
        if (m.role === "user" && md?.id && Array.isArray(md.moods) && md.moods.length) {
            const S0 = (x) => String(x ?? "").replace(/[\[\]\n]/g, " ").slice(0, 40);
            frameHead += `[Mood: ${md.moods.slice(0, 2).map(S0).join(" + ")} (the user's words: ${(md.words ?? []).slice(0, 6).map(S0).join(", ")}). The app has set this deck's palette and fonts for this mood — use the decorative display font for titles only, never for body text. Decorations: ${(md.devices ?? []).slice(0, 4).map(S0).join(" · ")} — at most 1–2 per page, never overlapping a text box. Keep body contrast ≥ 4.5.]\n[Series frame: the app prints the deck name in a top band on every inner page, so write the deck name once — as the cover title — and never again as a kicker, chip or label. The cover chip holds the date or place ([날짜] · [장소] blanks when unknown).]\n`;
            const W0 = (xs, n) => (Array.isArray(xs) ? xs : []).map(x => String(x ?? "").replace(/[^\w \-]/g, "").trim().slice(0, 30)).filter(Boolean).slice(0, n); // 사진 낱말(영어 — #309 ④)
            await wput(m.work, ".dynapse/mood.json", JSON.stringify({ id: md.id, moods: md.moods.slice(0, 2), words: (md.words ?? []).slice(0, 8), devices: (md.devices ?? []).slice(0, 4), photo: { terms: W0(md.photo?.terms, 6), avoid: W0(md.photo?.avoid, 5) }, art: String(md.art ?? "").replace(/[\[\]\n]/g, " ").slice(0, 240), at: Date.now() })).catch(() => { });
            report("turn", "mood.set", String(md.id).slice(0, 40));
        }
    }
    // 용도(#158 ①) — 서버가 정한 용도를 plan.json deck.segment에 남긴다(주간 표가 용도별 다른 모양 변경률을 센다). AI 지시엔 한 줄: 그 용도에 맞는지가 먼저
    {
        const sg = m.payload?.segment;
        if (m.role === "user" && sg?.id && /^[a-z_]{2,30}$/.test(sg.id)) {
            const plan = (await readJson(m.work, ".dynapse/plan.json").catch(() => null)) ?? {};
            if (plan.deck?.segment !== sg.id)
                await wput(m.work, ".dynapse/plan.json", JSON.stringify({ ...plan, deck: { ...(plan.deck ?? {}), segment: sg.id } }, null, 2)).catch(() => { });
            frameHead += `[Use case: ${sg.name ?? sg.id} (deck.segment = ${sg.id}). Judge every choice first by "does this fit this use case", then vary within it.]\n`;
        }
    }
    // 공지 종류 색(#158 ⑤) — 학생회 공지 용도면 서버가 준 세트(색각이상에서도 모든 쌍 ΔE2000 ≥12). 종류 칸엔 이름 글자 + data-notice-kind, 색은 시리즈 내내 같게. verify notice_cvd·notice_label이 본다
    {
        const nc = m.payload?.notice_colors;
        if (m.role === "user" && nc?.kinds && Object.values(nc.kinds).every(v => /^#[0-9a-f]{6}$/i.test(v)) && /^#[0-9a-f]{6}$/i.test(nc.ink ?? "")) {
            const plan = (await readJson(m.work, ".dynapse/plan.json").catch(() => null)) ?? {};
            await wput(m.work, ".dynapse/plan.json", JSON.stringify({ ...plan, deck: { ...(plan.deck ?? {}), notice_colors: nc.kinds } }, null, 2)).catch(() => { });
            frameHead += `[Notice kind colours (checked for colour-blind readers): ${Object.entries(nc.kinds).map(([k, v]) => `${k} ${v}`).join(" · ")}, text ${nc.ink} on all of them. Use them only for the kind label or band of each notice, rename the kinds to the council's own words if needed but keep each colour, and keep one colour per kind across the whole series. Every kind band carries its kind name as text with data-notice-kind="<kind name>" — never colour alone. Do not invent new kind colours.]\n`;
        }
    }
    // 참고 이미지(#145 §5) — 새로 만들기에 넣은 이미지는 context/refs/design(사진 칸 재료 아님). 구조·색·배치만 따르고 사진·글은 복제하지 않는다(선반 규칙 #119)
    if (m.role === "user" && fq?.design_refs) {
        const ds = (await T().core.invoke("work_files", { id: m.work }).catch(() => [])).map(f => f.name).filter(n => /^context\/refs\/design\/[^/]+\.(png|jpe?g|webp|gif)$/i.test(n)).slice(0, 8);
        if (ds.length)
            frameHead += `[Design references (open each with Read before planning): ${ds.join(", ")}. Follow their structure, colour, layout rhythm and type scale; never copy their photos, logos or text — the content is the user's.]\n`;
    }
    const motionHead = motionOn ? "[Presentation motion is on for this deck: keep slot names, data-tid and photo files identical across consecutive pages when the same thing continues, so the presentation can move it instead of cutting. Prefer continuous page pairs (cover-full → split-story with the same photo, big-number → compare-two, process-steps → process-steps, persona-card → journey-map). Put data-step=\"1|2|3\" on list items, steps, number bands or the two sides of a comparison when they should appear one key press at a time. Never write transition CSS or animations — the app moves things.]\n" : "";
    // 이야기 플립북(#111) — 움직임 ● 작업의 첫 턴, 또는 "이야기로·주인공" 요청: 여섯 장치 문법 + 스토리보드(.dynapse/story.json) 먼저. 움직임 ○ 작업엔 없다
    const storyAsk = motionOn && (!(await readJson(m.work, ".dynapse/TRACE.json").catch(() => null))?.rounds?.length || /이야기|스토리|주인공|줄거리|story|hero/i.test(m.text ?? ""));
    const storyHead = storyAsk ? `[Story deck (this work has presentation motion): before building pages, write .dynapse/story.json = {"logline": "<one sentence>", "hero": "<data-tid of the hero>", "beats": [{"page": "result-<page>.html", "device": "hero|journey|growth|zoom|cast|recap", "line": "<one short Korean line: what the hero means on this page>"}]} and follow it. Exactly one hero element (product photo, logo mark or key number) appears on every page with the same data-tid and changes place, size or meaning page by page; mark it on the cover with data-story="hero". Use at least one more device: journey (the hero moves one stop per page along a map, funnel or timeline; data-step on stops), growth (a number counts up with data-flip="count" while its data-viz bar grows; same data-tid), zoom (one tile of an overview becomes the next page's full view, same data-tid), cast (people or features appear one by one with data-step and line up). The closing <section> carries data-story="recap" and gathers the hero, key numbers and photos with their original data-tid. Flipbook marks only on growth and journey beats: data-flip="move" on the hero on the page it slides into, data-flip-next="K" on the section of the page you leave (K ≤ 24). Continuity is names only — never CSS transitions. If the user asks to change the hero, edit story.json and the data-tid only; keep text and photos. If the hero should really move (a stick figure, an animal, a vehicle), draw it as an inline SVG of named parts and change only angles between pages — follow .dynapse/skill-flip.md.]\n` : "";
    const viewHead = m.role === "user" && m.text && LANG_NAME[vl] ? `[The user is viewing the ${LANG_NAME[vl]} version: edit the pages they see, result-<page>.${vl}.html (keep their text in ${LANG_NAME[vl]}), not the original result-<page>.html. The app copies layout, photo and style changes to the other language versions; never rename or delete language files.]\n` : ""; // 매 턴(#101 §4) — 가벼운 턴 판정엔 안 센다
    // 채팅에 붙여넣은 웹폰트 주소(#58) — 받아서 이 작업 글꼴로 등록하고, AI에는 그 id만(주소를 페이지에 넣지 않게)
    let webFonts = "";
    if (m.role === "user" && m.text) {
        const urls = [...new Set(m.text.match(FONT_URL) ?? [])].slice(0, 3);
        const fams = [];
        for (const url of urls) {
            const r = await importWebFont(m.work, url).catch(() => ({ ok: false, why: "받지 못했어요" }));
            await postChat(m.work, [{ role: "event", text: r.ok ? `글꼴 받았어요 · ${r.families.slice(0, 3).join(", ")}` : `글꼴을 받지 못했어요 · ${r.why}`, payload: { kind: r.ok ? "stage" : "error", ai: "dynapse" } }]).catch(() => { });
            if (r.ok)
                fams.push(...r.families);
        }
        if (fams.length)
            webFonts = `[Web font(s) the user just added to this work: ${fams.map(f => `work:${f}`).join(", ")}. To use one, write .dynapse/font-pick.json with that id as display or body (the app inserts it). Never put the URL or @font-face into a page yourself.]\n`;
    } // 사용자가 직접 고친 것(#46) — AI가 되돌리지 않게
    // 가벼운 턴(#51 §4) = 📍·폰트·직접 수정 뒤 정리 — 판정은 요청 종류로(문장 분석 아님)
    let light = (pts.length > 0 || !!font || !!hand) && !NEEDS_LOOK.test(m.text ?? "");
    // 장을 옮겨 달라는 요청(#97 보정 2) — 순서 말 + 장 이름이 함께 있을 때만 이번 턴에 순서 잠금을 풀고 끝나면 새 순서로 잠근다. 흐름을 설명한 글은 순서 요청이 아니다
    let orderHead = "", orderOnly = false; // orderOnly = 순서·묶음·다시 넣기만(#139 A) — 범위 판정의 "덱"이 이 턴을 무거운 덱 턴으로 바꾸지 않는다
    // 숨긴 장이 10장 넘으면(#139 §3 — BizCrush IR 숨김 34장) 턴 시작에 한 줄 + [부록으로]·[빼기]. 작업마다 하루 한 번
    if (m.role === "user" && m.text) {
        const k = `hidmany:${m.work}`, today = new Date().toLocaleDateString("sv");
        if ((await store.get(k).catch(() => null)) !== today) {
            const h = await api("GET", `/api/works/${encodeURIComponent(m.work)}/hidden`).catch(() => null);
            const hid = (h?.data?.hidden ?? []).filter(f => PAGE_RE.test(f));
            if (hid.length > 10) {
                await store.set(k, today).catch(() => { });
                await postChat(m.work, [{ role: "event", text: `숨긴 장 ${hid.length}개 — 묶음으로 보내거나 뺄까요`, payload: { kind: "hidden-many", ai: "dynapse", files: hid.slice(0, 200) } }]).catch(() => { });
            }
        }
    }
    // 뺀 장 다시 넣기(#139 §3)도 순서 턴 — 장 이름 없이 제목으로 말해도("Osaka 장 다시 넣어줘")
    // 리워드 작업엔 순서 턴을 열지 않는다(#278 ② — 리워드 브리프 글이 순서 요청으로 읽혀 열린 잠금·"순서를 다시 정해요"가 장 턴 맥락에 들어가 AI가 "어떤 순서로 바꿀지 알려 주세요"라고 답했다)
    const rewardMsg = rewardWorks.has(m.work) || /\((?:slide|deck) reward, task_id=|\[Reward page turn/i.test(m.text ?? "");
    // 한 메시지 = 할 일 목록(C4 B · 2026-10-26 대표 실사용 — 두 요청 중 앞의 것만·옮긴 장이 되돌아감): 장 순서·이동·삭제는 AI 없이 엔진이(0 토큰), 나머지는 번호 목록으로 AI에.
    // 장 이름은 오타를 가장 가까운 이름으로 맞추고 답에 적는다. 📍·직접 수정·글꼴이 있는 말은 그 자리 일이라 나누지 않는다
    let todoHead = "", engineDid = false;
    if (m.role === "user" && m.text && !rewardMsg && !m.payload?.task_id && !pts.length && !hand && !font) {
        const K = await import("./tasks.js");
        const all = ((await readPages(m.work).catch(() => null)) ?? []).filter((x) => typeof x === "string" && PAGE_RE.test(x));
        const apx = ((await readJson(m.work, ".dynapse/appendix.json").catch(() => null)) ?? []).filter(f => all.includes(f));
        const hid = new Set((await readJson(m.work, ".dynapse/hidden.json").catch(() => null)) ?? []), main0 = all.filter(f => !apx.includes(f));
        const tasks = all.length ? K.readTasks(m.text, { names: all, numbered: main0.filter(f => !hid.has(f)) }) : [];
        const eng = tasks.filter(x => x.op), mark = (i) => "①②③④⑤⑥⑦⑧⑨"[i] ?? `${i + 1}.`, nm = (f) => f.replace(/^result-|\.html$/g, "");
        const done = new Map();
        if (eng.length) {
            let main = [...main0], apxN = [...apx];
            for (const x of eng) {
                const op = x.op;
                if (op.kind === "delete") {
                    for (const f of op.subjects)
                        await deletePage(m.work, f, { commit: false }).catch(() => { });
                    main = main.filter(f => !op.subjects.includes(f));
                    apxN = apxN.filter(f => !op.subjects.includes(f));
                }
                else {
                    for (const f of op.subjects)
                        if (!main.includes(f)) {
                            main.push(f);
                            apxN = apxN.filter(y => y !== f);
                        }
                    main = K.applyOp(main, op);
                }
                done.set(tasks.indexOf(x), `${K.opLine(op)}${op.fixed.length ? ` (${op.fixed.map(z => `${z.said} → ${nm(z.file)}`).join(", ")})` : ""}`);
            }
            if (apxN.join() !== apx.join())
                await wput(m.work, ".dynapse/appendix.json", JSON.stringify(apxN)).catch(() => { });
            await normalizeOrder(m.work, main).catch(() => null);
            await wput(m.work, ".dynapse/order-lock.json", JSON.stringify({ order: main, at: Date.now() })).catch(() => { });
            await repoCommit(m.work, `순서 · ${[...done.values()].join(" · ")}`.slice(0, 200));
            void afterSave(m.work);
            engineDid = true;
            report("turn", "tasks.engine", `n=${eng.length} ai=${tasks.length - eng.length}`);
            if (eng.length === tasks.length) {
                const text = tasks.length > 1 ? `할 일 ${tasks.length}개 · ${tasks.map((_, i) => `${mark(i)} ${done.get(i)} — 됨`).join(" · ")}` : `${done.get(0)} — 됨`;
                await postChat(m.work, [{ role: "agent", text, payload: { ai: "dynapse", summary: [text], engine: true } }]).catch(() => { });
                return;
            }
        }
        if (tasks.length > 1) {
            const lines = tasks.map((x, i) => `${mark(i)} ${x.text}${done.has(i) ? " (the app already did this)" : ""}`);
            todoHead = `[This message has ${tasks.length} tasks — do every one that is not done yet, in this turn:\n${lines.join("\n")}\nEnd your reply with the same list, one line each: "${mark(0)} 됨" or "${mark(0)} 못 함: <why>".]\n`;
            await postChat(m.work, [{ role: "event", text: `할 일 ${tasks.length}개: ${tasks.map((x, i) => `${mark(i)} ${done.has(i) ? `${done.get(i)} — 됨` : x.text.slice(0, 40)}`).join(" ")}`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
            todoAsk.set(m.work, { items: tasks.map((x, i) => ({ mark: mark(i), text: x.text, pages: done.has(i) ? [] : x.pages })).filter(x => x.pages.length), retried: false });
        }
        else
            todoAsk.delete(m.work);
    }
    // "남은 고칠 것 고쳐"(#302 B ③ — 웹 [고쳐 줘]) = 지난 검사 오류 목록을 그대로. 넘침·잘림은 엔진 맞춤 먼저, 남은 것만 AI에 — 사실 요청으로 읽지 않는다
    let fixHead = "";
    if (m.role === "user" && m.text && !rewardMsg && !pts.length && (await import("./facts.js")).FIX_REMAINING.test(m.text)) {
        const lv = (await readJson(m.work, ".dynapse/last-verify.json").catch(() => null)) ?? {};
        let items = [...(lv.errors ?? []), ...(lv.warnings ?? [])].filter(x => x.page && x.page !== "*").slice(0, 20);
        const fitPages = [...new Set(items.filter(x => /^(overflow|overflow_x|overflow_y|clipped|outside)$/.test(x.rule)).map(x => x.page))];
        const fitted = [];
        for (const f of fitPages)
            if (await fitFirst(m.work, f).catch(() => false))
                fitted.push(f);
        // 글자형 표지(#314 ⑦ · 보정 1) — 제안이 남아 있으면 이때 앱이 다시 짓는다(AI 0)
        {
            const cs = await readJson(m.work, ".dynapse/cover-suggest.json").catch(() => null);
            if (cs?.page && cs.form && (await import("./form-alts.js").then(FA => FA.buildAssigned(m.work, cs.page, cs.form)).catch(() => false)) === true) {
                fitted.push(cs.page);
                report("photo", "photo.cover_type_art", `${cs.page}|${cs.form}`);
                await wput(m.work, ".dynapse/cover-suggest.json", "{}").catch(() => { });
            } // 제안을 비운다(다시 묻지 않게)
            items = items.filter(x => x.rule !== "cover_type_art");
        }
        items = items.filter(x => !(fitted.includes(x.page) && /^(overflow|overflow_x|overflow_y|clipped|outside)$/.test(x.rule)));
        report("turn", "fix.remaining", `n=${items.length} fitted=${fitted.length}`);
        if (!items.length) {
            await postChat(m.work, [{ role: "agent", text: fitted.length ? `남은 고칠 것을 앱이 맞췄어요 · ${fitted.map(pageLabel).join(", ")}` : "지금 남은 검사 항목이 없어요", payload: { ai: "dynapse", engine: true } }]).catch(() => { });
            return;
        }
        fixHead = `[Fix request — do exactly these checker items and nothing else. This is not a request for facts or new content; never ask the user anything in this turn:\n${items.map(x => `- ${x.page} · ${x.rule}: ${String(x.msg ?? "").slice(0, 160)}`).join("\n")}]\n`;
    }
    // 사실 장부(C5 ① · #302 B ④) — 사용자 말의 날짜·시간·장소·가격·연락처는 받는 즉시 장부에(facts.json told · brief.md). 맞는 [빈칸]은 엔진이 바로 채우고,
    // 사실만 준 말이면 AI 턴 없이 끝. 장부는 매 턴 첫 줄 — AI를 바꿔도(한도·GPT) 같은 사실로
    let factsHead = "";
    // 한국어 원문에 영어 문장이 섞이면(앵커 B — "Make a slide deck about …") 답 언어를 못 박는다
    if (m.role === "user" && /[가-힣]/.test(m.text ?? "") && /[A-Za-z]{3,}(?:\s+[A-Za-z]{2,}){3,}/.test(m.text ?? ""))
        factsHead = "[The user writes in Korean — answer the user in Korean (image prompts may stay in English).]\n";
    if (m.role === "user" && m.text && !rewardMsg) {
        const F = await import("./facts.js"), fj = (await readJson(m.work, FACTS).catch(() => null)) ?? { asked: [], got: {} };
        const told = F.factsFromText(m.text);
        if (told.length) {
            fj.told = [...(fj.told ?? []).filter(x => !told.some(y => y.kind === x.kind && y.value === x.value)), ...told.map(x => ({ ...x, at: Date.now() }))].slice(-30);
            report("turn", "facts.told", told.map(x => x.kind).join(","));
        }
        // 맞는 [빈칸] 채우기 — 종류가 같은 사실이 하나뿐일 때만(가격 둘을 어느 칸에 넣을지는 짐작하지 않는다)
        let filled = 0, kinds = new Set();
        if (told.length && fj.asked.length) {
            const vals = {};
            for (const lb of fj.asked) {
                const k = F.blankKind(lb), c = told.filter(x => x.kind === k);
                if (k && c.length === 1 && !(lb in fj.got)) {
                    vals[lb] = c[0].value;
                    kinds.add(k);
                }
            }
            if (Object.keys(vals).length) {
                const names = (await T().core.invoke("work_files", { id: m.work }).catch(() => [])).map(f => f.name).filter(n => /^result-[a-z0-9-]+(\.[a-z]{2})?\.html$/.test(n));
                for (const f of names) {
                    const h = await wget(m.work, f).catch(() => null);
                    if (!h)
                        continue;
                    const r = F.fillBlanks(h, vals);
                    if (r.n) {
                        filled += r.n;
                        await wput(m.work, f, r.html).catch(() => { });
                    }
                }
                fj.got = { ...fj.got, ...vals };
                if (filled)
                    await repoCommit(m.work, `빈칸 채우기 · ${filled}곳`);
            }
        }
        if (told.length || filled) {
            await wput(m.work, FACTS, JSON.stringify(fj)).catch(() => { });
            await writeFactsBrief(m.work, fj.got, (fj.asked ?? []).filter(b => !(b in fj.got)).length, fj.told);
        }
        if (F.factsOnly(m.text, told) && told.every(x => kinds.has(x.kind))) {
            await postChat(m.work, [{ role: "agent", text: `받았어요 · ${told.map(x => `${x.kind} ${x.value}`).join(" · ")}${filled ? ` · 빈칸 ${filled}곳에 넣었어요` : ""}`, payload: { ai: "dynapse", engine: true } }]).catch(() => { });
            if (filled)
                void afterSave(m.work);
            return;
        }
        if (fj.asked?.length || Object.keys(fj.got ?? {}).length || fj.told?.length)
            factsHead = `[Facts ledger (the user already gave these — use them, never ask for them again, never invent other facts): ${[...Object.entries(fj.got ?? {}).map(([k, v]) => `${k} = ${v}`), ...(fj.told ?? []).map(x => `${x.kind}: ${x.value}`)].join("; ").slice(0, 900) || "(none yet)"}. Missing facts are collected by the app with a card that fills the [bracket] blanks — never ask for them in prose; leave [label] / [label: example] blanks and greyed example text (data-example) as they are. (.dynapse/brief.md has the list.)]\n`;
        // 새 덱 첫 턴(C5 S1 실측 10-27 — 장부가 비어 첫 답이 "기간·굿즈·주소를 알려 주시면"으로 산문 질문): 빈칸만 두고 묻는 건 앱 카드가
        else if (!(await T().core.invoke("work_files", { id: m.work }).catch(() => [])).some(f => PAGE_RE.test(f.name)))
            factsHead = "[Facts the user has not given (dates, places, prices, goods): still draw every section the user asked for and fill names and text with a short example as [label: example] — e.g. [굿즈 1 이름: 해골 키링]; numbers (price, date, count, rating, result) and the cover's date or place are label-only — [가격] · [날짜]. The app greys them with an \"예시\" tag and asks the user with a card. Never leave a page with only its title; do not ask for the facts in your reply.]\n";
    }
    // 주인공을 말로 정함(#309 ① — S3 라이브: "장마다 반복할 주인공: 핑크 가발을 쓴 고양이"가 되묻기로 끝났다): 앱이 hero.json을 쓰고, 이 턴은 자리를 두라고 첫 줄에 — 턴 끝에 [주인공 그림 만들기] 결정 칸
    {
        const hs = (m.text ?? "").match(/(?:주인공|마스코트|캐릭터)\s*(?:은|는)?\s*[:：]\s*([^\n]{2,160})/);
        if (hs && !rewardMsg) {
            const H = await import("./hero-sheet.js"), hf = await readJson(m.work, H.HERO_FILE).catch(() => null), brief = hs[1].trim();
            if (!hf || !hf.status || hf.status === "skip")
                await wput(m.work, H.HERO_FILE, JSON.stringify({ brief, gens: hf?.gens ?? 0, at: Date.now() })).catch(() => { });
            report("turn", "hero.said", `n=${brief.length}`);
            factsHead = `[Recurring character chosen by the user: "${brief.replace(/"/g, "'")}". The app already wrote .dynapse/hero.json — you may refine its "brief" into one English sentence (what it is, colours, outfit; no people, no text). Put <figure data-hero="1|2|3|4"></figure> on the pages where it fits (every page may carry one, sticker-sized, never over text). Do this now on the existing pages; do not ask which page.]\n` + factsHead;
        }
    }
    // 앱이 한 일은 앱이 답한다(#310 ① — 406차: "pdf 안 내보내졌는데 어디 내보냈다는 거야"에 AI가 "제가 내보낸 적 없습니다"로 앱을 부정했다): 앱 동작을 묻는 말은 마지막 기록으로 한 줄(AI 0) · 고치기가 섞이면 AI에 "앱 기록은 사실" 한 줄
    if (m.role === "user" && m.text && APP_ASK.test(m.text)) {
        if (/[?？]|(?:야|니|냐|지|죠|어|요|는데)\s*[.!]*\s*$/.test(m.text.trim()) && !/(?:고쳐|바꿔|만들어|넣어|빼|지워|키워|줄여|옮겨|해)\s*(?:줘|주세요)/.test(m.text) && !pts.length) {
            const le = await readJson(m.work, ".dynapse/out/last-export.json").catch(() => null);
            const hm = (t) => new Date(t).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
            const kindKo = { pdf: "PDF", flipbook: "플립북 PDF", pptx: "PPTX", png: "PNG", png2x: "PNG", html: "HTML", detail: "상세 그림" }[le?.kind ?? ""] ?? le?.kind ?? "";
            const said = le?.at ? `마지막 ${kindKo} · ${hm(le.at)} · ${String(le.path ?? "").replace(/^.*[\\/](Downloads)[\\/]/, "$1/") || "받기 폴더"}${le.pages ? ` · ${le.pages}장${le.total && le.total > le.pages ? `(플립북 ${le.total}장)` : ""}` : ""} · 다시 받으려면 [내보내기]` : "이 PC에서 아직 내보낸 기록이 없어요 · [내보내기]를 누르면 Downloads에 저장해요";
            report("turn", "app.answer", le?.kind ?? "none");
            await postChat(m.work, [{ role: "agent", text: said, payload: { ai: "dynapse", summary: [said], engine: true } }]).catch(() => { });
            return;
        }
        factsHead = "[App log lines (exports, order, sync) are facts. Never say the app did not do what its log says.]\n" + factsHead;
    }
    // 고치라는 암시(#312 보정 1 — "깨져·잘렸어·안 맞아·너무 붙었어·밀렸잖아"): 그 턴의 AI가 원인을 고친다 · 인쇄 CSS·배율 땜질 금지
    if (m.role === "user" && m.text && /깨져|깨졌|잘렸|잘려|안\s*맞아|안\s*맞잖|너무\s*붙|붙었|밀렸|넘쳐|넘치|겹쳐|겹쳤/.test(m.text))
        factsHead = "[The user is pointing at a defect: find its cause in the page HTML and fix it there in this turn. Never add print CSS, transform/scale/zoom hacks, or hide content to pass checks.]\n" + factsHead;
    // 다른 AI로 이어서(C5 ⑤ · 대표 10-27 "한도로 되돌림은 없어도 되는 거 아닌가"): 앞 AI가 한 것은 그대로 두고 남은 것만
    if (m.payload?.continued)
        factsHead = "[The previous AI hit its usage limit partway through this request. Its changes are kept: look at the current pages and do only what is still missing.]\n" + factsHead;
    // 순서는 앱 소유(#310 ② — 413차: AI가 pages.json을 잘못 써 두 장이 맨 앞으로 갔다): 순서·끼우기 요청이 아닌 턴은 시작 순서를 잠근다 → 턴 끝 정리가 AI가 바꾼 순서를 되돌린다(새 장은 AI가 둔 자리 그대로)
    if (m.role === "user" && m.text && !rewardMsg && !isReorderAsk(m.text) && !RELINK_ASK.test(m.text)) {
        const cur = (await readPages(m.work).catch(() => null)) ?? [];
        if (cur.length > 1)
            await wput(m.work, ".dynapse/order-lock.json", JSON.stringify({ order: cur, at: Date.now(), implicit: true })).catch(() => { });
    }
    if (m.role === "user" && m.text && !rewardMsg && !engineDid && (isReorderAsk(m.text) || (RELINK_ASK.test(m.text) && ((await readJson(m.work, DELETED).catch(() => null)) ?? []).length))) {
        const start = (await readPages(m.work).catch(() => null)) ?? [];
        orderUnlock.add(m.work);
        await wput(m.work, ".dynapse/order-lock.json", JSON.stringify({ order: start, at: Date.now(), open: true })).catch(() => { });
        // 순서만 바꾸는 요청(#139 A — "1~10번을 Osaka Award에 맞게 재조정"이 잠금에 되돌려졌다) = 순서만 쓰는 가벼운 턴. 만들기·글·사진 말이 섞이면 등급은 그대로
        orderAsk.set(m.work, { start, retried: false, text: m.text, groups: await groupsOf(m.work) });
        orderHead = ORDER_HEAD;
        {
            const del = ((await readJson(m.work, DELETED).catch(() => null)) ?? []).slice(-20);
            if (del.length)
                orderHead += `[Removed pages (to bring one back, list its file in .dynapse/turn.json "relink": [...] — the app restores it in place): ${del.map(d => `${d.file}${d.title ? ` "${d.title}"` : ""}`).join(", ")}]\n`;
        }
        if (!NEEDS_LOOK.test(m.text) && !/만들|추가|(?<!(앞에|뒤에|사이에|다시)\s*)넣어|새로|써\s*줘|사진|그림|차트|글자|문구|제목/.test(m.text)) {
            light = true;
            orderOnly = true;
        }
    }
    else if (m.role === "user") {
        orderAsk.delete(m.work);
        orderUnlock.delete(m.work);
    } // 실패한 순서 턴이 다음 요청에 남지 않게
    // 가져온 덱의 첫 턴 = 편집 턴(#56 보정 1 — "글자만 바꿔줘"에 표지부터 새로 만들고 사진을 만들었다). 결과 장이 이미 있고 기록이 없으면(가져옴·복제)
    // 템플릿 가져다 놓기(tpl)·미리 채운 리워드는 제외
    let importedHead = "";
    if (m.role === "user" && m.text && !tpl && !m.payload?.prefill?.length && !m.payload?.task_id && !/\((?:slide|deck) reward, task_id=/i.test(m.text)
        && !((await readJson(m.work, ".dynapse/TRACE.json"))?.rounds?.length)
        && (await T().core.invoke("work_files", { id: m.work }).catch(() => [])).some(f => /^result-[a-z0-9-]+\.html$/.test(f.name))) {
        importedHead = "[Imported deck — edit the existing pages in place. Do not rebuild or re-create pages, do not call get_template, and do not request or generate photos unless the user asks for a photo; keep the imported photos as they are.]\n";
        importedWorks.add(m.work);
    }
    // 번역 요청(#74 §3) — 글자 칸만, 보조 호출. 📍·직접 수정 같이 온 요청은 일반 턴으로
    if (m.role === "user" && m.text && !pts.length && !hand) {
        const lang = translateIntent(m.text);
        if (lang) {
            active++;
            try {
                if (await translateTurn(m.work, lang, m.payload?.route?.design?.[0] === "chatgpt" ? "chatgpt" : "claude"))
                    return;
            }
            finally {
                active--;
            }
        }
    }
    // 차트·표는 말로(#119 보정 10 §2) — 규칙 표(skills/viz-intents.json)의 말로만 된 문장이면 앱이 바로(AI 0 토큰, 커밋 1). 대상 장 = 📍 → "N번 장" → 화면에서 고른 장
    const selPage = String(m.payload?.sel_page ?? "") || null;
    if (m.role === "user" && m.text && !hand && !font && pts.length <= 1 && !m.payload?.task_id) {
        const order = async () => ((await readPages(m.work).catch(() => null)) ?? []).filter(x => typeof x === "string");
        const { vizByWords } = await import("./viz.js");
        active++;
        try {
            if (await vizByWords(m.work, m.text.replace(/\[첨부:[^\]]*\]/g, "").trim(), { file: pts[0]?.file ?? null, slot: pts[0]?.slot ?? null, selPage, order }).catch(() => false))
                return;
        }
        finally {
            active--;
        }
    }
    // PPTX 왕복(#73 보정 2) — 첨부한 .pptx가 우리가 내보낸 것이면 글·사진 칸만 되돌리고, 다른 말이 없으면 AI 턴 없이 끝
    if (m.role === "user" && m.text) {
        const names = [...new Set([...m.text.matchAll(/context\/refs\/([^,\]\n]+\.pptx)/gi), ...m.text.matchAll(/내 PPT 내용으로 다시 만들기 · ([^\n]+\.pptx)/gi)].map(x => x[1].trim()))];
        let handled = false;
        for (const n of names)
            if (await pptxRoundtrip(m.work, n).catch(() => false))
                handled = true;
        const rest = m.text.replace(/\[첨부:[^\]]*\]/g, "").replace(/내 PPT 내용으로 다시 만들기 · [^\n]+/g, "").trim();
        if (handled && !rest)
            return;
    }
    // 글꼴 짝 돌리기(#129 §4) — 이름 없는 "글꼴 바꿔줘"는 앱이 다음 짝으로, "글꼴 더 굵게/가늘게"는 굵기 토큰만(AI 0, 커밋 1)
    if (m.role === "user" && m.text && !pts.length && !hand && m.text.trim().length <= 30) {
        const t = m.text.trim();
        if (/^(제목\s*)?(글꼴|폰트|서체|글씨체?)\s*(을|를|좀)?\s*(더\s*)?(굵게|두껍게|가늘게|얇게)/.test(t) || /^(글꼴|폰트|서체)\s*(을|를|좀)?\s*(다른\s*(걸로|것으로)\s*)?(바꿔|바꾸|변경|다른)/.test(t) && !/[A-Za-z]{3,}|나눔|고운|프리텐|본명조|명조체|고딕체|함렛|검은고딕|송명|노토/.test(t)) {
            active++;
            try {
                if (await fontTurn(m.work, /굵게|두껍게/.test(t) ? 100 : /가늘게|얇게/.test(t) ? -100 : 0))
                    return;
            }
            finally {
                active--;
            }
        }
    }
    // 폰트만 바꾸는 요청(📍·직접 수정·웹폰트 주소·템플릿 없음) = 보조(Sonnet 일회) — 메인 세션 턴·캐시를 쓰지 않는다
    if (m.role === "user" && m.text && font && !pts.length && !hand && !webFonts && !tpl && !importedHead) {
        const cat = [font, pcFonts, workFonts].filter(Boolean).join(", ");
        active++;
        const editAi = m.payload?.route?.design?.[0] === "chatgpt" ? "chatgpt" : "claude"; // 편집 AI와 같은 회사의 가벼운 모델
        try {
            if (await fontAux(m.work, m.text, cat, cur, editAi))
                return;
        }
        finally {
            active--;
        }
    }
    if (m.role === "user" && m.text) {
        const firstB = !importedHead && !((await readJson(m.work, ".dynapse/TRACE.json"))?.rounds?.length);
        const kind = pts.length ? (pts.every(p => p.slot) ? "photo" : "point") : font ? "font" : /\((?:slide|deck) reward, task_id=/i.test(m.text) ? "reward" : firstB ? "first" : "edit";
        mxNext.set(m.work, { kind, points: pts.length, len: m.text.length, hand: hand ? (hand.match(/; /g)?.length ?? 0) + 1 : 0, ph: reqHash(m.text) });
    }
    // "PPTX 호환 켜/꺼 줘"는 AI 없이 바로(#138 — 카드 대신 말로)
    if (m.role === "user" && m.text && /^\s*PPTX\s*호환\s*(켜|꺼)/i.test(m.text)) {
        await setCompat(m.work, /켜/.test(m.text));
        return;
    }
    if (m.role === "user" && m.text && /한쇼|폴라리스|구글 ?슬라이드|google slides|hancom|ppt로 (고|수정|편집)/i.test(m.text))
        void askCompatOnce(m.work, null).catch(() => { }); // #81 보정 1 §3
    // 원고 그대로(카피 그대로 모드) — 붙인 원고의 문장을 고치지 않고 칸에 배치만. 바꿀 수밖에 없으면 turn.json copy_changes에 적는다(앱이 카드로 보여 줌). verify가 원고 문장이 결과에 있는지 본다
    let verbatim = "";
    // 칩이 꺼진(또는 없는) 다음 요청이면 원고 그대로 검사를 끈다(#153 보정 2 — 검사는 칩이 켜진 생성 요청에만. 편집 턴 "제목 더 짧게"가 원고 위반이 되지 않게). 기록(AI 사용 기록)은 남긴다
    if (m.role === "user" && m.text && !m.payload?.verbatim) {
        const vb0 = await readJson(m.work, ".dynapse/verbatim.json").catch(() => null);
        if (vb0 && vb0.active !== false)
            await wput(m.work, ".dynapse/verbatim.json", JSON.stringify({ ...vb0, active: false }, null, 1)).catch(() => { });
    }
    if (m.role === "user" && m.text && m.payload?.verbatim) {
        const refs = [...new Set([...m.text.matchAll(/context\/refs\/([^\s,\]]+)/g)].map(x => x[1]))];
        // 내 글 그대로(#153 ③ · 보정 1) — strict: 글자 하나 바꾸지 않는다(verify가 오류로 본다). 제목 다듬기 규칙은 이 모드에선 제안일 뿐
        // 원고 = 표시된 문구만(#192): 따옴표·코드 블록·"제목:" 줄. 표시가 없고 지시서 꼴이면 원고 검사 없음(지시로 처리) — 붙인 수정 지시서 전체를 원고로 검사하던 것
        const CM = await import("./copy-marks.js"), raw = m.text.replace(/\n?\[첨부:[^\]]*\]/g, ""), mc = CM.markedCopy(raw);
        const asIs = !!refs.length || mc.marked || !CM.instructionLike(raw);
        if (asIs)
            await wput(m.work, ".dynapse/verbatim.json", JSON.stringify({ at: Date.now(), strict: true, sources: refs.map(r => `context/.index/${r}.md`), text: refs.length ? null : mc.marked ? mc.lines.join("\n") : raw.slice(0, 20000), ...(mc.marked ? { marked: true, lines: mc.lines } : {}) }, null, 1)).catch(() => { });
        else
            await postChat(m.work, [{ role: "event", text: "지시로 읽었어요 · 그대로 넣을 문구는 따옴표나 \"제목:\"으로 표시해 주세요", payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
        if (asIs && mc.marked && !refs.length)
            verbatim = `[Keep my words — these marked lines (quoted, code or labelled) go into the slots character for character (a trailing period may be dropped): ${mc.lines.slice(0, 40).map(l => `«${l}»`).join(" ")}. The rest of the message is instruction, not copy.]\n`;
        else if (asIs)
            verbatim = `[Keep my words — the user's text${refs.length ? ` (${refs.join(", ")} — read its index in context/.index/)` : " (the text of this message)"} goes into the slots character for character: no rephrasing, shortening, translating, reordering, no changed punctuation, quotes or numbers. You only lay it out: choose layouts, split it across pages at sentence or paragraph boundaries, set sizes. Headline and copy rules (claim titles, predicate endings, label rules) do not apply to the user's sentences here — never edit them to satisfy a rule. If a sentence does not fit, use a denser layout, a composed page or another page; never cut it. verify fails the turn if any character changed.]\n`;
    }
    // 내 자료함(2026-10-07) — 모으기·정리는 사용자의 Claude Code가 자기 커넥터와 이 PC 파일로. 앱은 커넥터를 먼저 확인하고(없으면 카드, AI 0), 지시문 하나를 붙인다
    let libraryHead = "";
    const isLib = m.role === "user" && !!m.text && !!m.payload?.library;
    // 작업에 Drive 링크(2026-10-09 대표 "드라이브 주소가 있으면 바로 연결돼 있는지 확인하고 연결하게") — 자료함 밖에서도: 없으면 요청을 붙잡고 연결 카드, 있으면 그 AI로 커넥터를 보이게
    let driveHead = "", driveTurn = false;
    if (!isLib && m.role === "user" && m.text && /https?:\/\/(drive|docs)\.google\.com\//i.test(m.text) && !m.payload?.no_drive) {
        const both = await driveConnectors();
        if (both.claude !== "ok" && both.codex !== "ok") {
            held.set(m.work, m);
            await postChat(m.work, [{ role: "event", text: null, payload: { kind: "connector-needed", ai: "dynapse", name: "Google Drive", state: both.claude, held: true } }]);
            void watchConnector(m.work);
            return;
        }
        const via = both.claude === "ok" ? "claude" : "chatgpt";
        const r0 = (m.payload?.route ?? { design: [via], photo: [] });
        m = { ...m, payload: { ...m.payload, route: { ...r0, design: [via, ...r0.design.filter(a => a !== via)] } } };
        driveTurn = via === "claude";
        driveHead = `[The message has Google Drive links. Open them with your Google Drive connector tools (Claude: mcp__claude_ai_Google_Drive__* · Codex: your Google Drive plugin). Save each document's useful text to context/refs/<short-title>.md and images to context/assets/ when the connector gives the file, then do the request with them. If a link cannot be opened with the user's account, say so in one line and continue with the rest.]\n`;
    }
    if (isLib) {
        const both = await driveConnectors();
        const drive = both.claude === "ok" || both.codex === "ok" ? "ok" : both.claude;
        const driveAsk = /drive\.google\.com|docs\.google\.com|구글 ?드라이브|google drive|나와 공유|공유된 문서|shared with me/i.test(m.text);
        // Drive 요청이면 Drive가 연결된 AI로(Claude 먼저) — 웹이 고른 AI에 Drive가 없으면 바꾼다
        if (driveAsk && drive === "ok") {
            const via = both.claude === "ok" ? "claude" : "chatgpt";
            const r0 = (m.payload?.route ?? { design: [via], photo: [] });
            m = { ...m, payload: { ...m.payload, route: { ...r0, design: [via, ...r0.design.filter(a => a !== via)] } } };
        }
        const noDrive = !!m.payload?.no_drive;
        if (drive !== "ok" && driveAsk && !noDrive) {
            // 연결하러 간 사이 요청을 들고 있다가, 연결되면(5초마다 확인, 15분까지) 그대로 이어서 — 다시 보낼 필요 없음
            held.set(m.work, m);
            await postChat(m.work, [{ role: "event", text: null, payload: { kind: "connector-needed", ai: "dynapse", name: "Google Drive", state: drive, held: true } }]);
            void watchConnector(m.work);
            return;
        }
        const purpose = String(m.payload?.purpose ?? "").slice(0, 60);
        libraryHead = `[Folder${purpose ? ` "${purpose}"` : ""} — not a design work. This folder groups the works and materials for one purpose; people invited to the folder see them. Collect, organise and index the materials that serve this purpose so the works in it can reuse them. Collect only what fits the purpose; ask before adding anything outside it.
Sources (a folder can have many — remember every one in context/library.json "sources" so "check for updates" can re-read them):
- Google Drive: ${noDrive && drive !== "ok" ? "not connected, and the user chose to continue without it. Do not try to open Drive. Record each Drive link the user gave in \"sources\" (drive_folder or drive_file) and list them as items with to_download: true, then do every other part of the request. Tell the user in one line that those files need the Google Drive connector (or links shared as 'anyone with the link')." : drive === "ok" ? `use your Google Drive connector tools (Claude: mcp__claude_ai_Google_Drive__* · Codex: your Drive MCP server). The user may paste several links at once — each file link (type drive_file), each folder link (drive_folder, read the files inside) — or ask you to look in "shared with me" (drive_shared: search what others shared with them, filtered by the purpose or the words they give). Save each document's useful text as context/refs/<short-title>.md with a header (source link, modified date). Save images (product photos, logos) into context/assets/ only when the connector lets you get the file; otherwise list them in the index with their links as to_download. On "check for updates", re-read every source and update only items whose modified date changed, add new ones, and mark removed ones "removed": true.
  If the user asks to share files from this computer through Drive for this purpose: only if your Drive connector has a tool that creates or uploads files, put them into a Drive folder named after this purpose and record the new link as the item's source; if it cannot write, say so in one line — inviting people to this folder already shares these files with them.` : "the Google Drive connector is not connected in the user's Claude. If the user asks for Drive, tell them to connect it on claude.ai (Settings → Connectors) and stop."}
- This computer: you may read the Downloads folder (added), and any folder path the user names (local_folder). First list candidate files by name, type and date only (do not open everything), group them (company intro, product photos, logos, case studies, price lists, other) and ASK the user which groups or files to add — then stop and wait for the answer. After the answer copy (cp) the chosen files into context/assets (images) or context/refs (documents). Never move, rename or delete the user's files.
- Files the user drops into this chat (already in context/refs, context/assets; type upload).
Index: keep context/library.json up to date: {"sources":[{"type":"drive_file|drive_folder|drive_shared|local_folder|upload","ref":"<link, path or search words>","label":"<short name>","checked":"<date>"}],"items":[{"id","kind":"company_intro|product|photo|logo|case|pricing|people|other","title","summary","file","source":{"type","ref"},"updated","to_download"?,"used_in"?,"tags"?,"ratio"?,"fits"?}],"conflicts":[]}.
Images (photo, logo, product, people): open each image file in context/assets and look at it. "summary" = what it actually shows in one Korean line (subject, setting, colours, any text in it); "tags" = 3–6 Korean search words; "ratio" = "W×H" in pixels; "fits" = the slots it suits from cover, product, team, logo, scene, background, chart, screenshot. Works later pick images by these fields, so describe what is visible, not what the file name says. On "check for updates" fill these for any image that lacks them. Items with "needs_index": true came in from works in this folder: look at or read them, fill summary/tags (and ratio/fits for images) and drop needs_index. Keep each item's existing "used_in" exactly as it is (the app records which works used it). Summaries short, in Korean. Keep numbers exactly as in the source and list conflicting numbers in conflicts. Do not make design pages here.
Reply to the user in Korean, briefly: what you collected and what you need them to decide.]\n`;
    }
    // 내 커넥터(2026-10-09) — 요청에 메일·캘린더·노션·슬랙·드라이브·피그마 같은 말이 있으면 그 턴에 연결된 claude.ai 커넥터를 모두 보이게. 읽기 위주(보내기·지우기·바꾸기는 사용자가 이 메시지로 시킬 때만)
    let connHead = "", connTools = [];
    if (m.role === "user" && m.text && /메일|gmail|이메일|받은편지|캘린더|calendar|일정|미팅|회의 일정|노션|notion|슬랙|slack|드라이브|drive|지라|jira|컨플루언스|confluence|피그마|figma|커넥터|connector/i.test(m.text)) {
        const conns = await claudeConnectors().catch(() => []);
        if (conns.length) {
            connTools = conns.map(c => c.tool);
            connHead = `[The user's Claude connectors are available this turn: ${conns.map(c => c.name).join(", ")} (tools mcp__claude_ai_*). Use them to read what this request needs (mail, calendar, documents, messages). Do not send, delete, move or change anything in those services unless this message explicitly asks for it. Never say they are unavailable — try them first.]\n`;
        }
    }
    // 폴더 사진 먼저(2026-10-08 대표 "구글 드라이브·내 폴더 이미지를 인덱스화해서 IR·소개덱에 넣을 수 있게") — 폴더 안 작업이면 그 폴더 자료 목록의 사진(무엇이 보이는지·비율·맞는 칸)을
    // .dynapse/folder-images.json으로 주고, 맞는 칸에 먼저 쓰게 한다. AI가 복사(cp)하고 turn.json folder_used에 적으면 앱이 폴더 자료의 "쓰인 작업"에 남긴다
    let folderHead = "", folderDir = null;
    const inFolder = m.payload?.folder;
    if (m.role === "user" && m.text && !isLib && inFolder && WORK_ID.test(inFolder)) {
        await ensureFolderHere(inFolder).catch(() => { });
        folderDir = await T().core.invoke("work_dir", { id: inFolder }).catch(() => null);
        const lib = await readJson(inFolder, "context/library.json").catch(() => null);
        const imgs = (lib?.items ?? []).filter(i => !i.removed && i.file && /^context\/assets\/[^/]+\.(png|jpe?g|webp|svg)$/i.test(i.file)).slice(0, 60);
        // 폴더의 문서·글도(2026-10-09 대표 "폴더 안에서 작업하면 다른 작업에서도 인덱스로 쓸 수 있는 거지?") — 목록과 경로를 주고, 필요한 것만 그 자리에서 읽게(복사 없음)
        const docs = (lib?.items ?? []).filter(i => !i.removed && i.file && /^context\/refs\/[^/]+$/.test(i.file) && !/\.read\.json$|\.url$/.test(i.file)).slice(0, 60);
        if (folderDir)
            await wput(m.work, ".dynapse/folder.json", JSON.stringify({ folder: inFolder, name: m.payload.folder_name ?? null })).catch(() => { });
        if (folderDir && docs.length) {
            const sep = folderDir.includes("\\") ? "\\" : "/";
            await wput(m.work, ".dynapse/folder-docs.json", JSON.stringify({ folder: inFolder, docs: docs.map(i => ({ path: `${folderDir}${sep}${i.file.split("/").join(sep)}`, title: i.title ?? null, kind: i.kind ?? null, summary: i.summary ?? null })) }, null, 1)).catch(() => { });
            folderHead += `[The folder's documents and articles are listed in .dynapse/folder-docs.json (title, kind, one-line summary, absolute path). When the request needs company facts, numbers or wording, read the relevant ones straight from their path (read-only, no need to copy) and keep numbers and names exactly as written.]\n`;
        }
        if (folderDir && imgs.length) {
            const sep = folderDir.includes("\\") ? "\\" : "/";
            await wput(m.work, ".dynapse/folder-images.json", JSON.stringify({ folder: inFolder, images: imgs.map(i => ({ src: `${folderDir}${sep}${i.file.split("/").join(sep)}`, name: i.file.split("/").pop(), title: i.title ?? null, shows: i.summary ?? null, tags: i.tags ?? [], ratio: i.ratio ?? null, fits: i.fits ?? (i.kind === "logo" ? ["logo"] : []) })) }, null, 1)).catch(() => { });
            folderHead += `[This work is in the user's folder${m.payload.folder_name ? ` "${m.payload.folder_name}"` : ""}. .dynapse/folder-images.json lists the company's own images (what each shows, ratio, which slot it suits). For photo and logo slots, use these first when one fits the page's content — before stock and before generating: copy it in with cp "<src>" context/assets/<name> and place it like a user photo. Do not force an image that does not fit. List every src you copied in .dynapse/turn.json "folder_used": [src, …].]\n`;
        }
    }
    // 장 나누기(#84) — 웹 칩 줄 그대로 .dynapse/split.json. 원고 그대로면 장마다 그 덩어리를 문장 그대로, 아니면 개요로
    let planHead = "";
    const split = m.payload?.split;
    if (m.role === "user" && m.text && Array.isArray(split) && split.length >= 2) {
        await wput(m.work, ".dynapse/split.json", JSON.stringify({ at: Date.now(), verbatim: !!m.payload.verbatim, pages: split.map((c, i) => ({ n: i + 1, title: c.title, text: c.text })) }, null, 1)).catch(() => { });
        planHead = m.payload.verbatim
            ? `[Page plan attached (.dynapse/split.json, ${split.length} pages): each page takes exactly its listed chunk, in this order — place the sentences as written; shorten nothing; if a chunk does not fit, step the type size down (not the text). If it still does not fit, split that page in two (cards up to 8) instead of cutting text.]\n`
            : `[Page plan attached (.dynapse/split.json, ${split.length} pages): use it as the outline — one page per chunk, in this order; you may rewrite and shorten.]\n`;
    }
    // 글 주소(#83 §1) — 웹이 붙여넣은 주소를 context/refs/*.url 첨부로 보낸다. 앱이 글을 받아 원고(.md)로 두고, AI에는 그 파일과 만드는 법 한 줄. 못 읽으면 카드 하나·AI 턴 0
    let article = "";
    // 다음 회차의 첫 턴(#83 §2) — 지난 회차의 장이 그대로 들어 있다. 구조·어조·색·사진 방향은 두고 내용만 새로
    let seriesHead = "";
    if (m.role === "user" && m.text) {
        const sr = await readJson(m.work, ".dynapse/series.json").catch(() => null);
        if (sr?.n && !sr.used) {
            seriesHead = `[This is round ${sr.n} of a weekly series. The pages are last round's: keep their structure, layouts, tone, colours and photo direction; replace the content with this round's material; swap photos that no longer fit (user photos in context/assets first).]\n`;
            await wput(m.work, ".dynapse/series.json", JSON.stringify({ ...sr, used: true })).catch(() => { });
        }
    }
    if (m.role === "user" && m.text) {
        // 글 주소 여러 개(#83 보정 1) — 첨부 칩(.url)과 메시지에 쓴 주소를 순서대로 모아 작업은 5개, 자료함은 10개까지. 넘치면 카드 한 줄
        const names = [...new Set([...m.text.matchAll(/([A-Za-z0-9._-]+\.url)\b/g)].map(x => x[1]))];
        const got = [];
        const failedLinks = [];
        // 메시지에 그대로 붙인 글 주소도(2026-10-08 대표 "블로그를 열어서 그 내용으로 — 왜 거부하냐") — 앱이 받아 원고·본문 사진으로. Drive·디냅스·Figma는 제외
        const raw = [...new Set([...m.text.matchAll(/https?:\/\/[^\s<>"'\])]+/g)].map(x => x[0].replace(/[.,)]+$/, "")))]
            .filter(x => !/^https?:\/\/([^/]*\.)?(google\.com|dynapse\.ai|figma\.com|localhost)(\/|$|:)/i.test(x));
        const fromNames = [];
        for (const n of names) {
            const u = (await T().core.invoke("work_read", { id: m.work, file: `context/refs/${n}` }).catch(() => null))?.trim().split(/\s+/)[0];
            if (u)
                fromNames.push(u);
        }
        const all = [...new Set([...fromNames, ...raw])], cap = isLib ? 10 : 5, links = all.slice(0, cap);
        if (all.length > cap)
            await postChat(m.work, [{ role: "event", text: isLib ? `한 번에 ${cap}개까지 · 나머지 ${all.length - cap}개는 다음 메시지로` : `글은 한 번에 ${cap}개까지 · 나머지 ${all.length - cap}개는 자료함에 넣어 주세요`, payload: { kind: "stage", ai: "dynapse" } }]);
        for (const u of links) {
            await postChat(m.work, [{ role: "event", text: links.length > 1 ? `글 받는 중 ${links.indexOf(u) + 1}/${links.length}` : "글 받는 중", payload: { kind: "stage", ai: "dynapse" } }]);
            const r = await importArticle(m.work, u).catch(() => ({ ok: false, reason: "fetch" }));
            if (r.ok) {
                got.push({ ...r, url: u });
                await postChat(m.work, [{ role: "event", text: `글 받았어요 · ${r.title.slice(0, 40)} (${r.chars.toLocaleString()}자${r.images?.length ? ` · 사진 ${r.images.length}장` : r.image ? " · 대표 사진" : ""})`, payload: { kind: "stage", ai: "dynapse" } }]);
            }
            else {
                failedLinks.push(u);
                await postChat(m.work, [{ role: "event", text: r.reason === "private" ? "이 주소는 가져올 수 없어요 · 본문을 붙여넣어 주세요" : "글을 읽지 못했어요 · 본문을 붙여넣어 주세요", payload: { kind: "error", ai: "dynapse", paste: true } }]);
            }
        }
        const rest = m.text.replace(/\[첨부:[^\]]*\]/g, "").replace(/\[(?:Document|Article link) attached:[^\]]*\][^\n]*/g, "").trim();
        const restNoLinks = rest.replace(/https?:\/\/\S+/g, "").replace(/[A-Za-z0-9._-]+\.url\b/g, "").trim();
        if (links.length && !got.length && !restNoLinks)
            return; // 읽은 글이 없고 다른 말도 없으면 AI 턴 없이
        // 먼저 읽기(가벼운 AI) — 편집 AI와 같은 회사로
        const readAi = (m.payload?.route?.design?.[0] === "chatgpt") ? "chatgpt" : "claude";
        const reads = [];
        for (const g of got)
            reads.push(await readArticle(m.work, g, readAi).catch(() => null));
        const readFiles = got.filter((_, i) => reads[i]).map(g => g.file.replace(/\.md$/, ".read.json"));
        // 자료함(#83 보정 1) — 받은 글을 자료 목록(context/library.json)에 "글"로 남긴다(읽지 못한 것도 그 행에 표시). 링크만 보냈으면 AI 턴 없이 끝
        if (isLib && links.length) {
            await libraryAddArticles(m.work, got.map((g, i) => ({ ...g, read: reads[i] ? g.file.replace(/\.md$/, ".read.json") : null })), failedLinks);
            if (!restNoLinks) {
                await postChat(m.work, [{ role: "event", text: `글 ${got.length}개를 모았어요${failedLinks.length ? ` · ${failedLinks.length}개 읽지 못함` : ""} · 작업에서 📎 → 자료함에서`, payload: { kind: "stage", ai: "dynapse" } }]);
                return;
            }
        }
        if (got.length && !isLib)
            article = `${got.length > 1 ? `[Several source articles attached, in order (${got.map(g => g.file).join(", ")}): build the deck/cards from all of them — one section per article unless the request says otherwise; keep each article's numbers exact.]\n` : ""}[The app already opened the link(s) for you — never say you cannot open it.${readFiles.length ? ` Read ${readFiles.join(", ")} first: it is a careful reading of the article and its photos — sections in order with the photos that belong to each, what every photo shows, any text printed inside a photo, and which photos to skip. Build from it: one page per section in its order, the "cover" photo on the hook/cover, each section's photos on its page, never use "skip" photos. Diagrams, charts, screenshots and any photo with text_in_image must be shown whole, never cropped: put style="object-fit:contain" on that <img>, and give it a page whose photo area is wide (card-point photo top, split-story wide, gallery-grid) rather than a narrow side strip; keep the page's own text off it.` : ""}${got.some(g => g.images?.length) ? ` The article's own photos are saved in its order as ${got.flatMap(g => g.images ?? []).slice(0, 12).join(", ")} ("[사진 n]" in the text marks where photo n sits): look at them, use them for the photo slots of the pages they belong to, and let them guide each page's layout.` : ""}]\n[Source article attached (${got.map(g => g.file).join(", ")}): build the pages from it — hook/cover = its main claim in one line, one point per page in the article's order, closing = a call to action with the blog's name; keep every number and proper noun exactly; do not add facts that are not in the article.${got.some(g => g.image) ? ` The article's lead image (${got.filter(g => g.image).map(g => g.image).join(", ")}) is the user's own image but is often a title thumbnail with large text — open it first and use it for the hook/cover only if it is a real photo without large text.` : ""} Template photos that do not fit the article must change: user photos (context/assets) first, then stock that matches the article (recommend_assets with the article topic as request); never keep an unrelated template photo; if nothing fits, use the page's no-photo layout (data-variant="nophoto") instead of an empty photo box. Ask nothing; just build.]\n`;
    }
    // 내 사진 우선(#83 §3) — 만드는 턴(글·다음 회차·아직 장 없음)에 올린 사진(context/assets)이 있으면 사진 칸은 그것부터, 생성은 빈 칸만
    let mine = "";
    if (m.role === "user" && m.text && !pts.length && !font) {
        const fs = (await T().core.invoke("work_files", { id: m.work }).catch(() => [])).map(f => f.name);
        const photos = fs.filter(n => /^context\/assets\/[^/]+\.(jpe?g|png|webp)$/i.test(n));
        if (photos.length && (article || seriesHead || !fs.some(n => /^result-[a-z0-9-]+\.html$/.test(n))))
            mine = `[User photos in context/assets/ (${photos.slice(0, 8).map(n => n.slice("context/assets/".length)).join(", ")}${photos.length > 8 ? ", …" : ""}) fill the photo slots first — the hook/cover gets the best one, the rest in point order; generate photos only for slots that remain empty.]\n`;
    }
    // 요청 범위(#99) — 칸·장·덱을 판정해 턴 권한을 바꾼다. 같은 요청을 다시 하면 한 단계 올린다("지엽적으로만 고쳐서 또 말한" 신호)
    let scopeHead = "", scope = null, vizAsk = false;
    if (m.role === "user" && m.text && !tpl && !isLib && !font && !m.payload?.task_id && !rewardWorks.has(m.work) && !/\((?:slide|deck) reward, task_id=/i.test(m.text)) {
        const sc0 = await scopeTurn(m.work, m.text, pts, { imported: !!importedHead, mine: !!mine }).catch(() => null);
        const sc1 = sc0 && orderOnly && sc0.scope === "deck" ? { ...sc0, scope: null, head: "" } : sc0; // 순서만 = 가벼운 순서 턴(순서 지시는 orderHead가)
        const sc = frameTurn.has(m.work) && sc1 ? { ...sc1, scope: "deck", head: "" } : sc1; // 판형 바꾸기 = 모든 장(덱 범위 · 판형 지시는 frameHead가)
        if (sc) {
            scope = sc.scope;
            scopeHead = sc.head;
            vizAsk = sc.viz;
            const BW = await import("./bound.js"), whole0 = BW.WHOLE_WORDS.test(m.text) || BW.EXPLAIN_WORDS.test(m.text); // 장 시각화(#197)도 장 전체
            if (pts.length && sc.scope === "page" && !whole0) {
                light = false;
                pointed = "Request: ";
            } // 경계(#193) — 짚은 자리는 맨 앞 📍 Target 줄(#231)이 말한다
            else if (sc.scope === "page" || sc.scope === "deck") {
                light = false;
                if (pts.length)
                    pointed = sc.scope === "deck" ? `[The user pointed at: ${pts.map(p => `${p.file} ${p.slot ?? p.selector}`).join(" · ")} — as context for the request below.]\nRequest: ` : `[📍 This point names a whole page (${[...new Set(pts.map(p => p.file))].join(", ")}): you may replace its layout and re-place its content; keep its slot text unless asked. Read the whole page.]\nRequest: `;
            }
            if (sc.escalated && sc.scope)
                await postChat(m.work, [{ role: "event", text: `같은 요청이라 범위를 넓혀요 · ${SCOPE_KO[sc.scope]}`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
        }
    }
    if (m.role === "user" && m.text)
        turnPage.set(m.work, pts[0]?.file ?? selPage ?? null); // 같이 있음의 "N번 장 · AI 작업 중"(#128 보정 1) — 파일 이름만
    // 그 밖의 표·차트 수정(열·값·행 순서) = 가벼운 턴(#119 보정 10 §2). 장 번호도 📍도 없으면 화면에서 고른 장을 대상으로
    let selHead = "";
    if (m.role === "user" && m.text && !pts.length && TABLE_WORDS.test(m.text) && !NEEDS_LOOK.test(m.text) && scope !== "deck") {
        light = true;
        if (selPage && !/\d{1,2}\s*번\s*(?:째\s*)?(?:장|페이지|슬라이드)|(?:page|slide|p)\s*\d{1,2}\b/i.test(m.text))
            selHead = `[The user means ${selPage} (the page selected on screen) — change only that page.]\n`;
    }
    if (pinHint)
        pointed += pinHint; // 📍 + 짧은 말(위) — 범위가 장·덱으로 바뀐 뒤에도
    // 큰 덱(#140 §2·§6) — 덱 범위의 내용 요청("전체 톤 통일")은 묶음별 큐로 쪼갠다(거부하지 않는다). 구조 요청(순서·묶음·빼기·중복)·검토는 개요로 한 턴
    if (m.role === "user" && m.text && !tpl && (scope === "deck" || orderHead)) {
        const n = ((await readPages(m.work).catch(() => null)) ?? []).length;
        if (n > BIG_DECK) {
            await bigDeckNotice(m.work, n);
            if (orderHead) {
                await writeOutline(m.work).catch(() => null);
                orderHead += `[This deck has ${n} pages: do not open them — .dynapse/outline.json has one line per page (file, title, tag, hero, bundle, words).]\n`;
            }
            else if (!DECK_STRUCT.test(m.text) && !pureReview(m.text) && await startQueue(m.work, m.text, m.payload?.route).catch(() => false))
                return;
        }
    }
    // 큰 덱 만들기(#140 §3) — 새 덱 40장 초과 요청은 개요 턴(가벼움)부터
    let planText = "";
    if (m.role === "user" && m.text && !tpl && !pts.length && !orderHead && BIG_MAKE.test(m.text)) {
        planText = await bigPlanHead(m.work, m.text).catch(() => "");
        if (planText)
            light = true;
    }
    // 찾기 턴(#140 추가 1) — 큰 덱에서 검토·점검 요청(📍 없이). [더 볼 묶음]은 payload.review_bundle
    let reviewText = "";
    // 찾기 목록 뒤 짧은 "고쳐"(#229 보정 2) — 목록 전부 고치기(항목별 큐, 30분 안 목록)
    if (m.role === "user" && m.text && FIX_ALL.test(m.text.trim())) {
        const rv = await readJson(m.work, ".dynapse/review.json").catch(() => null);
        if (rv?.items?.length && Date.now() - (rv.at ?? 0) < 30 * 60_000) {
            await handleChat({ ...m, text: "", payload: { action: "review-fix" } });
            return;
        }
    }
    if (m.role === "user" && m.text && !tpl && !pts.length && !orderHead && (pureReview(m.text) || m.payload?.review_bundle)) {
        const n = ((await readPages(m.work).catch(() => null)) ?? []).length;
        if (n > BIG_DECK) {
            await bigDeckNotice(m.work, n);
            reviewText = await reviewHead(m.work, m.text, m.payload?.review_bundle).catch(() => "");
            if (reviewText)
                light = false;
        }
    }
    // 📍 경계(#193) — 한 장의 요소를 짚었고 장 전체·덱을 말하지 않았으면 그 요소와 부모 블록만. 넘침 불만은 앱의 맞춤 먼저(0토큰)
    const B = await import("./bound.js");
    const boundOf = m.role === "user" && m.text && pts.length && scope !== "deck" && !B.WHOLE_WORDS.test(m.text) && !B.EXPLAIN_WORDS.test(m.text) && new Set(pts.map(p => p.file)).size === 1
        ? { file: pts[0].file, sels: pts.map(p => p.selector || (p.slot ? `[data-slot="${p.slot}"]` : "")).filter(Boolean) } : null;
    if (boundOf && B.FIT_WORDS.test(m.text ?? "") && await fitFirst(m.work, boundOf.file).catch(() => false))
        return;
    // 빈 공간(#235) — 📍·보던 장·지난 자리의 장을 먼저 재고, 앱이 채우면 AI 턴 없음 · 못 채우면 띠 지도를 머리에
    let fillHead = "";
    if (m.role === "user" && m.text && FILL_WORDS.test(m.text)) {
        const f = pts[0]?.file ?? selPage ?? lastEdit.get(m.work)?.pt.file ?? null;
        if (f && (PAGE_RE.test(f) || LANG_PAGE.test(f))) {
            const r = await fillFirst(m.work, f).catch(() => ({ done: false, head: "" }));
            if (r.done)
                return;
            fillHead = r.head;
        }
    }
    // 이 턴의 장(#191 병렬) — 📍 한 장 · "N장" · "이 장"(보던 장). 못 정하면 null(병렬 안 함)
    const tPage = m.role === "user" && m.text ? (await import("./lanes.js")).turnPageOf(m.text, pts, selPage, (await readPages(m.work).catch(() => null)) ?? []) : null;
    // 덱 모티프 말(#201) — "번호 작게/크게/없애/왼쪽 아래로"는 AI 0 덱 턴(모든 장의 덱 블록만). 📍 + "이 장만"이면 그 장 조절 블록만
    if (m.role === "user" && m.text && m.text.length <= 80) {
        const done = await motifSay(m.work, m.text, pts, selPage).catch(() => false);
        if (done)
            return;
    }
    // 조금 옮기기(#236 ① — "그림 조금만 내려"가 AI 턴으로 가 CSS만 만지다 끝났다): 📍(또는 지난 턴에 짚은 요소) + 짧은 말이면 그 요소에 translate를 앱이 바로(AI 0)
    if (m.role === "user" && m.text && pts[0] && m.text.trim().length <= 30 && await pinTextSay(m.work, m.text, pts[0]).catch(() => false))
        return; // 짚은 글의 단순한 말(#299 ④ · AI 0)
    if (m.role === "user" && m.text && m.text.trim().length <= 24) {
        const done = await nudgeSay(m.work, m.text.trim(), pts[0] ?? (lastEdit.get(m.work)?.pt.selector !== "section.slide" ? lastEdit.get(m.work)?.pt : undefined)).catch(() => false);
        if (done)
            return;
    }
    // 리워드는 앱이 먼저 맡는다(#205 — Codex가 "Accept this reward task"를 claim_task로 읽어 직접 불렀다). 맡은 nonce·업로드 자리를 턴 머리에, 19+ 확인이 정말 없으면 작업실 카드로 멈췄다가 이어서
    let claimHead = "";
    {
        const rt = m.role === "user" && m.text && !/claim_nonce=/.test(m.text) ? m.text.match(/\((?:slide|deck) reward, task_id=(task_[a-z0-9]+)\)/i)?.[1] : null;
        if (rt) {
            const c = await claimFirst(m.work, rt, m);
            if (c === "held")
                return;
            if (c)
                claimHead = c;
            await wput(m.work, ".dynapse/reward-brief.md", String(m.text ?? "").slice(0, 20_000)).catch(() => { }); // 검사의 사실 계약(#217 보정 7) — 원고 밖 주소·역·시간·전화·가격을 막는 기준 글
            // 덱 리워드 = 계획 한 턴 + 장마다 한 턴(#214 보정 1 — 첫 턴이 준비에만 8분·141k를 쓰고 장 0개). 끄기는 store reward_seq_off
            if (/\(deck reward, task_id=/i.test(m.text ?? "") && (await store.get("reward_seq_off").catch(() => null)) !== true) {
                seqReward.set(m.work, { taskId: rt, phase: "plan", pages: [], i: 0, skipped: [], retried: false, route: m.payload?.route, t0: Date.now() });
                claimHead += SEQ_PLAN;
                report("turn", "reward.seq_plan", `task=${rt}`);
            }
        }
    }
    // 청첩장 리워드(#280 ③ — 발주 문장 "drop a block rather than invent"로 AI가 혼주·계좌·주소 블록을 지웠다): 발주 글과 별개로 턴마다 블록 유지 한 줄. small wedding 상황만 혼주·계좌 예외
    if (m.role === "user" && m.text) {
        const br = (await wget(m.work, ".dynapse/reward-brief.md").catch(() => null)) ?? "";
        if (br && /wedding-wording|Wedding bifold|data-format="mobile"|청첩장/i.test(br))
            claimHead += REWARD_BLOCKS_LINE(/Situation:\s*small wedding/i.test(br));
    }
    // 참고(#287) — 링크·"이것처럼"·"참고해서"가 든 요청: 남의 마크업을 베끼지 않고 배치 아이디어만, 우리 레이아웃 계약 그대로
    if (m.role === "user" && m.text && (/https?:\/\//.test(m.text) || /이것처럼|이거처럼|이렇게 만들|참고해서|참고하여|비슷하게|따라 만들/.test(m.text)))
        claimHead += "[Reference only: links and attached pages are references — do not copy their markup, scripts or text; take layout ideas only and keep our layout contract (our layout, slots and tokens). Never add pages for a reference.]\n";
    if (m.role === "user" && m.text && REVIEW_ASK.test(m.text) && EDIT_ASK.test(m.text))
        claimHead += "[This message asks for a change and a check: make the change first on the pages it names (all language editions together), then list in your reply what else needs fixing — do not only review.]\n";
    // 짚은 자리 첫 줄(#231) — 사람이 읽을 수 있게: 장 → 요소(칸 · 글 앞부분). 덱 범위가 아니면 맨 앞
    const ptFirst = m.role === "user" && pts.length && scope !== "deck" ? `${guessed ? "[Target given by the app from your last edit — never search the filesystem for a selection.]\n" : ""}${pts.slice(0, 6).map(p => { const t = (p.text ?? (p.snippet ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 40); const lb = !p.slot ? String(p.label ?? "").slice(0, 40) : ""; return `📍 Target: ${p.file} → ${p.selector || (p.slot ? `[data-slot="${p.slot}"]` : "?")}${p.slot || t || lb ? ` (${[p.slot ? `slot ${p.slot}` : lb, t ? `text ‘${t}’` : ""].filter(Boolean).join(", ")})` : ""}`; }).join("\n")}. Edit only inside this element unless the user names the page or deck.\n` : "";
    if (m.role === "user" && m.text && SPACE_WORDS.test(m.text))
        light = false; // 배치·공간 말은 가벼운 턴이 아니다(#233 ③)
    // 칸 글 계약으로 시작(#275 ②) — 장이 하나도 없는 새 덱의 첫 요청 · 판형 카드·슬라이드 · 리워드·템플릿·가져오기·시리즈·폴더 디자인·디자인 참고·짚기·언어판 없음
    let slotsHead = "";
    const rawFirstTurn = m.role === "user" && !!m.text && !rewardWorks.has(m.work) && !(await T().core.invoke("work_files", { id: m.work }).catch(() => [])).some(f => PAGE_RE.test(f.name)) && (await engineMode(m.work)).first === "raw";
    if (m.role === "user" && m.text && !rawFirstTurn && !tpl && !pts.length && !rewardWorks.has(m.work) && !seriesPair && !fdes && !fq?.design_refs && ["card", "card45", "slide", "detail"].includes(fq?.frame ?? "")) {
        const names = (await T().core.invoke("work_files", { id: m.work }).catch(() => [])).map(f => f.name);
        if (!names.some(n => PAGE_RE.test(n) || LANG_PAGE.test(n)) && !importedWorks.has(m.work)) {
            const kind = fq.frame === "slide" ? "slide" : fq.frame === "detail" ? "detail" : "card", lays = await slotMenuFor(kind).catch(() => []);
            if (lays.length >= 4) {
                const S2 = await import("./slots.js"), sb = m.payload?.start_brief;
                slotsHead = S2.slotsInstruction({ pages: kind === "detail" ? null : sb?.count ?? null, menu: S2.slotMenu(lays), detail: kind === "detail" });
                const paras = m.text.split(/\n\s*\n/).filter(x => x.trim()).length, pages = kind === "detail" ? 6 : sb?.count ?? Math.max(4, Math.min(8, paras));
                startSlots(m.work, { kind, fmt: (fq.frame === "slide" ? null : fq.frame), raw: `${verbatim}${m.text}`, pages, menu: S2.slotMenu(lays) });
            }
        }
    }
    // 숫자 보존 검사(C3 5차 ②)의 원고 — 첫 결과에서만 verify가 원고의 숫자·날짜·금액이 그려진 장 글에 다 있는지 본다. 다음 요청부터는 first:false(사용자가 뺀 숫자를 되살리라 하지 않게)
    if (m.role === "user" && m.text && (slotsHead || rawFirstTurn))
        await wput(m.work, ".dynapse/manuscript.json", JSON.stringify({ text: m.text, at: Date.now(), first: true })).catch(() => { });
    else if (m.role === "user" && m.text) {
        const mj = await readJson(m.work, ".dynapse/manuscript.json").catch(() => null);
        if (mj?.first)
            await wput(m.work, ".dynapse/manuscript.json", JSON.stringify({ ...mj, first: false })).catch(() => { });
    }
    if (m.role === "user" && m.text && slotsHead) {
        await simOrSend()(m.work, `${slotsHead}\n${verbatim}${m.text}`, { raw: m.text, points: [], route: m.payload?.route, capLeft: m.payload?.cap_left ?? null, light, receivedAt: receivedAt.get(m.work) });
        return;
    }
    if (m.role === "user" && m.text) {
        if (pts.length)
            pointTurn.add(m.work);
        await simOrSend()(m.work, tpl ? `${hand}${webFonts}${tpl}\n요청: ${m.text}` : factsHead + ptFirst + keepHead + fillHead + claimHead + libraryHead + driveHead + connHead + folderHead + seriesHead + article + planHead + (isLib ? "" : mine) + (seriesHead || article || isLib ? "" : importedHead) + hand + handPages + viewHead + frameHead + motionHead + storyHead + fontHead + webFonts + fontAsk + verbatim + designHead + (planText || reviewText || scopeHead) + orderHead + todoHead + fixHead + selHead + pointed + m.text, { raw: m.text, points: pts, ...(tPage ? { page: tPage } : {}), ...(boundOf ? { bounded: boundOf } : {}), route: m.payload?.route, capLeft: m.payload?.cap_left ?? null, light, ...(scope ? { scope } : {}), ...(vizAsk ? { viz: true } : {}), ...(motionOn ? { motion: true } : {}), receivedAt: receivedAt.get(m.work), library: isLib, ...(isLib ? {} : { folderDir }), ...(driveTurn ? { drive: true } : {}), ...(connTools.length ? { connectors: connTools } : {}) });
    }
}
// 모델 이름 한 줄(#109) — claude-opus-5-5 → Opus 5.5 · gpt-5-codex → GPT-5 Codex
export function prettyModel(id) {
    if (!id)
        return null;
    const c = id.match(/^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?/i);
    if (c)
        return `${c[1][0].toUpperCase()}${c[1].slice(1)} ${c[2]}${c[3] && c[3].length <= 2 ? `.${c[3]}` : ""}`;
    return id.replace(/^gpt-/i, "GPT-").replace(/-(codex|mini|pro)\b/gi, (_m, w) => ` ${w[0].toUpperCase()}${w.slice(1)}`);
}
const SCOPE_KO = { slot: "칸", page: "장", deck: "덱 전체" };
// 표·차트 말(#119 보정 10 §2) — "표"는 홀로 선 낱말만(장표·도표·발표·목표·표지·표시 안의 표는 아니다, #120 보정 2)
const TABLE_WORDS = /(?<![가-힣])표(?:를|가|는|은|에|에서|의|로|만|도|랑)?(?![가-힣])|테이블|\btables?\b|차트|그래프|\bcharts?\b|\bgraphs?\b/i;
// 사용자가 범위를 직접 말하면(덱 단위로·가벼운 턴 말고·제대로) 판정보다 우선(#120 보정 2)
const DECK_WORDS = /덱\s*단위|가벼운\s*턴\s*말고|제대로|whole deck|전체|모든 ?장|덱 ?전체|순서|구조|흐름|스토리|장\s*(을|를)?\s*(추가|삭제|빼|넣|늘|줄)|(장표|페이지|슬라이드)\s*(을|를|도|로|하나|한\s*장)?\s*(더\s*)?(추가|삭제|넣|만들|늘|빼)|\d{1,2}\s*(장|페이지|번\s*장)\s*(뒤|앞|다음|사이)|새\s*(장|장표|페이지|슬라이드)|한\s*장\s*더|부록|처음부터|다시 ?짜|재구성|중복\s*(된|인)?\s*(장|페이지|슬라이드)|duplicate (pages|slides)|whole deck|all (the )?(pages|slides)|re-?order|restructure|storyline|\bflow\b|add (a |more )?(page|slide)s?|remove (a |the )?(page|slide)|appendix|from scratch/i;
const PAGE_WORDS = /이 ?장|이 ?페이지|이 ?슬라이드|레이아웃|배치|구성|다시 ?(만들|짜|구성)|갈아|통째|디자인 ?(바꿔|바꾸|다시)|layout|re-?arrange|redesign|this (page|slide)/i;
// 구조를 바꾸는 요청(#99 보정 1) — 📍는 대상만 정하고 범위는 요청이 정한다: 항목 더·다른 배열·나누기·합치기·넓히기·키우기는 그 장(같은 턴에서, "같은 요청" 두 번째 턴을 기다리지 않는다)
const STRUCT_WORDS = /더\s*(넣|추가|늘|많이|보여|써)|늘려|늘리|하나\s*더|몇\s*개|개만|개\s*밖에|만\s*쓸|배열|정렬|나눠|나누|쪼개|분리|합쳐|합치|넓혀|넓게|넓히|키워|키우|크게|칸\s*(을|를)?\s*(늘|추가|더)|more (items|cards|rows|photos|images)|another (arrangement|layout)|split|merge|wider|bigger|enlarge/i;
const PHOTO_WORDS = /(사진|이미지|그림)\s*(을|를|이|도)?\s*(넣|더|추가|바꿔|바꾸|교체|늘려|많이|써|활용)|사진이 ?(없|부족|안 ?들어)|add (more )?(photos?|images?)|more (photos|images)|replace (the )?(photo|image)/i;
const VIZ_WORDS = /시각화|인포그래픽|도식|다이어그램|차트|그래프|페르소나|아이콘|여정 ?지도|타임라인|visuali[sz]|infographic|diagram|chart|graph|persona|icons?\b|journey|timeline/i;
const lastAsk = new Map();
// 결함 말(C4 A) · 좁히는 말 — 결함은 덱에서 같은 것을 찾아 같이, "이 페이지만·여기만"은 그 자리만
export const DEFECT_WORDS = /잘려|잘림|잘리|잘린|넘쳐|넘침|넘치|삐져|대비|흐릿|겹쳐|겹침|PDF|인쇄|프린트|내보내|(?:글꼴|폰트|글자|한글)\s*(?:이|가)?\s*(?:깨|이상|안\s*나와)|cut\s*off|overflow|clipped/i; // 그냥 "깨져 보여"는 그 요소 이야기(turn-cases text-04)
export const ONLY_HERE = /이\s*(?:페이지|장|슬라이드)\s*만|여기\s*만|이것만|이거만|이\s*칸만|이\s*부분만/;
const defectAsk = new Map();
const wordsOf = (t) => new Set(t.toLowerCase().replace(/\[[^\]]*\]/g, " ").split(/[^0-9a-z가-힣]+/).filter(w => w.length >= 2));
async function scopeTurn(id, text, pts, o = {}) {
    // "3장 전체"·"이 장 전체" = 그 장 하나(덱 아님)
    const t = text.replace(/\[첨부:[^\]]*\]/g, "").replace(/(\d+|이|그)\s*(장|페이지|슬라이드)\s*(을|를|의)?\s*전체/g, " 이 장 ");
    const photoAsk = PHOTO_WORDS.test(t);
    const vizAsk = VIZ_WORDS.test(t);
    // 장 하나를 대고 "다시 짜·재구성"만 덱 말이면 그 장(turn-sim page-01 — "3장 레이아웃 다시 짜줘"가 덱 전체 무거운 턴이 됐다)
    const onePage = PAGE_WORDS.test(t) && /(^|[^\d])\d{1,2}\s*(장|페이지|번\s*장)(?!\s*(뒤|앞|다음|사이|이랑|하고|과|와))/.test(t) && !DECK_WORDS.test(t.replace(/다시 ?짜|재구성/g, " "));
    // 📍가 있으면 덱은 덱을 분명히 말할 때만(#193 — "제대로 위치 잡아봐"가 덱 턴이 됐다) · 장 전체는 "장 전체·통째·다 다시"일 때만
    const { DECK_STRICT, WHOLE_WORDS, BOUND_LINE, EXPLAIN_WORDS } = await import("./bound.js");
    const explain = EXPLAIN_WORDS.test(text) && (pts.length > 0 || PAGE_WORDS.test(t) || /(^|[^\d])\d{1,2}\s*(장|페이지)/.test(t)); // 장 시각화(#197)
    const whole = WHOLE_WORDS.test(text) || explain, deckOk = pts.length ? DECK_STRICT.test(t) : DECK_WORDS.test(t);
    // 결함·출력 문제(잘림·넘침·대비·PDF·인쇄·글꼴 깨짐)는 📍가 있어도 덱 전체(C4 A — "PDF에서 잘려"를 짚은 장만 고치고 바로 다음 장의 같은 결함은 두었다). "이 페이지만·여기만"이면 그 자리만
    const defectDeck = pts.length > 0 && DEFECT_WORDS.test(t) && !ONLY_HERE.test(t);
    let scope = defectDeck ? "deck" : deckOk && !onePage ? "deck" : pts.length && whole ? "page" : PAGE_WORDS.test(t) || STRUCT_WORDS.test(t) || photoAsk || (vizAsk && pts.length) ? "page" : pts.length ? "slot" : null; // 📍 상자에 "도식으로" = 그 장(#102 §3)
    // 같은 요청 두 번(30분 안 · 낱말 60% 겹침) → 한 단계 위로
    const w = wordsOf(t), prev = lastAsk.get(id);
    let escalated = false;
    if (prev && !pts.length && Date.now() - prev.at < 30 * 60_000 && w.size >= 2) { // ⌖로 짚은 말은 넓히지 않는다(#233 보정 1 — 같은 말 + ⌖가 "범위를 넓혀요 · 장"으로 보던 장을 덮었다)
        const inter = [...w].filter(x => prev.words.has(x)).length, sim = inter / Math.max(1, Math.min(w.size, prev.words.size));
        if (sim >= 0.6) {
            const up = prev.scope === "slot" || pts.length ? "page" : "deck"; /* 📍 턴은 덱까지 넓히지 않는다(#193) */
            if (!scope || ["slot", "page", "deck"].indexOf(up) > ["slot", "page", "deck"].indexOf(scope)) {
                scope = up;
                escalated = true;
            }
        }
    }
    lastAsk.set(id, { words: w, scope: scope ?? "slot", at: Date.now() }); // 범위 없는 보통 턴을 또 말하면 장으로
    const parts = [];
    // 사진 AI · 올린 사진(#99 §3) — 개인 작업이면 매 턴(가벼운 칸 턴은 빼고)
    if (scope !== "slot" && (!o.imported || photoAsk)) { // 가져온 덱의 첫 턴은 사진을 건드리지 않는다(#56 보정 1) — 사진을 말했을 때만
        const ai = ["chatgpt", "gemini"].filter(a => photoReady(a));
        parts.push(ai.length ? `Photo AI: ${ai.map(a => AI_LABEL[a]).join(", ")} connected — request photos freely via .dynapse/photo-requests.json (at most 6 this turn); the app makes them after your turn. In this personal work any page may carry a photo where it helps (cover, cases, product, team, closing); there is no 3-page cap.` : "No photo AI is connected — use the user's photos and stock only.");
        const fs = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(n => /^context\/assets\/[^/]+\.(jpe?g|png|webp)$/i.test(n));
        if (fs.length && !o.mine) {
            const idx = new Map();
            const fi = await readJson(id, ".dynapse/folder-images.json").catch(() => null);
            for (const x of fi?.images ?? [])
                if (x.name && x.shows)
                    idx.set(x.name, x.shows);
            const lib = await readJson(id, "context/library.json").catch(() => null);
            for (const x of lib?.items ?? [])
                if (x.file && x.summary)
                    idx.set(x.file.split("/").pop(), x.summary);
            parts.push(`User photos (use these first): ${fs.slice(0, 12).map(n => { const b = n.slice("context/assets/".length); return idx.get(b) ? `${n} (${idx.get(b).slice(0, 60)})` : n; }).join(", ")}${fs.length > 12 ? ", …" : ""}.`);
        }
    }
    if (defectDeck) {
        defectAsk.set(id, [...new Set(pts.map(p => p.file))]);
        parts.push(`Defect request: the user pointed at ${[...new Set(pts.map(p => `${p.file}${p.selector ? ` (${p.selector})` : ""}`))].join(", ")} to show where they saw it — the 📍 is a location hint, not a limit. Fix this defect there, then check every other page for the same defect (run the checker; for PDF or print problems compare each page's size and edges) and fix those the same way in this turn. Do not change anything else. In your reply, name the other pages you also fixed.`);
    }
    else
        defectAsk.delete(id);
    if (photoAsk)
        parts.push("Photo request: for each page that would benefit and has no photo slot, switch it to a layout that has one (cp materials/<layout>.html over that page's file, keep its text and page_no), then use the user's photos or add .dynapse/photo-requests.json entries for the empty photo slots (at most 6).");
    if (scope === "page" && pts.length && !whole)
        parts.push(BOUND_LINE); // 📍 + 구조 말 = 그 요소와 부모 블록만(#193) · 칸 범위 📍는 머리 줄 "edit ONLY these"가 같은 일
    if (scope === "page" && pts.length && whole)
        parts.push("The 📍 marks the target; the request decides the scope — this request changes the structure, so work on the whole page now (more items, another arrangement, split, merge, wider or bigger boxes). Rebuild from the existing page as reference: same tokens, the same slot naming and distance; photos from materials/ and the user's library first. Never answer that the layout or the pin does not allow it.");
    if (explain) {
        scope = "page";
        parts.push("Visual page (#197): turn this page into a visual explanation the audience reads in three seconds. 1) Pick the layout: explain-labels (how something works — a process, parts, a flow) or explain-stat (one key number and what it means). Copy materials/<layout>.html over this page's file (keep the file name) and fill its slots. 2) Copy: section_title ≤8 words; explain_sub one line; explain_tags = three labels of ≤3 words, each naming a part the illustration will show; explain_note = survey conditions or source. Presentation copy, not report sentences — a number carries one phrase of what changed. 3) Append one request to .dynapse/photo-requests.json: {\"file\": this page, \"slot\": \"explain_photo\", \"kind\": \"illustration\", \"brief\": subject, composition, and the three labelled parts placed left / right / bottom — no style words}. The app makes the illustration after your turn.");
    }
    if (scope === "page" && (!pts.length || whole))
        parts.push("Scope: page. You may read the whole page, change its data-variant, rebuild its blocks, add a photo slot, or replace its layout with another registry layout that fits its role and data (cp materials/<layout>.html over the same file name — never rename result-*.html — then move the text and photos into the new slots and keep the page's <style data-fonts>, data-pack, data-brand and data-tokens blocks). Leave other pages as they are.");
    // 뺀 장(#139 §3) — 덱 범위 턴에는 목록을 주고, 이름으로 다시 넣게(turn.json "relink")
    if (scope === "deck") {
        const del = ((await readJson(id, DELETED).catch(() => null)) ?? []).slice(-20);
        if (del.length)
            parts.push(`Removed pages (kept in history; to bring one back, list its file in .dynapse/turn.json "relink": [...] — never recreate it): ${del.map(d => `${d.file}${d.title ? ` "${d.title}"` : ""}`).join(", ")}.`);
    }
    const nPages = scope === "deck" ? ((await readPages(id).catch(() => null)) ?? []).length : 0;
    // 큰 덱(#140 §1) — 장 본문 대신 개요만. 구조(순서·묶음·부록·빼기·다시 넣기)만 이 턴에서, 장 내용은 묶음 턴으로(turn.json "queue")
    if (scope === "deck" && nPages > BIG_DECK) {
        await writeOutline(id).catch(() => null);
        parts.push(`Scope: whole deck of ${nPages} pages — too long to read. Do not open the pages: .dynapse/outline.json has one line per page (file, title, tag, hero, bundle, words); work from it. In this turn change only the structure: .dynapse/pages.json (order), .dynapse/bundles.json (a bare array of {name, pages}), .dynapse/appendix.json, and .dynapse/turn.json "relink". To drop a page, move it to the appendix. If the request also needs page content changed, do not edit pages here: add .dynapse/turn.json "queue": [{"bundle":"<bundle name>","ask":"<what to change there, one line>"}] and the app runs one turn per bundle. Reply in Korean: what you changed and which bundles are queued.`);
    }
    else if (scope === "deck")
        parts.push("Scope: whole deck. Read every page. You may add, delete (move to the appendix in .dynapse/appendix.json rather than deleting the user's content) and reorder pages (.dynapse/pages.json — only when the request names pages and asks to move them; a described flow is not a reorder, and an order the user set stays), and replace layouts on several pages. Pick each page's layout by the data it carries; never three same layouts in a row; strongest number in the first three pages. The app runs an editor read after your turn.");
    // 시각화 계획 먼저(#102 §3) — 덱 범위나 시각화 어휘면 장마다 데이터 종류와 그릴 것을 먼저 적고 그 다음 장을 만든다
    // 장 하나를 짚은 턴은 계획 파일 없이 바로 고친다(대표 2026-10-22 "변경해 계획을 하지 말고" — 계획만 적고 제목·축 글자만 바뀐 턴). 덱 범위만 계획 먼저
    if (scope === "deck" && nPages <= BIG_DECK)
        parts.push(`Visualization plan first: before editing pages, write .dynapse/viz-plan.json = [{"page":"result-….html","data_kind":"number|trend|share|process|compare|persona|journey|list|text","viz":"<data-viz type | persona-card | journey-map | icon-row | none>","why":"…"}] for every page, then build the pages from it (charts as data-viz JSON — the app draws them).${vizAsk ? " The request asks for visualization: at least one page must use one." : ""}`);
    else if (vizAsk)
        parts.push("Visualization: change the page itself in this turn (charts as data-viz JSON — the app draws them; a comparison as a real layout of rows, columns or a matrix, not restyled text). Do not write a plan file and do not report a plan; the reply says what changed on the page.");
    if (scope === "page" || scope === "deck")
        parts.push("Reply: the first line states the scope you understood and what you will do (e.g. \"3장을 비교 레이아웃으로 바꾸고 숫자를 크게 · 다른 장은 그대로\") — do not ask, state your assumption and proceed; then the result; the last line lists the pages you changed.");
    return { scope, head: parts.length ? `[${parts.join(" ")}]\n` : "", escalated, viz: vizAsk };
}
const receivedAt = new Map();
export const importedWorks = new Set(); // 가져온 덱(#56 보정 1) — 첫 턴의 첫 생성 사진 규칙(#49 B)을 쓰지 않는다
const pointTurn = new Set(); // 📍 턴(usage 카드에 📍 표시)
// 직접 수정 커밋(#25 B·#26) — 웹 캔버스가 page_write로 쓴 페이지를 커밋하고 한 줄. AI 호출 0
async function pageCommit(id, file, note, patch) {
    if (!/^result-[a-z0-9-]+\.html$/.test(file) && !LANG_PAGE.test(file))
        return;
    void syncLangs(id, [file]).catch(() => { }); // 조절·구조는 다른 언어판에, 글자는 "번역 안 됨" 표시만(#100)
    // 조절(#78 보정 6 B) — 그 장의 <style data-tweaks> 블록 통째. 대조 없이 블록을 바꾸므로 undo가 HEAD에서 나머지를 다시 적용해도 맞는다. 접지 않는다(한 걸음 = undo 한 번)
    if (patch?.kind === "tweak" && typeof patch.block === "string") {
        await addPending(id, { t: "tweak", page: file, block: patch.block, target: patch.target ?? "", label: `${pageLabel(file)} · ${note.slice(0, 30)}`, ...(patch.group ? { group: patch.group } : {}) });
        return;
    }
    // 직접 수정은 모은다(#46) — 파일은 이미 바뀌었고(보인다) 커밋은 [보내기]·다음 요청·20분 뒤 한 번에
    {
        const lm = file.match(LANG_PAGE);
        if (lm && patch?.neu && typeof DOMParser !== "undefined")
            void pinLangLeaf(id, file, lm[2], patch.neu).catch(() => { });
    } // 언어판 손 고침은 그 칸을 고정(#234 보정 1 ④)
    {
        const lm = file.match(LANG_PAGE);
        if (lm && patch?.old && patch?.neu && patch.old.trim() !== patch.neu.trim() && patch.old.length <= 300) { // 언어판 손 고침 → 덱 용어집(#100 보정 5)
            const a = (await readJson(id, ".dynapse/lang-fixes.json").catch(() => null)) ?? [];
            a.push({ lang: lm[2], from: patch.old.trim(), to: patch.neu.trim(), at: Date.now() });
            await wput(id, ".dynapse/lang-fixes.json", JSON.stringify(a.slice(-200), null, 1)).catch(() => { });
            if (await isTeamAccount())
                void api("POST", "/api/lang-fixes", { work: id, pairs: [{ lang: lm[2], from: patch.old.trim(), to: patch.neu.trim() }] }).catch(() => { });
        }
    } // 팀 계정만 서버로(copy-lint 후보) — 일반 사용자 글은 보내지 않는다
    await addPending(id, { t: "text", page: file, old: patch?.old ?? "", neu: patch?.neu ?? "", nth: patch?.nth ?? 0, ...(patch?.sel ? { sel: patch.sel } : {}), ...(patch?.kind === "ids" || patch?.kind === "struct" ? { kind: patch.kind } : {}), ...(patch?.group ? { group: patch.group } : {}), label: `${pageLabel(file)} · ${note.slice(0, 30)}` });
}
// 글자 편집 폴백(#101) — 캔버스가 원본에서 못 맞춘 편집. 지금 파일에서 그 요소를 찾아 old를 바꾸고(공백·U+2060·nbsp·엔티티 무시), 못 찾으면 자식 태그가 없는 요소는 글자 통째를 neu로
const escH = (x) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function textBySel(src, sel, old, neu) {
    if (typeof DOMParser === "undefined")
        return { why: "파서 없음" };
    const doc = new DOMParser().parseFromString(src, "text/html");
    let el = null;
    try {
        el = doc.querySelector(sel);
    }
    catch {
        return { why: "sel 오류" };
    }
    if (!el || el === doc.body || el === doc.documentElement)
        return { why: "sel 없음" };
    const tag = el.tagName.toLowerCase(), k = Array.from(doc.getElementsByTagName(tag)).indexOf(el);
    const masked = src.replace(/<!--[\s\S]*?-->/g, x => " ".repeat(x.length)).replace(/(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi, (_x, a, _t, b, c) => a + " ".repeat(b.length) + c);
    const opens = [];
    const re = new RegExp(`<${tag}(?=[\\s>/])`, "gi");
    for (let x = re.exec(masked); x; x = re.exec(masked))
        opens.push(x.index);
    const at = opens[k];
    if (at === undefined)
        return { why: "sel 없음" };
    const openEnd = masked.indexOf(">", at) + 1;
    if (!openEnd)
        return { why: "sel 없음" };
    const tr = new RegExp(`<(\\/?)${tag}(?=[\\s>/])`, "gi");
    tr.lastIndex = openEnd;
    let depth = 1, closeAt = masked.length;
    for (let x = tr.exec(masked); x; x = tr.exec(masked)) {
        depth += x[1] ? -1 : 1;
        if (depth === 0) {
            closeAt = x.index;
            break;
        }
    }
    const inner = src.slice(openEnd, closeAt), mInner = masked.slice(openEnd, closeAt);
    const o = old.replace(/[\u2060]/g, "").trim(), n = escH(neu.trim()).replace(/\n/g, "<br>"); // Shift+Enter 줄 바꿈은 <br>(캔버스 applyTextEditAt과 같게)
    if (o) {
        // 글자 사이 공백·U+2060·nbsp·엔티티를 하나로 보는 패턴
        const pat = [...o].map(ch => /\s/.test(ch) ? "(?:\\s|&nbsp;|\u00a0)+" : ch === "&" ? "&(?:amp;)?" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\u2060?").join("");
        const rx = new RegExp(pat, "g");
        for (let x = rx.exec(inner); x; x = rx.exec(inner)) {
            const lt = mInner.lastIndexOf("<", x.index), gt = mInner.lastIndexOf(">", x.index);
            if (gt < lt)
                continue;
            return { html: src.slice(0, openEnd + x.index) + n + src.slice(openEnd + x.index + x[0].length) };
        }
    }
    if (!el.children.length)
        return { html: src.slice(0, openEnd) + n + src.slice(closeAt) };
    return { why: "old 없음" };
}
async function textSelCommit(id, file, t) {
    const t0 = Date.now();
    const src = await wget(id, file).catch(() => null);
    const r = src ? textBySel(src, t.sel, t.old, t.neu) : { why: "파일 없음" };
    void actionMetric(id, "text_edit_failed", t0, { why: t.why || null, rescued: "html" in r, ...("why" in r ? { app_why: r.why } : {}) }).catch(() => { });
    if ("why" in r) {
        await postChat(id, [{ role: "event", text: `글자 저장 실패 · ${r.why} · ${pageLabel(file)}`, payload: { kind: "error", ai: "dynapse", file } }]).catch(() => { });
        return;
    }
    await wput(id, file, r.html);
    await pageCommit(id, file, t.note, { old: t.old, neu: t.neu, nth: t.nth, sel: t.sel });
}
// 손으로 고친 장(#101 §4) — 글자·조절·사진을 손으로 바꾼 장. 매 턴 머리말에 "통째로 다시 만들지 말 것"(두 턴 뒤 사라지던 Hand edits와 따로) · verify가 조절·요소 id가 사라지면 hand_lost
const HAND_PAGES = ".dynapse/hand-pages.json";
const LAYOUT_ASK = /배치|레이아웃|구조|구성|다시\s*짜|새로\s*짜|틀을?\s*바꿔|layout|re-?arrange/i; // 장의 짜임을 바꾸라는 말 — 손 고친 장 표시를 푼다
// 오프라인 보기에서 고친 장(#146) — 손댄 장으로 적고(다음 AI 턴이 지킨다) 커밋 1 · 끊겨 있으면 올리기 대기열에(연결되면 올린다). 같은 장 연속 저장은 한 커밋으로 묶는다(10초)
const viewerT = new Map();
export async function viewerSaved(id, file) {
    await markHandPage(id, file);
    const k = `${id}|${file}`;
    clearTimeout(viewerT.get(k));
    viewerT.set(k, setTimeout(() => {
        viewerT.delete(k);
        void (async () => {
            await repoCommit(id, `이 PC에서 직접 고침 · ${pageLabel(file)}`).catch(() => null);
            const { netState, queuePush } = await import("./net.js");
            if (netState() !== "online")
                queuePush(id);
        })();
    }, 10_000));
}
async function markHandPage(id, page) {
    if (!PAGE_RE.test(page))
        return;
    const cur = ((await readJson(id, HAND_PAGES)) ?? []).filter(x => typeof x === "string");
    if (!cur.includes(page))
        await wput(id, HAND_PAGES, JSON.stringify([...cur, page].slice(-60))).catch(() => { });
}
async function handPagesPrefix(id) {
    const cur = ((await readJson(id, HAND_PAGES)) ?? []).filter(x => typeof x === "string" && PAGE_RE.test(x));
    if (!cur.length)
        return "";
    const have = new Set((await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name));
    const live = cur.filter(f => have.has(f));
    return live.length ? `[Pages edited by hand (keep their text, data-tweaks and data-tid; edit in place, never recreate or cp a layout over them): ${live.map(f => f.replace(/^result-|\.html$/g, "")).slice(0, 20).join(", ")}]\n` : "";
}
// 장 삭제(#97 보정 1) — AI 없이: 직접 수정을 먼저 저장 → 그 장(과 언어판) 파일 삭제 → 순서·쪽번호 다시 → 커밋 1. 복원용으로 직전 커밋·자리를 .dynapse/deleted.json에 쌓는다
const DELETED = ".dynapse/deleted.json";
async function deletePage(id, file, o = {}) {
    await savePending(id).catch(() => null);
    const sha = await T().core.invoke("repo_head", { id }).catch(() => null);
    if (!sha) {
        await postChat(id, [{ role: "event", text: "지우지 못했어요 · 저장된 버전이 없어요", payload: { kind: "error", ai: "dynapse" } }]).catch(() => { });
        return;
    }
    const order = ((await readPages(id)) ?? []).filter(x => typeof x === "string");
    const apx = ((await readJson(id, ".dynapse/appendix.json")) ?? []).filter(x => typeof x === "string");
    const vers = (await langFiles(id)).vers.filter(v => baseOf(v) === file);
    const html0 = (await wget(id, file).catch(() => null)) ?? "";
    for (const f of [file, ...vers]) {
        const ok = await T().core.invoke("page_delete", { id, path: f }).then(() => true).catch(() => false);
        if (!ok && f === file) {
            await postChat(id, [{ role: "event", text: "지우지 못했어요 · 앱을 업데이트해 주세요(0.1.69 이상)", payload: { kind: "error", ai: "dynapse" } }]).catch(() => { });
            return;
        }
    }
    if (apx.includes(file))
        await wput(id, ".dynapse/appendix.json", JSON.stringify(apx.filter(x => x !== file))).catch(() => { });
    // 뺀 장 목록(#139 §3) — 50개까지(장 제목으로 다시 넣기). 같은 파일을 다시 빼면 앞 기록은 지운다
    const stack = ((await readJson(id, DELETED)) ?? []).filter(d => d.file !== file).slice(-49);
    const bundle = ((await readJson(id, BUNDLES).catch(() => null)) ?? []).find(b => Array.isArray(b?.pages) && b.pages.includes(file))?.name;
    await wput(id, DELETED, JSON.stringify([...stack, { file, sha, at: order.indexOf(file), vers, appendix: apx.includes(file), when: Date.now(), title: titleOf(html0), ...(bundle ? { bundle } : {}) }]));
    await normalizeOrder(id, order.filter(x => x !== file));
    await writeLangStatus(id).catch(() => { });
    if (o.commit === false)
        return;
    await repoCommit(id, `장 빼기 · ${pageLabel(file)}`);
    // 빼기 = 연결 끊기(#139 §3) — 파일은 기록에 남는다. 말로도 다시 넣을 수 있다
    const t0 = titleOf(html0);
    await postChat(id, [{ role: "event", text: `${pageLabel(file)}을 뺐어요 · ⌘Z 또는 "${t0 ? `${t0.slice(0, 16)} ` : ""}장 다시 넣어줘"`, payload: { kind: "stage", ai: "dynapse", order: true } }]).catch(() => { });
    void afterSave(id);
}
const titleOf = (h) => (h.match(/<(h1|h2)\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
async function restoreLastPage(id) {
    const d = ((await readJson(id, DELETED)) ?? []).at(-1);
    if (d)
        await relinkPage(id, d.file);
}
// 다시 넣기(#139 §3) — 뺀 장(deleted.json)은 그 커밋에서 되살리고 자리·묶음으로, 순서 밖 옛 장은 순서 끝에. commit=false면 턴 커밋에 함께
export async function relinkPage(id, file, o = {}) {
    const stack = (await readJson(id, DELETED)) ?? [];
    const d = [...stack].reverse().find(x => x.file === file);
    if (!d) {
        const order = ((await readPages(id)) ?? []).filter(x => typeof x === "string");
        if (order.includes(file) || !(await wget(id, file).catch(() => null)))
            return false;
        await normalizeOrder(id, [...order, file]);
        if (o.commit !== false) {
            await repoCommit(id, `장 다시 넣기 · ${pageLabel(file)}`);
            await postChat(id, [{ role: "event", text: `${pageLabel(file)}을 다시 넣었어요`, payload: { kind: "stage", ai: "dynapse", order: true } }]).catch(() => { });
            void afterSave(id);
        }
        return true;
    }
    for (const f of [d.file, ...d.vers]) {
        const h = await T().core.invoke("repo_show", { id, sha: d.sha, file: f }).catch(() => null);
        if (h)
            await wput(id, f, h);
    }
    const order = ((await readPages(id)) ?? []).filter(x => x !== d.file);
    if (d.appendix) {
        const apx = (await readJson(id, ".dynapse/appendix.json")) ?? [];
        await wput(id, ".dynapse/appendix.json", JSON.stringify([...new Set([...apx, d.file])])).catch(() => { });
    }
    else if (d.at >= 0)
        order.splice(Math.min(d.at, order.length), 0, d.file);
    await wput(id, DELETED, JSON.stringify(stack.filter(x => x !== d)));
    if (d.bundle) {
        const bs = (await readJson(id, BUNDLES).catch(() => null)) ?? [];
        const b = bs.find(x => x?.name === d.bundle);
        if (b) {
            b.pages = [...new Set([...(b.pages ?? []), d.file])];
            await wput(id, BUNDLES, JSON.stringify(bs)).catch(() => { });
        }
    }
    // 다시 넣기는 순서 안으로(옛 장이었으면 끝에)
    if (d.at < 0 && !d.appendix)
        order.push(d.file);
    await normalizeOrder(id, order);
    await normalizeBundles(id).catch(() => false);
    await writeLangStatus(id).catch(() => { });
    if (o.commit !== false) {
        await repoCommit(id, `장 다시 넣기 · ${pageLabel(d.file)}`);
        await postChat(id, [{ role: "event", text: `${pageLabel(d.file)}을 다시 넣었어요`, payload: { kind: "stage", ai: "dynapse", order: true } }]).catch(() => { });
        void afterSave(id);
    }
    return true;
}
const PENDING = ".dynapse/pending-edits.json", HANDED = ".dynapse/hand-edits.json", REDO = ".dynapse/redo-edits.json";
// [턴 시작으로](#143 §2) — 앱이 다시 쓴 장에 새 오류가 났을 때의 그 장 턴 시작 판. 사용자가 고르면 직접 수정(restore)으로 쌓인다
const REGRESS = ".dynapse/out/regress-start.json"; // .dynapse/tmp/는 네이티브 work_rel이 거절한다(#164 ① 하네스가 찾음 — [턴 시작으로]의 기록이 실제 앱에선 쓰이지 않았다)
const redoOf = async (id) => ((await readJson(id, REDO)) ?? []).filter(x => Array.isArray(x) && x.length);
const autoSave = new Map();
const pendingOf = async (id) => ((await readJson(id, PENDING)) ?? []).filter(e => e && e.t);
async function showPending(id, list) {
    const redo = (await redoOf(id)).length;
    await postChat(id, [{ role: "event", text: null, payload: { kind: "edits", ai: "dynapse", items: list.map(e => e.label), redo } }]).catch(() => { });
}
export async function addPending(id, e, keepRedo = false) {
    if ((e.t === "text" || e.t === "tweak" || e.t === "photo") && !(e.t === "text" && e.kind === "ids"))
        await markHandPage(id, e.page).catch(() => { });
    if (!keepRedo)
        await wput(id, REDO, "[]\n"); // 새 편집이 들어오면 다시 하기는 비운다
    const list = (await pendingOf(id)).filter(x => !(e.t === "font" && x.t === "font") && !(e.t === "palette" && x.t === "palette") && !(e.t === "photo" && x.t === "photo" && x.page === e.page && x.slot === e.slot)); // 같은 칸·폰트는 마지막 것만
    list.push(e);
    await wput(id, PENDING, JSON.stringify(list, null, 1));
    await showPending(id, list);
    clearTimeout(autoSave.get(id));
    autoSave.set(id, setTimeout(() => { void savePending(id, true); }, 20 * 60_000)); // 20분 동안 아무 것도 안 하면 자동 저장
    void afterSave(id);
}
// AI에게(#78 보정 6 B) — 장별 한 문장: "card-3: 3 style adjustments (page_no, body), 1 text change; card-5: 1 photo swap". 파일이 진실이고 이건 존중 머리말
function handLines(list) {
    const out = [], by = new Map();
    for (const e of list) {
        if (e.t === "stopped" || e.t === "font" || e.t === "palette" || e.t === "restore") {
            out.push(handLine(e));
            continue;
        }
        if (e.t === "text" && e.kind === "ids")
            continue; // 요소 id 심기는 알릴 것 없음
        const k = pageKey(e.page), b = by.get(k) ?? by.set(k, { tw: new Set(), nTw: 0, text: 0, photo: 0, struct: 0 }).get(k);
        if (e.t === "tweak") {
            b.nTw++;
            if (e.target)
                b.tw.add(e.target);
        }
        else if (e.t === "photo")
            b.photo++;
        else if (e.kind === "struct")
            b.struct++;
        else
            b.text++;
    }
    const pl = (n, w) => `${n} ${w}${n > 1 ? "s" : ""}`;
    for (const [k, b] of by)
        out.unshift(`${k}: ${[b.nTw ? `${pl(b.nTw, "style adjustment")}${b.tw.size ? ` (${[...b.tw].slice(0, 4).join(", ")})` : ""}` : "", b.text ? pl(b.text, "text change") : "", b.struct ? pl(b.struct, "element duplicate/delete/reorder") : "", b.photo ? pl(b.photo, "photo swap") : ""].filter(Boolean).join(", ")}`);
    return out;
}
const handLine = (e) => e.t === "palette" ? `deck colours changed by the user (palette ${e.id}) — keep tokens.css as it is` : e.t === "restore" ? `${pageKey(e.page)} restored to its state before the last turn (user choice)` : e.t === "tweak" ? `${pageKey(e.page)} style adjustment` : e.t === "stopped" ? `${e.why === "verify" ? "changes kept after a failed app check" : "partial changes from a stopped turn"} in ${e.files.slice(0, 4).join(", ")}` : e.t === "text" ? `${pageKey(e.page)} "${e.old.slice(0, 30)}" → "${e.neu.slice(0, 40)}"` : e.t === "photo" ? `${pageKey(e.page)} ${e.slot} → ${e.file}` : `fonts → ${e.block.match(/data-display="([^"]+)"/)?.[1] ?? "?"} / ${e.block.match(/data-body="([^"]+)"/)?.[1] ?? "?"}`;
export async function savePending(id, auto = false) {
    clearTimeout(autoSave.get(id));
    autoSave.delete(id);
    const list = await pendingOf(id);
    if (!list.length)
        return null;
    const labels = list.map(e => e.label);
    const sha = await clickRound(id, `직접 수정 ${list.length}곳 · ${labels.slice(0, 3).join(", ")}${list.length > 3 ? " …" : ""}${auto ? " · 자동 저장" : ""}`, ["dynapse"]);
    await wput(id, HANDED, JSON.stringify({ lines: handLines(list).slice(0, 8), turns: 0 }, null, 1));
    await wput(id, PENDING, "[]\n");
    await wput(id, REDO, "[]\n");
    await showPending(id, []);
    void afterSave(id);
    // 고친 장만 다시 점검(#91 — 오버레이·사진 교체 뒤 배지가 바로 바뀌게)
    const pgs = [...new Set(list.map(e => e.page).filter((x) => !!x && /^result-[a-z0-9-]+\.html$/.test(x)))];
    if (pgs.length)
        void appVerify(id, pgs).catch(() => null);
    return sha;
}
// PPTX 호환 세팅(#81 보정 1) — 생성을 막지 않는다. 켜면 RULES.md 한 줄 → 다음 턴부터 AI가 그 안에서(이미 만든 장은 그대로). 끄면 줄 삭제
export const COMPAT_LINE = "- Export: PPTX-compatible (Hancom Show, Polaris, Google Slides) — no shadows, gradients or transparent text; use fonts with a common fallback.";
export async function setCompat(id, on) {
    const rules = (await wget(id, "context/RULES.md")) ?? "";
    const kept = rules.split("\n").filter(l => !l.startsWith("- Export: PPTX-compatible")).join("\n").trimEnd();
    await wput(id, "context/RULES.md", on ? `${kept ? `${kept}\n` : ""}${COMPAT_LINE}\n` : `${kept}\n`);
    await repoCommit(id, on ? "PPTX 호환 켬" : "PPTX 호환 끔");
    await postChat(id, [{ role: "event", text: on ? "PPTX 호환을 켰어요 · 다음 요청부터 그 안에서 만들어요" : "PPTX 호환을 껐어요", payload: { kind: "compat", ai: "dynapse", on } }]).catch(() => { });
}
// 제안 카드는 작업마다 한 번(.dynapse/session.json compat_asked)
export async function askCompatOnce(id, n) {
    const ses = (await readJson(id, ".dynapse/session.json")) ?? {};
    if (ses.compat_asked)
        return;
    if (((await wget(id, "context/RULES.md")) ?? "").includes("- Export: PPTX-compatible"))
        return;
    await wput(id, ".dynapse/session.json", JSON.stringify({ ...ses, compat_asked: Date.now() }, null, 1));
    // 묻지 않는다(#138) — 내보내기 결과에 한 줄(n곳), 한쇼·Google Slides를 말했으면 바로 켜고 되돌리는 말을 한 줄
    if (n)
        await postChat(id, [{ role: "event", text: `PPTX로 열면 ${n}곳이 이미지로 바뀌어요 · 한쇼·Google Slides에서 고칠 거면 "PPTX 호환 켜 줘"`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
    else {
        await setCompat(id, true);
        await postChat(id, [{ role: "event", text: "되돌리려면 \"PPTX 호환 꺼 줘\"", payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
    }
}
// 우리 회사 틀 적용(대표 2026-10-05) — 서버가 준 재료로 장마다 결정적으로(AI 0): <style data-brand>(회사 색) · 글꼴 블록 · 로고 칸 + context/RULES.md 한 절 → 버전 1.
// 배치는 그대로(Dynapse 레이아웃). 되돌리기 = 이전 버전으로(버전 띠)
const BRAND_RE = /<style\b[^>]*\bdata-brand\b[^>]*>[\s\S]*?<\/style>/i;
async function applyBrandPack(id, pid) {
    if (!/^bpk_[a-z0-9]+$/i.test(pid))
        return;
    const r = await api("GET", `/api/brand-packs/${pid}/apply`).catch(() => null);
    const d = r?.status === 200 ? r.data : null;
    if (!d?.style_block) {
        await postChat(id, [{ role: "event", text: "회사 틀을 받지 못했어요", payload: { kind: "error", ai: "dynapse" } }]).catch(() => { });
        return;
    }
    if ((await pendingOf(id)).length)
        await savePending(id); // 직접 수정이 있으면 먼저 저장(틀 버전과 섞이지 않게)
    let logo = null;
    if (d.logo_url && d.logo_file && /^materials\/brand-logo\.(png|jpg|svg|webp)$/.test(d.logo_file)) {
        const dir = await T().core.invoke("work_dir", { id }).catch(() => null);
        const g = dir ? await http("GET", d.logo_url, { out: `${dir}/${d.logo_file}` }).catch(() => null) : null;
        if (g?.status === 200)
            logo = d.logo_file;
    }
    const pages = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(n => PAGE_RE.test(n));
    for (const pg of pages) {
        let html = await wget(id, pg);
        if (!html)
            continue;
        html = BRAND_RE.test(html) ? html.replace(BRAND_RE, d.style_block) : /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${d.style_block}\n</head>`) : html;
        if (d.font_block)
            html = FONT_RE.test(html) ? html.replace(FONT_RE, d.font_block) : html.replace(/<\/head>/i, `${d.font_block}\n</head>`);
        if (logo)
            html = html.replace(/(<([a-z][a-z0-9]*)\b[^>]*\bdata-slot\s*=\s*["']brand["'][^>]*>)[\s\S]*?(<\/\2>)/i, `$1<img src="${logo}" alt="${d.name.replace(/"/g, "")}" data-locked data-img-function="brand">$3`);
        await wput(id, pg, html);
    }
    const rules = (await wget(id, "context/RULES.md")) ?? "";
    const kept = rules.replace(/\n?## Company template — [\s\S]*?(?=\n## |$)/, "").trimEnd();
    await wput(id, "context/RULES.md", `${kept ? `${kept}\n\n` : ""}${d.rules}\n`);
    await clickRound(id, `우리 회사 틀 · ${d.name}`, ["dynapse"]);
    await postChat(id, [{ role: "event", text: `회사 틀을 적용했어요 · ${d.name}${logo ? " · 로고" : ""}`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
}
// 스타일 팩(2026-10-08) — 팔레트·장식(<style data-pack>) + 글꼴 블록 + RULES.md 한 절. 장이 아직 없으면 파일만 두고(.dynapse/style-pack.json) 첫 턴이 끝나면 장마다 넣는다.
// 회사 틀(<style data-brand>)이 있으면 그 앞에 둬서 회사 색이 이긴다. "" = 팩 빼기
const PACK_RE = /<style\b[^>]*\bdata-pack\b[^>]*>[\s\S]*?<\/style>\s*/i;
const withPack = (html, block) => {
    const h = html.replace(PACK_RE, "");
    if (!block)
        return h;
    const at = h.search(/<style\b[^>]*\bdata-brand\b/i);
    return at >= 0 ? `${h.slice(0, at)}${block}\n${h.slice(at)}` : /<\/head>/i.test(h) ? h.replace(/<\/head>/i, `${block}\n</head>`) : h;
};
async function applyStylePack(id, pack) {
    const off = !pack;
    const d = off ? null : await api("GET", `/api/style-packs/${encodeURIComponent(pack)}/apply`).then(r => (r.status === 200 ? r.data : null)).catch(() => null);
    if (!off && !d?.style_block) {
        await postChat(id, [{ role: "event", text: "스타일을 받지 못했어요", payload: { kind: "error", ai: "dynapse" } }]).catch(() => { });
        return;
    }
    if ((await pendingOf(id)).length)
        await savePending(id);
    await wput(id, ".dynapse/style-pack.json", JSON.stringify(off ? {} : { id: d.id, name: d.name, style_block: d.style_block }, null, 1));
    const pages = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(n => PAGE_RE.test(n));
    for (const pg of pages) {
        let html = await wget(id, pg);
        if (!html)
            continue;
        html = withPack(html, d?.style_block ?? "");
        if (d?.font_block)
            html = FONT_RE.test(html) ? html.replace(FONT_RE, d.font_block) : html.replace(/<\/head>/i, `${d.font_block}\n</head>`);
        await wput(id, pg, html);
    }
    const rules = (await wget(id, "context/RULES.md")) ?? "";
    const kept = rules.replace(/\n?## Style pack — [\s\S]*?(?=\n## |$)/, "").trimEnd();
    await wput(id, "context/RULES.md", `${kept ? `${kept}\n\n` : ""}${d ? `${d.rules}\n` : ""}`);
    if (d?.font_block)
        await wput(id, ".dynapse/pack-fonts.html", d.font_block);
    if (pages.length)
        await clickRound(id, off ? "스타일 빼기" : `스타일 · ${d.name}`, ["dynapse"]);
    await postChat(id, [{ role: "event", text: off ? "스타일을 뺐어요" : pages.length ? `스타일을 바꿨어요 · ${d.name}` : `스타일 · ${d.name} — 만들 때 이 색·글꼴·그림체로`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
}
// 턴 뒤 — 팩이 정해진 작업인데 팩 블록이 없는 장(새로 만든 장)에 넣는다(글꼴 블록도 없으면)
async function ensurePack(id) {
    const sp = await readJson(id, ".dynapse/style-pack.json").catch(() => null);
    if (!sp?.style_block)
        return;
    const fb = await wget(id, ".dynapse/pack-fonts.html").catch(() => null);
    const pages = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(n => PAGE_RE.test(n));
    for (const pg of pages) {
        const html = await wget(id, pg);
        if (!html || PACK_RE.test(html))
            continue;
        let h = withPack(html, sp.style_block);
        if (fb && !FONT_RE.test(h))
            h = h.replace(/<\/head>/i, `${fb}\n</head>`);
        await wput(id, pg, h);
    }
}
// 칩 × — 그 항목만 되돌린다
// 웹 canvas-inject applyTextEditAt와 같은 규칙 — 그 요소(같은 태그의 k번째 여는 태그) 안의 글자만
function textAtSel(src, sel, o, neu) {
    if (typeof DOMParser === "undefined")
        return null;
    const doc = new DOMParser().parseFromString(src, "text/html");
    let el = null;
    try {
        el = doc.querySelector(sel);
    }
    catch {
        return null;
    }
    if (!el || el === doc.body || el === doc.documentElement)
        return null;
    const tag = el.tagName.toLowerCase(), k = Array.from(doc.getElementsByTagName(tag)).indexOf(el);
    const masked = src.replace(/<!--[\s\S]*?-->/g, m => " ".repeat(m.length)).replace(/(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi, (_m, a, _t, b, c) => a + " ".repeat(b.length) + c);
    const opens = [];
    const re = new RegExp(`<${tag}(?=[\\s>/])`, "gi");
    for (let m = re.exec(masked); m; m = re.exec(masked))
        opens.push(m.index);
    const at = opens[k];
    if (at === undefined)
        return null;
    const openEnd = masked.indexOf(">", at) + 1;
    if (!openEnd)
        return null;
    const tr = new RegExp(`<(\\/?)${tag}(?=[\\s>/])`, "gi");
    tr.lastIndex = openEnd;
    let depth = 1, closeAt = masked.length;
    for (let m = tr.exec(masked); m; m = tr.exec(masked)) {
        depth += m[1] ? -1 : 1;
        if (depth === 0) {
            closeAt = m.index;
            break;
        }
    }
    const inner = src.slice(openEnd, closeAt), mi = masked.slice(openEnd, closeAt);
    const escH = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    for (const needle of [...new Set([escH(o), o])])
        for (let i = inner.indexOf(needle); i >= 0; i = inner.indexOf(needle, i + needle.length)) {
            if (mi.lastIndexOf(">", i) < mi.lastIndexOf("<", i))
                continue;
            return src.slice(0, openEnd + i) + escH(neu) + src.slice(openEnd + i + needle.length);
        }
    return null;
}
const TWEAKS_RE = /<style\b[^>]*\bdata-tweaks\b[^>]*>[\s\S]*?<\/style>/i;
function applyEdit(html, e) {
    if (e.t === "stopped")
        return html;
    if (e.t === "restore")
        return e.html;
    if (e.t === "tweak") {
        const b = e.block || "<style data-tweaks></style>";
        return TWEAKS_RE.test(html) ? html.replace(TWEAKS_RE, b) : e.block && /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${e.block}\n</head>`) : html;
    }
    if (e.t === "photo")
        return setSlotImg(html, e.slot, e.file) ?? html;
    if (e.t === "font")
        return FONT_RE.test(html) ? html.replace(FONT_RE, e.block) : html;
    if (e.t === "palette") {
        const TOK = /<style\b[^>]*\bdata-tokens\b[^>]*>[\s\S]*?<\/style\s*>/i;
        if (!TOK.test(html))
            return html;
        return fixRawColors(html.replace(TOK, () => `<style data-tokens>\n${e.tokens}\n</style>`), { stripMood: true }).html;
    } // 덱 색(#273 ②) — 토큰 블록 + 레이아웃 무드 색 빼기
    const o = e.old.trim();
    if (!o)
        return html;
    const viaSel = e.sel ? textAtSel(html, e.sel, o, e.neu.trim()) : null; // 요소 자리로(#46 §3 — 웹 캔버스와 같은 방식)
    if (viaSel)
        return viaSel;
    let n = -1, at = -1;
    for (let i = html.indexOf(o); i >= 0; i = html.indexOf(o, i + o.length)) {
        n++;
        if (n === e.nth || at < 0)
            at = i;
        if (n === e.nth)
            break;
    }
    return at < 0 ? html : html.slice(0, at) + e.neu.trim() + html.slice(at + o.length);
}
const qs = (x) => (typeof x === "string" ? x : "");
export const PAGE_OPS = {
    "swap-photo": { on: "base", key: "page", optional: true, run: (id, [f], q) => (qs(q.slot) && qs(q.url) ? (q.credit !== undefined && !creditOf(q.credit) ? postChat(id, [{ role: "event", text: "쓸 수 없는 라이선스예요 · Pixabay·CC0·CC BY 사진만 넣어요", payload: { kind: "error", ai: "dynapse" } }]).then(() => { }) : swapPhoto(id, f ?? null, qs(q.slot), qs(q.url), qs(q.asset_id) || null, creditOf(q.credit))) : Promise.resolve()) }, // 출처가 왔는데 CC0·CC BY가 아니면 넣지 않는다
    "use-file": { on: "base", key: "page", optional: true, run: (id, [f], q) => (qs(q.slot) && qs(q.file) ? useFile(id, f ?? null, qs(q.slot), qs(q.file)) : Promise.resolve()) },
    "use-library-file": { on: "base", key: "page", optional: true, run: (id, [f], q) => useLibraryFile(id, f ?? null, q) },
    "bind-photo": { on: "base", key: "page", optional: true, run: (id, [f], q) => (qs(q.file) ? bindPhoto(id, qs(q.file), f ?? null) : Promise.resolve()) },
    "gen-photo": { on: "base", key: "page", optional: true, run: async (id, [f], q) => { if (!qs(q.slot))
            return; active++; try {
            await genPhoto(id, { ...q, page: f });
        }
        finally {
            active--;
        } } },
    "form-alts": { on: "base", langs: false, run: async (id, [f]) => { const { makeAlts, cancelPrerender } = await import("./form-alts.js"); cancelPrerender(id); await makeAlts(id, f).catch(e => postChat(id, [{ role: "event", text: null, payload: { kind: "form-alts", ai: "dynapse", file: f, items: [], error: String(e?.message ?? e).slice(0, 120) } }]).catch(() => { })); } },
    "form-apply": { on: "base", commit: true, run: async (id, [f], q) => { if (!/^[a-z0-9-]{2,30}$/.test(qs(q.form)))
            return; const { applyAlt } = await import("./form-alts.js"); await applyAlt(id, f, qs(q.form), q.fresh === true); } },
    "form-revert": { on: "base", commit: true, run: (id, [f], q) => formRevert(id, f, qs(q.sha)) },
    "page-grow": { on: "base", commit: true, run: async (id, [f], q) => { const { growPage } = await import("./grow.js"); await growPage(id, f, typeof q.k === "number" ? q.k : null); } },
    "viz-set": { on: "base", commit: true, run: async (id, [f], q) => { if (!qs(q.slot))
            return; const { setViz } = await import("./viz.js"); await setViz(id, f, qs(q.slot), (q.patch ?? null), Number(q.dh) || 0); } },
    "page-commit": { on: "view", run: (id, [f], q) => pageCommit(id, f, qs(q.note) || "글자", q) },
    "text-sel": { on: "view", run: (id, [f], q) => (qs(q.sel) && typeof q.neu === "string" ? textSelCommit(id, f, { sel: qs(q.sel), old: qs(q.old), neu: q.neu, nth: Number(q.nth) || 0, note: qs(q.note) || "글자", why: qs(q.why) }) : Promise.resolve()) },
    "page-delete": { on: "base", langs: false, run: (id, [f]) => deletePage(id, f) },
    "page-order": { on: "base", key: "order", langs: false, run: (id, fs) => pageOrder(id, fs) },
    "page-relink": { on: "base", key: "files", langs: false, run: (id, fs, q) => pageFilesOp(id, "page-relink", fs, qs(q.bundle) || null) },
    "page-bundle": { on: "base", key: "files", langs: false, run: (id, fs, q) => pageFilesOp(id, "page-bundle", fs, qs(q.bundle) || null) },
    "hidden-to-appendix": { on: "base", key: "files", langs: false, run: (id, fs, q) => pageFilesOp(id, "hidden-to-appendix", fs, qs(q.bundle) || null) },
    "hidden-unlink": { on: "base", key: "files", langs: false, run: (id, fs, q) => pageFilesOp(id, "hidden-unlink", fs, qs(q.bundle) || null) },
    // 번역(#100) — 받아들이기는 그 언어판 장 하나(보고 있는 판), 장 없이 오면 그 언어 전체를 다시 번역(덱 범위)
    "lang-refresh": { on: "view", optional: true, langs: false, run: async (id, [f], q) => {
            const L = qs(q.lang);
            if (!LANG_NAME[L])
                return;
            if (q.accept && f) {
                await acceptLang(id, L, f);
                return;
            }
            active++;
            try {
                await translateTurn(id, { code: L, name: LANG_NAME[L] }, q.route?.design?.[0] === "chatgpt" ? "chatgpt" : "claude", f ? [f] : undefined);
            }
            finally {
                active--;
            }
        } },
    "regress-restore": { on: "view", key: "pages", optional: true, langs: false, run: (id, fs) => restoreRegress(id, fs) },
};
// 장이 아닌 동작(덱·작업·연결·동기화 단위) — 이유가 곧 분류 근거. 새 동작은 PAGE_OPS 아니면 여기에
export const NOT_PAGE_OPS = {
    "relogin": "AI 다시 로그인(#185) — 작업 단위(같은 턴을 한 번 다시)", "photo-engine": "사진 카드 이 PC 엔진 받기(#199) — 작업의 기다리는 사진", "adult-ok": "19+ 확인 뒤 리워드 요청 이어서(#205) — 작업 단위", "login-code": "로그인 코드 넣기(#204) — AI 로그인", "motif-set": "덱 모티프(#201) — 모든 장의 덱 블록", "photo-skip": "사진 카드 사진 없이 계속(#199) — 기다리는 칸 전부", "open-claim": "브라우저 계정과 합치기(#186) — 작업 단위", "pull": "MCP 사본 받기 — 작업 단위", "import-commit": "가져오기 커밋 — 작업 단위", "redo-edit": "직접 수정 다시 하기 — 걸음 단위(장은 그 수정이 안다)", "undo-turn": "⌘Z로 AI 턴 되돌리기(#150 ①) — 작업 단위(버전 띠의 되돌리기와 같은 길)", "redo-turn": "⇧⌘Z로 AI 턴 다시 — 작업 단위", "undo-edit": "직접 수정 되돌리기 — 걸음 단위", "save-edits": "직접 수정 저장 — 작업 단위",
    "set-font": "덱 글꼴 — 모든 장", "set-palette": "덱 색(#273 ②) — 모든 장의 토큰 블록", "slot-suggest": "칸 글 제안(#276 보정 1 ⑤) — 장을 고치지 않는다(제안만)", "style-from": "이 그림 톤으로 덱 그림 통일(#196) — 덱", "style-regen": "덱 그림 톤으로 다시 만들기 — 덱", "style-off": "덱 그림 톤 끄기 — 덱", "style-set": "덱 그림 톤 문장 — 덱", "font-url": "글꼴 주소 — 덱", "fonts-scan": "이 PC 글꼴 목록", "style-pack": "덱 스타일 — 모든 장", "brand-pack": "브랜드 — 덱", "compat": "PPTX 호환 — 덱 규칙",
    "fill-photos": "빈 사진 칸 채우기 — 덱 전체", "bg-act": "뒤에서 도는 일의 버튼(멈춤·지금 교체·건너뛰기) — 장 없음", "copy-photo": "다른 작업의 사진을 자료로 — 장 없음", "copy-asset": "자료 복사 — 장 없음", "copy-library": "자료함 복사 — 장 없음", "link-folder": "폴더 연결 — 작업", "photo-share": "사진 공유 설정 — 작업",
    "page-restore-last": "마지막으로 뺀 장 다시 넣기 — 장 이름은 앱이 기록에서", "page-mine": "동기화 충돌에서 내 판 고르기(#56) — 동기화 규칙 대상, 판 이름 그대로", "pull-take": "동기화", "pull-discard": "동기화", "pull-latest": "동기화", "meta-sync": "동기화", "pull-merge": "동기화", "push": "동기화", "sync-check": "동기화", "publish-latest": "공개 — 작업", "share-on": "공유 — 작업", "share-history": "공유 기록 — 작업",
    "restore": "버전 되돌리기 — 작업 전체", "split-html": "가져온 HTML 나누기 — 작업", "import-page": "HTML을 이 덱의 새 장으로(#264 보정 1 ①) — 장을 하나 더하는 덱 동작, 대상 장 없음", "split-undo": "나누기 되돌리기 — 작업", "extract-inline": "박힌 사진 빼기 — 덱 전체", "shrink-big": "큰 파일 줄이기 — 작업", "delete-local": "이 PC에서 지우기 — 작업",
    "lang-add": "언어판 추가 — 덱 전체 번역", "viz-redraw": "차트 다시 그리기 — 덱 전체", "facts-fill": "빠진 사실 넣기 — 덱 전체 [빈칸](#302)", "facts-later": "빠진 사실 나중에 — 작업 기록(#302)", "facts-keep": "예시 그대로 쓰기 — 덱 전체 예시 표시 떼기(#304 보정 2 ⑤)", "continue-with": "다른 AI로 이어서 — 마지막 요청(C5 ⑤)", "frame-set": "덱 프레임 — 덱", "doc-reindex": "자료 색인 — 작업", "doc-summary-off": "자료 요약 끄기 — 작업", "duplicate-from": "복사본 만들기 — 작업",
    "connect-drive": "드라이브 연결", "connector-cancel": "연결", "connector-recheck": "연결", "connector-skip": "연결", "connector-status": "연결", "login": "AI 로그인", "login-all": "AI 한 번에 연결", "login-skip": "AI 연결 건너뛰기",
    "plan-build": "개요대로 만들기 — 덱", "review-fix": "검토에서 고르기 — 덱 범위 턴", "proposal-take": "제안 받기 — 덱", "review-more": "검토 더 — 덱", "queue-cancel": "묶음 큐", "queue-pause": "묶음 큐", "queue-resume": "묶음 큐", "queue-retry": "묶음 큐",
    "replace-reward": "리워드 교체 — Task", "submit-reward": "리워드 제출 — Task", "report-error": "오류 보고", "stop": "턴 멈춤",
};
export const pageOpLog = []; // 시험이 읽는다(최근 50)
export async function pageOp(id, op, q) {
    const d = PAGE_OPS[op];
    const key = d.key ?? "file", raw = key === "files" || key === "order" || key === "pages" ? (Array.isArray(q[key]) ? q[key] : []) : [q[key]];
    const view = raw.filter((x) => typeof x === "string" && (PAGE_RE.test(x) || LANG_PAGE.test(x))).slice(0, 400); // 장 이름 검사는 여기 한 곳
    if (!view.length && (raw.some(x => x != null && x !== "") || !d.optional)) {
        report("turn", "pageop.bad_file", op);
        return;
    }
    const target = d.on === "view" ? view : [...new Set(view.map(baseOf))];
    const watch = view.filter(v => v !== baseOf(v)).slice(0, 20), before = new Map();
    for (const v of watch)
        before.set(v, await wget(id, v));
    await d.run(id, target, q, view);
    if (d.langs !== false && target.length) {
        const t = (await syncLangs(id, target.slice(0, 40)).catch(() => [])) ?? [];
        if (t.length && d.commit && S.git)
            await repoCommit(id, `언어판 맞춤 · ${t.length}장`);
    }
    const viewChanged = [];
    for (const v of watch) {
        const now = await wget(id, v);
        viewChanged.push(now !== before.get(v));
        if (now === before.get(v) && d.on === "base" && d.langs !== false)
            report("turn", "pageop.view_stale", `${op} ${v}`);
    }
    pageOpLog.push({ op, view, target, viewChanged });
    if (pageOpLog.length > 50)
        pageOpLog.shift();
    if (watch.length)
        void afterSave(id);
}
async function useLibraryFile(id, page, q) {
    if (!q.from || !WORK_ID.test(q.from) || !q.file || !/^context\/assets\/[\w.\- ()가-힣]+\.(png|jpe?g|webp)$/i.test(q.file) || !q.slot)
        return;
    await ensureFolderHere(q.from);
    const src = await T().core.invoke("work_dir", { id: q.from }).catch(() => null), dst = await T().core.invoke("work_dir", { id }).catch(() => null);
    if (!src || !dst) {
        await postChat(id, [{ role: "event", text: "폴더를 찾지 못했어요", payload: { kind: "error", ai: "dynapse" } }]);
        return;
    }
    const have = new Set((await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name));
    let name = q.file;
    for (let n = 2; have.has(name); n++)
        name = q.file.replace(/(\.[^.]+)$/, `-${n}$1`);
    const fileUrl = (p) => `file:///${encodeURI(p.replace(/\\/g, "/").replace(/^\//, ""))}`;
    const ok = await http("GET", fileUrl(`${src}/${q.file}`), { out: `${dst}/${name}` }).then(() => true).catch(() => false);
    if (!ok) {
        await postChat(id, [{ role: "event", text: "폴더 사진을 가져오지 못했어요", payload: { kind: "error", ai: "dynapse" } }]);
        return;
    }
    await useFile(id, page, q.slot, name);
    await markUsed(q.from, [q.file], id);
}
async function formRevert(id, file, sha) {
    if (/^[0-9a-f]{7,40}$/.test(sha)) {
        const h = await T().core.invoke("repo_show", { id: id, sha, file }).catch(() => null);
        if (h) {
            await wput(id, file, h);
            await repoCommit(id, `이전 모양으로 · ${pageLabel(file)}`);
            await postChat(id, [{ role: "event", text: `${pageLabel(file)}을 이전 모양으로 돌렸어요`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
        }
    }
}
// 서버 순서(#189 — 대표 "내보내기할 때 장표 순서 바꾼 걸로 순서가 안 돼") — 웹에서 끈 순서(works.meta.page_order)가 이 PC의 마지막 순서 변경보다 새것이면
// 장 띠 끌기와 같은 길(pageOrder: 장 차례·잠금·쪽 번호·순번·커밋)로 맞춘다. 내보내기 직전에 부른다. 같은 순서면 아무것도 안 한다
// 숨김·순서·장 목록은 작업당 하나 — 서버가 진실(#256 보정 1: 3일 못 받은 팀원 앱의 hidden.json·pages.json이 옛것이라 주인과 다르게 보였다).
// 받기·합치기·"작업 설정 받기"(meta-sync) 때 서버 값으로 덮는다. 쓰기만(커밋은 부르는 쪽) · 서버에 다시 올리지 않는다 · 쪽번호는 받은 장 그대로
export async function applyServerMeta(id) {
    const hr = await api("GET", `/api/works/${encodeURIComponent(id)}/hidden`).catch(() => null);
    if (hr?.status !== 200 || !hr.data)
        return null;
    const hid = (hr.data.hidden ?? []).filter(f => PAGE_RE.test(f));
    await wput(id, ".dynapse/hidden.json", JSON.stringify(hid)).catch(() => { });
    const have = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(f => PAGE_RE.test(f));
    const cur = ((await readPages(id).catch(() => null)) ?? []).filter(f => have.includes(f));
    let ordered = false;
    const want = (hr.data.order ?? []).filter(f => have.includes(f));
    if (want.length) {
        // 서버 순서에 없는 장(그 뒤에 생긴 장)은 지금 목록의 자리 순서대로 뒤에
        const next = [...want, ...cur.filter(f => !want.includes(f)), ...have.filter(f => !want.includes(f) && !cur.includes(f)).sort()];
        if (JSON.stringify(next) !== JSON.stringify(cur)) {
            await wput(id, ".dynapse/pages.json", JSON.stringify(next)).catch(() => { });
            ordered = true;
        }
        await wput(id, ".dynapse/order-at.json", JSON.stringify({ at: Number(hr.data.order_at) || Date.now() })).catch(() => { });
    }
    return { pages: have.filter(f => !LANG_PAGE.test(f)).length, hidden: hid.filter(f => have.includes(f)).length, ordered };
}
const metaLine = (m) => (m ? ` · 장 ${m.pages}개 · 숨김 ${m.hidden}개${m.ordered ? " · 순서 서버와 맞춤" : ""}` : "");
// 작업 설정 받기(#256 보정 1 ③ — 다른 사람이 숨김·순서를 바꿨다). 판 받기와 따로 · 바뀐 게 있으면 커밋만(올리지 않는다: 서버 값을 받은 것)
export async function metaSync(id) {
    if (!S.git)
        return;
    const m = await applyServerMeta(id);
    if (!m)
        return;
    slog(id, "meta.sync", { hidden: m.hidden, ordered: m.ordered });
    if (!m.ordered)
        return;
    const was = await T().core.invoke("repo_head", { id }).catch(() => null);
    await repoCommit(id, "장 순서 · 서버와 맞춤");
    const now = await T().core.invoke("repo_head", { id }).catch(() => null);
    const heads = (await store.get("remote_heads")) ?? {};
    if (now && now !== was && heads[`${id}#local`] === was) {
        heads[`${id}#local`] = now;
        await store.set("remote_heads", heads);
        await store.save();
    }
    await postChat(id, [{ role: "event", text: `장 순서를 함께 쓰는 사람과 맞췄어요${metaLine(m)}`, payload: { kind: "stage", ai: "dynapse", order: true } }]).catch(() => { });
}
export async function serverOrder(id, order, at) {
    const local = Number((await readJson(id, ".dynapse/order-at.json").catch(() => null))?.at) || 0;
    if (!order.length || at <= local)
        return false;
    const cur = (await readPages(id)) ?? [];
    if (JSON.stringify(cur.filter(f => order.includes(f))) === JSON.stringify(order.filter(f => cur.includes(f))))
        return false;
    await pageOrder(id, order);
    return true;
}
async function pageOrder(id, want) {
    if (want.length) {
        const ord = await normalizeOrder(id, want);
        if (ord)
            await wput(id, ".dynapse/order-lock.json", JSON.stringify({ order: ord, at: Date.now() })).catch(() => { });
        await repoCommit(id, "장 순서 바꿈");
        await postChat(id, [{ role: "event", text: "장 순서를 바꿨어요", payload: { kind: "stage", ai: "dynapse", order: true } }]);
        void afterSave(id);
    }
}
async function pageFilesOp(id, action, files, bundle) {
    await savePending(id).catch(() => null);
    if (action === "page-relink") {
        let n = 0;
        for (const f of files)
            if (await relinkPage(id, f, { commit: false }).catch(() => false))
                n++;
        if (n) {
            await repoCommit(id, `장 다시 넣기 · ${n}장`);
            await postChat(id, [{ role: "event", text: `${n === 1 ? pageLabel(files[0]) : `${n}장`}을 다시 넣었어요`, payload: { kind: "stage", ai: "dynapse", order: true } }]).catch(() => { });
            void afterSave(id);
        }
        return;
    }
    if (action === "hidden-unlink") {
        for (const f of files)
            await deletePage(id, f, { commit: false }).catch(() => { });
        await repoCommit(id, `숨긴 장 빼기 · ${files.length}장`);
        await postChat(id, [{ role: "event", text: `숨긴 장 ${files.length}개를 뺐어요 · 기록에 남아요 · ⌘Z로 하나씩 또는 "숨겼던 장 다시 넣어줘"`, payload: { kind: "stage", ai: "dynapse", order: true } }]).catch(() => { });
        await api("POST", `/api/works/${encodeURIComponent(id)}/hidden`, { unhide: files }).catch(() => null);
        void afterSave(id);
        return;
    }
    const order = ((await readPages(id)) ?? []).filter(x => typeof x === "string");
    const apx = ((await readJson(id, ".dynapse/appendix.json")) ?? []).filter(x => typeof x === "string");
    const bs = ((await readJson(id, BUNDLES).catch(() => null)) ?? []).filter(b => b && typeof b.name === "string").map(b => ({ name: b.name, pages: (b.pages ?? []).filter(f => !files.includes(f)) }));
    const to = action === "hidden-to-appendix" ? "부록" : (bundle ?? "본편");
    let apx2 = apx.filter(f => !files.includes(f));
    if (to === "부록")
        apx2 = [...apx2, ...files];
    else if (to !== "본편") {
        const b = bs.find(x => x.name === to);
        if (b)
            b.pages.push(...files);
        else
            bs.push({ name: to, pages: files });
    }
    await wput(id, ".dynapse/appendix.json", JSON.stringify(apx2)).catch(() => { });
    await wput(id, BUNDLES, JSON.stringify(bs.filter(b => b.pages.length))).catch(() => { });
    // 자리는 그대로 두고 묶음끼리 붙인다(같은 묶음 안 순서 유지) — 끌어 놓기는 웹이 먼저 순서를 바꾼 뒤 이것을 보낸다
    await normalizeOrder(id, order);
    await normalizeBundles(id).catch(() => false);
    {
        const ord = (await readPages(id).catch(() => null)) ?? [];
        await wput(id, ".dynapse/order-lock.json", JSON.stringify({ order: ord, at: Date.now() })).catch(() => { });
    }
    if (action === "hidden-to-appendix")
        await api("POST", `/api/works/${encodeURIComponent(id)}/hidden`, { unhide: files }).catch(() => null);
    await repoCommit(id, `${to}으로 · ${files.length}장`);
    await postChat(id, [{ role: "event", text: `${files.length === 1 ? pageLabel(files[0]) : `${files.length}장`}을 ${to}으로 옮겼어요`, payload: { kind: "stage", ai: "dynapse", order: true } }]).catch(() => { });
    void afterSave(id);
    return;
}
export async function restoreRegress(id, want) {
    const rg = await readJson(id, REGRESS).catch(() => null);
    const pages = (want.length ? want : Object.keys(rg?.pages ?? {})).filter(f => PAGE_W.test(f) && rg?.pages?.[f]);
    if (!rg || !pages.length) {
        await postChat(id, [{ role: "event", text: "되돌릴 턴 시작 판이 없어요 · 이미 되돌렸거나 앱을 다시 켰어요", payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
        return 0;
    }
    const pend = await pendingOf(id), group = `rg${Date.now()}`;
    for (const pg of pages) {
        const h = pend.filter(e => e.t !== "restore" && e.t !== "font" && e.t !== "palette" && e.t !== "stopped" && e.page === pg).reduce(applyEdit, rg.pages[pg].start);
        await handPut(id, pg, h);
        await addPending(id, { t: "restore", page: pg, html: h, label: `${pageLabel(pg)} · 턴 시작으로`, group });
        delete rg.pages[pg];
    }
    await wput(id, REGRESS, JSON.stringify(rg)).catch(() => { });
    await postChat(id, [{ role: "event", text: `${pages.length === 1 ? pageLabel(pages[0]) : `${pages.length}장`}을 턴 시작으로 되돌렸어요 · ⌘Z로 다시`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
    report("turn", "fit.regress_restore", `n=${pages.length}`);
    return pages.length;
}
async function keepHand(id, file, html) {
    const mine = (await pendingOf(id)).filter(e => (e.t === "text" || e.t === "photo" || e.t === "tweak") && e.page === file && !(e.t === "text" && e.kind));
    if (!mine.length)
        return html;
    let out = html, n = 0;
    for (const e of mine) {
        if (handHolds(out, e))
            continue;
        const o2 = applyEdit(out, e);
        if (o2 !== out && handHolds(o2, e)) {
            out = o2;
            n++;
        }
    }
    if (n)
        report("turn", "guard.keep_hand", `${file} n=${n}`);
    return out;
}
// 그 직접 수정이 이 판에 살아 있나 — 사진은 그 칸이 그 파일, 조절은 그 블록, 글은 새 글이 있다(지운 글·구조 수정은 여기서 판단하지 않는다)
function handHolds(html, e) {
    if (e.t === "photo")
        return (setSlotImg(html, e.slot, e.file) ?? html) === html;
    if (e.t === "tweak")
        return !e.block || html.includes(e.block);
    if (e.t === "text") {
        const n = e.neu.trim();
        return !n || html.includes(n) || html.includes(escH(n));
    }
    return true; // restore — 통째 판이라 뒤의 수정이 위에 얹힌다(덮어쓰기 검사 대상 아님)
}
// ↶(#78 보정 6 B) — 마지막 한 걸음(같은 group이면 함께)을 되돌리고 다시 하기 더미에 쌓는다
async function undoLast(id) {
    const list = await pendingOf(id);
    if (!list.length)
        return;
    const g = list.at(-1).group;
    let from = list.length - 1;
    while (g && from > 0 && list[from - 1].group === g)
        from--;
    const gone = list.slice(from);
    if (!gone.some(e => e.t === "stopped"))
        await wput(id, REDO, JSON.stringify([...(await redoOf(id)), gone], null, 1));
    await undoPending(id, gone.map((_, i) => from + i));
}
// ↷ — 되돌린 걸음을 지금 파일에 다시 적용(HEAD 재적용이 아니라 지금 위에)
async function redoPending(id) {
    const stack = await redoOf(id);
    const step = stack.pop();
    if (!step)
        return;
    await wput(id, REDO, JSON.stringify(stack, null, 1));
    const pages = [...new Set(step.flatMap(e => (e.t === "font" || e.t === "palette" || e.t === "stopped" ? [] : [e.page])))];
    if (step.some(e => e.t === "font" || e.t === "palette"))
        for (const f of (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(n => PAGE_RE.test(n)))
            if (!pages.includes(f))
                pages.push(f);
    for (const pg of pages) {
        const cur = await T().core.invoke("work_read", { id, file: pg }).catch(() => null);
        if (cur === null)
            continue;
        await handPut(id, pg, step.filter(e => e.t === "font" || e.t === "palette" || (e.t !== "stopped" && e.page === pg)).reduce(applyEdit, cur));
    }
    if (step.some(e => e.t === "palette"))
        await syncPaletteLock(id);
    const list = await pendingOf(id);
    list.push(...step);
    await wput(id, PENDING, JSON.stringify(list, null, 1));
    await showPending(id, list);
    void afterSave(id);
}
async function undoPending(id, index) {
    const list = await pendingOf(id);
    const idx = new Set(Array.isArray(index) ? index : [index]);
    const goneAll = list.filter((_, i) => idx.has(i));
    if (!goneAll.length)
        return;
    const gone = goneAll.find(e => e.t === "stopped") ?? goneAll.find(e => e.t === "font") ?? goneAll.find(e => e.t === "palette") ?? goneAll[0];
    const rest = list.filter((_, i) => !idx.has(i));
    const head = await T().core.invoke("repo_head", { id }).catch(() => null);
    // 중단으로 남은 변경을 되돌리기 — 작업 트리를 마지막 커밋으로, 나머지 직접 수정은 아래에서 다시 적용
    if (gone.t === "stopped")
        await T().core.invoke("repo_discard", { id }).catch(() => { });
    const pages = gone.t === "stopped" || gone.t === "font" || gone.t === "palette" ? (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(n => PAGE_RE.test(n)) : [...new Set(goneAll.flatMap(e => (e.t === "stopped" || e.t === "font" || e.t === "palette" ? [] : [e.page])))];
    for (const pg of pages) {
        const base = head ? await T().core.invoke("repo_show", { id, sha: head, file: pg }).catch(() => null) : null;
        if (base === null)
            continue;
        const out = rest.filter(e => e.t === "font" || e.t === "palette" || (e.t !== "stopped" && e.page === pg)).reduce(applyEdit, base);
        await handPut(id, pg, out); // 되돌리기는 사용자 경로 — 가드가 지운 수정을 다시 얹지 않게
    }
    if (goneAll.some(e => e.t === "palette"))
        await syncPaletteLock(id); // 덱 색을 되돌리면 잠금도 그 판으로
    await wput(id, PENDING, JSON.stringify(rest, null, 1));
    await showPending(id, rest);
    void afterSave(id);
}
// 다음 턴 프롬프트 맨 위(#46 §2) — 두 턴 동안
// 사람이 정한 점검(#91 보정 1) — data-lint-ok가 있는 장이 있으면 머리말 한 줄(Hand edits와 같은 급): 그 보정을 다시 넣지 않는다
async function lintOkPrefix(id) {
    const pages = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(f => /^result-[a-z0-9-]+\.html$/.test(f));
    const ok = [];
    for (const pg of pages) {
        const h = await wget(id, pg);
        const v = h?.match(/<section\b[^>]*\bdata-lint-ok\s*=\s*["']([^"']*)["']/i)?.[1];
        if (v)
            ok.push(`${pg} (${v})`);
    }
    return ok.length ? `[User-confirmed checks — keep these pages as they are for those checks; never re-apply a fix the user removed and never add data-shade/data-overlay unless asked: ${ok.join("; ").slice(0, 300)}]\n` : "";
}
async function handEditsPrefix(id) {
    const h = await readJson(id, HANDED);
    if (!h?.lines?.length || (h.turns ?? 0) >= 2)
        return "";
    await wput(id, HANDED, JSON.stringify({ ...h, turns: (h.turns ?? 0) + 1 }, null, 1));
    return `[Hand edits since your last turn (keep them unless the request changes them): ${h.lines.join("; ").slice(0, 400)}]\n`;
}
// 가져오기(#20) — 첫 커밋 "가져옴 · ⟨출처⟩"가 스레드 맨 위. 파일은 이미 이 PC 폴더에 있다(브릿지·인앱 IPC·폴더 복사).
// 웹만 있던 사람이 [올리기]로 서버에 둔 것이면(pull) 여기서 내려받는다
export async function importStart(id, im) {
    if (im.pull)
        await pullWork(id).catch(() => false);
    const files = await T().core.invoke("work_files", { id }).catch(() => []);
    if (!files.some(f => f.name === ".dynapse/imported.json"))
        await wput(id, ".dynapse/imported.json", "{\"from\":\"web\"}\n");
    const src = (im.source ?? "파일").slice(0, 80);
    await resolveRefs(id, false, false); // 재료 복사도 이 가져오기 커밋 하나에(#30)
    const fl = im.folder ? ` · 폴더: ${im.folder.slice(0, 40)}` : ""; // 열어 둔 폴더에 들어갔으면 그 이름(#130 보정 3)
    if (await importPdf(id, fl).catch(() => false))
        return; // PDF면 바로 장으로(#130) — 그 커밋·안내가 "가져옴" 줄을 대신한다
    await repoCommit(id, `가져옴 · ${src}`);
    await postChat(id, [{ role: "event", text: `가져옴 · ${src}${fl}`, payload: { kind: "stage", ai: "dynapse" } }]);
    await splitImported(id).catch(() => { }); // 한 HTML에 여러 장(#20 보정 5)
}
// 사진 경로 펴기(#130 보정 4) — 0.1.74 앱은 materials/·context/assets/ 바로 아래 파일만 연다. 장이 하위 폴더 사진(materials/pdf/img-000.png)을 쓰면 캔버스에 "?"
// → verify(flat-photos.json 요청 파일 모드)가 한 단계 이름(materials/pdf-img-000.png)으로 옮기고 주소를 바꾼다. 커밋 1 "사진 경로 정리 N곳". 0.1.75에서 한 단계 하위 폴더를 허용하면 필요 없어진다
export async function flatPhotos(id, names) {
    const all = names ?? (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name);
    // 파일 목록엔 하위 폴더가 안 나온다 — 장이 하위 폴더 그림을 가리키는지로 판단(없으면 아무것도 안 한다)
    const NEST = /(?:materials|context\/assets)\/(?:[^"'()\s<>/]+\/)+[^"'()\s<>/]+\.(?:png|jpe?g|webp|gif|svg|avif)/i;
    let hit = false;
    for (const p of all.filter(n => /^result-[a-z0-9-]+(\.[a-z]{2})?\.html$/.test(n)))
        if (NEST.test((await wget(id, p).catch(() => null)) ?? "")) {
            hit = true;
            break;
        }
    if (!hit)
        return 0;
    await ensureVerify(id);
    const wd = await T().core.invoke("work_dir", { id }).catch(() => null);
    if (!wd)
        return 0;
    await wput(id, ".dynapse/flat-photos.json", "{}");
    const r = await exec("node", [".dynapse/verify.mjs"], undefined, wd).catch(() => null);
    const n = Number((r?.stdout ?? "").match(/"moved":(\d+)/)?.[1] ?? 0);
    if (n && S.git)
        await repoCommit(id, `사진 경로 정리 ${n}곳`);
    return n;
}
// PDF를 장으로(#130 · 보정 2) — 장이 아직 없는 작업에 context/refs/*.pdf가 있으면 verify(import-pdf.json 요청 파일 모드, pdf.js)가 장마다 층 셋(바탕·그림·글)으로 짓는다.
// AI 0 · 이 PC · 40장 · 20MB. 처음 화면은 원본 그대로, 글은 바로 고칠 수 있다. 암호 걸린 PDF는 참고 문서로만
async function importPdf(id, fl = "") {
    const files = await T().core.invoke("work_files", { id }).catch(() => []);
    if (files.some(f => /^result-[a-z0-9-]+\.html$/.test(f.name)))
        return false;
    const pdf = files.find(f => /^context\/refs\/[^/]+\.pdf$/i.test(f.name));
    if (!pdf)
        return false;
    const name = pdf.name.split("/").pop();
    const ev = (state, extra = {}) => postChat(id, [{ role: "event", text: null, payload: { kind: "import", ai: "dynapse", state, ...extra } }]).catch(() => { });
    if (pdf.size > 20 * 1024 * 1024) {
        await postChat(id, [{ role: "event", text: `${name}는 20MB가 넘어 참고 문서로만 두었어요`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
        return false;
    }
    await ensureVerify(id);
    const wd = await T().core.invoke("work_dir", { id }).catch(() => null);
    if (!wd)
        return false;
    await ev("run", { done: 0, total: 0, name });
    await wput(id, ".dynapse/import-pdf.json", JSON.stringify({ file: pdf.name, max: 40 }));
    const r = await exec("node", [".dynapse/verify.mjs"], undefined, wd).catch(() => null);
    let x = {};
    try {
        x = JSON.parse((r?.stdout ?? "").trim().split("\n").pop() ?? "{}");
    }
    catch { /* */ }
    await ev("done");
    if (!x.ok || !x.pages?.length) {
        await postChat(id, [{ role: "event", text: x.error === "password" ? "비밀번호가 있는 PDF예요 · 풀어서 다시 넣어 주세요" : `PDF를 장으로 바꾸지 못했어요 · 참고 문서로 두었어요${x.error && x.error !== "empty" ? ` (${x.error.slice(0, 40)})` : ""}`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
        return false;
    }
    const made = x.pages.map(p => p.file), cap = x.pages.filter(p => p.capture).length, imgs = x.pages.reduce((a, p) => a + p.images, 0);
    await normalizeOrder(id, made);
    await repoCommit(id, `가져옴 · ${name} · ${made.length}장`);
    await postChat(id, [{ role: "event", text: `PDF ${made.length}장을 장으로 불러왔어요${fl} · 원본 그대로예요 · 글은 두 번 눌러 바로 고치고${imgs ? `, 그림 ${imgs}개는 사진처럼 바꿀 수 있어요` : ""} · 장마다 [···] "디냅스 구조로 다시 쓰기"${cap ? ` · ${cap}장은 글을 못 읽어 그림으로 두었어요` : ""}${x.capped ? ` · ${(x.total ?? 0) - 40}장은 참고 문서로만` : ""}`, payload: { kind: "stage", ai: "dynapse", order: true } }]).catch(() => { });
    void afterSave(id);
    return true;
}
// 한 HTML에 여러 장(#20 보정 5) — 다른 도구가 덱 전체를 HTML 하나로 내보낸 경우 첫 장만 보였다. 장이 하나뿐인 가져오기면 verify(split-html.json 요청 파일 모드)로
// 슬라이드 그릇·같은 크기 블록·제목 경계를 찾아 장마다 result-NN-….html로 나눈다(AI 없음). 원본은 materials/import-original.html, [한 장으로 되돌리기]
async function splitImported(id, manual = false) {
    const pages = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(n => /^result-[a-z0-9-]+\.html$/.test(n));
    const none = async (why) => { if (manual)
        await postChat(id, [{ role: "event", text: why, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { }); };
    if (pages.length !== 1)
        return none("장이 하나인 작업만 나눌 수 있어요");
    await ensureVerify(id);
    const wd = await T().core.invoke("work_dir", { id }).catch(() => null);
    if (!wd)
        return;
    await wput(id, ".dynapse/split-html.json", JSON.stringify({ file: pages[0] }));
    const r = await exec("node", [".dynapse/verify.mjs"], undefined, wd).catch(() => null);
    let x = {};
    try {
        x = JSON.parse((r?.stdout ?? "").trim().split("\n").pop() ?? "{}");
    }
    catch {
        return;
    }
    if (!x.split || !x.pages?.length || !x.from)
        return none("나눌 장 경계를 찾지 못했어요 · 그대로 한 장이에요");
    const made = x.pages.map(p => p.file);
    await T().core.invoke("page_delete", { id, path: x.from }).catch(() => { });
    await wput(id, ".dynapse/split.json", JSON.stringify({ from: x.from, pages: made, how: x.how }));
    await normalizeOrder(id, made);
    await repoCommit(id, `HTML 1개 → ${made.length}장으로 나눔`);
    await postChat(id, [{ role: "event", text: `HTML 1개 → ${made.length}장으로 나눴어요`, payload: { kind: "split", ai: "dynapse", n: made.length, how: x.how } }]).catch(() => { });
    void afterSave(id);
}
// [한 장으로 되돌리기] — 나눈 장을 지우고 원본 한 장으로
async function splitUndo(id) {
    const sp = await readJson(id, ".dynapse/split.json").catch(() => null);
    if (!sp?.from)
        return;
    const orig = await wget(id, "materials/import-original.html").catch(() => null);
    if (!orig)
        return;
    await wput(id, sp.from, orig);
    for (const f of sp.pages)
        await T().core.invoke("page_delete", { id, path: f }).catch(() => { });
    await wput(id, ".dynapse/split.json", "{}");
    await normalizeOrder(id, [sp.from]);
    await repoCommit(id, "한 장으로 되돌림");
    await postChat(id, [{ role: "event", text: "원래 HTML 한 장으로 되돌렸어요", payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
    void afterSave(id);
}
// HTML을 이 덱의 새 장으로(#264 보정 1 ① · #267 ④) — AI 없이: 원본은 materials/import-<n>.html, 덱 토큰을 맨 뒤에 입혀(글꼴·색이 덱과 같게) result-import-<이름>.html로 끝에 둔다.
// 검사는 그 장만, 넘침·글자 크기·가져오기 계약(16:9·토큰 밖 색·색 면 2개)만(verify data-import="html"). 다시 쓰지 않는다 — 고칠 점은 한 줄씩 알린다
// replace(#264 ③ A·B안) — 붙여 넣은 B안으로 그 장을 바꾼다(새 장 없이 · 같은 덱 토큰 · 버전 하나 → [되돌리기]로 A)
// 새 장은 내가 가져온 HTML만(#287 — 정지혜 모바일 청첩장: 남의 청첩장 링크의 페이지가 "1장으로 넣었어요 · 고칠 점 36"(외부 주소·스크립트)이 됐다).
// 한 장짜리 작업(모바일 청첩장 · 접는 종이)은 장이 늘지 않는다 · 다른 사이트에서 저장한 페이지(외부 스크립트·og:url·base·외부 링크 많음)는 [이 작업의 새 장으로](explicit)가 아니면 참고 자료로
export const looksExternalPage = (h) => (h.match(/<script\b[^>]*\bsrc\s*=\s*["']https?:/gi) ?? []).length + (/<base\b[^>]*href\s*=\s*["']https?:/i.test(h) ? 3 : 0) + (/property\s*=\s*["']og:url["'][^>]*content\s*=\s*["']https?:\/\/(?![^"']*dynapse\.)/i.test(h) ? 3 : 0) + ((h.match(/(?:href|src)\s*=\s*["']https?:\/\//gi) ?? []).length > 12 ? 3 : 0) >= 3;
async function importPage(id, html0, name0, replace, explicit = false) {
    if (html0.length > 1_500_000)
        throw new Error("1.5MB를 넘는 HTML이에요");
    {
        const order = ((await readPages(id).catch(() => null)) ?? []).filter((x) => typeof x === "string"), single = order.includes("result-mobile.html") || (order.includes("result-out.html") && order.includes("result-in.html"));
        const external = !explicit && looksExternalPage(html0);
        if (!replace && (single || external)) {
            const base = (name0.replace(/\.html?$/i, "") || "page").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "page";
            await wput(id, `context/refs/${base}.html`, html0).catch(() => { });
            await postChat(id, [{ role: "event", text: single ? "참고 자료로 넣었어요 · 이 청첩장은 한 장이에요 · 대화로 \"이것처럼\"이라고 하면 참고해서 고쳐요" : "다른 사이트에서 온 페이지라 참고 자료로 넣었어요 · 새 장으로 넣으려면 붙여 넣고 [이 작업의 새 장으로]", payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
            report("app", "import.to_ref", `reason=${single ? "single" : "external"} bytes=${html0.length}`);
            return;
        }
    }
    const files = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name);
    let n = 1;
    while (files.includes(`materials/import-${n}.html`))
        n++;
    await wput(id, `materials/import-${n}.html`, html0);
    const title = html0.match(/<title>([^<]{1,80})<\/title>/i)?.[1] ?? "", base = (name0.replace(/\.html?$/i, "") || title).toLowerCase().normalize("NFKD").replace(/^result-/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
    let file = replace ?? `result-import-${base || n}.html`;
    if (!replace)
        for (let k = 2; files.includes(file); k++)
            file = `result-import-${base || n}-${k}.html`;
    let h = /<html[\s>]/i.test(html0) ? html0 : `<!doctype html>\n<html lang="ko"><head>\n<meta charset="utf-8">\n</head><body>\n${html0}\n</body></html>`;
    // 장 뿌리: 덱 장 꼴(section.slide)이 있으면 data-import="html"만 달고, 없으면 body 안을 1600×900 한 장으로 감싼다
    if (/<section\b[^>]*\bclass\s*=\s*["'][^"']*\bslide\b/i.test(h))
        h = h.replace(/<section\b(?![^>]*\bdata-import\b)([^>]*\bclass\s*=\s*["'][^"']*\bslide\b[^>]*)>/i, (_m, a) => `<section${a} data-import="html">`);
    else
        h = h.replace(/<body\b([^>]*)>([\s\S]*)<\/body>/i, (_m, a, b) => `<body${a}>\n<section class="slide" data-layout="free" data-import="html" style="width:1600px;height:900px;position:relative;overflow:hidden">\n${b}\n</section>\n</body>`);
    // 덱 토큰 — 원본 스타일 뒤(같은 선택자면 뒤가 이긴다). 원본의 data-tokens 블록은 덱 것으로 바꾼다
    const pt = await pageTokens(id), TOK = /<style\b[^>]*\bdata-tokens\b[^>]*>[\s\S]*?<\/style\s*>/i;
    if (pt.tok) {
        const blk = `<style data-tokens>\n${pt.tok}</style>`;
        h = TOK.test(h) ? h.replace(TOK, "") : h;
        h = /<\/head>/i.test(h) ? h.replace(/<\/head>/i, () => `${blk}\n</head>`) : blk + h;
    }
    await wput(id, file, h);
    const order = replace ? null : await normalizeOrder(id, undefined, [file]);
    await repoCommit(id, replace ? `B안으로 바꿨어요 · ${pageLabel(file)}` : `HTML을 새 장으로 · ${file}`);
    // 검사 — 그 장만
    let line = "";
    if (await ensureVerify(id)) {
        const wd = await T().core.invoke("work_dir", { id }).catch(() => null);
        const r = wd ? await exec("node", [".dynapse/verify.mjs", file], undefined, wd).catch(() => null) : null;
        let v = {};
        try {
            v = JSON.parse((r?.stdout ?? "").trim().split("\n").pop() ?? "{}");
        }
        catch { /* 검사 실패 — 줄 없이 */ }
        const mine = [...(v.errors ?? []), ...(v.warnings ?? [])].filter(x => x.page === file);
        line = mine.length ? ` · 고칠 점 ${mine.length}: ${[...new Set(mine.map(x => x.msg))].slice(0, 3).join(" / ")}` : " · 넘침·글자 크기·토큰 모두 맞아요";
    }
    await postChat(id, [{ role: "event", text: replace ? `${pageLabel(file)}을 B안으로 바꿨어요 · 되돌리면 A안${line}` : `HTML을 ${order ? order.indexOf(file) + 1 : "새"}장으로 넣었어요${line}`, payload: { kind: "stage", ai: "dynapse", file } }]).catch(() => { });
    report("app", "import.page", `bytes=${html0.length} tokens=${pt.tok ? 1 : 0}`);
    void afterSave(id);
}
// 가져온 HTML의 상대경로 재료(#24-보정) — 링크 폴더에서 쓰인 파일만 같은 경로로 복사(AI 없음). 못 찾으면 "파일 N개를 못 찾았어요 · [위치 참조]"
export async function resolveRefs(id, afterLink, commit = true) {
    const r = await T().core.invoke("resolve_refs", { id }).catch(() => null);
    if (!r)
        return;
    if (r.copied.length) {
        if (commit)
            await repoCommit(id, `재료 복사 · ${r.copied.length}개`);
        await postChat(id, [{ role: "event", text: `재료 ${r.copied.length}개 복사`, payload: { kind: "stage", ai: "dynapse" } }]);
    }
    if (r.missing.length)
        await postChat(id, [{ role: "event", text: `파일 ${r.missing.length}개를 못 찾았어요`, payload: { kind: "refs-missing", ai: "dynapse", files: r.missing.slice(0, 20), again: afterLink } }]);
}
// 추천 띠 교체(#24 §2) — 결정적 치환: 재고 사진을 받아 materials/⟨칸⟩-v⟨n⟩으로 두고, 그 칸(data-slot)이 있는 페이지의 사진만 바꾼다. 편집 AI 호출 0
// 공개 라이선스 사진(찾기, #151 보정 1 ③)의 출처 — 서버가 라이선스를 확인해 보낸 값. CC0·CC BY·Pixabay만
function creditOf(x) {
    const c = x;
    if (!c || typeof c !== "object" || !["cc0", "by", "pixabay"].includes(String(c.license)) || typeof c.title !== "string")
        return null; // pixabay = 서버가 받아 올린 Pixabay 사진(image_stock §5 ④)
    const s = (v, n) => (typeof v === "string" && v ? v.slice(0, n) : null);
    return { title: c.title.slice(0, 120), creator: s(c.creator, 80), license: String(c.license), license_version: s(c.license_version, 8), license_url: s(c.license_url, 300), landing: s(c.landing, 300), source: s(c.source, 40), ...(s(c.open_id, 40) ? { open_id: s(c.open_id, 40) } : {}) };
}
export async function swapPhoto(id, page0, slot, url, assetId, credit = null) {
    if (!/^[a-z0-9_]{1,40}$/i.test(slot) || !/^https:\/\/[a-z0-9.-]+\.public\.blob\.vercel-storage\.com\//.test(url))
        return; // 우리 재고 저장소만
    // 그 장표 하나만(#42) — 장표가 없으면 그 슬롯이 한 장표에만 있을 때만
    const page = await resolvePage(id, slot, page0);
    if (!page) {
        await postChat(id, [{ role: "event", text: `사진 요청에 장표가 없어요 · ${slot}`, payload: { kind: "error", ai: "dynapse" } }]);
        return;
    }
    const dir = await T().core.invoke("work_dir", { id });
    const files = await T().core.invoke("work_files", { id }).catch(() => []);
    const ext = /\.jpe?g(\?|$)/i.test(url) ? "jpg" : "png";
    const file = nextMaterial(files, page, slot, ext);
    const g = await http("GET", url, { out: `${dir}/${file}` }).catch(() => null);
    const data = g?.status === 200 && (await T().core.invoke("work_files", { id }).catch(() => [])).some(f => f.name === file && f.size > 0);
    if (!data) {
        await postChat(id, [{ role: "event", text: "사진을 받지 못했어요", payload: { kind: "error", ai: "dynapse" } }]);
        return;
    }
    // 상대경로(#29 A1) — 페이지에 base64를 넣지 않는다. 올릴 때 verify의 bundle이 넣는다
    await placePhoto(id, page, slot, file, { runtime: credit ? "open" : "stock", hand: true, ...(assetId ? { asset_id: assetId } : {}), ...(credit ? { title: credit.title } : {}) });
    const placed = (await readSlots(id))[slotKey(page, slot)] ?? file;
    if (credit)
        await addCredit(id, { ...credit, file: placed, page, slot, at: Date.now() }); // 출처 줄은 마무리 장에(앱이 적는다)
    await addPending(id, { t: "photo", page, slot, file: placed, label: `${pageLabel(page)} · ${slot} ${credit ? "공개 사진" : "재고"}` }); // 모아 저장(#46)
    await photoDone(id, page, slot, placed);
}
// 클릭 요청(#30 — 추천 띠 사진 교체·사진 버전 쓰기·글자 직접 수정) = 커밋 1 = 스레드 항목 1. 렌더는 생략(가볍게), 라벨만
export { setPhotoBudget } from "./photo-runner.js"; // 시뮬레이터가 예산을 줄인다
export { aiRecordHtml } from "./ai-record.js"; // AI 사용 기록(#153 ④) — 시뮬레이터가 내용을 본다
// 늦게 온 사진 교체(#151 보정 1 ②) — 턴 항목으로 저장(⌘Z가 되돌리는 대상) + 한 줄 "사진 N장이 도착해 바꿨어요 · ⌘Z"
async function lateRound(id, n, ais) {
    if (!S.git)
        return;
    const pages = (await T().core.invoke("repo_changed", { id }).catch(() => [])).filter(f => PAGE_RE.test(f) || LANG_PAGE.test(f));
    if (!pages.length)
        return;
    const trace = (await readJson(id, ".dynapse/TRACE.json")) ?? {};
    const k = (trace.rounds?.at(-1)?.n ?? 0) + 1, label = `사진 ${n}장이 도착해 바꿨어요`;
    const v = await appVerify(id, pages).catch(() => null);
    const r = { n: k, role: "write", runtime: "dynapse", session_id: "", files: pages, req: { text: label, kind: "photo-late" } };
    await saveRound(id, r, label, v);
    if (!r.commit)
        return;
    await wput(id, ".dynapse/TRACE.json", JSON.stringify({ ...trace, rounds: [...(trace.rounds ?? []), r] }, null, 2));
    await postChat(id, [{ role: "event", text: `${label} · ${S.app?.os === "windows" ? "Ctrl+Z" : "⌘Z"}`, payload: { kind: "shot", ai: ais[0] ?? "dynapse", round: k, pages: await orderShots(id, r.shots ?? []), commit: r.commit, uploaded: !!r.uploaded, ais: ["dynapse", ...ais], labels: [`${pages.map(pageLabel).slice(0, 3).join(" · ")} · 사진`], photo_late: n } }]);
    void afterSave(id);
}
async function clickRound(id, label, ais) {
    if (!S.git)
        return null;
    const trace = (await readJson(id, ".dynapse/TRACE.json")) ?? {};
    const n = (trace.rounds?.at(-1)?.n ?? 0) + 1;
    const parent = await T().core.invoke("repo_head", { id }).catch(() => null);
    const sha = await repoCommit(id, `r${n} · ${label}`);
    if (!sha || sha === parent)
        return sha; // 바뀐 게 없으면 항목도 없다
    const r = { n, role: "write", runtime: "dynapse", session_id: "", files: [], req: { text: label, kind: "click" }, commit: sha, ...(parent ? { parent } : {}) };
    await wput(id, ".dynapse/TRACE.json", JSON.stringify({ ...trace, rounds: [...(trace.rounds ?? []), r] }, null, 2));
    await postChat(id, [{ role: "event", text: label, payload: { kind: "shot", ai: ais[0] ?? "dynapse", round: n, pages: [], commit: sha, uploaded: false, ais, labels: [label] } }]);
    return sha;
}
async function publishLatest(id) {
    const say = (text, kind = "stage") => postChat(id, [{ role: "event", text, payload: { kind, ai: "dynapse" } }]);
    // 예시 칸이 남으면 공개하지 않는다(#304 보정 2 ⑤ — 지어낸 예시가 사실처럼 피드에 올라가지 않게)
    {
        const F = await import("./facts.js");
        let n = 0;
        for (const f of (await T().core.invoke("work_files", { id }).catch(() => [])).map(x => x.name).filter(x => /^result-[a-z0-9-]+\.html$/.test(x)))
            n += F.exampleCount((await wget(id, f).catch(() => null)) ?? "");
        if (n) {
            await say(`예시 칸 ${n}개를 바꿔야 공개할 수 있어요 · 빈칸 카드에서 채우거나 [예시 그대로 쓰기]`, "error");
            return;
        }
    }
    await say("공개하는 중 · 확인");
    await ensureVerify(id);
    const v = await appVerify(id);
    if (!v.ok) {
        await postChat(id, [{ role: "event", text: null, payload: { kind: "verify", ai: "dynapse", ok: false, errors: v.errors.slice(0, 5), warnings: v.warnings.length, wk: warnKinds(v.warnings) } }]);
        await say("확인을 통과하지 못해 공개하지 않았어요 · 채팅으로 고쳐 달라고 해 주세요", "error");
        return;
    }
    const r0 = await mcp("publish_work", { work_id: id }).catch(() => null);
    const dir = await T().core.invoke("work_dir", { id });
    const have = new Set((await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name));
    const puts = (r0?.data?.put ?? []).filter(p => have.has(p.name));
    if (!puts.length) {
        await say(r0?.text?.slice(0, 80) || "올릴 페이지가 없어요", "error");
        return;
    }
    await say(`공개하는 중 · ${puts.length}장 올리기`);
    for (const p of puts) {
        const b = `.dynapse/out/${p.name.replace(/^result-|\.html$/g, "")}.bundle.html`;
        const u = await http("PUT", p.url, { file: `${dir}/${have.has(b) ? b : p.name}`, contentType: "text/html", auth: true }).catch(() => ({ status: 0, body: "" }));
        if (u.status !== 200) {
            let why = "";
            try {
                why = JSON.parse(u.body ?? "{}").error ?? "";
            }
            catch { /* */ }
            await say(`${pageLabel(p.name)}을 올리지 못했어요${why ? ` · ${why}` : ""}`, "error");
            return;
        }
    }
    const head = S.git ? await T().core.invoke("repo_head", { id }).catch(() => null) : null; // 공개된 버전 = 지금 커밋(#35 A)
    const r = await mcp("publish_work", { work_id: id, submit: true, ...(head ? { head } : {}) }).catch(() => null);
    const vis = r?.data?.visibility;
    // 공개 = 재료도 올린다(#49 A3) — 동기화·함께가 꺼져 있어도 이 작업만 한 번(공개되면 열린 작업이라 서버가 받는다). 공개 페이지·다른 PC가 사진을 볼 수 있게
    if (vis === "public") {
        sharedWorks.add(id);
        const ok = await pushWork(id, dir).then(() => true).catch(() => false);
        if (!ok)
            await say("재료를 못 올렸어요 · 사진이 안 보이면 [다시]", "error");
    }
    // 실패는 실패로(대표 2026-10-06: "공개 신청"만 뜨고 아무 일도 없었다) — 이유 한 줄 + 다시
    if (!vis) {
        await say(`공개하지 못했어요 · ${(r?.text ?? "서버가 응답하지 않아요").slice(0, 100)}`, "error");
        return;
    }
    await postChat(id, [{ role: "agent", text: vis === "public" ? "공개했어요 · 피드에 올라갔어요" : vis === "pending-fill" ? "빈 사진 칸이 있어 아직 공개 전이에요 · 칸을 채우면 바로 공개돼요" : "공개 대기 중이에요", payload: { ai: "dynapse", summary: [vis === "public" ? "공개" : "공개 대기"] } }]);
}
const DECK_FILES = ["result-cover.html", "result-body.html", "result-data.html", "result-closing.html"];
// 반려 카드(#62 보정 1) — 제출 카드 대신. 웹이 칩 둘([사진 채우고 다시 제출 · N장] [사진 칸 빼고 다시 제출])을 붙이고, 고친 턴이 검사를 통과하면 웹이 다시 제출한다
const PAGE_KO = { cover: "표지", body: "본문", data: "데이터", closing: "마무리" };
async function rejectedCard(id, taskId, o) {
    const pages = [...new Set((o.pages ?? []).map(p => { const k = p.replace(/^result-|\.html$/g, ""); return PAGE_KO[k] ?? (/^card-\d+$/.test(k) ? `카드 ${k.slice(5)}` : k); }).filter(Boolean))];
    const photo = o.kind ? o.kind === "photo_empty" : (o.slots ?? 0) > 0;
    const line = o.line ?? (photo ? `${pages.length ? `${pages.join("·")}에 ` : ""}빈 사진 칸이 있어요${o.slots ? ` (${o.slots}칸)` : ""} — 채우거나 빼면 올릴 수 있어요` : o.agent ? `검사에서 걸린 곳 · ${o.agent.replace(/^L0:\s*/, "").split(/\s+\/\s+/)[0].replace(/^덱 \d+건\s*—\s*/, "").slice(0, 90)}` : "검사를 통과하지 못했어요 — 채팅으로 고쳐 달라고 해 주세요"); // 사유 첫 문장을 그대로(#161)
    await postChat(id, [{ role: "event", text: line, payload: { kind: "rejected", ai: "dynapse", reason: photo ? "photo_empty" : o.kind && o.kind !== "other" ? o.kind : "other", slots: o.slots ?? 0, task_id: taskId, ...(o.agent ? { agent: o.agent.slice(0, 600) } : {}) } }]);
}
// 지정 형태 적용(#127 보정 7 — wrk_88a8…: 카드뉴스 발주의 역할 키 body·data가 없는 result-body.html로 풀려 AI가 짓지 않았고, 앱 검사는 없는 장이라 건너뛰고, 서버는 반려했다).
// 서버 L0와 같은 표(shared/forms formPages)로 지정 형태의 장을 정하고, 지금 형태가 다르면 앱이 그 형태로 다시 짓는다(form-alts 결정적 빌드 · AI 0).
// 못 지은 장만 AI 장 턴 한 번 → 끝나면 앱이 다시 제출. 직접 고친 장(#143 §2)은 건드리지 않는다
const formsTried = new Set();
const formLab = (f) => { const k = f.replace(/^result-|\.html$/g, ""); return PAGE_KO[k] ?? (/^card-\d+$/.test(k) ? `카드 ${k.slice(5)}` : k); };
function formNow(html, planForm) {
    const sec = html.slice(Math.max(0, html.search(/<section\b/i)));
    return sec.match(/^<section\b[^>]*\bdata-form\s*=\s*["']([a-z0-9-]+)["']/i)?.[1] ?? planForm
        ?? sec.match(/data-block\s*=\s*["']cover_\d+["'][^>]*\bdata-form\s*=\s*["']([a-z0-9-]+)["']/i)?.[1]
        ?? sec.replace(/&quot;/g, '"').match(/data-viz\s*=\s*'[^']*?"type"\s*:\s*"([a-z0-9-]+)"/i)?.[1] ?? null;
}
async function assignForms(id, taskId, replaces) {
    const rf = await readJson(id, ".dynapse/reward-forms.json").catch(() => null);
    if (!rf || !Object.keys(rf).length)
        return "ok";
    const say = (text) => postChat(id, [{ role: "event", text, payload: { kind: "stage", ai: "dynapse" } }]);
    const files = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(n => /^result-[a-z0-9-]+\.html$/.test(n));
    const num = (a, b) => a.localeCompare(b, undefined, { numeric: true });
    const order0 = ((await readPages(id).catch(() => null)) ?? []).filter(f => files.includes(f));
    const order = [...order0, ...files.filter(f => !order0.includes(f)).sort(num)];
    if (!order.length)
        return "ok";
    // 예전 수락분은 키가 없는 장 이름(result-body.html)으로 풀려 있다 — 장 키(body)로 되돌려 같은 표로 다시 푼다
    const keyed = Object.fromEntries(Object.entries(rf).map(([f, v]) => [order.includes(f) ? f : f.replace(/^result-|\.html$/g, ""), v]));
    const htmls = new Map();
    for (const f of order)
        htmls.set(f, (await wget(id, f)) ?? "");
    const map = formPages(order, keyed, f => htmls.get(f));
    const fixed = Object.fromEntries(map.filter(x => x.file).map(x => [x.file, x.form]));
    // plan.json — 없는 장으로 씨앗된 지정 항목은 빼고 실제 장에 fixed·role(verify assigned_form이 그 장을 본다)
    {
        const plan = await readJson(id, ".dynapse/plan.json").catch(() => null);
        if (plan?.pages) {
            const n0 = plan.pages.length;
            plan.pages = plan.pages.filter(p => !p.fixed || files.includes(p.page ?? ""));
            if (plan.pages.length !== n0)
                await wput(id, ".dynapse/plan.json", JSON.stringify(plan, null, 2));
        }
    }
    await seedPlan(id, fixed);
    const plan = await readJson(id, ".dynapse/plan.json").catch(() => null);
    const pf = (f) => plan?.pages?.find(p => p.page === f)?.form ?? null;
    const coverK = (formNow(htmls.get(order[0]) ?? "", pf(order[0])) ?? "cover-colour-giant").replace(/^cover-/, "");
    const want = (f) => (/^closing-(same|invert|swap|crop)$/.test(f) ? `closing-${coverK}-${f.slice(8)}` : f); // 짧은 마무리 id = 표지 모양 + 짝(verify와 같은 규칙)
    const todo = map.filter(x => x.file && formNow(htmls.get(x.file) ?? "", pf(x.file)) !== want(x.form)).map(x => ({ file: x.file, form: want(x.form) })).sort((a, b) => order.indexOf(a.file) - order.indexOf(b.file));
    const missing = map.filter(x => !x.file);
    if (!todo.length && !missing.length)
        return "ok";
    const fk = `${id}|${taskId}`;
    await say(`지정된 모양 ${todo.length + missing.length}개가 아직 없어서 맞추는 중 · ${[...todo.map(t => formLab(t.file)), ...missing.map(x => x.key)].join("·")}`);
    const hand = new Set(((await readJson(id, HAND_PAGES).catch(() => null)) ?? []).filter(x => typeof x === "string"));
    const { buildAssigned, FORM_KO } = await import("./form-alts.js");
    const built = [], left = [];
    for (const t of todo) {
        if (hand.has(t.file)) {
            await say(`${formLab(t.file)} · 직접 고친 장이라 그대로 둬요`);
            continue;
        }
        const r = await buildAssigned(id, t.file, t.form).catch(() => false);
        if (r === "photo")
            await say(`${formLab(t.file)} · 이 모양은 사진이 빠져서 지금 장 그대로 둬요(사진이 있어야 하는 장)`); // AI도 같은 충돌 — 검수에 맡긴다
        else if (r) {
            built.push(t.file);
            await say(`${formLab(t.file)} · ${FORM_KO[t.form] ?? t.form}(으)로 지었어요`);
        }
        else
            left.push(t);
    }
    if (built.length)
        await repoCommit(id, `지정 형태 · ${built.map(formLab).join("·")}`);
    report("export", "reward.assign_forms", `built=${built.length} left=${left.length} missing=${missing.length}`);
    if ((left.length || missing.length) && !formsTried.has(fk)) {
        formsTried.add(fk);
        pendingSubmit.set(id, { taskId, ...(replaces ? { replaces } : {}) });
        await say(`${[...left.map(t => formLab(t.file)), ...missing.map(x => x.key)].join("·")} · 재료에 맞는 틀이 없어 AI가 이 장만 지정 모양으로 지어요 · 끝나면 제출해요`);
        void chatSend(id, `[Assigned forms before submit] This reward assigns these forms: ${[...left.map(t => `${t.file} → ${t.form}`), ...missing.map(x => `${x.key} → ${x.form} (no free page — turn the closest body page into it)`)].join("; ")}. Rebuild only those pages in that form, keeping each page's text, numbers and photos; write data-form="<form>" on its <section class="slide"> and set that page's form in .dynapse/plan.json. Do not touch other pages. The app submits again when you finish.`, { scope: "page" });
        return "turn";
    }
    return "ok";
}
// 발주가 정한 형태(#127 보정 4) — 수락한 리워드의 spec.forms를 plan.json에 장마다 {page, role, fixed}로 먼저 써 둔다(AI는 claim·evidence·frames만 채운다).
// 원본은 .dynapse/reward-forms.json에도(verify가 AI가 plan을 다시 써도 지정 형태를 지켰는지 본다 — assigned_form)
async function seedPlan(id, forms) {
    await wput(id, ".dynapse/reward-forms.json", JSON.stringify(forms));
    const plan = (await readJson(id, ".dynapse/plan.json").catch(() => null)) ?? {};
    const pages = Array.isArray(plan.pages) ? plan.pages : [];
    let changed = !Array.isArray(plan.pages);
    for (const [file, form] of Object.entries(forms)) {
        if (!/^result-[a-z0-9-]+\.html$/.test(file))
            continue;
        const role = /^cover-/.test(form) ? "cover" : /^closing-/.test(form) ? "closing" : /^section-/.test(form) ? "section" : "body";
        const pg = pages.find(p => p.page === file);
        if (!pg) {
            pages.push({ page: file, role, fixed: form });
            changed = true;
        }
        else if (pg.fixed !== form || pg.role !== role) {
            pg.fixed = form;
            pg.role = role;
            changed = true;
        }
    }
    if (changed)
        await wput(id, ".dynapse/plan.json", JSON.stringify({ ...plan, pages }, null, 2));
}
// 서버 L0가 지정 형태로 걸었는데 앱이 이미 맞춘 뒤면(그리는 형태 자리에 박스 나열 등) — 서버 사유 그대로 AI 장 턴 한 번 → 끝나면 다시 제출(작업·Task당 한 번)
async function l0Turn(id, taskId, replaces, why, kind) {
    const fk = `${id}|${taskId}|l0`;
    if (kind !== "forms" || formsTried.has(fk))
        return false;
    formsTried.add(fk);
    pendingSubmit.set(id, { taskId, ...(replaces ? { replaces } : {}) });
    await postChat(id, [{ role: "event", text: "지정된 모양이 서버 검사에 아직 맞지 않아 AI가 그 장만 고쳐요 · 끝나면 제출해요", payload: { kind: "stage", ai: "dynapse" } }]);
    void chatSend(id, `[Assigned forms — server check before submit] The server's check says: ${why.join(" / ").slice(0, 900)}. Fix only the pages it names so each shows its assigned form (data-viz of that type for drawn forms, never a row of equal boxes), keep each page's text and photos, write data-form="<form>" on its <section class="slide"> and set the form in .dynapse/plan.json. The app submits again when you finish.`, { scope: "page" });
    return true;
}
// 남은 문제 카드(#127 보정 5 ④) — 반려 카드 자리에 "05가 44%라 검수에서 감점될 수 있어요" 장마다 한 줄. 웹이 [그래도 제출](검사 건너뜀) [더 고치기]를 붙인다
export function softLines(errors) {
    const by = new Map();
    for (const e of errors) {
        const k = e.page && e.page !== "*" ? e.page : "*";
        by.set(k, [...(by.get(k) ?? []), e]);
    }
    return [...by].slice(0, 6).map(([pg, es]) => {
        const lab = pg === "*" ? "덱 전체" : pg.replace(/^result-|\.html$/g, ""), uf = es.find(e => e.rule === "underfill");
        if (uf)
            return `${lab}가 ${(uf.msg ?? "").match(/장의 (\d+)%/)?.[1] ?? "?"}%라 검수에서 감점될 수 있어요`;
        return `${lab} · ${(es[0].msg ?? es[0].rule).split(/ — /)[0].slice(0, 60)}${es.length > 1 ? ` 외 ${es.length - 1}` : ""}`;
    });
}
async function softRejectCard(id, taskId, errors) {
    const lines = softLines(errors);
    await postChat(id, [{ role: "event", text: lines.join("\n"), payload: { kind: "rejected", ai: "dynapse", reason: "soft", slots: 0, task_id: taskId, agent: errors.map(e => `- ${e.page === "*" ? "" : `${e.page}: `}${e.msg}`).join("\n").slice(0, 600) } }]);
}
const ladderTried = new Set();
const TOKENS_WHY = /tokens\.css가 비어 있다|CSS 변수\(--…\)가 없다|<style data-tokens>가 tokens\.css와 다르다|<style data-tokens> 없음/; // 서버 L0의 토큰 사유(#161 — lib/deck.ts deckL0)
const DEMON = /여기|거기|저기|이\s*(섹션|항목|칸|부분|박스|표|행|열|줄|제목|문장|숫자)|저\s*(서비스|항목|칸|부분|것)|그\s*(칸|부분|항목)/; // 가리키는 말(#233 ①)
const lastEdit = new Map();
const lastReply = new Map();
const spaceTweaks = new Map(); // 장마다 배치 손보기 횟수(#233 ⑤)   // 지난 답(넘겨받기에 열린 질문을 싣는다 — #233 ②)   // 지난 턴에 고친 자리 — 턴마다 새로(같은 자리 이어서)
const englishRetried = new Set(); // 영어 답 한 번만 다시(#233 ②)
// 영어 답 판정(#304 앵커 B 10-27 — "Make a slide deck about …"로 시작한 원문에 영어로 답했고, 정책 이름 한글이 섞여 "한글 0" 검사를 지나갔다): 인용·코드·> 줄(이미지 프롬프트)을 빼고 라틴 글자가 한글의 세 배 넘으면 영어
export const mostlyEnglish = (t) => { const b = t.replace(/```[\s\S]*?```/g, "").replace(/^\s*>.*$/gm, "").replace(/`[^`]*`/g, "").replace(/"[^"\n]*"|“[^”]*”/g, ""); const ko = (b.match(/[가-힣]/g) ?? []).length, en = (b.match(/[A-Za-z]/g) ?? []).length; return en > 40 && en > ko * 3; };
// 배치·공간 말(#233 ③ — 1.7M 토큰 작업에서 짧은 말이 전부 가벼운 Sonnet·낮음으로 가 "옆으로 넘치면 행이 짧아지니 박스를 넓고 낮게"를 글자 그대로(1.35fr→1fr) 했다): 길이와 무관하게 보통 등급 · Opus · 보통 강도
export const SPACE_WORDS = /너비|폭|높이|여백|마진|간격|줄\s*바꿈|한\s*줄|두\s*줄|옆으로|아래로|위로|겹치|겹침|4분면|사분면|맞춰|정렬|넓게|좁게|낮게|높게|칸\s*크기|열\s*너비|width|height|margin|padding|gap|align|wrap|overlap/i;
export const REPEAT_RE = /다시\s*해\s*봐|다시\s*해|내가\s*못\s*봤|안\s*바뀌었|그대로(야|네|인데)|아직(도)?\s*(그대로|안)/;
const lastModelOf = new Map();
const TOO_LONG = /exceeds the maximum number of tokens|prompt is too long|maximum context length|context[_ ]length[_ ]exceeded|input is too long|too many (input )?tokens|request too large/i, longRetried = new Set(); // #213 보정 1
const SESSION_TURNS = 20, CTX_WINDOW = 200_000; // 한 대화 20턴이면 미리 새 대화로(#213 보정 1)
const SESSION_ROLL_CR = 20_000_000, rollNote = new Set();
// 넘겨받기 한 단락(#213 보정 1) — 제목·장 목록·마지막 5턴의 요청과 바뀐 파일·열린 사진 요청·판형·팩. 지난 대화 없이 파일에서 이어 간다
const HANDOFF0 = "[New session — the previous conversation for this work grew too long and was closed. Pick up from the files: .dynapse/plan.json and .dynapse/NOTES.md first, then the result pages the request names. Do not re-read every page.]\n";
export async function handoff(id) {
    const tr = await readJson(id, ".dynapse/TRACE.json").catch(() => null), pages = (await readPages(id).catch(() => null)) ?? [];
    const plan = await readJson(id, ".dynapse/plan.json").catch(() => null);
    const pack = await readJson(id, ".dynapse/style-pack.json").catch(() => null);
    const pr = await readJson(id, ".dynapse/photo-requests.json").catch(() => null);
    const last = (tr?.rounds ?? []).filter(r => r.req?.text).slice(-5).map(r => `"${(r.req.text ?? "").replace(/\s+/g, " ").slice(0, 120)}" → ${r.files.slice(0, 4).join(", ") || "no file change"}`);
    const le = lastEdit.get(id), lr = lastReply.get(id), q = lr && /[?？]\s*$|할까요|하시겠어요|원하시면/.test(lr) ? lr.replace(/\s+/g, " ").slice(-160) : "";
    return `${HANDOFF0.slice(0, -2)} Handoff: title ${JSON.stringify(tr?.title ?? plan?.title ?? "")};${le ? ` current target ${le.pt.file}${le.pt.slot ? ` [data-slot="${le.pt.slot}"]` : ""};` : ""}${q ? ` your last question to the user (they may be answering it): ${JSON.stringify(q)};` : ""} pages in order ${pages.slice(0, 30).join(", ") || "none yet"}${plan?.print_format || plan?.format ? `; format ${plan.print_format ?? plan.format}` : ""}${pack?.id ? `; style pack ${pack.name ?? pack.id}` : ""}${Array.isArray(pr) && pr.length ? `; open photo requests ${pr.slice(0, 6).map(r => `${r.page}|${r.slot}`).join(", ")}` : ""}${last.length ? `; last turns: ${last.join(" / ")}` : ""}.]\n`;
} // 대화 바꾸기 기준(#213 ②) · 다음 턴에 넘겨받기 한 단락
const softLeft = new Map(), fixRound = new Map(); // 경고만 남아 카드 없이 제출한 수(#211) · 고침 턴 횟수(#211 보정 1)
const planFixTried = new Map(), pendingSubmit = new Map();
// 장들의 토큰 블록 중 가장 많은 것(없으면 재료 레이아웃의 :root 토큰) — tokens.css를 만들 때와 못 읽을 때(#161) 같은 추출
async function pageTokens(id) {
    const files = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name);
    const count = new Map();
    for (const f of files.filter(n => /^result-[a-z0-9-]+\.html$/.test(n))) {
        const b = ((await wget(id, f).catch(() => null)) ?? "").match(/<style\b[^>]*\bdata-tokens\b[^>]*>([\s\S]*?)<\/style\s*>/i)?.[1]?.trim();
        if (b && /--[\w-]+\s*:/.test(b))
            count.set(b, (count.get(b) ?? 0) + 1);
    }
    const top = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    if (top)
        return { tok: `${top.replace(/\r\n?/g, "\n").trim()}\n`, from: "pages" };
    for (const f of files.filter(n => /^materials\/[\w-]+\.html$/.test(n))) {
        const m = ((await wget(id, f).catch(() => null)) ?? "").match(/:root\s*\{[^}]*--color-semantic[^}]*\}/);
        if (m)
            return { tok: `${m[0].replace(/\r\n?/g, "\n").trim()}\n`, from: "materials" };
    }
    return { tok: null, from: null };
}
// tokens.css 읽기(#161) — 0.1.80까지의 네이티브 work_read는 .css를 거부해 wget(tokens.css)가 늘 null이었다(제출 전 확인에 tokens:"" → 서버 "tokens.css가 비어 있다" → 덱 리워드 제출 전부 반려).
// 파일을 못 읽으면 장들의 <style data-tokens> 블록(ensureTokens가 tokens.css를 만드는 그 글)으로 돌아온다. 네이티브 새 판(work_read .css 예외)에선 파일 그대로
export async function readTokens(id) {
    const f = await wget(id, "tokens.css").catch(() => null);
    if (f && /--[\w-]+\s*:/.test(f))
        return f;
    return (await pageTokens(id)).tok;
}
// 토큰 파일(#127 보정 6 — wrk_88a8…: AI가 tokens.css를 쓰지 않아 "tokens.css을 올리지 못했어요"로 멈춤). 앱이 만든다(AI 0): 장마다 든 <style data-tokens> 중 가장 많은 것을 그대로,
// 없으면 재료 레이아웃(materials/*.html)의 :root 토큰. verify는 장의 토큰 블록 = tokens.css를 본다 — 대부분의 장과 같은 글이 된다.
// "made"는 파일이 정말 없었을 때만(#161 — 못 읽는 것을 없는 것으로 보고 한 작업에 세 번 "만들었어요"를 띄웠다). force = 장 블록으로 다시 쓰기(서버가 tokens 사유로 반려했을 때·못 읽어 확인 못 할 때)
export async function ensureTokens(id, force = false) {
    const cur = await wget(id, "tokens.css").catch(() => null);
    if (!force && cur && /--[\w-]+\s*:/.test(cur))
        return "ok";
    const exists = (await T().core.invoke("work_files", { id }).catch(() => [])).some(f => f.name === "tokens.css" && f.size > 0);
    const { tok, from } = await pageTokens(id);
    if (!tok)
        return exists ? "ok" : "none";
    if (cur === tok)
        return "ok";
    const ok = await wput(id, "tokens.css", tok).then(() => true).catch(() => false);
    report("export", ok ? (exists ? "reward.tokens_synced" : "reward.tokens_made") : "reward.tokens_write_fail", `from=${from}${force ? " force" : ""}`);
    return ok ? (exists ? "ok" : "made") : exists ? "ok" : "none";
}
// 토큰 블록 결정적 삽입(#239 ① · #248 ① — 접는 청첩장 s-sky 작업: AI가 <style data-tokens>를 안 넣어 레이아웃 기본 회색, 제출 전 검사는 막기만 했다).
// 리워드 Task의 style(팔레트·스타일 팩·qi·wa)로 허브가 만든 tokens.css(/api/layouts/tokens.css — 발주 원고와 같은 함수)를 블록 없는 장에 넣는다. AI 0 · 블록이 있는 장은 그대로
export async function injectTokens(id, taskId) {
    const TOK = /<style\b[^>]*\bdata-tokens\b[^>]*>([\s\S]*?)<\/style\s*>/i;
    const names = (await T().core.invoke("work_files", { id }).catch(() => [])).filter(f => f.size > 0).map(f => f.name).filter(n => PAGE_RE.test(n));
    const bare = [];
    for (const f of names) {
        const h = await wget(id, f).catch(() => null);
        if (h && !/--[\w-]+\s*:/.test(h.match(TOK)?.[1] ?? ""))
            bare.push([f, h]);
    }
    if (!bare.length)
        return 0;
    // 다른 장에 블록이 있으면 그 글 그대로(모든 장이 같은 토큰 = verify 규칙) · 없으면 Task 색. 장에 .style-qi 같은 무드 클래스가 없으면(접는 청첩장 v23) 선택자를 :root까지 넓힌다
    const pt = await pageTokens(id);
    let tok = pt.from === "pages" ? pt.tok?.trim() ?? null : null, style = "pages";
    if (!tok) {
        const t = await mcp("get_task", { task_id: taskId }).catch(() => null);
        style = t?.data?.spec?.style ?? "";
        if (t?.data?.spec?.kind !== "deck" || !/^[a-z0-9-]{2,40}$/.test(style))
            return 0;
        const mobile = bare.some(([, h]) => /\bdata-format\s*=\s*["']mobile["']/i.test(h)); // 모바일 장 = 흰 바탕 토큰(팔레트 연한 면이 장 전체를 물들이지 않게)
        const r = await http("GET", `${HUB}/api/layouts/tokens.css?mood=${encodeURIComponent(style)}${mobile ? "&format=mobile" : ""}`).catch(() => null);
        tok = r?.status === 200 && /--color-semantic-/.test(r.body) ? r.body.trim() : null;
        if (!tok) {
            report("export", "reward.tokens_inject_fail", `style=${style} status=${r?.status ?? 0}`);
            return 0;
        }
        tok = tok.replace(/(^|\n)(\s*)\.style-([a-z0-9-]+)\s*\{/g, (m, a, b, k) => (bare.some(([, h]) => new RegExp(`class\\s*=\\s*["'][^"']*\\bstyle-${k}\\b`).test(h)) ? m : `${a}${b}:root,.style-${k}{`));
    }
    const blk = `<style data-tokens>\n${tok}\n</style>`;
    for (const [f, h] of bare)
        await wput(id, f, TOK.test(h) ? h.replace(TOK, blk) : /<\/head>/i.test(h) ? h.replace(/<\/head>/i, `${blk}\n</head>`) : blk + h);
    await wput(id, "tokens.css", `${tok}\n`).catch(() => { });
    report("export", "reward.tokens_injected", `style=${style} n=${bare.length}`);
    return bare.length;
}
// 색은 앱이 정한다(#274 ① ② — 대표 2026-10-22 20:50). 턴 뒤·제출 전에 모든 장(병렬 장 턴이면 그 장들만):
// 잠근 덱(.dynapse/palette.json = 첫 턴 전에 앱이 쓴 팔레트 토큰)은 토큰 블록을 잠근 글로 되돌리고(색을 말로 바꾼 턴이면 AI가 바꾼 tokens.css가 새 잠금) 레이아웃 무드 블록의 색 선언을 뺀다.
// 모든 덱: 토큰 밖 색값 → 가장 가까운 토큰(colors.ts) · 장 배경 그라데이션 → 첫 색 한 면. 공지 종류 색(#158 ⑤)은 그대로. AI 0
export const PALETTE_FILE = ".dynapse/palette.json";
export const COLOR_ASK = /색상|색깔|색을|색으로|색이|색만|색\s|컬러|colou?r|팔레트|palette|배경|바탕|파란|파랑|빨간|빨강|노란|초록|분홍|핑크|보라|검정|검은|흰색|하얀|하늘색|주황|베이지|네이비|민트|톤을|톤으로|톤\s/i;
// 칸 글 계약(#275 ② — 대표 "속도 먼저": 6장 카드 Claude 266초·출력 3.2만). 새 덱의 첫 턴은 AI가 .dynapse/slot-NN.json만 쓰고, 앱이 파일이 생기는 즉시 장을 조립한다(slots.ts).
// 메뉴 = 그 판형(card·slide) 레이아웃 뼈대의 칸 열쇠·상한(허브 레이아웃 API, 하루 기억). 지켜보기는 이 PC 폴더만 400ms마다 읽는다(서버 호출 = 새 장의 뼈대 한 번씩) · 턴이 끝나면 멈춘다(상한 15분)
const slotMenus = new Map();
const slotsTurn = new Map();
// 레이아웃 목록 = 허브 지침 색인(layouts.json: 판형·역할) — 앱 안 등록부 사본(shared/layout-registry)엔 id·kind뿐이다(ota3·4에서 메뉴가 비어 칸 글 계약이 켜지지 않았다). 변형 id는 뼈대의 data-variant 규칙에서
export async function slotMenuFor(kind) {
    const c = slotMenus.get(kind);
    if (c && Date.now() - c.at < 86_400_000)
        return c.layouts;
    const ix = (await tierBundles().catch(() => null))?.index ?? TIER_BUNDLES?.index ?? await http("GET", `${HUB}/skills/bundles/layouts.json`).then(r => (r.status === 200 ? JSON.parse(r.body) : null)).catch(() => null);
    if (!ix)
        return [];
    const S2 = await import("./slots.js"), regs = Object.entries(ix).filter(([, v]) => (v.formats?.length ? v.formats : [v.kind ?? "slide"]).includes(kind));
    const xs = (await Promise.all(regs.map(async ([lid, v]) => {
        const r = await http("GET", `${HUB}/api/layouts/${lid}?mood=qi&no=1&of=6&tokens=1`).catch(() => null);
        if (r?.status !== 200)
            return null;
        const vars = ["", ...new Set([...r.body.matchAll(/\.slide\[data-variant="([a-z0-9-]+)"\]/g)].map(m => m[1]))];
        return S2.slotLayout(lid, v.roles ?? [], vars, r.body);
    }))).filter((x) => !!x && (x.leaves.length > 0 || !!x.free?.length));
    if (xs.length >= 4)
        slotMenus.set(kind, { at: Date.now(), layouts: xs });
    report("turn", "slots.menu", `kind=${kind} layouts=${xs.length}`);
    return xs;
}
// 지켜보기 시작(첫 턴) — 400ms마다 이 PC 폴더만 · 턴 끝(slotsFlush) 또는 15분에 멈춤
export function startSlots(id, o) {
    const st = { ...o, t0: Date.now(), seen: new Map(), n: 0 };
    st.timer = setInterval(() => { void slotsBuild(id).catch(() => { }); }, 400);
    setTimeout(() => { if (slotsTurn.get(id) === st)
        void slotsFlush(id); }, 15 * 60_000);
    slotsTurn.set(id, st);
    report("turn", "slots.start", `kind=${o.kind} pages=${o.pages}`);
}
export async function slotsBuild(id) {
    const st = slotsTurn.get(id);
    if (!st || st.busy)
        return;
    st.busy = true;
    try {
        const S2 = await import("./slots.js"), known = new Set((slotMenus.get(st.kind)?.layouts ?? []).map(l => l.id));
        // 한 장 고치기(#275 보정 2 ③) — 그 장 JSON만. 같은 레이아웃이면 바뀐 칸 글만 지금 장 HTML에(캔버스에서 손댄 것·조절 블록이 그대로), 레이아웃이 바뀌면 그 장만 새로 조립
        if (st.patch) {
            const P = st.patch, t = await wget(id, S2.slotFile(P.nn)).catch(() => null);
            if (!t || t === P.prev)
                return;
            const pg = S2.parseSlotPage(t, known), old = S2.parseSlotPage(P.prev, known);
            if (!pg)
                return;
            const cur = (await wget(id, P.file).catch(() => null)) ?? "", FC = await import("./fill-core.js");
            let html = null;
            if (old && old.layout === pg.layout && (old.variant ?? "") === (pg.variant ?? "") && cur) {
                const ch = Object.keys(pg.slots).filter(k => pg.slots[k] !== old.slots[k]);
                html = FC.applyFill(cur, FC.leaves(cur).filter(l => ch.includes(l.key)), pg.slots);
            }
            else {
                const no = cur.match(/data-slot\s*=\s*["']page_no["'][^>]*>\s*(\d+)\s*\/\s*(\d+)/);
                const r = await http("GET", `${HUB}/api/layouts/${pg.layout}?mood=qi&no=${no?.[1] ?? Number(P.nn)}&of=${no?.[2] ?? 6}&tokens=1${pg.variant ? `&variant=${encodeURIComponent(pg.variant)}` : ""}`).catch(() => null);
                const tok = (await readJson(id, PALETTE_FILE).catch(() => null))?.tokens ?? null;
                if (r?.status === 200) {
                    html = S2.assemble(r.body, pg, { tokens: tok, format: st.fmt, cover: P.nn === "01", raw: st.raw });
                    const sm = (await readJson(id, ".dynapse/sample-text.json").catch(() => null)) ?? {};
                    sm[P.file] = S2.sampleTexts(r.body);
                    await wput(id, ".dynapse/sample-text.json", JSON.stringify(sm)).catch(() => { });
                }
            }
            if (html && html !== cur) {
                await wput(id, P.file, html);
                st.n++;
                if (st.first === undefined) {
                    st.first = Date.now() - st.t0;
                    report("turn", "slots.page_edit", `ms=${st.first} relayout=${old?.layout !== pg.layout ? 1 : 0}`);
                }
            }
            P.prev = t;
            return;
        }
        // 번호로 바로 읽는다(이 PC 파일만 · 줄이 03을 02보다 먼저 쓸 수 있어 장 수 + 2까지)
        const upto = Math.max(st.pages || 8, st.seen.size) + 2, js = [], body = new Map();
        for (let k = 1; k <= Math.min(upto, 30); k++) {
            const f = S2.slotFile(String(k).padStart(2, "0")), t = await wget(id, f).catch(() => null);
            if (t) {
                js.push(f);
                body.set(f, t);
            }
        }
        const tok = (await readJson(id, PALETTE_FILE).catch(() => null))?.tokens ?? (await wget(id, "tokens.css").catch(() => null))?.trim() ?? null;
        let wrote = false;
        for (const f of js) {
            const t = body.get(f) ?? null;
            if (!t || st.seen.get(f) === t)
                continue;
            const pg = S2.parseSlotPage(t, known);
            if (!pg)
                continue;
            st.seen.set(f, t);
            // 관계 밖 레이아웃(C3 #1)은 막지 않고 센다 — 관계 칸이 레이아웃 이름으로 오는지(C3 1회차 원인)도 같이 본다
            {
                const nn0 = f.match(S2.SLOT_FILE)?.[1] ?? "", pos = { first: nn0 === "01", last: js.length > 1 && f === js[js.length - 1] };
                if (!pg.relation)
                    report("turn", "slots.relation_none", `layout=${pg.layout}`);
                else if (!S2.relationOk(pg.relation, pg.layout, pos))
                    report("turn", "slots.relation_miss", `relation=${pg.relation} layout=${pg.layout} page=${nn0}`);
            }
            const nn = f.match(S2.SLOT_FILE)[1], of = Math.max(js.length, 2), r = await http("GET", `${HUB}/api/layouts/${pg.layout}?mood=qi&no=${Number(nn)}&of=${of}&tokens=1${pg.variant ? `&variant=${encodeURIComponent(pg.variant)}` : ""}`).catch(() => null);
            if (r?.status !== 200)
                continue;
            {
                const sf = S2.statLabelFix(pg, st.raw);
                if (sf.fixed)
                    report("turn", "slots.stat_label_fix", sf.fixed);
                const vb = S2.verbatimFix(pg, st.raw);
                if (vb.fixed.length || vb.over.length)
                    report("turn", "slots.verbatim_fix", `fixed=${vb.fixed.join(",")}${vb.over.length ? ` over=${vb.over.join(",")}` : ""}`);
                const cn = S2.conditionNear(pg, st.raw);
                if (cn.moved.length)
                    report("turn", "slots.condition_near", cn.moved.join(" | ").slice(0, 200));
                if (S2.leadRow(pg).lead)
                    report("turn", "slots.lead_row", pg.layout);
                const cl = S2.collapseItems(r.body, pg).collapsed;
                if (cl.length)
                    report("turn", "slots.collapse", cl.map(x => `${x.slot}:${x.n}→${x.k}`).join(","));
            }
            await wput(id, S2.pageFile(nn), S2.assemble(r.body, pg, { tokens: tok, format: st.fmt, cover: nn === "01", raw: st.raw, first: true }));
            wrote = true;
            st.n++;
            {
                const sm = (await readJson(id, ".dynapse/sample-text.json").catch(() => null)) ?? {};
                sm[S2.pageFile(nn)] = S2.sampleTexts(r.body);
                await wput(id, ".dynapse/sample-text.json", JSON.stringify(sm)).catch(() => { });
            }
            if (st.first === undefined) {
                st.first = Date.now() - st.t0;
                report("turn", "slots.first_page", `ms=${st.first} layout=${pg.layout}`);
            }
        }
        if (wrote) {
            const order = js.filter(f => st.seen.has(f)).map(f => S2.pageFile(f.match(S2.SLOT_FILE)[1]));
            await wput(id, ".dynapse/pages.json", JSON.stringify(order)).catch(() => { });
        }
    }
    finally {
        st.busy = false;
    }
}
// 턴 끝(검사 전) — 남은 파일 조립 · 지켜보기 멈춤 · 시간 한 줄
const slotsDone = new Map(); // 이 턴에 칸 글로 지은 덱(칸만 고치기가 다시 조립할 때)
let slotsLast = null; // 마지막 flush의 수치(턴 수치가 가져간다)
export async function slotsFlush(id) {
    const st = slotsTurn.get(id);
    if (!st)
        return false;
    if (st.lanes?.length)
        await Promise.race([Promise.all(st.lanes), new Promise(r => setTimeout(r, 90_000))]); // 나눠 쓰는 줄(#275 보정 2 ①)이 끝날 때까지(상한 90초) — 늦게 온 장도 이번 턴에
    clearInterval(st.timer);
    for (let k = 0; k < 20 && st.busy; k++)
        await new Promise(r => setTimeout(r, 100));
    await slotsBuild(id).catch(() => { });
    slotsTurn.delete(id);
    slotsDone.set(id, st);
    report("turn", "slots.done", `pages=${st.n} first_ms=${st.first ?? -1} total_ms=${Date.now() - st.t0}`);
    slotsLast = { mode: st.patch ? "page" : "deck", pages: st.n, first_ms: st.first ?? null, total_ms: Date.now() - st.t0, lanes: (st.lanes?.length ?? 0) + 1 };
    return st.n > 0;
}
// 칸만 고치기(#275 ⑥ — 넘침이 장 HTML 고침 턴으로 갔다): 검사 오류 중 칸이 정해진 글자 문제만 모아 같은 회사 AI에 한 번(도구 없음 · JSON 하나) "이 칸을 N자 안으로" →
// 칸 글 파일만 고치고 그 장들만 다시 조립. 상한 = 지금 글자의 65%(넘친 만큼을 정확히 모른다 · 한 번만)
export async function slotFix(id, errors, ai) {
    const done = slotsDone.get(id);
    if (!done)
        return [];
    const FIT = /^(overflow|overflow_x|clipped|spill|text_budget|line_length|mobile_text|overlap_box)$/, items = [];
    for (const e of errors) {
        const nn = e.page?.match(/^result-(\d{2})\.html$/)?.[1];
        if (!nn || !e.slot || !FIT.test(e.rule) || items.some(x => x.nn === nn && x.key.split("#")[0] === e.slot))
            continue;
        const j = (() => { try {
            return JSON.parse(done.seen.get(`.dynapse/slot-${nn}.json`) ?? "");
        }
        catch {
            return null;
        } })();
        if (!j?.slots)
            continue;
        const key = Object.keys(j.slots).find(k => k === e.slot || k.startsWith(`${e.slot}#`));
        if (!key || !j.slots[key])
            continue;
        items.push({ nn, key, now: j.slots[key], max: Math.max(2, Math.floor([...j.slots[key]].length * 0.65)), j });
    }
    if (!items.length)
        return [];
    const prompt = `Shorten each text so it fits its box: at most "max" characters, same meaning and language, keep numbers and names, plain text without line breaks. Answer one JSON object with the same ids: {"<id>": "<new text>"}.\n${JSON.stringify(Object.fromEntries(items.map(x => [`${x.nn}/${x.key}`, { text: x.now, max: x.max }])))}`;
    const r = await auxRun(id, prompt, ai).catch(() => null);
    if (!r) {
        report("turn", "slots.fix_fail", `n=${items.length}`);
        return [];
    }
    const pages = new Set();
    for (const x of items) {
        const v = r.json[`${x.nn}/${x.key}`];
        if (typeof v !== "string" || !v.trim() || [...v].length > x.max + 2)
            continue;
        x.j.slots[x.key] = v.trim();
        await wput(id, `.dynapse/slot-${x.nn}.json`, JSON.stringify(x.j)).catch(() => { });
        pages.add(`result-${x.nn}.html`);
    }
    if (pages.size) {
        slotsTurn.set(id, { ...done, t0: Date.now(), seen: new Map([...done.seen].filter(([f]) => !pages.has(`result-${f.match(/(\d{2})\.json$/)?.[1]}.html`))), n: 0, timer: undefined, lanes: undefined, first: undefined });
        await slotsBuild(id).catch(() => { });
        const st = slotsTurn.get(id);
        slotsTurn.delete(id);
        if (st)
            slotsDone.set(id, st);
    }
    report("turn", "slots.fix", `asked=${items.length} fixed=${pages.size} ms=${r.ms} ai=${r.ai}`);
    return [...pages];
}
// 잠금 = 지금 첫 장의 토큰 블록(#273 ② — 사용자가 고르거나 되돌린 판). tokens.css도 같은 글로
async function syncPaletteLock(id) {
    const first = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(n => PAGE_RE.test(n)).sort()[0];
    if (!first)
        return;
    const tok = ((await wget(id, first).catch(() => null)) ?? "").match(/<style\b[^>]*\bdata-tokens\b[^>]*>([\s\S]*?)<\/style\s*>/i)?.[1]?.trim();
    if (!tok)
        return;
    const lock = await readJson(id, PALETTE_FILE).catch(() => null), pid = tok.match(/--color-semantic-accent-base\s*:\s*(#[0-9a-f]{6})/i)?.[1] ?? "";
    await wput(id, "tokens.css", `${tok}\n`).catch(() => { });
    await wput(id, PALETTE_FILE, JSON.stringify({ id: lock?.id ?? null, accent: pid, tokens: tok, from: "user", at: Date.now() })).catch(() => { });
}
// 보존 하한(#293 보정 7)의 잣대 — 사진(img·배경 그림 url) 수와 보이는 글 길이(태그·스타일·스크립트 뺀 글자 수)
export const keepMeasure = (h) => ({ photos: (h.match(/<img\b/gi) ?? []).length + (h.match(/background(?:-image)?\s*:[^;"']*url\(/gi) ?? []).length,
    text: h.replace(/<style\b[\s\S]*?<\/style\s*>|<script\b[\s\S]*?<\/script\s*>|<!--[\s\S]*?-->/gi, "").replace(/<[^>]+>/g, "").replace(/\s+/g, "").length });
export async function colorPass(id, o = {}) {
    const C = await import("./colors.js"), TOK = /<style\b[^>]*\bdata-tokens\b[^>]*>[\s\S]*?<\/style\s*>/i, out = { n: 0, mood: 0, restored: 0, flat: 0, repaint: null };
    let lock = await readJson(id, PALETTE_FILE).catch(() => null);
    const plan = await readJson(id, ".dynapse/plan.json").catch(() => null);
    // 잠금이 없는 덱도 잠근다(#274 보정 2 — 대표 리워드 덱이 wa 기본 미색+버건디로 나왔다: 리워드는 잠금·갈아입히기에서 빠져 있었다).
    // 리워드 = Task 스타일(팔레트 id · qi · wa — 허브 tokens.css가 같은 함수), AI 기본색이면 샘플러 · 시리즈 회차·폴더 디자인 = 지금 tokens.css(첫 덱 것) 그대로. 브랜드 장은 아래에서 건너뛴다
    if (!lock?.tokens) {
        const series = !!(await readJson(id, ".dynapse/series.json").catch(() => null)), task = o.reward ? (rewardWorks.get(id) ?? null) : null;
        let tk = null, pid = null, from = "";
        if (task && /^task_/.test(task)) {
            const t = await mcp("get_task", { task_id: task }).catch(() => null), st = t?.data?.spec?.style ?? "";
            if (/^[a-z0-9-]{2,40}$/.test(st)) {
                const r = await http("GET", `${HUB}/api/layouts/tokens.css?mood=${encodeURIComponent(st)}`).catch(() => null);
                if (r?.status === 200 && /--color-semantic-/.test(r.body)) {
                    tk = r.body.trim();
                    pid = st;
                    from = "reward";
                }
            }
        }
        else if (series) {
            const cur = (await wget(id, "tokens.css").catch(() => null))?.trim();
            if (cur && /--color-semantic-/.test(cur)) {
                tk = cur;
                from = "series";
            }
        }
        if (tk && C.aiDefault(tk)) {
            const r = await api("GET", `/api/palettes/pick?work=${encodeURIComponent(id)}`).catch(() => null), np = r?.data?.id && /^[a-z0-9-]{2,40}$/.test(r.data.id) ? r.data.id : null;
            const t2 = np ? await http("GET", `${HUB}/api/layouts/tokens.css?mood=${encodeURIComponent(np)}`).catch(() => null) : null;
            if (np && t2?.status === 200 && /--color-semantic-/.test(t2.body)) {
                report("turn", "color.ai_default_repaint", `${from} ${pid ?? "-"} → ${np}`);
                tk = t2.body.trim();
                pid = np;
            }
        }
        if (tk) {
            lock = { id: pid ?? undefined, tokens: C.lockSelectors(tk), from: from || "starter", at: Date.now() };
            await wput(id, PALETTE_FILE, JSON.stringify(lock)).catch(() => { });
            report("turn", "color.lock", `${lock.from} ${pid ?? "-"}`);
        }
    }
    let tok = lock?.tokens?.trim() || null;
    const ask = COLOR_ASK.test(o.ask ?? "");
    if (tok && ask) {
        const cur = (await wget(id, "tokens.css").catch(() => null))?.trim();
        if (cur && cur !== tok && /--color-semantic-/.test(cur)) {
            tok = cur;
            await wput(id, PALETTE_FILE, JSON.stringify({ ...lock, tokens: cur, from: "ask", at: Date.now() })).catch(() => { });
        }
    }
    const names = (await T().core.invoke("work_files", { id }).catch(() => [])).filter(f => f.size > 0).map(f => f.name).filter(n => PAGE_RE.test(n) || LANG_PAGE.test(n));
    // AI 기본색이면 갈아입힌다(#274 ②) — 사용자가 색을 말한 턴·말로 고른 색·폴더 디자인·시리즈 회차·리워드·브랜드 장은 하지 않는다. 잠금이 있으면 그 팔레트, 없으면 허브의 분산 샘플러
    // 첫 턴에만(#293 보정 7 — D2 기준 측정: "계좌 펼쳐 놔"·"인사말 짧게"에 청첩장 전체 색이 바뀌었다. 고치기 턴은 사용자의 판이다)
    if (o.first && !ask && !o.reward && !o.only && !["ask", "folder", "user", "series", "reward", "mood"].includes(lock?.from ?? "") && !(await readJson(id, ".dynapse/series.json").catch(() => null))) {
        const cur = tok ?? (await readTokens(id).catch(() => null))?.trim() ?? null, why = cur ? C.aiDefault(cur) : null;
        const first = names.find(n => PAGE_RE.test(n)), fh = first ? (await wget(id, first).catch(() => null)) ?? "" : "";
        if (why && !/<style\b[^>]*\bdata-brand\b/i.test(fh)) {
            let pid = lock?.from === "starter" && lock.id && !C.aiDefault(lock.tokens ?? "") ? lock.id : null;
            if (!pid) {
                const r = await api("GET", `/api/palettes/pick?work=${encodeURIComponent(id)}`).catch(() => null);
                pid = r?.data?.id && /^[a-z0-9-]{2,40}$/.test(r.data.id) ? r.data.id : null;
            }
            const r = pid ? await http("GET", `${HUB}/api/layouts/tokens.css?mood=${encodeURIComponent(pid)}${/\bdata-format\s*=\s*["']mobile["']/i.test(fh) ? "&format=mobile" : ""}`).catch(() => null) : null;
            if (pid && r?.status === 200 && /--color-semantic-/.test(r.body) && !C.aiDefault(r.body)) {
                tok = C.lockSelectors(r.body.trim());
                out.repaint = pid;
                await wput(id, PALETTE_FILE, JSON.stringify({ id: pid, tokens: tok, from: "ai_default", was: why, at: Date.now() })).catch(() => { });
                report("turn", "color.ai_default_repaint", `${why} → ${pid}`);
            }
        }
    }
    const sample = [];
    for (const f of names.filter(n => !o.only || o.only.includes(n) || out.repaint)) {
        const h = await wget(id, f).catch(() => null);
        if (!h || /<style\b[^>]*\bdata-brand\b/i.test(h))
            continue;
        let x = h;
        if (tok && x.match(TOK)?.[0].replace(/^<style\b[^>]*>|<\/style\s*>$/gi, "").trim() !== tok) {
            const blk = `<style data-tokens>\n${tok}\n</style>`;
            x = TOK.test(x) ? x.replace(TOK, () => blk) : /<\/head>/i.test(x) ? x.replace(/<\/head>/i, () => `${blk}\n</head>`) : blk + x;
            out.restored++;
        }
        const r = C.fixRawColors(x, { stripMood: !!tok, allow: Object.values(plan?.deck?.notice_colors ?? {}) });
        out.n += r.n;
        out.mood += r.mood;
        out.flat += r.flat;
        sample.push(...r.sample);
        if (r.html !== h)
            await wput(id, f, r.html).catch(() => { });
    }
    if (tok && ((await wget(id, "tokens.css").catch(() => null)) ?? "").trim() !== tok)
        await wput(id, "tokens.css", `${tok}\n`).catch(() => { });
    if (out.n || out.restored || out.flat)
        report("turn", "color.fixed", `raw=${out.n} mood=${out.mood} restored=${out.restored} flat=${out.flat} lock=${lock?.from ?? "-"} ${sample.slice(0, 4).join(" ")}`);
    return out;
}
// 청첩장 브랜드 줄 지우기(#248 ② — 접는 청첩장 뒷면 "saemal wedding"): fold·mobile 리워드는 example.brand를 찍지 않는다. 그 글자가 든 가장 안쪽 요소를 지운다(AI 0). 서버 L0도 같은 규칙으로 반려
export async function dropBrand(id, taskId) {
    const t = await mcp("get_task", { task_id: taskId }).catch(() => null);
    const g = t?.data?.spec?.deck_goal, brand = String(t?.data?.spec?.example?.brand ?? "").trim();
    if ((g !== "fold" && g !== "mobile") || brand.length < 3)
        return 0;
    const esc = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"), leaf = new RegExp(`<([a-z][a-z0-9]*)\\b[^>]*>[^<]*${esc}[^<]*<\\/\\1\\s*>`, "gi");
    let n = 0;
    for (const f of (await T().core.invoke("work_files", { id }).catch(() => [])).filter(x => x.size > 0).map(x => x.name).filter(x => PAGE_RE.test(x))) {
        const h = await wget(id, f).catch(() => null);
        if (!h)
            continue;
        const out = h.replace(leaf, () => { n++; return ""; });
        if (out !== h)
            await wput(id, f, out);
    }
    if (n)
        report("export", "reward.brand_dropped", `n=${n}`);
    return n;
}
// 제출은 작업마다 한 번에 하나(#177 — 18차 이후 Gemini가 연결된 PC: 첫 제출이 남긴 자동 재제출(pendingSubmit)이 다른 턴 끝에 사람이 누른 제출과 겹쳐 돌았다.
// 뒤에 온 쪽이 my_status로 앞 쪽의 Claim을 놓고, 앞 쪽은 놓인 nonce로 submit_work → "놓은 Claim" 반려). 들어올 때 남은 자동 재제출은 지운다(지금 제출이 그것을 대신한다)
const submitting = new Set();
// 제출 전 사진 묶기(2026-10-20 대표 작업 — 사진 둘이 장보다 먼저 와서 칸에 못 들어갔고, 서버가 빈 칸으로 두 번 반려). 이미 만든 사진(materials/<장>-<칸>-vN · slots.json)이
// 그 칸에 없으면 넣는다. AI 0 · 사진을 다시 만들지 않는다
export async function bindStray(id) {
    const P = await import("./photo-runner.js");
    const files = (await T().core.invoke("work_files", { id }).catch(() => [])).filter(f => f.size > 0).map(f => f.name), have = new Set(files);
    const best = new Map();
    for (const f of files) {
        const m = f.match(/^materials\/([a-z0-9-]+)-([a-z0-9_]{1,40})-v(\d{1,3})\.(png|jpe?g|webp)$/i);
        if (!m)
            continue;
        const k = `${m[1]}|${m[2]}`, v = Number(m[3]);
        if ((best.get(k)?.v ?? -1) < v)
            best.set(k, { file: f, v });
    }
    for (const [k, file] of Object.entries(await P.readSlots(id).catch(() => ({})))) {
        const dot = k.indexOf(".");
        if (dot > 0 && have.has(file))
            best.set(`${k.slice(0, dot)}|${k.slice(dot + 1)}`, { file, v: 1e9 });
    } // 고른 버전이 먼저
    const kids = ((await readJson(id, ".dynapse/TRACE.json").catch(() => null))?.children ?? []);
    let n = 0;
    for (const [k, { file }] of best) {
        const [pk, slot] = k.split("|"), page = `result-${pk}.html`;
        if (!have.has(page))
            continue;
        const h = await wget(id, page);
        if (!h || P.slotSrc(h, slot) || !new RegExp(`data-slot\\s*=\\s*["']${slot}["']`).test(h))
            continue;
        const rt = kids.find(c => c.page === page && c.slot === slot)?.runtime ?? "codex";
        if ((await P.placePhoto(id, page, slot, file, { runtime: rt }).catch(() => [])).length)
            n++;
    }
    if (n)
        report("export", "reward.photo_bind", `n=${n}`);
    return n;
}
// 빈 사진 칸은 사람에게 넘기지 않는다(같은 날 — "채팅으로 채워 달라고"가 떴고 다시 시도는 놓은 Claim에 걸렸다): 그 칸들만 사진 러너로 한 번 만들고 묶은 뒤 다시 제출. 작업·과제마다 한 번
const photoTried = new Set();
const PHOTO_NAME = /^(card_full|card_image|cover_full|cover_image|body_image|closing_full|series_\d|photo|hero|image|flyer_photo|texture)/;
async function autoPhotos(id, taskId, want, say) {
    const k = `${id}|${taskId}|photo`;
    if (photoTried.has(k))
        return false;
    const uniq = [...new Map(want.filter(w => PAGE_RE.test(w.page) && /^[a-z0-9_]{1,40}$/i.test(w.slot)).map(w => [`${w.page}|${w.slot}`, w])).values()];
    if (!uniq.length)
        return false;
    photoTried.add(k);
    const briefs = (await readJson(id, ".dynapse/image-briefs.json").catch(() => null)) ?? {};
    const plan = (await readJson(id, ".dynapse/plan.json").catch(() => null)) ?? {};
    const reqs = [];
    for (const w of uniq) {
        const pp = (plan.pages ?? []).find(p => p.page === w.page), h = (await wget(id, w.page)) ?? "";
        const title = (h.match(/data-slot\s*=\s*["'](?:title|headline|card_title)[^"']*["'][^>]*>([\s\S]{1,200}?)<\//)?.[1] ?? pp?.title ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        const brief = briefs[`${w.page}|${w.slot}`]?.brief ?? (pp?.photo_slot === w.slot ? pp.photo : null) ?? `A real photo for the page "${title || pageKey(w.page)}"${plan.subject || plan.topic ? ` of "${plan.subject ?? plan.topic}"` : ""}: natural light, real materials, no text, no faces, no logos.`;
        const c45 = /data-format\s*=\s*["']card45/.test(h);
        reqs.push({ file: w.page, slot: w.slot, brief: String(brief).slice(0, 400), ratio: /^card_full/.test(w.slot) ? (c45 ? "3:4" : "1:1") : /^card_image|series_|texture/.test(w.slot) ? "16:9" : "4:3" });
    }
    await say(`사진 ${reqs.length}장 만드는 중 · 제출 전`);
    await wput(id, ".dynapse/photo-requests.json", JSON.stringify(reqs, null, 1));
    const P = await import("./photo-runner.js");
    await P.runPhotoRequests(id, undefined, { reward: true, cap: reqs.length }).catch(() => []);
    await bindStray(id).catch(() => 0);
    report("export", "reward.photo_autofill", `n=${reqs.length}`);
    return true;
}
// 빈 글자 칸(#211 보정 2 — "채팅으로 채워 달라고"를 지웠다): 선택 칸(캡션·메모·머리표·쪽 번호…)은 data-slot-empty로 숨기고, 필수 칸은 plan.json의 그 장 사실로 채운다.
// 그래도 남으면 그 장만 한 번 채우는 턴(제출은 턴 뒤 앱이 다시) · 그것도 안 되면 그 칸 이름 한 줄. 사람에게 시키는 문구 없음
const OPTIONAL_SLOT = /(^|_)(caption|cap|note|notes|kicker|meta|back_hint|label|source|src|credit|credits|eyebrow|tag|badge|footnote|hint|page_no|price_note)(_?\d*)$/;
const fillTried = new Set();
const escT = (t) => t.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
export function hideSlot(html, slot) { return html.replace(new RegExp(`(<[a-z][a-z0-9]*\\b[^>]*\\bdata-slot\\s*=\\s*["']${slot}["'])(?![^>]*data-slot-empty)`, "i"), "$1 data-slot-empty hidden"); }
export function fillSlot(html, slot, text) { return html.replace(new RegExp(`(<([a-z][a-z0-9]*)\\b[^>]*\\bdata-slot\\s*=\\s*["']${slot}["'][^>]*>)\\s*(</\\2>)`, "i"), (_m, open, _t, close) => `${open}${escT(text)}${close}`); }
export async function fixEmptyText(id, want) {
    const plan = (await readJson(id, ".dynapse/plan.json").catch(() => null)) ?? {};
    let hidden = 0, filled = 0;
    const left = [];
    for (const page of [...new Set(want.map(w => w.page))]) {
        const h0 = await wget(id, page);
        if (!h0) {
            left.push(...want.filter(w => w.page === page));
            continue;
        }
        let h = h0;
        const pp = (plan.pages ?? []).find(p => p.page === page), facts = [...(pp?.facts ?? pp?.lines ?? [])].filter(x => typeof x === "string" && x.trim());
        for (const w of want.filter(x => x.page === page)) {
            if (OPTIONAL_SLOT.test(w.slot)) {
                const n = hideSlot(h, w.slot);
                if (n !== h) {
                    h = n;
                    hidden++;
                    continue;
                }
            }
            const v = /title|headline/.test(w.slot) ? pp?.title : /(^|_)sub/.test(w.slot) ? pp?.sub ?? pp?.subtitle : facts.shift();
            const n = v ? fillSlot(h, w.slot, String(v).slice(0, 120)) : h;
            if (n !== h) {
                h = n;
                filled++;
            }
            else
                left.push(w);
        }
        await wput(id, page, h);
    }
    return { hidden, filled, left };
}
// 경고 묶음(#211 목록) — 이 규칙만 남으면 고침 턴·카드 없이 올린다
const SOFT_RULE = /^(underfill|variety|system|rhythm|size|viz_small|style_leak|glyph_contrast|contrast|overflow|overflow_x|plan_frame|plan_borrow|density|text_budget|line_length|widow|font|small_icon|info_small|mobile_text|huge_text|copy_ai|copy_tone|copy_template|copy_uniform|copy_symmetry|copy_metrics|copy_metaphor|copy_antithesis|copy_gongmun|copy_classifier|copy_cause|copy_symbol|copy_hanja|copy_predicate)$/;
// 계약 오류 자동 고침 표(#211 보정 4 — X배너 리워드가 EX5 카드에서 멈췄고 대표가 [제출]을 2~3번 눌렀다). 사다리 스위치와 무관하게 먼저 돈다.
// 장마다 <style data-autofix> 하나(다시 돌면 바꿔 쓴다): EX5 인쇄 판의 filter·backdrop-filter·mix-blend 끔 · PR5 6pt 미만 칸은 6pt로. 나머지(PR2·PR3·PR13 — 자리 옮기기)는 고침 턴 한 번이 맡는다
export async function contractAutofix(id, errors) {
    const byPage = new Map(), done = [];
    for (const e of errors) {
        if (!e.page || !PAGE_RE.test(e.page))
            continue;
        const rule = e.rule === "EX5" ? ".slide,.slide *{filter:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;mix-blend-mode:normal!important}"
            : e.rule === "PR5" && e.slot && /^[a-z0-9_]{1,40}$/i.test(e.slot) ? `[data-slot="${e.slot}"]{font-size:calc(6.2pt * var(--print-scale,1))!important}` : null;
        if (!rule)
            continue;
        if (!byPage.has(e.page))
            byPage.set(e.page, new Set());
        byPage.get(e.page).add(rule);
        done.push(e.rule);
    }
    for (const [page, rules] of byPage) {
        const h = await wget(id, page);
        if (!h)
            continue;
        const prev = h.match(/<style data-autofix>([\s\S]*?)<\/style>/)?.[1] ?? "", all = [...new Set([...prev.split("\n").filter(Boolean), ...rules])].join("\n");
        const blk = `<style data-autofix>${all}</style>`;
        const out = /<style data-autofix>[\s\S]*?<\/style>/.test(h) ? h.replace(/<style data-autofix>[\s\S]*?<\/style>/, blk) : /<\/head>/i.test(h) ? h.replace(/<\/head>/i, `${blk}\n</head>`) : blk + h;
        if (out !== h)
            await wput(id, page, out);
    }
    return [...new Set(done)];
}
// 사진 장 상한(#211 보정 3 — 바다마을 덱이 사진 넷을 다 묶은 뒤 "사진이 든 장이 4장"에서 멈췄다. 6장 사진은 표지 사진의 재사용): 제출 전에 앱이 줄인다.
// 같은 사진을 다시 쓴 장부터, 그다음 마지막 사진 장부터(첫 장은 그대로) 그 칸을 data-slot-empty로 숨긴다. 상한은 서버·verify와 같은 장 수 표(3·4·6·8)
export async function trimPhotoPages(id, pages) {
    const P = await import("./photo-runner.js");
    const np = pages.length, cap = np <= 4 ? 3 : np <= 8 ? 4 : np <= 12 ? 6 : 8;
    const info = [];
    for (const pg of pages) {
        const h = await wget(id, pg);
        if (!h)
            continue;
        const slots = [...new Set([...h.matchAll(/<[a-z][a-z0-9]*\b[^>]*\bdata-slot\s*=\s*["']([a-z0-9_]+)["'][^>]*>/gi)].filter(m => !/data-slot-empty/.test(m[0])).map(m => m[1]))].map(sl => ({ slot: sl, src: P.slotSrc(h, sl) })).filter(x => !!x.src);
        if (slots.length)
            info.push({ page: pg, html: h, slots });
    }
    if (info.length <= cap)
        return [];
    const seen = new Set(), dup = [];
    for (const x of info) {
        if (x.slots.every(z => seen.has(z.src)))
            dup.push(x);
        x.slots.forEach(z => seen.add(z.src));
    }
    const cut = [...dup, ...[...info].reverse().filter(x => !dup.includes(x))].filter(x => x.page !== pages[0]).slice(0, info.length - cap);
    for (const x of cut) {
        let h = x.html;
        for (const z of x.slots)
            h = hideSlot(h, z.slot);
        await wput(id, x.page, h);
    }
    if (cut.length)
        report("export", "reward.photo_trim", `n=${info.length} cap=${cap} cut=${cut.length}`);
    return cut.map(x => x.page);
}
// 서버 L0 사유에서 비어 있는 사진 칸(사진 칸 이름이 "빈 글자 칸"으로 와도 — 옛 서버) → 그 칸이 있는 장
export async function emptyPhotoSlots(id, pages, why) {
    const names = [...new Set(why.flatMap(w => [...w.matchAll(/빈 (?:글자|사진) 칸:\s*([^—/·]+)/g)].flatMap(m => m[1].split(",").map(x => x.trim()))).filter(x => PHOTO_NAME.test(x)))];
    const out = [];
    const P = await import("./photo-runner.js");
    for (const slot of names)
        for (const page of pages) {
            const h = await wget(id, page);
            if (h && new RegExp(`data-slot\\s*=\\s*["']${slot}["']`).test(h) && !P.slotSrc(h, slot))
                out.push({ page, slot });
        }
    if (why.some(w => /사진이 없다\(필수\)/.test(w)) && pages[0] && !out.some(o => o.page === pages[0])) {
        const h = (await wget(id, pages[0])) ?? "";
        const sl = [...h.matchAll(/data-slot\s*=\s*["']([a-z0-9_]+)["']/g)].map(m => m[1]).find(x => PHOTO_NAME.test(x));
        if (sl && !P.slotSrc(h, sl))
            out.push({ page: pages[0], slot: sl });
    }
    return out;
}
// 빈 글자 칸 한 단계(#211 보정 2) — again = 고쳤으니 다시 제출 · turn = 그 장만 채우는 턴을 보냈다(턴 뒤 앱이 다시 제출) · stop = 그래도 남아 한 줄 · ok = 할 일 없음
async function emptyTextStep(id, taskId, replaces, want, say) {
    const r = await fixEmptyText(id, want);
    if (r.hidden || r.filled)
        report("export", "reward.text_fix", `hidden=${r.hidden} filled=${r.filled} left=${r.left.length}`);
    if (!r.left.length)
        return r.hidden || r.filled ? "again" : "ok";
    const k = `${id}|${taskId}|text`, pages = [...new Set(r.left.map(x => x.page))];
    if (!fillTried.has(k)) {
        fillTried.add(k);
        pendingSubmit.set(id, { taskId, ...(replaces ? { replaces } : {}) });
        await say(`빈 칸 채우는 중 · ${pages.map(pageKey).join(", ")}`);
        void chatSend(id, `[Fill before submit] Fill only these empty text slots with facts from .dynapse/plan.json and the brief (never invent numbers): ${r.left.map(x => `${x.page} ${x.slot}`).join(", ")}. Change nothing else on any page.`);
        return "turn";
    }
    await rejectedCard(id, taskId, { kind: "text_empty", line: `${pages.map(pageKey).join("·")} ${r.left.map(x => x.slot).slice(0, 3).join(", ")} 칸이 비어 올리지 못했어요` });
    return "stop";
}
// AI가 직접 올리다 Claim이 풀려 거절된 답(#224 ④) — 서버 사유 "놓은 Claim — 다시 claim_task"를 AI가 옮긴 말
export const CLAIM_LOST = /놓은 Claim|released claim|claim(?:_task)?[^\n]{0,40}(?:다시|again|re-?claim)|Claim이 (?:풀|놓)/i;
const claimRetried = new Set();
const submitStep = new Map(); // 제출 중 지금 단계(심장 박동 줄 #214 보정 4)
async function submitReward(id, taskId, replaces, force = false) {
    if (submitting.has(id)) {
        report("export", "reward.submit_overlap", null);
        return;
    }
    submitting.add(id);
    pendingSubmit.delete(id);
    // 심장 박동(#214 보정 4 — 제출 뒤 웹 카드가 "깨진 곳 없는지 보는 중 2/3 · 2:55"에 소식 없이 멈춰 보였다): 제출 중 10초 넘게 새 줄이 없으면 10초마다 지금 단계 + 경과 한 줄.
    // 간격 10초 · 멈춤 = 제출 끝(finally) · 제출 한 번에 많아야 수십 번(제출은 길어도 몇 분)
    const t0 = Date.now();
    submitStep.set(id, { label: "제출하는 중", at: t0 });
    const mm = (ms) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;
    const hb = setInterval(() => {
        const st = submitStep.get(id);
        if (!st || Date.now() - st.at < 10_000)
            return;
        st.at = Date.now();
        void postChat(id, [{ role: "event", text: /\d+\/\d+$/.test(st.label) ? st.label : `${st.label} · ${mm(Date.now() - t0)}`, payload: { kind: "stage", ai: "dynapse", hb: true, live: "submit" } }]).catch(() => { });
    }, 10_000); // live = 웹이 같은 줄을 바꿔 쓴다(#279 ①)
    try {
        await submitReward0(id, taskId, replaces, force);
    }
    finally {
        clearInterval(hb);
        submitStep.delete(id);
        submitting.delete(id);
        void postChat(id, [{ role: "event", text: null, payload: { kind: "submit-end", ai: "dynapse" } }]).catch(() => { });
    } // 웹 [제출] 버튼이 돌아오게(#211 보정 3 — 막혀 끝나도)
}
// 묶음 읽기(#281 — 2.3MB 묶음을 앱이 읽기 상한(2MB)으로 못 읽어 빈 글이 서버 검사로 갔다): 크거나 비면 사진 작은 판으로 묶음을 다시 만들고 한 번 더 ·
// 그래도면 {page, big} — 부른 쪽이 올리지 않고 한 줄. 시뮬레이터가 이 함수를 그대로 돈다(turn-sim bigBundle)
export async function bundleGate(id, pages) {
    const readB = (f) => T().core.invoke("work_read", { id, file: `.dynapse/out/${f.replace(/^result-|\.html$/g, "")}.bundle.html` }).then(h => ({ h: h ?? "", big: false }), e => ({ h: "", big: /너무 커요/.test(String(e)) }));
    let got = await Promise.all(pages.map(readB));
    if (got.some(g => g.big || !g.h.trim())) {
        await appVerify(id, undefined, { reward: true, noRender: true }).catch(() => null);
        got = await Promise.all(pages.map(readB));
    }
    const bad = got.findIndex(g => g.big || !g.h.trim());
    return bad >= 0 ? { page: pages[bad], big: got[bad].big } : got;
}
async function submitReward0(id, taskId, replaces, force = false) {
    {
        const { redrawCharts } = await import("./viz.js");
        await redrawCharts(id, "quiet").catch(() => 0);
    } // 제출 전 차트를 지금 판으로(#102 보정 3)
    const say = (text, kind = "stage") => { submitStep.set(id, { label: text.replace(/ · \d+장$/, ""), at: Date.now() }); return postChat(id, [{ role: "event", text, payload: { kind, ai: "dynapse", ...(kind === "stage" ? { live: "submit" } : {}) } }]); }; // 제출 단계 줄은 한 줄을 바꿔 쓴다(#279 ①)
    await say("제출하는 중 · 확인");
    // 사진이 오는 중이면 다 들어온 뒤에(2026-10-22 대표 "사진이 안 들어왔는데 그냥 공개?" — 사진 1/2가 도는 동안 [제출하기]로 빈 칸 그대로 올라가 공개됐다). 3초마다 · 최대 4분(80번), 그 뒤엔 지금 판으로
    for (let k = 0; k < 80; k++) {
        const left = ((await readJson(id, ".dynapse/photo-making.json").catch(() => null)) ?? []).length;
        if (!left)
            break;
        if (k === 0)
            await say(`사진 ${left}장이 오는 중 · 다 오면 제출해요`);
        await new Promise(r => setTimeout(r, 3000));
    }
    // 토큰 블록 없는 장은 Task 색으로 먼저 채운다(#239 ① — 막지 않고 고친다)
    {
        const n = await injectTokens(id, taskId).catch(() => 0);
        if (n)
            await say(`장 ${n}개에 색 토큰을 넣었어요`);
    }
    {
        const n = await fillQr(id).catch(() => 0);
        if (n)
            await say(`QR 칸 ${n}곳에 QR을 넣었어요 · 기본은 dynapse.ai, 대화로 주소를 바꿀 수 있어요`);
    }
    await fillSeal(id).catch(() => 0); // 인장 표지 — 제출하는 이름·날짜로
    {
        const n = await dropBrand(id, taskId).catch(() => 0);
        if (n)
            await say(`청첩장에 찍힌 예시 브랜드 이름 ${n}곳을 지웠어요`);
    }
    // 필요한 파일부터(#127 보정 6) — tokens.css가 없으면 장의 토큰으로 만든다(AI 0). 검사가 tokens.css와 장의 토큰 블록을 같이 본다
    if (await ensureTokens(id, !(await wget(id, "tokens.css").catch(() => null))) === "made")
        await say("tokens.css가 없어 장의 토큰으로 만들었어요"); // 못 읽으면(#161) 장 블록으로 다시 써서 올릴 파일 = 확인한 글
    {
        const cp = await colorPass(id, { reward: true }).catch(() => null);
        if (cp?.n || cp?.flat)
            await say(`토큰 밖 색 ${cp.n + cp.flat}곳을 덱 색으로 맞췄어요`);
    } // #274 ① — 제출 전에도
    await ensureVerify(id);
    await say(`제출 전 검사 중 · 장 ${((await readPages(id).catch(() => null)) ?? []).length}장`);
    {
        const fixed = await holdFormat(id).catch(() => []);
        if (fixed.length)
            await say(`판형을 ${FRAME_KO[(await readJson(id, FORMAT_FILE).catch(() => null))?.frame ?? ""] ?? "원래 판형"}로 되돌렸어요 · ${fixed.map(pageKey).slice(0, 6).join(", ")}`);
    } // 판형 고정(#212 보정 1)   // 첫 진행 줄은 10초 안에(#211 — "확인" 뒤 7분 넘게 조용했다)
    {
        const n = await bindStray(id).catch(() => 0);
        if (n)
            await say(`만들어 둔 사진 ${n}장을 칸에 넣었어요`);
    }
    {
        const order = ((await readPages(id).catch(() => null)) ?? []).filter(x => typeof x === "string" && PAGE_RE.test(x));
        const cut = order.length ? await trimPhotoPages(id, order).catch(() => []) : [];
        if (cut.length)
            await say(`사진 장이 많아 ${cut.map(f => { const k = f.replace(/^result-|\.html$/g, ""); return /^card-\d+$/.test(k) ? `${k.slice(5)}장` : pageLabel(f); }).join("·")} 사진을 뺐어요`);
    }
    // 제출 사다리 스위치(2026-10-20 대표 "처음 턴에서 한 번에 되게" — 빛결 작업: 첫 턴은 좋았고 문제는 전부 제출 확인 단계에서 생겼다: 7분 조용한 사다리 · 모양 바꿈 ·
    // AI 고침 턴 두 번이 카드를 다시 씀 · 앱이 만든 <style>을 스스로 반려). 기본 꺼짐 = 결정적 고침(tokens·겹침은 verify가) + 검사 한 번 → 계약 위반만 막고 올린다.
    // 모양 바꾸기·지정 형태 AI 턴·[Fix before submit] 턴·카드 없음. 켜기는 store reward_ladder = true(시험용)
    const ladderOn = (await store.get("reward_ladder").catch(() => null)) === true;
    // 지정 형태부터(#127 보정 7) — 서버 L0가 볼 장을 같은 표로 정하고 형태를 맞춘다. AI 장 턴이 필요하면 그 턴 뒤 다시 제출
    if (ladderOn && !force && await assignForms(id, taskId, replaces).catch(() => "ok") === "turn")
        return;
    // 리워드 규칙으로 먼저(#62 보정 1) — 빈 사진 칸이면 올리기 전에 반려 카드(사람 말 한 줄 + 채우기/빼기). 서버까지 갔다 오지 않는다
    let v = await appVerify(id, undefined, { reward: true });
    const emptyPh = v.errors.filter(e => e.rule === "photo" && /빈 사진 칸/.test(e.msg ?? ""));
    if (!v.ok && emptyPh.length && await autoPhotos(id, taskId, emptyPh.flatMap(e => ((e.msg ?? "").match(/빈 사진 칸:\s*([^—]+)/)?.[1] ?? "").split(",").map(x => x.trim()).filter(Boolean).map(slot => ({ page: e.page ?? "", slot }))), say))
        return submitReward0(id, taskId, replaces, force);
    {
        const emptyTx = v.errors.filter(e => e.rule === "data-slot" && /빈 글자 칸:/.test(e.msg ?? "") && e.page).flatMap(e => ((e.msg ?? "").match(/빈 글자 칸:\s*([^—]+)/)?.[1] ?? "").split(",").map(x => x.trim()).filter(Boolean).map(slot => ({ page: e.page, slot })));
        if (!force && emptyTx.length) {
            const r = await emptyTextStep(id, taskId, replaces, emptyTx, say);
            if (r === "again")
                return submitReward0(id, taskId, replaces, force);
            if (r === "turn" || r === "stop")
                return;
        }
    }
    if (!v.ok && emptyPh.length === v.errors.length) {
        await rejectedCard(id, taskId, { pages: emptyPh.map(e => e.page ?? ""), slots: emptyPh.reduce((n, e) => n + ((e.msg ?? "").match(/빈 사진 칸:\s*([^—]+)/)?.[1].split(",").filter(x => x.trim()).length ?? 0), 0) });
        return;
    }
    // 토큰 블록 없음(tokens_missing, #239 ①)은 막지 않고 고친다 — Task 색 블록을 넣고 tokens.css를 맞춘 뒤 검사 한 번 더
    if (!v.ok && v.errors.some(e => e.rule === "tokens_missing")) {
        const n = await injectTokens(id, taskId).catch(() => 0);
        await ensureTokens(id, true).catch(() => "none");
        report("export", "submit.autofix", `tokens_missing n=${n}`);
        v = await appVerify(id, undefined, { reward: true });
    }
    // 계약 오류 자동 고침 표(#211 보정 4) — 결정적으로 고칠 수 있는 것은 고치고 검사 한 번 더(사다리 스위치와 무관)
    if (!v.ok && !force) {
        const fixed = await contractAutofix(id, v.errors).catch(() => []);
        if (fixed.length) {
            for (const r of fixed)
                report("export", "submit.autofix", r);
            await say(fixed.includes("EX5") ? "인쇄 판의 흐림·겹침 효과를 빼고 다시 확인해요" : "인쇄 글자를 6pt로 키우고 다시 확인해요");
            v = await appVerify(id, undefined, { reward: true });
        }
    }
    // 채움 사다리(#127 보정 5 — 대표 8장 보고 덱 p05 44%에서 멈춤): ① 크기(verify 줄 맞춤, 이미 함) → ② 이미 지은 다른 모양 중 가장 채운 것(AI 0) → ③ AI 장 턴 한 번(아래 고치기)
    // → ④ 그래도 남으면 [그래도 제출]·[더 고치기] 카드. 직접 고친 장(#143 §2)은 건드리지 않는다. 장마다 한 줄("05 · 44% → 모양 바꿈(순환) → 71% ✓")
    const fk = `${id}|${taskId}`;
    if (ladderOn && !force && !ladderTried.has(fk)) {
        const uf = [...new Set([...v.errors, ...v.warnings].filter(e => e.rule === "underfill" && e.page && e.page !== "*").map(e => e.page))]; // 리워드에서 채움은 경고(#211 보정 1) — 그래도 AI 0 사다리는 돈다
        if (uf.length) {
            ladderTried.add(fk);
            const hand = new Set(((await readJson(id, HAND_PAGES).catch(() => null)) ?? []).filter(x => typeof x === "string"));
            const assigned = new Set(Object.keys((await readJson(id, ".dynapse/reward-forms.json").catch(() => null)) ?? {}));
            const pct = (vv, f) => { const e = [...vv.errors, ...vv.warnings].find(x => x.page === f && x.rule === "underfill"); if (!e)
                return vv.fills?.[f] ?? 100; return Number((e.msg ?? "").match(/장의 (\d+)%/)?.[1] ?? 0); };
            const { fillLadder, FORM_KO } = await import("./form-alts.js");
            for (const f of uf.slice(0, 6)) {
                const lab = f.replace(/^result-|\.html$/g, ""), b0 = pct(v, f);
                if (hand.has(f)) {
                    await say(`${lab} · ${b0}% · 직접 고친 장이라 그대로 둬요`);
                    continue;
                }
                if (assigned.has(f)) {
                    await say(`${lab} · ${b0}% · 지정된 모양이라 모양은 그대로 두고 AI가 채워요`);
                    continue;
                } // 지정 형태(spec.forms) 장은 사다리가 모양을 바꾸지 않는다(#166 ② — pull-quote·numbered-rows가 cover-photo-line 1600×900으로 바뀌어 올라갔다)
                let passed = false;
                const r = await fillLadder(id, f, async () => { const x = await appVerify(id, [f], { reward: true }); passed = ![...x.errors, ...x.warnings].some(e => e.page === f && e.rule === "underfill"); return pct(x, f); }).catch(() => null);
                await say(r?.form ? `${lab} · ${b0}% → 모양 바꿈(${FORM_KO[r.form] ?? r.form}) → ${r.after}%${passed || (r.after ?? 0) >= 55 ? " ✓" : ""}` : `${lab} · ${b0}% → 더 채운 모양이 없어요 · AI가 이 장만 채워요`);
            }
            v = await appVerify(id, undefined, { reward: true });
        }
    }
    // 막는 오류는 한 번에 전부(#211 보정 1 — "1/2·2/2"로 나눠 같은 카드를 세 번 봤다): 리워드 verify는 계약 위반 8개만 오류로 낸다. 남은 막는 오류를 모든 장 한 목록으로
    // 고침 턴 한 번(그 턴만 verify 4회) → 다시 검사해 남으면 그 장만 자동으로 한 번 더 → 그래도 남을 때만 아래 카드. 경고는 고침 턴을 부르지 않는다
    const tried = fixRound.get(fk) ?? 0;
    if (!force && !v.ok && tried < (ladderOn ? 2 : 1) && v.errors.some(e => !SOFT_RULE.test(e.rule))) { // 표 밖 오류는 사다리 스위치와 무관하게 고침 턴 한 번(#211 보정 4) → 턴 뒤 앱이 다시 제출
        const n = tried + 1;
        fixRound.set(fk, n);
        pendingSubmit.set(id, { taskId, ...(replaces ? { replaces } : {}) });
        await wput(id, ".dynapse/verify-runs.json", JSON.stringify({ n: 0, at: Date.now(), runs: [], max: 4 })).catch(() => { });
        const pagesN = new Set(v.errors.map(e => e.page).filter(p => p && p !== "*")).size;
        await say(n === 1 ? `제출 전 막는 것 ${v.errors.length}개를 한 번에 고치는 중${pagesN ? ` · ${pagesN}장` : ""}` : `남은 ${v.errors.length}개 · 그 장만 한 번 더`);
        const list = v.errors.map(e => `- ${e.page && e.page !== "*" ? `${e.page}: ` : ""}${e.msg}`).join("\n").slice(0, 3500);
        const fmt = FRAME_PX[(await readJson(id, FORMAT_FILE).catch(() => null))?.frame ?? ""];
        const rr = [...sessions.entries()].find(([k, x]) => k.startsWith(`${id}|`) && x.route)?.[1].route; // 리워드 시작에서 고른 AI·모델 그대로(#306)
        void chatSend(id, `${fmt ? `[Deck format: ${fmt[2]} ${fmt[0]}×${fmt[1]}px — every page stays exactly this size.]\n` : ""}[Fix before submit${n === 2 ? " — last pass" : ""}] Fix every error below in this one turn — all pages, all at once (rewrite each named page once; no patch scripts). These are contract errors only; warnings are fixed by the app, leave them. Never fix an error by deleting what it checks (a link, button, photo or section) — repair it; for an external link use an allowed host. Run node .dynapse/verify.mjs --reward at most 4 times, then end the turn — the app submits by itself.\n${list}`, { route: rr });
        return;
    }
    if (!force && v.ok) {
        const demoted = v.warnings.filter(w => w.was === "error").length;
        if (demoted)
            softLeft.set(id, demoted);
    } // 남은 경고 수(#211) — 검수에서 볼 것
    // 경고 묶음만(#211 목록) — 채움·다양성·글자 단계·차트 글자·스타일 블록·대비·AI 팔레트·넘침·계획. 그 밖(서버 L0가 막는 구성·형태·사진 하한, 없는 장, 빈 사진 칸, 두부 글자, 견본 글, 목록 밖 사실)은 카드
    const SOFT = SOFT_RULE;
    const hardErr = v.errors.filter(e => !SOFT.test(e.rule) || (e.rule === "photo" && /빈 사진 칸/.test(e.msg ?? "")));
    if (!v.ok && !force && !hardErr.length) {
        softLeft.set(id, v.errors.length);
        report("turn", "reward.soft_submit", `n=${v.errors.length} rules=${[...new Set(v.errors.map(e => e.rule))].slice(0, 6).join(",")}`);
        force = true;
    }
    // ④ 단단한 오류가 남았을 때만 고르게(#127 보정 5): 장마다 한 줄 + [그래도 제출] [더 고치기]
    if (!v.ok && !force) {
        await postChat(id, [{ role: "event", text: null, payload: { kind: "verify", ai: "dynapse", ok: false, errors: v.errors.slice(0, 5), warnings: v.warnings.length, wk: warnKinds(v.warnings) } }]);
        await softRejectCard(id, taskId, v.errors);
        return;
    }
    // 이 작업에 남아 있는 제출 전 Claim은 놓는다(에이전트가 올리다 멈춘 것 — 올린 자리는 새 파일을 받지 않는다)
    const st = await mcp("my_status").catch(() => null);
    for (const k of st?.data?.claims ?? [])
        if (k.task_id === taskId && k.status === "active" && k.claim_nonce)
            await mcp("release_claim", { claim_nonce: k.claim_nonce }).catch(() => null);
    const c = await mcp("claim_task", { task_id: taskId, work_id: id, full: true, ...(replaces ? { replaces } : {}) }).catch(() => null);
    if (!c?.data?.claim_nonce) {
        await say(c?.text?.slice(0, 80) || "작업을 맡지 못했어요", "error");
        return;
    }
    const cl = c.data;
    const dir = await T().core.invoke("work_dir", { id });
    const deck = cl.task.spec.kind === "deck";
    // 장 목록 = 목표에서(#43) — 카드뉴스는 result-card-1..n(4~8, 기본 6), 슬라이드는 표지·본문·데이터·마무리(2~4)
    const spec = cl.task.spec;
    // 슬라이드 장 목록(2026-10-14 대표 캡처 "올릴 파일 수가 맞지 않아요(5/13)" — 12장 덱인데 앱은 4장 고정 목록을 올리려 했다): spec.pages가 4를 넘으면 가운데 장 result-p04…(v6b)
    const n = Math.max(2, Math.min(16, spec.pages ?? 4));
    const slides = n <= 4 ? DECK_FILES.slice(0, n) : [...DECK_FILES.slice(0, 3), ...Array.from({ length: n - 4 }, (_, j) => `result-p${String(4 + j).padStart(2, "0")}.html`), DECK_FILES[3]];
    // 앱이 가진 순서(.dynapse/pages.json)가 같은 장수면 그 순서대로(사용자가 장을 옮겼을 수 있다)
    const order = ((await readPages(id).catch(() => null)) ?? []).filter(x => typeof x === "string" && /^result-[a-z0-9-]+\.html$/.test(x));
    const pages = !deck ? ["result-cover.html"] : spec.deck_goal === "cards"
        ? Array.from({ length: Math.max(4, Math.min(8, spec.pages ?? 6)) }, (_, i) => `result-card-${i + 1}.html`)
        : spec.deck_goal === "flip" ? Array.from({ length: n }, (_, i) => `result-p${String(i + 1).padStart(2, "0")}.html`)
            : spec.deck_goal === "fold" ? ["result-out.html", "result-in.html"] // 접는 인쇄물(#217 보정 4) — 바깥면·안쪽면
                : spec.deck_goal === "mobile" ? ["result-mobile.html"] // 모바일 청첩장(#230 보정 16) — 폰 한 장
                    : order.length === n ? order : slides;
    const files = [...pages.map(f => ({ path: `.dynapse/out/${f.replace(/^result-|\.html$/g, "")}.bundle.html`, type: "text/html" })), ...(deck ? [{ path: "tokens.css", type: "text/css" }] : [])];
    const ups = cl.uploads?.length ? cl.uploads : [{ upload_id: cl.upload_id, upload_url: cl.upload_url }];
    const release = () => mcp("release_claim", { claim_nonce: cl.claim_nonce }).catch(() => null);
    if (ups.length !== files.length) {
        await say(`올릴 파일 수가 맞지 않아요(${files.length}/${ups.length})`, "error");
        await release();
        return;
    }
    // 올리기 전에 파일이 다 있는지(#127 보정 6) — tokens.css는 만들고, 장 자체가 없으면 그 장만 AI에게. 장 묶음(.dynapse/out/*.bundle.html)은 work_files 목록에 안 나온다(네이티브가 out은 PNG만 보인다) —
    // 묶음이 없으면 올리기 자체가 실패하고 그 이유를 말한다
    {
        const have = () => T().core.invoke("work_files", { id }).then(l => new Set(l.filter(x => x.size > 0).map(x => x.name))).catch(() => new Set());
        let h = await have();
        if (deck && !h.has("tokens.css") && await ensureTokens(id) === "made") {
            await say("tokens.css가 없어 장의 토큰으로 만들었어요");
            h = await have();
        }
        const noPage = pages.filter(f => !h.has(f));
        if (noPage.length) {
            await release();
            pendingSubmit.set(id, { taskId, ...(replaces ? { replaces } : {}) });
            await say(`장 ${noPage.length}개가 없어 그 장만 만들고 다시 제출해요 · ${noPage.map(pageLabel).join(", ")}`);
            void chatSend(id, `[Missing pages before submit] These pages listed for this reward do not exist: ${noPage.join(", ")}. Create only these, following .dynapse/plan.json and the other pages' style; do not touch other pages. The app submits again when you finish.`, { scope: "page" });
            return;
        }
        if (deck && !h.has("tokens.css")) {
            await say("tokens.css를 만들지 못했어요 · 장에 <style data-tokens>가 없어요 · AI에게 \"토큰 블록 넣어줘\"라고 한 뒤 위의 [제출]로 다시", "error");
            await release();
            return;
        }
    }
    // 서버와 같은 L0(#127 보정 7) — 올리기 전에 서버의 덱 검사(같은 함수 deckL0)를 이 묶음으로. 걸리면 올리지 않고 원인 한 줄. 사진 본문(data:)은 짧게(요청 크기 — 사진 유무만 본다)
    if (deck) {
        const strip = (h) => h.replace(/(data:[a-z]+\/[a-z0-9.+-]+;base64,)[A-Za-z0-9+/=]{64,}/gi, "$1AAAA");
        const got = await bundleGate(id, pages);
        if (!Array.isArray(got)) {
            await release();
            report("export", "reward.bundle_unread", `big=${got.big} page=${got.page}`);
            await say(got.big ? `장 묶음이 커서 못 올렸어요(2MB 넘음) · ${pageLabel(got.page)} · 사진 수를 줄인 뒤 위의 [제출]로 다시` : `장 묶음이 비어 못 올렸어요 · ${pageLabel(got.page)} · 위의 [제출]로 다시`, "error");
            return;
        }
        const body = { task_id: taskId, pages: pages.map((f, i) => ({ file: f, html: strip(got[i].h) })), tokens: (await readTokens(id)) ?? "" }; // #161 — 못 읽으면 장 블록
        const l0 = await api("POST", "/api/device/l0", body).catch(() => null); // 예전 서버(404)·연결 실패면 지금처럼 올린다
        const why = l0?.status === 200 ? l0.data?.why ?? [] : [];
        if (why.length) {
            await release();
            report("export", "reward.l0_pre", `${l0?.data?.user?.kind ?? "other"} n=${why.length}`);
            // 빈 업로드(#281) — 토큰 다시 만들기·글자 칸 사다리를 타지 않는다(빈 글에 같이 나온 "data-tokens 없음"으로 돌았다). 한 줄, 다시 하기 없음
            if (l0?.data?.user?.kind === "empty_upload" || why.some(w => BS.EMPTY_WHY.test(w))) {
                report("export", "reward.empty_upload", `n=${why.length}`);
                await say("올라온 장이 비어 있어 제출을 멈췄어요 · 위의 [제출]로 다시", "error");
                return;
            }
            // 덱 색 변수(#161) — 서버가 tokens 사유로 반려하면 반려 카드 대신 장 블록으로 tokens.css를 다시 쓰고 한 번 더(작업·과제마다 한 번). 예전 서버는 kind가 other라 사유 글로도 본다
            const tk = `${id}|${taskId}|tokens`;
            if ((l0?.data?.user?.kind === "tokens" || why.some(w => TOKENS_WHY.test(w))) && !ladderTried.has(tk)) {
                ladderTried.add(tk);
                await ensureTokens(id, true);
                await say("덱 색 변수(tokens.css)를 맞추는 중 · 앱이 장에서 다시 만들어요");
                return submitReward0(id, taskId, replaces, force); // 같은 제출 안의 다시 하기(잠금 그대로)
            }
            {
                const names = [...new Set(why.flatMap(w => [...w.matchAll(/빈 글자 칸:\s*([^—/·]+)/g)].flatMap(m => m[1].split(",").map(x => x.trim()))).filter(x => x && !PHOTO_NAME.test(x)))];
                const want = [];
                for (const slot of names)
                    for (const pg of pages) {
                        const h = await wget(id, pg);
                        if (h && new RegExp(`data-slot\\s*=\\s*["']${slot}["'](?![^>]*data-slot-empty)`).test(h))
                            want.push({ page: pg, slot });
                    }
                if (want.length) {
                    await release();
                    const r = await emptyTextStep(id, taskId, replaces, want, say);
                    if (r === "again")
                        return submitReward0(id, taskId, replaces, force);
                    if (r !== "ok")
                        return;
                }
            }
            {
                const want = await emptyPhotoSlots(id, pages, why).catch(() => []); // 빈 사진 칸 → 사진 러너 한 번 → 다시 제출(사람 지시 없음)
                if (want.length && !photoTried.has(`${id}|${taskId}|photo`)) {
                    await release();
                    if (await autoPhotos(id, taskId, want, say))
                        return submitReward0(id, taskId, replaces, force);
                }
            }
            if (await l0Turn(id, taskId, replaces, why, l0?.data?.user?.kind))
                return;
            await rejectedCard(id, taskId, { line: l0?.data?.user?.line, kind: l0?.data?.user?.kind, agent: `L0: ${why.join(" / ")}` });
            return;
        }
    }
    await say(`제출하는 중 · 올리기 0/${files.length}`);
    // 한꺼번에 여덟까지(#279 ⑥ — 하나씩 올려 9파일 82초, 7KB짜리도 한 번에 ~9초 = 크기가 아니라 왕복 대기): 끝난 수로 진행 한 줄(경과 시간 줄 대신) · 파일마다 ms는 보고 한 줄로
    const t0 = Date.now(), ms = new Array(files.length).fill(0), res = new Array(files.length).fill(null);
    let doneN = 0, nextI = 0;
    await Promise.all(Array.from({ length: Math.min(8, files.length) }, async () => {
        for (let i = nextI++; i < files.length; i = nextI++) {
            const a = Date.now();
            res[i] = await http("PUT", ups[i].upload_url, { file: `${dir}/${files[i].path}`, contentType: files[i].type, auth: true }).catch(e => ({ status: 0, body: String(e?.message ?? e) }));
            ms[i] = Date.now() - a;
            doneN++;
            submitStep.set(id, { label: `제출하는 중 · 올리기 ${doneN}/${files.length}`, at: Date.now() - 10_000 });
        }
    }));
    report("export", "submit.upload", `n=${files.length} total_ms=${Date.now() - t0} max_ms=${Math.max(...ms)} sum_ms=${ms.reduce((x, y) => x + y, 0)}`);
    for (const [i, f] of files.entries()) {
        const r = res[i] ?? { status: 0, body: "no result" };
        // 실패 이유를 말한다(#127 보정 6) — 서버 응답이면 상태·이유, 연결이면 연결 문제. 다시는 작업실 위의 [제출]로
        if (r.status !== 200) {
            let why = "";
            try {
                why = String(JSON.parse(r.body ?? "{}").error ?? "");
            }
            catch {
                why = String(r.body ?? "").slice(0, 80);
            }
            const noFile = !r.status && /No such file|Failed to open|couldn't open|26/i.test(why); // curl이 파일을 못 읽음(장 묶음이 없음 — 검사가 아직 안 만듦)
            await say(`${f.path.split("/").pop()}을 올리지 못했어요 · ${noFile ? "파일이 없어요 · 검사를 다시 돌린 뒤" : r.status ? `서버 ${r.status}${why ? ` ${why.slice(0, 80)}` : ""} ·` : "연결이 끊겼어요 ·"} 위의 [제출]로 다시`, "error");
            report("export", "reward.upload_fail", `status=${r.status} file=${f.path.split("/").pop()}`);
            await release();
            return;
        }
    }
    const tr = await readJson(id, ".dynapse/TRACE.json");
    const last = [...(tr?.rounds ?? [])].reverse().find(r => r.runtime === "claude_code" || r.runtime === "codex");
    const provider = last?.runtime === "codex" ? "codex" : "claude_code";
    const head = S.git ? await T().core.invoke("repo_head", { id }).catch(() => null) : null; // 공개본 버전 표시(r#)
    const photos = await photoTally(id, (await readJson(id, ".dynapse/TRACE.json")) ?? {}).catch(() => null);
    const r = await mcp("submit_work", { task_id: taskId, work_id: id, claim_nonce: cl.claim_nonce, provider, ...(head ? { head } : {}), ...(photos ? { photos } : {}), ...(ups.length > 1 ? { upload_ids: ups.map(u => u.upload_id) } : { upload_id: ups[0].upload_id }),
        evidence: { claim_nonce: cl.claim_nonce, runtime: provider, model: last?.model ?? `unknown-${provider}` } }).catch(() => null);
    if (!r?.data?.receipt) {
        await release();
        // 서버 L0 반려(#62 보정 1) — 사용자에겐 rejected_user 한 줄(에이전트용 "칸을 빼라"는 보이지 않게 payload에만)
        const rej = r?.data;
        if (rej?.rejected && rej.rejected_kind === "forms" && await l0Turn(id, taskId, replaces, [rej.rejected], "forms"))
            return;
        if (rej?.rejected) {
            await rejectedCard(id, taskId, { line: rej.rejected_user, kind: rej.rejected_kind, agent: rej.rejected, slots: [...rej.rejected.matchAll(/빈 사진 칸:\s*([^—/]+)/g)].reduce((n, m) => n + m[1].split(",").filter(x => x.trim()).length, 0) });
            return;
        }
        await say((r?.text ?? "제출하지 못했어요").slice(0, 160), "error");
        return;
    }
    const left = softLeft.get(id) ?? 0;
    softLeft.delete(id);
    const done = replaces ? "교체 제출했어요" : left ? `제출했어요 · 남은 경고 ${left}개는 검수에서 봐요` : "제출했어요";
    await postChat(id, [{ role: "agent", text: done, payload: { ai: "dynapse", summary: [done] } }]);
}
// 글꼴 블록(#36) — 결과 페이지 전부에 같은 블록. 있으면 교체, 없으면 </head> 앞. 바뀐 페이지가 있으면 true
const FONT_RE = /<style\b[^>]*\bdata-fonts\b[^>]*>[\s\S]*?<\/style>/i;
async function setFonts(id, block0) {
    const block = await expandWorkFonts(id, block0); // 이 작업에 받아 둔 웹폰트(#58)
    const pages = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(n => /^result-[a-z0-9-]+\.html$/.test(n));
    let n = 0;
    for (const f of pages) {
        const h = await wget(id, f);
        if (!h)
            continue;
        const out = FONT_RE.test(h) ? h.replace(FONT_RE, block) : /<\/head>/i.test(h) ? h.replace(/<\/head>/i, `${block}\n</head>`) : `${block}\n${h}`;
        if (out !== h) {
            await wput(id, f, out);
            n++;
        }
    }
    return n > 0;
}
let pcExtra = null;
export async function pcFontsFor(id, force = false) {
    const native = ((await T().core.invoke("local_fonts", { refresh: force }).catch(() => [])) ?? []);
    if (force || !pcExtra || Date.now() - pcExtra.at > 300_000) {
        const dir = await T().core.invoke("work_dir", { id }).catch(() => null);
        if (dir) {
            await ensureVerify(id).catch(() => { });
            await wput(id, ".dynapse/known-fonts.json", JSON.stringify(native.map(f => f.family))).catch(() => { });
            const r = await exec("node", [".dynapse/verify.mjs", "result-dyn-fonts.html"], undefined, dir).catch(() => null);
            try {
                const j = JSON.parse(r?.stdout?.trim().split("\n").at(-1) ?? "");
                if (Array.isArray(j.fonts))
                    pcExtra = { at: Date.now(), list: j.fonts.slice(0, 2000) };
            }
            catch { /* Chrome·node 없음 — 네이티브 목록만 */ }
        }
    }
    const have = new Set(native.map(f => f.family));
    const all = [...native, ...(pcExtra?.list ?? []).filter(f => !have.has(f.family))];
    await wput(id, ".dynapse/pc-fonts.json", JSON.stringify(all.map(f => ({ family: f.family, kr: f.kr, weights: f.weights ?? [] })))).catch(() => { });
    return all;
}
// 웹폰트 주소 → 이 작업의 글꼴(#58) — 폰트 CSS·.woff2/.ttf/.otf 주소를 받아 context/fonts/⟨이름⟩/(파일 + font.json의 @font-face). 글꼴 id = work:⟨이름⟩
// 글꼴 블록에 그 @font-face를 그대로 넣는다(작업 폴더 기준 상대경로 — 사진처럼). 결과 HTML에 외부 주소는 남지 않는다(Google Fonts만 허용 주소 그대로 @import)
// 공개본·다른 PC(폴더가 없을 때)는 이 PC 글꼴처럼 기본 글꼴. .css 파일을 쓰지 않는다(work_write가 0.1.53까지 .css를 거부)
export const FONT_URL = /https:\/\/[^\s"'<>()]+?(?:\.(?:woff2?|ttf|otf)(?:\?[^\s"'<>()]*)?|\/css2?\?[^\s"'<>()]+|\.css(?:\?[^\s"'<>()]*)?)(?=[\s"'<>()]|$)/gi;
const famDir = (f) => f.trim().replace(/\s+/g, "_");
const cleanFam = (s) => s.replace(/["']/g, "").replace(/[^\p{L}\p{N} ._-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
const UA = "user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"; // Google·폰트 CDN이 woff2를 주게
export async function importWebFont(id, url) {
    const dir = await T().core.invoke("work_dir", { id }).catch(() => null);
    if (!dir)
        return { ok: false, why: "작업 폴더가 없어요" };
    const u = (() => { try {
        return new URL(url);
    }
    catch {
        return null;
    } })();
    if (!u || u.protocol !== "https:")
        return { ok: false, why: "https 주소만 받아요" };
    const put = (fam, faces) => wput(id, `context/fonts/${famDir(fam)}/font.json`, JSON.stringify({ family: fam, from: u.origin, faces }, null, 1));
    if (/\.(woff2?|ttf|otf)$/i.test(u.pathname)) {
        const base = decodeURIComponent(u.pathname.split("/").pop() ?? "font");
        const ext = base.match(/\.(woff2?|ttf|otf)$/i)[1].toLowerCase();
        const fam = cleanFam(base.replace(/\.(woff2?|ttf|otf)$/i, "").replace(/[-_ ]?(regular|bold|medium|light|thin|black|semibold|extrabold|extralight|heavy|book|\d{3})$/i, "").replace(/[-_]+/g, " ")) || "Web Font";
        const rel = `context/fonts/${famDir(fam)}/f1.${ext}`;
        const g = await http("GET", url, { out: `${dir}/${rel}`, headers: [UA] }).catch(() => null);
        if (g?.status !== 200)
            return { ok: false, why: "이 주소에서 폰트 파일을 못 받았어요" };
        const fmt = ext === "ttf" ? "truetype" : ext === "otf" ? "opentype" : ext;
        await put(fam, `@font-face{font-family:'${fam}';src:url('${rel}') format('${fmt}');font-display:swap}`);
        return { ok: true, families: [fam] };
    }
    const r = await http("GET", url, { headers: [UA] }).catch(() => null);
    if (r?.status !== 200 || !/@font-face/i.test(r.body))
        return { ok: false, why: "이 주소에서 폰트 파일을 못 찾았어요" };
    const byFam = new Map();
    for (const m of r.body.matchAll(/@font-face\s*\{[^}]*\}/gi)) {
        const f = cleanFam(m[0].match(/font-family\s*:\s*([^;}]+)/i)?.[1] ?? "");
        if (f)
            (byFam.get(f) ?? byFam.set(f, []).get(f)).push(m[0]);
    }
    if (!byFam.size)
        return { ok: false, why: "이 주소에서 폰트 파일을 못 찾았어요" };
    // Google Fonts는 결과 HTML에 허용된 주소 — 받지 않고 그대로 @import(한글은 조각 파일이 100개 넘는다)
    if (u.hostname === "fonts.googleapis.com") {
        for (const f of byFam.keys())
            await put(f, `@import url('${url}');`);
        return { ok: true, families: [...byFam.keys()] };
    }
    let n = 0;
    const got = [];
    for (const [f, bs] of byFam) {
        const faces = [];
        for (const b of bs) {
            let out = b, ok = false;
            for (const m of b.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
                if (n >= 200)
                    break;
                const src = (() => { try {
                    return new URL(m[1], url).href;
                }
                catch {
                    return null;
                } })();
                const ext = src?.match(/\.(woff2?|ttf|otf)(\?|$)/i)?.[1]?.toLowerCase();
                if (!src || !ext || !src.startsWith("https://"))
                    continue;
                const rel = `context/fonts/${famDir(f)}/f${++n}.${ext}`;
                const g = await http("GET", src, { out: `${dir}/${rel}`, headers: [UA] }).catch(() => null);
                if (g?.status !== 200)
                    continue;
                out = out.replace(m[0], `url('${rel}')`);
                ok = true;
            }
            // 받지 못한 외부 주소가 남은 규칙은 버린다(결과 HTML에 외부 주소 0)
            if (ok && !/url\(\s*["']?https?:/i.test(out))
                faces.push(out.replace(/\s+/g, " "));
        }
        if (faces.length) {
            await put(f, faces.join("\n"));
            got.push(f);
        }
    }
    return got.length ? { ok: true, families: got } : { ok: false, why: "폰트 파일을 받지 못했어요" };
}
// 글꼴 블록의 /*@work-font:⟨이름⟩*/ 자리 → 그 작업 글꼴의 @font-face(서버는 폴더를 모르니 앱이 채운다)
async function expandWorkFonts(id, block) {
    let out = block;
    for (const m of block.matchAll(/\/\*@work-font:([^*]{1,80})\*\//g)) {
        const j = await readJson(id, `context/fonts/${famDir(m[1])}/font.json`).catch(() => null);
        out = out.replace(m[0], j?.faces && !/<\/?style/i.test(j.faces) ? j.faces : m[0]);
    }
    return out;
}
// 보조 작업(#51 §4 보정 2) — 메인 편집 세션(Opus, --resume)은 건드리지 않고, 입력이 작고 출력이 정해진 일만 Sonnet 일회 프로세스로.
// 도구 없음 · 짧은 시스템 프롬프트(기본 프롬프트 ~9k 토큰을 싣지 않는다) · 작업 폴더 밖(작업 루트)에서 — 지침(CLAUDE.md)·결과 파일을 읽지 않는다. 결과는 stdout JSON → 앱이 파일로
const AUX_SYS = "You are a small helper inside the Dynapse app. You have no tools. Answer with exactly one JSON object and nothing else.";
// 편집 AI와 같은 회사로(대표: ChatGPT로 수정할 때도 같은 느낌) — Claude면 Sonnet, ChatGPT면 그 계정의 가벼운 모델(luna·mini 계열, 없으면 기본). 둘 다 일회 프로세스
const lightCodex = () => (S.models.chatgpt ?? []).map(m => m.id).find(m => /luna|mini|nano/i.test(m)) ?? null;
export async function auxRun(id, prompt, ai = "claude") {
    const okClaude = S.tools.claude.installed && S.tools.claude.loggedIn !== false, okCodex = S.tools.codex.installed && S.tools.codex.loggedIn !== false;
    const use = ai === "chatgpt" && okCodex ? "codex" : okClaude ? "claude" : okCodex ? "codex" : null;
    if (!use)
        return null;
    const dir = await T().core.invoke("work_dir", { id }).catch(() => null);
    if (!dir)
        return null;
    const root = dir.replace(/[\\/][^\\/]+[\\/]?$/, "");
    const t0 = Date.now();
    const pick = (t) => JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
    try {
        if (use === "claude") {
            const r = await exec("claude", ["-p", "--model", "sonnet", "--output-format", "json", "--tools", "", "--strict-mcp-config", "--no-session-persistence", "--system-prompt", AUX_SYS], prompt, root).catch(() => null);
            const j = JSON.parse(r?.stdout ?? "");
            if (j.is_error || !j.result)
                return null;
            const u = j.usage ?? {};
            return { json: pick(j.result), tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), ms: Date.now() - t0, model: Object.keys(j.modelUsage ?? {}).find(k => /sonnet/i.test(k)) ?? "sonnet", ai: "claude" };
        }
        // Codex — 읽기 전용 샌드박스 · 지침 파일 안 읽음 · 기록 안 남김(--ephemeral) · 작업 폴더 밖
        const m = lightCodex();
        const r = await exec("codex", ["exec", "--json", "--skip-git-repo-check", "--ephemeral", ...(m && codexModelOk(m) ? ["-m", m] : []), "-c", `model_reasoning_effort="low"`, "-c", "project_doc_max_bytes=0", "-s", "read-only", "-C", root, "-"], `${AUX_SYS} Do not run commands or read files.\n${prompt}`, root).catch(() => null);
        let text = "", tokens = 0;
        for (const line of (r?.stdout ?? "").split("\n")) {
            try {
                const e = JSON.parse(line);
                if (e.type === "item.completed" && e.item?.type === "agent_message" && e.item.text)
                    text = e.item.text;
                if (e.type === "turn.completed" && e.usage)
                    tokens += (e.usage.input_tokens ?? 0) + (e.usage.output_tokens ?? 0);
            }
            catch { /* 다른 줄 */ }
        }
        if (!text)
            return null;
        return { json: pick(text), tokens, ms: Date.now() - t0, model: m ?? S.defaultModels.chatgpt ?? "codex", ai: "codex" };
    }
    catch {
        return null;
    }
}
// 자료함 글 행(#83 보정 1) — kind "article". 같은 원고(file)면 갱신, 읽지 못한 주소는 failed 행 하나(다시 붙이면 그 행이 바뀐다)
async function libraryAddArticles(id, arts, failed) {
    const lib = (await readJson(id, "context/library.json").catch(() => null)) ?? { sources: [], items: [], conflicts: [] };
    const items = lib.items ?? [];
    const today = new Date().toISOString().slice(0, 10);
    for (const a of arts) {
        const rd = a.read ? await readJson(id, a.read).catch(() => null) : null;
        const row = { id: `art-${a.file.replace(/^.*url-|\.md$/g, "")}`, kind: "article", title: a.title.slice(0, 80), summary: rd?.one_line?.slice(0, 120), file: a.file, read: a.read, images: a.images ?? [], source: { type: "link", ref: a.url }, updated: today };
        const k = items.findIndex(x => x.file === a.file || (x.failed && x.source?.ref === a.url));
        if (k >= 0)
            items[k] = { ...items[k], ...row, failed: undefined };
        else
            items.push(row);
    }
    for (const u of failed)
        if (!items.some(x => x.source?.ref === u))
            items.push({ id: `art-fail-${items.length}`, kind: "article", title: u.replace(/^https?:\/\/(www\.)?/, "").slice(0, 80), failed: true, source: { type: "link", ref: u }, updated: today });
    await wput(id, "context/library.json", JSON.stringify({ ...lib, items }, null, 1));
}
// 글 읽기(2026-10-08 대표 "Aside처럼 읽어 와서 — 읽는 건 Sonnet으로, 제대로 읽고 그걸 적용") — 앱이 받은 원고(.md)와 본문 사진을 가벼운 AI가 먼저 읽어
// context/refs/<원고>.read.json(장 구성 · 사진마다 무엇이 보이는지·안의 글자·어느 장·뺄지)을 만든다. 만드는 AI는 이걸 계획으로 쓴다. 편집 AI와 같은 회사: Claude = Sonnet(Read만, 사진을 직접 본다) · ChatGPT = 가벼운 모델(사진을 -i로 붙인다)
const READER_SYS = "You read one web article for the Dynapse app before a designer turns it into pages. Read the article file and look at every listed image yourself. Answer with exactly one JSON object and nothing else.";
async function readArticle(id, art, ai) {
    const out = art.file.replace(/\.md$/, ".read.json");
    const have = await readJson(id, out).catch(() => null);
    if (have?.sections)
        return { sections: have.sections.length, images: have.images?.length ?? 0, skipped: (have.images ?? []).filter(i => i.use === "skip").length, model: have._model ?? "", ms: 0 };
    const okClaude = S.tools.claude.installed && S.tools.claude.loggedIn !== false, okCodex = S.tools.codex.installed && S.tools.codex.loggedIn !== false;
    const use = ai === "chatgpt" && okCodex ? "codex" : okClaude ? "claude" : okCodex ? "codex" : null;
    const dir = await T().core.invoke("work_dir", { id }).catch(() => null);
    if (!use || !dir)
        return null;
    const imgs = (art.images ?? []).slice(0, 12);
    const prompt = `Article: ${art.file}${imgs.length ? `\nIts photos, in article order (photo n = "[사진 n]" in the text): ${imgs.map((f, i) => `${i + 1}=${f}`).join(", ")}` : ""}
Return JSON: {"title": string, "kind": "blog|news|product|notice|interview|guide|other", "one_line": "the article's main claim in one Korean line", "audience": string,
"sections": [{"heading": "short Korean heading", "points": ["Korean sentence taken from the article", …], "numbers": ["exact numbers/names as written"], "images": [photo numbers that belong here]}],
"images": [{"n": number, "file": string, "shows": "what is visible, one Korean line", "text_in_image": "the text printed in the image, or null", "kind": "photo|diagram|chart|screenshot|portrait|map|logo|banner|decoration", "use": "cover|page|skip", "why": "one short reason"}],
"cta": {"name": string|null, "contact": string|null, "address": string|null}}
Rules: sections follow the article's order and wording — do not invent facts or numbers; 4–8 sections. Look at each image before describing it. Mark use "skip" for decoration, ads, stickers, map widgets, duplicated or unreadable images. Pick the single best image for "cover".`;
    const t0 = Date.now();
    await postChat(id, [{ role: "event", text: `글 읽는 중 · ${use === "claude" ? "Sonnet" : "ChatGPT"}${imgs.length ? ` · 사진 ${imgs.length}장` : ""}`, payload: { kind: "stage", ai: use === "claude" ? "claude" : "chatgpt" } }]);
    const pick = (t) => JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
    let j = null, model = "", tokens = 0;
    try {
        if (use === "claude") {
            // 상한(#88 B-6) — 한 번 읽기에 $0.5까지(사진 12장을 봐도 보통 그 아래)
            const r = await exec("claude", ["-p", "--model", "sonnet", "--output-format", "json", "--tools", "Read", "--allowedTools", "Read", "--strict-mcp-config", "--no-session-persistence", "--max-turns", "20", "--max-budget-usd", "0.5", "--system-prompt", READER_SYS], prompt, dir).catch(() => null);
            const o = JSON.parse(r?.stdout ?? "{}");
            const u = o.usage ?? {};
            tokens = (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
            if (!o.is_error && o.result) {
                j = pick(o.result);
                model = Object.keys(o.modelUsage ?? {}).find(k => /sonnet/i.test(k)) ?? "sonnet";
            }
        }
        else {
            const m = lightCodex();
            const r = await exec("codex", ["exec", "--json", "--skip-git-repo-check", "--ephemeral", ...(m && codexModelOk(m) ? ["-m", m] : []), "-c", `model_reasoning_effort="low"`, "-c", "model_max_output_tokens=6000", "-c", "project_doc_max_bytes=0", "-s", "read-only", "-C", dir, ...imgs.flatMap(f => ["-i", `${dir}/${f}`]), "-"], `${READER_SYS}\nDo not run commands other than reading the article file.\n${prompt}`, dir).catch(() => null);
            let text = "";
            for (const line of (r?.stdout ?? "").split("\n")) {
                try {
                    const e = JSON.parse(line);
                    if (e.type === "item.completed" && e.item?.type === "agent_message" && e.item.text)
                        text = e.item.text;
                    if (e.type === "turn.completed" && e.usage)
                        tokens += (e.usage.input_tokens ?? 0) + (e.usage.output_tokens ?? 0);
                }
                catch { /* 다른 줄 */ }
            }
            if (text) {
                j = pick(text);
                model = m ?? S.defaultModels.chatgpt ?? "codex";
            }
        }
    }
    catch {
        j = null;
    }
    // 쓴 토큰은 숫자로(#88 B-6 · voice "토큰 소비량은 숫자로") — 보조 사용량 카드 하나(실패해도 쓴 만큼)
    if (tokens)
        await auxDone(id, "read", { tokens, ms: Date.now() - t0, model: model || (use === "claude" ? "sonnet" : "codex"), ai: use }, null).catch(() => { });
    if (!j || !Array.isArray(j.sections) || !j.sections.length) {
        await postChat(id, [{ role: "event", text: "글 읽기를 건너뛰었어요 · 원고 그대로 만들어요", payload: { kind: "stage", ai: "dynapse" } }]);
        return null;
    }
    await wput(id, out, JSON.stringify({ ...j, _model: model, _at: Date.now() }, null, 1));
    const r = { sections: j.sections.length, images: j.images?.length ?? 0, skipped: (j.images ?? []).filter(i => i.use === "skip").length, model, ms: Date.now() - t0 };
    await postChat(id, [{ role: "event", text: `읽었어요 · ${r.sections}부분${r.images ? ` · 사진 ${r.images - r.skipped}장 씀${r.skipped ? `, ${r.skipped}장 뺌` : ""}` : ""} · ${mmss(r.ms)}`, payload: { kind: "stage", ai: use === "claude" ? "claude" : "chatgpt" } }]);
    return r;
}
// 보조 카드 — 메인 턴 사용량과 따로(웹이 "보조"를 붙인다) · 운영 표(#52)에 role=aux
async function auxDone(id, kind, r, reply) {
    const k = r.tokens >= 1000 ? `${Math.round(r.tokens / 1000)}k` : String(r.tokens);
    await postChat(id, [...(reply ? [{ role: "agent", text: reply, payload: { ai: r.ai, model: r.model, aux: true } }] : []),
        { role: "event", text: `${k} 토큰 · ${mmss(r.ms)}`, payload: { kind: "usage", role: "aux", ai: r.ai, tokens: r.tokens, cached: 0, ms: r.ms, model: r.model } }]).catch(() => { });
    void sendMetric(id, { tid: newTid(), kind, role: "aux", ai: r.ai, model: r.model, ok: true, tok: { total: r.tokens }, t: { total: Math.round(r.ms / 1000) } });
}
// 폰트 요청(#36 → 보조) — 카탈로그 안에서 두 id만 고르는 일. 메인 세션 턴 0. 실패하면 null → 예전처럼 메인 턴으로
async function fontAux(id, text, catalog, cur, ai = "claude") {
    const r = await auxRun(id, `Pick fonts for a slide deck. Catalog (id (name, tags)): ${catalog}\n${cur}. Keep the one the user did not mention. Match names loosely (spaces, case, Korean/English: 나눔고딕 = nanum-gothic, 프리텐다드 = pretendard). If the named font is not in the catalog, pick the closest and say so ("이 폰트는 없어요 · 비슷한 ⟨이름⟩으로 바꿨어요").\nUser request: ${text.slice(0, 500)}\nReturn {"display":"<id>","body":"<id>","why":"<one short Korean line for the user>"}`, ai);
    const d = typeof r?.json.display === "string" ? r.json.display : null, b = typeof r?.json.body === "string" ? r.json.body : null;
    if (!r || !d || !b)
        return false;
    const q = await http("GET", `${HUB}/api/fonts?display=${encodeURIComponent(d)}&body=${encodeURIComponent(b)}`).catch(() => null);
    const block = q?.status === 200 ? JSON.parse(q.body).block : null;
    if (!block || !/^<style data-fonts\b/.test(block))
        return false;
    const blk = await expandWorkFonts(id, block);
    if (await setFonts(id, blk)) {
        await addPending(id, { t: "font", block: blk, label: `Aa ${d === b ? d : `${d} · ${b}`}`.slice(0, 40) });
        await savePending(id);
    }
    void api("POST", "/api/fonts/pick", { work_id: id, display: d, body: b }).catch(() => { }); // 선택 기록(#36 추가 3)
    await auxDone(id, "font", r, typeof r.json.why === "string" ? r.json.why.slice(0, 120) : "글꼴을 바꿨어요");
    return true;
}
// AI가 고른 글꼴(.dynapse/font-pick.json {display, body}) — 카탈로그 블록을 서버에서 받아 적용. 한 번만
// "글꼴 바꿔줘"·"더 굵게/가늘게"(#129 §4) — 지금 짝(data-pair)의 다음 짝 또는 굵기 토큰 ±100. 리워드는 지정 짝이 있으면 바꾸지 않는다
async function fontTurn(id, dw) {
    if (await readJson(id, ".dynapse/reward-font.json").catch(() => null))
        return false;
    const pages = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(n => /^result-[a-z0-9-]+\.html$/.test(n));
    const first = pages.length ? (await wget(id, pages.find(p => p === "result-cover.html") ?? pages[0]).catch(() => null)) ?? "" : "";
    const blk = first.match(FONT_RE)?.[0] ?? "", cur = blk.match(/data-pair="([^"]+)"/)?.[1] ?? null;
    const say = (text) => postChat(id, [{ role: "event", text, payload: { kind: "stage", ai: "dynapse" } }, { role: "event", text: null, payload: { kind: "turn-end", ai: "dynapse" } }]).catch(() => { });
    if (dw) { // 굵기만 — display 굵기를 한 단계(100~900)
        if (!cur)
            return false;
        const w0 = Number(blk.match(/--typography-weight-display:(\d+)/)?.[1] ?? 0);
        if (!w0)
            return false;
        const w1 = Math.max(100, Math.min(900, w0 + dw));
        if (w1 === w0) {
            await say(`제목 굵기가 이미 ${dw > 0 ? "가장 굵어요" : "가장 가늘어요"}`);
            return true;
        }
        if (!(await setFonts(id, blk.replace(/--typography-weight-display:\d+/, `--typography-weight-display:${w1}`))))
            return false;
        await repoCommit(id, `글꼴 · 제목 굵기 ${w0} → ${w1}`);
        await say(`제목 굵기를 ${w0}에서 ${w1}로 ${dw > 0 ? "굵게" : "가늘게"} 했어요 · 되돌리기 ⌘Z`);
        return true;
    }
    const r = await http("GET", `${HUB}/api/fonts?pairs=1`).catch(() => null);
    const pool = r?.status === 200 ? (JSON.parse(r.body).pairs ?? []) : [];
    if (pool.length < 2)
        return false;
    const i = pool.findIndex(p => p.id === cur), next = pool[(i + 1 + pool.length) % pool.length];
    if (!(await applyPair(id, next.id)))
        return false;
    await wput(id, ".dynapse/font-pair.json", JSON.stringify({ id: next.id, name: next.name, why: next.why })).catch(() => { });
    await repoCommit(id, `글꼴 · ${next.name}`);
    await say(`글꼴을 ${next.name}(으)로 바꿨어요 · ${next.why} · 한 번 더 말하면 다음 짝 · 되돌리기 ⌘Z`);
    return true;
}
// QR 칸(#157 ④) — <div data-kind="qr" data-url="https://…">는 앱이 채운다(AI는 QR을 그리지 않는다). 주소가 바뀌면(data-qr-for ≠ data-url) 다시 만든다.
// QR은 허브 /api/qr(그 주소만 보낸다)에서 SVG로. 실패하면 칸을 그대로 두고 다음 턴에 다시
// 인장 표지(#230 보정 17 1b) — data-variant="seal" 장의 cover_seal에 두 이름·날짜로 결정적 SVG(AI 0). 이름·날짜가 바뀌면 다시 그리고, 같으면 그대로
export async function fillSeal(id) {
    const { fillSealHtml } = await import("./seal.js");
    const pages = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(n => PAGE_RE.test(n) || LANG_PAGE.test(n));
    let n = 0;
    for (const p of pages) {
        const h = await wget(id, p).catch(() => null);
        if (!h)
            continue;
        const r = fillSealHtml(h);
        if (r.changed) {
            await wput(id, p, r.html);
            n++;
        }
    }
    return n;
}
export async function fillQr(id) {
    const pages = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(n => PAGE_RE.test(n));
    const RE = /<(div|figure|span)(\s[^>]*\bdata-kind\s*=\s*["']qr["'][^>]*)>([\s\S]*?)<\/\1>/gi, cache = new Map();
    let n = 0;
    for (const p of pages) {
        const h = (await wget(id, p).catch(() => null)) ?? "";
        if (!/data-kind\s*=\s*["']qr/i.test(h))
            continue;
        const jobs = [];
        // 주소가 없는 QR 칸은 dynapse.ai(2026-10-22 대표 — QR 자리에 사진이 들어갔다): 사진·자리표시 그림이 있어도 QR로 바꾸고 data-url을 적어 둔다(대화로 바꿀 수 있게)
        for (const m of h.matchAll(RE)) {
            const url = m[2].match(/\bdata-url\s*=\s*["']([^"']+)["']/i)?.[1]?.replace(/&amp;/g, "&") ?? QR_DEFAULT_URL, done = m[2].match(/\bdata-qr-for\s*=\s*["']([^"']*)["']/i)?.[1]?.replace(/&amp;/g, "&");
            if (url && /^https?:\/\//i.test(url) && (done !== url || !/<svg\b/i.test(m[3])))
                jobs.push({ at: m[0], url });
        }
        if (!jobs.length)
            continue;
        let out = h;
        for (const j of jobs) {
            if (!cache.has(j.url)) {
                const r = await http("GET", `${HUB}/api/qr?u=${encodeURIComponent(j.url)}`).catch(() => null);
                cache.set(j.url, r?.status === 200 ? (JSON.parse(r.body).svg ?? null) : null);
            }
            const svg = cache.get(j.url);
            if (!svg || !/^<svg\b/.test(svg.trim()))
                continue;
            const m = j.at.match(/^<(\w+)(\s[^>]*)>/), attrs0 = m[2].replace(/\s+data-qr-for\s*=\s*["'][^"']*["']/i, ""), attrs = /\bdata-url\s*=/.test(attrs0) ? attrs0 : `${attrs0} data-url="${QR_DEFAULT_URL}"`;
            out = out.replace(j.at, `<${m[1]}${attrs} data-qr-for="${j.url.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">${svg.trim().replace(/<svg\b/, '<svg width="100%" height="100%" role="img" aria-label="QR"')}</${m[1]}>`);
            n++;
        }
        if (out !== h)
            await wput(id, p, out).catch(() => { });
    }
    return n;
}
// 글자 빠짐(#158 ③) — verify glyph_missing(짝 글꼴에 없는·빈 한글, 예: 주아의 "똠", 나눔스퀘어라운드의 "펲")이면 그 글꼴을 쓰지 않는 다음 짝으로 한 번 바꾼다.
// 캠퍼스 짝이면 캠퍼스 짝 안에서 먼저. 리워드 지정 짝은 그대로. 서버 짝 목록에 families가 없으면(옛 허브) 바꾸지 않는다
export async function glyphSwap(id, v) {
    const hits = (v.warnings ?? []).filter(w => w.rule === "glyph_missing");
    if (!hits.length)
        return null;
    if (await readJson(id, ".dynapse/reward-font.json").catch(() => null))
        return null;
    const bad = new Set(hits.map(h => String(h.font ?? "").split(",")[0].trim()).filter(Boolean));
    if (!bad.size)
        return null;
    const pages = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(n => /^result-[a-z0-9-]+\.html$/.test(n));
    const first = pages.length ? (await wget(id, pages.find(p => p === "result-cover.html") ?? pages[0]).catch(() => null)) ?? "" : "";
    const cur = (first.match(FONT_RE)?.[0] ?? "").match(/data-pair="([^"]+)"/)?.[1] ?? null;
    const r = await http("GET", `${HUB}/api/fonts?pairs=1`).catch(() => null);
    const pool = r?.status === 200 ? (JSON.parse(r.body).pairs ?? []) : [];
    if (!pool.some(p => Array.isArray(p.families)))
        return null;
    const now = pool.find(p => p.id === cur), i = pool.findIndex(p => p.id === cur), ring = [...pool.slice(i + 1), ...pool.slice(0, Math.max(0, i))];
    const fine = ring.filter(p => p.id !== cur && !(p.families ?? []).some(f => bad.has(f)));
    const next = fine.find(p => !!p.campus === !!now?.campus) ?? fine[0];
    if (!next)
        return null;
    if (!(await applyPair(id, next.id)))
        return null;
    await wput(id, ".dynapse/font-pair.json", JSON.stringify({ id: next.id, name: next.name, why: next.why })).catch(() => { });
    const chars = [...new Set(hits.flatMap(h => [...String(h.chars ?? "")]))].slice(0, 4).join("·");
    await repoCommit(id, `글꼴 · ${next.name}(글자 빠짐: ${chars})`);
    return { name: next.name, chars };
}
// 글꼴 짝 적용(#129) — 서버의 짝 블록(역할 다섯·굵기). 본문에 라틴 글자가 30% 넘으면 라틴 짝을 함께(latin=1). 선택은 pair_id로 기록
async function latinHeavy(id) {
    const pages = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(n => /^result-[a-z0-9-]+\.html$/.test(n)).slice(0, 8);
    let lat = 0, all = 0;
    for (const p of pages) {
        const t = ((await wget(id, p).catch(() => null)) ?? "").replace(/<(script|style|svg)\b[\s\S]*?<\/\1\s*>/gi, " ").replace(/<[^>]+>/g, " ");
        lat += (t.match(/[A-Za-z]/g) ?? []).length;
        all += (t.match(/[A-Za-z가-힣]/g) ?? []).length;
    }
    return all > 80 && lat / all >= 0.3;
}
export async function applyPair(id, pair) {
    const latin = await latinHeavy(id);
    // 카드뉴스(1080 폭) = 매체 규칙(#119 보정 15 ⑥ — 본문 400 이상·자간 0 이상)
    const first = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).find(n => /^result-[a-z0-9-]+\.html$/.test(n));
    const cards = !!first && /\.slide(?:\[[^\]]*\])*\s*\{[^}]*?\bwidth\s*:\s*1080px/.test((await wget(id, first).catch(() => null)) ?? "");
    const r = await http("GET", `${HUB}/api/fonts?pair=${encodeURIComponent(pair)}${latin ? "&latin=1" : ""}${cards ? "&media=cards" : ""}`).catch(() => null);
    const block = r?.status === 200 ? JSON.parse(r.body).block : null;
    if (!block || !/^<style data-fonts\b/.test(block))
        return false;
    const ok = await setFonts(id, block);
    void api("POST", "/api/fonts/pick", { work_id: id, pair }).catch(() => { });
    return ok;
}
async function applyFontPick(id) {
    const pick = await readJson(id, ".dynapse/font-pick.json");
    if (pick?.pair) {
        await wput(id, ".dynapse/font-pick.json", "{}\n");
        await applyPair(id, pick.pair).catch(() => false);
        return;
    }
    if (!pick?.display || !pick.body)
        return;
    await wput(id, ".dynapse/font-pick.json", "{}\n");
    const r = await http("GET", `${HUB}/api/fonts?display=${encodeURIComponent(pick.display)}&body=${encodeURIComponent(pick.body)}`).catch(() => null);
    const block = r?.status === 200 ? JSON.parse(r.body).block : null;
    if (block && /^<style data-fonts\b/.test(block)) {
        await setFonts(id, block);
        void api("POST", "/api/fonts/pick", { work_id: id, display: pick.display, body: pick.body }).catch(() => { });
    } // 선택 기록(#36 추가 3 · 대화)
}
// 내 것(올린 사진·생성본)을 그 칸에(#31) — 파일 경로만 바꾼다(AI 0)
// 폴더(2026-10-07 Figma형) — 초대받은 폴더가 이 PC에 아직 없으면 먼저 받는다
async function ensureFolderHere(folder) {
    const have = await T().core.invoke("work_files", { id: folder }).catch(() => []);
    if (!have.some(f => f.name.startsWith("context/"))) {
        sharedWorks.add(folder);
        await pullWork(folder).catch(() => false);
    }
}
// 폴더 안 작업에서 생긴 자료를 폴더로(2026-10-09) — 이 작업 context/assets·refs에 새로 들어온 파일(올린 사진·문서·받은 글)을 폴더에 복사하고 자료 목록에 넣는다.
// 폴더에 같은 이름이 이미 있으면(폴더에서 가져온 것) 건너뛴다. 사진 설명은 비어 있으면 폴더의 다음 "업데이트 확인"이 채운다(needs_index)
async function folderSync(id) {
    const f = await readJson(id, ".dynapse/folder.json").catch(() => null);
    if (!f?.folder || !WORK_ID.test(f.folder))
        return;
    const [src, dst] = await Promise.all([T().core.invoke("work_dir", { id }).catch(() => null), T().core.invoke("work_dir", { id: f.folder }).catch(() => null)]);
    if (!src || !dst)
        return;
    const mine = (await T().core.invoke("work_files", { id }).catch(() => [])).filter(x => /^context\/(assets|refs)\/[^/]+$/.test(x.name) && !/\.url$/.test(x.name));
    const theirs = new Set((await T().core.invoke("work_files", { id: f.folder }).catch(() => [])).map(x => x.name));
    const sent = new Set((await readJson(id, ".dynapse/folder-sent.json").catch(() => null)) ?? []);
    const todo = mine.filter(x => !sent.has(x.name) && !theirs.has(x.name)).slice(0, 30);
    if (!todo.length)
        return;
    const fileUrl = (p) => `file:///${encodeURI(p.replace(/\\/g, "/").replace(/^\//, ""))}`;
    const copied = [];
    for (const x of todo)
        if (await http("GET", fileUrl(`${src}/${x.name}`), { out: `${dst}/${x.name}` }).then(() => true).catch(() => false))
            copied.push(x.name);
    await wput(id, ".dynapse/folder-sent.json", JSON.stringify([...sent, ...todo.map(x => x.name)].slice(-500))).catch(() => { });
    if (!copied.length)
        return;
    const lib = (await readJson(f.folder, "context/library.json").catch(() => null)) ?? { sources: [], items: [], conflicts: [] };
    const items = lib.items ?? [], today = new Date().toISOString().slice(0, 10);
    for (const c of copied) {
        if (/\.read\.json$/.test(c) || items.some(i => i.file === c))
            continue;
        const base = c.split("/").pop(), img = /\.(png|jpe?g|webp|gif|svg)$/i.test(c), art = /^context\/refs\/url-[^/]+\.md$/.test(c);
        if (img && /^url-/.test(base) && copied.some(o => /^context\/refs\/url-.+\.md$/.test(o)))
            continue; // 글의 본문 사진은 그 글 행에 붙는다
        items.push({ id: `w-${id.slice(4, 10)}-${items.length}`, kind: art ? "article" : img ? "photo" : "other", title: base.replace(/\.[^.]+$/, "").slice(0, 80), file: c,
            ...(art ? { read: copied.includes(c.replace(/\.md$/, ".read.json")) ? c.replace(/\.md$/, ".read.json") : null, images: copied.filter(o => o.startsWith(`context/assets/${base.replace(/\.md$/, "")}`)) } : {}),
            source: { type: "work", ref: id }, updated: today, needs_index: img || !art });
    }
    await wput(f.folder, "context/library.json", JSON.stringify({ ...lib, items }, null, 1)).catch(() => { });
    await repoCommit(f.folder, `작업에서 자료 ${copied.length}개`);
    if (S.sync || sharedWorks.has(f.folder))
        await pushWork(f.folder, dst).catch(() => { });
    await postChat(id, [{ role: "event", text: `폴더에 자료 ${copied.length}개를 넣었어요 · 같은 폴더의 다른 작업에서도 써요`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
}
// 쓴 작업을 폴더 자료에 남긴다(used_in) — 폴더 사람들이 "이 사진이 어디 쓰였나"를 보고, 그 작업의 사람들도 복사본으로 같은 자료를 본다
async function markUsed(folder, files, work) {
    const lib = await readJson(folder, "context/library.json").catch(() => null);
    if (!lib?.items)
        return;
    let changed = false;
    for (const it of lib.items)
        if (it.file && files.includes(it.file) && !(it.used_in ?? []).includes(work)) {
            it.used_in = [...(it.used_in ?? []), work].slice(-50);
            changed = true;
        }
    if (!changed)
        return;
    await wput(folder, "context/library.json", JSON.stringify(lib, null, 1)).catch(() => { });
    await repoCommit(folder, "used_in");
    const dir = await T().core.invoke("work_dir", { id: folder }).catch(() => null);
    if (dir && (S.sync || sharedWorks.has(folder)))
        await pushWork(folder, dir).catch(() => { });
}
async function useFile(id, page0, slot, file) {
    if (!/^[a-z0-9_]{1,40}$/i.test(slot) || !/^(materials|context\/assets)\/(?:[\w.\- ()가-힣]+\/)?[\w.\- ()가-힣]+\.(png|jpe?g|webp)$/i.test(file))
        return; // 하위 폴더 한 단계(#130 보정 4 §3)
    const page = await resolvePage(id, slot, page0);
    if (!page) {
        await postChat(id, [{ role: "event", text: `사진 요청에 장표가 없어요 · ${slot}`, payload: { kind: "error", ai: "dynapse" } }]);
        return;
    }
    await placePhoto(id, page, slot, file, { runtime: file.startsWith("context/") ? "mine" : "generated", hand: true });
    const placed = (await readSlots(id))[slotKey(page, slot)] ?? file;
    await addPending(id, { t: "photo", page, slot, file: placed, label: `${pageLabel(page)} · ${slot}` }); // 모아 저장(#46)
    await photoDone(id, page, slot, placed);
}
// 사진이 실제로 칸에 들어갔다(#87 P0 B) — 웹 사진 패널이 이걸 받아야 "들어갔어요"(요청 접수와 반영을 구분). 채팅엔 보이지 않는다
async function photoDone(id, page, slot, file) {
    // 쓴 사진이 정말 이 PC에 있는지 먼저(#186 — 0.1.74 Windows: 사진 쓰기가 막혔는데 "들어갔어요"가 세 번, 캔버스는 깨진 그림) — 없으면 한 줄(앱 새 판)
    const there = (await T().core.invoke("work_files", { id }).catch(() => [])).some(f => f.name === file && f.size > 0);
    if (!there) {
        report("sync", "photo.write_missing", `file=${file.split("/").pop()}`);
        await postChat(id, [{ role: "event", text: "사진을 이 PC에 저장하지 못했어요 · 앱을 새 판으로 업데이트하면 돼요", payload: { kind: "error", ai: "dynapse" } }]).catch(() => { });
        return;
    }
    await postChat(id, [{ role: "event", text: null, payload: { kind: "photo-done", ai: "dynapse", page, slot, file } }]).catch(() => { });
    void appVerify(id, [page]).catch(() => null); // 사진이 바뀐 장만 다시 점검(#91 §1 — 새 사진 위 글자 대비)
}
async function genPhoto(id, q) {
    const local = (q.ais ?? []).includes("local"); // [이 PC로 만들기](#151 보정 3 ①)
    const ais = local ? ["local"] : (q.ais ?? []).filter((a) => a === "gemini" || a === "chatgpt").slice(0, 2);
    if (!q.slot || !/^[a-z0-9_]{1,40}$/i.test(q.slot) || !ais.length)
        return;
    const page = await resolvePage(id, q.slot, q.page);
    if (!page) {
        await postChat(id, [{ role: "event", text: `사진 요청에 장표가 없어요 · ${q.slot}`, payload: { kind: "error", ai: "dynapse" } }]);
        return;
    }
    const brief = (q.brief ?? "").slice(0, 600) || "A photo that fits this slide";
    // 엔진이 없으면 받기부터(설치 사다리 · 뒤에서 도는 줄) — 준비되면 그대로 이어서 만든다
    if (local) {
        const { ensureLocalPhoto } = await import("./photo-runner.js");
        const st = await ensureLocalPhoto(id);
        if (st !== "ready") {
            await postChat(id, [{ role: "event", text: st === "none" ? "이 PC에 맞는 사진 엔진이 없어요 · 사진 고르기·공개 사진은 지금 쓸 수 있어요" : "이 PC 사진 엔진을 받지 못했어요 · 연결 탭의 이 PC에서 다시 받아 주세요", payload: { kind: "error", ai: "local" } }, { role: "event", text: null, payload: { kind: "photo-fail", ai: "dynapse", page, slot: q.slot } }]).catch(() => { });
            return;
        }
    }
    // AI 줄에서 고른 모델·강도로(대표: 모델을 바꿔 둔 채로 누르면 그 설정으로)
    const OWN = (await import("./image-style.js")).OWN_WORDS; // "이 그림만 다른 톤으로"(#196 보정 1) — 덱 톤을 싣지 않는다
    const r = await genSlotPhoto(id, page, q.slot, ais, brief, q.ratio, q.from && q.text ? { from: q.from, text: q.text.slice(0, 200) } : undefined, { design: [], photo: ais.filter((a) => a !== "local"), models: q.models }, { own: OWN.test(String(q.text ?? "")) });
    if (!r.files.length) {
        await postChat(id, [{ role: "event", text: null, payload: { kind: "photo-fail", ai: "dynapse", page, slot: q.slot } }]).catch(() => { });
        return;
    } // 실패 이유 줄은 genSlotPhoto가 이미 남겼다
    await photoDone(id, page, q.slot, r.files[0]);
    await clickRound(id, `${pageLabel(page)} · 사진${q.text ? ` · ${q.text.slice(0, 20)}` : ""}`, r.ais);
    void afterSave(id);
}
// [이 버전으로](#30) — 그 커밋의 파일 전체로 돌아가는 새 커밋(이력은 남는다) = 새 스레드 항목 r⟨n+1⟩ "r⟨k⟩으로 되돌림". 사진·글 구분 없음. AI 호출 0
// ⌘Z가 AI 턴도(#150 ① — 대표 필름 2차: "제목 더 짧게" 턴 뒤 ⌘Z가 아무것도 안 했다). 직접 수정이 없을 때 웹이 undo-turn을 보낸다.
// 커서 = 지금 보이는 판까지 들어간 마지막 AI 턴(되돌리기 판 제외). ⌘Z = 그 턴 직전 판(round.parent)으로 · ⇧⌘Z = 다음 턴 판(round.commit)으로. 길은 버전 띠의 되돌리기와 같다(restoreTo — 커밋 1).
// 그 사이 다른 커밋(새 턴·직접 수정 저장)이 생기면 커서는 최신으로 돌아가고 다시 하기는 없다. 커서는 .dynapse/out(동기화 안 함)
const TURN_UNDO = ".dynapse/out/turn-undo.json";
const turnRounds = async (id) => ((await readJson(id, ".dynapse/TRACE.json"))?.rounds ?? []).filter(r => r.commit && r.role !== "restore" && r.req?.kind !== "click");
const undoAt = new Map(); // ⇧⌘Z·⌘Z 연타(300ms 안)는 한 번으로(#233 ④)
export async function undoTurn(id) {
    if (Date.now() - (undoAt.get(id) ?? 0) < 300)
        return;
    undoAt.set(id, Date.now());
    const say = (t) => postChat(id, [{ role: "event", text: t, payload: { kind: "stage", ai: "dynapse" } }]);
    const rs = await turnRounds(id), head = await T().core.invoke("repo_head", { id }).catch(() => null);
    // 모양 전환(#178 ④) — 지금 판이 마지막 모양 전환 직후 판과 같으면 그 전환부터 되돌린다(AI 턴과 섞여도 나중 것부터)
    {
        const { FORM_UNDO } = await import("./form-alts.js");
        const fs = (await readJson(id, FORM_UNDO).catch(() => null)) ?? [], top = fs.at(-1);
        const same = top && head ? await T().core.invoke("repo_diffstat", { id, from: top.after, to: head }).then(d => !d.trim()).catch(() => false) : false;
        if (top && same) {
            await wput(id, FORM_UNDO, JSON.stringify(fs.slice(0, -1)));
            await restoreTo(id, top.before, `${pageLabel(top.file)} 모양 되돌림`);
            await say(`${pageLabel(top.file)} 모양을 되돌렸어요`);
            return;
        }
    }
    let st = await readJson(id, TURN_UNDO).catch(() => null);
    if (!st || st.head !== head)
        st = { at: rs.length - 1, head: head ?? "" };
    const r = rs[st.at];
    if (!r?.parent) {
        await say("되돌릴 AI 수정이 없어요");
        return;
    }
    if (!(await restoreTo(id, r.parent, `r${r.n} 전으로 되돌림`)))
        return; // 실패 줄은 restoreTo가 한 번만
    const nh = await T().core.invoke("repo_head", { id }).catch(() => null);
    await wput(id, TURN_UNDO, JSON.stringify({ at: st.at - 1, head: nh ?? "" }));
    const what = String(r.req?.text ?? "").split("\n")[0].replace(/^\[[^\]]*\]\s*/, "").slice(0, 30);
    await say(`r${Math.max(1, r.n - 1)}로 되돌렸어요${what ? ` · “${what}” 고침이 풀렸어요` : ""} · ⇧⌘Z로 다시`);
}
export async function redoTurn(id) {
    const say = (t) => postChat(id, [{ role: "event", text: t, payload: { kind: "stage", ai: "dynapse" } }]);
    const rs = await turnRounds(id), head = await T().core.invoke("repo_head", { id }).catch(() => null);
    const st = await readJson(id, TURN_UNDO).catch(() => null);
    const r = st && st.head === head ? rs[st.at + 1] : null;
    if (!r?.commit) {
        await say("다시 할 것이 없어요");
        return;
    }
    if (Date.now() - (undoAt.get(id) ?? 0) < 300)
        return;
    undoAt.set(id, Date.now());
    if (!(await restoreTo(id, r.commit, `r${r.n} 다시`)))
        return;
    const nh = await T().core.invoke("repo_head", { id }).catch(() => null);
    await wput(id, TURN_UNDO, JSON.stringify({ at: st.at + 1, head: nh ?? "" }));
}
export async function restoreTo(id, sha, label0) {
    if (!S.git)
        return false;
    const trace = (await readJson(id, ".dynapse/TRACE.json")) ?? {};
    const target = (trace.rounds ?? []).find(r => r.commit?.startsWith(sha));
    const n = (trace.rounds?.at(-1)?.n ?? 0) + 1;
    const label = label0 ?? `r${target?.n ?? "?"}으로 되돌림`;
    // 이미 그 버전과 같으면 커밋하지 않는다(#39 — r3 → r1 → r3 왕복이 버전을 늘리지 않게)
    const head = await T().core.invoke("repo_head", { id }).catch(() => null);
    const diff = head ? await T().core.invoke("repo_diffstat", { id, from: sha, to: head }).catch(() => null) : null;
    if (diff !== null && !diff.trim()) {
        await postChat(id, [{ role: "event", text: "이미 이 버전이에요", payload: { kind: "stage", ai: "dynapse" } }]);
        return false;
    }
    // git 잠금(#233 ④ — "fatal: Unable to create … index.lock" 뒤 되돌림 성공 줄이 세 번): 잠깐 뒤 한 번 다시, 그래도 안 되면 실패 한 줄만
    const tryRestore = () => T().core.invoke("repo_restore", { id, sha, message: `r${n} · ${label}` });
    const ok = await tryRestore().catch(async (e) => { if (/index\.lock|Unable to create/i.test(String(e))) {
        await new Promise(r => setTimeout(r, 700));
        return tryRestore();
    } throw e; }).catch(e => { void postChat(id, [{ role: "event", text: `되돌리지 못했어요 · ${String(e).slice(0, 60)}`, payload: { kind: "error", ai: "dynapse" } }]); return null; });
    if (!ok)
        return false;
    const v = await appVerify(id);
    const r = { n, role: "restore", runtime: "dynapse", session_id: "", files: [], req: { text: label, restore: target?.n ?? sha } };
    await saveRound(id, r, label, v);
    await wput(id, ".dynapse/TRACE.json", JSON.stringify({ ...trace, rounds: [...(trace.rounds ?? []), r] }, null, 2));
    await postChat(id, [{ role: "event", text: label, payload: { kind: "shot", ai: "dynapse", round: n, pages: await orderShots(id, r.shots ?? []), commit: r.commit ?? ok, uploaded: !!r.uploaded, ais: ["dynapse"], labels: [label] } }]);
    void afterSave(id);
    return true;
}
// 사진 버전 고르기(대표: "이걸로" 모호 · AI 호출 0) — 칸 바인딩(slots.json)을 그 버전으로, 그 칸을 쓰는 페이지의 사진도 그 파일로. 사진 작업이면 photo 칸
// #42 — 장표+슬롯: 새 이름 materials/⟨page⟩-⟨slot⟩-vN은 이름에서, 예전 materials/⟨slot⟩-vN은 받은 page(없으면 그 슬롯이 있는 장표가 하나일 때만). 사진 작업(결과 장표 없음)만 "photo" 칸
export async function bindPhoto(id, file, page0) {
    const m = file.match(/^materials\/(?:([a-z0-9-]+)-)?([a-z0-9_]{1,40})-v(\d{1,3})\.(png|jpe?g)$/i);
    if (!m)
        return;
    const files = await T().core.invoke("work_files", { id }).catch(() => []);
    if (!files.some(f => f.name === file && f.size > 0)) {
        await postChat(id, [{ role: "event", text: "그 버전 파일이 없어요", payload: { kind: "error", ai: "dynapse" } }]);
        return;
    }
    const pagesAll = files.map(f => f.name).filter(n => PAGE_RE.test(n));
    const slots = await readSlots(id);
    if (!pagesAll.length) {
        await wput(id, ".dynapse/slots.json", JSON.stringify({ ...slots, photo: file }, null, 2));
    } // 사진 작업
    else {
        // 이름의 page 접두사가 실제 장표면 그 장표 · 슬롯
        const byName = m[1] && pagesAll.includes(`result-${m[1]}.html`) ? { page: `result-${m[1]}.html`, slot: m[2] } : null;
        const slot = m[2];
        const page = byName?.page ?? await resolvePage(id, slot, page0);
        if (!page) {
            await postChat(id, [{ role: "event", text: "어느 장표의 사진인지 몰라요", payload: { kind: "error", ai: "dynapse" } }]);
            return;
        }
        const h = await wget(id, page);
        const out = h ? setSlotImg(h, slot, file) : null; // 그 칸 안에서만(빈 칸이면 넣는다 — 옆 사진을 건드리지 않는다)
        if (!out) {
            await postChat(id, [{ role: "event", text: "그 사진 칸을 찾지 못했어요", payload: { kind: "error", ai: "dynapse" } }]);
            return;
        }
        await handPut(id, page, out); // 사용자가 고른 버전 — 가드 밖(#143 §2)
        for (const ed of await editionsOf(id, page)) {
            const eh = await wget(id, ed).catch(() => null);
            const eo = eh ? setSlotImg(eh, slot, file) : null;
            if (eo && eo !== eh)
                await handPut(id, ed, eo);
        } // 언어판에도(#100 보정 4)
        await wput(id, ".dynapse/slots.json", JSON.stringify({ ...slots, [slotKey(page, slot)]: file }, null, 2));
        await addPending(id, { t: "photo", page, slot, file, label: `${pageLabel(page)} · ${slot} v${m[3]}` }); // 모아 저장(#46)
        return;
    }
    const sha = await clickRound(id, `사진 v${m[3]}`, ["dynapse"]); // 사진 작업(결과 장표 없음)은 바로
    if (!sha)
        await postChat(id, [{ role: "event", text: `사진 v${m[3]}로 바꿨어요`, payload: { kind: "stage", ai: "dynapse", file } }]);
    void afterSave(id);
}
// 서버가 결정적으로 채운 파일(#29 C6) — 리워드 표지(브리프 문구)·맞는 재고 사진. 우리 주소(허브·재고 저장소)만, 결과·재료 경로만, 이미 있으면 두지 않는다(사람·AI가 고친 것을 덮지 않게)
async function applyPrefill(id, list) {
    const dir = await T().core.invoke("work_dir", { id });
    const have = new Set((await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name));
    let n = 0;
    // 덱 전 장 + tokens.css(#54 보정 1) — 카드 8장 + 토큰 + 사진까지 · 서로 기다리지 않게 한꺼번에. 파일마다 따로 실패(#54 보정 2 — 하나가 실패해도 턴은 시작)
    const failed = [];
    await Promise.all(list.slice(0, 12).map(async (p) => {
        try {
            if (have.has(p.file) || !/^(result-[a-z0-9-]+\.html|tokens\.css|materials\/[\w.-]+\.(png|jpe?g))$/i.test(p.file))
                return;
            if (!(p.url.startsWith(`${HUB}/`) || /^https:\/\/[a-z0-9.-]+\.public\.blob\.vercel-storage\.com\//.test(p.url)))
                return;
            // tokens.css는 파일로 받는다(work_write는 0.1.53까지 .css를 거부) — 받은 뒤 내용 확인
            if (p.file === "tokens.css") {
                const g = await http("GET", p.url, { out: `${dir}/tokens.css` }).catch(() => null);
                if (g?.status === 200 && /--[\w-]+\s*:/.test((await wget(id, "tokens.css").catch(() => null)) ?? "--x:"))
                    n++;
                else
                    failed.push(p.file);
            }
            else if (p.file.endsWith(".html")) {
                const r = await http("GET", p.url).catch(() => null);
                if (r?.status === 200 && r.body.includes("data-slot")) {
                    await wput(id, p.file, r.body);
                    n++;
                }
            }
            else {
                const g = await http("GET", p.url, { out: `${dir}/${p.file}` }).catch(() => null);
                if (g?.status === 200)
                    n++;
            }
        }
        catch {
            failed.push(p.file);
        }
    }));
    if (failed.length)
        await postChat(id, [{ role: "event", text: `미리 채우기 실패 · ${failed.slice(0, 3).join(", ")}`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
    void n; // 커밋하지 않는다 — 이 요청(첫 턴)의 커밋에 함께 들어간다(#30)
}
// 에이전트용 레이아웃(#29 A6) — 폴더에 한 번(두 무드 CSS + fit()만, 예시 스크립트 없음). 에이전트는 cp 후 Edit(지침 C1)
// 목록은 허브 등록부(layout-registry.json → shared/layout-registry.ts, 2026-10-08) — 덱 세트 전용(materials:false, 보고서)은 빼고
const AGENT_LAYOUTS = LAYOUT_REGISTRY.layouts.filter(l => l.materials).map(l => l.id);
let layoutCache = null;
let layoutChecked = 0;
const sha16 = async (t) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
// 허브의 레이아웃이 바뀌었으면 새 본으로(#44 §3) — 가진 본의 hash를 If-None-Match로, 바뀐 것만 받는다(304 = 그대로). 5분에 한 번 · 오프라인이면 캐시 그대로
async function refreshLayouts(id) {
    layoutCache ??= (await store.get("agent_layouts")) ?? {};
    if (Date.now() - layoutChecked < 5 * 60_000 && AGENT_LAYOUTS.every(l => layoutCache[l]))
        return;
    layoutChecked = Date.now();
    let said = false, changed = false;
    for (const l of AGENT_LAYOUTS) {
        const have = layoutCache[l];
        const r = await http("GET", `${HUB}/api/layouts/${l}`, have ? { headers: [`if-none-match: "${await sha16(have)}"`] } : {}).catch(() => null);
        if (r?.status === 200 && r.body.includes("data-slot")) {
            if (!said && !have) {
                said = true;
                await postChat(id, [{ role: "event", text: "레이아웃 받는 중", payload: { kind: "tool", ai: "dynapse" } }]).catch(() => { });
            }
            layoutCache[l] = r.body;
            changed = true;
        }
    }
    if (changed) {
        await store.set("agent_layouts", layoutCache);
        await store.save();
    }
}
async function ensureLayouts(id, have) {
    await refreshLayouts(id).catch(() => { });
    // 아직 결과 장이 없는 작업(새 작업)은 재료 레이아웃을 최신 본으로 맞춘다 — 이미 만든 장은 그 레이아웃 복사본이라 건드리지 않는다
    const fresh = ![...have].some(f => /^result-[a-z0-9-]+\.html$/.test(f));
    for (const l of AGENT_LAYOUTS)
        if (layoutCache?.[l] && (fresh || !have.has(`materials/${l}.html`)))
            await wput(id, `materials/${l}.html`, layoutCache[l]).catch(() => { });
}
// 나눠 둔 지침(#29 A5) — 핵심은 CLAUDE.md(≤9KB), 리워드·덱·합치기·가져오기는 필요할 때만 여는 .dynapse/skills/*.md
export const SKILL_PARTS = ["reward", "merge", "import", "flip"];
let partsCache = null, partsAt = 0;
async function ensureSkillParts(id, names) {
    if (!partsCache || Date.now() - partsAt > 600_000) {
        partsAt = Date.now();
        const got = {};
        for (const n of SKILL_PARTS) {
            const r = await http("GET", `${HUB}/skills/parts/${n}.md`).catch(() => null);
            if (r?.status === 200 && r.body.startsWith("#"))
                got[n] = r.body;
        }
        if (Object.keys(got).length === SKILL_PARTS.length) {
            partsCache = got;
            await store.set("skill_parts", got);
            await store.save();
        }
        else
            partsCache = (await store.get("skill_parts")) ?? null;
    }
    // .dynapse/skill-⟨이름⟩.md — 작업 폴더 규칙(work_rel)은 .dynapse/skills/ 하위 폴더를 허용하지 않는다(쓰기가 조용히 실패해 리워드 제출이 멈췄다)
    for (const n of SKILL_PARTS)
        if (partsCache?.[n])
            await wputOnce(id, `.dynapse/skill-${n}.md`, partsCache[n], names).catch(() => { });
}
const OLD_RULES = "# 규칙\n톤:\n금지:\n브랜드 색:\n잠근 슬롯:\n협업: 다른 AI가 고칠 땐 .dynapse/NOTES.md 먼저 읽고, 바꾼 이유를 한 줄 남긴다\n";
// 폴더 준비 — 지침·검증 스크립트·저장소·인증 파일(0600). 공개 작업 요청 수락·[내 AI로 만들기]처럼 웹에서 먼저 생긴 작업도 여기서 폴더가 생긴다
// 턴마다 같은 파일을 다시 쓰지 않는다(#54 C11) — 이 앱 세션에서 마지막으로 쓴 내용과 같으면 건너뛴다(밖에서 지웠으면 다시)
const lastWritten = new Map();
async function wputOnce(id, file, text, have) {
    const k = `${id}|${file}`;
    if (lastWritten.get(k) === text && (!have || have.has(file)))
        return;
    await wput(id, file, text);
    lastWritten.set(k, text);
}
export async function prepWork(id) {
    const dir = await T().core.invoke("work_dir", { id });
    let have = await T().core.invoke("work_files", { id }).catch(() => []);
    const has = have.some(f => /^result-/.test(f.name));
    if (!has && (S.sync || sharedWorks.has(id))) {
        await pullWork(id).catch(() => false);
        have = await T().core.invoke("work_files", { id }).catch(() => []);
    }
    else if (has && (S.sync || sharedWorks.has(id)))
        void syncLatest(id, "turn").catch(() => false); // 턴 전 — 판이 다르면 카드만(ota16, 자동으로 받지 않는다)   // 다른 기기에서 만든 작업 — 동기화 사본을 받는다
    const names = new Set(have.map(f => f.name));
    const skill = await workflowSkill(), tb = await tierBundles().catch(() => null);
    if (tb) {
        for (const f of ["CLAUDE.md", "AGENTS.md"])
            await wputOnce(id, f, tb.light, names);
        await wputOnce(id, ".dynapse/skill-normal.md", tb.normal, names);
        await wputOnce(id, ".dynapse/skill-heavy.md", tb.heavy, names);
        if (tb.layouts)
            await wputOnce(id, ".dynapse/layouts.md", tb.layouts, names);
        for (const [k, t] of Object.entries(tb.rules ?? {}))
            await wputOnce(id, `.dynapse/rules-${k}.md`, t, names);
    } // 턴 등급(#123) · 슬롯 지도 전체는 필요할 때만 읽는 파일로(#167 ①)
    else if (skill)
        for (const f of ["CLAUDE.md", "AGENTS.md"])
            await wputOnce(id, f, skill, names);
    if (has && (await readJson(id, ".dynapse/engine.json").catch(() => null))?.now !== "raw") {
        const { redrawCharts } = await import("./viz.js");
        await redrawCharts(id, "turn").catch(() => 0);
    } // 옛 판 차트는 턴 전에 다시 그린다(#102 보정 3) — AI가 옛 그림을 보고 고치지 않게
    await ensureSkillParts(id, names);
    await ensureVerify(id);
    // 규칙 파일은 만들지 않는다(#130 보정 1) — 사용자가 규칙을 말하면 그때 한 줄로. 옛 빈 템플릿(OLD_RULES 그대로)은 열 때 조용히 지운다(verify 요청 파일 — 그 파일·그 내용일 때만)
    if (have.some(f => f.name === "context/RULES.md") && ((await wget(id, "context/RULES.md").catch(() => null)) ?? "").replace(/\r\n?/g, "\n").trim() === OLD_RULES.trim()) {
        await wput(id, ".dynapse/rm-rules.json", "{}").catch(() => { });
        const r = await exec("node", [".dynapse/verify.mjs"], undefined, dir).catch(() => null);
        if (/"removed":true/.test(r?.stdout ?? ""))
            await repoCommit(id, "빈 규칙 파일 정리");
    }
    await flatPhotos(id, have.map(f => f.name)).catch(() => 0); // 하위 폴더 사진 펴기(#130 보정 4) — 턴 전에(고친 덱이 이번 턴에 낫는다)
    {
        let sl = 0;
        for (const pg of have.map(f => f.name).filter(f => /^result-[a-z0-9-]+\.html$/.test(f) || LANG_PAGE.test(f))) {
            const h0 = await wget(id, pg).catch(() => null);
            if (!h0)
                continue;
            const r = repairStyleLeak(h0);
            if (r.n) {
                sl += r.n;
                await wput(id, pg, r.html).catch(() => { });
            }
        }
        if (sl && S.git)
            await repoCommit(id, `CSS 새어 나온 곳 정리 ${sl}곳`);
    } // #91 보정 2 — 이미 새어 나온 덱은 다음 요청 전에
    // 레이아웃(#54 C11) — 재료가 이미 다 있으면 최신 확인은 뒤에서(턴을 기다리게 하지 않는다)
    if (!names.has(".dynapse/imported.json")) {
        const missing = AGENT_LAYOUTS.some(l => !names.has(`materials/${l}.html`)) || !has;
        if (missing)
            await ensureLayouts(id, names);
        else
            void refreshLayouts(id).catch(() => { });
    }
    if (S.git && !(await T().core.invoke("repo_head", { id }).catch(() => null)))
        await repoCommit(id, "작업실 시작");
    // 가져온 HTML의 재료(#24-보정) — 링크 폴더에 있는데 아직 안 복사된 것이 있으면 조용히 복사(턴 전)
    await T().core.invoke("resolve_refs", { id }).catch(() => null); // 복사만 — 이 요청의 커밋에 함께(#30)
    if (S.token && lastWritten.get(`${id}|secret`) !== S.token) {
        await T().core.invoke("work_secret", { id, name: "mcp-config", text: JSON.stringify({ mcpServers: { dynapse: { type: "http", url: MCP_URL, headers: { Authorization: `Bearer ${S.token}` } } } }) });
        await T().core.invoke("work_secret", { id, name: "auth-header", text: `Authorization: Bearer ${S.token}\n` });
        lastWritten.set(`${id}|secret`, S.token);
    }
    return dir;
}
// 역할 줄 — 사용자가 고른 AI를 에이전트에게(데이터가 아니라 앱이 붙이는 지시). 디자인 둘 = 공동(너가 쓰고 다른 AI가 검토), 사진 둘 = 비교, 사진 0 = 재고만
export function routeLine(r, self) {
    if (!r)
        return "";
    // 사진은 앱 러너가 만든다(#29 C3) — 에이전트는 칸마다 요청만 적는다. 재고는 get_template의 slots(임계점 적용)가 이미 골라 둔다
    const other = r.design.find(a => a !== self);
    const th = r.photo_first ? 0.85 : 0.6;
    const ai = r.photo.length ? r.photo.map(a => AI_LABEL[a]).join(" and ") : "";
    const photo = ai
        ? `Photos: user's own (context/assets) → the stock in get_template slots (score ≥ ${th}) → otherwise add {file: "result-<page>.html", slot, brief, ratio} to .dynapse/photo-requests.json (file = the page it belongs to — the app changes only that page) and the app generates them with ${ai} after your turn (list every slot that needs one; on a first build the app makes the cover first and the user chooses how many more; never call agy/codex yourself; never shrink images yourself — the app does it; never claim a generated photo matches the brief — the user checks)`
        : `Photos: user's own (context/assets) → stock that fits (get_template slots or recommend_assets) → otherwise — if the user's message asks for photos or images, keep the photo slots and list them in turn.json empty_slots (the app then offers my photo · stock · make with an AI); if it does not, do not leave an empty photo box: switch that page to its no-photo layout (set data-variant="nophoto" on its <section class="slide">) when the layout has one, else leave the slot empty and list it in turn.json empty_slots. Never generate photos — the user has not turned on a photo AI. Never present a no-photo page as done when the user asked for photos`;
    const design = other ? `Design: you (${AI_LABEL[self]}) edit, then ask ${AI_LABEL[other]} to review this folder (\`codex exec -c project_doc_max_bytes=0\` / \`claude -p\`)` : `Design: you (${AI_LABEL[self]})`;
    return `[Roles for this message — chosen by the user] ${design} · ${photo}. Reply to the user in Korean.\n`;
}
// 첫 턴 기다리는 동안 배우기(#142 추가 4 ④·⑤) — 이 PC의 첫 AI 턴에만, 세 줄을 10초·35초·70초에(턴이 끝나면 멈춤). 첫 줄이 첫 결과까지 시간("첫 덱까지 약 2분")
// 첫 대기(#142 추가 6 순간 4) — 웹과 같은 문구(shared/i18n onb.tip1~3), 10초 간격 한 번
const TEACH = [ONB.tip1, ONB.tip2, ONB.tip3];
async function teachFirstTurn(id) {
    if (await store.get("taught_first").catch(() => true))
        return;
    await store.set("taught_first", true).catch(() => { });
    await store.save().catch(() => { });
    for (const [i, ms] of [10_000, 20_000, 30_000].entries())
        setTimeout(() => { if ([...sessions.values()].some(x => x.busy))
            void postChat(id, [{ role: "event", text: TEACH[i], payload: { kind: "stage", ai: "dynapse", teach: i + 1 } }]).catch(() => { }); }, ms);
}
export async function chatSend(id, text, opts = {}) {
    if (userStopped(id)) {
        report("turn", "turn.stopped_skip", "");
        return;
    } // [중단] 뒤 — 사용자가 새로 말할 때까지 턴을 열지 않는다(#311)
    const route = opts.route;
    const readyClaude = S.tools.claude.installed && S.tools.claude.loggedIn !== false, readyCodex = S.tools.codex.installed && S.tools.codex.loggedIn !== false;
    const readyAgy = S.ag.installed && S.ag.loggedIn === true; // Gemini 편집(#153 ①) — Antigravity CLI가 로그인돼 있으면 편집 주체도 된다
    // 이 PC(#113) — 작업실 AI 줄에서 고른 경우, 또는 구독 AI가 없고 이 PC 엔진이 준비된 경우. 에이전트 세션 없이 결정적 러너로
    // 리워드는 이 PC로 하지 않는다(#113 §5 — 제출 provider에 local 없음)
    const isReward = /\((?:slide|deck) reward, task_id=/i.test(text) || rewardWorks.has(id);
    if (!isReward && (route?.design?.[0] === "local" || (!readyClaude && !readyCodex && !readyAgy && localReady()))) {
        // AI 계정이 없으면 묻지 않고 이 PC 모델로(#142 추가 6 순간 2) — 한 줄 "느리지만 돼요 · ChatGPT를 더하면 빨라져요" + 연결 카드는 그대로(더 빠르게 하려면)
        if (route?.design?.[0] !== "local")
            await postChat(id, [{ role: "event", text: ONB.local_model, payload: { kind: "stage", ai: "dynapse" } }, { role: "event", text: null, payload: { kind: "need-ai", ai: "dynapse" } }]);
        const { runLocalTurn } = await import("./fill-runner.js");
        await runLocalTurn(id, opts.raw ?? text, opts);
        return;
    }
    // 고른 AI가 먼저 · 없으면 Claude → ChatGPT → Gemini(하나면 돼요, #153 ①)
    const want = route?.design?.[0] === "chatgpt" && readyCodex ? "codex" : route?.design?.[0] === "gemini" && readyAgy ? "agy" : readyClaude ? "claude" : readyCodex ? "codex" : readyAgy ? "agy" : null;
    // 오프라인(#146 §3) — AI는 인터넷이 필요하다: 이 PC 엔진이 준비돼 있으면 묻지 않고 이 PC로, 없으면 요청을 보관하고 연결되면 바로 시작(리워드는 보관만)
    if (want && netState() !== "online" && !opts.queueItem && opts.queueItem !== 0) {
        if (!isReward && localReady()) {
            await postChat(id, [{ role: "event", text: "인터넷이 끊겨 이 PC로 해요", payload: { kind: "stage", ai: "dynapse" } }]);
            const { runLocalTurn } = await import("./fill-runner.js");
            await runLocalTurn(id, opts.raw ?? text, opts);
            return;
        }
        holdTurn(id, opts.raw ?? text);
        report("turn", "net.held", `ai=${want}`);
        await postChat(id, [{ role: "event", text: "요청을 보관했어요 · 연결되면 바로 시작해요", payload: { kind: "stage", ai: "dynapse" } }]);
        return;
    }
    if (want)
        void teachFirstTurn(id).catch(() => { });
    // 장 단위 병렬(#191) — 다른 장의 장 턴이 도는 중이면 기다리지 않고 두 번째 세션(그 장만 쓰게 잠금). 덱 턴·같은 장·Claude 5시간 창 10% 미만·옛 네이티브면 줄
    let laneKey = null;
    if (want && opts.page) {
        const L = await import("./lanes.js");
        const busy = [...sessions.entries()].filter(([k, x]) => k.startsWith(`${id}|`) && (x.busy || x.starting)).map(([, x]) => ({ page: x.turnPage ?? null, scope: x.turnScope ?? null })); // 여는 중인 세션도 도는 것으로(#272 ②)
        const five = S.claudeLimit?.unifiedWindows?.five_hour?.utilization;
        const max = Number(await store.get("lanes_max").catch(() => null)) || L.LANES_DEFAULT;
        if (L.laneOk({ busy, page: opts.page, scope: opts.scope ?? null, tool: want, feature: !!S.app?.features?.includes("commit_paths"), capLow: five != null && five >= 0.9, max }))
            laneKey = `${id}|${want}|lane:${opts.page}`;
        if (busy.length)
            report("turn", "lane.pick", `lane=${laneKey ? 1 : 0} busy=${busy.length} page=${opts.page}`); // 기록 ①(#272 ② journey_lanes) — 두 번째 장 지시가 병렬 세션을 얻었나
    }
    const key = laneKey ?? `${id}|${want ?? "none"}`;
    let s = sessions.get(key);
    if (!s) {
        const tool = want;
        if (!tool) { // 연결 전(#20) — 메시지는 버리지 않고 기다렸다가 로그인되면 이어서
            waiting.push({ id, text, opts });
            await postChat(id, [{ role: "event", text: null, payload: { kind: "need-ai", ai: "dynapse" } }]);
            void import("./main.js").then(m => m.autoConnect()).catch(() => { }); // 첫 요청에 AI가 없으면 ChatGPT 로그인을 곧바로(#142 추가 3) — 연결되면 이 요청이 저절로
            return;
        }
        const trace = await readJson(id, ".dynapse/TRACE.json");
        const rt = rtOf(tool);
        // 이어받을 세션(#29 A8) — 턴마다 갱신하는 .dynapse/session.json 먼저(저장 안 된 턴 뒤에도), 없으면 TRACE rounds
        const sj = await readJson(id, ".dynapse/session.json");
        const prev = sj?.[rt] || [...(trace?.rounds ?? [])].reverse().find(r => r.runtime === rt && r.session_id)?.session_id;
        const remembered = (await readJson(id, ".dynapse/allow.json").catch(() => null)) ?? [];
        s = { tool, ai: tool === "claude" ? "claude" : tool === "agy" ? "gemini" : "chatgpt", sessionId: laneKey ? undefined : prev, busy: false, queue: [], lastAt: Date.now(), out: [], verifyN: 0, fixups: 0, extraAllow: remembered.filter(x => typeof x === "string" && /^[\w]+(\(.{1,120}\))?$/.test(x)).slice(0, 30),
            extraDirs: ((await readJson(id, ".dynapse/allow-dirs.json").catch(() => null)) ?? []).filter(okDir).slice(0, 8) };
        sessions.set(key, s);
    }
    if (laneKey && opts.page) {
        const L = await import("./lanes.js");
        s.lanePage = opts.page;
        s.laneDeny = L.laneDeny(opts.page, (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name));
    } // 병렬 세션은 새 대화 · 그 장만 쓴다(#191)
    if (!s.busy) {
        s.turnPage = opts.page ?? null;
        s.turnScope = opts.scope ?? null;
    }
    s.auto = route?.auto_approve !== false; // 자동 승인(#27 A, 기본 켜짐)
    if (opts.library)
        s.library = true;
    if (opts.drive)
        s.drive = true;
    if (opts.connectors?.length)
        s.connectors = [...new Set([...(s.connectors ?? []), ...opts.connectors])]; // 한 번 보인 커넥터는 그 세션에 계속                                                  // Drive 링크를 받은 작업(한 번 켜지면 그 세션은 커넥터가 보인다)
    if (opts.folderDir !== undefined)
        s.folderDir = opts.folderDir; // 내 자료함(한 번 켜지면 그 작업 세션은 계속 자료함)
    if (route)
        s.route = route; // 사진 요청(#29 C3)은 턴 뒤 이 AI 줄로
    if (route?.design?.[0] && route.design[0] !== s.ai)
        s.out.push({ role: "event", text: `${AI_LABEL[route.design[0]]}가 연결돼 있지 않아 ${AI_LABEL[s.ai]}가 맡아요`, payload: { kind: "error", ai: "dynapse" } });
    if (route?.design?.length)
        await wput(id, ".dynapse/team.json", JSON.stringify(teamToFile({ merge: route.design[0], design: route.design, photo: route.photo, chosen: null }), null, 2)).catch(() => { }); // AI 줄(#16B) → team.json
    const pick = route?.models?.[s.ai];
    // 작업에서 안 고르면 홈 AI 카드의 기본 모델(#21 보정 12)
    s.model = pick?.model || S.defaultModels[s.ai] || null;
    s.effort = slotsTurn.has(id) ? "low" : pick?.effort || "low"; // 칸 글 턴(#275 ②)은 늘 낮음 — 실측: 생각 1.8k 토큰이 첫 장을 20초 늦췄다
    // Codex 칸 글 턴은 세 줄로(#275 보정 2 ① — 실측: 한 줄 6장 34~47초, 세 줄 15초): 이 세션이 첫 줄(표지 쪽), 나머지 줄은 같은 폴더에 codex exec를 동시에(턴마다 한 번 · 각 줄은 자기 장 번호만 쓴다)
    {
        const st = slotsTurn.get(id);
        if (st && want === "codex" && !st.lanes) {
            const S2 = await import("./slots.js"), L = S2.laneSplit(st.raw, st.pages, 3);
            if (L.length >= 2) {
                st.lanes = [];
                text = `${S2.slotsInstruction({ menu: st.menu, lane: L[0] })}\n${st.raw}`;
                const dir = await T().core.invoke("work_dir", { id }).catch(() => null), mo = s.model && codexModelOk(s.model) ? ["-m", s.model] : [];
                if (dir)
                    for (const l of L.slice(1))
                        st.lanes.push(exec("codex", ["exec", "--json", "--skip-git-repo-check", ...mo, "-c", 'model_reasoning_effort="low"', "-s", "workspace-write", "-c", "sandbox_workspace_write.network_access=true", "-C", dir, "-"], `${S2.slotsInstruction({ menu: st.menu, lane: l })}\n${st.raw}`, dir)
                            .then(r => report("turn", "slots.lane", `from=${l.from} code=${r.code} ms=${Date.now() - st.t0}`)).catch(e => report("turn", "slots.lane_fail", `from=${l.from} ${String(e).slice(0, 80)}`)));
                report("turn", "slots.lanes", `n=${L.length} pages=${st.pages}`);
            }
        }
    } // 고르지 않으면 낮음(대표 2026-10-01 — 덱 실측 끝까지 47초·토큰 절반, 문구 비슷). 한 작업 안에서 강도가 섞이지 않아 프로세스 재시작도 없다
    // 가벼운 편집 턴(#51 §4) — 📍·글자·폰트·직접 수정 뒤 정리는 Sonnet 5 · 보통. AI 줄에서 고른 모델이 있으면 그것
    // #54 C8 전제 — 모델이 바뀌면 지금은 Claude 프로세스를 다시 띄워(캐시 없는 재처리 5~30초) 오히려 느리다. 모델별 프로세스 유지(C8) 뒤에 켠다
    s.noRefusalRetry = !!opts.refusalRetry;
    s.queueItem = opts.queueItem;
    s.lightAuto = false;
    s.light = !!opts.light;
    s.scope = opts.scope;
    s.viz = !!opts.viz;
    s.vizRetried = false;
    s.motion = !!opts.motion;
    // 고른 모델 > 연결 탭 기본 > 등급 자동(#306 — 가벼운 턴이 사용자가 고른 Opus를 Sonnet으로 덮었다): 자동 Sonnet은 둘 다 없을 때만
    if (LIGHT_SONNET && opts.light) {
        const { modelFor } = await import("./model-pick.js"), mp = modelFor({ ai: s.ai, pick: pick?.model ?? null, dflt: S.defaultModels[s.ai] ?? null, light: true });
        if (mp.auto) {
            s.model = mp.model;
            s.effort = pick?.effort || "low";
            s.lightAuto = true;
        }
    }
    // 배치·공간 말 = 보통 강도·기본(가벼운 Sonnet 아님) · "다시 해봐"류 되풀이 = 앞 턴 모델 그대로(#233 ③)
    {
        const raw = opts.raw ?? "";
        if (raw && SPACE_WORDS.test(raw) && !pick?.model) {
            s.model = S.defaultModels[s.ai] || null;
            if (!pick?.effort)
                s.effort = "medium";
            s.lightAuto = false;
            report("turn", "turn.space_route", `ai=${s.ai}`);
        }
        const lm = lastModelOf.get(id);
        if (raw && REPEAT_RE.test(raw) && lm && !pick?.model) {
            s.model = lm.model;
            s.effort = lm.effort ?? s.effort;
            s.lightAuto = false;
        }
        if (raw)
            lastModelOf.set(id, { model: s.model ?? null, effort: s.effort ?? null });
    }
    if (opts.receivedAt)
        s.tm = { received: opts.receivedAt }; // 기본 강도 = 보통(대표 2026-09-26: 한 턴 7분은 길다). AI 줄에서 고르면 그 값
    s.bounded = opts.bounded ?? null;
    s.boundTry = 0;
    s.photoShapeTry = 0;
    s.boundPts = opts.bounded ? (opts.points ?? []).slice(0, 6) : []; // 📍 경계(#193)
    if (opts.raw !== undefined) {
        s.pointed = opts.scope === "deck" ? [] : (opts.points ?? []).slice(0, 6);
        s.pointTry = 0;
    } // 짚은 자리 맞춤 검사(#231) — 사용자 요청 턴만(고침·이어서 보내기는 앞 값 그대로)
    s.capLeft = opts.capLeft ?? null; // 작업 남은 상한(#29 A10 — 예전엔 주석 뒤에 있어 실행되지 않았다)
    // [승인]·[건너뛰기] 답(#22-보정 3) — 승인이면 막힌 도구를 이 세션에 한 번 더 허용하고 이어서
    // 상한 카드의 답(#27 B) — 이어서 = 같은 세션에서 마무리(부분 읽기), 그만 = 아무것도 안 함
    // 상한에서 [여기서 끝내기] — 사용자가 여기까지로 정했다: 지금까지 바뀐 것을 그 요청의 커밋 하나로(#30)
    if (/^(Claude|ChatGPT): (그만|여기서 끝내기)$/.test(text)) {
        if (S.git && (await T().core.invoke("repo_changed", { id }).catch(() => [])).length) {
            await repoCommit(id, `${(s.requestText ?? "요청").slice(0, 180)} (여기까지)`);
            void afterSave(id);
        }
        return;
    }
    // 요청 원문(#127 §4) — 커밋·버전 이름은 사용자 문장. 조립된 머리(커넥터·폴더 안내 등)가 커밋 이름이 되던 것. 리워드 수락은 "리워드 수락 · 제목"
    const raw0 = (opts.raw ?? text).replace(/^\[📍[^\n]*\n[\s\S]*?\nRequest: /, ""), rw = raw0.match(/\((?:slide|deck) reward, task_id=(task_[a-z0-9]+)\)/i);
    let request = rw ? `리워드 수락 · ${raw0.replace(rw[0], "").replace(/\s+/g, " ").trim().slice(0, 60) || rw[1]}` : raw0;
    if (!/^(Claude|ChatGPT): (이어서|이어서 하기)$/.test(text) && !/^이어서$/.test(text.trim()))
        s.autoCont = 0; // 새 요청이면 자동 이어서 횟수를 되돌린다(#138)
    if (/^(Claude|ChatGPT): (이어서|이어서 하기)$/.test(text) || /^이어서$/.test(text.trim())) {
        text = "Finish the work that was stopped by the token cap. Do not re-read large files whole — use grep -n and partial reads; do mechanical changes with one script.";
        request = null;
    }
    if (s.pendingAllow?.length && /: (승인|건너뛰기)$/.test(text)) {
        const allow = /: 승인$/.test(text);
        if (allow) {
            s.extraAllow = [...new Set([...(s.extraAllow ?? []), ...s.pendingAllow])];
            s.respawn = true;
            await wput(id, ".dynapse/allow.json", JSON.stringify(s.extraAllow, null, 2)).catch(() => { }); // 이 작업에 기억 — 같은 질문 두 번 없음(#27)
            if (s.pendingDirs?.length) {
                s.extraDirs = [...new Set([...(s.extraDirs ?? []), ...s.pendingDirs])].slice(-8);
                await wput(id, ".dynapse/allow-dirs.json", JSON.stringify(s.extraDirs, null, 2)).catch(() => { });
            }
        }
        s.pendingDirs = [];
        s.pendingAllow = [];
        text = allow ? "Re-run the command that was just blocked and continue." : "Continue as far as you can without that command.";
        request = null;
    }
    s.autoRetry = 0;
    if (s.failedText) {
        text = `Earlier request that failed to start — do it now:\n${s.failedText}\n\nUser now says: ${text}`;
        s.failedText = undefined;
    }
    // 역할 줄은 바뀔 때만(#29 C7). 턴 도중 온 메시지는 다음 턴 하나로 합친다
    const rl = routeLine(route, s.ai);
    const head = rl && rl !== s.routeSent ? rl : "";
    if (head)
        s.routeSent = rl;
    s.reqQueue ??= [];
    // 한 작업에 턴은 하나씩(#97 보정 2) — 다른 AI 세션이 같은 작업에서 돌고 있으면 그 턴이 끝난 뒤에
    if (!laneKey) {
        const other = [...sessions.entries()].find(([k, x]) => k.startsWith(`${id}|`) && x !== s && (x.busy || x.starting));
        if (other) {
            (other[1].afterIdle ??= []).push({ text, opts });
            report("turn", "lane.after_idle", `page=${opts.page ?? "-"}`);
            return;
        }
    } // 기록 ②: 다른 세션 뒤로 미뤘다
    // 대기 줄마다 그 요청의 장(#267 보정 2 — 새 대화 장 턴의 대상). 합쳐진 줄(Also:)은 장이 섞일 수 있어 null
    s.pageQ ??= new Map();
    if (s.busy && s.queue.length) {
        s.pageQ.delete(s.queue[s.queue.length - 1]);
        s.queue[s.queue.length - 1] += `\n\nAlso: ${head}${text}`;
        const k = s.reqQueue.length - 1;
        if (request)
            s.reqQueue[k] = s.reqQueue[k] ? `${s.reqQueue[k]} · ${request}` : request;
    }
    else {
        if (request && opts.page)
            s.pageQ.set(head + text, opts.page);
        if (s.pageQ.size > 20)
            s.pageQ.clear();
        s.queue.push(head + text);
        s.reqQueue.push(request);
    }
    if (!s.busy)
        await nextTurn(id, s);
}
// 보이는 진행 문구(#22-보정 14) — 결과물에 닿는 것만: ⟨페이지⟩ 읽는/쓰는 중 · 사진 만드는 중 · ⟨AI⟩ · 사진 넣는 중 · 확인 중 n/3 · 제출됨 · 저장됨.
// 나머지(.dynapse 내부·지시 파일·토큰·레시피·재료 읽기·git·ls·cat)는 로그 접힘에만(kind "log")
// 로그는 턴당 한 행(#29 B7 — 도구 호출마다 행을 저장하던 것). 턴 끝(finishTurn)에 lines로 한 번
export function eventLog(s, text) {
    if (!text.trim())
        return;
    (s.logBuf ??= []).push(text.slice(0, 160));
}
function flushLogs(s) {
    if (!s.logBuf?.length)
        return;
    // 서버 payload 한도(8KB) 안으로 — 넘치면 몇 행으로 나눈다(그래도 도구마다 한 행보다 훨씬 적다)
    let lines = [];
    const out = () => { if (lines.length)
        s.out.push({ role: "event", text: lines.at(-1) ?? "", payload: { kind: "log", ai: s.ai, lines } }); lines = []; };
    for (const l of s.logBuf.slice(0, 400)) {
        if (JSON.stringify([...lines, l]).length > 7000)
            out();
        lines.push(l);
    }
    out();
    s.logBuf = [];
}
export function chatEvent(id, s, text, payload = {}) {
    if (!text || text === s.lastStage)
        return; // 같은 단계가 이어지면 한 줄만
    s.lastStage = text;
    s.lastEvAt = Date.now();
    s.out.push({ role: "event", text, payload: { kind: "tool", ai: s.ai, ...(s.runModel && !payload.ai ? { model: s.runModel } : {}), ...payload } });
}
// Codex 대화별 지난 누적 사용량(위 turn.completed) — 앱을 다시 켜도 이어지게 저장(최근 60개)
const codexTotals = new Map();
let codexLoaded = false; // 저장본은 첫 줄에서 한 번 읽는다(모듈을 읽을 때는 store가 아직 없다 — 앱 시작에서 만든다). turn.completed는 한참 뒤에 온다
export function chatLine(id, s, l) {
    let d;
    try {
        d = JSON.parse(l);
    }
    catch {
        return;
    }
    const sid = d.session_id ?? d.thread_id;
    if (sid)
        s.sessionId = sid;
    if (!codexLoaded && store) {
        codexLoaded = true;
        void store.get("codex_totals").then(v => { for (const [k, x] of v ?? [])
            if (!codexTotals.has(k))
                codexTotals.set(k, x); }).catch(() => { });
    }
    // 실제 모델 — Claude system/init·result.modelUsage, Codex 이벤트의 model. 없으면 표시하지 않는다(추정 금지)
    if (d.type === "system" && d.subtype === "init" && typeof d.model === "string")
        s.runModel = d.model;
    else if (typeof d.model === "string" && /^(gpt-|o\d|codex)/i.test(d.model))
        s.runModel = d.model;
    if (d.type === "result" && d.modelUsage && typeof d.modelUsage === "object" && !(s.runModel && s.runModel in d.modelUsage)) {
        const top = Object.entries(d.modelUsage).sort((a, b) => (b[1].outputTokens ?? 0) - (a[1].outputTokens ?? 0))[0]?.[0];
        if (top)
            s.runModel = top;
    }
    const stage = (name, target) => {
        const mcp = name.match(/^mcp__dynapse__(.+)$/);
        if (mcp)
            return MCP_STAGE[mcp[1]] ?? null;
        if (/verify\.mjs/.test(target)) {
            s.verifyN++;
            return `확인 중 ${Math.min(s.verifyN, 3)}/3`;
        }
        return stageFromTool(name, target);
    };
    const push = (name, target, useId) => {
        // 시간 분해(#51) — 첫 도구·첫 파일 쓰기, 도구별 횟수·시간. Claude는 tool_use→tool_result 실제 실행 시간(#54 보정 1 — 예전엔 "다음 도구까지"라
        // 모델이 생각하는 시간이 앞 도구에 붙었다: 실측 턴의 "Grep 51초"는 Grep 0초 + 생각 47초). Codex는 id가 없어 예전 방식
        const now = Date.now();
        s.tm ??= {};
        s.tm.spawned ??= s.tm.start ?? now;
        s.tm.first_tool ??= now;
        if (s.lastTool && s.lastToolAt) {
            const x = (s.tools ??= {})[s.lastTool] ??= { n: 0, ms: 0 };
            x.ms += now - s.lastToolAt;
            s.lastTool = undefined;
        }
        const tn = name.replace(/^mcp__dynapse__/, "").replace(/_file$/, "");
        ((s.tools ??= {})[tn] ??= { n: 0, ms: 0 }).n++;
        if (useId)
            (s.toolOpen ??= {})[useId] = { n: tn, t: now };
        else {
            s.lastTool = tn;
            s.lastToolAt = now;
        }
        if (s.mx && /^Read$/.test(name) && /(skill[\w-]*\.md|RULES|CLAUDE\.md|AGENTS\.md|dynapse-workflow)/i.test(target))
            s.mx.skill++; // 지침 다시 읽기(#29 재발 감시)
        if (/write|edit|replace|create|apply|patch/i.test(name) && /result-[a-z0-9-]+\.html|tokens\.css/.test(target) || /\b(cp|copy)\b[^\n]*result-[a-z0-9-]+\.html/.test(target))
            s.tm.first_write ??= now;
        const t = stage(name, target);
        if (!t) {
            eventLog(s, `${name}${target ? ` ${target}` : ""}`);
            // 조용한 도구도 드물게(#45) — 마지막 이벤트 뒤 15초가 지나면 사람 말 한 줄
            if (Date.now() - (s.lastEvAt ?? 0) > 15_000) {
                const q = quietStage(name, target);
                if (q)
                    chatEvent(id, s, q);
            }
            return;
        }
        const sub = /(^|\s|\/)agy(\s|$)/.test(target) ? "gemini" : /codex\s+exec/.test(target) && s.tool === "claude" ? "chatgpt" : undefined;
        // 카드의 대상 파일(#17) — 작업 폴더 안 결과·사진이면 웹이 링크로(누르면 결과 창에 그 파일)
        const m = target.match(new RegExp(`(?:works/${id}/)?((?:result-[a-z0-9-]+\\.html)|(?:materials|\\.dynapse/photos|\\.dynapse/out|context/assets)/[\\w.-]+\\.(?:png|jpe?g))`, "i"));
        chatEvent(id, s, t, { ...(sub ? { ai: sub } : {}), ...(m ? { file: m[1] } : {}) });
    };
    if (d.type === "assistant")
        for (const c of d.message?.content ?? [])
            if (c.type === "tool_use") {
                if (c.name === "mcp__dynapse__ask_user")
                    s.asked = true;
                if (c.name === "mcp__dynapse__merge_report" && typeof c.input?.from_work === "string")
                    s.merged = { work_id: c.input.from_work, commit_sha: typeof c.input.from_commit === "string" ? c.input.from_commit : null };
                push(c.name ?? "", String(c.input?.file_path ?? c.input?.path ?? c.input?.command ?? ""), typeof c.id === "string" ? c.id : undefined);
            }
    if (d.type === "user" && Array.isArray(d.message?.content))
        for (const c of d.message.content)
            if (c?.type === "tool_result" && s.toolOpen?.[c.tool_use_id]) {
                const o = s.toolOpen[c.tool_use_id];
                delete s.toolOpen[c.tool_use_id];
                const x = (s.tools ??= {})[o.n] ??= { n: 0, ms: 0 };
                x.ms += Date.now() - o.t;
                s.toolMs = (s.toolMs ?? 0) + Date.now() - o.t;
            }
    // Gemini(agy stream-json, #153 ① 실측) — init(conversation_id·model) · step_update(도구 ACTIVE/DONE/ERROR) · result(status·response·usage)
    if (d.event === "init") {
        if (typeof d.conversation_id === "string")
            s.sessionId = d.conversation_id;
        if (typeof d.init?.model === "string")
            s.runModel = d.init.model;
    }
    if (d.event === "step_update" && d.step_update?.step_type === "tool" && d.step_update.state === "ACTIVE") {
        const su = d.step_update, nm = String(su.tool_name ?? ""), pr = (su.tool_info?.parameters ?? {});
        const tgt = String(pr.TargetFile ?? pr.AbsolutePath ?? pr.FilePath ?? pr.CommandLine ?? pr.Command ?? "");
        push(/write_to_file|create_file/.test(nm) ? "Write" : /replace|edit|patch/.test(nm) ? "Edit" : /view_file|read_file/.test(nm) ? "Read" : /run_command/.test(nm) ? "run" : /grep|find|list_dir/.test(nm) ? "Grep" : nm, tgt);
    }
    if (d.event === "result" && d.result) {
        const r = d.result;
        s.agyStatus = r.status;
        if (r.error)
            s.agyError = r.error;
        if (typeof r.response === "string" && r.response.trim())
            s.lastText = r.response;
        const u = r.usage ?? {}, cached = u.cache_read_tokens ?? 0;
        s.usage = { tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.thinking_tokens ?? 0), cached, parts: { input: u.input_tokens ?? 0, output: (u.output_tokens ?? 0) + (u.thinking_tokens ?? 0), cache_write: 0, cache_read: cached } };
        s.liveTok = s.usage.tokens;
    }
    if (d.item?.type === "command_execution" && d.type !== "item.completed")
        push("run", String(d.item.command ?? ""));
    if (d.item?.type === "file_change")
        push("write", String(d.item.changes?.[0]?.path ?? ""));
    if (d.item?.type === "mcp_tool_call" && d.type !== "item.completed")
        push(`mcp__dynapse__${d.item.tool ?? ""}`, "");
    if (d.item?.type === "agent_message" && typeof d.item.text === "string")
        s.lastText = d.item.text;
    // 사용량(#18) — Claude result.usage·total_cost_usd · Codex turn.completed.usage. 남은 양은 Claude rate_limit_event만(다른 CLI는 주지 않는다 — 실측)
    if (d.type === "rate_limit_event" && d.rate_limit_info) {
        S.claudeLimit = d.rate_limit_info;
        reportLimits();
        // 턴의 한도 사용(Claude Design 등 같은 구독과 비교하는 공통 기준) — 5시간 창 사용률의 턴 시작·끝
        const u = d.rate_limit_info.unifiedWindows?.five_hour?.utilization;
        if (typeof u === "number") {
            if (s.quota0 === undefined)
                s.quota0 = u;
            s.quota1 = u;
        }
    }
    // 턴 도중 토큰(#27 B) — 응답마다 usage를 더해 상한(턴 400k · 작업 남은 몫)을 넘으면 프로세스를 멈추고 선택 카드
    {
        const mu = d.type === "assistant" ? d.message?.usage : null, mid = d.message?.id;
        // 캐시 재사용 제외(표시와 같은 기준). 방금 --resume으로 띄운 프로세스의 첫 응답은 대화 전체를 캐시에 다시 쓴다 → 상한에는 안 센다(#29 A10 — kill→이어서→kill 루프)
        if (mu && mid && !s.seenMsg?.has(mid)) {
            s.seenMsg?.add(mid);
            const cw = s.freshSpawn ? 0 : (mu.cache_creation_input_tokens ?? 0);
            s.freshSpawn = false;
            s.liveTok = (s.liveTok ?? 0) + (mu.input_tokens ?? 0) + (mu.output_tokens ?? 0) + cw;
            s.ctxPeak = Math.max(s.ctxPeak ?? 0, (mu.input_tokens ?? 0) + (mu.cache_creation_input_tokens ?? 0) + (mu.cache_read_input_tokens ?? 0)); // 이 응답이 읽은 대화 크기(#213 보정 1 — 창의 70%면 다음 턴은 새 대화)
            // 등급 상한용(#123 보정 1) — 턴 첫 응답의 입력·캐시 쓰기(이어 받은 대화를 처음 읽는 양, 모델이 바뀌면 15만+)는 빼고 출력만. 캐시 재사용은 어디서도 안 센다
            s.tierTok = (s.tierTok ?? 0) + (mu.output_tokens ?? 0) + ((s.tierMsgs ?? 0) === 0 ? 0 : (mu.input_tokens ?? 0) + (mu.cache_creation_input_tokens ?? 0));
            s.tierMsgs = (s.tierMsgs ?? 0) + 1;
        }
        // Codex는 input_tokens에 캐시 재사용(cached_input_tokens)을 포함해 알려 준다 → 빼고 센다(902k 오경보). 끝난 턴(turn.completed)에서는 멈추지 않는다
        if (d.type === "turn.completed" && d.usage)
            s.liveTok = Math.max(0, (d.usage.input_tokens ?? 0) - (d.usage.cached_input_tokens ?? 0)) + (d.usage.output_tokens ?? 0);
        // 상한 — Claude는 프로세스를 죽이지 않고 스트림 인터럽트(세션·캐시 유지, result가 온다), Codex는 exec 하나라 멈춘다
        // 등급 상한(#123) — 넘으면 인터럽트로 지금까지를 검사·저장(#120 "여기까지" 경로). 사용자 상한 카드(TURN_CAP)와 따로
        // 처음 20초·응답 2번까지는 멈추지 않는다(#123 보정 1 — 가벼운 턴이 2초 만에 죽었다)
        const tierN = s.tool === "claude" ? (s.tierTok ?? 0) : (s.liveTok ?? 0), tierWarm = Date.now() - (s.tierT0 ?? 0) >= 20_000 && (s.tool !== "claude" || (s.tierMsgs ?? 0) >= 2);
        if (d.type !== "turn.completed" && d.type !== "result" && s.busy && !s.capped && !s.tierHit && s.tierCap && tierWarm && tierN >= s.tierCap && s.procId !== undefined) {
            s.tierHit = true;
            if (s.tool === "claude") {
                s.interrupted = true;
                void T().core.invoke("run_write", { id: s.procId, line: JSON.stringify({ type: "control_request", request_id: `tier-${Date.now()}`, request: { subtype: "interrupt" } }) }).catch(() => { });
            }
            else
                void T().core.invoke("run_kill", { id: s.procId }).catch(() => { });
        }
        if (d.type !== "turn.completed" && d.type !== "result" && s.busy && !s.capped && s.cap && (s.liveTok ?? 0) >= s.cap && s.procId !== undefined) {
            s.capped = true;
            if (s.tool === "claude") {
                s.interrupted = true;
                void T().core.invoke("run_write", { id: s.procId, line: JSON.stringify({ type: "control_request", request_id: `cap-${Date.now()}`, request: { subtype: "interrupt" } }) }).catch(() => T().core.invoke("run_kill", { id: s.procId }).catch(() => { }));
            }
            else
                void T().core.invoke("run_kill", { id: s.procId }).catch(() => { });
        }
    }
    // 이어 쓴 Codex 대화(resume)의 turn.completed 사용량은 그 대화의 누적이다(2026-10-22 실측: 30초 턴에 출력 81k, 턴마다 커지기만 함) → 같은 대화의 지난 누적을 빼서 이번 턴만 센다
    if (d.type === "turn.completed" && d.usage && s.sessionId) {
        const k = String(s.sessionId), now = { i: d.usage.input_tokens ?? 0, c: d.usage.cached_input_tokens ?? 0, o: d.usage.output_tokens ?? 0, r: d.usage.reasoning_output_tokens ?? 0 }, prev = codexTotals.get(k);
        codexTotals.set(k, now);
        if (codexTotals.size > 60)
            codexTotals.delete(codexTotals.keys().next().value);
        void store.set("codex_totals", [...codexTotals]).then(() => store.save()).catch(() => { });
        if (prev && now.i >= prev.i && now.o >= prev.o)
            d.usage = { ...d.usage, input_tokens: now.i - prev.i, cached_input_tokens: Math.max(0, now.c - prev.c), output_tokens: now.o - prev.o, reasoning_output_tokens: Math.max(0, now.r - prev.r) };
    }
    if (d.type === "turn.completed" && d.usage) {
        const u = d.usage;
        const cached = u.cached_input_tokens ?? 0;
        s.usage = { tokens: Math.max(0, (u.input_tokens ?? 0) - cached) + (u.output_tokens ?? 0) + (u.reasoning_output_tokens ?? 0), cached,
            parts: { input: Math.max(0, (u.input_tokens ?? 0) - cached), output: (u.output_tokens ?? 0) + (u.reasoning_output_tokens ?? 0), cache_write: 0, cache_read: cached } };
    } // 캐시 재사용 제외(Claude와 같은 기준)
    if (d.type === "result") {
        const u = d.usage ?? {};
        // 표시·상한 토큰 = 새로 읽고 쓴 양(입력 + 출력 + 캐시 생성). 캐시 재사용(같은 맥락을 도구마다 다시 읽는 것)은 빼고 따로 싣는다 — "1297k"가 과장돼 보이던 것
        // total_cost_usd는 살아 있는 세션 프로세스의 누적값 — 턴 비용 = 지난 턴 누적과의 차(프로세스가 새로 뜨면 0부터)
        const tot = typeof d.total_cost_usd === "number" ? d.total_cost_usd : undefined;
        const turnUsd = tot === undefined ? undefined : s.costPid === s.procId && s.costBase !== undefined && tot >= s.costBase ? tot - s.costBase : tot;
        if (tot !== undefined) {
            s.costBase = tot;
            s.costPid = s.procId;
        }
        s.usage = { tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), cached: u.cache_read_input_tokens ?? 0, usd: turnUsd,
            parts: { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cache_write: u.cache_creation_input_tokens ?? 0, cache_read: u.cache_read_input_tokens ?? 0 } };
        if (s.usage.usd && s.usage.tokens)
            s.usdPerTok = s.usage.usd / s.usage.tokens;
        // 권한으로 막힌 도구(#22-보정 3) — Claude result.permission_denials
        const den0 = Array.isArray(d.permission_denials) ? d.permission_denials : [];
        // 앱 몫 경로(번들·PNG .dynapse/out, auth-header, mcp-config, 자격 폴더)를 읽으려다 막힌 것은 묻지 않는다 — 거부가 답(도구 결과 한 줄로 에이전트가 넘어간다). 작업 폴더 안 읽기는 애초에 묻지 않는다(#120 보정 1)
        const refusedRead = (x) => /^(Read|Glob|Grep)$/.test(String(x.tool_name ?? "")) && REFUSED_PATH.test(String(x.tool_input?.file_path ?? x.tool_input?.path ?? x.tool_input?.pattern ?? ""));
        const den = den0.filter(x => !refusedRead(x));
        // 거부 목록(DENY, --disallowedTools)에 걸린 명령은 allow로 못 푼다(#127 보정 3) — 승인 후보에서 빼고 "Write/Edit로" 안내 한 번
        const denyCmd = (x) => x.tool_name === "Bash" && !!x.tool_input?.command && deniedByList(String(x.tool_input.command));
        if (den.some(denyCmd))
            s.denyHit = true;
        if (s.lanePage && den.some(x => /^(Edit|Write|MultiEdit)$/.test(String(x.tool_name ?? ""))))
            s.laneBlocked = true; // 병렬 장 턴이 다른 장·공유 파일을 쓰려 했다(#191) — 턴 끝에 앞 턴 뒤로
        s.denied = [...new Set(den.filter(x => !denyCmd(x)).flatMap(x => x.tool_name === "Bash" && x.tool_input?.command ? bashRules(String(x.tool_input.command)) : [String(x.tool_name ?? "")]).filter(Boolean))].slice(0, 6);
        // 명령은 허용돼도 작업 밖 폴더는 따로 막힌다(대표 2026-10-09 "승인했는데 또 막혔다") — 그 명령·도구가 가리킨 폴더를 함께 승인 대상으로
        s.deniedDirs = [...new Set(den.flatMap(x => deniedPaths(x)))].slice(0, 4);
        s.lastText = typeof d.result === "string" ? d.result : s.lastText;
        if (s.interrupted && s.capped) {
            s.interrupted = false;
            void capStop(id, s);
            return;
        }
        // 등급 상한으로 멈춘 턴 — 오류가 아니다: 지금까지를 검사·저장하고 한 줄만(다시 보내지 않는다)
        if (s.interrupted && s.tierHit) {
            s.interrupted = false;
            void endTurn(id, s, true);
            return;
        }
        if (d.subtype === "error_max_budget_usd") {
            void capStop(id, s, "work");
            return;
        }
        if (d.subtype === "error_max_turns") {
            void capStop(id, s, "steps");
            return;
        } // 한 턴 단계 한도 — 고장이 아니라 일이 길었던 것
        // 그 밖의 실패는 이유를 붙인다(대표 2026-10-10 "왜 멈췄는지 모르는데 고장난 것처럼 보여주면 안 된다")
        // 이어받을 대화가 이 PC의 CLI에 없다(2026-10-14 turn.fail_claude ×3 — 다른 PC·계정의 세션 id가 session.json에 남아 매번 같은 id로 이어받다 끝났다):
        // 그 id를 지우고 같은 요청을 새 대화로 한 번 다시
        if (d.subtype !== "success" && /No conversation found with session ID/i.test((s.errTail ?? []).join("\n")) && !s.freshRetried && s.turnText) {
            s.freshRetried = true;
            const again = s.turnText, rt = rtOf(s.tool);
            s.sessionId = undefined;
            s.sidByWant = {};
            report("turn", "turn.session_missing", `tool=${s.tool}`);
            void (async () => {
                const sj = (await readJson(id, ".dynapse/session.json").catch(() => null)) ?? {};
                delete sj[rt];
                await wput(id, ".dynapse/session.json", JSON.stringify(sj, null, 1)).catch(() => { });
                await endTurn(id, s, false, "지난 대화를 이 PC에서 찾지 못해 새 대화로 다시 해요");
                await chatSend(id, again, { route: s.route });
            })();
            return;
        }
        if (d.subtype !== "success") {
            const last = (s.errTail ?? []).filter(l => l.trim()).at(-1);
            void endTurn(id, s, false, last ? `${AI_LABEL[s.ai]}가 실행 중 오류로 끝났어요 · ${last.trim().slice(0, 120)}` : undefined);
            return;
        } // 작업 상한 예산(--max-budget-usd)으로 끝난 턴도 같은 선택 카드 — 오류·자동 보고가 아니다(대표 2026-10-10)   // 상한 인터럽트로 끝난 턴 → 선택 카드(프로세스는 살아 있다)
        void endTurn(id, s, d.subtype === "success");
    }
}
async function pptxRoundtrip(id, name) {
    const r = await T().core.invoke("pptx_roundtrip", { id, name }).catch(() => null);
    if (!r?.dynapse || !r.manifest || !r.shapes)
        return false;
    const norm = (t) => t.replace(/\s+/g, " ").trim();
    const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const near = (a, b) => Math.abs(a - b) < 7620 * 3; // 3px 안이면 같은 자리
    let texts = 0, photos = 0, moved = r.extra ?? 0;
    for (const sh of r.shapes) {
        const dot = sh.name.indexOf(".");
        const page = sh.name.slice(0, dot), key = sh.name.slice(dot + 1);
        const pg = r.manifest.pages[page];
        if (!pg)
            continue;
        if (sh.kind === "text") {
            const m = pg.texts[key];
            if (!m)
                continue;
            if (!near(sh.x, m.x) || !near(sh.y, m.y))
                moved++;
            // 부드러운 줄바꿈(앱이 넣은 줄 자리) — #164부터 PPTX엔 U+200B가 없다(PowerPoint가 그 자리에서 다시 접었다). 표시는 manifest 글에만 남아 있어, 그 앞뒤 글자가 같은 줄바꿈을 지운다(<br>로 바꾸지 않는다). 예전 PPTX의 U+200B도 그대로 지운다
            const { softJoin, manifestPlain } = await import("./pptx-soft.js");
            const t0 = softJoin(sh.text ?? "", m.text);
            if (norm(t0) === norm(manifestPlain(m.text)))
                continue;
            const html = await wget(id, pg.file);
            if (!html)
                continue;
            const neu = esc(t0.trim()).replace(/\n/g, "<br>");
            const out = textAtSel(html, m.sel, m.inner, neu);
            if (!out)
                continue;
            await wput(id, pg.file, out);
            await addPending(id, { t: "text", page: pg.file, old: m.inner, neu, nth: 0, sel: m.sel, label: `${pageLabel(pg.file)} · ${(sh.text ?? "").slice(0, 20)}` });
            texts++;
        }
        else if (sh.file) {
            const m = pg.pics[key];
            if (!m)
                continue;
            if (!near(sh.x, m.x) || !near(sh.y, m.y))
                moved++;
            await placePhoto(id, pg.file, key, sh.file, { runtime: "mine", hand: true });
            const placed = (await readSlots(id))[slotKey(pg.file, key)] ?? sh.file;
            await addPending(id, { t: "photo", page: pg.file, slot: key, file: placed, label: `${pageLabel(pg.file)} · ${key}` });
            photos++;
        }
        else {
            const m = pg.pics[key];
            if (m && (!near(sh.x, m.x) || !near(sh.y, m.y)))
                moved++;
        }
    }
    const seen = (await readJson(id, ".dynapse/roundtrip.json").catch(() => null)) ?? [];
    await wput(id, ".dynapse/roundtrip.json", JSON.stringify([...new Set([...seen, name])])).catch(() => { }); // 문서 머리 줄(docHead)에서 뺀다
    await postChat(id, [{ role: "event", text: `PPTX에서 글 ${texts}곳 · 사진 ${photos}장 반영${moved ? ` · 배치 변경 ${moved}곳은 반영 안 됨` : ""}${texts + photos ? " · 입력창 위에서 [보내기]로 저장" : ""}`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
    return true;
}
// 번역 턴(#74 §3) — "영어로 바꿔줘" 같은 요청은 글자 칸만: 앱이 페이지에서 글자 요소(자기 글자가 있는 가장 바깥 요소)를 뽑고, 번역문만 보조 호출(#51 §4 보정 2)로 받아
// 같은 자리에 넣는다. 레이아웃·사진·토큰은 건드리지 않는다. 결과는 버전 하나(원문은 버전 띠에 남는다). 줄 수는 비슷하게, 넘치면 글을 줄인다(상자는 그대로)
const LANGS = { 스페인어: { code: "es", name: "Spanish" }, 프랑스어: { code: "fr", name: "French" }, 독일어: { code: "de", name: "German" }, 베트남어: { code: "vi", name: "Vietnamese" }, 태국어: { code: "th", name: "Thai" }, 인도네시아어: { code: "id", name: "Indonesian" }, 포르투갈어: { code: "pt", name: "Portuguese" }, 이탈리아어: { code: "it", name: "Italian" }, 러시아어: { code: "ru", name: "Russian" }, spanish: { code: "es", name: "Spanish" }, french: { code: "fr", name: "French" }, german: { code: "de", name: "German" }, portuguese: { code: "pt", name: "Portuguese" }, vietnamese: { code: "vi", name: "Vietnamese" }, 영어: { code: "en", name: "English" }, 영문: { code: "en", name: "English" }, 일본어: { code: "ja", name: "Japanese" }, 중국어: { code: "zh", name: "Simplified Chinese" }, 한국어: { code: "ko", name: "Korean" }, 한글: { code: "ko", name: "Korean" }, english: { code: "en", name: "English" }, japanese: { code: "ja", name: "Japanese" }, korean: { code: "ko", name: "Korean" } };
// 언어판 요청(#100 보정 2) — 짧은 메시지 어디에 있어도: "한국어판 만들어 줘" · "IR EN 한국어 버전도 만들어줘" · "영어로 번역해 줘" · "make a Korean version" · "translate to Japanese"
export const translateIntent = (t0) => {
    const t = t0.trim();
    if (t.length > 160)
        return null;
    const L = Object.keys(LANGS).sort((a, b) => b.length - a.length).join("|"), pick = (x) => LANGS[x.toLowerCase()] ?? LANGS[x] ?? null;
    const v = t.match(new RegExp(`(${L})\\s*(?:판|버전|version|edition)\\s*(?:을|를|도|으로|로)?\\s*(?:하나\\s*)?(?:도\\s*)?(?:만들|추가|생성|뽑|create|make)`, "i")) ?? t.match(new RegExp(`(?:make|create|add) (?:an? |the )?(${L}) (?:version|edition)`, "i"))
        ?? t.match(new RegExp(`(?:전부|모두|전체를?|글자?만?)?\\s*(${L})\\s*(?:로|으로)\\s*(?:도\\s*)?(?:바꿔|번역|옮겨|만들)`, "i")) ?? t.match(new RegExp(`translate (?:it |this |all |the deck )?(?:in)?to (${L})\\b`, "i"));
    return v ? pick(v[1]) : null;
};
// ── 언어판(#100) ── 한 작업 안에 result-<장>.<lang>.html. 구조(레이아웃·변형·조절·사진)는 앱이 결정적으로 따라가게 하고 글만 번역 보조 턴으로.
// .dynapse/lang.json = { base, src: { <lang>: { <원문 장>: { <글 칸 경로>: 번역할 때의 원문 글 } } } } · .dynapse/lang-status.json = { base, langs, stale: { <lang>: [원문 장] } }(웹 토글·배지)
export const LANG_PAGE = /^result-([a-z0-9-]+)\.(en|ko|ja|zh|es|fr|de|vi|th|id|pt|it|ru|ar|hi)\.html$/;
// 짚은 요소 전후(#231) — 같은 선택자(없으면 칸 + 글 앞부분으로 다시 찾기)의 하위 트리가 같으면 miss, 못 찾으면 gone. 앱이 붙이는 data-dyn* 표시는 비교에서 뺀다
export function pointedState(before, after, p) {
    if (typeof DOMParser === "undefined")
        return "hit";
    const P = new DOMParser(), a = P.parseFromString(before, "text/html"), b = P.parseFromString(after, "text/html");
    const q = (d, s) => { try {
        return s ? d.querySelector(s) : null;
    }
    catch {
        return null;
    } };
    const bySlot = (d) => { if (!p.slot)
        return null; const xs = Array.from(d.querySelectorAll(`[data-slot="${p.slot.replace(/"/g, "")}"]`)); const t = (p.text ?? "").slice(0, 12); return xs.find(x => t && (x.textContent ?? "").includes(t)) ?? xs[0] ?? null; };
    const ea = q(a, p.selector) ?? bySlot(a), eb = q(b, p.selector) ?? bySlot(b);
    if (!eb)
        return "gone";
    if (!ea)
        return "hit";
    const norm = (e) => e.outerHTML.replace(/\sdata-dyn[-a-z]*="[^"]*"/g, "").replace(/<br data-dyn[^>]*>/g, "").replace(/\s+/g, " ").trim();
    return norm(ea) === norm(eb) ? "miss" : "hit";
}
// 언어판 제목 어긋남(#229 보정 1) — 턴 시작(startPages)과 지금의 제목 칸(…title·…headline)을 판마다 비교: 바뀐 판이 있고 같은 장의 다른 판은 그대로면 그 판들
const TITLE_SLOT = /<([a-z0-9]+)\b[^>]*\bdata-slot\s*=\s*["']([a-z0-9_]*(?:title|headline)[a-z0-9_]*)["'][^>]*>([\s\S]*?)<\/\1>/gi;
const titlesOf = (h) => [...h.matchAll(TITLE_SLOT)].map(m => `${m[2]}=${m[3].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()}`).join("|");
const langLabel = (f) => { const l = f.match(LANG_PAGE)?.[2]; return l === "en" ? "영어판" : l === "ko" ? "한국어판" : l ? `${l}판` : "원문"; };
export async function staleEditions(id, s) {
    const st = s.startPages;
    if (!st?.size)
        return [];
    const keyOf = (f) => f.replace(LANG_PAGE, "result-$1.html"), groups = new Map();
    for (const f of st.keys())
        groups.set(keyOf(f), [...(groups.get(keyOf(f)) ?? []), f]);
    const out = [];
    for (const fs of groups.values()) {
        if (fs.length < 2)
            continue;
        const now = new Map();
        for (const f of fs)
            now.set(f, titlesOf((await wget(id, f).catch(() => null)) ?? st.get(f)));
        const changed = fs.filter(f => now.get(f) !== titlesOf(st.get(f)));
        if (!changed.length)
            continue;
        for (const f of fs)
            if (!changed.includes(f))
                out.push({ file: f, from: changed[0] });
    }
    return out;
}
const LANG_NAME = { en: "English", ko: "Korean", ja: "Japanese", zh: "Simplified Chinese", es: "Spanish", fr: "French", de: "German", vi: "Vietnamese", th: "Thai", id: "Indonesian", pt: "Portuguese", it: "Italian", ru: "Russian", ar: "Arabic", hi: "Hindi" };
const verOf = (base, lang) => base.replace(/\.html$/, `.${lang}.html`);
const baseOf = (f) => { const m = f.match(LANG_PAGE); return m ? `result-${m[1]}.html` : f; };
// 글 칸(번역 대상) — 자기 글이 있는 가장 바깥 요소. 사진·쪽번호·스크립트·그린 차트(#102)는 빼고. 경로 = body부터 nth-child
function textLeaves(doc) {
    const path = (el) => { const parts = []; for (let e = el; e && e.tagName !== "BODY"; e = e.parentElement) {
        const pa = e.parentElement;
        if (!pa)
            break;
        parts.unshift(`${e.tagName.toLowerCase()}:nth-child(${Array.from(pa.children).indexOf(e) + 1})`);
    } return `body > ${parts.join(" > ")}`; };
    const out = [], picked = [];
    for (const el of Array.from(doc.body.querySelectorAll("*"))) {
        if (/^(SCRIPT|STYLE|SVG|TITLE)$/i.test(el.tagName) || el.closest("svg,figure,[data-kind=photo],[data-slot=page_no],[data-viz-out]"))
            continue;
        if (!Array.from(el.childNodes).some(n => n.nodeType === 3 && (n.textContent ?? "").trim()))
            continue;
        if (picked.some(a => a.contains(el)))
            continue;
        picked.push(el);
        const text = el.innerHTML.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\u2060/g, "").trim();
        if (text && /[\p{L}]/u.test(text))
            out.push({ el, sel: path(el), text });
    }
    return out;
}
let trCache = null;
async function trRules(L) {
    if (!trCache || Date.now() - trCache.at > 600_000) {
        const r = await http("GET", `${HUB}/skills/copy-lint.json`).catch(() => null);
        let j = {};
        try {
            j = r?.status === 200 ? (JSON.parse(r.body).translate ?? {}) : {};
        }
        catch { /* */ }
        trCache = { at: Date.now(), j };
    }
    return trCache.j[L] ?? {};
}
const glossLines = (g) => (Array.isArray(g) ? g.map(x => [x.from, x.to]) : Object.entries(g ?? {})).map(([a, b]) => `${a} → ${b}`);
// 사용자가 언어판에서 손으로 고친 문구(#100 보정 5) — .dynapse/lang-fixes.json [{lang, from, to, at}]. 다음 번역에서 덱 용어집으로 먼저 지킨다. 이 PC 밖으로 보내지 않는다
let teamAcct = null;
async function isTeamAccount() { if (teamAcct && Date.now() - teamAcct.at < 600_000)
    return teamAcct.v; const r = await api("GET", "/api/lang-fixes").catch(() => null); teamAcct = { v: r?.status === 200 && !!r.data?.team, at: Date.now() }; return teamAcct.v; }
async function langFixes(id, L) { const a = (await readJson(id, ".dynapse/lang-fixes.json").catch(() => null)) ?? []; return a.filter(x => x.lang === L && x.from && x.to).slice(-60); }
// 차트 글(#100 보정 4) — data-viz JSON 안의 글(제목·결론·라벨·계열 이름·항목 이름/설명·출처). 숫자·type·icon·id는 그대로. 경로 = viz:<차트 순번>:<키 경로>
const VIZ_TEXT_KEYS = /^(takeaway|title|label|labels|name|sub|source|text|who|center|top|bottom|note|caption|when|before|after|items)$/;
function vizLeaves(doc) {
    const out = [];
    Array.from(doc.querySelectorAll("[data-viz]")).forEach((el, k) => {
        let sp;
        try {
            sp = JSON.parse(el.getAttribute("data-viz") ?? "");
        }
        catch {
            return;
        }
        const walk = (v, path, textKey) => {
            if (typeof v === "string") {
                if (path[path.length - 1] === "text" && /^(m|l|xl)$/.test(v))
                    return;
                if (textKey && /[\p{L}]/u.test(v) && !/^(#|https?:|materials\/|context\/)/.test(v))
                    out.push({ el, sel: `viz:${k}:${path.join(".")}`, text: v, path });
                return;
            }
            if (Array.isArray(v)) {
                v.forEach((x, i) => walk(x, [...path, i], textKey));
                return;
            }
            if (v && typeof v === "object")
                for (const [key, x] of Object.entries(v))
                    if (!/^(type|icon|id|src|unit|highlight|text_tier)$/.test(key))
                        walk(x, [...path, key], VIZ_TEXT_KEYS.test(key) || (textKey && typeof x !== "object"));
        };
        walk(sp, [], false);
    });
    return out;
}
function setVizLeaf(doc, sel, val) {
    const m = sel.match(/^viz:(\d+):(.*)$/);
    if (!m)
        return false;
    const el = doc.querySelectorAll("[data-viz]")[Number(m[1])];
    if (!el)
        return false;
    let sp;
    try {
        sp = JSON.parse(el.getAttribute("data-viz") ?? "");
    }
    catch {
        return false;
    }
    const keys = m[2].split(".").map(x => (/^\d+$/.test(x) ? Number(x) : x));
    let o = sp;
    for (const k of keys.slice(0, -1)) {
        o = o?.[k];
        if (o == null)
            return false;
    }
    const last = keys[keys.length - 1];
    if (typeof o?.[last] !== "string")
        return false;
    const was = o[last];
    o[last] = val;
    if (typeof sp.highlight === "string" && sp.highlight === was)
        sp.highlight = val; // 강조가 이름으로 가리키면 같이 바꾼다
    el.setAttribute("data-viz", JSON.stringify(sp));
    return true;
}
const parseH = (h) => new DOMParser().parseFromString(h, "text/html");
const serialH = (d) => `<!doctype html>\n${d.documentElement.outerHTML}`;
// 구조 골격 — 글 칸 내용·차트 글(#100 보정 4)·글꼴 블록을 비운 문서(이게 다르면 구조가 바뀐 것)
// 앱이 매번 다시 계산하는 것(줄 맞춤·자동 맞춤 #125·#126)은 구조가 아니다 — 영어·한국어는 글 길이가 달라 늘 다르고, 그게 장마다 원문↔언어판 옮겨 쓰기를 부르던 원인(#127)
function skelOf(h) { const d = parseH(h); d.querySelectorAll("[data-dyn-fit]").forEach(e => e.removeAttribute("data-dyn-fit")); d.querySelectorAll('br[data-dyn="widow"],style[data-dyn]').forEach(e => e.remove()); for (const l of textLeaves(d))
    l.el.innerHTML = ""; for (const l of vizLeaves(d))
    setVizLeaf(d, l.sel, ""); d.querySelectorAll("[data-viz]").forEach(e => { e.innerHTML = ""; }); d.querySelectorAll("style[data-fonts]").forEach(x => x.remove()); d.documentElement.removeAttribute("lang"); return d.documentElement.outerHTML; }
// 구조는 donor에서, 글은 textSrc에서(같은 경로의 글 칸) · 글꼴 블록과 html lang은 textSrc 것(언어별 글꼴 허용)
function transplant(donor, textSrc) {
    const d = parseH(donor), t = parseH(textSrc), byPath = new Map(textLeaves(t).map(l => [l.sel, l.el.innerHTML]));
    for (const l of textLeaves(d)) {
        const v = byPath.get(l.sel);
        if (v !== undefined)
            l.el.innerHTML = v;
    }
    {
        const tv = new Map(vizLeaves(t).map(l => [l.sel, l.text]));
        for (const l of vizLeaves(d)) {
            const v = tv.get(l.sel);
            if (v !== undefined)
                setVizLeaf(d, l.sel, v);
        }
    } // 언어판의 차트 글은 그대로(#100 보정 4)
    const tf = t.querySelector("style[data-fonts]"), df = d.querySelector("style[data-fonts]");
    if (tf && df)
        df.replaceWith(d.importNode(tf, true));
    else if (tf && !df)
        d.head.appendChild(d.importNode(tf, true));
    const lg = t.documentElement.getAttribute("lang");
    if (lg)
        d.documentElement.setAttribute("lang", lg);
    return serialH(d);
}
async function langFiles(id) {
    const names = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name);
    const vers = names.filter(n => LANG_PAGE.test(n));
    return { bases: names.filter(n => PAGE_RE.test(n)), vers, langs: [...new Set(vers.map(v => v.match(LANG_PAGE)[2]))] };
}
// 원문 글이 번역할 때와 달라진 장 = "번역 안 됨"
async function writeLangStatus(id) {
    const { bases, vers, langs } = await langFiles(id);
    if (!langs.length)
        return;
    const meta = (await readJson(id, ".dynapse/lang.json")) ?? {}, stale = {};
    for (const b of bases) {
        const h = await wget(id, b).catch(() => null);
        if (!h)
            continue;
        const dh = parseH(h), leaves = [...textLeaves(dh), ...vizLeaves(dh)]; // 차트 글도 "번역 안 됨" 판단에(#100 보정 4)
        for (const L of langs) {
            if (!vers.includes(verOf(b, L))) {
                (stale[L] ??= []).push(b);
                continue;
            }
            const src = meta.src?.[L]?.[b] ?? {};
            if (leaves.some(l => src[l.sel] !== l.text))
                (stale[L] ??= []).push(b);
        }
    }
    // 원문 언어(#100 보정 3) — 기록이 없으면 첫 장 글자로(예전 기본값 "ko"는 영어 덱을 "한 | 한"으로 보이게 했다)
    let base = meta.base && !langs.includes(meta.base) ? meta.base : null;
    if (!base) {
        const order = (await readPages(id).catch(() => null)) ?? [], f0 = order.find(f => bases.includes(f)) ?? bases[0], h0 = f0 ? (await wget(id, f0).catch(() => null)) ?? "" : "";
        const tx = h0.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "").replace(/<[^>]+>/g, " ");
        base = (tx.match(/[가-힣]/g) ?? []).length * 2.5 > (tx.match(/[A-Za-z]/g) ?? []).length ? "ko" : "en";
    }
    await wput(id, ".dynapse/lang-status.json", JSON.stringify({ base, langs, stale })).catch(() => { });
}
// 구조 따라가기 — 바뀐 장의 구조를 다른 언어판에(글 칸은 그대로). 원문 장에 언어판이 없으면 원문을 복사해 둔다(번역 안 됨)
// 칸마다 사진 옮기기 — 원본(donor)의 data-slot 칸 사진 src와 그 img의 object-position·data-focus를 대상 장의 같은 칸에
function copyPhotos(donor, target) {
    let out = target;
    const d = parseH(donor);
    for (const el of Array.from(d.querySelectorAll("[data-slot]"))) {
        const img = (el.tagName === "IMG" ? el : el.querySelector("img"));
        const src = img?.getAttribute("src");
        const slot = el.getAttribute("data-slot") ?? "";
        if (!src || !/^[a-z0-9_]{1,40}$/i.test(slot) || /^data:/.test(src))
            continue;
        const next = setSlotImg(out, slot, src);
        if (!next)
            continue;
        out = next;
        const pos = img.style.objectPosition, focus = img.getAttribute("data-focus");
        if (pos || focus) {
            const t = parseH(out), te = t.querySelector(`[data-slot="${slot}"]`), ti = (te?.tagName === "IMG" ? te : te?.querySelector("img"));
            if (ti && (ti.style.objectPosition !== pos || ti.getAttribute("data-focus") !== focus)) {
                if (pos)
                    ti.style.objectPosition = pos;
                if (focus)
                    ti.setAttribute("data-focus", focus);
                out = "<!doctype html>\n" + t.documentElement.outerHTML;
            }
        }
    }
    return out;
}
// 원문 장 하나를 바꾼 뒤 언어판에도(구조·사진·차트) — 바뀐 언어판이 있으면 커밋 한 줄
async function syncLangsCommit(id, base) {
    const t = (await syncLangs(id, [base]).catch(() => [])) ?? [];
    if (t.length && S.git)
        await repoCommit(id, `언어판 맞춤 · ${t.length}장`);
}
export async function syncLangs(id, changed) {
    if (typeof DOMParser === "undefined")
        return;
    const { bases, vers, langs } = await langFiles(id);
    if (!langs.length)
        return;
    const touched = new Set(), redraw = new Set();
    for (const c of changed.filter(f => PAGE_RE.test(f) || LANG_PAGE.test(f))) {
        const b = baseOf(c), donor = await wget(id, c).catch(() => null);
        if (!donor)
            continue;
        if (c !== b && changed.includes(b))
            continue; // 원문과 언어판이 함께 바뀌면 원문이 기준
        const targets = [b, ...langs.map(L => verOf(b, L))].filter(f => f !== c && (f === b ? bases.includes(b) : vers.includes(f)));
        const sk = skelOf(donor);
        for (const t of targets) {
            const cur0 = await wget(id, t).catch(() => null);
            if (!cur0)
                continue;
            // 사진은 구조(#100 보정 4) — 뼈대가 같아도 칸의 사진(src·object-position·data-focus)은 옮긴다
            const cur = copyPhotos(donor, cur0);
            if (cur !== cur0) {
                await wput(id, t, cur);
                touched.add(t);
            }
            if (skelOf(cur) === sk)
                continue;
            const out = transplant(donor, cur);
            await wput(id, t, out);
            touched.add(t);
            if (LANG_PAGE.test(t) && /\sdata-viz\s*=/.test(out))
                redraw.add(t);
        }
    }
    for (const L of langs)
        for (const b of bases)
            if (!vers.includes(verOf(b, L))) {
                const h = await wget(id, b).catch(() => null);
                if (h) {
                    await wput(id, verOf(b, L), h.replace(/<html\b([^>]*)\blang\s*=\s*["'][^"']*["']/i, `<html$1lang="${L}"`));
                    touched.add(verOf(b, L));
                }
            }
    // 구조를 옮겨 받은 언어판 차트는 그 판의 글로 다시 그린다(옮긴 그림은 원문 글이다, #100 보정 4)
    if (redraw.size) {
        await ensureVerify(id);
        const wd = await T().core.invoke("work_dir", { id }).catch(() => null);
        if (wd)
            await exec("node", [".dynapse/verify.mjs", ...redraw, "--no-render"], undefined, wd).catch(() => null);
    }
    await writeLangStatus(id);
    return [...touched];
}
// [그대로 두기] — 지금 원문 글을 번역된 것으로 친다(언어판 글은 그대로)
async function acceptLang(id, L, file) {
    const b = baseOf(file), h = await wget(id, b).catch(() => null);
    if (!h || typeof DOMParser === "undefined")
        return;
    const meta = (await readJson(id, ".dynapse/lang.json")) ?? {};
    ((meta.src ??= {})[L] ??= {})[b] = Object.fromEntries(textLeaves(parseH(h)).map(l => [l.sel, l.text]));
    await wput(id, ".dynapse/lang.json", JSON.stringify(meta, null, 1));
    await writeLangStatus(id);
}
// 한국어판에 남은 영어(#237 — KO 장에 kicker "LIVE OPERATION"·em "Under 2 seconds"가 그대로): 지킬 이름이 아닌 라틴 말 3낱말 이상(대문자만이면 2낱말)이 남은 글 칸만 가벼운 번역 한 번 · 그래도 남으면 lang_mix 보고
async function langMixFix(id, files, keep, ai) {
    if (typeof DOMParser === "undefined")
        return;
    const RUN = /(?:[A-Za-z][A-Za-z0-9'’-]*\s+){2,}[A-Za-z][A-Za-z0-9'’-]*|\b[A-Z]{2,}(?:\s+[A-Z]{2,})+\b/;
    const strip = (t) => keep.reduce((x, k) => x.split(k).join(" "), t);
    const todo = [], docs = new Map();
    for (const f of files) {
        const h = await wget(id, f).catch(() => null);
        if (!h)
            continue;
        const d = parseH(h);
        docs.set(f, d);
        for (const l of textLeaves(d))
            if (RUN.test(strip(l.text)))
                todo.push({ file: f, sel: l.sel, text: l.text });
    }
    if (!todo.length)
        return;
    const r = await auxRun(id, `Translate the English left in each Korean slide text into natural Korean. Keep exactly as written: ${keep.slice(0, 30).join("; ") || "(none)"}; keep numbers; keep line breaks. Return JSON with the same keys.\n${JSON.stringify(Object.fromEntries(todo.map((l, i) => [`k${i}`, l.text.slice(0, 400)])))}`, ai).catch(() => null);
    let n = 0;
    const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    for (const [i, l] of todo.entries()) {
        const v = r?.json[`k${i}`];
        if (typeof v !== "string" || !v.trim() || RUN.test(strip(v)))
            continue;
        const d = docs.get(l.file), el = (() => { try {
            return d.querySelector(l.sel);
        }
        catch {
            return null;
        } })();
        if (!el)
            continue;
        el.innerHTML = esc(v.trim()).replace(/\n/g, "<br>");
        n++;
    }
    for (const f of new Set(todo.map(t => t.file)))
        if (n)
            await wput(id, f, serialH(docs.get(f)));
    if (n < todo.length)
        report("turn", "lang_mix", `left=${todo.length - n} fixed=${n}`);
    else
        report("turn", "lang_mix.fixed", `n=${n}`);
}
// 언어판 손 고침 고정(#234 보정 1 ④ · 2026-10-22 대표 "직접 고치면 바뀌어야 할 텐데 바로 돌아와") — 고친 글이 든 칸(언어판과 원문은 같은 뼈대)을 lang.json pin에.
// 자동 번역(턴 뒤 따라가기)은 고정된 칸을 건너뛰고, 원문이 그 뒤 바뀌면 "번역 안 됨" 배지만(덮지 않는다)
async function pinLangLeaf(id, file, L, neu) {
    const h = await wget(id, file).catch(() => null), b = baseOf(file), hb = await wget(id, b).catch(() => null);
    if (!h || !hb)
        return;
    const want = neu.replace(/\s+/g, " ").trim().slice(0, 40);
    if (!want)
        return;
    const leaf = textLeaves(parseH(h)).find(l => l.text.replace(/\s+/g, " ").includes(want));
    if (!leaf)
        return;
    const bl = textLeaves(parseH(hb)).find(l => l.sel === leaf.sel);
    if (!bl)
        return;
    const meta = (await readJson(id, ".dynapse/lang.json")) ?? {};
    ((meta.pin ??= {})[L] ??= {})[b] ??= {};
    meta.pin[L][b][leaf.sel] = bl.text;
    ((meta.src ??= {})[L] ??= {})[b] ??= {};
    meta.src[L][b][leaf.sel] = bl.text; // 지금 원문과 맞는 것으로
    await wput(id, ".dynapse/lang.json", JSON.stringify(meta, null, 1));
    slog(id, "lang.pin", { file, sel: leaf.sel.slice(-60) });
}
// 번역(#74 §3 → #100) — 원문 장은 그대로 두고 언어판에. 처음이면 원문을 복사해 만들고, 있으면 원문 글이 바뀐 칸만 다시(only = 그 장만)
async function translateTurn(id, lang, ai, only, o = {}) {
    if (typeof DOMParser === "undefined")
        return false;
    const L = lang.code;
    if (!LANG_NAME[L])
        return false;
    const { bases } = await langFiles(id);
    const files = (only?.length ? only.map(baseOf) : bases).filter(f => bases.includes(f));
    const meta = (await readJson(id, ".dynapse/lang.json")) ?? {};
    const todo = [];
    let created = 0;
    for (const b of files) {
        const h = await wget(id, b).catch(() => null);
        if (!h)
            continue;
        if (!meta.base) { // 원문 언어 = 첫 장 글의 많은 쪽(영어 덱에 한글 한 줄이 있다고 한국어로 보지 않는다 — #100 보정 2)
            const order = (await readPages(id).catch(() => null)) ?? [], first = (order[0] && (await wget(id, order[0]).catch(() => null))) || h;
            const tx = first.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "").replace(/<[^>]+>/g, " "), ko = (tx.match(/[가-힣]/g) ?? []).length, la = (tx.match(/[A-Za-z]/g) ?? []).length;
            meta.base = ko * 2.5 > la ? "ko" : "en";
        }
        if (meta.base === L)
            continue;
        const v = verOf(b, L), cur = await wget(id, v).catch(() => null);
        if (!cur) {
            await wput(id, v, h.replace(/<html\b([^>]*)\blang\s*=\s*["'][^"']*["']/i, `<html$1lang="${L}"`));
            created++;
        }
        const src = meta.src?.[L]?.[b] ?? {}, fresh = !cur;
        const pin = meta.pin?.[L]?.[b] ?? {};
        {
            const dh = parseH(h);
            for (const l of [...textLeaves(dh), ...vizLeaves(dh)])
                if ((fresh || src[l.sel] !== l.text) && !(pin[l.sel] !== undefined && (o.auto || pin[l.sel] === l.text)))
                    todo.push({ file: b, sel: l.sel, text: l.text, slot: l.sel.startsWith("viz:") ? "viz" : (l.el.closest("[data-slot]")?.getAttribute("data-slot") ?? l.el.tagName.toLowerCase()) });
        } // 차트 글 포함(#100 보정 4)
    }
    if (meta.base === L) {
        await postChat(id, [{ role: "event", text: `이미 ${lang.name} 원문이에요`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
        return true;
    }
    if (!todo.length) {
        await writeLangStatus(id);
        await postChat(id, [{ role: "event", text: `${lang.name} 언어판이 이미 맞아요`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
        return true;
    }
    await postChat(id, [{ role: "event", text: `${created ? `${lang.name} 언어판 만드는 중` : "번역 반영 중"} · 글자 ${todo.length}곳`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
    const items = Object.fromEntries(todo.map((l, i) => [`k${i}`, l.text.slice(0, 600)]));
    const tr = await trRules(L), fixes = await langFixes(id, L), keepT = await readJson(id, ".dynapse/terms.json").catch(() => null);
    const rulesTxt = [
        ...(keepT?.keep.length ? [`Keep exactly as written (never translate, transliterate or re-case): ${keepT.keep.slice(0, 30).join("; ")}`] : []),
        ...(tr.principles?.length ? [`Rules:\n${tr.principles.map(x => `- ${x}`).join("\n")}`] : []),
        ...(glossLines(tr.glossary).length ? [`Glossary — use exactly these spellings:\n${glossLines(tr.glossary).join("; ")}`] : []),
        ...(fixes.length ? [`This deck's own corrections by the user — apply them exactly wherever the same wording comes up:\n${fixes.map(x => `${x.from} → ${x.to}`).join("; ")}`] : []),
        ...(tr.examples?.length ? [`Bad → good examples:\n${tr.examples.map(x => `${x.en ? `"${x.en}": ` : ""}"${x.bad}" → "${x.good}"`).join("\n")}`] : []),
    ].join("\n\n");
    const r = await auxRun(id, `Translate each value into ${lang.name}. These are text boxes and chart labels on presentation slides: keep it about as long as the original (titles short), keep line breaks (\\n) and line counts similar, keep numbers, names, brand names and URLs exactly, no added quotes or notes. If a value is already in ${lang.name}, return it unchanged.${rulesTxt ? `\n\n${rulesTxt}` : ""}\n${JSON.stringify(items)}\nReturn {"k0":"…","k1":"…", …} with every key.`, ai);
    // 검사(translate.<lang>.checks)에 걸린 값만 한 번 더 다듬는다(자동 1회)
    if (r && tr.checks?.length) {
        const bad = {};
        for (const [i, l] of todo.entries()) {
            const v = r.json[`k${i}`];
            if (typeof v !== "string")
                continue;
            for (const c of tr.checks) {
                let re;
                try {
                    re = new RegExp(c.pattern, "u");
                }
                catch {
                    continue;
                }
                if (c.scope && !new RegExp(c.scope, "i").test(l.slot ?? ""))
                    continue;
                if (re.test(v.trim()))
                    (bad[`k${i}`] ??= { text: v, why: [] }).why.push(`${c.why} → ${c.fix}`);
            }
        }
        if (Object.keys(bad).length) {
            const p2 = await auxRun(id, `Rewrite each ${lang.name} value so none of its listed problems remain. Keep the meaning, numbers and names; keep it short.${rulesTxt ? `\n\n${rulesTxt}` : ""}\n${JSON.stringify(Object.fromEntries(Object.entries(bad).map(([k, x]) => [k, { text: x.text, problems: x.why }])))}\nReturn {"k…":"…"} with the same keys.`, ai);
            if (p2)
                for (const k of Object.keys(bad))
                    if (typeof p2.json[k] === "string" && p2.json[k].trim())
                        r.json[k] = p2.json[k];
        }
    }
    if (!r) {
        await postChat(id, [{ role: "event", text: "번역하지 못했어요 · 다시", payload: { kind: "error", ai: "dynapse" } }]).catch(() => { });
        return true;
    }
    const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const byFile = new Map();
    let n = 0;
    const vizTouched = new Set();
    meta.src ??= {};
    meta.src[L] ??= {};
    for (const [i, l] of todo.entries()) {
        const tr = r.json[`k${i}`];
        if (typeof tr !== "string" || !tr.trim())
            continue;
        const v = verOf(l.file, L), d = byFile.get(v) ?? parseH((await wget(id, v).catch(() => null)) ?? "");
        byFile.set(v, d);
        if (l.sel.startsWith("viz:")) {
            if (setVizLeaf(d, l.sel, tr.trim().replace(/\n/g, " "))) {
                (meta.src[L][l.file] ??= {})[l.sel] = l.text;
                n++;
                vizTouched.add(v);
            }
            continue;
        }
        const el = (() => { try {
            return d.querySelector(l.sel);
        }
        catch {
            return null;
        } })();
        if (!el)
            continue;
        el.innerHTML = esc(tr.trim()).replace(/\n/g, "<br>");
        (meta.src[L][l.file] ??= {})[l.sel] = l.text;
        n++;
    }
    for (const [v, d] of byFile)
        await wput(id, v, serialH(d));
    // 차트를 고친 언어판 장은 새 글로 다시 그린다(검사 없이 그림만, AI 없음)
    if (vizTouched.size) {
        await ensureVerify(id);
        const wd = await T().core.invoke("work_dir", { id }).catch(() => null);
        if (wd)
            await exec("node", [".dynapse/verify.mjs", ...vizTouched, "--no-render"], undefined, wd).catch(() => null);
    }
    await wput(id, ".dynapse/lang.json", JSON.stringify(meta, null, 1));
    await writeLangStatus(id);
    if (n || created)
        await clickRound(id, `${created ? `${lang.name} 언어판` : `번역 반영 · ${lang.name}`} · 글자 ${n}곳`, [r.ai === "codex" ? "chatgpt" : "claude"]);
    await auxDone(id, "translate", r, created ? `${lang.name} 언어판을 만들었어요 · 글자 ${n}곳 · 원문은 그대로 · 캔버스 위 언어 토글로 오가요` : `번역 반영 · 글자 ${n}곳`);
    void postChat(id, [{ role: "event", text: null, payload: { kind: "lang", ai: "dynapse", lang: L } }]).catch(() => { });
    if (created)
        await wput(id, ".dynapse/export-lang.json", JSON.stringify({ lang: L })).catch(() => { }); // 보는·내보내는 언어판 = 새 언어판
    if (L === "ko")
        await langMixFix(id, files.map(f => verOf(f, L)), keepT?.keep ?? [], ai).catch(() => { }); // 한국어판에 남은 영어(#237)
    if (!o.auto && (created || only?.length))
        await polishEdition(id, lang, ai).catch(() => { }); // 언어판 전체를 한 번 검사·다듬기(#100 보정 5) — 턴 뒤 자동 따라가기(#234 ②)는 바뀐 칸만, 다듬기 없이
    return true;
}
// 예전 언어판의 차트 글 따라잡기(#100 보정 4) — 작업을 열 때 한 번: 차트가 있는 원문 장인데 그 언어판 기록에 차트 글(viz:)이 없으면 그 장들만 번역(원본 기기만)
const langCaught = new Set();
export async function catchUpLangs(id) {
    if (langCaught.has(id) || typeof DOMParser === "undefined")
        return;
    langCaught.add(id);
    const { bases, vers, langs } = await langFiles(id);
    if (!langs.length)
        return;
    if (sharedWorks.has(id) && !(await isOriginDevice(id)))
        return;
    const meta = (await readJson(id, ".dynapse/lang.json")) ?? {};
    for (const L of langs) {
        const need = [];
        for (const b of bases) {
            if (!vers.includes(verOf(b, L)))
                continue;
            const h = await wget(id, b).catch(() => null);
            if (!h || !/\sdata-viz\s*=/.test(h))
                continue;
            const src = meta.src?.[L]?.[b] ?? {};
            if (vizLeaves(parseH(h)).some(l => src[l.sel] !== l.text))
                need.push(b);
        }
        const lg = langByCode(L);
        if (need.length && lg)
            await translateTurn(id, lg, "claude", need).catch(() => false);
    }
}
// 언어판 전체 검사·다듬기(#100 보정 5) — 기본 검사 목록은 언어판 장을 빼므로 만든 직후 한 번: 모든 result-*.<lang>.html에 copy_ai(번역 검사 포함) → 걸린 글 칸만 한 번 고쳐 쓴다
async function polishEdition(id, lang, ai) {
    const L = lang.code, { vers } = await langFiles(id), mine = vers.filter(v => v.endsWith(`.${L}.html`));
    if (!mine.length)
        return;
    await ensureVerify(id);
    const wd = await T().core.invoke("work_dir", { id }).catch(() => null);
    if (!wd)
        return;
    const out = await exec("node", [".dynapse/verify.mjs", ...mine, "--no-render"], undefined, wd).catch(() => null);
    let v = {};
    try {
        v = JSON.parse((out?.stdout ?? "").trim().split("\n").pop() ?? "{}");
    }
    catch {
        return;
    }
    const hits = [...(v.errors ?? []), ...(v.warnings ?? [])].filter(x => x.rule === "copy_ai" && mine.includes(x.page));
    if (!hits.length)
        return;
    const docs = new Map(), items = {}, at = {};
    let k = 0;
    for (const x of hits) {
        const d = docs.get(x.page) ?? parseH((await wget(id, x.page).catch(() => null)) ?? "");
        docs.set(x.page, d);
        const q = x.msg.match(/"([^"]{2,60})/)?.[1]?.replace(/…$/, "") ?? "";
        const leaf = textLeaves(d).find(l => (l.el.closest("[data-slot]")?.getAttribute("data-slot") ?? l.el.tagName.toLowerCase()) === x.slot && (!q || l.text.startsWith(q.slice(0, 20))));
        if (!leaf)
            continue;
        const key = Object.entries(at).find(([, a]) => a.file === x.page && a.sel === leaf.sel)?.[0] ?? `k${k++}`;
        at[key] = { file: x.page, sel: leaf.sel };
        (items[key] ??= { text: leaf.text, problems: [] }).problems.push(x.msg.split(" — ").slice(1).join(" — ").slice(0, 160));
    }
    if (!Object.keys(items).length)
        return;
    const tr = await trRules(L), gl = glossLines(tr.glossary);
    const r = await auxRun(id, `Rewrite each ${lang.name} slide text so none of its listed problems remain. Keep the meaning, numbers and names; keep it about as short.${tr.principles?.length ? `\nRules:\n${tr.principles.map(x => `- ${x}`).join("\n")}` : ""}${gl.length ? `\nGlossary — use exactly these spellings: ${gl.join("; ")}` : ""}\n${JSON.stringify(items)}\nReturn {"k…":"…"} with the same keys.`, ai);
    if (!r)
        return;
    const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const touched = new Set();
    let n = 0;
    for (const [key, a] of Object.entries(at)) {
        const val = r.json[key];
        if (typeof val !== "string" || !val.trim())
            continue;
        const d = docs.get(a.file);
        const el = (() => { try {
            return d.querySelector(a.sel);
        }
        catch {
            return null;
        } })();
        if (!el)
            continue;
        el.innerHTML = esc(val.trim()).replace(/\n/g, "<br>");
        touched.add(a.file);
        n++;
    }
    for (const f of touched)
        await wput(id, f, serialH(docs.get(f)));
    if (n) {
        await clickRound(id, `${lang.name} 언어판 다듬기 · 글자 ${n}곳`, [r.ai === "codex" ? "chatgpt" : "claude"]);
        await postChat(id, [{ role: "event", text: `${lang.name} 언어판을 한 번 더 다듬었어요 · ${n}곳`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
    }
}
export const langByCode = (c) => Object.values(LANGS).find(x => x.code === c) ?? null;
// 진단용 꼬리(대표 2026-10-04) — JSON이 아닌 줄(대개 stderr·런타임 오류)만 마지막 30줄. 실패하면 진단에 붙는다
function errTail(s, l) {
    // JSON 줄은 오류(Codex error·turn.failed)의 message만 남긴다(#95 A — 모델 400이 JSON으로 와서 놓쳤다)
    if (l.trimStart().startsWith("{")) {
        try {
            const d = JSON.parse(l);
            const em = d.type === "error" ? d.message : d.type === "turn.failed" ? d.error?.message : null;
            if (typeof em === "string" && em.trim()) {
                (s.errTail ??= []).push(em.slice(0, 400));
                if (s.errTail.length > 30)
                    s.errTail.shift();
            }
        }
        catch { /* 비JSON */ }
        return;
    }
    (s.errTail ??= []).push(l.slice(0, 400));
    if (s.errTail.length > 30)
        s.errTail.shift();
}
const linkIndexed = new Map();
const rewardWorks = new Map(); // 작업 → 리워드 작업 번호(#62 보정 1)
const UNIT_EN = { 쪽: "pages", 슬라이드: "slides", 시트: "sheets" };
async function docHead(id) {
    await T().core.invoke("doc_index", { id, name: null }).catch(() => null); // 예전 네이티브(0.1.56 이하)면 명령이 없다 — 머리 없이
    const list = await readJson(id, ".dynapse/docs.json").catch(() => null);
    if (!list?.length)
        return "";
    const seen = new Set((await readJson(id, ".dynapse/doc-seen.json").catch(() => null)) ?? []);
    const key = (d) => `${d.name}|${d.chars}`;
    const fresh = list.filter(d => !seen.has(key(d)));
    // AI가 받아 적은 글(⟨이름⟩.ai.md)은 따로 알리지 않는다 — 원본 줄이 그걸 가리킨다
    const aiRead = new Set(list.filter(d => d.name.endsWith(".ai.md")).map(d => d.name.slice(0, -".ai.md".length)));
    if (!fresh.length)
        return "";
    await wput(id, ".dynapse/doc-seen.json", JSON.stringify([...seen, ...fresh.map(key)])).catch(() => { });
    // 글자 없는 문서(스캔 PDF 등) — 본인 AI가 한 번 읽어 글로 받아 적고(context/refs/⟨이름⟩.ai.md), 앱이 그걸 색인해 다음부터는 그 색인을 쓴다
    const rtNames = new Set((await readJson(id, ".dynapse/roundtrip.json").catch(() => null)) ?? []); // PPTX 왕복으로 처리한 파일은 문서로 알리지 않는다
    const lines = fresh.filter(d => !d.name.endsWith(".ai.md") && !rtNames.has(d.name)).map(d => d.ok
        ? /\.pptx$/i.test(d.name)
            // 내 PPT(#73 §1) — 내용만 가져와 우리 레이아웃으로 다시. 마스터·디자인은 따라 하지 않는다
            ? `[Attached: ${d.name} — the user's PowerPoint, ${d.count} slides, outline: ${d.outline.join(" / ") || "-"}, index: context/.index/${d.name}.md (text, tables, and its pictures extracted to context/assets/). Rebuild it with Dynapse layouts: keep the original slide order, titles and key sentences; copy every number and name exactly; reuse its pictures in photo slots where they fit. Do not imitate its master design. If the material does not fit a page, add pages instead of cutting or shrinking text.]`
            : `[Attached: ${d.name} — ${d.count} ${UNIT_EN[d.unit] ?? "pages"}, outline: ${d.outline.join(" / ") || "-"}, index: context/.index/${d.name}.md. If the material does not fit a page, add pages instead of cutting or shrinking text.]`
        : aiRead.has(d.name) ? `[Attached: ${d.name} — already transcribed: use the index of context/refs/${d.name}.ai.md, not the original]`
            : `[Attached: ${d.name} — no text layer (${d.reason ?? "scanned"}). Read context/refs/${d.name} yourself once and save what it says to context/refs/${d.name}.ai.md: "# ${d.name}", then "## 목차" (headings with page numbers), then the full text with "<!-- 쪽 n -->" page markers. Copy every number and name exactly; do not summarize. The app indexes that file; from then on use its index instead of the original. If you cannot open this file type, tell the user in Korean that this document needs Claude to read it.]`);
    if (!lines.length)
        return "";
    const off = !!(await wget(id, ".dynapse/no-doc-summary.json").catch(() => null));
    const long = off ? [] : fresh.filter(d => d.ok && d.chars > 100_000 && !d.summary);
    if (long.length) {
        await postChat(id, [{ role: "event", text: `문서 요약 중 · 1회 · ${long.map(d => d.name).join(", ")}`, payload: { kind: "doc-summary", ai: "dynapse", names: long.map(d => d.name) } }]).catch(() => { });
        // 보조(Sonnet 일회, #51 §4 보정 2) — 요약은 메인 세션 밖에서. 색인 앞 15만 자(목차·숫자 문장이 맨 앞) → 요약 파일. 0.1.58 이하 네이티브(명령 없음)나 실패면 아래처럼 메인 턴이 쓴다
        const left = [];
        const editAi = (await readJson(id, ".dynapse/team.json").catch(() => null))?.merge === "chatgpt" ? "chatgpt" : "claude"; // 이 작업의 편집 AI와 같은 회사
        for (const d of long) {
            const txt = await T().core.invoke("doc_text", { id, name: d.name }).catch(() => null);
            const r = txt ? await auxRun(id, `Summarize this document index for someone who will build slides from it. Korean, at most 3,000 characters: purpose, structure with ${UNIT_EN[d.unit] ?? "page"} numbers, and every key number with its ${UNIT_EN[d.unit] ?? "page"} number (copy numbers and names exactly).${txt.length >= 150_000 ? " The index is cut at 150,000 characters; say which pages it covers." : ""}\n\n${txt.slice(0, 150_000)}\n\nReturn {"summary":"<markdown>"}`, editAi) : null;
            const sum = typeof r?.json.summary === "string" ? r.json.summary : null;
            if (r && sum && await T().core.invoke("doc_summary_put", { id, name: d.name, text: `# 요약 · ${d.name}\n\n${sum}` }).then(() => true).catch(() => false)) {
                await auxDone(id, "doc_summary", r, null);
                lines.push(`[Summary of ${d.name} is ready: context/.index/${d.name}.summary.md — work from it and the outline; Grep the index only for the ranges you need.]`);
            }
            else
                left.push(d);
        }
        long.splice(0, long.length, ...left);
    }
    if (long.length) {
        lines.push(`[Long document — before the request, write context/.index/<name>.summary.md once for: ${long.map(d => d.name).join(", ")} (≤ 3,000 characters: purpose, structure with page numbers, every key number with its page). From then on work from the summary and the outline; Grep the index only for the ranges you need.]`);
    }
    return `${lines.join("\n")}\n`;
}
// 같이 있음(#128 보정 1) — 턴 시작에 turn+장, 턴 끝에 view를 한 번씩(주기 호출 아님, #115). 멤버가 아닌 작업은 서버가 404로 무시
const turnPage = new Map();
const presence = (id, state, page = null) => void api("POST", `/api/works/${encodeURIComponent(id)}/presence`, { state, ...(page && /^result-[a-z0-9-]+(\.[a-z]{2})?\.html$/.test(page) ? { page: page.replace(/\.[a-z]{2}\.html$/, ".html") } : {}) }).catch(() => { });
const recentAsks = new Map();
export async function pageFreshHead(id, s, req, file) {
    const prev = recentAsks.get(id) ?? [];
    recentAsks.set(id, [...prev, req.replace(/\s+/g, " ").slice(0, 200)].slice(-4));
    const on = !!file && PAGE_RE.test(file) && s.scope !== "deck" && !s.lanePage && !s.rewardTask && !rewardWorks.has(id) && s.queueItem === undefined && (await store.get("page_fresh_off").catch(() => null)) !== true;
    if (!on) {
        if (s.pageThread) {
            s.sessionId = s.mainSid;
            s.mainSid = undefined;
            s.pageThread = false;
            if (s.procId !== undefined)
                s.respawn = true;
        }
        return "";
    }
    if (!s.pageThread) {
        s.mainSid = s.sessionId;
        s.pageThread = true;
    }
    s.sessionId = undefined;
    if (s.procId !== undefined)
        s.respawn = true;
    const plan = ((await readJson(id, ".dynapse/plan.json").catch(() => null))?.pages ?? []).find(p => p.page === file);
    const page = (await wget(id, file).catch(() => null)) ?? "", html = s.tool === "codex" ? page : null; // Claude는 고치기 전에 파일을 읽어야 해서(Edit 규칙) HTML은 싣지 않는다
    // 바꿀 수 있는 레이아웃(#267 ②) — 지금 레이아웃 + 같은 판형·겹치는 역할 7개까지의 칸 줄(.dynapse/layouts.md 전체 대신)
    const ix = TIER_BUNDLES?.index, cur = page.match(/<section\b[^>]*\bdata-layout\s*=\s*["']([a-z0-9-]+)["']/i)?.[1] ?? null;
    // 판형 = 이 장의 종류(#273 ① — 인쇄·접지 장에 발표 레이아웃이 후보로 오지 않게): print:<id> · mobile · card(1080 폭 또는 card 판형) · slide
    const pfmt = page.match(/<section\b[^>]*\bdata-format\s*=\s*["'](print:[a-z0-9_]+|mobile|detail|card45|card)["']/i)?.[1] ?? null;
    const fmt = pfmt?.startsWith("print:") ? pfmt : pfmt === "mobile" || pfmt === "detail" ? pfmt : pfmt === "card" || pfmt === "card45" || Number(page.match(/\.slide(?:\[[^\]]*\])*\s*\{[^}]*?\bwidth\s*:\s*(\d{3,4})px/)?.[1] ?? 0) === 1080 ? "card" : "slide";
    const roles = new Set(cur && ix?.[cur] ? ix[cur].roles : []), cands = ix ? [...(cur && ix[cur] ? [cur] : []), ...Object.entries(ix).filter(([k, v]) => k !== cur && (v.formats ?? []).includes(fmt) && (!roles.size || v.roles.some(x => roles.has(x)))).map(([k]) => k)].slice(0, 8) : [];
    // 칸 글로 지은 장(#275 보정 2 ③) — 말·레이아웃 바꾸기는 그 장 JSON만(구조·사진·색·글꼴·크기 말은 예전 길)
    {
        const nn = file.match(/^result-(\d{2})\.html$/)?.[1], sj = nn ? await wget(id, `.dynapse/slot-${nn}.json`).catch(() => null) : null;
        if (!s.raw && nn && sj && (fmt === "card" || fmt === "slide" || fmt === "detail") && !/나눠|합쳐|추가|빼|사진|이미지|그림|차트|표로|그래프|움직임|색|컬러|글꼴|폰트|크기|위치|옮겨|크게|작게|넓게|좁게/.test(req)) {
            const S2 = await import("./slots.js"), menu = await slotMenuFor(fmt).catch(() => []), curL = menu.find(l => l.id === (S2.parseSlotPage(sj, new Set(menu.map(x => x.id)))?.layout ?? ""));
            const alts = menu.filter(l => l !== curL && (!curL || l.roles.some(r => curL.roles.includes(r)))).slice(0, 6);
            slotsTurn.set(id, { kind: fmt, fmt: (pfmt === "card45" ? "card45" : fmt === "card" ? "card" : fmt === "detail" ? "detail" : null), t0: Date.now(), seen: new Map(), n: 0, raw: "", pages: 0, menu: "", patch: { nn, file: file, prev: sj } });
            const st = slotsTurn.get(id);
            st.timer = setInterval(() => { void slotsBuild(id).catch(() => { }); }, 400);
            setTimeout(() => { if (slotsTurn.get(id) === st)
                void slotsFlush(id); }, 10 * 60_000);
            report("turn", "slots.page_start", `${s.tool} layout=${curL?.id ?? "-"}`);
            return S2.pageEditInstruction(file, nn, sj, S2.slotMenu([...(curL ? [curL] : []), ...alts]))
                + (prev.length ? `Earlier requests in this work (oldest first): ${prev.slice(-3).map((x, i) => `${i + 1}) ${x}`).join(" ")}\n` : "") + "\n";
        }
    }
    const lays = cands.map(k => ix[k].line).filter((x) => !!x);
    {
        const off = cands.filter(k => !(ix[k].formats ?? []).includes(fmt));
        if (off.length)
            report("turn", "recommend.kind_mismatch", `page_fresh fmt=${fmt} off=${off.slice(0, 3).join(",")}`);
    } // 지금 레이아웃이 다른 판형이면(옛 장) 기록
    report("turn", "turn.page_fresh", `${s.tool} html=${html ? html.length : 0}`);
    return `[Single-page turn — a fresh conversation. Only ${file} changes. What you need is here: do not open other pages, NOTES.md, TRACE.json or .dynapse/layouts.md (the layouts this page may use are listed below).]\n`
        + (plan ? `Plan for this page: ${JSON.stringify(plan).slice(0, 600)}\n` : "")
        + (prev.length ? `Earlier requests in this work (oldest first): ${prev.slice(-3).map((x, i) => `${i + 1}) ${x}`).join(" ")}\n` : "")
        + (lays.length ? `Layouts this page may use (copy materials/<id>.html; slots):\n${lays.join("\n")}\n` : "")
        + (html && html.length <= 40_000 ? `Current ${file}:\n\`\`\`html\n${html}\n\`\`\`\n` : "")
        + "\n";
}
// 턴 카드의 장 띠 순서(#278 ③ — 검사 결과 순서(본문·마무리·표지·데이터)로 나왔다): .dynapse/pages.json 순서, 없는 장은 뒤에 원래 순서
async function orderShots(id, shots) {
    const ord = (await readPages(id).catch(() => null)) ?? [], at = (k) => { const i = ord.indexOf(`result-${k}.html`); return i < 0 ? 1000 + shots.indexOf(k) : i; };
    return [...shots].sort((a, b) => at(a) - at(b));
}
// 리워드 장 턴 머리(#278 ②) — 장 쓰기 턴: 묻지 않고 순서를 바꾸지 않는다
// 청첩장 리워드 블록 유지(#280 ③) — 발주 글이 무엇이든 턴마다. 모르는 사실은 대괄호 칸(하객 장에서 숨는다)
export const REWARD_BLOCKS_LINE = (small) => `[Reward invitation: keep every standard block (${small ? "greeting, date/calendar, venue address + map links, notice, gallery — this is the small-wedding situation, so hosts and accounts stay out" : "hosts, greeting, date/calendar, venue address + map links, accounts, notice, gallery"}); never delete a block because the brief lacks its facts — leave unknown facts as bracketed fields like [신랑 아버지 이름] or [은행 계좌번호] that the user fills. If an earlier turn deleted a block, restore it from the layout.]\n`;
const REWARD_PAGE_HEAD = "[This is a page-writing turn: do not ask the user anything and do not reorder pages or touch .dynapse/pages.json or order files — write the page(s) named below and end the turn.]\n";
// 한 장 턴에 안 쓰는 커넥터 도구(#275 보정 4 — 매 호출 다시 읽는 바탕 맥락을 줄인다): 리워드 맡기·제출·놓기·목록. 덱 턴·리워드 작업실엔 그대로
const PAGE_MCP_DENY = ["mcp__dynapse__claim_task", "mcp__dynapse__submit_work", "mcp__dynapse__release_claim", "mcp__dynapse__list_tasks", "mcp__dynapse__get_task", "mcp__dynapse__my_status"];
// 한 세션에 턴 열기는 하나씩(#272 ②) — 여는 중에 들어온 요청은 대기열에 남고, 이 턴이 끝나면 endTurn이 다시 nextTurn을 부른다
export async function nextTurn(id, s) {
    if (s.starting) {
        report("turn", "turn.start_race", `q=${s.queue.length}`);
        return;
    } // 기록 ③
    s.starting = true;
    try {
        await nextTurn0(id, s);
    }
    finally {
        s.starting = false;
        if (!s.busy && s.queue.length)
            setTimeout(() => void nextTurn(id, s), 0);
    } // 여는 동안 들어왔는데 이번에 턴이 안 열렸으면 바로 다음
}
async function nextTurn0(id, s) {
    s.denyHit = false;
    s.denyNoted = false;
    presence(id, "turn", turnPage.get(id) ?? null);
    void import("./form-alts.js").then(x => x.cancelPrerender(id)).catch(() => { }); // 턴이 시작되면 다른 모양 미리 만들기 중단(#119 보정 9 §2)
    const text0 = s.queue.shift();
    const req = s.reqQueue?.shift(), qPage = text0 ? s.pageQ?.get(text0) ?? null : null;
    if (text0)
        s.pageQ?.delete(text0);
    // 턴 등급(#123) — 무거움: 리워드·작업의 첫 턴·덱 범위·"전체 다시" / 가벼움: 📍 한 칸·글자·폰트 정리·카피 다듬기 / 그 밖 보통.
    // 등급마다 지침 묶음(가벼움은 CLAUDE.md 2k자만 · 보통·무거움은 .dynapse/skill-normal|heavy.md를 먼저 읽게)과 토큰 상한(15k·60k·160k)이 다르다
    {
        const first = !((await readJson(id, ".dynapse/TRACE.json").catch(() => null))?.rounds?.length), rq = req ?? text0 ?? "";
        s.firstTurn = first;
        s.tier = turnTier({ reward: !!s.rewardTask || rewardWorks.has(id), first, scope: s.scope ?? null, refusalRetry: !!s.noRefusalRetry, light: !!s.light, rq, plan: planTurn.has(id) });
        {
            const kt = keepTier.get(id);
            if (kt) {
                s.tier = kt;
                keepTier.delete(id);
            }
            else if (rq.trim().length <= 12 && SHORT_YES.test(rq.trim()) && lastTierOf.get(id))
                s.tier = lastTierOf.get(id);
        } // #229 ②③ — 이어서 하기·짧은 승낙은 앞 턴 등급 그대로
        lastTierOf.set(id, s.tier);
        if (seqReward.has(id))
            s.tier = "light"; // 리워드 계획·장 턴(#214 보정 1) — 가벼운 묶음 + 그 장의 레이아웃 하나(계획 ≤30k · 장 ≤25k 입력)
        s.tierCap = seqReward.has(id) ? 60_000 : s.tier === "heavy" ? 160_000 : s.tier === "normal" ? 60_000 : 15_000;
        s.tierHit = false;
        s.contQueued = false;
        s.tierSaid = false;
        s.grown = undefined;
        s.tierTok = 0;
        s.tierMsgs = 0;
        s.tierT0 = Date.now();
    }
    const tierHead = !TIER_BUNDLES ? "" : s.tier === "light" ? "[Turn tier: light — follow CLAUDE.md only; edit just what is asked.]\n" : `[Turn tier: ${s.tier} — read .dynapse/skill-${s.tier}.md first if you have not read it in this session; it is your full instructions${s.tier === "normal" ? " (no editor read, no second versions; fix copy_ai in the same turn)" : ""}.]\n`;
    // 리워드 무거운 턴(#119 보정 6) — 선반 본보기 그림도 붙인다(전엔 글만). 계획에 "borrow" 한 줄(무엇을 가져오나)이 필요하다 — verify가 리워드에서 본다
    let refHead = "";
    if (text0 && s.tier === "heavy" && (s.rewardTask || rewardWorks.has(id))) {
        const refs = await refPicks(id).catch(() => []);
        if (refs.length)
            refHead = `[Shelf references — open each image with Read before planning. Good: ${refs.filter(r => !r.anti).map(r => `${r.file} (${r.r.form}: ${r.r.why})`).join("; ")}${refs.some(r => r.anti) ? `. Avoid: ${refs.filter(r => r.anti).map(r => `${r.file} (${r.r.why})`).join("; ")}` : ""}. In .dynapse/plan.json add a top-level "borrow": one line on what you take from the good references (structure or rhythm, not their surface or text).]\n`;
    }
    // 리워드 첫 턴 준비 상한(#214 — 첫 턴이 준비·재고 찾기에만 8분·141k를 쓰고 장을 못 썼다): 첫 장은 2분 안에, 재고 찾기 2번까지, 예시는 브리프에 있음, 표지·사진 장도 글부터
    if (req && (s.rewardTask || rewardWorks.has(id)) && !(await readJson(id, ".dynapse/TRACE.json").catch(() => null))?.rounds?.length)
        refHead += "[Reward prep budget: write the first page within 2 minutes. At most 1 search_assets/recommend_assets call in total. Do not open layout files (the registry lines in the guide are enough) and do not re-read the example — its facts are in the brief. The example is already in the brief — do not re-read it. On cover and photo pages write the title and text first, then request photos.]\n";
    // 장 하나 턴은 새 대화(#267 보정 2 — 이어 쓴 대화가 턴마다 지난 기록 전체를 다시 읽어 캐시 읽기가 5M까지 갔다): 그 장 HTML(Codex) · 계획 한 줄 · 지난 요청 3개 · 바꿀 수 있는 레이아웃 8개까지의 칸 줄만 싣는다.
    // 덱 대화는 mainSid에 두고 다음 덱 턴에 그대로 이어 간다. 리워드·묶음 큐·병렬 장 세션은 지금처럼. 끄기 = store page_fresh_off
    const pageHead = text0 && req ? await pageFreshHead(id, s, req, qPage).catch(() => "") : "";
    const layHead = text0 && s.tier !== "light" && !pageHead ? await layoutsLine(id).catch(() => "") : ""; // 이 턴의 판형에 맞는 레이아웃 이름만(#167 ①)
    // 덱 모티프(#201) — 모티프가 있는 덱이면 한 줄: AI는 모티프를 만들거나 지우거나 크기·자리를 정하지 않는다(앱의 덱 블록이 정한다)
    // 새 대화로 바꾼 뒤 첫 턴(#213 ②) — 넘겨받기 한 단락(지난 대화 대신 파일에서)
    const rollHead = text0 && rollNote.delete(id) ? await handoff(id).catch(() => HANDOFF0) : "";
    const motifHead = text0 && (await readJson(id, ".dynapse/motif.json").catch(() => null) || /\bdata-motif\b/.test((await wget(id, ((await readPages(id).catch(() => null)) ?? [])[1] ?? "").catch(() => null)) ?? ""))
        ? "[Deck motif: keep every [data-motif] element; never set its size, position or opacity — the app sets them for the whole deck (<style data-deck>).]\n" : "";
    // 지난 턴에 어긋난 언어판(#229 보정 1) — 한 번만 앞머리에
    const staleHead = text0 ? await (async () => {
        const st = await readJson(id, ".dynapse/edition-stale.json").catch(() => null);
        if (!Array.isArray(st) || !st.length)
            return "";
        await wput(id, ".dynapse/edition-stale.json", "[]").catch(() => { });
        return `[Language editions out of date: ${st.slice(0, 8).map(x => `${x.file} (titles changed in ${x.from})`).join(", ")} — bring them in line in this turn too.]\n`;
    })() : "";
    // 분위기 스티커(#304 보정 2 ③) — 분위기 덱이면 매 턴 한 줄(쓰는 법 · 장당 둘 · 글은 사실만)
    const moodHead = text0 ? await (async () => {
        const mf = await readJson(id, ".dynapse/mood.json").catch(() => null), hf = await readJson(id, ".dynapse/hero.json").catch(() => null);
        const hero = !hf?.status && (!!mf?.id || /캐릭터|마스코트|주인공|mascot|character/i.test(text0)) ? (await import("./hero-sheet.js")).HERO_LINE : ""; // 주인공 시트(#304 보정 2 ②)
        return (mf?.id ? (await import("./mood-deco.js")).stickerLine(mf.id) : "") + hero;
    })() : "";
    // 기존 덱에 새 장(#310 ⑥) — 덱 토큰·라벨 모양을 입게 한 줄 · 낱말 통일이면 모든 언어판에 한 줄
    const deckHead = text0 ? await (async () => {
        const DH = await import("./deck-head.js"), order = (await readPages(id).catch(() => null)) ?? [];
        let out = "";
        if (order.length >= 2 && DH.ADD_PAGE.test(text0)) {
            const hs = [];
            for (const f of order.slice(1, 7)) {
                const h = await wget(id, f).catch(() => null);
                if (h)
                    hs.push(h);
            }
            out += DH.newPageLine(DH.labelSample(hs));
        }
        if (DH.UNIFY.test(text0))
            out += DH.UNIFY_LINE;
        return out;
    })().catch(() => "") : "";
    const rawHead = s.raw ? "[Raw mode (this work): write and fix every page element yourself in the page HTML — no slot JSON and no data-viz (draw charts as inline SVG/HTML). Use tokens.css variables for colours and fonts. After your turn the app does not reflow, resize or recolour your pages; verify findings come back to you to fix.]\n" : "";
    const text = text0 ? rawHead + tierHead + layHead + refHead + rollHead + motifHead + moodHead + deckHead + staleHead + (await docHead(id).catch(() => "")) + pageHead + text0 : text0;
    if (!text)
        return;
    // 턴 시작의 장(#127) — 턴 끝에 AI가 쓴 장과 앱이 다시 쓴 장을 가른다(앱이 다시 쓴 장의 옛 오류로 턴이 실패하지 않게)
    {
        const names = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(f => /^result-[a-z0-9-]+\.html$/.test(f) || LANG_PAGE.test(f));
        const m = new Map();
        for (const f of names) {
            const h = await wget(id, f).catch(() => null);
            if (h !== null)
                m.set(f, h);
        }
        s.startPages = m;
    }
    s.mx = { ...(req ? mxNext.get(id) ?? { kind: "edit", len: req.length, ph: reqHash(req) } : { kind: "cont" }), tid: newTid(), runs: 0, rules: [], skill: 0 };
    if (req)
        mxNext.delete(id);
    // 다른 모양 보기(#119 보정 3 §5) — 칩이 보낸 요청이면 지금 판(커밋)과 그 장의 형태를 적어 두고, 턴 끝에 "새 모양 유지 · 이전으로" 카드
    {
        const fa = req?.match(/\[form-alt:(result-[a-z0-9-]+\.html)\]/)?.[1];
        s.formAlt = fa ? { file: fa, prev: await T().core.invoke("repo_head", { id }).catch(() => null), a: ((await readJson(id, ".dynapse/plan.json").catch(() => null))?.pages ?? []).find(p => p.page === fa)?.form ?? null } : undefined;
    }
    if (req)
        s.copyPolished = false; // 새 요청마다 카피 다듬기 한 번(#122)
    {
        const isRw = !!s.rewardTask || rewardWorks.has(id) || seqReward.has(id) || /\((?:slide|deck) reward, task_id=/i.test(req ?? text0 ?? ""), em = await engineMode(id);
        s.raw = !isRw && (s.firstTurn ? em.first : em.edit) === "raw";
        await wput(id, ".dynapse/engine.json", JSON.stringify({ ...em, now: s.raw ? "raw" : "engine" })).catch(() => { });
    }
    if (req) {
        s.requestText = req.slice(0, 500);
        s.photoAis = [];
        const rt = req.match(/\((?:slide|deck) reward, task_id=(task_[a-z0-9]+)\)/i)?.[1];
        if (rt)
            s.rewardTask = rt;
    }
    if (!s.rewardTask && !rewardWorks.has(id)) {
        const rw = await readJson(id, ".dynapse/reward.json").catch(() => null);
        if (rw)
            rewardWorks.set(id, rw.task ?? "reward");
    } // 앱을 다시 켠 뒤에도 리워드 작업이면 리워드 규칙
    {
        const u0 = S.claudeLimit?.unifiedWindows?.five_hour?.utilization;
        s.quota0 = typeof u0 === "number" ? u0 : undefined;
        s.quota1 = undefined;
    }
    s.liveTok = 0;
    s.ctxPeak = 0;
    s.seenMsg = new Set();
    s.capped = false;
    s.cap = Math.min(TURN_CAP, s.capLeft ?? Infinity);
    s.busy = true;
    s.asked = false;
    s.merged = null;
    s.verifyN = 0;
    s.reviews = 0;
    s.firstReply = undefined;
    s.reviewNotes = [];
    s.usageAcc = undefined;
    s.look = undefined;
    s.lastStage = undefined;
    s.lastEvAt = Date.now();
    s.tm = { ...(s.tm?.received && Date.now() - s.tm.received < 10 * 60_000 ? { received: s.tm.received } : {}), start: Date.now() };
    s.tools = {};
    s.toolOpen = {};
    s.toolMs = 0;
    s.lastTool = undefined;
    s.lastToolAt = undefined;
    s.lastText = undefined;
    s.turnAt = Date.now();
    s.usage = null;
    s.turnText = text.replace(/^\[(이번 메시지의 역할|Roles for this message)[^\n]*\n/, "");
    render();
    const dir = await prepWork(id);
    eventLog(s, "턴 시작");
    // 리워드 턴 예산(#120 §3) — verify 횟수 기록을 비우고, 8분이 지나면 AI를 인터럽트해 지금까지를 검사·저장(검증 실패면 "제출 전 고칠 것" 칩). 개인 작업은 예산 없음
    agentRuns.delete(id);
    void wput(id, ".dynapse/verify-runs.json", "{}").catch(() => { });
    clearTimeout(s.budgetT);
    s.budgetT = undefined;
    clearTimeout(s.prepT);
    clearTimeout(s.prep2T);
    s.budgetLine = undefined;
    // 리워드 턴은 끊지 않는다(#214 보정 1 — 대표: "멈췄어요"로 끝나는 결과는 없어야 한다). 2:30까지 결과 장을 하나도 안 썼으면 "그만 읽고 지금 쓰라"는 한 줄만 넣는다
    if (s.rewardTask || rewardWorks.has(id)) {
        const wrote = async () => { let n = 0; for (const f of ((await T().core.invoke("work_files", { id }).catch(() => [])).map(x => x.name).filter(x => PAGE_RE.test(x)))) {
            const h = await wget(id, f).catch(() => null);
            if (h !== null && h !== s.startPages?.get(f))
                n++;
        } return n; };
        s.prepT = setTimeout(() => {
            void wrote().then(n => {
                if (n || !s.busy || s.procId === undefined || s.tool !== "claude")
                    return;
                report("turn", "reward.prep_nudge", `in=${s.liveTok ?? 0}`);
                void T().core.invoke("run_write", { id: s.procId, line: JSON.stringify({ type: "user", message: { role: "user", content: "Write the page now with what you have; no more reading." } }) }).catch(() => { });
            });
        }, 150_000);
        // 장 턴(#214 보정 1) — 4:00에도 그 장을 저장하지 않았으면 조용히 다음 장으로(끝에 한 번 더). 사용자에겐 진행 줄만
        const q = seqReward.get(id), curs = q?.phase === "pages" ? (q.curs ?? (q.cur ? [q.cur] : [])) : [], cur = curs[0];
        // 4분 규칙은 묶음 기준(#214 보정 3) — 묶음이면 장마다 2분 30초를 더한다. 그때까지 저장하지 않은 장만 끝에 한 번 더
        if (q && cur)
            s.prep2T = setTimeout(() => {
                void (async () => {
                    const miss = [];
                    for (const f of curs) {
                        const h = await wget(id, f).catch(() => null);
                        if (h === null || h === s.startPages?.get(f))
                            miss.push(f);
                    }
                    if (!miss.length || !s.busy || s.procId === undefined)
                        return;
                    q.skipped.push(...miss);
                    report("turn", "turn.page_skip", miss.join(","));
                    s.tierHit = true;
                    s.budgetLine = `${miss.map(pageKey).join("·")}은 끝에 다시 만들어요`;
                    if (s.tool === "claude") {
                        s.interrupted = true;
                        void T().core.invoke("run_write", { id: s.procId, line: JSON.stringify({ type: "control_request", request_id: `seq-${Date.now()}`, request: { subtype: "interrupt" } }) }).catch(() => { });
                    }
                    else
                        void T().core.invoke("run_kill", { id: s.procId }).catch(() => { });
                })();
            }, 240_000 + Math.max(0, curs.length - 1) * 150_000);
    }
    // 이번 턴에 실제로 쓰는 모델(#109) — "기본"만 보여 연결 탭의 선택이 반영됐는지 알 수 없었다
    {
        const EFF = { low: "낮음", medium: "보통", high: "높음" };
        const mdl = prettyModel(s.model) ?? "기본 모델";
        chatEvent(id, s, `${AI_LABEL[s.ai]} · ${mdl}${s.effort ? ` · ${EFF[s.effort] ?? s.effort}` : ""}${s.lightAuto ? " · 가벼운 턴" : ""}`, { ai: s.ai, model: s.model ?? null });
    }
    // 보정 상태(#91 보정 1) — 턴 시작에 data-shade·data-overlay가 있던 장. 턴 뒤 사라졌으면(사용자가 빼 달라고 함) 그 장에 data-lint-ok="contrast"
    {
        const names = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(f => /^result-[a-z0-9-]+\.html$/.test(f));
        const had = [];
        for (const pg of names) {
            const h = await wget(id, pg);
            if (h && /<section\b[^>]*\bdata-(shade|overlay)\s*=/i.test(h))
                had.push(pg);
        }
        s.shadeBefore = had;
    }
    {
        const t0 = await readJson(id, ".dynapse/TRACE.json");
        s.traceBefore = [...(t0?.children ?? []).map(c => JSON.stringify(c)), `empty:${JSON.stringify(t0?.empty_slots ?? [])}`, `capped:${JSON.stringify(t0?.capped_slots ?? [])}`];
    }
    flushSoon(id, s);
    if (s.tool === "claude") {
        // 위치 참조한 폴더는 턴마다 다시 인덱스하고 Claude에 읽기 위치로 넘긴다(원본 수정 금지는 지침으로)
        // 재색인은 연결 폴더 목록이 바뀌었거나 10분 지났을 때만(#54 C11 — 매 턴 최대 2000파일을 걸었다)
        const lk = JSON.stringify(await readJson(id, "context/links.json").catch(() => null));
        const li = linkIndexed.get(id);
        const linked = li && li.key === lk && Date.now() - li.at < 600_000 ? li.list : await T().core.invoke("link_reindex", { id }).catch(() => []);
        if (!li || li.key !== lk || Date.now() - li.at >= 600_000)
            linkIndexed.set(id, { key: lk, at: Date.now(), list: linked });
        // 다시 띄우는 조건(#29 A7·A10) — 모델·강도·참조 폴더·승인 모드·토큰이 바뀔 때만. 예산(매 턴 줄어든다)·추가 허용은 키에 넣지 않는다(매 턴 재시작 = 캐시 무효)
        // 새로 승인된 명령은 그 허용을 적용하려고 한 번만 다시 붙는다(respawn)
        const want = `${s.model ?? ""}|${s.effort ?? ""}|${linked.join(",")}|${s.auto ? "auto" : "manual"}|${s.library ? "lib" : ""}|${s.drive ? "drive" : ""}|${(s.connectors ?? []).join(",")}|${s.folderDir ?? ""}|${(s.extraDirs ?? []).join(",")}`;
        // 모델별 프로세스 유지(#54 C8) — 모델·강도만 바뀌면 지금 프로세스를 닫지 않고 세워 두고(캐시 유지), 그 설정의 세워 둔 프로세스가 있으면 그걸 다시 쓴다(재시작·캐시 없는 재처리 없음).
        // 세워 둔 동안 다른 프로세스가 처리한 요청은 돌아올 때 한 줄로 알린다. 토큰·참조 폴더·승인 모드·새 허용이 바뀌면 지금처럼 다시 띄운다(세워 둔 것도 닫는다)
        const sameEnv = (a) => (a ?? "").split("|").slice(2).join("|") === want.split("|").slice(2).join("|");
        let missedHead = "";
        if (s.procId !== undefined && s.spawnedWith !== want && s.token === S.token && !s.respawn && sameEnv(s.spawnedWith)) {
            s.parked = (s.parked ?? []).filter(x => sameEnv(x.want));
            for (const x of s.parked.splice(1))
                void T().core.invoke("run_close_stdin", { id: x.procId }).catch(() => { }); // 세워 두는 건 하나까지(모델 둘)
            const back = s.parked.find(x => x.want === want);
            s.parked = s.parked.filter(x => x !== back);
            s.parked.push({ want: s.spawnedWith ?? "", procId: s.procId, sessionId: s.sessionId, at: Date.now(), missed: [] });
            if (s.sessionId)
                (s.sidByWant ??= {})[s.spawnedWith ?? ""] = s.sessionId;
            if (back) {
                s.procId = back.procId;
                s.sessionId = back.sessionId;
                s.spawnedWith = want;
                s.freshSpawn = false;
                if (back.missed.length)
                    missedHead = `[While you were idle the user asked another model for: ${back.missed.slice(-5).join(" · ").slice(0, 400)} — the files already reflect it.]\n`;
            }
            else {
                s.procId = undefined;
                s.sessionId = s.sidByWant?.[want];
            } // 그 모델의 지난 대화가 있으면 이어서, 없으면 새 대화(파일이 상태)
        }
        if (s.procId !== undefined && (s.token !== S.token || s.spawnedWith !== want || s.respawn)) {
            const old = s.procId;
            s.procId = undefined;
            for (const x of s.parked ?? [])
                void T().core.invoke("run_close_stdin", { id: x.procId }).catch(() => { });
            s.parked = [];
            await T().core.invoke("run_close_stdin", { id: old }).catch(() => { });
            await new Promise(r => setTimeout(r, s.sessionId ? 1500 : 0)); // 같은 대화를 이어 붙일 때만 옛 프로세스가 기록을 닫을 시간(#54 C8 — 새 대화면 기다리지 않는다)
        } // 토큰·모델·강도·예산·승인 모드가 바뀌면 새 인자로 다시 붙는다(--resume). 옛 프로세스 종료는 새 턴을 끝내지 않는다(procId를 먼저 비움)
        if (s.procId === undefined) {
            if (s.sessionId)
                s.out.push({ role: "event", text: "이어서 불러옴 · 대화 기억 유지", payload: { kind: "stage", ai: s.ai } }); // 대화가 이어진다는 표시(#25 C)
            s.token = S.token;
            s.spawnedWith = want;
            s.respawn = false;
            s.freshSpawn = true;
            s.notesSent = false;
            const budget = budgetUsd(s);
            // 내 자료함은 사용자 커넥터를 쓴다(--strict-mcp-config 없이 = claude.ai 커넥터가 보인다) · Drive 커넥터 도구 허용 · 다운로드 폴더 읽기(복사만, 지시문)
            homeDir = dir.split(/[\\/]Dynapse[\\/]/)[0];
            const downloads = s.library ? `${dir.split(/[\\/]Dynapse[\\/]/)[0]}${dir.includes("\\") ? "\\" : "/"}Downloads` : null;
            const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--mcp-config", ".dynapse/mcp-config", ...(s.library || s.drive || s.connectors?.length ? [] : ["--strict-mcp-config"]),
                "--max-turns", String(LIMITS.maxTurns), "--allowedTools", [CHAT_TOOLS, ...(s.library ? ["mcp__claude_ai_Google_Drive", "Bash(ls *)", "Bash(find *)"] : s.drive ? ["mcp__claude_ai_Google_Drive"] : []), ...(s.connectors ?? []), ...(s.extraAllow ?? [])].join(" "), "--add-dir", dir, ...linked.flatMap(p => ["--add-dir", p]), ...(downloads ? ["--add-dir", downloads] : []), ...(s.folderDir ? ["--add-dir", s.folderDir] : []), ...(s.extraDirs ?? []).flatMap(p => ["--add-dir", p]),
                ...(s.model ? ["--model", s.model] : []), ...(s.effort ? ["--effort", s.effort] : []), ...(budget ? ["--max-budget-usd", budget.toFixed(2)] : []),
                // 자동 승인(#27 A) — 공식 auto 모드(Claude Code 분류기). 끄면 manual + 카드. --dangerously-skip-permissions는 쓰지 않는다
                "--permission-mode", s.auto ? "auto" : "manual", "--disallowedTools", [...DENY, ...(s.lanePage ? s.laneDeny ?? [] : []), ...(s.pageThread ? PAGE_MCP_DENY : [])].join(" "),
                ...(s.sessionId ? ["--resume", s.sessionId] : [])];
            let mine;
            chatEvent(id, s, "Claude 시작 중", { ai: "claude" });
            await flushChat(id, s);
            (s.tm ??= {}).spawned = Date.now(); // 새 프로세스를 띄울 때만(#45 — 기동 몇 초가 조용했다)
            const started = spawn("claude", args, "", dir, l => { logChat(l); errTail(s, l); chatLine(id, s, l); }, pid => { mine = pid; s.procId = pid; }, true);
            started.then(code => {
                // 설정이 바뀌어 새로 띄운 경우, 닫히는 옛 프로세스의 종료가 새 턴을 끝내지 않게 — 지금 프로세스일 때만(#26 보정: "끝났어요(종료 코드 0)")
                if (mine !== undefined && s.procId !== mine)
                    return;
                s.procId = undefined;
                if (s.busy && s.capped)
                    void capStop(id, s);
                else if (s.busy) {
                    void endTurn(id, s, false, `Claude Code가 끝났어요(종료 코드 ${code})`);
                    void diagAuto({ tool: "claude", stage: "turn", code: `exit:${code}`, log: (s.errTail ?? []).join("\n"), work: id, cli: S.tools.claude.version || null });
                }
            });
            for (let k = 0; k < 50 && s.procId === undefined; k++)
                await new Promise(r => setTimeout(r, 100));
        }
        if (s.procId === undefined) {
            void diagAuto({ tool: "claude", stage: "turn", code: "spawn_fail", log: (s.errTail ?? []).join("\n"), work: id, cli: S.tools.claude.version || null });
            return endTurn(id, s, false, "Claude Code를 시작하지 못했어요");
        }
        const ctx = await notesHead(id, s);
        for (const x of s.parked ?? [])
            if (s.requestText)
                x.missed.push(s.requestText.split("\n")[0].slice(0, 80));
        await T().core.invoke("run_write", { id: s.procId, line: JSON.stringify({ type: "user", message: { role: "user", content: missedHead + ctx + text } }) })
            .catch(e => endTurn(id, s, false, `전달 실패: ${e}`));
    }
    else if (s.tool === "agy") {
        // Gemini 편집(#153 ① · 결정 b) — 턴마다 agy 한 번(--conversation으로 이어서). Dynapse MCP는 쓰지 않는다(토큰을 agy 전역 설정에 두지 않는다) —
        // 사진·검사·제출은 앱이 턴 밖에서 한다. 쓰기 권한은 이 작업 폴더만 턴 동안 settings.json에(agy_allow, mcp 규칙 없음), 끝나면 뺀다
        await dropAgyMcp();
        await T().core.invoke("agy_allow", { folder: dir, on: true }).catch(e => { report("turn", "agy.allow_fail", String(e).slice(0, 120)); });
        // 모델 — 고른 Gemini 글 모델만(사진 모델 이름이 오면 편집 기본 모델)
        const args = ["-p=", "--output-format", "stream-json", "--input-format", "stream-json", "--mode", "accept-edits", "--model", s.model && /^gemini-[\d.]+-(flash|pro)(-[a-z]+)?$/.test(s.model) && !/image/.test(s.model) ? s.model : AGY_MODEL, "--add-dir", dir, ...(s.sessionId ? ["--conversation", s.sessionId] : [])];
        s.errTail = [];
        const msg = JSON.stringify({ event: "user", message: { content: `${(s.sessionId ? "" : await notesHead(id, s))}${AGY_HEAD}${text}` } }) + "\n";
        chatEvent(id, s, "Gemini 시작 중", { ai: "gemini" });
        await flushChat(id, s);
        (s.tm ??= {}).spawned = Date.now();
        const code = await spawn("agy", args, msg, dir, l => { logChat(l); errTail(s, l); chatLine(id, s, l); }, pid => { s.procId = pid; }).catch(() => -1);
        s.procId = undefined;
        await T().core.invoke("agy_allow", { folder: dir, on: false }).catch(() => { });
        const failed = code !== 0 || s.agyStatus === "ERROR";
        if (failed && !s.capped)
            void diagAuto({ tool: "agy", stage: "turn", code: `exit:${code}${s.agyStatus === "ERROR" ? ":error" : ""}`, log: (s.errTail ?? []).join("\n"), work: id, cli: null });
        const denied = (s.errTail ?? []).some(l => /auto-denied|permission that headless mode cannot prompt/i.test(l));
        if (s.tierHit && !s.capped) {
            await endTurn(id, s, true);
            return;
        }
        if (s.capped)
            await capStop(id, s);
        else
            await endTurn(id, s, !failed, !failed ? undefined : denied ? "Gemini가 허용되지 않은 동작을 하려다 멈췄어요 · 다시 보내면 이어서 해요" : s.agyError ? `Gemini가 끝나지 못했어요 · ${s.agyError.slice(0, 80)}` : `Gemini가 끝나지 못했어요(종료 코드 ${code})`);
        s.agyStatus = undefined;
        s.agyError = undefined;
    }
    else {
        const mo = [...(s.model && codexModelOk(s.model) ? ["-m", s.model] : []), ...(s.effort ? ["-c", `model_reasoning_effort="${s.effort}"`] : [])];
        const args = s.sessionId
            ? ["exec", "resume", "--json", "--skip-git-repo-check", ...mo, "-c", 'sandbox_mode="workspace-write"', "-c", "sandbox_workspace_write.network_access=true", s.sessionId, "-"]
            // --approve-for-me는 그 자체가 workspace-write 샌드박스 — -s와 같이 쓰면 인자 오류(종료 코드 2). 자동 승인이면 -s를 빼고, 아니면 -s만
            : ["exec", "--json", "--skip-git-repo-check", ...mo, ...(s.auto ? ["--approve-for-me"] : ["-s", "workspace-write"]), "-c", "sandbox_workspace_write.network_access=true", "-C", dir, "-"]; // Codex 자동 승인(#27) — 샌드박스 안 자동 검토(exec resume엔 이 옵션이 없다)
        s.errTail = [];
        const code = await spawn("codex", args, (s.sessionId ? "" : await notesHead(id, s)) + text, dir, l => { logChat(l); errTail(s, l); chatLine(id, s, l); }, pid => { s.procId = pid; }).catch(() => -1);
        s.procId = undefined;
        if (code !== 0 && !s.capped)
            void diagAuto({ tool: "codex", stage: "turn", code: `exit:${code}`, log: (s.errTail ?? []).join("\n"), work: id, cli: S.tools.codex.version || null });
        // 계정에서 못 쓰는 모델(#95 A) — 기억하고 다음 턴은 기본 모델. 문구는 "모델 설정" 한 줄(JSON 통째가 아니라)
        const unsup = code !== 0 && s.model && (s.errTail ?? []).some(l => CODEX_UNSUP.test(l));
        if (unsup) {
            markCodexUnsupported(s.model);
        }
        if (s.tierHit && !s.capped) {
            await endTurn(id, s, true);
            return;
        }
        if (s.capped)
            await capStop(id, s);
        else
            await endTurn(id, s, code === 0, code === 0 ? undefined : unsup ? `모델 설정 · ${s.model}은 ChatGPT 계정에서 못 써요 — 기본 모델로 바꿨어요. 다시 보내 주세요` : `Codex가 끝나지 못했어요(종료 코드 ${code})`);
        if (unsup) {
            await postChat(id, [{ role: "agent", text: `고른 ${s.model}은 이 ChatGPT 계정에서 못 써요`, payload: { ai: "dynapse", summary: [`${s.model} 못 씀`], decision: { ask: `기본 모델${S.defaultModels.chatgpt ? `(${S.defaultModels.chatgpt})` : ""}로 다시 할까요?`, options: ["기본 모델로 다시 해 줘", "모델은 그대로 둘게요"] } } }]).catch(() => { });
            s.model = null;
        } // 낮추는 건 사람이 고른다(#306)
    }
}
// 새 프로세스의 첫 메시지(#29 C4) — NOTES 마지막 3줄을 앞에(에이전트가 NOTES·TRACE를 읽지 않게). 같은 프로세스에서는 한 번만
async function notesHead(id, s) {
    if (s.notesSent)
        return "";
    s.notesSent = true;
    const lines = ((await wget(id, ".dynapse/NOTES.md")) ?? "").split("\n").map(l => l.trim()).filter(l => l.startsWith("- ")).slice(-3);
    return lines.length ? `[Last notes from earlier turns — do not open NOTES.md or TRACE.json]\n${lines.join("\n")}\n\n` : "";
}
// 한 턴 끝 — 앱 독립 검증 → (실패면 같은 세션에 실패 JSON으로 한 번 더) → 통과분만 버전 커밋 → 사진·요약을 대화에
// 공개 기여 권하기(#144 §4) — 결과가 좋을 때만, 하루 한 번: 검사 통과 · 바뀐 장마다 경고 ≤ 3 · 빈 사진 칸·외부 사진 없음 · 대외비 표시 없음 · 리워드·가져온 덱 아님.
// 포인트 액수는 웹의 공개 흐름이 보여 준다. 서버는 소유자의 비공개 작업에만 이 카드를 남긴다(이미 공개·검수 중이면 버림). 내부자료는 공개·Task 대상이 아니다(docs/00)
const CONFIDENTIAL = /대외비|내부\s*용|사내\s*(한정|용)|기밀|confidential|internal\s+(use|only)|do not distribute/i;
async function contributeAsk(id, s, v, empty) {
    if (!v.ok || empty > 0 || s.rewardTask || rewardWorks.has(id) || importedWorks.has(id))
        return;
    const per = new Map();
    for (const w of v.warnings)
        if (w.page !== "*")
            per.set(w.page, (per.get(w.page) ?? 0) + 1);
    if ([...per.values()].some(n => n > 3) || [...v.errors, ...v.warnings].some(e => /^(external|relative)$/.test(e.rule)))
        return;
    const day = new Date().toLocaleDateString("sv");
    if ((await store.get("contribute_ask").catch(() => null)) === day)
        return;
    const pages = ((await readPages(id).catch(() => null)) ?? []).slice(0, 80);
    if (pages.length < 3)
        return;
    for (const f of pages) {
        const h = await wget(id, f);
        if (h && CONFIDENTIAL.test(h.replace(/<[^>]+>/g, " ")))
            return;
    }
    await store.set("contribute_ask", day).catch(() => { });
    await store.save().catch(() => { });
    s.out.push({ role: "event", text: "이 덱을 공개 기여(무상)할 수 있어요 · 내용은 그대로 갤러리에 올라가요", payload: { kind: "contribute-ask", ai: "dynapse" } });
    report("turn", "contribute.ask", `pages=${pages.length}`);
}
// AI 로그인 풀림 원문(#185) — Claude·Codex·Gemini CLI가 실측으로 내는 말만(넓게 잡지 않는다)
export const AUTH_LOST = /OAuth access token is invalid|authentication_error|invalid_api_key|Invalid API key|Please run \/login|Not logged in|not authenticated|access token could not be refreshed|refresh token (was )?(already used|expired|invalid)|401 Unauthorized|Unauthorized: |login required|auth(entication)? (has )?expired/i;
const reloginPending = new Map();
// [다시 로그인](#185) — 그 AI의 공식 로그인 → 되면 같은 턴을 한 번 다시(되면 지운다 · 실패면 같은 줄을 다시)
async function relogin(id, tool) {
    const m = await import("./main.js");
    const okLogin = tool === "agy" ? await m.agyLogin().catch(() => false) : await m.openLogin(tool).catch(() => false);
    const ai = tool === "codex" ? "chatgpt" : tool === "agy" ? "gemini" : "claude";
    if (!okLogin) {
        await postChat(id, [{ role: "event", text: `${AI_LABEL[ai] ?? tool} 로그인이 끝나지 않았어요`, payload: { kind: "relogin", ai, tool } }]);
        return;
    }
    const p = reloginPending.get(id);
    reloginPending.delete(id);
    await postChat(id, [{ role: "event", text: "다시 연결됐어요 · 방금 요청을 이어서 해요", payload: { kind: "stage", ai: "dynapse" } }]);
    if (p)
        await chatSend(id, p.text, { route: p.route });
}
// 작업량 한도로 멈춘 턴(C5 S1 2회차 10-27 — "표지부터 채워넣어"·"남은 고칠 것을 고쳐 주세요"가 "여기까지 저장했어요 · 이어서"로 답 없이 끝났다):
// 사용자 말 사이에 2번까지 앱이 남은 것을 이어서 보낸다(가벼운 턴이었으면 보통으로). 리워드·묶음 큐·장 건너뜀 줄(budgetLine)은 원래 한 줄
function tierStop(id, s) {
    const n = autoCont.get(id) ?? 0, rq = s.requestText ?? "";
    if (userStopped(id) || s.budgetLine || !rq || n >= 2 || s.rewardTask || rewardWorks.has(id) || seqReward.has(id) || s.queueItem !== undefined) {
        s.out.push({ role: "event", text: s.budgetLine ?? "여기까지 저장했어요 · 이어서", payload: { kind: "stage", ai: "dynapse" } });
        return;
    }
    autoCont.set(id, n + 1);
    s.contQueued = true;
    keepTier.set(id, s.tier === "heavy" ? "heavy" : "normal");
    report("turn", "tier.auto_continue", `n=${n + 1} tier=${s.tier ?? "-"}`);
    s.out.push({ role: "event", text: "여기까지 저장했어요 · 남은 것을 이어서 해요", payload: { kind: "stage", ai: "dynapse" } });
    const text = `[Auto-continue ${n + 1}/2: the last turn stopped at its work limit and its changes are saved. Look at the current pages and finish only what is still missing from this request — do not redo finished parts. End with a short Korean reply.]\n${rq}`;
    setTimeout(() => void simOrSend()(id, text, { raw: rq, ...(s.route ? { route: s.route } : {}), ...(s.turnPage ? { page: s.turnPage } : {}), ...(s.scope ? { scope: s.scope } : {}) }).catch(() => { }), 0);
}
export async function endTurn(id, s, ok, why) {
    if (!s.busy)
        return;
    if (s.stopped)
        return stoppedTurn(id, s); // ■ 중단(#50) — 검증·커밋·썸네일 없이
    // 한도(C5 ⑤ — 희원: "You've hit your session limit · resets 1:20pm" 원문이 그대로): 사람 말 한 줄 + 다른 AI로 [이어서 하기]. 이 턴의 반쯤 쓴 장은 턴 시작으로(이어서 하면 처음부터)
    {
        const F5 = await import("./facts.js"), li = F5.limitInfo(`${s.lastText ?? ""} ${why ?? ""} ${(s.errTail ?? []).slice(-3).join(" ")}`);
        // Opus만 찬 한도(주간 Opus 한도)면 다른 AI가 아니라 같은 Claude의 Sonnet으로 묻는다(#306 — 낮추는 건 사람이 고른다)
        const opusOnly = s.ai === "claude" && /\bopus\b/i.test(`${s.lastText ?? ""} ${why ?? ""}`) && /opus/i.test(s.model ?? s.runModel ?? "");
        if (li) {
            const ok2 = (t) => S.tools[t].installed && S.tools[t].loggedIn !== false, alt = opusOnly ? "claude" : s.ai !== "chatgpt" && ok2("codex") ? "chatgpt" : s.ai !== "claude" && ok2("claude") ? "claude" : null;
            report("turn", "limit.hit", `ai=${s.ai} alt=${alt ?? "-"}`);
            s.lastText = undefined;
            s.out.push({ role: "event", text: opusOnly ? `Opus 사용량이 ${li.reset ? `${li.reset}까지 ` : ""}찼어요 · 고른 Opus 대신 Sonnet으로 이어서 할까요?` : `${AI_LABEL[s.ai] ?? s.ai} 사용량이 ${li.reset ? `${li.reset}까지 ` : ""}찼어요${alt ? ` · ${AI_LABEL[alt]}로 이어서 할까요?` : li.reset ? ` · ${li.reset}에 다시 할 수 있어요` : ""}`, payload: { kind: "limit-switch", ai: "dynapse", from: s.ai, ...(alt ? { to: alt } : {}), ...(opusOnly ? { model: "claude-sonnet-5" } : {}), reset: li.reset } });
            return finishTurn(id, s);
        }
    }
    if (s.tierHit && !s.capped && !s.tierSaid) {
        s.tierSaid = true;
        tierStop(id, s);
    } // 작업량 한도 — 한 줄 + 남은 것 이어서(아래 tierStop)
    (s.tm ??= {}).agent_done ??= Date.now();
    if (s.lastTool && s.lastToolAt) {
        const x = (s.tools ??= {})[s.lastTool] ??= { n: 0, ms: 0 };
        x.ms += Date.now() - s.lastToolAt;
        s.lastTool = undefined;
    }
    // 리워드 턴은 승인 카드도 자동 승인도 없다(#120 보정 1 · #127 보정 3 — 이 정리가 자동 승인 뒤에 있어 리워드도 "다시 실행" 길을 탔다)
    if (s.denied?.length && (s.rewardTask || rewardWorks.has(id))) {
        s.denied = [];
        s.deniedDirs = [];
    }
    // 리워드 장은 턴이 끝날 때 색 토큰부터(#239 ① · #248 — 접는 청첩장 초안이 회색으로 보였다): 블록 없는 장에 Task 색 블록(AI 0). 제출 때도 한 번 더 본다
    {
        const tk = s.rewardTask ?? rewardWorks.get(id);
        if (ok && tk && /^task_[a-z0-9]+$/.test(tk))
            await injectTokens(id, tk).catch(() => 0);
    }
    // 거부 목록에 걸린 명령(#127 보정 3) — 승인·재실행이 아니라 같은 턴에 안내 한 번(턴당 1회). 그 안내에 대한 답은 띄우지 않고 앞의 답을 쓴다(사용량은 같은 카드)
    if (s.denyHit && !s.denyNoted && s.tool === "claude" && s.procId !== undefined) {
        s.denyHit = false;
        s.denyNoted = true;
        foldUsage(s);
        if (s.firstReply === undefined)
            s.firstReply = s.lastText;
        await flushChat(id, s);
        await T().core.invoke("run_write", { id: s.procId, line: JSON.stringify({ type: "user", message: { role: "user", content: "That command is not allowed here (no inline scripts: node -e, python3 -c, sed over files). Make the same change with Write or Edit on the file, then continue. Do not explain this to the user." } }) }).catch(() => { });
        return;
    }
    s.denyHit = false;
    // 자동 승인(#27 · 대표: "이미 승인하기로 했는데 또 누르게 하지 말 것") — 켜져 있으면 막힌 명령을 이 작업에 허용·기억하고 카드 없이 이어서.
    // 위험 명령(rm·sudo 등)과 같은 턴 2회 넘게 막히면 카드로 묻는다. 거부 목록(DENY)은 언제나 우선
    if (s.denied?.length && !s.asked && s.auto && (s.autoRetry ?? 0) < 2 && s.denied.every(r => !RISKY.test(r))) {
        s.extraAllow = [...new Set([...(s.extraAllow ?? []), ...s.denied])].slice(-40);
        s.respawn = true;
        await wput(id, ".dynapse/allow.json", JSON.stringify(s.extraAllow, null, 2)).catch(() => { });
        if (s.deniedDirs?.length) {
            s.extraDirs = [...new Set([...(s.extraDirs ?? []), ...s.deniedDirs])].slice(-8);
            s.deniedDirs = [];
            await wput(id, ".dynapse/allow-dirs.json", JSON.stringify(s.extraDirs, null, 2)).catch(() => { });
        }
        s.out.push({ role: "event", text: "자동 승인했어요", payload: { kind: "stage", ai: s.ai, detail: s.denied.map(r => r.replace(/^Bash\((\S+).*$/, "$1")).join(", ").slice(0, 60) } }); // 도구 이름은 [자세히] 안(C5 ⑥)
        s.denied = [];
        s.autoRetry = (s.autoRetry ?? 0) + 1;
        // 이미 쓴 첫 답은 이어 간 턴의 답으로(#304 앵커 A 10-27 — 이미지 목록·프롬프트가 든 첫 답이 사라지고 이어 간 턴의 영어 한 줄만 보였다)
        if (s.firstReply?.trim() && !carryReply.has(id))
            carryReply.set(id, s.firstReply);
        s.queue.unshift("Re-run the command that was just blocked and continue. Your earlier answer is already shown to the user; if you add a note, write it in Korean.");
        (s.reqQueue ??= []).unshift(null); // 같은 요청의 이어 가기
        return finishTurn(id, s);
    }
    // 권한으로 막힌 턴(#22-보정 3) — 설명문 대신 카드 하나: Claude · 실행을 승인해 주세요 [승인] [건너뛰기]
    // 승인 카드 없음(#138) — 자동 승인으로도 못 푼 명령(위험 명령·두 번 넘게 막힘)은 리워드처럼 건너뛰고 끝까지 간다. 회색 한 줄만
    if (s.denied?.length && !s.asked) {
        s.out.push({ role: "event", text: `막힌 명령 ${s.denied.length}개는 건너뛰었어요 · ${s.denied.map(r => r.replace(/^Bash\((\S+).*$/, "$1")).join(", ").slice(0, 60)}`, payload: { kind: "stage", ai: "dynapse" } });
        report("turn", "turn.denied_skipped", `n=${s.denied.length}`);
        s.denied = [];
        s.deniedDirs = [];
    }
    // 어디인지 되묻는 답(#99 보정 2) — "어느 페이지·어떤 섹션인지 알려주시면" 대신 마지막 📍(10분 안)로 같은 요청을 바로 다시(묻지 않는다, 한 번만)
    {
        const pin = lastPin.get(id);
        if (ok && !s.asked && !s.rewardTask && pin && Date.now() - pin.at < 10 * 60_000 && !whichRetried.has(id) && ASK_WHICH.test(s.lastText ?? "") && (s.requestText ?? "").trim()) {
            whichRetried.add(id);
            setTimeout(() => whichRetried.delete(id), 120_000);
            report("turn", "turn_ask_which", `model=${s.runModel ?? "-"} tier=${s.tier ?? "-"}`);
            s.out.push({ role: "event", text: "같은 자리로 봤어요", payload: { kind: "stage", ai: "dynapse" } });
            const again = s.requestText;
            await finishTurn(id, s);
            void handleChat({ id: `auto:${Date.now()}`, work: id, role: "user", text: again, payload: { point: pin.pts, ...(pin.route ? { route: pin.route } : {}) } });
            return;
        }
    }
    // 묻고 멈춤·미룬 일(#229 — BizCrush IR: "부록 장은 새 큐에서 빼고… 첫째 작업은…"으로 파일 0개 · 다음 "그래서 만든다는 거야"엔 가벼운 턴이 "진행하라는 뜻이신가요?"):
    // 결과 장·사진·토큰을 하나도 안 바꾼 턴이 질문·확인 요청·미루기로 끝나면 숨긴 답 한 번("방금 말한 계획을 지금 하라") + 진행 줄. 두 번째면 그대로 보이고 보고
    // 언어판 어긋남(#229 보정 1 · #100 보정 4 — BizCrush: 한국어판 제목만 바뀌고 영어판은 예전 제목): 이 턴에 한 판의 제목 칸이 바뀌고 같은 장의 다른 판은 그대로면 한 줄 + 다음 턴 앞머리에 접는다
    if (ok && !s.rewardTask) {
        const st = (await staleEditions(id, s).catch(() => [])).filter(x => LANG_PAGE.test(x.from)); // 원문을 고친 쪽은 아래 언어판 따라가기(#234 ②)가 맞춘다 — 언어판만 고친 경우만 알림
        if (st.length) {
            await wput(id, ".dynapse/edition-stale.json", JSON.stringify(st)).catch(() => { });
            report("turn", "turn.edition_stale", `n=${st.length}`);
            s.out.push({ role: "event", text: `${st.map(x => langLabel(x.file)).filter((v, i, a) => a.indexOf(v) === i).join("·")} 제목이 아직 예전 그대로예요 · 다음 요청 때 함께 맞춰요`, payload: { kind: "stage", ai: "dynapse" } });
        }
    }
    // 계획 파일만 쓴 턴(#229 보정 1 — BizCrush: "작업 지시를 .dynapse/turn.json에 · viz-plan.json에 계획" 뒤 장 0, 다음 턴은 "대기 중인 경쟁 지도 작업에서"): .dynapse/*.json은 일이 아니다.
    // 장·재료·토큰·RULES.md를 안 바꾸고 계획 파일(turn·viz-plan·plan.json)만 쓴 보통·무거운 턴도 같은 숨긴 답 한 번(그 파일에 쓴 것을 지금 장에)
    {
        const lt = (s.lastText ?? "").trim(), ch = S.git && ok && !s.asked && !s.rewardTask ? await T().core.invoke("repo_changed", { id }).catch(() => []) : [];
        const work = ch.some(f => /^result-[a-z0-9-]+(\.[a-z]{2})?\.html$|^materials\/|^tokens\.css$|^context\/RULES\.md$/.test(f)), planOnly = !work && s.tier !== "light" && ch.some(f => /^\.dynapse\/(turn|viz-plan|plan)\.json$/.test(f));
        const swallowed = !work && reviewTurn.has(id) && EDIT_ASK.test(s.requestText ?? ""); // 찾기 턴이 고치라는 말을 삼킴(#229 보정 2)
        if (swallowed)
            reviewTurn.delete(id);
        if (ok && !s.asked && !s.rewardTask && lt && (ASK_GO.test(lt) || DEFER_RE.test(lt) || planOnly || swallowed)) {
            if (!work) {
                const n = askLoop.get(id) ?? 0;
                if (n < 1) {
                    askLoop.set(id, n + 1);
                    setTimeout(() => askLoop.delete(id), 600_000);
                    keepTier.set(id, s.tier ?? "normal");
                    report("turn", swallowed ? "turn.review_swallowed" : planOnly && !ASK_GO.test(lt) && !DEFER_RE.test(lt) ? "turn.plan_only" : "turn.ask_continue", `${planOnly ? "plan" : DEFER_RE.test(lt) ? "defer" : "ask"} model=${s.runModel ?? "-"} tier=${s.tier ?? "-"}`);
                    s.out.push({ role: "event", text: "바로 이어서 만들어요", payload: { kind: "stage", ai: "dynapse" } });
                    await finishTurn(id, s);
                    void handleChat({ id: `auto:${Date.now()}`, work: id, role: "user", text: swallowed ? `Apply the change the user asked for now, in this turn, on the pages it names (all language editions together): "${(s.requestText ?? "").slice(0, 300)}". Then list what else needs fixing.` : planOnly ? "Do everything you wrote in turn.json / viz-plan.json / plan.json now, in this turn — edit the pages, all language editions together; no questions, nothing pending." : "Yes — do the plan you just described, now, in this turn: write the pages; no questions, nothing queued for later.", payload: { auto: "continue" } });
                    return;
                }
                report("turn", "turn.ask_loop", `model=${s.runModel ?? "-"} tier=${s.tier ?? "-"}`);
                askLoop.delete(id);
            }
        }
    }
    // 거절한 답(#99 보정 1 turn_refusal) — 바꿔 달라고 했는데 "레이아웃 제한 · 페이지 단위로 요청 · 파일을 바꾸지 않았습니다"로 끝난 턴은 묻지 않고 한 번만 장 범위·보통 등급으로 다시
    if (ok && !s.asked && !s.noRefusalRetry && !s.rewardTask && REFUSAL.test(s.lastText ?? "") && s.turnText) {
        const again = s.turnText;
        if (s.mx)
            s.mx.refusal = true;
        report("turn", "turn_refusal", `model=${s.runModel ?? "-"} tier=${s.tier ?? "-"}`);
        // 장을 더하거나 빼는 요청이면(요청 글 또는 거절 답에 "페이지 추가") 덱 범위로
        const deck = DECK_WORDS.test(again) || /(새|추가).{0,8}(페이지|장표|슬라이드)|(페이지|장표|슬라이드).{0,8}(추가|넣)|덱\s*['"‘“]?\s*단위|덱\s*범위|\bdeck\b/i.test(s.lastText ?? ""); // AI가 말한 범위로
        report("turn", "scope_miss", `scope=${s.scope ?? "-"} tier=${s.tier ?? "-"} to=${deck ? "deck" : "page"}`); // 다이제스트용 — 낱말·글 없이 등급만
        s.out.push({ role: "event", text: deck ? "범위를 덱으로 넓혀 다시 해요" : "범위를 장으로 넓혀 다시 해요", payload: { kind: "stage", ai: "dynapse" } });
        await finishTurn(id, s);
        const sc = await scopeTurn(id, deck ? "장 추가" : "이 장 구조", deck ? [] : [{ file: "", selector: "" }]).catch(() => null);
        void chatSend(id, `${sc?.head ?? ""}[The previous reply declined a change the user asked for. Do it now at ${deck ? "deck" : "page"} scope; do not ask.]\n${again}`, { scope: deck ? "deck" : "page", route: s.route, refusalRetry: true });
        return;
    }
    // 합치기 질문을 보낸 턴(#21) — 반쯤 합친 상태를 저장하지 않는다. 답(다음 메시지)이 오면 같은 세션에서 이어진다
    if (ok && s.asked) {
        s.out.push({ role: "agent", text: s.lastText ?? "골라 주세요", payload: { ai: s.ai, model: s.runModel ?? null, summary: summaryLines(s.lastText) } });
        return finishTurn(id, s);
    }
    // 네트워크로 막힌 턴(#142 "무조건 멈추지 않게") — 회사망을 맞추고, 이 PC 엔진이 준비돼 있으면 같은 요청을 이 PC로 바로 이어서(리워드 제외 · 한 번)
    // AI 로그인이 풀림(#185 — Windows 사용자에게 Claude의 "401 OAuth access token is invalid" 원문이 그대로 보였다): 원문 대신 한 줄 + [다시 로그인].
    // 다시 로그인되면 같은 턴을 한 번 다시 보낸다(reloginPending). 에이전트 글은 짧을 때만 본다(긴 답 속 "401"을 오인하지 않게)
    let authLost = false;
    // 입력이 너무 김(#213 보정 1 — 32번째 턴 + 캡처 둘에 "ERROR: Your input exceeds the maximum number of tokens allowed"가 사용자에게 그대로 보였다):
    // 원문은 보이지 않고, 그 대화를 닫고 새 대화(넘겨받기 한 단락)로 같은 요청을 한 번 조용히 다시. 진행 줄 하나
    if (TOO_LONG.test(`${(s.lastText ?? "").slice(0, 800)}\n${(s.errTail ?? []).join("\n")}\n${s.agyError ?? ""}\n${why ?? ""}`) && s.turnText && !longRetried.has(id)) {
        longRetried.add(id);
        setTimeout(() => longRetried.delete(id), 600_000);
        report("turn", "turn.too_long", `tool=${s.tool} model=${s.runModel ?? "-"}`);
        {
            const rt = rtOf(s.tool), sj = (await readJson(id, ".dynapse/session.json").catch(() => null)) ?? {};
            const { [rt]: _o, ...rest } = sj;
            void _o;
            await wput(id, ".dynapse/session.json", JSON.stringify({ ...rest, [`${rt}_cr`]: 0, [`${rt}_n`]: 0 })).catch(() => { });
        }
        rollNote.add(id);
        if (s.procId !== undefined)
            void T().core.invoke("run_close_stdin", { id: s.procId }).catch(() => { });
        s.sessionId = undefined;
        s.sidByWant = {};
        s.lastText = undefined;
        s.out.push({ role: "event", text: "대화가 길어 정리하고 이어가요", payload: { kind: "stage", ai: "dynapse" } });
        const again = s.turnText;
        await finishTurn(id, s);
        void simOrSend()(id, again, { route: s.route }); // rollHead가 넘겨받기 한 단락을 앞에 붙인다
        return;
    }
    if (TOO_LONG.test(`${(s.lastText ?? "").slice(0, 800)}\n${(s.errTail ?? []).join("\n")}\n${why ?? ""}`)) {
        ok = false;
        s.lastText = undefined;
        why = "대화가 너무 길어요 · 작업 메뉴의 [복제]로 새 작업을 만들어 이어가 주세요";
        report("turn", "turn.model_error", `too_long2 tool=${s.tool}`);
        rollNote.add(id);
        s.sessionId = undefined;
        {
            const rt = rtOf(s.tool), sj = (await readJson(id, ".dynapse/session.json").catch(() => null)) ?? {};
            delete sj[rt];
            await wput(id, ".dynapse/session.json", JSON.stringify(sj)).catch(() => { });
        }
    } // 다시 한 번도 막히면 원문 대신 한 줄
    if (!s.rewardTask && AUTH_LOST.test(`${(s.lastText ?? "").length < 400 ? s.lastText ?? "" : ""}\n${(s.errTail ?? []).join("\n")}\n${s.agyError ?? ""}\n${why ?? ""}`)) {
        authLost = true;
        ok = false;
        why = `${AI_LABEL[s.ai]} 로그인이 풀렸어요`;
        s.lastText = undefined;
        if (s.turnText)
            reloginPending.set(id, { tool: s.tool, text: s.turnText, route: s.route });
        report("turn", "turn.auth_lost", `tool=${s.tool}`);
    }
    if (!ok && !s.rewardTask && /ENOTFOUND|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|certificate|self[- ]signed|unable to get local issuer|error sending request|getaddrinfo|socket hang up|proxy|network/i.test(`${why ?? ""} ${(s.errTail ?? []).join(" ")}`)) {
        void import("./main.js").then(m => m.netFix(1)).catch(() => null);
        report("turn", "turn.net_blocked", `ai=${s.ai}`);
        if (localReady() && s.turnText && !s.localTried) {
            s.localTried = true;
            const again = s.requestText ?? s.turnText;
            s.out.push({ role: "event", text: `${AI_LABEL[s.ai]}에 닿지 않아 이 PC로 이어서 해요 · 회사망을 맞추고 있어요(다음 요청부터 다시 내 AI로)`, payload: { kind: "stage", ai: "dynapse" } });
            await discardTurn(id, s);
            await finishTurn(id, s);
            const { runLocalTurn } = await import("./fill-runner.js");
            void runLocalTurn(id, again, {});
            return;
        }
        // 이 PC 엔진이 없으면(#146 §3) — 쓰다 만 장은 버리고 시작본 그대로(되돌리기 아님 · 직접 수정은 가드가 지킨다), 요청은 보관 → 연결되면 처음부터
        if (netState() !== "online" && s.turnText) {
            holdTurn(id, s.requestText ?? s.turnText);
            s.out.push({ role: "event", text: "인터넷이 끊겨 멈췄어요 · 쓰던 장은 시작 상태 그대로예요 · 연결되면 이 요청을 처음부터 다시 해요", payload: { kind: "stage", ai: "dynapse" } });
            await discardTurn(id, s);
            await finishTurn(id, s);
            return;
        }
    }
    if (!ok) {
        // 시작도 못 한 턴(세션·결과 없음) — 요청을 기억했다가 다음 메시지에 함께 넘긴다("이어서 해줘"가 빈 대화가 되지 않게)
        if (!s.sessionId && !s.usage && s.turnText)
            s.failedText = s.turnText;
        if (s.mx)
            s.mx.failed = true;
        s.out.push({ role: "event", text: why ?? `${AI_LABEL[s.ai]}가 이유를 남기지 않고 끝났어요 · 다시 보내면 이어서 해요`, payload: { kind: authLost ? "relogin" : "error", ai: s.ai, model: s.runModel ?? null, ...(authLost ? { tool: s.tool } : {}) } });
        // 밖에서 끊긴 턴(종료 코드 143·137 = 신호 — 발행 자가 점검·정리가 끊은 것)은 화면 묶음 탓이 아니다: OTA 지킴이가 세지 않게 다른 코드로
        const killed = /종료 코드 (143|137)\b|SIGTERM|SIGKILL/.test(why ?? "");
        report("turn", killed ? `turn.killed_${s.ai}` : `turn.fail_${s.ai}`, `model=${s.runModel ?? "-"} started=${!!s.sessionId}`);
        tally("turns", false); // 원격 보고(#116 §1) — 글은 싣지 않는다
        if (s.lastText)
            s.out.push({ role: "agent", text: s.lastText, payload: { ai: s.ai, model: s.runModel ?? null, summary: summaryLines(s.lastText) } });
        await discardTurn(id, s); // 실패 턴 = 커밋 없음, 파일은 턴 시작 상태로(#30)
        return finishTurn(id, s);
    }
    await mergeTurn(id, s); // 에이전트의 turn.json → TRACE·NOTES·tags(#29 C4)
    if (!s.raw) {
        const { applyVizActions } = await import("./viz.js");
        await applyVizActions(id).catch(() => 0);
    } // AI가 고른 차트 동작(#102 보정 5) — 검사 전에 적용
    // 덱 프레임 카드(#119 보정 7) — plan.json deck.frame이 새로 생기거나 바뀌면 세 줄로 보인다(사용자가 글을 고칠 수 있다)
    {
        const pf = (await readJson(id, ".dynapse/plan.json").catch(() => null))?.deck?.frame;
        if (pf?.about && pf.rule) {
            const key = JSON.stringify([pf.about, pf.metaphor ?? "", pf.rule]);
            if ((await wget(id, ".dynapse/frame-shown.json").catch(() => null)) !== key) {
                await wput(id, ".dynapse/frame-shown.json", key).catch(() => { });
                const fp = await readJson(id, ".dynapse/font-pair.json").catch(() => null);
                s.out.push({ role: "event", text: null, payload: { kind: "frame", ai: "dynapse", about: String(pf.about).slice(0, 160), metaphor: String(pf.metaphor ?? "").slice(0, 80), rule: String(pf.rule).slice(0, 160), ...(fp?.name ? { font: `${fp.name}${fp.why ? ` · ${String(fp.why).slice(0, 60)}` : ""}` } : {}) } });
            }
        }
    } // 글꼴 줄(#129 §4)
    await flushChat(id, s);
    const request = (s.requestText ?? s.turnText ?? "").split("\n")[0].slice(0, 200) || "요청";
    const isPage = (f) => /^result-[a-z0-9-]+\.html$/.test(f) || LANG_PAGE.test(f); // 언어판(#100)도 검사·저장
    // 순서 요청 턴(#139 A) — AI가 쓴 pages.json을 새 순서로 받아 쪽번호를 다시 쓰고 다시 잠근다. 그대로면 한 번 엄격하게 다시 → 그래도 그대로면 묻는 줄("바꾼 것 없음"으로 끝내지 않는다)
    {
        const oa = orderAsk.get(id);
        if (oa) {
            orderAsk.delete(id);
            const now = (await readPages(id).catch(() => null)) ?? [];
            const regrouped = oa.groups !== undefined && (await groupsOf(id)) !== oa.groups;
            if ((now.length && now.join() !== oa.start.join()) || regrouped) {
                orderUnlock.delete(id);
                await normalizeOrder(id, now.length ? now : oa.start).catch(() => null);
                await normalizeBundles(id).catch(() => false);
                const ord = (await readPages(id).catch(() => null)) ?? now;
                await wput(id, ".dynapse/order-lock.json", JSON.stringify({ order: ord, at: Date.now() })).catch(() => { });
                const moved = ord.filter((f, i) => oa.start.indexOf(f) !== i).length, nb = regrouped ? (await bundlesOf(id)).filter(b => b.name !== "본편") : [];
                s.out.push({ role: "event", text: [`순서 바꿈 · ${moved}장 이동`, ...(nb.length ? [`묶음 ${nb.map(b => `${b.name} ${b.pages.length}장`).join(" · ")}`] : [])].join(" · "), payload: { kind: "stage", ai: "dynapse", order: true } });
                report("turn", "order.applied", `moved=${moved} retried=${oa.retried} tier=${s.tier ?? "-"}`);
            }
            else if (!oa.retried) {
                report("turn", "order.empty_retry", `tier=${s.tier ?? "-"}`);
                s.out.push({ role: "event", text: "순서를 다시 정해요", payload: { kind: "stage", ai: "dynapse" } });
                await finishTurn(id, s);
                orderUnlock.add(id);
                orderAsk.set(id, { ...oa, retried: true });
                void chatSend(id, `${ORDER_HEAD}[The previous reply did not change .dynapse/pages.json. Write the full new order there now; change nothing else and do not ask — pick the order that best fits the request.]\n${oa.text}`, { light: true, route: s.route });
                return;
            }
            else {
                orderUnlock.delete(id);
                report("turn", "order.empty_ask", `tier=${s.tier ?? "-"}`);
                s.firstReply = "어떤 순서로 바꿀지 알려 주세요 · 예: \"3·5·1번 순서로\" 또는 \"8장을 2장 뒤로\"";
            }
        }
    }
    // 찾기 턴 결과(#140 추가 1) — 목록 카드 "검토 · 고칠 곳 N · 장 M · 먼저 볼 것 K"(항목마다 [고치기], [전부 고치기], 더 볼 묶음)
    if (reviewTurn.delete(id)) {
        const rv = await readJson(id, ".dynapse/review.json").catch(() => null);
        const items = (rv?.items ?? []).filter(x => x && PAGE_RE.test(String(x.file ?? ""))).slice(0, 30).map(x => ({ file: x.file, where: String(x.where ?? "").slice(0, 80), what: String(x.what ?? "").slice(0, 160), why: String(x.why ?? "").slice(0, 160), severity: /^(high|mid|low)$/.test(String(x.severity)) ? String(x.severity) : "mid" }));
        if (items.length) {
            await wput(id, ".dynapse/review.json", JSON.stringify({ items, more: (rv?.more ?? []).filter(x => typeof x === "string").slice(0, 6), at: Date.now() })).catch(() => { });
            s.out.push({ role: "event", text: `검토 · 고칠 곳 ${items.length} · 장 ${new Set(items.map(x => x.file)).size} · 먼저 볼 것 ${items.filter(x => x.severity === "high").length}`, payload: { kind: "review-list", ai: "dynapse", items, more: (rv?.more ?? []).filter(x => typeof x === "string").slice(0, 6) } });
            report("turn", "review.list", `items=${items.length} high=${items.filter(x => x.severity === "high").length}`);
        }
    }
    // 개요 턴 결과(#140 §3) — 제목만 든 자리 장 + 순서·묶음 → 카드 [만들기 시작]
    const stubbed = new Set(); // 자리 장은 이번 검사·사진에서 뺀다
    if (planTurn.delete(id)) {
        const plan = ((await readJson(id, ".dynapse/outline-plan.json").catch(() => null)) ?? []).filter(x => x && /^result-[a-z0-9-]+\.html$/.test(String(x.file ?? ""))).slice(0, 400);
        if (plan.length > BIG_DECK) {
            for (const [i, x] of plan.entries())
                if (!(await wget(id, x.file).catch(() => null)))
                    stubbed.add(x.file), await wput(id, x.file, stubPage(String(x.title ?? `${i + 1}장`).slice(0, 80), i + 1, plan.length)).catch(() => { });
            const files = plan.map(x => x.file), groups = new Map();
            for (const x of plan) {
                const b = String(x.bundle ?? "").trim().slice(0, 30) || "본편";
                groups.set(b, [...(groups.get(b) ?? []), x.file]);
            }
            await wput(id, ".dynapse/pages.json", JSON.stringify(files)).catch(() => { });
            await wput(id, BUNDLES, JSON.stringify([...groups].filter(([b]) => b !== "본편").map(([name, pages]) => ({ name, pages })))).catch(() => { });
            await normalizeOrder(id, files).catch(() => null);
            await normalizeBundles(id).catch(() => false);
            await writeOutline(id).catch(() => null);
            s.out.push({ role: "event", text: `개요 ${plan.length}장 · 묶음 ${groups.size}개 — 장 띠에서 제목을 훑어보고 고칠 곳은 말로 · 괜찮으면 [만들기 시작]`, payload: { kind: "plan-ready", ai: "dynapse", n: plan.length, bundles: groups.size } });
            report("turn", "bigplan.ready", `n=${plan.length} bundles=${groups.size}`);
        }
    }
    // 첫 생성은 표지 1장(#49 B) — 나머지는 사용자가 [1장]·[2장]·[전부]로. 리워드는 브리프대로 전부
    const firstBuild = !((await readJson(id, ".dynapse/TRACE.json"))?.rounds?.length);
    // ① 에이전트가 바꾼 장을 먼저 검사(사진 전, #54 A1) — 실패면 같은 턴에 되돌려 보낸다
    // 병렬 장 턴(#191) — 같은 작업의 다른 턴이 도는 중이면 이 턴의 장(언어판·사진)만 보고·검사하고·커밋한다. 덱 정리·덱 검사는 마지막 턴 끝에
    const conc = [...sessions.entries()].some(([k, x]) => k.startsWith(`${id}|`) && x !== s && x.busy);
    const own = conc && s.turnPage ? (await import("./lanes.js")).ownFile(s.turnPage) : null;
    const ownPaths = async () => own ? (await T().core.invoke("repo_changed", { id }).catch(() => [])).filter(own) : null;
    slotsLast = null;
    if (await slotsFlush(id).catch(() => false))
        s.slotsBuilt = true;
    if (slotsLast)
        s.slotsInfo = slotsLast; // 칸 글 계약(#275 ②) — 마지막 장까지 조립한 뒤 검사
    const changed0 = (S.git ? await T().core.invoke("repo_changed", { id }).catch(() => []) : []).filter(f => !own || own(f));
    const pages0 = changed0.filter(isPage).filter(f => !stubbed.has(f)); // 아래 언어판 따라가기가 더할 수 있다
    // 📍 경계(#193) — 📍 요소·부모 블록 밖이 움직였거나(±2px) 글이 바뀌었으면 그 장을 턴 시작 판으로 되돌리고 같은 턴에서 한 번 다시(경계 문장). 또 넘으면 되돌리고 [장 전체로]
    if (ok && s.bounded && pages0.includes(s.bounded.file) && s.startPages?.get(s.bounded.file)) {
        const start = s.startPages.get(s.bounded.file), bad = await boundCheck(id, s.bounded, start).catch(() => null);
        if (bad?.length) {
            await wput(id, s.bounded.file, start).catch(() => { });
            report("turn", "bound.revert", `n=${bad.length} try=${s.boundTry ?? 0}`);
            const { BOUND_RETRY } = await import("./bound.js");
            if (!s.boundTry && s.tool === "claude" && s.procId !== undefined) {
                s.boundTry = 1;
                foldUsage(s);
                s.out.push({ role: "event", text: "📍 밖까지 바뀌어서 되돌리고 다시 해요", payload: { kind: "stage", ai: "dynapse" } });
                await flushChat(id, s);
                s.verifyN = 0;
                await T().core.invoke("run_write", { id: s.procId, line: JSON.stringify({ type: "user", message: { role: "user", content: `${BOUND_RETRY} Outside changes: ${bad.slice(0, 5).join("; ")}.` } }) }).catch(() => { });
                return; // 같은 턴이 이어진다
            }
            s.out.push({ role: "event", text: "📍 밖까지 바뀌어서 되돌렸어요", payload: { kind: "bound-revert", ai: "dynapse", request: (s.requestText ?? "").slice(0, 400), points: s.boundPts ?? [] } });
            pages0.splice(pages0.indexOf(s.bounded.file), 1);
        }
    }
    // 결함 턴(C4 A): 짚은 장 말고도 고친 장이 있으면 한 줄 — 한 턴 커밋이라 ⌘Z 한 번에 같이 되돌아간다
    {
        const pinned = defectAsk.get(id);
        if (ok && pinned && s.startPages?.size) {
            defectAsk.delete(id);
            const also = [];
            for (const [f, a] of s.startPages) {
                if (pinned.includes(f) || !/^result-[a-z0-9-]+\.html$/.test(f))
                    continue;
                const b = await wget(id, f).catch(() => null);
                if (b !== null && b !== a)
                    also.push(f);
            }
            if (also.length)
                s.out.push({ role: "event", text: `${also.slice(0, 6).map(f => f.replace(/^result-|\.html$/g, "")).join(", ")}도 같은 문제라 같이 고쳤어요 · 되돌리기 ⌘Z`, payload: { kind: "stage", ai: "dynapse", pages: also.slice(0, 12) } });
        }
    }
    // 내용 바꾸기(C4 A): 📍 요소의 글이 바뀌었고 다른 장에 같은 글이 있으면 고치지 않고 버튼만 — "다른 장 N곳도 같이 바꿀까요 [같이 바꾸기]"
    if (ok && s.bounded && s.pointed?.length && s.startPages?.size && !s.rewardTask) {
        const p0 = s.pointed[0], txt = (h) => { if (!h || !p0.selector)
            return ""; try {
            return (new DOMParser().parseFromString(h, "text/html").querySelector(p0.selector)?.textContent ?? "").replace(/\s+/g, " ").trim();
        }
        catch {
            return "";
        } };
        const before = txt(s.startPages.get(p0.file)), after = txt(await wget(id, p0.file).catch(() => null));
        if (before && after && before !== after && before.length >= 2 && before.length <= 80) {
            const others = [];
            for (const [f, h0] of s.startPages) {
                if (f === p0.file || !/^result-[a-z0-9-]+\.html$/.test(f))
                    continue;
                const h = (await wget(id, f).catch(() => null)) ?? h0;
                if (h.replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").includes(before))
                    others.push(f);
            }
            if (others.length) {
                const nm = (f) => f.replace(/^result-|\.html$/g, "");
                report("turn", "scope.same_offer", `n=${others.length}`);
                s.out.push({ role: "event", text: `다른 장 ${others.length}곳에도 "${before.slice(0, 30)}"이(가) 있어요 · 같이 바꿀까요`, payload: { kind: "same-offer", ai: "dynapse", pages: others.slice(0, 12), ask: `${others.slice(0, 12).map(nm).join(", ")}의 "${before.slice(0, 60)}"도 방금처럼 바꿔 줘 — ${String(s.requestText ?? "").slice(0, 200)}`.slice(0, 400) } });
            }
        }
    }
    // 할 일 대조(C4 B ③): 장을 대고 말한 할 일인데 그 장이 하나도 안 바뀌었으면 빠진 것 — 첫 번째는 같은 턴에 이어서(Claude), 아니면 숨기지 않고 "못 함" 한 줄
    {
        const ta = todoAsk.get(id);
        if (ok && ta && !s.rewardTask && s.startPages?.size) {
            const changed = async (f) => { const a = s.startPages.get(f), b = await wget(id, f).catch(() => null); return a !== undefined && b !== null && a !== b; };
            const miss = [];
            for (const x of ta.items) {
                let hit = false;
                for (const f of x.pages)
                    if (await changed(f)) {
                        hit = true;
                        break;
                    }
                if (!hit)
                    miss.push(x);
            }
            if (miss.length && !ta.retried && s.tool === "claude" && s.procId !== undefined) {
                todoAsk.set(id, { ...ta, retried: true });
                foldUsage(s);
                report("turn", "tasks.missed_retry", `n=${miss.length}`);
                s.out.push({ role: "event", text: `빠진 할 일 ${miss.map(x => x.mark).join("")} 이어서 해요`, payload: { kind: "stage", ai: "dynapse" } });
                await flushChat(id, s);
                s.verifyN = 0;
                await T().core.invoke("run_write", { id: s.procId, line: JSON.stringify({ type: "user", message: { role: "user", content: `[Not done yet — these tasks left their pages unchanged: ${miss.map(x => `${x.mark} ${x.text} (${x.pages.join(", ")})`).join("; ")}. Do them now, then end with the full task list.]` } }) }).catch(() => { });
                return;
            }
            todoAsk.delete(id);
            if (miss.length) {
                report("turn", "tasks.missed", `n=${miss.length}`);
                s.out.push({ role: "event", text: miss.map(x => `${x.mark} 못 함: 그 장이 그대로예요(${x.text.slice(0, 40)})`).join(" · "), payload: { kind: "stage", ai: "dynapse" } });
            }
        }
        else if (ta && !ok)
            todoAsk.delete(id);
    }
    // 짚은 자리 맞춤(#231 — 대표: 📍 고침이 계속 빗나가고 무엇을 짚었는지도 안 보인다): 짚은 요소의 하위 트리가 턴 전후로 그대로면(다른 곳만 바뀜 · 아무것도 안 바뀜) 빗나감.
    // 첫 번째는 같은 턴에 숨긴 말 한 번(Claude) · 두 번째(또는 다른 AI)는 한 줄 + [다시][자리 다시 짚기]. 장이 다시 지어져 요소가 없으면 칸+글로 다시 찾고, 그래도 없으면 "자리가 바뀌었어요"
    if (ok && !s.rewardTask && s.pointed?.length && s.startPages?.size) {
        const st = await Promise.all(s.pointed.map(async (p) => { const a = s.startPages.get(p.file), b = await wget(id, p.file).catch(() => null); return { p, r: a && b ? pointedState(a, b, p) : "hit" }; }));
        const miss = st.filter(x => x.r !== "hit"), gone = miss.some(x => x.r === "gone");
        if (!miss.length) {
            report("turn", "turn.point_hit", `n=${st.length} try=${s.pointTry ?? 0}`);
            lastEdit.set(id, { pt: s.pointed[0], at: Date.now() });
        }
        else if (!s.pointTry && s.tool === "claude" && s.procId !== undefined && !gone) {
            s.pointTry = 1;
            foldUsage(s);
            report("turn", "turn.point_retry", `n=${miss.length}`);
            s.out.push({ role: "event", text: "📍 짚은 자리가 그대로라 그 자리만 다시 고쳐요", payload: { kind: "stage", ai: "dynapse" } });
            await flushChat(id, s);
            s.verifyN = 0;
            await T().core.invoke("run_write", { id: s.procId, line: JSON.stringify({ type: "user", message: { role: "user", content: `The pointed element did not change (you edited elsewhere or nothing). Apply the user's change to ${miss.map(x => `${x.p.file} → ${x.p.selector || `[data-slot="${x.p.slot}"]`}`).join(", ")} only, in this turn, then start your reply with "📍 <page> · <slot>: <what changed>".` } }) }).catch(() => { });
            return; // 같은 턴이 이어진다
        }
        else {
            report("turn", "turn.point_miss", `n=${miss.length} gone=${gone ? 1 : 0} try=${s.pointTry ?? 0} tool=${s.tool}`);
            s.pointMissed = true; // 앱 줄만(#299 ⑤ — AI의 "📍로 지정해 주세요"와 두 줄로 겹쳤다)
            s.out.push({ role: "event", text: gone ? "짚은 자리가 바뀌었어요 · 장이 다시 지어져 그 요소를 못 찾았어요" : "짚은 자리를 못 고쳤어요", payload: { kind: "point-miss", ai: "dynapse", request: (s.requestText ?? "").slice(0, 400), points: s.pointed } });
        }
        s.pointed = [];
    }
    // 이름 지키기(#234 ①) — 턴 전 글 칸에 있던 이름이 번역·음역·대소문자 바뀜으로 사라졌으면 그 자리만 원래 철자로 · 바뀐 원문 장의 새 라틴 이름은 목록에
    if (ok && !s.rewardTask && s.startPages?.size && typeof DOMParser !== "undefined") {
        const TM = await import("./terms.js");
        let tt = await readJson(id, ".dynapse/terms.json").catch(() => null);
        const fixedAll = [], newNames = [];
        for (const f of pages0.filter(x => isPage(x) || LANG_PAGE.test(x))) {
            const b0 = s.startPages.get(f), a0 = await wget(id, f).catch(() => null);
            if (!a0)
                continue;
            if (PAGE_RE.test(f))
                newNames.push(...TM.namesIn(a0.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "").replace(/<[^>]+>/g, " ")));
            if (!b0 || !tt?.keep.length)
                continue;
            const db = parseH(b0), da = parseH(a0), before = new Map(textLeaves(db).map(l => [l.sel, l.text]));
            let changed = false;
            for (const l of textLeaves(da)) {
                const bt = before.get(l.sel);
                if (!bt)
                    continue;
                const r = TM.restoreLeaf(bt, l.text, tt.keep.filter(k => !(TM.RENAME_ASK.test(s.requestText ?? "") && (s.requestText ?? "").includes(k))));
                for (const [from, to] of r.pairs) {
                    const h = l.el.innerHTML, at = h.indexOf(from);
                    if (at >= 0) {
                        l.el.innerHTML = h.slice(0, at) + to + h.slice(at + from.length);
                        changed = true;
                    }
                }
                fixedAll.push(...r.fixed);
            }
            if (changed)
                await wput(id, f, "<!doctype html>\n" + da.documentElement.outerHTML).catch(() => { });
        }
        if (newNames.length) {
            tt = TM.mergeTerms(tt, newNames, "manuscript");
            await wput(id, ".dynapse/terms.json", JSON.stringify(tt, null, 1)).catch(() => { });
        }
        if (fixedAll.length) {
            const u = [...new Set(fixedAll)];
            report("turn", "terms.restored", `n=${fixedAll.length}`);
            s.out.push({ role: "event", text: `이름 ${fixedAll.length}곳은 그대로 두었어요(${u.slice(0, 4).join("·")})`, payload: { kind: "stage", ai: "dynapse" } });
        }
    }
    // 장 크기 지키기(#237 보정 2 — AI가 오류 글 "이 덱은 1600×900"을 보고 sed로 1280×720 장을 1600×900으로 바꿨다): 턴 시작 판과 .slide 너비·높이가 다르면 그 숫자만 되돌리고, AI가 넣은 크기 블록은 지운다
    // 사용자가 장 크기를 직접 말한 턴(예: "두 파일 .slide 1280×720으로 되돌려")은 그대로 둔다 — 크기를 되돌리는 턴을 막지 않게
    // 이름을 댄 장만(#237 보정 2 — 좁게): 말에 장 이름(21-landscape · 21장 · 📍 장)이 있으면 그 장만 허용, 없으면 이 턴 전체
    const sizeAsk = /장\s*크기|판\s*크기|\.slide|사이즈|\d{3,4}\s*[×x*]\s*\d{3,4}/i.test(s.requestText ?? ""), rq = s.requestText ?? "";
    const named = (f) => { const k = f.replace(/^result-|(\.[a-z]{2})?\.html$/g, ""), n = k.match(/^(\d{1,3})-/)?.[1]; return rq.includes(k) || (!!n && new RegExp(`(?<!\\d)${Number(n)}\\s*(번\\s*)?(장|페이지|슬라이드)`).test(rq)) || (s.pointed ?? []).some(p => p.file === f); };
    const anyNamed = sizeAsk && pages0.some(named);
    if (ok && s.startPages?.size) {
        const SZ = /(\.slide(?:\[[^\]]*\])*\s*\{[^}]*?\bwidth\s*:\s*)(\d+)(px[^}]*?\bheight\s*:\s*)(\d+)(px)/, kept = [];
        for (const f of pages0.filter(x => (isPage(x) || LANG_PAGE.test(x)) && !(sizeAsk && (!anyNamed || named(x) || named(x.replace(/\.[a-z]{2}\.html$/, ".html")))))) {
            const b0 = s.startPages.get(f), a0 = await wget(id, f).catch(() => null);
            if (!b0 || !a0)
                continue;
            const zb = b0.match(SZ), za = a0.match(SZ);
            let out = a0;
            if (zb && za && (zb[2] !== za[2] || zb[4] !== za[4]))
                out = out.replace(SZ, (_m, p1, _w, p3, _h, p5) => `${p1}${zb[2]}${p3}${zb[4]}${p5}`);
            if (!/<style\b[^>]*\bdata-format\b/i.test(b0))
                out = out.replace(/<style\b[^>]*\bdata-format\b[^>]*>[\s\S]*?<\/style\s*>\s*/i, "");
            if (out !== a0) {
                await wput(id, f, out).catch(() => { });
                kept.push(f);
            }
        }
        if (kept.length) {
            report("turn", "format.size_kept", `n=${kept.length}`);
            s.out.push({ role: "event", text: `장 크기는 못 바꿔요 — 안쪽만 고쳤어요 · ${kept.map(pageKey).slice(0, 6).join(", ")}`, payload: { kind: "stage", ai: "dynapse" } });
        }
    }
    // 언어판 따라가기(#234 ② — 대표: 영어판이 고친 걸 안 따라온다): 원문 장을 고친 턴이면 "번역 안 됨"으로 두지 않고, 턴이 끝난 뒤 바뀐 칸만 가벼운 번역 한 번(언어마다 · 60초)
    // 주기적인 루프 아님 — 턴 하나에 한 번. 리워드·언어판 없는 작업은 그냥 지나간다. 실패하면 기존 [번역 반영] 표시가 남는다
    if (ok && !s.rewardTask) {
        const bases = pages0.filter(f => PAGE_RE.test(f));
        if (bases.length) {
            const { langs } = await langFiles(id).catch(() => ({ langs: [] }));
            if (langs.length) {
                const ai = s.ai === "chatgpt" ? "chatgpt" : "claude";
                report("turn", "lang.follow", `pages=${bases.length} langs=${langs.join(",")}`);
                setTimeout(() => {
                    void (async () => {
                        active++;
                        try {
                            for (const L of langs) {
                                if (!LANG_NAME[L])
                                    continue;
                                await Promise.race([translateTurn(id, { code: L, name: LANG_NAME[L] }, ai, bases, { auto: true }).catch(() => false), new Promise(r => setTimeout(r, 60_000))]);
                            }
                        }
                        finally {
                            active--;
                        }
                    })();
                }, 1500);
            }
        }
    }
    // 글이 많은 장의 배치 손보기 세 번째(#233 ⑤ — 20개 회사 표 한 장 1,779자 vs 덱 중앙값 565): 한 번만 "두 장으로 나누면" + [나누기](자동으로 나누지 않는다)
    if (ok && !s.rewardTask && SPACE_WORDS.test(s.requestText ?? "")) {
        const pg = (s.pointed?.[0]?.file) || pages0.find(f => isPage(f)) || turnPage.get(id) || null;
        if (pg) {
            const k = `${id}|${pg}`, n = (spaceTweaks.get(k) ?? 0) + 1;
            spaceTweaks.set(k, n);
            if (n === 3) {
                const txt = async (f) => ((await wget(id, f).catch(() => null)) ?? "").replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, "").replace(/\s+/g, "").length;
                const all = ((await readPages(id).catch(() => null)) ?? []).slice(0, 60), lens = (await Promise.all(all.map(txt))).filter(x => x > 0).sort((a, b) => a - b), med = lens[Math.floor(lens.length / 2)] ?? 0, mine = await txt(pg);
                if (med > 0 && mine > med * 3) {
                    report("turn", "turn.dense_hint", `chars=${mine} median=${med}`);
                    s.out.push({ role: "event", text: `이 장은 글이 덱 평균의 ${Math.round(mine / med)}배예요 · 두 장으로 나누면 줄바꿈 없이 들어가요`, payload: { kind: "split-hint", ai: "dynapse", page: pg } });
                }
            }
        }
    }
    // 고친 자리 기억(#233 ①) — 짚은 자리가 맞았으면 그 요소, 아니면 이번에 바뀐 첫 장(장 전체)
    if (ok && !s.rewardTask && Date.now() - (lastEdit.get(id)?.at ?? 0) > 5_000) {
        const pg = pages0.find(f => /^result-[a-z0-9-]+(\.[a-z]{2})?\.html$/.test(f));
        if (pg)
            lastEdit.set(id, { pt: { file: pg, selector: "section.slide", slot: null }, at: Date.now() });
    } // 보던 언어판 그대로
    // 사진 요청 꼴(#194) — 앱이 맞출 수 없는 줄(칸·요소·무엇을 그릴지 없음)이 있으면 같은 턴에서 AI에게 한 번: 정확한 꼴 + "요소는 먼저 칸으로". 말없이 버리지 않는다
    if (ok && s.tool === "claude" && s.procId !== undefined && !s.photoShapeTry) {
        const PR = await import("./photo-runner.js"), nz = await PR.normalizePhotoRequests(id).catch(() => null);
        if (nz?.bad.length) {
            s.photoShapeTry = 1;
            foldUsage(s);
            s.out.push({ role: "event", text: `사진 요청 ${nz.bad.length}개의 꼴이 맞지 않아 AI에게 다시 쓰게 했어요`, payload: { kind: "stage", ai: "dynapse" } });
            await flushChat(id, s);
            s.verifyN = 0;
            report("photo", "photo.req_shape", `n=${nz.bad.length}`);
            await T().core.invoke("run_write", { id: s.procId, line: JSON.stringify({ type: "user", message: { role: "user", content: `The app could not use ${nz.bad.length} entr${nz.bad.length === 1 ? "y" : "ies"} in .dynapse/photo-requests.json (${[...new Set(nz.bad.map(b => b.why))].slice(0, 3).join("; ")}). Rewrite that file in exactly this shape: ${PR.PHOTO_SCHEMA}. A slot must be a figure[data-slot] on that page — if the target is an icon or another element, convert it to a figure[data-slot] first, then request it. Reply to the user in Korean, one line.` } }) }).catch(() => { });
            return; // 같은 턴이 이어진다
        }
    }
    // AI가 쓴 장(#127) = 턴 시작과 내용이 달라진 장(앱의 쪽번호·줄 묶기·언어판 따라가기 전). 시작 기록이 없으면 예전처럼 바뀐 장 전부
    const aiPages = [];
    for (const f of pages0) {
        const st = s.startPages?.get(f);
        if (!s.startPages || st === undefined || st !== (await wget(id, f).catch(() => null)))
            aiPages.push(f);
    }
    let v1 = null;
    if (pages0.length) {
        chatEvent(id, s, `확인 중 ${Math.min(s.verifyN + 1, 3)}/3`, { ai: "dynapse" });
        await flushChat(id, s);
        // 보존 하한(#293 보정 7 · #294 보정 1 — D2 기준 측정: 외부 주소 오류를 고치라니 AI가 사진 <img>를 모두 지웠다). 고침 턴이 사진을 줄이거나 보이는 글을 10% 넘게 줄였으면 그 장은 고치기 전으로
        if (s.preFix?.size) {
            const lost = [];
            for (const [f, was] of s.preFix) {
                const now = await wget(id, f).catch(() => null);
                if (now === null || now === was)
                    continue;
                const a = keepMeasure(was), b = keepMeasure(now);
                if (b.photos < a.photos || b.text < a.text * 0.9) {
                    lost.push(pageLabel(f));
                    await wput(id, f, was).catch(() => { });
                    report("turn", "fix.preserve_floor", `${f} photos=${a.photos}→${b.photos} text=${a.text}→${b.text}`);
                }
            }
            s.preFix = undefined;
            if (lost.length)
                s.out.push({ role: "event", text: `오류를 고치려다 사진·글이 빠져서 ${lost.join("·")}은 고치기 전으로 두었어요`, payload: { kind: "stage", ai: "dynapse" } });
        }
        // 글자만 바뀐 턴(#51 §3) — 결과 장의 태그·속성은 그대로이고 글자만 다르면 렌더·스크린샷 생략(정적 검사만)
        const textOnly = changed0.every(f => isPage(f) || f.startsWith(".dynapse/")) && await textOnlyChange(id, pages0);
        const v0 = Date.now();
        const order = own ? await readPages(id).catch(() => null) : await normalizeOrder(id, undefined, pages0).catch(() => null); // 병렬 중엔 다른 장 쪽번호를 건드리지 않는다
        // 잠금이 되돌린 횟수(#139 A)
        if (orderRestored.delete(id)) {
            report("turn", "order.lock_restore", `tier=${s.tier ?? "-"}`);
            s.out.push({ role: "event", text: "장 순서는 정해 두신 대로 두었어요", payload: { kind: "stage", ai: "dynapse" } });
        } // 장 순서·쪽번호(#97) — 검사·저장 전에. 새로 생긴 장만 순서에(#98 보정 1)
        if (!s.raw)
            await joinPages(id, pages0).catch(() => { }); // 한글 줄바꿈 묶기(#91 §5) — 검사·저장 전에 · raw는 AI가(#312 보정 2)
        if (!s.raw) {
            const cp = await colorPass(id, { ask: s.requestText, only: own ? pages0 : undefined, reward: !!s.rewardTask || rewardWorks.has(id), first: !!s.firstTurn }).catch(() => null); // 색은 토큰으로만(#274)
            if (cp?.repaint)
                s.out.push({ role: "event", text: "AI 기본색이라 덱 색을 바꿨어요 · 되돌리려면 ⌘Z", payload: { kind: "stage", ai: "dynapse", palette: cp.repaint } });
        }
        {
            let tm = 0, sl = 0, treat = (await readJson(id, ".dynapse/photo-treat.json").catch(() => null))?.treat ?? null;
            for (const pg of pages0.filter(f => /^result-[a-z0-9-]+\.html$/.test(f) || LANG_PAGE.test(f))) {
                const h0 = await wget(id, pg).catch(() => null);
                if (!h0)
                    continue;
                const r = repairStyleLeak(h0);
                sl += r.n;
                const x = stripTextMotion(r.html);
                tm += x.n;
                // 덱 사진 처리(#119 보정 15 ③) — 처음 본 장에서 한 번 정하고 덱 전체에 같은 값
                if (!treat && /<img\b/i.test(x.html)) {
                    treat = photoTreatOf(x.html);
                    await wput(id, ".dynapse/photo-treat.json", JSON.stringify({ treat, at: Date.now() })).catch(() => { });
                }
                const y = treat && !s.raw ? putPhotoTreat(x.html, treat) : x.html;
                if (y !== h0)
                    await wput(id, pg, y).catch(() => { });
            }
            if (sl)
                s.out.push({ role: "event", text: `글자로 새어 나온 CSS ${sl}곳을 고쳤어요`, payload: { kind: "stage", ai: "dynapse" } }); // #91 보정 2
            if (tm)
                s.out.push({ role: "event", text: `제목 움직임 제거 ${tm}곳 · 제목·본문은 제자리에서 바뀌어요`, payload: { kind: "stage", ai: "dynapse" } });
        } // 글은 움직이지 않는다(#106 보정 3)
        // 언어판(#100) — 바뀐 장의 구조를 다른 언어판에(글은 그대로). 따라 바뀐 언어판도 이번 검사에
        for (const f of (await syncLangs(id, pages0).catch(() => [])) ?? [])
            if (!pages0.includes(f))
                pages0.push(f);
        for (const pg of (s.shadeBefore ?? []).filter(f => pages0.includes(f))) {
            const h = await wget(id, pg);
            if (h && !/<section\b[^>]*\bdata-(shade|overlay)\s*=/i.test(h))
                await wput(id, pg, addLintOk(h, "contrast")).catch(() => { });
        }
        // 덱 모티프(#201) — 이번 턴에 바뀐 장에도 덱 블록을(새 장·다른 모양·AI가 지운 블록). 장마다 손으로 정한 크기가 아니라 덱 설정 하나
        if (!s.raw) {
            await stampMotif(id, pages0).catch(() => 0);
            await stampMoodDeco(id, pages0).catch(() => 0);
        }
        // 숫자+단위 한 덩어리(#314 ⑧ — "120만 건" 줄바꿈) — 바뀐 장의 글만, 글자는 그대로(AI 0)
        if (!s.raw) {
            const NW = await import("./num-nowrap.js");
            for (const f of pages0) {
                const h = await wget(id, f).catch(() => null);
                if (!h)
                    continue;
                const r = NW.nowrapNumbers(h);
                if (r.n)
                    await wput(id, f, r.html).catch(() => { });
            }
        } // 덱 모티프·분위기 장식(#303 ④) — raw는 지시로만(#312 보정 2)
        {
            const fixed = await holdFormat(id, pages0).catch(() => []);
            if (fixed.length)
                s.out.push({ role: "event", text: `장 크기는 못 바꿔요 — 안쪽만 고쳤어요 · ${fixed.map(pageKey).slice(0, 6).join(", ")}`, payload: { kind: "stage", ai: "dynapse" } });
        } // 판형 고정(#212 보정 1)
        // 보는 검토(#98) — 지난 바퀴의 답(FIXED/KEPT)을 모으고, 이번에 한 번 더 볼지. 리워드(제출이 턴 안)·Codex(후속 메시지 없음)는 안 한다
        if (s.reviews)
            s.reviewNotes = [...(s.reviewNotes ?? []), ...reviewNotes(s.lastText)];
        const fast = s.scope !== "deck" && (s.route?.review === "fast" || !!s.light || !!textOnly); // 덱 범위(#99)는 편집자 읽기까지 반드시
        const canLook = s.tool === "claude" && s.procId !== undefined && (s.reviews ?? 0) < 2 && !(s.reviews && lastWord(s.lastText) === "DONE") && !s.rewardTask && !rewardWorks.has(id) && s.tier !== "light" && s.tier !== "normal"; // 보는 검토·편집자 읽기는 무거운 턴만(#123)
        v1 = await appVerify(id, pages0, { noRender: !!textOnly, reward: !!s.rewardTask || rewardWorks.has(id), board: canLook && !fast });
        // 앱이 단 분위기 띠가 글자와 겹치면(#303 ④ ornament_overlap · fix orn_off) 그 장에서 띠를 떼고 그 오류는 AI에 보내지 않는다
        {
            const offE = v1.errors.filter(e => e.fix === "orn_off");
            if (offE.length && !s.raw) {
                const pg = [...new Set(offE.map(e => e.page))];
                await moodBandOff(id, offE.map(e => ({ page: e.page, orn: e.orn }))).catch(() => { });
                report("turn", "mood.band_off", `n=${pg.length}`);
                const rest = v1.errors.filter(e => !offE.includes(e));
                v1 = { ...v1, errors: rest, ok: rest.length === 0 };
            }
        }
        {
            const mf = v1?.motif_fit ?? [];
            if (mf.length) {
                const M = await import("./motif.js");
                for (const x of mf.slice(0, 3))
                    s.out.push({ role: "event", text: M.fitLine(x), payload: { kind: "stage", ai: "dynapse" } });
            }
        } // 모티프 자리(#201 ③)
        if (own && v1 && !v1.ok && v1.errors.every(e => e.page === "*"))
            v1 = { ...v1, ok: true }; // 병렬 중 덱 검사(*)는 마지막 턴 끝에(#191)
        // 턴의 실패 = AI가 쓴 장의 오류(+ 덱 전체 "*")만(#127). 앱이 다시 쓴 장: 예전부터 있던 오류는 칩 하나, 새로 생긴 오류는 앱 탓 → 그 장만 턴 시작으로 되돌리고 보고
        {
            const last = (await readJson(id, ".dynapse/last-errors.json").catch(() => null)) ?? {};
            const own = v1.errors.filter(e => !s.startPages || e.page === "*" || aiPages.includes(e.page)), other = v1.errors.filter(e => !own.includes(e));
            const stale = other.filter(e => (last[e.page] ?? []).includes(e.rule)), regress = other.filter(e => !stale.includes(e));
            // 앱이 다시 쓴 장에 새 오류(#143 §2) — 말없이 턴 시작으로 되돌리지 않는다(예전 fit.regress 되돌리기는 사용자의 사진·조절까지 지울 수 있었다).
            // 장은 그대로 두고, 턴 시작 판을 .dynapse/tmp(기록·동기화 밖)에 남겨 [턴 시작으로]를 사용자가 고르게 한다(직접 수정으로 쌓여 ⌘Z가 된다). 대체 검사(node가 못 돈 때)는 알리지 않는다
            const rp = v1.engine === "app" ? [] : [...new Set(regress.map(e => e.page))].filter(pg => s.startPages?.get(pg) !== undefined);
            if (rp.length) {
                const pages = { ...((await readJson(id, REGRESS).catch(() => null))?.pages ?? {}) };
                for (const pg of rp)
                    pages[pg] = { start: s.startPages.get(pg), rules: [...new Set(regress.filter(e => e.page === pg).map(e => e.rule))] };
                await wput(id, REGRESS, JSON.stringify({ at: Date.now(), pages })).catch(() => { });
                s.out.push({ role: "event", text: `앱이 다시 쓴 장에 오류 · ${rp.map(pageLabel).join(", ")} · 장은 그대로 두었어요`, payload: { kind: "regress", ai: "dynapse", pages: rp, line: errorsLine(regress.filter(e => rp.includes(e.page))) } });
                for (const pg of rp)
                    report("turn", "fit.regress_kept", pages[pg].rules.join(","));
            }
            // 이번에 검사한 장만 새로 적고 나머지는 지난 기록 그대로(2026-10-22 — 덮어써서 검사 안 한 장의 옛 오류가 다음 턴에 "앱이 다시 쓴 장의 새 오류"로 다시 떴다)
            const now = Object.fromEntries(Object.entries(last).filter(([pg]) => !pages0.includes(pg) && pg !== "*"));
            for (const e of [...own, ...stale, ...regress])
                (now[e.page] ??= []).includes(e.rule) || now[e.page].push(e.rule);
            await wput(id, ".dynapse/last-errors.json", JSON.stringify(now)).catch(() => { });
            if (stale.length) {
                const key = stale.map(e => `${e.page}|${e.rule}`).sort().join(";");
                s.staleShown ??= new Set();
                if (!s.staleShown.has(key)) {
                    s.staleShown.add(key);
                    s.out.push({ role: "event", text: null, payload: { kind: "stale-errors", ai: "dynapse", n: stale.length, line: errorsLine(stale), errors: stale.slice(0, 6) } });
                }
            }
            v1 = { ...v1, errors: own, ok: own.length === 0 };
        }
        // 빈 공간 자동 보정(C3 6차 ③ — 판정 2에서 Q01 3·4장 · Q32 4·6장 큰 빈 공간): 첫 결과에서 내용 상자가 장의 70% 미만(coverage · underfill)인 장은 AI 턴 없이 글자·도형을 한 단계 키운다(growPage · 장당 한 번, 3장까지)
        const msj = !s.rewardTask && !rewardWorks.has(id) && v1 ? await readJson(id, ".dynapse/manuscript.json").catch(() => null) : null;
        if (v1 && msj?.first && !s.raw) {
            const thin = [...new Set([...v1.warnings, ...v1.errors].filter(e => (e.rule === "coverage" || e.rule === "underfill") && e.page && e.page !== "*").map(e => e.page))].slice(0, 3);
            // 그림 재고(image_stock §5 ①②): 빈 공간 장·표지에 원고 명사의 사물 그림 — 그림을 놓은 장은 키우지 않는다
            const cover = ((await readPages(id).catch(() => null)) ?? pages0)[0];
            const arted = await (await import("./art.js")).placeArts(id, v1, [...new Set([cover, ...thin].filter(Boolean))], String(msj.text ?? "")).catch(() => []);
            const grow = thin.filter(f => !arted.includes(f));
            // 한 줄로(C5 ⑥ — 장마다 "02을 ×1.05 키웠어요"가 두 번씩): 배율은 [자세히] 안 · 한 턴에 같은 장은 한 번만
            if (grow.length) {
                const { growPage } = await import("./grow.js"), grew = [];
                for (const f of grow) {
                    if ((s.grown ??= new Set()).has(f))
                        continue;
                    s.grown.add(f);
                    const k = await growPage(id, f, null, { commit: false, max: 1.3, quiet: true }).catch(() => null);
                    report("turn", "fit.auto_grow", f);
                    if (k)
                        grew.push(`${pageLabel(f)} ×${k.toFixed(2)}`);
                }
                if (grew.length)
                    s.out.push({ role: "event", text: `빈 곳이 많은 장 ${grew.length}개를 조금 키웠어요`, payload: { kind: "stage", ai: "dynapse", detail: grew.join(" · ") } });
            }
        }
        // 남은 잘림은 앱이 마저(C5 ③ — 희원: 03 steps 화면 밖 글자 5개가 남은 채 "고쳐 달라"를 사용자에게 시켰다): 검사 맞춤 뒤에도 잘림·넘침이 남은 장은
        // 줄 감기 → 감기 + 한 단계씩 줄여(×0.92 → ×0.85, 글자·간격만) 다시 재고 — 풀린 단계만 남긴다(새 겹침·넘침이 늘면 되돌림). 커밋은 턴 커밋에 같이 · 결과만 한 줄
        if (v1 && !s.raw && !s.rewardTask && !rewardWorks.has(id)) {
            const CLIP = /^(clipped|overflow|overflow_x|overflow_y|outside)$/;
            const clip = [...new Set([...v1.errors, ...v1.warnings].filter(e => CLIP.test(e.rule) && e.page && e.page !== "*").map(e => e.page))].slice(0, 3), fixed = [];
            if (clip.length) {
                const { growHtml } = await import("./grow.js");
                for (const f of clip) {
                    const orig = await wget(id, f).catch(() => null);
                    if (!orig)
                        continue;
                    const bad0 = [...v1.errors, ...v1.warnings].filter(e => e.page === f && /overflow|clip|outside|overlap/.test(e.rule)).length;
                    // 줄 감기 먼저(한 줄로 묶인 긴 글 — nowrap), 그다음 감기 + 한 단계씩 줄이기
                    const wrap = (h) => /data-fit-wrap/.test(h) ? h : h.replace(/<\/head>/i, `<style data-fit-wrap>.slide *{white-space:normal!important;word-break:keep-all;overflow-wrap:anywhere}</style>\n</head>`);
                    for (const k of [1, 0.92, 0.85]) {
                        await wput(id, f, k === 1 ? wrap(orig) : growHtml(wrap(orig), k)).catch(() => { });
                        const v = await appVerify(id, [f]).catch(() => null);
                        const left = v ? [...v.errors, ...v.warnings].filter(e => e.page === f && CLIP.test(e.rule)).length : 1, bad = v ? [...v.errors, ...v.warnings].filter(e => e.page === f && /overflow|clip|outside|overlap/.test(e.rule)).length : 99;
                        if (left === 0 && bad < bad0) {
                            fixed.push(f);
                            const errs = v1.errors.filter(e => !(e.page === f && CLIP.test(e.rule)));
                            v1 = { ...v1, errors: errs, warnings: v1.warnings.filter(e => !(e.page === f && CLIP.test(e.rule))), ok: errs.length === 0 };
                            break;
                        }
                        await wput(id, f, orig).catch(() => { });
                    }
                }
                report("turn", "fit.clip_auto", `n=${clip.length} fixed=${fixed.length}`);
                if (fixed.length)
                    s.out.push({ role: "event", text: `${fixed.map(pageLabel).join(", ")} 글이 넘쳐 줄을 감고 맞췄어요 · 되돌리기 ⌘Z`, payload: { kind: "stage", ai: "dynapse" } });
            }
        }
        // 지난 검사(#302 B ③) — "남은 고칠 것 고쳐"가 이 목록을 그대로 쓴다
        // 글자형 표지 제안(#314 ⑦ · 보정 1) — 경고 하나로 실어 "자세히"·"남은 고칠 것"에만(AI 고침 패스에는 안 넣는다)
        if (v1) {
            const cs = await readJson(id, ".dynapse/cover-suggest.json").catch(() => null);
            const ch = cs?.page ? (await wget(id, cs.page).catch(() => null)) ?? "" : "", hasPhoto = !!cs?.slot && new RegExp(`data-slot\\s*=\\s*["']${cs.slot}["'][^>]*>\\s*<img\\b`, "i").test(ch); // 그새 사진이 들어왔으면 제안 없음
            const extra = cs?.page && !hasPhoto ? [{ page: cs.page, rule: "cover_type_art", msg: `표지 사진이 없어 가운데가 비었어요 — 글자형 표지(${cs.form === "cover-number" ? "숫자 표지" : "색면 큰 제목"})로 바꿀 수 있어요` }] : [];
            await wput(id, ".dynapse/last-verify.json", JSON.stringify({ at: Date.now(), errors: v1.errors.slice(0, 20), warnings: [...v1.warnings.slice(0, 20 - extra.length), ...extra] })).catch(() => { });
        }
        // 빠진 사실(#302 B ①②): 장 글의 [빈칸]을 예시 표기로(흐린 글씨 + "예시") · 처음 보는 빈칸이면 카드 하나(입력칸 + [나중에]) — AI가 산문으로 묻지 않게
        if (!s.rewardTask && !rewardWorks.has(id)) {
            const F = await import("./facts.js");
            // 언어판(.ko.html 등)도 — 대표의 12-seed-use.ko에 예시 표기가 없어 빈칸이 회색 글자뿐이었다(#312 ④)
            const names = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(n => /^result-[a-z0-9-]+(\.[a-z]{2})?\.html$/.test(n));
            // 표지(장 순서의 첫 장 · 01·cover)는 날짜·장소 예시도 이름표만(#314 ②)
            const first0 = (await readJson(id, ".dynapse/pages.json").catch(() => null))?.[0], isCover = (f) => { const b = f.replace(/\.[a-z]{2}\.html$/, ".html"); return b === first0 || /^result-(01|cover)\.html$/.test(b); };
            const all = [], ex = {};
            for (const f of names) {
                const h = await wget(id, f).catch(() => null);
                if (!h)
                    continue;
                const bl = F.blanksOf(h);
                if (!bl.length && !/\bdata-example\b/.test(h))
                    continue;
                for (const b of bl)
                    if (!all.includes(b))
                        all.push(b);
                const mk = F.markExamples(h, { cover: isCover(f) });
                if (mk !== h)
                    await wput(id, f, mk).catch(() => { });
                for (const [k, v] of Object.entries(F.examplesOf(mk)))
                    ex[k] ??= v;
            }
            if (all.length) {
                const fj = (await readJson(id, FACTS).catch(() => null)) ?? { asked: [], got: {} };
                const fresh = all.filter(b => !fj.asked.includes(b) && !(fj.later ?? []).includes(b) && !(b in fj.got));
                await wput(id, FACTS, JSON.stringify({ ...fj, asked: [...new Set([...fj.asked, ...all])].slice(0, 40) })).catch(() => { });
                await writeFactsBrief(id, fj.got, all.length);
                if (fresh.length) {
                    report("turn", "facts.ask", `n=${fresh.length}`);
                    s.out.push({ role: "event", text: `빈칸 ${all.length}개 — 채우면 바로 들어가요`, payload: { kind: "facts-ask", ai: "dynapse", fields: all.slice(0, 12), examples: Object.fromEntries(Object.entries(ex).filter(([k]) => all.slice(0, 12).includes(k))) } });
                }
            }
        }
        (s.tm ??= {}).verify_ms = Date.now() - v0;
        s.copyHits = [...v1.warnings, ...v1.errors].filter(w => w.rule === "copy_ai").slice(0, 8);
        if (s.mx && typeof v1.ai_copy_score === "number")
            s.mx.copy = v1.ai_copy_score; // AI 말투(#122)
        // 자동 맞춤(#126) — 앱이 푼 곳 · 남아 AI에게 간 잘림·겹침·가림
        {
            const fit = v1.fit ?? {}, auto = ["layout_cover", "layout_clip", "layout_tt", "layout_line"].reduce((a, k) => a + (Number(fit[k]) || 0), 0), left = [...v1.errors, ...v1.warnings].filter(w => /^(clipped|overlap|outside|overflow_x|overflow_y)$/.test(w.rule)).length;
            if (s.mx && (auto || left))
                Object.assign(s.mx, { fit_auto: auto, fit_left: left });
        }
        if (s.mx && !textOnly)
            s.mx.renders = (s.mx.renders ?? 0) + 1; // 렌더 횟수(#127 보정 2)
        if (s.mx) {
            s.mx.runs++;
            s.mx.rules = [...new Set([...s.mx.rules, ...v1.errors.map(e => e.rule)])].slice(0, 8);
            if (v1.flow?.length)
                s.mx.flow = v1.flow.slice(0, 10).map(f => [f.shared, f.moved, f.appeared]);
        } // 연속 레이아웃 수치(#117 보정 2 §1) — 이웃 장마다 [공통 비율, 바뀐 수, 나타나고 사라진 수]
        {
            const done = seqWritten(id);
            if (done)
                v1 = { ...v1, warnings: v1.warnings.filter(w => done.has(w.page)) };
        } // 리워드 장 차례 중엔 쓴 장 경고만(#278 ④)
        s.out.push({ role: "event", text: null, payload: { kind: "verify", ai: "dynapse", ok: v1.ok, errors: v1.errors.slice(0, 5), warnings: v1.warnings.length, wk: warnKinds(v1.warnings) } });
        if (!s.raw) {
            const gs = await glyphSwap(id, v1).catch(() => null);
            if (gs)
                s.out.push({ role: "event", text: `이 글꼴엔 없는 글자(${gs.chars})가 있어 ${gs.name}(으)로 바꿨어요 · 되돌리기 ⌘Z`, payload: { kind: "stage", ai: "dynapse" } });
        } // 글자 빠짐(#158 ③)
        // 칸 글로 지은 덱(#275 ⑥) — 글자 문제는 그 칸만 다시 묻고 그 장만 다시 조립·검사. 남은 오류만 아래 고침 턴으로
        if (!v1.ok && s.slotsBuilt && !s.slotFixed) {
            s.slotFixed = true;
            const fixedPages = await slotFix(id, v1.errors, s.ai === "chatgpt" ? "chatgpt" : "claude");
            if (fixedPages.length) {
                const v2 = await appVerify(id, fixedPages, { noRender: false, reward: false });
                const keep = v1.errors.filter(e => !fixedPages.includes(e.page));
                v1 = { ...v2, errors: [...keep, ...v2.errors], ok: !keep.length && v2.ok };
            }
        }
        if (!v1.ok && s.fixups < (s.raw ? 2 : 1) && s.tool === "claude" && s.procId !== undefined) { // raw는 엔진 고침 대신 AI 고침 두 번(#312 보정 1)
            s.fixups++;
            foldUsage(s);
            if (!s.reviews && s.firstReply === undefined)
                s.firstReply = s.lastText;
            await flushChat(id, s);
            s.verifyN = 0;
            s.preFix = new Map();
            for (const f of [...new Set(v1.errors.map(e => e.page))].filter(isPage)) {
                const h = await wget(id, f).catch(() => null);
                if (h)
                    s.preFix.set(f, h);
            }
            await T().core.invoke("run_write", { id: s.procId, line: JSON.stringify({ type: "user", message: { role: "user", content: `App verify failed on the pages you changed. Fix only these errors (slot/over_px say where — no need to open the PNG${v1.errors.some(e => e.rule === "render_empty") ? "; for render_empty open the element PNG named in the message" : ""}) and end your turn; the app checks again — do not run verify.mjs yourself. Keep the request and constraints. Reply to the user in Korean.\n${JSON.stringify({ errors: v1.errors.slice(0, 8) })}` } }) }).catch(() => { });
            return; // 같은 턴이 이어진다(result가 다시 온다)
        }
        // 고친 뒤에도 실패(#55) — 되돌리지 않는다. 파일은 그대로, 입력창 위 칩 "검증 실패 · 고친 파일 N개"에서 [저장]·[되돌리기]는 사용자가. 커밋 없음
        // 리워드는 실패해도 "아무것도 없음"이 아니게(#107 보정 2 §2 — 대표 첫 리워드가 빈 작업실로 보였다): 만든 장을 `검증 실패` 꼬리표로 커밋하고 사진 요청도 돌린다(제출은 verify --reward가 막는다).
        // 사진이 들어오면 아래 자동 이어하기가 AI에게 verify → 고치기 → 제출을 맡긴다
        const rwFail = !v1.ok && (!!s.rewardTask || rewardWorks.has(id));
        if (rwFail) {
            const made = changed0.filter(isPage).length;
            s.failTag = true;
            s.out.push({ role: "event", text: `만든 ${made}장은 있어요 · 제출 전 고칠 것 ${v1.errors.length}개`, payload: { kind: "stage", ai: "dynapse" } });
            report("turn", "turn.verify_fail", [...new Set(v1.errors.map(e => e.rule))].slice(0, 8).join(","));
        }
        if (!v1.ok && !rwFail) {
            // 검사와 상관없는 디자인 단계는 실패해도(#294 보정 5 — C2: 칸 첫 결과가 검사에 걸리면 글꼴 짝·빈 사진 칸 채우기가 빠졌다가 다음 턴("1장 제목 크게")에 덱 전체로 들어가 다른 장까지 바뀌어 보였다)
            await applyFontPick(id).catch(() => { });
            {
                const pg = changed0.filter(isPage);
                const nf = pg.length ? await fillEmptySlots(id, pg).catch(() => 0) : 0;
                if (nf)
                    report("photo", "photo.fill_empty", `n=${nf} fail_path=1`);
            }
            const kept = changed0.filter(f => isPage(f) || f.startsWith("materials/") || f === "tokens.css");
            s.out.push({ role: "agent", text: s.firstReply ?? s.lastText ?? "끝났어요", payload: { ai: s.ai, model: s.runModel ?? null, summary: summaryLines(s.firstReply ?? s.lastText) } });
            s.out.push({ role: "event", text: `검증 실패 · 남은 오류: ${errorsLine(v1.errors)}`, payload: { kind: "error", ai: "dynapse" } });
            report("turn", "turn.verify_fail", [...new Set(v1.errors.map(e => e.rule))].slice(0, 8).join(","));
            tally("turns", false);
            if (kept.length)
                await addPending(id, { t: "stopped", why: "verify", files: kept, label: `검증 실패 · 고친 파일 ${kept.length}개` }).catch(() => { });
            return finishTurn(id, s);
        }
        // 시각화 요청인데 계획에 그림이 하나도 없으면(#102 §3) — 한 번만 되돌려 보낸다
        if (v1.ok && s.viz && !s.vizRetried && s.tool === "claude" && s.procId !== undefined) {
            const plan = await readJson(id, ".dynapse/viz-plan.json").catch(() => null);
            const drew = (await Promise.all(pages0.map(f => wget(id, f).catch(() => null)))).some(h => !!h && /\sdata-viz\s*=|data-layout\s*=\s*["'](persona-card|journey-map|icon-row)["']|\sdata-icon\s*=/.test(h));
            if (!drew && (!Array.isArray(plan) || plan.every(x => !x?.viz || x.viz === "none"))) {
                s.vizRetried = true;
                foldUsage(s);
                if (s.firstReply === undefined)
                    s.firstReply = s.lastText;
                chatEvent(id, s, "그림이 없어 한 번 더 · 시각화", { ai: "dynapse" });
                await flushChat(id, s);
                await T().core.invoke("run_write", { id: s.procId, line: JSON.stringify({ type: "user", message: { role: "user", content: "The request asks for visualization, but no page has one yet. Pick at least one page whose data fits (a trend → data-viz line, numbers → data-viz bar or big-number, shares → donut, a process → data-viz flow, a person → persona-card, features → icon-row), update .dynapse/viz-plan.json and that page (charts are data-viz JSON — the app draws them), and end your turn. Reply to the user in Korean." } }) }).catch(() => { });
                return;
            }
        }
        // ③ 보는 검토(#98) — 통과한 뒤 그림·덱 글자를 AI가 한 번 더 본다. 같은 턴이 이어진다(result가 다시 온다)
        if (v1.ok && canLook) {
            const rp = await reviewPrompt(id, s, v1, pages0, fast, order).catch(() => null);
            if (rp) {
                foldUsage(s);
                if (!s.reviews && s.firstReply === undefined)
                    s.firstReply = s.lastText;
                s.reviews = (s.reviews ?? 0) + 1;
                s.look = { n: s.reviews, imgs: (s.look?.imgs ?? 0) + rp.imgs, tok: s.look?.tok ?? 0 };
                chatEvent(id, s, `그림으로 확인 ${s.reviews}/2 · 그림 ${rp.imgs}장`, { ai: "dynapse" });
                await flushChat(id, s);
                s.verifyN = 0;
                await T().core.invoke("run_write", { id: s.procId, line: JSON.stringify({ type: "user", message: { role: "user", content: rp.text } }) }).catch(() => { });
                return;
            }
        }
    }
    // ② 답을 먼저(#54 A1) — 사진은 뒤에서 만들고 커밋은 사진 뒤 한 번(요청 1 = 커밋 1, #30). 보는 검토를 했으면 첫 답 + 편집자 읽기 카드
    const carried = s.contQueued ? undefined : carryReply.get(id);
    if (carried !== undefined)
        carryReply.delete(id); // 자동 승인으로 이어 간 턴 — 앞 턴의 첫 답이 사용자에게 보일 답
    const reply = carried ?? s.firstReply ?? s.lastText;
    const reask = await (async () => {
        const F = await import("./facts.js"), want = F.asksFor(reply ?? "");
        if (!want.length)
            return null;
        const fj = await readJson(id, FACTS).catch(() => null), have = new Map();
        for (const x of fj?.told ?? [])
            have.set(x.kind, x.value);
        for (const [k, v] of Object.entries(fj?.got ?? {})) {
            const kk = F.blankKind(k);
            if (kk)
                have.set(kk, v);
        }
        const kinds = want.filter(k => have.has(k));
        return kinds.length ? { kinds, known: kinds.map(k => `${k} = ${have.get(k)}`).join("; ") } : null;
    })().catch(() => null);
    // 리워드 작업실에서 AI가 직접 올리다 "놓은 Claim"으로 거절되면(#224 ④ — "제출이 거절됐어요 … 다시 claim_task"가 사용자에게 보였다) 그 말은 보이지 않고 앱이 [제출]을 한 번(다시 맡기 → 묶기 → 제출)
    const rwTask = s.rewardTask ?? (/^task_/.test(rewardWorks.get(id) ?? "") ? rewardWorks.get(id) : undefined);
    const claimLost = !!rwTask && CLAIM_LOST.test(reply ?? "") && !claimRetried.has(`${id}|${rwTask}`);
    if (s.contQueued) { /* 작업량 한도로 이어 가는 턴 — 답은 이어 간 턴이 한 번 */ }
    else if (claimLost) {
        claimRetried.add(`${id}|${rwTask}`);
        report("turn", "reward.claim_lost_retry", rwTask);
        s.out.push({ role: "event", text: "앱이 다시 맡아서 올려요", payload: { kind: "stage", ai: "dynapse" } });
        setTimeout(() => { active++; void submitReward(id, rwTask).finally(() => { active--; }); }, 0);
    }
    // 말 없이 끝난 턴(#233 ① — 12:27 Sonnet이 선택 파일을 찾느라 Bash 6번 뒤 답 없이 끝났다): "끝났어요"로 덮지 않고 한 줄 + [다시] · 영어 답(#233 ②)은 한국어로 한 번 다시(숨김)
    else if (!(reply ?? "").trim() && !rwTask) {
        report("turn", "turn.silent", `model=${s.runModel ?? "-"} tier=${s.tier ?? "-"}`);
        // 사람 말 없이 끝나지 않게(C5 S1 2회차) — 바뀐 장을 앱이 한 문장으로 + [다시]
        const mine = s.startPages?.size ? (await Promise.all([...s.startPages].map(async ([f, h]) => ((await wget(id, f).catch(() => null)) ?? h) !== h ? f : null))).filter((f) => !!f) : pages0; // 이 턴에 바뀐 장(턴 시작 판과 비교)
        const said = mine.length ? `${mine.slice(0, 6).map(pageLabel).join("·")}을 고쳤어요 · AI가 설명 없이 끝났어요` : "아무 장도 바꾸지 못하고 끝났어요";
        s.out.push({ role: "agent", text: said, payload: { ai: "dynapse", summary: [said] } }, { role: "event", text: "다시 보내면 이어서 해요", payload: { kind: "error", ai: "dynapse", retry: true } });
    }
    // 이미 받은 사실을 다시 묻는 답(C5 ① — 희원: GPT가 받은 날짜·장소를 또 물었다)은 보이지 않고, 장부를 앞에 붙여 한 번 다시
    else if (!rwTask && reask && !reaskRetried.has(id)) {
        reaskRetried.add(id);
        setTimeout(() => reaskRetried.delete(id), 600_000);
        report("turn", "facts.reask_blocked", reask.kinds.join(","));
        s.out.push({ role: "event", text: `이미 받은 ${reask.kinds.join("·")}로 이어서 해요`, payload: { kind: "stage", ai: "dynapse" } });
        const rq = s.requestText ?? "";
        setTimeout(() => void handleChat({ id: `auto:${Date.now()}`, work: id, role: "user", text: `[You asked for facts the user already gave: ${reask.known}. Use them now and finish the request — do not ask again.] ${rq.slice(0, 400)}`, payload: { ...(s.route ? { route: s.route } : {}) } }), 50);
    }
    else if (!rwTask && /[가-힣]/.test(s.requestText ?? "") && mostlyEnglish(reply ?? "") && !englishRetried.has(id)) {
        englishRetried.add(id);
        setTimeout(() => englishRetried.delete(id), 600_000);
        report("turn", "turn.english_reply", `model=${s.runModel ?? "-"}`);
        s.out.push({ role: "event", text: "한국어로 다시 답하게 했어요", payload: { kind: "stage", ai: "dynapse" } });
        // 장을 이미 바꾼 턴이면 답만 한국어로 다시 쓰게(일을 다시 시키지 않는다 — 앵커 B는 91k 토큰 턴이었다)
        const did = s.startPages?.size ? (await Promise.all([...s.startPages].map(async ([f, h]) => ((await wget(id, f).catch(() => null)) ?? h) !== h))).some(Boolean) : false;
        const rq = s.requestText ?? "";
        setTimeout(() => void handleChat({ id: `auto:${Date.now()}`, work: id, role: "user", text: did ? "Rewrite your last answer to the user in Korean with the same content (image prompts may stay in English). Do not open or edit any page." : `Answer in Korean. Do the user's request now on the pages it names: "${rq.slice(0, 300)}"`, payload: { auto: "korean" } }), 50);
    }
    else {
        let decision = null; // 고를 일(#279 보정 1 ④) — 답 끝 JSON 한 줄 → 웹 버튼 칸
        // 리워드 장 턴 답이 질문이면(#278 ②) 그 장을 실제로 썼는지로 한 줄을 바꾼다(묻는 말이 대화에 남지 않게)
        let txt = reply ?? "끝났어요";
        const rf = (s.requestText ?? "").match(/^\[(?:This is a page-writing turn[^\]]*\]\s*\[)?Reward page turn[^\]]*?write only ([^\s,]+\.html)/)?.[1];
        if (rf && /[?？]\s*$|알려\s*주세요|알려주세요|할까요|원하시나요/.test(txt.trim())) {
            const h = await wget(id, rf).catch(() => null);
            txt = h && h.length > 400 ? `${pageLabel(rf)}을 썼어요 · ${Math.round(h.length / 100) / 10}KB` : `${pageLabel(rf)}을 아직 못 썼어요 · 다음 차례에 다시 해요`;
            report("turn", "reward.question_replaced", rf);
        }
        // 쉬운 문장 3개까지(#279 ②) — 코드·파일 이름·규칙 이름·CSS 문장·잘린 문장·끝의 질문을 뺀다(브랜드 표기 질문은 브리프의 브랜드로 한 문장). 원문은 앱 로그에
        {
            const rw = !!s.rewardTask || rewardWorks.has(id), br = rw ? ((await wget(id, ".dynapse/reward-brief.md").catch(() => null)) ?? "") : "", brand = br.match(/(?:브랜드|상호)\s*[:：]\s*([^\n,·]{2,24})/)?.[1]?.trim() ?? br.match(/Brand "([^"]{2,40})"/)?.[1] ?? null;
            const RC = await import("./reply-clean.js"), dc = RC.takeDecision(txt);
            if (dc.decision) {
                decision = dc.decision;
                txt = dc.text;
                report("turn", "reply.decision", `n=${dc.decision.options.length}`);
            }
            const clean = RC.cleanReply(txt, { brand, reward: rw });
            if (clean !== txt) {
                logChat(`reply.clean ${txt.length}→${clean.length}`);
                report("turn", "reply.cleaned", `${txt.length}>${clean.length}`);
            }
            txt = clean;
        }
        if (!decision && !s.rewardTask && !rewardWorks.has(id)) {
            const H = await import("./hero-sheet.js"), hf = await readJson(id, H.HERO_FILE).catch(() => null); // 주인공 시트 승인(#304 보정 2 ② · 보정 1 ②)
            if (hf?.brief && !hf.status && (hf.gens ?? 0) < H.HERO_CAP) {
                if (H.personIn(hf.brief)) {
                    await wput(id, H.HERO_FILE, JSON.stringify({ ...hf, status: "skip", at: Date.now() })).catch(() => { });
                    report("turn", "hero.person_skip", "");
                }
                else {
                    decision = H.heroDecision(hf);
                    await wput(id, H.HERO_FILE, JSON.stringify({ ...hf, status: "ask", at: Date.now() })).catch(() => { });
                    report("turn", "hero.ask", "");
                }
            }
        }
        // 아래가 빈 장(#314 ③ · 보정 1 — 모양 규칙은 AI 고침에 넣지 않고 사용자가 고른다): 첫 결과에 underfill 경고가 있으면 결정 칸 하나 [채우기] [그대로 두기]
        if (!decision && s.firstTurn && !s.rewardTask && !rewardWorks.has(id) && v1) {
            const uf = [...new Set(v1.warnings.filter(w => w.rule === "underfill").map(w => w.page.replace(/^.*\//, "")))].slice(0, 8);
            if (uf.length) {
                decision = { ask: `아래가 비었어요 · ${uf.map(pageLabel).join("·")}`, options: [FILL_YES, FILL_NO] };
                await wput(id, FILL_FILE, JSON.stringify({ pages: uf, at: Date.now() })).catch(() => { });
                report("turn", "underfill.offer", `n=${uf.length}`);
            }
        }
        if (!s.pointMissed)
            s.out.push({ role: "agent", text: txt, payload: { ai: s.ai, model: s.runModel ?? null, summary: summaryLines(txt), ...(decision ? { decision } : {}) } });
    }
    if (reply)
        lastReply.set(id, reply.slice(-600));
    const notes = s.reviewNotes ?? [];
    if (notes.length) {
        const fx = notes.filter(x => x.t === "fixed").length, kp = notes.length - fx;
        s.out.push({ role: "event", text: `편집자 읽기 · 고친 것 ${fx} · 남긴 것 ${kp}`, payload: { kind: "review", ai: s.ai, fixed: fx, kept: kp, items: notes.map(x => ({ ...x, page: PAGE_RE.test(x.page) ? x.page : null })) } });
    }
    await flushChat(id, s);
    s.post = true;
    active++;
    const ph0 = Date.now();
    const rwk = !!s.rewardTask || rewardWorks.has(id);
    // 개인 작업은 덱 단위 한 묶음(#151 보정 1 ②) — 예산 90초, 못 온 칸은 재고로 완성하고 늦게 온 사진은 뒤에서 교체 + 한 줄(⌘Z)
    const photoAis = await runPhotoRequests(id, s.route, rwk ? { cap: 8, reward: true } : { first: firstBuild && !importedWorks.has(id), batch: true, onLate: (n, ais) => lateRound(id, n, ais) }).catch(() => []).finally(() => { active--; });
    // 완성이라 하기 전에 빈 사진 칸 0(#151 ①) — 이번 턴에 바뀐 장의 빈 사진 칸을 재고로(신뢰 장 제외). 리워드는 생성 규격이라 하지 않는다
    if (!rwk) {
        const ch = S.git ? (await T().core.invoke("repo_changed", { id }).catch(() => [])).filter(isPage).filter(f => !own || own(f)) : pages0;
        const nf = await fillEmptySlots(id, ch).catch(() => 0);
        if (nf) {
            const ps = photoStats.get(id);
            if (ps)
                ps.stock = (ps.stock ?? 0) + nf;
            report("photo", "photo.fill_empty", `n=${nf}`);
        }
    }
    if (photoAis.length)
        (s.tm ??= {}).photo_ms = Date.now() - ph0;
    await applyFontPick(id).catch(() => { }); // 글꼴 한 줄(#36)도 이 요청의 커밋에
    await fillQr(id).catch(() => 0); // QR 칸(#157 ④)도 이 요청의 커밋에
    await fillSeal(id).catch(() => 0); // 인장 표지(#230 보정 17 1b)도
    if (photoAis.length)
        s.photoAis = [...new Set([...(s.photoAis ?? []), ...photoAis])];
    const changed = S.git ? (await T().core.invoke("repo_changed", { id }).catch(() => [])).filter(f => !own || own(f)) : ["?"];
    const touched = changed.some(f => isPage(f) || f.startsWith("materials/"));
    if (s.mx)
        s.mx.files = changed.filter(f => !f.startsWith(".dynapse/")).length;
    if (touched) {
        // 바뀐 페이지만(#29 A4). 사진·글꼴로 바뀐 장만 한 번 더(번들·스크린샷 갱신) — 에이전트 장은 ①에서 봤다
        const pages = changed.filter(isPage);
        const photosChanged = changed.filter(f => f.startsWith("materials/"));
        const photoPages = [];
        if (photosChanged.length)
            for (const f of (await T().core.invoke("work_files", { id }).catch(() => [])).map(x => x.name).filter(isPage)) {
                const h = await wget(id, f);
                if (h && photosChanged.some(ph => h.includes(ph)))
                    photoPages.push(f);
            }
        if (photoPages.length)
            await syncLangs(id, photoPages).catch(() => { }); // 사진이 들어온 장의 언어판도 같은 사진(#100)
        const vpages = [...new Set([...pages, ...photoPages])];
        const again = vpages.filter(f => photoPages.includes(f) || !pages0.includes(f));
        let v = v1 ?? { ok: true, errors: [], warnings: [], shots: [] };
        if (again.length || !v1) {
            const v0 = Date.now();
            const v2 = await appVerify(id, S.git && vpages.length ? (v1 ? again : vpages) : undefined, { reward: !!s.rewardTask || rewardWorks.has(id) });
            (s.tm ??= {}).verify_ms = (s.tm.verify_ms ?? 0) + Date.now() - v0;
            if (s.mx) {
                s.mx.runs++;
                s.mx.rules = [...new Set([...s.mx.rules, ...v2.errors.map(e => e.rule)])].slice(0, 8);
            }
            if (!v2.ok || !v1)
                s.out.push({ role: "event", text: null, payload: { kind: "verify", ai: "dynapse", ok: v2.ok, errors: v2.errors.slice(0, 5), warnings: v2.warnings.length, wk: warnKinds(v2.warnings) } });
            v = { ok: v.ok && v2.ok, errors: [...v.errors, ...v2.errors], warnings: [...v.warnings, ...v2.warnings], shots: [...new Set([...v.shots, ...v2.shots])], engine: v2.engine ?? v.engine };
        }
        // 사진·글꼴 뒤 검사가 실패해도 답은 이미 나갔다 — 만든 사진을 버리지 않고 저장, 오류는 검사 카드로 보인다
        const trace = (await readJson(id, ".dynapse/TRACE.json")) ?? {};
        const n = (trace.rounds?.at(-1)?.n ?? 0) + 1;
        // 사진 칸 출처(#23 · #23-보정 A) — 이번 턴에 쓴 재고는 "재고 사진 · ⟨제목⟩" + [내 AI로 새로], 비워 둔 칸은 "사진 칸 비어 있음" + [사진 만들기]
        const before = new Set(s.traceBefore ?? []);
        for (const c of (trace.children ?? []).filter(c => c.runtime === "stock" && !before.has(JSON.stringify(c))).slice(0, 4))
            s.out.push({ role: "event", text: `재고 사진 · ${(c.title ?? "재고").slice(0, 40)}`, payload: { kind: "stock", ai: "dynapse", slot: c.slot ?? null, file: c.file ?? null, asset_id: c.asset_id ?? null } });
        const photos = await photoTally(id, trace).catch(() => null); // 턴 카드 "사진 3 · ◆2 ✦1"(#37)
        if (trace.empty_slots?.length && !before.has(`empty:${JSON.stringify(trace.empty_slots)}`) && !photoAis.length && (photos?.empty ?? 1) > 0) // 앱이 재고로 다 채웠으면 "비어 있음" 아님(#151 ①)
            s.out.push({ role: "event", text: "사진 칸 비어 있음", payload: { kind: "photo-empty", ai: "dynapse", slots: trace.empty_slots.slice(0, 6) } });
        // 스레드 항목(#30) — 바뀐 곳 라벨(파일 줄 어휘: 표지 · 사진)과 관여한 AI(편집 + 사진)
        const fl = frameTurn.get(id);
        if (fl)
            frameTurn.delete(id);
        const labels = [...new Set([...(fl ? [fl] : []), ...pages.map(pageLabel), ...photoPages.map(f => `${pageLabel(f)} · 사진`)])].slice(0, 6);
        const ais = [s.ai, ...(s.photoAis ?? [])].filter((a, k, all) => all.indexOf(a) === k);
        const r = { n, role: "write", runtime: rtOf(s.tool), session_id: s.sessionId ?? "", files: vpages,
            req: { text: request }, summary: summaryLines(reply), ...(s.runModel ? { model: s.runModel } : {}), ...(s.merged ? { merged_from: s.merged } : {}) };
        const c0 = Date.now();
        await saveRound(id, r, s.failTag ? `검증 실패 · ${request}` : request, v, await ownPaths());
        tally("turns", !s.failTag);
        s.failTag = false;
        (s.tm ??= {}).save_ms = Date.now() - c0;
        r.timing = timingOf(s); // TRACE round에(#51)
        await wput(id, ".dynapse/TRACE.json", JSON.stringify({ ...trace, rounds: [...(trace.rounds ?? []), r] }, null, 2));
        if (s.mx) {
            s.mx.committed = true;
            s.mx.round = n;
        }
        // 스토리보드(#111 §2) — story.json이 새로 생기거나 바뀌면 장마다 장치·한 줄을 채팅에(새 화면 없음)
        {
            const sj = await wget(id, ".dynapse/story.json").catch(() => null);
            if (sj && storySent.get(id) !== sj) {
                storySent.set(id, sj);
                try {
                    const st = JSON.parse(sj);
                    const lines = (st.beats ?? []).slice(0, 14).map(b => `${pageLabel(String(b.page ?? ""))} · ${b.device ?? ""} · ${String(b.line ?? "").slice(0, 60)}`);
                    if (st.logline || lines.length)
                        s.out.push({ role: "event", text: [`이야기 · ${String(st.logline ?? "").slice(0, 120)}`, ...lines].join("\n"), payload: { kind: "story", ai: "dynapse" } });
                }
                catch { /* 형식이 틀리면 보이지 않는다 */ }
            }
        }
        void import("./main.js").then(m => m.markFirstTurn()).catch(() => { }); // 첫 턴(#149 §4 막힘 줄 끄기)
        s.out.push({ role: "event", text: null, payload: { kind: "shot", ai: s.ai, round: n, pages: await orderShots(id, r.shots ?? []), commit: r.commit ?? null, uploaded: !!r.uploaded, model: s.runModel ?? null, ais, labels, ...(photos ? { photos } : {}) } }); // 스레드 항목 = 커밋 = 요청 하나(#20 · #30)
        if (s.mx && photos)
            s.mx.fill = { n: photos.n, empty: photos.empty, stock: photos.stock, open: photos.open, gen: photos.agy + photos.codex, mine: photos.mine }; // #151 보정 1 ④ 비율
        if (v1)
            await contributeAsk(id, s, v1, photos?.empty ?? 0).catch(() => { });
        // 부기는 뒤에서(#54 A3) — 작업 상태 올리기·썸네일·동기화
        void T().core.invoke("work_dir", { id }).then(dir => api("POST", "/api/works", { id, status: "done", local_path: dir, device_id: S.deviceId })).catch(() => { });
        void afterSave(id);
        void T().core.invoke("doc_index", { id, name: null }).catch(() => { }); // AI가 받아 적은 글(#70)도 곧바로 색인 — 파일 패널이 바로 "AI가 읽음"
        // 리워드 작업(대표: 덱을 만들었는데 홈에 안 뜬다) — 사진은 턴 끝에 들어오고 에이전트는 그 전에 끝나 제출이 한 턴 밀렸다 → 사진이 들어왔으면 같은 요청으로 이어서 올리고 제출(한 번만)
        if (s.rewardTask && photoAis.length && s.autoSubmitted !== s.requestText) {
            s.autoSubmitted = s.requestText;
            s.out.push({ role: "event", text: "사진이 들어와 이어서 제출해요", payload: { kind: "stage", ai: "dynapse" } });
            s.queue.push("The app has placed the requested photos into the slots. Now finish the reward as your first message's steps say (or .dynapse/skill-reward.md if it had none): node .dynapse/verify.mjs --reward → PUT the bundles in page order (then tokens.css for a deck) → submit_work. Claim again first only if the claim expired. Reply to the user in Korean with the result.");
            (s.reqQueue ??= []).push("사진 들어와 이어서 제출");
        }
    }
    else if (S.git && changed.length)
        await repoCommit(id, request, await ownPaths());
    // 병렬 장 턴이 다른 장·공유 파일을 쓰려다 막혔으면(#191) — 덱을 바꾸는 요청: 앞 턴이 끝난 뒤 같은 요청으로 이어서
    if (s.laneBlocked && s.requestText) {
        s.laneBlocked = false;
        const other = [...sessions.entries()].find(([k, x]) => k.startsWith(`${id}|`) && x !== s && x.busy);
        s.out.push({ role: "event", text: "덱 전체를 바꾸는 요청이라 앞 작업이 끝난 뒤 이어서 해요", payload: { kind: "stage", ai: "dynapse" } });
        if (other)
            (other[1].afterIdle ??= []).push({ text: s.requestText, opts: {} });
    }
    s.post = false;
    s.stopped = false; // ■가 사진 도중이면 러너가 지금 장까지만 — 여기서 정리
    if (touched && ok && changed.some(isPage))
        await flatPhotos(id).catch(() => 0); // AI가 하위 폴더에 둔 사진(#130 보정 4) — 턴 끝에 한 단계로
    // 강조색은 표지 사진에서(#119 보정 8 §3) — 개인 작업, 사진이 든 표지, 기본 강조색일 때 한 번(색을 정했거나 리워드면 건드리지 않는다)
    if (touched && ok && !s.raw && !s.rewardTask && !rewardWorks.has(id) && (!sharedWorks.has(id) || await isOriginDevice(id).catch(() => false)))
        void import("./accent.js").then(x => x.accentFromCover(id)).catch(() => false);
    // 다른 모양 미리 만들기(#119 보정 9 §2) — 저장 뒤 유휴 8초에 이번 턴에 바뀐 장(최대 3장). 멤버 기기는 안 한다(원본 기기만 렌더)
    if (touched && ok && (!sharedWorks.has(id) || await isOriginDevice(id).catch(() => false)))
        void import("./form-alts.js").then(x => x.schedulePrerender(id, changed.filter(isPage))).catch(() => { });
    return finishTurn(id, s);
}
// 보는 검토(#98) — 앱 검사를 통과한 턴 끝에 같은 세션으로 한 번 더: 스토리보드·바뀐 장 작은 PNG·차트/표 요소 PNG를 Read로 보게 하고(그림), 1바퀴째엔 덱 전체 글자로 편집자 읽기 7문(글자).
// 고쳤으면 앱이 다시 검사하고 한 번 더 보게(최대 2바퀴). 답은 FIXED/KEPT 줄 + 마지막 줄 DONE|CHANGED → 완료 카드 "편집자 읽기 · 고친 것 N · 남긴 것 M"
const DECK_LINTS = ["same_layout", "stale_pages", "no_numbers", "emoji", "L1", "L3", "L4", "L5", "L7", "L8", "page_no", "density", "variety", "story_flow"];
// 내용 → 형태 예시(#119 §2) — 22종 어휘에서 작업마다 다른 8개(작업 id로 결정적). 같은 예시를 늘 보면 그리로 수렴한다
const FORM_EXAMPLES = [
    "share of customers who return → pictogram 7/10", "market size then and now → proportion", "revenue by channel → ratio", "monthly cycle of order → make → ship → review → ring-process",
    "how a customer starts using it → steps-icon", "old way vs our way → before-after", "a product photo with three features → annotated", "company history with uneven years → ribbon-timeline",
    "one customer sentence → pull-quote", "one headline metric with three supports → stat-stack", "six use cases → grid-gallery", "the customer journey from ad to repeat → path",
    "a trend over 12 months → line with its takeaway", "four regions compared → bar", "two shares of one whole → donut", "one number that is the whole point → big-number",
    "before/after on two dates → slope", "a sales funnel → funnel", "options by cost and impact → matrix-2x2", "milestones with dates → timeline", "a decision with branches → flow", "three equal, parallel benefits → cards (only then)"
];
const formExamples = (seed) => { let h = 0; for (const c of seed)
    h = (h * 31 + c.charCodeAt(0)) >>> 0; const a = [...FORM_EXAMPLES]; for (let i = a.length - 1; i > 0; i--) {
    h = (h * 1103515245 + 12345) >>> 0;
    const j = h % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
} return a.slice(0, 8); };
const lastWord = (t) => (t ?? "").trim().split("\n").map(x => x.trim()).filter(Boolean).at(-1)?.replace(/[*`.]/g, "").toUpperCase() ?? "";
function reviewNotes(t) {
    return (t ?? "").split("\n").map(l => l.trim().replace(/^[-*•]\s*/, "").match(/^\**(FIXED|KEPT)\**\s+(\S+)\s*[|—:-]\s*(.+)$/i)).filter((m) => !!m)
        .map(m => ({ t: m[1].toUpperCase() === "FIXED" ? "fixed" : "kept", page: m[2].replace(/[`*]/g, ""), text: m[3].trim().slice(0, 160) })).slice(0, 12);
}
async function deckText(id, order) {
    const apx = ((await readJson(id, ".dynapse/appendix.json")) ?? []);
    const strip = (x) => x.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "").replace(/<br\s*\/?>/gi, " / ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&[a-z#0-9]+;/gi, "").replace(/[\s⁠]+/g, " ").trim();
    const out = [];
    for (const [i, f] of order.entries()) {
        const h = await wget(id, f);
        if (!h)
            continue;
        const layout = h.match(/<section\b[^>]*\bdata-layout\s*=\s*["']([^"'\s]+)/i)?.[1] ?? "free";
        const slots = [...h.matchAll(/<(\w+)\b[^>]*\bdata-slot\s*=\s*["']([\w-]+)["'][^>]*>([\s\S]*?)<\/\1>/gi)].map(m => [m[2], strip(m[3])]).filter(([k, v]) => v && k !== "page_no" && k !== "brand");
        const body = slots.length ? slots.map(([k, v]) => `${k}: ${v}`).join(" | ") : strip(h.replace(/^[\s\S]*?<body\b[^>]*>/i, ""));
        out.push(`${String(i + 1).padStart(2, "0")}${apx.includes(f) ? " [appendix]" : ""} ${f} (${layout}) — ${body.slice(0, 520)}`);
    }
    let s = out.join("\n");
    if (s.length > 11000)
        s = s.slice(0, 11000) + "\n…";
    return s;
}
let refsCache = null;
async function refPicks(id) {
    if (!refsCache || Date.now() - refsCache.at > 86_400_000) {
        const r = await api("GET", "/api/refs").catch(() => null);
        if (r?.data?.refs?.length)
            refsCache = { at: Date.now(), list: r.data.refs };
    }
    const list = (refsCache?.list ?? []).filter(r => r.url);
    if (!list.length)
        return [];
    let h = 0;
    for (const c of id)
        h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const rot = (a) => a.length ? a[(h = (h * 1103515245 + 12345) >>> 0) % a.length] : undefined;
    const good = list.filter(r => r.kind !== "anti" && r.content_type !== "-"), a = rot(good), b = rot(good.filter(r => r.content_type !== a?.content_type)), x = rot(list.filter(r => r.kind === "anti"));
    const out = [];
    const wd = await T().core.invoke("work_dir", { id }).catch(() => "");
    for (const [r, anti] of [[a, false], [b, false], [x, true]]) {
        if (!r?.url || !wd)
            continue;
        const file = `.dynapse/refs/${r.id}${/\.png($|\?)/i.test(r.url) ? ".png" : ".jpg"}`;
        const have = (await T().core.invoke("work_files", { id }).catch(() => [])).some(f => f.name === file);
        if (!have) {
            await T().core.invoke("work_write", { id, file: ".dynapse/refs/.keep", text: "" }).catch(() => { });
            const r2 = await exec("curl", ["-sSfL", "--max-time", "20", "--proto", "=https", "-o", file, r.url], undefined, wd).catch(() => null);
            if (!r2 || r2.code !== 0)
                continue;
        }
        out.push({ file, r, anti });
    }
    return out;
}
async function reviewPrompt(id, s, v, pages, fast, order) {
    const round = (s.reviews ?? 0) + 1;
    const own = (p) => pages.some(pg => p.endsWith(`/${pg.replace(/^result-|\.html$/g, "")}.sm.png`) || p.endsWith(`${pg.replace(/^result-|\.html$/g, "")}.sm.png`));
    const smalls = fast ? [] : (v.small ?? []).filter(own).slice(0, 3);
    const els = (v.elements ?? []).filter(e => e.file && pages.includes(e.page)).slice(0, 4);
    const board = !fast && v.board ? [v.board] : [];
    const imgs = [...board, ...smalls, ...els.map(e => e.file)];
    if (!imgs.length)
        return null;
    const lines = [
        `Visual review, round ${round} of 2. The app rendered the deck locally. Open each image with the Read tool before you answer:`,
        ...board.map(f => `- ${f} — every page in deck order on one sheet (● = changed this turn)`),
        ...smalls.map(f => `- ${f} — a page you changed`),
        ...els.map(e => `- ${e.file} — ${e.kind}${e.slot ? ` (${e.slot})` : ""} on ${e.page}`),
        "Look for: empty or broken charts, cut or overlapping text, cramped or odd spacing, tiny text, colour emoji, a page that does not match its neighbours."
    ];
    const con = (v.console ?? []).filter(c => pages.includes(c.page)).slice(0, 6);
    if (con.length)
        lines.push(`Console errors while rendering: ${con.map(c => `${c.page}: ${c.text}`).join(" · ")}`);
    const deckW = [...(v.warnings ?? []), ...(v.errors ?? [])].filter(w => DECK_LINTS.includes(w.rule)).slice(0, 8);
    if (deckW.length)
        lines.push(`Deck checks: ${deckW.map(w => `${w.page === "*" ? "deck" : w.page} ${w.rule}: ${w.msg.split(" — ")[0]}`).join(" · ")}`);
    if (round === 1 && !fast && order && order.length >= 3) {
        const lb = await readJson(id, ".dynapse/labels.json");
        lines.push("", `Then read the whole deck as an editor${lb?.goal ? ` (goal: ${lb.goal})` : ""}. Every page's text, in order:`, await deckText(id, order), "", "Check these and fix what needs fixing now:", "1. Is the strongest number or proof within the first three pages (not hidden in the appendix)? If not, bring it forward.", "2. Does any page's big text contradict its own small text?", "3. Are pages on the same topic split apart by unrelated pages? Reorder via .dynapse/pages.json.", "4. Layout policy (the app sampled each page's form in .dynapse/plan.json — keep it unless the page fails the checklist): does every page show one claim (the title) and ONE evidence as its hero (not three parallel items or bullets)? Do neighbouring pages differ in distance (far rest page · mid explanation · close giant number/quote), with a far page every 3–4 pages and close once or twice? Is the system fixed — only the three type sizes var(--type-s/m/l), one accent colour, the motif (data-motif) on every page? If a page fails, rebuild it in its plan.json alt or the next candidate for its evidence kind, never as a row of equal boxes; area forms print their numbers. Tables → appendix only.", `   Examples for this deck (content → form): ${formExamples(id).join(" · ")}.`, "5. Do case pages carry a number?", "5b. Does any sentence read like AI or a chat reply — a dash in the middle of a sentence, 'label: value', A, B and C lists, '제공합니다/지원합니다', '혁신적/다양한/최적의', '~을 통해', two honorifics in one sentence? Rewrite it the way the person who runs this place would say it (short, concrete, one honorific).", "6. Are the pages the goal needs all there (for a business/IR deck: team, revenue, the ask)? Never invent a missing page's facts — report it as KEPT.", "7. Is it readable when presented (body ≥ 24px at 1600 wide, one message per page)?", ...(s.motion ? ["8. Presentation motion is on: do continuing elements keep the same slot name, data-tid and photo file on consecutive pages, so the move is not cut?"] : []), 
        // 다르게 보기(#119 보정 7) — 렌더를 보고 두 질문. 답은 plan.json seen_as, "남음"·"다름"이면 그 장만 이 턴에 한 번 더
        "9. Seeing-as, for every page you look at: (a) is its empty space planned or leftover? (b) say the screen in one word — is that the page's frame in .dynapse/plan.json (pages[].frame) and does it obey deck.frame.rule? Write the answers into plan.json as pages[].seen_as = {\"space\":\"planned|leftover\",\"word\":\"…\",\"same\":true|false}. A page that is leftover or not the same: rebuild that page once now in its frame's composition (only once).", "10. Where a page borrowed from a reference, did it take the reason (the why — e.g. the tension between a giant left title and a colour panel) or only the surface (the numbers of a numbered row with no tension left)? If only the surface, rebuild it once with the why.");
        const refs = await refPicks(id).catch(() => []);
        if (refs.length)
            lines.push("", "Reference shelf (CC BY 4.0 — do not copy; read why the form works and what a page of this deck could take from it). Open each with the Read tool:", ...refs.map(x => `- ${x.file} — ${x.anti ? "AVOID (looks AI-made): " : ""}${x.r.content_type} → ${x.r.form}: ${x.r.why}${x.r.source?.author ? ` (${x.r.id}, ${x.r.source.author})` : ` (${x.r.id})`}`), "Name one page that should borrow a reason from these (not the look), or KEPT if none fits.");
    }
    const vb = await readJson(id, ".dynapse/verbatim.json");
    const verbatim = !!vb?.at && vb.at >= (s.turnAt ?? 0) - 120_000;
    lines.push("", `Rules: ${verbatim ? "this request is copy-as-written — never rewrite the user's sentences; only re-layout, reorder or split. " : "keep the user's facts and wording; "}never invent numbers; do not run verify.mjs, do not open a browser; edit only result-*.html, .dynapse/pages.json, .dynapse/appendix.json and .dynapse/bundles.json; never rename result-*.html.`, "Reply in this format, one item per line (the text after | in Korean, short):", "FIXED <file or deck> | what you changed", "KEPT <file or deck> | what you saw but left, and why", "Last line: DONE if you changed no file in this round, otherwise CHANGED.");
    return { text: lines.join("\n"), imgs: imgs.length };
}
const addUsage = (a, b) => !a ? b : !b ? a : { tokens: a.tokens + b.tokens, cached: (a.cached ?? 0) + (b.cached ?? 0), usd: a.usd !== undefined || b.usd !== undefined ? (a.usd ?? 0) + (b.usd ?? 0) : undefined,
    parts: a.parts && b.parts ? Object.fromEntries(Object.keys({ ...a.parts, ...b.parts }).map(k => [k, (a.parts?.[k] ?? 0) + (b.parts?.[k] ?? 0)])) : a.parts ?? b.parts };
// 같은 턴 안의 후속 메시지(고침·보는 검토) 앞에 — 지금까지의 사용량을 접어 둔다(결과마다 사용량이 그 구간 값으로 덮이므로)
function foldUsage(s) { if (s.reviews)
    s.look = { ...(s.look ?? { n: 0, imgs: 0, tok: 0 }), tok: (s.look?.tok ?? 0) + (s.usage?.tokens ?? 0) }; s.usageAcc = addUsage(s.usageAcc ?? null, s.usage ?? null); s.usage = null; }
// 남은 오류 한 줄(#55) — 종류(장 칸) 최대 3개: "잘린 글자(본문 section_title) · 사진 칸(표지)"
const RULE_KO = { free_axis: "정렬 축", free_empty: "빈 영역", free_margin: "바깥 여백", overlap_box: "겹침", overflow_x: "넘침", viz: "시각화 데이터", hand_lost: "손으로 고친 것 지워짐", clipped: "잘린 글자", spill: "상자 밖 글자", render_empty: "빈 차트", page_no: "쪽번호", L1: "라벨이 본문보다 작음", L2: "라벨이 제목에 비해 작음", L3: "작은 라벨", L4: "작은 글자", L5: "작고 흐린 글자", L6: "한글 대문자·넓은 자간", L7: "아래가 빈 작은 글자", L8: "제목을 되풀이하는 라벨", overflow: "화면 밖 글자", "data-slot": "칸", tokens: "토큰", glyph: "글꼴", external: "외부 주소", size: "크기", missing: "사진 파일 없음", section: "장 구조", photos: "사진 장 수" };
function errorsLine(errs) {
    const xs = errs.slice(0, 3).map(e => `${RULE_KO[e.rule] ?? e.rule}(${PAGE_RE.test(e.page) ? pageLabel(e.page) : e.page}${e.slot ? ` ${e.slot}` : ""})`);
    return `${xs.join(" · ")}${errs.length > 3 ? ` 외 ${errs.length - 3}` : ""}`;
}
// 시간 분해(#51) — 받기 · 준비(시작→첫 파일 쓰기) · 편집(첫 쓰기→답) · 사진 · 검사 · 저장, 초
function timingOf(s) {
    const t = s.tm ?? {}, sec = (ms) => (ms && ms > 0 ? Math.round(ms / 1000) : 0);
    const fw = t.first_write ?? t.agent_done;
    return { recv: sec(t.received && t.start ? t.start - t.received : 0), prep: sec(fw && t.start ? fw - t.start : 0), edit: sec(t.agent_done && t.first_write ? t.agent_done - t.first_write : 0),
        photo: sec(t.photo_ms), verify: sec(t.verify_ms), save: sec(t.save_ms), ...(s.tool === "claude" ? { tool: sec(s.toolMs) } : {}) }; // tool = 도구 실제 실행 합(#54 보정 1)
}
// 글자만 바뀌었나 — 마지막 커밋과 태그 골격이 같고 글자 노드만 다르면
async function textOnlyChange(id, pages) {
    const head = await T().core.invoke("repo_head", { id }).catch(() => null);
    if (!head)
        return false;
    const skel = (h) => h.replace(/>[^<]*</g, "><");
    for (const f of pages) {
        const a = await T().core.invoke("repo_show", { id, sha: head, file: f }).catch(() => null), b = await wget(id, f);
        if (a === null || b === null || skel(a) !== skel(b))
            return false;
    }
    return true;
}
// 사진 칸 합계(#37) — 결과 페이지 전부의 사진 칸: 채워진 칸의 출처(TRACE children의 그 칸 마지막 기록) · 빈 칸 수. 캔버스 배지와 같은 칸 규칙
// 사진 칸 = <figure data-slot> · data-kind="photo" · 예전 이름 접두사(#42 — closing_bg 같은 새 이름도 사진)
const PHOTO_SLOT = /<(\w+)\b([^>]*\bdata-slot\s*=\s*["']([\w-]+)["'][^>]*)>([\s\S]*?)<\/\1>/gi;
const PH_NAME = /^(cover_full|cover_image|body_image|closing_full|series_\d|texture|photo|hero|image)/;
const isPhotoSlot = (tag, attrs, slot) => !isQrSlot(attrs, slot) && (tag.toLowerCase() === "figure" || /\bdata-kind\s*=\s*["']photo["']/i.test(attrs) || PH_NAME.test(slot)); // QR 칸은 사진 칸이 아니다(2026-10-22)
async function photoTally(id, trace) {
    const pages = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(n => /^result-[a-z0-9-]+\.html$/.test(n));
    const t = { n: 0, stock: 0, agy: 0, codex: 0, mine: 0, empty: 0, open: 0 }; // open = 공개 라이선스 찾기(#151 보정 1 ④ 비율)
    for (const f of pages) {
        const h = await wget(id, f);
        if (!h)
            continue;
        for (const m of h.matchAll(PHOTO_SLOT)) {
            if (!isPhotoSlot(m[1], m[2], m[3]))
                continue;
            if (!/<img\b/i.test(m[4])) {
                t.empty++;
                continue;
            }
            t.n++;
            const src = m[4].match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] ?? "";
            const rt = [...(trace.children ?? [])].reverse().find(c => c.slot === m[3] && (!c.page || c.page === f))?.runtime ?? (src.startsWith("context/") ? "mine" : ""); // 장표+슬롯(#42)
            if (rt === "stock")
                t.stock++;
            else if (rt === "open")
                t.open++;
            else if (rt === "agy")
                t.agy++;
            else if (rt === "codex" || rt === "generated")
                t.codex++;
            else if (rt === "mine" || src.startsWith("context/"))
                t.mine++;
            else
                t.stock++;
        }
    }
    return t.n || t.empty ? t : null;
}
const PAGE_LABEL = { cover: "표지", body: "본문", data: "데이터", closing: "마무리" };
const pageLabel = (f) => { const k = f.replace(/^result-|\.html$/g, ""); return PAGE_LABEL[k] ?? k; };
// 실패 턴 되돌리기(#30) — 바뀐 게 있을 때만. 결과·재료만 턴 시작 커밋으로(참고 파일·인증은 그대로)
async function discardTurn(id, s) {
    if (!S.git)
        return;
    const changed = await T().core.invoke("repo_changed", { id }).catch(() => []);
    if (!changed.some(f => /^result-[a-z0-9-]+\.html$/.test(f) || f.startsWith("materials/") || f === "tokens.css"))
        return;
    await T().core.invoke("repo_discard", { id }).catch(() => { });
    s.out.push({ role: "event", text: "원래대로 돌렸어요", payload: { kind: "stage", ai: "dynapse" } });
}
export async function mergeTurn(id, s) {
    await ensurePack(id).catch(() => { });
    await folderSync(id).catch(() => { });
    const t = await readJson(id, ".dynapse/turn.json");
    if (!t || !Object.keys(t).length)
        return;
    // 개요 턴이 적은 묶음 일(#140 §1) — 이 턴이 끝나면 묶음별 큐로
    {
        const qq = t.queue;
        if (Array.isArray(qq) && qq.length)
            pendingQueue.set(id, qq.filter(x => x && typeof x === "object").map(x => x).slice(0, 40));
    }
    // 뺀 장 다시 넣기(#139 §3) — AI가 이름으로 고른 장(turn.json "relink")을 이 턴 커밋에 함께
    for (const f of (Array.isArray(t.relink) ? t.relink : []).filter((x) => typeof x === "string" && PAGE_RE.test(x)).slice(0, 20))
        await relinkPage(id, f, { commit: false }).catch(() => false);
    const tr = (await readJson(id, ".dynapse/TRACE.json")) ?? {};
    // 장표(#42) — 에이전트가 적은 page(result-*.html)가 있으면 함께. 같은 장표·같은 칸의 예전 기록만 대체
    const stock = (t.stock ?? []).filter(x => x?.slot).slice(0, 8).map(x => ({ runtime: "stock", asset_id: x.asset_id, title: x.title?.slice(0, 60), slot: x.slot, file: x.file, ...(x.page && PAGE_RE.test(x.page) ? { page: x.page } : {}) }));
    const next = { ...tr,
        ...(t.title && !tr.title ? { title: t.title.slice(0, 30) } : {}), ...(t.kind && !tr.kind ? { kind: t.kind === "photo" ? "photo" : "slides" } : {}),
        children: [...(tr.children ?? []).filter(c => !stock.some(x => x.slot === c.slot && (!("page" in x) || !c.page || c.page === x.page))), ...stock],
        ...(t.empty_slots ? { empty_slots: t.empty_slots.slice(0, 12) } : {}), ...(t.capped_slots ? { capped_slots: t.capped_slots.slice(0, 12) } : {}) };
    await wput(id, ".dynapse/TRACE.json", JSON.stringify(next, null, 2));
    // 파일 태그(file_tags, 예전 이름 tags) · 작업 태그(labels — 주제·느낌·종류·덱 목표, #32 검색)
    const ft = t.file_tags ?? (t.tags && Object.keys(t.tags).some(k => /\//.test(k) || /\.html$/.test(k)) ? t.tags : null);
    if (ft && typeof ft === "object") {
        const tg = (await readJson(id, ".dynapse/tags.json")) ?? {};
        await wput(id, ".dynapse/tags.json", JSON.stringify({ ...tg, ...ft }, null, 2));
    }
    const lb = t.labels ?? (t.tags && ("subject" in t.tags || "feel" in t.tags) ? t.tags : null);
    if (lb && typeof lb === "object") {
        const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").map(x => x.slice(0, 20)).slice(0, 5) : []);
        const prev = (await readJson(id, ".dynapse/labels.json")) ?? {};
        await wput(id, ".dynapse/labels.json", JSON.stringify({ subject: arr(lb.subject).length ? arr(lb.subject) : prev.subject ?? [], feel: arr(lb.feel).length ? arr(lb.feel) : prev.feel ?? [], ...(typeof lb.kind === "string" ? { kind: lb.kind.slice(0, 12) } : prev.kind ? { kind: prev.kind } : {}), ...(typeof lb.goal === "string" ? { goal: lb.goal.slice(0, 12) } : prev.goal ? { goal: prev.goal } : {}) }, null, 2));
    }
    if (t.changed?.length || t.next) {
        const n = (tr.rounds?.at(-1)?.n ?? 0) + 1;
        const notes = (await wget(id, ".dynapse/NOTES.md")) ?? "";
        const add = [`## R${n} · ${rtOf(s.tool)}`, ...(s.turnText ? [`- 요청: ${s.turnText.split("\n")[0].slice(0, 120)}`] : []), ...(t.changed ?? []).slice(0, 3).map(c => `- 바꾼 것: ${String(c).slice(0, 140)}`), ...(t.next ? [`- 다음에 볼 것: ${t.next.slice(0, 140)}`] : [])].join("\n");
        await wput(id, ".dynapse/NOTES.md", `${notes.trimEnd()}\n\n${add}\n`.trimStart());
    }
    // 원고 그대로(카피 그대로 모드) — AI가 바꾼 문장을 숨기지 않고 카드로
    const cc = Array.isArray(t.copy_changes) ? (t.copy_changes).slice(0, 12) : [];
    if (cc.length)
        await postChat(id, [{ role: "event", text: `원고 문장 ${cc.length}곳을 바꿨어요 · ${cc.slice(0, 2).map(c => `“${String(c.before ?? "").slice(0, 20)}” → “${String(c.after ?? "").slice(0, 20)}”`).join(" · ")}`, payload: { kind: "copy_changes", ai: "dynapse", items: cc.map(c => ({ page: String(c.page ?? "").slice(0, 60), slot: String(c.slot ?? "").slice(0, 40), before: String(c.before ?? "").slice(0, 200), after: String(c.after ?? "").slice(0, 200), why: String(c.why ?? "").slice(0, 120) })) } }]).catch(() => { });
    // 폴더 사진을 썼다(2026-10-08) — 폴더 자료의 "쓰인 작업"에 남긴다
    const fu = t.folder_used;
    if (Array.isArray(fu) && fu.length) {
        const fi = await readJson(id, ".dynapse/folder-images.json").catch(() => null);
        const fdir = fi?.folder ? await T().core.invoke("work_dir", { id: fi.folder }).catch(() => null) : null;
        if (fi?.folder && fdir) {
            const rel = fu.filter((x) => typeof x === "string").map(x => x.replace(/\\/g, "/")).filter(x => x.startsWith(fdir.replace(/\\/g, "/"))).map(x => x.slice(fdir.replace(/\\/g, "/").length).replace(/^\//, ""));
            if (rel.length)
                await markUsed(fi.folder, rel, id).catch(() => { });
        }
    }
    await wput(id, ".dynapse/turn.json", "{}\n");
}
// ■ 중단(#50) — 그 작업의 AI 프로세스를 트리 종료(run_kill = 프로세스 그룹 · Windows taskkill /T), 사진 러너는 지금 장까지만.
// 디스크에 남은 변경은 그대로(커밋 안 함) — 직접 수정 묶음 칩 자리에 "중단 · 고친 파일 N개"([저장]·[되돌리기]). 다음 메시지는 같은 세션(--resume)으로 이어진다
export const stopPhotos = new Set();
// [중단](#311 — 대표 10-27: 누르자마자 다음 턴이 저절로 시작했다): 누른 시각을 기억하고, 사용자가 새로 말하기 전까지 자동으로 이어지는 일(묶음 큐·다음 리워드 장·미룬 요청·작업량 이어서·다듬기·턴 끝 받기)을 하나도 시작하지 않는다.
// 준비 중이던 턴도 chatSend에서 멈춘다. 기록은 이 PC에만(.dynapse/out — 올리지 않음)
const stoppedAt = new Map();
const carryReply = new Map();
const FILL_YES = "채우기", FILL_NO = "그대로 두기", FILL_FILE = ".dynapse/underfill-offer.json"; // 아래가 빈 장 결정 칸(#314 ③)   // 자동 승인으로 이어 가는 턴에 넘길 첫 답(사용자 말이 오면 지움)
export const userStopped = (id) => { const t = stoppedAt.get(id); return t !== undefined && (receivedAt.get(id) ?? 0) <= t; };
export async function stopWork(id) {
    stoppedAt.set(id, Date.now());
    autoCont.delete(id);
    void wput(id, ".dynapse/out/stop.json", JSON.stringify({ at: Date.now() })).catch(() => { });
    stopPhotos.add(id);
    let any = false;
    for (const [k, s] of sessions) {
        if (!k.startsWith(`${id}|`) || !s.busy)
            continue;
        any = true;
        s.stopped = true;
        s.queue.length = 0;
        if (s.reqQueue)
            s.reqQueue.length = 0;
        if (s.post)
            continue; // 답 뒤 사진 단계(#54 A1) — AI는 이미 쉬는 중, 사진 러너만 멈춘다(세션 유지)
        const pid = s.procId;
        s.procId = undefined;
        if (pid !== undefined)
            await T().core.invoke("run_kill", { id: pid }).catch(() => { });
        setTimeout(() => { if (s.busy && s.stopped && !s.post)
            void stoppedTurn(id, s); }, 3000); // 종료 소식이 안 와도 3초 뒤 끝낸다
    }
    if (!any) {
        setTimeout(() => stopPhotos.delete(id), 90_000);
        await postChat(id, [{ role: "event", text: "중단됨", payload: { kind: "stopped", ai: "dynapse" } }]).catch(() => { });
    }
}
async function stoppedTurn(id, s) {
    if (!s.busy)
        return;
    s.stopped = false;
    presence(id, "view");
    turnPage.delete(id); // ■ 중단도 턴 끝(#128 보정 1)
    const changed = S.git ? await T().core.invoke("repo_changed", { id }).catch(() => []) : [];
    const files = changed.filter(f => /^result-[a-z0-9-]+\.html$/.test(f) || f.startsWith("materials/") || f === "tokens.css");
    const ms = Date.now() - (s.turnAt ?? Date.now());
    if (s.mx) {
        s.mx.stopped = true;
        s.mx.stop_at = Math.round(ms / 1000);
        s.mx.files = files.length;
    }
    s.out.push({ role: "event", text: `중단됨 · ${mmss(ms)}${files.length ? ` · 고친 파일 ${files.length}개` : ""}`, payload: { kind: "stopped", ai: s.ai } });
    if (files.length)
        await addPending(id, { t: "stopped", files, label: `중단 · 고친 파일 ${files.length}개` }).catch(() => { });
    stopPhotos.delete(id);
    return finishTurn(id, s);
}
// 원문 없는 언어판(#310 보정 1 — 대표 BizCrush: result-04-problem.ko.html만 남아 ko PDF에 "주최자의 과제"가 끼었다): .dynapse/orphan-<파일>로 옮기고 한 줄(네이티브는 .dynapse 아래 폴더를 하나만 허용).
// 턴 끝·받기 뒤에 돈다 — 대표가 아무것도 안 해도 다음 받기에서 정리된다. 옮긴 수를 돌려준다(커밋은 부른 쪽이)
export async function cleanOrphanLangs(id) {
    const names = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name);
    // 원문이 하나도 없는 작업(원문을 지우고 언어판만 쓰는 작업)은 치우지 않는다(#310 보정 1 "무엇이 깨질 수 있나" ①)
    if (!names.some(n => PAGE_RE.test(n) && !LANG_PAGE.test(n)))
        return 0;
    const orphans = names.filter(n => { const m = n.match(LANG_PAGE); return !!m && !names.includes(`result-${m[1]}.html`); }).slice(0, 40);
    let n = 0;
    for (const f of orphans) {
        const h = await wget(id, f).catch(() => null);
        if (h === null)
            continue;
        await wput(id, `.dynapse/orphan-${f}`, h).catch(() => { });
        if (await T().core.invoke("page_delete", { id, path: f }).then(() => true).catch(() => false))
            n++;
    }
    if (n) {
        report("sync", "lang.orphans", String(n));
        await postChat(id, [{ role: "event", text: `원문 장이 없는 언어판 ${n}개를 내보내기에서 뺐어요`, payload: { kind: "stage", ai: "dynapse", detail: orphans.map(pageLabel).slice(0, 6).join(" · ") } }]).catch(() => { });
    }
    return n;
}
export async function finishTurn(id, s) {
    void flushReports();
    void cleanOrphanLangs(id).then(n => (n ? repoCommit(id, `원문 없는 언어판 정리 · ${n}개`) : null)).catch(() => null);
    const halted = userStopped(id); // [중단] 뒤(#311) — 아래 자동 이어짐을 모두 건너뛴다
    if (halted) {
        s.queue.length = 0;
        s.afterIdle = [];
        s.copyHits = [];
    }
    // 묶음 큐(#140 §2) — 이 턴이 큐 항목이면 결과를 적고 다음 묶음을(턴 정리가 끝난 뒤) · 중단 뒤엔 멈춘 채로 한 줄
    {
        const pq = pendingQueue.get(id);
        if (pq && halted) {
            await postChat(id, [{ role: "event", text: "묶음 만들기를 멈췄어요 · 다시 말하면 이어서 해요", payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
        }
        else if (pq) {
            pendingQueue.delete(id);
            const ask = s.requestText ?? "";
            setTimeout(() => void startQueue(id, ask, s.route, pq).catch(() => false), 2500);
        }
    }
    if (s.queueItem !== undefined && halted)
        s.queueItem = undefined;
    if (s.queueItem !== undefined) {
        const qi = s.queueItem, t0 = s.turnAt ?? Date.now(), failed = !!s.mx?.failed;
        s.queueItem = undefined;
        setTimeout(() => void queueAfter(id, qi, !failed, s.usage?.tokens ?? 0, Date.now() - t0).catch(() => { }), 2500);
    }
    clearTimeout(s.budgetT);
    s.budgetT = undefined;
    clearTimeout(s.prepT);
    clearTimeout(s.prep2T);
    if (s.formAlt) { // 다른 모양 보기 결과 카드(#119 보정 3 §5)
        const fa = s.formAlt;
        s.formAlt = undefined;
        const b = ((await readJson(id, ".dynapse/plan.json").catch(() => null))?.pages ?? []).find(p => p.page === fa.file)?.form ?? null;
        if (fa.prev)
            await postChat(id, [{ role: "event", text: `${pageLabel(fa.file)} · ${fa.a ?? "이전 모양"} → ${b ?? "새 모양"}`, payload: { kind: "form-alt", ai: "dynapse", file: fa.file, a: fa.a, b, prev: fa.prev } }]).catch(() => { });
    }
    // 2안 분류표의 고름(verify가 .dynapse/choices.json에 남김) — 이번 턴 것만 서버로(form_choices, 샘플러 가중치)
    {
        const ch = (await readJson(id, ".dynapse/choices.json").catch(() => null)) ?? [];
        const mine = ch.filter(c => c.by === "checklist" && c.at && Date.parse(c.at) >= (s.turnAt ?? Date.now()) - 60_000).slice(-20);
        if (mine.length)
            void api("POST", `/api/works/${encodeURIComponent(id)}/form-choices`, { items: mine }).catch(() => { });
    } // 원격 보고(#116 §1) — 턴이 끝날 때 한 번
    const ms = Date.now() - (s.turnAt ?? Date.now());
    flushLogs(s); // 로그 한 행은 사용량 카드보다 먼저(끝 신호 뒤에 오지 않게)
    if (s.sessionId && !s.lightAuto && !s.pageThread) {
        const rt = rtOf(s.tool);
        const sj = (await readJson(id, ".dynapse/session.json")) ?? {};
        // 대화 바꾸기(#213 ② — 작업 대화가 끝없이 이어져 턴마다 캐시 읽기가 평균 1.2M): 같은 대화의 캐시 읽기 합이 20M을 넘으면 그 대화를 닫고 다음 턴은 새 대화 + 넘겨받기 한 단락
        const cr = Number(s.usage?.parts?.cache_read ?? 0), sameSes = sj[rt] === s.sessionId, total = (sameSes ? Number(sj[`${rt}_cr`] ?? 0) : 0) + cr, turnsN = (sameSes ? Number(sj[`${rt}_n`] ?? 0) : 0) + (/\[첨부:[^\]]*\.(png|jpe?g|webp|gif|heic)\b/i.test(s.turnText ?? "") ? 5 : 1); // 첨부 이미지는 대화에 남아 무겁다 — 5턴으로 센다
        if (total > SESSION_ROLL_CR || turnsN >= SESSION_TURNS || (s.ctxPeak ?? 0) > CTX_WINDOW * 0.7) {
            const { [rt]: _old, ...rest } = sj;
            void _old;
            await wput(id, ".dynapse/session.json", JSON.stringify({ ...rest, [`${rt}_cr`]: 0, [`${rt}_n`]: 0 })).catch(() => { });
            rollNote.add(id);
            report("turn", "turn.session_roll", `rt=${rt} cr=${Math.round(total / 1e6)}M n=${turnsN}`);
            if (s.procId !== undefined)
                void T().core.invoke("run_close_stdin", { id: s.procId }).catch(() => { });
            s.sessionId = undefined;
        }
        else
            await wput(id, ".dynapse/session.json", JSON.stringify({ ...sj, [rt]: s.sessionId, [`${rt}_cr`]: total, [`${rt}_n`]: turnsN })).catch(() => { });
    }
    if (s.usageAcc) {
        if (s.reviews && s.usage)
            s.look = { ...(s.look ?? { n: 0, imgs: 0, tok: 0 }), tok: (s.look?.tok ?? 0) + s.usage.tokens };
        s.usage = addUsage(s.usageAcc, s.usage ?? null);
        s.usageAcc = undefined;
    } // 후속 메시지(고침·보는 검토)까지 합친 턴 사용량
    if (s.usage?.tokens) {
        const k = s.usage.tokens >= 1000 ? `${Math.round(s.usage.tokens / 1000)}k` : String(s.usage.tokens);
        // 토큰·시간·모델만 — 금액 환산은 어디에도 보이지 않는다(#22-보정). usd는 내부 상한 계산용으로만 싣는다
        // 이어지는 대화(#25 C) — 세션마다 몇 번째 턴·며칠째인지(TRACE.sessions). 📍 턴 표시
        const tr = (await readJson(id, ".dynapse/TRACE.json").catch(() => null)) ?? {};
        const sid = s.sessionId ?? "";
        const ss = { ...(tr.sessions ?? {}) };
        if (sid) {
            ss[sid] = { n: (ss[sid]?.n ?? 0) + 1, since: ss[sid]?.since ?? Date.now() };
            await wput(id, ".dynapse/TRACE.json", JSON.stringify({ ...tr, sessions: ss }, null, 2)).catch(() => { });
        }
        const point = pointTurn.delete(id);
        // 구간(#120 §3) — 쓰기(턴 시작 → AI 첫 verify) · 고치기(첫 → 마지막 verify, n회) · 사진 · 검사. 리워드 턴만(verify 기록이 있을 때)
        const vr = agentRuns.get(id) ?? [];
        agentRuns.delete(id);
        const ph = vr.length && s.turnAt ? { write_ms: Math.max(0, vr[0] - s.turnAt), fix_ms: Math.max(0, vr[vr.length - 1] - vr[0]), fix_n: vr.length - 1 } : null;
        const phText = ph ? ` · 쓰기 ${mmss(ph.write_ms)} · 고치기 ${mmss(ph.fix_ms)}(${ph.fix_n}회)${s.tm?.photo_ms ? ` · 사진 ${mmss(s.tm.photo_ms)}` : ""}${s.tm?.verify_ms ? ` · 검사 ${mmss(s.tm.verify_ms)}` : ""}` : "";
        if (ph && s.mx)
            s.mx.phase = ph;
        const tierText = s.tier ? ` · ${s.tier === "heavy" ? "무거움" : s.tier === "normal" ? "보통" : "가벼움"} ${k}/${Math.round((s.tierCap ?? 0) / 1000)}k` : ""; // 등급(#123)
        if (s.mx && s.tier)
            s.mx.tier = s.tier;
        const fitN = fitCount.get(id) ?? 0;
        fitCount.delete(id);
        const rwLine = (s.rewardTask || rewardWorks.has(id)) && s.mx ? ` · 검사 ${s.mx.runs}회 · 렌더 ${s.mx.renders ?? 0}회` : ""; // 리워드 턴(#127 보정 2) — 제출 전 고침은 제출 줄에
        // 보이는 한 줄은 "21초 · Opus 5.5"(#279 ③) — 토큰·등급·단계 시간은 detail로(웹 [자세히])
        s.out.push({ role: "event", text: `${ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))}초` : mmss(ms)}${prettyModel(s.runModel) ? ` · ${prettyModel(s.runModel)}` : ""}`, payload: { kind: "usage", detail: `${k} 토큰 · ${mmss(ms)}${tierText}${phText}${fitN ? ` · 줄·맞춤 ${fitN}곳` : ""}${rwLine}`, ai: s.ai, tier: s.tier ?? null, timing: { ...timingOf(s), ...(ph ? { write: Math.round(ph.write_ms / 1000), fix: Math.round(ph.fix_ms / 1000), fix_n: ph.fix_n } : {}) }, tools: Object.entries(s.tools ?? {}).sort((a, b) => b[1].ms - a[1].ms).slice(0, 3).map(([n, x]) => ({ n, c: x.n, s: Math.round(x.ms / 1000) })), tokens: s.usage.tokens, cached: s.usage.cached ?? null, usd: s.usage.usd ?? null, parts: s.usage.parts ?? null,
                ...(s.quota0 !== undefined && s.quota1 !== undefined ? { quota_used: Math.max(0, Math.round((s.quota1 - s.quota0) * 1000) / 10), quota_now: Math.round(s.quota1 * 100) } : {}), ms, model: s.runModel ?? null, picked: s.model ?? null, effort: s.effort ?? null,
                ...(sid ? { session_id: sid, session_turn: ss[sid].n, session_since: ss[sid].since } : {}), ...(point ? { point: true } : {}), ...(s.look ? { look: s.look } : {}) } });
    }
    if (s.mx) {
        const x = s.mx, u = s.usage?.parts, ps = photoStats.get(id);
        photoStats.delete(id);
        s.mx = undefined;
        const tools = Object.entries(s.tools ?? {});
        // 턴 결과(2026-10-11) — ok(저장 여부)만으로는 질문 카드·상한·승인 대기가 실패처럼 보였다
        const outcome = x.committed ? "saved" : x.failed ? "failed" : x.stopped ? "stopped" : x.wait ? "waiting" : s.asked ? "asked" : "none";
        if ((u?.input ?? 0) > 100_000)
            report("turn", "turn.big", `kind=${x.kind} tier=${s.tier ?? "-"} in=${Math.round((u?.input ?? 0) / 1000)}k cr=${Math.round((u?.cache_read ?? 0) / 1e6)}M`); // 큰 턴(#213 ①) — 주간 표·되돌아보기
        void sendMetric(id, { tid: x.tid, kind: x.kind, round: x.round ?? null, ok: !!x.committed, failed: !!x.failed, stopped: !!x.stopped, stop_at: x.stop_at ?? null, outcome,
            ai: s.ai, model: s.runModel ?? s.model ?? null, picked: s.model ?? null, chosen: !!s.route?.models?.[s.ai]?.model, effort: s.effort ?? null, // 고른 모델·돈 모델(#306 — 보이는 것·실행·기록이 같은지 turn_metrics로)
            tok: s.usage ? { total: s.usage.tokens, in: u?.input ?? null, out: u?.output ?? null, cw: u?.cache_write ?? null, cr: u?.cache_read ?? s.usage.cached ?? null } : null,
            t: { ...timingOf(s), total: Math.round(ms / 1000) },
            ...(s.slotsInfo ? { slots: s.slotsInfo } : {}), // 칸 글 턴(#275 보정 3 ⓐ) — 덱·한 장 · 첫 장·전체 ms · 줄 수(턴 수치 표에서 따로 본다)
            tools: { n: tools.reduce((a, [, v]) => a + v.n, 0), top: tools.sort((a, b) => b[1].ms - a[1].ms).slice(0, 3).map(([n, v]) => ({ n, c: v.n, s: Math.round(v.ms / 1000) })), skill: x.skill },
            verify: { runs: x.runs, rules: x.rules, fixups: s.fixups, ...(x.flow ? { flow: x.flow } : {}) }, photo: ps ?? null,
            files: x.files ?? null, fill: x.fill ?? null, hand: x.hand ?? 0, points: x.points ?? 0, len: x.len ?? null, ph: x.ph ?? null, phase: x.phase ?? null, copy: x.copy ?? null, tier: x.tier ?? null }); // phase = 쓰기·고치기 구간(#120)
    }
    if (!s.queue.length)
        setTimeout(() => void syncPending(id), 0); // 턴 중에 온 새 판(#56 보정 3)
    if (seqReward.has(id) && !s.queue.length && !userStopped(id))
        setTimeout(() => void seqNext(id).catch(e => report("turn", "turn.seq_err", String(e).slice(0, 80))), 0); // 리워드 다음 장(#214 보정 1)
    {
        const ps = pendingSubmit.get(id);
        if (ps && !s.queue.length && !halted) {
            pendingSubmit.delete(id);
            setTimeout(() => { active++; void submitReward(id, ps.taskId, ps.replaces).finally(() => { active--; }); }, 0);
        }
    } // 계획 고친 뒤 다시 제출(#127 §2)
    if (s.afterIdle?.length && !s.queue.length && !userStopped(id)) {
        const w = s.afterIdle;
        s.afterIdle = [];
        setTimeout(() => { for (const x of w)
            void chatSend(id, x.text, x.opts); }, 0);
    }
    s.busy = false;
    s.pointMissed = false;
    s.fixups = 0;
    s.preFix = undefined;
    s.slotsBuilt = false;
    s.slotFixed = false;
    s.slotsInfo = undefined;
    s.lastAt = Date.now();
    s.reviews = 0;
    s.firstReply = undefined;
    s.reviewNotes = [];
    s.usageAcc = undefined;
    s.look = undefined;
    if (s.turnText)
        void remember(s.turnText.split("\n")[0].slice(0, 28), id).catch(() => { }); // 상태 창 "최근" — 누르면 그 작업실
    await flushChat(id, s);
    if (!s.queue.length)
        await postChat(id, [{ role: "event", text: null, payload: { kind: "turn-end", ai: "dynapse" } }]).catch(() => { });
    if (!s.queue.length && !halted)
        void pullOnce().catch(() => { }); // 턴 중에 웹이 보낸(앱이 아직 못 받은) 메시지를 이어서(#165 ① — 턴 끝 한 번)
    if (!s.queue.length) {
        presence(id, "view");
        turnPage.delete(id);
    }
    if (!s.queue.length && (!sharedWorks.has(id) || await isOriginDevice(id).catch(() => false)))
        void shrinkBig(id).catch(() => 0); // 4MB 넘는 사진은 올리기 전에 앱이 먼저 줄인다(#128 · 저장 때도 — afterSave)   // 턴 끝 표시(#128) — 웹의 진행 단어("검사 중 · N분째")를 지운다. 채팅엔 안 보인다
    render();
    // 카피 다듬기(#122 §3) — 개인 작업 턴이 AI 말투(copy_ai)를 남기면 그 칸만 고치는 가벼운 턴 한 번(글만 · 레이아웃 그대로). 요청마다 한 번, 리워드는 #120 횟수 안에서 AI가 고친다
    if (!s.queue.length && !halted && s.copyHits?.length && !s.copyPolished && !s.rewardTask && !rewardWorks.has(id) && !s.stopped && s.tier === "heavy") { // 다듬기 패스는 무거운 턴만(#123) — 보통은 같은 턴에서 고치게 지시
        s.copyPolished = true;
        const lines = s.copyHits.map(w => `- ${w.page}: ${w.msg}`).join("\n");
        s.copyHits = [];
        s.out.push({ role: "event", text: "문장을 사람 말로 다듬어요(글만)", payload: { kind: "stage", ai: "dynapse" } });
        flushSoon(id, s);
        s.queue.push(`[copy-polish] Copy polish, text only. verify flagged these sentences as AI-sounding. Rewrite only these slots the way the person who runs this place would say it — short sentences, concrete nouns and numbers, one honorific, no mid-sentence dash, no label-colon, no three-item lists. Do not change layout, CSS, photos or other slots. Reply in one Korean line.\n${lines}`);
    }
    if (s.queue.length)
        await nextTurn(id, s);
}
// 이벤트 배치 — 2초에 한 번 이하로 서버에
export const flushTimers = new Map();
export function flushSoon(id, s) {
    if (flushTimers.has(id))
        return;
    flushTimers.set(id, window.setTimeout(() => { flushTimers.delete(id); void flushChat(id, s); }, 2000));
}
export async function flushChat(id, s) {
    if (!s.out.length)
        return;
    const batch = s.out.splice(0, 50);
    // 병렬 장 턴(#191) — 같은 작업에 도는 턴이 둘 이상이면 이 턴의 줄에 장 이름(웹이 "3장 고치는 중 · 5장 고치는 중"으로 나란히)
    if (s.turnPage && [...sessions.entries()].filter(([k, x]) => k.startsWith(`${id}|`) && x.busy).length >= 2)
        for (const o of batch)
            if (o.role === "event" && o.payload)
                o.payload.lane = s.turnPage;
    await postChat(id, batch);
    if (s.out.length)
        flushSoon(id, s);
}
// 같은 진행 줄 반복 합치기(C5 S1 2회차 — "02을 ×1.05 키웠어요"가 두 번씩): 같은 작업에 같은 글의 진행 줄이 60초 안에 또 오면 보내지 않는다
const lastStageOf = new Map();
export async function postChat(id, messages0) {
    const messages = messages0.filter(m => {
        const k = m.payload?.kind;
        if (m.role !== "event" || k !== "stage" || !m.text)
            return true;
        const l = lastStageOf.get(id), dup = !!l && l.text === m.text && Date.now() - l.at < 60_000;
        lastStageOf.set(id, { text: m.text, at: Date.now() });
        return !dup;
    });
    if (!messages.length)
        return;
    globalThis.__dynChatTap?.(id, messages); // 자가 점검 여정(#174 ①)이 실패 이유로 앱의 마지막 줄을 적는다 — 평소엔 없음
    // 끊긴 동안(#146 §2) — 못 보낸 줄은 보낼 칸에 두었다가 연결되면 차례로(대화가 빈칸 없이 이어지게)
    if (netState() !== "online") {
        queueChat(id, messages);
        return;
    }
    await api("POST", `/api/works/${encodeURIComponent(id)}/messages`, { messages }).catch(() => { if (netState() !== "online")
        queueChat(id, messages); });
}
// 진행 중에 쌓이는 이벤트는 주기적으로 내보낸다
setInterval(() => { for (const [key, s] of sessions)
    if (s.out.length)
        flushSoon(key.split("|")[0], s); }, CHAT_FLUSH_MS);
// 한도(#18 기본값) — 턴당 도구 호출 40 · 앱 검증 재시도 1(에이전트 자체는 3회) · 작업당 토큰 상한은 웹이 계산해 cap_left로 보낸다
export const LIMITS = { maxTurns: 40 };
export const TURN_CAP = 400_000;
// 막힌 Bash 명령 → 허용 규칙(프로그램 단위). "SRC=… && mkdir … && cp …"처럼 대입·cd·연결이 있어도 실제 프로그램마다 Bash(⟨프로그램⟩ *)
// 여러 줄·heredoc 명령은 첫 줄만(#127 보정 3 — "distance"는 heredoc 본문 낱말이었다), heredoc 표시(<<EOF) 뒤는 보지 않는다
const firstLine = (cmd) => cmd.split("\n")[0].replace(/<<-?\s*['"]?\w+['"]?.*$/, "");
// 거부 목록(DENY)의 Bash 규칙에 걸리는가 — "Bash(python3 -c *)" = 첫 줄이 "python3 -c"로 시작
export function deniedByList(cmd) {
    const c = firstLine(cmd).trim();
    return DENY.some(r => { const m = r.match(/^Bash\((.+?)( \*)?\)$/); if (!m)
        return false; const p = m[1].replace(/\*$/, ""); return m[2] ? c === p || c.startsWith(p + " ") : c === p || (m[1].endsWith("*") && c.startsWith(p)); });
}
export function bashRules(cmd) {
    const progs = firstLine(cmd).replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""').split(/&&|\|\||;|\|/).map(seg => seg.trim().split(/\s+/).filter(t => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t))[0] ?? "").map(p => p.replace(/^["'(]+|["')]+$/g, ""))
        .filter(p => p && p !== "cd" && /^[\w./-]{1,40}$/.test(p));
    return [...new Set(progs)].map(p => `Bash(${p} *)`);
}
// 자동으로 허용하지 않는 명령 — 카드로 묻는다
export // 막힌 명령·도구가 가리킨 작업 밖 폴더 — 절대 경로·~ 경로에서 폴더만. 집 폴더 안, 숨김·민감 폴더(.ssh·.aws·Keychains 등)와 시스템은 제외
 let homeDir = ""; // 작업 폴더(⟨집⟩/Dynapse/works/…)에서 — 세션을 띄울 때 정한다
const HOME_DIR = () => homeDir;
function okDir(p) {
    if (typeof p !== "string" || p.length > 300)
        return false;
    const h = HOME_DIR();
    if (!h || !p.startsWith(h + "/") && !p.startsWith(h + "\\"))
        return false;
    return !/[\\/]\.(ssh|aws|gnupg|config|kube|docker|npm|codex|claude)([\\/]|$)|[\\/]Library[\\/](Keychains|Cookies|Application Support[\\/]Google)|[\\/]Dynapse[\\/]/i.test(p);
}
function deniedPaths(x) {
    const h = HOME_DIR();
    if (!h)
        return [];
    const raw = [];
    const inp = x.tool_input ?? {};
    for (const k of ["file_path", "path", "notebook_path"])
        if (typeof inp[k] === "string")
            raw.push(inp[k]);
    if (typeof inp.command === "string")
        for (const m of inp.command.matchAll(/(?:^|[\s'"=])((?:~|\/)[^\s'";|&<>]+)/g))
            raw.push(m[1]);
    return raw.map(p => p.replace(/^~(?=\/|$)/, h)).map(p => (/\.[A-Za-z0-9]{1,6}$/.test(p.split("/").pop() ?? "") ? p.replace(/[\\/][^\\/]+$/, "") : p).replace(/[\\/]+$/, "")).filter(okDir);
}
const RISKY = /^Bash\((rm|sudo|chmod|chown|dd|mkfs|kill|pkill|killall|launchctl|osascript|security|ssh|scp|rsync|diskutil|shutdown|reboot|del|erase|rd|rmdir|reg|rundll32|powershell|pwsh|cmd|taskkill|sc|net|wmic|Remove-Item|Set-ExecutionPolicy) /; // 한 턴 토큰 상한(#27 B)
// 거부 목록(#27 A) — 자동 승인이어도 막는다: 파괴·원격 실행·자격증명 경로
// 땜질 금지(#120 §2) — 규칙 하나씩 고치는 node -/node -e 패치 스크립트, 번들·PNG(.dynapse/out — 장당 20만 자) 읽기
// 장을 읽고 판단해야 하는 요청("확인해서 고쳐 줘")은 가벼운 턴이 아니다(#123 보정 1) — 가벼움은 📍 칸·글자·폰트 바꾸기만
const NEEDS_LOOK = /확인|점검|살펴|봐\s*줘|봐\s*주|검토|왜\s|이상해|이상하|깨져|깨졌|틀렸|틀린|문제|맞는지|어색|check|look|review|why|broken|wrong/i;
// 여러 장 요청(C5 S1 2회차 — "표지부터 채워넣어"가 작업량 한도에 걸렸다): "부터·전부·남은·다 …" 또는 장 2개 이상이면 가벼운 턴이 아니다
export function multiPageAsk(t) {
    // 장마다·매 장 · 주인공·캐릭터·마스코트(덱 전체에 반복 — hero.json)도(C3 10회차 S3 라이브 10-27: "장마다 반복할 주인공: …"이 가벼운 Sonnet 턴으로 가 "어떤 페이지?"로 끝났다)
    if (/부터|전부|모두|모든\s*장|장마다|매\s*장|주인공|캐릭터|마스코트|남은|나머지|(?:^|\s)다\s*(?:고쳐|채워|바꿔|넣어|지워|해|맞춰|만들어|다듬어)/.test(t) || /\d+\s*[~\-–]\s*\d+\s*(?:번|장|페이지|쪽)/.test(t))
        return true;
    return new Set([...t.matchAll(/(\d{1,2})\s*(?:번째\s*)?(?:장|페이지|슬라이드)|(표지)|(마지막\s*장)/g)].map(m => m[1] ?? m[2] ?? "last")).size >= 2;
}
// 턴 등급(#123) — 무거움: 리워드·작업의 첫 턴·덱 범위·거절 뒤 다시·"전체 다시" / 가벼움: 카피 다듬기·📍 한 칸·순서만·글꼴·직접 수정 뒤 정리(확인 말 없이) / 그 밖 보통. turn-sim이 같은 함수를 쓴다
export function turnTier(o) {
    if (o.plan && !o.reward)
        return "light"; // 큰 덱 개요 턴(#140 §3) — 첫 턴이어도 개요만(장은 [만들기 시작] 뒤 묶음 턴)
    if (o.reward || /\((?:slide|deck) reward, task_id=/i.test(o.rq) || o.first || o.scope === "deck" || o.refusalRetry || /전체\s*(를\s*)?다시|처음부터|덱\s*(을|를)?\s*다시/.test(o.rq) || (REVIEW_ASK.test(o.rq) && EDIT_ASK.test(o.rq)))
        return "heavy"; // 고치기 + 검토(#229 보정 2)는 무거운 고치는 턴
    if (multiPageAsk(o.rq) && !isReorderAsk(o.rq))
        return "normal"; // 순서만 옮기기는 가벼운 순서 턴 그대로
    return /^\[copy-polish\]/.test(o.rq) || ((o.light || o.scope === "slot") && !NEEDS_LOOK.test(o.rq)) ? "light" : "normal";
}
const lastPin = new Map(), whichRetried = new Set();
// 묻고 멈춤·미룸(#229) — 확인 요청·물음표로 끝남 / 대기열·나중에·다음 턴으로 미룸
export const ASK_GO = /(\?|？)\s*$|확인해\s*주시면|진행할까요|진행해도\s*될까요|뜻이신가요|원하시면\s*(바로\s*)?(진행|만들)|하시겠어요/;
export const DEFER_RE = /대기열|나중에\s*(만들|작업|처리)|다음\s*턴에|새\s*큐|\bqueue\b|\bpending\b|대기\s*중인\s*(작업|요청)|후속\s*작업에서|보류해\s*(두|뒀)/i;
const reaskRetried = new Set(); // C5 ① 재질문 막기 — 작업당 10분에 한 번
// 엔진 방식(#312 보정 1·2 — 대표 10-27: 같은 지시를 Aside(AI가 HTML 직접)가 더 깔끔하게): 사용자 작업은 첫 턴부터 raw — 슬롯 조립·차트 다시 그리기·자동 키움·줄 맞춤·색 지킴·장식 찍기 없이 AI가 장 HTML을 직접 쓰고, 검사 결과는 같은 턴의 AI가 고친다(2번까지).
// .dynapse/engine.json {first, edit: "raw"|"engine", now} — 오늘 밤 raw 레인 벤치가 엔진 우세인 조각을 다시 켠다. 리워드(재고)는 엔진
export async function engineMode(id) {
    if (rewardWorks.has(id) || seqReward.has(id))
        return { first: "engine", edit: "engine" };
    const e = await readJson(id, ".dynapse/engine.json").catch(() => null);
    return { first: e?.first === "engine" ? "engine" : "raw", edit: e?.edit === "engine" ? "engine" : "raw" };
}
// 앱 동작을 묻는 말(#310 ①) — 내보냈·어디 저장·안 나왔·안 내보내져
export const APP_ASK = /내보냈|내보낸\s*(?:거|게|적|파일)|내보내졌|안\s*내보내|어디(?:에|로)?\s*(?:내보냈|저장(?:했|됐)|갔|있)|(?:pdf|pptx|png|파일)[^?？]{0,12}(?:어디|안\s*(?:나왔|보여|생겼))/i;
const askLoop = new Map(), keepTier = new Map();
const autoCont = new Map(); // 작업량 한도 자동 이어서 횟수(사용자 말이 오면 0 · tierStop)
// 짧은 승낙(#229 ③) — "해·응·진행·만들어…"(12자 안)는 앞 턴과 같은 등급으로(가벼운 턴이 "진행하라는 뜻이신가요?"로 되묻지 않게)
export const SHORT_YES = /^(해|해줘|해 줘|응|웅|네|넹|예|ㅇㅇ|ㅇㅋ|오케이|ok|okay|yes|go|진행|진행해|진행해줘|만들어|만들어줘|그래|그래서|좋아|고고|ㄱㄱ|계속|이어서)[\s.!~요]*$|만든다는\s*거야/i;
const lastTierOf = new Map();
export const ASK_WHICH = /어느\s*(페이지|장|슬라이드|섹션|부분|요소|칸)|어떤\s*(페이지|장|섹션|부분|요소|칸)|특정해|알려\s*주시면|짚어\s*주시면|which (page|slide|section|element|part)|point (me )?to/i;
const RELINK_ASK = /다시\s*넣|되살려|살려\s*(줘|주세요)|복원|bring\s+back|restore/i;
const ORDER_ASK = /순서|묶어|묶음|부록으로|따로\s*(빼|모아)|재조정|재배치|재구성|배치를?\s*(바꿔|다시)|흐름(을)?\s*(바꿔|다시|맞게)|정렬|앞으로|뒤로|맨\s*앞|맨\s*뒤|옮겨|옮기|이동해|다음으로|앞에\s*(넣|두|놓)|뒤에\s*(넣|두|놓)|move|reorder|swap|put .* (before|after)/i;
const PAGE_NAMED = /\d+\s*[~\-–]\s*\d+\s*(번|장|페이지|쪽)?|\d+\s*(장|번째|번|페이지|쪽|p\b)|표지|마무리|부록|데모|result-[a-z0-9-]+|\b(page|slide)\s*\d+|["“'‘][^"”'’]{2,30}["”'’]\s*(장|페이지|슬라이드)/i;
// 순서 말과 장 이름이 25자 안에 붙어 있어야 옮기기 요청("데모 두 장을 16장 뒤로") — 긴 카피 지시 속 흐름 설명("표지 다음으로 문제, 데모…")은 아니다
export function isReorderAsk(t) {
    const at = (re) => [...t.matchAll(new RegExp(re.source, "gi"))].map(m => m.index ?? 0);
    const o = at(ORDER_ASK), p = at(PAGE_NAMED);
    return o.some(a => p.some(b => Math.abs(a - b) <= 25)) && (t.length <= 400 || /순서를?\s*(바꿔|바꾸|옮)|옮겨\s*(줘|주세요)|move .* (to|before|after)|reorder/i.test(t));
}
export const REFUSAL = /(덱|장|페이지|슬라이드|워크룸)\s*(에서\s*)?['"‘“]?(덱|장|페이지)?['"’”]?\s*단위.{0,24}요청|다시\s*요청해\s*주셔야|턴으로\s*다시|can'?t do (this|that) in a (light|slot|page) turn|레이아웃\s*(의\s*)?제한|가벼운\s*턴\s*(의\s*)?범위|범위를\s*벗어나|단위\s*(작업|요청)으로\s*다시|다시\s*보내\s*주|light turn|out of (the )?scope|페이지\s*단위로\s*(다시\s*)?요청|장\s*단위로\s*(다시\s*)?요청|파일을\s*(바꾸|수정하|변경하)지\s*않았|승인으로만\s*받아들|핀(이|으로)?\s*(가리킨|지정한)\s*(칸|부분)만|page-level request|did not change any files|outside the pinned/i;
const REFUSED_PATH = /(^|[\\/])\.dynapse[\\/](out([\\/]|$)|auth-header|mcp-config)|[\\/]\.(ssh|claude|codex|gemini|aws|vercel)([\\/]|$)|[\\/]\.config[\\/]gh/;
const REWARD_BUDGET_MS = 8 * 60_000; // 리워드 턴 예산(#120 — 6장 덱 목표 5분, 실측 16분 44초)
// 파이썬 땜질도 막는다(#127 보정 2 — 리워드 턴이 python3 - 로 장을 고쳤다)
export const DENY = ["Bash(node -e *)", "Bash(node --eval *)", "Bash(node - *)", "Bash(node -)", "Bash(node -p *)", "Bash(python3 -)", "Bash(python3 - *)", "Bash(python3 -c *)", "Bash(python -c *)", "Bash(python - *)", "Read(.dynapse/out/**)", "Read(./.dynapse/out/**)", "Read(.dynapse/auth-header)", "Read(./.dynapse/auth-header)", "Read(.dynapse/mcp-config)", "Read(./.dynapse/mcp-config)", "Bash(rm -rf /*)", "Bash(rm -rf ~*)", "Bash(curl * | sh)", "Bash(curl * | bash)", "Read(~/.ssh/**)", "Read(~/.claude/**)", "Read(~/.codex/**)", "Read(~/.gemini/**)", "Read(~/.aws/**)",
    // 배포 계정 자격(#80) — gh·vercel이 자기 자리에 둔 토큰. 에이전트도 앱도 읽지 않는다
    "Read(~/.config/gh/**)", "Read(~/.vercel/**)", "Read(~/Library/Application Support/com.vercel.cli/**)", "Bash(gh auth token*)",
    // 홈 폴더 뒤지기 금지(대표: 구글드라이브·문서·오디오 권한 창) — macOS 보호 폴더 권한을 Dynapse 이름으로 묻게 된다
    "Bash(find ~*)", "Bash(find /Users*)", "Bash(find $HOME*)", "Bash(mdfind *)", "Bash(ls ~/Library/CloudStorage*)", "Bash(du ~*)",
    // Windows(#34 M8) — 드라이브 전체 뒤지기
    "Bash(find C:*)", "Bash(dir /s C:*)", "Bash(Get-ChildItem -Recurse *)"];
// 상한으로 멈춘 턴(#27 B) — 설명 대신 선택 카드: 이번 턴이 커서 멈췄어요 [이어서] [그만]. 이어서 = 같은 세션에 "이어서 해줘"
async function capStop(id, s, why = "turn") {
    if (s.mx)
        s.mx.wait = `cap_${why}`;
    const k = Math.round((s.liveTok ?? 0) / 1000);
    if (why === "turn" || !s.usage)
        s.usage = { tokens: s.liveTok ?? 0 };
    // 묻지 않는다(#138) — 회색 한 줄과 함께 이어서(한 요청에 두 번까지 · 세 번째는 멈추고 한 줄: 비용이 끝없이 늘지 않게)
    s.autoCont = (s.autoCont ?? 0) + 1;
    const what = why === "work" ? "작업당 토큰 상한" : why === "steps" ? `한 번에 할 수 있는 단계(${LIMITS.maxTurns}번)` : `이번 턴 토큰(${k}k)`;
    if (s.autoCont <= 2) {
        s.out.push({ role: "event", text: `${what}에 닿아 이어서 해요`, payload: { kind: "stage", ai: "dynapse" } });
        s.capped = false;
        await finishTurn(id, s);
        void chatSend(id, `${AI_LABEL[s.ai]}: 이어서`, { route: s.route });
        return;
    }
    s.out.push({ role: "event", text: `${what}에 닿아 여기서 멈췄어요 · 더 하려면 "이어서"라고 보내 주세요`, payload: { kind: "stage", ai: "dynapse" } });
    s.capped = false;
    return finishTurn(id, s);
}
// Claude 턴 예산 — 남은 작업 상한(토큰) × 이 작업에서 실측한 $/토큰. 실측이 없으면 넘기지 않는다(추정 금지)
export function budgetUsd(s) {
    if (s.tool !== "claude" || s.capLeft == null || !s.usdPerTok)
        return null;
    return Math.max(0.05, s.capLeft * s.usdPerTok);
}
// Claude 남은 양 — rate_limit_event를 기기 보고로(웹 AI 줄 "남음 68% · 3시간 후 리셋")
export let limitsAt = 0;
export function reportLimits() {
    if (Date.now() - limitsAt < 60_000 || !S.token)
        return;
    limitsAt = Date.now();
    void api("POST", "/api/device", deviceBody());
}
// 10분 유휴 세션은 닫는다(다음 메시지에 --resume)
export function idleSessions() {
    for (const [, s] of sessions) {
        if (!s.busy && s.procId !== undefined && Date.now() - s.lastAt > 10 * 60_000)
            T().core.invoke("run_close_stdin", { id: s.procId }).catch(() => { });
        // 세워 둔 프로세스(#54 C8)도 10분 쉬면 닫는다
        for (const x of (s.parked ?? []).filter(x => Date.now() - x.at > 10 * 60_000)) {
            void T().core.invoke("run_close_stdin", { id: x.procId }).catch(() => { });
            s.parked = (s.parked ?? []).filter(y => y !== x);
        }
    }
}
export const chatLog = [];
export const logChat = (l) => { chatLog.push(l); if (chatLog.length > 400)
    chatLog.shift(); };
// 대화(MCP put_work_revision)에서 고친 사본 → 이 기기 결과(앱 지시 메시지 pull)
export async function pullCopy(id, round) {
    const trace = await readJson(id, ".dynapse/TRACE.json");
    if (!trace)
        return;
    const dir = await T().core.invoke("work_dir", { id });
    for (const n of ["result-cover.html", "result-body.html"]) {
        const g = await http("GET", `${HUB}/api/works/${encodeURIComponent(id)}/sync?name=${n}`, { out: `${dir}/.dynapse/pull-${n}`, auth: true }).catch(() => null);
        if (g?.status === 200) {
            const html = await wget(id, `.dynapse/pull-${n}`);
            if (html)
                await wput(id, n, html);
        }
    }
    const r = { n: round, role: "write", runtime: "mcp", session_id: "", files: ["result-cover.html", "result-body.html"], req: { kind: "mcp" } };
    await saveRound(id, r, "대화(MCP)에서 수정", await appVerify(id));
    await wput(id, ".dynapse/TRACE.json", JSON.stringify({ ...trace, rounds: [...(trace.rounds ?? []), r] }, null, 2));
    if (r.shots?.length)
        await postChat(id, [{ role: "event", text: null, payload: { kind: "shot", ai: "mcp", round, pages: r.shots } }]);
}
// ───────────── 웹 단일 UI (#12-Z) — 인앱 창 · 진행 미러 · 메타 · 비공개 썸네일 · 동기화 ─────────────
// 인앱 창: 같은 창을 다시 쓴다(새 창·새 탭 없음). 인앱 창은 브라우저와 쿠키가 달라 앱 계정의 1회용 코드로 들어간다
export async function openWeb(path) {
    let p = path;
    if (S.token) {
        const r = await api("POST", "/api/device/handoff", { next: path }).catch(() => null);
        if (r?.data?.path)
            p = r.data.path;
    }
    await import("./engines.js").then(e => e.yieldMemory()).catch(() => false);
    await T().core.invoke("open_inapp", { path: p, origin: HUB }).catch(() => T().shell.open(`${HUB}${path}`)); // 이 PC가 여는 주소로(pickHub)
}
// 진행 미러 — 단계 문장·AI·시작 시각을 웹 진행 카드로(3초에 1번 이하, 끝날 때 1번)
// 저장 뒤: ① 메타(TRACE 라운드·사진 기록·NOTES·팀) ② 표지의 비공개 썸네일(서버가 찍고 html은 버린다) ③ 동기화를 켰으면 결과 html 사본
const thumbSent = new Map();
export async function afterSave(id) {
    void writeOutline(id).catch(() => null); // 개요(#140 §1) — 저장마다(바뀐 장만 다시 읽는다)
    if (!S.token)
        return;
    const [trace, notes, team, brief] = await Promise.all([readJson(id, ".dynapse/TRACE.json"), wget(id, ".dynapse/NOTES.md"), readJson(id, ".dynapse/team.json"), readJson(id, ".dynapse/brief.json")]);
    const files = await T().core.invoke("work_files", { id }).catch(() => []); // 파일 줄(#17) — 다른 기기에서도 목록
    // 데이터 위치(#20) — 서버엔 메타(기록·팀·파일 이름·크기)만. 노트·지시서는 내용이라 동기화를 켰을 때만
    // 사진 칸 이름(#20 보정 3) — 결과 html의 data-slot 이름만(내용 아님). 웹이 슬라이드 작업에 사진 칩을 칸이 있을 때만 보인다
    const slotNames = new Set();
    for (const f of files.filter(x => /^result-[a-z0-9-]+\.html$/.test(x.name))) {
        const html = await wget(id, f.name).catch(() => null);
        for (const m of (html ?? "").matchAll(/data-slot\s*=\s*["']([^"']{1,60})["']/gi))
            slotNames.add(m[1]);
    }
    const tags = await readJson(id, ".dynapse/tags.json").catch(() => null); // 파일 줄 태그(#21 보정 9) — 에이전트가 붙인 역할·특징
    const labels = await readJson(id, ".dynapse/labels.json").catch(() => null); // 작업 태그(#32 — 주제·느낌·종류·덱 목표, 검색용 메타)
    // 메타는 최근 라운드 20개만(#54 D17 — 길어지는 TRACE 전체를 매번 보냈고, 서버는 앞의 20개만 남겨 최신이 빠졌다)
    const traceSlim = trace ? { ...trace, rounds: (trace.rounds ?? []).slice(-20) } : trace;
    await api("PUT", `/api/works/${encodeURIComponent(id)}/meta`, { trace: traceSlim, team, files: files.slice(0, 300), slot_names: [...slotNames], ...(tags ? { tags } : {}), ...(labels ? { labels } : {}), local_path: await T().core.invoke("work_dir", { id }).catch(() => null), ...(S.sync ? { notes, ...(brief ? { brief } : {}) } : {}) }).catch(() => { });
    const dir = await T().core.invoke("work_dir", { id }).catch(() => null);
    if (!dir)
        return;
    // 썸네일 예외(#20 보정 2) — 작은 미리보기(표지 1장, 서버가 긴 변 640·≤120KB로 줄인다)만 기본으로. 계정에서 끄면(thumb_upload=false) 안 올린다.
    // 결과 HTML을 서버에 보내 렌더하던 길은 없앴다(내용 업로드가 되므로)
    if (S.thumbUpload) {
        const first = await firstItem(id, files);
        // 같은 썸네일이면 다시 올리지 않는다(#54 D17 — 커밋마다 올렸다): 표지 파일 크기·수정 시각이 지난번과 같으면 건너뜀
        const fm = files.find(f => f.name === first), tk = fm ? `${first}|${fm.size}|${fm.mtime}` : null;
        if (first && tk && thumbSent.get(id) === tk) { /* 그대로 */ }
        else if (first) {
            if (tk)
                thumbSent.set(id, tk);
            clearTimeout(thumbTimers.get(id));
            const sha = S.git ? await T().core.invoke("repo_head", { id }).catch(() => null) : null;
            thumbTimers.set(id, window.setTimeout(() => { thumbTimers.delete(id); void http("PUT", `${HUB}/api/works/${encodeURIComponent(id)}/preview${sha ? `?sha=${sha}` : ""}`, { file: `${dir}/${first}`, contentType: first.endsWith(".png") ? "image/png" : "image/jpeg", auth: true }).catch(() => null); }, 2000));
        }
    }
    // 서버에 사본이 있는 작업은 턴마다 HEAD를 올린다(#56 보정 2 — 동기화를 켠 작업인데 85라운드가 안 올라갔다: 복제·가져오기로 서버 사본이 생긴 작업은 sync·공유 표시가 없어 빠졌다)
    // 내 작업은 늘 양방향(#285 보정 4 — 대표: 작업별 공유 스위치·10P 없이 주인의 판은 늘 서버로. 이희원 "이름 바꿈"이 공유 꺼짐으로 안 올라가 공개본이 옛 이름이었다).
    // 남의 작업(멤버)은 서버의 멤버 규칙(member_push · 차단기)이 그대로 정한다
    if (!sharedWorks.has(id) || await isOriginDevice(id).catch(() => false))
        await shrinkBig(id).catch(() => 0); // 올리기 전에 큰 사진부터(#128 보정 3) — 함께 하는 작업은 원본 기기만
    await pushWork(id, dir);
}
const serverHas = new Map();
async function onServer(id) {
    const heads = (await store.get("remote_heads")) ?? {};
    if (heads[id])
        return true;
    // 서버 판이 있거나 공유가 열렸거나 멤버가 있으면(#56 보정 8 — 첫 올리기가 실패한 공유 작업이 그 뒤 저장마다 빠졌다)
    if (!serverHas.has(id))
        serverHas.set(id, !!(await api("GET", `/api/works/${encodeURIComponent(id)}/commits?head=1`).then(r => r.status === 200 && (!!r.data?.sha || !!r.data?.shared)).catch(() => false)));
    return serverHas.get(id);
}
// 동기화 저장 형식(#20) — 파일을 덮어쓰지 않고 커밋 단위로: {sha = 로컬 git HEAD, parent = 직전에 올린 커밋, message, files:[{path, sha256, size}]}.
// 서버가 없는 블롭(missing)을 돌려주면 그 파일만 올리고 다시. 같은 내용은 한 번만 저장된다
const pushing = new Set(); // 한 작업에 올림은 하나씩(ota17 — 두 올림이 겹치고 그 사이 받기가 끼어들었다)
export async function pushWork(id, dir) {
    if (pushing.has(id)) {
        slog(id, "push.skip", { why: "pushing" });
        return;
    }
    pushing.add(id);
    try {
        await pushWork0(id, dir);
    }
    finally {
        pushing.delete(id);
    }
}
// 4MB 넘는 사진(#128) — 서버(본문 한도 4MB)에 못 올라간다. 원본은 context/assets/originals/(올리지 않는 하위 폴더)에 두고 그 자리 파일을 줄인다
// (네이티브 shrink_photo: 긴 변 1920 · 투명 없으면 JPEG 85). 이름이 .png → .jpg로 바뀌면 장의 참조도 바꾼다. 동기화 코드는 건드리지 않는다(#56 보정 4) — 줄인 뒤 평소 올리기를 부른다
// 4MB 넘는 사진은 묻지 않고 줄인다(#128 보정 3·4) — 올리기 직전(저장·턴 끝·공유 켜기). 원본은 git이 갖고 있다(매 턴 커밋) — 따로 사본을 두지 않는다
// (.dynapse/photos/orig-*는 그 폴더가 올리기 목록이라 큰 사본이 다시 막혔다 — ota43이 남긴 것은 verify가 지운다). 장에 박힌 사진도 먼저 파일로 뺀다.
// 결과는 상태 점에 한 줄("사진 1장을 줄여서 올렸어요 · 6.9MB → 0.4MB" — 채팅엔 숨는 shrink 이벤트). 같은 작업에서 겹쳐 돌지 않는다
const shrinking = new Set();
export async function shrinkBig(id) {
    if (shrinking.has(id))
        return 0;
    shrinking.add(id);
    try {
        await extractInline(id).catch(() => 0);
        const all = await T().core.invoke("work_files", { id }).catch(() => []);
        const big = all.filter(f => f.size > 4 * 1024 * 1024 - 64 * 1024 && /^(materials|context\/assets|\.dynapse\/photos)\/[^/]+\.(png|jpe?g|webp)$/i.test(f.name) && !/^\.dynapse\/photos\/orig-/.test(f.name)).slice(0, 8);
        const pages = all.filter(f => /^result-[a-z0-9-]+\.html$/.test(f.name) || LANG_PAGE.test(f.name)).map(f => f.name);
        let n = 0;
        const done = [];
        let before = 0;
        for (const f of big) {
            // 원본 보관(0.1.75부터 — 네이티브가 context/assets/ 하위 폴더 한 단계를 연다, 올리기 목록 밖). 옛 네이티브에선 실패해도 줄인다(git이 원본)
            if (!f.name.startsWith(".dynapse/"))
                await T().core.invoke("work_copy_file", { from: id, file: f.name, to: id, dest: `context/assets/originals/${f.name.split("/").pop()}` }).catch(() => null);
            const nn = await T().core.invoke("shrink_photo", { id, file: f.name }).catch(() => null);
            if (!nn)
                continue;
            n++;
            done.push(nn);
            before += f.size;
            if (nn !== f.name)
                for (const p of pages) {
                    const h = await wget(id, p).catch(() => null);
                    if (h?.includes(f.name))
                        await wput(id, p, h.split(f.name).join(nn)).catch(() => { });
                }
        }
        // 그래도 4MB 넘는 사진(알파 PNG·네이티브 실패)과 4MB 넘는 장 — verify(fit-photos.json)가 될 때까지 줄인다(#128 보정 4: 거절은 없다)
        const LIM = 4 * 1024 * 1024 - 64 * 1024, all2 = await T().core.invoke("work_files", { id }).catch(() => []);
        const still = all2.filter(f => f.size > LIM && /^(materials|context\/assets|\.dynapse\/photos)\/[^/]+\.(png|jpe?g|webp)$/i.test(f.name) && !/^\.dynapse\/photos\/orig-/.test(f.name)).map(f => f.name);
        const bigPages = all2.filter(f => f.size > LIM && (/^result-[a-z0-9-]+\.html$/.test(f.name) || LANG_PAGE.test(f.name))).map(f => f.name);
        let slimmed = 0;
        const orig = all2.some(f => /^\.dynapse\/photos\/orig-/.test(f.name));
        let cleaned = 0;
        if (still.length || bigPages.length || orig) {
            for (const f of still)
                if (!done.includes(f))
                    before += all2.find(x => x.name === f)?.size ?? 0;
            await ensureVerify(id);
            const wd = await T().core.invoke("work_dir", { id }).catch(() => null);
            if (wd) {
                await wput(id, ".dynapse/fit-photos.json", JSON.stringify({ files: still, pages: bigPages }));
                const r = await exec("node", [".dynapse/verify.mjs"], undefined, wd).catch(() => null);
                let x = {};
                try {
                    x = JSON.parse((r?.stdout ?? "").trim().split("\n").pop() ?? "{}");
                }
                catch { /* */ }
                for (const e of x.fit ?? []) {
                    if (!done.includes(e.file))
                        n++;
                    const i = done.indexOf(e.file);
                    if (i >= 0)
                        done[i] = e.out;
                    else
                        done.push(e.out);
                    if (e.out !== e.file)
                        for (const p of pages) {
                            const h = await wget(id, p).catch(() => null);
                            if (h?.includes(e.file))
                                await wput(id, p, h.split(e.file).join(e.out)).catch(() => { });
                        }
                }
                slimmed = x.slim?.length ?? 0;
                cleaned = x.cleaned ?? 0;
            }
        }
        if (!n && !slimmed) {
            if (cleaned && S.git)
                await repoCommit(id, "사진 사본 정리");
            return 0;
        }
        if (S.git)
            await repoCommit(id, [n ? `큰 사진 줄임 · ${n}장` : "", slimmed ? `큰 장 줄임 · ${slimmed}장` : ""].filter(Boolean).join(" · "));
        if (!n)
            return slimmed;
        const after = (await T().core.invoke("work_files", { id }).catch(() => [])).filter(f => done.includes(f.name)).reduce((a, f) => a + f.size, 0);
        const mb = (b) => `${(b / 1048576).toFixed(1)}MB`;
        await postChat(id, [{ role: "event", text: null, payload: { kind: "shrink", ai: "dynapse", n, text: `사진 ${n}장을 줄여서 올렸어요 · ${mb(before)} → ${mb(after)}` } }]).catch(() => { });
        return n;
    }
    finally {
        shrinking.delete(id);
    }
}
// 박힌 사진 빼기(#56 보정 5) — 장 안 data:image(8KB 이상)를 materials/<칸>-<해시>.<확장자>로 빼고 경로로(verify의 요청 파일 모드, AI 없음). 바뀌면 커밋. 뺀 사진 수
export async function extractInline(id, force = false) {
    const all = await T().core.invoke("work_files", { id }).catch(() => []);
    const pages = all.filter(f => (/^result-[a-z0-9-]+\.html$/.test(f.name) || LANG_PAGE.test(f.name)) && (force || f.size > 300 * 1024)).map(f => f.name);
    if (!pages.length)
        return 0;
    // 2MB 넘는 장은 앱이 글로 읽지 못한다(work_read 상한 — 2026-10-22 사진 넷을 품은 견본을 가져오면 흰 화면): 크기만으로 후보 · 빼기는 verify(node)가 한다
    const big = new Set(all.filter(f => f.size > 1.9 * 1024 * 1024).map(f => f.name));
    const cand = [];
    for (const f of pages) {
        if (big.has(f)) {
            cand.push(f);
            continue;
        }
        const h = await wget(id, f).catch(() => null);
        if (h && /data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]{2000,}/.test(h))
            cand.push(f);
    }
    if (!cand.length)
        return 0;
    await ensureVerify(id);
    const wd = await T().core.invoke("work_dir", { id }).catch(() => null);
    if (!wd)
        return 0;
    await wput(id, ".dynapse/extract.json", JSON.stringify({ pages: cand }));
    const r = await exec("node", [".dynapse/verify.mjs"], undefined, wd).catch(() => null);
    let x = {};
    try {
        x = JSON.parse((r?.stdout ?? "").trim().split("\n").pop() ?? "{}");
    }
    catch {
        return 0;
    }
    const n = (x.extracted ?? []).reduce((a, e) => a + e.n, 0);
    if (n && S.git)
        await repoCommit(id, `사진을 파일로 뺐어요 · ${n}장`);
    if (n)
        report("sync", "sync.inline_extracted", `n=${n} pages=${(x.extracted ?? []).length} mb=${((x.extracted ?? []).reduce((a, e) => a + e.before - e.after, 0) / 1048576).toFixed(1)}`);
    return n;
}
// ── 동기화 기록(#56 보정 8) — 결정·결과를 작업마다 .dynapse/out/sync-log.json(git 밖·올리지 않음, 2,000줄 고리)에. 내용·글은 없이 이유·판·수·시간만.
// "왜 그때 올리기를 안 했나"를 이 기록으로 답한다. 1.5초 모아 한 번 쓴다
const SLOG = ".dynapse/out/sync-log.json";
const slogBuf = new Map(), slogT = new Map();
const short = (s) => (s ? s.slice(0, 7) : null);
export function slog(id, ev, data = {}) {
    const b = slogBuf.get(id) ?? [];
    b.push(JSON.stringify({ t: new Date().toISOString(), ev, ...data }));
    slogBuf.set(id, b);
    if (!slogT.has(id))
        slogT.set(id, window.setTimeout(() => void flushSlog(id), 1500));
}
export async function flushSlog(id) {
    const t = slogT.get(id);
    if (t)
        clearTimeout(t);
    slogT.delete(id);
    const add = slogBuf.get(id) ?? [];
    slogBuf.delete(id);
    if (!add.length)
        return;
    let lines = [];
    try {
        const cur = await wget(id, SLOG).catch(() => null);
        lines = cur ? JSON.parse(cur).map(x => JSON.stringify(x)) : [];
    }
    catch {
        lines = [];
    }
    await wput(id, SLOG, `[\n${[...lines, ...add].slice(-2000).join(",\n")}\n]\n`).catch(() => { });
}
export async function slogTail(id, n = 50) { await flushSlog(id); try {
    return JSON.parse((await wget(id, SLOG)) ?? "[]").slice(-n);
}
catch {
    return [];
} }
// 4MB 넘는 파일(#139 동기화 — dyn-3xen 10-15 18:00: 참고 PDF 7.2MB가 413으로 막혀 그 작업의 커밋 전체가 서버에 가지 못했다. 서버는 목록의 블롭이 다 있어야 커밋을 받는다)
// 장이 아닌 파일이 줄인 뒤에도 4MB를 넘으면 올리기 목록에서 뺀다 — 이 PC에는 그대로 있고(받기는 장만 지운다) 나머지는 평소대로 올라간다
const SYNC_LIM = 4 * 1024 * 1024 - 64 * 1024;
const tooBig = new Map(), bigSaid = new Set();
// onServer = 서버 판(base)에 이미 있는 경로 — 옛 이미지 버전 정리(keep)를 그 파일엔 쓰지 않는다(2026-10-22 dyn-puca: 멤버 PC엔 slots.json(올리지 않음)이 없어
// 장이 쓰는 -v1 사진 둘을 "옛 버전"으로 빼고 올림 → 서버에서 지움 → 주인이 다시 올림 → 멤버가 174개를 다시 받는 핑퐁). 지우는 건 사용자가 지운 파일뿐(폴더에 없음)
async function syncList(id, onServer) {
    const all = await T().core.invoke("work_files", { id }).catch(() => []);
    const list = [...all, ...(await pageRefs(id, all))]
        // 동기화·초대 범위(#21 보정 7 C) — 페이지 · materials · 생성 사진 · 참고 폴더(assets·refs·RULES) · 폴더 자료 목록(library.json — 출처 링크·쓰인 작업). 링크 원본·인덱스는 올리지 않는다
        .filter(x => /^result-[a-z0-9-]+\.html$/.test(x.name) || LANG_PAGE.test(x.name) || /^\.dynapse\/(pages|appendix|lang-status|bundles)\.json$/.test(x.name) || /^(materials|\.dynapse\/photos)\/[\w.-]+\.(png|jpe?g)$/i.test(x.name) || /^context\/(RULES\.md|library\.json|(assets|refs)\/[^/]+)$/.test(x.name)
        || /^(assets|images|img|fonts|css|js|media)\/([^/]+\/)?[^/]+\.(png|jpe?g|webp|gif|svg|ttf|otf|woff2?|css|js)$/i.test(x.name)); // 가져온 HTML의 재료(#24-보정) — 공유 범위에 포함
    // 공유 범위(#21 보정 15 B) — 기본은 최신만: 이미지 버전(⟨이름⟩-v⟨n⟩)은 가장 새 것 + 지금 칸에 걸린 것만. "이전 버전도 함께"(.dynapse/share.json)면 전부
    const share = await readJson(id, ".dynapse/share.json").catch(() => null);
    const bound = new Set(Object.values((await readJson(id, ".dynapse/slots.json").catch(() => null)) ?? {}).filter((x) => typeof x === "string"));
    const VER = /^(.*)-v(\d+)(\.[a-z0-9]+)$/i;
    const newest = new Map();
    for (const x of list) {
        const m = x.name.match(VER);
        if (m)
            newest.set(m[1] + m[3], Math.max(newest.get(m[1] + m[3]) ?? 0, Number(m[2])));
    }
    const keep = (n) => { const m = n.match(VER); return share?.history || !m || bound.has(n) || !!onServer?.has(n) || newest.get(m[1] + m[3]) === Number(m[2]); };
    const files = [], seen = new Set();
    const isPg = (n) => /^result-[a-z0-9-]+\.html$/.test(n) || LANG_PAGE.test(n);
    tooBig.set(id, list.filter(x => keep(x.name) && !isPg(x.name) && x.size > SYNC_LIM).map(x => ({ path: x.name, size: x.size })));
    for (const f of list.filter(x => keep(x.name) && (isPg(x.name) || !(x.size > SYNC_LIM)))) {
        if (seen.has(f.name))
            continue;
        seen.add(f.name);
        const h = await T().core.invoke("work_sha256", { id, file: f.name }).catch(() => null);
        if (h)
            files.push({ path: f.name, sha256: h, size: f.size });
    }
    return files;
}
// 서버 판을 이 폴더에 받는다(파일 하나씩, 바이트 그대로)
async function fetchFile(id, dir, sha, path) {
    const g = await http("GET", `${HUB}/api/works/${encodeURIComponent(id)}/commits/${sha}?path=${encodeURIComponent(path)}`, { out: `${dir}/${path}`, auth: true }).catch(() => null);
    return g?.status === 200;
}
// stale 합치기(#56 보정 7) — 서버가 "그 사이 판이 바뀌었다"(base ≠ head)고 하면: 내가 base 이후 바꾼 파일(A)과 head가 base 이후 바꾼 파일(B)을 비교.
// 겹치지 않으면 B를 받아 놓고 내 것은 그대로 → 다시 올린다. 같은 파일을 둘 다 고쳤으면 그 파일은 head 쪽, 내 판은 .dynapse/out/proposal--⟨파일⟩--⟨시각⟩에 두고 카드.
// 장 순서(pages.json)는 head 순서 + 내가 새로 만든 장을 뒤에. 자동으로 아무것도 잃지 않는다(내 판은 git 기록과 보관 파일에)
async function mergeStale(id, dir, base, head) {
    const t0 = Date.now(), none = { ok: false, theirs: 0, mine: 0, conflicts: [], saved: {} };
    const man = async (sha) => (await api("GET", `/api/works/${encodeURIComponent(id)}/commits?manifest=${sha}`).catch(() => null))?.data?.commit?.files ?? null;
    const theirs = await man(head);
    if (!theirs) {
        slog(id, "merge.fail", { why: "head_manifest", head: short(head) });
        return none;
    }
    const baseF = base ? await man(base) : null;
    const mine = await syncList(id, new Set([...(baseF ?? []), ...theirs].map(f => f.path))); // 서버에 있는 파일은 옛 버전 정리로 빼지 않는다
    const hm = new Map(theirs.map(f => [f.path, f.sha256])), mm = new Map(mine.map(f => [f.path, f.sha256]));
    // base를 모르면(처음 올리는 기기) 내 것과 head를 바로 비교 — 둘 다 있고 다르면 겹침, 한쪽에만 있으면 그쪽
    const bm = baseF ? new Map(baseF.map(f => [f.path, f.sha256])) : null;
    const changed = (m) => bm ? new Set([...[...m].filter(([p, h]) => bm.get(p) !== h).map(([p]) => p), ...[...bm.keys()].filter(p => !m.has(p))]) : new Set(m.keys());
    const A = changed(mm), B = changed(hm);
    const both = [...B].filter(p => A.has(p) && mm.get(p) !== hm.get(p) && (bm || (mm.has(p) && hm.has(p))));
    const isPg = (p) => /^result-[a-z0-9-]+\.html$/.test(p) || LANG_PAGE.test(p);
    const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14), conflicts = [], saved = {};
    let got = 0;
    // 합병 기준은 주인의 최신(#256 보정 2 — 3일 묵은 팀원 판이 대표가 지운 장 12개를 되살리고 같이 고친 장 6개를 덮었다): 이 기기가 주인이 아니면
    // 같은 파일은 주인 판(head), 주인이 지운 장은 내가 고쳤어도 지운다. 내 판은 .dynapse/out/owner-⟨시각⟩--⟨파일⟩에 두고 대화에 한 줄(자동으로 잃는 것 없음). 내가 새로 만든 장은 그대로
    const member = !(await isOriginDevice(id).catch(() => true));
    const keepMine = async (p) => { const h = await wget(id, p).catch(() => null); if (h != null) {
        saved[p] = `.dynapse/out/owner-${ts}--${p.replace(/\//g, "_")}`;
        await wput(id, saved[p], h).catch(() => { });
    } };
    const skippedF = [];
    for (const p of B) {
        if (p === ".dynapse/pages.json" && both.includes(p))
            continue; // 아래에서 합친다
        if (both.includes(p) && !bm && !hm.has(p))
            continue;
        // 같은 파일(#56 보정 10 — 고르라고 하지 않는다): 주인 기기는 나중에 올리는 쪽(나)의 판을 둔다. 덮인 판은 기록(head 커밋)에 남고, 그 사람에게 [내 판으로] 한 줄이 간다
        if (both.includes(p) && !member) {
            conflicts.push(p);
            continue;
        }
        if (both.includes(p) && member)
            await keepMine(p);
        if (hm.has(p)) {
            if (await fetchFile(id, dir, head, p)) {
                got++;
                if (both.includes(p))
                    conflicts.push(p);
            }
            // 한 조각이 전체를 막지 않는다(#254 보정 1 ①) — 장이 아닌 파일 하나를 못 받으면 내 것(또는 없음)으로 두고 진행. 장을 못 받으면 합치지 않는다(반쪽 판을 올리지 않게)
            else if (!isPg(p) && skippedF.length < 20) {
                skippedF.push(p);
                slog(id, "merge.skip_file", { path: p });
            }
            else {
                slog(id, "merge.fail", { why: "fetch", path: p });
                return none;
            }
        }
        else if (bm && isPg(p) && (!A.has(p) || member)) {
            if (A.has(p)) {
                await keepMine(p);
                conflicts.push(p);
            }
            await T().core.invoke("page_delete", { id, path: p }).catch(() => { });
            got++;
        } // head가 지운 장 — 주인 기기는 내가 손대지 않은 것만
    }
    if (skippedF.length) {
        const ps = (await store.get("pull_skipped")) ?? {};
        ps[id] = [...new Set([...(ps[id] ?? []), ...skippedF.filter(p => !mm.has(p))])];
        await store.set("pull_skipped", ps);
        await store.save();
    }
    if (both.includes(".dynapse/pages.json")) { // 순서 — head 순서 + 내가 새로 만든 장
        const ok = await fetchFile(id, dir, head, ".dynapse/pages.json");
        const theirsOrder = ok ? ((await readPages(id).catch(() => null)) ?? []) : [];
        const baseOrder = bm && base ? await (async () => { const g = await http("GET", `${HUB}/api/works/${encodeURIComponent(id)}/commits/${base}?path=.dynapse%2Fpages.json`, { auth: true }).catch(() => null); try {
            return g?.status === 200 ? JSON.parse(g.body) : [];
        }
        catch {
            return [];
        } })() : [];
        const myNew = mine.map(f => f.path).filter(p => isPg(p) && !baseOrder.includes(p) && !theirsOrder.includes(p) && !LANG_PAGE.test(p));
        await wput(id, ".dynapse/pages.json", JSON.stringify([...theirsOrder, ...myNew]));
    }
    if (member)
        await applyServerMeta(id).catch(() => null); // 숨김·순서·장 목록은 주인 값(#256 보정 2)
    const nC = conflicts.filter(p => p !== ".dynapse/pages.json").length;
    const msg = `합침 · ${short(head)} 받고 내 변경 ${[...A].filter(p => !both.includes(p)).length}개${nC ? (member ? ` · 겹친 장 ${nC}개는 주인 판` : ` · 같은 장 ${nC}개는 내 판`) : ""}`;
    await repoCommit(id, msg);
    slog(id, conflicts.length ? "merge.card" : "merge.auto", { base: short(base), head: short(head), mine: A.size, theirs: B.size, both: both.length, got, ms: Date.now() - t0 });
    report("sync", conflicts.length ? "merge.card" : "merge.auto", `work=${id} mine=${A.size} theirs=${B.size} both=${both.length}`);
    return { ok: true, theirs: B.size, mine: A.size, conflicts: conflicts.filter(p => p !== ".dynapse/pages.json"), saved, member };
}
const notMemberSaid = new Set(); // 작업마다 한 번(이 앱이 켜져 있는 동안)
const pushWait = new Map(); // 차단기가 풀릴 때 한 번 다시 올리기(#256)
const emptySaid = new Set(); // 빈 파일 알림 — 같은 파일 묶음은 한 번(#254)
async function pushWork0(id, dir) {
    const t0 = Date.now();
    await extractInline(id).catch(() => 0); // 4MB 넘는 장이 못 올라가던 것(#56 보정 5) — 올리기 전에 박힌 사진을 파일로
    let sha = S.git ? await T().core.invoke("repo_head", { id }).catch(() => null) : null;
    if (!sha) {
        slog(id, "push.skip", { why: S.git ? "no_commit" : "no_git" });
        return;
    }
    const heads = (await store.get("remote_heads")) ?? {};
    if (heads[id] === sha && heads[`${id}#refs`] === "1") {
        slog(id, "push.skip", { why: "same_head", sha: short(sha) });
        return;
    }
    if (heads[`${id}#local`] === sha) {
        slog(id, "push.skip", { why: "just_pulled", sha: short(sha) });
        return;
    } // 방금 받은 판(동기화 커밋) — 올릴 새 것이 없다(ota16)
    if (heads[`${id}#off`] === sha) {
        slog(id, "push.skip", { why: "off_same", sha: short(sha) });
        return;
    } // 공유가 꺼져 거절된 같은 판 — 다시 묻지 않는다(새 커밋이 생기면 한 번 더)   // #refs = 장이 가리키는 재료까지 올린 뒤(2026-10-11) — 그 전 작업은 한 번 더 올린다(서버는 없는 파일만 받는다)
    // 빈 파일(0바이트)은 올리지 않는다(#254 — 채팅에 붙인 빈 image.png 하나 때문에 147개가 다 막혔다) — 목록에서 빼고 한 번 알린다
    const noEmpty = (l) => { const e = l.filter(f => !f.size); if (e.length && !emptySaid.has(`${id}:${e.map(f => f.path).join(",")}`)) {
        emptySaid.add(`${id}:${e.map(f => f.path).join(",")}`);
        slog(id, "push.empty_skip", { n: e.length, first: e[0].path });
        void postChat(id, [{ role: "event", text: `빈 파일 ${e.length}개(${e.map(f => f.path.split("/").pop()).slice(0, 3).join(", ")})는 올리지 않아요 · 열리지 않는 파일이에요`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
    } return l.filter(f => f.size > 0); };
    const serverPaths = async (b) => new Set(b ? ((await api("GET", `/api/works/${encodeURIComponent(id)}/commits?manifest=${b}`).catch(() => null))?.data?.commit?.files ?? []).map(f => f.path) : []);
    let onServer = await serverPaths(heads[id] ?? null);
    let files = noEmpty(await syncList(id, onServer));
    const trace = await readJson(id, ".dynapse/TRACE.json");
    // base = 이 기기가 마지막으로 맞춘 서버 판(#56 보정 7) — 서버는 base가 지금 head일 때만 받는다(빨리 감기)
    let base = heads[id] ?? null;
    // 받을 때 건너뛴 파일(#254 보정 1 ①)은 이 PC에 없어도 서버 판의 것을 그대로 둔다 — 빠진 채 올려 서버에서 지우지 않게(서버는 지금 판의 블롭을 함께 쓰는 사람 것에서 찾는다)
    const carry = async (l, b) => {
        const ps = ((await store.get("pull_skipped")) ?? {})[id];
        if (!ps?.length || !b)
            return l;
        const man = (await api("GET", `/api/works/${encodeURIComponent(id)}/commits?manifest=${b}`).catch(() => null))?.data?.commit?.files ?? [];
        const add = man.filter(f => ps.includes(f.path) && !l.some(x => x.path === f.path));
        return add.length ? [...l, ...add] : l;
    };
    files = await carry(files, base);
    let body = { sha, parent: base, base, message: trace?.rounds?.at(-1)?.req?.text ?? null, model: trace?.rounds?.at(-1)?.model ?? null, merged_from: trace?.rounds?.at(-1)?.merged_from ?? null, files };
    // 올리는 상태(#21 보정 14 C) — 웹 상태 줄 "☁ 올리는 중 n/m"·파일 줄 ↑→✓/! (채팅엔 안 보이는 이벤트)
    const up = (p) => postChat(id, [{ role: "event", text: null, payload: { kind: "upload", ai: "dynapse", ...p } }]);
    const failed = [], putFail = [], skipped = [];
    const why1 = (x) => (!x.size ? "빈 파일" : x.status === 413 || x.size > 4 * 1024 * 1024 ? `${(x.size / 1048576).toFixed(1)}MB · 4MB 넘어요` : `올리기 거절 ${x.status}`);
    let done = 0, merged = false, blobRounds = 0, overrode = null;
    slog(id, "push.try", { sha: short(sha), base: short(base), n: files.length });
    {
        const tb = (tooBig.get(id) ?? []).filter(x => !bigSaid.has(`${id}:${x.path}`));
        if (tb.length) {
            tb.forEach(x => bigSaid.add(`${id}:${x.path}`));
            slog(id, "push.big_skip", { n: tb.length, first: `${tb[0].path}:${tb[0].size}` });
            report("sync", "push.big_skip", `work=${id} n=${tb.length} size=${tb[0].size}`);
            await postChat(id, [{ role: "event", text: `${tb.map(x => `${x.path.split("/").pop()} ${(x.size / 1048576).toFixed(1)}MB`).slice(0, 3).join(", ")}${tb.length > 3 ? ` 외 ${tb.length - 3}개` : ""}는 이 PC에만 둬요 · 4MB 넘는 파일은 함께 쓰는 사람에게 가지 않아요(나머지는 올라가요)`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
        }
    }
    for (let k = 0; k < 6; k++) { // 올리고 → 다시 등록(두 번까지) · stale이면 한 번 합치고 다시
        const r = await api("POST", `/api/works/${encodeURIComponent(id)}/commits`, body).catch(() => null);
        if (r?.status === 200) {
            heads[id] = sha;
            heads[`${id}#refs`] = "1";
            heads[`${id}#local`] = sha;
            await store.set("remote_heads", heads);
            await store.save();
            slog(id, "push.ok", { sha: short(sha), base: short(base), n: files.length, merged, ms: Date.now() - t0 });
            if (skipped.length) {
                report("sync", "push.partial", `work=${id} skipped=${skipped.length} ${skipped.slice(0, 3).map(x => `${x.path}:${x.status}:${x.size}`).join(" ")}`);
                await postChat(id, [{ role: "event", text: `${skipped.map(x => x.path.split("/").pop()).slice(0, 2).join(", ")}${skipped.length > 2 ? ` 외 ${skipped.length - 2}개` : ""} ${skipped.length}개를 못 올렸어요(${why1(skipped[0])}) · 나머지 ${files.length}개는 올렸어요`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
            }
            await up({ state: "done", total: files.length, files: files.map(f => f.path), failed: skipped.map(x => x.path), head: sha });
            return;
        }
        // 그 사이 판이 바뀌었다(#56 보정 7) — 받아 합치고 한 번만 다시. 두 번째 stale은 사람이 보게(되풀이 없음)
        if (r?.status === 409 && r.data?.stale && r.data.head) {
            slog(id, "push.stale", { sha: short(sha), base: short(base), head: short(r.data.head), again: merged });
            if (merged) {
                report("sync", "push.stale", `work=${id} twice`);
                await up({ state: "fail", total: files.length, files: [], failed: [], reason: "다른 사람이 계속 올리는 중이에요 · 잠시 뒤 다시" });
                return;
            }
            const mr = await mergeStale(id, dir, base, r.data.head);
            if (!mr.ok) {
                report("sync", "merge.fail", `work=${id}`);
                await up({ state: "fail", total: files.length, files: [], failed: [], reason: "새 판을 합치지 못했어요" });
                return;
            }
            merged = true;
            heads[id] = r.data.head;
            await store.set("remote_heads", heads);
            await store.save();
            sha = (await T().core.invoke("repo_head", { id }).catch(() => null)) ?? sha;
            base = r.data.head;
            onServer = await serverPaths(base);
            files = await carry(noEmpty(await syncList(id, onServer)), base);
            body = { ...body, sha, parent: base, base, files };
            overrode = mr.conflicts.length && !mr.member ? { pages: mr.conflicts.slice(0, 20), head: r.data.head } : null;
            body = { ...body, ...(overrode ? { overrode } : {}) };
            if (mr.member && mr.conflicts.length)
                await postChat(id, [{ role: "event", text: `주인 버전으로 맞췄어요 · 겹친 장 ${mr.conflicts.length}개(${mr.conflicts.slice(0, 3).map(p => p.replace(/^result-|\.html$/g, "")).join(", ")}${mr.conflicts.length > 3 ? " 외" : ""})의 내 판은 이 PC에 보관했어요 · 내 변경 ${Math.max(0, mr.mine - mr.conflicts.length)}개는 올려요`, payload: { kind: "stage", ai: "dynapse", owner_wins: mr.conflicts.slice(0, 20), saved: mr.saved } }]).catch(() => { });
            else if (mr.theirs || mr.conflicts.length)
                await postChat(id, [{ role: "event", text: `새 판의 변경 ${mr.theirs}개를 받고 내 변경 ${mr.mine}개를 올려요${mr.conflicts.length ? ` · 같은 장 ${mr.conflicts.length}개는 내 판으로` : ""}`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
            continue;
        }
        // 공유가 꺼진 작업(#56 보정 5)·멤버 올리기 꺼짐(#56 보정 7) — 실패가 아니다: 서버가 이 작업을 받지 않는 상태. 조용히 끝내고 같은 판으로는 다시 시도하지 않는다
        if ((r?.status === 409 || r?.status === 423) && !r.data?.missing?.length && /공유가 꺼져|원래 PC|원본 PC|잠시 멈췄/.test(String(r.data?.error ?? ""))) {
            // 차단기(잠시 멈춤)는 표시하지 않는다 — 풀리면 다음 저장에 다시(같은 판을 영영 안 올리는 일이 없게)
            if (!r.data?.paused) {
                heads[`${id}#off`] = sha;
                await store.set("remote_heads", heads);
                await store.save();
            }
            // 기다리는 올리기(#256) — 서버가 알려 준 재개 시각(resume_at)에 한 번만 다시. 작업당 타이머 하나 · 5초~15분 뒤 · 되풀이 없음(다시 멈춰 있으면 그때 새 시각으로 한 번 더 — 10분에 1번꼴, 하루 최대 144번)
            const ra = Number(r.data?.resume_at) || 0;
            if (r.data?.paused && ra && !pushWait.has(id))
                pushWait.set(id, setTimeout(() => { pushWait.delete(id); slog(id, "push.resume", {}); void pushWork(id, dir).catch(() => { }); }, Math.min(15 * 60_000, Math.max(5_000, ra - Date.now() + 5_000))));
            slog(id, "push.off", { sha: short(sha), why: r.data?.paused ? "breaker" : /원본 PC/.test(String(r.data?.error)) ? "member_push_off" : "share_off" });
            await up({ state: "off", total: 0, files: [], failed: [], why: r.data?.paused ? "breaker" : /원본 PC/.test(String(r.data?.error)) ? "member_push_off" : "share_off", ...(ra ? { resume_at: ra } : {}) });
            return;
        }
        // 멤버가 아닌 계정(#186 — 초대 링크가 브라우저에 새 계정을 만들어 이 PC 계정은 멤버가 아니었다: 404·403이 소리 없이 되풀이) — 이 작업에 한 줄 한 번 + [계정 합치기](웹의 [앱에서 열기]와 같은 잇기)
        if (r?.status === 403 || r?.status === 404) {
            if (!notMemberSaid.has(id)) {
                notMemberSaid.add(id);
                report("sync", "push.not_member", `status=${r?.status}`);
                void import("./main.js").then(m => m.toast?.("이 PC의 계정이 이 작업 멤버가 아니에요 · 초대를 연 브라우저에서 이 작업을 열고 [계정 합치기]")).catch(() => { });
                await postChat(id, [{ role: "event", text: "이 PC의 계정이 이 작업 멤버가 아니라 올리지 못했어요 · 초대를 연 브라우저 계정과 합치면 돼요", payload: { kind: "not-member", ai: "dynapse" } }]).catch(() => { });
            }
        }
        if (r?.status !== 409 || !r.data?.missing?.length) {
            slog(id, "push.fail", { status: r?.status ?? 0 });
            report("sync", "sync.push_fail", `status=${r?.status ?? "net"}`);
            await up({ state: "fail", total: files.length, files: [], failed: files.map(f => f.path), ...(r?.status === 403 || r?.status === 404 ? { reason: "이 계정의 작업이 아니에요" } : {}) });
            return;
        }
        const miss = r.data.missing;
        if (++blobRounds > 3)
            break;
        let moved = false;
        await up({ state: "run", done, total: miss.length });
        for (const m of miss) {
            const f = files.find(x => x.sha256 === m);
            if (!f)
                continue;
            const g = await http("PUT", `${HUB}/api/blobs/${m}?path=${encodeURIComponent(f.path)}&work=${encodeURIComponent(id)}`, { file: `${dir}/${f.path}`, contentType: "application/octet-stream", auth: true }).catch(() => null);
            // 400 = 서버가 다시 계산한 해시가 다르다 — 목록을 만든 뒤 파일이 바뀌었다(10-15 18:00 장 2개: 턴 끝 쪽번호·사진 쓰기와 겹침). 실패가 아니라 목록을 다시 만들고 한 번 더
            if (g?.status === 400 && !moved && (await T().core.invoke("work_sha256", { id, file: f.path }).catch(() => null)) !== f.sha256) {
                moved = true;
                slog(id, "push.rehash", { path: f.path });
                continue;
            }
            if (g?.status === 200)
                done++;
            else {
                failed.push(f.path);
                putFail.push({ path: f.path, status: g?.status ?? 0, size: f.size });
                if (g?.status === 400)
                    slog(id, "push.400_why", { path: f.path, why: String(g.body ?? "").slice(0, 120) });
            }
            if (done % 2 === 0 || done === miss.length)
                await up({ state: "run", done, total: miss.length, path: f.path });
        }
        if (moved) {
            files = noEmpty(await syncList(id, onServer));
            body = { ...body, files };
            failed.length = 0;
            putFail.length = 0;
        }
        // 파일 하나의 거절(4xx — 빈 파일·크기·형식)은 그 파일만 빼고 나머지를 올린다(#254). 서버 전체 오류(5xx·네트워크)는 그대로 실패
        const perFile = putFail.filter(x => x.status >= 400 && x.status < 500);
        if (perFile.length && perFile.length === putFail.length && perFile.length < files.length && !skipped.length) {
            skipped.push(...perFile);
            const drop = new Set(perFile.map(x => x.path));
            files = files.filter(f => !drop.has(f.path));
            body = { ...body, files };
            failed.length = 0;
            putFail.length = 0;
            blobRounds = 0;
            slog(id, "push.skip_files", { n: drop.size, first: perFile[0].path });
            continue;
        }
    }
    // 왜 못 올렸는지(#56 보정 5) — 파일별 상태·크기. 4MB 넘는 장은 사진을 파일로 빼면 된다([빼기])
    const big = putFail.filter(x => x.status === 413 || x.size > 4 * 1024 * 1024).sort((a, b) => b.size - a.size), mb = (n) => `${(n / 1048576).toFixed(1)}MB`;
    const empty0 = putFail.find(x => !x.size), big0 = big.find(x => x.size > 0);
    const reason = empty0 ? `${empty0.path} — 빈 파일(0바이트)이라 올리지 않아요` : big0 ? `${big0.path} ${mb(big0.size)} — 장은 4MB까지 · 사진을 파일로 빼면 돼요` : putFail.length ? `${putFail[0].path} 올리기 실패(${putFail[0].status || "네트워크"})` : undefined; // 0바이트를 "4MB 초과"로 말하던 것(#254)
    slog(id, big.length ? "push.413" : "push.400", { failed: failed.length, first: putFail[0] ? `${putFail[0].path}:${putFail[0].status}:${putFail[0].size}` : null });
    report("sync", big.length ? "push.413" : "push.400", `work=${id} failed=${failed.length}`); // 표준 코드(#56 보정 8) — 규칙 엔진: 413이면 다시 줄이기
    report("sync", "sync.push_fail", `missing_after_retries failed=${failed.length} ${putFail.slice(0, 3).map(x => `${x.path}:${x.status}:${x.size}`).join(" ")}`);
    await up({ state: "fail", total: files.length, files: [], failed: failed.length ? failed : files.map(f => f.path), ...(reason ? { reason } : {}), ...(big.length ? { big: true } : {}) });
}
// 동기화를 방금 켰을 때 — 이 기기의 최근 작업(최대 20건)을 한 번 올린다
export async function syncAll() {
    const r = await api("GET", "/api/works").catch(() => null);
    for (const w of (r?.data?.works ?? []).filter(w => (w.deviceId ?? w.device_id) === S.deviceId).slice(0, 20)) {
        const dir = await T().core.invoke("work_dir", { id: w.id }).catch(() => null);
        const files = await T().core.invoke("work_files", { id: w.id }).catch(() => []);
        if (dir && files.some(f => f.name === "result-cover.html")) {
            await afterSave(w.id);
        }
    }
}
// 채우기 — 비공개 썸네일·메타가 생기기 전(0.1.11 이전)에 만든 이 기기의 작업을 시작 때 한 번 올린다(최대 10건). 웹의 빈 칸을 없앤다
export async function backfill() {
    const r = await api("GET", "/api/works").catch(() => null);
    const todo = (r?.data?.works ?? []).filter(w => w.deviceId === S.deviceId && w.status === "done" && (!w.thumbPrivate || !w.meta)).slice(0, 10);
    for (const w of todo) {
        const files = await T().core.invoke("work_files", { id: w.id }).catch(() => []);
        if (files.some(f => f.name === "result-cover.html"))
            await afterSave(w.id);
    }
}
// 다른 기기에서 만든 작업을 이 기기로 — 동기화 사본(결과 html) + 메타(지시서·팀·기록)
export async function pullWork(id, noPush = false) {
    // 최신 커밋 매니페스트대로 파일을 받아 이 기기 git에 커밋(#20). 로컬 해시는 기기마다 다르므로 서버 커밋 해시를 remote_heads에 적어 다음 올림의 parent로 쓴다
    // 받는 상태(#21 보정 14 C) — "받는 중 n/m" → 로컬. 결과는 반드시 남긴다(#56 — 실패해도 아무 말이 없어 "편집이 막힌" 것처럼 보였다)
    const down = (p, text = null) => postChat(id, [{ role: "event", text, payload: { kind: "download", ai: "dynapse", ...p } }]);
    const why = (st) => st === 401 ? "연결이 끊겼어요" : st === 404 ? "이 계정의 작업이 아니에요" : st === 409 || st === 423 ? "공유가 꺼져 있어요" : st ? `서버 오류 ${st}` : "네트워크 오류";
    const fail = async (reason, done = 0, total = 0) => { report("sync", "sync.pull_fail", reason.slice(0, 60)); await down({ state: "fail", done, total, reason }, `받지 못했어요 · ${reason}`); return false; };
    const c = await api("GET", `/api/works/${encodeURIComponent(id)}/commits?latest=1`).catch(() => null);
    if (!c || c.status !== 200)
        return fail(why(c?.status));
    const head = c.data?.commit;
    if (!head?.files.length)
        return fail("커밋 없음");
    const dir = await T().core.invoke("work_dir", { id }).catch(() => null);
    if (!dir)
        return fail("폴더를 만들지 못했어요");
    await down({ state: "run", done: 0, total: head.files.length }, "이 PC로 받는 중…");
    let got = 0;
    // 한 조각이 전체를 막지 않는다(#254 보정 1 ①) — 장이 아닌 파일(사진·자료) 하나가 4xx면 그 파일만 건너뛰고 이름·이유를 남긴다.
    // 장(result-*.html)·연결 끊김(401)·서버 오류(5xx)·네트워크는 예전처럼 받기 실패(반쪽 장 목록으로 맞추지 않는다). 건너뛴 파일은 다음 올리기에서 서버 판의 것을 그대로 둔다(pullskip)
    const skipped = [];
    // 같은 파일은 받지 않는다(2026-10-22 — 판이 바뀔 때마다 174개를 통째로 다시 받았다): 이 PC 파일의 sha256이 서버 판의 것과 같으면 건너뜀(받은 것으로 센다)
    for (const f of head.files) {
        if (f.sha256 && (await T().core.invoke("work_sha256", { id, file: f.path }).catch(() => null)) === f.sha256) {
            got++;
            continue;
        }
        const g = await http("GET", `${HUB}/api/works/${encodeURIComponent(id)}/commits/${head.sha}?path=${encodeURIComponent(f.path)}&device=${encodeURIComponent(S.deviceId)}`, { out: `${dir}/${f.path}`, auth: true, keep: true }).catch(() => null); // 실패 응답은 파일에 쓰지 않는다(#170)
        if (g?.status !== 200) {
            const st = g?.status ?? 0, page = /^result-[a-z0-9-]+(\.[a-z]{2})?\.html$/.test(f.path) || f.path === ".dynapse/pages.json";
            if (page || !st || st === 401 || st >= 500 || skipped.length >= 20)
                return fail(`파일 ${got}/${head.files.length} · ${why(g?.status)}${page ? "" : ` · ${f.path.split("/").pop()}`}`, got, head.files.length);
            skipped.push({ path: f.path, status: st });
            continue;
        }
        got++;
        if (got % 3 === 0 && got < head.files.length)
            await down({ state: "run", done: got, total: head.files.length });
    }
    {
        const ps = (await store.get("pull_skipped")) ?? {};
        if (skipped.length)
            ps[id] = skipped.map(x => x.path);
        else
            delete ps[id];
        await store.set("pull_skipped", ps);
        await store.save();
    }
    if (skipped.length) {
        slog(id, "pull.skip_files", { n: skipped.length, first: `${skipped[0].path}:${skipped[0].status}` });
        report("sync", "pull.partial", `work=${id} skipped=${skipped.length} ${skipped.slice(0, 3).map(x => `${x.path}:${x.status}`).join(" ")}`);
    }
    const sm = await applyServerMeta(id).catch(() => null);
    const pagesN = head.files.filter(f => /^result-[a-z0-9-]+\.html$/.test(f.path)).length;
    const skipLine = skipped.length ? ` · ${skipped.map(x => x.path.split("/").pop()).slice(0, 2).join(", ")}${skipped.length > 2 ? ` 외 ${skipped.length - 2}개` : ""} ${skipped.length}개는 못 받았어요(${skipped[0].status === 404 ? "서버에 없음" : `거절 ${skipped[0].status}`})` : "";
    await down({ state: "done", done: got, total: head.files.length, head: head.sha, ...(skipped.length ? { failed: skipped.map(x => x.path) } : {}) }, `${pagesN ? `받았어요 · ${pagesN}장` : "받았어요"}${sm ? metaLine(sm).replace(/^ · 장 \d+개/, "") : ""}${skipLine}`);
    const r = await api("GET", "/api/works").catch(() => null);
    const meta = r?.data?.works?.find(x => x.id === id)?.meta;
    if (meta?.brief)
        await wput(id, ".dynapse/brief.json", JSON.stringify(meta.brief, null, 2));
    if (meta?.team)
        await wput(id, ".dynapse/team.json", JSON.stringify(meta.team, null, 2));
    await wput(id, ".dynapse/TRACE.json", JSON.stringify({ primary: meta?.primary ?? {}, rounds: meta?.rounds ?? [], photos: [] }, null, 2));
    if (meta?.notes)
        await wput(id, ".dynapse/NOTES.md", meta.notes);
    // 동기화로 받은 작업도 CLAUDE.md·AGENTS.md = 가벼움(#167 ③ — 여기서 전체 지침 61KB를 써서 동기화 작업은 매 턴 61KB를 읽었다). 큰 묶음은 등급 파일로
    {
        const tb = await tierBundles().catch(() => null), skill = tb ? null : await workflowSkill();
        if (tb) {
            await wput(id, "CLAUDE.md", tb.light);
            await wput(id, "AGENTS.md", tb.light);
            await wput(id, ".dynapse/skill-normal.md", tb.normal);
            await wput(id, ".dynapse/skill-heavy.md", tb.heavy);
            if (tb.layouts)
                await wput(id, ".dynapse/layouts.md", tb.layouts);
            for (const [k, t] of Object.entries(tb.rules ?? {}))
                await wput(id, `.dynapse/rules-${k}.md`, t);
        }
        else if (skill) {
            await wput(id, "CLAUDE.md", skill);
            await wput(id, "AGENTS.md", skill);
        }
    }
    await repoCommit(id, `동기화 · ${head.sha.slice(0, 7)}${head.message ? ` · ${head.message.slice(0, 120)}` : ""}`);
    {
        const fl = await T().core.invoke("work_files", { id }).catch(() => []);
        if (fl.some(f => PAGE_RE.test(f.name) && f.size > 1.9 * 1024 * 1024))
            await extractInline(id).catch(() => 0);
    } // 받은 장이 2MB 넘으면(사진을 품은 장) 사진을 파일로 — 캔버스가 읽게
    const heads = (await store.get("remote_heads")) ?? {};
    heads[id] = head.sha;
    heads[`${id}#local`] = (S.git ? await T().core.invoke("repo_head", { id }).catch(() => null) : null) ?? "";
    await store.set("remote_heads", heads);
    await store.save();
    // 이 PC가 원본이 됐다 — local_path·기기·메타를 서버에(#56 — 성공해도 local_path가 안 적히던 경로)
    await api("POST", "/api/works", { id, status: "done", local_path: dir, device_id: S.deviceId }).catch(() => { });
    // 받은 판에 원문 없는 언어판이 있으면 정리(#310 보정 1) — 정리 커밋은 다음 올림에 같이 간다
    if (await cleanOrphanLangs(id).catch(() => 0))
        await repoCommit(id, "원문 없는 언어판 정리");
    if (await (await import("./photo-runner.js")).stripCredits(id).catch(() => 0))
        await repoCommit(id, "장 위 사진 출처 줄 걷기"); // #313 — 다음 받기에서 저절로
    if (!noPush)
        void afterSave(id); // 받은 판을 곧바로 다시 올리지 않는다(ota16 — 받기·올리기 핑퐁)
    return true;
}
// 최신 판 맞추기(#56 보정 3) — 멤버 기기가 옛 폴더를 보여 주던 문제: 서버 판(head)과 이 기기가 마지막으로 맞춘 판(remote_heads)이 다르면
// 폴더가 깨끗하고(커밋 안 된 변경 없음) 올리지 않은 로컬 커밋도 없으면 바로 받는다. 내 변경이 있으면 [가져오기] 카드 — 누르면 내 변경을 커밋·올려 서버가 합치고(다른 장이면 합침, 같은 장이면 둘 다 보존) 그 판을 받는다.
// 턴이 도는 중이면 끝난 뒤에. why: open(작업 열기) · turn(턴 전 — 카드 없이 깨끗할 때만) · notice(새 판 알림) · click([가져오기]). 받았으면 true
const pendingSync = new Set(), offered = new Map();
// #56 보정 6·7 — 서버 head가 하나의 진실(소유자 기기 포함). 받는 규칙:
// · 잃을 게 없는 폴더(커밋 안 된 변경 없음 · 올리지 않은 커밋 없음)는 묻지 않고 서버 판 그대로 받는다(서버에서 지운 장은 이 폴더에서도 지운다 — 옛 장이 되살아나지 않게)
// · 올리지 않은 내 커밋만 있으면 올린다(빨리 감기, 그 사이 판이 바뀌었으면 합쳐서) · 커밋 안 된 변경이 있으면 카드(작업 중인 걸 건드리지 않는다)
// · [가져오기](take) = 내 변경을 커밋·올려 합친 뒤 맞춘다. 올릴 수 없으면(멤버 올리기 꺼짐 등) 내 장을 .dynapse/out/lc-⟨시각⟩--⟨장⟩에 보관하고 서버 판으로
async function exactPull(id) {
    const c = await api("GET", `/api/works/${encodeURIComponent(id)}/commits?latest=1`).catch(() => null);
    const keep = new Set((c?.data?.commit?.files ?? []).map(f => f.path));
    if (!keep.size)
        return false;
    const names = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name);
    for (const f of names.filter(n => (/^result-[a-z0-9-]+\.html$/.test(n) || LANG_PAGE.test(n)) && !keep.has(n)))
        await T().core.invoke("page_delete", { id, path: f }).catch(() => { });
    return pullWork(id, true).catch(() => false);
}
async function backupLocal(id) {
    const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const names = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(n => /^result-[a-z0-9-]+\.html$/.test(n) || LANG_PAGE.test(n) || n === ".dynapse/pages.json");
    let n = 0;
    for (const f of names) {
        const h = await wget(id, f).catch(() => null);
        if (h != null) {
            await wput(id, `.dynapse/out/lc-${ts}--${f.replace(/\//g, "_")}`, h).catch(() => { });
            n++;
        }
    }
    return n;
}
export async function syncLatest(id, why, head) {
    if (why === "open") {
        const fl = await T().core.invoke("work_files", { id }).catch(() => []);
        if (fl.some(f => (PAGE_RE.test(f.name) || LANG_PAGE.test(f.name)) && f.size > 1.9 * 1024 * 1024))
            await extractInline(id).catch(() => 0);
    } // 열 때 2MB 넘는 장 → 사진을 파일로(흰 화면 방지)
    if (!S.token || !S.git) {
        slog(id, "pull.skip", { why: S.token ? "no_git" : "no_token", by: why });
        return false;
    }
    const hr = await api("GET", `/api/works/${encodeURIComponent(id)}/commits?head=1`).then(r => (r.status === 200 ? r.data ?? null : null)).catch(() => null);
    const remote = head ?? hr?.sha ?? null;
    if (!remote) {
        slog(id, "pull.skip", { why: "no_remote", by: why });
        return false;
    }
    const heads = (await store.get("remote_heads")) ?? {};
    if (heads[id] === remote && why !== "discard") {
        slog(id, "pull.skip", { why: "same", remote: short(remote), by: why });
        return false;
    }
    if (pushing.has(id)) {
        slog(id, "pull.skip", { why: "pushing", by: why });
        await postChat(id, [{ role: "event", text: "올리는 중이라 지금은 받지 않아요", payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
        return false;
    }
    if ([...sessions.entries()].some(([k, x]) => k.startsWith(`${id}|`) && x.busy)) {
        slog(id, "pull.skip", { why: "turn_busy", by: why });
        if (why !== "turn")
            pendingSync.add(id);
        return false;
    }
    const dirty = (await T().core.invoke("repo_changed", { id }).catch(() => [])).filter(f => !/^\.dynapse\//.test(f));
    const local = await T().core.invoke("repo_head", { id }).catch(() => null), lastLocal = heads[`${id}#local`];
    // 올리지 않은 커밋 — 마지막으로 맞춘 뒤 새 커밋이 있거나, 한 번도 맞춘 적 없는데 커밋이 있다(처음 만든 기기의 작업을 덮지 않게)
    const unpushed = !!local && local !== lastLocal;
    slog(id, "pull.check", { by: why, remote: short(remote), have: short(heads[id]), dirty: dirty.length, unpushed });
    const say = (text) => postChat(id, [{ role: "event", text, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
    if (why === "discard") {
        // 버리기 전에 이 PC의 장을 보관(#56 보정 9 — "서버 판으로 맞추기 · 내 변경은 이 PC에 보관")
        const kept = dirty.length || unpushed ? await backupLocal(id) : 0;
        await T().core.invoke("repo_discard", { id }).catch(() => { });
        const ok = await exactPull(id);
        slog(id, ok ? "pull.ok" : "pull.fail", { by: why, remote: short(remote), kept });
        if (ok)
            await say(`서버 판으로 맞췄어요 · ${short(remote)}${kept ? ` · 내 장 ${kept}개는 이 PC에 보관했어요(.dynapse/out)` : ""}`);
        return ok;
    }
    // 작업 중인 변경이 있어도 묻지 않는다(#56 보정 10) — 아래에서 내 변경을 커밋·올리고(같은 장은 나중 판) 맞춘다
    if (dirty.length)
        await repoCommit(id, "내 변경 · 새 판 받기 전");
    if (dirty.length || unpushed) { // 내 것을 올린다 — 서버가 빨리 감기로 받거나, 그 사이 판이 바뀌었으면 합쳐서
        const dir = await T().core.invoke("work_dir", { id }).catch(() => null);
        if (dir)
            await pushWork(id, dir).catch(() => { });
        const h2 = (await store.get("remote_heads")) ?? {}, l2 = await T().core.invoke("repo_head", { id }).catch(() => null);
        if (l2 && h2[`${id}#local`] === l2) {
            slog(id, "pull.ok", { by: why, via: "push", head: short(h2[id]) });
            if (why === "take")
                await say(`내 변경을 올리고 새 판과 맞췄어요 · ${short(h2[id])}`);
            return true;
        }
        if (why !== "take")
            return false; // 못 올렸다 — 자동으로는 아무것도 버리지 않는다(카드가 남아 있다)
        const n = await backupLocal(id);
        await T().core.invoke("repo_discard", { id }).catch(() => { });
        const ok = await exactPull(id);
        slog(id, ok ? "pull.ok" : "pull.fail", { by: why, via: "backup", kept: n });
        if (ok)
            await say(`내 장 ${n}개는 이 PC에 보관하고 서버 판으로 맞췄어요 · ${short(remote)}`);
        return ok;
    }
    // 잃을 게 없다 — 묻지 않고 받는다(#56 보정 6 추가)
    const ok = await exactPull(id);
    slog(id, ok ? "pull.ok" : "pull.fail", { by: why, remote: short(remote), via: "clean" });
    if (!ok)
        report("sync", "pull.fail", `work=${id} ${why}`); // 성공은 기록(sync-log)만 — 보고는 실패·합침
    if (ok)
        await say(`새 판을 받았어요 · ${short(remote)}`);
    return ok;
}
// 이 기기가 원본(소유자 계정)인지 — 서버 ?head=1의 origin. 10분 기억. 멤버 기기는 열 때 자동 커밋(차트 다시 그림·줄 맞춤)을 하지 않는다(올릴 수 없는 변경이 쌓인다, ota18)
const originAt = new Map();
export async function isOriginDevice(id) {
    const c = originAt.get(id);
    if (c && Date.now() - c.at < 600_000)
        return c.v;
    const r = await api("GET", `/api/works/${encodeURIComponent(id)}/commits?head=1`).catch(() => null);
    const v = r?.status === 200 ? !!r.data?.origin : true; // 못 물으면 예전처럼(혼자 쓰는 작업)
    originAt.set(id, { v, at: Date.now() });
    return v;
}
export async function syncPending(id) { if (pendingSync.delete(id))
    await syncLatest(id, "notice").catch(() => { }); }
// 못 받은 작업 다시 받기(#56) — 앱 시작·포커스 때. 서버 커밋은 있는데 어느 PC에도 없는 이 계정의 작업. 작업마다 3번까지(그 뒤는 캔버스의 [다시])
let pendingAt = 0;
export async function retryPendingPulls() {
    if (!S.token || Date.now() - pendingAt < 60_000)
        return;
    pendingAt = Date.now();
    const r = await api("GET", `/api/device/pending?device_id=${encodeURIComponent(S.deviceId ?? "")}`).catch(() => null);
    const tries = (await store.get("pull_tries")) ?? {};
    for (const id of (r?.data?.works ?? []).filter(x => WORK_ID.test(x)).slice(0, 5)) {
        if ((tries[id] ?? 0) >= 3)
            continue;
        tries[id] = (tries[id] ?? 0) + 1;
        await store.set("pull_tries", tries);
        await store.save();
        if (await pullWork(id).catch(() => false)) {
            delete tries[id];
            await store.set("pull_tries", tries);
            await store.save();
        }
    }
}
// ───────────── 진행 카드: stream 이벤트 → 사람 말 (#12-V V2) — Claude(stream-json)·Codex(exec --json)·agy(stream-json) 공용 ─────────────
// 결과물에 닿는 도구만 문구로(#22-보정 14). 매핑 없는 도구 = null(로그로). "작업 중"·"기록 정리"·"지시서"·"스타일 규칙" 문구 없음
const PAGE_NAME = { cover: "표지", body: "본문", data: "데이터" };
export function stageFromTool(name, target) {
    const t = target.toLowerCase(), n = name.toLowerCase();
    if (n.includes("generate_image"))
        return "사진 만드는 중 · Gemini";
    if (/(^|\s|\/)agy(\s|$)/.test(t))
        return "사진 만드는 중 · Gemini";
    if (/codex\s+exec/.test(t))
        return "사진 만드는 중 · ChatGPT";
    const write = /write|edit|replace|create|apply|patch/.test(n);
    // 레이아웃 복사로 장 만들기(#45) — `cp materials/card-hook.html result-card-1.html`
    const cp = t.match(/\b(?:cp|copy)\b[^\n]*?result-([a-z0-9-]+)\.html/);
    if (cp)
        return `${PAGE_NAME[cp[1]] ?? cp[1]} 만드는 중`;
    const page = t.match(/(?:^|\/)result-([a-z0-9-]+)\.html(?:\s|$)/);
    if (page && /^(read|view|write|edit|multiedit|replace|create|apply|patch|str_replace_based_edit_tool)$/.test(n.replace(/_file$/, "")))
        return `${PAGE_NAME[page[1]] ?? page[1]} ${write ? "쓰는 중" : "읽는 중"}`;
    if (page && write)
        return `${PAGE_NAME[page[1]] ?? page[1]} 쓰는 중`;
    if (write && /(^|\/)(materials|context\/assets)\/(?:[^/]+\/)?[^/]+\.(png|jpe?g|webp)$/.test(t))
        return "사진 넣는 중";
    return null;
}
// 조용한 도구의 사람 말(#45) — 15초 넘게 소식이 없을 때만 쓴다
export function quietStage(name, target) {
    const t = target.toLowerCase(), n = name.toLowerCase();
    if (/mcp__dynapse__(get_template|recommend_assets|search_assets|get_task|claim_task)/.test(n))
        return /claim_task/.test(n) ? "작업 맡는 중" : "재고 찾는 중";
    if (/tokens\.css/.test(t))
        return "스타일 정리 중";
    if (/(skill|rules|claude\.md|agents\.md|notes\.md|brief|refs\/|context\/)/.test(t) || /^(read|glob|grep|ls)$/.test(n))
        return "자료 살펴보는 중";
    if (/^(bash|run|shell)$/.test(n) || n === "run")
        return "준비 중";
    return null;
}
export const mmss = (ms) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;
// 상태 창 "최근" 3(#12-G) — 작업실 턴이 끝날 때
export async function remember(t, work) {
    S.recent = [{ t, work }, ...S.recent.filter(r => !work || r.work !== work)].slice(0, 5);
    await store.set("recent", S.recent);
    await store.save();
}
// 덱 모티프(#201) — 설정(.dynapse/motif.json) → 모든 장(언어판 포함)의 <style data-deck>. 쓴 장 수
// 주인공 시트 만들기(#304 보정 2 ②) — 사용자 이미지 AI로 시트 한 장 · 앱이 잘라 투명 PNG 넷(materials/hero-1~4) · 장의 data-hero 자리에 · 커밋 한 번(AI 0). 덱당 2장 상한
async function heroMake(id, hf) {
    const H = await import("./hero-sheet.js"), PR = await import("./photo-runner.js"), gens = (hf.gens ?? 0) + 1;
    if (gens > H.HERO_CAP) {
        await postChat(id, [{ role: "agent", text: `주인공 그림은 덱당 ${H.HERO_CAP}장까지예요`, payload: { ai: "dynapse", engine: true } }]).catch(() => { });
        return;
    }
    await wput(id, H.HERO_FILE, JSON.stringify({ ...hf, status: "made", gens, at: Date.now() })).catch(() => { });
    const r = await PR.genHeroSheet(id, H.heroPrompt(hf.brief));
    const fail = async (why) => { await wput(id, H.HERO_FILE, JSON.stringify({ ...hf, status: "fail", gens, at: Date.now() })).catch(() => { }); report("photo", "hero.fail", why); await postChat(id, [{ role: "agent", text: why === "no_ai" ? "주인공 그림을 만들 AI가 연결돼 있지 않아요 · 연결 탭에서 ChatGPT나 Gemini를 켜 주세요" : why === "cut" ? "그림을 네 자세로 나누지 못했어요 · 다시 말하면 한 번 더 만들어요" : "주인공 그림을 만들지 못했어요", payload: { ai: "dynapse", engine: true } }]).catch(() => { }); };
    if ("why" in r)
        return fail(r.why);
    // 바이트 그대로(#314 ⑤ — 10-27 앵커: data URL fetch가 던져 실패 줄 없이 끝났고, 다시 처리된 버튼 글이 AI 턴 두 번(86k)으로 갔다)
    try {
        const buf = await T().core.invoke("work_bytes", { id, file: r.file }).catch(() => null), blob = buf ? new Blob([buf], { type: "image/png" }) : null;
        const parts = blob ? await H.cutSheet(blob).catch(() => null) : null;
        if (!parts || parts.length !== 4)
            return fail("cut");
        const inv = T().core.invoke, files = [];
        for (const [i, png] of parts.entries()) {
            const f = `materials/hero-${i + 1}${gens > 1 ? `-v${gens}` : ""}.png`;
            if (await inv("material_write", png, { headers: { "x-id": id, "x-path": encodeURIComponent(f) } }).then(() => true).catch(() => false))
                files.push(f);
        }
        if (files.length !== 4)
            return fail("write");
        const pages = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(n => PAGE_RE.test(n) || LANG_PAGE.test(n));
        let n = 0;
        for (const f of pages) {
            const h = await wget(id, f).catch(() => null);
            if (!h || !/\bdata-hero\s*=/.test(h))
                continue;
            const x = H.fillHero(h, files);
            if (x.n) {
                n += x.n;
                await wput(id, f, x.html).catch(() => { });
            }
        }
        // 자리(data-hero)가 하나도 없으면 앱이 장마다 스티커 하나(AI 0 · #314 ⑤) — 장 순서대로 자세를 돌려 쓴다
        if (!n) {
            const order = (await readJson(id, ".dynapse/pages.json").catch(() => null)) ?? pages.filter(f => PAGE_RE.test(f));
            for (const f of pages) {
                const base = f.replace(/\.[a-z]{2}\.html$/, ".html"), i = Math.max(0, order.indexOf(base)), h = await wget(id, f).catch(() => null);
                if (!h)
                    continue;
                const x = H.placeHero(h, files[i % 4], i % 4 + 1);
                if (x !== h) {
                    n++;
                    await wput(id, f, x).catch(() => { });
                }
            }
        }
        await wput(id, H.HERO_FILE, JSON.stringify({ ...hf, status: "made", gens, sheet: r.file, poses: files, ai: r.ai, at: Date.now() })).catch(() => { });
        await repoCommit(id, `주인공 그림 · 네 자세${n ? ` · ${n}곳` : ""}`);
        void afterSave(id);
        report("photo", "hero.made", `n=${n} ai=${r.ai}`);
        await postChat(id, [{ role: "agent", text: n ? `주인공 그림 네 자세를 ${n}곳에 넣었어요 · AI 생성 그림이에요` : "주인공 그림 네 자세를 만들었어요 · 넣을 자리를 말하면 그 장에 넣어요", payload: { ai: "dynapse", summary: [`주인공 ${n}곳`], engine: true } }]).catch(() => { });
    }
    catch (e) {
        return fail(`error ${String(e?.message ?? e).slice(0, 60)}`);
    }
}
// 분위기 장식(#303 ④ — mood-deco.ts): .dynapse/mood.json의 장식을 바뀐 장마다 같은 블록으로(AI 0). 표지·마무리(장 순서 처음·끝) = 스티커 제목 자리 · off = 띠를 뗀 장
async function stampMoodDeco(id, only) {
    const D = await import("./mood-deco.js");
    const mf = await readJson(id, D.MOOD_FILE).catch(() => null);
    if (!mf?.id)
        return 0;
    // 시리즈 틀(#304 보정 2 ①): 분위기가 있으면 모든 장에 위 띠(표지 제목 = 라벨 · 쪽수)와 아래 띠(분위기 모티프). 라벨은 그 언어판의 표지 제목
    const decos = D.decosOf(mf.devices ?? []), band = D.bandOf(mf.id, decos), letter = D.letterOf(mf.id), stickers = D.stickersOf(mf.id); // 표지·마무리 레터링(#304 보정 2 ④) · 스티커 모양(③)
    const devices = D.devicesOf(mf.devices ?? []), eng = D.engineStickers(mf.id); // 그로테스크 장치·엔진 스티커(#309 ⑤ — 표지·마무리, AI 0)
    const order = (await readPages(id).catch(() => null)) ?? [], base = (f) => f.replace(/\.[a-z]{2}\.html$/, ".html"), ends = new Set([order[0], order[order.length - 1]].filter(Boolean));
    const names = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(f => PAGE_RE.test(f) || LANG_PAGE.test(f));
    const labels = new Map(), labelFor = async (f) => {
        const lg = f.match(/\.([a-z]{2})\.html$/)?.[1] ?? "", cv = order[0] ? (lg ? order[0].replace(/\.html$/, `.${lg}.html`) : order[0]) : null;
        if (!labels.has(lg))
            labels.set(lg, cv ? D.labelOf((await wget(id, cv).catch(() => null)) ?? "") : "");
        return labels.get(lg);
    };
    let n = 0;
    for (const f of only ? names.filter(x => only.includes(x) || only.includes(base(x))) : names) {
        const h = await wget(id, f).catch(() => null);
        if (!h)
            continue;
        const no = order.indexOf(base(f)) + 1, frame = no > 0 ? { label: await labelFor(f), no, total: order.length } : null;
        const h2 = D.stampMood(h, { decos, band, letter, stickers, frame, cover: ends.has(base(f)), off: (mf.off ?? []).includes(base(f)), devices, eng, offOrn: mf.offOrn?.[base(f)] ?? [] });
        if (h2 !== h) {
            await wput(id, f, h2);
            n++;
        }
    }
    return n;
}
// 앱이 단 띠가 글자와 겹친 장(verify ornament_overlap · fix orn_off) — 그 장은 띠 없이(기록하고 다시 찍는다)
// 띠(frame-top·frame-bottom)나 종류를 모르는 겹침이면 그 장 띠 전체를, 장치·엔진 스티커면 그 장식만 뗀다(#309 ⑤ — 표지 장치 하나가 겹쳐도 틀은 남게)
async function moodBandOff(id, hits) {
    const D = await import("./mood-deco.js"), mf = await readJson(id, D.MOOD_FILE).catch(() => null);
    if (!mf?.id)
        return;
    const b = (f) => f.replace(/\.[a-z]{2}\.html$/, ".html"), whole = hits.filter(x => !x.orn || /^frame-/.test(x.orn)), part = hits.filter(x => !whole.includes(x));
    const off = [...new Set([...(mf.off ?? []), ...whole.map(x => b(x.page))])].slice(-200), offOrn = { ...(mf.offOrn ?? {}) };
    for (const x of part)
        offOrn[b(x.page)] = [...new Set([...(offOrn[b(x.page)] ?? []), String(x.orn).slice(0, 20)])];
    await wput(id, D.MOOD_FILE, JSON.stringify({ ...mf, off, offOrn })).catch(() => { });
    await stampMoodDeco(id, [...new Set(hits.map(x => x.page))]).catch(() => 0);
}
async function stampMotif(id, only) {
    const M = await import("./motif.js");
    const mt = await readJson(id, M.MOTIF_FILE).catch(() => null);
    if (!mt)
        return 0;
    const names = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(f => PAGE_RE.test(f) || LANG_PAGE.test(f));
    let n = 0;
    for (const f of only ? names.filter(x => only.includes(x) || only.includes(x.replace(/\.[a-z]{2}\.html$/, ".html"))) : names) {
        const h = await wget(id, f).catch(() => null);
        if (!h)
            continue;
        const h2 = M.stampDeck(h, mt);
        if (h2 !== h) {
            await wput(id, f, h2);
            n++;
        }
    }
    return n;
}
// 판형 고정(#212 보정 1 — 정사각 카드 덱이 사다리·고침 턴 뒤 16:9 장이 됐다). 판형 = .dynapse/format.json(없으면 장 대다수의 크기로 한 번 정한다).
// 장 크기가 다르면 <style data-format>(section.slide:not(#fm){width;height}) 한 블록으로 되돌린다 — 글·구조는 그대로. 되돌린 장 이름
const FORMAT_FILE = ".dynapse/format.json";
const FRAME_KO = { card: "카드(1:1)", card45: "카드(4:5)", slide: "16:9", a4: "A4", detail: "상세페이지" };
export async function holdFormat(id, only) {
    const names = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(f => PAGE_RE.test(f) || LANG_PAGE.test(f));
    const sizeOf = (h) => { const b = h.replace(/<style\b[^>]*\bdata-format\b[^>]*>[\s\S]*?<\/style\s*>/i, ""), m = b.match(/\.slide(?:\[[^\]]*\])*\s*\{[^}]*?\bwidth\s*:\s*(\d+)px[^}]*?\bheight\s*:\s*(\d+)px/); return m ? [Number(m[1]), Number(m[2])] : null; };
    let fmt = (await readJson(id, FORMAT_FILE).catch(() => null))?.frame ?? "";
    // 인쇄 판(#217): 판형은 장의 data-format="print:<id>" — 크기를 고치지 않고(mm 판) 형식만 적어 둔다(웹 [내보내기]가 인쇄용 PDF를 고른다)
    if (/^print:/.test(fmt) || fmt === "detail")
        return []; // 상세페이지는 높이가 내용만큼(#294 보정 9) — 크기를 되돌리지 않는다
    {
        const first = names[0] ? await wget(id, names[0]).catch(() => null) : null, pf = first?.match(/<section\b[^>]*\bdata-format\s*=\s*["'](print:[a-z0-9_]+)["']/i)?.[1];
        if (pf) {
            await wput(id, FORMAT_FILE, JSON.stringify({ frame: pf })).catch(() => { });
            return [];
        }
    }
    if (!FRAME_PX[fmt]) { // 처음 — 장 대다수의 판(크기가 아니라 비율로 맞춘다, #237)
        const cnt = new Map();
        for (const f of names.slice(0, 30)) {
            const z = sizeOf((await wget(id, f).catch(() => null)) ?? "");
            const k = z ? Object.entries(FRAME_PX).find(([, v]) => Math.abs(v[0] / v[1] - z[0] / z[1]) <= 0.01)?.[0] : undefined;
            if (k)
                cnt.set(k, (cnt.get(k) ?? 0) + 1);
        }
        fmt = [...cnt].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
        if (!fmt)
            return [];
        await wput(id, FORMAT_FILE, JSON.stringify({ frame: fmt })).catch(() => { });
    }
    const [W, H] = FRAME_PX[fmt], fixed = [];
    for (const f of only ? names.filter(x => only.includes(x)) : names) {
        const h = await wget(id, f).catch(() => null);
        if (!h)
            continue;
        const z = sizeOf(h), base = h.replace(/<style\b[^>]*\bdata-format\b[^>]*>[\s\S]*?<\/style\s*>\s*/i, "");
        // 비율로 본다(#237 — 1280×720 덱이 "16:9"라고 1600×900 틀을 덮어써 같은 px 글자가 25% 큰 판에서 ~20% 작아 보였다): 1280×720·1600×900·1920×1080은 모두 16:9 = 그대로.
        // 비율이 정말 다를 때만(카드 덱에 16:9 장 등) 판 크기를 맞춘다. 같은 비율인데 예전에 넣은 data-format 블록은 지운다(다음 턴에 낫는다)
        const need = !!z && Math.abs(z[0] / z[1] - W / H) > 0.01;
        const h2 = need ? base.replace(/<\/head>/i, `<style data-format>section.slide:not(#fm),.slide:not(#fm){width:${W}px;height:${H}px}</style></head>`) : base;
        if (h2 !== h) {
            await wput(id, f, h2);
            if (need && !/\bdata-format\b/.test(h.match(/<style\b[^>]*\bdata-format\b[^>]*>[\s\S]*?<\/style>/i)?.[0] ?? ""))
                fixed.push(f);
            if (!need)
                report("turn", "format.heal", `${f} ${z?.join("x")}`);
        }
    }
    if (fixed.length)
        report("turn", "format.hold", `frame=${fmt} n=${fixed.length} to=${W}x${H}`);
    return fixed;
}
// 조금 옮기기(#236 ①) — 방향 말·N px → 그 요소의 <style data-tweaks> translate(앞 값에 더한다) · 커밋 한 번 · "24px 내렸어요 [더 내리기][되돌리기]"
const NUDGE = /^(?:[^\s\d]{1,8}\s+){0,2}?(?:(조금|살짝|약간|좀|조금만|살짝만)\s*(?:더\s*)?)?(?:(\d{1,3})\s*(?:px|픽셀)?\s*)?(아래|밑|위|왼쪽|오른쪽)?\s*(?:으로|로)?\s*(내려|올려|옮겨|밀어|당겨)?\s*(?:줘|주세요|봐)?[.!~요]*$/;
export async function nudgeSay(id, text, pt) {
    const m = text.match(NUDGE);
    if (!m || !pt?.file || !pt.selector || /^section/.test(pt.selector))
        return false;
    const [, soft, num, where, verb] = m;
    if (!soft && !num)
        return false;
    const dir = where === "위" || verb === "올려" ? "up" : where === "왼쪽" ? "left" : where === "오른쪽" ? "right" : where === "아래" || where === "밑" || verb === "내려" ? "down" : null;
    if (!dir)
        return false;
    const n = Math.min(400, Number(num ?? 24)), h = await wget(id, pt.file).catch(() => null);
    if (!h)
        return false;
    const sel = pt.selector, TW = /(<style\b[^>]*\bdata-tweaks\b[^>]*>)([\s\S]*?)(<\/style\s*>)/i, body0 = h.match(TW)?.[2] ?? "";
    const key = `${sel}:not(#tw)`, esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), prev = body0.match(new RegExp(`${esc}\\{translate:\\s*(-?\\d+)px\\s+(-?\\d+)px\\}`));
    const x = Number(prev?.[1] ?? 0) + (dir === "left" ? -n : dir === "right" ? n : 0), y = Number(prev?.[2] ?? 0) + (dir === "up" ? -n : dir === "down" ? n : 0);
    const body = body0.replace(new RegExp(`${esc}\\{translate:[^}]*\\}\\n?`, "g"), "") + `${key}{translate:${x}px ${y}px}\n`;
    const h2 = TW.test(h) ? h.replace(TW, (_a, o, _b, c) => `${o}${body}${c}`) : h.replace(/<\/head>/i, `<style data-tweaks>${body}</style></head>`);
    await wput(id, pt.file, h2);
    if (S.git)
        await repoCommit(id, `조금 옮김 · ${pageLabel(pt.file)}`);
    void afterSave(id);
    const say = { down: "내렸어요", up: "올렸어요", left: "왼쪽으로 옮겼어요", right: "오른쪽으로 옮겼어요" }[dir], more = { down: "더 내리기", up: "더 올리기", left: "더 왼쪽", right: "더 오른쪽" }[dir];
    report("turn", "tw.moved", `${dir} ${n}`);
    await postChat(id, [{ role: "event", text: `${n}px ${say}`, payload: { kind: "nudge", ai: "dynapse", more, again: text.replace(/\d{1,3}\s*(px|픽셀)?/, "").trim() || "조금 더", points: [pt] } }]).catch(() => { });
    return true;
}
// 짚은 글의 단순한 말(#299 ④ — "한 줄로"·"조금 크게"·"왼쪽 정렬"이 AI 턴으로 가 30초를 썼다): 문장 전체가 그 말 하나면 그 요소의 data-tweaks에 사용자 값으로(AI 0 · ⌘Z 한 번).
// 크기는 zoom을 곱한다(em은 부모 기준이라 제 크기가 아니다). 한 줄은 nowrap — 넘치면 verify 줄 맞춤이 맞춘다. 다른 말이 섞이면(예: "한 줄로 하고 CTO 추가") AI로
const PIN_SAY = /^(?:(?:이|이거|이\s*줄|이\s*글|여기)\s*)?(?:(한\s*줄로|한\s*줄에)|(?:(조금|약간|살짝|훨씬|많이)\s*)?(?:더\s*)?(크게|키워|작게|줄여)|(왼쪽|가운데|오른쪽)\s*(?:으로\s*|로\s*)?정렬)\s*(?:해\s*줘|해줘|해\s*주세요|만들어\s*줘|요)?[.!~ ]*$/;
export async function pinTextSay(id, text, pt) {
    const m = text.trim().match(PIN_SAY);
    if (!m || !pt?.file || !pt.selector || pt.container || /^section|\.slide\b/.test(pt.selector))
        return false;
    const [, oneLine, how, size, align] = m;
    const h = await wget(id, pt.file).catch(() => null);
    if (!h)
        return false;
    const TW = /(<style\b[^>]*\bdata-tweaks\b[^>]*>)([\s\S]*?)(<\/style\s*>)/i, body0 = h.match(TW)?.[2] ?? "", key = `${pt.selector}:not(#tw)`, esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const prevRule = body0.match(new RegExp(`${esc}\\{([^}]*)\\}`))?.[1] ?? "", decl = Object.fromEntries(prevRule.split(";").map(x => x.split(":").map(y => y.trim())).filter(x => x.length === 2 && x[0]));
    let say;
    if (oneLine) {
        decl["white-space"] = "nowrap";
        say = "한 줄로 했어요";
    }
    else if (size) {
        const up = /크게|키워/.test(size), k = /훨씬|많이/.test(how ?? "") ? 1.3 : 1.15, z = Math.max(0.5, Math.min(3, Number(decl.zoom ?? 1) * (up ? k : 1 / k)));
        decl.zoom = z.toFixed(3);
        say = up ? `${Math.round(z * 100)}%로 키웠어요` : `${Math.round(z * 100)}%로 줄였어요`;
    }
    else {
        decl["text-align"] = align === "왼쪽" ? "left" : align === "오른쪽" ? "right" : "center";
        say = `${align} 정렬했어요`;
    }
    const rule = `${key}{${Object.entries(decl).map(([k, v]) => `${k}:${v}`).join(";")}}`;
    const body = body0.replace(new RegExp(`${esc}\\{[^}]*\\}\\n?`, "g"), "") + `${rule}\n`;
    const h2 = TW.test(h) ? h.replace(TW, (_a, o, _b, c) => `${o}${body}${c}`) : h.replace(/<\/head>/i, `<style data-tweaks>${body}</style></head>`);
    await wput(id, pt.file, h2);
    if (S.git)
        await repoCommit(id, `${say} · ${pageLabel(pt.file)}`);
    void afterSave(id);
    report("turn", "tw.pin_say", `${oneLine ? "oneline" : size ? "size" : "align"}`);
    await postChat(id, [{ role: "event", text: `${pageLabel(pt.file)} · ${say} · ⌘Z로 되돌리기`, payload: { kind: "nudge", ai: "dynapse", points: [pt] } }]).catch(() => { });
    return true;
}
export async function applyMotif(id, patch, say) {
    const M = await import("./motif.js");
    const cur = (await readJson(id, M.MOTIF_FILE).catch(() => null)) ?? M.MOTIF_DEFAULT, next = { ...cur, ...patch };
    await wput(id, M.MOTIF_FILE, JSON.stringify(next, null, 1));
    const n = await stampMotif(id);
    if (S.git)
        await repoCommit(id, `쪽 번호 · 모든 장 ${n}`);
    void afterSave(id);
    report("turn", "motif.deck", `n=${n} size=${next.size} corner=${next.corner}${next.off ? " off" : ""}`);
    await postChat(id, [{ role: "event", text: `${say ?? "쪽 번호를 바꿨어요"} · 모든 장 ${n}장`, payload: { kind: "stage", ai: "dynapse" } }]);
}
// 덱 모티프 말 — 처리했으면 true(턴 없음). 모티프가 없는 덱이면 false(보통 턴으로)
async function motifSay(id, text, pts, selPage) {
    const M = await import("./motif.js");
    const cur = (await readJson(id, M.MOTIF_FILE).catch(() => null)) ?? M.MOTIF_DEFAULT;
    const mt = M.motifTurn(text, cur);
    if (!mt)
        return false;
    const pages = (await readPages(id).catch(() => null)) ?? [];
    let has = false;
    for (const f of pages.slice(0, 40))
        if (/\bdata-motif\b/.test((await wget(id, f).catch(() => null)) ?? "")) {
            has = true;
            break;
        }
    if (!has)
        return false;
    if (mt.onlyPage) { // 📍 + "이 장만" — 그 장 조절 블록에만
        const page = (pts[0]?.file ?? selPage ?? "").replace(/\.[a-z]{2}\.html$/, ".html");
        if (!PAGE_RE.test(page))
            return false;
        const h = await wget(id, page).catch(() => null);
        if (!h || !/\bdata-motif\b/.test(h))
            return false;
        const rule = `[data-motif]:not(#tw){${M.pageOnlyRule(mt.next)}}`, TW = /(<style\b[^>]*\bdata-tweaks\b[^>]*>)([\s\S]*?)(<\/style\s*>)/i;
        const body = (h.match(TW)?.[2] ?? "").replace(/\[data-motif\]:not\(#tw\)\{[^}]*\}\n?/g, "") + rule + "\n";
        const h2 = TW.test(h) ? h.replace(TW, (_a, o, _b, c) => `${o}${body}${c}`) : h.replace(/<\/head>/i, `<style data-tweaks>${body}</style></head>`);
        await wput(id, page, h2);
        if (S.git)
            await repoCommit(id, `쪽 번호 · ${pageLabel(page)}만`);
        void afterSave(id);
        await postChat(id, [{ role: "event", text: `${mt.say.replace("쪽 번호를", `${pageLabel(page)} 쪽 번호를`)} · 이 장만`, payload: { kind: "stage", ai: "dynapse" } }]);
        return true;
    }
    await applyMotif(id, mt.next, mt.say);
    return true;
}
const seqReward = new Map();
const SEQ_PLAN = "[Reward plan turn: in this turn write only .dynapse/plan.json — for every page in the brief's order: page (its result file name), form, title, the facts it uses, and, if it has a photo, photo_slot and photo (a one-line photo request). Do not write or edit any result page; do not upload or submit. At most 2 search_assets/recommend_assets calls in total. End the turn as soon as plan.json is saved.]\n";
// 묶음 장 턴(#214 보정 3 — 장마다 한 턴은 6장에 90~100k·9~10분이었다): 첫 장(표지·훅)·마지막 장(마무리)은 혼자, 가운데 장은 2~3장씩 고르게 한 턴.
// 첫 판(재시도)은 묶지 않는다. 저장은 장마다(한 장 쓰고 저장 → 다음 장), 4분 규칙은 묶음에, 건너뛰기는 장 단위
export function seqGroup(pages, i, retried) {
    const n = pages.length;
    if (retried || i === 0 || i >= n - 1 || n <= 3)
        return [pages[i]];
    const m = n - 2, k = Math.ceil(m / 3), sizes = Array.from({ length: k }, (_, j) => Math.floor(m / k) + (j < m % k ? 1 : 0));
    let at = 1;
    for (const sz of sizes) {
        if (i < at + sz)
            return pages.slice(i, at + sz);
        at += sz;
    }
    return [pages[i]];
}
// 시험 고리(turn-sim) — 순서 시작·못 쓴 장 표시·상태
export const seqStart = (id, taskId) => { seqReward.set(id, { taskId, phase: "plan", pages: [], i: 0, skipped: [], retried: false, t0: Date.now() }); };
export const seqSkip = (id, file) => { seqReward.get(id)?.skipped.push(file); };
export const seqState = (id) => { const q = seqReward.get(id); return q ? { phase: q.phase, i: q.i, n: q.pages.length, cur: q.cur ?? null, retried: q.retried } : null; };
export async function seqNext(id) {
    const q = seqReward.get(id);
    if (!q)
        return;
    if (q.phase === "plan") {
        const pl = await readJson(id, ".dynapse/plan.json").catch(() => null);
        const files = [...new Set((pl?.pages ?? []).map(p => p.page ?? "").filter(f => PAGE_RE.test(f)))];
        const pages = files.length ? files : ((await readPages(id).catch(() => null)) ?? []);
        if (!pages.length) {
            seqReward.delete(id);
            report("turn", "turn.seq_noplan", "");
            void simOrSend()(id, "[Reward: build every page now as the first message says.]", { route: q.route });
            return;
        }
        q.phase = "pages";
        q.pages = pages;
        q.i = 0;
        const reqs = (pl?.pages ?? []).filter(p => p.page && PAGE_RE.test(p.page) && p.photo_slot && /^[a-z0-9_]{1,40}$/i.test(p.photo_slot) && (p.photo ?? "").trim()).map(p => ({ file: p.page, slot: p.photo_slot, brief: String(p.photo).slice(0, 400) }));
        if (reqs.length) {
            await wput(id, ".dynapse/photo-requests.json", JSON.stringify(reqs, null, 1)).catch(() => { });
            void runPhotoRequests(id, q.route, { reward: true }).catch(() => []);
        } // 사진은 계획 바로 뒤(장 턴과 함께 돈다)
    }
    if (q.i < q.pages.length) {
        const grp = seqGroup(q.pages, q.i, q.retried), n = q.pages.length, file = grp[0];
        q.cur = file;
        q.curs = grp;
        q.i += grp.length;
        const left = ((await readJson(id, ".dynapse/photo-making.json").catch(() => null)) ?? []).length;
        await postChat(id, [{ role: "event", text: `장 만드는 중 · ${grp.length > 1 ? `${q.i - grp.length + 1}~${q.i}` : q.i}/${n}${left ? ` · 사진 ${left}장 오는 중` : ""}`, payload: { kind: "stage", ai: "dynapse" } }]);
        const plan = ((await readJson(id, ".dynapse/plan.json").catch(() => null))?.pages ?? []);
        const lay = plan.find(p => p.page === file);
        if (grp.length === 1)
            void simOrSend()(id, `${REWARD_PAGE_HEAD}[Reward page turn ${q.i}/${n}: write only ${file} now — follow .dynapse/plan.json for this page (form${lay?.form ? ` ${lay.form}` : ""}, title, facts)${lay?.layout ? ` and materials/${lay.layout}.html` : ""}; keep the deck tokens and the page size. Do not touch other pages; do not upload or submit. Request a photo in .dynapse/photo-requests.json only if the plan has none for this page. End the turn as soon as the page is saved.]`, { route: q.route });
        else {
            const lays = [...new Set(grp.map(f => plan.find(p => p.page === f)?.layout).filter(Boolean))];
            void simOrSend()(id, `${REWARD_PAGE_HEAD}[Reward page turn ${q.i - grp.length + 1}–${q.i}/${n}: write only ${grp.join(", ")} now, one page at a time — write and save each page before starting the next. Follow .dynapse/plan.json for each (form, title, facts)${lays.length ? ` and materials/${lays.join(".html, materials/")}.html` : ""}; keep the deck tokens and the page size. Do not touch other pages; do not upload or submit. Request a photo in .dynapse/photo-requests.json only if the plan has none for that page. End the turn as soon as the last page is saved.]`, { route: q.route });
        }
        return;
    }
    if (q.skipped.length && !q.retried) {
        q.pages = q.skipped;
        q.skipped = [];
        q.i = 0;
        q.retried = true;
        return seqNext(id);
    } // 못 쓴 장은 끝에 한 번 더
    for (const f of q.skipped)
        report("turn", "turn.page_fallback", f); // 그래도 못 쓴 장 = 미리 채운 장 그대로
    // 장 턴이 그 장을 통째로 다시 쓰며 먼저 온 사진을 지웠으면 — 만든 사진(slots.json)을 빈 칸에 다시 놓는다(AI 0)
    {
        const P = await import("./photo-runner.js"), slots = await P.readSlots(id).catch(() => ({}));
        for (const [k, file] of Object.entries(slots)) {
            const dot = k.indexOf(".");
            if (dot < 1)
                continue;
            const page = `result-${k.slice(0, dot)}.html`, slot = k.slice(dot + 1);
            const h = await wget(id, page).catch(() => null);
            if (h && /^[a-z0-9_]{1,40}$/i.test(slot) && !P.slotSrc(h, slot) && new RegExp(`data-slot\\s*=\\s*["']${slot}["']`).test(h)) {
                const kid = ((await readJson(id, ".dynapse/TRACE.json").catch(() => null))?.children ?? []).filter(c => c.page === page && c.slot === slot).at(-1);
                await P.placePhoto(id, page, slot, file, { runtime: kid?.runtime ?? "codex" }).catch(() => []);
            }
        }
    }
    seqReward.delete(id);
    report("turn", "reward.seq_done", `n=${q.pages.length} s=${Math.round((Date.now() - q.t0) / 1000)}`);
    setTimeout(() => { active++; void submitReward(id, q.taskId).finally(() => { active--; }); }, 0);
}
// 리워드 먼저 맡기(#205) — 이 작업에 남은 그 Task의 Claim은 놓고 새로 맡는다. 성공 = 턴 머리(nonce·업로드 자리, AI는 claim_task를 부르지 않는다) ·
// 19+ 확인 없음 = 작업실 카드(adult-ask)를 띄우고 "held"(확인되면 adult-ok가 같은 요청을 이어서) · 서버 일시 오류 = 3초 뒤 한 번 더, 그래도 안 되면 null(예전 길 — 막지 않는다)
const heldAdult = new Map();
async function claimFirst(id, taskId, m) {
    const st = await mcp("my_status").catch(() => null);
    for (const k of st?.data?.claims ?? [])
        if (k.task_id === taskId && k.status === "active" && k.claim_nonce)
            await mcp("release_claim", { claim_nonce: k.claim_nonce }).catch(() => null);
    for (let t = 0; t < 2; t++) {
        const c = await mcp("claim_task", { task_id: taskId, work_id: id }).catch(() => null);
        if (c?.data?.claim_nonce) {
            report("turn", "reward.claim_first", `task=${taskId}`);
            return `[The app already claimed this reward task — claim: ${JSON.stringify(c.data).slice(0, 4000)}. Never call claim_task yourself; use this claim_nonce and these upload slots for the upload and submit_work.]\n`;
        }
        const why = c?.text ?? "";
        if (/19\+|self-confirmation/i.test(why)) {
            heldAdult.set(id, m);
            report("turn", "reward.adult_ask", `task=${taskId}`);
            return "held";
        } // 카드는 서버가 작업실에(work_id) — 둘 띄우지 않는다
        if (t === 0 && /try again|busy|잠시 뒤/i.test(why)) {
            await new Promise(r => setTimeout(r, 3000));
            continue;
        }
        report("turn", "reward.claim_fail", why.slice(0, 120));
        break;
    }
    return null;
}
// 사진 카드의 길(#199 ③) — [이 PC 엔진 받기]: 받기(뒤에서 도는 줄) → 준비되면 기다리던 사진 작업·칸을 이 PC로 그대로
async function photoEngine(id) {
    const P = await import("./photo-runner.js"), w = P.engineWay();
    if (!w.ok) {
        await postChat(id, [{ role: "event", text: w.why ?? "이 PC에 맞는 엔진이 없어요", payload: { kind: "stage", ai: "local" } }]);
        return;
    }
    if (!w.ready)
        await postChat(id, [{ role: "event", text: "이 PC 엔진 받는 중 · 한 번만 · 끝나면 이어서 만들어요", payload: { kind: "stage", ai: "local", hop: true } }]);
    if ((await P.ensureLocalPhoto(id)) !== "ready")
        return; // 못 받으면 뒤에서 도는 줄이 이유를 남긴다
    for (const x of waiting.filter(v => v.id === id && v.photo === "")) {
        waiting.splice(waiting.indexOf(x), 1);
        const prev = photoQueue.get(id) ?? Promise.resolve(), next = prev.then(() => runPhotoTurn(id, x.text, { route: x.opts.route, resume: true })).catch(() => { });
        photoQueue.set(id, next);
        await next;
    }
    if (P.needSlots.has(id)) {
        const rt = P.needSlots.get(id);
        P.needSlots.delete(id);
        await P.runPhotoRequests(id, rt, { pending: true }).catch(() => []);
    }
}
// [사진 없이 계속] — 기다리던 사진을 놓고, 빈 칸·색면 칸인 장은 그 레이아웃의 nophoto 변형으로(있을 때). 재고 사진이 든 칸은 그대로
async function photoSkip(id) {
    const P = await import("./photo-runner.js");
    for (const x of waiting.filter(v => v.id === id && v.photo === ""))
        waiting.splice(waiting.indexOf(x), 1);
    P.needSlots.delete(id);
    const pend = (await readJson(id, ".dynapse/photo-pending.json").catch(() => null)) ?? [];
    await wput(id, ".dynapse/photo-pending.json", "[]\n");
    const idx = ((await tierBundles().catch(() => null))?.index ?? {});
    const kids = (await readJson(id, ".dynapse/TRACE.json").catch(() => null))?.children ?? [];
    const changed = [];
    for (const page of [...new Set(pend.map(p => p.file).filter((f) => !!f && PAGE_RE.test(f)))].slice(0, 40)) {
        const h = await wget(id, page).catch(() => null);
        if (!h)
            continue;
        const sec = h.match(/<section\b[^>]*>/i)?.[0] ?? "", lay = sec.match(/\bdata-layout\s*=\s*["']([a-z0-9-]+)/i)?.[1];
        if (!lay || !(idx[lay]?.nophoto || /\[data-variant[~*]?=\s*["']?nophoto/.test(h)) || /\bdata-variant\s*=/i.test(sec))
            continue; // 색인이 없으면 장 자신의 CSS(레이아웃 표본은 nophoto 규칙을 싣는다)
        const bare = pend.filter(p => p.file === page && p.slot).every(p => { const src = P.slotSrc(h, p.slot); return !src || kids.some(c => c.page === page && c.slot === p.slot && c.runtime === "abstract"); });
        if (!bare)
            continue;
        await wput(id, page, h.replace(sec, sec.replace(/^<section\b/i, '<section data-variant="nophoto"')));
        changed.push(page);
    }
    if (changed.length) {
        await syncLangs(id, changed).catch(() => []);
        if (S.git)
            await repoCommit(id, `사진 없이 · ${changed.length}장`);
        void afterSave(id);
    }
    await postChat(id, [{ role: "event", text: changed.length ? `사진 없이 이어서요 · ${changed.length}장은 사진 없는 모양으로` : "사진 없이 이어서요 · 사진 AI를 연결하면 그때 만들어요", payload: { kind: "stage", ai: "dynapse" } }]);
}
// 연결 전에 온 메시지(#20) — 대화 AI가 로그인되면(상태 자동 감지) 그대로 다시 보낸다. 사용자가 다시 보낼 필요 없음
export const waiting = [];
const photoQueue = new Map();
// 기다리는 요청 꺼내기(#142 추가 5 — 이 PC로 넘길 때). take=false면 보기만. 사진 작업은 빼고(사진 AI가 필요)
export function waitingTake(take) { const xs = waiting.filter(w => w.photo === undefined); if (take)
    for (const w of xs)
        waiting.splice(waiting.indexOf(w), 1); return xs; }
export async function replayWaiting() {
    const ready = (S.tools.claude.installed && S.tools.claude.loggedIn !== false) || (S.tools.codex.installed && S.tools.codex.loggedIn !== false);
    // 사진 작업은 사진 AI 로그인으로 재생(#22)
    // 같은 작업·같은 문장은 한 번만, 작업마다 차례로(#29 C7 — 재연결 때 같은 사진을 여러 번 만들던 것)
    const seen = new Set();
    for (const w of waiting.filter(x => x.photo !== undefined && anyPhotoReady())) {
        waiting.splice(waiting.indexOf(w), 1);
        const k = `${w.id}|${w.text}`;
        if (seen.has(k))
            continue;
        seen.add(k);
        await postChat(w.id, [{ role: "event", text: ONB.connected, payload: { kind: "stage", ai: "dynapse" } }]);
        const prev = photoQueue.get(w.id) ?? Promise.resolve();
        const next = prev.then(() => runPhotoTurn(w.id, w.text, { route: w.opts.route, taskId: w.photo || null, ...(w.photo ? {} : { resume: true }) })).catch(() => { }); // 같은 요청 그대로(#199 — 다시 쌓지 않는다)
        photoQueue.set(w.id, next);
    }
    // 사진 AI가 없어 재고로 둔 칸(#199) — 사진 AI가 연결되면 같은 칸들을 그 AI로
    if (anyPhotoReady()) {
        const { needSlots, runPhotoRequests } = await import("./photo-runner.js");
        for (const [wid, rt] of [...needSlots]) {
            needSlots.delete(wid);
            await postChat(wid, [{ role: "event", text: ONB.connected, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
            void runPhotoRequests(wid, rt, { pending: true }).catch(() => []);
        }
    }
    if (!ready || !waiting.some(x => x.photo === undefined))
        return;
    for (const w of waiting.splice(0).filter(x => x.photo === undefined)) {
        await postChat(w.id, [{ role: "event", text: ONB.connected, payload: { kind: "stage", ai: "dynapse" } }]);
        await chatSend(w.id, w.text, w.opts);
    }
}
// 내 Claude의 Google Drive 커넥터(claude.ai 커넥터가 Claude Code에 보인다) — `claude mcp list`를 5분 기억. ok | needs-auth | missing | unknown
let driveMemo = null;
export async function driveConnector(fresh = false) {
    const d = await driveConnectors(fresh);
    return d.claude === "ok" || d.codex === "ok" ? "ok" : d.claude === "needs-auth" ? "needs-auth" : d.claude === "unknown" && d.codex === "unknown" ? "unknown" : "missing";
}
let drivesMemo = null;
let claudeConnectorsMemo = [];
export async function claudeConnectors() { await driveConnectors(); return claudeConnectorsMemo; }
export async function driveConnectors(fresh = false) {
    if (!fresh && drivesMemo && Date.now() - drivesMemo.at < 5 * 60_000)
        return drivesMemo.v;
    const [c, x] = await Promise.all([
        S.tools.claude?.installed ? exec("claude", ["mcp", "list"]).catch(() => null) : Promise.resolve(null),
        S.tools.codex?.installed ? exec("codex", ["mcp", "list"]).catch(() => null) : Promise.resolve(null),
    ]);
    // 연결된 claude.ai 커넥터 전부(2026-10-09 대표 "메일도 Claude에 커넥트해서 읽을 수 있는데") — "claude.ai Gmail: … - ✔ Connected" → mcp__claude_ai_Gmail
    if (c && c.code === 0)
        claudeConnectorsMemo = (c.stdout ?? "").split("\n").map(l => l.match(/^claude\.ai ([^:]+):.*(✔|connected)/i)).filter((m) => !!m && !/needs auth/i.test(m.input ?? ""))
            .map(m => ({ name: m[1].trim(), tool: `mcp__claude_ai_${m[1].trim().replace(/[^A-Za-z0-9]+/g, "_")}` })).filter(x => !/^(Claude Docs|Dynapse)$/i.test(x.name)).slice(0, 12); // 우리 Dynapse는 작업 세션에 이미(mcp__dynapse)
    const cl = (c?.stdout ?? "").split("\n").find(l => /google drive/i.test(l)) ?? "";
    const claude = !c || c.code !== 0 ? "unknown" : !cl ? "missing" : /✔|connected/i.test(cl) && !/needs auth/i.test(cl) ? "ok" : "needs-auth";
    const xl = (x?.stdout ?? "").split("\n").find(l => /\b(g(oogle)?[-_ ]?drive|gdrive)\b/i.test(l)) ?? "";
    const codex = !x || x.code !== 0 ? "unknown" : !xl ? "missing" : /\benabled\b/i.test(xl) ? "ok" : "needs-auth";
    drivesMemo = { at: Date.now(), v: { claude, codex } };
    return drivesMemo.v;
}
// 커넥터 연결 기다리기 — 카드를 띄운 뒤 5초마다 다시 확인(15분). 연결되면 상태 카드 + 들고 있던 요청을 이어서 실행
const held = new Map();
const watching = new Set();
async function watchConnector(work) {
    if (watching.has(work))
        return;
    watching.add(work);
    try {
        for (let i = 0; i < 180 && held.has(work); i++) {
            await new Promise(r => setTimeout(r, 5000));
            if ((await driveConnector(true)) === "ok") {
                await postConnectorStatus(work, false, "ok");
                await resumeHeld(work);
                return;
            }
        }
    }
    finally {
        watching.delete(work);
    }
}
async function resumeHeld(work) {
    const m = held.get(work);
    if (!m)
        return;
    held.delete(work);
    await postChat(work, [{ role: "event", text: "Google Drive가 연결됐어요 · 요청을 이어서 할게요", payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
    await handleChat(m);
}
async function postConnectorStatus(work, fresh, v0) {
    const both = await driveConnectors(fresh && !v0);
    const drive = v0 ?? (both.claude === "ok" || both.codex === "ok" ? "ok" : both.claude);
    await postChat(work, [{ role: "event", text: null, payload: { kind: "connector-status", ai: "dynapse", drive, via: both.claude === "ok" ? "claude" : both.codex === "ok" ? "chatgpt" : null, claude: both.claude, codex: both.codex, downloads: true } }]).catch(() => { });
}
