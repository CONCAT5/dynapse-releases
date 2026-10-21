// Dynapse 데스크톱 — 브릿지 (WORKORDER #11 B' · #12-Z). 결과를 보고·고치고·공개하는 화면은 웹 /works/⟨id⟩ 하나.
// 앱 = 실행(공식 CLI) + 로컬 브릿지(127.0.0.1, bridge.rs) + 동기화. 창은 두 줄 상태 창(내 AI 줄 + 실행 줄) — 화면 HTML은 home.ts.
// 실행 경로는 하나(#20): 작업실 메시지(웹 → 서버 → SSE) → chat.ts 세션. 딥링크는 connect·open·folder·export 넷뿐, 확인 카드 없음(사용자가 보낸 메시지 = 자동 실행).
// 원칙: AI 로그인은 각 CLI의 공식 플로우 · 결과 파일은 이 기기에만(동기화는 켠 경우만).
import { flushReports, onOtaBad, report, tally } from "./report.js";
import { backoff, backoffReset, netFromCurl, netMark, netQueueInit, netState, onNet, probeSoon, queueFromUrl, queuedCount, requeue, setProbe, takeQueue } from "./net.js";
import { initLocal, localAction, localTool, onLocalReport } from "./engines.js";
import { ONB } from "./shared/onb.js";
import { DETECT_MS, EVENTS_FAIL_MS, EVENTS_RETRY_MS, HEARTBEAT_MS, IDLE_SLOW_MS, IDLE_STOP_MS, OTA_EVERY_MS, OTA_FIRST_MS, PULL_MIN_MS, UPDATE_EVERY_MS, UPDATE_FIRST_MS } from "./limits.js";
import { assemblyHtml, mainHtml } from "./onboard.js";
import { diagAuto, diagReport } from "./diag.js";
import { G, GIT_INSTALL_URL, detectAllGit, detectGit, gitBody } from "./git.js";
import { viewerSaved, askCompatOnce, bundlesOf, readJson, postChat, wput, wget, retryPendingPulls, appVerify, exportRender, backfill, chatActive, importStart, ensureVerify, idleSessions, onChatMessage, openWeb, replayWaiting, sessions, sharedWorks, syncAll, readPages } from "./chat.js";
// 엔진 창(main)이 숨어도 멈추지 않게 — 풀리지 않는 WebLock을 쥔 페이지는 WebView2가 동결하지 않는다(wry 권장 우회, #34 B4)
void navigator.locks?.request("dynapse-engine", () => new Promise(() => { }));
// 도메인 바꿀 때 같이: src-tauri/src/bridge.rs ORIGINS(새 주소 맨 앞) · capabilities/inapp.json remote.urls (#35 B4)
// 새 주소가 이 PC에서 안 열리면(도메인 직후 DNS 캐시 등) 옛 주소로 — 켤 때 한 번 확인하고, 옛 주소면 10분마다 다시(pickHub)
export const HUB_NEW = "https://dynapse.ai", HUB_OLD = "https://ai-task-hub-nu.vercel.app";
export let HUB = HUB_NEW;
export let MCP_URL = `${HUB}/api/mcp`;
const reach = async (u) => (await exec("curl", ["-s", "-o", navigator.userAgent.includes("Windows") ? "NUL" : "/dev/null", "-m", "5", "-w", "%{http_code}", `${u}/api/fonts`]).catch(() => ({ stdout: "" }))).stdout.trim() === "200";
export async function pickHub() {
    const next = (await reach(HUB_NEW)) ? HUB_NEW : (await reach(HUB_OLD)) ? HUB_OLD : HUB_NEW;
    if (next !== HUB) {
        HUB = next;
        MCP_URL = `${HUB}/api/mcp`;
        console.log("[hub]", HUB);
    }
    if (HUB !== HUB_NEW && !rePick) {
        rePick = true;
        setTimeout(() => { rePick = false; void pickHub(); }, 10 * 60_000);
    } // 옛 주소 쓰는 동안 10분마다(예약은 하나만)
}
let rePick = false;
// 설치 = 원클릭(2026-09-28 대표 결정, 09-24 "공식 페이지만"을 바꿈) — [설치하기]가 공식 설치 스크립트를 보이는 창에서(runner.rs open_install). 이 페이지는 창을 못 열 때만. URL은 응답 200 확인
const INSTALL_URL = { claude: "https://code.claude.com/docs/en/setup", codex: "https://developers.openai.com/codex/cli", agy: "https://antigravity.google/docs/getting-started?tab=cli" };
const AI_NAME = { claude: "Claude", codex: "ChatGPT" }; // 사용자에게는 쓰는 AI 이름으로
const CAPS = { claude: ["편집"], codex: ["사진", "편집"] };
const capsText = (c) => c.join("·");
const RUNNER_NAME = { claude: "Claude Code", codex: "Codex" }; // 실제로 도는 공식 도구
export const WORK_ID = /^[A-Za-z0-9_-]{4,64}$/;
// 계정 한 줄(#22-보정 15) — CLI가 알려 주는 값만. 이메일은 가운데를 가린다(kw***@concat.kr). 자격증명 파일은 읽지 않는다
const maskEmail = (e) => { const [u, d] = e.split("@"); return d ? `${u.slice(0, 2)}***@${d}` : null; };
const switching = {};
export const S = {
    myAis: [], // 계정이 다른 PC에서 쓰던 AI(#142 — 새 PC는 로그인만)
    token: null,
    refresh: null,
    deviceId: "",
    handle: null,
    defaultModels: {},
    photoLimits: {}, // 사진 AI 한도(#22-보정 2) — { gemini: "2026-09-26" } 그날 자정까지                            // 홈 AI 카드에서 고른 기본 모델(#21 보정 12) — 작업에서 따로 안 고르면 이것
    browsers: [], // 연결된 브라우저(#20) — 프로필 팝오버
    tools: {
        claude: { checked: false, installed: false, loggedIn: null, connected: null, version: "" },
        codex: { checked: false, installed: false, loggedIn: null, connected: null, version: "" },
    },
    ag: { checked: false, installed: false, loggedIn: null, connected: false, version: "", desktop: false },
    minVersions: {},
    hubMsg: "",
    hubBusy: false,
    recent: [],
    pop: null,
    models: {}, // CLI가 알려 준 모델(#18)
    claudeLimit: null, // Claude rate_limit_event(남은 양 — 실측상 Claude만 준다)
    sync: false,
    thumbUpload: true, // 작은 미리보기 업로드(#20 보정 2 — 기본 켜짐, 웹 상태 팝오버에서 끈다)                           // 클라우드 프라이빗 동기화(#12-Z Z3) — 웹 [동기화 켜기]를 기기 보고 응답으로 안다
    bridge: null, // 로컬 브릿지(bridge.rs) — 기기 보고로 서버에 알린다
    git: false, // 작업 폴더 = 저장소(#12-AE) — git이 없으면 스냅샷 폴더로 폴백
    app: null,
    channel: "stable",
    updateReady: null,
    updateFail: false, installing: false, // 자동 업데이트가 안 됨(#185 C 보정 1) — 한 줄 + [설치 파일 받기] · 받은 뒤 "설치가 끝나면 다시 열려요"
    toast: "",
    onboard: null,
    installStep: {}, // 설치 사다리(#134) — 지금 몇 번째 방법(1~3)
    installFail: {}, // 설치 창이 남긴 실패(#41 A) — 카드가 [다시 설치] + 로그
};
let busySent = null;
export let store;
const $app = document.getElementById("app");
const $top = document.getElementById("top");
export const T = () => window.__TAURI__;
// ───────────── 유틸 ─────────────
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const rand = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));
export function toast(msg) {
    S.toast = msg;
    render();
    setTimeout(() => { if (S.toast === msg) {
        S.toast = "";
        render();
    } }, 3500);
}
export const exec = (program, args, stdin, cwd) => T().core.invoke("run_exec", { program, args, stdin: stdin ?? null, cwd: cwd ?? null });
const procs = new Map();
const early = new Map();
const buffer = (id) => { if (!early.has(id))
    early.set(id, { lines: [] }); return early.get(id); };
