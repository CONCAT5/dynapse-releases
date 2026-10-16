// "이 PC" 엔진(#113 · 보정 1·2) — 구독 AI가 없어도 이 PC에서 글 칸 채우기·사진. 번들 하나를 받아 두고(설치 프로그램 밖, 앱과 따로 버전),
// 글은 llama-server(필요할 때 켜고 10분 쉬면 끈다), 사진은 sd-cli(장마다 1회). 실행 파일은 네이티브가 매니페스트 해시를 확인한 뒤에만 띄운다.
// 연결 탭의 `이 PC` 칩이 상태·[받기]·[삭제]·[고치기]를 보인다(기기 보고 tools.local) — 새 화면 없음
import { api, exec, http, S, spawn, T } from "./main.js";
import { LOCAL_IDLE_MS, LOCAL_CHECK_MS } from "./limits.js";
// 엔진이 못 뜬/못 돈 이유(보정 1 표) — Windows(CUDA·백신)와 macOS(Metal) 메시지를 같은 몇 가지로
export function engineWhy(t) {
    if (/quarantine|virus|ERROR_VIRUS|os error 225|os error 226/i.test(t))
        return "av";
    if (/CUDA driver version is insufficient|no CUDA-capable device|ggml_cuda_init: failed|cudaGetDeviceCount|vkCreateInstance failed|ErrorIncompatibleDriver/i.test(t))
        return "driver";
    if (/out of memory|failed to allocate|ggml_metal.*alloc|cudaMalloc failed|ErrorOutOfDeviceMemory/i.test(t))
        return "oom";
    return "load_fail";
}
export const avPath = (e) => e.match(/quarantine:(.+)$/)?.[1] ?? "";
// 보안 프로그램이 실행 파일을 지웠다(서명 없는 Windows 번들, 2026-10-14 대표 "서명 기다리지 않고 연다") — 격리 비율을 보려고 실행할 때마다 한 줄(#116 보고)
const avBlocked = (what, path) => void import("./report.js").then(m => m.report("install", "install.av_blocked", `${L.bundle?.id ?? "?"} · ${what}${L.bundle?.unsigned ? " · unsigned" : ""}`.slice(0, 120), path ? "spawn" : null)).catch(() => { });
export const MIN_BUNDLE = "2026.10.1"; // 이 앱이 돌릴 수 있는 가장 낮은 번들(보정 2 §3) — 낮으면 `업데이트 필요`로 실행 거부
export const L = { bundle: null, state: null, probe: null, paused: false, closed: false };
const vnum = (v) => v.split(/[.+-]/).map(x => Number(x) || 0);
export const vlt = (a, b) => { const x = vnum(a), y = vnum(b); for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0))
        return (x[i] ?? 0) < (y[i] ?? 0);
} return false; };
// 이 PC에 맞는 번들 — 1차는 Apple Silicon 16GB+(보정 1 §0). 매니페스트의 tiers가 열린 것만
// Windows: NVIDIA인데 VRAM이 CUDA 티어에 모자라면 Vulkan 티어로(NVIDIA도 Vulkan이 돈다). 같은 백엔드가 먼저
export function pick(p, list) {
    const arch = p.arch === "aarch64" ? "arm64" : p.arch === "x86_64" ? "x64" : p.arch;
    const fits = (b, backend) => b.tier.os === p.os && b.tier.arch === arch && b.tier.backend === backend && p.ram_gb >= b.tier.min_ram && (!b.tier.min_vram || (p.vram_gb ?? 0) >= b.tier.min_vram);
    const best = (backend) => list.filter(b => fits(b, backend)).sort((a, b) => b.tier.min_ram - a.tier.min_ram)[0] ?? null;
    return best(p.backend) ?? (p.os === "windows" && p.backend === "cuda" ? best("vulkan") : null);
}
let reportT = null;
let onChange = () => { };
export function onLocalChange(f) { onChange = f; }
function changed() { onChange(); if (reportT)
    return; reportT = setTimeout(() => { reportT = null; report(); }, 3000); } // 기기 보고는 3초에 한 번 이하(받는 중 진행도)
