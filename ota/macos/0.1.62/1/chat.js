import { PAGE_RE, anyPhotoReady, genSlotPhoto, nextMaterial, pageKey, photoReady, placePhoto, readSlots, resolvePage, photoStats, runPhotoRequests, runPhotoTurn, setSlotImg, slotKey, stopAnswer } from "./photo-runner.js";
import { diagAuto, diagReport } from "./diag.js";
import { importArticle } from "./article.js";
import { HUB, MCP_URL, S, T, WORK_ID, agyLogin, api, deviceBody, exec, http, mcp, openLogin, render, spawn, store, switchAccount } from "./main.js";
export const AI_LABEL = { claude: "Claude", chatgpt: "ChatGPT", gemini: "Gemini" };
export let skillCache = null;
let skillAt = 0;
// 지침은 10분마다 다시 확인(#54 D18 — 예전엔 앱 세션 동안 메모리 사본만 써서 지침을 바꿔도 재시작 전엔 옛 것). 바뀌었을 때만 저장
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
    const v = await appVerify0(id, pages, o.noRender, o.reward);
    const g = await glyphWarnings(id, pages).catch(() => []);
    return g.length ? { ...v, warnings: [...(v.warnings ?? []), ...g] } : v;
}
async function appVerify0(id, pages, noRender = false, reward = false) {
    const dir = await T().core.invoke("work_dir", { id });
    // 리워드 표시(대표: 검증 실패가 계속 뜬다) — 0.1.57 이하 실행기는 --reward 옵션을 거부해 일반 검사로 돌았다. 표시 파일이면 옵션 없이도 verify.mjs가 리워드 규칙으로(에이전트가 직접 돌려도 같다)
    if (reward)
        await wput(id, ".dynapse/reward.json", JSON.stringify({ task: rewardWorks.get(id) ?? null })).catch(() => { });
    if (verifyCache) {
        // --no-small: 앱은 작은 PNG를 안 쓴다(#54 B5). 옛 네이티브(0.1.52 이하)는 옵션 인자를 거부 → 옵션 없이 한 번 더(#54 B6)
        const run = (flags) => exec("node", [".dynapse/verify.mjs", ...(pages ?? []), ...flags], undefined, dir).catch(() => null);
        // --reward(#62): 공개 재고 규칙 — 빈 사진 칸은 오류(사진 요청에 적힌 칸은 대기), 사진 칸을 빼도 된다
        let r = await run(["--no-small", ...(noRender ? ["--no-render"] : []), ...(reward ? ["--reward"] : [])]);
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
        if (/(?:src|href)\s*=\s*["']?\s*(?:https?:)?\/\//i.test(h) || /url\(\s*["']?\s*(?:https?:)?\/\//i.test(h))
            errors.push({ page, rule: "external", msg: "외부 URL" });
    }
    return { ok: !errors.length, errors, warnings: [{ page: "*", rule: "render", msg: "node가 없어 렌더 검사를 못 했어요" }], shots: [], engine: "app" };
}
// 내보내기 렌더(#73 §2) — verify.mjs의 --pptx(편집 가능한 PPTX + fonts.txt) · --png2x(2배 PNG). node·Chrome이 있어야 한다. 실패하면 이유 한 줄
export async function exportRender(id, mode) {
    await ensureVerify(id);
    if (!verifyCache)
        return { ok: false, error: "검증 스크립트를 받지 못했어요" };
    const dir = await T().core.invoke("work_dir", { id });
    const r = await exec("node", [".dynapse/verify.mjs", `--${mode}`], undefined, dir).catch(e => ({ stdout: "", stderr: String(e) }));
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
export const CHAT_TOOLS = "Read Write Edit Grep Glob mcp__dynapse Bash(node .dynapse/verify.mjs) Bash(node .dynapse/verify.mjs *) Bash(node .dynapse/tmp/*) Bash(node -e *) Bash(git *) Bash(curl *) Bash(cp *) Bash(mkdir *) Bash(codex exec *) Bash(claude -p *)";
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
        await importStart(m.work, { source: p.source, pull: p.pull });
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
        const srcFiles = WORK_ID.test(from) ? await T().core.invoke("work_files", { id: from }).catch(() => []) : [];
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
            await postChat(m.work, [{ role: "event", text: `이 PC에 복사했어요 · 파일 ${n}개${bad ? ` · ${bad}개 실패` : ""}`, payload: { kind: "download", ai: "dynapse", state: "done", done: n, total: n + bad } }]);
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
    if (m.payload?.action === "push") {
        const dir = await T().core.invoke("work_dir", { id: m.work }).catch(() => null);
        if (dir)
            await pushWork(m.work, dir);
        return;
    } // 실패한 커밋은 remote_heads에 안 적혀 그대로 다시 올라간다
    // 이전 버전도 함께(#21 보정 15 B) — 작업별 옵션(상태 창). 켜면 이미지 버전 전부를 다음 올리기부터
    // 공유 켬(#38 — 작업실에서 −10P · 30일) — 이 작업을 지금 올리고, 앞으로 저장마다 올린다
    if (m.payload?.action === "share-on") {
        sharedWorks.add(m.work);
        const dir = await T().core.invoke("work_dir", { id: m.work }).catch(() => null);
        if (dir)
            await pushWork(m.work, dir).catch(() => { });
        return;
    }
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
        const l = await T().core.invoke("link_add", { id: m.work, path: m.payload.path ?? null }).catch(e => { void postChat(m.work, [{ role: "event", text: String(e), payload: { kind: "error", ai: "dynapse" } }]); return null; });
        if (l) {
            await postChat(m.work, [{ role: "event", text: `참조 · ${l.name}`, payload: { kind: "stage", ai: "dynapse" } }]);
            await resolveRefs(m.work, true);
        }
        return;
    }
    // 서버가 합친 커밋·A안/B안 선택(#20 초대) → 최신 매니페스트대로 받아 이 기기 git에 커밋
    // 가져오기(#21, fork:true)는 받기만 — 올리기는 동기화·초대일 때만
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
    const pointed = pts.length ? `[📍 ${pts.length} pointed element(s) — edit ONLY these (skill §3-0). A new photo for a pointed photo slot goes to .dynapse/photo-requests.json with that point's file. Do not read whole files; find each by selector, change only that element, then report one line per element: "before → after". Reply to the user in Korean.]\n${pts.map((p, i) => `${i + 1}. file=${p.file} selector=${p.selector}${p.slot ? ` slot=${p.slot}` : ""}\n   source: ${(p.snippet ?? "").replace(/\s+/g, " ").slice(0, 400)}`).join("\n")}\nRequest: ` : "";
    // 글꼴 한 줄(#36) — 카탈로그 안에서 두 id만 고르게. 페이지를 열지 않는다(토큰 적게)
    const font = m.payload?.font;
    // 이 PC 글꼴도 카탈로그에(#49 C · #36 추가 2) · 지금 폰트를 알려 말하지 않은 쪽(제목/본문)은 그대로 두게
    const pcFonts = font ? (await pcFontsFor(m.work).catch(() => [])).filter(f => f.kr).slice(0, 30).map(f => `local:${f.family} (${f.family}, 이 PC)`).join(", ") : "";
    const workFonts = font ? (await T().core.invoke("work_files", { id: m.work }).catch(() => [])).map(f => f.name.match(/^context\/fonts\/([^/]+)\/font\.json$/)?.[1]).filter((x) => !!x).map(d => `work:${d.replace(/_/g, " ")} (${d.replace(/_/g, " ")}, 이 작업)`).join(", ") : "";
    const curBlock = font ? ((await wget(m.work, "result-cover.html").catch(() => null)) ?? "").match(/<style\b[^>]*\bdata-fonts\b[^>]*>/i)?.[0] ?? "" : "";
    const cur = curBlock ? `current: display=${curBlock.match(/data-display="([^"]+)"/)?.[1] ?? "?"}, body=${curBlock.match(/data-body="([^"]+)"/)?.[1] ?? "?"}` : "current: layout default";
    const fontAsk = font ? `[Font request — change fonts only. Do not open, read or edit any page or tokens file. Pick a display (titles) and a body font only from this catalog: ${font}${pcFonts ? `, ${pcFonts}` : ""}${workFonts ? `, ${workFonts}` : ""}. ${cur}; keep the one the user did not mention. Match names loosely (spaces, case, Korean/English: 나눔고딕 = nanum-gothic, 프리텐다드 = pretendard). Write .dynapse/font-pick.json as {"display":"<id>","body":"<id>","why":"<one Korean line>"}; the app applies it to every page after your turn. If the named font is not in the catalog, pick the closest and say so in Korean ("이 폰트는 없어요 · 비슷한 ⟨이름⟩으로 바꿨어요"). Reply to the user in Korean with that one line.]\nRequest: ` : "";
    const hand = m.role === "user" && m.text ? await handEditsPrefix(m.work).catch(() => "") : "";
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
    const light = pts.length > 0 || !!font || !!hand;
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
    if (m.role === "user" && m.text && /한쇼|폴라리스|구글 ?슬라이드|google slides|hancom|ppt로 (고|수정|편집)/i.test(m.text))
        void askCompatOnce(m.work, null).catch(() => { }); // #81 보정 1 §3
    // 원고 그대로(카피 그대로 모드) — 붙인 원고의 문장을 고치지 않고 칸에 배치만. 바꿀 수밖에 없으면 turn.json copy_changes에 적는다(앱이 카드로 보여 줌). verify가 원고 문장이 결과에 있는지 본다
    let verbatim = "";
    if (m.role === "user" && m.text && m.payload?.verbatim) {
        const refs = [...new Set([...m.text.matchAll(/context\/refs\/([^\s,\]]+)/g)].map(x => x[1]))];
        await wput(m.work, ".dynapse/verbatim.json", JSON.stringify({ at: Date.now(), sources: refs.map(r => `context/.index/${r}.md`), text: refs.length ? null : m.text.replace(/\n?\[첨부:[^\]]*\]/g, "").slice(0, 20000) }, null, 1)).catch(() => { });
        verbatim = `[Copy as written — the user's manuscript${refs.length ? ` (${refs.join(", ")} — read its index in context/.index/)` : " (the text of this message)"} goes into the slots exactly as written: no rephrasing, shortening, translating or reordering within a sentence; keep numbers and names exactly. If a sentence does not fit, use a denser layout variant, a composed page or more pages — never cut it. If you truly must change a sentence, record each change in .dynapse/turn.json "copy_changes": [{"page","slot","before","after","why"}].]\n`;
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
        const names = [...new Set([...m.text.matchAll(/([A-Za-z0-9._-]+\.url)\b/g)].map(x => x[1]))].slice(0, 2);
        const got = [];
        for (const n of names) {
            const u = (await T().core.invoke("work_read", { id: m.work, file: `context/refs/${n}` }).catch(() => null))?.trim().split(/\s+/)[0];
            if (!u)
                continue;
            await postChat(m.work, [{ role: "event", text: "글 받는 중", payload: { kind: "stage", ai: "dynapse" } }]);
            const r = await importArticle(m.work, u).catch(() => ({ ok: false, reason: "fetch" }));
            if (r.ok) {
                got.push(r);
                await postChat(m.work, [{ role: "event", text: `글 받았어요 · ${r.title.slice(0, 40)} (${r.chars.toLocaleString()}자${r.image ? " · 대표 사진" : ""})`, payload: { kind: "stage", ai: "dynapse" } }]);
            }
            else
                await postChat(m.work, [{ role: "event", text: r.reason === "private" ? "이 주소는 가져올 수 없어요 · 본문을 붙여넣어 주세요" : "글을 읽지 못했어요 · 본문을 붙여넣어 주세요", payload: { kind: "error", ai: "dynapse", paste: true } }]);
        }
        const rest = m.text.replace(/\[첨부:[^\]]*\]/g, "").replace(/\[(?:Document|Article link) attached:[^\]]*\][^\n]*/g, "").trim();
        if (names.length && !got.length && !rest)
            return; // 읽은 글이 없고 다른 말도 없으면 AI 턴 없이
        if (got.length)
            article = `[Source article attached (${got.map(g => g.file).join(", ")}): build the pages from it — hook/cover = its main claim in one line, one point per page in the article's order, closing = a call to action with the blog's name; keep every number and proper noun exactly; do not add facts that are not in the article.${got.some(g => g.image) ? ` The article's lead image (${got.filter(g => g.image).map(g => g.image).join(", ")}) is the user's own photo: use it for the hook/cover photo slot first.` : ""} Ask nothing; just build.]\n`;
    }
    // 내 사진 우선(#83 §3) — 만드는 턴(글·다음 회차·아직 장 없음)에 올린 사진(context/assets)이 있으면 사진 칸은 그것부터, 생성은 빈 칸만
    let mine = "";
    if (m.role === "user" && m.text && !pts.length && !font) {
        const fs = (await T().core.invoke("work_files", { id: m.work }).catch(() => [])).map(f => f.name);
        const photos = fs.filter(n => /^context\/assets\/[^/]+\.(jpe?g|png|webp)$/i.test(n));
        if (photos.length && (article || seriesHead || !fs.some(n => /^result-[a-z0-9-]+\.html$/.test(n))))
            mine = `[User photos in context/assets/ (${photos.slice(0, 8).map(n => n.slice("context/assets/".length)).join(", ")}${photos.length > 8 ? ", …" : ""}) fill the photo slots first — the hook/cover gets the best one, the rest in point order; generate photos only for slots that remain empty.]\n`;
    }
    if (m.role === "user" && m.text) {
        if (pts.length)
            pointTurn.add(m.work);
        await chatSend(m.work, tpl ? `${hand}${webFonts}${tpl}\n요청: ${m.text}` : seriesHead + article + mine + (seriesHead ? "" : importedHead) + hand + webFonts + fontAsk + verbatim + pointed + m.text, { route: m.payload?.route, capLeft: m.payload?.cap_left ?? null, light, receivedAt: receivedAt.get(m.work) });
    }
}
const receivedAt = new Map();
export const importedWorks = new Set(); // 가져온 덱(#56 보정 1) — 첫 턴의 첫 생성 사진 규칙(#49 B)을 쓰지 않는다
const pointTurn = new Set(); // 📍 턴(usage 카드에 📍 표시)
// 직접 수정 커밋(#25 B·#26) — 웹 캔버스가 page_write로 쓴 페이지를 커밋하고 한 줄. AI 호출 0
async function pageCommit(id, file, note, patch) {
    if (!/^result-[a-z0-9-]+\.html$/.test(file))
        return;
    // 조절(#78 보정 6 B) — 그 장의 <style data-tweaks> 블록 통째. 대조 없이 블록을 바꾸므로 undo가 HEAD에서 나머지를 다시 적용해도 맞는다. 접지 않는다(한 걸음 = undo 한 번)
    if (patch?.kind === "tweak" && typeof patch.block === "string") {
        await addPending(id, { t: "tweak", page: file, block: patch.block, target: patch.target ?? "", label: `${pageLabel(file)} · ${note.slice(0, 30)}`, ...(patch.group ? { group: patch.group } : {}) });
        return;
    }
    // 직접 수정은 모은다(#46) — 파일은 이미 바뀌었고(보인다) 커밋은 [보내기]·다음 요청·20분 뒤 한 번에
    await addPending(id, { t: "text", page: file, old: patch?.old ?? "", neu: patch?.neu ?? "", nth: patch?.nth ?? 0, ...(patch?.sel ? { sel: patch.sel } : {}), ...(patch?.kind === "ids" || patch?.kind === "struct" ? { kind: patch.kind } : {}), ...(patch?.group ? { group: patch.group } : {}), label: `${pageLabel(file)} · ${note.slice(0, 30)}` });
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
    await postChat(id, [{ role: "event", text: n ? `이 덱은 PPTX로 열 때 ${n}곳이 이미지로 바뀌어요` : "한쇼·폴라리스·Google Slides에서 고칠 거면 PPTX 호환을 켤 수 있어요", payload: { kind: "compat_ask", ai: "dynapse", n } }]).catch(() => { });
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
    await repoCommit(id, `가져옴 · ${src}`);
    await postChat(id, [{ role: "event", text: `가져옴 · ${src}`, payload: { kind: "stage", ai: "dynapse" } }]);
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
        await postChat(id, [{ role: "event", text: null, payload: { kind: "verify", ai: "dynapse", ok: false, errors: v.errors.slice(0, 5), warnings: v.warnings.length } }]);
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
async function submitReward(id, taskId, replaces) {
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
    if (!v.ok) {
        await postChat(id, [{ role: "event", text: null, payload: { kind: "verify", ai: "dynapse", ok: false, errors: v.errors.slice(0, 5), warnings: v.warnings.length } }]);
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
    const pages = !deck ? ["result-cover.html"] : spec.deck_goal === "cards"
        ? Array.from({ length: Math.max(4, Math.min(8, spec.pages ?? 6)) }, (_, i) => `result-card-${i + 1}.html`)
        : DECK_FILES.slice(0, Math.max(2, Math.min(4, spec.pages ?? 4)));
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
        const r = await exec("codex", ["exec", "--json", "--skip-git-repo-check", "--ephemeral", ...(m ? ["-m", m] : []), "-c", `model_reasoning_effort="low"`, "-c", "project_doc_max_bytes=0", "-s", "read-only", "-C", root, "-"], `${AUX_SYS} Do not run commands or read files.\n${prompt}`, root).catch(() => null);
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
async function applyFontPick(id) {
    const pick = await readJson(id, ".dynapse/font-pick.json");
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
async function useFile(id, page0, slot, file) {
    if (!/^[a-z0-9_]{1,40}$/i.test(slot) || !/^(materials|context\/assets)\/[\w.\- ()가-힣]+\.(png|jpe?g|webp)$/i.test(file))
        return;
    const page = await resolvePage(id, slot, page0);
    if (!page) {
        await postChat(id, [{ role: "event", text: `사진 요청에 장표가 없어요 · ${slot}`, payload: { kind: "error", ai: "dynapse" } }]);
        return;
    }
    await placePhoto(id, page, slot, file, { runtime: file.startsWith("context/") ? "mine" : "generated" });
    const placed = (await readSlots(id))[slotKey(page, slot)] ?? file;
    await addPending(id, { t: "photo", page, slot, file: placed, label: `${pageLabel(page)} · ${slot}` }); // 모아 저장(#46)
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
    if (!r.files.length)
        return;
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
const AGENT_LAYOUTS = ["cover-full", "body-series", "data-texture", "closing-full", "card-hook", "card-point"];
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
export const SKILL_PARTS = ["reward", "merge", "import"];
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
export const RULES_TEMPLATE = "# 규칙\n톤:\n금지:\n브랜드 색:\n잠근 슬롯:\n협업: 다른 AI가 고칠 땐 .dynapse/NOTES.md 먼저 읽고, 바꾼 이유를 한 줄 남긴다\n";
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
    } // 다른 기기에서 만든 작업 — 동기화 사본을 받는다
    const names = new Set(have.map(f => f.name));
    const skill = await workflowSkill();
    if (skill)
        for (const f of ["CLAUDE.md", "AGENTS.md"])
            await wputOnce(id, f, skill, names);
    await ensureSkillParts(id, names);
    await ensureVerify(id);
    // 참고 폴더(#21 보정 6) — context/RULES.md 기본 템플릿(6줄 이하). 사람과 AI가 함께 쓴다
    if (!have.some(f => f.name === "context/RULES.md"))
        await wput(id, "context/RULES.md", RULES_TEMPLATE).catch(() => { });
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
        : `Photos: user's own (context/assets) → the stock in get_template slots → otherwise leave the slot empty and list it in turn.json empty_slots`;
    const design = other ? `Design: you (${AI_LABEL[self]}) edit, then ask ${AI_LABEL[other]} to review this folder (\`codex exec -c project_doc_max_bytes=0\` / \`claude -p\`)` : `Design: you (${AI_LABEL[self]})`;
    return `[Roles for this message — chosen by the user] ${design} · ${photo}. Reply to the user in Korean.\n`;
}
export async function chatSend(id, text, opts = {}) {
    const route = opts.route;
    const readyClaude = S.tools.claude.installed && S.tools.claude.loggedIn !== false, readyCodex = S.tools.codex.installed && S.tools.codex.loggedIn !== false;
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
        s = { tool, ai: tool === "claude" ? "claude" : "chatgpt", sessionId: prev, busy: false, queue: [], lastAt: Date.now(), out: [], verifyN: 0, fixups: 0, extraAllow: remembered.filter(x => typeof x === "string" && /^[\w]+(\(.{1,120}\))?$/.test(x)).slice(0, 30) };
        sessions.set(key, s);
    }
    s.auto = route?.auto_approve !== false; // 자동 승인(#27 A, 기본 켜짐)
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
    s.lightAuto = false;
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
    let request = text.replace(/^\[📍[^\n]*\n[\s\S]*?\nRequest: /, ""); // 요청 원문(📍 계약은 뺀다)
    if (/^(Claude|ChatGPT): (이어서|이어서 하기)$/.test(text)) {
        text = "Finish the work that was stopped by the token cap. Do not re-read large files whole — use grep -n and partial reads; do mechanical changes with one script.";
        request = null;
    }
    if (s.pendingAllow?.length && /: (승인|건너뛰기)$/.test(text)) {
        const allow = /: 승인$/.test(text);
        if (allow) {
            s.extraAllow = [...new Set([...(s.extraAllow ?? []), ...s.pendingAllow])];
            s.respawn = true;
            await wput(id, ".dynapse/allow.json", JSON.stringify(s.extraAllow, null, 2)).catch(() => { });
        } // 이 작업에 기억 — 같은 질문 두 번 없음(#27)
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
        }
        // Codex는 input_tokens에 캐시 재사용(cached_input_tokens)을 포함해 알려 준다 → 빼고 센다(902k 오경보). 끝난 턴(turn.completed)에서는 멈추지 않는다
        if (d.type === "turn.completed" && d.usage)
            s.liveTok = Math.max(0, (d.usage.input_tokens ?? 0) - (d.usage.cached_input_tokens ?? 0)) + (d.usage.output_tokens ?? 0);
        // 상한 — Claude는 프로세스를 죽이지 않고 스트림 인터럽트(세션·캐시 유지, result가 온다), Codex는 exec 하나라 멈춘다
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
        const den = Array.isArray(d.permission_denials) ? d.permission_denials : [];
        s.denied = [...new Set(den.flatMap(x => x.tool_name === "Bash" && x.tool_input?.command ? bashRules(String(x.tool_input.command)) : [String(x.tool_name ?? "")]).filter(Boolean))].slice(0, 6);
        s.lastText = typeof d.result === "string" ? d.result : s.lastText;
        if (s.interrupted && s.capped) {
            s.interrupted = false;
            void capStop(id, s);
            return;
        } // 상한 인터럽트로 끝난 턴 → 선택 카드(프로세스는 살아 있다)
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
const LANGS = { 영어: { code: "en", name: "English" }, 영문: { code: "en", name: "English" }, 일본어: { code: "ja", name: "Japanese" }, 중국어: { code: "zh", name: "Simplified Chinese" }, 한국어: { code: "ko", name: "Korean" }, 한글: { code: "ko", name: "Korean" }, english: { code: "en", name: "English" }, japanese: { code: "ja", name: "Japanese" }, korean: { code: "ko", name: "Korean" } };
export const translateIntent = (t) => { const m = t.trim().match(/^(?:전부|모두|전체를?|글자?만?\s*)?\s*(영어|영문|일본어|중국어|한국어|한글|english|japanese|korean)\s*(?:로|으로)?\s*(?:바꿔|번역|translate)/i) ?? t.trim().match(/^translate (?:it |this |all )?(?:in)?to (english|japanese|korean)\b/i); return m ? LANGS[m[1].toLowerCase()] ?? LANGS[m[1]] ?? null : null; };
async function translateTurn(id, lang, ai) {
    if (typeof DOMParser === "undefined")
        return false;
    const files = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(n => PAGE_RE.test(n));
    const leaves = [];
    const path = (el) => { const parts = []; for (let e = el; e && e.tagName !== "BODY"; e = e.parentElement) {
        const p = e.parentElement;
        if (!p)
            break;
        parts.unshift(`${e.tagName.toLowerCase()}:nth-child(${Array.from(p.children).indexOf(e) + 1})`);
    } return `body > ${parts.join(" > ")}`; };
    for (const f of files) {
        const html = await wget(id, f);
        if (!html)
            continue;
        const doc = new DOMParser().parseFromString(html, "text/html");
        const picked = [];
        for (const el of Array.from(doc.body.querySelectorAll("*"))) {
            if (/^(SCRIPT|STYLE|SVG|TITLE)$/i.test(el.tagName) || el.closest("figure,[data-kind=photo],[data-slot=page_no]"))
                continue;
            if (!Array.from(el.childNodes).some(n => n.nodeType === 3 && (n.textContent ?? "").trim()))
                continue;
            if (picked.some(a => a.contains(el)))
                continue;
            picked.push(el);
            const text = (el.innerHTML.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")).trim();
            if (text && /[\p{L}]/u.test(text))
                leaves.push({ file: f, sel: path(el), inner: el.innerHTML, text });
        }
    }
    if (!leaves.length)
        return false;
    await postChat(id, [{ role: "event", text: `번역 중 · ${lang.name} · 글자 ${leaves.length}곳`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
    const items = Object.fromEntries(leaves.map((l, i) => [`k${i}`, l.text.slice(0, 600)]));
    const r = await auxRun(id, `Translate each value into ${lang.name}. These are text boxes on presentation slides: keep it about as long as the original (titles short), keep line breaks (\\n) and line counts similar, keep numbers, names, brand names and URLs exactly, no added quotes or notes. If a value is already in ${lang.name}, return it unchanged.\n${JSON.stringify(items)}\nReturn {"k0":"…","k1":"…", …} with every key.`, ai);
    if (!r) {
        await postChat(id, [{ role: "event", text: "번역하지 못했어요 · 다시", payload: { kind: "error", ai: "dynapse" } }]).catch(() => { });
        return true;
    }
    const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const byFile = new Map();
    let n = 0;
    for (const [i, l] of leaves.entries()) {
        const tr = r.json[`k${i}`];
        if (typeof tr !== "string" || !tr.trim() || tr.trim() === l.text)
            continue;
        const cur = byFile.get(l.file) ?? await wget(id, l.file);
        if (!cur)
            continue;
        const out = textAtSel(cur, l.sel, l.inner, esc(tr.trim()).replace(/\n/g, "<br>"));
        if (out) {
            byFile.set(l.file, out);
            n++;
        }
    }
    for (const [f, html] of byFile)
        await wput(id, f, html);
    if (n) {
        await clickRound(id, `번역 · ${lang.name} · 글자 ${n}곳`, [r.ai === "codex" ? "chatgpt" : "claude"]);
        void api("POST", `/api/works/${encodeURIComponent(id)}/messages`, { action: "set-lang", lang: lang.code }).catch(() => { }); // 작업 lang 메타(공개 핀 EN 칩)
    }
    await auxDone(id, "translate", r, n ? `${lang.name}로 바꿨어요 · 글자 ${n}곳 · 레이아웃·사진은 그대로 · 원문은 버전 띠에서` : "바꿀 글자가 없었어요");
    return true;
}
// 진단용 꼬리(대표 2026-10-04) — JSON이 아닌 줄(대개 stderr·런타임 오류)만 마지막 30줄. 실패하면 진단에 붙는다
function errTail(s, l) { if (l.trimStart().startsWith("{"))
    return; (s.errTail ??= []).push(l.slice(0, 400)); if (s.errTail.length > 30)
    s.errTail.shift(); }
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
export async function nextTurn(id, s) {
    const text0 = s.queue.shift();
    const text = text0 ? (await docHead(id).catch(() => "")) + text0 : text0;
    const req = s.reqQueue?.shift();
    if (!text)
        return;
    s.mx = { ...(req ? mxNext.get(id) ?? { kind: "edit", len: req.length, ph: reqHash(req) } : { kind: "cont" }), tid: newTid(), runs: 0, rules: [], skill: 0 };
    if (req)
        mxNext.delete(id);
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
        const want = `${s.model ?? ""}|${s.effort ?? ""}|${linked.join(",")}|${s.auto ? "auto" : "manual"}`;
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
            const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--mcp-config", ".dynapse/mcp-config", "--strict-mcp-config",
                "--max-turns", String(LIMITS.maxTurns), "--allowedTools", [CHAT_TOOLS, ...(s.extraAllow ?? [])].join(" "), "--add-dir", dir, ...linked.flatMap(p => ["--add-dir", p]),
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
        const mo = [...(s.model ? ["-m", s.model] : []), ...(s.effort ? ["-c", `model_reasoning_effort="${s.effort}"`] : [])];
        const args = s.sessionId
            ? ["exec", "resume", "--json", "--skip-git-repo-check", ...mo, "-c", 'sandbox_mode="workspace-write"', "-c", "sandbox_workspace_write.network_access=true", s.sessionId, "-"]
            // --approve-for-me는 그 자체가 workspace-write 샌드박스 — -s와 같이 쓰면 인자 오류(종료 코드 2). 자동 승인이면 -s를 빼고, 아니면 -s만
            : ["exec", "--json", "--skip-git-repo-check", ...mo, ...(s.auto ? ["--approve-for-me"] : ["-s", "workspace-write"]), "-c", "sandbox_workspace_write.network_access=true", "-C", dir, "-"]; // Codex 자동 승인(#27) — 샌드박스 안 자동 검토(exec resume엔 이 옵션이 없다)
        s.errTail = [];
        const code = await spawn("codex", args, (s.sessionId ? "" : await notesHead(id, s)) + text, dir, l => { logChat(l); errTail(s, l); chatLine(id, s, l); }, pid => { s.procId = pid; }).catch(() => -1);
        s.procId = undefined;
        if (code !== 0 && !s.capped)
            void diagAuto({ tool: "codex", stage: "turn", code: `exit:${code}`, log: (s.errTail ?? []).join("\n"), work: id, cli: S.tools.codex.version || null });
        if (s.capped)
            await capStop(id, s);
        else
            await endTurn(id, s, code === 0, code === 0 ? undefined : `Codex가 끝나지 못했어요(종료 코드 ${code})`);
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
    // 자동 승인(#27 · 대표: "이미 승인하기로 했는데 또 누르게 하지 말 것") — 켜져 있으면 막힌 명령을 이 작업에 허용·기억하고 카드 없이 이어서.
    // 위험 명령(rm·sudo 등)과 같은 턴 2회 넘게 막히면 카드로 묻는다. 거부 목록(DENY)은 언제나 우선
    if (s.denied?.length && !s.asked && s.auto && (s.autoRetry ?? 0) < 2 && s.denied.every(r => !RISKY.test(r))) {
        s.extraAllow = [...new Set([...(s.extraAllow ?? []), ...s.denied])].slice(-40);
        s.respawn = true;
        await wput(id, ".dynapse/allow.json", JSON.stringify(s.extraAllow, null, 2)).catch(() => { });
        s.out.push({ role: "event", text: `자동 승인 · ${s.denied.map(r => r.replace(/^Bash\((\S+).*$/, "$1")).join(", ").slice(0, 60)}`, payload: { kind: "stage", ai: s.ai } });
        s.denied = [];
        s.autoRetry = (s.autoRetry ?? 0) + 1;
        s.queue.unshift("Re-run the command that was just blocked and continue.");
        (s.reqQueue ??= []).unshift(null); // 같은 요청의 이어 가기
        return finishTurn(id, s);
    }
    // 권한으로 막힌 턴(#22-보정 3) — 설명문 대신 카드 하나: Claude · 실행을 승인해 주세요 [승인] [건너뛰기]
    if (s.denied?.length && !s.asked) {
        s.pendingAllow = s.denied;
        s.out.push({ role: "event", text: null, payload: { kind: "ask", ai: s.ai, stop: "approve", questions: [{ label: AI_LABEL[s.ai], question: `실행을 승인해 주세요 · ${s.denied.join(", ").slice(0, 60)}`, options: [{ id: "allow", label: "승인" }, { id: "skip", label: "건너뛰기" }] }] } });
        s.denied = [];
        return finishTurn(id, s);
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
        s.out.push({ role: "event", text: why ?? "멈췄어요", payload: { kind: "error", ai: s.ai, model: s.runModel ?? null } });
        if (s.lastText)
            s.out.push({ role: "agent", text: s.lastText, payload: { ai: s.ai, model: s.runModel ?? null, summary: summaryLines(s.lastText) } });
        await discardTurn(id, s); // 실패 턴 = 커밋 없음, 파일은 턴 시작 상태로(#30)
        return finishTurn(id, s);
    }
    await mergeTurn(id, s); // 에이전트의 turn.json → TRACE·NOTES·tags(#29 C4)
    await flushChat(id, s);
    const request = (s.requestText ?? s.turnText ?? "").split("\n")[0].slice(0, 200) || "요청";
    const isPage = (f) => /^result-[a-z0-9-]+\.html$/.test(f);
    // 첫 생성은 표지 1장(#49 B) — 나머지는 사용자가 [1장]·[2장]·[전부]로. 리워드는 브리프대로 전부
    const firstBuild = !((await readJson(id, ".dynapse/TRACE.json"))?.rounds?.length);
    // ① 에이전트가 바꾼 장을 먼저 검사(사진 전, #54 A1) — 실패면 같은 턴에 되돌려 보낸다
    const changed0 = S.git ? await T().core.invoke("repo_changed", { id }).catch(() => []) : [];
    const pages0 = changed0.filter(isPage);
    let v1 = null;
    if (pages0.length) {
        chatEvent(id, s, `확인 중 ${Math.min(s.verifyN + 1, 3)}/3`, { ai: "dynapse" });
        await flushChat(id, s);
        // 글자만 바뀐 턴(#51 §3) — 결과 장의 태그·속성은 그대로이고 글자만 다르면 렌더·스크린샷 생략(정적 검사만)
        const textOnly = changed0.every(f => isPage(f) || f.startsWith(".dynapse/")) && await textOnlyChange(id, pages0);
        const v0 = Date.now();
        v1 = await appVerify(id, pages0, { noRender: !!textOnly, reward: !!s.rewardTask || rewardWorks.has(id) });
        (s.tm ??= {}).verify_ms = Date.now() - v0;
        if (s.mx) {
            s.mx.runs++;
            s.mx.rules = [...new Set([...s.mx.rules, ...v1.errors.map(e => e.rule)])].slice(0, 8);
        }
        s.out.push({ role: "event", text: null, payload: { kind: "verify", ai: "dynapse", ok: v1.ok, errors: v1.errors.slice(0, 5), warnings: v1.warnings.length } });
        if (!v1.ok && s.fixups < 1 && s.tool === "claude" && s.procId !== undefined) {
            s.fixups++;
            await flushChat(id, s);
            s.verifyN = 0;
            await T().core.invoke("run_write", { id: s.procId, line: JSON.stringify({ type: "user", message: { role: "user", content: `App verify failed on the pages you changed. Fix only these errors (slot/over_px say where — no need to open the PNG) and end your turn; the app checks again — do not run verify.mjs yourself. Keep the request and constraints. Reply to the user in Korean.\n${JSON.stringify({ errors: v1.errors.slice(0, 8) })}` } }) }).catch(() => { });
            return; // 같은 턴이 이어진다(result가 다시 온다)
        }
        // 고친 뒤에도 실패(#55) — 되돌리지 않는다. 파일은 그대로, 입력창 위 칩 "검증 실패 · 고친 파일 N개"에서 [저장]·[되돌리기]는 사용자가. 커밋 없음
        if (!v1.ok) {
            const kept = changed0.filter(f => isPage(f) || f.startsWith("materials/") || f === "tokens.css");
            s.out.push({ role: "agent", text: s.lastText ?? "끝났어요", payload: { ai: s.ai, model: s.runModel ?? null, summary: summaryLines(s.lastText) } });
            s.out.push({ role: "event", text: `검증 실패 · 남은 오류: ${errorsLine(v1.errors)}`, payload: { kind: "error", ai: "dynapse" } });
            if (kept.length)
                await addPending(id, { t: "stopped", why: "verify", files: kept, label: `검증 실패 · 고친 파일 ${kept.length}개` }).catch(() => { });
            return finishTurn(id, s);
        }
    }
    // ② 답을 먼저(#54 A1) — 사진은 뒤에서 만들고 커밋은 사진 뒤 한 번(요청 1 = 커밋 1, #30)
    s.out.push({ role: "agent", text: s.lastText ?? "끝났어요", payload: { ai: s.ai, model: s.runModel ?? null, summary: summaryLines(s.lastText) } });
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
                s.out.push({ role: "event", text: null, payload: { kind: "verify", ai: "dynapse", ok: v2.ok, errors: v2.errors.slice(0, 5), warnings: v2.warnings.length } });
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
            req: { text: request }, summary: summaryLines(s.lastText), ...(s.runModel ? { model: s.runModel } : {}), ...(s.merged ? { merged_from: s.merged } : {}) };
        const c0 = Date.now();
        await saveRound(id, r, request, v);
        (s.tm ??= {}).save_ms = Date.now() - c0;
        r.timing = timingOf(s); // TRACE round에(#51)
        await wput(id, ".dynapse/TRACE.json", JSON.stringify({ ...trace, rounds: [...(trace.rounds ?? []), r] }, null, 2));
        if (s.mx) {
            s.mx.committed = true;
            s.mx.round = n;
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
            (s.reqQueue ??= []).push(null);
        }
    }
    else if (S.git && changed.length)
        await repoCommit(id, request);
    s.post = false;
    s.stopped = false; // ■가 사진 도중이면 러너가 지금 장까지만 — 여기서 정리
    return finishTurn(id, s);
}
// 남은 오류 한 줄(#55) — 종류(장 칸) 최대 3개: "잘린 글자(본문 section_title) · 사진 칸(표지)"
const RULE_KO = { clipped: "잘린 글자", overflow: "화면 밖 글자", "data-slot": "칸", tokens: "토큰", glyph: "글꼴", external: "외부 주소", size: "크기", missing: "사진 파일 없음", section: "장 구조", photos: "사진 장 수" };
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
    const ms = Date.now() - (s.turnAt ?? Date.now());
    flushLogs(s); // 로그 한 행은 사용량 카드보다 먼저(끝 신호 뒤에 오지 않게)
    if (s.sessionId && !s.lightAuto) {
        const rt = s.tool === "claude" ? "claude_code" : "codex";
        const sj = (await readJson(id, ".dynapse/session.json")) ?? {};
        if (sj[rt] !== s.sessionId)
            await wput(id, ".dynapse/session.json", JSON.stringify({ ...sj, [rt]: s.sessionId })).catch(() => { });
    }
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
        s.out.push({ role: "event", text: `${k} 토큰 · ${mmss(ms)}`, payload: { kind: "usage", ai: s.ai, timing: timingOf(s), tools: Object.entries(s.tools ?? {}).sort((a, b) => b[1].ms - a[1].ms).slice(0, 3).map(([n, x]) => ({ n, c: x.n, s: Math.round(x.ms / 1000) })), tokens: s.usage.tokens, cached: s.usage.cached ?? null, usd: s.usage.usd ?? null, parts: s.usage.parts ?? null,
                ...(s.quota0 !== undefined && s.quota1 !== undefined ? { quota_used: Math.max(0, Math.round((s.quota1 - s.quota0) * 1000) / 10), quota_now: Math.round(s.quota1 * 100) } : {}), ms, model: s.runModel ?? null, picked: s.model ?? null, effort: s.effort ?? null,
                ...(sid ? { session_id: sid, session_turn: ss[sid].n, session_since: ss[sid].since } : {}), ...(point ? { point: true } : {}) } });
    }
    if (s.mx) {
        const x = s.mx, u = s.usage?.parts, ps = photoStats.get(id);
        photoStats.delete(id);
        s.mx = undefined;
        const tools = Object.entries(s.tools ?? {});
        void sendMetric(id, { tid: x.tid, kind: x.kind, round: x.round ?? null, ok: !!x.committed, failed: !!x.failed, stopped: !!x.stopped, stop_at: x.stop_at ?? null,
            ai: s.ai, model: s.runModel ?? s.model ?? null, effort: s.effort ?? null,
            tok: s.usage ? { total: s.usage.tokens, in: u?.input ?? null, out: u?.output ?? null, cw: u?.cache_write ?? null, cr: u?.cache_read ?? s.usage.cached ?? null } : null,
            t: { ...timingOf(s), total: Math.round(ms / 1000) },
            tools: { n: tools.reduce((a, [, v]) => a + v.n, 0), top: tools.sort((a, b) => b[1].ms - a[1].ms).slice(0, 3).map(([n, v]) => ({ n, c: v.n, s: Math.round(v.ms / 1000) })), skill: x.skill },
            verify: { runs: x.runs, rules: x.rules, fixups: s.fixups }, photo: ps ?? null,
            files: x.files ?? null, fill: x.fill ?? null, hand: x.hand ?? 0, points: x.points ?? 0, len: x.len ?? null, ph: x.ph ?? null });
    }
    s.busy = false;
    s.fixups = 0;
    s.lastAt = Date.now();
    if (s.turnText)
        void remember(s.turnText.split("\n")[0].slice(0, 28), id).catch(() => { }); // 상태 창 "최근" — 누르면 그 작업실
    await flushChat(id, s);
    render();
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
        flushSoon(key.split("|")[0], s); }, 2000);
// 한도(#18 기본값) — 턴당 도구 호출 40 · 앱 검증 재시도 1(에이전트 자체는 3회) · 작업당 토큰 상한은 웹이 계산해 cap_left로 보낸다
export const LIMITS = { maxTurns: 40 };
export const TURN_CAP = 400_000;
// 막힌 Bash 명령 → 허용 규칙(프로그램 단위). "SRC=… && mkdir … && cp …"처럼 대입·cd·연결이 있어도 실제 프로그램마다 Bash(⟨프로그램⟩ *)
export function bashRules(cmd) {
    const progs = cmd.split(/&&|\|\||;|\||\n/).map(seg => seg.trim().split(/\s+/).filter(t => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t))[0] ?? "").map(p => p.replace(/^["'(]+|["')]+$/g, ""))
        .filter(p => p && p !== "cd" && /^[\w./-]{1,40}$/.test(p));
    return [...new Set(progs)].map(p => `Bash(${p} *)`);
}
// 자동으로 허용하지 않는 명령 — 카드로 묻는다
export const RISKY = /^Bash\((rm|sudo|chmod|chown|dd|mkfs|kill|pkill|killall|launchctl|osascript|security|ssh|scp|rsync|diskutil|shutdown|reboot|del|erase|rd|rmdir|reg|rundll32|powershell|pwsh|cmd|taskkill|sc|net|wmic|Remove-Item|Set-ExecutionPolicy) /; // 한 턴 토큰 상한(#27 B)
// 거부 목록(#27 A) — 자동 승인이어도 막는다: 파괴·원격 실행·자격증명 경로
export const DENY = ["Bash(rm -rf /*)", "Bash(rm -rf ~*)", "Bash(curl * | sh)", "Bash(curl * | bash)", "Read(~/.ssh/**)", "Read(~/.claude/**)", "Read(~/.codex/**)", "Read(~/.gemini/**)", "Read(~/.aws/**)",
    // 배포 계정 자격(#80) — gh·vercel이 자기 자리에 둔 토큰. 에이전트도 앱도 읽지 않는다
    "Read(~/.config/gh/**)", "Read(~/.vercel/**)", "Read(~/Library/Application Support/com.vercel.cli/**)", "Bash(gh auth token*)",
    // 홈 폴더 뒤지기 금지(대표: 구글드라이브·문서·오디오 권한 창) — macOS 보호 폴더 권한을 Dynapse 이름으로 묻게 된다
    "Bash(find ~*)", "Bash(find /Users*)", "Bash(find $HOME*)", "Bash(mdfind *)", "Bash(ls ~/Library/CloudStorage*)", "Bash(du ~*)",
    // Windows(#34 M8) — 드라이브 전체 뒤지기
    "Bash(find C:*)", "Bash(dir /s C:*)", "Bash(Get-ChildItem -Recurse *)"];
// 상한으로 멈춘 턴(#27 B) — 설명 대신 선택 카드: 이번 턴이 커서 멈췄어요 [이어서] [그만]. 이어서 = 같은 세션에 "이어서 해줘"
async function capStop(id, s) {
    const k = Math.round((s.liveTok ?? 0) / 1000);
    s.usage = { tokens: s.liveTok ?? 0 };
    s.out.push({ role: "event", text: null, payload: { kind: "ask", ai: s.ai, stop: "cap", questions: [{ label: AI_LABEL[s.ai], question: `작업이 길어져 잠시 멈췄어요 · 이번 턴에 새로 ${k}k 토큰(한 번에 ${Math.round((s.cap ?? TURN_CAP) / 1000)}k까지)`, options: [{ id: "more", label: "이어서 하기" }, { id: "stop", label: "여기서 끝내기" }] }] } });
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
    if (S.sync || sharedWorks.has(id))
        await pushWork(id, dir);
}
// 동기화 저장 형식(#20) — 파일을 덮어쓰지 않고 커밋 단위로: {sha = 로컬 git HEAD, parent = 직전에 올린 커밋, message, files:[{path, sha256, size}]}.
// 서버가 없는 블롭(missing)을 돌려주면 그 파일만 올리고 다시. 같은 내용은 한 번만 저장된다
export async function pushWork(id, dir) {
    const sha = S.git ? await T().core.invoke("repo_head", { id }).catch(() => null) : null;
    if (!sha)
        return;
    const heads = (await store.get("remote_heads")) ?? {};
    if (heads[id] === sha)
        return;
    const list = (await T().core.invoke("work_files", { id }).catch(() => []))
        // 동기화·초대 범위(#21 보정 7 C) — 페이지 · materials · 생성 사진 · 참고 폴더(assets·refs·RULES). 링크 원본·인덱스는 올리지 않는다
        .filter(x => /^result-[a-z0-9-]+\.html$/.test(x.name) || /^(materials|\.dynapse\/photos)\/[\w.-]+\.(png|jpe?g)$/i.test(x.name) || /^context\/(RULES\.md|(assets|refs)\/[^/]+)$/.test(x.name)
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
    const files = [];
    for (const f of list.filter(x => keep(x.name))) {
        const h = await T().core.invoke("work_sha256", { id, file: f.name }).catch(() => null);
        if (h)
            files.push({ path: f.name, sha256: h, size: f.size });
    }
    const trace = await readJson(id, ".dynapse/TRACE.json");
    const body = { sha, parent: heads[id] ?? null, message: trace?.rounds?.at(-1)?.req?.text ?? null, model: trace?.rounds?.at(-1)?.model ?? null, merged_from: trace?.rounds?.at(-1)?.merged_from ?? null, files };
    // 올리는 상태(#21 보정 14 C) — 웹 상태 줄 "☁ 올리는 중 n/m"·파일 줄 ↑→✓/! (채팅엔 안 보이는 이벤트)
    const up = (p) => postChat(id, [{ role: "event", text: null, payload: { kind: "upload", ai: "dynapse", ...p } }]);
    const failed = [];
    let done = 0;
    for (let k = 0; k < 2; k++) {
        const r = await api("POST", `/api/works/${encodeURIComponent(id)}/commits`, body).catch(() => null);
        if (r?.status === 200) {
            heads[id] = sha;
            await store.set("remote_heads", heads);
            await store.save();
            await up({ state: "done", total: files.length, files: files.map(f => f.path), failed });
            return;
        }
        if (r?.status !== 409 || !r.data?.missing?.length) {
            await up({ state: "fail", total: files.length, files: [], failed: files.map(f => f.path) });
            return;
        }
        const miss = r.data.missing;
        await up({ state: "run", done, total: miss.length });
        for (const m of miss) {
            const f = files.find(x => x.sha256 === m);
            if (!f)
                continue;
            const g = await http("PUT", `${HUB}/api/blobs/${m}?path=${encodeURIComponent(f.path)}`, { file: `${dir}/${f.path}`, contentType: "application/octet-stream", auth: true }).catch(() => null);
            if (g?.status === 200)
                done++;
            else
                failed.push(f.path);
            if (done % 2 === 0 || done === miss.length)
                await up({ state: "run", done, total: miss.length, path: f.path });
        }
    }
    await up({ state: "fail", total: files.length, files: [], failed: failed.length ? failed : files.map(f => f.path) });
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
export async function pullWork(id) {
    // 최신 커밋 매니페스트대로 파일을 받아 이 기기 git에 커밋(#20). 로컬 해시는 기기마다 다르므로 서버 커밋 해시를 remote_heads에 적어 다음 올림의 parent로 쓴다
    // 받는 상태(#21 보정 14 C) — "받는 중 n/m" → 로컬. 결과는 반드시 남긴다(#56 — 실패해도 아무 말이 없어 "편집이 막힌" 것처럼 보였다)
    const down = (p, text = null) => postChat(id, [{ role: "event", text, payload: { kind: "download", ai: "dynapse", ...p } }]);
    const why = (st) => st === 401 ? "연결이 끊겼어요" : st === 404 ? "이 계정의 작업이 아니에요" : st === 409 || st === 423 ? "공유가 꺼져 있어요" : st ? `서버 오류 ${st}` : "네트워크 오류";
    const fail = async (reason, done = 0, total = 0) => { await down({ state: "fail", done, total, reason }, `받지 못했어요 · ${reason}`); return false; };
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
    await down({ state: "done", done: got, total: head.files.length }, pagesN ? `받았어요 · ${pagesN}쪽` : "받았어요");
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
    await store.set("remote_heads", heads);
    await store.save();
    // 이 PC가 원본이 됐다 — local_path·기기·메타를 서버에(#56 — 성공해도 local_path가 안 적히던 경로)
    await api("POST", "/api/works", { id, status: "done", local_path: dir, device_id: S.deviceId }).catch(() => { });
    void afterSave(id);
    return true;
}
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
    if (write && /(^|\/)(materials|context\/assets)\/[^/]+\.(png|jpe?g|webp)$/.test(t))
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
