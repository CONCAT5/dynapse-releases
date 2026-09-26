// 사진 러너 (WORKORDER #22) — 사진 작업(kind: photo)의 턴은 편집 AI 없이 앱이 결정적으로 돈다. 사진 AI(Gemini=agy · ChatGPT=codex)만 호출.
// 1 프롬프트(브리프 + 누적 수정 지시 + 규격) → 2 사진 AI 고르기(팀 순서 · 준비됨 · 오늘 한도 아님) → 3 생성(materials/photo-v⟨n⟩.png, 덮어쓰기 없음)
// → 4 L0(규격·비율, 실패면 이유를 덧붙여 최대 2회 더) → 5 바인딩·커밋·미리보기 → 6 리워드 작업이면 claim·업로드·제출을 앱이 직접(MCP) → 7 사진 AI 로고로 한 줄
// 멈추면(한도·로그인·업데이트·연결) 멈춤 카드로 묻는다 — "한도면 자동으로 다른 AI"를 켠 경우만 조용히 대체(#22-보정 3). 실패하면 claim은 놓는다. 달러 표기 없음(#22-보정)
import { HUB, S, T, api, http, mcp, spawn, store } from "./main.js";
import { postChat, readJson, repoCommit, wput } from "./chat.js";
const NAME = { gemini: "Gemini", chatgpt: "ChatGPT" };
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
export const REASON = { quota: "한도에 닿았어요", login: "로그인이 풀렸어요", update: "업데이트가 필요해요", approve: "실행을 승인해 주세요", net: "연결이 끊겼어요" };
const LOGIN = /not logged in|login required|unauthori[sz]ed|\b401\b|please log ?in|sign in/i, UPDATE = /please (update|upgrade)|version .* (not supported|outdated)|upgrade required/i;
// 사진 AI 한 번 — 성공이면 파일, 멈추면 이유
async function generate(ai, id, dir, file, prompt, z, pick) {
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
        const text = [prompt, `generate_image 도구를 AspectRatio "${z ? aspectOf(z.w, z.h) : "1:1"}"로 1회만 호출하라. 다른 도구는 쓰지 말고 파일을 옮기지 마라. 끝나면 한 줄로 답하라.`].join("\n");
        const args = ["-p", text, "--add-dir", dir, "--mode", "accept-edits", "--output-format", "stream-json", "--print-timeout", "8m", "--effort", pick?.effort || "low", ...(pick?.model ? ["--model", pick.model] : [])];
        const code = await spawn("agy", args, "", dir, onLine, () => { }).catch(() => -1);
        if (quota || login || update)
            return why();
        if (code !== 0 || !cid || status !== "SUCCESS")
            return "net";
        const r = await T().core.invoke("agy_pick", { cid, workId: id, files: [file], w: z?.w ?? null, h: z?.h ?? null }).catch(() => null);
        return r ? { ok: true, model: pick?.model ?? null, trace: r.trace_hash } : "net";
    }
    // ChatGPT(codex exec) — 앱이 직접 띄운다(편집 세션의 실행 권한과 무관). 결과는 파일로만 판정
    let model = pick?.model ?? null;
    const onLine = (l) => { watch(l); try {
        const d = JSON.parse(l);
        if (typeof d.model === "string")
            model = d.model;
    }
    catch { /* 비JSON */ } };
    const out = `${dir}/${file}`;
    const text = `${prompt}\n${z ? `${z.w}x${z.h}` : "1024x1024"} PNG 한 장을 만들어 ${out} 로 저장하라. 다른 파일은 만들지 않는다.`;
    const mo = [...(pick?.model ? ["-m", pick.model] : []), ...(pick?.effort ? ["-c", `model_reasoning_effort="${pick.effort}"`] : [])];
    await spawn("codex", ["exec", "--json", "--skip-git-repo-check", ...mo, "-s", "workspace-write", "-C", dir, "-"], text, dir, onLine, () => { }).catch(() => -1);
    if ((await T().core.invoke("check_png", { path: out })).png)
        return { ok: true, model };
    return why();
}
// 사진 턴 하나
// 멈춤 카드(#22-보정 3) — 멈춘 AI 로고 + 이유 한 줄 + 버튼 2~3개(합치기 질문과 같은 ask 카드). 답은 다음 메시지로 온다
async function stopCard(id, ai, why) {
    const other = ai === "gemini" ? "chatgpt" : "gemini";
    const first = photoReady(other) && !photoLimited(other) ? { id: `use:${other}`, label: `${NAME[other]}로 이어서` } : { id: `add:${other}`, label: `${NAME[other]} 추가` };
    const second = why === "quota" ? { id: "later", label: "내일 다시" } : why === "login" ? { id: `login:${ai}`, label: `${NAME[ai]} 로그인` } : { id: "retry", label: "다시" };
    await postChat(id, [{ role: "event", text: null, payload: { kind: "ask", ai, stop: why, questions: [{ label: NAME[ai], question: `사진 ${REASON[why]}`, options: [first, second, { id: "stop", label: "그만" }] }] } }]);
}
// 멈춤 카드의 답 — "Gemini: ChatGPT로 이어서" 같은 문장. 이어서면 그 AI로 같은 프롬프트(수정 지시로 쌓지 않는다)
export function stopAnswer(text) {
    const m = text.match(/^(Gemini|ChatGPT): (.+)$/);
    if (!m)
        return null;
    const a = m[2];
    if (/로 이어서$/.test(a))
        return { use: a.startsWith("ChatGPT") ? "chatgpt" : "gemini" };
    if (/ (추가|로그인)$/.test(a))
        return { login: a.startsWith("ChatGPT") ? "chatgpt" : "gemini" };
    if (a === "다시")
        return { retry: true };
    return { stop: true }; // 내일 다시 · 그만
}
export async function runPhotoTurn(id, text, opts) {
    const started = Date.now();
    const say = (rows) => postChat(id, rows);
    const dir = await T().core.invoke("work_dir", { id });
    // 1 프롬프트 — 첫 문장(또는 리워드 작업 브리프) + 누적 수정 지시
    const st = (await readJson(id, ".dynapse/photo.json")) ?? {};
    let claim = null;
    if (opts.taskId) {
        const c = await mcp("claim_task", { task_id: opts.taskId }).catch(() => null);
        if (!c?.data?.claim_nonce) {
            await say([{ role: "event", text: c?.text?.slice(0, 80) || "작업을 맡지 못했어요", payload: { kind: "error", ai: "dynapse" } }]);
            return;
        }
        claim = c.data;
        if (!st.base)
            st.base = claim.task.spec.prompt ?? text;
        else if (!opts.resume)
            st.edits = [...(st.edits ?? []), text];
    }
    else if (!st.base)
        st.base = text;
    else if (!opts.resume)
        st.edits = [...(st.edits ?? []), text];
    await wput(id, ".dynapse/photo.json", JSON.stringify(st, null, 2));
    const z = sizeOf(claim?.task.spec.size);
    const prompt = [st.base, ...(st.edits?.length ? [`수정: ${st.edits.join(" / ")}`] : []), z ? `규격 ${z.w}x${z.h}` : "", "텍스트·로고·워터마크 금지."].filter(Boolean).join("\n");
    // 2 사진 AI 순서 — 팀(AI 줄) 순서, 준비됨, 오늘 한도 아님
    const order = [...new Set([...(opts.route?.photo ?? []).filter((a) => a === "gemini" || a === "chatgpt"), "gemini", "chatgpt"])];
    const usable = (opts.force ? [opts.force] : order).filter(a => photoReady(a) && (opts.force ? true : !photoLimited(a)));
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
    let used = null, model = null, trace, why = "";
    let stopped = null;
    for (const ai of usable) {
        await say([{ role: "event", text: `사진 만드는 중 · ${NAME[ai]}`, payload: { kind: "tool", ai } }]);
        let res = "net";
        for (let k = 0; k < 3; k++) {
            res = await generate(ai, id, dir, file, why ? `${prompt}\n지난 결과 문제: ${why}` : prompt, z, opts.route?.models?.[ai]);
            if (typeof res === "string")
                break;
            const fit = await T().core.invoke("img_fit", { workId: id, file, w: z?.w ?? null, h: z?.h ?? null }).catch(() => null);
            if (fit && !fit.undersized)
                break;
            why = fit ? `규격보다 작음(${fit.width}x${fit.height} < ${z?.w}x${z?.h})` : "PNG가 아님";
            await say([{ role: "event", text: `규격 확인 · 다시 (${k + 1}/2)`, payload: { kind: "tool", ai } }]);
            res = "net";
        }
        if (res && typeof res !== "string") {
            used = ai;
            model = res.model;
            trace = res.trace;
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
    const slots = (await readJson(id, ".dynapse/slots.json")) ?? {};
    await wput(id, ".dynapse/slots.json", JSON.stringify({ ...slots, photo: file }, null, 2));
    const sha = await repoCommit(id, `“${text.slice(0, 160)}” · ${NAME[used]}`);
    const trace0 = (await readJson(id, ".dynapse/TRACE.json")) ?? {};
    await wput(id, ".dynapse/TRACE.json", JSON.stringify({ ...trace0, primary: { runtime: used === "gemini" ? "agy" : "codex", model }, rounds: [...(trace0.rounds ?? []), { n: (trace0.rounds?.length ?? 0) + 1, role: "write", runtime: used === "gemini" ? "agy" : "codex", model, files: [file], commit: sha }] }, null, 2));
    if (S.thumbUpload)
        await http("PUT", `${HUB}/api/works/${encodeURIComponent(id)}/preview`, { file: `${dir}/${file}`, contentType: "image/png", auth: true }).catch(() => null);
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
            task_id: claim.task.id, claim_nonce: claim.claim_nonce, provider, upload_id: claim.upload_id,
            evidence: { claim_nonce: claim.claim_nonce, runtime: provider, model: model ?? `unknown-${provider}`, ...(trace ? { trace_hash: trace } : {}) },
        }).catch(() => null);
        if (!r?.data?.receipt) {
            await say([{ role: "event", text: (r?.data?.rejected ?? r?.text ?? "제출하지 못했어요").slice(0, 80), payload: { kind: "error", ai: used, retry: true } }]);
            await release();
            return;
        }
        submitted = ` · 접수 ${r.data.receipt.slice(-6)}`;
    }
    // 7 결과 — 사진 AI 로고로 한 줄 + 사진
    await say([
        { role: "event", text: null, payload: { kind: "photo", ai: used, file, model, commit: sha } },
        { role: "agent", text: `사진 1장 · ${NAME[used]} · ${secs}초${submitted}`, payload: { ai: used, model, summary: [`사진 1장 · ${NAME[used]} · ${secs}초${submitted}`] } },
    ]);
    await api("POST", "/api/works", { id, status: "done", local_path: dir, device_id: S.deviceId }).catch(() => { });
}