let report = () => { };
export function onLocalReport(f) { report = f; }
// 기기 보고 tools.local — 연결 탭 칩이 읽는다(이름·용량·상태·예상 시간만)
export function localTool() {
    const b = L.bundle, st = L.state;
    if (L.closed || !b)
        return { offered: false };
    const ask = meteredAsk && (st?.state ?? "none") === "none"; // 종량제 확인 중 — 칩은 멈춤 + 데이터 요금 안내
    return { offered: true, bundle: b.id, version: st?.version ?? null, latest: b.version, state: L.paused ? "paused_server" : ask ? "paused" : st?.state ?? "none", done: st?.done ?? 0, total: st?.total ?? b.size ?? b.files.reduce((a, f) => a + f.size, 0),
        error: ask ? "metered" : st?.error ?? null, text: b.text?.label ?? null, photo: b.photo?.label ?? null, est: b.est ?? null, combo: L.probe ? `${L.probe.os === "macos" ? "Mac" : "Windows"} · ${L.probe.gpu ?? L.probe.backend} · ${L.probe.ram_gb}GB` : null,
        needs_update: !!st?.version && vlt(st.version, MIN_BUNDLE), disk_free_gb: L.probe?.disk_free_gb ?? null,
        ...(b.unsigned ? { unsigned: true, folder: homeDir ? `${homeDir.replace(/[\\/]+$/, "")}${L.probe?.os === "windows" ? "\\" : "/"}Dynapse` : null } : {}) }; // 서명 없는 번들 — 받기 칸에 "보안 프로그램이 막으면 이 폴더를 예외로"(보정 1 §1)
}
let meteredAsk = false, meteredOk = false;
let homeDir = null;
void (async () => { try {
    homeDir = await T().path?.homeDir?.() ?? null;
}
catch {
    homeDir = null;
} })();
export const localReady = () => !!L.bundle && L.state?.state === "ready" && !!L.state.version && !vlt(L.state.version, MIN_BUNDLE);
export const localPhotoReady = () => localReady() && !!L.bundle?.photo;
// 시작 — 이 PC 탐지 · 매니페스트 · 상태 · 빠른 검사 · (준비됐고 새 판이면) 백그라운드 업데이트
export async function initLocal() {
    let lastErr = "";
    await T().event.listen("bundle", e => {
        if (L.bundle && e.payload.id === L.bundle.id) {
            L.state = e.payload.state;
            changed();
            // 받기 실패 보고(#116 — 규칙 bundle-sha·티어 멈춤이 읽는다): engine.sha · engine.download_net · engine.disk · engine.quarantine
            const er = e.payload.state.error ?? "";
            if (e.payload.state.state === "paused" && er && er !== lastErr && er !== "cancel") {
                lastErr = er;
                const code = er === "sha" ? "engine.sha" : er.startsWith("disk") ? "engine.disk" : er.startsWith("quarantine") ? "engine.quarantine" : er.startsWith("net") ? "engine.download_net" : "engine.download_fail";
                void import("./report.js").then(m => m.report("engine", code, er.slice(0, 120)));
            }
        }
    });
    await refreshLocal(true);
    setInterval(() => { void refreshLocal(false); }, LOCAL_CHECK_MS);
}
export async function refreshLocal(first = false) {
    L.probe ??= await T().core.invoke("bundle_probe").catch(() => null);
    const r = await api("GET", "/api/engines").catch(() => null);
    if (!r?.data?.bundles || !L.probe) {
        changed();
        return;
    }
    L.paused = !!r.data.paused;
    const b = pick(L.probe, r.data.bundles);
    L.closed = !b || (r.data.closed_tiers ?? []).includes(b.id);
    L.bundle = b;
    if (!b) {
        changed();
        return;
    }
    L.state = await T().core.invoke("bundle_state", { id: b.id }).catch(() => null);
    // 받는 중에 앱이 꺼졌으면 이어받기(보정 1 §1)
    if (first && (L.state?.state === "downloading" || L.state?.state === "updating") && !L.paused)
        await install().catch(() => { });
    else if (first && L.state?.version) {
        const full = Date.now() - Number(localStorage.getItem("dyn:bundle-full") ?? 0) > 7 * 86400_000; // 주 1회 전체 해시
        L.state = await T().core.invoke("bundle_verify", { id: b.id, full }).catch(() => L.state);
        if (full)
            try {
                localStorage.setItem("dyn:bundle-full", String(Date.now()));
            }
            catch { /* */ }
    }
    // 업데이트 — 준비됨이고 서버 판이 더 높고 앱이 그 번들의 min_app 이상이면 바뀐 파일만(턴 사이에 교체는 네이티브가 끝에 원자적으로)
    if (L.state?.state === "ready" && L.state.version && vlt(L.state.version, b.version) && (!b.min_app || !vlt(S.app?.version ?? "0", b.min_app)) && !L.paused && !running)
        await install().catch(() => { });
    changed();
}
export async function install() {
    if (!L.bundle || L.paused)
        return;
    await T().core.invoke("bundle_install", { manifest: JSON.stringify({ id: L.bundle.id, version: L.bundle.version, min_app: L.bundle.min_app ?? null, files: L.bundle.files }) });
}
// 연결 탭 칩의 동작(app_action install/local/<start|cancel|delete|fix|rollback>)
export async function localAction(what) {
    if (!L.bundle)
        return;
    // 종량제(핫스팟) — 처음 [받기]는 한 번 멈추고 묻는다(칩: 데이터 요금 안내 + [다시 받기] = 동의). 동의한 뒤엔 바로
    if (what === "start" && L.probe?.metered && !meteredOk) {
        if (!meteredAsk) {
            meteredAsk = true;
            changed();
            return;
        }
        meteredOk = true;
        meteredAsk = false;
    }
    // 고치기·받기 전에 글 엔진을 끈다 — Windows는 열려 있는 모델·실행 파일을 바꾸거나 지우지 못한다
    if (what === "start" || what === "fix") {
        await stopLlama();
        await install().catch(e => console.warn("[local]", e));
    }
    else if (what === "cancel")
        await T().core.invoke("bundle_cancel").catch(() => { });
    else if (what === "delete") {
        await stopLlama();
        await T().core.invoke("bundle_delete", { id: L.bundle.id }).catch(() => { });
        L.state = { state: "none", done: 0, total: 0 };
    }
    else if (what === "rollback")
        L.state = await T().core.invoke("bundle_rollback", { id: L.bundle.id }).catch(() => L.state);
    changed();
}
// ── llama-server — 필요할 때 켜고, 10분 쉬면 끈다(메모리 반환). 127.0.0.1 임의 포트, 포트 충돌이면 5번까지 다른 포트
let llama = null;
let running = 0;
let idleT = null;
// GPU에 올릴 층 — Metal·VRAM 9GB 이상은 전부(99), CUDA 6~8GB는 모델(9B Q4 ≈ 5.7GB, 약 33층)과 KV 캐시(≈1.5GB)를 나눠 남는 만큼만(나머지는 CPU)
const gpuLayers = () => { const p = L.probe; if (!p || p.backend !== "cuda" || (p.vram_gb ?? 0) >= 9)
    return "99"; return String(Math.max(0, Math.floor(((p.vram_gb ?? 0) - 1.5) / 5.7 * 33))); };
