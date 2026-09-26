import { anyPhotoReady, runPhotoTurn, stopAnswer } from "./photo-runner.js";
import { HUB, MCP_URL, S, T, WORK_ID, agyLogin, api, deviceBody, exec, http, openLogin, render, spawn, store, switchAccount } from "./main.js";
export const AI_LABEL = { claude: "Claude", chatgpt: "ChatGPT", gemini: "Gemini" };
export let skillCache = null;
export async function workflowSkill() {
    if (skillCache)
        return skillCache;
    const r = await http("GET", `${HUB}/skills/dynapse-workflow.md`).catch(() => null);
    if (r?.status === 200 && r.body.includes("TRACE.json")) {
        skillCache = r.body;
        await store.set("skill_md", r.body);
        await store.save();
        return r.body;
    }
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
export async function ensureVerify(id) {
    if (!verifyCache) {
        const r = await http("GET", `${HUB}/skills/verify.mjs`).catch(() => null);
        if (r?.status === 200 && r.body.includes("dynapse-verify")) {
            verifyCache = r.body;
            await store.set("verify_mjs", r.body);
            await store.save();
        }
        else
            verifyCache = (await store.get("verify_mjs")) ?? null;
    }
    if (verifyCache)
        await wput(id, ".dynapse/verify.mjs", verifyCache).catch(() => { });
}
// 앱의 독립 검증 — node가 있으면 같은 스크립트, 없으면 앱 안의 최소 L0(파일·빈 파일·외부 URL·section). 렌더 사진은 node 경로에서만
export async function appVerify(id, pages) {
    const dir = await T().core.invoke("work_dir", { id });
    if (verifyCache) {
        const r = await exec("node", [".dynapse/verify.mjs", ...(pages ?? [])], undefined, dir).catch(() => null);
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
        const pages = v.shots.map(x => x.split("/").pop().replace(/\.png$/, "")).filter(pg => /^[a-z0-9-]+$/.test(pg));
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
        const page = rel.split("/").pop().replace(/\.png$/, "");
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
export const CHAT_TOOLS = "Read Write Edit mcp__dynapse Bash(node .dynapse/verify.mjs) Bash(node .dynapse/verify.mjs *) Bash(git *) Bash(curl *) Bash(agy *) Bash(codex *) Bash(cp *) Bash(sips *)";
export const MCP_STAGE = {
    // 보이는 것은 제출·공개뿐(#22-보정 14) — 나머지 Dynapse 도구는 로그로
    publish_work: "제출됨", submit_work: "제출됨",
};
export async function onChatMessage(m) {
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
            await pageCommit(m.work, p.file, p.note ?? "글자");
        return;
    }
    if (m.payload?.action === "swap-photo") {
        const p = m.payload;
        if (p.slot && p.url)
            await swapPhoto(m.work, p.slot, p.url, p.asset_id ?? null);
        return;
    }
    if (m.payload?.action === "push") {
        const dir = await T().core.invoke("work_dir", { id: m.work }).catch(() => null);
        if (dir)
            await pushWork(m.work, dir);
        return;
    } // 실패한 커밋은 remote_heads에 안 적혀 그대로 다시 올라간다
    // 이전 버전도 함께(#21 보정 15 B) — 작업별 옵션(상태 창). 켜면 이미지 버전 전부를 다음 올리기부터
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
        const uri = file ? await T().core.invoke("work_image", { id: from, file }).catch(() => null) : null;
        if (uri) {
            await T().core.invoke("work_dir", { id: m.work }).catch(() => { });
            await T().core.invoke("context_file", { id: m.work, path: "context/assets/photo.png", data: uri.split(",")[1] }).catch(() => { });
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
        await pullWork(m.work).catch(() => false);
        return;
    }
    // 웹 채팅 카드 [Claude 로그인](#20 연결 전 CTA) — 공식 로그인 창만 연다(실행 없음). 로그인되면 기다리던 메시지가 이어서 돈다
    if (m.payload?.action === "login" && m.payload.switch) {
        const ai = m.payload.ai;
        await switchAccount(ai === "chatgpt" ? "codex" : "claude");
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
    if (m.role === "user" && m.payload?.import)
        await importStart(m.work, m.payload.import);
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
        if (ans?.login) {
            if (ans.login === "gemini")
                await agyLogin();
            else
                await openLogin("codex");
        }
        const force = ans?.use ?? ans?.login;
        const prev = photoQueue.get(m.work) ?? Promise.resolve();
        const next = prev.then(() => runPhotoTurn(m.work, m.text, { route: m.payload?.route, taskId: m.payload?.task_id ?? null, ...(ans?.brief ? { briefOnly: true } : ans ? { resume: true, ...(force ? { force } : {}) } : {}) })).catch(e => postChat(m.work, [{ role: "event", text: String(e).slice(0, 80), payload: { kind: "error", ai: "dynapse" } }]));
        photoQueue.set(m.work, next);
        await next;
        return;
    }
    // 가져다 놓은 템플릿의 첫 메시지(#21 보정) — 템플릿 지시를 턴 앞에 붙인다(사용자가 말했을 때만 첫 턴)
    const tpl = m.payload?.template;
    // 짚어서 말하기(#25 A) — 📍 요소가 붙어 오면 "그 요소만" 계약을 턴 앞에(파일 전체 읽기 금지 · 끝나면 전/후 한 줄)
    const pts = (m.payload?.point ?? []).slice(0, 5);
    const pointed = pts.length ? `[📍 짚은 곳 ${pts.length}개 — 이 요소만 고쳐라(지침 §3-1). 파일 전체를 읽지 말고 selector로 찾아 그 요소만 바꾼 뒤, 끝나면 요소마다 "전 → 후" 한 줄]\n${pts.map((p, i) => `${i + 1}. file=${p.file} selector=${p.selector}${p.slot ? ` slot=${p.slot}` : ""}\n   원문: ${(p.snippet ?? "").replace(/\s+/g, " ").slice(0, 400)}`).join("\n")}\n요청: ` : "";
    if (m.role === "user" && m.text) {
        if (pts.length)
            pointTurn.add(m.work);
        await chatSend(m.work, tpl ? `${tpl}\n요청: ${m.text}` : pointed + m.text, { route: m.payload?.route, capLeft: m.payload?.cap_left ?? null });
    }
}
const pointTurn = new Set(); // 📍 턴(usage 카드에 📍 표시)
// 직접 수정 커밋(#25 B·#26) — 웹 캔버스가 page_write로 쓴 페이지를 커밋하고 한 줄. AI 호출 0
async function pageCommit(id, file, note) {
    if (!/^result-[a-z0-9-]+\.html$/.test(file))
        return;
    const sha = await repoCommit(id, `직접 수정 · ${note.slice(0, 80)}`);
    await postChat(id, [{ role: "event", text: `직접 수정 · ${note.slice(0, 60)}`, payload: { kind: "stage", ai: "dynapse", file, ...(sha ? { commit: sha } : {}) } }]);
    void afterSave(id);
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
    await repoCommit(id, `가져옴 · ${src}`);
    await postChat(id, [{ role: "event", text: `가져옴 · ${src}`, payload: { kind: "stage", ai: "dynapse" } }]);
    await resolveRefs(id, false);
}
// 가져온 HTML의 상대경로 재료(#24-보정) — 링크 폴더에서 쓰인 파일만 같은 경로로 복사(AI 없음). 못 찾으면 "파일 N개를 못 찾았어요 · [위치 참조]"
export async function resolveRefs(id, afterLink) {
    const r = await T().core.invoke("resolve_refs", { id }).catch(() => null);
    if (!r)
        return;
    if (r.copied.length) {
        await repoCommit(id, `재료 복사 · ${r.copied.length}개`);
        await postChat(id, [{ role: "event", text: `재료 ${r.copied.length}개 복사`, payload: { kind: "stage", ai: "dynapse" } }]);
    }
    if (r.missing.length)
        await postChat(id, [{ role: "event", text: `파일 ${r.missing.length}개를 못 찾았어요`, payload: { kind: "refs-missing", ai: "dynapse", files: r.missing.slice(0, 20), again: afterLink } }]);
}
// 추천 띠 교체(#24 §2) — 결정적 치환: 재고 사진을 받아 materials/⟨칸⟩-v⟨n⟩으로 두고, 그 칸(data-slot)이 있는 페이지의 사진만 바꾼다. 편집 AI 호출 0
export async function swapPhoto(id, slot, url, assetId) {
    if (!/^[a-z0-9_]{1,40}$/i.test(slot) || !/^https:\/\/[a-z0-9.-]+\.public\.blob\.vercel-storage\.com\//.test(url))
        return; // 우리 재고 저장소만
    const dir = await T().core.invoke("work_dir", { id });
    const files = await T().core.invoke("work_files", { id }).catch(() => []);
    const ext = /\.jpe?g(\?|$)/i.test(url) ? "jpg" : "png";
    const n = 1 + Math.max(0, ...files.map(f => Number(f.name.match(new RegExp(`^materials/${slot}-v(\\d+)\\.(png|jpe?g)$`))?.[1] ?? 0)));
    const file = `materials/${slot}-v${n}.${ext}`;
    const g = await http("GET", url, { out: `${dir}/${file}` }).catch(() => null);
    const data = g?.status === 200 ? await T().core.invoke("work_image", { id, file }).catch(() => null) : null;
    if (!data) {
        await postChat(id, [{ role: "event", text: "사진을 받지 못했어요", payload: { kind: "error", ai: "dynapse" } }]);
        return;
    }
    const re = new RegExp(`<(\\w+)\\b([^>]*\\bdata-slot\\s*=\\s*["']${slot}["'][^>]*)>([\\s\\S]*?)<\\/\\1>`, "i");
    let pages = 0;
    for (const f of files.filter(f => /^result-[a-z0-9-]+\.html$/.test(f.name))) {
        const html = await wget(id, f.name);
        if (!html || !re.test(html))
            continue;
        await wput(id, f.name, html.replace(re, (_m, tag, attrs) => `<${tag}${attrs}><img src="${data}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block"></${tag}>`));
        pages++;
    }
    const slots = (await readJson(id, ".dynapse/slots.json")) ?? {};
    await wput(id, ".dynapse/slots.json", JSON.stringify({ ...slots, [slot]: file }, null, 2));
    const trace = (await readJson(id, ".dynapse/TRACE.json")) ?? {};
    await wput(id, ".dynapse/TRACE.json", JSON.stringify({ ...trace, children: [...(trace.children ?? []).filter(c => c.slot !== slot), { runtime: "stock", asset_id: assetId ?? undefined, slot, file }] }, null, 2));
    const sha = await repoCommit(id, `사진 교체 · ${slot}${assetId ? ` · 재고 ${assetId}` : ""}`);
    await postChat(id, [{ role: "event", text: pages ? "사진 교체" : "사진 받음", payload: { kind: "stage", ai: "dynapse", file, ...(sha ? { commit: sha } : {}) } }]);
    void afterSave(id);
}
export const RULES_TEMPLATE = "# 규칙\n톤:\n금지:\n브랜드 색:\n잠근 슬롯:\n협업: 다른 AI가 고칠 땐 .dynapse/NOTES.md 먼저 읽고, 바꾼 이유를 한 줄 남긴다\n";
// 폴더 준비 — 지침·검증 스크립트·저장소·인증 파일(0600). 공개 작업 요청 수락·[내 AI로 만들기]처럼 웹에서 먼저 생긴 작업도 여기서 폴더가 생긴다
export async function prepWork(id) {
    const dir = await T().core.invoke("work_dir", { id });
    const has = (await T().core.invoke("work_files", { id }).catch(() => [])).some(f => /^result-/.test(f.name));
    if (!has && (S.sync || sharedWorks.has(id)))
        await pullWork(id).catch(() => false); // 다른 기기에서 만든 작업 — 동기화 사본을 받는다
    const skill = await workflowSkill();
    if (skill)
        for (const f of ["CLAUDE.md", "AGENTS.md"])
            await wput(id, f, skill);
    await ensureVerify(id);
    // 참고 폴더(#21 보정 6) — context/RULES.md 기본 템플릿(6줄 이하). 사람과 AI가 함께 쓴다
    const have = await T().core.invoke("work_files", { id }).catch(() => []);
    if (!have.some(f => f.name === "context/RULES.md"))
        await wput(id, "context/RULES.md", RULES_TEMPLATE).catch(() => { });
    if (S.git && !(await T().core.invoke("repo_head", { id }).catch(() => null)))
        await repoCommit(id, "작업실 시작");
    // 가져온 HTML의 재료(#24-보정) — 링크 폴더에 있는데 아직 안 복사된 것이 있으면 조용히 복사(턴 전)
    {
        const r = await T().core.invoke("resolve_refs", { id }).catch(() => null);
        if (r?.copied.length)
            await repoCommit(id, `재료 복사 · ${r.copied.length}개`);
    }
    if (S.token) {
        await T().core.invoke("work_secret", { id, name: "mcp-config", text: JSON.stringify({ mcpServers: { dynapse: { type: "http", url: MCP_URL, headers: { Authorization: `Bearer ${S.token}` } } } }) });
        await T().core.invoke("work_secret", { id, name: "auth-header", text: `Authorization: Bearer ${S.token}\n` });
    }
    return dir;
}
// 역할 줄 — 사용자가 고른 AI를 에이전트에게(데이터가 아니라 앱이 붙이는 지시). 디자인 둘 = 공동(너가 쓰고 다른 AI가 검토), 사진 둘 = 비교, 사진 0 = 재고만
export const PHOTO_CAP = 2; // 한 턴 생성 상한(#24 §3)
export function routeLine(r, self) {
    if (!r)
        return "";
    const cm = r.models?.chatgpt, gp = r.models?.gemini;
    // agy 모델 id에는 강도가 붙어 있다(gemini-3.1-pro-high) — 고른 강도가 있으면 그 id, 없으면 그 모델의 첫 강도
    const gOpt = gp?.model ? S.models.gemini?.find(o => o.id === gp.model) : undefined;
    const gm = gp?.model ? { model: gOpt?.efforts?.length ? `${gp.model}-${gOpt.efforts.includes(gp.effort ?? "") ? gp.effort : gOpt.efforts[0]}` : gp.model, effort: gp.effort } : gp;
    const PH = {
        gemini: `Gemini(\`agy -p …${gm?.model ? ` --model ${gm.model}` : ""}${gm?.effort ? ` --effort ${gm.effort}` : ""}\`로 generate_image)`,
        // 편집 중 사진 칸도 내 사진 AI로(#23-보정 A) — ChatGPT는 codex exec로 PNG 한 장
        chatgpt: `ChatGPT(\`codex exec … materials/⟨칸⟩-v⟨n⟩.png\`로 생성${cm?.model ? `, -m ${cm.model}` : ""})`,
    };
    const other = r.design.find(a => a !== self);
    // 사진 칸 정책(#23-보정 A · #24) — 내 사진 → 우리 추천(recommend_assets 1위 ≥ 임계점) → 필요할 때만 생성(칸당 1장, 재사용 우선, 한 턴 상한). "내 AI 우선"은 임계점 0.85
    const gen = r.photo.length > 1 ? `${r.photo.map(a => PH[a]).join(" 와 ")} 각각 한 장씩 만들어 비교(둘 다 materials/에 저장하고 어느 쪽을 넣었는지 답에 적기)` : r.photo.length ? `${PH[r.photo[0]]}로 생성` : "";
    const th = r.photo_first ? 0.85 : 0.6;
    const rec = `recommend_assets 1위 score ≥ ${th}면 그 재고`;
    const photo = !gen ? `사진: 내 사진(context/assets) → ${rec}(미만이어도 1위) → 없으면 칸을 비우고 TRACE empty_slots에(사진 AI 없음)`
        : `사진: 내 사진(context/assets) → ${rec} → 미만인 칸만 ${gen}(이미 생성본이 있으면 재사용, 한 턴 최대 ${PHOTO_CAP}장 — 넘으면 추천 1위 + capped_slots)`;
    const design = other ? `디자인: 너(${AI_LABEL[self]})가 고치고, 끝나면 ${AI_LABEL[other]}에게 검토시켜라(\`codex exec\`/\`claude -p\`로 이 폴더 검토 요청)` : `디자인: 너(${AI_LABEL[self]})`;
    return `[이번 메시지의 역할 — 사용자가 고른 AI] ${design} · ${photo}\n`;
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
        const prev = [...(trace?.rounds ?? [])].reverse().find(r => r.runtime === rt && r.session_id)?.session_id; // 만들기 때의 세션을 이어받는다
        const remembered = (await readJson(id, ".dynapse/allow.json").catch(() => null)) ?? [];
        s = { tool, ai: tool === "claude" ? "claude" : "chatgpt", sessionId: prev, busy: false, queue: [], lastAt: Date.now(), out: [], verifyN: 0, fixups: 0, extraAllow: remembered.filter(x => typeof x === "string" && /^[\w]+(\(.{1,120}\))?$/.test(x)).slice(0, 30) };
        sessions.set(key, s);
    }
    s.auto = route?.auto_approve !== false; // 자동 승인(#27 A, 기본 켜짐)
    if (route?.design?.[0] && route.design[0] !== s.ai)
        s.out.push({ role: "event", text: `${AI_LABEL[route.design[0]]}가 연결돼 있지 않아 ${AI_LABEL[s.ai]}가 맡아요`, payload: { kind: "error", ai: "dynapse" } });
    if (route?.design?.length)
        await wput(id, ".dynapse/team.json", JSON.stringify(teamToFile({ merge: route.design[0], design: route.design, photo: route.photo, chosen: null }), null, 2)).catch(() => { }); // AI 줄(#16B) → team.json
    const pick = route?.models?.[s.ai];
    // 작업에서 안 고르면 홈 AI 카드의 기본 모델(#21 보정 12)
    s.model = pick?.model || S.defaultModels[s.ai] || null;
    s.effort = pick?.effort || "medium"; // 기본 강도 = 보통(대표 2026-09-26: 한 턴 7분은 길다). AI 줄에서 고르면 그 값 s.capLeft = opts.capLeft ?? null;
    // [승인]·[건너뛰기] 답(#22-보정 3) — 승인이면 막힌 도구를 이 세션에 한 번 더 허용하고 이어서
    // 상한 카드의 답(#27 B) — 이어서 = 같은 세션에서 마무리(부분 읽기), 그만 = 아무것도 안 함
    if (/^(Claude|ChatGPT): 그만$/.test(text))
        return;
    if (/^(Claude|ChatGPT): 이어서$/.test(text))
        text = "방금 상한으로 멈춘 작업을 이어서 마무리해줘. 큰 파일은 통째로 다시 읽지 말고 grep -n·부분 읽기로, 기계적인 작업은 스크립트 한 번으로.";
    if (s.pendingAllow?.length && /: (승인|건너뛰기)$/.test(text)) {
        const allow = /: 승인$/.test(text);
        if (allow) {
            s.extraAllow = [...new Set([...(s.extraAllow ?? []), ...s.pendingAllow])];
            await wput(id, ".dynapse/allow.json", JSON.stringify(s.extraAllow, null, 2)).catch(() => { });
        } // 이 작업에 기억 — 같은 질문 두 번 없음(#27)
        s.pendingAllow = [];
        text = allow ? "방금 막힌 명령을 다시 실행해서 이어가." : "그 명령 없이 할 수 있는 만큼 이어가.";
    }
    s.autoRetry = 0;
    s.queue.push(routeLine(route, s.ai) + text);
    if (!s.busy)
        await nextTurn(id, s);
}
// 보이는 진행 문구(#22-보정 14) — 결과물에 닿는 것만: ⟨페이지⟩ 읽는/쓰는 중 · 사진 만드는 중 · ⟨AI⟩ · 사진 넣는 중 · 확인 중 n/3 · 제출됨 · 저장됨.
// 나머지(.dynapse 내부·지시 파일·토큰·레시피·재료 읽기·git·ls·cat)는 로그 접힘에만(kind "log")
export function eventLog(s, text) {
    if (!text.trim())
        return;
    s.out.push({ role: "event", text: text.slice(0, 160), payload: { kind: "log", ai: s.ai } });
}
export function chatEvent(id, s, text, payload = {}) {
    if (!text || text === s.lastStage)
        return; // 같은 단계가 이어지면 한 줄만
    s.lastStage = text;
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
    const push = (name, target) => {
        const t = stage(name, target);
        if (!t) {
            eventLog(s, `${name}${target ? ` ${target}` : ""}`);
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
                push(c.name ?? "", String(c.input?.file_path ?? c.input?.path ?? c.input?.command ?? ""));
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
    }
    // 턴 도중 토큰(#27 B) — 응답마다 usage를 더해 상한(턴 400k · 작업 남은 몫)을 넘으면 프로세스를 멈추고 선택 카드
    {
        const mu = d.type === "assistant" ? d.message?.usage : null, mid = d.message?.id;
        if (mu && mid && !s.seenMsg?.has(mid)) {
            s.seenMsg?.add(mid);
            s.liveTok = (s.liveTok ?? 0) + (mu.input_tokens ?? 0) + (mu.output_tokens ?? 0) + (mu.cache_creation_input_tokens ?? 0);
        } // 캐시 재사용 제외(표시와 같은 기준)
        if (d.type === "turn.completed" && d.usage)
            s.liveTok = (d.usage.input_tokens ?? 0) + (d.usage.output_tokens ?? 0);
        if (s.busy && !s.capped && s.cap && (s.liveTok ?? 0) >= s.cap && s.procId !== undefined) {
            s.capped = true;
            void T().core.invoke("run_kill", { id: s.procId }).catch(() => { });
        }
    }
    if (d.type === "turn.completed" && d.usage) {
        const u = d.usage;
        s.usage = { tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.reasoning_output_tokens ?? 0) };
    }
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
        s.usage = { tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), cached: u.cache_read_input_tokens ?? 0, usd: turnUsd };
        if (s.usage.usd && s.usage.tokens)
            s.usdPerTok = s.usage.usd / s.usage.tokens;
        // 권한으로 막힌 도구(#22-보정 3) — Claude result.permission_denials
        const den = Array.isArray(d.permission_denials) ? d.permission_denials : [];
        s.denied = [...new Set(den.flatMap(x => x.tool_name === "Bash" && x.tool_input?.command ? bashRules(String(x.tool_input.command)) : [String(x.tool_name ?? "")]).filter(Boolean))].slice(0, 6);
        s.lastText = typeof d.result === "string" ? d.result : s.lastText;
        void endTurn(id, s, d.subtype === "success");
    }
}
export async function nextTurn(id, s) {
    const text = s.queue.shift();
    if (!text)
        return;
    s.liveTok = 0;
    s.seenMsg = new Set();
    s.capped = false;
    s.cap = Math.min(TURN_CAP, s.capLeft ?? Infinity);
    s.busy = true;
    s.asked = false;
    s.merged = null;
    s.verifyN = 0;
    s.lastStage = undefined;
    s.lastText = undefined;
    s.turnAt = Date.now();
    s.usage = null;
    s.turnText = text.replace(/^\[이번 메시지의 역할[^\n]*\n/, "");
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
        const linked = await T().core.invoke("link_reindex", { id }).catch(() => []);
        const want = `${s.model ?? ""}|${s.effort ?? ""}|${budgetUsd(s) ?? ""}|${linked.join(",")}|${(s.extraAllow ?? []).join(",")}|${s.auto ? "auto" : "manual"}`;
        if (s.procId !== undefined && (s.token !== S.token || s.spawnedWith !== want)) {
            const old = s.procId;
            s.procId = undefined;
            await T().core.invoke("run_close_stdin", { id: old }).catch(() => { });
            await new Promise(r => setTimeout(r, 1500));
        } // 토큰·모델·강도·예산·승인 모드가 바뀌면 새 인자로 다시 붙는다(--resume). 옛 프로세스 종료는 새 턴을 끝내지 않는다(procId를 먼저 비움)
        if (s.procId === undefined) {
            if (s.sessionId)
                s.out.push({ role: "event", text: "이어서 불러옴 · 대화 기억 유지", payload: { kind: "stage", ai: s.ai } }); // 대화가 이어진다는 표시(#25 C)
            s.token = S.token;
            s.spawnedWith = want;
            const budget = budgetUsd(s);
            const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--mcp-config", ".dynapse/mcp-config", "--strict-mcp-config",
                "--max-turns", String(LIMITS.maxTurns), "--allowedTools", [CHAT_TOOLS, ...(s.extraAllow ?? [])].join(" "), "--add-dir", dir, ...linked.flatMap(p => ["--add-dir", p]),
                ...(s.model ? ["--model", s.model] : []), ...(s.effort ? ["--effort", s.effort] : []), ...(budget ? ["--max-budget-usd", budget.toFixed(2)] : []),
                // 자동 승인(#27 A) — 공식 auto 모드(Claude Code 분류기). 끄면 manual + 카드. --dangerously-skip-permissions는 쓰지 않는다
                "--permission-mode", s.auto ? "auto" : "manual", "--disallowedTools", DENY.join(" "),
                ...(s.sessionId ? ["--resume", s.sessionId] : [])];
            let mine;
            const started = spawn("claude", args, "", dir, l => { logChat(l); chatLine(id, s, l); }, pid => { mine = pid; s.procId = pid; }, true);
            started.then(code => {
                // 설정이 바뀌어 새로 띄운 경우, 닫히는 옛 프로세스의 종료가 새 턴을 끝내지 않게 — 지금 프로세스일 때만(#26 보정: "끝났어요(종료 코드 0)")
                if (mine !== undefined && s.procId !== mine)
                    return;
                s.procId = undefined;
                if (s.busy && s.capped)
                    void capStop(id, s);
                else if (s.busy)
                    void endTurn(id, s, false, `Claude Code가 끝났어요(종료 코드 ${code})`);
            });
            for (let k = 0; k < 50 && s.procId === undefined; k++)
                await new Promise(r => setTimeout(r, 100));
        }
        if (s.procId === undefined)
            return endTurn(id, s, false, "Claude Code를 시작하지 못했어요");
        await T().core.invoke("run_write", { id: s.procId, line: JSON.stringify({ type: "user", message: { role: "user", content: text } }) })
            .catch(e => endTurn(id, s, false, `전달 실패: ${e}`));
    }
    else {
        const mo = [...(s.model ? ["-m", s.model] : []), ...(s.effort ? ["-c", `model_reasoning_effort="${s.effort}"`] : [])];
        const args = s.sessionId
            ? ["exec", "resume", "--json", "--skip-git-repo-check", ...mo, "-c", 'sandbox_mode="workspace-write"', "-c", "sandbox_workspace_write.network_access=true", s.sessionId, "-"]
            : ["exec", "--json", "--skip-git-repo-check", ...mo, "-s", "workspace-write", "-c", "sandbox_workspace_write.network_access=true", ...(s.auto ? ["--approve-for-me"] : []), "-C", dir, "-"]; // Codex 자동 승인(#27) — 샌드박스 안 자동 검토(exec resume엔 이 옵션이 없다)
        const code = await spawn("codex", args, text, dir, l => { logChat(l); chatLine(id, s, l); }, pid => { s.procId = pid; }).catch(() => -1);
        s.procId = undefined;
        if (s.capped)
            await capStop(id, s);
        else
            await endTurn(id, s, code === 0, code === 0 ? undefined : `Codex가 끝나지 못했어요(종료 코드 ${code})`);
    }
}
// 한 턴 끝 — 앱 독립 검증 → (실패면 같은 세션에 실패 JSON으로 한 번 더) → 통과분만 버전 커밋 → 사진·요약을 대화에
export async function endTurn(id, s, ok, why) {
    if (!s.busy)
        return;
    // 자동 승인(#27 · 대표: "이미 승인하기로 했는데 또 누르게 하지 말 것") — 켜져 있으면 막힌 명령을 이 작업에 허용·기억하고 카드 없이 이어서.
    // 위험 명령(rm·sudo 등)과 같은 턴 2회 넘게 막히면 카드로 묻는다. 거부 목록(DENY)은 언제나 우선
    if (s.denied?.length && !s.asked && s.auto && (s.autoRetry ?? 0) < 2 && s.denied.every(r => !RISKY.test(r))) {
        s.extraAllow = [...new Set([...(s.extraAllow ?? []), ...s.denied])].slice(-40);
        await wput(id, ".dynapse/allow.json", JSON.stringify(s.extraAllow, null, 2)).catch(() => { });
        s.out.push({ role: "event", text: `자동 승인 · ${s.denied.map(r => r.replace(/^Bash\((\S+).*$/, "$1")).join(", ").slice(0, 60)}`, payload: { kind: "stage", ai: s.ai } });
        s.denied = [];
        s.autoRetry = (s.autoRetry ?? 0) + 1;
        s.queue.unshift("방금 막힌 명령을 다시 실행해서 이어가.");
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
        s.out.push({ role: "event", text: why ?? "멈췄어요", payload: { kind: "error", ai: s.ai, model: s.runModel ?? null } });
        if (s.lastText)
            s.out.push({ role: "agent", text: s.lastText, payload: { ai: s.ai, model: s.runModel ?? null, summary: summaryLines(s.lastText) } });
        return finishTurn(id, s);
    }
    const changed = S.git ? await T().core.invoke("repo_changed", { id }).catch(() => []) : ["?"];
    const touched = changed.some(f => /^result-[a-z0-9-]+\.html$/.test(f) || f.startsWith("materials/"));
    if (touched) {
        chatEvent(id, s, `확인 중 ${Math.min(s.verifyN + 1, 3)}/3`, { ai: "dynapse" });
        await flushChat(id, s);
        const v = await appVerify(id);
        s.out.push({ role: "event", text: null, payload: { kind: "verify", ai: "dynapse", ok: v.ok, errors: v.errors.slice(0, 5), warnings: v.warnings.length } });
        if (!v.ok && s.fixups < 1 && s.tool === "claude" && s.procId !== undefined) {
            s.fixups++;
            await flushChat(id, s);
            s.verifyN = 0;
            await T().core.invoke("run_write", { id: s.procId, line: JSON.stringify({ type: "user", message: { role: "user", content: `앱 검증이 실패했다. 아래 errors를 고치고 node .dynapse/verify.mjs로 다시 확인하라. 요청과 제약은 그대로다.\n${JSON.stringify({ errors: v.errors.slice(0, 8) })}` } }) }).catch(() => { });
            return; // 같은 턴이 이어진다(result가 다시 온다)
        }
        if (v.ok || !S.git) {
            const trace = (await readJson(id, ".dynapse/TRACE.json")) ?? {};
            const n = (trace.rounds?.at(-1)?.n ?? 0) + 1;
            // 사진 칸 출처(#23 · #23-보정 A) — 이번 턴에 쓴 재고는 "재고 사진 · ⟨제목⟩" + [내 AI로 새로], 비워 둔 칸은 "사진 칸 비어 있음" + [사진 만들기]
            const before = new Set(s.traceBefore ?? []);
            for (const c of (trace.children ?? []).filter(c => c.runtime === "stock" && !before.has(JSON.stringify(c))).slice(0, 4))
                s.out.push({ role: "event", text: `재고 사진 · ${(c.title ?? "재고").slice(0, 40)}`, payload: { kind: "stock", ai: "dynapse", slot: c.slot ?? null, file: c.file ?? null, asset_id: c.asset_id ?? null } });
            const capped = trace.capped_slots ?? [];
            if (capped.length && !before.has(`capped:${JSON.stringify(capped)}`))
                s.out.push({ role: "event", text: `${PHOTO_CAP}장만 새로 만들었어요`, payload: { kind: "photo-capped", ai: "dynapse", slots: capped.slice(0, 6) } });
            if (trace.empty_slots?.length && !before.has(`empty:${JSON.stringify(trace.empty_slots)}`))
                s.out.push({ role: "event", text: "사진 칸 비어 있음", payload: { kind: "photo-empty", ai: "dynapse", slots: trace.empty_slots.slice(0, 6) } });
            const r = { n, role: "write", runtime: s.tool === "claude" ? "claude_code" : "codex", session_id: s.sessionId ?? "", files: ["result-cover.html", "result-body.html"],
                req: { text: s.turnText?.slice(0, 500) }, summary: summaryLines(s.lastText), ...(s.runModel ? { model: s.runModel } : {}), ...(s.merged ? { merged_from: s.merged } : {}) };
            await saveRound(id, r, `“${(s.turnText ?? "").slice(0, 200)}” · ${AI_LABEL[s.ai]}`, v);
            await wput(id, ".dynapse/TRACE.json", JSON.stringify({ ...trace, rounds: [...(trace.rounds ?? []), r] }, null, 2));
            if (r.shots?.length)
                s.out.push({ role: "event", text: null, payload: { kind: "shot", ai: s.ai, round: n, pages: r.shots, commit: r.commit ?? null, uploaded: !!r.uploaded, model: s.runModel ?? null } }); // 스레드 항목 = 커밋(#20)
            await api("POST", "/api/works", { id, status: "done", local_path: await T().core.invoke("work_dir", { id }), device_id: S.deviceId }).catch(() => { });
            void afterSave(id);
        }
    }
    else if (S.git && changed.length)
        await repoCommit(id, `“${(s.turnText ?? "").slice(0, 200)}” · 기록`);
    s.out.push({ role: "agent", text: s.lastText ?? "끝났어요", payload: { ai: s.ai, model: s.runModel ?? null, summary: summaryLines(s.lastText) } });
    return finishTurn(id, s);
}
export async function finishTurn(id, s) {
    const ms = Date.now() - (s.turnAt ?? Date.now());
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
        s.out.push({ role: "event", text: `${k} 토큰 · ${mmss(ms)}`, payload: { kind: "usage", ai: s.ai, tokens: s.usage.tokens, cached: s.usage.cached ?? null, usd: s.usage.usd ?? null, ms, model: s.runModel ?? null, picked: s.model ?? null, effort: s.effort ?? null,
                ...(sid ? { session_id: sid, session_turn: ss[sid].n, session_since: ss[sid].since } : {}), ...(point ? { point: true } : {}) } });
    }
    s.busy = false;
    s.fixups = 0;
    s.lastAt = Date.now();
    if (s.turnText)
        await remember(s.turnText.split("\n")[0].slice(0, 28), id); // 상태 창 "최근" — 누르면 그 작업실
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
export const RISKY = /^Bash\((rm|sudo|chmod|chown|dd|mkfs|kill|pkill|killall|launchctl|osascript|security|ssh|scp|rsync|diskutil|shutdown|reboot) /; // 한 턴 토큰 상한(#27 B)
// 거부 목록(#27 A) — 자동 승인이어도 막는다: 파괴·원격 실행·자격증명 경로
export const DENY = ["Bash(rm -rf /*)", "Bash(rm -rf ~*)", "Bash(curl * | sh)", "Bash(curl * | bash)", "Read(~/.ssh/**)", "Read(~/.claude/**)", "Read(~/.codex/**)", "Read(~/.gemini/**)", "Read(~/.aws/**)"];
// 상한으로 멈춘 턴(#27 B) — 설명 대신 선택 카드: 이번 턴이 커서 멈췄어요 [이어서] [그만]. 이어서 = 같은 세션에 "이어서 해줘"
async function capStop(id, s) {
    const k = Math.round((s.liveTok ?? 0) / 1000);
    s.usage = { tokens: s.liveTok ?? 0 };
    s.out.push({ role: "event", text: null, payload: { kind: "ask", ai: s.ai, stop: "cap", questions: [{ label: AI_LABEL[s.ai], question: `이번 턴이 커서 멈췄어요 · ${k}k`, options: [{ id: "more", label: "이어서" }, { id: "stop", label: "그만" }] }] } });
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
    for (const [, s] of sessions)
        if (!s.busy && s.procId !== undefined && Date.now() - s.lastAt > 10 * 60_000) {
            T().core.invoke("run_close_stdin", { id: s.procId }).catch(() => { });
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
    await T().core.invoke("open_inapp", { path: p }).catch(() => T().shell.open(`${HUB}${path}`));
}
// 진행 미러 — 단계 문장·AI·시작 시각을 웹 진행 카드로(3초에 1번 이하, 끝날 때 1번)
// 저장 뒤: ① 메타(TRACE 라운드·사진 기록·NOTES·팀) ② 표지의 비공개 썸네일(서버가 찍고 html은 버린다) ③ 동기화를 켰으면 결과 html 사본
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
    await api("PUT", `/api/works/${encodeURIComponent(id)}/meta`, { trace, team, files: files.slice(0, 300), slot_names: [...slotNames], ...(tags ? { tags } : {}), local_path: await T().core.invoke("work_dir", { id }).catch(() => null), ...(S.sync ? { notes, ...(brief ? { brief } : {}) } : {}) }).catch(() => { });
    const dir = await T().core.invoke("work_dir", { id }).catch(() => null);
    if (!dir)
        return;
    // 썸네일 예외(#20 보정 2) — 작은 미리보기(표지 1장, 서버가 긴 변 640·≤120KB로 줄인다)만 기본으로. 계정에서 끄면(thumb_upload=false) 안 올린다.
    // 결과 HTML을 서버에 보내 렌더하던 길은 없앴다(내용 업로드가 되므로)
    if (S.thumbUpload) {
        const first = await firstItem(id, files);
        if (first) {
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
    const c = await api("GET", `/api/works/${encodeURIComponent(id)}/commits?latest=1`).catch(() => null);
    const head = c?.data?.commit;
    if (!head?.files.length)
        return false;
    const dir = await T().core.invoke("work_dir", { id });
    // 받는 상태(#21 보정 14 C) — "받는 중 n/m" → 로컬
    const down = (p) => postChat(id, [{ role: "event", text: null, payload: { kind: "download", ai: "dynapse", ...p } }]);
    let got = 0;
    for (const f of head.files) {
        const g = await http("GET", `${HUB}/api/works/${encodeURIComponent(id)}/commits/${head.sha}?path=${encodeURIComponent(f.path)}`, { out: `${dir}/${f.path}`, auth: true }).catch(() => null);
        if (g?.status !== 200) {
            await down({ state: "fail", done: got, total: head.files.length });
            return false;
        }
        got++;
        if (got % 3 === 0 && got < head.files.length)
            await down({ state: "run", done: got, total: head.files.length });
    }
    await down({ state: "done", done: got, total: head.files.length });
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
    return true;
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
    const page = t.match(/(?:^|\/)result-([a-z0-9-]+)\.html(?:\s|$)/);
    if (page && /^(read|view|write|edit|multiedit|replace|create|apply|patch|str_replace_based_edit_tool)$/.test(n.replace(/_file$/, "")))
        return `${PAGE_NAME[page[1]] ?? page[1]} ${write ? "쓰는 중" : "읽는 중"}`;
    if (page && write)
        return `${PAGE_NAME[page[1]] ?? page[1]} 쓰는 중`;
    if (write && /(^|\/)(materials|context\/assets)\/[^/]+\.(png|jpe?g|webp)$/.test(t))
        return "사진 넣는 중";
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
    for (const w of waiting.filter(x => x.photo !== undefined && anyPhotoReady())) {
        waiting.splice(waiting.indexOf(w), 1);
        await postChat(w.id, [{ role: "event", text: "연결됨 · 시작합니다", payload: { kind: "stage", ai: "dynapse" } }]);
        void runPhotoTurn(w.id, w.text, { route: w.opts.route, taskId: w.photo || null });
    }
    if (!ready || !waiting.some(x => x.photo === undefined))
        return;
    for (const w of waiting.splice(0).filter(x => x.photo === undefined)) {
        await postChat(w.id, [{ role: "event", text: "연결됨 · 시작합니다", payload: { kind: "stage", ai: "dynapse" } }]);
        await chatSend(w.id, w.text, w.opts);
    }
}
