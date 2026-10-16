// 작업실 대화 엔진 (WORKORDER #14 · #20) — 앱의 실행 경로는 이것 하나: 메시지 수신 → 세션 확보 → stdin → 이벤트 배치 → 턴 종료(검증·버전·사진·동기화).
// 한 작업 = 살아 있는 Claude Code 세션 하나(Codex는 메시지마다 exec/resume). 사진은 에이전트가 지침대로 agy를 직접 부른다(앱 안 사진 호출 없음)
import { CHAT_FLUSH_MS } from "./limits.js";
import { flushReports, report, tally } from "./report.js";
import { localReady } from "./engines.js";
import { LAYOUT_REGISTRY } from "./shared/layout-registry.js";
import { CODEX_UNSUP, codexModelOk, markCodexUnsupported, PAGE_RE, anyPhotoReady, genSlotPhoto, nextMaterial, pageKey, photoReady, placePhoto, readSlots, resolvePage, photoStats, runPhotoRequests, runPhotoTurn, setSlotImg, slotKey, stopAnswer, editionsOf } from "./photo-runner.js";
import { diagAuto, diagReport } from "./diag.js";
import { importArticle } from "./article.js";
import { HUB, MCP_URL, S, T, WORK_ID, agyLogin, api, deviceBody, exec, http, mcp, openLogin, render, spawn, store, switchAccount } from "./main.js";
export const AI_LABEL = { claude: "Claude", chatgpt: "ChatGPT", gemini: "Gemini" };
export let skillCache = null;
let skillAt = 0;
// 지침은 10분마다 다시 확인(#54 D18 — 예전엔 앱 세션 동안 메모리 사본만 써서 지침을 바꿔도 재시작 전엔 옛 것). 바뀌었을 때만 저장
// 등급별 지침 묶음(#123) — hub skills/bundles/{light,normal,heavy}.md. 받으면 CLAUDE.md = 가벼움(+ 안내), .dynapse/skill-normal|heavy.md = 큰 묶음. 못 받으면 예전처럼 전체를 CLAUDE.md로
export let TIER_BUNDLES = null;
let bundleAt = 0;
async function tierBundles() {
    if (TIER_BUNDLES && Date.now() - bundleAt < 600_000)
        return TIER_BUNDLES;
    const got = {};
    for (const n of ["light", "normal", "heavy"]) {
        const r = await http("GET", `${HUB}/skills/bundles/${n}.md`).catch(() => null);
        if (r?.status === 200 && r.body.startsWith("#"))
            got[n] = r.body;
    }
    if (got.light && got.normal && got.heavy) {
        TIER_BUNDLES = got;
        bundleAt = Date.now();
        await store.set("tier_bundles", got);
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
export const wput = (id, file, text) => T().core.invoke("work_write", { id, file, text });
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
export async function readJson(id, file) { const r = await wget(id, file); try {
    return r ? JSON.parse(r) : null;
}
catch {
    return null;
} }
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
    if (verifyCache)
        await wput(id, ".dynapse/verify.mjs", verifyCache).catch(() => { });
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
            if (miss)
                out.push({ page, rule: "glyph", msg: `'${[...miss].slice(0, 3).join("")}' ${[...miss].length}자를 ${label} 폰트(${f.name})가 못 그려요 · 글꼴 패널에서 바꿔 주세요` });
        }
        if (glyphMemo.size > 400)
            glyphMemo.clear();
        glyphMemo.set(key, out.slice(mark));
    }
    return out;
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
const ORDER_HEAD = "[Reorder request. Write the complete new page order to .dynapse/pages.json as a JSON array of the existing result-*.html names (every page now in it, each once). Do not edit, add, delete or rename page files — the app renumbers the pages. Reply in Korean, one line per moved page: \"file → position · why\".]\n";
export async function normalizeOrder(id, wanted, fresh) {
    const files = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(f => PAGE_RE.test(f));
    if (!files.length)
        return null;
    const prev = wanted ?? (await readJson(id, ".dynapse/pages.json"));
    const arr = Array.isArray(prev) ? [...new Set(prev.filter((x) => typeof x === "string"))] : [];
    const app = (await readJson(id, ".dynapse/appendix.json")) ?? [];
    const appx = Array.isArray(app) ? app.filter(f => files.includes(f)) : [];
    const main = arr.filter(f => files.includes(f) && !appx.includes(f));
    // 순서 파일에 없는 장 — 이번 턴에 새로 생긴(fresh) 장만 넣는다. 나머지는 옛 장(#98 보정 1 stale_pages: 순서·쪽번호에서 빠지고 검사가 알린다)
    const stale = (f) => !wanted && Array.isArray(prev) && !!fresh && !fresh.includes(f);
    for (const f of files.filter(f => !main.includes(f) && !appx.includes(f) && !stale(f)).sort((a, b) => (orderKey(a) ?? 1e7) - (orderKey(b) ?? 1e7) || a.localeCompare(b))) {
        const k = orderKey(f);
        let at = main.length;
        if (k !== null) {
            const i = main.findIndex(x => { const kx = orderKey(x); return kx !== null && kx > k; });
            if (i >= 0)
                at = i;
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
    if (wanted || JSON.stringify(order) !== prevJson)
        await wput(id, ".dynapse/pages.json", JSON.stringify(order)).catch(() => { });
    const pad = (n) => String(n).padStart(2, "0"), N = order.length;
    // 언어판도 같은 번호로(#139 B — 장을 지운 뒤 원문은 40, 한국어판은 41로 남아 "쪽번호 분모가 장마다 달라요")
    const allNames = (await T().core.invoke("work_files", { id }).catch(() => [])).map(x => x.name);
    for (const [i, f] of order.entries()) {
        const stem = f.replace(/\.html$/, "");
        for (const g of [f, ...allNames.filter(n => n.startsWith(`${stem}.`) && LANG_PAGE.test(n) && n.replace(/\.[a-z]{2}\.html$/, ".html") === f)]) {
            const h = await wget(id, g);
            if (!h)
                continue;
            const out = h.replace(/(<[a-z][a-z0-9]*\b[^>]*\bdata-slot\s*=\s*["']page_no["'][^>]*>)([^<]*)(<)/i, (_m, a, _t, c) => `${a}${pad(i + 1)} / ${pad(N)}${c}`);
            if (out !== h)
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
async function postChecks(id, v, pages, noRender) {
    if (v.engine !== "node")
        return;
    const names = pages?.length ? pages : (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(f => /^result-[a-z0-9-]+\.html$/.test(f));
    const rules = noRender ? CHECK_STATIC : [...CHECK_RENDER, ...CHECK_STATIC];
    const items = [...(v.errors ?? []), ...(v.warnings ?? [])].filter(x => rules.includes(x.rule)).slice(0, 60)
        .map(x => { const a = x; return { page: x.page, rule: x.rule, msg: String(x.msg).split(" — ")[0].slice(0, 120), ...(typeof a.slot === "string" ? { slot: a.slot } : {}), ...(typeof a.photo === "string" ? { photo: a.photo } : {}), ...(typeof a.fix === "string" ? { fix: a.fix } : {}), ...(typeof a.focus === "string" ? { focus: a.focus } : {}), ...(a.tone === "dark" || a.tone === "light" ? { tone: a.tone } : {}) }; });
    await postChat(id, [{ role: "event", text: null, payload: { kind: "checks", ai: "dynapse", pages: names, rules, items } }]);
}
const agentRuns = new Map(); // 이 턴 AI의 --reward 실행 시각(#120 §3)
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
    if (verifyCache) {
        // --no-small: 앱은 작은 PNG를 안 쓴다(#54 B5). 옛 네이티브(0.1.52 이하)는 옵션 인자를 거부 → 옵션 없이 한 번 더(#54 B6)
        const run = (flags) => exec("node", [".dynapse/verify.mjs", ...(pages ?? []), ...flags], undefined, dir).catch(() => null);
        // --reward(#62): 공개 재고 규칙 — 빈 사진 칸은 오류(사진 요청에 적힌 칸은 대기), 사진 칸을 빼도 된다
        // --board(#98): 보는 검토 — 스토리보드 + 바뀐 장 작은 PNG(그래서 --no-small 없이)
        let r = await run([...(board && !noRender ? ["--board"] : ["--no-small"]), ...(noRender ? ["--no-render"] : []), ...(reward ? ["--reward"] : [])]);
        if (!r?.stdout?.trim())
            r = await run([]);
        const line = r?.stdout?.trim().split("\n").at(-1);
        try {
            const v = JSON.parse(line ?? "");
            if (typeof v.ok === "boolean")
                return { ...v, engine: "node" };
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
        const FONT_OK = /^(?:https?:)?\/\/(fonts\.googleapis\.com\/css2?\?|fonts\.gstatic\.com\/|cdn\.jsdelivr\.net\/gh\/orioncactus\/pretendard[@/]|cdn\.jsdelivr\.net\/npm\/pretendard[@/])/i;
        const ext = [...h.replace(/<!--[\s\S]*?-->/g, "").matchAll(/(?:src|href)\s*=\s*["']?\s*((?:https?:)?\/\/[^"'\s>]+)|url\(\s*["']?\s*((?:https?:)?\/\/[^)"']+)|@import\s+(?:url\()?\s*["']?((?:https?:)?\/\/[^)"';\s]+)/gi)].map(m => m[1] ?? m[2] ?? m[3]).filter(u => u && !FONT_OK.test(u) && !/^(?:https?:)?\/\/fonts\.(googleapis|gstatic)\.com\/?$/i.test(u));
        if (ext.length)
            errors.push({ page, rule: "external", msg: `외부 URL: ${ext[0].slice(0, 60)}` });
    }
    return { ok: !errors.length, errors, warnings: [{ page: "*", rule: "render", msg: "node가 없어 렌더 검사를 못 했어요" }], shots: [], engine: "app" };
}
// 내보내기 렌더(#73 §2) — verify.mjs의 --pptx(편집 가능한 PPTX + fonts.txt) · --png2x(2배 PNG). node·Chrome이 있어야 한다. 실패하면 이유 한 줄
export async function exportRender(id, mode, lang, extra = []) {
    await ensureVerify(id);
    if (!verifyCache)
        return { ok: false, error: "검증 스크립트를 받지 못했어요" };
    const dir = await T().core.invoke("work_dir", { id });
    const r = await exec("node", [".dynapse/verify.mjs", `--${mode}`, ...(lang && LANG_NAME[lang] ? ["--lang", lang] : []), ...extra], undefined, dir).catch(e => ({ stdout: "", stderr: String(e) }));
    const line = r?.stdout?.trim().split("\n").at(-1) ?? "";
    try {
        const v = JSON.parse(line);
        return v;
    }
    catch { /* 아래 */ }
    const why = String(r?.stderr ?? "");
    return { ok: false, error: /검증 스크립트만/.test(why) ? "앱을 업데이트해야 PPTX로 내보낼 수 있어요" : /찾지 못했어요|not found|ENOENT/i.test(why) ? "PPTX를 만들려면 Node.js가 필요해요" : "PPTX를 만들지 못했어요" };
}
// 라운드 저장(AE1): 커밋(없으면 스냅샷 폴더) → 부모와 diff 요약 → 검증 결과·전후 사진(서버 비공개)
export async function repoCommit(id, message) {
    if (!S.git)
        return null;
    return T().core.invoke("repo_commit", { id, message }).catch(() => null);
}
export async function saveRound(id, r, message, v) {
    const parent = S.git ? await T().core.invoke("repo_head", { id }).catch(() => null) : null;
    const sha = await repoCommit(id, `r${r.n} · ${message}`);
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
export async function onChatMessage(m) {
    active++;
    // 준비 중 예외는 조용히 죽지 않게 한 줄(#54 보정 2 — 프리필 실패로 "장 채우는 중"에서 영원히 멈췄다)
    try {
        return await handleChat(m);
    }
    catch (e) {
        if (WORK_ID.test(m.work))
            await postChat(m.work, [{ role: "event", text: `준비 중 오류 · ${String(e?.message ?? e).slice(0, 80)}`, payload: { kind: "error", ai: "dynapse" } }]).catch(() => { });
    }
    finally {
        active--;
    }
}
async function handleChat(m) {
    if (!WORK_ID.test(m.work))
        return;
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
    if (m.payload?.action === "lang-refresh") {
        const q = m.payload;
        const L = String(q.lang ?? "");
        if (LANG_NAME[L] && q.accept && q.file) {
            await acceptLang(m.work, L, q.file);
            return;
        }
        if (LANG_NAME[L]) {
            active++;
            try {
                await translateTurn(m.work, { code: L, name: LANG_NAME[L] }, m.payload?.route?.design?.[0] === "chatgpt" ? "chatgpt" : "claude", q.file ? [q.file] : undefined);
            }
            finally {
                active--;
            }
        }
        return;
    }
    if (m.payload?.action === "text-sel") {
        const q = m.payload;
        if (q.file && q.sel && typeof q.neu === "string")
            await textSelCommit(m.work, q.file, { sel: q.sel, old: q.old ?? "", neu: q.neu, nth: q.nth ?? 0, note: q.note ?? "글자", why: q.why ?? "" });
        return;
    }
    if (m.payload?.action === "page-commit") {
        const p = m.payload;
        if (p.file)
            await pageCommit(m.work, p.file, p.note ?? "글자", p);
        return;
    }
    if (m.payload?.action === "redo-edit") {
        await redoPending(m.work);
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
        const listed = srcAll.length ? [...((await readJson(from, ".dynapse/pages.json").catch(() => null)) ?? []), ...((await readJson(from, ".dynapse/appendix.json").catch(() => null)) ?? [])].filter(x => typeof x === "string") : [];
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
            await repoCommit(m.work, `복제 · ${from}`);
            await api("POST", "/api/works", { id: m.work, status: "done", local_path: dst, device_id: S.deviceId }).catch(() => { });
            // 서버 사본은 원본의 마지막 저장 버전이다 — 이 PC 사본(보이던 그대로: 저장 전 글꼴·직접 수정 포함)을 곧바로 올려 둘이 같게(2026-10-12 "복제하니 폰트가 바뀌었다")
            if (m.payload.server || m.payload.origin_synced || S.sync || sharedWorks.has(from))
                await pushWork(m.work, dst).catch(() => { });
            const nApx = ((await readJson(from, ".dynapse/appendix.json").catch(() => null)) ?? []).length, nMain = srcFiles0.filter(f => PAGE_RE.test(f.name)).length - nApx;
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
                await submitReward(m.work, t);
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
    if (m.payload?.action === "use-library-file") {
        const q = m.payload;
        if (!q.from || !WORK_ID.test(q.from) || !q.file || !/^context\/assets\/[\w.\- ()가-힣]+\.(png|jpe?g|webp)$/i.test(q.file) || !q.slot)
            return;
        await ensureFolderHere(q.from);
        const src = await T().core.invoke("work_dir", { id: q.from }).catch(() => null), dst = await T().core.invoke("work_dir", { id: m.work }).catch(() => null);
        if (!src || !dst) {
            await postChat(m.work, [{ role: "event", text: "폴더를 찾지 못했어요", payload: { kind: "error", ai: "dynapse" } }]);
            return;
        }
        const have = new Set((await T().core.invoke("work_files", { id: m.work }).catch(() => [])).map(f => f.name));
        let name = q.file;
        for (let n = 2; have.has(name); n++)
            name = q.file.replace(/(\.[^.]+)$/, `-${n}$1`);
        const fileUrl = (p) => `file:///${encodeURI(p.replace(/\\/g, "/").replace(/^\//, ""))}`;
        const ok = await http("GET", fileUrl(`${src}/${q.file}`), { out: `${dst}/${name}` }).then(() => true).catch(() => false);
        if (!ok) {
            await postChat(m.work, [{ role: "event", text: "폴더 사진을 가져오지 못했어요", payload: { kind: "error", ai: "dynapse" } }]);
            return;
        }
        await useFile(m.work, q.page ?? null, q.slot, name);
        await markUsed(q.from, [q.file], m.work);
        return;
    }
    if (m.payload?.action === "use-file") {
        const q = m.payload;
        if (q.slot && q.file)
            await useFile(m.work, q.page ?? null, q.slot, q.file);
        return;
    }
    if (m.payload?.action === "gen-photo") {
        const q = m.payload;
        if (q.slot) {
            active++;
            try {
                await genPhoto(m.work, q);
            }
            finally {
                active--;
            }
        }
        return;
    }
    if (m.payload?.action === "bind-photo") {
        const q = m.payload;
        if (q.file)
            await bindPhoto(m.work, q.file, q.page ?? null);
        return;
    }
    if (m.payload?.action === "swap-photo") {
        const p = m.payload;
        if (p.slot && p.url)
            await swapPhoto(m.work, p.page ?? null, p.slot, p.url, p.asset_id ?? null);
        return;
    }
    // 장 띠에서 끌어 순서 바꾸기(#97) — pages.json을 그 순서로 쓰고 쪽번호를 다시 매긴 뒤 커밋(되돌리기 = 버전)
    if (m.payload?.action === "page-delete") {
        const f = String(m.payload.file ?? "");
        if (PAGE_RE.test(f))
            await deletePage(m.work, f);
        return;
    }
    if (m.payload?.action === "page-restore-last") {
        await restoreLastPage(m.work);
        return;
    }
    // 다른 모양 보기(#119 보정 4) — 대안 2~3개를 AI 없이 짓고 썸네일까지(띠) · [이 모양으로]면 그때 장에 넣고 커밋 1
    // 차트(#102 보정 3) — 옛 판 다시 그리기(작업을 열 때) · 차트 칩(글자 단계·범례·값 표시·칸 높이)
    if (m.payload?.action === "viz-redraw") {
        await syncLatest(m.work, "open").catch(() => { });
        void catchUpLangs(m.work).catch(() => { });
        const { redrawCharts } = await import("./viz.js");
        await redrawCharts(m.work, "open").catch(() => 0);
        return;
    }
    if (m.payload?.action === "viz-set") {
        const q = m.payload;
        const f0 = q.file ?? "";
        if ((/^result-[a-z0-9-]+\.html$/.test(f0) || LANG_PAGE.test(f0)) && q.slot) {
            const base = f0.replace(/\.[a-z]{2}\.html$/, ".html"), { setViz } = await import("./viz.js");
            await setViz(m.work, base, q.slot, q.patch ?? null, Number(q.dh) || 0);
            await syncLangsCommit(m.work, base);
        }
        return;
    } // 언어판에서 눌러도 원문 장 → 언어판까지(#100 보정 5)
    // 키우기(#121 §3) — AI 없이: 장의 px·rem 크기를 k배로 다시 써서 검사, 넘치면 k를 0.9씩(3번까지) · 커밋 "키우기 ×k"
    if (m.payload?.action === "page-grow") {
        const q = m.payload;
        const f0 = q.file ?? "";
        if (/^result-[a-z0-9-]+\.html$/.test(f0) || LANG_PAGE.test(f0)) {
            const base = f0.replace(/\.[a-z]{2}\.html$/, ".html"), { growPage } = await import("./grow.js");
            await growPage(m.work, base, typeof q.k === "number" ? q.k : null);
            await syncLangsCommit(m.work, base);
        }
        return;
    } // 언어판까지(#100 보정 5)
    if (m.payload?.action === "form-alts") {
        const q = m.payload;
        if (/^result-[a-z0-9-]+\.html$/.test(q.file ?? "")) {
            const { makeAlts, cancelPrerender } = await import("./form-alts.js");
            cancelPrerender(m.work);
            await makeAlts(m.work, q.file).catch(e => postChat(m.work, [{ role: "event", text: null, payload: { kind: "form-alts", ai: "dynapse", file: q.file, items: [], error: String(e?.message ?? e).slice(0, 120) } }]).catch(() => { }));
        }
        return;
    }
    if (m.payload?.action === "form-apply") {
        const q = m.payload;
        if (/^result-[a-z0-9-]+\.html$/.test(q.file ?? "") && /^[a-z0-9-]{2,30}$/.test(q.form ?? "")) {
            const { applyAlt } = await import("./form-alts.js");
            await applyAlt(m.work, q.file, q.form, q.fresh === true);
        }
        return;
    }
    // 다른 모양 보기에서 "이전으로"(#119 보정 3 §5) — 그 장만 칩 직전 커밋의 내용으로
    if (m.payload?.action === "form-revert") {
        const q = m.payload, file = String(q.file ?? ""), sha = String(q.sha ?? "");
        if (/^result-[a-z0-9-]+\.html$/.test(file) && /^[0-9a-f]{7,40}$/.test(sha)) {
            const h = await T().core.invoke("repo_show", { id: m.work, sha, file }).catch(() => null);
            if (h) {
                await wput(m.work, file, h);
                await repoCommit(m.work, `이전 모양으로 · ${pageLabel(file)}`);
                await postChat(m.work, [{ role: "event", text: `${pageLabel(file)}을 이전 모양으로 돌렸어요`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
            }
        }
        return;
    }
    // 언어판 추가(#100 보정 2) — 캔버스 ··· 메뉴. 말로 한 요청과 같은 길(앱이 장을 복사하고 글만 번역)
    if (m.payload?.action === "lang-add") {
        const lg = langByCode(String(m.payload.lang ?? ""));
        if (lg) {
            active++;
            try {
                await translateTurn(m.work, lg, m.payload?.route?.design?.[0] === "chatgpt" ? "chatgpt" : "claude");
            }
            finally {
                active--;
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
    if (m.payload?.action === "pull-discard") {
        await syncLatest(m.work, "discard").catch(() => { });
        return;
    }
    if (m.payload?.action === "page-order") {
        const want = m.payload.order?.filter((x) => typeof x === "string" && PAGE_RE.test(x)) ?? [];
        if (want.length) {
            const ord = await normalizeOrder(m.work, want);
            if (ord)
                await wput(m.work, ".dynapse/order-lock.json", JSON.stringify({ order: ord, at: Date.now() })).catch(() => { });
            await repoCommit(m.work, "장 순서 바꿈");
            await postChat(m.work, [{ role: "event", text: "장 순서를 바꿨어요", payload: { kind: "stage", ai: "dynapse", order: true } }]);
            void afterSave(m.work);
        }
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
        if (!anyPhotoReady()) {
            waiting.push({ id: m.work, text: m.text, opts: { route: m.payload?.route }, photo: m.payload.task_id ?? "" });
            await postChat(m.work, [{ role: "event", text: null, payload: { kind: "need-ai", ai: "dynapse", cap: "photo" } }]);
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
        const next = prev.then(() => runPhotoTurn(m.work, m.text, { route: m.payload?.route, taskId: m.payload?.task_id ?? null, ...(ans?.brief ? { briefOnly: true } : ans ? { resume: true, ...(force ? { force } : {}) } : {}) })).catch(e => postChat(m.work, [{ role: "event", text: String(e).slice(0, 80), payload: { kind: "error", ai: "dynapse" } }]));
        photoQueue.set(m.work, next);
        await next;
        void actionMetric(m.work, "photo_work", pt0, { len: m.text.length, ph: reqHash(m.text) });
        return;
    }
    // 가져다 놓은 템플릿의 첫 메시지(#21 보정) — 템플릿 지시를 턴 앞에 붙인다(사용자가 말했을 때만 첫 턴)
    const tpl = m.payload?.template;
    // 짚어서 말하기(#25 A) — 📍 요소가 붙어 오면 "그 요소만" 계약을 턴 앞에(파일 전체 읽기 금지 · 끝나면 전/후 한 줄)
    const pts = (m.payload?.point ?? []).slice(0, 5);
    if (m.role === "user" && pts.length)
        lastPin.set(m.work, { pts, at: Date.now(), route: m.payload?.route ?? null }); // 같은 자리 이어서(#99 보정 2)
    let pointed = pts.length ? `[📍 ${pts.length} pointed element(s) — edit ONLY these (skill §3-0). A new photo for a pointed photo slot goes to .dynapse/photo-requests.json with that point's file. Do not read whole files; find each by selector, change only that element, then report one line per element: "before → after". A pointed chart (an element with data-viz) changes its data only in its data-viz JSON; for its look, write the action names to .dynapse/viz-actions.json as [{\"file\":\"result-….html\",\"slot\":\"<data-slot>\",\"do\":[…]}] and the app applies them: 좌우로 꽉·넓게·제목에 맞춰 → \"full-width\"; 글씨 키워 → \"text:l\" (아주 크게 → \"text:xl\", 보통 → \"text:m\"); 그림 크게·높게 → \"box:+\"; 줄여·낮게 → \"box:-\"; 범례 빼 → \"legend:off\" (넣어 → \"legend:on\"); 값 빼 → \"values:off\" (넣어 → \"values:on\"). Never write chart CSS or width/max-width/margin on the box yourself; the app redraws it; never claim a chart change you could not make. Reply to the user in Korean.]\n${pts.map((p, i) => `${i + 1}. file=${p.file} selector=${p.selector}${p.slot ? ` slot=${p.slot}` : ""}\n   source: ${(p.snippet ?? "").replace(/\s+/g, " ").slice(0, 400)}`).join("\n")}\nRequest: ` : "";
    // 📍 + 짧은 말만(2026-10-16 대표 "위치를 찍어서 지시했는데 아직도" — "언어 음성 제공"을 보냈더니 AI가 "어느 페이지, 어느 부분에?"라고 되물었다):
    // 동사 없는 짧은 말은 그 자리에 들어갈 글이다 — 그렇게 못 박고, 📍가 있으면 어디냐고 묻지 않게
    let pinHint = "";
    if (m.role === "user" && pts.length && m.text) {
        const t0 = m.text.trim();
        const bare = t0.length <= 40 && !/[?？]/.test(t0) && !/(줘|주세요|해|해요|하자|해라|세요|바꿔|넣어|빼|지워|키워|줄여|옮겨|고쳐|추가|삭제|수정|변경|make|change|replace|add|remove|move)\S{0,3}\s*$/i.test(t0);
        pinHint = `[The 📍 is the place — never ask which page, slide or element.${bare ? ` The user typed only this phrase while pointing: replace the text of the pointed element with «${t0.replace(/[«»]/g, "")}» (keep its style; if it is a list item, replace that item).` : ""}]\n`;
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
    const handPages = m.role === "user" && m.text ? await handPagesPrefix(m.work).catch(() => "") : "";
    // 보고 있는 언어판(#100) — 그 언어판 파일을 고치게. 구조 변경은 앱이 다른 언어판에 옮긴다
    const vl = String(m.payload?.view_lang ?? "");
    // 발표용 움직임(#106 보정 1) — 켠 작업만. 앱이 발표에서 같은 이름의 요소를 옮긴다(매직 무브) · data-step은 키마다 드러난다
    const motionOn = m.role === "user" && !!m.text && m.payload?.motion === true;
    // 첫 턴 글꼴 후보(#108) — 목록 전체 대신 3개. 고르면 앱이 블록을 넣는다(font-pick.json)
    const fc = m.payload?.font_candidates;
    // 글꼴 짝(#129) — 서버가 덱마다 고른 짝(리워드면 발주가 정한 짝). 앱이 블록을 넣고 AI에는 이름과 이유만
    const fpair = m.payload?.reward_font ?? m.payload?.font_pair?.id;
    if (m.role === "user" && fpair && /^[A-Za-z0-9-]{2,30}$/.test(fpair)) {
        await wput(m.work, ".dynapse/font-pick.json", JSON.stringify({ pair: fpair })).catch(() => { });
        if (m.payload.reward_font)
            await wput(m.work, ".dynapse/reward-font.json", JSON.stringify({ pair: fpair })).catch(() => { });
    }
    const fpInfo = m.payload?.font_pair;
    if (m.role === "user" && fpair && fpInfo?.name)
        await wput(m.work, ".dynapse/font-pair.json", JSON.stringify({ id: fpair, name: fpInfo.name, why: fpInfo.why ?? "" })).catch(() => { }); // 덱 프레임 카드의 "글꼴 · …"
    const fontHead = m.role === "user" && m.text && fpair ? `[Fonts: the app sets the typeface pair ${fpInfo?.name ?? fpair}${fpInfo?.why ? ` (${fpInfo.why})` : ""} on every page after your turn — roles display, title, body, label, numeral with their weights. Never set font-family or font-weight on text yourself; if a page's own CSS needs them, use var(--typography-font-family-display|title|body|label|numeral) and var(--typography-weight-display|body).]\n` : m.role === "user" && m.text && fc?.length ? `[Font candidates for this deck: ${fc.map(f => `${f.id} (${f.name}${f.tags?.length ? ` · ${f.tags.join("·")}` : ""})`).join(", ")}. Choose the display and the body font only from these and write .dynapse/font-pick.json {"display":"<id>","body":"<id>"}; the app puts the font block on every page. Never set font-family yourself.]\n` : "";
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
    let orderHead = "";
    if (m.role === "user" && m.text && isReorderAsk(m.text)) {
        const start = (await readJson(m.work, ".dynapse/pages.json").catch(() => null)) ?? [];
        orderUnlock.add(m.work);
        await wput(m.work, ".dynapse/order-lock.json", JSON.stringify({ order: start, at: Date.now(), open: true })).catch(() => { });
        // 순서만 바꾸는 요청(#139 A — "1~10번을 Osaka Award에 맞게 재조정"이 잠금에 되돌려졌다) = 순서만 쓰는 가벼운 턴. 만들기·글·사진 말이 섞이면 등급은 그대로
        orderAsk.set(m.work, { start, retried: false, text: m.text });
        orderHead = ORDER_HEAD;
        if (!NEEDS_LOOK.test(m.text) && !/만들|추가|넣어|새로|써\s*줘|사진|그림|차트|글자|문구|제목/.test(m.text))
            light = true;
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
        const order = async () => ((await readJson(m.work, ".dynapse/pages.json").catch(() => null)) ?? []).filter(x => typeof x === "string");
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
    if (m.role === "user" && m.text && m.payload?.verbatim) {
        const refs = [...new Set([...m.text.matchAll(/context\/refs\/([^\s,\]]+)/g)].map(x => x[1]))];
        await wput(m.work, ".dynapse/verbatim.json", JSON.stringify({ at: Date.now(), sources: refs.map(r => `context/.index/${r}.md`), text: refs.length ? null : m.text.replace(/\n?\[첨부:[^\]]*\]/g, "").slice(0, 20000) }, null, 1)).catch(() => { });
        verbatim = `[Copy as written — the user's manuscript${refs.length ? ` (${refs.join(", ")} — read its index in context/.index/)` : " (the text of this message)"} goes into the slots exactly as written: no rephrasing, shortening, translating or reordering within a sentence; keep numbers and names exactly. If a sentence does not fit, use a denser layout variant, a composed page or more pages — never cut it. If you truly must change a sentence, record each change in .dynapse/turn.json "copy_changes": [{"page","slot","before","after","why"}].]\n`;
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
        const sc = await scopeTurn(m.work, m.text, pts, { imported: !!importedHead, mine: !!mine }).catch(() => null);
        if (sc) {
            scope = sc.scope;
            scopeHead = sc.head;
            vizAsk = sc.viz;
            if (sc.scope === "page" || sc.scope === "deck") {
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
    if (m.role === "user" && m.text) {
        if (pts.length)
            pointTurn.add(m.work);
        await chatSend(m.work, tpl ? `${hand}${webFonts}${tpl}\n요청: ${m.text}` : libraryHead + driveHead + connHead + folderHead + seriesHead + article + planHead + (isLib ? "" : mine) + (seriesHead || article || isLib ? "" : importedHead) + hand + handPages + viewHead + motionHead + storyHead + fontHead + webFonts + fontAsk + verbatim + scopeHead + orderHead + selHead + pointed + m.text, { raw: m.text, points: pts, route: m.payload?.route, capLeft: m.payload?.cap_left ?? null, light, ...(scope ? { scope } : {}), ...(vizAsk ? { viz: true } : {}), ...(motionOn ? { motion: true } : {}), receivedAt: receivedAt.get(m.work), library: isLib, ...(isLib ? {} : { folderDir }), ...(driveTurn ? { drive: true } : {}), ...(connTools.length ? { connectors: connTools } : {}) });
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
const DECK_WORDS = /덱\s*단위|가벼운\s*턴\s*말고|제대로|whole deck|전체|모든 ?장|덱 ?전체|순서|구조|흐름|스토리|장\s*(을|를)?\s*(추가|삭제|빼|넣|늘|줄)|(장표|페이지|슬라이드)\s*(을|를|도|로|하나|한\s*장)?\s*(더\s*)?(추가|삭제|넣|만들|늘|빼)|\d{1,2}\s*(장|페이지|번\s*장)\s*(뒤|앞|다음|사이)|새\s*(장|장표|페이지|슬라이드)|한\s*장\s*더|부록|처음부터|다시 ?짜|재구성|whole deck|all (the )?(pages|slides)|re-?order|restructure|storyline|\bflow\b|add (a |more )?(page|slide)s?|remove (a |the )?(page|slide)|appendix|from scratch/i;
const PAGE_WORDS = /이 ?장|이 ?페이지|이 ?슬라이드|레이아웃|배치|구성|다시 ?(만들|짜|구성)|갈아|통째|디자인 ?(바꿔|바꾸|다시)|layout|re-?arrange|redesign|this (page|slide)/i;
// 구조를 바꾸는 요청(#99 보정 1) — 📍는 대상만 정하고 범위는 요청이 정한다: 항목 더·다른 배열·나누기·합치기·넓히기·키우기는 그 장(같은 턴에서, "같은 요청" 두 번째 턴을 기다리지 않는다)
const STRUCT_WORDS = /더\s*(넣|추가|늘|많이|보여|써)|늘려|늘리|하나\s*더|몇\s*개|개만|개\s*밖에|만\s*쓸|배열|정렬|나눠|나누|쪼개|분리|합쳐|합치|넓혀|넓게|넓히|키워|키우|크게|칸\s*(을|를)?\s*(늘|추가|더)|more (items|cards|rows|photos|images)|another (arrangement|layout)|split|merge|wider|bigger|enlarge/i;
const PHOTO_WORDS = /(사진|이미지|그림)\s*(을|를|이|도)?\s*(넣|더|추가|바꿔|바꾸|교체|늘려|많이|써|활용)|사진이 ?(없|부족|안 ?들어)|add (more )?(photos?|images?)|more (photos|images)|replace (the )?(photo|image)/i;
const VIZ_WORDS = /시각화|인포그래픽|도식|다이어그램|차트|그래프|페르소나|아이콘|여정 ?지도|타임라인|visuali[sz]|infographic|diagram|chart|graph|persona|icons?\b|journey|timeline/i;
const lastAsk = new Map();
const wordsOf = (t) => new Set(t.toLowerCase().replace(/\[[^\]]*\]/g, " ").split(/[^0-9a-z가-힣]+/).filter(w => w.length >= 2));
async function scopeTurn(id, text, pts, o = {}) {
    // "3장 전체"·"이 장 전체" = 그 장 하나(덱 아님)
    const t = text.replace(/\[첨부:[^\]]*\]/g, "").replace(/(\d+|이|그)\s*(장|페이지|슬라이드)\s*(을|를|의)?\s*전체/g, " 이 장 ");
    const photoAsk = PHOTO_WORDS.test(t);
    const vizAsk = VIZ_WORDS.test(t);
    let scope = DECK_WORDS.test(t) ? "deck" : PAGE_WORDS.test(t) || STRUCT_WORDS.test(t) || photoAsk || (vizAsk && pts.length) ? "page" : pts.length ? "slot" : null; // 📍 상자에 "도식으로" = 그 장(#102 §3)
    // 같은 요청 두 번(30분 안 · 낱말 60% 겹침) → 한 단계 위로
    const w = wordsOf(t), prev = lastAsk.get(id);
    let escalated = false;
    if (prev && Date.now() - prev.at < 30 * 60_000 && w.size >= 2) {
        const inter = [...w].filter(x => prev.words.has(x)).length, sim = inter / Math.max(1, Math.min(w.size, prev.words.size));
        if (sim >= 0.6) {
            const up = prev.scope === "slot" ? "page" : "deck";
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
    if (photoAsk)
        parts.push("Photo request: for each page that would benefit and has no photo slot, switch it to a layout that has one (cp materials/<layout>.html over that page's file, keep its text and page_no), then use the user's photos or add .dynapse/photo-requests.json entries for the empty photo slots (at most 6).");
    if (scope === "page" && pts.length)
        parts.push("The 📍 marks the target; the request decides the scope — this request changes the structure, so work on the whole page now (more items, another arrangement, split, merge, wider or bigger boxes). Rebuild from the existing page as reference: same tokens, the same slot naming and distance; photos from materials/ and the user's library first. Never answer that the layout or the pin does not allow it.");
    if (scope === "page")
        parts.push("Scope: page. You may read the whole page, change its data-variant, rebuild its blocks, add a photo slot, or replace its layout with another registry layout that fits its role and data (cp materials/<layout>.html over the same file name — never rename result-*.html — then move the text and photos into the new slots and keep the page's <style data-fonts>, data-pack, data-brand and data-tokens blocks). Leave other pages as they are.");
    if (scope === "deck")
        parts.push("Scope: whole deck. Read every page. You may add, delete (move to the appendix in .dynapse/appendix.json rather than deleting the user's content) and reorder pages (.dynapse/pages.json — only when the request names pages and asks to move them; a described flow is not a reorder, and an order the user set stays), and replace layouts on several pages. Pick each page's layout by the data it carries; never three same layouts in a row; strongest number in the first three pages. The app runs an editor read after your turn.");
    // 시각화 계획 먼저(#102 §3) — 덱 범위나 시각화 어휘면 장마다 데이터 종류와 그릴 것을 먼저 적고 그 다음 장을 만든다
    if (vizAsk || scope === "deck")
        parts.push(`Visualization plan first: before editing pages, write .dynapse/viz-plan.json = [{"page":"result-….html","data_kind":"number|trend|share|process|compare|persona|journey|list|text","viz":"<data-viz type | persona-card | journey-map | icon-row | none>","why":"…"}] for ${scope === "deck" ? "every page" : "the pages this request touches"}, then build the pages from it (charts as data-viz JSON — the app draws them).${vizAsk ? " The request asks for visualization: at least one page must use one." : ""}`);
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
    const o = old.replace(/[\u2060]/g, "").trim(), n = escH(neu.trim());
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
async function deletePage(id, file) {
    await savePending(id).catch(() => null);
    const sha = await T().core.invoke("repo_head", { id }).catch(() => null);
    if (!sha) {
        await postChat(id, [{ role: "event", text: "지우지 못했어요 · 저장된 버전이 없어요", payload: { kind: "error", ai: "dynapse" } }]).catch(() => { });
        return;
    }
    const order = ((await readJson(id, ".dynapse/pages.json")) ?? []).filter(x => typeof x === "string");
    const apx = ((await readJson(id, ".dynapse/appendix.json")) ?? []).filter(x => typeof x === "string");
    const vers = (await langFiles(id)).vers.filter(v => baseOf(v) === file);
    for (const f of [file, ...vers]) {
        const ok = await T().core.invoke("page_delete", { id, path: f }).then(() => true).catch(() => false);
        if (!ok && f === file) {
            await postChat(id, [{ role: "event", text: "지우지 못했어요 · 앱을 업데이트해 주세요(0.1.69 이상)", payload: { kind: "error", ai: "dynapse" } }]).catch(() => { });
            return;
        }
    }
    if (apx.includes(file))
        await wput(id, ".dynapse/appendix.json", JSON.stringify(apx.filter(x => x !== file))).catch(() => { });
    const stack = ((await readJson(id, DELETED)) ?? []).slice(-9);
    await wput(id, DELETED, JSON.stringify([...stack, { file, sha, at: order.indexOf(file), vers, appendix: apx.includes(file), when: Date.now() }]));
    await normalizeOrder(id, order.filter(x => x !== file));
    await writeLangStatus(id).catch(() => { });
    await repoCommit(id, `장 삭제 · ${pageLabel(file)}`);
    await postChat(id, [{ role: "event", text: `${pageLabel(file)}을 지웠어요 · ⌘Z로 되돌리기`, payload: { kind: "stage", ai: "dynapse", order: true } }]).catch(() => { });
    void afterSave(id);
}
async function restoreLastPage(id) {
    const stack = (await readJson(id, DELETED)) ?? [];
    const d = stack.at(-1);
    if (!d)
        return;
    for (const f of [d.file, ...d.vers]) {
        const h = await T().core.invoke("repo_show", { id, sha: d.sha, file: f }).catch(() => null);
        if (h)
            await wput(id, f, h);
    }
    const order = ((await readJson(id, ".dynapse/pages.json")) ?? []).filter(x => x !== d.file);
    if (d.appendix) {
        const apx = (await readJson(id, ".dynapse/appendix.json")) ?? [];
        await wput(id, ".dynapse/appendix.json", JSON.stringify([...new Set([...apx, d.file])])).catch(() => { });
    }
    else if (d.at >= 0)
        order.splice(Math.min(d.at, order.length), 0, d.file);
    await wput(id, DELETED, JSON.stringify(stack.slice(0, -1)));
    if (d.at < 0 && !d.appendix)
        await normalizeOrder(id, undefined, []); // 옛 장이었으면 옛 장 그대로(순서에 넣지 않는다)
    else
        await normalizeOrder(id, order);
    await writeLangStatus(id).catch(() => { });
    await repoCommit(id, `장 복원 · ${pageLabel(d.file)}`);
    await postChat(id, [{ role: "event", text: `${pageLabel(d.file)}을 되살렸어요`, payload: { kind: "stage", ai: "dynapse", order: true } }]).catch(() => { });
    void afterSave(id);
}
const PENDING = ".dynapse/pending-edits.json", HANDED = ".dynapse/hand-edits.json", REDO = ".dynapse/redo-edits.json";
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
    const list = (await pendingOf(id)).filter(x => !(e.t === "font" && x.t === "font") && !(e.t === "photo" && x.t === "photo" && x.page === e.page && x.slot === e.slot)); // 같은 칸·폰트는 마지막 것만
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
        if (e.t === "stopped" || e.t === "font") {
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
const handLine = (e) => e.t === "tweak" ? `${pageKey(e.page)} style adjustment` : e.t === "stopped" ? `${e.why === "verify" ? "changes kept after a failed app check" : "partial changes from a stopped turn"} in ${e.files.slice(0, 4).join(", ")}` : e.t === "text" ? `${pageKey(e.page)} "${e.old.slice(0, 30)}" → "${e.neu.slice(0, 40)}"` : e.t === "photo" ? `${pageKey(e.page)} ${e.slot} → ${e.file}` : `fonts → ${e.block.match(/data-display="([^"]+)"/)?.[1] ?? "?"} / ${e.block.match(/data-body="([^"]+)"/)?.[1] ?? "?"}`;
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
            html = html.replace(/(<([a-z][a-z0-9]*)\b[^>]*\bdata-slot\s*=\s*["']brand["'][^>]*>)[\s\S]*?(<\/\2>)/i, `$1<img src="${logo}" alt="${d.name.replace(/"/g, "")}">$3`);
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
    if (e.t === "tweak") {
        const b = e.block || "<style data-tweaks></style>";
        return TWEAKS_RE.test(html) ? html.replace(TWEAKS_RE, b) : e.block && /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${e.block}\n</head>`) : html;
    }
    if (e.t === "photo")
        return setSlotImg(html, e.slot, e.file) ?? html;
    if (e.t === "font")
        return FONT_RE.test(html) ? html.replace(FONT_RE, e.block) : html;
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
    const pages = [...new Set(step.flatMap(e => (e.t === "font" || e.t === "stopped" ? [] : [e.page])))];
    if (step.some(e => e.t === "font"))
        for (const f of (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(n => PAGE_RE.test(n)))
            if (!pages.includes(f))
                pages.push(f);
    for (const pg of pages) {
        const cur = await T().core.invoke("work_read", { id, file: pg }).catch(() => null);
        if (cur === null)
            continue;
        await wput(id, pg, step.filter(e => e.t === "font" || (e.t !== "stopped" && e.page === pg)).reduce(applyEdit, cur));
    }
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
    const gone = goneAll.find(e => e.t === "stopped") ?? goneAll.find(e => e.t === "font") ?? goneAll[0];
    const rest = list.filter((_, i) => !idx.has(i));
    const head = await T().core.invoke("repo_head", { id }).catch(() => null);
    // 중단으로 남은 변경을 되돌리기 — 작업 트리를 마지막 커밋으로, 나머지 직접 수정은 아래에서 다시 적용
    if (gone.t === "stopped")
        await T().core.invoke("repo_discard", { id }).catch(() => { });
    const pages = gone.t === "stopped" || gone.t === "font" ? (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(n => PAGE_RE.test(n)) : [...new Set(goneAll.flatMap(e => (e.t === "stopped" || e.t === "font" ? [] : [e.page])))];
    for (const pg of pages) {
        const base = head ? await T().core.invoke("repo_show", { id, sha: head, file: pg }).catch(() => null) : null;
        if (base === null)
            continue;
        const out = rest.filter(e => e.t === "font" || (e.t !== "stopped" && e.page === pg)).reduce(applyEdit, base);
        await wput(id, pg, out);
    }
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
export async function swapPhoto(id, page0, slot, url, assetId) {
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
    await placePhoto(id, page, slot, file, { runtime: "stock", ...(assetId ? { asset_id: assetId } : {}) });
    const placed = (await readSlots(id))[slotKey(page, slot)] ?? file;
    await addPending(id, { t: "photo", page, slot, file: placed, label: `${pageLabel(page)} · ${slot} 재고` }); // 모아 저장(#46)
    await photoDone(id, page, slot, placed);
}
// 클릭 요청(#30 — 추천 띠 사진 교체·사진 버전 쓰기·글자 직접 수정) = 커밋 1 = 스레드 항목 1. 렌더는 생략(가볍게), 라벨만
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
    const line = o.line ?? (photo ? `${pages.length ? `${pages.join("·")}에 ` : ""}빈 사진 칸이 있어요${o.slots ? ` (${o.slots}칸)` : ""} — 채우거나 빼면 올릴 수 있어요` : "검사를 통과하지 못했어요 — 채팅으로 고쳐 달라고 해 주세요");
    await postChat(id, [{ role: "event", text: line, payload: { kind: "rejected", ai: "dynapse", reason: photo ? "photo_empty" : "other", slots: o.slots ?? 0, task_id: taskId, ...(o.agent ? { agent: o.agent.slice(0, 600) } : {}) } }]);
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
const planFixTried = new Map(), pendingSubmit = new Map();
async function submitReward(id, taskId, replaces) {
    {
        const { redrawCharts } = await import("./viz.js");
        await redrawCharts(id, "quiet").catch(() => 0);
    } // 제출 전 차트를 지금 판으로(#102 보정 3)
    const say = (text, kind = "stage") => postChat(id, [{ role: "event", text, payload: { kind, ai: "dynapse" } }]);
    await say("제출하는 중 · 확인");
    await ensureVerify(id);
    // 리워드 규칙으로 먼저(#62 보정 1) — 빈 사진 칸이면 올리기 전에 반려 카드(사람 말 한 줄 + 채우기/빼기). 서버까지 갔다 오지 않는다
    const v = await appVerify(id, undefined, { reward: true });
    const emptyPh = v.errors.filter(e => e.rule === "photo" && /빈 사진 칸/.test(e.msg ?? ""));
    if (!v.ok && emptyPh.length === v.errors.length) {
        await rejectedCard(id, taskId, { pages: emptyPh.map(e => e.page ?? ""), slots: emptyPh.reduce((n, e) => n + ((e.msg ?? "").match(/빈 사진 칸:\s*([^—]+)/)?.[1].split(",").filter(x => x.trim()).length ?? 0), 0) });
        return;
    }
    // 계획·덱 수준 오류만 남았으면(#127 §2 — 대표가 "고쳐서제출"을 쳐야 했다) 같은 세션에 "이것만 고치고" 한 번 → 끝나면 앱이 다시 제출(한 번만)
    // 제출 전 한 번 고치기(#127 보정 2) — 계획 오류뿐이거나, 오류 6개 이하·3장 이하(빈 사진 칸 제외)면 같은 세션에 한 번 보내고 끝나면 다시 확인·제출. "채팅으로 고쳐 달라고"는 그 한 번이 실패한 뒤에만
    const PLAN_ONLY = /^(plan_frame|plan_borrow|variety|system)$/, errPages = new Set(v.errors.map(e => e.page).filter(p => p && p !== "*"));
    const small = v.errors.length <= 6 && errPages.size <= 3 && !v.errors.some(e => e.rule === "photo" || e.rule === "photo_label_orphan");
    // 2회까지(#127 보정 4) — 1회차 뒤 남은 오류가 1회차와 다를 때만(새 규칙·새 장) 한 번 더. 같은 오류가 그대로면 거기서 멈춘다
    const fk = `${id}|${taskId}`, tried = planFixTried.get(fk), esig = v.errors.map(e => `${e.page ?? ""}:${e.rule}`).sort().join(",");
    if (!v.ok && (v.errors.every(e => PLAN_ONLY.test(e.rule)) || small) && (!tried || (tried.n < 2 && tried.sig !== esig))) {
        const n = (tried?.n ?? 0) + 1;
        planFixTried.set(fk, { n, sig: esig });
        pendingSubmit.set(id, { taskId, ...(replaces ? { replaces } : {}) });
        const planOnly = v.errors.every(e => PLAN_ONLY.test(e.rule)), deck = v.errors.filter(e => !e.page || e.page === "*");
        await say(planOnly ? `제출 전 계획만 고치는 중 · 제출 전 고침 ${n}/2회` : `제출 전 ${errPages.size || 1}장 고치는 중 · 제출 전 고침 ${n}/2회`);
        void chatSend(id, `[Fix before submit ${n}/2] Fix only these errors — ${planOnly ? "edit .dynapse/plan.json with Edit (and only the pages a rhythm line names)" : "rewrite each named page once with all of its errors fixed (no patch scripts)"}${deck.length ? ". Deck-level lines (no page): change the form of one named or neighbouring page — set a different candidate in .dynapse/plan.json, run node .dynapse/verify.mjs --plan, then rebuild only that page; pages with an assigned form (fixed) keep it" : ""} — then stop; the app re-checks and submits:\n${v.errors.map(e => `- ${e.page === "*" ? "" : `${e.page}: `}${e.msg}`).join("\n").slice(0, 2400)}`, { raw: "제출 전 고침" });
        return;
    }
    if (!v.ok) {
        await postChat(id, [{ role: "event", text: null, payload: { kind: "verify", ai: "dynapse", ok: false, errors: v.errors.slice(0, 5), warnings: v.warnings.length, wk: warnKinds(v.warnings) } }]);
        await say("확인을 통과하지 못해 제출하지 않았어요 · 채팅으로 고쳐 달라고 해 주세요", "error");
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
    const order = ((await readJson(id, ".dynapse/pages.json").catch(() => null)) ?? []).filter(x => typeof x === "string" && /^result-[a-z0-9-]+\.html$/.test(x));
    const pages = !deck ? ["result-cover.html"] : spec.deck_goal === "cards"
        ? Array.from({ length: Math.max(4, Math.min(8, spec.pages ?? 6)) }, (_, i) => `result-card-${i + 1}.html`)
        : spec.deck_goal === "flip" ? Array.from({ length: n }, (_, i) => `result-p${String(i + 1).padStart(2, "0")}.html`)
            : order.length === n ? order : slides;
    const files = [...pages.map(f => ({ path: `.dynapse/out/${f.replace(/^result-|\.html$/g, "")}.bundle.html`, type: "text/html" })), ...(deck ? [{ path: "tokens.css", type: "text/css" }] : [])];
    const ups = cl.uploads?.length ? cl.uploads : [{ upload_id: cl.upload_id, upload_url: cl.upload_url }];
    const release = () => mcp("release_claim", { claim_nonce: cl.claim_nonce }).catch(() => null);
    if (ups.length !== files.length) {
        await say(`올릴 파일 수가 맞지 않아요(${files.length}/${ups.length})`, "error");
        await release();
        return;
    }
    await say("제출하는 중 · 올리기");
    for (const [i, f] of files.entries()) {
        const r = await http("PUT", ups[i].upload_url, { file: `${dir}/${f.path}`, contentType: f.type, auth: true }).catch(() => ({ status: 0 }));
        if (r.status !== 200) {
            await say(`${f.path.split("/").pop()}을 올리지 못했어요`, "error");
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
        if (rej?.rejected) {
            await rejectedCard(id, taskId, { line: rej.rejected_user, kind: rej.rejected_kind, agent: rej.rejected, slots: [...rej.rejected.matchAll(/빈 사진 칸:\s*([^—/]+)/g)].reduce((n, m) => n + m[1].split(",").filter(x => x.trim()).length, 0) });
            return;
        }
        await say((r?.text ?? "제출하지 못했어요").slice(0, 160), "error");
        return;
    }
    const done = replaces ? "교체 제출했어요" : "제출했어요";
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
    const r = await http("GET", `${HUB}/api/fonts?pair=${encodeURIComponent(pair)}${latin ? "&latin=1" : ""}`).catch(() => null);
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
    await placePhoto(id, page, slot, file, { runtime: file.startsWith("context/") ? "mine" : "generated" });
    const placed = (await readSlots(id))[slotKey(page, slot)] ?? file;
    await addPending(id, { t: "photo", page, slot, file: placed, label: `${pageLabel(page)} · ${slot}` }); // 모아 저장(#46)
    await photoDone(id, page, slot, placed);
}
// 사진이 실제로 칸에 들어갔다(#87 P0 B) — 웹 사진 패널이 이걸 받아야 "들어갔어요"(요청 접수와 반영을 구분). 채팅엔 보이지 않는다
async function photoDone(id, page, slot, file) {
    await postChat(id, [{ role: "event", text: null, payload: { kind: "photo-done", ai: "dynapse", page, slot, file } }]).catch(() => { });
    void appVerify(id, [page]).catch(() => null); // 사진이 바뀐 장만 다시 점검(#91 §1 — 새 사진 위 글자 대비)
}
async function genPhoto(id, q) {
    const ais = (q.ais ?? []).filter((a) => a === "gemini" || a === "chatgpt").slice(0, 2);
    if (!q.slot || !/^[a-z0-9_]{1,40}$/i.test(q.slot) || !ais.length)
        return;
    const page = await resolvePage(id, q.slot, q.page);
    if (!page) {
        await postChat(id, [{ role: "event", text: `사진 요청에 장표가 없어요 · ${q.slot}`, payload: { kind: "error", ai: "dynapse" } }]);
        return;
    }
    const brief = (q.brief ?? "").slice(0, 600) || "A photo that fits this slide";
    // AI 줄에서 고른 모델·강도로(대표: 모델을 바꿔 둔 채로 누르면 그 설정으로)
    const r = await genSlotPhoto(id, page, q.slot, ais, brief, q.ratio, q.from && q.text ? { from: q.from, text: q.text.slice(0, 200) } : undefined, { design: [], photo: ais, models: q.models });
    if (!r.files.length) {
        await postChat(id, [{ role: "event", text: null, payload: { kind: "photo-fail", ai: "dynapse", page, slot: q.slot } }]).catch(() => { });
        return;
    } // 실패 이유 줄은 genSlotPhoto가 이미 남겼다
    await photoDone(id, page, q.slot, r.files[0]);
    await clickRound(id, `${pageLabel(page)} · 사진${q.text ? ` · ${q.text.slice(0, 20)}` : ""}`, r.ais);
    void afterSave(id);
}
// [이 버전으로](#30) — 그 커밋의 파일 전체로 돌아가는 새 커밋(이력은 남는다) = 새 스레드 항목 r⟨n+1⟩ "r⟨k⟩으로 되돌림". 사진·글 구분 없음. AI 호출 0
export async function restoreTo(id, sha) {
    if (!S.git)
        return;
    const trace = (await readJson(id, ".dynapse/TRACE.json")) ?? {};
    const target = (trace.rounds ?? []).find(r => r.commit?.startsWith(sha));
    const n = (trace.rounds?.at(-1)?.n ?? 0) + 1;
    const label = `r${target?.n ?? "?"}으로 되돌림`;
    // 이미 그 버전과 같으면 커밋하지 않는다(#39 — r3 → r1 → r3 왕복이 버전을 늘리지 않게)
    const head = await T().core.invoke("repo_head", { id }).catch(() => null);
    const diff = head ? await T().core.invoke("repo_diffstat", { id, from: sha, to: head }).catch(() => null) : null;
    if (diff !== null && !diff.trim()) {
        await postChat(id, [{ role: "event", text: "이미 이 버전이에요", payload: { kind: "stage", ai: "dynapse" } }]);
        return;
    }
    const ok = await T().core.invoke("repo_restore", { id, sha, message: `r${n} · ${label}` }).catch(e => { void postChat(id, [{ role: "event", text: `되돌리지 못했어요 · ${String(e).slice(0, 60)}`, payload: { kind: "error", ai: "dynapse" } }]); return null; });
    if (!ok)
        return;
    const v = await appVerify(id);
    const r = { n, role: "restore", runtime: "dynapse", session_id: "", files: [], req: { text: label, restore: target?.n ?? sha } };
    await saveRound(id, r, label, v);
    await wput(id, ".dynapse/TRACE.json", JSON.stringify({ ...trace, rounds: [...(trace.rounds ?? []), r] }, null, 2));
    await postChat(id, [{ role: "event", text: label, payload: { kind: "shot", ai: "dynapse", round: n, pages: r.shots ?? [], commit: r.commit ?? ok, uploaded: !!r.uploaded, ais: ["dynapse"], labels: [label] } }]);
    void afterSave(id);
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
        await wput(id, page, out);
        for (const ed of await editionsOf(id, page)) {
            const eh = await wget(id, ed).catch(() => null);
            const eo = eh ? setSlotImg(eh, slot, file) : null;
            if (eo && eo !== eh)
                await wput(id, ed, eo);
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
    } // 턴 등급(#123)
    else if (skill)
        for (const f of ["CLAUDE.md", "AGENTS.md"])
            await wputOnce(id, f, skill, names);
    if (has) {
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
export async function chatSend(id, text, opts = {}) {
    const route = opts.route;
    const readyClaude = S.tools.claude.installed && S.tools.claude.loggedIn !== false, readyCodex = S.tools.codex.installed && S.tools.codex.loggedIn !== false;
    // 이 PC(#113) — 작업실 AI 줄에서 고른 경우, 또는 구독 AI가 없고 이 PC 엔진이 준비된 경우. 에이전트 세션 없이 결정적 러너로
    // 리워드는 이 PC로 하지 않는다(#113 §5 — 제출 provider에 local 없음)
    const isReward = /\((?:slide|deck) reward, task_id=/i.test(text) || rewardWorks.has(id);
    if (!isReward && (route?.design?.[0] === "local" || (!readyClaude && !readyCodex && localReady()))) {
        const { runLocalTurn } = await import("./fill-runner.js");
        await runLocalTurn(id, opts.raw ?? text, opts);
        return;
    }
    const want = route?.design?.[0] === "chatgpt" && readyCodex ? "codex" : readyClaude ? "claude" : readyCodex ? "codex" : null;
    const key = `${id}|${want ?? "none"}`;
    let s = sessions.get(key);
    if (!s) {
        const tool = want;
        if (!tool) { // 연결 전(#20) — 메시지는 버리지 않고 기다렸다가 로그인되면 이어서
            waiting.push({ id, text, opts });
            await postChat(id, [{ role: "event", text: null, payload: { kind: "need-ai", ai: "dynapse" } }]);
            return;
        }
        const trace = await readJson(id, ".dynapse/TRACE.json");
        const rt = tool === "claude" ? "claude_code" : "codex";
        // 이어받을 세션(#29 A8) — 턴마다 갱신하는 .dynapse/session.json 먼저(저장 안 된 턴 뒤에도), 없으면 TRACE rounds
        const sj = await readJson(id, ".dynapse/session.json");
        const prev = sj?.[rt] || [...(trace?.rounds ?? [])].reverse().find(r => r.runtime === rt && r.session_id)?.session_id;
        const remembered = (await readJson(id, ".dynapse/allow.json").catch(() => null)) ?? [];
        s = { tool, ai: tool === "claude" ? "claude" : "chatgpt", sessionId: prev, busy: false, queue: [], lastAt: Date.now(), out: [], verifyN: 0, fixups: 0, extraAllow: remembered.filter(x => typeof x === "string" && /^[\w]+(\(.{1,120}\))?$/.test(x)).slice(0, 30),
            extraDirs: ((await readJson(id, ".dynapse/allow-dirs.json").catch(() => null)) ?? []).filter(okDir).slice(0, 8) };
        sessions.set(key, s);
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
    s.effort = pick?.effort || "low"; // 고르지 않으면 낮음(대표 2026-10-01 — 덱 실측 끝까지 47초·토큰 절반, 문구 비슷). 한 작업 안에서 강도가 섞이지 않아 프로세스 재시작도 없다
    // 가벼운 편집 턴(#51 §4) — 📍·글자·폰트·직접 수정 뒤 정리는 Sonnet 5 · 보통. AI 줄에서 고른 모델이 있으면 그것
    // #54 C8 전제 — 모델이 바뀌면 지금은 Claude 프로세스를 다시 띄워(캐시 없는 재처리 5~30초) 오히려 느리다. 모델별 프로세스 유지(C8) 뒤에 켠다
    s.noRefusalRetry = !!opts.refusalRetry;
    s.lightAuto = false;
    s.light = !!opts.light;
    s.scope = opts.scope;
    s.viz = !!opts.viz;
    s.vizRetried = false;
    s.motion = !!opts.motion;
    if (LIGHT_SONNET && opts.light && s.ai === "claude" && !pick?.model) {
        s.model = "claude-sonnet-5";
        s.effort = pick?.effort || "low";
        s.lightAuto = true;
    }
    if (opts.receivedAt)
        s.tm = { received: opts.receivedAt }; // 기본 강도 = 보통(대표 2026-09-26: 한 턴 7분은 길다). AI 줄에서 고르면 그 값
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
    {
        const other = [...sessions.entries()].find(([k, x]) => k.startsWith(`${id}|`) && x !== s && x.busy);
        if (other) {
            (other[1].afterIdle ??= []).push({ text, opts });
            return;
        }
    }
    if (s.busy && s.queue.length) {
        s.queue[s.queue.length - 1] += `\n\nAlso: ${head}${text}`;
        const k = s.reqQueue.length - 1;
        if (request)
            s.reqQueue[k] = s.reqQueue[k] ? `${s.reqQueue[k]} · ${request}` : request;
    }
    else {
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
            s.out.push({ role: "event", text: "여기까지 저장했어요 · 이어서", payload: { kind: "stage", ai: "dynapse" } });
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
            const again = s.turnText, rt = s.tool === "claude" ? "claude_code" : "codex";
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
            if (norm(sh.text ?? "") === norm(m.text))
                continue;
            const html = await wget(id, pg.file);
            if (!html)
                continue;
            const neu = esc((sh.text ?? "").trim()).replace(/\n/g, "<br>");
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
            await placePhoto(id, pg.file, key, sh.file, { runtime: "mine" });
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
        const order = (await readJson(id, ".dynapse/pages.json").catch(() => null)) ?? [], f0 = order.find(f => bases.includes(f)) ?? bases[0], h0 = f0 ? (await wget(id, f0).catch(() => null)) ?? "" : "";
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
// 번역(#74 §3 → #100) — 원문 장은 그대로 두고 언어판에. 처음이면 원문을 복사해 만들고, 있으면 원문 글이 바뀐 칸만 다시(only = 그 장만)
async function translateTurn(id, lang, ai, only) {
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
            const order = (await readJson(id, ".dynapse/pages.json").catch(() => null)) ?? [], first = (order[0] && (await wget(id, order[0]).catch(() => null))) || h;
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
        {
            const dh = parseH(h);
            for (const l of [...textLeaves(dh), ...vizLeaves(dh)])
                if (fresh || src[l.sel] !== l.text)
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
    const tr = await trRules(L), fixes = await langFixes(id, L);
    const rulesTxt = [
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
    if (created || only?.length)
        await polishEdition(id, lang, ai).catch(() => { }); // 언어판 전체를 한 번 검사·다듬기(#100 보정 5)
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
export async function nextTurn(id, s) {
    s.denyHit = false;
    s.denyNoted = false;
    presence(id, "turn", turnPage.get(id) ?? null);
    void import("./form-alts.js").then(x => x.cancelPrerender(id)).catch(() => { }); // 턴이 시작되면 다른 모양 미리 만들기 중단(#119 보정 9 §2)
    const text0 = s.queue.shift();
    const req = s.reqQueue?.shift();
    // 턴 등급(#123) — 무거움: 리워드·작업의 첫 턴·덱 범위·"전체 다시" / 가벼움: 📍 한 칸·글자·폰트 정리·카피 다듬기 / 그 밖 보통.
    // 등급마다 지침 묶음(가벼움은 CLAUDE.md 2k자만 · 보통·무거움은 .dynapse/skill-normal|heavy.md를 먼저 읽게)과 토큰 상한(15k·60k·160k)이 다르다
    {
        const first = !((await readJson(id, ".dynapse/TRACE.json").catch(() => null))?.rounds?.length), rq = req ?? text0 ?? "";
        s.tier = s.rewardTask || rewardWorks.has(id) || /\((?:slide|deck) reward, task_id=/i.test(rq) || first || s.scope === "deck" || s.noRefusalRetry || /전체\s*(를\s*)?다시|처음부터|덱\s*(을|를)?\s*다시/.test(rq) ? "heavy"
            : /^\[copy-polish\]/.test(rq) || ((s.light || s.scope === "slot") && !NEEDS_LOOK.test(rq)) ? "light" : "normal";
        s.tierCap = s.tier === "heavy" ? 160_000 : s.tier === "normal" ? 60_000 : 15_000;
        s.tierHit = false;
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
    const text = text0 ? tierHead + refHead + (await docHead(id).catch(() => "")) + text0 : text0;
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
    if (s.rewardTask || rewardWorks.has(id))
        s.budgetT = setTimeout(() => {
            if (!s.busy || s.post || s.procId === undefined)
                return;
            s.out.push({ role: "event", text: "8분이 지났어요 · 여기까지 검사하고 저장해요", payload: { kind: "stage", ai: "dynapse" } });
            flushSoon(id, s);
            if (s.tool === "claude") {
                s.interrupted = true;
                void T().core.invoke("run_write", { id: s.procId, line: JSON.stringify({ type: "control_request", request_id: `budget-${Date.now()}`, request: { subtype: "interrupt" } }) }).catch(() => { });
            }
            else
                void T().core.invoke("run_kill", { id: s.procId }).catch(() => { });
        }, REWARD_BUDGET_MS);
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
                "--permission-mode", s.auto ? "auto" : "manual", "--disallowedTools", DENY.join(" "),
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
            s.out.push({ role: "event", text: "여기까지 저장했어요 · 이어서", payload: { kind: "stage", ai: "dynapse" } });
            await endTurn(id, s, true);
            return;
        }
        if (s.capped)
            await capStop(id, s);
        else
            await endTurn(id, s, code === 0, code === 0 ? undefined : unsup ? `모델 설정 · ${s.model}은 ChatGPT 계정에서 못 써요 — 기본 모델로 바꿨어요. 다시 보내 주세요` : `Codex가 끝나지 못했어요(종료 코드 ${code})`);
        if (unsup)
            s.model = null;
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
export async function endTurn(id, s, ok, why) {
    if (!s.busy)
        return;
    if (s.stopped)
        return stoppedTurn(id, s); // ■ 중단(#50) — 검증·커밋·썸네일 없이
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
        s.out.push({ role: "event", text: `자동 승인 · ${s.denied.map(r => r.replace(/^Bash\((\S+).*$/, "$1")).join(", ").slice(0, 60)}`, payload: { kind: "stage", ai: s.ai } });
        s.denied = [];
        s.autoRetry = (s.autoRetry ?? 0) + 1;
        s.queue.unshift("Re-run the command that was just blocked and continue.");
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
    if (!ok) {
        // 시작도 못 한 턴(세션·결과 없음) — 요청을 기억했다가 다음 메시지에 함께 넘긴다("이어서 해줘"가 빈 대화가 되지 않게)
        if (!s.sessionId && !s.usage && s.turnText)
            s.failedText = s.turnText;
        if (s.mx)
            s.mx.failed = true;
        s.out.push({ role: "event", text: why ?? `${AI_LABEL[s.ai]}가 이유를 남기지 않고 끝났어요 · 다시 보내면 이어서 해요`, payload: { kind: "error", ai: s.ai, model: s.runModel ?? null } });
        report("turn", `turn.fail_${s.ai}`, `model=${s.runModel ?? "-"} started=${!!s.sessionId}`);
        tally("turns", false); // 원격 보고(#116 §1) — 글은 싣지 않는다
        if (s.lastText)
            s.out.push({ role: "agent", text: s.lastText, payload: { ai: s.ai, model: s.runModel ?? null, summary: summaryLines(s.lastText) } });
        await discardTurn(id, s); // 실패 턴 = 커밋 없음, 파일은 턴 시작 상태로(#30)
        return finishTurn(id, s);
    }
    await mergeTurn(id, s); // 에이전트의 turn.json → TRACE·NOTES·tags(#29 C4)
    {
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
            const now = (await readJson(id, ".dynapse/pages.json").catch(() => null)) ?? [];
            if (now.length && now.join() !== oa.start.join()) {
                orderUnlock.delete(id);
                const ord = await normalizeOrder(id, now).catch(() => null);
                if (ord)
                    await wput(id, ".dynapse/order-lock.json", JSON.stringify({ order: ord, at: Date.now() })).catch(() => { });
                const moved = (ord ?? now).filter((f, i) => oa.start.indexOf(f) !== i).length;
                s.out.push({ role: "event", text: `순서 바꿈 · ${moved}장 이동`, payload: { kind: "stage", ai: "dynapse", order: true } });
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
    // 첫 생성은 표지 1장(#49 B) — 나머지는 사용자가 [1장]·[2장]·[전부]로. 리워드는 브리프대로 전부
    const firstBuild = !((await readJson(id, ".dynapse/TRACE.json"))?.rounds?.length);
    // ① 에이전트가 바꾼 장을 먼저 검사(사진 전, #54 A1) — 실패면 같은 턴에 되돌려 보낸다
    const changed0 = S.git ? await T().core.invoke("repo_changed", { id }).catch(() => []) : [];
    const pages0 = changed0.filter(isPage); // 아래 언어판 따라가기가 더할 수 있다
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
        // 글자만 바뀐 턴(#51 §3) — 결과 장의 태그·속성은 그대로이고 글자만 다르면 렌더·스크린샷 생략(정적 검사만)
        const textOnly = changed0.every(f => isPage(f) || f.startsWith(".dynapse/")) && await textOnlyChange(id, pages0);
        const v0 = Date.now();
        const order = await normalizeOrder(id, undefined, pages0).catch(() => null);
        // 잠금이 되돌린 횟수(#139 A)
        if (orderRestored.delete(id)) {
            report("turn", "order.lock_restore", `tier=${s.tier ?? "-"}`);
            s.out.push({ role: "event", text: "장 순서는 정해 두신 대로 두었어요", payload: { kind: "stage", ai: "dynapse" } });
        } // 장 순서·쪽번호(#97) — 검사·저장 전에. 새로 생긴 장만 순서에(#98 보정 1)
        await joinPages(id, pages0).catch(() => { }); // 한글 줄바꿈 묶기(#91 §5) — 검사·저장 전에
        {
            let tm = 0, sl = 0;
            for (const pg of pages0.filter(f => /^result-[a-z0-9-]+\.html$/.test(f) || LANG_PAGE.test(f))) {
                const h0 = await wget(id, pg).catch(() => null);
                if (!h0)
                    continue;
                const r = repairStyleLeak(h0);
                sl += r.n;
                const x = stripTextMotion(r.html);
                tm += x.n;
                if (x.html !== h0)
                    await wput(id, pg, x.html).catch(() => { });
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
        // 보는 검토(#98) — 지난 바퀴의 답(FIXED/KEPT)을 모으고, 이번에 한 번 더 볼지. 리워드(제출이 턴 안)·Codex(후속 메시지 없음)는 안 한다
        if (s.reviews)
            s.reviewNotes = [...(s.reviewNotes ?? []), ...reviewNotes(s.lastText)];
        const fast = s.scope !== "deck" && (s.route?.review === "fast" || !!s.light || !!textOnly); // 덱 범위(#99)는 편집자 읽기까지 반드시
        const canLook = s.tool === "claude" && s.procId !== undefined && (s.reviews ?? 0) < 2 && !(s.reviews && lastWord(s.lastText) === "DONE") && !s.rewardTask && !rewardWorks.has(id) && s.tier !== "light" && s.tier !== "normal"; // 보는 검토·편집자 읽기는 무거운 턴만(#123)
        v1 = await appVerify(id, pages0, { noRender: !!textOnly, reward: !!s.rewardTask || rewardWorks.has(id), board: canLook && !fast });
        // 턴의 실패 = AI가 쓴 장의 오류(+ 덱 전체 "*")만(#127). 앱이 다시 쓴 장: 예전부터 있던 오류는 칩 하나, 새로 생긴 오류는 앱 탓 → 그 장만 턴 시작으로 되돌리고 보고
        {
            const last = (await readJson(id, ".dynapse/last-errors.json").catch(() => null)) ?? {};
            const own = v1.errors.filter(e => !s.startPages || e.page === "*" || aiPages.includes(e.page)), other = v1.errors.filter(e => !own.includes(e));
            const stale = other.filter(e => (last[e.page] ?? []).includes(e.rule)), regress = other.filter(e => !stale.includes(e));
            // 되돌린 뒤 그 장에 쌓인 직접 수정(턴 도중 사용자가 바꾼 글·사진·초점)을 다시 얹는다(#100 보정 5 조사 — 턴 시작 판으로 되돌리면 그 사이 직접 수정이 지워졌다)
            const pend0 = await pendingOf(id).catch(() => []);
            // 대체 검사(node가 못 돈 때)로는 되돌리지 않는다
            for (const pg of [...new Set(regress.map(e => e.page))]) {
                if (v1.engine === "app")
                    break;
                const st = s.startPages?.get(pg);
                if (st !== undefined) {
                    let h = st;
                    for (const e of pend0.filter(x => "page" in x && x.page === pg))
                        h = applyEdit(h, e);
                    await wput(id, pg, h).catch(() => { });
                }
                report("turn", "fit.regress", [...new Set(regress.filter(e => e.page === pg).map(e => e.rule))].join(","));
            }
            const now = {};
            for (const e of [...own, ...stale])
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
        s.out.push({ role: "event", text: null, payload: { kind: "verify", ai: "dynapse", ok: v1.ok, errors: v1.errors.slice(0, 5), warnings: v1.warnings.length, wk: warnKinds(v1.warnings) } });
        if (!v1.ok && s.fixups < 1 && s.tool === "claude" && s.procId !== undefined) {
            s.fixups++;
            foldUsage(s);
            if (!s.reviews && s.firstReply === undefined)
                s.firstReply = s.lastText;
            await flushChat(id, s);
            s.verifyN = 0;
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
    const reply = s.firstReply ?? s.lastText;
    s.out.push({ role: "agent", text: reply ?? "끝났어요", payload: { ai: s.ai, model: s.runModel ?? null, summary: summaryLines(reply) } });
    const notes = s.reviewNotes ?? [];
    if (notes.length) {
        const fx = notes.filter(x => x.t === "fixed").length, kp = notes.length - fx;
        s.out.push({ role: "event", text: `편집자 읽기 · 고친 것 ${fx} · 남긴 것 ${kp}`, payload: { kind: "review", ai: s.ai, fixed: fx, kept: kp, items: notes.map(x => ({ ...x, page: PAGE_RE.test(x.page) ? x.page : null })) } });
    }
    await flushChat(id, s);
    s.post = true;
    active++;
    const ph0 = Date.now();
    const photoAis = await runPhotoRequests(id, s.route, s.rewardTask || rewardWorks.has(id) ? { cap: 8, reward: true } : { first: firstBuild && !importedWorks.has(id) }).catch(() => []).finally(() => { active--; });
    if (photoAis.length)
        (s.tm ??= {}).photo_ms = Date.now() - ph0;
    await applyFontPick(id).catch(() => { }); // 글꼴 한 줄(#36)도 이 요청의 커밋에
    if (photoAis.length)
        s.photoAis = [...new Set([...(s.photoAis ?? []), ...photoAis])];
    const changed = S.git ? await T().core.invoke("repo_changed", { id }).catch(() => []) : ["?"];
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
        if (trace.empty_slots?.length && !before.has(`empty:${JSON.stringify(trace.empty_slots)}`) && !photoAis.length)
            s.out.push({ role: "event", text: "사진 칸 비어 있음", payload: { kind: "photo-empty", ai: "dynapse", slots: trace.empty_slots.slice(0, 6) } });
        // 스레드 항목(#30) — 바뀐 곳 라벨(파일 줄 어휘: 표지 · 사진)과 관여한 AI(편집 + 사진)
        const labels = [...new Set([...pages.map(pageLabel), ...photoPages.map(f => `${pageLabel(f)} · 사진`)])].slice(0, 6);
        const ais = [s.ai, ...(s.photoAis ?? [])].filter((a, k, all) => all.indexOf(a) === k);
        const r = { n, role: "write", runtime: s.tool === "claude" ? "claude_code" : "codex", session_id: s.sessionId ?? "", files: vpages,
            req: { text: request }, summary: summaryLines(reply), ...(s.runModel ? { model: s.runModel } : {}), ...(s.merged ? { merged_from: s.merged } : {}) };
        const c0 = Date.now();
        await saveRound(id, r, s.failTag ? `검증 실패 · ${request}` : request, v);
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
        const photos = await photoTally(id, trace).catch(() => null); // 턴 카드 "사진 3 · ◆2 ✦1"(#37)
        s.out.push({ role: "event", text: null, payload: { kind: "shot", ai: s.ai, round: n, pages: r.shots ?? [], commit: r.commit ?? null, uploaded: !!r.uploaded, model: s.runModel ?? null, ais, labels, ...(photos ? { photos } : {}) } }); // 스레드 항목 = 커밋 = 요청 하나(#20 · #30)
        if (s.mx && photos)
            s.mx.fill = { n: photos.n, empty: photos.empty };
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
        await repoCommit(id, request);
    s.post = false;
    s.stopped = false; // ■가 사진 도중이면 러너가 지금 장까지만 — 여기서 정리
    if (touched && ok && changed.some(isPage))
        await flatPhotos(id).catch(() => 0); // AI가 하위 폴더에 둔 사진(#130 보정 4) — 턴 끝에 한 단계로
    // 강조색은 표지 사진에서(#119 보정 8 §3) — 개인 작업, 사진이 든 표지, 기본 강조색일 때 한 번(색을 정했거나 리워드면 건드리지 않는다)
    if (touched && ok && !s.rewardTask && !rewardWorks.has(id) && (!sharedWorks.has(id) || await isOriginDevice(id).catch(() => false)))
        void import("./accent.js").then(x => x.accentFromCover(id)).catch(() => false);
    // 다른 모양 미리 만들기(#119 보정 9 §2) — 저장 뒤 유휴 8초에 이번 턴에 바뀐 장(최대 3장). 멤버 기기는 안 한다(원본 기기만 렌더)
    if (touched && ok && (!sharedWorks.has(id) || await isOriginDevice(id).catch(() => false)))
        void import("./form-alts.js").then(x => x.schedulePrerender(id, changed.filter(isPage))).catch(() => { });
    return finishTurn(id, s);
}
// 보는 검토(#98) — 앱 검사를 통과한 턴 끝에 같은 세션으로 한 번 더: 스토리보드·바뀐 장 작은 PNG·차트/표 요소 PNG를 Read로 보게 하고(그림), 1바퀴째엔 덱 전체 글자로 편집자 읽기 7문(글자).
// 고쳤으면 앱이 다시 검사하고 한 번 더 보게(최대 2바퀴). 답은 FIXED/KEPT 줄 + 마지막 줄 DONE|CHANGED → 완료 카드 "편집자 읽기 · 고친 것 N · 남긴 것 M"
const DECK_LINTS = ["same_layout", "stale_pages", "no_numbers", "emoji", "small", "tiny_text", "page_no", "density", "variety", "story_flow"];
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
    lines.push("", `Rules: ${verbatim ? "this request is copy-as-written — never rewrite the user's sentences; only re-layout, reorder or split. " : "keep the user's facts and wording; "}never invent numbers; do not run verify.mjs, do not open a browser; edit only result-*.html, .dynapse/pages.json and .dynapse/appendix.json; never rename result-*.html.`, "Reply in this format, one item per line (the text after | in Korean, short):", "FIXED <file or deck> | what you changed", "KEPT <file or deck> | what you saw but left, and why", "Last line: DONE if you changed no file in this round, otherwise CHANGED.");
    return { text: lines.join("\n"), imgs: imgs.length };
}
const addUsage = (a, b) => !a ? b : !b ? a : { tokens: a.tokens + b.tokens, cached: (a.cached ?? 0) + (b.cached ?? 0), usd: a.usd !== undefined || b.usd !== undefined ? (a.usd ?? 0) + (b.usd ?? 0) : undefined,
    parts: a.parts && b.parts ? Object.fromEntries(Object.keys({ ...a.parts, ...b.parts }).map(k => [k, (a.parts?.[k] ?? 0) + (b.parts?.[k] ?? 0)])) : a.parts ?? b.parts };
// 같은 턴 안의 후속 메시지(고침·보는 검토) 앞에 — 지금까지의 사용량을 접어 둔다(결과마다 사용량이 그 구간 값으로 덮이므로)
function foldUsage(s) { if (s.reviews)
    s.look = { ...(s.look ?? { n: 0, imgs: 0, tok: 0 }), tok: (s.look?.tok ?? 0) + (s.usage?.tokens ?? 0) }; s.usageAcc = addUsage(s.usageAcc ?? null, s.usage ?? null); s.usage = null; }
// 남은 오류 한 줄(#55) — 종류(장 칸) 최대 3개: "잘린 글자(본문 section_title) · 사진 칸(표지)"
const RULE_KO = { free_axis: "정렬 축", free_empty: "빈 영역", free_margin: "바깥 여백", overlap_box: "겹침", overflow_x: "넘침", viz: "시각화 데이터", hand_lost: "손으로 고친 것 지워짐", clipped: "잘린 글자", spill: "상자 밖 글자", render_empty: "빈 차트", page_no: "쪽번호", tiny_text: "아주 작은 글자", overflow: "화면 밖 글자", "data-slot": "칸", tokens: "토큰", glyph: "글꼴", external: "외부 주소", size: "크기", missing: "사진 파일 없음", section: "장 구조", photos: "사진 장 수" };
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
const isPhotoSlot = (tag, attrs, slot) => tag.toLowerCase() === "figure" || /\bdata-kind\s*=\s*["']photo["']/i.test(attrs) || PH_NAME.test(slot);
async function photoTally(id, trace) {
    const pages = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(n => /^result-[a-z0-9-]+\.html$/.test(n));
    const t = { n: 0, stock: 0, agy: 0, codex: 0, mine: 0, empty: 0 };
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
        const add = [`## R${n} · ${s.tool === "claude" ? "claude_code" : "codex"}`, ...(s.turnText ? [`- 요청: ${s.turnText.split("\n")[0].slice(0, 120)}`] : []), ...(t.changed ?? []).slice(0, 3).map(c => `- 바꾼 것: ${String(c).slice(0, 140)}`), ...(t.next ? [`- 다음에 볼 것: ${t.next.slice(0, 140)}`] : [])].join("\n");
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
export async function stopWork(id) {
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
export async function finishTurn(id, s) {
    void flushReports();
    clearTimeout(s.budgetT);
    s.budgetT = undefined;
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
    if (s.sessionId && !s.lightAuto) {
        const rt = s.tool === "claude" ? "claude_code" : "codex";
        const sj = (await readJson(id, ".dynapse/session.json")) ?? {};
        if (sj[rt] !== s.sessionId)
            await wput(id, ".dynapse/session.json", JSON.stringify({ ...sj, [rt]: s.sessionId })).catch(() => { });
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
        s.out.push({ role: "event", text: `${k} 토큰 · ${mmss(ms)}${tierText}${phText}${fitN ? ` · 줄·맞춤 ${fitN}곳` : ""}${rwLine}`, payload: { kind: "usage", ai: s.ai, tier: s.tier ?? null, timing: { ...timingOf(s), ...(ph ? { write: Math.round(ph.write_ms / 1000), fix: Math.round(ph.fix_ms / 1000), fix_n: ph.fix_n } : {}) }, tools: Object.entries(s.tools ?? {}).sort((a, b) => b[1].ms - a[1].ms).slice(0, 3).map(([n, x]) => ({ n, c: x.n, s: Math.round(x.ms / 1000) })), tokens: s.usage.tokens, cached: s.usage.cached ?? null, usd: s.usage.usd ?? null, parts: s.usage.parts ?? null,
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
        void sendMetric(id, { tid: x.tid, kind: x.kind, round: x.round ?? null, ok: !!x.committed, failed: !!x.failed, stopped: !!x.stopped, stop_at: x.stop_at ?? null, outcome,
            ai: s.ai, model: s.runModel ?? s.model ?? null, effort: s.effort ?? null,
            tok: s.usage ? { total: s.usage.tokens, in: u?.input ?? null, out: u?.output ?? null, cw: u?.cache_write ?? null, cr: u?.cache_read ?? s.usage.cached ?? null } : null,
            t: { ...timingOf(s), total: Math.round(ms / 1000) },
            tools: { n: tools.reduce((a, [, v]) => a + v.n, 0), top: tools.sort((a, b) => b[1].ms - a[1].ms).slice(0, 3).map(([n, v]) => ({ n, c: v.n, s: Math.round(v.ms / 1000) })), skill: x.skill },
            verify: { runs: x.runs, rules: x.rules, fixups: s.fixups, ...(x.flow ? { flow: x.flow } : {}) }, photo: ps ?? null,
            files: x.files ?? null, fill: x.fill ?? null, hand: x.hand ?? 0, points: x.points ?? 0, len: x.len ?? null, ph: x.ph ?? null, phase: x.phase ?? null, copy: x.copy ?? null, tier: x.tier ?? null }); // phase = 쓰기·고치기 구간(#120)
    }
    if (!s.queue.length)
        setTimeout(() => void syncPending(id), 0); // 턴 중에 온 새 판(#56 보정 3)
    {
        const ps = pendingSubmit.get(id);
        if (ps && !s.queue.length) {
            pendingSubmit.delete(id);
            setTimeout(() => { active++; void submitReward(id, ps.taskId, ps.replaces).finally(() => { active--; }); }, 0);
        }
    } // 계획 고친 뒤 다시 제출(#127 §2)
    if (s.afterIdle?.length && !s.queue.length) {
        const w = s.afterIdle;
        s.afterIdle = [];
        setTimeout(() => { for (const x of w)
            void chatSend(id, x.text, x.opts); }, 0);
    }
    s.busy = false;
    s.fixups = 0;
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
    if (!s.queue.length) {
        presence(id, "view");
        turnPage.delete(id);
    }
    if (!s.queue.length && (!sharedWorks.has(id) || await isOriginDevice(id).catch(() => false)))
        void shrinkBig(id).catch(() => 0); // 4MB 넘는 사진은 올리기 전에 앱이 먼저 줄인다(#128 · 저장 때도 — afterSave)   // 턴 끝 표시(#128) — 웹의 진행 단어("검사 중 · N분째")를 지운다. 채팅엔 안 보인다
    render();
    // 카피 다듬기(#122 §3) — 개인 작업 턴이 AI 말투(copy_ai)를 남기면 그 칸만 고치는 가벼운 턴 한 번(글만 · 레이아웃 그대로). 요청마다 한 번, 리워드는 #120 횟수 안에서 AI가 고친다
    if (!s.queue.length && s.copyHits?.length && !s.copyPolished && !s.rewardTask && !rewardWorks.has(id) && !s.stopped && s.tier === "heavy") { // 다듬기 패스는 무거운 턴만(#123) — 보통은 같은 턴에서 고치게 지시
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
    await postChat(id, batch);
    if (s.out.length)
        flushSoon(id, s);
}
export async function postChat(id, messages) {
    await api("POST", `/api/works/${encodeURIComponent(id)}/messages`, { messages }).catch(() => { });
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
const lastPin = new Map(), whichRetried = new Set();
const ASK_WHICH = /어느\s*(페이지|장|슬라이드|섹션|부분|요소|칸)|어떤\s*(페이지|장|섹션|부분|요소|칸)|특정해|알려\s*주시면|짚어\s*주시면|which (page|slide|section|element|part)|point (me )?to/i;
const ORDER_ASK = /순서|재조정|재배치|재구성|배치를?\s*(바꿔|다시)|흐름(을)?\s*(바꿔|다시|맞게)|정렬|앞으로|뒤로|맨\s*앞|맨\s*뒤|옮겨|옮기|이동해|다음으로|앞에\s*(넣|두|놓)|뒤에\s*(넣|두|놓)|move|reorder|swap|put .* (before|after)/i;
const PAGE_NAMED = /\d+\s*[~\-–]\s*\d+\s*(번|장|페이지|쪽)?|\d+\s*(장|번째|번|페이지|쪽|p\b)|표지|마무리|부록|데모|result-[a-z0-9-]+|\b(page|slide)\s*\d+|["“'‘][^"”'’]{2,30}["”'’]\s*(장|페이지|슬라이드)/i;
// 순서 말과 장 이름이 25자 안에 붙어 있어야 옮기기 요청("데모 두 장을 16장 뒤로") — 긴 카피 지시 속 흐름 설명("표지 다음으로 문제, 데모…")은 아니다
export function isReorderAsk(t) {
    const at = (re) => [...t.matchAll(new RegExp(re.source, "gi"))].map(m => m.index ?? 0);
    const o = at(ORDER_ASK), p = at(PAGE_NAMED);
    return o.some(a => p.some(b => Math.abs(a - b) <= 25)) && (t.length <= 400 || /순서를?\s*(바꿔|바꾸|옮)|옮겨\s*(줘|주세요)|move .* (to|before|after)|reorder/i.test(t));
}
const REFUSAL = /(덱|장|페이지|슬라이드|워크룸)\s*(에서\s*)?['"‘“]?(덱|장|페이지)?['"’”]?\s*단위.{0,24}요청|다시\s*요청해\s*주셔야|턴으로\s*다시|can'?t do (this|that) in a (light|slot|page) turn|레이아웃\s*(의\s*)?제한|가벼운\s*턴\s*(의\s*)?범위|범위를\s*벗어나|단위\s*(작업|요청)으로\s*다시|다시\s*보내\s*주|light turn|out of (the )?scope|페이지\s*단위로\s*(다시\s*)?요청|장\s*단위로\s*(다시\s*)?요청|파일을\s*(바꾸|수정하|변경하)지\s*않았|승인으로만\s*받아들|핀(이|으로)?\s*(가리킨|지정한)\s*(칸|부분)만|page-level request|did not change any files|outside the pinned/i;
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
    await T().core.invoke("open_inapp", { path: p, origin: HUB }).catch(() => T().shell.open(`${HUB}${path}`)); // 이 PC가 여는 주소로(pickHub)
}
// 진행 미러 — 단계 문장·AI·시작 시각을 웹 진행 카드로(3초에 1번 이하, 끝날 때 1번)
// 저장 뒤: ① 메타(TRACE 라운드·사진 기록·NOTES·팀) ② 표지의 비공개 썸네일(서버가 찍고 html은 버린다) ③ 동기화를 켰으면 결과 html 사본
const thumbSent = new Map();
export async function afterSave(id) {
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
    if (S.sync || sharedWorks.has(id) || await onServer(id)) {
        if (!sharedWorks.has(id) || await isOriginDevice(id).catch(() => false))
            await shrinkBig(id).catch(() => 0); // 올리기 전에 큰 사진부터(#128 보정 3) — 함께 하는 작업은 원본 기기만
        await pushWork(id, dir);
    }
    else
        slog(id, "push.skip", { why: "not_shared" }); // 동기화 끔 · 공유 목록에 없음 · 서버 판 없음(#56 보정 8 — 18:24에 왜 안 올렸는지가 이것이었다)
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
    const cand = [];
    for (const f of pages) {
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
async function syncList(id) {
    const all = await T().core.invoke("work_files", { id }).catch(() => []);
    const list = [...all, ...(await pageRefs(id, all))]
        // 동기화·초대 범위(#21 보정 7 C) — 페이지 · materials · 생성 사진 · 참고 폴더(assets·refs·RULES) · 폴더 자료 목록(library.json — 출처 링크·쓰인 작업). 링크 원본·인덱스는 올리지 않는다
        .filter(x => /^result-[a-z0-9-]+\.html$/.test(x.name) || LANG_PAGE.test(x.name) || /^\.dynapse\/(pages|appendix|lang-status)\.json$/.test(x.name) || /^(materials|\.dynapse\/photos)\/[\w.-]+\.(png|jpe?g)$/i.test(x.name) || /^context\/(RULES\.md|library\.json|(assets|refs)\/[^/]+)$/.test(x.name)
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
    const keep = (n) => { const m = n.match(VER); return share?.history || !m || bound.has(n) || newest.get(m[1] + m[3]) === Number(m[2]); };
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
    const mine = await syncList(id);
    const hm = new Map(theirs.map(f => [f.path, f.sha256])), mm = new Map(mine.map(f => [f.path, f.sha256]));
    // base를 모르면(처음 올리는 기기) 내 것과 head를 바로 비교 — 둘 다 있고 다르면 겹침, 한쪽에만 있으면 그쪽
    const bm = baseF ? new Map(baseF.map(f => [f.path, f.sha256])) : null;
    const changed = (m) => bm ? new Set([...[...m].filter(([p, h]) => bm.get(p) !== h).map(([p]) => p), ...[...bm.keys()].filter(p => !m.has(p))]) : new Set(m.keys());
    const A = changed(mm), B = changed(hm);
    const both = [...B].filter(p => A.has(p) && mm.get(p) !== hm.get(p) && (bm || (mm.has(p) && hm.has(p))));
    const isPg = (p) => /^result-[a-z0-9-]+\.html$/.test(p) || LANG_PAGE.test(p);
    const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14), conflicts = [], saved = {};
    let got = 0;
    for (const p of B) {
        if (p === ".dynapse/pages.json" && both.includes(p))
            continue; // 아래에서 합친다
        if (both.includes(p) && !bm && !hm.has(p))
            continue;
        // 같은 파일(#56 보정 10 — 고르라고 하지 않는다): 나중에 올리는 쪽(나)의 판을 둔다. 덮인 판은 기록(head 커밋)에 남고, 그 사람에게 [내 판으로] 한 줄이 간다
        if (both.includes(p)) {
            conflicts.push(p);
            continue;
        }
        if (hm.has(p)) {
            if (await fetchFile(id, dir, head, p))
                got++;
            else {
                slog(id, "merge.fail", { why: "fetch", path: p });
                return none;
            }
        }
        else if (bm && isPg(p) && !A.has(p)) {
            await T().core.invoke("page_delete", { id, path: p }).catch(() => { });
            got++;
        } // head가 지운 장(내가 손대지 않은 것만)
    }
    if (both.includes(".dynapse/pages.json")) { // 순서 — head 순서 + 내가 새로 만든 장
        const ok = await fetchFile(id, dir, head, ".dynapse/pages.json");
        const theirsOrder = ok ? ((await readJson(id, ".dynapse/pages.json").catch(() => null)) ?? []) : [];
        const baseOrder = bm && base ? await (async () => { const g = await http("GET", `${HUB}/api/works/${encodeURIComponent(id)}/commits/${base}?path=.dynapse%2Fpages.json`, { auth: true }).catch(() => null); try {
            return g?.status === 200 ? JSON.parse(g.body) : [];
        }
        catch {
            return [];
        } })() : [];
        const myNew = mine.map(f => f.path).filter(p => isPg(p) && !baseOrder.includes(p) && !theirsOrder.includes(p) && !LANG_PAGE.test(p));
        await wput(id, ".dynapse/pages.json", JSON.stringify([...theirsOrder, ...myNew]));
    }
    const msg = `합침 · ${short(head)} 받고 내 변경 ${[...A].filter(p => !both.includes(p)).length}개${conflicts.filter(p => p !== ".dynapse/pages.json").length ? ` · 같은 장 ${conflicts.filter(p => p !== ".dynapse/pages.json").length}개는 내 판` : ""}`;
    await repoCommit(id, msg);
    slog(id, conflicts.length ? "merge.card" : "merge.auto", { base: short(base), head: short(head), mine: A.size, theirs: B.size, both: both.length, got, ms: Date.now() - t0 });
    report("sync", conflicts.length ? "merge.card" : "merge.auto", `work=${id} mine=${A.size} theirs=${B.size} both=${both.length}`);
    return { ok: true, theirs: B.size, mine: A.size, conflicts: conflicts.filter(p => p !== ".dynapse/pages.json"), saved };
}
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
    let files = await syncList(id);
    const trace = await readJson(id, ".dynapse/TRACE.json");
    // base = 이 기기가 마지막으로 맞춘 서버 판(#56 보정 7) — 서버는 base가 지금 head일 때만 받는다(빨리 감기)
    let base = heads[id] ?? null;
    let body = { sha, parent: base, base, message: trace?.rounds?.at(-1)?.req?.text ?? null, model: trace?.rounds?.at(-1)?.model ?? null, merged_from: trace?.rounds?.at(-1)?.merged_from ?? null, files };
    // 올리는 상태(#21 보정 14 C) — 웹 상태 줄 "☁ 올리는 중 n/m"·파일 줄 ↑→✓/! (채팅엔 안 보이는 이벤트)
    const up = (p) => postChat(id, [{ role: "event", text: null, payload: { kind: "upload", ai: "dynapse", ...p } }]);
    const failed = [], putFail = [];
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
            await up({ state: "done", total: files.length, files: files.map(f => f.path), failed });
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
            files = await syncList(id);
            base = r.data.head;
            body = { ...body, sha, parent: base, base, files };
            overrode = mr.conflicts.length ? { pages: mr.conflicts.slice(0, 20), head: r.data.head } : null;
            body = { ...body, ...(overrode ? { overrode } : {}) };
            if (mr.theirs || mr.conflicts.length)
                await postChat(id, [{ role: "event", text: `새 판의 변경 ${mr.theirs}개를 받고 내 변경 ${mr.mine}개를 올려요${mr.conflicts.length ? ` · 같은 장 ${mr.conflicts.length}개는 내 판으로` : ""}`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
            continue;
        }
        // 공유가 꺼진 작업(#56 보정 5)·멤버 올리기 꺼짐(#56 보정 7) — 실패가 아니다: 서버가 이 작업을 받지 않는 상태. 조용히 끝내고 같은 판으로는 다시 시도하지 않는다
        if ((r?.status === 409 || r?.status === 423) && !r.data?.missing?.length && /공유가 꺼져|원래 PC|원본 PC|잠시 멈췄/.test(String(r.data?.error ?? ""))) {
            // 차단기(잠시 멈춤)는 표시하지 않는다 — 관리자가 풀면 다음 저장에 다시(같은 판을 영영 안 올리는 일이 없게)
            if (!r.data?.paused) {
                heads[`${id}#off`] = sha;
                await store.set("remote_heads", heads);
                await store.save();
            }
            slog(id, "push.off", { sha: short(sha), why: r.data?.paused ? "breaker" : /원본 PC/.test(String(r.data?.error)) ? "member_push_off" : "share_off" });
            await up({ state: "off", total: 0, files: [], failed: [], why: r.data?.paused ? "breaker" : /원본 PC/.test(String(r.data?.error)) ? "member_push_off" : "share_off" });
            return;
        }
        if (r?.status !== 409 || !r.data?.missing?.length) {
            slog(id, "push.fail", { status: r?.status ?? 0 });
            report("sync", "sync.push_fail", `status=${r?.status ?? "net"}`);
            await up({ state: "fail", total: files.length, files: [], failed: files.map(f => f.path) });
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
            files = await syncList(id);
            body = { ...body, files };
            failed.length = 0;
            putFail.length = 0;
        }
    }
    // 왜 못 올렸는지(#56 보정 5) — 파일별 상태·크기. 4MB 넘는 장은 사진을 파일로 빼면 된다([빼기])
    const big = putFail.filter(x => x.status === 413 || x.size > 4 * 1024 * 1024).sort((a, b) => b.size - a.size), mb = (n) => `${(n / 1048576).toFixed(1)}MB`;
    const reason = big.length ? `${big[0].path} ${mb(big[0].size)} — 장은 4MB까지 · 사진을 파일로 빼면 돼요` : putFail.length ? `${putFail[0].path} 올리기 실패(${putFail[0].status || "네트워크"})` : undefined;
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
    for (const f of head.files) {
        const g = await http("GET", `${HUB}/api/works/${encodeURIComponent(id)}/commits/${head.sha}?path=${encodeURIComponent(f.path)}`, { out: `${dir}/${f.path}`, auth: true }).catch(() => null);
        if (g?.status !== 200)
            return fail(`파일 ${got}/${head.files.length} · ${why(g?.status)}`, got, head.files.length);
        got++;
        if (got % 3 === 0 && got < head.files.length)
            await down({ state: "run", done: got, total: head.files.length });
    }
    const pagesN = head.files.filter(f => /^result-[a-z0-9-]+\.html$/.test(f.path)).length;
    await down({ state: "done", done: got, total: head.files.length }, pagesN ? `받았어요 · ${pagesN}장` : "받았어요");
    const r = await api("GET", "/api/works").catch(() => null);
    const meta = r?.data?.works?.find(x => x.id === id)?.meta;
    if (meta?.brief)
        await wput(id, ".dynapse/brief.json", JSON.stringify(meta.brief, null, 2));
    if (meta?.team)
        await wput(id, ".dynapse/team.json", JSON.stringify(meta.team, null, 2));
    await wput(id, ".dynapse/TRACE.json", JSON.stringify({ primary: meta?.primary ?? {}, rounds: meta?.rounds ?? [], photos: [] }, null, 2));
    if (meta?.notes)
        await wput(id, ".dynapse/NOTES.md", meta.notes);
    const skill = await workflowSkill();
    if (skill) {
        await wput(id, "CLAUDE.md", skill);
        await wput(id, "AGENTS.md", skill);
    }
    await repoCommit(id, `동기화 · ${head.sha.slice(0, 7)}${head.message ? ` · ${head.message.slice(0, 120)}` : ""}`);
    const heads = (await store.get("remote_heads")) ?? {};
    heads[id] = head.sha;
    heads[`${id}#local`] = (S.git ? await T().core.invoke("repo_head", { id }).catch(() => null) : null) ?? "";
    await store.set("remote_heads", heads);
    await store.save();
    // 이 PC가 원본이 됐다 — local_path·기기·메타를 서버에(#56 — 성공해도 local_path가 안 적히던 경로)
    await api("POST", "/api/works", { id, status: "done", local_path: dir, device_id: S.deviceId }).catch(() => { });
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
// 연결 전에 온 메시지(#20) — 대화 AI가 로그인되면(상태 자동 감지) 그대로 다시 보낸다. 사용자가 다시 보낼 필요 없음
export const waiting = [];
const photoQueue = new Map();
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
        await postChat(w.id, [{ role: "event", text: "연결됨 · 시작합니다", payload: { kind: "stage", ai: "dynapse" } }]);
        const prev = photoQueue.get(w.id) ?? Promise.resolve();
        const next = prev.then(() => runPhotoTurn(w.id, w.text, { route: w.opts.route, taskId: w.photo || null })).catch(() => { });
        photoQueue.set(w.id, next);
    }
    if (!ready || !waiting.some(x => x.photo === undefined))
        return;
    for (const w of waiting.splice(0).filter(x => x.photo === undefined)) {
        await postChat(w.id, [{ role: "event", text: "연결됨 · 시작합니다", payload: { kind: "stage", ai: "dynapse" } }]);
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