export async function ensureLlama() {
    if (!localReady() || !L.bundle?.text)
        throw new Error("not_ready");
    if (llama && !llama.exited) {
        llama.at = Date.now();
        return llama.port;
    }
    for (let k = 0; k < 5; k++) {
        const port = 18100 + Math.floor(Math.random() * 800);
        let log = "";
        const st = { id: -1, port, at: Date.now(), exited: false };
        // 실행 파일을 못 찾거나(백신 격리 — quarantine:) 띄우지 못하면 spawn이 거절한다 → 기다리지 않고 바로 이유로
        void spawn("llama-server", ["-m", `@bundle/${L.bundle.text.file}`, "--host", "127.0.0.1", "--port", String(port), "-c", "8192", "-ngl", gpuLayers(), "--jinja", "--no-webui"], "", null, l => { log = (log + l + "\n").slice(-4000); }, id => { st.id = id; }).then(() => { st.exited = true; if (llama === st)
            llama = null; lastLog = log; })
            .catch(e => { log += `\n${String(e)}`; st.exited = true; lastLog = log; });
        for (let i = 0; i < 240 && !st.exited; i++) {
            const h = await http("GET", `http://127.0.0.1:${port}/health`).catch(() => null);
            if (h?.status === 200) {
                llama = st;
                idleT ??= setInterval(() => { if (llama && !running && Date.now() - llama.at > LOCAL_IDLE_MS)
                    void stopLlama(); }, 60_000);
                return port;
            }
            await new Promise(r => setTimeout(r, 500));
        }
        if (!st.exited) {
            await T().core.invoke("run_kill", { id: st.id }).catch(() => { });
        }
        // bind 실패만 다른 포트로(Windows: "only one usage of each socket address") — 나머지는 이유로
        if (!/bind|address already in use|only one usage of each socket address/i.test(lastLog || log)) {
            const why = engineWhy(log);
            if (why === "av") {
                lastAv = avPath(log);
                avBlocked("llama-server", lastAv);
            }
            throw new Error(why);
        }
    }
    throw new Error("port");
}
export let lastLog = "";
export let lastAv = ""; // 백신이 막은 폴더(안내에 그대로 보인다)
// 메모리 양보(#137 §4) — 작업 화면을 띄우기 전 남은 메모리가 2GB 아래면, 쉬고 있는 이 PC 엔진(llama-server)을 먼저 끈다(돌고 있는 일은 건드리지 않는다)
export async function yieldMemory() {
    if (!llama || running)
        return false;
    const l = await T().core.invoke("machine_load").catch(() => null);
    if (!l || l.free_mb >= 2048)
        return false;
    await stopLlama();
    return true;
}
export async function stopLlama() { if (llama && llama.id >= 0)
    await T().core.invoke("run_kill", { id: llama.id }).catch(() => { }); llama = null; }
