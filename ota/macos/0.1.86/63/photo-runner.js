// 사진 러너 (WORKORDER #22) — 사진 작업(kind: photo)의 턴은 편집 AI 없이 앱이 결정적으로 돈다. 사진 AI(Gemini=agy · ChatGPT=codex)만 호출.
// 1 프롬프트(브리프 + 누적 수정 지시 + 규격) → 2 사진 AI 고르기(팀 순서 · 준비됨 · 오늘 한도 아님) → 3 생성(materials/photo-v⟨n⟩.png, 덮어쓰기 없음)
// → 4 L0(규격·비율, 실패면 이유를 덧붙여 최대 2회 더) → 5 바인딩·커밋·미리보기 → 6 리워드 작업이면 claim·업로드·제출을 앱이 직접(MCP) → 7 사진 AI 로고로 한 줄
// 멈추면(한도·로그인·업데이트·연결) 묻지 않고 다음 사진 AI → 이 PC 엔진(#199, 한 줄씩). "먼저 물어보기"를 켰거나 리워드면 멈춤 카드(#22-보정 3). 실패하면 claim은 놓는다. 달러 표기 없음(#22-보정)
import { restoreWaitVariant } from "./slots.js";
import { stripSlotArt } from "./art-core.js";
import { isQrSlot } from "./qr-default.js";
import { diagAuto } from "./diag.js";
import { HUB, S, T, api, http, mcp, spawn, store } from "./main.js";
import { report } from "./report.js";
import { bgDone, bgDrop, bgItems, bgOnAct, bgSet } from "./bg.js";
import { handPut, postChat, readJson, repoCommit, sessions, stopPhotos, wget, wput, readPages } from "./chat.js";
import { L, localAction, localPhotoReady, noteEngineResult, onLocalReady, sdImage } from "./engines.js";
const RT = { gemini: "agy", chatgpt: "codex", local: "local" };
const GEN_NAME = { gemini: "Gemini", chatgpt: "ChatGPT", local: "이 PC" };
const NAME = { gemini: "Gemini", chatgpt: "ChatGPT" };
// 사진 AI 최대 출력(#29 A3 실측) — Gemini(agy generate_image) 긴 변 1024 · ChatGPT(gpt-image) 1024×1024 · 1536×1024 · 1024×1536(짧은 변 1024)
const MAX_OUT = { gemini: 1024, chatgpt: 1536 };
const canMake = (ai, z) => !z || (ai === "gemini" ? Math.max(z.w, z.h) <= 1024 : Math.max(z.w, z.h) <= 1536 && Math.min(z.w, z.h) <= 1024);
const QUOTA = /\b429\b|quota|rate.?limit|RESOURCE_EXHAUSTED|usage limit|too many requests/i;
const today = () => new Date().toLocaleDateString("sv"); // 로컬 날짜(자정 기준)
export const photoLimited = (ai) => S.photoLimits[ai] === today();
export const photoReady = (ai) => (ai === "gemini" ? S.ag.installed && S.ag.loggedIn === true : S.tools.codex.installed && S.tools.codex.loggedIn !== false);
export const anyPhotoReady = () => ["gemini", "chatgpt"].some(photoReady);
async function markLimited(ai) {
    S.photoLimits[ai] = today();
    await store.set("photo_limits", S.photoLimits);
    await store.save();
}
const ASPECTS = [["1:1", 1], ["4:3", 4 / 3], ["3:4", 3 / 4], ["16:9", 16 / 9], ["9:16", 9 / 16]];
const aspectOf = (w, h) => ASPECTS.reduce((b, a) => (Math.abs(Math.log(a[1] / (w / h))) < Math.abs(Math.log(b[1] / (w / h))) ? a : b))[0];
const sizeOf = (size) => { const m = size?.match(/(\d+)\s*[x×]\s*(\d+)/); return m ? { w: +m[1], h: +m[2] } : null; };
// ChatGPT 계정에서 못 쓰는 Codex 모델(#95 A) — codex debug models엔 계정별 표시가 없어 첫 400을 기억한다(이 PC 앱 저장소). 목록·사진·편집·보조 호출 모두 이 모델을 쓰지 않는다
const UNSUP_KEY = "dyn:codex_unsupported";
export const codexUnsupported = () => { try {
    return JSON.parse(localStorage.getItem(UNSUP_KEY) ?? "[]");
}
catch {
    return [];
} };
export const codexModelOk = (slug) => !!slug && !codexUnsupported().includes(slug);
// 이 계정에서 써 볼 모델 후보(#103 B) — 지난번 성공한 것 → 앱이 감지한 목록(codex debug models, visibility list) 순. 목록이 없으면 gpt-5 계열 이름
export function codexCandidates() {
    let ok = null;
    try {
        ok = localStorage.getItem("dyn:codex_model_ok");
    }
    catch { /* */ }
    const listed = (S.models.chatgpt ?? []).map(m => m.id); // 앱이 감지한 목록(main.ts detectModels)
    return [...new Set([...(ok ? [ok] : []), ...listed, "gpt-5", "gpt-5-codex", "gpt-5-mini"])];
}
export function markCodexUnsupported(slug) { try {
    localStorage.setItem(UNSUP_KEY, JSON.stringify([...new Set([...codexUnsupported(), slug])].slice(-20)));
}
catch { /* */ } }
export const CODEX_UNSUP = /not supported when using Codex with a ChatGPT account|model[^\n]{0,60}is not supported/i;
// 사진 AI가 마지막으로 말한 실패 이유(작업별) — 멈춤 카드에 한 줄로
export const lastErr = new Map();
export const REASON = { quota: "한도에 닿았어요", login: "로그인이 풀렸어요", update: "업데이트가 필요해요", approve: "실행을 승인해 주세요", net: "연결이 끊겼어요", model: "모델 설정이 맞지 않아요" };
const LOGIN = /not logged in|login required|unauthori[sz]ed|\b401\b|please log ?in|sign in/i, UPDATE = /please (update|upgrade)|version .* (not supported|outdated)|upgrade required/i;
// 사진 AI 한 번 — 성공이면 파일, 멈추면 이유
// cont(#24 §3) — 수정이면 이전 결과에서 이어서: Gemini는 같은 대화(--conversation), ChatGPT는 이전 파일을 입력 이미지로(-i)
// 사진 턴의 모델 선택(2026-10-13 예진·희원 발견): 작업 AI 줄에서 고른 것 → 없으면 /connect(앱)의 기본 모델. 편집 턴(chat.ts)은 이미 그렇게 하는데 사진만 작업 값만 봐서 "기본"이 Codex 설정 파일의 모델로 떨어졌다
export const pickFor = (ai, route) => {
    const r = route?.models?.[ai];
    if (r?.model)
        return r;
    const d = S.defaultModels[ai === "chatgpt" ? "chatgpt" : ai];
    return d ? { model: d, effort: r?.effort ?? null } : r;
};
async function generate(ai, id, dir, file, prompt, z, pick, cont) {
    const started = Date.now() - 2000; // 파일 시각 비교 여유 2초
    let quota = false, login = false, update = false;
    const watch = (l) => { if (QUOTA.test(l))
        quota = true; if (LOGIN.test(l))
        login = true; if (UPDATE.test(l))
        update = true; };
    const why = () => (quota ? "quota" : login ? "login" : update ? "update" : "net");
    if (ai === "gemini") {
        let cid = "", status = "";
        const onLine = (l) => {
            watch(l);
            try {
                const d = JSON.parse(l);
                cid = d.result?.conversation_id ?? d.conversation_id ?? d.step_update?.conversation_id ?? cid;
                if (d.event === "result")
                    status = d.result?.status ?? "";
            }
            catch { /* 비JSON */ }
        };
        // 지시문은 영어로(대표 2026-09-27) — 브리프(내용)는 원문 그대로, 실행 지시만 영어
        const text = [prompt, `Call the generate_image tool exactly once with AspectRatio "${z ? aspectOf(z.w, z.h) : "1:1"}". Do not use any other tool and do not move files. Reply in one line when done.`].join("\n");
        const args = [...(cont?.cid ? ["--conversation", cont.cid] : []), "-p", text, "--add-dir", dir, "--mode", "accept-edits", "--output-format", "stream-json", "--print-timeout", "8m", "--effort", pick?.effort || "low", ...(pick?.model ? ["--model", pick.model] : [])];
        const code = await spawn("agy", args, "", dir, onLine, () => { }).catch(() => -1);
        // 새 결과만(#23 §2) — 이번 호출 뒤에 생긴 이미지만 고른다. 한도·로그인 판정은 결과가 없을 때만(#29 C7 — 대화 글자에 "rate limit"이 있어도 성공이면 성공)
        const r = cid && code === 0 && status === "SUCCESS" ? await T().core.invoke("agy_pick", { cid, workId: id, files: [file], w: z?.w ?? null, h: z?.h ?? null, since: started }).catch(() => null) : null;
        if (r)
            return { ok: true, model: pick?.model ?? null, trace: r.trace_hash, cid };
        return quota || login || update ? why() : "net";
    }
    // ChatGPT(codex exec) — 앱이 직접 띄운다(편집 세션의 실행 권한과 무관). 결과는 파일로만 판정
    let model = pick?.model ?? null, thread = "";
    const onLine = (l) => {
        watch(l);
        try {
            const d = JSON.parse(l);
            if (typeof d.model === "string")
                model = d.model;
            if (typeof d.thread_id === "string")
                thread = d.thread_id;
            // 실패 이유 한 줄(2026-10-08 희원 — 8초 만에 실패하는데 화면엔 "비어 있음"만) — codex의 error·turn.failed 메시지
            const em = d.type === "error" ? d.message : d.type === "turn.failed" ? d.error?.message : null;
            if (typeof em === "string" && em.trim())
                lastErr.set(id, em.trim().slice(0, 160));
        }
        catch { /* 비JSON */ }
    };
    const out = `${dir}/${file}`;
    // 파일은 앱이 가져간다(대표: 구글드라이브·문서·오디오 권한 창) — 옮기라고 하면 Codex가 생성본 위치를 찾으려 홈 전체를 뒤진다(find ~ → macOS 보호 폴더 권한 창)
    const text = `${prompt}\nGenerate exactly one ${z ? `${z.w}x${z.h}` : "1024x1024"} image with your image generation tool. Do not save, copy, move, list or search for any files and do not run shell commands — the app collects the generated image itself. Reply in one line when done.`;
    // 강도 기본 낮음 · 지침 파일 안 읽기(project_doc_max_bytes=0) · 빈 스크래치 폴더에서(#29 A5·C3 — 작업 폴더의 27KB 지침·결과 파일을 읽지 않게)
    const useModel = codexModelOk(pick?.model) ? pick.model : null; // 이 계정에서 못 쓰는 모델은 지정하지 않는다(#95 A)
    const mo = [...(useModel ? ["-m", useModel] : []), "-c", `model_reasoning_effort="${pick?.effort || "low"}"`, "-c", "project_doc_max_bytes=0"];
    // 작업 폴더 규칙(work_rel)이 허용하는 곳 — .dynapse/tmp/codex는 만들 수 없어 Codex가 바로 실패했다(0초 "연결이 끊겼어요")
    const scratch = `${dir}/.dynapse/photos`;
    await wput(id, ".dynapse/photos/README.md", "ChatGPT photo scratch — the app collects images itself\n").catch(() => { });
    // 덱 그림 기준(#196) — 고치는 이어가기가 아니면 기준 그림을 참고 이미지로(스타일만 따른다)
    const ref = !cont?.prev && cont?.styleRef ? `${dir}/${cont.styleRef}` : null;
    await spawn("codex", ["exec", "--json", "--skip-git-repo-check", ...mo, ...(cont?.prev ? ["-i", `${dir}/${cont.prev}`] : ref ? ["-i", ref] : []), "-s", "workspace-write", "-C", scratch, "-"], cont?.prev ? `Edit the attached previous image.\n${text}` : ref ? `The attached image is a style reference only — match its palette, line and figure style exactly and draw the new content described below.\n${text}` : text, scratch, onLine, () => { }).catch(() => -1);
    // 이번 세션의 생성본(~/.codex/generated_images/⟨thread⟩/, 시작 뒤 가장 새 것)을 작업 폴더로
    if (thread && (await T().core.invoke("codex_pick", { thread, workId: id, file, w: z?.w ?? null, h: z?.h ?? null, since: started }).then(() => true).catch(() => false)))
        return { ok: true, model };
    // 새 파일만 성공(#23 §2) — 존재 && PNG && 수정 시각 ≥ 시작. 같은 경로의 이전 파일을 결과로 보지 않는다
    const fresh = (await T().core.invoke("work_files", { id }).catch(() => [])).some(f => f.name === file && f.mtime >= started);
    if (fresh && (await T().core.invoke("check_png", { path: out })).png)
        return { ok: true, model };
    // ChatGPT 계정에서 못 쓰는 모델(#95 A — gpt-6.1-sol 400) — 기억하고, 모델 없이 즉시 한 번 다시. "연결이 끊겼어요"가 아니다
    if (CODEX_UNSUP.test(lastErr.get(id) ?? "")) {
        // #103 B — "모델 없음"으로 다시 돌리면 사용자 ~/.codex/config.toml의 기본 모델(같은 못 쓰는 모델일 수 있다)로 돌아 같은 400이 난다.
        // 그래서 이 계정에서 되는 모델을 **명시**해 다시(목록에서 unsupported가 아닌 첫 slug, 최대 3개). 성공한 slug는 기본으로 저장
        const bad = (lastErr.get(id) ?? "").match(/'([a-z0-9.\-]+)' model is not supported/i)?.[1] ?? useModel ?? null;
        if (bad)
            markCodexUnsupported(bad);
        lastErr.delete(id);
        const tried = new Set([...(cont?.triedModels ?? []), ...(bad ? [bad] : [])]);
        const next = codexCandidates().find(m => !tried.has(m) && codexModelOk(m));
        if (next && tried.size <= 3) {
            await postChat(id, [{ role: "event", text: `모델 ${bad ?? "기본"}은 ChatGPT 계정에서 못 써요 · ${next}로 다시 했어요`, payload: { kind: "stage", ai: "chatgpt", model_reset: bad, model_next: next } }]).catch(() => { });
            const r = await generate(ai, id, dir, file, prompt, z, { model: next, effort: pick?.effort ?? null }, { ...(cont ?? {}), triedModels: [...tried, next] });
            if (typeof r !== "string" && r.ok) {
                try {
                    localStorage.setItem("dyn:codex_model_ok", next);
                }
                catch { /* */ }
            }
            return r;
        }
        return "model";
    }
    return why();
}
// 사다리 한 칸 넘어갈 때의 한 줄(#199) — "Gemini 한도 · ChatGPT로 이어서" · "ChatGPT 로그인 풀림 · 이 PC에서 이어서"
const HOP = { quota: "한도", login: "로그인 풀림", update: "업데이트 필요", approve: "승인 대기", net: "연결 끊김", model: "모델 설정 안 맞음" };
export const hopText = (from, why, to) => `${GEN_NAME[from]} ${HOP[why]} · ${to === "local" ? "이 PC에서" : `${GEN_NAME[to]}로`} 이어서`;
// 이 PC 엔진 길(#199) — 받을 수 있나(사양·열린 티어) · 받을 크기 · 못 받으면 이유(카드의 작은 글자). 8GB·Intel Mac은 번들이 없다(pick)
export function engineWay() {
    if (localPhotoReady())
        return { ok: true, ready: true, gb: null, why: null };
    const b = L.bundle;
    if (b?.photo && !L.closed && !L.paused) {
        const bytes = b.size ?? b.files.reduce((a, f) => a + f.size, 0);
        return { ok: true, ready: false, gb: bytes ? Math.max(0.1, Math.round(bytes / 1e8) / 10) : null, why: null };
    }
    const p = L.probe;
    const why = !p ? "이 PC 사양을 아직 못 읽었어요" : p.os === "macos" && p.arch !== "aarch64" && p.arch !== "arm64" ? "Intel Mac은 이 PC 엔진을 못 돌려요" : p.ram_gb < 16 ? `메모리 ${p.ram_gb}GB라 이 PC 엔진은 못 돌려요(16GB부터)` : "이 PC에 맞는 엔진이 아직 없어요";
    return { ok: false, ready: false, gb: null, why };
}
// 아무것도 안 될 때만 카드 하나(#199 ③) — "사진을 만들 AI가 없어요" + 세 길을 비용 순으로. 누르면 그 길을 끝내고 같은 요청을 자동으로 이어서(기다리는 요청 · photo-pending)
export async function needPhotoCard(id, o) {
    const w = engineWay();
    await postChat(id, [{ role: "event", text: null, payload: { kind: "need-ai", ai: "dynapse", cap: "photo",
                ways: { chatgpt: !photoReady("chatgpt"), engine: o.engine && w.ok && !w.ready ? { gb: w.gb ?? 1.2 } : null, engine_why: o.engine && !w.ok ? w.why : null, skip: true },
                ...(o.limited?.length ? { limited: o.limited } : {}) } }]);
}
// 기다리는 칸(#199) — 카드의 길을 끝내거나 엔진이 준비되면 같은 칸들을 이어서(photo-pending = [1장]·[전부]와 같은 목록)
export const needSlots = new Map();
const needShown = new Set(), engineWait = new Set();
async function keepPending(id, reqs) {
    const prev = (await readJson(id, ".dynapse/photo-pending.json").catch(() => null)) ?? [];
    const add = reqs.map(({ page, ...x }) => ({ ...x, file: page }));
    await wput(id, ".dynapse/photo-pending.json", JSON.stringify([...add, ...prev.filter(p => !add.some(a => a.slot === p.slot && a.file === p.file))].slice(0, 12), null, 1));
}
// 엔진 받기 한 번(뒤에서 도는 줄) → 준비되면 기다리던 칸을 이 PC로. 작업마다 하나만
export function engineThen(id, route) {
    if (engineWait.has(id))
        return;
    engineWait.add(id);
    void ensureLocalPhoto(id).then(async (st) => {
        engineWait.delete(id);
        if (st === "ready") {
            needSlots.delete(id);
            await runPhotoRequests(id, route, { pending: true }).catch(() => []);
        }
        else {
            for (const it of bgItems(id).filter(x => x.kind === "photo" && x.state === "wait" && /엔진 기다림/.test(x.text)))
                bgDone(id, it.k, `사진 · ${pageWord(it.page ?? "")} · 재고 그대로`);
            await postChat(id, [{ role: "event", text: "이 PC 엔진을 받지 못했어요 · 칸은 재고로 두었어요", payload: { kind: "stage", ai: "local" } }]).catch(() => { });
        }
    }).catch(() => engineWait.delete(id));
}
// 사진 턴 하나
// 멈춤 카드(#22-보정 3) — 멈춘 AI 로고 + 이유 한 줄 + 버튼 2~3개(합치기 질문과 같은 ask 카드). 답은 다음 메시지로 온다
async function stopCard(id, ai, why) {
    const other = ai === "gemini" ? "chatgpt" : "gemini";
    // 다른 AI로 다시(대표: "Gemini 추가"는 뜻이 안 맞다) — 연결돼 있든 아니든 같은 문구. 연결 전이면 누를 때 로그인부터 하고 이어서 만든다
    const first = { id: `use:${other}`, label: `${NAME[other]}로 다시` };
    const second = why === "quota" ? { id: "later", label: "내일 다시" } : why === "login" ? { id: `login:${ai}`, label: `${NAME[ai]} 로그인` } : { id: "retry", label: "다시" };
    // Gemini 한도면 [다른 Google 계정으로](본인의 다른 계정 — 공식 로그아웃·로그인 창)
    const sw = why === "quota" && ai === "gemini" ? [{ id: "switch:gemini", label: "다른 Google 계정으로" }] : [];
    await postChat(id, [{ role: "event", text: null, payload: { kind: "ask", ai, stop: why, questions: [{ label: NAME[ai], question: `사진 ${REASON[why]}`, options: [first, ...sw, second, { id: "stop", label: "그만" }] }] } }]);
}
// 멈춤 카드의 답 — "Gemini: ChatGPT로 이어서" 같은 문장. 이어서면 그 AI로 같은 프롬프트(수정 지시로 쌓지 않는다)
export function stopAnswer(text) {
    if (/^Gemini: 다른 Google 계정으로$/.test(text))
        return { switch: "gemini" };
    if (/^리워드: 브리프대로$/.test(text))
        return { brief: true };
    if (/^리워드: /.test(text))
        return { stop: true };
    const m = text.match(/^(Gemini|ChatGPT): (.+)$/);
    if (!m)
        return null;
    const a = m[2];
    if (/로 (이어서|다시)$/.test(a))
        return { use: a.startsWith("ChatGPT") ? "chatgpt" : "gemini" };
    if (/ (추가|로그인)$/.test(a))
        return { login: a.startsWith("ChatGPT") ? "chatgpt" : "gemini" };
    if (a === "다시")
        return { retry: true };
    return { stop: true }; // 내일 다시 · 그만
}
// 피사체·무드를 바꾸는 문장(#23 §3 간단 규칙) — "강아지로 바꿔줘", "파란 톤으로 해줘", "도자기 말고", "대신 바다"
const REPLACE = /(으로|로)\s*(바꿔|바꾸|변경|해\s?줘|만들어)|말고|대신|다른\s*(사진|걸로|것으로)/;
const release0 = (c) => mcp("release_claim", { claim_nonce: c.claim_nonce }).catch(() => null);
export async function runPhotoTurn(id, text, opts) {
    const started = Date.now();
    const say = (rows) => postChat(id, rows);
    const dir = await T().core.invoke("work_dir", { id });
    // 1 프롬프트(#23 §3) — 일반 사진: 최신 문장이 주어, 이전 문장은 "이전 요청(참고)". 피사체·무드를 바꾸는 문장이면 이전 요청을 버린다.
    //   리워드: 브리프가 주어(계약), 사용자 문장은 "추가 지시"만 — 브리프와 다른 걸 바꾸려 하면 카드로 묻는다
    const st = (await readJson(id, ".dynapse/photo.json")) ?? {};
    if (!st.reqs && st.base && !opts.taskId)
        st.reqs = [st.base, ...(st.edits ?? [])];
    let claim = null;
    if (opts.taskId) {
        const c = await mcp("claim_task", { task_id: opts.taskId, work_id: id, full: true }).catch(() => null); // 이 작업 행에 nonce를(#22 보정 7)
        if (!c?.data?.claim_nonce) {
            await say([{ role: "event", text: c?.text?.slice(0, 80) || "작업을 맡지 못했어요", payload: { kind: "error", ai: "dynapse" } }]);
            return;
        }
        claim = c.data;
        const brief = claim.task.spec.prompt ?? "";
        const own = text.trim() !== brief.trim() && !/^이 리워드 작업/.test(text);
        if (!opts.resume && own && REPLACE.test(text) && !opts.briefOnly) {
            await release0(claim);
            await say([{ role: "event", text: null, payload: { kind: "ask", ai: "dynapse", stop: "brief", questions: [{ label: "리워드", question: "브리프와 달라요", options: [
                                    { id: "brief", label: "브리프대로" }, { id: `href:/works/new?kind=photo&text=${encodeURIComponent(text.slice(0, 300))}`, label: "이렇게 새 작업으로" }, { id: "stop", label: "그만" }
                                ] }] } }]);
            return;
        }
        st.base = brief || text;
        if (!opts.resume && own && !opts.briefOnly)
            st.edits = [...(st.edits ?? []), text];
    }
    else if (!opts.resume) {
        // 바꾸는 문장이면 이전 요청을 버리고 새로 — 아니면 이전은 참고로 남긴다
        st.reqs = REPLACE.test(text) || !st.reqs?.length ? [text] : [...st.reqs, text].slice(-4);
    }
    // 수정(바꾸는 문장 아님 + 이전 결과 있음)이면 이전 이미지에서 이어서 고친다(#24 §3)
    const editing = !claim && !opts.resume && (st.reqs?.length ?? 0) > 1 && !!st.last;
    await wput(id, ".dynapse/photo.json", JSON.stringify(st, null, 2));
    const z = sizeOf(claim?.task.spec.size);
    const head = claim ? [st.base, ...(st.edits?.length ? [`Additional instructions (within the brief): ${st.edits.join(" / ")}`] : [])]
        : [st.reqs?.at(-1) ?? text, ...((st.reqs?.length ?? 0) > 1 ? [`Earlier requests (for reference; the line above wins): ${st.reqs.slice(0, -1).join(" / ")}`] : [])];
    const prompt = [...head, z ? `Size: ${z.w}x${z.h}` : "", "No text, logos or watermarks."].filter(Boolean).join("\n");
    // 2 사진 AI 순서 — 팀(AI 줄) 순서, 준비됨, 오늘 한도 아님
    const order = [...new Set([...(opts.route?.photo ?? []).filter((a) => a === "gemini" || a === "chatgpt"), "gemini", "chatgpt"])];
    // 고른 AI를 먼저 실제로 시도한다(대표: Gemini를 골랐는데 ChatGPT로 만듦) — "오늘 한도" 표시는 추정이라 건너뛰는 근거로 쓰지 않는다.
    // 첫 AI(고른 것)는 표시가 있어도 시도, 대체 AI는 표시가 없을 때만. 실제로 멈추면 다음 사진 AI → 이 PC(#199 — 늘 자동, "먼저 물어보기"를 켠 경우만 멈춤 카드)
    // 대체 AI도 표시만으로 건너뛰지 않는다(10-29 — "오늘 한도" 추정 때문에 ChatGPT를 건너 이 PC로 갔다): 표시가 있으면 순서만 뒤로, 한 번은 시도
    const ready0 = opts.force ? [opts.force].filter(photoReady) : [...order.filter((a, i) => photoReady(a) && (i === 0 || !photoLimited(a))), ...order.filter((a, i) => i > 0 && photoReady(a) && photoLimited(a))];
    // 못 만드는 규격(#29 A3) — 최대 출력이 규격보다 작은 AI는 뺀다(할 수 있는 AI가 있을 때). 아무도 못 하면 한 번만 시도하고 미달이면 그대로 끝
    const able = ready0.filter(a => canMake(a, z));
    const usable = opts.force || !able.length ? ready0 : able;
    const ask = !!opts.route?.ask_switch; // "사진 AI 바꿀 땐 먼저 물어보기"(AI 줄 팝오버, 기본 꺼짐 · #199)
    const release = async () => { if (claim)
        await mcp("release_claim", { claim_nonce: claim.claim_nonce }).catch(() => null); };
    if (!usable.length && (ask || claim)) {
        const limited = order.find(a => photoReady(a) && photoLimited(a));
        if (limited)
            await stopCard(id, limited, "quota");
        else
            await needPhotoCard(id, { engine: !claim });
        await release();
        return claim ? undefined : "need";
    }
    // 3~4 생성 + L0(규격) — 실패하면 이유를 덧붙여 최대 2회 더, 한도면 다음 사진 AI로
    const files = await T().core.invoke("work_files", { id }).catch(() => []);
    const n = 1 + Math.max(0, ...files.map(f => Number(f.name.match(/^materials\/photo-v(\d+)\.png$/)?.[1] ?? 0)));
    const file = `materials/photo-v${n}.png`;
    let used = null, model = null, trace, why = "", undersized = "";
    let stopped = null;
    if (!usable.length) {
        const lim = order.find(a => photoReady(a) && photoLimited(a));
        if (lim)
            stopped = { ai: lim, why: "quota" };
    } // 오늘 한도로 빠진 AI — 이 PC로 넘어가는 줄에 이유
    for (const [i, ai] of usable.entries()) {
        if (stopped)
            await say([{ role: "event", text: hopText(stopped.ai, stopped.why, ai), payload: { kind: "stage", ai, hop: true } }]); // 한 줄 전환(#199) — 카드 없음
        else if (i === 0)
            await say([{ role: "event", text: `사진 만드는 중 · ${NAME[ai]}`, payload: { kind: "tool", ai } }]);
        bgSet(id, { k: "photo:work", kind: "photo", text: `사진 · ${NAME[ai]} 만드는 중`, state: "run", ai }); // AI 줄 칩이 돈다(#199 보정 1)
        let res = "net";
        // 재시도는 "PNG가 아님"일 때 한 번만. 규격 미달은 다시 만들어도 같다(모델 최대 출력) → 재시도 없이 최종(#29 A3)
        for (let k = 0; k < 2; k++) {
            const cont = editing ? (ai === "gemini" && st.lastAi === "gemini" && st.cid ? { cid: st.cid } : ai === "chatgpt" ? { prev: st.last } : undefined) : undefined;
            res = await generate(ai, id, dir, file, why ? `${prompt}\nProblem with the last result: ${why}` : cont?.cid ? `Edit the previous image: ${st.reqs.at(-1)}\n${prompt}` : prompt, z, pickFor(ai, opts.route), cont);
            if (typeof res === "string")
                break;
            const fit = await T().core.invoke("img_fit", { workId: id, file, w: z?.w ?? null, h: z?.h ?? null }).catch(() => null);
            if (fit && !fit.undersized)
                break;
            if (fit?.undersized) {
                undersized = `${fit.width}x${fit.height}`;
                if (!claim)
                    break;
                res = "net";
                break;
            } // 일반 사진은 미달이어도 쓴다, 리워드는 규격이 계약이라 제출하지 않는다
            why = "not a PNG";
            await say([{ role: "event", text: "확인 중 2/2", payload: { kind: "tool", ai, file } }]);
            res = "net";
        }
        if (undersized && claim) {
            await say([{ role: "event", text: `이 규격(${z?.w}×${z?.h})은 ${NAME[ai]}로 만들 수 없어요 · 최대 ${undersized}`, payload: { kind: "error", ai } }]);
            await release();
            return;
        }
        if (res && typeof res !== "string") {
            used = ai;
            model = res.model;
            trace = res.trace;
            if (S.photoLimits[ai]) {
                delete S.photoLimits[ai];
                await store.set("photo_limits", S.photoLimits);
                await store.save();
            } // 만들어졌으면 한도 표시를 지운다
            await wput(id, ".dynapse/photo.json", JSON.stringify({ ...st, last: file, lastAi: ai, ...(res.cid ? { cid: res.cid } : ai === "chatgpt" ? { cid: undefined } : {}) }, null, 2));
            break;
        }
        const stop = res;
        if (stop === "quota")
            await markLimited(ai);
        stopped = { ai, why: stop };
        if (ask)
            break; // 먼저 물어보기(#199) — 멈춤 카드로
    }
    // 이 PC 엔진(#199) — 사진 AI가 없거나 다 멈췄으면. 사양이 맞으면 처음 한 번 받고(뒤에서 도는 줄) 이어서. 리워드는 발주의 허용 AI로만
    if (!used && !claim && !ask) {
        const w = engineWay();
        if (w.ok) {
            await say([{ role: "event", text: stopped ? hopText(stopped.ai, stopped.why, "local") + (w.ready ? "" : " · 처음 한 번 2분") : `사진 AI가 없어 이 PC에서 만들어요${w.ready ? "" : " · 처음 한 번 2분"}`, payload: { kind: "stage", ai: "local", hop: true } }]);
            if ((w.ready || (await ensureLocalPhoto(id)) === "ready")) {
                bgSet(id, { k: "photo:work", kind: "photo", text: "사진 · 이 PC 만드는 중", state: "run", ai: "local" });
                const k = z ? z.w / Math.max(1, z.h) : 1, r64 = (v) => Math.max(256, Math.round(v / 64) * 64);
                const lw = k >= 1 ? 1024 : r64(1024 * k), lh = k >= 1 ? r64(1024 / k) : 1024;
                const lr = await sdImage(id, `${prompt}\nNo people's faces.`, file, lw, lh);
                void noteEngineResult(lr.ok);
                if (lr.ok) {
                    used = "local";
                    model = L.bundle?.photo?.model ?? null;
                    await wput(id, ".dynapse/photo.json", JSON.stringify({ ...st, last: file, lastAi: undefined, cid: undefined }, null, 2));
                }
            }
        }
    }
    if (used)
        bgDone(id, "photo:work", "사진 · 들어감");
    else
        bgDrop(id, "photo:work");
    if (!used) {
        if (ask || claim)
            await stopCard(id, (stopped?.ai ?? usable[0] ?? "chatgpt"), stopped?.why ?? "net");
        else
            await needPhotoCard(id, { engine: true, limited: order.filter(a => photoReady(a) && photoLimited(a)) }); // 아무것도 안 될 때만 카드 하나(#199)
        await release();
        return claim || ask ? undefined : "need";
    }
    // 5 바인딩 · 커밋 · 미리보기
    await say([{ role: "event", text: "사진 넣는 중", payload: { kind: "tool", ai: "dynapse", file } }]);
    const slots = (await readJson(id, ".dynapse/slots.json")) ?? {};
    await wput(id, ".dynapse/slots.json", JSON.stringify({ ...slots, photo: file }, null, 2));
    const sha = await repoCommit(id, text.slice(0, 200)); // 요청 1 = 커밋 1(#30) — 메시지 = 요청 원문
    const trace0 = (await readJson(id, ".dynapse/TRACE.json")) ?? {};
    await wput(id, ".dynapse/TRACE.json", JSON.stringify({ ...trace0, primary: { runtime: RT[used], model }, rounds: [...(trace0.rounds ?? []), { n: (trace0.rounds?.length ?? 0) + 1, role: "write", runtime: RT[used], model, files: [file], commit: sha }] }, null, 2));
    if (S.thumbUpload)
        await http("PUT", `${HUB}/api/works/${encodeURIComponent(id)}/preview${sha ? `?sha=${sha}` : ""}`, { file: `${dir}/${file}`, contentType: "image/png", auth: true }).catch(() => null);
    const secs = Math.round((Date.now() - started) / 1000);
    // 6 리워드 작업 — 업로드·제출을 앱이 직접
    let submitted = "";
    if (claim) {
        const up = await http("PUT", claim.upload_url, { file: `${dir}/${file}`, contentType: "image/png", auth: true }).catch(() => ({ status: 0, body: "" }));
        if (up.status !== 200) {
            await say([{ role: "event", text: "올리지 못했어요", payload: { kind: "error", ai: used, retry: true } }]);
            await release();
            return;
        }
        const provider = used === "gemini" ? "antigravity" : "codex";
        const r = await mcp("submit_work", {
            task_id: claim.task.id, work_id: id, claim_nonce: claim.claim_nonce, provider, upload_id: claim.upload_id,
            evidence: { claim_nonce: claim.claim_nonce, runtime: provider, model: model ?? `unknown-${provider}`, ...(trace ? { trace_hash: trace } : {}) },
        }).catch(() => null);
        if (!r?.data?.receipt) {
            await say([{ role: "event", text: (r?.data?.rejected ?? r?.text ?? "제출하지 못했어요").slice(0, 80), payload: { kind: "error", ai: used, retry: true } }]);
            await release();
            return;
        }
        submitted = ""; // 접수 번호는 보이지 않는다(대표: 필요 없다) — 결과는 "공개됐어요"·"검토 중" 알림으로
    }
    // 7 결과 — 사진 AI 로고로 한 줄 + 사진
    await say([
        { role: "event", text: null, payload: { kind: "photo", ai: used, file, model, commit: sha } },
        // 고른 AI 대신 다른 AI로 만들었으면 그 전환은 위에서 한 줄씩 말했다(#199 hop) — 결과 줄에 무엇으로 만들었는지
        { role: "agent", text: `사진 1장 · ${GEN_NAME[used]}${model ? ` ${model}` : ""} · ${secs}초${submitted}`, payload: { ai: used, model, summary: [`사진 1장 · ${GEN_NAME[used]}${model ? ` ${model}` : ""} · ${secs}초${submitted}`] } },
    ]);
    await api("POST", "/api/works", { id, status: "done", local_path: dir, device_id: S.deviceId }).catch(() => { });
}
// 편집 작업의 사진 칸(#29 C3) — 편집 AI는 사진을 직접 만들지 않고 .dynapse/photo-requests.json에 [{slot, brief, ratio?, ai?}]만 적는다.
// ── 사진 칸 키 = 장표 + 슬롯(#42) ── 덱은 같은 레이아웃을 여러 장에 쓰니 슬롯 이름(cover_full·series_1)만으로 바꾸면 다른 장표가 덮인다.
// 상태 파일(slots.json 키 "closing.cover_full") · TRACE children(page) · 재료 이름(materials/⟨page⟩-⟨slot⟩-vN)까지 이 키로
export const PAGE_RE = /^result-[a-z0-9-]+\.html$/;
export const pageKey = (f) => f.replace(/^result-|\.html$/g, "");
// 언어판(#100 보정 4) — 사진은 구조라 원문 장과 모든 언어판에 같이. 보는 파일이 result-x.ko.html이어도 원문 result-x.html로 맞춘다
export const basePage = (f) => f.replace(/\.[a-z]{2}\.html$/, ".html");
export async function editionsOf(id, page) {
    const b = basePage(page).replace(/\.html$/, "");
    return (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(n => n.startsWith(`${b}.`) && /\.[a-z]{2}\.html$/.test(n) && basePage(n) === `${b}.html`);
}
export const slotKey = (page, slot) => `${pageKey(page)}.${slot}`;
const SLOT_OK = /^[a-z0-9_]{1,40}$/i;
const slotEl = (slot) => new RegExp(`<(\\w+)\\b([^>]*\\bdata-slot\\s*=\\s*["']${slot}["'][^>]*)>([\\s\\S]*?)<\\/\\1>`, "i");
// AI가 칸을 <img data-slot>(닫는 태그 없음)로 만든 경우(대표 2026-10-10 "사진 요청에 장표가 없어요 · booth_photo") — 그 img가 칸이다
const slotImg = (slot) => new RegExp(`<img\\b([^>]*\\bdata-slot\\s*=\\s*["']${slot}["'][^>]*?)\\s*\\/?>`, "i");
const hasSlot = (html, slot) => slotEl(slot).test(html) || slotImg(slot).test(html);
const IMG = (file) => `<img src="${file}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block">`;
// 그 칸 안의 사진만 — 있으면 src만, 없으면 넣는다(칸 밖의 다음 사진을 건드리지 않는다)
// 사진을 바꾸면 그 칸의 "AI 예시 사진" 표시(data-sample="photo", #271 보정 1)는 빠진다 — 내 사진·재고·새로 만든 것 모두. 리워드 판의 예시 사진 생성만 keepSample
export function setSlotImg(html, slot, file, keepSample = false) {
    if (!file.trim())
        return null; // 빈 주소는 쓰지 않는다(#314 img_src_empty — 깨진 그림 표시)
    const out0a = setSlotImg0(html, slot, file);
    if (!out0a)
        return out0a;
    const out0 = stripSlotArt(out0a, slot); // 빈 사진 자리에 앱이 놓은 사물 그림(art.ts)은 사진이 오면 뺀다
    // 사진이 들어오면 그 칸의 "사용자 사진 자리" 표시(data-photo-placeholder·data-slot-empty)는 늘 뗀다(2026-10-22 — 둘이 붙어 있을 때만 떼서 카드 1·4 사진이 [data-photo-placeholder]>img{display:none}에 가려진 채 공개됐다)
    const unph = (m) => m.replace(/\s+data-photo-placeholder(?:\s*=\s*(?:"[^"]*"|'[^']*'))?/gi, "").replace(/\s+data-slot-empty(?:\s*=\s*(?:"[^"]*"|'[^']*'))?/gi, "")
        .replace(/\s+data-abstract\b(?:\s*=\s*(?:"[^"]*"|'[^']*'))?/gi, "").replace(/outline:1px solid color-mix\([^;"]*\);outline-offset:-1px;?/g, "")
        .replace(/(\sdata-photo-wait\b[^>]*?)display:none;?/i, "$1").replace(/\s+data-photo-wait\b/gi, "").replace(/\s+style=""/g, "");
    const re0 = slotEl(slot), out1 = re0.test(out0) ? out0.replace(re0, unph) : out0.replace(slotImg(slot), unph);
    // 사진을 기다리며 바꿔 둔 변형(nophoto)은 기다리는 칸이 다 차면 원래 변형으로(#294 보정 9)
    const out = restoreWaitVariant(out1);
    if (keepSample)
        return out;
    const drop = (m) => m.replace(/\s+data-sample\s*=\s*["']photo["']/gi, ""); // 칸(figure)과 그 안 사진(img) 둘 다
    const re = slotEl(slot);
    if (re.test(out))
        return out.replace(re, drop);
    return out.replace(slotImg(slot), drop);
}
const withContain = (attrs) => /\bstyle\s*=\s*["'][^"']*\bcontain\s*:/i.test(attrs) ? attrs : /\bstyle\s*=\s*"/i.test(attrs) ? attrs.replace(/\bstyle\s*=\s*"([^"]*)"/i, (_m, v) => `style="${v.trim().replace(/;?$/, ";")}contain:layout"`) : /\bstyle\s*=\s*'/i.test(attrs) ? attrs.replace(/\bstyle\s*=\s*'([^']*)'/i, (_m, v) => `style='${v.trim().replace(/;?$/, ";")}contain:layout'`) : `${attrs} style="contain:layout"`;
function setSlotImg0(html, slot, file) {
    const re = slotEl(slot);
    if (!re.test(html)) {
        const ri = slotImg(slot);
        if (!ri.test(html))
            return null;
        return html.replace(ri, (_m, attrs) => `<img${/\bsrc\s*=/i.test(attrs) ? attrs.replace(/(\bsrc\s*=\s*["'])[^"']*(["'])/i, `$1${file}$2`) : `${attrs} src="${file}"`}>`);
    }
    return html.replace(re, (_m, tag, attrs, inner) => {
        const has = /<img\b[^>]*\bsrc\s*=\s*["'][^"']*["']/i.test(inner);
        // 새로 넣는 사진(absolute·inset 0)은 그 칸을 채운다 — 칸에 위치 지정이 없으면 장 전체를 덮었다(앵커 6회차 A-2r: .photo{height:490px} 칸의 굿즈 사진이 카드 전체를 덮어 글이 가려짐). contain:layout은 칸의 배치(absolute 등)는 그대로 두고 사진의 기준만 칸으로
        return `<${tag}${has ? attrs : withContain(attrs)}>${has ? inner.replace(/(<img\b[^>]*\bsrc\s*=\s*["'])[^"']*(["'])/i, `$1${file}$2`) : `${inner}${IMG(file)}`}</${tag}>`;
    });
}
export async function resolvePage(id, slot, page, cache) {
    const pages = cache?.pages ?? (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(n => PAGE_RE.test(n));
    if (cache)
        cache.pages = pages;
    const read = async (f) => { if (cache?.html.has(f))
        return cache.html.get(f) ?? null; const h = await T().core.invoke("work_read", { id, file: f }).catch(() => null); cache?.html.set(f, h); return h; };
    const has = async (f) => { const h = await read(f); return !!h && hasSlot(h, slot); };
    if (page)
        page = basePage(page); // 언어판을 보며 눌러도 원문 장으로(#100 보정 4)
    if (page && PAGE_RE.test(page) && pages.includes(page) && (await has(page)))
        return page;
    const hits = [];
    for (const f of pages)
        if (await has(f))
            hits.push(f);
    return hits.length === 1 ? hits[0] : null;
}
// 만드는 중인 파일 이름(#151 보정 1) — 생성이 끝나기 전에 재고가 같은 vN을 쓰면 늦게 온 사진이 재고 파일을 덮는다
const inflight = new Set();
export function nextMaterial(files, page, slot, ext = "png") {
    const base = `${pageKey(page)}-${slot}`;
    const n = 1 + Math.max(0, ...[...files, ...[...inflight].map(name => ({ name }))].map(f => Number(f.name.match(new RegExp(`^materials/${base}-v(\\d+)\\.(png|jpe?g|svg)$`))?.[1] ?? 0)));
    return `materials/${base}-v${n}.${ext}`;
}
// slots.json — 예전 키(슬롯만)는 그 슬롯이 있는 첫 장표로 옮긴다(첫 읽기 때 한 번). 사진 작업의 "photo"는 그대로
export async function readSlots(id) {
    const slots = (await readJson(id, ".dynapse/slots.json")) ?? {};
    const old = Object.keys(slots).filter(k => k !== "photo" && !k.includes("."));
    if (!old.length)
        return slots;
    const pages = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(n => PAGE_RE.test(n)).sort();
    const out = Object.fromEntries(Object.entries(slots).filter(([k]) => !old.includes(k)));
    for (const k of old) {
        let pg = null;
        for (const f of pages) {
            const h = await T().core.invoke("work_read", { id, file: f }).catch(() => null);
            if (h && hasSlot(h, k)) {
                pg = f;
                break;
            }
        }
        if (pg)
            out[slotKey(pg, k)] = slots[k];
    }
    await wput(id, ".dynapse/slots.json", JSON.stringify(out, null, 2));
    return out;
}
// 사진은 들어오는 즉시 줄인다(#48 B · 앱 Rust, 모든 OS) — 긴 변 ≤ 1920, JPEG ≤ 600KB(투명이면 PNG). 이름이 .jpg로 바뀔 수 있다. 예전 앱이면 그대로
// 두 장이 동시에 끝나도 한 번에 하나씩(#51 §2 보정 — CPU 스파이크 겹침 방지)
let shrinkQ = Promise.resolve();
const shrunk = new Map(); // 이미 줄인 파일(#54 D14 — 생성 직후와 넣을 때 두 번 줄였다)
export async function shrink(id, file) {
    const k = `${id}|${file}`, done = shrunk.get(k);
    if (done)
        return done;
    const run = shrinkQ.then(() => T().core.invoke("shrink_photo", { id, file }).catch(() => file));
    shrinkQ = run.catch(() => { });
    const out = await run;
    if (shrunk.size > 500)
        shrunk.clear();
    shrunk.set(k, out);
    shrunk.set(`${id}|${out}`, out);
    return out;
}
let loadMemo = null;
// 동시 수(#51 §2 보정) — 설정 photo_parallel(1|2, 기본 2) · 2는 여유 메모리 ≥ 2GB · CPU < 70%일 때만. 예전 네이티브(명령 없음)는 지금처럼 2
async function photoConc(total) {
    if (total < 2)
        return { n: 1, busy: false };
    const pref = await store.get("photo_parallel").catch(() => null);
    if (pref === 1)
        return { n: 1, busy: false };
    // 부하 측정은 CPU를 1초 재므로 30초 기억(#54 D14)
    const l = loadMemo && Date.now() - loadMemo.at < 30_000 ? loadMemo.v : await T().core.invoke("machine_load").catch(() => undefined);
    loadMemo = { at: Date.now(), v: l };
    if (l === undefined)
        return { n: 2, busy: false };
    const ok = !!l && l.free_mb >= 2048 && l.cpu < 70;
    return { n: ok ? 2 : 1, busy: !ok };
}
const sameCell = (c, page, slot) => c.slot === slot && (c.page ? c.page === page : true);
// 사진 요청 꼴 맞추기(#194 — BizCrush 아이콘 6개가 {file, selector:"… svg[data-illustration]", note}로 와서 첫 거르기에서 말없이 사라졌다).
// note → brief · slot 없이 selector면 그 요소를 figure[data-slot]로 바꾼다(상자 크기 유지·SVG는 버림) · 아이콘 크기(SVG·160px 이하)는 1:1 "flat icon, no background".
// 그래도 못 쓰는 줄은 이유와 함께 돌려준다(말없이 버리지 않는다). 파일을 고쳐 쓴다(같은 요청을 다시 맞추지 않게)
export const PHOTO_SCHEMA = '[{"file":"result-….html","slot":"<data-slot of a figure on that page>","brief":"what the photo shows","ratio":"16:9|4:3|1:1|3:4 (optional)"}]';
export async function normalizePhotoRequests(id, file0 = ".dynapse/photo-requests.json") {
    const raw = await readJson(id, file0).catch(() => null);
    if (!Array.isArray(raw) || !raw.length)
        return { ok: 0, bad: [], converted: 0 };
    const out = [], bad = [];
    let converted = 0;
    const pages = new Map();
    for (const r0 of raw.slice(0, 20)) {
        if (!r0 || typeof r0 !== "object") {
            bad.push({ why: "꼴이 아님" });
            continue;
        }
        const r = { ...r0, brief: String(r0.brief ?? r0.note ?? "").trim() };
        delete r.note;
        if (!r.brief) {
            bad.push({ why: "무엇을 그릴지(brief) 없음" });
            continue;
        }
        if (!r.slot && r.selector && r.file && PAGE_RE.test(r.file)) {
            const h0 = pages.get(r.file) ?? (await wget(id, r.file).catch(() => null)) ?? "";
            const cv = slotFromSelector(h0, r.selector);
            if (!cv) {
                bad.push({ why: `요소를 찾지 못함(${r.selector.slice(0, 40)})` });
                continue;
            }
            pages.set(r.file, cv.html);
            r.slot = cv.slot;
            converted++;
            if (cv.icon) {
                r.ratio = "1:1";
                if (!/flat icon/i.test(r.brief))
                    r.brief = `flat icon, no background, ${r.brief}`;
            }
            delete r.selector;
        }
        if (!r.slot || !SLOT_OK.test(r.slot)) {
            bad.push({ why: r.selector ? "요소를 칸으로 못 바꿈" : "칸(slot) 없음" });
            continue;
        }
        out.push(r);
    }
    for (const [f, h] of pages)
        await wput(id, f, h).catch(() => { });
    await wput(id, file0, JSON.stringify(out, null, 1) + "\n").catch(() => { });
    return { ok: out.length, bad, converted };
}
// selector가 가리키는 요소 → <figure data-slot="illus_N" data-kind="photo"> — 원문에서 같은 태그의 n번째를 찾아 그 범위만 바꾼다(문서 전체를 다시 쓰지 않는다)
function slotFromSelector(html, selector) {
    if (typeof DOMParser === "undefined")
        return null;
    const doc = new DOMParser().parseFromString(html, "text/html");
    let el = null;
    try {
        el = doc.querySelector(selector);
    }
    catch {
        el = null;
    }
    if (!el || el.closest("figure[data-slot]"))
        return null;
    const tag = el.tagName.toLowerCase(), nth = Array.from(doc.getElementsByTagName(tag)).indexOf(el);
    if (nth < 0)
        return null;
    // 원문에서 n번째 <tag 시작 → 같은 이름 깊이로 짝 닫기
    const open = new RegExp(`<${tag}\\b`, "gi");
    let m = null, k = -1;
    while ((m = open.exec(html)) && ++k < nth) { /* n번째까지 */ }
    if (!m || k !== nth)
        return null;
    const start = m.index, any = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, "gi");
    any.lastIndex = start;
    let depth = 0, end = -1, t;
    while ((t = any.exec(html))) {
        if (t[1]) {
            depth--;
            if (depth === 0) {
                end = t.index + t[0].length;
                break;
            }
        }
        else if (!t[2])
            depth++;
        else if (depth === 0) {
            end = t.index + t[0].length;
            break;
        }
    }
    if (end < 0)
        return null;
    const w = Number(el.getAttribute("width")) || 0, h = Number(el.getAttribute("height")) || 0, vb = (el.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
    const icon = tag === "svg" || (Math.max(w, h) > 0 && Math.max(w, h) <= 160);
    const W = w || (icon ? 64 : 0), H = h || (icon && vb.length === 4 && vb[2] > 0 ? Math.round(64 * vb[3] / vb[2]) : icon ? 64 : 0);
    const used = new Set(Array.from(doc.querySelectorAll("[data-slot]")).map(e => e.getAttribute("data-slot")));
    let n = 1;
    while (used.has(`illus_${n}`))
        n++;
    const slot = `illus_${n}`, cls = el.getAttribute("class"), style = [el.getAttribute("style") ?? "", W && H ? `width:${W}px;height:${H}px` : ""].filter(Boolean).join(";");
    const fig = `<figure data-slot="${slot}" data-kind="photo"${cls ? ` class="${cls}"` : ""}${style ? ` style="${style}"` : ""}><img src="" alt=""></figure>`;
    return { html: html.slice(0, start) + fig + html.slice(end), slot, icon };
}
// 커밋하지 않는다(#30 — 요청 1 = 커밋 1: 편집 턴의 끝에서 한 번). 쓴 사진 AI를 돌려준다(스레드 항목의 아이콘)
// 사진 개수(#48 C · #49 B) — 요청한 칸은 앱이 끝까지(턴 상한 없음 — 사진 턴은 편집 AI를 안 쓴다, 작업당 ≤ 8). 첫 생성(first)은 표지 1장만 만들고
// 나머지는 .dynapse/photo-pending.json에 두었다가 사용자가 [1장]·[2장]·[전부]를 누르면(fill-photos) 그만큼. 리워드는 브리프대로 전부. 하루 상한 PHOTO_DAILY
export const PHOTO_DAILY = 40, PHOTO_MAX = 10; // 10 = 청첩장 표지 + 갤러리 9(#283 보정 1)
// 조명·시간 문구는 끝에 한 번 더(#48 D — 순서 효과 실측 1건: "어두운 톤"·"저녁"이 무시됨)
const STRICT = /(어두운|어둡게|밝은|밝게|저조도|역광|노을|황혼|새벽|아침|낮|저녁|밤|야경|dark|dim|low[- ]light|bright|sunset|dusk|dawn|morning|evening|night|golden hour)[^,.·\n]{0,24}/gi;
// 조명을 말하지 않은 요청의 기본값(#227 보정 1 A3 — 첫 화면이 노을·역광·골든아워·어두운 실내로 반복돼 AI 티가 났다): 밝은 낮·정면·사물 위주
export const LIGHT_DEFAULT = "Light: bright daylight or even indoor light, front-on, the subject clearly visible; not sunset, backlight, golden hour or a dark cinematic interior.";
export const withStrict = (brief) => { const m = [...new Set(brief.match(STRICT) ?? [])].slice(0, 3); return m.length ? `${brief}\nStrict: ${m.join("; ")}.` : `${brief}\n${LIGHT_DEFAULT}`; };
export const photoStats = new Map();
// 재고에 공유(#49-보정 1) — 켜진 작업이면 만든 사진을 한 장씩 서버 검수 대기로(사진만 · Evidence = AI·모델). 결과는 묶음 끝에 한 줄
async function shareOn(id) { return !!(await readJson(id, ".dynapse/photo-share.json").catch(() => null))?.on; }
async function contribute(id, page, slot, file, ai, model) {
    const dir = await T().core.invoke("work_dir", { id }).catch(() => null);
    if (!dir)
        return "no";
    const ct = /\.png$/i.test(file) ? "image/png" : /\.webp$/i.test(file) ? "image/webp" : "image/jpeg";
    const q = new URLSearchParams({ work: id, slot: `${pageKey(page)}.${slot}`, runtime: ai, ...(model ? { model } : {}) });
    const r = await http("POST", `${HUB}/api/photos/contribute?${q}`, { file: `${dir}/${file}`, contentType: ct, auth: true }).catch(() => null);
    try {
        const j = JSON.parse(r?.body ?? "{}");
        return j.ok ? "ok" : j.dup ? "dup" : "no";
    }
    catch {
        return "no";
    }
}
const TRUST_PAGE = /대표\s*(?:이사|인사|소개|의\s*말|약력)|CEO|창업자|founder|팀\s*소개|우리\s*팀|팀원|\bteam\b|구성원|고객\s*후기|후기|testimonial|실적|track[\s-]*record|고객사|team-people|quote-voice/i;
const PERSON = /\b(person|people|man|woman|men|women|portrait|face|founder|ceo|team|staff|employee|customer|smiling|headshot)s?\b|사람|인물|얼굴|대표|직원|팀원|고객/i;
const isTrustPage = (h) => TRUST_PAGE.test(h.match(/\bdata-(?:role|tags|layout)\s*=\s*["']([^"']+)/gi)?.join(" ") ?? "") || TRUST_PAGE.test(h.match(/<(h1|h2)\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2]?.replace(/<[^>]+>/g, "") ?? "") || /\bdata-layout\s*=\s*["'](team-people|quote-voice)["']/i.test(h);
// 사진 칸 = <figure data-slot> · data-kind="photo" · 사진 이름 접두사(chat.ts photoTally와 같은 규칙)
const PH_OPEN = /<(\w+)\b([^>]*\bdata-slot\s*=\s*["']([\w-]+)["'][^>]*)>/gi;
// data-slot 칸마다 [여는 태그, 태그, 속성, 칸 이름, 안쪽] — 닫는 태그를 깊이로 찾는다(7회차 G-1: 한 정규식으로 칸 전체를 잡으면 바깥 칸 people이 첫 </div>까지 삼켜 안쪽 person_1을 건너뛰었다 → 강사 사진 자리 하나만 표시). 빈 태그(img 등)는 예전처럼 건너뜀
export function slotTags(h) {
    const out = [];
    for (const m of h.matchAll(PH_OPEN)) {
        const tag = m[1].toLowerCase();
        if (/^(img|input|br|hr|source|meta|link)$/.test(tag))
            continue;
        const from = (m.index ?? 0) + m[0].length, re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
        let depth = 1, end = -1;
        re.lastIndex = from;
        for (let t; depth > 0 && (t = re.exec(h));) {
            depth += t[1] ? -1 : 1;
            if (!depth)
                end = t.index;
        }
        if (end >= 0)
            out.push([m[0], m[1], m[2], m[3], h.slice(from, end)]);
    }
    return out;
}
// hero는 hero · hero_image · hero_1처럼 사진 이름일 때만(6회차 G-2: 가격 글 칸 hero_value를 사진 칸으로 읽어 "사진 자리" 틀이 10,000원을 덮었다)
const PH_NAME = /^(cover_full|cover_image|body_image|closing_full|series_\d|texture|photo|hero(?=$|_(?:image|photo|img|pic|\d))|image)/;
// 빈 사진 칸 메우기(#151 ① — 완성이라 하기 전에 표지·마무리·주인공 장의 사진 칸은 채운다) — 이번 턴에 바뀐 장의 빈 사진 칸을 재고로. 신뢰 장(대표·팀·후기)은 실제 사진을 기다린다(#119 보정 15 ④)
export async function fillEmptySlots(id, pages) {
    const dir = await T().core.invoke("work_dir", { id });
    const mood = (await readJson(id, ".dynapse/brief.json").catch(() => null))?.mood ?? null; // 톤 맞춤
    const title = ((await wget(id, "result-cover.html").catch(() => null))?.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    let n = 0;
    const own = !!(await readJson(id, PHOTO_OWN_FILE).catch(() => null))?.on;
    for (const page of [...new Set(pages.map(basePage))].filter(f => PAGE_RE.test(f)).slice(0, 16)) {
        const h = await wget(id, page).catch(() => null);
        // 신뢰 장(대표·팀·강사)은 실제 사진을 기다린다 — 사용자가 사진을 넣는다고 한 작업(photo-own)이면 그 자리 표시는 한다(6회차 G-2: 강사 사진 칸 둘이 틀·안내 없는 크림 상자)
        if (!h || (isTrustPage(h) && !own))
            continue;
        const head = (h.match(/<(h1|h2)\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        // 재고 찾기 말에 그 장의 다른 글도(#294 보정 10 — 상세페이지 표지 제목 "아침한줌"은 상품 이름이라 재고 낱말에 안 걸렸다: "수제 그래놀라"·"귀리" 같은 상품 말을 같이)
        const body = (h.match(/<section\b[\s\S]*<\/section>/i)?.[0] ?? "").replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
        for (const m of slotTags(h)) {
            if (isQrSlot(m[2], m[3]) || !(m[1].toLowerCase() === "figure" || /\bdata-kind\s*=\s*["']photo["']/i.test(m[2]) || (PH_NAME.test(m[3]) && !/^(p|h[1-6]|span|li|strong|em|b|small|dd|dt)$/i.test(m[1]))) || !SLOT_OK.test(m[3]))
                continue; // 글 태그(p·h·span…)는 이름이 사진 같아도 사진 칸이 아니다   // QR 칸엔 사진을 넣지 않는다
            if (m[4].match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i)?.[1])
                continue;
            if (await stockFill(id, dir, page, m[3], [head, title, body].filter(Boolean).join(" · ") || m[3], mood).catch(() => false))
                n++;
        }
    }
    return n;
}
export const ILLUST_ASK = /일러스트|삽화|그림체|illustrat/i;
// 재고 한 장(추천 1위) → materials/⟨장⟩-⟨칸⟩-vN → 그 칸에. 우리 재고 저장소 주소만 받는다
// 이 작업에 이미 넣은 재고(TRACE children asset_id) — 한 덱의 칸끼리 같은 사진이 겹치지 않게
const usedStock = async (id) => [...new Set(((await readJson(id, ".dynapse/TRACE.json").catch(() => null))?.children ?? []).map(c => c.asset_id).filter((x) => !!x))].slice(0, 40);
// 이 작업에 이미 넣은 공개 사진(credits.json open_id — 같은 Pixabay 사진이 여러 칸에 들어가지 않게, #314)
const usedOpen = async (id) => [...new Set(((await readJson(id, ".dynapse/credits.json").catch(() => null)) ?? []).map(c => c.open_id).filter((x) => !!x))].slice(0, 40);
export { PHOTO_OWN, PHOTO_OWN_FILE, markPhotoSpot } from "./photo-own.js";
import { PHOTO_OWN_FILE, markPhotoSpot, unNophoto } from "./photo-own.js";
export async function stockFill(id, dir, page, slot, brief, mood) {
    // 아이콘 칸 — 재고 사진·색면 대신 기본 아이콘(#304 차이 목록: 빈 상자는 흔한 아이콘보다 나쁘다). 주변 낱말로 고르고 덱 강조색 · 생성 아이콘이 오면 바뀐다
    if (/(^|[_-])icons?([_-]|\d|$)/i.test(slot)) {
        const IC = await import("./icon-default.js"), lib = IC.iconsFrom((await wget(id, ".dynapse/verify.mjs").catch(() => null)) ?? ""), h = await wget(id, page).catch(() => null);
        if (lib && h) {
            const name = IC.pickIcon(IC.slotContext(h, slot), n => !!lib[n]), r = IC.fillIcon(h, slot, name, lib[name] ?? "");
            if (r.ok) {
                await wput(id, page, r.html).catch(() => { });
                report("photo", "photo.icon_default", `${page}|${slot}|${name}`);
                return true;
            }
        }
        report("photo", "photo.icon_skip", `${page}|${slot}`);
        return false;
    } // 아이콘 칸은 재고 사진·색면 없이(#304 차이 목록 — 유리 체스 말이 기능 아이콘에) · 생성·SVG 아이콘 길만
    // 사용자가 사진을 넣겠다고 했으면 재고·색면 대신 사진 자리 표시(그 장 제목을 안내 글로)
    if ((await readJson(id, PHOTO_OWN_FILE).catch(() => null))?.on && !/(^|[_-])icons?([_-]|\d|$)/i.test(slot)) {
        const h = await wget(id, page).catch(() => null);
        if (h) {
            const head = (h.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>|<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[0] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
            const no = slot.match(/(\d+)$/)?.[1], out = markPhotoSpot(unNophoto(h), slot, `사진 자리${no ? ` ${Number(no)}` : ""}${head ? ` · ${head.slice(0, 24)}` : ""}`);
            if (out !== h)
                await wput(id, page, out).catch(() => { });
            report("photo", "photo.own_spot", `${page}|${slot}`);
            return true;
        }
    }
    // 일러스트를 청한 덱에는 재고 사진을 넣지 않는다(#314 ③ — 앵커 B "귀여운 일러스트"에 결혼식·상견례 사진). 자리는 AI 그림·생성 그림 몫
    {
        const ms = (await readJson(id, ".dynapse/manuscript.json").catch(() => null))?.text ?? "";
        if (ILLUST_ASK.test(ms)) {
            report("photo", "photo.skip_illust", `slot=${slot}`);
            return false;
        }
    }
    // 주제 낱말로(#154 ①) — 사진 프롬프트·장 제목에 덱 프레임의 about을 더해 찾는다. 맞는 재고가 없으면 서버가 공개 라이선스(제목·태그가 맞는 것)를, 그것도 없으면 abstract를 준다
    const about = (await readJson(id, ".dynapse/plan.json").catch(() => null))?.deck?.frame?.about ?? "";
    const en = await import("./art.js").then(A => A.photoWordsEn(id, brief)).catch(() => ""); // 사전 명사의 영어 이름을 앞에(서버는 영어 낱말을 먼저 쓴다)
    // 분위기 덱이면(#309 ④) 분위기 사진 낱말을 주제 낱말 뒤에 · 제외어(5개까지)는 서버가 후보에서 빼고 앱도 한 번 더 본다
    const D = await import("./mood-deco.js"), mf = await readJson(id, D.MOOD_FILE).catch(() => null), avoid = (mf?.photo?.avoid ?? []).slice(0, 5);
    const req = mf?.photo?.terms?.length ? D.moodPhotoReq(en, `${brief} ${about}`, mf.photo) : `${en ? `${en} · ` : ""}${brief} ${about}`.trim().slice(0, 300);
    const r = await mcp("recommend_assets", { slot, request: req, work_id: id, k: 1, exclude: [...await usedStock(id), ...await usedOpen(id)], fill: true, ...(mood ? { mood } : {}), ...(avoid.length ? { avoid } : {}) }); // fill — 예전 서버는 무시
    let data = {};
    try {
        data = r.data ?? JSON.parse(r.text);
    }
    catch { /* 형식 오류 */ }
    let top = data.items?.[0];
    // 틀린 주제의 사진은 넣지 않는다(#155 ① 단언) — 재고는 서버가 밝힌 맞은 낱말이 있고 그 낱말이 우리가 보낸 요청에 실제로 있어야. 공개 라이선스는 서버가 제목·태그로 확인한 것. 아니면 색면
    if (top && !top.credit && !(top.match?.length && top.match.every(w => req.toLowerCase().includes(w.toLowerCase())))) {
        report("photo", "photo.reject_unmatched", `slot=${slot} asset=${top.asset_id ?? "-"}`);
        top = undefined;
        data.abstract = true;
    }
    // 이미 다른 칸에 넣은 공개 사진(예전 서버는 open_id를 안 뺀다)은 넣지 않는다
    if (top?.credit && top.credit.open_id && (await usedOpen(id)).includes(top.credit.open_id)) {
        report("photo", "photo.reject_dup", `slot=${slot}`);
        top = undefined;
        data.abstract = true;
    }
    // 분위기 제외어가 든 사진(서버가 못 거른 공개 사진 제목 등)은 넣지 않는다
    {
        const hit = top ? D.avoidHit([top.credit?.title ?? "", ...(top.match ?? [])].join(" "), avoid) : null;
        if (hit) {
            report("photo", "photo.reject_mood", `slot=${slot} word=${hit}`);
            top = undefined;
            data.abstract = true;
        }
    }
    if (!top?.url || !/^https:\/\/[a-z0-9.-]+\.public\.blob\.vercel-storage\.com\//.test(top.url))
        return data.abstract ? abstractFill(id, page, slot) : false;
    const files = await T().core.invoke("work_files", { id }).catch(() => []);
    const file = nextMaterial(files, page, slot, /\.jpe?g(\?|$)/i.test(top.url) ? "jpg" : "png");
    const g = await http("GET", top.url, { out: `${dir}/${file}` }).catch(() => null);
    if (g?.status !== 200)
        return false;
    const placed = await placePhoto(id, page, slot, file, top.credit ? { runtime: "open", title: top.credit.title } : { runtime: "stock", ...(top.asset_id ? { asset_id: top.asset_id } : {}) });
    if (placed.length && top.credit && ["cc0", "by", "pixabay"].includes(top.credit.license))
        await addCredit(id, { ...top.credit, file: (await readSlots(id))[slotKey(page, slot)] ?? file, page, slot, at: Date.now() });
    // 분위기 덱인데 맞은 낱말에 분위기 사진 낱말이 하나도 없으면(주제로만 맞음) 한 줄 — 작업마다 한 번(#309 ④ 미리보기 경고)
    if (placed.length && mf?.photo?.terms?.length && !(top.match ?? []).some(w => mf.photo.terms.some(t => t.toLowerCase().split(/\s+/).includes(w.toLowerCase()))) && !(await readJson(id, ".dynapse/photo-mood-hint.json").catch(() => null))?.at) {
        await wput(id, ".dynapse/photo-mood-hint.json", JSON.stringify({ at: Date.now(), page, slot })).catch(() => { });
        await postChat(id, [{ role: "event", text: `${((k) => /^\d+$/.test(k) ? `${Number(k)}장` : k)(page.replace(/^result-|\.html$/g, "").split("-")[0])} 사진이 ${(mf.moods ?? []).join("·") || "이 덱"} 분위기와 다를 수 있어요 · 사진을 눌러 바꿀 수 있어요`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
    }
    return placed.length > 0;
}
// 주제가 맞는 사진이 없을 때(#154 ① — 틀린 주제의 사진은 빈 칸보다 나쁘다) — 장 바탕색 판 + 가는 테두리(그라데이션 없음). 생성 사진이 오면 늦은 교체가 바꾼다
// #274 보정 6 ③: 예전엔 강조 32% + 표면 68%를 섞은 색면이었다 — C3 Q01 표지 띠의 연한 파랑(#A7B8E5)이 이것. 사진 없는 띠가 강조색 덩어리로 보이지 않게 바탕색으로
export async function abstractFill(id, page, slot) {
    const h = stripSlotArt((await wget(id, page).catch(() => null)) ?? "", slot); // 그 자리에 놓은 사물 그림은 자리를 접거나 바꾸면 같이 뺀다(좌표가 틀어진다)
    const tok = (k) => h.match(new RegExp(`--color-semantic-${k}\\s*:\\s*(#[0-9a-f]{6})`, "i"))?.[1] ?? null;
    // 빈 사진 자리에 큰 판을 내보내지 않는다(#294 보정 9 — C3 3회차 Q34 cover-full:half 오른쪽 절반이 검은 판).
    // ① 레이아웃에 사진 없는 변형(nophoto)이 있으면 그 변형으로 — 칸은 남겨 두고(data-photo-wait) 사진이 오면 setSlotImg가 원래 변형으로 되돌린다
    const sec = h.match(/<section\b[^>]*\bclass\s*=\s*["'][^"']*\bslide\b[^>]*>/i)?.[0] ?? "", variant = sec.match(/\bdata-variant\s*=\s*["']([^"']*)["']/)?.[1] ?? "";
    const mark = (x) => x.replace(new RegExp(`(<[a-z][a-z0-9]*\\b[^>]*\\bdata-slot\\s*=\\s*["']${slot}["'])(?![^>]*data-photo-wait)`, "i"), "$1 data-photo-wait data-slot-empty");
    if (sec && variant !== "nophoto" && /\.slide\[data-variant="nophoto"\]/.test(h)) {
        const sec2 = sec.replace(/\s+data-variant(-was)?\s*=\s*["'][^"']*["']/g, "").replace(/>$/, ` data-variant="nophoto" data-variant-was="${variant}">`);
        await wput(id, page, mark(h.replace(sec, sec2)));
        report("photo", "photo.nophoto_variant", `${page}|${slot}|was=${variant || "-"}`);
        // 첫 장이 사진 없이 나가면 AI 없이 한 줄(작업마다 한 번) — 사진을 넣으면 원래 모양으로 돌아간다
        if (/^result-(01|cover)\.html$/.test(page) && !(await readJson(id, ".dynapse/photo-hint.json").catch(() => null))?.at) {
            await wput(id, ".dynapse/photo-hint.json", JSON.stringify({ at: Date.now(), page, slot })).catch(() => { });
            await postChat(id, [{ role: "event", text: "첫 장에 맞는 사진이 없어 글로 채웠어요 · 사진을 넣으려면 \"첫 장에 사진 넣어 줘\"라고 하거나 사진을 끌어 넣으세요", payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
        }
        return true;
    }
    // ①-b 사진 없는 표지 → 글자형 표지 제안(#314 ⑦ · 보정 1: 모양 규칙이라 바로 바꾸지 않는다). 첫 장이고 사진 없는 변형이 없으며 이 칸의 생성 사진을 기다리지 않으면 제안만 남긴다 —
    // 턴 끝 검사 경고(cover_type_art · 자세히에만)가 되고, 사용자가 "남은 고칠 것 고쳐"라고 하면 앱이 다시 짓는다(제목에 숫자 → cover-number, 아니면 cover-colour-giant · AI 0). 아래 처리는 그대로
    if ((await readPages(id).catch(() => null))?.[0] === page && !/^(closing|section)/.test(slot)) {
        const req = await readJson(id, ".dynapse/photo-requests.json").catch(() => null);
        if (!(Array.isArray(req) && req.some(r => r?.file === page && (!r.slot || r.slot === slot)))) {
            const form = /\d/.test((await import("./mood-deco.js")).labelOf(h)) ? "cover-number" : "cover-colour-giant";
            await wput(id, ".dynapse/cover-suggest.json", JSON.stringify({ page, slot, form, at: Date.now() })).catch(() => { });
            report("photo", "photo.cover_type_art_suggest", `${page}|${slot}|${form}`);
        }
    }
    // ② 글 뒤 장 전체 배경(*_full · hero · *_bg, 변형 없음 — 그 위에 흰 글자와 어둡게 깔기)은 진한 글자색 판(#300 ⑤ — C3 Q32 8장 대비 2.8)
    const full = /(^|_)(full|hero|bg)$/.test(slot) && !variant;
    // ③ 그 밖(글 옆 사진 자리 · 띠)은 칸을 접는다 — 숨기고 기다린다(글이 장을 채운다)
    if (!full && /(^|_)(full|hero|bg|photo|image|cover)(_?\d*)$/.test(slot)) {
        const out = mark(h).replace(new RegExp(`(<[a-z][a-z0-9]*\\b[^>]*\\bdata-slot\\s*=\\s*["']${slot}["'][^>]*?)(\\s*/?>)`, "i"), (m, a, e) => /display:none/.test(a) ? m : /\bstyle\s*=\s*"/.test(a) ? `${a.replace(/\bstyle\s*=\s*"/, 'style="display:none;')}${e}` : `${a} style="display:none"${e}`);
        if (out !== h) {
            await wput(id, page, out);
            report("photo", "photo.collapse_empty", `${page}|${slot}`);
            return true;
        }
    }
    const b = (full ? tok("text-strong") : null) ?? tok("bg-base") ?? "#ffffff", rgb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16));
    // PNG(#155 — SVG는 동기화 대상이 아니라 다른 기기·웹에서 빈 칸이었다) · 160×90 한 색(칸이 object-fit: cover로 늘린다)
    const png = await solidPng(rgb[0], rgb[1], rgb[2]).catch(() => null);
    if (!png)
        return false;
    const file = nextMaterial(await T().core.invoke("work_files", { id }).catch(() => []), page, slot, "png");
    const inv = T().core.invoke; // 바이트 본문 + 머리(네이티브 material_write)
    const ok = await inv("material_write", png, { headers: { "x-id": id, "x-path": encodeURIComponent(file) } }).then(() => true).catch(() => false);
    if (!ok || !(await placePhoto(id, page, slot, file, { runtime: "abstract" })).length)
        return false;
    if (full)
        return true;
    // 가는 테두리 — 바탕과 같은 판이 자리만 보이게(사진이 오면 placePhoto가 그 칸을 다시 쓴다)
    const h2 = await wget(id, page).catch(() => null), line = "outline:1px solid color-mix(in srgb,var(--color-semantic-text-muted,#777) 35%,transparent);outline-offset:-1px";
    if (h2) {
        const out = h2.replace(new RegExp(`(<[a-z][a-z0-9]*\\b[^>]*\\bdata-slot\\s*=\\s*["']${slot}["'][^>]*?)(\\s*/?>)`, "i"), (m, a, e) => /\bdata-abstract\b/.test(a) ? m : /\bstyle\s*=\s*"/.test(a) ? `${a.replace(/\bstyle\s*=\s*"/, `style="${line};`)} data-abstract${e}` : `${a} style="${line}" data-abstract${e}`);
        if (out !== h2)
            await wput(id, page, out);
    }
    return true;
}
export const solidPngBytes = (r, g, b) => solidPng(r, g, b, 320, 180); // 자가 점검 여정(#174 ①)의 "내 사진"
// 한 색 PNG(브라우저·node 공통 — CompressionStream "deflate" = zlib 형식, PNG IDAT 그대로)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++)
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
} return t; })();
const crc32 = (d) => { let c = 0xffffffff; for (const x of d)
    c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
async function solidPng(r, g, b, w = 160, h = 90) {
    const raw = new Uint8Array((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) {
        const o = y * (w * 3 + 1);
        for (let x = 0; x < w; x++) {
            raw[o + 1 + x * 3] = r;
            raw[o + 2 + x * 3] = g;
            raw[o + 3 + x * 3] = b;
        }
    }
    const z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
    const chunk = (type, data) => { const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer); dv.setUint32(0, data.length); out.set([...type].map(c => c.charCodeAt(0)), 4); out.set(data, 8); dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length))); return out; };
    const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
    dv.setUint32(0, w);
    dv.setUint32(4, h);
    ihdr.set([8, 2, 0, 0, 0], 8);
    const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", z), chunk("IEND", new Uint8Array(0))];
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
        out.set(p, o);
        o += p.length;
    }
    return out;
}
// 덱 단위 한 묶음(#151 보정 1 ②) — 사진 칸 전부를 한 번에(동시 2), 예산 안에 안 온 칸은 재고로 완성하고 늦게 온 사진은 뒤에서 교체. 시뮬레이터는 예산을 줄인다
// 이 PC로 한 장 — 엔진은 한 번에 하나(메모리 · 글 엔진도 끈다). 브리프는 편집 AI가 쓴 사진 요청 그대로, 톤 줄(withStrict) + 글자·사람 얼굴 없음
// 크기 = 비율에 맞춘 64의 배수(긴 변 1024). 실패 이유는 엔진 분류 그대로(av·driver·oom·run_fail)
let localQ = Promise.resolve();
async function localGen(id, page, slot, brief, ratio = "16:9") {
    const [rw, rh] = ratio.split(":").map(Number), k = rw > 0 && rh > 0 ? rw / rh : 16 / 9;
    const r64 = (v) => Math.max(256, Math.round(v / 64) * 64);
    const w = k >= 1 ? 1024 : r64(1024 * k), h = k >= 1 ? r64(1024 / k) : 1024;
    const run = localQ.catch(() => { }).then(async () => {
        const file = nextMaterial(await T().core.invoke("work_files", { id }).catch(() => []), page, slot);
        inflight.add(file);
        try {
            const r = await sdImage(id, `${withStrict(brief.trim())}\nA real photograph. No text, letters or logos. No people's faces.`, file, w, h);
            void noteEngineResult(r.ok);
            return r.ok ? { file } : { why: r.why ?? "run_fail" };
        }
        finally {
            inflight.delete(file);
        }
    });
    localQ = run;
    return run;
}
// 이 PC 사진 엔진 준비(#151 보정 3 ① — 사진 패널 [이 PC로 만들기]) — 없으면 받기(설치 사다리)를 시작하고 뒤에서 도는 줄 하나("이 PC 사진 엔진 받는 중 N%"),
// 준비되는 순간 이어서. 줄은 5% 단위로만 바뀐다(서버 호출 = 받기 한 번에 20회 이하 · 확인은 이 PC 상태만 2초 간격, 받기가 끝나거나 멈추면 그만)
export async function ensureLocalPhoto(id) {
    if (localPhotoReady())
        return "ready";
    if (!L.bundle?.photo || L.closed)
        return "none";
    const k = "engine:photo";
    await localAction(L.state?.state === "broken" ? "fix" : "start").catch(() => { });
    return await new Promise(res => {
        let last = -1, done = false;
        const fin = (r) => { if (done)
            return; done = true; clearInterval(t); bgDone(id, k, r === "ready" ? "이 PC 사진 엔진 준비됨" : "이 PC 엔진 받기가 멈췄어요 · 연결 탭에서 다시"); res(r); };
        const tick = () => {
            if (localPhotoReady())
                return fin("ready");
            const st = L.state;
            if (!st || st.state === "paused" || st.state === "broken" || st.state === "none" && last >= 0)
                return fin("fail");
            const pct = st.total ? Math.floor((st.done / st.total) * 20) * 5 : 0;
            if (pct !== last) {
                last = pct;
                bgSet(id, { k, kind: "engine", text: `이 PC 사진 엔진 받는 중 ${pct}% · 한 번만`, state: "run" });
            }
        };
        const t = setInterval(tick, 2000);
        onLocalReady(() => fin("ready"));
        tick();
    });
}
export let PHOTO_BUDGET_MS = 90_000;
export const setPhotoBudget = (ms) => { PHOTO_BUDGET_MS = Math.max(50, Math.round(ms)); };
// 그 칸의 지금 사진(없으면 "") — 늦게 온 사진은 이 값이 예산 끝 그대로일 때만 바꾼다(사용자·다음 턴이 손댔으면 두기)
export function slotSrc(html, slot) {
    const el = html.match(slotEl(slot)), im = el ? null : html.match(slotImg(slot));
    if (im)
        return im[1].match(/\bsrc\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
    return el?.[3].match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
}
// 덱 그림 스타일(#196) — 파일이 없으면 스타일 팩 규칙의 그림 줄에서. 꺼져 있으면 null
async function deckStyle(id) {
    const IS = await import("./image-style.js");
    const st = await readJson(id, IS.STYLE_FILE).catch(() => null);
    if (st?.sentence)
        return st.off ? null : st;
    const pk = IS.packSentence((await wget(id, "context/RULES.md").catch(() => null)) ?? "");
    // 스타일 팩이 없으면 분위기 사전의 그림 톤(#304 차이 목록 — 앵커 B "귀여운 일러스트" 0장 · C 글래스 아이콘 넷 중 둘이 엉뚱한 사진). 사용자가 정한 톤·첫 그림 톤은 위 파일이 먼저
    const art = pk ? "" : String((await readJson(id, ".dynapse/mood.json").catch(() => null))?.art ?? "").trim();
    if (!pk && !art)
        return null;
    const nst = pk ? { sentence: pk, medium: null, palette: [], ref: null, from: "pack", at: Date.now() } : { sentence: `Deck image style (keep every image in this deck the same): ${art}; no text, no logos.`, medium: null, palette: [], ref: null, from: "mood", at: Date.now() };
    await wput(id, IS.STYLE_FILE, JSON.stringify(nst, null, 1)).catch(() => { });
    return nst;
}
// 요청 하나의 지시 — 일러스트·아이콘이면 덱 문장을 앞에, ChatGPT엔 기준 그림. 사진·"이 그림만 다른 톤"은 그대로
export async function styledReq(id, brief, kind, own) {
    const IS = await import("./image-style.js"), k = IS.kindOf(brief, kind), st = k === "photo" || own || IS.OWN_WORDS.test(brief) ? null : await deckStyle(id);
    return { brief: st ? `${st.sentence}\n${brief}` : brief, ref: st?.ref ?? null, style: st, kind: k };
}
// 작은 분류(#196 ③) — 96px 축소본의 색 수·부드러운 변화. 웹뷰에 캔버스가 없으면 null(판정 없이 통과)
async function imageStats(id, file) {
    const g0 = globalThis;
    if (typeof g0.createImageBitmap !== "function" || typeof g0.OffscreenCanvas !== "function")
        return null;
    const url = await T().core.invoke("work_data_url", { id, file }).catch(() => null);
    if (!url)
        return null;
    const bmp = await g0.createImageBitmap(await (await fetch(url)).blob()).catch(() => null);
    if (!bmp)
        return null;
    const W = 96, H = Math.max(1, Math.round(96 * bmp.height / Math.max(1, bmp.width))), cv = new g0.OffscreenCanvas(W, H), g = cv.getContext("2d");
    if (!g)
        return null;
    g.drawImage(bmp, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data, cnt = new Map();
    let smooth = 0, pairs = 0;
    for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4, q = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
            cnt.set(q, (cnt.get(q) ?? 0) + 1);
            if (x < W - 1) {
                const j = i + 4, df = Math.abs(d[i] - d[j]) + Math.abs(d[i + 1] - d[j + 1]) + Math.abs(d[i + 2] - d[j + 2]);
                pairs++;
                if (df > 3 && df < 40)
                    smooth++;
            }
        }
    const hex = (q) => `#${[q >> 10, (q >> 5) & 31, q & 31].map(v => ((v << 3) | 4).toString(16).padStart(2, "0")).join("")}`;
    return { colors: cnt.size, smooth: smooth / Math.max(1, pairs), palette: [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([q]) => hex(q)) };
}
// 만든 뒤(#196) — 기준과 다른 그림인지(다르면 true) · 기준이 없으면 이 그림으로 덱 기준을 정한다(첫 일러스트)
export async function toneCheck(id, file, style) {
    if (!style?.medium)
        return false;
    const IS = await import("./image-style.js"), sx = await imageStats(id, file).catch(() => null);
    return !!sx && IS.classify(sx) !== style.medium;
}
export async function afterMade(id, file, kind, style, off) {
    if (kind === "photo" || off)
        return;
    const IS = await import("./image-style.js");
    if (!style && !(await readJson(id, IS.STYLE_FILE).catch(() => null))) {
        const sx = await imageStats(id, file).catch(() => null), medium = sx ? IS.classify(sx) : null, palette = sx?.palette ?? [];
        await wput(id, IS.STYLE_FILE, JSON.stringify({ sentence: IS.styleSentence(medium, palette), medium, palette, ref: file, from: "first", at: Date.now() }, null, 1)).catch(() => { });
        await postChat(id, [{ role: "event", text: "덱 그림 톤을 이 그림으로 정했어요 · 다음 그림도 이 톤으로", payload: { kind: "stage", ai: "dynapse", file } }]).catch(() => { });
    }
}
// [이 그림 톤으로 덱 통일](#196 보정 1) — 그 그림을 기준(ref)으로 다시 뽑는다
export async function rebaseStyle(id, file) {
    const IS = await import("./image-style.js"), sx = await imageStats(id, file).catch(() => null), medium = sx ? IS.classify(sx) : null, palette = sx?.palette ?? [];
    await wput(id, IS.STYLE_FILE, JSON.stringify({ sentence: IS.styleSentence(medium, palette), medium, palette, ref: file, from: "pick", at: Date.now() }, null, 1));
}
// 칸마다 마지막 brief(#196 보정 1 — 덱 톤을 바꾸면 다시 만들 때)
async function noteBrief(id, page, slot, brief, kind) {
    const m = (await readJson(id, ".dynapse/image-briefs.json").catch(() => null)) ?? {};
    m[`${page}|${slot}`] = { brief: brief.slice(0, 1200), kind };
    await wput(id, ".dynapse/image-briefs.json", JSON.stringify(m, null, 1)).catch(() => { });
}
const rewardWorks = new Set(); // 이번 실행에서 리워드 사진을 만든 작업(#271 보정 1 — 예시 사진 표시를 reward.json만으로 판단하면 리워드 옵션으로 부른 판이 표시를 잃었다)
export async function runPhotoRequests(id, route, o = {}) {
    const file0 = o.pending ? ".dynapse/photo-pending.json" : ".dynapse/photo-requests.json";
    const nz = await normalizePhotoRequests(id, file0).catch(() => ({ ok: 0, bad: [], converted: 0 })); // 꼴 맞추기(#194)
    if (nz.bad.length) {
        await postChat(id, [{ role: "event", text: `사진 요청 ${nz.bad.length}개를 쓰지 못했어요 · ${[...new Set(nz.bad.map(b => b.why))].slice(0, 2).join(" · ")}`, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
        report("photo", "photo.req_bad", `n=${nz.bad.length} why=${nz.bad[0].why.slice(0, 40)}`);
    }
    let raw = ((await readJson(id, file0)) ?? []).filter(r => r && SLOT_OK.test(r.slot ?? "") && (r.brief ?? "").trim()).slice(0, PHOTO_MAX);
    if (!raw.length)
        return [];
    if (o.reward)
        rewardWorks.add(id); // 리워드 사진 생성 중인 작업(예시 사진 표시를 둔다 — placePhoto0가 reward.json 없이도 안다)
    const batch = !!o.batch && !o.reward && !o.pending;
    // 첫 생성 = 표지 칸(cover·card-1) 요청을 맨 앞으로. 묶음이 아니면 표지 한 장만(스타일 확인 — 예전 경로)
    if (o.first)
        raw = [...raw].sort((a, b) => Number(!/result-(cover|card-1)\.html/.test(b.file ?? "")) - Number(!/result-(cover|card-1)\.html/.test(a.file ?? "")));
    const cap = Math.min(o.cap ?? (o.first && !batch ? 1 : PHOTO_MAX), PHOTO_MAX);
    // 장표 확인(#42) — 없거나 틀리면 그 슬롯이 한 장표에만 있을 때만 그 장표, 아니면 거부
    const reqs = [];
    const pc = { html: new Map() };
    // 아직 쓰지 않은 장(#214 보정 2 — 계획 턴 바로 뒤의 사진 요청은 장 턴보다 먼저 온다): 장 이름이 맞으면 받아 두고 브리프·비율만으로 만든다(materials/<장>-<칸>-v1).
    // 칸에 넣기는 그 장이 저장된 뒤(slots.json에 적어 두면 장 턴 끝·제출 전 묶기가 넣는다). "장표가 없어요" 카드는 사용자가 틀린 장 이름을 쓴 요청에만
    for (const r of raw) {
        const page = await resolvePage(id, r.slot, r.file, pc);
        if (page) {
            reqs.push({ ...r, page });
            continue;
        }
        const f = basePage(r.file ?? "");
        if (PAGE_RE.test(f) && (await wget(id, f).catch(() => null)) === null) {
            reqs.push({ ...r, page: f });
            report("photo", "photo.page_pending", `${f}|${r.slot}`);
            continue;
        }
        // 리워드 장 턴 차례(#278 ① — 대표 리워드 덱: 1/8 턴 바로 뒤 사진 요청 셋이 아직 뼈대인 장을 가리켜 "장표가 없어요" 셋): 장은 있는데 그 칸이 아직 없으면 그 장 턴을 기다린다(같은 대기 길 — 제출 전 묶기가 넣는다)
        if (PAGE_RE.test(f) && (o.reward || rewardWorks.has(id))) {
            reqs.push({ ...r, page: f });
            report("photo", "photo.slot_pending", `${f}|${r.slot}`);
            continue;
        }
        await postChat(id, [{ role: "event", text: `사진 요청에 장표가 없어요 · ${r.slot}`, payload: { kind: "error", ai: "dynapse" } }]);
    }
    // 신뢰 장은 실제 사진만(#119 보정 15 ④) — 대표·팀·후기·실적 장의 사람 사진은 만들지 않는다. 칸은 비워 두고 촬영 문구가 든 사진 요청 한 줄
    for (const r of [...reqs]) {
        const h = await wget(id, r.page).catch(() => null) ?? "";
        const trust = isTrustPage(h);
        if (!trust || !PERSON.test(r.brief ?? ""))
            continue;
        reqs.splice(reqs.indexOf(r), 1);
        await postChat(id, [{ role: "event", text: `사진 요청 · ${pageKey(r.page)} ${r.slot} — 대표·팀·후기·실적 장은 실제 사진만 써요. 2m 이상 떨어져서 망원 쪽으로, 상반신 — 가깝게 자르는 건 우리가 · 찍은 사진을 이 칸에 끌어 넣으세요`, payload: { kind: "stage", ai: "dynapse", photo_ask: { page: r.page, slot: r.slot } } }]).catch(() => { });
    }
    // 인물 금지(#217 보정 7 → 보정 10: 리워드 제출 경로만 — 사용자 청첩장 작업에선 여덟 번 막혀 회색 자리만 다시 찍혔다): 리워드의 청첩장 판·용도는 사람 사진을 만들지 않는다.
    // 칸은 "사용자 사진 자리"(종이색 판 + 작은 안내)로 두고 빈 칸으로 세지 않는다(data-slot-empty) — 사용자가 자기 사진을 넣는다
    {
        const fr = (await readJson(id, ".dynapse/format.json").catch(() => null))?.frame ?? "";
        const wed = !!o.reward && (/^print:wedding_/.test(fr) || /wedding|청첩/.test(JSON.stringify(await readJson(id, ".dynapse/plan.json").catch(() => null) ?? "").slice(0, 4000)));
        // 보정 1(#239 — 대표 2026-10-21 "넣어도 돼"): 막지 않는다. 사람 사진은 뒷모습·멀리·작은 얼굴로(닮음 위험을 줄인다) + 칸에 data-sample="photo"(작업실 줄 "예시 사진이에요 · 두 사람 사진으로 바꾸기")
        if (wed)
            for (const r of reqs) {
                if (!PERSON.test(r.brief ?? "") && !/couple|bride|groom|신랑|신부|커플|부부|웨딩 촬영/i.test(r.brief ?? ""))
                    continue;
                r.brief = `${r.brief ?? ""} — seen from behind or at a distance, faces small and not identifiable; no close-up portrait`;
                const h = await wget(id, r.page).catch(() => null);
                if (h) {
                    const out = h.replace(new RegExp(`(<[a-z][a-z0-9]*\\b[^>]*data-slot\\s*=\\s*["']${r.slot}["'])(?![^>]*data-sample)`, "i"), "$1 data-sample=\"photo\"");
                    if (out !== h)
                        await wput(id, r.page, out);
                }
                report("photo", "photo.person_sample", `${r.page}|${r.slot}`);
            }
    }
    if (!reqs.length) {
        await wput(id, file0, "[]\n");
        return [];
    }
    const usedAis = new Set();
    await wput(id, ".dynapse/photo-making.json", JSON.stringify(reqs.slice(0, cap).map(r => ({ file: r.page, slot: r.slot })))).catch(() => { }); // 만드는 중인 칸(#214 B) — 검사가 빈 칸으로 세지 않게. 끝나면 비운다
    await wput(id, file0, "[]\n"); // 한 번만(같은 요청을 다음 턴에 다시 만들지 않게)
    const today = new Date().toLocaleDateString("sv");
    const daily = (await store.get("photo_daily").catch(() => null)) ?? { d: today, n: 0 };
    if (daily.d !== today) {
        daily.d = today;
        daily.n = 0;
    }
    // 하루 상한(#63) — 계정 단위 서버 값(코호트·Plus). 리워드 사진은 상한 밖·세지 않음. 서버를 못 읽으면 이 기기의 옛 상한(40)
    const quota = o.reward ? null : await api("GET", "/api/device/photo-quota").catch(() => null);
    const server = quota?.status === 200 && !!quota.data;
    const dayLimit = o.reward ? Infinity : server ? (quota.data.limit ?? Infinity) : PHOTO_DAILY;
    const dayUsed = server ? quota.data.used : daily.n;
    const leftReqs = [];
    let stop = null;
    const dir = await T().core.invoke("work_dir", { id });
    const order = [...new Set([...(route?.photo ?? []).filter((a) => a === "gemini" || a === "chatgpt"), "gemini", "chatgpt"])].filter(photoReady);
    // 사진 AI가 없으면 막지 않는다(#142 추가 3 ⑦ · 추가 5 §2) — Claude만 있는 사람: 재고 추천(recommend_assets)으로 칸을 채우고 ChatGPT는 한 줄로만 권한다. 리워드는 재고로 채우지 않는다(생성 규격)
    // 이 PC 엔진(#151 보정 3 ②) — 사진 AI 다음. 리워드는 발주의 허용 AI로만(이 PC 아님)
    const ask = !!route?.ask_switch; // "사진 AI 바꿀 땐 먼저 물어보기"(#199) — 고른 AI만, 이 PC로 넘어가지 않는다
    const useLocal = !o.reward && !ask && localPhotoReady();
    if (!order.length && !o.reward && !useLocal) {
        // 사진 AI 0(#199 ①) — 지금은 재고·색면으로 완성. 이 PC 엔진을 받을 수 있으면 묻지 않고 받아(뒤에서 도는 줄) 끝나는 순간 그 칸들을 이 PC로 바꾼다.
        // 못 받는 PC(8GB·Intel Mac)면 카드 하나(작업마다 한 번) — [ChatGPT 로그인]·[이 PC 엔진]·[사진 없이 계속]을 누르면 같은 칸들이 이어서
        const eng = engineWay();
        let n = 0;
        for (const r of reqs.slice(0, cap))
            if (await stockFill(id, dir, r.page, r.slot, r.brief ?? "").catch(() => false))
                n++;
        await keepPending(id, reqs.slice(0, cap));
        if (eng.ok) {
            await postChat(id, [{ role: "event", text: `사진 AI가 없어 이 PC에서 만들어요 · 처음 한 번 2분${n ? ` · 그동안 재고 ${n}장` : ""}`, payload: { kind: "stage", ai: "local", hop: true, photo_soft: true } }]).catch(() => { });
            for (const r of reqs.slice(0, cap))
                bgSet(id, { k: `photo:${pageKey(r.page)}.${r.slot}`, kind: "photo", text: `사진 · ${pageWord(r.page)} · 이 PC 엔진 기다림`, state: "wait", page: r.page, slot: r.slot, wait_gen: true });
            engineThen(id, route);
        }
        else {
            if (n)
                await postChat(id, [{ role: "event", text: `사진 ${n}장을 재고로 채웠어요`, payload: { kind: "stage", ai: "dynapse", photo_soft: true } }]).catch(() => { });
            if (!needShown.has(id)) {
                needShown.add(id);
                needSlots.set(id, route);
                await needPhotoCard(id, { engine: true });
            }
            else
                needSlots.set(id, route);
        }
        report("photo", "photo.stock_fill", `n=${n}/${Math.min(cap, reqs.length)} engine=${eng.ok ? "get" : "no"}`);
        return [];
    }
    const done = [], left = [], reasons = new Set();
    let failed = null; // 한도 아닌 실패(로그인·업데이트·연결) — 끝에 이유와 다른 AI 버튼을 보여 준다
    // 사진 2장 동시(#51 §2) — 사진 AI 계정 정책상 동시 2를 넘기지 않는다. 한도·중단은 둘 다 마무리 뒤 멈춤
    const total = Math.min(cap, reqs.length), { n: CONC, busy } = await photoConc(total);
    let started = 0, regen = 0, q429 = false;
    const share = await shareOn(id), shared = { ok: 0, dup: 0, no: 0 };
    const each = [];
    // 예산이 끝난 뒤(cut) 온 사진은 넣지 않고 late에 모은다 — 끝까지 다 오면 뒤에서 한 번에 교체(#151 보정 1 ②)
    let cut = false;
    const late = [];
    const fin = new Set(), inPlace = new Set();
    // 뒤에서 도는 일(#151 보정 2) — 묶음의 칸마다 한 줄: 차례 기다림[건너뛰기] → 만드는 중[멈춤] → 들어감 / 재고로 채움 · 오면 교체. 웹 상태 점 옆 한 줄·펼침
    const bk = (r) => `photo:${pageKey(r.page)}.${r.slot}`;
    const skipped = new Set();
    // 리워드·[1장] 채우기도 같은 줄로(#155 — 리워드 사진 3장을 만드는 동안 "진행 중인지 멈춘 건지 알 수 없다")
    const track = true, made = new Set();
    if (track)
        for (const r of reqs.slice(0, cap)) {
            bgSet(id, { k: bk(r), kind: "photo", text: `사진 · ${pageWord(r.page)} · 차례 기다림`, state: "wait", act: "skip", page: r.page, slot: r.slot });
            bgOnAct(id, bk(r), a => { if (a === "skip" && !fin.has(r)) {
                skipped.add(r);
                bgDone(id, bk(r), `사진 · ${pageWord(r.page)} · 건너뜀`);
            }
            else if (a === "stop") {
                stopPhotos.add(id);
            } });
        }
    let saidLocal = false, saidCloud = false; // 한 줄 전환(#199)은 묶음에 한 번씩
    const one = async (r) => {
        if (stopPhotos.has(id) && !stop)
            stop = "중단"; // ■(#50) — 지금 장까지만, 남은 칸은 [1장]·[2장]·[전부]로
        if (skipped.has(r)) {
            left.push(r.slot);
            leftReqs.push(r);
            return;
        } // [건너뛰기](#151 보정 2) — 재고가 그 칸을 채운다
        if (started >= cap || stop) {
            left.push(r.slot);
            leftReqs.push(r);
            return;
        }
        if (dayUsed + started >= dayLimit) {
            stop = "오늘 사진 상한";
            left.push(r.slot);
            leftReqs.push(r);
            return;
        }
        const want = r.ai === "gemini" || r.ai === "chatgpt" ? r.ai : null;
        // 고른 AI → 한도면 다음 AI(대표: Gemini 한도인데 이유 없이 "비어 있음"). 오늘 한도로 표시된 AI는 뒤로
        const tryOrder0 = [...[...new Set([...(want ? [want] : []), ...order])].filter(photoReady).sort((a, b) => Number(photoLimited(a)) - Number(photoLimited(b))), ...(useLocal ? ["local"] : [])];
        const tryOrder = ask ? tryOrder0.slice(0, 1) : tryOrder0; // 먼저 물어보기(#199) — 다른 AI로 넘어가지 않고 끝의 카드로
        let hopped = false;
        if (!tryOrder.length) {
            left.push(r.slot);
            leftReqs.push(r);
            return;
        }
        const k = ++started;
        const g0 = Date.now();
        let got = null;
        const limited = [];
        let cloudDead = false; // 이 칸에서 사진 AI가 한도 아닌 이유로 멈췄다 — 이 칸은 다른 사진 AI 대신 이 PC로(다른 칸은 그대로 사진 AI부터)
        const [rw, rh] = (r.ratio ?? "16:9").split(":").map(Number);
        const ratio = rw > 0 && rh > 0 ? rw / rh : 16 / 9;
        for (const ai of tryOrder) {
            if (ai === "local") { // 사진 AI가 없거나 한도·실패 뒤 — 이 PC 엔진(한 번에 한 장)
                const from = limited[0] ?? (cloudDead ? failed?.ai : null);
                if (from && !saidLocal && !cut) {
                    saidLocal = true;
                    hopped = true;
                    void postChat(id, [{ role: "event", text: hopText(from, limited.length ? "quota" : failed?.why ?? "net", "local"), payload: { kind: "stage", ai: "local", hop: true } }]);
                } // 한 줄 전환(#199) — 묶음에 한 번
                if (!cut)
                    void postChat(id, [{ role: "event", text: `사진 ${k}/${total} · 이 PC`, payload: { kind: "tool", ai: "local", prompt: r.brief.trim() } }]);
                if (track)
                    bgSet(id, { k: bk(r), kind: "photo", text: `사진 · ${pageWord(r.page)} · 이 PC 만드는 중`, state: "run", act: "stop", page: r.page, slot: r.slot, wait_gen: cut, ai: "local" });
                const lr = await localGen(id, r.page, r.slot, r.brief, r.ratio);
                if ("file" in lr)
                    got = { ai, file: lr.file, res: { ok: true, model: L.bundle?.photo?.model ?? null } };
                else
                    reasons.add(`이 PC ${lr.why === "oom" ? "메모리 부족" : "엔진 실패"}`);
                break;
            }
            if (cloudDead)
                continue; // 사진 AI가 한도 아닌 이유로 멈췄으면 다른 사진 AI는 묻지 않고 넘어간다 — 이 PC는 그다음
            const long = MAX_OUT[ai], short = 1024;
            const z = ratio >= 1 ? { w: Math.min(long, Math.round(short * ratio)), h: Math.min(short, Math.round(long / ratio)) } : { w: Math.min(short, Math.round(long * ratio)), h: Math.min(long, Math.round(short / ratio)) };
            const file = nextMaterial(await T().core.invoke("work_files", { id }).catch(() => []), r.page, r.slot);
            if (ai === tryOrder[0] && !/-v1\.[a-z]+$/.test(file))
                regen++; // 같은 칸의 두 번째 이상 = 재생성(교체)
            if (!cut)
                void postChat(id, [{ role: "event", text: `사진 ${k}/${total} · ${NAME[ai]}${CONC > 1 ? " · 2개 동시" : busy ? " · 1개(부하)" : ""}`, payload: { kind: "tool", ai, file, prompt: `${r.brief.trim()}\nNo text, logos or watermarks.` } }]);
            inflight.add(file);
            if (track)
                bgSet(id, { k: bk(r), kind: "photo", text: `사진 · ${pageWord(r.page)} · ${NAME[ai]} 만드는 중`, state: "run", act: "stop", page: r.page, slot: r.slot, wait_gen: cut, ai });
            const sq = await styledReq(id, r.brief.trim(), r.kind, r.style === "own"); // 덱 그림 스타일(#196)
            let res = await generate(ai, id, dir, file, `${withStrict(sq.brief)}\nNo text, logos or watermarks.`, z, pickFor(ai, route), ai === "chatgpt" && sq.ref ? { styleRef: sq.ref } : undefined).finally(() => inflight.delete(file));
            let fileG = file;
            if (typeof res !== "string" && await toneCheck(id, file, sq.style)) { // 덱 톤과 다르면 한 번 다시(#196 ③)
                const f2 = nextMaterial(await T().core.invoke("work_files", { id }).catch(() => []), r.page, r.slot);
                const r2 = await generate(ai, id, dir, f2, `${withStrict(sq.brief)}\nThe last image did not match the deck style — follow the style line exactly.\nNo text, logos or watermarks.`, z, pickFor(ai, route), ai === "chatgpt" && sq.ref ? { styleRef: sq.ref } : undefined);
                if (typeof r2 !== "string") {
                    res = r2;
                    fileG = f2;
                    if (await toneCheck(id, f2, sq.style))
                        void postChat(id, [{ role: "event", text: `이 그림은 덱 톤과 달라요 · ${pageKey(r.page)} ${r.slot} · 📍 찍고 다시 만들 수 있어요`, payload: { kind: "stage", ai: "dynapse" } }]);
                }
            }
            if (typeof res === "string") {
                if (res === "quota") {
                    await markLimited(ai);
                    limited.push(ai);
                    continue;
                }
                failed ??= { ai, why: res };
                cloudDead = true;
                continue;
            }
            // 빈 그림(#217 보정 10 — 회색 한 장이 "들어왔어요"로 칸에 들어갔다): 색 8가지 이하면 받지 않고 다음 AI로
            {
                const st = await imageStats(id, fileG).catch(() => null);
                if (st && st.colors <= 8) {
                    report("photo", "photo.blank_file", `${ai} ${r.page}|${r.slot} colors=${st.colors}`);
                    continue;
                }
            }
            await noteBrief(id, r.page, r.slot, r.brief.trim(), sq.kind);
            await afterMade(id, fileG, sq.kind, sq.style, r.style === "own");
            got = { ai, file: fileG, res };
            break;
        }
        if (limited.length)
            q429 = true;
        if (!got) {
            left.push(r.slot);
            leftReqs.push(r);
            if (limited.length) {
                reasons.add(`${limited.map(a => NAME[a]).join("·")} 한도`);
                if (limited.length >= tryOrder.filter(a => a !== "local").length && !useLocal)
                    stop = "한도";
            }
            return;
        } // 모든 AI가 한도면 거기서 멈춘다
        if (cut) {
            late.push({ r, got });
            kickLate();
            return;
        } // 예산 뒤 — 지금은 재고가 그 칸에. 뒤에서 교체
        const { ai, res } = got;
        let release = () => { };
        const placingNow = new Promise(res0 => { release = res0; });
        inPlace.add(placingNow); // 예산이 이 사이에 끝나도 재고가 덮지 않게
        let file = got.file;
        try {
            file = await shrink(id, got.file);
            if (limited.length && !hopped && !saidCloud) {
                saidCloud = true;
                await postChat(id, [{ role: "event", text: hopText(limited[0], "quota", ai), payload: { kind: "stage", ai, hop: true } }]);
            } // 한 줄 전환(#199) — 묶음에 한 번
            await placePhoto(id, r.page, r.slot, file, { runtime: RT[ai], ...(ai === "local" ? { title: L.bundle?.photo?.label ?? "이 PC" } : {}), ...(res.cid ? { conversation_id: res.cid } : {}), ...(r.brief ? { brief: String(r.brief).slice(0, 400) } : {}) }); // 만든 그림의 지시문을 TRACE에(7회차 A-1 — 사람 든 장면 그림의 지시문을 찾을 길이 없었다)
        }
        finally {
            release();
            inPlace.delete(placingNow);
        }
        if (share && ai !== "local") {
            const placed = await shrink(id, got.file);
            shared[await contribute(id, r.page, r.slot, placed, ai, res.model ?? null)]++;
        }
        void postChat(id, [{ role: "event", text: `사진 · ${pageKey(r.page)} ${r.slot}`, payload: { kind: "stage", ai, file, photo_done: true } }]);
        done.push(r.slot);
        usedAis.add(ai);
        daily.n++;
        each.push(Math.round((Date.now() - g0) / 1000));
        if (track) {
            made.add(bk(r));
            bgDone(id, bk(r), `사진 · ${pageWord(r.page)} · 들어감`);
            bgOnAct(id, bk(r), null);
        }
        if (!o.reward && ai !== "local")
            void api("POST", "/api/device/photo-quota", { n: 1 }).catch(() => { }); // 이 PC 사진은 하루 상한에 세지 않는다(내 PC 자원)
    };
    const queue = [...reqs];
    // 예산 뒤 실패한 칸은 재고 그대로 — 끝난 줄로(#151 보정 2)
    let kickLate = () => { };
    const worker = async () => { for (let r = queue.shift(); r; r = queue.shift()) {
        try {
            await one(r);
        }
        finally {
            fin.add(r);
            if (!batch && !made.has(bk(r))) {
                bgDone(id, bk(r), `사진 · ${pageWord(r.page)} · 못 만듦`);
                bgOnAct(id, bk(r), null);
            }
            if (batch && cut && !late.some(x => x.r === r) && !skipped.has(r)) {
                bgDone(id, bk(r), `사진 · ${pageWord(r.page)} · 못 만듦 · 재고 그대로`);
                bgOnAct(id, bk(r), null);
            }
        }
    } };
    const all = Promise.all(Array.from({ length: CONC }, worker));
    const b0 = Date.now();
    if (batch) {
        let tm;
        cut = await Promise.race([all.then(() => false), new Promise(res => { tm = setTimeout(() => res(true), PHOTO_BUDGET_MS); })]);
        clearTimeout(tm);
        if (cut)
            await Promise.all([...inPlace]); // 예산 직전에 넣기 시작한 사진은 끝까지(재고가 덮지 않게)
    }
    else
        await all;
    // 완성 전에 빈 칸 없이(#151 ① · 보정 1 ①) — 못 만든 칸·아직 안 온 칸이 비어 있으면 재고(톤 맞춤 추천 1위)로. 이미 사진이 있는 칸(교체 요청)은 그대로
    const waiting = cut ? reqs.filter(r => !fin.has(r)) : [];
    const stocked = new Set(), atCut = new Map();
    const mood0 = batch ? (await readJson(id, ".dynapse/brief.json").catch(() => null))?.mood ?? null : null;
    if (batch)
        for (const r of [...leftReqs, ...waiting]) {
            const h0 = await wget(id, r.page).catch(() => null) ?? "";
            if (!slotSrc(h0, r.slot) && await stockFill(id, dir, r.page, r.slot, r.brief ?? "", mood0).catch(() => false))
                stocked.add(r);
            if (waiting.includes(r)) {
                atCut.set(slotKey(r.page, r.slot), slotSrc(await wget(id, r.page).catch(() => null) ?? "", r.slot));
                const run = started > 0 && !queue.includes(r); // 이미 만드는 중이면 [멈춤], 아직 차례 전이면 [건너뛰기]
                bgSet(id, { k: bk(r), kind: "photo", text: `사진 · ${pageWord(r.page)} · ${stocked.has(r) ? "재고로 채움 · 오면 교체" : "오면 교체"}`, state: run ? "run" : "wait", act: run ? "stop" : "skip", page: r.page, slot: r.slot, wait_gen: true });
            }
            else if (batch) {
                bgDone(id, bk(r), `사진 · ${pageWord(r.page)} · ${stocked.has(r) ? "재고로 채움" : "못 만듦"}`);
                bgOnAct(id, bk(r), null);
            }
        }
    if (!cut)
        await wput(id, ".dynapse/photo-making.json", "[]\n").catch(() => { }); // 다 끝났다(늦게 오는 교체가 있으면 그쪽이 끝낼 때)
    photoStats.set(id, { n: done.length, asked: total, left: 0, regen, q429, conc: CONC, busy, each_s: each, ai: [...usedAis], ...(batch ? { stock: stocked.size, late: waiting.length, budget_s: Math.round((Date.now() - b0) / 1000) } : {}) });
    await store.set("photo_daily", daily).catch(() => { });
    await store.save().catch(() => { });
    if (cut)
        void lateSwap(id, all, late, atCut, { share, daily, reward: !!o.reward, onLate: o.onLate, kick: f => { kickLate = f; }, key: x => bk(x) });
    // 못 만든·안 만든 칸은 나중에 [1장]·[2장]·[전부]로(#49 B) — 뒤에서 아직 만드는 칸은 빼고
    const prevPending = o.pending ? [] : ((await readJson(id, ".dynapse/photo-pending.json")) ?? []);
    const keep = [...leftReqs.map(({ page, ...x }) => ({ ...x, file: page })), ...prevPending.filter(p => !reqs.some(r => r.slot === p.slot && r.page === p.file))].slice(0, PHOTO_MAX);
    await wput(id, ".dynapse/photo-pending.json", JSON.stringify(keep, null, 1));
    // 사진 AI가 다 멈췄는데 이 PC 엔진은 아직 없고 받을 수 있으면(#199 ①) — 묻지 않고 받아 남은 칸을 이 PC로(지금 칸은 재고·색면 그대로)
    if (leftReqs.length && !o.reward && !ask && !useLocal && !o.pending && (q429 || failed)) {
        const eng = engineWay();
        if (eng.ok && !eng.ready) {
            await postChat(id, [{ role: "event", text: `${hopText(failed?.ai ?? order[0] ?? "chatgpt", q429 ? "quota" : failed?.why ?? "net", "local")} · 처음 한 번 2분`, payload: { kind: "stage", ai: "local", hop: true } }]).catch(() => { });
            engineThen(id, route);
        }
    }
    if (share && (shared.ok || shared.dup || shared.no))
        await postChat(id, [{ role: "event", text: `재고에 공유 · 검수 대기 ${shared.ok}${shared.dup ? ` · 중복 ${shared.dup}` : ""}${shared.no ? ` · 못 올림 ${shared.no}` : ""}`, payload: { kind: "stage", ai: "dynapse" } }]);
    if (done.length)
        await postChat(id, [{ role: "event", text: `사진 ${done.length}장이 들어왔어요`, payload: { kind: "stage", ai: [...usedAis][0] ?? "dynapse", photo_done: true } }]); // #48 D — 맞는지는 사람이 본다
    if (stop === "중단")
        stopPhotos.delete(id);
    // 묶음: 재고로 채운 칸은 "비어 있음"이 아니다. 한 줄로만 — 뒤에서 만드는 중이면 "오면 바꿔요"
    if (batch) {
        const emptyLeft = leftReqs.filter(r => !stocked.has(r));
        {
            const ps = photoStats.get(id);
            if (ps)
                ps.left = emptyLeft.length;
        }
        const fb = failed;
        if (stocked.size || waiting.length)
            await postChat(id, [{ role: "event", text: `${stocked.size ? `사진 ${stocked.size}장은 재고로 채웠어요` : "사진 칸은 그대로 두었어요"}${waiting.length ? ` · 만드는 사진 ${waiting.length}장은 오면 바꿔요` : fb ? ` · ${NAME[fb.ai]} ${REASON[fb.why]}` : ""}`, payload: { kind: "stage", ai: "dynapse", photo_soft: true, stock: stocked.size, late: waiting.length } }]).catch(() => { });
        report("photo", "photo.batch", `gen=${done.length} stock=${stocked.size} late=${waiting.length} empty=${emptyLeft.length} of=${total}`);
        left.splice(0, left.length, ...emptyLeft.map(r => r.slot));
        if (!left.length)
            return [...usedAis];
    }
    {
        const ps = photoStats.get(id);
        if (ps && !batch)
            ps.left = left.length;
    }
    // 만든 게 하나도 없고 실패 이유가 있으면 — 같은 "비어 있음" 카드를 되풀이하지 않고 이유 + [다른 AI로 다시]·[다시]·[그만](2026-10-08 희원: 누를 때마다 같은 카드만 쌓였다)
    const f = failed;
    if (!done.length && f && !stop) {
        const detail = lastErr.get(id);
        lastErr.delete(id);
        // 카드 하나(웹이 버튼을 그린다 — [다른 AI로 다시]·[로그인]·[다시]가 모두 fill-photos/login 행동이라 덱 작업에서도 그대로 동작) + 사진 패널용 신호
        // 회사(워크스페이스) 계정 401(#142 — "workspace routing discovery unauthorized")은 로그인이 풀린 게 아니다: 그 계정으로는 사진이 막혀 있다
        const ws = /workspace|routing discovery/i.test(detail ?? "");
        await postChat(id, [{ role: "event", text: ws ? `${NAME[f.ai]} 사진이 막혔어요 · 회사(워크스페이스) 계정은 사진 만들기가 막혀 있을 수 있어요 — 개인 계정으로 다시 로그인하거나 다른 길로` : `${NAME[f.ai]} 사진이 만들어지지 않았어요 · ${REASON[f.why]}${detail ? ` — ${detail}` : ""}`, payload: { kind: "photo-fill-fail", ai: f.ai, why: f.why, ...(ws ? { workspace: true } : {}), left: left.length, other: order.find(a => a !== f.ai) ?? (f.ai === "gemini" ? "chatgpt" : "gemini"), ...(detail ? { detail } : {}) } },
            { role: "event", text: null, payload: { kind: "photo-fail", ai: f.ai } }]);
        return [...usedAis];
    }
    if (left.length)
        await postChat(id, [{ role: "event", text: stop === "중단" ? `사진 칸 · 남음 ⬚${left.length}` : stop === "오늘 사진 상한" ? `오늘 ${dayLimit}장 다 썼어요 · 남은 ${left.length}장 내일` : stop ? `남은 ${left.length}장 · ${stop === "한도" ? "내일" : stop}` : `사진 칸 비어 있음${reasons.size ? ` · ${[...reasons].join(" · ")}` : ""}`,
                payload: { kind: stop && stop !== "중단" ? "photo-capped" : "photo-empty", ai: "dynapse", slots: left.slice(0, 8), choose: !stop || stop === "중단", left: left.length, ...(stop === "오늘 사진 상한" ? { daily: true, cap: dayLimit } : {}) } }]);
    return [...usedAis];
}
// 늦게 온 사진 교체(#151 보정 1 ②) — 묶음이 다 끝나면, 그 작업의 턴이 끝난 뒤(로컬 확인 2초 간격 · 최대 10분 · 서버 호출 없음) 칸이 예산 끝 그대로인 것만 바꾸고 한 번에 저장 + 한 줄(⌘Z)
async function lateSwap(id, all, late, atCut, o) {
    // 다 오면 한 번에. 도착한 줄의 [지금 교체](#151 보정 2)를 누르면 나머지를 기다리지 않고 지금 도착한 것부터
    let finished = false, force = false, wake = () => { };
    void all.catch(() => { }).finally(() => { finished = true; wake(); });
    const mark = (r) => {
        bgSet(id, { k: o.key(r), kind: "photo", text: `사진 · ${pageWord(r.page)} · 도착 · 바꾸기 전`, state: "wait", act: "swap", page: r.page, slot: r.slot, wait_gen: true });
        bgOnAct(id, o.key(r), a => { if (a === "swap") {
            force = true;
            wake();
        } });
    };
    for (const x of late)
        mark(x.r);
    o.kick(() => { const r = late.at(-1)?.r; if (r)
        mark(r); });
    for (;;) {
        if (!finished && !force)
            await new Promise(res => { wake = res; });
        force = false;
        const got0 = late.splice(0);
        if (got0.length) {
            for (let t = 0; t < 300 && sessions.get(id)?.busy; t++)
                await new Promise(r => setTimeout(r, 2000)); // 턴이 끝난 뒤(로컬 확인 2초 · 최대 10분)
            let n = 0;
            const ais = new Set();
            for (const { r, got } of got0) {
                const key = slotKey(r.page, r.slot), k = o.key(r);
                bgOnAct(id, k, null);
                if (!atCut.has(key) || slotSrc(await wget(id, r.page).catch(() => null) ?? "", r.slot) !== atCut.get(key)) {
                    bgDone(id, k, `사진 · ${pageWord(r.page)} · 손댄 칸이라 그대로`);
                    continue;
                } // 사용자·다음 턴이 손댄 칸은 두기
                const file = await shrink(id, got.file);
                if (!(await placePhoto(id, r.page, r.slot, file, { runtime: RT[got.ai], ...(got.ai === "local" ? { title: L.bundle?.photo?.label ?? "이 PC" } : {}), ...(got.res.cid ? { conversation_id: got.res.cid } : {}), ...(r.brief ? { brief: String(r.brief).slice(0, 400) } : {}) })).length) {
                    bgDone(id, k, `사진 · ${pageWord(r.page)} · 넣지 못함`);
                    continue;
                }
                if (o.share && got.ai !== "local")
                    await contribute(id, r.page, r.slot, file, got.ai, got.res.model ?? null).catch(() => "no");
                bgDrop(id, k);
                n++;
                ais.add(got.ai);
            }
            const cloud = got0.filter(x => x.got.ai !== "local").length;
            o.daily.n += cloud;
            await store.set("photo_daily", o.daily).catch(() => { });
            await store.save().catch(() => { });
            if (!o.reward && cloud)
                void api("POST", "/api/device/photo-quota", { n: cloud }).catch(() => { });
            report("photo", "photo.late", `swap=${n}/${got0.length}`);
            if (n) {
                bgSet(id, { k: `photo:late:${Date.now()}`, kind: "photo", text: `사진 ${n}장 도착해 바꿨어요 · ${S.app?.os === "windows" ? "Ctrl+Z" : "⌘Z"}`, state: "done", until: Date.now() + 10 * 60_000 });
                await o.onLate?.(n, [...ais]).catch(() => { });
            }
        }
        if (finished && !late.length)
            break;
    }
}
// 줄의 장 이름(#151 보정 2) — 표지 · 마무리 · 그 밖은 "02장"
const pageWord = (page) => { const k = pageKey(page); return /^(cover|card-1)$/.test(k) ? "표지" : /^closing$/.test(k) ? "마무리" : `${k}장`; };
// 칸 하나에 사진 하나(#29 A1 상대경로 · #31 · #42) — **그 장표 하나**의 그 칸(data-slot)만 이 파일로(img가 없으면 넣는다), slots.json·TRACE children(출처) 갱신. 커밋은 부르는 쪽이
// 같은 작업의 사진 넣기는 한 번에 하나(#51 — 2장 동시 생성이 같은 장표·slots.json·TRACE를 동시에 고쳐 쓰지 않게)
const placing = new Map();
// hand = 사용자가 그 칸을 직접 바꿈(사진 바꾸기·내 파일·버전) — 직접 수정 가드(#143 §2) 밖. 턴 뒤 사진 채우기·이 PC 채우기는 가드 안(사용자가 고른 사진을 덮지 못한다)
export function placePhoto(id, page, slot, file, source) {
    const run = (placing.get(id) ?? Promise.resolve()).catch(() => { }).then(() => placePhoto0(id, page, slot, file, source));
    placing.set(id, run);
    void run.then(pg => { if (pg.length)
        freshShotsSoon(id, pg); }).catch(() => { });
    return run;
}
// 장 HTML이 장 그림보다 새로우면 다시 그린다(#314 — 앵커 4회차 D: 검사 뒤 앱이 붙인 사진 자리 표시·글꼴이 PNG에 없었다). 턴의 사진 단계가 끝난 뒤 한 번
export async function refreshIfStale(id) {
    const files = await T().core.invoke("work_files", { id }).catch(() => []), m = new Map(files.map(f => [f.name, f.mtime]));
    const stale = files.filter(f => /^result-[a-z0-9-]+\.html$/.test(f.name)).filter(f => { const png = m.get(`.dynapse/out/${f.name.replace(/^result-|\.html$/g, "")}.png`); return png !== undefined && f.mtime > png + 1; }).map(f => f.name);
    if (stale.length) {
        freshShotsSoon(id, stale);
        report("photo", "shots.stale", `n=${stale.length}`);
    }
    return stale.length;
}
// 사진이 들어온 장은 장 그림(PNG)을 다시(#314 — 앵커 2회차 C: 턴 끝에 찍은 그림이라 나중에 들어온 사진 칸이 접힌 채 남았다). 5초 모아 한 번 · 그 작업 턴이 돌면 10초 뒤 다시(6번까지)
const shotQ = new Map();
export function freshShotsSoon(id, pages) {
    const q = shotQ.get(id);
    if (q)
        clearTimeout(q.t);
    const e = q ?? { pages: new Set(), t: setTimeout(() => { }, 0), tries: 0 };
    for (const p of pages)
        e.pages.add(p);
    const fire = async () => {
        const busy = [...sessions].some(([k, x]) => k.startsWith(`${id}|`) && x.busy);
        if (busy && e.tries++ < 6) {
            e.t = setTimeout(() => void fire(), 10_000);
            return;
        }
        shotQ.delete(id);
        const { appVerify } = await import("./chat.js");
        // 덱 한눈 그림(board.png)도 사진이 들어온 판으로(#314 — 앵커 3회차 A: 보드가 사진 전 판이라 평가자가 틀린 판을 봤다) — 장 전체 · 보드
        await appVerify(id, undefined, { noRender: false, board: true }).then(() => report("photo", "shots.fresh", `n=${e.pages.size}`)).catch(() => { });
    };
    e.t = setTimeout(() => void fire(), 5_000);
    shotQ.set(id, e);
}
async function placePhoto0(id, page0, slot, file, src0) {
    const { hand, ...source } = src0, put = hand ? handPut : wput;
    const page = basePage(page0);
    if (!PAGE_RE.test(page) || !SLOT_OK.test(slot))
        return [];
    file = await shrink(id, file); // 모든 경로(재고·내 파일·생성본)가 여기를 지난다
    const html = await T().core.invoke("work_read", { id, file: page }).catch(() => null);
    // 장이 아직 없다(#214 보정 2) — 칸 자리만 적어 둔다(slots.json·TRACE). 장 턴 끝·제출 전 묶기가 빈 칸에 넣는다
    // 리워드 장 턴 차례(#278 ①) — 장은 있지만 그 칸이 아직 없다(뼈대): 없는 장과 같이 자리만 적어 둔다(그 장 턴 뒤 묶기가 넣는다)
    const later = html !== null && rewardWorks.has(id) && !new RegExp(`\\bdata-slot\\s*=\\s*["']${slot}["']`, "i").test(html);
    if (html === null || later) {
        const sl = await readSlots(id);
        await wput(id, ".dynapse/slots.json", JSON.stringify({ ...sl, [slotKey(page, slot)]: file }, null, 2));
        const tr0 = (await readJson(id, ".dynapse/TRACE.json")) ?? {};
        await wput(id, ".dynapse/TRACE.json", JSON.stringify({ ...tr0, children: [...(tr0.children ?? []).filter(c => !sameCell(c, page, slot)), { ...source, slot, page, file }] }, null, 2));
        return [];
    }
    // 사진이 들어오면 "사용자 사진 자리" 표시를 뗀다(#217 보정 10 — 남아 있으면 자리 CSS가 사진을 가렸다)
    const keep = /^(chatgpt|gemini|codex|antigravity|agy|claude)/i.test(source.runtime) && (rewardWorks.has(id) || !!(await T().core.invoke("work_read", { id, file: ".dynapse/reward.json" }).catch(() => null))); // 리워드 예시 사진 생성은 표시를 둔다
    const out0 = html ? setSlotImg(html, slot, file, keep) : null;
    const out = out0 ? out0.replace(new RegExp(`(<[a-z][a-z0-9]*\\b[^>]*\\bdata-slot\\s*=\\s*["']${slot}["'][^>]*?)\\s+data-slot-empty(?:=["'][^"']*["'])?\\s+data-photo-placeholder=["'][^"']*["']`, "i"), "$1") : null;
    if (!out)
        return [];
    await put(id, page, out);
    const eds = []; // 언어판마다 같은 칸에 같은 사진(#100 보정 4 — 한국어판을 보며 바꿨는데 원문만 바뀌었다)
    for (const ed of await editionsOf(id, page)) {
        const h = await T().core.invoke("work_read", { id, file: ed }).catch(() => null);
        const o = h ? setSlotImg(h, slot, file, keep) : null;
        if (o && o !== h) {
            await put(id, ed, o);
            eds.push(ed);
        }
    }
    const slots = await readSlots(id);
    await wput(id, ".dynapse/slots.json", JSON.stringify({ ...slots, [slotKey(page, slot)]: file }, null, 2));
    const tr = (await readJson(id, ".dynapse/TRACE.json")) ?? {};
    await wput(id, ".dynapse/TRACE.json", JSON.stringify({ ...tr, children: [...(tr.children ?? []).filter(c => !sameCell(c, page, slot)), { ...source, slot, page, file }] }, null, 2));
    if ((await readJson(id, CREDITS).catch(() => null))?.length)
        await syncCredits(id).catch(() => { }); // 공개 라이선스 사진이 빠졌으면 출처 줄도
    return [page, ...eds];
}
const CREDITS = ".dynapse/credits.json";
const esc = (t) => t.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const CREDIT_EL = /\s*<p\b[^>]*\bdata-credits\b[^>]*>[\s\S]*?<\/p>/i;
export async function addCredit(id, c) {
    const all = ((await readJson(id, CREDITS).catch(() => null)) ?? []).filter(x => x.file !== c.file);
    await wput(id, CREDITS, JSON.stringify([...all, c].slice(-60), null, 1));
    await syncCredits(id);
}
export async function syncCredits(id) {
    const all = (await readJson(id, CREDITS).catch(() => null)) ?? [];
    const names = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name);
    const pages = names.filter(n => PAGE_RE.test(n));
    if (!pages.length)
        return;
    const order = ((await readPages(id).catch(() => null)) ?? []).filter(f => pages.includes(f));
    const closing = pages.includes("result-closing.html") ? "result-closing.html" : order.at(-1) ?? [...pages].sort().at(-1);
    const htmls = new Map();
    for (const f of pages)
        htmls.set(f, (await wget(id, f).catch(() => null)) ?? "");
    const live = all.filter(c => [...htmls.values()].some(h => h.includes(`src="${c.file}"`)));
    const lic = (c) => (c.license === "pixabay" ? "Pixabay" : c.license === "cc0" ? "CC0" : `CC ${c.license.toUpperCase()}${c.license_version ? ` ${c.license_version}` : ""}`);
    // Pixabay 사진은 출처 의무가 없지만 어디서 왔는지 같이 적는다 · "Openverse"는 그 사진이 있을 때만
    const line = live.length ? `사진 · ${live.map(c => `${esc(c.title)}${c.creator ? ` — ${esc(c.creator)}` : ""} (${lic(c)}${c.source && c.license !== "pixabay" ? `, ${esc(c.source)}` : ""})`).join(" / ")}${live.some(c => c.license !== "pixabay") ? " · Openverse" : ""}` : "";
    // 장 안에는 쓰지 않는다(#313 — 대표 마무리 장에 지운 출처 줄이 사진 받기마다 다시 들어왔다): 줄은 .dynapse/credits-line.json — 내보낼 때 끝에 "사진 출처" 한 장으로(PDF) · 웹 보기는 장 밖 접힌 줄
    await wput(id, ".dynapse/credits-line.json", JSON.stringify({ line: line.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"') })).catch(() => { });
    await stripCredits(id, [...htmls.keys(), ...(await Promise.all(pages.map(f => editionsOf(id, f)))).flat()]);
    void closing;
}
// 장에 남은 출처 줄 걷기(#313) — 받기·사진 동기화 때. 처음 걷을 때만 한 줄
export async function stripCredits(id, files) {
    const names = files ?? (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(n => /^result-[a-z0-9-]+(\.[a-z]{2})?\.html$/.test(n));
    let n = 0;
    for (const f of [...new Set(names)]) {
        const h = (await wget(id, f).catch(() => null)) ?? "";
        if (!CREDIT_EL.test(h))
            continue;
        const out = h.replace(new RegExp(CREDIT_EL.source, "gi"), "");
        if (out !== h) {
            await wput(id, f, out);
            n++;
        }
    }
    if (n && !(await readJson(id, ".dynapse/credits-placement.json").catch(() => null))?.placement) {
        await wput(id, ".dynapse/credits-placement.json", JSON.stringify({ placement: "export", at: Date.now() })).catch(() => { });
        await postChat(id, [{ role: "event", text: "사진 출처는 장 위가 아니라 내보낼 때 마지막 출처 장으로 붙여요", payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
    }
    return n;
}
// 사진 패널 [✦ Gemini] [⦾ ChatGPT] [둘 다](#31) — 그 칸 사진을 사진 AI로 1장씩(편집 AI 0). 결과는 "내 것"(materials/⟨칸⟩-vN)에 쌓이고 첫 결과를 칸에.
// edit = 한 줄 수정("더 어둡게") — 그 생성본의 같은 대화(Gemini --conversation) 또는 그 파일을 입력 이미지로(ChatGPT). 반환 = 만든 AI들(커밋·항목은 부르는 쪽)
// 주인공 시트 한 장(#304 보정 2 ②) — 칸이 아니라 파일 하나(정사각 1024). 사용자 이미지 AI 중 준비된 것 하나(ChatGPT 먼저 — 긴 변이 커서 네 자세가 덜 뭉개진다)
// 시험용(turn-sim heroAi) — 준비·한도를 바꿔 끼운 다섯 경우
export const heroAiSim = () => { const all = () => true, none = () => false; return [heroAi({ photo: ["chatgpt"] }, all, none), heroAi({ photo: ["gemini"] }, all, none), heroAi({ photo: ["chatgpt"] }, all, a => a === "chatgpt"), heroAi({ photo: ["gemini"] }, a => a !== "gemini", none), heroAi(undefined, none, none)]; };
// 주인공 그림 AI(10-29) — 작업의 사진 AI 순서(route.photo) 먼저, 그다음 chatgpt·gemini · 준비 안 된 것 빼고 · 오늘 한도 표시는 뒤로(추정이라 건너뛰지 않음)
export function heroAi(route, ready, limited) {
    const pref = [...new Set([...(route?.photo ?? []).filter((a) => a === "gemini" || a === "chatgpt"), "chatgpt", "gemini"])].filter(ready);
    return pref.find(a => !limited(a)) ?? pref[0] ?? null;
}
export async function genHeroSheet(id, prompt, route) {
    // 작업의 사진 AI 순서가 먼저(10-29 대표 — AI 줄의 사진은 ChatGPT인데 주인공 그림은 정해진 순서로 갔다) · 오늘 한도 표시는 추정이라 순서만 뒤로
    const ai = heroAi(route, photoReady, photoLimited);
    if (!ai)
        return { why: "no_ai" };
    const dir = await T().core.invoke("work_dir", { id });
    const file = nextMaterial(await T().core.invoke("work_files", { id }).catch(() => []), "hero", "sheet");
    await postChat(id, [{ role: "event", text: `주인공 그림 만드는 중 · ${NAME[ai]}`, payload: { kind: "tool", ai, file } }]);
    const res = await generate(ai, id, dir, file, prompt, { w: 1024, h: 1024 }, pickFor(ai, route));
    {
        const { tally } = await import("./report.js");
        tally("photos", typeof res !== "string");
    }
    if (typeof res === "string") {
        if (res === "quota")
            await markLimited(ai);
        return { why: res };
    }
    return { file, ai };
}
export async function genSlotPhoto(id, page, slot, ais0, brief, ratio = "16:9", edit, route, opt) {
    // 이 PC(#151 보정 3 ①) — 사진 패널 [이 PC로 만들기]. 엔진이 없으면 부르는 쪽(genPhoto)이 먼저 받는다. 결과 라벨 "이 PC · 로컬"
    if (ais0.includes("local")) {
        if (!localPhotoReady())
            return { ais: [], files: [] };
        await postChat(id, [{ role: "event", text: "사진 만드는 중 · 이 PC", payload: { kind: "tool", ai: "local" } }]);
        const lr = await localGen(id, page, slot, brief, ratio);
        {
            const { tally } = await import("./report.js");
            tally("photos", "file" in lr);
        }
        if (!("file" in lr)) {
            await postChat(id, [{ role: "event", text: lr.why === "oom" ? "이 PC 메모리로는 사진을 만들지 못했어요 · 다른 앱을 닫고 다시" : lr.why === "av" ? "보안 프로그램이 이 PC 엔진을 막았어요" : lr.why === "driver" ? "그래픽 드라이버를 업데이트하면 이 PC로 사진을 만들어요" : "이 PC로 사진을 만들지 못했어요 · 다시 눌러 주세요", payload: { kind: "error", ai: "local" } }]);
            return { ais: [], files: [] };
        }
        const fileS = await shrink(id, lr.file);
        await placePhoto(id, page, slot, fileS, { runtime: "local", title: L.bundle?.photo?.label ?? "이 PC", hand: true });
        return { ais: ["local"], files: [fileS] };
    }
    const ais = ais0.filter((a) => a !== "local");
    const dir = await T().core.invoke("work_dir", { id });
    const [rw, rh] = ratio.split(":").map(Number);
    const k = rw > 0 && rh > 0 ? rw / rh : 16 / 9;
    const made = [], files = [];
    const tr = (await readJson(id, ".dynapse/TRACE.json")) ?? {};
    for (const ai of ais.filter(photoReady)) {
        const long = MAX_OUT[ai], short = 1024;
        const z = k >= 1 ? { w: Math.min(long, Math.round(short * k)), h: Math.min(short, Math.round(long / k)) } : { w: Math.min(short, Math.round(long * k)), h: Math.min(long, Math.round(short / k)) };
        const file = nextMaterial(await T().core.invoke("work_files", { id }).catch(() => []), page, slot);
        const cid = edit ? tr.children?.find(c => c.file === edit.from)?.conversation_id : undefined;
        const cont = edit ? (ai === "gemini" && cid ? { cid } : ai === "chatgpt" ? { prev: edit.from } : undefined) : undefined;
        await postChat(id, [{ role: "event", text: `사진 만드는 중 · ${NAME[ai]}`, payload: { kind: "tool", ai, file } }]);
        const sq = edit ? null : await styledReq(id, brief, opt?.kind, opt?.own); // 덱 그림 스타일(#196) — 고치는 이어가기는 그 그림 그대로
        const res = await generate(ai, id, dir, file, `${edit ? `Edit the previous image: ${edit.text}\n` : ""}${withStrict(sq?.brief ?? brief)}\nNo text, logos or watermarks.`, z, pickFor(ai, route), cont ?? (ai === "chatgpt" && sq?.ref ? { styleRef: sq.ref } : undefined));
        if (sq && typeof res !== "string") {
            await noteBrief(id, page, slot, brief, sq.kind);
            await afterMade(id, file, sq.kind, sq.style, !!opt?.own);
        }
        if (typeof res === "string") {
            if (res !== "quota")
                void diagAuto({ tool: ai === "gemini" ? "agy" : "codex", stage: "photo", code: `photo_${res}`, summary: REASON[res], work: id });
            if (res === "quota")
                await markLimited(ai);
            await postChat(id, [{ role: "event", text: `${NAME[ai]} 사진 ${REASON[res]}`, payload: { kind: "error", ai } }]);
            continue;
        }
        const fileS = await shrink(id, file);
        if (!files.length)
            await placePhoto(id, page, slot, fileS, { runtime: ai === "gemini" ? "agy" : "codex", hand: true, ...(res.cid ? { conversation_id: res.cid } : {}) });
        else {
            const t2 = (await readJson(id, ".dynapse/TRACE.json")) ?? {};
            await wput(id, ".dynapse/TRACE.json", JSON.stringify({ ...t2, children: [...(t2.children ?? []), { runtime: ai === "gemini" ? "agy" : "codex", slot: `${slot}#alt`, page, file: fileS, ...(res.cid ? { conversation_id: res.cid } : {}) }] }, null, 2));
        }
        made.push(ai);
        files.push(fileS);
    }
    {
        const { tally } = await import("./report.js");
        tally("photos", files.length > 0);
    } // 원격 보고(#116 §1) 하루 집계
    return { ais: made, files };
}
