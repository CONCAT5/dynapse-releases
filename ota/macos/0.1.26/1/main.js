import { assemblyHtml, headerHtml, homeHtml } from "./home.js";
import { appVerify, backfill, chatSend, importStart, importTurn, ensureVerify, idleSessions, onChatMessage, openWeb, replayWaiting, sessions, syncAll } from "./chat.js";
export const HUB = "https://ai-task-hub-nu.vercel.app";
export const MCP_URL = `${HUB}/api/mcp`;
// 미설치면 공식 설치 웹페이지만 연다 — 설치는 사용자가 직접 (2026-09-24 대표 결정). URL은 응답 200 확인
const INSTALL_URL = { claude: "https://code.claude.com/docs/en/setup", codex: "https://developers.openai.com/codex/cli", agy: "https://antigravity.google/docs/getting-started?tab=cli" };
const AI_NAME = { claude: "Claude", codex: "ChatGPT" }; // 사용자에게는 쓰는 AI 이름으로
const CAPS = { claude: ["디자인"], codex: ["사진", "디자인"] };
const capsText = (c) => c.join("·");
const RUNNER_NAME = { claude: "Claude Code", codex: "Codex" }; // 실제로 도는 공식 도구
export const WORK_ID = /^[A-Za-z0-9_-]{4,64}$/;
export const S = {
    token: null,
    refresh: null,
    deviceId: "",
    handle: null,
    browsers: [], // 연결된 브라우저(#20) — 프로필 팝오버
    tools: {
        claude: { checked: false, installed: false, loggedIn: null, connected: null, version: "" },
        codex: { checked: false, installed: false, loggedIn: null, connected: null, version: "" },
    },
    ag: { checked: false, installed: false, loggedIn: null, connected: false, version: "" },
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
    toast: "",
    onboard: null,
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
function toast(msg) {
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
export async function http(method, url, o = {}, retried = false) {
    const args = ["-sS", "-X", method, url, "-w", "\n%{http_code}"];
    if (o.json !== undefined)
        args.push("-H", "content-type: application/json", "--data-binary", JSON.stringify(o.json));
    if (o.form)
        for (const [k, v] of Object.entries(o.form))
            args.push("--data-urlencode", `${k}=${v}`);
    if (o.file)
        args.push("-H", `content-type: ${o.contentType ?? "application/octet-stream"}`, "--data-binary", `@${o.file}`);
    if (o.sse)
        args.push("-H", "accept: application/json, text/event-stream");
    if (o.out)
        args.push("-L", "--create-dirs", "-o", o.out); // materials/·.dynapse/photos/ 하위 경로도(동기화 받기)
    if (o.auth && S.token)
        args.push("-H", `@${await T().core.invoke("auth_header_file", { token: S.token })}`);
    const r = await exec("curl", args);
    if (r.code !== 0)
        throw new Error(`네트워크 오류: ${r.stderr.trim() || r.code}`);
    const i = r.stdout.lastIndexOf("\n");
    const res = { status: Number(r.stdout.slice(i + 1)), body: r.stdout.slice(0, i) };
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
async function detect(id) {
    const t = S.tools[id];
    const v = await exec(id, ["--version"]).catch(() => null);
    t.installed = !!v && v.code === 0;
    t.version = t.installed ? v.stdout.trim().split("\n")[0] : "";
    t.loggedIn = null;
    t.connected = null;
    if (t.installed && id === "claude") {
        // 실측: `claude auth status --json` → { "loggedIn": true, ... }
        const r = await exec("claude", ["auth", "status", "--json"]).catch(() => null);
        try {
            t.loggedIn = !!r && JSON.parse(r.stdout).loggedIn === true;
        }
        catch {
            t.loggedIn = null;
        }
    }
    if (t.installed && id === "codex") {
        // 실측: 로그인 시 `codex login status` → exit 0 + "Logged in using …" (미로그인 문구는 실측 전)
        const r = await exec("codex", ["login", "status"]).catch(() => null);
        t.loggedIn = !!r && r.code === 0 && /Logged in/i.test(r.stdout + r.stderr);
    }
    if (t.installed) {
        // 실측(claude 2.1.118 · codex-cli 0.156.1): `mcp get <이름>` — 등록이 없으면 exit 1
        const g = await exec(id, ["mcp", "get", "dynapse"]).catch(() => null);
        t.connected = !!g && g.code === 0;
    }
    t.checked = true;
    render();
}
export async function openLogin(id) {
    try {
        await T().core.invoke("open_login", { tool: id });
    }
    catch (e) {
        toast(String(e));
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
async function agyLoginOk(force = false) {
    const today = new Date().toISOString().slice(0, 10);
    if (!force && (await store.get("agy_login_ok")) === today)
        return true;
    const r = await exec("agy", ["-p", "pong", "--output-format", "json", "--print-timeout", "30s"]).catch(() => null);
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
    S.ag = { checked: true, installed, loggedIn, connected: st.connected, version: installed ? v.stdout.trim() : "" };
    render();
}
// 공식 로그인 창(터미널의 `agy`) → 10초마다 확인(최대 3분)
export async function agyLogin() {
    try {
        await T().core.invoke("open_login", { tool: "agy" });
    }
    catch (e) {
        toast(String(e));
        return false;
    }
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
async function refreshToken() {
    if (!S.refresh)
        return false;
    const r = await http("POST", `${HUB}/oauth/token`, { form: { grant_type: "refresh_token", refresh_token: S.refresh } }, true).catch(() => null);
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
async function reportDevice() {
    if (!S.token)
        return;
    const t = (x) => ({ installed: x.installed, loggedIn: x.loggedIn, connected: x.connected });
    S.bridge ??= await T().core.invoke("bridge_info").catch(() => null);
    const r = await api("POST", "/api/device", deviceBody()).catch(() => null);
    if (r?.data?.update_required)
        void forceUpdate(); // 서버 최소 버전보다 낮다(#21 보정 2) — 곧바로 받는다
    await refreshMe();
}
export function deviceBody() {
    const t = (x) => ({ installed: x.installed, loggedIn: x.loggedIn, connected: x.connected });
    return {
        device_id: S.deviceId, app_version: S.app?.version, ota: otaNow(),
        models: S.models, limits: S.claudeLimit ? { claude: S.claudeLimit } : undefined,
        // 기기 등록(#12-Z Z1) — 이름(처음 한 번 기본값)·OS·로컬 브릿지 포트·이번 실행의 토큰
        name: S.app?.host || undefined, os: S.app?.os, online: true,
        ...(S.bridge ? { bridge_port: S.bridge.port, bridge_token: S.bridge.token } : {}),
        tools: { claude: t(S.tools.claude), codex: t(S.tools.codex),
            agy: { installed: S.ag.installed, loggedIn: S.ag.loggedIn, connected: null },
            antigravity: { installed: S.ag.installed, loggedIn: S.ag.loggedIn, connected: S.ag.checked ? S.ag.connected : null } },
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
        out.chatgpt = j.models.filter(x => x.visibility === "list").map(x => ({ id: x.slug, name: x.display_name, efforts: x.supported_reasoning_levels?.map(e => e.effort) }));
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
async function refreshMe() {
    if (!S.token)
        return;
    const g = await api("GET", "/api/device").catch(() => null);
    if (g?.status === 200 && g.data) {
        S.thumbUpload = g.data.user.thumb_upload !== false;
        setSync(!!g.data.user.sync);
        S.handle = g.data.user.handle;
    }
    else if (g?.status === 401)
        await forgetToken();
    pushStatus();
    render();
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
            tools: { claude: t(S.tools.claude), codex: t(S.tools.codex), agy: { installed: S.ag.installed, loggedIn: S.ag.loggedIn } } }) }).catch(() => { });
}
// 서버가 미는 이벤트(#12-AD AD1) — /api/device/events SSE를 curl -N으로 붙잡는다(55초마다 서버가 닫으면 다시 붙음).
// sync는 즉시 반영, message는 작업실 대화를 세션으로(#14). 폴링 없음
let eventsOn = false;
async function listenEvents() {
    if (eventsOn || !S.token)
        return;
    eventsOn = true;
    let ev = "";
    const hdr = await T().core.invoke("auth_header_file", { token: S.token }).catch(() => null);
    if (S.app?.updater)
        checkSoon(); // SSE 재연결 때도 새 버전 확인(10분에 한 번 이하)
    const code = hdr ? await spawn("curl", ["-sS", "-N", "-f", "-H", `@${hdr}`, `${HUB}/api/device/events?device_id=${encodeURIComponent(S.deviceId)}`], "", null, (l) => {
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
        else if (ev === "message")
            onChatMessage(d); // 작업실 대화(#14)
        // 새 버전 알림(pub/sub) — 서버가 stable·화면 묶음이 새로 올라가면 이 연결로 민다
        else if (ev === "update") {
            const v = d.version;
            if (v && v !== S.app?.version)
                void forceUpdate();
        }
        else if (ev === "ota") {
            const n = d;
            if (n.native === S.app?.version && (n.ota ?? 0) > otaNow())
                void otaCheck();
        }
    }, () => { }).catch(() => -1) : -1;
    eventsOn = false;
    if (code === 22 && S.refresh)
        await refreshToken().catch(() => false); // -f: 401 → 토큰 갱신 후 다시
    if (S.token)
        setTimeout(listenEvents, code === 0 ? 500 : 5_000);
}
// ───────────── 딥링크 — connect·open·folder·export 넷(#20). 작업은 전부 작업실 메시지 ─────────────
// [앱으로 로그인](#20 브라우저 간 계정) — 붙이기 전에 확인 창(딥링크는 아무 사이트나 쏠 수 있다). 같은 네트워크 검사는 서버가
async function linkBrowser(s) {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(s))
        return;
    if (!S.token) {
        toast("Dynapse 연결 필요");
        return;
    }
    const peek = await api("GET", `/api/device/link-session?s=${s}`).catch(() => null);
    if (peek?.status !== 200) {
        toast(peek?.data?.error ?? "링크가 끝났어요 — 브라우저에서 다시 눌러 주세요");
        return;
    }
    const ok = await T().core.invoke("app_confirm", { title: "브라우저 연결", message: `${peek.data?.ua || "브라우저"}를 내 계정(${peek.data?.handle ?? S.handle ?? ""})에 연결할까요?\n\n직접 누른 게 아니면 [취소]를 누르세요.`, ok: "연결" }).catch(() => false);
    if (!ok)
        return;
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
    await importStart(id, { source: name });
    await openWeb(`/works/${id}`);
    await chatSend(id, importTurn(files, name));
}
async function takeLinks() {
    const urls = await T().core.invoke("take_deep_links");
    for (const u of urls)
        await handleLink(u);
}
async function handleLink(raw) {
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
        await forceUpdate();
        return;
    } // 웹 [앱 업데이트](#21 보정 2)
    if (action === "link") {
        await linkBrowser(p.get("s") ?? "");
        return;
    } // [앱으로 로그인](#20) — 브라우저 세션을 이 계정에   // 폴더 가져오기(#20) — 경로가 오면 확인 창을 먼저
    if (!WORK_ID.test(w))
        return;
    if (action === "open") {
        await openWeb(`/works/${w}`);
        return;
    } // 인앱 창의 같은 웹 화면(로컬 원본이 IPC로 보인다)
    if (action === "folder") {
        await T().core.invoke("open_work", { id: w, file: null }).catch(e => toast(String(e)));
        return;
    }
    if (action === "export") { // ~/Downloads zip(렌더 사진이 없으면 검증 1회로 만든 뒤)
        const kind = p.get("kind") === "html" ? "html" : "png";
        if (kind === "png") {
            const f = await T().core.invoke("work_files", { id: w }).catch(() => []);
            if (!f.some(x => x.name.startsWith(".dynapse/out/"))) {
                await ensureVerify(w);
                await appVerify(w);
            }
        }
        await T().core.invoke("export_work", { id: w, kind }).then(path => toast(`내보냄 · ${path.split("/").pop()}`)).catch(e => toast(String(e)));
    }
}
// ───────────── 업데이트 (docs/11 §3.4) ─────────────
const UPDATE_FIRST_MS = 30_000;
const UPDATE_EVERY_MS = 60 * 60 * 1000; // 1시간(#21 보정 2) + 시작·SSE 재연결 때
// 실행 중 = 어느 작업실 세션이 턴을 도는 중(#20 — 실행 경로는 대화 하나)
function jobRunning() { return [...sessions.values()].some(s => s.busy); }
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
async function checkUpdate(manual) {
    if (!S.app?.updater)
        return; // 로컬 빌드 — 조용히(문구 없음)
    if (manual)
        toast("확인하는 중…");
    try {
        const u = await T().core.invoke("update_check", { channel: S.channel });
        if (u) {
            S.updateReady = u.version;
            if (manual)
                toast(`${u.version} 받음`);
        }
        else if (manual)
            toast("최신");
        render();
    }
    catch (e) {
        console.warn("update check failed", e);
        if (manual)
            toast(`확인하지 못했어요: ${e.message ?? e}`);
    }
}
// 서버가 요구하거나(update_required) 웹 [앱 업데이트](dynapse://update) — 받고, 도는 작업이 없으면 바로 설치·다시 시작
let forcing = false;
async function forceUpdate() {
    if (forcing || !S.app?.updater)
        return;
    forcing = true;
    try {
        if (!S.updateReady)
            await checkUpdate(false);
        if (!S.updateReady)
            return;
        for (let k = 0; k < 120 && jobRunning(); k++)
            await new Promise(r => setTimeout(r, 5000)); // 턴이 끝날 때까지(최대 10분)
        if (!jobRunning()) {
            toast(`${S.updateReady} · 다시 시작`);
            await installUpdate();
        }
    }
    finally {
        forcing = false;
    }
}
// 무재시작 업데이트(OTA) — 서명된 화면 묶음을 받아 두고, 도는 작업이 없을 때 화면만 새로고침(앱은 그대로 켜져 있다)
const otaNow = () => window.__DYN_OTA ?? 0;
let otaBusy = false;
async function otaCheck() {
    if (otaBusy || !S.app?.updater)
        return;
    otaBusy = true;
    try {
        const n = await T().core.invoke("ota_fetch").catch(e => { console.warn("ota", e); return null; });
        if (!n || n <= otaNow())
            return;
        for (let k = 0; k < 360 && (jobRunning() || [...sessions.values()].some(s => s.busy)); k++)
            await new Promise(r => setTimeout(r, 5000)); // 턴이 끝날 때까지(최대 30분)
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
async function installUpdate() {
    if (jobRunning()) {
        toast("작업이 끝나면 설치할 수 있어요");
        return;
    }
    try {
        await T().core.invoke("update_install");
    }
    catch (e) {
        toast(`설치하지 못했어요: ${e.message ?? e}`);
    }
}
const LOCATION_MSG = { dmg: "디스크 이미지", translocated: "격리 위치", outside: "응용 프로그램 폴더 밖" };
// ───────────── 첫 실행 온보딩 (WORKORDER #12 B) — "어떤 AI를 쓰세요?" → 공식 로그인 → 연결됐어요 ─────────────
function startOnboard(first) {
    S.onboard = { step: "pick", picked: [], queue: [], hubStarted: false, connected: [], first };
    render();
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
            const until = Date.now() + 600_000;
            while (Date.now() < until && S.onboard === o && o.current === id && o.phase === "install") {
                await new Promise(r => setTimeout(r, 3000));
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
        if (await connectTool(id, true))
            o.connected.push(id);
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
async function finishOnboard() {
    S.onboard = null;
    void replayWaiting(); // 온보딩에서 막 로그인했으면 기다리던 메시지부터(#20)
    await store.set("onboarded", true);
    await store.save();
    render();
}
function onboardView() {
    const o = S.onboard;
    const back = o.first ? "" : `<button class="pill pill--soft" data-act="ob-cancel">닫기</button>`;
    if (o.step === "pick") {
        const b = (k, name, note) => `<button class="ob__ai ${o.picked.includes(k) ? "ob__ai--on" : ""}" data-act="ob-pick" data-id="${k}"><b>${name}</b><small>${note}</small></button>`;
        const hint = `<p class="muted" style="margin-top:-4px">사진은 ChatGPT나 Gemini, 디자인은 Claude나 ChatGPT가 해요.</p>`;
        return `<div class="ob">${assemblyHtml()}<h1>어떤 AI를 쓰세요?</h1><p class="lead">쓰는 AI를 모두 고르세요. 내 구독으로 이 기기에서 만들어요.</p>
      <div class="ob__ais">${b("claude", "Claude", "디자인")}${b("chatgpt", "ChatGPT", "사진 · 디자인")}${b("gemini", "Gemini", "사진 · Antigravity 안에서")}</div>${hint}
      ${o.picked.includes("gemini") ? `<div class="note">Gemini는 Antigravity 앱 안에서 써요. 앱이 연결해 두면 Antigravity에서 한 문장으로 시작해요.</div>` : ""}
      <div class="card__row">${back}<button class="pill" data-act="ob-next" ${o.picked.length ? "" : "disabled"}>다음</button></div></div>`;
    }
    if (o.step === "tool" && o.current) {
        const id = o.current, name = AI_NAME[id];
        const body = o.phase === "install"
            ? `<h1>${RUNNER_NAME[id]}를 설치하면 ${name}로 ${capsText(CAPS[id])}을 할 수 있어요</h1>
         <p class="lead">공식 설치 페이지를 따라 설치해 주세요. 설치되면 앱이 알아서 알아채고 다음으로 넘어가요.</p>
         <p class="muted">설치를 기다리는 중…</p>
         <div class="card__row"><button class="pill" data-act="install" data-id="${id}">설치하기 ↗</button>
         <button class="pill pill--soft" data-act="ob-skip">나중에</button></div>`
            : o.phase === "login"
                ? `<h1>${name}에 로그인하면 ${capsText(CAPS[id])}을 할 수 있어요</h1><p class="lead">열린 ${name} 공식 로그인 창에서 로그인해 주세요. 끝나면 자동으로 다음으로 넘어가요.</p>
         <p class="muted">로그인 중…</p>
         <div class="card__row"><button class="pill pill--soft" data-act="ob-relogin">로그인 창 다시 열기</button><button class="pill pill--soft" data-act="ob-skip">건너뛰기</button></div>`
                : `<h1>${name}</h1><p class="lead">${o.phase === "connecting" ? "연결하는 중…" : o.phase === "latest" ? `${RUNNER_NAME[id]}를 최신으로 맞추는 중…` : "확인하는 중…"}</p>`;
        return `<div class="ob">${body}</div>`;
    }
    if (o.step === "gemini") {
        const body = o.phase === "install"
            ? `<h1>Antigravity를 설치하면 Gemini로 사진을 만들 수 있어요</h1>
         <p class="lead">공식 다운로드 페이지에서 설치해 주세요. 설치되면 앱이 알아서 알아채고 다음으로 넘어가요.</p>
         <p class="muted">설치를 기다리는 중…</p>
         <div class="card__row"><button class="pill" data-act="install" data-id="antigravity">설치하기 ↗</button>
         <button class="pill pill--soft" data-act="ob-ag-skip">나중에</button></div>`
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
function homeState() {
    const a = S.app;
    const loc = a?.updater && a.location_issue ? `⚠ ${LOCATION_MSG[a.location_issue]} · 업데이트 안 됨` : null;
    return {
        ais: aiStates(),
        primaryKey: S.tools.claude.installed ? "claude" : S.tools.codex.installed ? "codex" : null,
        pop: S.pop, handle: S.handle, browsers: S.browsers, deviceId: S.deviceId ?? null, connected: !!S.token, hubBusy: S.hubBusy,
        recent: S.recent.slice(0, 3), version: a ? `${a.version}${otaNow() ? `.${otaNow()}` : ""}` : "", // 화면 묶음 번호(OTA)가 있으면 0.1.26.3
        updateReady: S.updateReady && !jobRunning() ? S.updateReady : null, location: loc,
        beta: a?.dev ? (S.channel === "beta" ? "on" : "off") : null,
        idle: !jobRunning(), where: S.sync ? "sync" : "local",
    };
}
export function render() {
    const h = homeState();
    $top.innerHTML = headerHtml(h);
    const logOpen = document.querySelector(".logbox")?.open;
    $app.innerHTML = S.onboard ? onboardView() : homeHtml(h, runLine());
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
    try {
        for (const id of ["claude", "codex"]) {
            const t = S.tools[id];
            if (!all && t.installed && t.loggedIn && t.connected)
                continue;
            await detect(id);
            if (t.installed && t.loggedIn && t.connected === false)
                await connectTool(id, true);
        }
        if (all || !S.ag.installed)
            await agDetect();
        await replayWaiting(); // 로그인되면 기다리던 작업실 메시지를 이어서(#20)
        pushStatus(); // 로그인 확인(토큰 소모)은 하루 1회 캐시 — 3초 루프에서 다시 안 한다
    }
    finally {
        polling = false;
    }
}
setInterval(() => { if (document.hasFocus())
    autoDetect(); }, 3000);
addEventListener("focus", () => autoDetect(true));
// ───────────── 이벤트 ─────────────
const LOGOUT_URL = { claude: "https://code.claude.com/docs/en/setup", codex: "https://developers.openai.com/codex/cli", gemini: INSTALL_URL.agy };
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
            await T().shell.open(INSTALL_URL[(id === "gemini" ? "agy" : id)]);
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
            break; // 웹 화면 = 인앱 창(같은 창 재사용)
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
            installUpdate();
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
const HEARTBEAT_MS = 10 * 60_000;
(async () => {
    await listenRunner();
    store = await T().store.load("dynapse.json", { autoSave: false, defaults: {} });
    S.token = (await store.get("token")) ?? null;
    S.refresh = (await store.get("refresh")) ?? null;
    const rec = (await store.get("recent")) ?? [];
    S.recent = rec.filter((r) => typeof r === "object" && !!r && !!r.work); // 예전 문자열 기록(열 수 없음)은 버린다
    S.deviceId = (await store.get("device_id")) ?? "";
    if (!S.deviceId) {
        S.deviceId = `dev_${rand(12)}`;
        await store.set("device_id", S.deviceId);
        await store.save();
    }
    S.app = await T().core.invoke("app_info");
    S.channel = (await store.get("update_channel")) === "beta" ? "beta" : "stable";
    S.git = await T().core.invoke("repo_available").catch(() => false);
    if (!(await store.get("onboarded")))
        startOnboard(true);
    render();
    await T().event.listen("deep-link", () => { takeLinks(); });
    await T().event.listen("tray-new", () => { void openWeb("/works/new"); }); // 트레이 "새 작업"(#20 보정 4) — 빈 작업실을 인앱 창으로
    await Promise.all([detect("claude"), detect("codex"), agDetect(), loadMinVersions()]);
    await detectModels().catch(() => { });
    await reportDevice();
    await takeLinks(); // 이 링크로 앱이 켜졌으면 여기서 처리
    backfill();
    setInterval(() => { if (!jobRunning())
        reportDevice(); }, HEARTBEAT_MS); // 기기 심장박동(#12-Z) — 웹의 온라인·"이 PC"
    listenEvents(); // 작업실 대화·동기화(#14 — 폴링 없음, 서버가 민다)
    setInterval(idleSessions, 60_000);
    if (S.app.updater) {
        setTimeout(() => checkUpdate(false), UPDATE_FIRST_MS);
        setInterval(() => checkUpdate(false), UPDATE_EVERY_MS);
        setTimeout(() => void otaCheck(), 15_000);
        setInterval(() => void otaCheck(), 30 * 60_000); // 화면 묶음 — 시작 15초 뒤·30분마다(+ SSE 알림)
    }
})();