export function busyLocal(d) { running = Math.max(0, running + d); if (llama)
    llama.at = Date.now(); }
// 한 번 묻기 — JSON schema로 모양을 강제(문법). 요청 본문은 파일로(Windows 명령줄 길이 한도)
// 같은 요청을 두 번 돌려도 같은 결과(#113 보정 5 §2) — temperature 0 · seed 고정. 되돌리기·비교가 뜻을 가진다
export async function llamaJson(id, messages, schema, maxTokens = 3000) {
    const port = await ensureLlama();
    const body = JSON.stringify({ messages, temperature: 0, seed: 42, max_tokens: maxTokens, response_format: { type: "json_schema", json_schema: { name: "slots", schema } }, chat_template_kwargs: { enable_thinking: false } });
    const rel = ".dynapse/llm-req.json"; // 한 번에 하나(글 러너는 직렬)
    await T().core.invoke("work_write", { id, file: rel, text: body }).catch(() => { });
    const wd = await T().core.invoke("work_dir", { id });
    const r = await http("POST", `http://127.0.0.1:${port}/v1/chat/completions`, { file: `${wd}/${rel}`, contentType: "application/json" });
    void T().core.invoke("work_write", { id, file: rel, text: "" }).catch(() => { });
    if (r.status !== 200)
        throw new Error(`llm_${r.status}`);
    const j = JSON.parse(r.body);
    return { json: JSON.parse(j.choices?.[0]?.message?.content ?? "{}"), tokens: j.usage?.completion_tokens ?? 0 };
}
// 사진 — sd-cli 한 번(작업 폴더 안 상대 경로로 저장). 실패하면 이유 분류
export async function sdImage(id, prompt, out, w, h) {
    const p = L.bundle?.photo;
    if (!localPhotoReady() || !p)
        return { ok: false, why: "not_ready", ms: 0 };
    await stopLlama(); // 글 엔진과 사진 엔진은 동시에 돌리지 않는다(보정 1 §2 — 메모리)
    const t0 = Date.now();
    const dir = await T().core.invoke("work_dir", { id });
    const r = await exec("sd-cli", ["--diffusion-model", `@bundle/${p.files.diffusion}`, "--vae", `@bundle/${p.files.vae}`, "--llm", `@bundle/${p.files.llm}`, "-p", prompt.slice(0, 900),
        "--cfg-scale", "1.0", "--steps", String(p.steps ?? 4), "-W", String(w), "-H", String(h), "-o", out, ...(L.probe?.backend === "cuda" && (L.probe.vram_gb ?? 0) < 9 ? ["--offload-to-cpu"] : [])], undefined, dir); // VRAM 6~8GB — 모델을 CPU에 두고 단계마다 올린다.catch(e => ({ code: -1, stdout: "", stderr: String(e) }));
    const ms = Date.now() - t0;
    if (r.code === 0)
        return { ok: true, ms };
    const why = engineWhy(r.stderr);
    if (why === "av") {
        lastAv = avPath(r.stderr);
        avBlocked("sd-cli", lastAv);
    }
    return { ok: false, ms, why: why === "load_fail" ? "run_fail" : why };
}
// 업데이트 뒤 연속 실패 3번이면 이전 판으로(보정 1 §2 · 보정 2 §2) — 되돌린 뒤엔 다시 세지 않는다
let fails = 0;
export async function noteEngineResult(ok) {
    if (ok) {
        fails = 0;
        return;
    }
    if (++fails < 3 || !L.bundle || !L.state?.previous)
        return;
    fails = 0;
    L.state = await T().core.invoke("bundle_rollback", { id: L.bundle.id }).catch(() => L.state);
    const { report } = await import("./report.js");
    report("engine", "engine.rollback", `${L.bundle.id}`);
    changed();
}
