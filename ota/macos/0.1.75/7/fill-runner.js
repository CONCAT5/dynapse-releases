// 이 PC 글 러너(#113 §4) — 에이전트 루프 없는 결정적 경로. 사진 러너(#22)와 같은 종류.
// ① 장이 없으면 서버 계획(/api/engines/plan — 목표·장 수 → 고정 레이아웃)대로 레이아웃을 받아 놓는다 ② 장의 글자 칸(fill-core leaves)을
// llama-server에 JSON schema 강제로 한 번에 채운다(📍 한 칸 수정이면 그 칸만) ③ 내용 검사로 걸린 칸만 2번까지 다시 ④ 빈 사진 칸은 sd-cli로(표지 먼저, 3장까지)
// ⑤ verify → 커밋. 배치·장 수·차트 요청(장·덱 범위)은 local-plan이 단계로 쪼개 여러 번 돌린다(#113 보정 5 — 구독 AI로 넘기지 않는다)
import { api, HUB, http, T } from "./main.js";
import { appVerify, postChat, readJson, saveRound, wget, wput, afterSave } from "./chat.js";
import { applyFill, checkFill, fillPrompt, leaves, schemaFor } from "./fill-core.js";
import { busyLocal, L, lastAv, llamaJson, localPhotoReady, localReady, noteEngineResult, sdImage, stopLlama } from "./engines.js";
// 엔진이 못 뜬 이유 → 한 줄(보정 1 표). av = 백신 격리(다시 받지 않는다 — 또 격리된다), driver = 그래픽 드라이버
const engineSay = (why, what) => why === "av" ? `보안 프로그램이 이 PC 엔진을 막았어요 · ${lastAv || "Dynapse 폴더"}를 예외로 두면 돼요`
    : why === "driver" ? "그래픽 드라이버를 업데이트하면 이 PC 엔진이 돌아요 · NVIDIA 앱이나 nvidia.com에서"
        : why === "oom" ? (what === "글" ? "이 PC 메모리로는 글 엔진을 띄우지 못했어요 · 다른 앱을 닫고 다시" : "이 PC 메모리로는 사진은 아직 · 사진 칸은 비워 둘게요")
            : what === "글" ? "이 PC 글 엔진이 응답하지 않았어요 · 다시 보내 주세요" : "";
