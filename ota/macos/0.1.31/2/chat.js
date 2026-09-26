import { anyPhotoReady, runPhotoTurn, stopAnswer } from "./photo-runner.js";
import { HUB, MCP_URL, S, T, WORK_ID, agyLogin, api, deviceBody, exec, http, openLogin, render, spawn, store } from "./main.js";
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
    if (done.includes("cover"))
        shotAt[id] = Date.now();
    return done;
}
export const shotAt = {};
// 함께 하는 작업(#20 초대) — 초대가 곧 올리기 동의라 동기화를 켜지 않아도 이 작업의 커밋은 올리고 받는다
export const sharedWorks = new Set();
export const sessions = new Map();
export const CHAT_TOOLS = "Read Write Edit mcp__dynapse Bash(node .dynapse/verify.mjs) Bash(node .dynapse/verify.mjs *) Bash(git *) Bash(curl *) Bash(agy *) Bash(codex *) Bash(cp *) Bash(sips *)";
export const MCP_STAGE = {
    search_assets: "재고 찾는 중", get_template: "재료 받는 중", get_pack: "재료 받는 중", get_work: "작업 읽는 중", publish_work: "공개 신청 중",
    set_sync: "동기화 설정 중", claim_task: "작업 수락 중", submit_work: "제출 중", my_status: "기록 확인 중",
    get_version: "상대 버전 받는 중", ask_user: "골라 주세요", merge_report: "합친 결과 정리 중",
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
        if (l)
            await postChat(m.work, [{ role: "event", text: `참조 · ${l.name}`, payload: { kind: "stage", ai: "dynapse" } }]);
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
        const next = prev.then(() => runPhotoTurn(m.work, m.text, { route: m.payload?.route, taskId: m.payload?.task_id ?? null, ...(ans ? { resume: true, ...(force ? { force } : {}) } : {}) })).catch(e => postChat(m.work, [{ role: "event", text: String(e).slice(0, 80), payload: { kind: "error", ai: "dynapse" } }]));
        photoQueue.set(m.work, next);
        await next;
        return;
    }
    // 가져다 놓은 템플릿의 첫 메시지(#21 보정) — 템플릿 지시를 턴 앞에 붙인다(사용자가 말했을 때만 첫 턴)
    const tpl = m.payload?.template;
    if (m.role === "user" && m.text)
        await chatSend(m.work, tpl ? `${tpl}\n요청: ${m.text}` : m.text, { route: m.payload?.route, capLeft: m.payload?.cap_left ?? null });
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
    if (S.token) {
        await T().core.invoke("work_secret", { id, name: "mcp-config", text: JSON.stringify({ mcpServers: { dynapse: { type: "http", url: MCP_URL, headers: { Authorization: `Bearer ${S.token}` } } } }) });
        await T().core.invoke("work_secret", { id, name: "auth-header", text: `Authorization: Bearer ${S.token}\n` });
    }
    return dir;
}
// 역할 줄 — 사용자가 고른 AI를 에이전트에게(데이터가 아니라 앱이 붙이는 지시). 디자인 둘 = 공동(너가 쓰고 다른 AI가 검토), 사진 둘 = 비교, 사진 0 = 재고만
export function routeLine(r, self) {
    if (!r)
        return "";
    const cm = r.models?.chatgpt, gp = r.models?.gemini;
    // agy 모델 id에는 강도가 붙어 있다(gemini-3.1-pro-high) — 고른 강도가 있으면 그 id, 없으면 그 모델의 첫 강도
    const gOpt = gp?.model ? S.models.gemini?.find(o => o.id === gp.model) : undefined;
    const gm = gp?.model ? { model: gOpt?.efforts?.length ? `${gp.model}-${gOpt.efforts.includes(gp.effort ?? "") ? gp.effort : gOpt.efforts[0]}` : gp.model, effort: gp.effort } : gp;
    const PH = {
        gemini: `Gemini(\`agy -p …${gm?.model ? ` --model ${gm.model}` : ""}${gm?.effort ? ` --effort ${gm.effort}` : ""}\`로 generate_image)`,
        // 편집 세션 안의 ChatGPT 사진 호출은 폐지(#22-보정 2 — 사진은 앱 사진 러너만). 편집 중 사진 칸은 재고 또는 Gemini
        chatgpt: `재고(search_assets)`,
    };
    const other = r.design.find(a => a !== self);
    const photo = r.photo.length === 0 ? "사진: 새로 만들지 말 것(재고 search_assets만)"
        : r.photo.length > 1 ? `사진: ${r.photo.map(a => PH[a]).join(" 와 ")} 각각 한 장씩 만들어 비교(둘 다 materials/에 저장하고 어느 쪽을 넣었는지 답에 적기)`
            : `사진: ${PH[r.photo[0]]}로만`;
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
        s = { tool, ai: tool === "claude" ? "claude" : "chatgpt", sessionId: prev, busy: false, queue: [], lastAt: Date.now(), out: [], verifyN: 0, fixups: 0 };
        sessions.set(key, s);
    }
    if (route?.design?.[0] && route.design[0] !== s.ai)
        s.out.push({ role: "event", text: `${AI_LABEL[route.design[0]]}가 연결돼 있지 않아 ${AI_LABEL[s.ai]}가 맡아요`, payload: { kind: "error", ai: "dynapse" } });
    if (route?.design?.length)
        await wput(id, ".dynapse/team.json", JSON.stringify(teamToFile({ merge: route.design[0], design: route.design, photo: route.photo, chosen: null }), null, 2)).catch(() => { }); // AI 줄(#16B) → team.json
    const pick = route?.models?.[s.ai];
    // 작업에서 안 고르면 홈 AI 카드의 기본 모델(#21 보정 12)
    s.model = pick?.model || S.defaultModels[s.ai] || null;
    s.effort = pick?.effort || null;
    s.capLeft = opts.capLeft ?? null;
    // [승인]·[건너뛰기] 답(#22-보정 3) — 승인이면 막힌 도구를 이 세션에 한 번 더 허용하고 이어서
    if (s.pendingAllow?.length && /: (승인|건너뛰기)$/.test(text)) {
        const allow = /: 승인$/.test(text);
        if (allow)
            s.extraAllow = [...new Set([...(s.extraAllow ?? []), ...s.pendingAllow])];
        s.pendingAllow = [];
        text = allow ? "방금 막힌 명령을 다시 실행해서 이어가." : "그 명령 없이 할 수 있는 만큼 이어가.";
    }
    s.queue.push(routeLine(route, s.ai) + text);
    if (!s.busy)
        await nextTurn(id, s);
}
export function chatEvent(id, s, text, payload = {}) {
    if (!text || text === s.lastStage)
        return; // 같은 단계가 이어지면 한 줄만(대표 캡처: "작업 중" 반복)
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
            return MCP_STAGE[mcp[1]] ?? "Dynapse 도구 쓰는 중";
        if (/verify\.mjs/.test(target)) {
            s.verifyN++;
            return `검증 중(${Math.min(s.verifyN, 3)}/3)`;
        }
        if (/\.dynapse\/out\/.*\.png$/.test(target))
            return "결과 사진 보는 중";
        if (/^\s*git\s+(checkout|restore)/.test(target))
            return "되돌리는 중";
        if (/^\s*git\b/.test(target))
            return "버전 확인 중";
        if (/^\s*curl\b.*-X\s*PUT/.test(target))
            return "올리는 중";
        if (/^(ToolSearch|TodoWrite|Task|Glob|Grep|LS|WebFetch|WebSearch)$/.test(name))
            return null; // 내부 도구는 카드로 안 보인다
        if (/^\s*sleep\b/.test(target))
            return "기다리는 중";
        if (/^\s*sips\b/.test(target))
            return "사진 규격 확인 중";
        const st = stageFromTool(name, target);
        if (st === "작업 중")
            return /^(Bash|run)$/i.test(name) && target ? "명령 실행 중" : null;
        return s.verifyN > 0 && /쓰는 중/.test(st) ? "다시 고치는 중" : st;
    };
    const push = (name, target) => {
        const t = stage(name, target);
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
    if (d.type === "turn.completed" && d.usage) {
        const u = d.usage;
        s.usage = { tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.reasoning_output_tokens ?? 0) };
    }
    if (d.type === "result") {
        const u = d.usage ?? {};
        s.usage = { tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), usd: typeof d.total_cost_usd === "number" ? d.total_cost_usd : undefined };
        if (s.usage.usd && s.usage.tokens)
            s.usdPerTok = s.usage.usd / s.usage.tokens;
        // 권한으로 막힌 도구(#22-보정 3) — Claude result.permission_denials
        const den = Array.isArray(d.permission_denials) ? d.permission_denials : [];
        s.denied = [...new Set(den.map(x => x.tool_name === "Bash" && x.tool_input?.command ? `Bash(${String(x.tool_input.command).trim().split(/\s+/)[0]} *)` : String(x.tool_name ?? "")).filter(Boolean))].slice(0, 4);
        s.lastText = typeof d.result === "string" ? d.result : s.lastText;
        void endTurn(id, s, d.subtype === "success");
    }
}
export async function nextTurn(id, s) {
    const text = s.queue.shift();
    if (!text)
        return;
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
    chatEvent(id, s, "읽는 중");
    flushSoon(id, s);
    if (s.tool === "claude") {
        // 위치 참조한 폴더는 턴마다 다시 인덱스하고 Claude에 읽기 위치로 넘긴다(원본 수정 금지는 지침으로)
        const linked = await T().core.invoke("link_reindex", { id }).catch(() => []);
        const want = `${s.model ?? ""}|${s.effort ?? ""}|${budgetUsd(s) ?? ""}|${linked.join(",")}|${(s.extraAllow ?? []).join(",")}`;
        if (s.procId !== undefined && (s.token !== S.token || s.spawnedWith !== want)) {
            await T().core.invoke("run_close_stdin", { id: s.procId }).catch(() => { });
            for (let k = 0; k < 30 && s.procId !== undefined; k++)
                await new Promise(r => setTimeout(r, 100));
            s.procId = undefined;
        } // 토큰·모델·강도·예산이 바뀌면 새 인자로 다시 붙는다(--resume)
        if (s.procId === undefined) {
            s.token = S.token;
            s.spawnedWith = want;
            const budget = budgetUsd(s);
            const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--mcp-config", ".dynapse/mcp-config", "--strict-mcp-config",
                "--max-turns", String(LIMITS.maxTurns), "--allowedTools", [CHAT_TOOLS, ...(s.extraAllow ?? [])].join(" "), "--add-dir", dir, ...linked.flatMap(p => ["--add-dir", p]),
                ...(s.model ? ["--model", s.model] : []), ...(s.effort ? ["--effort", s.effort] : []), ...(budget ? ["--max-budget-usd", budget.toFixed(2)] : []),
                ...(s.sessionId ? ["--resume", s.sessionId] : [])];
            const started = spawn("claude", args, "", dir, l => { logChat(l); chatLine(id, s, l); }, pid => { s.procId = pid; }, true);
            started.then(code => {
                s.procId = undefined;
                if (s.busy)
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
            : ["exec", "--json", "--skip-git-repo-check", ...mo, "-s", "workspace-write", "-c", "sandbox_workspace_write.network_access=true", "-C", dir, "-"];
        const code = await spawn("codex", args, text, dir, l => { logChat(l); chatLine(id, s, l); }, pid => { s.procId = pid; }).catch(() => -1);
        s.procId = undefined;
        await endTurn(id, s, code === 0, code === 0 ? undefined : `Codex가 끝나지 못했어요(종료 코드 ${code})`);
    }
}
// 한 턴 끝 — 앱 독립 검증 → (실패면 같은 세션에 실패 JSON으로 한 번 더) → 통과분만 버전 커밋 → 사진·요약을 대화에
export async function endTurn(id, s, ok, why) {
    if (!s.busy)
        return;
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
        chatEvent(id, s, "검증 중 · 앱", { ai: "dynapse" });
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
        s.out.push({ role: "event", text: `${k} 토큰 · ${mmss(ms)}`, payload: { kind: "usage", ai: s.ai, tokens: s.usage.tokens, usd: s.usage.usd ?? null, ms, model: s.runModel ?? null, picked: s.model ?? null, effort: s.effort ?? null } });
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
    if (S.thumbUpload && files.some(f => f.name === ".dynapse/out/cover.png") && Date.now() - (shotAt[id] ?? 0) > 120_000)
        await http("PUT", `${HUB}/api/works/${encodeURIComponent(id)}/preview`, { file: `${dir}/.dynapse/out/cover.png`, contentType: "image/png", auth: true }).catch(() => null);
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
        .filter(x => /^result-[a-z0-9-]+\.html$/.test(x.name) || /^(materials|\.dynapse\/photos)\/[\w.-]+\.(png|jpe?g)$/i.test(x.name) || /^context\/(RULES\.md|(assets|refs)\/[^/]+)$/.test(x.name));
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
export function stageFromTool(name, target) {
    const t = target.toLowerCase(), n = name.toLowerCase();
    if (n.includes("generate_image"))
        return "사진 만드는 중 · Gemini";
    if (/(^|\s|\/)agy(\s|$)/.test(t) || t.startsWith("agy "))
        return "사진 AI에 맡기는 중";
    if (/codex\s+exec/.test(t))
        return "사진 AI에 맡기는 중";
    const file = t.split("/").pop() ?? "";
    const read = /read|view|cat|open/.test(n), write = /write|edit|replace|create|apply|patch/.test(n);
    if (file.includes("notes.md"))
        return write ? "노트 남기는 중" : "노트 읽는 중";
    if (file.includes("trace.json"))
        return "기록 정리하는 중";
    if (file.includes("brief.json") || file === "claude.md" || file === "agents.md")
        return "지시서 읽는 중";
    if (file.includes("result-cover"))
        return write ? "표지 쓰는 중" : "표지 확인하는 중";
    if (file.includes("result-body"))
        return write ? "본문 쓰는 중" : "본문 확인하는 중";
    if (file.includes("cover"))
        return read ? "표지 레이아웃 읽는 중" : "표지 쓰는 중";
    if (file.includes("body"))
        return read ? "본문 레이아웃 읽는 중" : "본문 쓰는 중";
    if (file.includes("tokens") || file.includes("recipe"))
        return "스타일 규칙 읽는 중";
    if (/\.(png|jpe?g)$/.test(file))
        return "사진 넣는 중";
    return "작업 중";
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