async function listenRunner() {
    await T().event.listen("runner-line", ({ payload: p }) => {
        const h = procs.get(p.id);
        if (h)
            h.line(p.line);
        else
            buffer(p.id).lines.push(p.line);
    });
    await T().event.listen("runner-exit", ({ payload: p }) => {
        const h = procs.get(p.id);
        if (h) {
            procs.delete(p.id);
            h.exit(p.code);
        }
        else
            buffer(p.id).exit = p.code;
    });
}
// keep = stdin을 열어 둔다(#14 대화 세션 — run_write로 한 줄씩, run_close_stdin으로 끝)
export async function spawn(program, args, stdin, cwd, onLine, onStart, keep = false) {
    const id = await T().core.invoke("run_spawn", { program, args, stdin: keep && !stdin ? null : stdin, cwd, keepStdin: keep });
    onStart(id);
    return new Promise((resolve) => {
        const b = early.get(id);
        early.delete(id);
        b?.lines.forEach(onLine);
        if (b && "exit" in b) {
            resolve(b.exit ?? null);
            return;
        }
        procs.set(id, { line: onLine, exit: resolve });
    });
}
export async function http(method, url0, o = {}, retried = false) {
    const url = HUB !== HUB_NEW && url0.startsWith(HUB_NEW) ? HUB + url0.slice(HUB_NEW.length) : url0; // 서버가 준 새 주소(업로드 등)도 이 PC가 여는 주소로
    const args = ["-sS", "-X", method, url, "-w", "\n%{http_code}"];
    // 큰 본문은 표준 입력으로(2026-10-20 Windows 자가 점검 — 리워드 제출 본문이 명령줄 한도 32K를 넘어 "파일 이름이나 확장명이 너무 깁니다(os error 206)")
    const body = o.json !== undefined ? JSON.stringify(o.json) : null, viaStdin = body !== null && body.length > 6000;
    if (body !== null)
        args.push("-H", "content-type: application/json", "--data-binary", viaStdin ? "@-" : body);
    if (o.form)
        for (const [k, v] of Object.entries(o.form))
            args.push("--data-urlencode", `${k}=${v}`);
    if (o.file)
        args.push("-H", `content-type: ${o.contentType ?? "application/octet-stream"}`, "--data-binary", `@${o.file}`);
    if (o.sse)
        args.push("-H", "accept: application/json, text/event-stream");
    for (const h of o.headers ?? [])
        if (/^[a-z-]{2,40}: [^\r\n]{0,200}$/i.test(h))
            args.push("-H", h);
    if (o.out)
        args.push("-L", "--create-dirs", "-o", o.out);
    if (o.out && o.keep)
        args.push("--fail"); // 받기(#170 — 서버의 423 오류 본문이 .dynapse/pages.json에 그대로 써졌다): 실패 응답은 파일에 쓰지 않는다                // materials/·.dynapse/photos/ 하위 경로도(동기화 받기)
    if (o.auth && S.token)
        args.push("-H", `@${await T().core.invoke("auth_header_file", { token: S.token })}`);
    const r = await exec("curl", args, viaStdin ? body : undefined);
    const hub = url.startsWith(HUB); // 연결 상태(#146)는 우리 서버로 가는 요청으로만 판단 — 남의 주소(사진·글)가 막힌 것은 오프라인이 아니다
    if (r.code !== 0 && !(o.keep && r.code === 22)) {
        const n = hub && typeof r.code === "number" ? netFromCurl(r.code, r.stderr) : null;
        if (n) {
            netMark(n);
            queueFromUrl(method, url);
        }
        throw new Error(`네트워크 오류: ${r.stderr.trim() || r.code}`);
    }
    const i = r.stdout.lastIndexOf("\n");
    const res = { status: Number(r.stdout.slice(i + 1)), body: r.stdout.slice(0, i) };
    if (hub)
        netMark(res.status === 407 ? "blocked" : "online");
    // 토큰 만료 → refresh 후 한 번만 다시 (서버는 인증이 필요한 요청에 401을 준다)
    if (res.status === 401 && o.auth && S.refresh && !retried && (await refreshToken()))
        return http(method, url, o, true);
    return res;
}
export async function api(method, path, json) {
    const r = await http(method, `${HUB}${path}`, { json, auth: true });
    let data = null;
    try {
        data = JSON.parse(r.body);
    }
    catch { /* 빈 본문 */ }
    return { status: r.status, data };
}
export async function mcp(name, args = {}) {
    const r = await http("POST", MCP_URL, {
        json: { jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args } }, auth: true, sse: true,
    });
    if (r.status === 401)
        return { isError: true, text: "Dynapse 연결이 필요해요" };
    const line = r.body.split("\n").find(l => l.startsWith("data: "));
    const msg = JSON.parse(line ? line.slice(6) : r.body);
    if (msg.error)
        throw new Error(msg.error.message ?? "커넥터 오류");
    const text = msg.result?.content?.[0]?.text ?? "";
    let data;
    try {
        data = JSON.parse(text);
    }
    catch { /* 문자열 응답 */ }
    return { isError: !!msg.result?.isError, text, data };
}
// ───────────── AI 도구: 감지 · 공식 로그인 · Dynapse 연결(MCP 등록) ─────────────
// 데스크톱 앱 흔적(CLI 없을 때만 본다, 30초 캐시) — "ChatGPT 앱은 있어요 · CLI 하나만 더"(2026-09-28 다른 Windows PC: Codex 데스크톱 앱만 있어 계속 "설치 필요")
let apps = null;
async function desktopApps() {
    if (!apps || Date.now() - apps.at > 30_000)
        apps = { at: Date.now(), v: await T().core.invoke("desktop_apps").catch(() => ({ claude: false, codex: false, antigravity: false })) };
    return apps.v;
}
// 원클릭 설치(2026-09-28 대표 결정) — 공식 설치 스크립트를 보이는 창에서. 창을 못 열면 예전처럼 공식 페이지
const installWatch = {};
async function installCli(id) {
    const tool = id === "gemini" ? "agy" : id;
    const had = !!S.installFail[tool];
    delete S.installFail[tool];
    render();
    if (had)
        void reportDevice();
    // 설치 사다리(#134 보정 2) — 사람이 명령을 치지 않는다: 1) 공식 설치를 창 없이 2) 이식형 Node+npm(npm만 열린 회사망) 3) 설치 창 4) 카드(복사할 명령 · IT 한 줄).
    // 막히는 단계는 바로 다음으로 · 카드는 "설치 중 · n/4 방법 시도"만 · 단계마다 실패 보고(install.stepN_fail). 0.1.74 네이티브엔 1·2단계가 없어 곧장 3단계
    const found = async () => { apps = null; if (tool === "agy")
        await agDetect();
    else
        await detect(tool); return tool === "agy" ? S.ag.installed : S.tools[tool].installed; };
    for (const [n, step] of [[1, "script"], [2, "npm"]]) {
        if (step === "npm" && tool === "agy")
            continue; // Gemini(Antigravity) CLI는 npm 패키지가 없다
        S.installStep[tool] = n;
        render();
        const r = await T().core.invoke("install_silent", { tool, step }).then(() => "ok").catch(e => String(e));
        await T().core.invoke("install_result", { tool }).catch(() => null); // 이번 결과 파일은 여기서 치운다(설치 창 감시가 옛 결과를 읽지 않게)
        if (/sim: 없는 명령|not found|unknown command|not allowed/i.test(r))
            break; // 옛 네이티브 — 창으로
        if (r === "ok" && await found()) {
            delete S.installStep[tool];
            render();
            void reportDevice();
            return;
        }
        report("install", `install.step${n}_fail`, r === "ok" ? "not_found" : r.slice(0, 160));
    }
    S.installStep[tool] = 3;
    render();
    const opened = await T().core.invoke("open_install", { tool }).then(() => true).catch(() => { void T().shell.open(INSTALL_URL[tool]); return false; });
    apps = null;
    if (opened)
        void watchInstall(tool);
    else {
        report("install", "install.step3_fail", "window");
        delete S.installStep[tool];
        S.installFail[tool] = { status: "fail:all", log: "" };
        render();
    }
}
// 설치 창이 끝나면 결과 파일을 남긴다 — 2초마다 본다(최대 15분, 다시 누르면 새 감시로 바뀜). 성공이면 곧바로 감지, 실패면 카드가 이유를 안다
async function watchInstall(tool) {
    const me = (installWatch[tool] = (installWatch[tool] ?? 0) + 1);
    const until = Date.now() + 15 * 60_000, gaveUp = Date.now() + 120_000;
    while (Date.now() < until && installWatch[tool] === me) {
        await new Promise(r => setTimeout(r, 2000));
        const r = await T().core.invoke("install_result", { tool }).catch(() => null);
        // 2분이 지나도 결과가 없으면 카드로 넘긴다(설치는 창에서 계속 — 끝나면 이 감시가 받는다) · 실패 보고 한 번
        if (!r && Date.now() > gaveUp && installWatch[tool] === me && S.installStep[tool] === 3) {
            delete S.installStep[tool];
            S.installFail[tool] = { status: "fail:slow", log: "" };
            report("install", "install.step3_fail", "no_result_2min");
            render();
        }
        if (!r || installWatch[tool] !== me)
            continue;
        delete S.installStep[tool];
        if (r.status === "ok") {
            apps = null;
            if (tool === "agy")
                await agDetect();
            else
                await detect(tool);
            const found = tool === "agy" ? S.ag.installed : S.tools[tool].installed;
            if (!found) {
                S.installFail[tool] = { status: "missing", log: "" };
                void diagAuto({ tool, stage: "install", code: "missing_after_install", summary: "설치 창은 끝났는데 명령을 찾지 못했어요" });
            }
        }
        else {
            report("install", "install.step3_fail", r.status.slice(0, 40));
            S.installFail[tool] = { status: r.status.startsWith("fail:") ? r.status : "fail:other", log: r.log };
            void diagAuto({ tool, stage: "install", code: S.installFail[tool].status, log: r.log });
        } // 진단(대표 2026-10-04) — 요약만 자동
        render();
        void reportDevice();
        return;
    }
}
async function installRecheck(tool) {
    apps = null;
    if (tool === "agy")
        await agDetect();
    else
        await detect(tool);
    if (tool === "agy" ? S.ag.installed : S.tools[tool].installed)
        delete S.installFail[tool];
    render();
    void reportDevice();
}
export async function detect(id) {
    const t = S.tools[id];
    const v = await exec(id, ["--version"]).catch(() => null);
    t.installed = !!v && v.code === 0;
    if (v && v.code !== 0)
        void diagAuto({ tool: id, stage: "detect", code: `version_exit:${v.code}`, log: `${v.stderr ?? ""}\n${v.stdout ?? ""}` }); // 있는데 안 도는 CLI(경로·권한·런타임)
    t.desktop = !t.installed && (await desktopApps())[id];
    t.version = t.installed ? v.stdout.trim().split("\n")[0] : "";
    t.loggedIn = null;
    t.connected = null;
    if (t.installed && id === "claude") {
        // 실측: `claude auth status --json` → { "loggedIn": true, ... }
        const r = await exec("claude", ["auth", "status", "--json"]).catch(() => null);
        try {
            const j = r ? JSON.parse(r.stdout) : {};
            t.loggedIn = j.loggedIn === true;
            t.account = t.loggedIn && typeof j.email === "string" ? maskEmail(j.email) : null;
            t.plan = t.loggedIn && typeof j.subscriptionType === "string" ? j.subscriptionType.slice(0, 20) : null;
        }
        catch {
            t.loggedIn = null;
            t.account = null;
            t.plan = null;
        }
    }
    if (t.installed && id === "codex") {
        // 실측: 로그인 시 `codex login status` → exit 0 + "Logged in using …" (미로그인 문구는 실측 전)
        const r = await exec("codex", ["login", "status"]).catch(() => null);
        t.loggedIn = !!r && r.code === 0 && /Logged in/i.test(r.stdout + r.stderr);
        // 실측: "Logged in using ChatGPT" — 이메일은 주지 않는다
        t.account = t.loggedIn ? (/ChatGPT/i.test(r.stdout + r.stderr) ? "ChatGPT 계정" : "API 키") : null;
        t.plan = null;
    }
    if (t.installed) {
        // 실측(claude 2.1.118 · codex-cli 0.156.1): `mcp get <이름>` — 등록이 없으면 exit 1
        const g = await exec(id, ["mcp", "get", "dynapse"]).catch(() => null);
        t.connected = !!g && g.code === 0;
    }
    t.checked = true;
    render();
}
// 숨은 로그인(#135 §7) — 터미널 없이 공식 CLI 로그인(claude auth login · codex login)을 창 없는 프로세스로. CLI가 브라우저를 열고,
// 앱은 출력에서 로그인 주소를 잡아 [브라우저 다시 열기]에 쓴다. 코드를 붙여 달라는 CLI면 카드의 칸이 그 프로세스 입력으로 간다. 2초마다 확인(최대 3분) 뒤엔 "끝났나요?" 한 줄
export const loginLive = {};
async function pacProxy(url) {
    if (!/^https?:\/\//.test(url))
        return null;
    const r = await http("GET", url).catch(() => null);
    if (!r || r.status !== 200 || r.body.length > 200_000)
        return null;
    const helpers = `function dnsDomainIs(h,d){return h.length>=d.length&&h.substring(h.length-d.length)===d}function shExpMatch(s,p){return new RegExp("^"+p.replace(/[.+^\${}()|[\\]\\\\]/g,"\\\\$&").replace(/\\*/g,".*").replace(/\\?/g,".")+"$").test(s)}function isPlainHostName(h){return h.indexOf(".")<0}function localHostOrDomainIs(h,d){return h===d||d.indexOf(h+".")===0}function isResolvable(){return true}function dnsResolve(){return null}function myIpAddress(){return "127.0.0.1"}function isInNet(){return false}function dnsDomainLevels(h){return h.split(".").length-1}function weekdayRange(){return true}function dateRange(){return true}function timeRange(){return true}`;
    const src = `<script>${helpers}\n${r.body.replace(/<\/script/gi, "")}\ntry{parent.postMessage({pac:String(FindProxyForURL("https://auth.openai.com/","auth.openai.com"))},"*")}catch(e){parent.postMessage({pac:""},"*")}<\/script>`;
    return new Promise(ok => {
        const fr = document.createElement("iframe");
        fr.setAttribute("sandbox", "allow-scripts");
        fr.style.display = "none";
        const done = (v) => { removeEventListener("message", on); fr.remove(); ok(v); };
        const on = (e) => { if (e.source !== fr.contentWindow)
            return; const m = String(e.data?.pac ?? "").match(/PROXY\s+([^;\s]+)/i); done(m ? `http://${m[1]}` : null); };
        addEventListener("message", on);
        setTimeout(() => done(null), 3000);
        fr.srcdoc = src;
        document.body.appendChild(fr);
    });
}
export async function netFix(level) {
    let r = await T().core.invoke("net_fix", { level }).catch(() => null);
    if (r && !r.proxy && r.pac && !/windows/i.test(S.app?.os ?? "")) {
        const p = await pacProxy(r.pac).catch(() => null);
        if (p)
            r = await T().core.invoke("net_fix", { level, proxy: p }).catch(() => r);
    }
    if (!r)
        return null;
    if (level > ((await store.get("net_level").catch(() => 0)) ?? 0)) {
        await store.set("net_level", level).catch(() => { });
        await store.save().catch(() => { });
    }
    if (level > 0 || r.proxy || r.pac)
        report("install", "install.net_fix", `level=${level} proxy=${r.proxy ? "yes" : "no"} pac=${r.pac ? "yes" : "no"} ca=${r.ca_count} ${r.notes.join(",")}`);
    return r;
}
// 로그인 실패 이유(#142) — CLI 출력에서: 회사망이 OpenAI·Anthropic 로그인 서버를 막음(토큰 교환 실패) · 회사(워크스페이스) 계정이 막힘
export const loginWhy = (t) => /token exchange failed|error sending request|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|certificate|self[- ]signed|proxy/i.test(t) ? "network" : /workspace|routing discovery|unauthorized|forbidden|not allowed/i.test(t) ? "workspace" : null;
const setLogin = (id, v) => { S.tools[id].login = v; render(); void reportDevice(); };
async function loginHidden(id, retried = false) {
    // 한 번에 하나(#142 — 진행이 안 보여 [연결]을 여러 번 눌러 로그인 서버가 겹쳤다): 도는 중이면 새로 띄우지 않고 브라우저만 다시 연다
    const old = loginLive[id];
    if (old && !old.exited && Date.now() - old.at < 180_000) {
        if (old.url)
            await T().shell.open(old.url).catch(() => { });
        toast("이미 로그인 중이에요 · 브라우저를 확인하세요");
        return false;
    }
    if (old && !old.exited)
        await T().core.invoke("run_kill", { id: old.pid }).catch(() => { });
    const st = { pid: -1, url: null, at: Date.now(), stale: false, exited: false, why: null };
    let started = false, failed = false;
    setLogin(id, { state: "running", at: Date.now() });
    void spawn(id, id === "claude" ? ["auth", "login", "--claudeai"] : ["login"], "", null, l => {
        const u = l.match(/https:\/\/[^\s"'<>)\]]+/)?.[0];
        if (u && !st.url && !/localhost|127\.0\.0\.1/.test(u)) {
            st.url = u;
            render();
        }
        const w = loginWhy(l);
        if (w && !st.why) {
            st.why = w;
            void diagAuto({ tool: id, stage: "login", code: `login_${w}`, summary: l.slice(0, 200) });
        }
    }, pid => { st.pid = pid; started = true; }, true).then(() => { st.exited = true; render(); }).catch(() => { failed = true; });
    for (let i = 0; i < 20 && !started && !failed; i++)
        await new Promise(r => setTimeout(r, 100));
    if (!started)
        return null; // 못 띄웠다 — 예전처럼 터미널 창으로
    loginLive[id] = st;
    render();
    const until = Date.now() + 180_000;
    while (Date.now() < until) {
        await new Promise(r => setTimeout(r, 2000));
        await detect(id);
        // 로그인됨으로 보여도 로그인 프로그램은 스스로 끝날 때까지 둔다(#204 보정 1 — 예전 자격증명이 보이는 순간 끄면 브라우저가 돌아올 localhost:1455가 닫혀 ERR_CONNECTION_REFUSED). 최대 90초
        if (S.tools[id].loggedIn) {
            for (let i = 0; i < 45 && !st.exited; i++)
                await new Promise(r => setTimeout(r, 2000));
            if (!st.exited)
                void T().core.invoke("run_kill", { id: st.pid }).catch(() => { });
            delete loginLive[id];
            setLogin(id, null);
            // 연결되면 기다리던 요청이 저절로(#142 추가 1 — 다시 칠 필요 없음) · 앱을 앞으로
            if (S.tools[id].connected !== true)
                await connectTool(id, true).catch(() => false);
            void replayWaiting();
            void T().core.invoke("go_web").catch(() => { });
            return true;
        }
        // 네트워크로 막힘 — 회사망을 맞추고(레벨 1) 한 번 더 스스로(사람은 아무것도 안 한다). 그래도 막히면 이유 + 다른 길
        if (st.why === "network" && !retried) {
            if (!st.exited)
                await T().core.invoke("run_kill", { id: st.pid }).catch(() => { });
            delete loginLive[id];
            setLogin(id, { state: "running", at: Date.now() });
            toast("회사망에 맞추는 중이에요 · 다시 로그인해요");
            await netFix(1);
            return loginHidden(id, true);
        }
        if (st.why) {
            setLogin(id, { state: "failed", why: st.why, at: Date.now() });
            return false;
        } // 막힘 — 카드가 이유와 다른 길(이 PC·다른 AI)을 보인다
        if (st.skip) {
            setLogin(id, null);
            return false;
        } // [이건 건너뛰기]
        if (st.exited && Date.now() - st.at < 8000) {
            setLogin(id, null);
            return null;
        } // 바로 끝났다(이 CLI가 창 없이는 안 됨) — 터미널로
        if (st.exited) {
            await detect(id);
            if (S.tools[id].loggedIn)
                continue;
            // 로그인 프로그램이 먼저 끝났다(#204 보정 1 — 브라우저가 돌아올 곳이 없어진다) — 한 번은 스스로 다시 띄운다(새 브라우저 창 · 한 줄)
            if (!retried && !st.why) {
                delete loginLive[id];
                toast(`${AI_NAME[id]} 로그인 창이 닫혀 다시 열었어요`);
                report("app", "login.restart", id);
                return loginHidden(id, true);
            }
            setLogin(id, { state: "failed", why: st.why ?? "other", at: Date.now() });
            return false;
        } // 로그인 프로그램이 끝났는데 로그인 안 됨 — 3분 기다리지 않는다
    }
    st.stale = true;
    setLogin(id, { state: "failed", why: "timeout", at: Date.now() });
    void diagAuto({ tool: id, stage: "login", code: "login_timeout", summary: "숨은 로그인 3분 동안 확인되지 않았어요", cli: S.tools[id].version || null });
    return false;
}
export async function loginPaste(id, code) {
    const st = loginLive[id];
    if (!st || st.exited || !code.trim())
        return;
    await T().core.invoke("run_write", { id: st.pid, line: code.trim() }).catch(() => { });
}
export async function openLogin(id) {
    if (id === "claude" || id === "codex") {
        const r = await loginHidden(id).catch(() => null);
        if (r !== null)
            return r;
    }
    try {
        await T().core.invoke("open_login", { tool: id });
    }
    catch (e) {
        toast(String(e));
        void diagAuto({ tool: id, stage: "login", code: "open_login_fail", summary: String(e) });
        return false;
    }
    // 돌아와서 누를 필요 없게 2초마다 재검사(최대 3분) — 사용자가 누른 뒤에만 도는 로컬 확인
    const until = Date.now() + 180_000;
    while (Date.now() < until) {
        await new Promise(r => setTimeout(r, 2000));
        await detect(id);
        if (S.tools[id].loggedIn) {
            reportDevice();
            return true;
        }
    }
    void diagAuto({ tool: id, stage: "login", code: "login_timeout", summary: "로그인 창을 연 뒤 3분 동안 로그인이 확인되지 않았어요", cli: S.tools[id].version || null });
    return false;
}
async function connectTool(id, quiet = false) {
    // 그 도구의 MCP 설정에 Dynapse 서버를 등록 — 실측한 공식 명령만
    const args = id === "claude"
        ? ["mcp", "add", "--transport", "http", "-s", "user", "dynapse", MCP_URL]
        : ["mcp", "add", "dynapse", "--url", MCP_URL];
    const r = await exec(id, args).catch(e => ({ code: -1, stdout: "", stderr: String(e) }));
    if (r.code !== 0 && !/already exists/i.test(r.stdout + r.stderr)) {
        toast(`연결하지 못했어요: ${(r.stderr || r.stdout).trim().slice(0, 120)}`);
        return false;
    }
    await detect(id);
    if (!quiet)
        toast(`${AI_NAME[id]} 연결됨`);
    reportDevice();
    return true;
}
const semver = (v) => (v.match(/(\d+)\.(\d+)\.(\d+)/) ?? []).slice(1).map(Number);
function older(v, min) {
    const a = semver(v), b = semver(min);
    if (a.length < 3 || b.length < 3)
        return false;
    for (let i = 0; i < 3; i++)
        if (a[i] !== b[i])
            return a[i] < b[i];
    return false;
}
const isOld = (id) => { const m = S.minVersions[id]; return !!m && S.tools[id].installed && older(S.tools[id].version, m); };
async function loadMinVersions() {
    // 서버가 받아 주는 최소 버전 — 공개 정보라 연결 전(401 본문)에도 온다
    const r = await http("GET", `${HUB}/api/device`).catch(() => null);
    try {
        const j = JSON.parse(r.body);
        if (j.min_versions)
            S.minVersions = j.min_versions;
    }
    catch { /* 오프라인 — 실패 로그로 판정 */ }
}
async function bringLatest(id, log) {
    const r = await exec(id, ["update"]).catch(e => ({ code: -1, stdout: "", stderr: String(e) }));
    log?.(`[${id} update] exit ${r.code} ${(r.stdout + r.stderr).trim().slice(-300)}`);
    await detect(id);
    return r.code === 0 && !isOld(id);
}
// ───────────── Gemini · Antigravity CLI `agy` (#12-M) — 앱이 헤드리스로 직접 부른다(사람 개입 0) ─────────────
// 로그인 확인 = `agy -p "pong" --output-format json --print-timeout 30s` exit 0 (약 12k 토큰) → 하루 1회만, 통과한 날은 캐시
// modelsOnly — 목록 확인만(토큰 0). 3초 감지 루프가 "로그인 안 됨"을 다시 볼 때 — 목록을 못 받아도 pong으로 넘어가지 않는다
async function agyLoginOk(force = false, modelsOnly = false) {
    const today = new Date().toISOString().slice(0, 10);
    if (!force && (await store.get("agy_login_ok")) === today)
        return true;
    // 먼저 `agy models`(생성 없음 · 토큰 0, 서버에서 모델 목록을 받는다 — #29 C7). 목록을 못 받을 때만 예전 pong(약 12k 토큰)으로 확인
    const m = await exec("agy", ["models"]).catch(() => null);
    const listed = !!m && m.code === 0 && /^gemini-/m.test(m.stdout);
    // 로그인 전이면 models가 "Please sign in …"(exit 0)을 낸다 — 이때 pong을 돌리면 agy가 숨은 프로세스에서 브라우저 로그인을 시작해
    // 붙여넣을 창이 없는 코드 화면만 뜬다(2026-09-28 Windows 실측) → 로그인 안 됨으로 끝낸다. 로그인은 open_login 창에서만
    if (!listed && (modelsOnly || (m && /sign in/i.test(m.stdout + m.stderr))))
        return false;
    const r = listed ? m : await exec("agy", ["-p", "pong", "--output-format", "json", "--print-timeout", "30s", "--effort", "low"]).catch(() => null);
    const ok = !!r && r.code === 0;
    if (ok) {
        await store.set("agy_login_ok", today);
        await store.save();
    }
    return ok;
}
async function agDetect(checkLogin = false) {
    const v = await exec("agy", ["--version"]).catch(() => null);
    const installed = !!v && v.code === 0;
    const st = await T().core.invoke("ag_status").catch(() => ({ installed: false, connected: false }));
    let loggedIn = installed ? S.ag.loggedIn : null;
    if (installed && (checkLogin || loggedIn === null))
        loggedIn = await agyLoginOk(checkLogin);
    // 로그인 안 됨으로 남아 있으면 목록만 다시(토큰 0) — 앱 밖(터미널)에서 로그인해도 곧 반영(2026-09-28 Windows 실측: 한 번 false면 다음 날까지 그대로였다)
    else if (installed && loggedIn === false)
        loggedIn = await agyLoginOk(true, true);
    S.ag = { checked: true, installed, loggedIn, connected: st.connected, version: installed ? v.stdout.trim() : "", desktop: !installed && (st.installed || (await desktopApps()).antigravity) };
    render();
}
// Gemini 다른 Google 계정으로(대표 결정 ①) — 공식 대화형 창을 /logout으로 시작 → 사용자가 그 창에서 /login(브라우저 Google 로그인).
// 자격증명은 agy가 직접 다룬다. 20초 뒤부터 15초마다 짧은 확인(최대 6분), 되면 한도 표시를 지우고 연결 상태를 알린다
export async function agySwitch() {
    if (switching.gemini)
        return false;
    switching.gemini = "run";
    void reportDevice();
    try {
        await T().core.invoke("open_login", { tool: "agy-switch" });
        await new Promise(r => setTimeout(r, 20_000));
        const until = Date.now() + 6 * 60_000;
        while (Date.now() < until) {
            if (await agyLoginOk(true)) {
                if (S.photoLimits.gemini) {
                    delete S.photoLimits.gemini;
                    await store.set("photo_limits", S.photoLimits);
                    await store.save();
                }
                await agDetect();
                return true;
            }
            await new Promise(r => setTimeout(r, 15_000));
        }
        return false;
    }
    catch (e) {
        toast(String(e));
        return false;
    }
    finally {
        delete switching.gemini;
        void reportDevice();
    }
}
// 공식 로그인 창(터미널의 `agy`) → 10초마다 확인(최대 3분)
// Gemini 로그인을 앱이 관리(#204 · 보정 2·3 — 실측 2026-10-20: `agy -p`는 코드를 받지 않는다 · 터미널 창은 macOS Apple Events 권한 없이 안 열린다).
// macOS·Windows: 네이티브가 대화형 agy를 의사 터미널로 띄운다(run_spawn "agy" ["--dynapse-login"] = macOS /usr/bin/script -q /dev/null agy · Windows conhost --headless · 터미널 창 없음).
// 앱이 "Select login method"에 \r(Google OAuth)를 보내고, agy가 브라우저를 연다. 브라우저가 보여 준 코드는 클립보드(네이티브 clip_code — 4/0… 꼴만, 로그인 중 2초 간격) 또는
// 웹 연결 줄의 코드 칸(login-code)으로 받아 코드 + \r를 넣는다. 로그인 확인 = `agy models`(토큰 0). 2분 지나면 칸 강조, 5분이면 끝. 다른 OS·옛 네이티브는 예전 로그인 창(report login.agy_fallback)
let agyLive = null; // sentAt = 마지막 코드를 넣은 때(#204 보정 4 — "확인하는 중" 줄과 8초 기준)
export let agyLoginState = null;
const setAgyLogin = (v) => { agyLoginState = v; render(); void reportDevice(); };
const AGY_CODE = /^4\/0[A-Za-z0-9_-]{20,}$/;
const readClip = async () => { const g = globalThis; if (typeof g.__simClip === "string")
    return g.__simClip; return (await T().core.invoke("clip_code").catch(() => null)) ?? ""; };
export async function agyCode(code) {
    const c = code.trim();
    if (!agyLive || agyLive.exited || !c || c.length > 400)
        return false;
    if (agyLive.sent.has(c))
        return false; // 같은 코드는 한 번만(다시 넣으면 agy가 거절하고 끝난다)
    agyLive.sent.add(c);
    agyLive.sentAt = Date.now();
    setAgyLogin({ state: "running", why: "confirming", at: agyLive.at }); // 카드 한 줄 "코드를 넣었어요 · 확인하는 중"(#204 보정 4 — 토스트 없이)
    await T().core.invoke("run_write", { id: agyLive.pid, line: `${c}\r` }).catch(() => { });
    return true;
}
async function agyLoginManaged() {
    if (agyLive && !agyLive.exited && Date.now() - agyLive.at < 300_000) {
        if (agyLive.url)
            await T().shell.open(agyLive.url).catch(() => { });
        toast("이미 로그인 중이에요 · 브라우저를 확인하세요");
        return false;
    }
    const st = { pid: -1, url: null, at: Date.now(), exited: false, sent: new Set(), sentAt: undefined };
    {
        const old = await readClip().catch(() => "");
        if (old)
            st.sent.add(old);
    } // 시작 전에 클립보드에 있던 코드(지난 로그인의 만료된 코드)는 넣지 않는다 — 넣으면 agy가 거절하고 끝난다(2026-10-20 Windows 실측)
    let started = false, failed = "", picked = false, trusted = false, buf = "";
    setAgyLogin({ state: "running", at: Date.now() });
    void spawn("agy", ["--dynapse-login"], "", null, l => {
        const t = l.replace(/\x1b\[[0-9;?<>=]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "").replace(/\x1b[>=]/g, "");
        buf = (buf + "\n" + t).slice(-8000); // OSC는 BEL·ST(ESC \\) 둘 다(Windows conhost가 링크를 OSC 8 + ST로 감싼다)
        if (!trusted && /Do you trust the contents of this project/i.test(buf) && st.pid >= 0) {
            trusted = true;
            setTimeout(() => void T().core.invoke("run_write", { id: st.pid, line: "\r" }).catch(() => { }), 300);
        } // 폴더 신뢰 물음(Windows 실측 — 기본 "Yes")
        if (!picked && /Select login method/i.test(buf) && st.pid >= 0) {
            picked = true;
            setTimeout(() => void T().core.invoke("run_write", { id: st.pid, line: "\r" }).catch(() => { }), 300);
        } // 1. Google OAuth
        if (!st.url) {
            const i = buf.indexOf("https://accounts.google.com/");
            if (i >= 0) {
                const tail = buf.slice(i).split("\n").map(x => x.trim());
                let u = "";
                for (const x of tail) {
                    if (!x || !/^[A-Za-z0-9%&=_.+~:/?#-]+$/.test(x))
                        break;
                    u += x;
                    if (/[?&]state=[^&]{6,}$/.test(u) && !/^[A-Za-z0-9%_-]+$/.test(tail[tail.indexOf(x) + 1] ?? ""))
                        break;
                }
                if (/state=/.test(u)) {
                    st.url = u;
                    render();
                }
            }
        }
    }, pid => { st.pid = pid; started = true; }, true).then(() => { st.exited = true; }).catch(e => { failed = String(e).slice(0, 120); });
    for (let i = 0; i < 20 && !started && !failed; i++)
        await new Promise(r => setTimeout(r, 100));
    if (!started) {
        setAgyLogin(null);
        report("app", "login.agy_fallback", failed || "no_start");
        return null;
    } // 다른 OS·옛 네이티브(--dynapse-login 모름)
    agyLive = st;
    toast("브라우저에서 로그인한 뒤, 나오는 코드를 [복사]만 하세요 · 앱이 알아서 넣어요"); // 복사하면 앱이 넣는다는 걸 먼저 알린다(2026-10-20 — 모르면 어디에 붙일지 찾는다)
    // 확인되면 "연결됐어요 · Google 계정" 한 줄을 2.5초 보이고 접는다(#204 보정 4) · 코드를 넣은 뒤 확인까지 걸린 시간을 남긴다(8초 기준 조정용)
    const done = async (ok) => {
        if (!st.exited)
            await T().core.invoke("run_kill", { id: st.pid }).catch(() => { });
        const sentAt = st.sentAt;
        agyLive = null;
        if (ok) {
            if (sentAt)
                report("app", "login.agy_confirm_ms", String(Date.now() - sentAt));
            setAgyLogin({ state: "done", at: Date.now() });
            setTimeout(() => { if (agyLoginState?.state === "done")
                setAgyLogin(null); }, 2500);
            await agDetect();
            void reportDevice();
            void replayWaiting();
        }
        return ok;
    };
    let hinted = false;
    for (let k = 0; Date.now() - st.at < 300_000; k++) {
        await new Promise(r => setTimeout(r, 2000));
        const c = await readClip();
        if (AGY_CODE.test(c) && !st.sent.has(c) && !st.exited)
            await agyCode(c);
        const sentAt = st.sentAt;
        if ((sentAt || k % 2 === 1 || st.exited) && await agyLoginOk(true, true))
            return done(true); // 코드를 넣은 뒤엔 2초마다 확인
        if (sentAt && Date.now() - sentAt > 8000 && agyLoginState?.why === "confirming")
            setAgyLogin({ state: "running", why: "slow", at: st.at }); // "확인이 오래 걸려요 · 브라우저에서 코드를 다시 복사해 주세요" — 새 코드는 계속 받는다
        if (st.exited && Date.now() - st.at < 8000) {
            agyLive = null;
            setAgyLogin(null);
            report("app", "login.agy_fallback", `exited ${buf.slice(-120).replace(/\s+/g, " ")}`);
            return null;
        }
        if (st.exited)
            break;
        if (!hinted && !st.sentAt && Date.now() - st.at > 120_000) {
            hinted = true;
            setAgyLogin({ state: "running", why: "code", at: st.at });
        }
    }
    void diagAuto({ tool: "agy", stage: "login", code: "login_timeout", summary: "Gemini 로그인(앱 관리)이 확인되지 않았어요", cli: S.ag.version || null });
    setAgyLogin({ state: "failed", why: "code", at: Date.now() });
    return done(false);
}
export async function agyLogin() {
    const managed = await agyLoginManaged().catch(() => null);
    if (managed !== null)
        return managed;
    try {
        await T().core.invoke("open_login", { tool: "agy" });
    }
    catch (e) {
        report("app", "login.terminal_denied", String(e).slice(0, 160));
        toast(String(e));
        return false;
    } // macOS Apple Events 거부(-1743) 등(#204 보정 3)
    const until = Date.now() + 180_000;
    while (Date.now() < until) {
        await new Promise(r => setTimeout(r, 10_000));
        if (await agyLoginOk(true)) {
            await agDetect();
            reportDevice();
            return true;
        }
    }
    return false;
}
// ───────────── Dynapse 연결 (OAuth 코드 + PKCE, 127.0.0.1 루프백) — 브라우저의 자동 계정으로 동의 1클릭 ─────────────
// 이메일 코드 로그인(#135 §9) — /api/app/code로 코드 메일 → /oauth/token grant urn:dynapse:email_code(이 앱 클라이언트만). 실패는 카드 안 한 줄
async function codeSend() {
    const o = S.onboard;
    if (!o)
        return;
    const email = (document.getElementById("ob-email")?.value ?? o.email ?? "").trim();
    o.email = email;
    o.accBusy = true;
    o.accMsg = "";
    render();
    const r = await http("POST", `${HUB}/api/app/code`, { json: { email, lang: "ko" } }).catch(() => null);
    const err = r?.status === 200 ? null : (() => { try {
        return JSON.parse(r?.body ?? "{}").error ?? "net";
    }
    catch {
        return "net";
    } })();
    o.accBusy = false;
    o.codeSent = !err;
    o.accMsg = err ? { email: "이메일을 확인해 주세요", locked: "잠시 뒤에 다시 해 주세요", mail_off: "지금은 메일을 보낼 수 없어요 · [브라우저로 연결]을 쓰세요", mail_fail: "메일을 보내지 못했어요 · 다시 해 주세요" }[err] ?? "연결을 확인해 주세요" : `${email}로 6자리 코드를 보냈어요`;
    render();
    setTimeout(() => document.getElementById("ob-code")?.focus(), 50);
}
// 이 앱의 OAuth 클라이언트 id — 없으면 루프백 redirect로 등록(1st party "Dynapse 앱")
async function ensureClientId() {
    let cid = await store.get("client_id").catch(() => null);
    if (!cid) {
        const reg = await http("POST", `${HUB}/oauth/register`, { json: { redirect_uris: ["http://127.0.0.1:53682/cb"], client_name: "Dynapse 앱" } });
        if (reg.status !== 201)
            throw new Error(`앱 등록 실패 (${reg.status})`);
        cid = JSON.parse(reg.body).client_id;
        await store.set("client_id", cid);
        await store.save();
    }
    return cid;
}
// 첫 실행 기기 계정(#142 추가 4 ③) — Dynapse 로그인 없이 계정 + 토큰(사람 클릭 0). 이메일은 공유·포인트·다른 PC에서 처음 묻는다. 실패하면 예전 로그인 카드로
export async function deviceAccount() {
    try {
        const cid = await ensureClientId();
        const r = await http("POST", `${HUB}/api/app/device-account`, { json: { client_id: cid, device_id: S.deviceId } });
        const j = JSON.parse(r.body || "{}");
        if (r.status !== 200 || !j.access_token) {
            report("install", "install.device_account_fail", `${r.status} ${j.error ?? ""}`);
            return false;
        }
        await saveToken(j.access_token, j.refresh_token ?? null);
        await reportDevice();
        return true;
    }
    catch (e) {
        report("install", "install.device_account_fail", String(e).slice(0, 120));
        return false;
    }
}
// 잇기(#142 추가 4 ③ — 초대받은 사람의 [앱에서 열기]) — 브라우저 계정의 토큰을 받는다(앱의 기기 계정이 비어 있지 않으면 서버가 합친다)
async function claimLink(code, work) {
    try {
        const cid = await ensureClientId();
        const r = await http("POST", `${HUB}/api/app/claim`, { json: { code, client_id: cid }, auth: !!S.token });
        const j = JSON.parse(r.body || "{}");
        if (r.status !== 200 || !j.access_token) {
            toast("연결 코드가 지났어요 · 웹에서 [앱에서 열기]를 다시 눌러 주세요");
            return;
        }
        await saveToken(j.access_token, j.refresh_token ?? null);
        if (S.onboard)
            S.onboard = null;
        await store.set("onboarded", true).catch(() => { });
        await store.save().catch(() => { });
        await reportDevice();
        void afterAccount();
        if (WORK_ID.test(work))
            await openWork(work, "앱을 연결했어요 · 이 작업을 열었어요");
    }
    catch (e) {
        toast(`연결하지 못했어요 · ${String(e).slice(0, 80)}`);
    }
}
async function codeLogin() {
    const o = S.onboard;
    if (!o?.email)
        return;
    const code = (document.getElementById("ob-code")?.value ?? "").replace(/\D/g, "");
    if (code.length !== 6) {
        o.accMsg = "6자리 코드를 넣어 주세요";
        render();
        return;
    }
    o.accBusy = true;
    o.accMsg = "";
    render();
    try {
        const cid = await ensureClientId();
        const tok = await http("POST", `${HUB}/oauth/token`, { form: { grant_type: "urn:dynapse:email_code", email: o.email, code, client_id: cid } });
        const j = JSON.parse(tok.body || "{}");
        if (tok.status !== 200 || !j.access_token)
            throw new Error(j.error === "invalid_grant" ? "코드가 맞지 않거나 지났어요 · [코드 다시 받기]" : j.error === "slow_down" ? "잠시 뒤에 다시 해 주세요" : `로그인하지 못했어요 (${j.error ?? tok.status})`);
        await saveToken(j.access_token, j.refresh_token ?? null);
        await reportDevice();
        o.hubStarted = true;
        o.accBusy = false;
        await afterAccount();
    }
    catch (e) {
        o.accBusy = false;
        o.accMsg = e.message;
        render();
    }
}
async function hubLogin() {
    S.hubBusy = true;
    S.hubMsg = "브라우저에서 [연결 허용]을 누르면 자동으로 돌아와요.";
    render();
    try {
        const port = await T().core.invoke("oauth_listen");
        const redirect = `http://127.0.0.1:${port}/cb`;
        const reg = await http("POST", `${HUB}/oauth/register`, { json: { redirect_uris: [redirect], client_name: "Dynapse 앱" } });
        if (reg.status !== 201)
            throw new Error(`앱 등록 실패 (${reg.status})`);
        const clientId = JSON.parse(reg.body).client_id;
        const verifier = rand(32);
        const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
        const state = rand(16);
        const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: "S256", state });
        await T().shell.open(`${HUB}/oauth/authorize?${q}`);
        const cb = await T().core.invoke("oauth_wait", { port });
        if (cb.error || !cb.code)
            throw new Error(`연결이 취소됐어요${cb.error ? ` (${cb.error})` : ""}`);
        if (cb.state !== state)
            throw new Error("보안 확인값이 맞지 않아요. 다시 실행하세요.");
        const tok = await http("POST", `${HUB}/oauth/token`, {
            form: { grant_type: "authorization_code", code: cb.code, code_verifier: verifier, redirect_uri: redirect, client_id: clientId },
        });
        const j = JSON.parse(tok.body);
        if (tok.status !== 200 || !j.access_token)
            throw new Error(`연결 실패 (${j.error ?? tok.status})`);
        await saveToken(j.access_token, j.refresh_token ?? null);
        await store.set("client_id", clientId);
        await store.save(); // 갱신에 넣는다(#88 A-4 — 서버가 client_id를 필수로 받는다)
        S.hubMsg = "";
        await reportDevice();
    }
    catch (e) {
        S.hubMsg = e.message;
        toast(S.hubMsg);
    }
    S.hubBusy = false;
    render(); // 연결을 기다리던 웹 요청은 확인 카드에서 이어서 [실행]
}
// 이 앱의 client_id — 예전에 연결한 앱은 저장해 두지 않았다: 지금 접속 토큰으로 서버에 한 번 물어 저장(#88 A-4)
async function clientIdOf() {
    const have = await store.get("client_id").catch(() => null);
    if (have)
        return have;
    if (!S.token)
        return null;
    const r = await http("GET", `${HUB}/oauth/whoami`, { auth: true }, true).catch(() => null);
    const id = r?.status === 200 ? JSON.parse(r.body).client_id ?? null : null;
    if (id) {
        await store.set("client_id", id);
        await store.save();
    }
    return id;
}
async function refreshToken() {
    if (!S.refresh)
        return false;
    const cid = await clientIdOf();
    const r = await http("POST", `${HUB}/oauth/token`, { form: { grant_type: "refresh_token", refresh_token: S.refresh, ...(cid ? { client_id: cid } : {}) } }, true).catch(() => null);
    if (!r || r.status !== 200)
        return false;
    const j = JSON.parse(r.body);
    await saveToken(j.access_token, j.refresh_token ?? S.refresh);
    return true;
}
async function saveToken(access, refresh) {
    S.token = access;
    S.refresh = refresh;
    await store.set("token", access);
    await store.set("refresh", refresh);
    await store.save();
    listenEvents();
    setTimeout(() => void pullOnce({ boot: true }), 3_000); // 받지 못한 메시지(#165 ① — OTA 새로고침 중 웹이 보낸 턴을 48초 넘게 안 받았다). 연결이 붙은 뒤 한 번
}
async function forgetToken() {
    S.token = null;
    S.refresh = null;
    S.handle = null;
    await store.delete("token");
    await store.delete("refresh");
    await store.save();
}
async function disconnectHub() {
    // 서버 토큰 폐기(RFC 7009) + 이 기기 보고 삭제 + 로컬 토큰 삭제
    if (S.token) {
        await api("DELETE", `/api/device?device_id=${encodeURIComponent(S.deviceId)}`).catch(() => { });
        for (const t of [S.token, S.refresh])
            if (t)
                await http("POST", `${HUB}/oauth/revoke`, { form: { token: t } }).catch(() => { });
    }
    await forgetToken();
    render();
}
// 기기 상태 보고 — 앱 시작·로그인/연결 변화·실행 완료 때 + 10분 심장박동(#12-Z — 웹이 "온라인"·"이 PC"를 안다). 응답으로 아이디·동기화도 갱신
// 깔때기(#149) — 이 PC에서 한 번만 서버에 알리는 단계(첫 내보내기). 글 없음 · 단계·화면 이름만
export async function onbOnce(step, screen) {
    const k = `onb_${step}`;
    if (await store.get(k))
        return;
    const r = await api("POST", "/api/onb", { step, screen }).catch(() => null);
    if (r && r.status === 200) {
        await store.set(k, true);
        await store.save();
    }
}
// 설치 뒤 막힘 한 줄(#149 §4) — 기기 계정이 생기고(또는 첫 턴 전에 앱을 켜고) 10분 안에 첫 턴이 없으면 위 줄에 조용히: "막힌 데가 있으면 [여기] · 1분 안에 답해요".
// 하루 한 번. [여기] = reports(area onboard, 그때 화면 이름만 · 글 없음) → "받았어요". 타이머 하나(주기 루프 아님)
export let stuckLine = null;
let stuckT = null;
export function scheduleStuck(ms = 10 * 60_000) {
    if (stuckT)
        clearTimeout(stuckT);
    stuckT = setTimeout(async () => {
        stuckT = null;
        if (await store.get("first_turn_at"))
            return;
        const d = new Date().toLocaleDateString("sv");
        if ((await store.get("onb_stuck_day")) === d)
            return;
        await store.set("onb_stuck_day", d);
        await store.save();
        stuckLine = "ask";
        render();
    }, ms);
}
export async function stuckSend() {
    report("onboard", "onboard.stuck", `step=${S.onboard?.step ?? (S.token ? "main" : "none")} ai=${["claude", "codex", "agy"].filter(t => S.tools?.[t]?.loggedIn).join("+") || "none"}`);
    void flushReports();
    stuckLine = "sent";
    render();
}
export async function markFirstTurn() { if (!(await store.get("first_turn_at"))) {
    await store.set("first_turn_at", Date.now());
    await store.save();
} if (stuckLine === "ask") {
    stuckLine = null;
    render();
} }
export async function reportDevice() {
    if (!S.token)
        return;
    const t = (x) => ({ installed: x.installed, loggedIn: x.loggedIn, connected: x.connected });
    S.bridge ??= await T().core.invoke("bridge_info").catch(() => null);
    const r = await api("POST", "/api/device", deviceBody()).catch(() => null);
    if (r?.data?.update_required)
        void forceUpdate(false, true); // 서버 최소 버전보다 낮다(#21 보정 2) — 곧바로 받는다
    await refreshMe();
}
export function deviceBody() {
    const t = (x, k) => ({ login: x.loggedIn ? null : x.login ?? null, installed: x.installed, loggedIn: x.loggedIn, connected: x.connected, account: x.account ?? null, plan: x.plan ?? null, switching: switching[k] ?? null, desktop: x.desktop === true, install: x.installed ? null : S.installFail[k]?.status ?? null });
    return {
        device_id: S.deviceId, app_version: S.app?.version ? `${S.app.version}${otaNow() ? `+ota${otaNow()}` : ""}` : undefined, ota: otaNow(), default_models: S.defaultModels, // app_version = 화면 묶음 번호까지(대표: 새로고침됐는지 알 수 없다)
        models: { ...S.models, _default: S.defaultModels, _photo_limits: S.photoLimits }, limits: S.claudeLimit ? { claude: S.claudeLimit } : undefined,
        // 기기 등록(#12-Z Z1) — 이름(처음 한 번 기본값)·OS·로컬 브릿지 포트·이번 실행의 토큰
        name: S.app?.host || undefined, os: S.app?.os, online: true,
        ...(S.updateFail ? { update_fail: true } : {}), // 웹이 [설치 파일 받기]를 보인다(#185 C 보정 1)
        ...(S.bridge ? { bridge_port: S.bridge.port, bridge_token: S.bridge.token } : {}),
        tools: { claude: t(S.tools.claude, "claude"), codex: t(S.tools.codex, "codex"),
            agy: { installed: S.ag.installed, loggedIn: S.ag.loggedIn, connected: null, account: S.ag.loggedIn ? "Google 계정" : null, switching: switching.gemini ?? null, login: agyLoginState, desktop: S.ag.desktop, install: S.ag.installed ? null : S.installFail.agy?.status ?? null }, // agy는 계정 정보·로그아웃 명령이 없다(실측)
            antigravity: { installed: S.ag.installed, loggedIn: S.ag.loggedIn, connected: S.ag.checked ? S.ag.connected : null } },
        local: localTool(), // 이 PC 엔진(#113) — 연결 탭 칩
        git: gitBody(), // 배포 계정(#80) — 연결 여부·이 PC에서 확인한 시각·가린 이름
    };
}
async function detectModels() {
    const out = {};
    const h = S.tools.claude.installed ? await exec("claude", ["--help"]).catch(() => null) : null;
    const m = h?.stdout.replace(/\s+/g, " ").match(/alias for the latest model \(e\.g\. ([^)]*)\)/);
    if (m)
        out.claude = [...m[1].matchAll(/'([a-z0-9.-]+)'/g)].map(x => ({ id: x[1], name: x[1][0].toUpperCase() + x[1].slice(1) }));
    const c = S.tools.codex.installed ? await exec("codex", ["debug", "models"]).catch(() => null) : null;
    try {
        const j = JSON.parse(c?.stdout ?? "");
        const bad = (await import("./photo-runner.js")).codexUnsupported(); // ChatGPT 계정에서 못 쓰는 모델은 목록에서 뺀다(#95 A — 첫 400을 기억)
        out.chatgpt = j.models.filter(x => x.visibility === "list" && !bad.includes(x.slug)).map(x => ({ id: x.slug, name: x.display_name, efforts: x.supported_reasoning_levels?.map(e => e.effort) }));
    }
    catch { /* 목록 없음 → 기본 */ }
    const a = S.ag.installed ? await exec("agy", ["models"]).catch(() => null) : null;
    const base = new Map();
    for (const line of a?.stdout.split("\n") ?? []) {
        const [id, name] = line.split("\t");
        if (!id?.startsWith("gemini-") || !name)
            continue;
        const bm = id.match(/^(.*?)-(high|medium|low)$/);
        const key = bm ? bm[1] : id;
        const o = base.get(key) ?? { id: key, name: name.replace(/\s*\((High|Medium|Low)\)$/, ""), efforts: [] };
        if (bm)
            o.efforts.push(bm[2]);
        base.set(key, o);
    }
    if (base.size)
        out.gemini = [...base.values()];
    S.models = out;
}
// 계정 상태 다시 받기(#12-AD AD1) — 아이디·동기화. 딥링크를 받으면 판정 전에 먼저 부른다(낡은 값으로 막지 않게)
export async function refreshMe() {
    if (!S.token)
        return;
    const g = await api("GET", "/api/device").catch(() => null);
    if (g?.status === 200 && g.data) {
        S.thumbUpload = g.data.user.thumb_upload !== false;
        setSync(!!g.data.user.sync);
        for (const w of g.data.open_works ?? [])
            sharedWorks.add(w); // 공유가 열린 작업(#38)만 저장마다 올린다
        S.handle = g.data.user.handle;
        S.myAis = (g.data.my_ais ?? []).filter(x => x === "claude" || x === "codex" || x === "gemini");
        const oa = g.data.open_after_install; // 설치 뒤 열 작업(#133) — 웹에서 [앱 받기]를 누른 그 작업을 바로
        // 온보딩 중이면(#135 §4·§10) — 그 작업의 팀 AI를 미리 고르고, 작업은 온보딩이 끝난 뒤에 연다
        if (oa?.work && WORK_ID.test(oa.work) && S.onboard) {
            const pre = (oa.ai ?? []).filter((x) => x === "claude" || x === "chatgpt" || x === "gemini");
            if (pre.length && (S.onboard.step === "account" || S.onboard.step === "pick") && !S.onboard.picked.length)
                S.onboard.picked = pre;
            afterOnboard = oa;
        }
        else if (oa?.work && WORK_ID.test(oa.work))
            void openAfter(oa);
    }
    else if (g?.status === 401)
        await forgetToken();
    pushStatus();
    render();
}
// ───────────── 연결 상태·대기열(#146) ─────────────
// 끊김 → 그 순간 한 줄(이 PC·인앱 상태 점 — 서버로는 못 보낸다) · 복귀 → 대기열을 차례로 비우고 일이 있던 작업마다 대화에 한 줄. 다시 끊기면 남은 것을 되돌려 놓고 지수 간격(최대 1시간)
export const netNotes = []; // 사용자에게 보인 줄(시험이 센다)
let draining = false, drainT = null;
function initNet(saved) {
    netQueueInit(saved, async (q) => { await store.set("net_queue", q); await store.save(); });
    setProbe(async () => { try {
        const r = await http("GET", `${HUB}/api/download?info=1`);
        return r.status > 0 && r.status < 500;
    }
    catch {
        return false;
    } });
    onNet((n, prev) => {
        pushStatus();
        render();
        if (n !== "online" && prev === "online")
            netNotes.push({ at: Date.now(), work: null, text: n === "blocked" ? "회사망이 연결을 막고 있어요 · 이 PC에서 계속 작업돼요 · 풀리면 올려요" : "인터넷이 끊겼어요 · 이 PC에서 계속 작업돼요 · 연결되면 올려요" });
        if (n === "online")
            void drainNet();
    });
    if (queuedCount())
        setTimeout(() => { if (netState() === "online")
            void drainNet(); }, 4000); // 지난번에 남은 것(앱을 다시 켰을 때)
}
export async function drainNet() {
    if (draining || netState() !== "online")
        return;
    draining = true;
    if (drainT) {
        clearTimeout(drainT);
        drainT = null;
    }
    const t = takeQueue();
    const left = { push: [], pull: [], held: [], chat: [] };
    const per = new Map();
    try {
        for (const c of t.chat) {
            if (netState() !== "online") {
                left.chat.push(c);
                continue;
            }
            await api("POST", `/api/works/${encodeURIComponent(c.id)}/messages`, { messages: c.messages }).catch(() => left.chat.push(c));
        }
        const { pushWork, syncLatest } = await import("./chat.js");
        for (const id of t.pull) {
            if (netState() !== "online") {
                left.pull.push(id);
                continue;
            }
            await syncLatest(id, "notice").catch(() => left.pull.push(id));
        }
        for (const id of t.push) {
            if (netState() !== "online") {
                left.push.push(id);
                continue;
            }
            const dir = await T().core.invoke("work_dir", { id }).catch(() => null);
            if (!dir)
                continue;
            await pushWork(id, dir).catch(() => { });
            per.set(id, (per.get(id) ?? 0) + 1);
        }
        for (const h of t.held) {
            if (netState() !== "online") {
                left.held.push(h);
                continue;
            }
            per.set(h.id, (per.get(h.id) ?? 0) + 1);
            void onChatMessage({ id: `held:${h.at}`, work: h.id, role: "user", text: h.text, payload: {} }).catch(() => { });
        } // 보관 요청은 받는 길 그대로(범위·지시 머리말 다시)
    }
    finally {
        draining = false;
        requeue(left);
        if (queuedCount()) {
            const ms = backoff();
            report("sync", "net.retry", `n=${queuedCount()} ms=${ms}`);
            drainT = setTimeout(() => void drainNet(), ms);
        }
        else
            backoffReset();
    }
    for (const [id, n] of per) {
        const text = `연결됐어요 · 밀린 일 ${n}개 보내요`;
        netNotes.push({ at: Date.now(), work: id, text });
        await postChat(id, [{ role: "event", text, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
    }
    pushStatus();
}
function setSync(on) {
    const turnedOn = !S.sync && on;
    S.sync = on;
    if (turnedOn)
        syncAll(); // 방금 켰으면 이 기기의 작업을 한 번 올린다
}
// 이 PC의 실시간 상태를 로컬 브릿지 /ping에 싣는다(#12-AD AD1) — 웹 작업 CTA가 낡은 기기 보고 대신 이걸로 판정
function pushStatus() {
    const t = (x) => ({ installed: x.installed, loggedIn: x.loggedIn });
    T().core.invoke("bridge_status", { json: JSON.stringify({ version: S.app?.version, device_id: S.deviceId ?? null,
            tools: { claude: t(S.tools.claude), codex: t(S.tools.codex), agy: { installed: S.ag.installed, loggedIn: S.ag.loggedIn } }, net: netState(), queued: queuedCount() }) }).catch(() => { }); // net·queued(#146) — 같은 PC 웹(인앱)이 루프백 /ping으로 읽는다(오프라인에도)
}
// 서버가 미는 이벤트(#12-AD AD1) — /api/device/events SSE를 curl -N으로 붙잡는다(55초마다 서버가 닫으면 다시 붙음).
// sync는 즉시 반영, message는 작업실 대화를 세션으로(#14). 폴링 없음
// 한가하면 조용히(2026-10-13 Neon compute 한도 초과 — 켜 둔 앱마다 0.8초 폴링이 DB를 하루 종일 깨워 두었다):
// 20분 동안 손대지 않고 턴도 없으면 idle=1(서버가 5초·60초로), 2시간이면 연결을 끊어 DB가 잠들게. 웹 창 활동·엔진 창·턴·메시지가 오면 바로 다시
let lastActive = Date.now(), evPaused = false;
export function markActive() { lastActive = Date.now(); if (evPaused) {
    evPaused = false;
    void listenEvents();
    void reportDevice();
} }
const idleFor = () => (jobRunning() ? 0 : Date.now() - lastActive);
let eventsOn = false;
async function listenEvents() {
    if (eventsOn || !S.token)
        return;
    if (idleFor() > IDLE_STOP_MS) {
        evPaused = true;
        return;
    }
    eventsOn = true;
    let ev = "";
    const hdr = await T().core.invoke("auth_header_file", { token: S.token }).catch(() => null);
    if (S.app?.updater)
        checkSoon(); // SSE 재연결 때도 새 버전 확인(10분에 한 번 이하)
    const code = hdr ? await spawn("curl", ["-sS", "-N", "-f", "-H", `@${hdr}`, `${HUB}/api/device/events?device_id=${encodeURIComponent(S.deviceId)}${idleFor() > IDLE_SLOW_MS ? "&idle=1" : ""}`], "", null, (l) => {
        if (l.startsWith("event: ")) {
            ev = l.slice(7).trim();
            return;
        }
        if (!l.startsWith("data: "))
            return;
        let d;
        try {
            d = JSON.parse(l.slice(6));
        }
        catch {
            return;
        }
        if (ev === "sync")
            setSync(d === true);
        else if (ev === "message") {
            markActive();
            onChatMessage(d);
        } // 작업실 대화(#14)
        // 새 버전 알림(pub/sub) — 서버가 stable·화면 묶음이 새로 올라가면 이 연결로 민다
        else if (ev === "update") {
            const v = d.version;
            if (v && v !== S.app?.version)
                void forceUpdate();
        }
        else if (ev === "remedy")
            void applyRemedy(String(d.kind ?? "")); // 규칙 엔진의 조치(#116 §2)
        else if (ev === "ota") {
            const n = d;
            if (n.native === S.app?.version && (n.ota ?? 0) > otaNow())
                void otaCheck();
        }
    }, () => { }).catch(() => -1) : -1;
    eventsOn = false;
    if (code === 22 && S.refresh)
        await refreshToken().catch(() => false); // -f: 401 → 토큰 갱신 후 다시
    // 연결이 계속 안 되면(도메인 직후 DNS 캐시 등 — curl 6: 주소를 못 찾음, 7: 연결 실패) 허브 주소를 다시 고른다. 켤 때 한 번만 고르던 것(2026-09-29 한 시간 끊김)
    {
        const nn = typeof code === "number" ? netFromCurl(code) : null;
        if (nn)
            netMark(nn);
    } // 서버 스트림이 끊긴 이유도 연결 상태로(#146)
    evFails = code === 0 || code === 22 ? 0 : evFails + 1;
    if (evFails >= 2 || code === 6 || code === 7) {
        evFails = 0;
        await pickHub().catch(() => { });
    }
    if (S.token)
        setTimeout(listenEvents, code === 0 ? EVENTS_RETRY_MS : EVENTS_FAIL_MS);
}
let evFails = 0;
// 규칙 엔진 조치(#116 §2) — 서버가 이 기기의 실패를 보고 내려보낸 것. 되돌릴 수 있는 것만(사용자 확인 없이)
async function applyRemedy(kind) {
    const { report } = await import("./report.js");
    if (kind === "photo.model_retry") { // 이 계정에서 못 쓰는 ChatGPT 사진 모델이 기본으로 잡혀 있으면 기본으로 되돌린다(다음 후보는 사진 러너가 고른다)
        const { codexUnsupported } = await import("./photo-runner.js");
        const m = S.defaultModels.chatgpt;
        if (m && codexUnsupported().includes(m)) {
            delete S.defaultModels.chatgpt;
            await store.set("default_models", S.defaultModels);
            await store.save();
            void reportDevice();
        }
    }
    else if (kind === "sync.reshrink") {
        const { shrinkBig, afterSave } = await import("./chat.js");
        for (const r of S.recent.slice(0, 5))
            if (r.work) {
                await shrinkBig(r.work).catch(() => 0);
                await afterSave(r.work).catch(() => { });
            }
    } // push.413(#56 보정 8) — 다시 줄이고 올리기
    else if (kind === "sync.pull_now") {
        const { syncLatest } = await import("./chat.js");
        for (const r of S.recent.slice(0, 5))
            if (r.work)
                await syncLatest(r.work, "open").catch(() => false);
    } // stale 되풀이(#56 보정 8) — 서버 판 다시 확인
    else if (kind === "sync.push_now") {
        const { afterSave } = await import("./chat.js");
        for (const r of S.recent.slice(0, 5))
            if (r.work)
                await afterSave(r.work).catch(() => { });
    }
    else if (kind === "bundle.repair")
        await localAction("fix");
    else if (kind === "ota.reload")
        void otaCheck();
    else if (kind === "bundle.stepdown") { /* 1차 티어엔 더 작은 번들이 아직 없다 — 기록만 */ }
    report("local", `local.remedy_${kind.replace(/[^a-z_.]/g, "").replace(/\./g, "_") || "unknown"}`, null);
}
// 이 PC 결과 평가(#113 보정 4 §2) — 이 PC로 만든 덱을 처음 내보낸 직후 그 작업실에 카드 한 장(기기당 한 번)
async function localRateOnce(w) {
    try {
        if (localStorage.getItem("dyn:local-rated"))
            return;
    }
    catch {
        return;
    }
    const tr = await T().core.invoke("work_read", { id: w, file: ".dynapse/TRACE.json" }).catch(() => null);
    if (!tr || !/"runtime":\s*"local"/.test(tr))
        return;
    try {
        localStorage.setItem("dyn:local-rated", w);
    }
    catch { /* */ }
    const { postChat } = await import("./chat.js");
    await postChat(w, [{ role: "event", text: null, payload: { kind: "local-rate", ai: "dynapse" } }]).catch(() => { });
}
// 한 번 가져가기(#115) — 같은 PC 웹의 nudge 뒤. 서버 연결의 15초 확인을 기다리지 않는다(연달아 와도 1초에 한 번)
// 받지 못한 메시지 한 번 가져가기(#165 ①) — 시작·OTA 새로고침(boot: 앞 판이 받아만 둔 것도 되돌려 받는다)·턴 끝 직후에만. 주기 루프 아님(#115: 그 세 순간 + 같은 PC 웹의 nudge, 1초에 한 번까지)
let pullAt = 0;
export async function pullOnce(o = {}) {
    if (!S.token || Date.now() - pullAt < PULL_MIN_MS)
        return;
    pullAt = Date.now();
    const r = await api("GET", `/api/device/events?device_id=${encodeURIComponent(S.deviceId)}&once=1${o.boot ? "&boot=1" : ""}`).catch(() => null);
    for (const m of r?.data?.messages ?? [])
        onChatMessage(m);
}
// ───────────── 딥링크 — connect·open·folder·export 넷(#20). 작업은 전부 작업실 메시지 ─────────────
// [앱으로 로그인](#20 브라우저 간 계정) — 붙이기 전에 확인 창(딥링크는 아무 사이트나 쏠 수 있다). 같은 네트워크 검사는 서버가
// 붙이지 않은 이유를 웹에 알린다(#41 B) — 웹은 회색으로 기다리지 않고 그 이유에 맞는 버튼을 보인다. 인증 없음(nonce 소지)
const declineLink = (s, reason) => http("POST", `${HUB}/api/session/link/decline`, { json: { s, reason } }).catch(() => null);
async function linkBrowser(s) {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(s))
        return;
    // 앱이 Dynapse에 연결 안 됨 → 연결 전 화면(그 화면의 [Dynapse 연결])을 앞으로 + 웹은 "앱 창에서 [Dynapse 연결]을 먼저"
    const noAccount = async () => { void declineLink(s, "no_account"); await T().core.invoke("show_main", { show: true }).catch(() => { }); toast("먼저 [Dynapse 연결]을 눌러 주세요"); };
    if (!S.token) {
        await noAccount();
        return;
    }
    const peek = await api("GET", `/api/device/link-session?s=${s}`).catch(() => null);
    if (peek?.status === 401) {
        await noAccount();
        return;
    }
    if (peek?.status !== 200) {
        toast(peek?.data?.error ?? "링크가 끝났어요 — 브라우저에서 다시 눌러 주세요");
        return;
    }
    const ok = await T().core.invoke("app_confirm", { title: "브라우저 연결", message: `${peek.data?.ua || "브라우저"}를 내 계정(${peek.data?.handle ?? S.handle ?? ""})에 연결할까요?\n\n직접 누른 게 아니면 [취소]를 누르세요.`, ok: "연결" }).catch(() => false);
    if (!ok) {
        void declineLink(s, "cancel");
        return;
    }
    const r = await api("POST", "/api/device/link-session", { s, device_id: S.deviceId }).catch(() => null);
    toast(r?.status === 200 ? `${peek.data?.ua ?? "브라우저"} 연결됨` : r?.data?.error ?? "연결하지 못했어요");
    if (r?.status === 200)
        void loadBrowsers();
}
// 연결된 브라우저(#20) — 프로필 팝오버 목록
async function loadBrowsers() {
    const r = await api("GET", "/api/device/browsers").catch(() => null);
    if (r?.status === 200) {
        S.browsers = r.data?.browsers ?? [];
        render();
    }
}
// 폴더 가져오기(#20) — 고르기(또는 경로 확인) → 새 작업 → 복사(.git 그대로) → 첫 커밋 "가져옴" → 작업실 + 첫 턴
async function importFolder(path) {
    if (!S.token) {
        toast("Dynapse 연결 필요");
        return;
    }
    const picked = await T().core.invoke("import_pick", { path: path ?? null }).catch(e => { toast(String(e)); return null; });
    if (!picked)
        return;
    const name = picked.split(/[\\/]/).filter(Boolean).pop() ?? "폴더";
    const r = await api("POST", "/api/works", { title: name.slice(0, 30), status: "done", page: "import", device_id: S.deviceId }).catch(() => null);
    const id = r?.data?.id;
    if (!id) {
        toast("작업을 만들지 못했어요");
        return;
    }
    const files = await T().core.invoke("import_copy", { id, path: picked }).catch(e => { toast(String(e)); return null; });
    if (!files)
        return;
    await api("POST", "/api/works", { id, status: "done", local_path: await T().core.invoke("work_dir", { id }), device_id: S.deviceId }).catch(() => { });
    await importStart(id, { source: name }); // 저장만(#22-보정 5) — 커밋 + "가져옴" 한 줄, AI 턴 없음
    await openWeb(`/works/${id}`);
}
async function takeLinks() {
    const urls = await T().core.invoke("take_deep_links");
    for (const u of urls)
        await handleLink(u);
}
// 작업 열기(#133) — 이 PC에 장이 없으면(초대받은 작업·다른 PC 작업) 먼저 서버 판을 받고 연다
async function openWork(w, line) {
    const files = await T().core.invoke("work_files", { id: w }).catch(() => []);
    if (!files.some(f => /^result-[a-z0-9-]+\.html$/.test(f.name))) {
        const { pullWork, sharedWorks: sw } = await import("./chat.js");
        sw.add(w);
        await pullWork(w, true).catch(() => false);
    }
    await openWeb(`/works/${w}`);
    if (line)
        await postChat(w, [{ role: "event", text: line, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
}
export async function handleLink(raw) {
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        return;
    }
    const action = url.hostname || url.pathname.replace(/^\/+/, "").split("/")[0];
    const p = url.searchParams;
    const w = p.get("work") ?? "";
    // 딥링크는 넷뿐(#20) — 작업은 전부 작업실 메시지로 온다(만들기·수정·공개·사진·되돌리기 = 문장)
    if (action === "connect") {
        startOnboard(false);
        return;
    } // 웹 [앱에서 AI 연결] — AI 고르기·공식 로그인 화면
    if (action === "import") {
        await importFolder(p.get("path") || undefined);
        return;
    }
    if (action === "update") {
        await forceUpdate(true);
        return;
    }
    // 웹 화면 열기(#21 보정 13 — Safari 등 브릿지가 막힌 브라우저의 [앱에서 열기]) — 우리 웹의 경로만
    if (action === "page") {
        const path = p.get("path") ?? "";
        if (/^\/[\w/?=&.-]*$/.test(path) && !path.includes("..") && !path.startsWith("//"))
            await openWeb(path);
        return;
    } // 웹 [앱 업데이트](#21 보정 2)
    if (action === "claim") {
        await claimLink(p.get("code") ?? "", w);
        return;
    }
    // 초대 링크를 이 PC 앱 계정으로(#186 — 브라우저가 새 계정을 만들어 한 사람이 계정 여럿·이 PC 계정은 멤버가 아니었다): 앱이 있으면 초대 페이지가 먼저 여기로 보낸다
    if (action === "invite") {
        const t = p.get("token") ?? "";
        if (!/^[\w-]{10,100}$/.test(t))
            return;
        if (!S.token)
            await deviceAccount().catch(() => false);
        const r = S.token ? await api("POST", "/api/app/invite", { token: t }).catch(() => null) : null;
        if (r?.status === 200 && r.data?.work && WORK_ID.test(r.data.work))
            await openWork(r.data.work);
        else
            toast("초대 링크가 끝났어요 · 새 링크를 받아 주세요");
        return;
    } // 초대받은 사람의 [앱에서 열기](#142 추가 4 ③)
    if (action === "link") {
        await linkBrowser(p.get("s") ?? "");
        return;
    } // [앱으로 로그인](#20) — 브라우저 세션을 이 계정에   // 폴더 가져오기(#20) — 경로가 오면 확인 창을 먼저
    if (!WORK_ID.test(w))
        return;
    // 결과·오류는 그 작업 채팅에 한 줄(#61 A6 — toast는 숨은 기본 창에 떠서 앱 창에선 안 보였다)
    const say = (text, err = false, extra = {}) => { toast(text); void postChat(w, [{ role: "event", text, payload: { kind: err ? "error" : "stage", ai: "dynapse", ...extra } }]).catch(() => { }); };
    if (action === "open") {
        await openWork(w);
        return;
    } // 인앱 창의 같은 웹 화면(로컬 원본이 IPC로 보인다)
    // [브라우저에서 열기](#35 B2) — 그 페이지를 사진이 들어간 사본(.dynapse/out/⟨page⟩.bundle.html)으로, 이 PC 브리지 주소로 기본 브라우저에
    if (action === "browser") {
        const file = p.get("file") ?? "result-cover.html";
        if (!/^result-[a-z0-9-]+\.html$/.test(file))
            return;
        await ensureVerify(w);
        await appVerify(w, [file]).catch(() => null);
        S.bridge ??= await T().core.invoke("bridge_info").catch(() => null);
        if (!S.bridge) {
            say("브라우저로 열 수 없어요", true);
            return;
        }
        await T().shell.open(`http://127.0.0.1:${S.bridge.port}/works/${encodeURIComponent(w)}/.dynapse/out/${file.replace(/^result-|\.html$/g, "")}.bundle.html?t=${S.bridge.token}`).catch(e => say(`브라우저로 열지 못했어요 · ${String(e).slice(0, 80)}`, true));
        return;
    }
    if (action === "folder") {
        await T().core.invoke("open_work", { id: w, file: null }).catch(e => say(`폴더를 열지 못했어요 · ${String(e).slice(0, 80)}`, true));
        return;
    }
    if (action === "export") { // ~/Downloads zip(렌더 사진이 없으면 검증 1회로 만든 뒤)
        const k0 = p.get("kind") ?? "";
        // AI 사용 기록(#153 ④) — 장과 따로, 이 작업의 기록 PDF 한 장(기본 꺼짐 — 누를 때만)
        if (k0 === "ai-record") {
            say("AI 사용 기록 만드는 중…");
            const nm = (await api("GET", "/api/works").then(r => r.data?.works?.find(x => x.id === w)?.title ?? null).catch(() => null)) ?? null;
            const { aiRecordHtml } = await import("./ai-record.js");
            await wput(w, ".dynapse/out/ai-record.html", await aiRecordHtml(w, nm));
            const r = await exportRender(w, "recordpdf", null, ["--name", `${nm ?? "작업"} AI 사용 기록`]);
            if (!r.ok || !r.pdf) {
                say(`만들지 못했어요 · ${r.error ?? ""}`, true);
                report("export", "export.ai_record_fail", r.error ?? null);
                return;
            }
            say(`내보냈어요 · ${r.pdf.replace(/^.*[\\/](Downloads)[\\/]/, "$1/")}`);
            tally("exports", true);
            return;
        }
        // 학교·회사 PC 안전(#154 ③) — 시스템 글꼴(맑은 고딕·바탕)만으로 다시 짠 PPTX. 이름에 "(학교·회사 PC용)"
        // 내보내기 하나(#218) — auto=1(웹 [내보내기])·kind=auto면 이 PC의 판형(.dynapse/format.json)이 산출물을 정한다(웹과 같은 export-plan). 완료 줄은 용도 말
        let k1 = k0, autoDone = null;
        if (p.get("auto") === "1" || k0 === "auto") {
            const { exportFrame, exportPlan } = await import("./shared/export-plan.js");
            const fr = (await readJson(w, ".dynapse/format.json").catch(() => null))?.frame ?? null;
            const names = (await T().core.invoke("work_files", { id: w }).catch(() => [])).map(f => f.name);
            const pl = exportPlan(exportFrame(fr, names));
            k1 = pl.main.kind;
            autoDone = pl.main.done;
            report("export", "export.auto", `frame=${pl.frame} kind=${k1}`);
        }
        const safe = k1 === "pptx-safe";
        const kind = ["html", "pdf", "photo", "pptx", "png2x", "instagram", "detail"].includes(safe ? "pptx" : k1) ? (safe ? "pptx" : k1) : "png";
        // 보는 언어판(#100) — 네이티브(page_order)가 .dynapse/export-lang.json의 언어판만 묶는다. 없으면 원문
        const xl = (p.get("lang") ?? "").match(/^(en|ko|ja|zh|es|fr|de|vi|th|id|pt|it|ru|ar|hi)$/)?.[0] ?? null;
        await wput(w, ".dynapse/export-lang.json", JSON.stringify({ lang: xl })).catch(() => { });
        // 숨긴 장(2026-10-11) — 서버에 저장된 목록을 받아 .dynapse/hidden.json으로(PPTX·2배 PNG·상세 = verify.mjs, PDF·PNG·HTML = 앱이 그 장을 뺀다). 못 받으면 지난 목록 그대로
        {
            const hr = await api("GET", `/api/works/${encodeURIComponent(w)}/hidden`).catch(() => null);
            const hid = hr?.status === 200 ? hr.data?.hidden ?? [] : null;
            // 장 순서(#189) — 웹에서 바꾼 순서가 이 PC보다 새것이면 그 순서로 맞춘 뒤 내보낸다(서버가 이긴다 · PDF·PNG·PPTX 모두 pages.json을 읽는다)
            if (hr?.status === 200 && hr.data?.order?.length) {
                const { serverOrder } = await import("./chat.js");
                await serverOrder(w, hr.data.order, Number(hr.data.order_at) || 0).catch(() => false);
            }
            // 이 묶음만(#139 §2) — 고른 묶음 밖의 장을 이번 내보내기에서만 숨긴 것으로(서버 숨김 목록은 그대로)
            const xb = (p.get("bundle") ?? "").slice(0, 30), keep = xb ? (await bundlesOf(w).catch(() => [])).find(b => b.name === xb)?.pages : undefined;
            const all = keep ? ((await readPages(w).catch(() => null)) ?? []).concat((await readJson(w, ".dynapse/appendix.json").catch(() => null)) ?? []) : [];
            const out = keep ? [...new Set([...(hid ?? []), ...all.filter(f => !keep.includes(f))])] : hid;
            if (out)
                await wput(w, ".dynapse/hidden.json", JSON.stringify(out)).catch(() => { });
            else if (keep)
                await wput(w, ".dynapse/hidden.json", JSON.stringify(all.filter(f => !keep.includes(f)))).catch(() => { });
        } // PDF = 전체 페이지를 한 파일로(인쇄용) · photo = 사진 작업의 지금 사진 한 장 · pptx = 편집 가능한 PPTX(#73) · png2x = 2배 PNG
        // 인쇄용 PDF(#217 보정 1 — 인쇄 판 작업에서만): verify --printpdf가 판 크기 PDF + TrimBox/BleedBox를 Downloads에. print-marks = 판 바깥 재단 표시 판. 완료 줄 + 색 경고 한 줄
        if (k1 === "print" || k1 === "print-marks") {
            say("인쇄용 PDF 만드는 중…");
            const nm = (await api("GET", "/api/works").then(r => r.data?.works?.find(x => x.id === w)?.title ?? null).catch(() => null)) ?? "인쇄";
            const r = await exportRender(w, "printpdf", null, ["--name", nm, ...(k1 === "print-marks" ? ["--marks"] : [])]);
            if (!r.ok || !r.pdf) {
                say(`만들지 못했어요 · ${r.error ?? ""}`, true);
                report("export", "export.print_fail", r.error ?? null);
                tally("exports", false);
                return;
            }
            if (r.checks?.length)
                report("export", "export.print_checks", r.checks.join(" | ").slice(0, 200));
            say(`인쇄소에 보내요 · 재단 여유 ${r.bleed_mm ?? 3}mm 포함${r.trim_mm ? ` · 완성 ${r.trim_mm.map(Math.round).join("×")}mm` : ""} · ${r.pdf.replace(/^.*[\\/](Downloads)[\\/]/, "$1/")}${r.checks?.length ? ` · 확인할 것: ${r.checks[0].replace(/^EX\d+\s*/, "")}` : ""}`, false, { export: k1 });
            say("인쇄하면 보라·파랑은 탁해지고 큰 검정 면·남색은 잉크가 많아져요 — 인쇄소에서 CMYK로 바꾼 미리보기를 한 번 보세요", false);
            tally("exports", true);
            void onbOnce("first_export", `app:export_${k1}`);
            return;
        }
        if (kind === "png") {
            const f = await T().core.invoke("work_files", { id: w }).catch(() => []);
            if (xl) {
                await ensureVerify(w);
                await appVerify(w, f.map(x => x.name).filter(n => n.endsWith(`.${xl}.html`) && n.startsWith("result-")));
            }
            else if (!f.some(x => x.name.startsWith(".dynapse/out/"))) {
                await ensureVerify(w);
                await appVerify(w);
            }
        }
        say(kind === "pdf" ? "PDF 만드는 중…" : kind === "pptx" ? "PPTX 만드는 중…" : "내보내는 중…");
        // PPTX·2배 PNG(#73) — 앱이 렌더해 둔 뒤 Downloads로(브라우저 다운로드가 아니라 앱이 쓰고 Finder/탐색기에서 보인다 — 앱 창에서도 같은 길)
        let compatNote = "";
        if (kind === "pptx" || kind === "png2x") {
            if (kind === "pptx" && !safe)
                await pptxFonts(w).catch(() => 0); // 덱 글꼴 서브셋을 받아 두면 verify가 PPTX에 심는다(#164 ①)
            const r = await exportRender(w, kind, xl, safe ? ["--system-fonts"] : []);
            if (!r.ok) {
                {
                    say(`내보내지 못했어요 · ${r.error ?? ""}`, true);
                    report("export", `export.${kind}_fail`, r.error ?? null);
                    tally("exports", false);
                    return;
                }
            }
            void onbOnce("first_export", `app:export_${kind}`); // 깔때기 10(#149) — PPTX·2배 PNG는 Downloads로 바로 쓰고 끝날 수 있다
            // 호환 보고(#81 보정 1) — 깨뜨리지 않고 평탄화한 것을 칩처럼 한 줄로(compat.txt와 같은 내용) · 처음이면 제안 카드 한 번
            const c = r.compat;
            if (kind === "pptx" && c) {
                // 이미지로 바뀌는 곳은 무엇인지 이름으로(#154 ③ — "도식 2곳·거대 숫자 1곳")
                const im = [c.viz ? `도식 ${c.viz}곳` : "", c.bigNum ? `거대 숫자 ${c.bigNum}곳` : "", c.textImg ? `꾸민 글자 ${c.textImg}곳` : ""].filter(Boolean);
                const it = [im.length ? `${im.join("·")} → 이미지로` : "", c.shadow ? `그림자 ${c.shadow}곳 → 배경 그림에` : "", c.gradient ? `그라데이션 ${c.gradient}곳 → 배경 그림에` : "", c.textShadow ? `글자 그림자 ${c.textShadow}곳 → 없어짐` : "", c.alpha ? `투명 글자 ${c.alpha}곳 → 불투명 색` : "", c.webp ? `WebP ${c.webp}장 → JPEG` : "", r.embedded?.length ? `글꼴 ${new Set((r.embedded ?? []).map(x => x.replace(/ \d+$/, ""))).size}개를 넣었어요 · PowerPoint 2016 이상에서 그대로 보여요(한쇼·폴라리스는 맑은 고딕)` : c.fonts?.length ? `글꼴 ${c.fonts.slice(0, 2).join("·")} → 맑은 고딕(한쇼·폴라리스)` : ""].filter(Boolean); // 심었으면 그 사실을(#169 ①)
                if (it.length)
                    compatNote = ` · ${it.join(" · ")}`;
                // 글꼴 한 줄(#154 ③) — PPTX는 글꼴을 심을 수 없다: 이름은 그대로(있으면 그대로 보임), 없는 PC를 위해 [글꼴 받기](OFL 받는 곳). 학교·회사 PC용은 시스템 글꼴이라 없음
                if (!safe && c.fonts?.length && !r.embedded?.length)
                    void postChat(w, [{ role: "event", text: `글꼴 ${c.fonts.slice(0, 2).join("·")}가 없는 PC에선 비슷한 글꼴로 보여요`, payload: { kind: "export-fonts", ai: "dynapse",
                                fonts: c.fonts.slice(0, 4).map(f => ({ name: f, url: /^pretendard/i.test(f) ? "https://github.com/orioncactus/pretendard/releases" : `https://fonts.google.com/specimen/${encodeURIComponent(f).replace(/%20/g, "+")}` })) } }]).catch(() => { });
                const n = (c.shadow ?? 0) + (c.gradient ?? 0) + (c.textShadow ?? 0) + (c.alpha ?? 0) + (c.webp ?? 0);
                if (n)
                    void askCompatOnce(w, n).catch(() => { });
            }
        }
        // 인스타·상세페이지(#81 §3) — 규격 파일 묶음(AI 0). 인스타는 카드 작업만(슬라이드를 잘라 정사각으로 만들지 않는다 — 웹이 안내 카드를 띄운다)
        let caption = null;
        if (kind === "instagram") {
            const files = (await T().core.invoke("work_files", { id: w }).catch(() => [])).map(f => f.name);
            if (!files.some(f => /^result-card-\d+\.html$/.test(f))) {
                say("인스타는 카드뉴스 작업에서 · 슬라이드를 자르면 깨진 카드가 돼요", true);
                return;
            }
            const r = await exportRender(w, "png2x", xl);
            if (!r.ok) {
                {
                    say(`내보내지 못했어요 · ${r.error ?? ""}`, true);
                    report("export", `export.${kind}_fail`, r.error ?? null);
                    tally("exports", false);
                    return;
                }
            }
            caption = await instaCaption(w, files).catch(() => null);
        }
        // 카드 작업의 PNG 묶음에도 caption.txt(#157 ⑤ — 본문 요약·해시태그·출처). 묶음에 넣는 건 앱 본체가 새 판일 때(옛 판은 무시)
        if ((kind === "png" || kind === "png2x") && !caption) {
            const files = (await T().core.invoke("work_files", { id: w }).catch(() => [])).map(f => f.name);
            if (files.some(f => /^result-card-\d+\.html$/.test(f)))
                caption = await instaCaption(w, files).catch(() => null);
        }
        if (kind === "detail") {
            const r = await exportRender(w, "detail", xl);
            if (!r.ok) {
                {
                    say(`내보내지 못했어요 · ${r.error ?? ""}`, true);
                    report("export", `export.${kind}_fail`, r.error ?? null);
                    tally("exports", false);
                    return;
                }
            }
        }
        // HTML 레시피 접힘(#74 보정 1) — 이 작업의 사용량 한 줄을 서버에서 받아 두면 내보낸 deck.html 아래에 접혀 들어간다(없거나 실패하면 접힘 없음)
        if (kind === "html") {
            const u = await api("GET", `/api/works/${w}/metrics`).then(r => (r.status === 200 ? r.data : null)).catch(() => null);
            await wput(w, ".dynapse/out/recipe.json", JSON.stringify({ text: u?.text ?? null })).catch(() => { });
        }
        // 파일 이름 = 작업 제목(대표 2026-10-06: wrk_… 이름을 알아볼 수 없다) — 최근 목록에 없으면 서버 목록에서
        // 최근 목록 이름은 요청 첫 줄이라(2026-10-12 "[The folder's documents and.pdf") 서버의 작업 제목을 먼저
        const name = (await api("GET", "/api/works").then(r => r.data?.works?.find(x => x.id === w)?.title ?? null).catch(() => null)) ?? S.recent.find(r => r.work === w)?.t ?? null;
        // 플립북 PDF(#110 보정 1) — 장에 data-flip·data-flip-next가 있으면 그 자리만 중간 장을 끼운 PDF(verify.mjs --flippdf, ~/Downloads). 표시가 없으면 지금 PDF 그대로
        if (kind === "pdf") {
            const files = (await T().core.invoke("work_files", { id: w }).catch(() => [])).map(f => f.name).filter(n => /^result-[a-z0-9-]+(\.[a-z]{2})?\.html$/.test(n));
            let marked = false;
            for (const f of files) {
                if (/\bdata-flip(-next)?\s*=/.test((await wget(w, f).catch(() => null)) ?? "")) {
                    marked = true;
                    break;
                }
            }
            if (marked) {
                say("플립북 PDF 만드는 중…");
                const r = await exportRender(w, "flippdf", xl, ["--name", (xl && name ? `${name}-${xl}` : name) ?? w]);
                if (!r.ok || !r.pdf) {
                    {
                        say(`내보내지 못했어요 · ${r.error ?? ""}`, true);
                        report("export", `export.${kind}_fail`, r.error ?? null);
                        tally("exports", false);
                        return;
                    }
                }
                say(`내보냈어요 · ${r.pdf.replace(/^.*[\\/](Downloads)[\\/]/, "$1/")} · 장 ${r.main} → ${r.total} · 플립 ${r.flips}곳 · ${Math.round((r.size ?? 0) / 1048576 * 10) / 10}MB${r.thinned ? " · 50MB를 넘지 않게 중간 장을 줄였어요" : ""}`);
                return;
            }
        }
        await T().core.invoke("export_work", { id: w, kind, caption, name: safe ? `${name ?? "deck"} (학교·회사 PC용)` : xl && name ? `${name}-${xl}` : name }).then(path => { tally("exports", true); void localRateOnce(w); void onbOnce("first_export", `app:export_${kind}`); return path; }).catch(e => { report("export", `export.${kind}_native`, String(e).slice(0, 120)); tally("exports", false); throw e; }).then(path => say(`${autoDone ?? "내보냈어요"} · ${path.replace(/^.*[\\/](Downloads)[\\/]/, "$1/")}${kind === "pptx" ? ` · 고친 PPTX를 이 작업 채팅에 끌어다 놓으면 바뀐 글·사진이 돌아와요${compatNote}` : ""}`, false, { export: kind })); // export(#83 §2) — 인스타면 웹이 줄 끝에 [다음 회차].catch(e => say(`내보내지 못했어요 · ${String(e).slice(0, 80)}`, true));
    }
}
// ───────────── 업데이트 (docs/11 §3.4) ─────────────
// 실행 중 = 어느 작업실 세션이 턴을 도는 중(#20 — 실행 경로는 대화 하나)
function jobRunning() { return [...sessions.values()].some(s => s.busy); }
// 로그인이 도는 중(#204 보정 1) — 새로고침(OTA·업데이트)은 기다린다. 브라우저가 돌아올 로그인 프로그램을 잃지 않게
const loginRunning = () => Object.values(loginLive).some(l => !!l && !l.exited && Date.now() - l.at < 300_000) || (!!agyLive && !agyLive.exited && Date.now() - agyLive.at < 330_000);
// 실행 줄 — 도는 턴 한 줄(AI · 작업 · 단계) + [보기]. 없으면 home.ts의 유휴 칩
function runLine() {
    for (const [key, s] of sessions)
        if (s.busy) {
            const id = key.split("|")[0], title = S.recent.find(r => r.work === id)?.t ?? id;
            return `<div class="job"><span class="job__title">${esc(title)}</span><span class="job__stage">${esc(s.lastStage ?? "읽는 중")}${s.runModel ? ` · ${esc(shortModel(s.runModel))}` : ""}</span><span class="job__btns"><button class="pill pill--sm" data-act="open-work" data-id="${esc(id)}">보기</button></span></div>`;
        }
    return "";
}
// 모델 짧은 이름(#20 모델 표기 — 웹 lib/model-name과 같은 규칙) — 실행 줄에 "· Opus 4.6"
function shortModel(id) {
    const m = id.match(/^claude-(opus|fable|sonnet|haiku)-(\d+(?:-\d+)?)/i);
    return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2].replace(/-/g, ".")}` : id.replace(/^gpt-/i, "GPT-");
}
// 확인 + 받기 — 2분 안에 끝나지 않으면 실패로(2026-10-19: 멈춘 확인 하나가 forcing을 잡고 있어 웹 [앱 업데이트]를 아무리 눌러도 아무 일 없던 것)
const UPDATE_CHECK_MS = 120_000;
async function checkUpdate(manual) {
    if (!S.app?.updater)
        return null; // 로컬 빌드 — 조용히(문구 없음)
    if (manual)
        toast("확인하는 중…");
    try {
        const u = await Promise.race([
            T().core.invoke("update_check", { channel: S.channel }),
            new Promise((_, rej) => setTimeout(() => rej(new Error("2분 안에 받지 못했어요(네트워크·보안 프로그램)")), UPDATE_CHECK_MS)),
        ]);
        if (u) {
            S.updateReady = u.version;
            if (manual)
                toast(`${u.version} 받음`);
        }
        else if (manual)
            toast("최신");
        render();
        return null;
    }
    catch (e) {
        const why = String(e?.message ?? e);
        console.warn("update check failed", e);
        report("app", "app.update_check_failed", `native=${S.app?.version ?? ""} ${why}`);
        if (manual)
            toast(`확인하지 못했어요: ${why}`);
        markUpdateFail();
        return why;
    }
}
// 업데이트 실패(#185 C 보정 1 — 0.1.74 Windows 사용자가 [업데이트]를 계속 눌렀는데 아무 일도 없었다): 윗줄 한 줄 + [설치 파일 받기] · 웹도 보게 기기 보고(update_fail)
function markUpdateFail() { S.updateFail = true; render(); void reportDevice(); }
// 앱 안 업데이트가 안 되면 — 윗줄 + 설치 파일을 브라우저로(같은 자리에 덮어 설치, 작업·로그인 그대로)
// open = 사람이 누른 길에서만 브라우저를 연다(서버 푸시·켤 때 확인은 윗줄만 — 웹 /connect [설치 파일 받기]가 같은 주소)
function updateFallback(why, open) {
    void flushReports().catch(() => { });
    markUpdateFail();
    if (!open)
        return;
    toast(`앱 안에서 업데이트하지 못했어요 · 설치 파일을 열어요 (${why.slice(0, 80)})`);
    void openInstaller();
}
// [설치 파일 받기] — 그 OS의 최신 설치 파일(/api/app/latest)을 시스템 브라우저로(Windows setup.exe · macOS dmg). 앱은 "설치가 끝나면 다시 열려요"
async function openInstaller() {
    const r = await http("GET", `${HUB}/api/app/latest?os=${encodeURIComponent(S.app?.os ?? "")}`).catch(() => null);
    let url = "";
    try {
        url = String(JSON.parse(r?.body ?? "{}").url ?? "");
    }
    catch { /* */ }
    if (!/^https:\/\//.test(url))
        url = `${HUB}/api/download?os=${S.app?.os === "macos" ? "macos" : "windows"}`;
    await T().shell.open(url).catch(() => { });
    S.installing = true;
    render();
}
// OTA를 못 받는 옛 네이티브(#185 C 보정 1 ②) — 시작 때 한 번 보고, 낮으면 같은 줄을 늘(30분 점검을 기다리지 않는다)
async function checkNativeFloor() {
    const r = await http("GET", `${HUB}/api/app/latest?os=${encodeURIComponent(S.app?.os ?? "")}`).catch(() => null);
    let floor = "";
    try {
        floor = String(JSON.parse(r?.body ?? "{}").ota_native ?? "");
    }
    catch { /* */ }
    const num = (v) => v.split(/[.+]/).slice(0, 3).map(x => Number(x) || 0), lt = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    if (floor && S.app?.version && lt(num(S.app.version), num(floor)) < 0)
        markUpdateFail();
}
// 서버가 요구하거나(update_required) 웹 [앱 업데이트](dynapse://update) — 받고, 도는 작업이 없으면 바로 설치·다시 시작
let forcing = false;
const UPDATE_BOOT_MS = 90_000, UPDATE_IDLE_MS = 6 * 60_000; // 켠 직후 · 손대지 않은 시간(웹 창은 5분마다 active를 보낸다)
async function forceUpdate(byUser = false, urgent = false) {
    if (forcing || !S.app?.updater)
        return;
    if (!byUser && S.updateFail)
        return; // 한 번 실패했으면 서버 푸시(심장박동마다 update_required)로는 다시 안 깐다 — 사람이 누를 때만(sync-sim 77: 실패 뒤 설치가 계속 반복)
    forcing = true;
    try {
        if (!S.updateReady) {
            const why = await checkUpdate(false);
            if (why) {
                updateFallback(why, byUser);
                return;
            }
        }
        if (!S.updateReady)
            return;
        // 언제 깔까(2026-10-20 "심리스") — 사람이 눌렀으면 턴만 끝나면 바로. 아니면(서버 푸시·새 판 알림) 켠 직후 90초 안이거나, 6분 넘게 손대지 않았을 때만(보는 중·고치는 중에 다시 시작하지 않는다) · 최대 12시간 기다린다
        const quietNow = () => !jobRunning() && !chatActive() && (byUser || urgent || performance.now() < UPDATE_BOOT_MS || Date.now() - lastActive > UPDATE_IDLE_MS);
        for (let k = 0; k < (byUser || urgent ? 120 : 1440) && !quietNow(); k++)
            await new Promise(r => setTimeout(r, byUser || urgent ? 5000 : 30_000));
        if (quietNow()) {
            toast(`${S.updateReady} · 다시 시작`);
            const why = await installUpdate();
            if (why)
                updateFallback(why, byUser);
        }
        else if (byUser)
            toast("작업이 끝나면 설치할 수 있어요");
    }
    finally {
        forcing = false;
    }
}
// 설치를 시작했는데 다시 켜 보니 그대로면(인스톨러가 막힘·보안 프로그램) — 보고하고 한 번 알린다
const UPDATE_PENDING = "dyn:update-pending";
function updateAfterBoot() {
    let p = null;
    try {
        p = JSON.parse(localStorage.getItem(UPDATE_PENDING) ?? "null");
        localStorage.removeItem(UPDATE_PENDING);
    }
    catch { /* 없음 */ }
    if (!p || !S.app || Date.now() - p.at > 86_400_000)
        return;
    if (S.app.version !== p.from)
        return; // 바뀌었다 = 설치됨
    report("app", "app.update_install_lost", `native=${p.from} to=${p.to}`);
    updateFallback(`${p.to} 설치가 끝나지 않았어요`, false);
}
// 무재시작 업데이트(OTA) — 서명된 화면 묶음을 받아 두고, 도는 작업이 없을 때 화면만 새로고침(앱은 그대로 켜져 있다)
const otaNow = () => window.__DYN_OTA ?? 0;
// OTA 지킴이(#141 §5) — 실패 3번이면 내장 코드로(ota_reset) · 그 번호는 store ota_skip에 적어 다시 받아도 곧바로 되돌린다 · 보고 ota.reverted(서버가 기기 수를 센다)
// 건너뛸 묶음은 "네이티브+번호"로(2026-10-17 — 숫자만 적어 0.1.79 때의 건너뛰기가 0.1.80+ota1까지 막았다)
onOtaBad(n => {
    void (async () => {
        await store.set("ota_skip", `${S.app?.version ?? ""}+${n}`).catch(() => { });
        await store.save().catch(() => { });
        report("app", "app.ota_reverted", `ota=${n} native=${S.app?.version ?? ""}`);
        await flushReports().catch(() => { });
        await T().core.invoke("ota_reset").catch(() => { });
        location.reload();
    })();
});
let otaBusy = false;
const otaFailSeen = new Set();
async function otaCheck() {
    if (otaBusy || !S.app?.updater)
        return;
    otaBusy = true;
    try {
        const raw = await store.get("ota_skip").catch(() => null);
        const m = typeof raw === "string" ? raw.match(/^(.+)\+(\d+)$/) : null;
        const skip = m && m[1] === S.app?.version ? Number(m[2]) : 0; // 다른 네이티브의 건너뛰기·예전 숫자 값은 무시
        if (raw !== null && raw !== undefined && !skip) {
            await store.delete("ota_skip").catch(() => { });
            await store.save().catch(() => { });
        }
        // 받기 실패는 주소와 함께 보고(2026-10-20 — 거울이 manifest를 잘라 보내 하루 종일 OTA가 안 갔는데 보고가 없어 몰랐다). 같은 오류는 하루 한 번
        const n = await T().core.invoke("ota_fetch", { skip }).catch(e => {
            const msg = String(e).slice(0, 300), k = `ota_fail:${new Date().toLocaleDateString("sv")}:${msg.slice(0, 60)}`;
            if (!otaFailSeen.has(k)) {
                otaFailSeen.add(k);
                report("app", "app.ota_fetch_failed", `native=${S.app?.version ?? ""} ${msg}`);
            }
            return null;
        });
        // 되돌린 묶음이 다시 오면(지금 네이티브는 skip을 모른다) 받자마자 내장 코드로 — 새로고침하지 않는다
        if (n && n === skip) {
            await T().core.invoke("ota_reset").catch(() => { });
            return;
        }
        if (!n || n <= otaNow())
            return;
        // 쉬는 중일 때만 — 대화 턴·사진 턴·막 받은 메시지 모두(chatActive). 한가해진 뒤 3초 더 조용하면 새로고침(받는 순간 새로고침돼 메시지를 잃던 것)
        const busy = () => jobRunning() || chatActive() || loginRunning();
        for (let k = 0; k < 360; k++) {
            if (!busy()) {
                await new Promise(r => setTimeout(r, 3000));
                if (!busy())
                    break;
            }
            else
                await new Promise(r => setTimeout(r, 5000));
        }
        if (busy())
            return;
        for (const s of sessions.values())
            if (s.procId !== undefined)
                await T().core.invoke("run_close_stdin", { id: s.procId }).catch(() => { }); // 쉬는 세션은 닫는다(다음 메시지에 --resume)
        location.reload();
    }
    finally {
        otaBusy = false;
    }
}
let lastCheck = 0;
function checkSoon() { if (Date.now() - lastCheck > 10 * 60_000) {
    lastCheck = Date.now();
    void checkUpdate(false);
} }
export async function installUpdate() {
    if (jobRunning()) {
        toast("작업이 끝나면 설치할 수 있어요");
        return null;
    }
    try {
        localStorage.setItem(UPDATE_PENDING, JSON.stringify({ from: S.app?.version ?? "", to: S.updateReady ?? "", at: Date.now() }));
    }
    catch { /* 못 씀 */ }
    try {
        await T().core.invoke("update_install");
        return null;
    }
    catch (e) {
        try {
            localStorage.removeItem(UPDATE_PENDING);
        }
        catch { /* */ }
        const why = String(e?.message ?? e);
        report("app", "app.update_install_failed", `native=${S.app?.version ?? ""} ${why}`);
        toast(`설치하지 못했어요: ${why}`);
        markUpdateFail();
        return why;
    }
}
const LOCATION_MSG = { dmg: "디스크 이미지", translocated: "격리 위치", outside: "응용 프로그램 폴더 밖" };
// ───────────── 첫 실행 온보딩 (WORKORDER #12 B) — "어떤 AI를 쓰세요?" → 공식 로그인 → 연결됐어요 ─────────────
// Dynapse 로그인 뒤 — 로그인된 AI는 조용히 연결하고 끝(고르기 카드 없음). 아무것도 없어도 끝: 첫 요청이 ChatGPT 로그인을 바로 연다(autoConnect)
async function afterAccount() {
    // 새 PC(#142 — 계정이 쓰던 AI를 기억): 이 PC에 준비된 AI가 하나도 없고 계정이 쓰던 AI가 있으면, 그것만 조용히 설치하고 로그인 창을 차례로(고르기 없음)
    {
        await detect("claude").catch(() => { });
        await detect("codex").catch(() => { });
        const none = !["claude", "codex"].some(t => S.tools[t].installed && S.tools[t].loggedIn);
        const mine = (S.myAis ?? []).filter(x => x === "claude" || x === "codex");
        if (none && mine.length)
            for (const t of mine) {
                if (!S.tools[t].installed)
                    await installCli(t).catch(() => { });
                if (S.tools[t].installed && !S.tools[t].loggedIn)
                    await openLogin(t).catch(() => false);
            }
    }
    for (const t of ["claude", "codex"]) {
        await detect(t).catch(() => { });
        if (S.tools[t].installed && S.tools[t].loggedIn && S.tools[t].connected !== true)
            await connectTool(t, true).catch(() => false);
    }
    await agDetect().catch(() => { });
    await finishOnboard();
}
// 첫 요청에 AI가 없으면(#142 추가 3 §2) — ChatGPT 로그인을 곧바로(설치가 없으면 조용히 설치부터). 요청은 기다렸다가 연결되는 순간 시작(replayWaiting). 10분에 한 번
let autoAt = 0;
export async function autoConnect() {
    if (Date.now() - autoAt < 600_000)
        return;
    autoAt = Date.now();
    const pick = S.tools.codex.installed || !S.tools.claude.installed ? "codex" : "claude";
    if (!S.tools[pick].installed) {
        // 설치는 묻지 않고 앱이(#142 추가 5 §1) — 기다리는 작업에 진행 줄 하나. 사다리(창 없는 공식 설치 → 이식형 Node+npm → 설치 창)가 다 막히면 이 PC 엔진으로
        {
            const { waitingTake } = await import("./chat.js");
            for (const id of new Set(waitingTake(false).map(w => w.id)))
                await postChat(id, [{ role: "event", text: ONB.installing, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
        }
        await installCli(pick).catch(() => { });
        if (!S.tools[pick].installed) {
            await localFallback();
            return;
        }
    }
    if (await openLogin(pick).catch(() => false)) {
        if (S.tools[pick].connected !== true)
            await connectTool(pick, true).catch(() => false);
        void replayWaiting();
        return;
    }
    // 로그인이 안 되면(계정 없음·막힘·닫음) 멈추지 않는다(#142 추가 5 §4 · 추가 6 순간 2) — 이 PC 엔진을 설치 사다리로 준비하고(진행 줄) 기다리던 요청을 이 PC로
    await localFallback();
}
let fallbackArmed = false;
async function localFallback() {
    const { L, localReady } = await import("./engines.js"), { waitingTake } = await import("./chat.js");
    if (!L.bundle)
        return; // 이 PC에 맞는 엔진이 없으면(사양 부족) 카드의 [다시]·[나중에]로 남는다
    const works = [...new Set(waitingTake(false).map(w => w.id))];
    if (!localReady()) {
        for (const id of works)
            await postChat(id, [{ role: "event", text: ONB.installing, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
        await localAction("start").catch(() => { });
    }
    if (!localReady()) {
        if (!fallbackArmed) {
            fallbackArmed = true;
            const { onLocalReady } = await import("./engines.js");
            onLocalReady(() => { fallbackArmed = false; void localFallback(); });
        }
        return;
    } // 받기가 길면 끝나는 순간 이어서
    const { runLocalTurn } = await import("./fill-runner.js");
    for (const w of waitingTake(true)) {
        await postChat(w.id, [{ role: "event", text: ONB.local_model, payload: { kind: "stage", ai: "dynapse" } }]).catch(() => { });
        await runLocalTurn(w.id, w.opts?.raw ?? w.text, w.opts ?? {}).catch(() => { });
    }
}
// [한 번에 연결](#142 추가 2) — ChatGPT → Claude → Gemini 차례로(이미 된 것은 건너뜀, 동시에 둘 아님). 단계마다 그 작업 대화에 한 줄, [이건 건너뛰기] = loginSkip
// 실패는 적고 넘어간다(멈추지 않음). 끝에 역할 지도 한 줄. 비밀번호·자동 입력 없음 — 로그인은 각 공식 창에서 사람이
let allRun = null;
export function loginSkip() { const c = allRun?.cur; const lv = c ? loginLive[c] : undefined; if (lv)
    lv.skip = true; if (lv && !lv.exited)
    void T().core.invoke("run_kill", { id: lv.pid }).catch(() => { }); if (c)
    delete loginLive[c]; }
export async function loginAll(work) {
    if (allRun)
        return;
    allRun = { work, cur: null };
    const say = (t, extra = {}) => postChat(work, [{ role: "event", text: t, payload: { kind: "login-all", ai: "dynapse", ...extra } }]).catch(() => { });
    const steps = [{ id: "codex", name: "ChatGPT" }, { id: "claude", name: "Claude" }, { id: "gemini", name: "Gemini" }];
    const done = [], skipped = [];
    try {
        for (const [i, st] of steps.entries()) {
            const ready = st.id === "gemini" ? S.ag.installed && S.ag.loggedIn === true : S.tools[st.id].installed && S.tools[st.id].loggedIn === true;
            if (ready) {
                done.push(st.name);
                continue;
            }
            allRun.cur = st.id;
            await say(`${i + 1}/3 ${st.name} 로그인 창을 띄웠어요 · 열린 창에서 로그인하면 다음으로 넘어가요`, { step: i + 1, ai_now: st.id });
            let ok = false;
            if (st.id === "gemini") {
                if (!S.ag.installed)
                    await installCli("gemini").catch(() => { });
                ok = S.ag.installed ? await agyLogin().catch(() => false) : false;
            }
            else {
                if (!S.tools[st.id].installed)
                    await installCli(st.id).catch(() => { });
                ok = S.tools[st.id].installed ? await openLogin(st.id).catch(() => false) : false;
            }
            (ok ? done : skipped).push(st.name);
            if (!ok)
                report("install", "install.login_all_skip", st.id);
        }
    }
    finally {
        allRun = null;
    }
    const has = (n) => done.includes(n);
    const edit = has("Claude") ? "Claude" : has("ChatGPT") ? "ChatGPT" : null, photo = has("ChatGPT") ? "ChatGPT" : has("Gemini") ? "Gemini" : null;
    await say(`${skipped.length ? `연결됨 ${done.length}개 · 건너뜀 ${skipped.join("·")}` : "모두 연결됨"} — 편집: ${edit ?? "없음(Claude나 ChatGPT)"} · 사진: ${photo ?? "없음(ChatGPT나 Gemini)"}`, { end: true });
    void replayWaiting();
}
function startOnboard(first) {
    void T().core.invoke("show_main", { show: true }).catch(() => { });
    // Dynapse 로그인이 1단계(#135 §9) — 앱 안에서 이메일 코드(브라우저 없음). 로그인하면 받을 작업·팀 설정을 안다. 이미 연결돼 있으면 건너뛴다
    S.onboard = { step: S.token ? "pick" : "account", picked: [], queue: [], hubStarted: false, connected: [], first };
    render();
    // 첫 실행은 브라우저 [허용] 한 번이 기본(웹에 로그인돼 있으면 클릭 하나) — 이메일 코드는 같은 카드의 다른 길
    if (first && !S.token) {
        const o = S.onboard;
        o.accBusy = true;
        render();
        void hubLogin().then(async () => { o.accBusy = false; if (S.token && S.onboard === o) {
            o.hubStarted = true;
            await afterAccount();
        }
        else
            render(); });
    }
}
async function onboardNext() {
    const o = S.onboard;
    if (!o)
        return;
    if (o.step === "pick") {
        o.queue = o.picked.filter(p => p !== "gemini").map(p => (p === "chatgpt" ? "codex" : "claude"));
        // 마무리(#12-N N1): 디자인 AI 중 먼저 고른 것
        const first = o.picked.find(p => p === "claude" || p === "chatgpt") ?? null;
        if (first) {
            await store.set("primary_pref", first);
            await store.save();
        }
        o.agDone = false;
        o.step = "tool";
    }
    while (o.queue.length) {
        const id = o.queue[0];
        o.current = id;
        o.phase = "checking";
        render();
        if (!Object.keys(S.minVersions).length)
            await loadMinVersions();
        await detect(id);
        const t = S.tools[id];
        if (t.installed && isOld(id)) {
            o.phase = "latest";
            render();
            await bringLatest(id);
        } // 설치됨·구버전 → 공식 명령 먼저 (#12-D D1)
        if (!t.installed) {
            o.phase = "install";
            render();
            // 설치를 3초마다 확인(최대 10분) — 설치되면 알아서 로그인 단계로. [나중에]를 누르면 멈춘다
            // 10분 뒤에도 멈추지 않는다(#135 — 10분 지나면 "설치를 기다리는 중…"에서 끝났다): 그 뒤엔 15초마다(직접 설치·IT가 설치해 준 경우도 알아서 넘어간다)
            const t0 = Date.now();
            while (S.onboard === o && o.current === id && o.phase === "install") {
                await new Promise(r => setTimeout(r, Date.now() - t0 < 600_000 ? 3000 : 15_000));
                if (S.onboard !== o || o.current !== id || o.phase !== "install")
                    return;
                await detect(id);
                if (S.tools[id].installed)
                    break;
            }
            if (!S.tools[id].installed)
                return;
            continue;
        }
        if (t.loggedIn === false) {
            o.phase = "login";
            render();
            const ok = await openLogin(id);
            if (!ok)
                return; // 3분 안에 안 됐으면 화면의 [로그인 창 다시 열기]
        }
        o.phase = "connecting";
        render();
        // 연결 실패는 토스트 대신 카드 안 한 줄 + [다시]·[건너뛰기](#135 §8) — 조용히 다음 AI로 넘어가지 않는다
        if (await connectTool(id, true))
            o.connected.push(id);
        else {
            o.phase = "connect_fail";
            render();
            report("install", "onboard.connect_fail", id);
            return;
        }
        o.queue.shift();
    }
    if (o.picked.includes("gemini") && !o.agDone) {
        // Gemini: Antigravity CLI(agy) 설치 확인 → 로그인(앱 자격증명 재사용, 없으면 공식 로그인 1회). 사진은 앱이 헤드리스로 (#12-M)
        o.step = "gemini";
        o.current = undefined;
        o.phase = "checking";
        render();
        await agDetect(true);
        if (!S.ag.installed) {
            o.phase = "install";
            render();
            const until = Date.now() + 600_000;
            while (Date.now() < until && S.onboard === o && o.step === "gemini" && o.phase === "install") {
                await new Promise(r => setTimeout(r, 3000));
                if (S.onboard !== o || o.step !== "gemini" || o.phase !== "install")
                    return;
                await agDetect();
                if (S.ag.installed)
                    break;
            }
            if (!S.ag.installed)
                return;
        }
        if (S.ag.loggedIn !== true) {
            o.phase = "login";
            render();
            o.agOk = await agyLogin();
        }
        else
            o.agOk = true;
        o.agDone = true;
    }
    // 끝 화면 = 상태 창 첫 화면(협업 슬라이드, #12-F F1). "연결됐어요" 문장 화면은 없다
    await finishOnboard();
    if (!S.token && !o.hubStarted) {
        o.hubStarted = true;
        await hubLogin();
    } // Dynapse 계정 연결은 이 순간 자동 — 브라우저 [연결 허용] 1클릭
    render();
}
let afterOnboard = null;
// 설치 뒤 열기(#133 · #142 추가 8 ②) — 웹에서 누른 동사가 그대로 이어진다: PPTX로 받기 = 바로 내보내기 · 내 사진·로고 = 끌어 놓을 곳 한 줄 · 말로 고치기 = 실어 보낸 요청이 내 AI로
async function openAfter(oa) {
    const line = oa.request ? "앱을 연결했어요 · 웹에서 쓴 요청을 내 AI로 시작해요" : oa.verb === "photo" ? "앱을 연결했어요 · 내 사진을 이 창에 끌어 놓으면 사진 칸에 들어가요" : oa.verb === "logo" ? "앱을 연결했어요 · 로고 파일을 이 창에 끌어 놓으면 장마다 들어가요" : oa.verb === "pptx" ? "앱을 연결했어요 · PPTX를 만들고 있어요" : "앱을 연결했어요 · 이 작업을 열었어요";
    await openWork(oa.work, line);
    if (oa.verb === "pptx")
        await handleLink(`dynapse://export?work=${encodeURIComponent(oa.work)}&kind=pptx`).catch(() => { });
}
async function finishOnboard() {
    S.onboard = null;
    {
        const oa = afterOnboard;
        afterOnboard = null;
        if (oa) {
            void openAfter(oa);
            await store.set("onboarded", true);
            await store.save();
            render();
            return;
        }
    }
    void replayWaiting(); // 온보딩에서 막 로그인했으면 기다리던 메시지부터(#20)
    await store.set("onboarded", true);
    await store.save();
    render();
    if (S.token)
        void openFirst(); // 온보딩이 끝나면 같은 자리에 웹(#21 보정 8·13)
}
// 첫 화면(#184 — 화면마다 일 하나) — 웹에서 만든 작업이 있으면 가장 최근 작업을 바로(위에 AI 줄), 없으면 빈 작업실(입력칸 하나 + 같은 AI 줄). 폴더·사진 작업은 건너뛴다
async function openFirst() {
    const r = await api("GET", "/api/works").catch(() => null);
    const w = (r?.data?.works ?? []).find(x => x.mine !== false && x.kind !== "folder" && x.kind !== "photo");
    await openFront(w ? `/works/${encodeURIComponent(w.id)}` : "/works/new");
}
// 계정 전환(#22-보정 15) — 공식 로그아웃 → 공식 로그인 창. 자격증명은 CLI가 직접 다룬다. 그 AI의 턴이 돌고 있으면 끝난 뒤에
export async function switchAccount(tool) {
    if (tool === "gemini")
        return agySwitch();
    if (switching[tool])
        return;
    const busy = () => [...sessions.values()].some(s => s.tool === tool && s.busy);
    if (busy()) {
        switching[tool] = "wait";
        void reportDevice();
        const until = Date.now() + 30 * 60_000;
        while (busy() && Date.now() < until)
            await new Promise(r => setTimeout(r, 3000));
    }
    switching[tool] = "run";
    void reportDevice();
    try {
        await exec(tool, tool === "claude" ? ["auth", "logout"] : ["logout"]).catch(() => null);
        for (const [k, s] of sessions)
            if (s.tool === tool && !s.busy)
                sessions.delete(k); // 이전 계정의 대화 세션은 이어 쓰지 않는다
        await openLogin(tool);
    }
    finally {
        delete switching[tool];
        await detect(tool);
        await reportDevice();
    }
}
// 배포 계정(#80) — [설치] = 공식 설치 페이지만(스크립트 래핑 없음) · [로그인]·[다른 계정으로] = 공식 로그인 창 → 2초마다 이 PC에서 다시 확인(최대 3분)
async function gitAction(id, name, model) {
    if (name === "install") {
        await T().shell.open(GIT_INSTALL_URL[id]).catch(() => { });
        return;
    }
    if (name !== "login")
        return;
    const tool = model === "switch" ? `${id === "github" ? "gh" : "vercel"}-switch` : id === "github" ? "gh" : "vercel";
    try {
        await T().core.invoke("open_login", { tool });
    }
    catch (e) {
        toast(String(e));
        void diagAuto({ tool: id === "github" ? "gh" : "vercel", stage: "login", code: "open_login_fail", summary: String(e) });
        return;
    }
    const before = G[id].account, until = Date.now() + 180_000;
    while (Date.now() < until) {
        await new Promise(r => setTimeout(r, 2000));
        await detectGit(id);
        if (G[id].loggedIn && (model !== "switch" || G[id].account !== before))
            break;
    }
    void reportDevice();
}
// 웹이 시키는 앱 동작(#21 보정 13) — AI 이름은 웹 어휘(claude·chatgpt·gemini)
async function appAction(a) {
    if (a.name === "viewer-save") {
        if (WORK_ID.test(a.ai) && /^result-[a-z0-9-]+(\.[a-z]{2})?\.html$/.test(a.model))
            await viewerSaved(a.ai, a.model).catch(() => { });
        return;
    } // 오프라인 보기가 장을 고침(#146)
    if (a.ai === "github" || a.ai === "vercel") {
        await gitAction(a.ai, a.name, a.model);
        return;
    }
    if (a.name === "install" && a.ai === "local") {
        await localAction(a.model || "start");
        void reportDevice();
        return;
    } // 이 PC 엔진(#113) — start·cancel·delete·fix·rollback
    // 인앱 창 세션 되살리기 — 웹이 "이 창에 계정이 없다"고 알리면 1회용 handoff로 같은 주소를 다시 연다(model = relink-⟨base64url 경로⟩)
    if (a.name === "login" && a.ai === "app" && a.model === "active") {
        markActive();
        return;
    } // 웹 창에서 손댐(5분에 한 번)
    if (a.name === "login" && a.ai === "app" && a.model === "nudge") {
        markActive();
        void pullOnce();
        return;
    } // 같은 PC 웹이 메시지를 올림(#115) — 한 번 가져간다
    if (a.name === "login" && a.ai === "app") {
        markActive();
        const m = a.model.match(/^relink(?:-([A-Za-z0-9_-]{1,60}))?$/);
        if (!m)
            return;
        let path = "/works";
        try {
            if (m[1]) {
                const p = decodeURIComponent(escape(atob(m[1].replace(/-/g, "+").replace(/_/g, "/"))));
                if (/^\/[A-Za-z0-9/_\-?=&.%]*$/.test(p) && !p.startsWith("//"))
                    path = p;
            }
        }
        catch { /* /works */ }
        await openFront(path);
        return;
    }
    const tool = a.ai === "chatgpt" || a.ai === "codex" ? "codex" : a.ai === "gemini" || a.ai === "agy" ? "gemini" : "claude";
    // [다른 계정으로](#22-보정 15) — 브릿지 허용 동작을 늘리지 않으려고 login + model "switch"로 받는다
    if (a.name === "login" && a.model === "switch")
        await switchAccount(tool === "gemini" ? "gemini" : tool);
    else if (a.name === "login") {
        if (tool === "gemini")
            await agyLogin();
        else
            await openLogin(tool);
        await autoDetect(true);
    }
    else if (a.name === "install" && a.model === "report")
        void diagReport({ tool: tool === "gemini" ? "agy" : tool }); // [보고하기](진단) — 허용 동작을 늘리지 않으려고 install + model "report"
    else if (a.name === "install")
        await installCli(tool);
    else if (a.name === "update")
        void forceUpdate(true);
    else if (a.name === "add-ai")
        startOnboard(false);
    else if (a.name === "set-model") {
        const role = tool === "codex" ? "chatgpt" : tool;
        if (a.model)
            S.defaultModels[role] = a.model;
        else
            delete S.defaultModels[role];
        await store.set("default_models", S.defaultModels);
        await store.save();
        void reportDevice();
    }
}
// 창 하나, 화면 둘(#21 보정 12) — 트레이 "열기"가 웹을 아직 안 연 상태에서 오면 작업(/works)을, 연결 전이면 홈
async function openFront(path = "/works") {
    if (!S.token || S.onboard) {
        await T().core.invoke("show_main", { show: true }).catch(() => { });
        return;
    }
    await openWeb(path);
}
// 설치 대기 줄(#41 A) — 기다리는 중 / 안 됐음(→ [다시 설치] + 로그) / 끝났는데 못 찾음(→ [다시 확인])
function installRow(tool, dataId, skipAct) {
    const f = S.installFail[tool];
    const log = f?.log ? `<details class="logbox"><summary>로그</summary><pre>${esc(f.log)}</pre></details>` : "";
    const n = S.installStep[tool];
    const status = n ? `설치 중 · ${n}/4 방법 시도 · 끝나면 알아서 넘어가요` : !f ? "설치를 기다리는 중…" : f.status === "missing" ? "설치는 끝났는데 찾지 못했어요" : f.status === "fail:slow" ? "설치 창이 아직 끝나지 않았어요 · 창에서 계속돼요" : "설치가 안 됐어요";
    // 4단계 카드(#134) — 세 방법이 다 막혔을 때만: 이 PC에서 그대로 붙여 넣을 명령 + IT 담당자에게 보낼 한 줄. 진단은 자동으로 보냈다
    const win = navigator.userAgent.includes("Windows"), pkg = tool === "claude" ? "@anthropic-ai/claude-code" : tool === "codex" ? "@openai/codex" : null;
    const cmds = !f || f.status === "missing" ? [] : win
        ? (pkg ? ["winget install OpenJS.NodeJS.LTS", `npm install -g ${pkg}`] : ["irm https://antigravity.google/cli/install.ps1 | iex"])
        : [tool === "claude" ? "curl -fsSL https://claude.ai/install.sh | bash" : tool === "codex" ? "curl -fsSL https://chatgpt.com/codex/install.sh | sh" : "curl -fsSL https://antigravity.google/cli/install.sh | bash"];
    const card = cmds.length ? `<p class="muted">직접 설치하려면 ${win ? "PowerShell" : "터미널"}에 차례로 붙여 넣으세요</p>${cmds.map(c => `<div class="card__row"><code>${esc(c)}</code><button class="pill pill--soft" data-act="copy-cmd" data-id="${esc(c)}">복사</button></div>`).join("")}
    <p class="muted">회사 PC라 막혀 있으면 IT 담당자에게: "nodejs.org · registry.npmjs.org · ${tool === "codex" ? "chatgpt.com · github.com" : tool === "agy" ? "antigravity.google" : "claude.ai · storage.googleapis.com"} 접속을 허용해 주세요" · 진단은 자동으로 보냈어요</p>` : "";
    const main = f?.status === "missing"
        ? `<button class="pill" data-act="install-recheck" data-id="${tool}">다시 확인</button><button class="pill pill--soft" data-act="install" data-id="${dataId}">다시 설치</button>`
        : `<button class="pill" data-act="install" data-id="${dataId}">${f ? "다시 설치" : "설치하기"}</button>`;
    return `<p class="muted">${status}</p>${log}${card}<div class="card__row">${n ? "" : main}<button class="pill pill--soft" data-act="${skipAct}">나중에</button></div>`;
}
// 한 문장(#142 추가 4 ①) — 홈·받기 화면·앱 첫 창이 같은 말
const POSITION = "검증된 디자인에 내 내용을 내 AI가 채워 덱을 만들어요 · 작업은 내 PC에서";
function onboardView() {
    const o = S.onboard;
    const back = o.first ? "" : `<button class="pill pill--soft" data-act="ob-cancel">닫기</button>`;
    if (o.step === "account") {
        const esc = (t) => t.replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]);
        return `<div class="ob">${assemblyHtml()}<p class="muted">${POSITION}</p><h1>Dynapse에 로그인</h1><p class="lead">${o.accBusy && !o.codeSent ? "열린 브라우저에서 [허용]을 누르면 바로 돌아와요." : "브라우저에서 [허용]을 누르거나, 이메일로 받은 6자리 코드를 넣으세요."} 초대받은 작업과 팀 설정이 바로 이어져요.</p>
      <div class="card__row"><input id="ob-email" type="email" autocomplete="email" placeholder="이메일" value="${esc(o.email ?? "")}" ${o.accBusy ? "disabled" : ""} /><button class="pill${o.codeSent ? " pill--soft" : ""}" data-act="ob-code-send" ${o.accBusy ? "disabled" : ""}>${o.codeSent ? "코드 다시 받기" : "코드 받기"}</button></div>
      ${o.codeSent ? `<div class="card__row"><input id="ob-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" value="${esc(o.code ?? "")}" ${o.accBusy ? "disabled" : ""} /><button class="pill" data-act="ob-code-login" ${o.accBusy ? "disabled" : ""}>로그인</button></div>` : ""}
      ${o.accMsg ? `<p class="muted">${esc(o.accMsg)}</p>` : ""}
      <div class="card__row">${back}<button class="pill pill--soft" data-act="ob-browser" ${o.accBusy ? "disabled" : ""}>브라우저로 연결</button><button class="linkbtn" data-act="ob-acc-later">나중에</button></div></div>`;
    }
    if (o.step === "pick") {
        const b = (k, name, note) => `<button class="ob__ai ${o.picked.includes(k) ? "ob__ai--on" : ""}" data-act="ob-pick" data-id="${k}"><b>${name}</b><small>${note}</small></button>`;
        // 하나면 된다(#142 — "둘 다 연결해야 하는 이유를 모르겠다"): 편집 = Claude나 ChatGPT · 사진 = ChatGPT(쉬움)나 Gemini · ChatGPT 하나면 둘 다
        const hint = `<p class="muted" style="margin-top:-4px"><b>편집</b>(글·배치 고치기)은 Claude나 ChatGPT, <b>사진</b>(새로 만들기·바꾸기)은 ChatGPT나 Gemini가 해요. ChatGPT 하나면 둘 다 돼요.</p>`;
        return `<div class="ob">${assemblyHtml()}<p class="muted">${POSITION}</p><h1>어떤 AI를 쓰세요?</h1><p class="lead">쓰고 있는 것 하나만 골라도 돼요. 내 구독으로 이 기기에서 만들어요. 나중에 더할 수 있어요.</p>
      <div class="ob__ais">${b("chatgpt", "ChatGPT", "편집 · 사진 — 추천")}${b("claude", "Claude", "편집")}${b("gemini", "Gemini", "사진")}</div>${hint}
      ${o.picked.includes("gemini") ? `<div class="note">Gemini는 Antigravity 앱 안에서 써요. 앱이 연결해 두면 Antigravity에서 한 문장으로 시작해요.</div>` : ""}
      <div class="card__row">${back}<button class="pill" data-act="ob-next" ${o.picked.length ? "" : "disabled"}>다음</button></div></div>`;
    }
    if (o.step === "tool" && o.current) {
        const id = o.current, name = AI_NAME[id];
        const body = o.phase === "install"
            ? `<h1>${S.tools[id].desktop ? `${name} 앱은 있어요. ${id === "codex" ? "Codex CLI" : RUNNER_NAME[id]} 하나만 더 설치하면 연결돼요` : `${RUNNER_NAME[id]}를 설치하면 ${name}로 ${capsText(CAPS[id])}을 할 수 있어요`}</h1>
         <p class="lead">[설치하기]를 누르면 공식 설치가 새 창에서 진행돼요. 끝나면 앱이 알아서 다음으로 넘어가요.</p>
         ${installRow(id, id, "ob-skip")}`
            : o.phase === "login"
                ? (() => {
                    const lv = loginLive[id];
                    return `<h1>${name}에 로그인하면 ${capsText(CAPS[id])}을 할 수 있어요</h1><p class="lead">${lv ? "브라우저에서 로그인하면 자동으로 돌아와요." : `열린 ${name} 공식 로그인 창에서 로그인해 주세요. 끝나면 자동으로 다음으로 넘어가요.`}</p>
         <p class="muted">${lv?.stale ? "브라우저에서 로그인이 끝났나요?" : "로그인 중…"}</p>
         ${lv && !lv.exited ? `<div class="card__row"><input id="ob-login-code" placeholder="브라우저가 코드를 보여 주면 여기에 붙여넣기" /><button class="pill pill--soft" data-act="ob-login-paste" data-id="${id}">넣기</button></div>` : ""}
         <div class="card__row">${lv?.stale ? `<button class="pill" data-act="ob-login-check" data-id="${id}">확인</button>` : ""}${lv?.url ? `<button class="pill pill--soft" data-act="ob-login-url" data-id="${id}">브라우저 다시 열기</button>` : ""}<button class="pill pill--soft" data-act="ob-relogin">${lv ? "로그인 다시 시작" : "로그인 창 다시 열기"}</button>${lv ? `<button class="linkbtn" data-act="ob-login-term" data-id="${id}">터미널로 로그인</button>` : ""}<button class="pill pill--soft" data-act="ob-skip">건너뛰기</button></div>`;
                })()
                : o.phase === "connect_fail"
                    ? `<h1>${name}를 Dynapse에 연결하지 못했어요</h1><p class="lead">로그인은 됐어요. 연결만 다시 하면 돼요.</p>
         <div class="card__row"><button class="pill" data-act="ob-next">다시</button><button class="pill pill--soft" data-act="ob-skip">건너뛰기</button></div>`
                    : `<h1>${name}</h1><p class="lead">${o.phase === "connecting" ? "연결하는 중…" : o.phase === "latest" ? `${RUNNER_NAME[id]}를 최신으로 맞추는 중…` : "확인하는 중…"}</p>`;
        return `<div class="ob">${body}</div>`;
    }
    if (o.step === "gemini") {
        const body = o.phase === "install"
            ? `<h1>${S.ag.desktop ? "Antigravity 앱은 있어요. Gemini CLI 하나만 더 설치하면 사진을 만들 수 있어요" : "Gemini CLI를 설치하면 Gemini로 사진을 만들 수 있어요"}</h1>
         <p class="lead">[설치하기]를 누르면 공식 설치가 새 창에서 진행돼요. 설치 끝에 Google 로그인이 이어지면, 브라우저에 나온 코드를 그 창에 붙여넣고 Enter를 누르세요.</p>
         ${installRow("agy", "gemini", "ob-ag-skip")}`
            : o.phase === "login"
                ? `<h1>Gemini에 로그인하면 사진을 할 수 있어요</h1><p class="lead">열린 공식 로그인 창에서 로그인해 주세요. 끝나면 자동으로 다음으로 넘어가요.</p>
         <div class="card__row"><button class="pill pill--soft" data-act="ob-ag-skip">나중에</button></div>`
                : `<h1>Gemini</h1><p class="lead">${o.phase === "connecting" ? "연결하는 중…" : "확인하는 중…"}</p>`;
        return `<div class="ob">${body}</div>`;
    }
    return "";
}
// ───────────── 렌더 ─────────────
function aiStates() {
    const busy = (id) => [...sessions.values()].some(x => x.busy && x.tool === id);
    const t = (id, brand) => ({
        key: id, name: AI_NAME[id], runner: RUNNER_NAME[id], caps: CAPS[id], brand,
        checked: S.tools[id].checked, installed: S.tools[id].installed, loggedIn: S.tools[id].loggedIn, connected: !!S.tools[id].connected, busy: busy(id),
    });
    return [t("claude", "claude"), t("codex", "openai"),
        { key: "gemini", name: "Gemini", runner: "Antigravity CLI", caps: ["사진"], brand: "googlegemini",
            checked: S.ag.checked, installed: S.ag.installed, loggedIn: S.ag.loggedIn, connected: S.ag.connected, busy: false }];
}
export function render() {
    // 네이티브 화면은 온보딩과 "연결 전" 한 장뿐(#21 보정 13). 연결된 상태 화면은 웹 /connect
    const a = S.app;
    const loc = a?.updater && a.location_issue ? `⚠ ${LOCATION_MSG[a.location_issue]} · 업데이트 안 됨` : null;
    // 연결 상태 한 줄(#146 §1·§4) — 끊김·회사망일 때만, 확인 창 없이. [다시 시도] = 지금 한 번 확인(그 뒤는 5초→60초 간격)
    const nt = netState();
    const upd = S.installing ? `<span class="netline">설치가 끝나면 다시 열려요</span>` : S.updateFail ? `<span class="netline">새 판을 자동으로 못 깔았어요 · <button type="button" class="linkbtn" data-act="install-file">설치 파일 받기</button></span>` : "";
    $top.innerHTML = `<span class="brandmark"><img src="symbol.svg" alt="" class="top__logo" /><b>Dynapse</b></span>${nt === "online" ? "" : `<span class="netline">${nt === "blocked" ? "회사망이 연결을 막고 있어요" : S.token ? "인터넷이 끊겼어요 · 이 PC에서 계속 작업돼요 · 연결되면 올려요" : "인터넷이 필요해요 · 연결되면 이어서 해요"}${queuedCount() ? ` · 밀린 일 ${queuedCount()}개` : ""} <button type="button" class="linkbtn" data-act="net-retry">다시 시도</button></span>`}${stuckLine ? `<span class="netline netline--quiet">${stuckLine === "ask" ? `막힌 데가 있으면 <button type="button" class="linkbtn" data-act="onb-stuck">여기</button> · 1분 안에 답해요` : "받았어요 · 1분 안에 답해요"}</span>` : ""}`;
    if (upd)
        $top.insertAdjacentHTML("beforeend", upd);
    const logOpen = document.querySelector(".logbox")?.open;
    $app.innerHTML = S.onboard ? onboardView() : mainHtml({ connected: !!S.token, hubBusy: S.hubBusy, version: a ? `${a.version}${otaNow() ? `+ota${otaNow()}` : ""}` : "", location: loc });
    if (logOpen)
        document.querySelector(".logbox")?.setAttribute("open", "");
    const busy = jobRunning();
    if (busy !== busySent) {
        busySent = busy;
        T().core.invoke("set_busy", { busy }).catch(() => { });
    }
    let $t = document.getElementById("toast");
    if (!$t) {
        $t = document.createElement("div");
        $t.id = "toast";
        $t.className = "toast";
        document.body.appendChild($t);
    }
    $t.textContent = S.toast;
    $t.hidden = !S.toast;
}
// ───────────── 상태 자동 감지 (#12-G) — 창이 포커스일 때 3초마다, 준비 안 된 AI만. 로그인되면 연결(MCP 등록)은 조용히 ─────────────
let polling = false;
async function autoDetect(all = false) {
    if (polling || jobRunning() || S.onboard)
        return;
    polling = true;
    const was = JSON.stringify([S.tools.claude.installed, S.tools.claude.loggedIn, S.tools.codex.installed, S.tools.codex.loggedIn, S.ag.installed, S.ag.loggedIn]);
    try {
        for (const id of ["claude", "codex"]) {
            const t = S.tools[id];
            if (!all && t.installed && t.loggedIn && t.connected)
                continue;
            await detect(id);
            if (t.installed && t.loggedIn && t.connected === false)
                await connectTool(id, true);
        }
        if (all || !S.ag.installed || S.ag.loggedIn !== true)
            await agDetect();
        const gw = JSON.stringify(gitBody());
        await detectAllGit().catch(() => { });
        if (JSON.stringify(gitBody()).replace(/"at":\d+/g, "") !== gw.replace(/"at":\d+/g, ""))
            void reportDevice(); // 배포 계정(#80) — 5분에 한 번(gh auth status는 네트워크를 탄다)
        await replayWaiting(); // 로그인되면 기다리던 작업실 메시지를 이어서(#20)
        pushStatus(); // 로그인 확인(토큰 소모)은 하루 1회 캐시 — 3초 루프에서 다시 안 한다
        // 로그인 상태가 바뀌면 곧바로 서버에 — 웹 연결 카드는 기기 보고를 본다(심장박동까지 기다리지 않게)
        // 모델 목록도 다시 — 앱 시작 때 한 번만 읽어서, 켜 둔 채 CLI를 설치·로그인하면 연결 탭 모델 선택이 비어 있었다(2026-09-28 다른 Windows PC)
        if (JSON.stringify([S.tools.claude.installed, S.tools.claude.loggedIn, S.tools.codex.installed, S.tools.codex.loggedIn, S.ag.installed, S.ag.loggedIn]) !== was) {
            await detectModels().catch(() => { });
            void reportDevice();
        }
    }
    finally {
        polling = false;
    }
}
// 창이 포커스면 3초마다. 웹 창을 보는 동안(엔진 창은 숨어 포커스가 없다)에도 12초마다 — 준비 안 된 AI만 보므로 가볍다(2026-09-28 Windows 실측: 웹에서 로그인해도 카드가 안 바뀌었다)
let detectTick = 0;
setInterval(() => { if (document.hasFocus() || ++detectTick % 4 === 0)
    autoDetect(); }, DETECT_MS);
addEventListener("focus", () => { autoDetect(true); void retryPendingPulls().catch(() => { }); }); // 포커스 때도 못 받은 작업 다시(#56, 1분에 한 번)
// ───────────── 이벤트 ─────────────
const LOGOUT_URL = { claude: "https://code.claude.com/docs/en/setup", codex: "https://developers.openai.com/codex/cli", gemini: INSTALL_URL.agy };
// 로그인 칸(#135 §9) — 다시 그려도 적던 글이 남게, Enter = 다음 버튼
document.addEventListener("input", ev => { const t = ev.target; if (!S.onboard || !t)
    return; if (t.id === "ob-email")
    S.onboard.email = t.value; if (t.id === "ob-code")
    S.onboard.code = t.value.replace(/\D/g, ""); });
document.addEventListener("keydown", ev => { const t = ev.target; if (ev.key !== "Enter" || !S.onboard || !t)
    return; if (t.id === "ob-email")
    void codeSend(); if (t.id === "ob-code")
    void codeLogin(); });
// 첫 결과까지 클릭(#142 추가 4 ⑤) — 첫 화면(온보딩) 버튼만 센다
document.addEventListener("click", ev => { const b = ev.target?.closest("[data-act^='ob-']"); if (b && S.token)
    void api("POST", "/api/ttv", {}).catch(() => null); }, true);
document.addEventListener("click", async (ev) => {
    const el = ev.target.closest("[data-act]");
    const inPop = ev.target.closest(".pop");
    const act = el?.dataset.act, id = el?.dataset.id ?? "";
    if (act !== "pop" && !inPop && S.pop) {
        S.pop = null;
        if (!el) {
            render();
            return;
        }
    }
    if (!el)
        return;
    switch (act) {
        case "onb-stuck":
            void stuckSend();
            break; // 설치 뒤 막힘(#149 §4)
        case "net-retry":
            probeSoon(true);
            void http("GET", `${HUB}/api/download?info=1`).catch(() => null);
            break; // 지금 한 번 확인(#146) — 되면 http가 online으로
        case "pop":
            S.pop = S.pop === id ? null : id;
            render();
            if (S.pop === "profile")
                void loadBrowsers();
            break;
        case "login":
            S.pop = null;
            render();
            if (id === "gemini")
                await agyLogin();
            else
                await openLogin(id);
            await autoDetect(true);
            render();
            break;
        case "install":
            await installCli(id === "gemini" || id === "antigravity" ? "gemini" : id);
            break;
        case "install-recheck":
            if (id === "claude" || id === "codex" || id === "agy")
                await installRecheck(id);
            break;
        case "copy-cmd":
            if (id) {
                await navigator.clipboard.writeText(id).catch(() => { });
                toast("복사했어요");
            }
            break;
        case "logout-help":
            await T().shell.open(LOGOUT_URL[id]);
            break;
        case "hub-login":
            S.pop = null;
            hubLogin();
            break;
        case "hub-logout":
            S.pop = null;
            await disconnectHub();
            break;
        case "web":
            S.pop = null;
            render();
            await openWeb(id);
            break;
        case "import-folder":
            await importFolder();
            break;
        // 홈 툴바(#21 보정 12) — › = 보던 작업 화면 · ⟳ = 다시 살피기
        case "go-web":
            await T().core.invoke("go_web").catch(() => openWeb("/works"));
            break;
        case "home-reload":
            await autoDetect();
            render();
            break;
        case "pick-model": {
            const [ai, m] = id.split("|");
            if (m)
                S.defaultModels[ai] = m;
            else
                delete S.defaultModels[ai];
            await store.set("default_models", S.defaultModels);
            await store.save();
            render();
            void reportDevice();
            break;
        } // 웹 화면 = 인앱 창(같은 창 재사용)
        case "view-work":
            await openWeb(`/works/${id}`);
            break;
        case "view-path":
            await openWeb(id);
            break;
        case "open-work":
            await openWeb(`/works/${id}`);
            break; // 최근 = 웹 /works/⟨id⟩(인앱 창)
        case "ob-pick":
            if (S.onboard) {
                const k = id;
                S.onboard.picked = S.onboard.picked.includes(k) ? S.onboard.picked.filter(x => x !== k) : [...S.onboard.picked, k];
                render();
            }
            break;
        case "ob-next":
            onboardNext();
            break;
        case "ob-code-send":
            void codeSend();
            break;
        case "ob-login-url": {
            const u = loginLive[id]?.url;
            if (u)
                await T().shell.open(u).catch(() => { });
            break;
        }
        case "ob-login-paste": {
            const v = document.getElementById("ob-login-code")?.value ?? "";
            await loginPaste(id, v);
            toast("넣었어요 · 확인하는 중");
            break;
        }
        // 숨은 로그인이 안 맞는 PC면 예전 터미널 창으로(그 뒤 확인은 같은 2초 감지)
        case "ob-login-term": {
            const t = id, lv = loginLive[t];
            if (lv && !lv.exited)
                await T().core.invoke("run_kill", { id: lv.pid }).catch(() => { });
            delete loginLive[t];
            render();
            try {
                await T().core.invoke("open_login", { tool: t });
            }
            catch (e) {
                toast(String(e));
                break;
            }
            for (let i = 0; i < 90; i++) {
                await new Promise(r => setTimeout(r, 2000));
                await detect(t);
                if (S.tools[t].loggedIn) {
                    reportDevice();
                    onboardNext();
                    break;
                }
            }
            break;
        }
        case "ob-login-check": {
            const t = id;
            await detect(t);
            if (S.tools[t].loggedIn) {
                delete loginLive[t];
                onboardNext();
            }
            else
                toast("아직 로그인이 확인되지 않아요 · [로그인 다시 시작]");
            break;
        }
        case "ob-code-login":
            void codeLogin();
            break;
        case "ob-browser":
            if (S.onboard) {
                const o = S.onboard;
                o.accBusy = true;
                render();
                await hubLogin();
                o.accBusy = false;
                if (S.token) {
                    o.hubStarted = true;
                    await afterAccount();
                }
                else
                    render();
            }
            break;
        case "ob-acc-later":
            if (S.onboard) {
                void afterAccount();
            }
            break;
        case "ob-relogin":
            if (S.onboard?.current) {
                const cur = S.onboard.current;
                if (await openLogin(cur))
                    onboardNext();
            }
            break;
        case "ob-skip":
            if (S.onboard) {
                S.onboard.queue.shift();
                onboardNext();
            }
            break;
        case "ob-ag-skip":
            if (S.onboard) {
                S.onboard.agDone = true;
                S.onboard.phase = undefined;
                onboardNext();
            }
            break;
        case "ob-cancel":
            S.onboard = null;
            render();
            break;
        case "ob-add":
            S.pop = null;
            startOnboard(false);
            break;
        case "update-install":
            void installUpdate().then(why => { if (why)
                updateFallback(why, true); });
            break;
        case "install-file":
            void openInstaller();
            break;
        case "channel":
            S.channel = S.channel === "beta" ? "stable" : "beta";
            await store.set("update_channel", S.channel);
            await store.save();
            S.updateReady = null;
            render();
            checkUpdate(false);
            break;
    }
});
// ───────────── 시작 ─────────────
(async () => {
    // 자가 점검(#141 §4) — `--selfcheck`로 뜬 앱은 이 창의 일(저장소·토큰·동기화·온보딩)을 하지 않는다. 점검은 네이티브가 작업 창으로 한다
    if (await T().core.invoke("selfcheck_mode").catch(() => false)) {
        // 실제 앱 여정(#174 ①) — `--selfcheck --journey`일 때만. 결과는 네이티브가 자가 점검 JSON에 합친다
        if (await T().core.invoke("selfcheck_journey").catch(() => false))
            void runJourney();
        return;
    }
    // OTA 지킴이(#141 §5) — 이 묶음으로 처음 뜬 때부터 1시간을 센다 · 기본 창의 잡히지 않은 오류도 실패 하나(app.main_crash)
    {
        const n = window.__DYN_OTA ?? 0;
        try {
            const g = JSON.parse(localStorage.getItem("dyn:ota-guard") ?? "null");
            if (n && g?.ota !== n)
                localStorage.setItem("dyn:ota-guard", JSON.stringify({ ota: n, since: Date.now(), fails: [] }));
        }
        catch { /* 못 씀 */ }
        addEventListener("error", e => { if (e.error)
            report("app", "app.main_crash", String(e.error?.message ?? e.message).slice(0, 160)); });
    }
    await listenRunner();
    await pickHub();
    void (async () => { const st0 = await T().store.load("dynapse.json", { autoSave: false, defaults: {} }).catch(() => null); const lv = Number((await st0?.get("net_level").catch(() => 0)) ?? 0); await netFix(lv > 0 ? 1 : 0).catch(() => null); })(); // 회사망 맞추기 — 저장된 레벨로(#142)
    store = await T().store.load("dynapse.json", { autoSave: false, defaults: {} });
    S.token = (await store.get("token")) ?? null;
    if (S.token)
        setTimeout(() => void clientIdOf(), 8000); // 접속 토큰이 살아 있을 때 client_id를 받아 둔다(#88 A-4 — 갱신 때는 이미 만료돼 물을 수 없다)
    S.refresh = (await store.get("refresh")) ?? null;
    const rec = (await store.get("recent")) ?? [];
    S.recent = rec.filter((r) => typeof r === "object" && !!r && !!r.work); // 예전 문자열 기록(열 수 없음)은 버린다
    S.deviceId = (await store.get("device_id")) ?? "";
    initNet((await store.get("net_queue").catch(() => null)) ?? null);
    if (!S.deviceId) {
        S.deviceId = `dev_${rand(12)}`;
        await store.set("device_id", S.deviceId);
        await store.save();
    }
    S.app = await T().core.invoke("app_info");
    S.channel = (await store.get("update_channel")) === "beta" ? "beta" : "stable";
    if (S.app.updater)
        updateAfterBoot();
    S.git = await T().core.invoke("repo_available").catch(() => false);
    // 동기화 하네스(hub/scripts/sync-sim, #56 보정 4) — 가상 기기는 저장소·토큰·git까지만 켠다(창·탐지·주기 작업 없음). 실제 앱엔 __DYN_SIM__이 없다
    if (window.__DYN_SIM__) {
        window.__DYN_READY__ = true;
        return;
    }
    // 첫 실행(#142 추가 3 "seamless를 극한으로") — 이미 로그인된 공식 CLI가 있으면 연결 단계가 없다. AI 고르기 카드는 앞에 두지 않는다(첫 요청이 있는 것에서 고른다)
    if (!(await store.get("first_turn_at")))
        scheduleStuck(); // 설치 뒤 10분 첫 턴 없음(#149 §4)
    if (!(await store.get("onboarded"))) {
        if (S.token)
            void afterAccount();
        else
            void deviceAccount().then(ok => { if (ok)
                void afterAccount();
            else if (netState() !== "online") {
                render();
                const off = onNet(n => { if (n === "online") {
                    off();
                    void deviceAccount().then(o2 => { if (o2)
                        void afterAccount();
                    else
                        startOnboard(true); });
                } });
            }
            else
                startOnboard(true); });
    } // 처음 켠 PC가 오프라인(#146 §4) — 로그인 카드로 빠지지 않고 한 줄, 돌아오면 저절로
    render();
    await T().event.listen("front", () => { markActive(); void openFront(); }); // 트레이 "열기"·앱 다시 켜기
    // 엔진 창이 보이게 되면(재시작·화면 묶음 새로고침·Dock 등) 연결돼 있고 온보딩 중이 아니면 "열기" 카드 없이 곧바로 웹으로
    let goingWeb = 0;
    const autoWeb = () => {
        if (!S.token || S.onboard || document.visibilityState !== "visible" || Date.now() - goingWeb < 3000)
            return;
        // 엔진 창이 실제로 화면에 보일 때만(숨은 창의 포커스·가시성 이벤트로 웹을 목록으로 다시 열지 않게 — 수락 뒤 목록으로 가던 의심 경로)
        const w = T().window?.getCurrentWindow?.();
        void (w ? w.isVisible() : Promise.resolve(false)).then(vis => {
            if (!vis)
                return;
            goingWeb = Date.now();
            void T().core.invoke("go_web").catch(() => openWeb("/works")); // 웹 창이 없으면 handoff로(앱 계정 그대로)
        }).catch(() => { });
    };
    addEventListener("focus", autoWeb);
    document.addEventListener("visibilitychange", autoWeb);
    addEventListener("focus", markActive);
    document.addEventListener("visibilitychange", () => { if (!document.hidden)
        markActive(); });
    // 창 하나(#21 보정 8·13) — 연결돼 있으면 같은 창이 웹(/works), 아니면 기본 창(온보딩·연결). OTA 새로고침으로 다시 돌 땐 보이는 화면을 건드리지 않는다
    let reloaded = false;
    try {
        reloaded = sessionStorage.getItem("dyn:boot") === "1";
        sessionStorage.setItem("dyn:boot", "1");
    }
    catch { /* 없음 */ }
    if (!reloaded) {
        if (S.token && !S.onboard)
            void openFront();
        else
            await T().core.invoke("show_main", { show: true }).catch(() => { });
    }
    // 웹 연결 화면(/connect)의 [로그인]·[설치]·[새 버전]·[+]·모델 — 브릿지·IPC가 여기로(#21 보정 13)
    await T().event.listen("app-action", (e) => { void appAction(e.payload); });
    S.defaultModels = (await store.get("default_models")) ?? {};
    S.photoLimits = (await store.get("photo_limits")) ?? {};
    await T().event.listen("deep-link", () => { markActive(); takeLinks(); });
    await T().event.listen("tray-new", () => { markActive(); void openWeb("/works/new"); }); // 트레이 "새 작업"(#20 보정 4) — 빈 작업실을 인앱 창으로
    await T().event.listen("tray-feedback", () => { void openWeb("/me#feedback"); });
    // 작업 화면을 다시 만들었다(#137 §2) — 원인만 보고(주소·내용 없음)
    await T().event.listen("inapp-recreated", ({ payload: st }) => { report("app", "app.white_screen", `stage=${st} online=${navigator.onLine}`); });
    await T().event.listen("white-screen", ({ payload: ms }) => { report("app", "app.white_screen", `ms=${ms} online=${navigator.onLine}`); }); // 작업 화면이 10초 넘게 걸려 열림(#137)   // 트레이 "의견 보내기"(#75)
    await Promise.all([detect("claude"), detect("codex"), agDetect(), loadMinVersions()]);
    await detectModels().catch(() => { });
    await reportDevice();
    await takeLinks(); // 이 링크로 앱이 켜졌으면 여기서 처리
    backfill();
    setTimeout(() => void retryPendingPulls().catch(() => { }), 8000); // 못 받은 작업 다시(#56) — 시작 뒤 연결이 붙을 즈음
    setInterval(() => { if (!jobRunning() && !evPaused)
        reportDevice(); }, HEARTBEAT_MS); // 쉬는 동안엔 심장박동도(DB를 깨우지 않게)   // 기기 심장박동(#12-Z) — 웹의 온라인·"이 PC"
    onLocalReport(() => { void reportDevice(); });
    void initLocal().catch(() => { }); // 이 PC 엔진(#113) — 탐지·상태·업데이트
    listenEvents(); // 작업실 대화·동기화(#14 — 폴링 없음, 서버가 민다)
    setTimeout(() => void pullOnce({ boot: true }), 3_000); // 시작·OTA 새로고침 뒤 받지 못한 메시지 한 번(#165 ①)
    setInterval(idleSessions, 60_000);
    if (S.app.updater) {
        void checkNativeFloor(); // OTA를 못 받는 옛 네이티브면 첫 화면에 [설치 파일 받기](#185 C 보정 1 ②)
        setTimeout(() => checkUpdate(false), UPDATE_FIRST_MS);
        setInterval(() => checkUpdate(false), UPDATE_EVERY_MS);
        setTimeout(() => void otaCheck(), OTA_FIRST_MS);
        setInterval(() => void otaCheck(), OTA_EVERY_MS); // 화면 묶음 — 시작 15초 뒤·30분마다(+ SSE 알림)
    }
})();
// 실제 앱 여정(#174 ①) — 사용자 저장소(dynapse.json)에 쓰지 않는다: 저장소는 메모리, 토큰은 점검마다 새 기기 계정의 것. 앱 클라이언트 id만 사용자 저장소에서 읽는다(쓰지 않음 · 없으면 등록)
async function runJourney() {
    const mem = new Map();
    store = { get: async (k) => (mem.has(k) ? mem.get(k) : null), set: async (k, v) => { mem.set(k, v); }, delete: async (k) => mem.delete(k), has: async (k) => mem.has(k),
        save: async () => { }, keys: async () => [...mem.keys()], entries: async () => [...mem.entries()], reload: async () => { } };
    let result;
    const say = (l) => void T().core.invoke("selfcheck_log", { line: l }).catch(() => { });
    try {
        say("boot");
        await listenRunner();
        await pickHub();
        say(`hub ${HUB}`);
        S.app = await T().core.invoke("app_info");
        S.git = await T().core.invoke("repo_available").catch(() => false);
        await detect("claude").catch(() => { });
        const real = await T().store.load("dynapse.json", { autoSave: false, defaults: {} }).catch(() => null);
        const cid = (await real?.get("client_id").catch(() => null)) ?? await ensureClientId();
        say(`client ${cid ? "ok" : "none"} · claude ${S.tools.claude.installed ? (S.tools.claude.loggedIn ? "logged in" : "not logged in") : "none"}`);
        const { journey } = await import("./journey.js");
        const aiTurn = await T().core.invoke("selfcheck_journey_ai").catch(() => true);
        result = await journey({ native: true, aiTurn, clientId: cid, log: l => { void T().core.invoke("selfcheck_log", { line: l }).catch(() => { }); } });
    }
    catch (e) {
        say(`error ${String(e?.message ?? e).slice(0, 200)}`);
        result = { work: null, ai_account: null, checks: [{ name: "journey", ok: false, ms: 0, note: String(e?.message ?? e).slice(0, 200) }] };
    }
    await T().core.invoke("selfcheck_journey_done", { result }).catch(() => { });
}
// PPTX에 심을 글꼴(#164 ①) — 덱 글꼴 짝(장 글꼴 블록의 data-display·data-body)의 서브셋(KS X 1001 2,350자 · 400·700 + 제목 굵은 면)을 허브에서 받아 .dynapse/out/pptx-<id>-<굵기>.ttf에.
// 경로는 .dynapse/out/<파일> 3단계까지(네이티브 work_rel 규칙 — 9차 테이크: pptx-fonts/ 하위 폴더라 해시 확인·목록 쓰기가 거절돼 글꼴이 빠졌다)
// sha256이 같으면 다시 받지 않는다. verify --pptx가 index.json을 보고 면 셋까지 심는다. 사용자 글은 보내지 않는다(고정 서브셋만 받는다)
export async function pptxFonts(w) {
    const files = (await T().core.invoke("work_files", { id: w }).catch(() => [])).map(f => f.name);
    const first = files.find(n => n === "result-cover.html") ?? files.find(n => /^result-[a-z0-9-]+\.html$/.test(n));
    if (!first)
        return 0;
    const blk = ((await T().core.invoke("work_read", { id: w, file: first }).catch(() => "")) ?? "").match(/<style\b[^>]*\bdata-fonts\b[^>]*>/i)?.[0] ?? "";
    const ids = [...new Set([blk.match(/data-display="([^"]+)"/)?.[1], blk.match(/data-body="([^"]+)"/)?.[1]].filter((x) => !!x))];
    if (!ids.length)
        return 0;
    const r = await http("GET", `${HUB}/api/fonts?pptx=1`).catch(() => null);
    if (r?.status !== 200)
        return 0;
    const j = JSON.parse(r.body);
    if (!j.mode) {
        await T().core.invoke("work_write", { id: w, file: ".dynapse/out/pptx-fonts.json", text: "[]" }).catch(() => { });
        return 0;
    } // 허브가 형식을 정하기 전(실측 전)엔 받지 않는다
    const list = (j.fonts ?? []).filter(f => ids.includes(f.id));
    const dir = await T().core.invoke("work_dir", { id: w }).catch(() => null);
    if (!dir)
        return 0;
    const index = [];
    for (const f of list) {
        const faces = {};
        for (const [wt, x] of Object.entries(f.faces)) {
            const rel = `.dynapse/out/pptx-${f.id}-${wt}.ttf`, sum = () => T().core.invoke("work_sha256", { id: w, file: rel }).catch(() => null);
            if ((await sum()) !== x.sha256) {
                const g = await http("GET", x.url, { out: `${dir}/${rel}` }).catch(() => null);
                if (g?.status !== 200 || (await sum()) !== x.sha256)
                    continue;
            }
            faces[wt] = rel;
        }
        if (Object.keys(faces).length)
            index.push({ family: f.family, aliases: f.aliases, faces });
    }
    await T().core.invoke("work_write", { id: w, file: ".dynapse/out/pptx-fonts.json", text: JSON.stringify({ mode: j.mode, fonts: index }) }).catch(() => { });
    return index.length;
}
// 인스타 캡션(#81 §3) — 문장을 새로 쓰지 않고 칸 글자를 그대로 모은다: 훅 카드 주장 + 포인트 카드 제목(번호) + 마지막 카드의 다음 행동 + # 태그 5개(상호·주제)
async function instaCaption(id, files) {
    const order = ((await T().core.invoke("work_read", { id, file: ".dynapse/pages.json" }).then(t => JSON.parse(t)).catch(() => null)) ?? files.filter(f => /^result-card-\d+\.html$/.test(f)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))).filter(f => /^result-card-\d+\.html$/.test(f));
    const slot = (h, k) => (h.match(new RegExp(`data-slot=["']${k}["'][^>]*>([^<]*)<`))?.[1] ?? "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
    const pages = await Promise.all(order.map(f => T().core.invoke("work_read", { id, file: f }).catch(() => "")));
    if (!pages.length)
        return "";
    const first = pages[0], last = pages[pages.length - 1];
    const points = pages.slice(1, -1).map(h => slot(h, "card_title")).filter(Boolean);
    const brand = slot(first, "brand");
    const labels = await T().core.invoke("work_read", { id, file: ".dynapse/labels.json" }).then(t => JSON.parse(t)).catch(() => null);
    const tags = [...new Set([brand, ...(labels?.subject ?? []), ...(labels?.feel ?? [])].map(t => t.replace(/[^\p{L}\p{N}_]/gu, "")).filter(t => t.length >= 2))].slice(0, 5);
    // 출처(#157 ⑤) — 앱이 마무리 장에 적은 사진 출처 줄(data-credits)을 그대로. 해시태그는 그림 안이 아니라 여기에만
    const credits = pages.map(h => (h.match(/<p\b[^>]*\bdata-credits\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim()).find(Boolean) ?? "";
    return [[slot(first, "card_title"), slot(first, "card_line")].filter(Boolean).join("\n"), points.map((t, i) => `${i + 1}. ${t}`).join("\n"), slot(last, "card_line"), tags.map(t => `#${t}`).join(" "), credits].filter(Boolean).join("\n\n");
}
