// 사진 러너 (WORKORDER #22) — 사진 작업(kind: photo)의 턴은 편집 AI 없이 앱이 결정적으로 돈다. 사진 AI(Gemini=agy · ChatGPT=codex)만 호출.
// 1 프롬프트(브리프 + 누적 수정 지시 + 규격) → 2 사진 AI 고르기(팀 순서 · 준비됨 · 오늘 한도 아님) → 3 생성(materials/photo-v⟨n⟩.png, 덮어쓰기 없음)
// → 4 L0(규격·비율, 실패면 이유를 덧붙여 최대 2회 더) → 5 바인딩·커밋·미리보기 → 6 리워드 작업이면 claim·업로드·제출을 앱이 직접(MCP) → 7 사진 AI 로고로 한 줄
// 멈추면(한도·로그인·업데이트·연결) 멈춤 카드로 묻는다 — "한도면 자동으로 다른 AI"를 켠 경우만 조용히 대체(#22-보정 3). 실패하면 claim은 놓는다. 달러 표기 없음(#22-보정)
import { diagAuto } from "./diag.js";
import { HUB, S, T, api, http, mcp, spawn, store } from "./main.js";
import { postChat, readJson, repoCommit, stopPhotos, wput } from "./chat.js";
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
// 사진 AI가 마지막으로 말한 실패 이유(작업별) — 멈춤 카드에 한 줄로
export const lastErr = new Map();
export const REASON = { quota: "한도에 닿았어요", login: "로그인이 풀렸어요", update: "업데이트가 필요해요", approve: "실행을 승인해 주세요", net: "연결이 끊겼어요" };
const LOGIN = /not logged in|login required|unauthori[sz]ed|\b401\b|please log ?in|sign in/i, UPDATE = /please (update|upgrade)|version .* (not supported|outdated)|upgrade required/i;
// 사진 AI 한 번 — 성공이면 파일, 멈추면 이유
// cont(#24 §3) — 수정이면 이전 결과에서 이어서: Gemini는 같은 대화(--conversation), ChatGPT는 이전 파일을 입력 이미지로(-i)
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
    const mo = [...(pick?.model ? ["-m", pick.model] : []), "-c", `model_reasoning_effort="${pick?.effort || "low"}"`, "-c", "project_doc_max_bytes=0"];
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
            res = await generate(ai, id, dir, file, why ? `${prompt}\nProblem with the last result: ${why}` : cont?.cid ? `Edit the previous image: ${st.reqs.at(-1)}\n${prompt}` : prompt, z, opts.route?.models?.[ai], cont);
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
export const slotKey = (page, slot) => `${pageKey(page)}.${slot}`;
const SLOT_OK = /^[a-z0-9_]{1,40}$/i;
const slotEl = (slot) => new RegExp(`<(\\w+)\\b([^>]*\\bdata-slot\\s*=\\s*["']${slot}["'][^>]*)>([\\s\\S]*?)<\\/\\1>`, "i");
const IMG = (file) => `<img src="${file}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block">`;
// 그 칸 안의 사진만 — 있으면 src만, 없으면 넣는다(칸 밖의 다음 사진을 건드리지 않는다)
export function setSlotImg(html, slot, file) {
    const re = slotEl(slot);
    if (!re.test(html))
        return null;
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
    const has = async (f) => { const h = await read(f); return !!h && slotEl(slot).test(h); };
    if (page && PAGE_RE.test(page) && pages.includes(page) && (await has(page)))
        return page;
    const hits = [];
    for (const f of pages)
        if (await has(f))
            hits.push(f);
    return hits.length === 1 ? hits[0] : null;
}
export function nextMaterial(files, page, slot, ext = "png") {
    const base = `${pageKey(page)}-${slot}`;
    const n = 1 + Math.max(0, ...files.map(f => Number(f.name.match(new RegExp(`^materials/${base}-v(\\d+)\\.(png|jpe?g)$`))?.[1] ?? 0)));
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
            if (h && slotEl(k).test(h)) {
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
export async function runPhotoRequests(id, route, o = {}) {
    const file0 = o.pending ? ".dynapse/photo-pending.json" : ".dynapse/photo-requests.json";
    let raw = ((await readJson(id, file0)) ?? []).filter(r => r && SLOT_OK.test(r.slot ?? "") && (r.brief ?? "").trim()).slice(0, PHOTO_MAX);
    if (!raw.length)
        return [];
    // 첫 생성 = 표지 한 장(스타일 확인) — 표지 칸(cover·card-1) 요청을 맨 앞으로
    if (o.first)
        raw = [...raw].sort((a, b) => Number(!/result-(cover|card-1)\.html/.test(b.file ?? "")) - Number(!/result-(cover|card-1)\.html/.test(a.file ?? "")));
    const cap = Math.min(o.cap ?? (o.first ? 1 : PHOTO_MAX), PHOTO_MAX);
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
    if (!reqs.length) {
        await wput(id, ".dynapse/photo-requests.json", "[]\n");
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
    const done = [], left = [], reasons = new Set();
    let failed = null; // 한도 아닌 실패(로그인·업데이트·연결) — 끝에 이유와 다른 AI 버튼을 보여 준다
    // 사진 2장 동시(#51 §2) — 사진 AI 계정 정책상 동시 2를 넘기지 않는다. 한도·중단은 둘 다 마무리 뒤 멈춤
    const total = Math.min(cap, reqs.length), { n: CONC, busy } = await photoConc(total);
    let started = 0, regen = 0, q429 = false;
    const share = await shareOn(id), shared = { ok: 0, dup: 0, no: 0 };
    const each = [];
    const one = async (r) => {
        if (stopPhotos.has(id) && !stop)
            stop = "중단"; // ■(#50) — 지금 장까지만, 남은 칸은 [1장]·[2장]·[전부]로
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
            void postChat(id, [{ role: "event", text: `사진 ${k}/${total} · ${NAME[ai]}${CONC > 1 ? " · 2개 동시" : busy ? " · 1개(부하)" : ""}`, payload: { kind: "tool", ai, file, prompt: `${r.brief.trim()}\nNo text, logos or watermarks.` } }]);
            const res = await generate(ai, id, dir, file, `${withStrict(r.brief.trim())}\nNo text, logos or watermarks.`, z, route?.models?.[ai]);
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
        const { ai, res } = got;
        const file = await shrink(id, got.file);
        const files = await T().core.invoke("work_files", { id }).catch(() => []);
        if (limited.length)
            await postChat(id, [{ role: "event", text: `${limited.map(a => NAME[a]).join("·")} 한도에 닿아 ${NAME[ai]}로 만들었어요`, payload: { kind: "stage", ai } }]);
        void files;
        await placePhoto(id, r.page, r.slot, file, { runtime: ai === "gemini" ? "agy" : "codex", ...(res.cid ? { conversation_id: res.cid } : {}) });
        if (share) {
            const placed = await shrink(id, got.file);
            shared[await contribute(id, r.page, r.slot, placed, ai, res.model ?? null)]++;
        }
        void postChat(id, [{ role: "event", text: `사진 · ${pageKey(r.page)} ${r.slot}`, payload: { kind: "stage", ai, file, photo_done: true } }]);
        done.push(r.slot);
        usedAis.add(ai);
        daily.n++;
        each.push(Math.round((Date.now() - g0) / 1000));
        if (!o.reward)
            void api("POST", "/api/device/photo-quota", { n: 1 }).catch(() => { });
    };
    const queue = [...reqs];
    const worker = async () => { for (let r = queue.shift(); r; r = queue.shift())
        await one(r); };
    await Promise.all(Array.from({ length: CONC }, worker));
    photoStats.set(id, { n: done.length, asked: total, left: 0, regen, q429, conc: CONC, busy, each_s: each, ai: [...usedAis] });
    await store.set("photo_daily", daily).catch(() => { });
    await store.save().catch(() => { });
    // 못 만든·안 만든 칸은 나중에 [1장]·[2장]·[전부]로(#49 B)
    const prevPending = o.pending ? [] : ((await readJson(id, ".dynapse/photo-pending.json")) ?? []);
    const keep = [...leftReqs.map(({ page, ...x }) => ({ ...x, file: page })), ...prevPending.filter(p => !reqs.some(r => r.slot === p.slot && r.page === p.file))].slice(0, PHOTO_MAX);
    await wput(id, ".dynapse/photo-pending.json", JSON.stringify(keep, null, 1));
    if (share && (shared.ok || shared.dup || shared.no))
        await postChat(id, [{ role: "event", text: `재고에 공유 · 검수 대기 ${shared.ok}${shared.dup ? ` · 중복 ${shared.dup}` : ""}${shared.no ? ` · 못 올림 ${shared.no}` : ""}`, payload: { kind: "stage", ai: "dynapse" } }]);
    if (done.length)
        await postChat(id, [{ role: "event", text: `사진 ${done.length}장이 들어왔어요 · 확인해 주세요`, payload: { kind: "stage", ai: [...usedAis][0] ?? "dynapse", photo_done: true } }]); // #48 D — 맞는지는 사람이 본다
    if (stop === "중단")
        stopPhotos.delete(id);
    {
        const ps = photoStats.get(id);
        if (ps)
            ps.left = left.length;
    }
    // 만든 게 하나도 없고 실패 이유가 있으면 — 같은 "비어 있음" 카드를 되풀이하지 않고 이유 + [다른 AI로 다시]·[다시]·[그만](2026-10-08 희원: 누를 때마다 같은 카드만 쌓였다)
    const f = failed;
    if (!done.length && f && !stop) {
        const detail = lastErr.get(id);
        lastErr.delete(id);
        // 카드 하나(웹이 버튼을 그린다 — [다른 AI로 다시]·[로그인]·[다시]가 모두 fill-photos/login 행동이라 덱 작업에서도 그대로 동작) + 사진 패널용 신호
        await postChat(id, [{ role: "event", text: `${NAME[f.ai]} 사진이 만들어지지 않았어요 · ${REASON[f.why]}${detail ? ` — ${detail}` : ""}`, payload: { kind: "photo-fill-fail", ai: f.ai, why: f.why, left: left.length, other: order.find(a => a !== f.ai) ?? (f.ai === "gemini" ? "chatgpt" : "gemini"), ...(detail ? { detail } : {}) } },
            { role: "event", text: null, payload: { kind: "photo-fail", ai: f.ai } }]);
        return [...usedAis];
    }
    if (left.length)
        await postChat(id, [{ role: "event", text: stop === "중단" ? `사진 칸 · 남음 ⬚${left.length}` : stop === "오늘 사진 상한" ? `오늘 ${dayLimit}장 다 썼어요 · 남은 ${left.length}장 내일` : stop ? `남은 ${left.length}장 · ${stop === "한도" ? "내일" : stop}` : `사진 칸 비어 있음${reasons.size ? ` · ${[...reasons].join(" · ")}` : ""}`,
                payload: { kind: stop && stop !== "중단" ? "photo-capped" : "photo-empty", ai: "dynapse", slots: left.slice(0, 8), choose: !stop || stop === "중단", left: left.length, ...(stop === "오늘 사진 상한" ? { daily: true, cap: dayLimit } : {}) } }]);
    return [...usedAis];
}
// 칸 하나에 사진 하나(#29 A1 상대경로 · #31 · #42) — **그 장표 하나**의 그 칸(data-slot)만 이 파일로(img가 없으면 넣는다), slots.json·TRACE children(출처) 갱신. 커밋은 부르는 쪽이
// 같은 작업의 사진 넣기는 한 번에 하나(#51 — 2장 동시 생성이 같은 장표·slots.json·TRACE를 동시에 고쳐 쓰지 않게)
const placing = new Map();
export function placePhoto(id, page, slot, file, source) {
    const run = (placing.get(id) ?? Promise.resolve()).catch(() => { }).then(() => placePhoto0(id, page, slot, file, source));
    placing.set(id, run);
    return run;
}
async function placePhoto0(id, page, slot, file, source) {
    if (!PAGE_RE.test(page) || !SLOT_OK.test(slot))
        return [];
    file = await shrink(id, file); // 모든 경로(재고·내 파일·생성본)가 여기를 지난다
    const html = await T().core.invoke("work_read", { id, file: page }).catch(() => null);
    const out = html ? setSlotImg(html, slot, file) : null;
    if (!out)
        return [];
    await wput(id, page, out);
    const slots = await readSlots(id);
    await wput(id, ".dynapse/slots.json", JSON.stringify({ ...slots, [slotKey(page, slot)]: file }, null, 2));
    const tr = (await readJson(id, ".dynapse/TRACE.json")) ?? {};
    await wput(id, ".dynapse/TRACE.json", JSON.stringify({ ...tr, children: [...(tr.children ?? []).filter(c => !sameCell(c, page, slot)), { ...source, slot, page, file }] }, null, 2));
    return [page];
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
        const res = await generate(ai, id, dir, file, `${edit ? `Edit the previous image: ${edit.text}\n` : ""}${withStrict(brief)}\nNo text, logos or watermarks.`, z, route?.models?.[ai], cont);
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
            await placePhoto(id, page, slot, fileS, { runtime: ai === "gemini" ? "agy" : "codex", ...(res.cid ? { conversation_id: res.cid } : {}) });
        else {
            const t2 = (await readJson(id, ".dynapse/TRACE.json")) ?? {};
            await wput(id, ".dynapse/TRACE.json", JSON.stringify({ ...t2, children: [...(t2.children ?? []), { runtime: ai === "gemini" ? "agy" : "codex", slot: `${slot}#alt`, page, file: fileS, ...(res.cid ? { conversation_id: res.cid } : {}) }] }, null, 2));
        }
        made.push(ai);
        files.push(fileS);
    }
    return { ais: made, files };
}
