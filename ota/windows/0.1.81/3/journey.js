// 실제 앱 여정 자가 점검(#174 ①) — `Dynapse --selfcheck --journey`. 실제 네이티브 + 운영 서버 + (하루 한 번) 실제 Claude로 사용자 흐름을 처음부터 끝까지 사람 없이 돈다.
// 계정: 점검마다 새 기기 계정(selfcheck 표시) — 저장된 토큰·대표 계정·dynapse.json을 쓰지 않는다(저장소는 메모리). 끝에 DELETE /api/app/selfcheck로 서버 작업·계정을 지우고,
// 이 PC 작업 폴더는 네이티브가 지운다. 서버 호출은 단계마다 몇 번(루프 없음 — 턴 끝 기다림만 2초 간격 로컬 확인, 최대 6분). 사진 생성 AI는 쓰지 않는다.
// 같은 코드를 sync-sim(가짜 네이티브)이 native: false로 돌려 여정 스크립트 자체를 본다(PPTX·Claude 턴은 실제 네이티브에서만)
import { api, HUB, http, S, T } from "./main.js";
import { ensureTokens, onChatMessage, pullWork, readJson, readPages, readTokens, sessions, wget, wput } from "./chat.js";
import { applyAlt, makeAlts } from "./form-alts.js";
// 고정 원고(사실형 · 카드뉴스 아님 — 16:9 덱) — 사용자 글은 보내지 않는다
const TEXT = "밀과결 주말 빵 정기배송\n시작\n토요일 아침 8시, 빵이 문 앞에 도착해요. 새벽 5시에 반죽을 시작해 돌오븐에서 40분 구워요.\n배달\n식기 전에 닿는 2.5km 안에만 배달해요. 한 상자에 빵 세 가지가 들어 있어요.\n신청\n신청 마감은 금요일 밤 10시예요.";
const AI_DAY = "dyn:journey-ai-turn"; // 실제 Claude 턴은 하루 한 번(localStorage — 점검 창의 것, 사용자 저장소 아님) · 턴이 실제로 시작됐을 때만 센다
export async function journey(o) {
    const checks = [], log = o.log ?? (() => { });
    const res = { work: null, checks, ai_account: null };
    const step = async (name, f) => {
        const t = Date.now();
        let ok = false, note = "";
        try {
            const r = await f();
            ok = r === true || r.startsWith("skip:");
            note = r === true ? "" : r;
        }
        catch (e) {
            note = String(e?.message ?? e).slice(0, 200);
        }
        checks.push({ name: `journey_${name}`, ok, ms: Date.now() - t, note });
        log(`${ok ? "✓" : "✗"} ${name} ${note}`);
        return ok;
    };
    const id = () => res.work;
    // 앱이 대화에 남긴 줄(실패 이유 보기) — 마지막 30줄만 메모리에
    const tap = [];
    globalThis.__dynChatTap = (_i, ms) => { for (const m of ms)
        tap.push(`${m.payload?.kind ?? m.role ?? ""}:${(m.text ?? "").slice(0, 80)}`); tap.splice(0, Math.max(0, tap.length - 30)); };
    const lastLines = (n = 3) => tap.filter(x => !/:$/.test(x)).slice(-n).join(" / ");
    // 1 계정 — 앱의 기기 계정 길 그대로(selfcheck 표시만 더)
    if (!(await step("account", async () => {
        S.deviceId = `dev_sc${Math.random().toString(36).slice(2, 14).padEnd(12, "0")}`;
        const r = await http("POST", `${HUB}/api/app/device-account`, { json: { client_id: o.clientId, device_id: S.deviceId, selfcheck: true } });
        const j = JSON.parse(r.body || "{}");
        if (r.status !== 200 || !j.access_token)
            return `기기 계정 ${r.status} ${r.body.slice(0, 80)}`;
        S.token = j.access_token;
        return true;
    })))
        return res;
    try {
        // 2 디자인 입히기(AI 없이) — 웹의 첫 결과와 같은 서버 길
        if (!(await step("instant", async () => {
            const r = await api("POST", "/api/start/instant", { text: TEXT });
            if (r.status !== 200 || !r.data?.id)
                return `디자인 입히기 ${r.status} ${JSON.stringify(r.data).slice(0, 80)}`;
            res.work = r.data.id;
            return (r.data.pages ?? 0) >= 3 ? true : `장 ${r.data.pages}`;
        })))
            return res;
        // 3 이 PC로 받기 — 서버 판 → 작업 폴더(실제 경로 규칙·실제 git)
        if (!(await step("pull", async () => {
            if (!(await pullWork(id(), true)))
                return "받지 못함";
            const pages = (await readPages(id())) ?? [];
            const miss = [];
            for (const p of pages)
                if (!(await wget(id(), p)))
                    miss.push(p);
            return pages.length >= 3 && !miss.length ? true : `장 ${pages.length} · 없는 장 ${miss.join(",")}`;
        })))
            return res;
        const pages = (await readPages(id())) ?? [];
        const body = pages.find(p => p !== "result-cover.html" && !/closing|outro|end/.test(p)) ?? pages[1];
        // 4 다른 모양 띠(후보 ≥3) → 적용 → ⌘Z(사용자 길: 서버 메시지 action undo-turn)
        let forms = [];
        await step("band", async () => {
            if (!(await makeAlts(id(), body, { quiet: true })))
                return `${body}: 띠를 못 지음`;
            const c = await readJson(id(), ".dynapse/out/alt-cache.json");
            const p = c?.pages?.[body]?.p;
            forms = (p?.items ?? []).map(x => x.form);
            return forms.length >= 3 ? true : `${body}: 후보 ${forms.length}(${(p?.fails ?? []).slice(0, 3).map(f => `${f.form}:${f.error}`).join(" · ") || "검사 캐시 없음"})`;
        });
        await step("apply_undo", async () => {
            if (!forms.length)
                return "후보 없음";
            const before = await wget(id(), body);
            for (const f of forms.slice(0, 3)) {
                await applyAlt(id(), body, f);
                const after = await wget(id(), body);
                if (!after || after === before)
                    continue; // 글이 다 안 들어가 거절한 모양 — 다음 후보
                if (!new RegExp(`data-form="${f}"`).test(after))
                    return `${f}: 장에 data-form 없음`;
                await onChatMessage({ id: `sc-undo-${Date.now()}`, work: id(), role: "event", text: null, payload: { action: "undo-turn" } });
                const back = await wget(id(), body);
                const bare = (h) => (h ?? "").replace(/\s*<style\b[^>]*\bdata-dyn\b[^>]*>[\s\S]*?<\/style>/gi, ""); // 검사가 넣는 글줄 보조 블록(<style data-dyn>)은 내용이 아니다(실측: ⌘Z 뒤 판 = 전 판 + 이 블록)
                if (bare(back) === bare(before))
                    return true;
                const st = await wget(id(), ".dynapse/out/form-undo.json");
                const b0 = before ?? "", b1 = back ?? "";
                let k = 0;
                while (k < b0.length && b0[k] === b1[k])
                    k++;
                const diff = `@${k}/${b0.length}→${b1.length}: 전 "${b0.slice(Math.max(0, k - 20), k + 60).replace(/\s+/g, " ")}" · 후 "${b1.slice(Math.max(0, k - 20), k + 60).replace(/\s+/g, " ")}"`;
                return `${f} 적용 뒤 ⌘Z가 원래 장으로 돌아가지 않음 · ${back === after ? "⌘Z가 아무것도 안 함" : "다른 판으로 감"} · 모양 스택 ${st ? JSON.parse(st).length : "없음"} · ${diff} · ${lastLines()}`;
            }
            return `후보 ${forms.length}개 모두 적용되지 않음`;
        });
        // 5 사진 파일을 칸에 — 내 사진 넣기와 같은 네이티브 쓰기(material_write) + 칸 배치
        await step("photo", async () => {
            const pr = await import("./photo-runner.js");
            let target = null;
            for (const p of pages) {
                const h = (await wget(id(), p)) ?? "";
                const m = h.match(/<figure\b[^>]*\bdata-slot\s*=\s*["']([a-z0-9_]+)["']/i);
                if (m) {
                    target = { page: p, slot: m[1] };
                    break;
                }
            }
            if (!target)
                return "skip: 사진 칸이 있는 장 없음";
            const png = await pr.solidPngBytes?.(196, 120, 64);
            if (!png)
                return "PNG를 못 만듦";
            const file = `materials/selfcheck-${Date.now()}.png`;
            const inv = T().core.invoke;
            try {
                await inv("material_write", png, { headers: { "x-id": id(), "x-path": encodeURIComponent(file) } });
            }
            catch (e) { // 바이트 본문이 JSON으로 갔다면 IPC 사용자 프로토콜(fetch)이 막혀 postMessage로 떨어진 것 — 같은 fetch를 직접 해 원인(CSP 등)을 적는다
                const why = await fetch("ipc://localhost/material_write", { method: "POST", body: png, headers: { "x-id": id(), "x-path": encodeURIComponent(file), "Tauri-Callback": "0", "Tauri-Error": "0", "Tauri-Invoke-Key": "x" } }).then(r => `ipc fetch ${r.status}`).catch(x => `ipc fetch 막힘: ${String(x?.message ?? x).slice(0, 80)}`);
                return `${String(e?.message ?? e).slice(0, 60)} · ${why} · ${png.constructor?.name} ${png.byteLength}B`;
            }
            const fig = (h) => h.match(new RegExp(`<figure\\b[^>]*\\bdata-slot\\s*=\\s*["']${target.slot}["'][\\s\\S]*?</figure>`, "i"))?.[0] ?? "";
            const f0 = fig((await wget(id(), target.page)) ?? "");
            const placed = await pr.placePhoto(id(), target.page, target.slot, file, { runtime: "mine", hand: true });
            const f1 = fig((await wget(id(), target.page)) ?? "");
            return placed.length && f1 !== f0 && /<img\b[^>]*src=["'][^"']*selfcheck-/i.test(f1) ? true : `${target.page}·${target.slot}: 칸에 그 사진이 안 들어감(${placed.length})`;
        });
        // 6 실제 Claude 턴 "제목 더 짧게" — 하루 한 번 · 이 PC의 Claude 로그인으로(누구의 로그인인지 결과에 적는다)
        await step("ai_turn", async () => {
            if (!o.aiTurn)
                return "skip: 이 실행은 AI 턴 없음";
            const today = new Date().toISOString().slice(0, 10);
            let last = "";
            try {
                last = localStorage.getItem(AI_DAY) ?? "";
            }
            catch { /* 없음 */ }
            if (last === today)
                return "skip: 오늘 이미 함(하루 한 번)";
            const t = S.tools.claude;
            res.ai_account = t.account ? `${t.account}${t.plan ? ` · ${t.plan}` : ""}` : null;
            if (!t.installed || !t.loggedIn)
                return "skip: 이 PC에 로그인된 Claude CLI 없음";
            const cover = (await wget(id(), "result-cover.html")) ?? "";
            const rounds0 = ((await readJson(id(), ".dynapse/TRACE.json"))?.rounds ?? []).length;
            void onChatMessage({ id: `sc-turn-${Date.now()}`, work: id(), role: "user", text: "제목 더 짧게", payload: { route: { design: ["claude"], photo: [] } } });
            // 턴 끝 기다림 — 2초 간격 로컬 확인(서버 호출 없음), 6분까지
            const t0 = Date.now();
            let started = false;
            while (Date.now() - t0 < 360_000) {
                await new Promise(r => setTimeout(r, 2000));
                const busy = [...sessions].some(([k, x]) => k.startsWith(`${id()}|`) && !!x.busy); // 세션 키는 "작업|경로"(chat.ts) if (busy && !started) { started = true; try { localStorage.setItem(AI_DAY, today); } catch { /* */ } }
                const rounds = ((await readJson(id(), ".dynapse/TRACE.json"))?.rounds ?? []).length;
                if (started && !busy && rounds > rounds0)
                    break;
            }
            const after = (await wget(id(), "result-cover.html")) ?? "";
            const title = (h) => (h.match(/data-slot\s*=\s*["']title["'][^>]*>([\s\S]*?)</i)?.[1] ?? "").replace(/<[^>]+>/g, "").trim();
            if (!started)
                return `턴이 시작되지 않음 · claude ${JSON.stringify({ i: t.installed, l: t.loggedIn, c: t.connected ?? null })} · ${lastLines(4)}`;
            if (after === cover)
                return `턴이 끝났지만 표지가 그대로 · ${lastLines()}`;
            return title(after).length <= title(cover).length ? true : `제목이 짧아지지 않음(${title(cover)} → ${title(after)})`;
        });
        if (!o.native)
            return res;
        // 7 PPTX — 내보내기 버튼과 같은 길(글꼴 받기 → verify --pptx). 결과 파일은 작업 폴더 안(.dynapse/out/export) — Downloads로 옮기지 않는다
        let pptxOk = false;
        await step("pptx", async () => {
            const { pptxFonts } = await import("./main.js");
            const { exportRender } = await import("./chat.js");
            const nf = await pptxFonts(id()).catch(() => 0);
            const r = await exportRender(id(), "pptx");
            if (!r.ok)
                return `내보내기 실패 · ${r.error ?? ""}`;
            const k = await T().core.invoke("selfcheck_pptx", { id: id() });
            pptxOk = k.staged;
            if (nf > 0 && (!k.fonts || !k.embedded))
                return `글꼴 ${nf}면을 받았는데 PPTX에 없음(fntdata ${k.fonts})`;
            if (k.lines_missing.length)
                return `줄 ${k.lines_missing.length}/${k.lines_total}이 PPTX에 없음 · ${k.lines_missing.slice(0, 3).join(" | ")}`;
            return nf > 0 ? true : "skip: 받을 글꼴 없음(줄은 맞음)";
        });
        // 7b PDF(#188 — 전체화면 창이 1200×820으로 돌아온 사고) — 내보내기 버튼과 같은 네이티브 길(export_work pdf · 점검은 작업 폴더 안에, Finder 안 엶).
        // 도는 동안 0.5초마다 메인 스레드 핑(동기 커맨드 selfcheck_mode) — 3초 넘게 막히면 실패 · 모든 창의 크기·전체화면이 전후로 같아야 한다
        await step("pdf", async () => {
            // 장 순서(#189) — {pages} 꼴 pages.json에 본문 장 순서를 바꿔 두고, PDF가 그 순서를 따르는지(숨긴 장 빼고). 끝나면 원래 목록으로
            const order0 = (await readPages(id())) ?? [], swapped = order0.length >= 3 ? [order0[0], ...order0.slice(1).reverse()] : order0;
            await wput(id(), ".dynapse/pages.json", JSON.stringify({ pages: swapped }));
            const win0 = JSON.stringify(await T().core.invoke("selfcheck_windows"));
            let done = false, gap = 0;
            const ping = (async () => { while (!done) {
                const t = Date.now();
                await T().core.invoke("selfcheck_mode").catch(() => { });
                gap = Math.max(gap, Date.now() - t);
                await new Promise(r => setTimeout(r, 500));
            } })();
            const t0 = Date.now();
            const out = await T().core.invoke("export_work", { id: id(), kind: "pdf", caption: null, name: `selfcheck-${id()}` }).catch(e => `ERR ${String(e?.message ?? e)}`);
            done = true;
            await ping;
            const win1 = JSON.stringify(await T().core.invoke("selfcheck_windows"));
            if (out.startsWith("ERR"))
                return /Chrome·Edge가 없어요/.test(out) ? "skip: PDF를 만들 Chrome·Edge 없음" : `PDF 실패 · ${out.slice(4, 100)}`;
            if (!/\.dynapse[\\/]out[\\/]export[\\/]/.test(out))
                return `PDF가 작업 폴더 밖에(${out})`;
            if (gap > 3000)
                return `내보내는 ${Math.round((Date.now() - t0) / 1000)}초 중 앱이 ${Math.round(gap / 1000)}초 멈춤`;
            const got = JSON.parse((await wget(id(), ".dynapse/out/pdf-order.json")) ?? "[]");
            await wput(id(), ".dynapse/pages.json", JSON.stringify(order0));
            if (got.join() !== swapped.join())
                return `PDF 장 순서가 pages.json과 다름 · ${got.slice(0, 4).join(",")} ≠ ${swapped.slice(0, 4).join(",")}`;
            return win0 === win1 ? true : `창이 바뀜 ${win0} → ${win1}`;
        });
        // 8 PPTX 다시 들이기 — 첨부 메시지와 같은 길(내보낸 PPTX 그대로면 장이 바뀌지 않는다)
        await step("reimport", async () => {
            if (!pptxOk)
                return "PPTX가 없어 건너뜀";
            const before = await Promise.all(pages.map(p => wget(id(), p)));
            await onChatMessage({ id: `sc-rt-${Date.now()}`, work: id(), role: "user", text: "내 PPT 내용으로 다시 만들기 · selfcheck.pptx", payload: {} });
            const after = await Promise.all(pages.map(p => wget(id(), p)));
            const changed = pages.filter((_, i) => before[i] !== after[i]);
            return changed.length ? `그대로인 PPTX인데 바뀐 장 ${changed.join(",")}` : true;
        });
        return res;
    }
    finally {
        // 9 리워드 제출 전 확인(dry run) — 점검 Task(Task 행 없음 · 0P). 장 + 앱이 읽은 tokens.css
        if (res.work)
            await step("reward_l0", async () => {
                const ps = (await readPages(id())) ?? [];
                await ensureTokens(id()); // 제출 준비와 같게 — tokens.css가 없으면 장의 토큰 블록으로 만든다(#161)
                const strip = (h) => h.replace(/(data:[a-z]+\/[a-z0-9.+-]+;base64,)[A-Za-z0-9+/=]{64,}/gi, "$1AAAA");
                const body = { task_id: "selfcheck", pages: await Promise.all(ps.map(async (f) => ({ file: f, html: strip((await wget(id(), f)) ?? "") }))), tokens: (await readTokens(id())) ?? "" };
                const r = await api("POST", "/api/device/l0", body);
                if (r.status !== 200 || !Array.isArray(r.data?.why))
                    return `L0 ${r.status}`;
                const tk = r.data.why.filter(w => /tokens\.css|CSS 변수|data-tokens/.test(w));
                return tk.length ? `토큰 사유 ${tk.length} · ${tk[0].slice(0, 80)}` : true;
            });
        // 10 정리 — 서버 작업·계정(이 PC 폴더는 네이티브가)
        await step("cleanup", async () => { const r = await http("DELETE", `${HUB}/api/app/selfcheck`, { auth: true }); S.token = null; return r.status === 200 ? true : `정리 ${r.status}`; });
    }
}