import { placePhoto } from "./photo-runner.js";
import { runDeck, runPages, scopeOf } from "./local-plan.js";
import { report, tally } from "./report.js";
const GOALS = [[/카드\s*뉴스|인스타|카드/, "cards"], [/보고|리포트|실적|분석/, "report"], [/제안|기획안|프로포절/, "proposal"], [/사업\s*계획|투자|IR|피치/i, "business"], [/포트폴리오/, "portfolio"]];
async function ensurePages(id, request) {
    const files = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(n => /^result-[a-z0-9-]+\.html$/.test(n));
    const order = (await readJson(id, ".dynapse/pages.json").catch(() => null)) ?? [];
    if (files.length)
        return [...files].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)).map(file => ({ file }));
    const goal = GOALS.find(([re]) => re.test(request))?.[1] ?? "company";
    const n = Number(request.match(/(\d{1,2})\s*(장|페이지|p)/)?.[1]) || (goal === "cards" ? 4 : 4);
    const r = await api("GET", `/api/engines/plan?goal=${goal}&pages=${Math.max(2, Math.min(goal === "cards" ? 8 : 6, n))}`).catch(() => null);
    if (!r?.data?.pages?.length)
        return null;
    for (const p of r.data.pages) {
        const h = await http("GET", p.url.startsWith("http") ? p.url : `${HUB}${p.url}`).catch(() => null);
        if (h?.status === 200)
            await wput(id, p.file, h.body);
    }
    const tk = await http("GET", r.data.tokens.startsWith("http") ? r.data.tokens : `${HUB}${r.data.tokens}`).catch(() => null);
    if (tk?.status === 200)
        await T().core.invoke("work_write", { id, file: "tokens.css", text: tk.body }).catch(() => { });
    await wput(id, ".dynapse/pages.json", JSON.stringify(r.data.pages.map(p => p.file)));
    return r.data.pages.map(p => ({ file: p.file, role: p.role, scope: p.scope, density: p.density }));
}
// 사진 칸 — 비어 있는 figure[data-slot] (이름만, 표지 먼저)
const emptyPhotos = (html) => [...html.matchAll(/<figure\b[^>]*\bdata-slot\s*=\s*["']([a-z0-9_]+)["'][^>]*>([\s\S]*?)<\/figure>/gi)].filter(m => !/<img\b[^>]*\bsrc\s*=\s*["'][^"']+["']/i.test(m[2])).map(m => m[1]);
// 지금 덱의 장(pages.json 순서, 없으면 이름 순)
async function currentPages(id) {
    const files = (await T().core.invoke("work_files", { id }).catch(() => [])).map(f => f.name).filter(n => /^result-[a-z0-9-]+\.html$/.test(n));
    const order = (await readJson(id, ".dynapse/pages.json").catch(() => null)) ?? [];
    const inOrder = order.filter(f => files.includes(f));
    return inOrder.length ? inOrder : files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
export async function runLocalTurn(id, request, opts = {}) {
    const say = (text, kind = "stage") => postChat(id, [{ role: "event", text, payload: { kind, ai: "local" } }]).catch(() => { });
    if (!localReady()) {
        await say("이 PC 엔진이 아직 준비되지 않았어요 · 연결 탭의 이 PC에서 받아 주세요", "error");
        return;
    }
    const label = L.bundle?.text?.label ?? "이 PC";
    const pts = (opts.points ?? []).filter(p => p.slot);
    busyLocal(1);
    const t0 = Date.now();
    try {
        await postChat(id, [{ role: "event", text: `${label} · 이 PC · 글${localPhotoReady() ? " → 사진" : ""}`, payload: { kind: "tool", ai: "local", model: L.bundle?.text?.model ?? null } }]).catch(() => { });
        // 장·덱 범위(#113 보정 5) — 배치·장 수·차트 요청은 앱이 단계로 쪼개 여러 번 돌린다(구독 AI로 넘기지 않는다)
        const files0 = await currentPages(id);
        const big = files0.length ? scopeOf(request, files0, pts) : null;
        if (big) {
            const stage = (t) => say(t, "stage");
            let res = null;
            try {
                res = big.kind === "deck" ? await runDeck(id, request, big.n, files0, stage) : await runPages(id, request, big.files, files0, stage);
            }
            catch (e) {
                const why = String(e.message ?? e);
                report("engine", `engine.${["oom", "not_ready", "av", "driver"].includes(why) ? why : "llm_fail"}`, why);
                tally("engine_runs", false);
                await say(engineSay(why, "글"), "error");
                return;
            }
            if (!res) {
                await say("이 PC로 배치를 준비하지 못했어요 · 다시 보내 주세요", "error");
                report("engine", "engine.plan_fail", big.kind);
                return;
            }
            tally("engine_runs", res.changed.length > 0);
            void noteEngineResult(res.changed.length > 0);
            await finishLocal(id, request, res.changed, res.tokens, res.text, t0, label, false);
            return;
        }
        const plan = await ensurePages(id, request);
        if (!plan?.length) {
            await say("이 PC로 만들 장을 준비하지 못했어요 · 다시 보내 주세요", "error");
            report("engine", "engine.plan_fail");
            return;
        }
        const pages = [];
        for (const p of plan) {
            const html = await wget(id, p.file);
            if (html)
                pages.push({ ...p, html, leaves: leaves(html) });
        }
        // 📍 칸 수정 — 그 칸(그 슬롯의 잎들)만
        const only = pts.length ? pages.filter(p => pts.some(x => x.file === p.file)).map(p => ({ ...p, leaves: p.leaves.filter(l => pts.some(x => x.file === p.file && x.slot === l.slot)) })).filter(p => p.leaves.length) : null;
        const target = only?.length ? only : pages;
        const brief = only?.length ? (await readJson(id, ".dynapse/local-brief.json").catch(() => null))?.text ?? request : request;
        if (!only?.length)
            await wput(id, ".dynapse/local-brief.json", JSON.stringify({ text: request.slice(0, 2000) })).catch(() => { });
        const msgs = fillPrompt(brief, target, only?.length ? { file: target[0].file, keys: target.flatMap(p => p.leaves.map(l => l.key)), ask: request } : undefined);
        let tokens = 0;
        let j = {};
        try {
            const r = await llamaJson(id, msgs, schemaFor(target));
            j = r.json;
            tokens += r.tokens;
        }
        catch (e) {
            const why = String(e.message ?? e);
            if (why !== "av" && why !== "driver")
                void noteEngineResult(false); // 백신·드라이버는 판 탓이 아니다(되돌리지 않는다)
            report("engine", `engine.${["oom", "not_ready", "av", "driver"].includes(why) ? why : "llm_fail"}`, why);
            tally("engine_runs", false);
            await say(engineSay(why, "글"), "error");
            return;
        }
        // 내용 검사 — 걸린 칸만 2번까지
        for (let k = 0; k < 2; k++) {
            const bad = target.map(p => ({ ...p, leaves: p.leaves.filter(l => checkFill(j[p.file] ?? {}, [l]).length) })).filter(p => p.leaves.length);
            if (!bad.length)
                break;
            try {
                const r = await llamaJson(id, fillPrompt(brief, bad), schemaFor(bad));
                tokens += r.tokens;
                for (const p of bad)
                    j[p.file] = { ...(j[p.file] ?? {}), ...(r.json[p.file] ?? {}) };
            }
            catch {
                break;
            }
        }
        const changed = [];
        for (const p of target) {
            const full = pages.find(x => x.file === p.file);
            const out = applyFill(full.html, p.leaves, j[p.file] ?? {});
            if (out !== full.html) {
                await wput(id, p.file, out);
                changed.push(p.file);
            }
        }
        tally("engine_runs", true);
        void noteEngineResult(true);
        // 사진 — 첫 덱이면 빈 사진 칸을 sd로(표지 먼저, 3장까지). 프롬프트는 정해진 틀만(사용자 글을 그대로 넣지 않는다 — 보정 1 §3)
        let made = 0;
        if (!only?.length && localPhotoReady()) {
            for (const p of pages) {
                if (made >= 3)
                    break;
                const html = (await wget(id, p.file)) ?? "";
                for (const slot of emptyPhotos(html).slice(0, 1)) {
                    if (made >= 3)
                        break;
                    await say(`사진 만드는 중 · ${made + 1}`, "tool");
                    const vals = j[p.file] ?? {}, tk = Object.keys(vals).find(k => /title|headline|product_name/.test(k));
                    const subject = (tk ? vals[tk] : brief).slice(0, 160);
                    const prompt = `A real photograph for a presentation slide about: ${subject}. Natural light, real materials and places, calm composition with empty space, documentary style. No text, no letters, no logos, no people's faces.`;
                    const file = `materials/${slot}-local-${Date.now().toString(36)}.png`;
                    const wide = !/card/.test(p.file);
                    const r = await sdImage(id, prompt, file, wide ? 1024 : 1024, wide ? 576 : 1024);
                    tally("photos", r.ok);
                    if (!r.ok) {
                        report("engine", `engine.photo_${r.why ?? "fail"}`);
                        if (r.why === "oom" || r.why === "av" || r.why === "driver") {
                            await say(engineSay(r.why, "사진"), "error");
                            break;
                        }
                        continue;
                    }
                    await placePhoto(id, p.file, slot, file, { runtime: "local", title: L.bundle?.photo?.label ?? "이 PC" });
                    if (!changed.includes(p.file))
                        changed.push(p.file);
                    made++;
                }
            }
        }
        await finishLocal(id, request, changed, tokens, only?.length ? `칸 ${target.reduce((a, p) => a + p.leaves.length, 0)}개를 고쳤어요.` : `이 PC로 ${pages.length}장의 글을 채웠어요${made ? ` · 사진 ${made}장` : ""}.`, t0, label, !!only?.length);
        // 첫 이 PC 덱 뒤 평가 카드(보정 4 §2) — 기기당 한 번, 내보내기·공유 직후에 웹이 띄운다. 여기선 첫 덱 표시만
        try {
            if (!only?.length && !localStorage.getItem("dyn:local-first")) {
                localStorage.setItem("dyn:local-first", id);
            }
        }
        catch { /* */ }
    }
    finally {
        busyLocal(-1);
        if (localPhotoReady())
            void stopLlama();
    }
}
// 턴 끝 — verify · 저장(라운드) · 결과 줄. 칸 채우기와 큰 수정(#113 보정 5)이 같이 쓴다
async function finishLocal(id, request, changed, tokens, text, t0, label, only) {
    const v = await appVerify(id, changed.length ? changed : undefined);
    const trace = (await readJson(id, ".dynapse/TRACE.json")) ?? {};
    const n = (trace.rounds?.at(-1)?.n ?? 0) + 1;
    const r = { n, role: "write", runtime: "local", session_id: "", files: changed, req: { text: request.slice(0, 300) }, model: L.bundle?.text?.model ?? undefined };
    r.engine = `${L.bundle?.id}@${L.state?.version}`;
    await saveRound(id, r, only ? `칸 고치기 · ${request.slice(0, 40)}` : request.slice(0, 80), v);
    await wput(id, ".dynapse/TRACE.json", JSON.stringify({ ...trace, rounds: [...(trace.rounds ?? []), r] }, null, 2));
    const secs = Math.round((Date.now() - t0) / 1000);
    await postChat(id, [
        { role: "agent", text, payload: { ai: "local", model: L.bundle?.text?.model ?? null } },
        { role: "event", text: null, payload: { kind: "shot", ai: "local", round: n, pages: r.shots ?? [], commit: r.commit ?? null, uploaded: !!r.uploaded, model: L.bundle?.text?.label ?? null, ais: ["local"], labels: changed.slice(0, 6) } },
        { role: "event", text: `${label} · ${secs}초 · 토큰 ${tokens}`, payload: { kind: "usage", ai: "local" } },
    ]).catch(() => { });
    if (!v.ok)
        report("turn", "turn.verify_fail_local", [...new Set(v.errors.map(e => e.rule))].slice(0, 8).join(","));
    tally("turns", v.ok);
    void afterSave(id);
}
