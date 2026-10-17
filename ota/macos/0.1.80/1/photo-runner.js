// 사진 러너 (WORKORDER #22) — 사진 작업(kind: photo)의 턴은 편집 AI 없이 앱이 결정적으로 돈다. 사진 AI(Gemini=agy · ChatGPT=codex)만 호출.
// 1 프롬프트(브리프 + 누적 수정 지시 + 규격) → 2 사진 AI 고르기(팀 순서 · 준비됨 · 오늘 한도 아님) → 3 생성(materials/photo-v⟨n⟩.png, 덮어쓰기 없음)
// → 4 L0(규격·비율, 실패면 이유를 덧붙여 최대 2회 더) → 5 바인딩·커밋·미리보기 → 6 리워드 작업이면 claim·업로드·제출을 앱이 직접(MCP) → 7 사진 AI 로고로 한 줄
// 멈추면(한도·로그인·업데이트·연결) 멈춤 카드로 묻는다 — "한도면 자동으로 다른 AI"를 켠 경우만 조용히 대체(#22-보정 3). 실패하면 claim은 놓는다. 달러 표기 없음(#22-보정)
import { diagAuto } from "./diag.js";
import { HUB, S, T, api, http, mcp, spawn, store } from "./main.js";
import { report } from "./report.js";
import { bgDone, bgDrop, bgOnAct, bgSet } from "./bg.js";
import { handPut, postChat, readJson, repoCommit, sessions, stopPhotos, wget, wput } from "./chat.js";
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
    await spawn("codex", ["exec", "--json", "--skip-git-repo-check", ...mo, ...(cont?.prev ? ["-i", `${dir}/${cont.prev}`] : []), "-s", "workspace-write", "-C", scratch, "-"], cont?.prev ? `Edit the attached previous image.\n${text}` : text, scratch, onLine, () => { }).catch(() => -1);
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
    // 첫 AI(고른 것)는 표시가 있어도 시도, 대체 AI는 표시가 없을 때만. 실제로 한도면 아래에서 멈춤 카드(자동 대체를 켰을 때만 조용히 다음)
    const ready0 = (opts.force ? [opts.force] : order).filter((a, i) => photoReady(a) && (opts.force || i === 0 || !photoLimited(a)));
    // 못 만드는 규격(#29 A3) — 최대 출력이 규격보다 작은 AI는 뺀다(할 수 있는 AI가 있을 때). 아무도 못 하면 한 번만 시도하고 미달이면 그대로 끝
    const able = ready0.filter(a => canMake(a, z));
    const usable = opts.force || !able.length ? ready0 : able;
    const auto = !!opts.route?.auto_fallback; // "한도면 자동으로 다른 AI"(AI 줄 팝오버, 기본 꺼짐)
    const release = async () => { if (claim)
        await mcp("release_claim", { claim_nonce: claim.claim_nonce }).catch(() => null); };
    if (!usable.length) {
        const limited = order.find(a => photoReady(a) && photoLimited(a));
        if (limited)
            await stopCard(id, limited, "quota");
        else
            await say([{ role: "event", text: null, payload: { kind: "need-ai", ai: "dynapse", cap: "photo" } }]);
        await release();
        return;
    }
    // 3~4 생성 + L0(규격) — 실패하면 이유를 덧붙여 최대 2회 더, 한도면 다음 사진 AI로
    const files = await T().core.invoke("work_files", { id }).catch(() => []);
    const n = 1 + Math.max(0, ...files.map(f => Number(f.name.match(/^materials\/photo-v(\d+)\.png$/)?.[1] ?? 0)));
    const file = `materials/photo-v${n}.png`;
    let used = null, model = null, trace, why = "", undersized = "";
    let stopped = null;
    for (const ai of usable) {
        await say([{ role: "event", text: `사진 만드는 중 · ${NAME[ai]}`, payload: { kind: "tool", ai } }]);
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
        if (!(auto && stop === "quota"))
            break; // 자동 대체는 켠 경우만(#22-보정 3) — 아니면 멈춤 카드로 묻는다
    }
    if (!used) {
        await stopCard(id, stopped?.ai ?? usable[0], stopped?.why ?? "net");
        await release();
        return;
    }
    // 5 바인딩 · 커밋 · 미리보기
    await say([{ role: "event", text: "사진 넣는 중", payload: { kind: "tool", ai: "dynapse", file } }]);
    const slots = (await readJson(id, ".dynapse/slots.json")) ?? {};
    await wput(id, ".dynapse/slots.json", JSON.stringify({ ...slots, photo: file }, null, 2));
    const sha = await repoCommit(id, text.slice(0, 200)); // 요청 1 = 커밋 1(#30) — 메시지 = 요청 원문
    const trace0 = (await readJson(id, ".dynapse/TRACE.json")) ?? {};
    await wput(id, ".dynapse/TRACE.json", JSON.stringify({ ...trace0, primary: { runtime: used === "gemini" ? "agy" : "codex", model }, rounds: [...(trace0.rounds ?? []), { n: (trace0.rounds?.length ?? 0) + 1, role: "write", runtime: used === "gemini" ? "agy" : "codex", model, files: [file], commit: sha }] }, null, 2));
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
        // 고른 AI 대신 다른 AI로 만들었으면 이유를 한 줄 먼저(대표: "넘어가면 AI가 얘기해줘야")
        ...(usable[0] && used !== usable[0] ? [{ role: "agent", text: `${NAME[usable[0]]}가 ${stopped ? REASON[stopped.why] : "만들지 못했어요"} · ${NAME[used]}로 만들었어요`, payload: { ai: used, summary: [`${NAME[usable[0]]} ${stopped ? REASON[stopped.why] : "실패"} → ${NAME[used]}로 만듦`] } }] : []),
        { role: "agent", text: `사진 1장 · ${NAME[used]}${model ? ` ${model}` : ""} · ${secs}초${submitted}`, payload: { ai: used, model, summary: [`사진 1장 · ${NAME[used]}${model ? ` ${model}` : ""} · ${secs}초${submitted}`] } },
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
export function setSlotImg(html, slot, file) {
    const re = slotEl(slot);
    if (!re.test(html)) {
        const ri = slotImg(slot);
        if (!ri.test(html))
            return null;
        return html.replace(ri, (_m, attrs) => `<img${/\bsrc\s*=/i.test(attrs) ? attrs.replace(/(\bsrc\s*=\s*["'])[^"']*(["'])/i, `$1${file}$2`) : `${attrs} src="${file}"`}>`);
    }
    return html.replace(re, (_m, tag, attrs, inner) => {
        const has = /<img\b[^>]*\bsrc\s*=\s*["'][^"']*["']/i.test(inner);
        return `<${tag}${attrs}>${has ? inner.replace(/(<img\b[^>]*\bsrc\s*=\s*["'])[^"']*(["'])/i, `$1${file}$2`) : `${inner}${IMG(file)}`}</${tag}>`;
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
    const n = 1 + Math.max(0, ...[...files, ...[...inflight].map(name => ({ name }))].map(f => Number(f.name.match(new RegExp(`^materials/${base}-v(\\d+)\\.(png|jpe?g)$`))?.[1] ?? 0)));
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
// 커밋하지 않는다(#30 — 요청 1 = 커밋 1: 편집 턴의 끝에서 한 번). 쓴 사진 AI를 돌려준다(스레드 항목의 아이콘)
// 사진 개수(#48 C · #49 B) — 요청한 칸은 앱이 끝까지(턴 상한 없음 — 사진 턴은 편집 AI를 안 쓴다, 작업당 ≤ 8). 첫 생성(first)은 표지 1장만 만들고
// 나머지는 .dynapse/photo-pending.json에 두었다가 사용자가 [1장]·[2장]·[전부]를 누르면(fill-photos) 그만큼. 리워드는 브리프대로 전부. 하루 상한 PHOTO_DAILY
export const PHOTO_DAILY = 40, PHOTO_MAX = 8;
// 조명·시간 문구는 끝에 한 번 더(#48 D — 순서 효과 실측 1건: "어두운 톤"·"저녁"이 무시됨)
const STRICT = /(어두운|어둡게|밝은|밝게|저조도|역광|노을|황혼|새벽|아침|낮|저녁|밤|야경|dark|dim|low[- ]light|bright|sunset|dusk|dawn|morning|evening|night|golden hour)[^,.·\n]{0,24}/gi;
export const withStrict = (brief) => { const m = [...new Set(brief.match(STRICT) ?? [])].slice(0, 3); return m.length ? `${brief}\nStrict: ${m.join("; ")}.` : brief; };
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
const PH_SLOT = /<(\w+)\b([^>]*\bdata-slot\s*=\s*["']([\w-]+)["'][^>]*)>([\s\S]*?)<\/\1>/gi;
const PH_NAME = /^(cover_full|cover_image|body_image|closing_full|series_\d|texture|photo|hero|image)/;
// 빈 사진 칸 메우기(#151 ① — 완성이라 하기 전에 표지·마무리·주인공 장의 사진 칸은 채운다) — 이번 턴에 바뀐 장의 빈 사진 칸을 재고로. 신뢰 장(대표·팀·후기)은 실제 사진을 기다린다(#119 보정 15 ④)
export async function fillEmptySlots(id, pages) {
    const dir = await T().core.invoke("work_dir", { id });
    const mood = (await readJson(id, ".dynapse/brief.json").catch(() => null))?.mood ?? null; // 톤 맞춤
    const title = ((await wget(id, "result-cover.html").catch(() => null))?.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    let n = 0;
    for (const page of [...new Set(pages.map(basePage))].filter(f => PAGE_RE.test(f)).slice(0, 16)) {
        const h = await wget(id, page).catch(() => null);
        if (!h || isTrustPage(h))
            continue;
        const head = (h.match(/<(h1|h2)\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        for (const m of [...h.matchAll(PH_SLOT)]) {
            if (!(m[1].toLowerCase() === "figure" || /\bdata-kind\s*=\s*["']photo["']/i.test(m[2]) || PH_NAME.test(m[3])) || !SLOT_OK.test(m[3]))
                continue;
            if (m[4].match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i)?.[1])
                continue;
            if (await stockFill(id, dir, page, m[3], [head, title].filter(Boolean).join(" · ") || m[3], mood).catch(() => false))
                n++;
        }
    }
    return n;
}
// 재고 한 장(추천 1위) → materials/⟨장⟩-⟨칸⟩-vN → 그 칸에. 우리 재고 저장소 주소만 받는다
// 이 작업에 이미 넣은 재고(TRACE children asset_id) — 한 덱의 칸끼리 같은 사진이 겹치지 않게
const usedStock = async (id) => [...new Set(((await readJson(id, ".dynapse/TRACE.json").catch(() => null))?.children ?? []).map(c => c.asset_id).filter((x) => !!x))].slice(0, 40);
export async function stockFill(id, dir, page, slot, brief, mood) {
    const r = await mcp("recommend_assets", { slot, request: brief.slice(0, 300), work_id: id, k: 1, exclude: await usedStock(id), fill: true, ...(mood ? { mood } : {}) }); // fill — 낱말이 안 맞아도 칸 모양이 맞는 1장(#151 보정 1 ①, 예전 서버는 무시)
    let items = [];
    try {
        items = (r.data?.items ?? JSON.parse(r.text).items) ?? [];
    }
    catch { /* 형식 오류 */ }
    const top = items[0];
    if (!top?.url || !/^https:\/\/[a-z0-9.-]+\.public\.blob\.vercel-storage\.com\//.test(top.url))
        return false;
    const files = await T().core.invoke("work_files", { id }).catch(() => []);
    const file = nextMaterial(files, page, slot, /\.jpe?g(\?|$)/i.test(top.url) ? "jpg" : "png");
    const g = await http("GET", top.url, { out: `${dir}/${file}` }).catch(() => null);
    if (g?.status !== 200)
        return false;
    return (await placePhoto(id, page, slot, file, { runtime: "stock", ...(top.asset_id ? { asset_id: top.asset_id } : {}) })).length > 0;
}
// 덱 단위 한 묶음(#151 보정 1 ②) — 사진 칸 전부를 한 번에(동시 2), 예산 안에 안 온 칸은 재고로 완성하고 늦게 온 사진은 뒤에서 교체. 시뮬레이터는 예산을 줄인다
export let PHOTO_BUDGET_MS = 90_000;
export const setPhotoBudget = (ms) => { PHOTO_BUDGET_MS = Math.max(50, Math.round(ms)); };
// 그 칸의 지금 사진(없으면 "") — 늦게 온 사진은 이 값이 예산 끝 그대로일 때만 바꾼다(사용자·다음 턴이 손댔으면 두기)
export function slotSrc(html, slot) {
    const el = html.match(slotEl(slot)), im = el ? null : html.match(slotImg(slot));
    if (im)
        return im[1].match(/\bsrc\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
    return el?.[3].match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
}
export async function runPhotoRequests(id, route, o = {}) {
    const file0 = o.pending ? ".dynapse/photo-pending.json" : ".dynapse/photo-requests.json";
    let raw = ((await readJson(id, file0)) ?? []).filter(r => r && SLOT_OK.test(r.slot ?? "") && (r.brief ?? "").trim()).slice(0, PHOTO_MAX);
    if (!raw.length)
        return [];
    const batch = !!o.batch && !o.reward && !o.pending;
    // 첫 생성 = 표지 칸(cover·card-1) 요청을 맨 앞으로. 묶음이 아니면 표지 한 장만(스타일 확인 — 예전 경로)
    if (o.first)
        raw = [...raw].sort((a, b) => Number(!/result-(cover|card-1)\.html/.test(b.file ?? "")) - Number(!/result-(cover|card-1)\.html/.test(a.file ?? "")));
    const cap = Math.min(o.cap ?? (o.first && !batch ? 1 : PHOTO_MAX), PHOTO_MAX);
    // 장표 확인(#42) — 없거나 틀리면 그 슬롯이 한 장표에만 있을 때만 그 장표, 아니면 거부
    const reqs = [];
    const pc = { html: new Map() };
    for (const r of raw) {
        const page = await resolvePage(id, r.slot, r.file, pc);
        if (page)
            reqs.push({ ...r, page });
        else
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
    if (!reqs.length) {
        await wput(id, file0, "[]\n");
        return [];
    }
    const usedAis = new Set();
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
    if (!order.length && !o.reward) {
        let n = 0;
        for (const r of reqs.slice(0, cap))
            if (await stockFill(id, dir, r.page, r.slot, r.brief ?? "").catch(() => false))
                n++;
        await postChat(id, [{ role: "event", text: `${n ? `사진 ${n}장을 재고로 채웠어요 · ` : ""}새 사진은 ChatGPT를 더하면 만들어요`, payload: { kind: "stage", ai: "dynapse", photo_soft: true } }]).catch(() => { });
        report("photo", "photo.stock_fill", `n=${n}/${Math.min(cap, reqs.length)}`);
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
    if (batch)
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
        const tryOrder = [...new Set([...(want ? [want] : []), ...order])].filter(photoReady).sort((a, b) => Number(photoLimited(a)) - Number(photoLimited(b)));
        if (!tryOrder.length) {
            left.push(r.slot);
            leftReqs.push(r);
            return;
        }
        const k = ++started;
        const g0 = Date.now();
        let got = null;
        const limited = [];
        const [rw, rh] = (r.ratio ?? "16:9").split(":").map(Number);
        const ratio = rw > 0 && rh > 0 ? rw / rh : 16 / 9;
        for (const ai of tryOrder) {
            const long = MAX_OUT[ai], short = 1024;
            const z = ratio >= 1 ? { w: Math.min(long, Math.round(short * ratio)), h: Math.min(short, Math.round(long / ratio)) } : { w: Math.min(short, Math.round(long * ratio)), h: Math.min(long, Math.round(short / ratio)) };
            const file = nextMaterial(await T().core.invoke("work_files", { id }).catch(() => []), r.page, r.slot);
            if (ai === tryOrder[0] && !/-v1\.[a-z]+$/.test(file))
                regen++; // 같은 칸의 두 번째 이상 = 재생성(교체)
            if (!cut)
                void postChat(id, [{ role: "event", text: `사진 ${k}/${total} · ${NAME[ai]}${CONC > 1 ? " · 2개 동시" : busy ? " · 1개(부하)" : ""}`, payload: { kind: "tool", ai, file, prompt: `${r.brief.trim()}\nNo text, logos or watermarks.` } }]);
            inflight.add(file);
            if (batch)
                bgSet(id, { k: bk(r), kind: "photo", text: `사진 · ${pageWord(r.page)} · ${NAME[ai]} 만드는 중`, state: "run", act: "stop", page: r.page, slot: r.slot, wait_gen: cut });
            const res = await generate(ai, id, dir, file, `${withStrict(r.brief.trim())}\nNo text, logos or watermarks.`, z, pickFor(ai, route)).finally(() => inflight.delete(file));
            if (typeof res === "string") {
                if (res === "quota") {
                    await markLimited(ai);
                    limited.push(ai);
                    continue;
                }
                failed ??= { ai, why: res };
                break;
            }
            got = { ai, file, res };
            break;
        }
        if (limited.length)
            q429 = true;
        if (!got) {
            left.push(r.slot);
            leftReqs.push(r);
            if (limited.length) {
                reasons.add(`${limited.map(a => NAME[a]).join("·")} 한도`);
                if (limited.length >= tryOrder.length)
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
            if (limited.length)
                await postChat(id, [{ role: "event", text: `${limited.map(a => NAME[a]).join("·")} 한도에 닿아 ${NAME[ai]}로 만들었어요`, payload: { kind: "stage", ai } }]);
            await placePhoto(id, r.page, r.slot, file, { runtime: ai === "gemini" ? "agy" : "codex", ...(res.cid ? { conversation_id: res.cid } : {}) });
        }
        finally {
            release();
            inPlace.delete(placingNow);
        }
        if (share) {
            const placed = await shrink(id, got.file);
            shared[await contribute(id, r.page, r.slot, placed, ai, res.model ?? null)]++;
        }
        void postChat(id, [{ role: "event", text: `사진 · ${pageKey(r.page)} ${r.slot}`, payload: { kind: "stage", ai, file, photo_done: true } }]);
        done.push(r.slot);
        usedAis.add(ai);
        daily.n++;
        each.push(Math.round((Date.now() - g0) / 1000));
        if (batch) {
            bgDone(id, bk(r), `사진 · ${pageWord(r.page)} · 들어감`);
            bgOnAct(id, bk(r), null);
        }
        if (!o.reward)
            void api("POST", "/api/device/photo-quota", { n: 1 }).catch(() => { });
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
    photoStats.set(id, { n: done.length, asked: total, left: 0, regen, q429, conc: CONC, busy, each_s: each, ai: [...usedAis], ...(batch ? { stock: stocked.size, late: waiting.length, budget_s: Math.round((Date.now() - b0) / 1000) } : {}) });
    await store.set("photo_daily", daily).catch(() => { });
    await store.save().catch(() => { });
    if (cut)
        void lateSwap(id, all, late, atCut, { share, daily, reward: !!o.reward, onLate: o.onLate, kick: f => { kickLate = f; }, key: x => bk(x) });
    // 못 만든·안 만든 칸은 나중에 [1장]·[2장]·[전부]로(#49 B) — 뒤에서 아직 만드는 칸은 빼고
    const prevPending = o.pending ? [] : ((await readJson(id, ".dynapse/photo-pending.json")) ?? []);
    const keep = [...leftReqs.map(({ page, ...x }) => ({ ...x, file: page })), ...prevPending.filter(p => !reqs.some(r => r.slot === p.slot && r.page === p.file))].slice(0, PHOTO_MAX);
    await wput(id, ".dynapse/photo-pending.json", JSON.stringify(keep, null, 1));
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
                if (!(await placePhoto(id, r.page, r.slot, file, { runtime: got.ai === "gemini" ? "agy" : "codex", ...(got.res.cid ? { conversation_id: got.res.cid } : {}) })).length) {
                    bgDone(id, k, `사진 · ${pageWord(r.page)} · 넣지 못함`);
                    continue;
                }
                if (o.share)
                    await contribute(id, r.page, r.slot, file, got.ai, got.res.model ?? null).catch(() => "no");
                bgDrop(id, k);
                n++;
                ais.add(got.ai);
            }
            o.daily.n += got0.length;
            await store.set("photo_daily", o.daily).catch(() => { });
            await store.save().catch(() => { });
            if (!o.reward)
                void api("POST", "/api/device/photo-quota", { n: got0.length }).catch(() => { });
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
    return run;
}
async function placePhoto0(id, page0, slot, file, src0) {
    const { hand, ...source } = src0, put = hand ? handPut : wput;
    const page = basePage(page0);
    if (!PAGE_RE.test(page) || !SLOT_OK.test(slot))
        return [];
    file = await shrink(id, file); // 모든 경로(재고·내 파일·생성본)가 여기를 지난다
    const html = await T().core.invoke("work_read", { id, file: page }).catch(() => null);
    const out = html ? setSlotImg(html, slot, file) : null;
    if (!out)
        return [];
    await put(id, page, out);
    const eds = []; // 언어판마다 같은 칸에 같은 사진(#100 보정 4 — 한국어판을 보며 바꿨는데 원문만 바뀌었다)
    for (const ed of await editionsOf(id, page)) {
        const h = await T().core.invoke("work_read", { id, file: ed }).catch(() => null);
        const o = h ? setSlotImg(h, slot, file) : null;
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
    const order = ((await readJson(id, ".dynapse/pages.json").catch(() => null)) ?? []).filter(f => pages.includes(f));
    const closing = pages.includes("result-closing.html") ? "result-closing.html" : order.at(-1) ?? [...pages].sort().at(-1);
    const htmls = new Map();
    for (const f of pages)
        htmls.set(f, (await wget(id, f).catch(() => null)) ?? "");
    const live = all.filter(c => [...htmls.values()].some(h => h.includes(`src="${c.file}"`)));
    const lic = (c) => (c.license === "cc0" ? "CC0" : `CC ${c.license.toUpperCase()}${c.license_version ? ` ${c.license_version}` : ""}`);
    const line = live.length ? `사진 · ${live.map(c => `${esc(c.title)}${c.creator ? ` — ${esc(c.creator)}` : ""} (${lic(c)}${c.source ? `, ${esc(c.source)}` : ""})`).join(" / ")} · Openverse` : "";
    const el = line ? `<p data-credits style="position:absolute;left:64px;right:64px;bottom:20px;margin:0;font-size:18px;line-height:1.4;opacity:.72;z-index:5">${line}</p>` : "";
    for (const f of [closing, ...await editionsOf(id, closing)]) {
        const h = f === closing ? htmls.get(f) : (await wget(id, f).catch(() => null)) ?? "";
        if (!h)
            continue;
        let out = h.replace(CREDIT_EL, "");
        if (el) {
            const k = out.lastIndexOf("</section>"), b = out.lastIndexOf("</body>");
            const at = k >= 0 ? k : b >= 0 ? b : out.length;
            out = `${out.slice(0, at)}${el}\n${out.slice(at)}`;
        }
        if (out !== h)
            await wput(id, f, out);
    }
}
// 사진 패널 [✦ Gemini] [⦾ ChatGPT] [둘 다](#31) — 그 칸 사진을 사진 AI로 1장씩(편집 AI 0). 결과는 "내 것"(materials/⟨칸⟩-vN)에 쌓이고 첫 결과를 칸에.
// edit = 한 줄 수정("더 어둡게") — 그 생성본의 같은 대화(Gemini --conversation) 또는 그 파일을 입력 이미지로(ChatGPT). 반환 = 만든 AI들(커밋·항목은 부르는 쪽)
export async function genSlotPhoto(id, page, slot, ais, brief, ratio = "16:9", edit, route) {
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
        const res = await generate(ai, id, dir, file, `${edit ? `Edit the previous image: ${edit.text}\n` : ""}${withStrict(brief)}\nNo text, logos or watermarks.`, z, pickFor(ai, route), cont);
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
