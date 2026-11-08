// 관문 한 번(#353 ③ — 대표 11-03 "배포마다 왜 한 시간"): 커밋 하나를 깨끗한 작업 트리에서 한 번만 점검하고 도장을 찍는다.
// ota.mjs는 같은 커밋·깨끗한 트리·같은 플랫폼 도장이 24시간 안에 있으면 [0] 점검을 다시 돌리지 않는다(허브 배포와 OTA를 나란히 돌릴 수 있게).
// 쓰는 법: node scripts/gate.mjs [--sha <커밋>] [--repo <ai-task-mining 경로>] [--shards 2]   (기본: origin/main · ~/development/ai-task-mining)
// 도장: .gate/<sha>-<platform>.json {sha, platform, at, tsc, sync, turn, ms} — .gitignore
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
// 잠들지 않기(#370 결과 6 — 11-06 맥이 잠든 사이 관문이 76분 돌고 렌더 검사 47·73이 실패): 이 프로세스가 사는 동안만 caffeinate -i -w <pid>(끝나면 저절로 풀림 · 재시작 없음)
if (process.platform === "darwin" && existsSync("/usr/bin/caffeinate")) spawn("/usr/bin/caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore", detached: true }).unref();
// 고정 Chrome(#353 · 11-04): sim·render-sim의 실제 검사·렌더는 이 맥의 Chrome for Testing 157로(148은 sync-sim 105f를 못 지나간다 11-05)(시스템 Chrome은 자동 업데이트 중 새 창이 끊긴다) — 없으면 예전처럼 시스템 Chrome
const PINNED_CHROME = `${process.env.HOME}/.cache/puppeteer/chrome/mac_arm-157.0.8103.38/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
if (!process.env.CHROME_PATH && (await import("node:fs")).existsSync(PINNED_CHROME)) process.env.CHROME_PATH = PINNED_CHROME;
const arg = k => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
const ROOT = resolve(new URL("..", import.meta.url).pathname), repo = resolve(arg("repo") ?? join(homedir(), "development", "ai-task-mining")), W = join(homedir(), "development", "dynapse-gate");
const run = (cmd, args, o = {}) => { const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 28, ...o }); return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` }; };
const die = m => { console.error(`✗ ${m}`); process.exit(1); };
const t0 = Date.now();
// 겹치지 않기(#353 · 밤 전체 검사) — 같은 작업 트리(dynapse-gate)를 쓰는 관문은 하나만. 살아 있는 pid가 잠금을 쥐고 있으면 기다리지 않고 멈춘다
{ const { readFileSync: rf, writeFileSync: wf, rmSync: rm, existsSync: ex } = await import("node:fs"), L = join(homedir(), "development", ".gate.lock");
  if (ex(L)) { const pid = Number(rf(L, "utf8").trim()); let alive = false; try { process.kill(pid, 0); alive = pid > 0; } catch { alive = false; } if (alive) die(`다른 관문이 도는 중(pid ${pid}) — 끝난 뒤 다시`); }
  wf(L, String(process.pid)); process.on("exit", () => { try { if (rf(L, "utf8").trim() === String(process.pid)) rm(L); } catch { /* */ } }); }
run("git", ["fetch", "-q", "origin"], { cwd: repo });
const sha = run("git", ["rev-parse", arg("sha") ?? "origin/main"], { cwd: repo }).out.trim(); if (!/^[0-9a-f]{40}$/.test(sha)) die(`커밋을 못 찾음: ${arg("sha") ?? "origin/main"}`);
if (!existsSync(join(W, ".git"))) { const r = run("git", ["worktree", "add", "--detach", W, sha], { cwd: repo }); if (r.code) die(`작업 트리: ${r.out.slice(-400)}`); }
else { run("git", ["checkout", "-q", "--", "."], { cwd: W }); const r = run("git", ["checkout", "-q", "--detach", sha], { cwd: W }); if (r.code) die(`checkout: ${r.out.slice(-400)}`); }
const src = join(W, "prototypes", "desktop"), hub = join(W, "prototypes", "hub");
console.log(`관문 · ${sha.slice(0, 8)} · ${W}`);
for (const d of [hub, src]) { const r = run("pnpm", ["install", "--frozen-lockfile"], { cwd: d }); if (r.code) die(`pnpm install(${d}): ${r.out.slice(-600)}`); }
let r = run("node", ["scripts/sync-tokens.mjs"], { cwd: src }); if (r.code) die(`sync-tokens: ${r.out.slice(-400)}`);
mkdirSync(join(src, "dist"), { recursive: true });
r = run("pnpm", ["exec", "tsc", "--noEmit", "-p", "."], { cwd: src }); if (r.code) die(`tsc: ${r.out.slice(-1200)}`);
console.log("  ✓ tsc");
// 주석이 코드를 삼킨 줄(#353 — 줄 중간 // 사고 네 번째, 11-04 noteBrief): 있으면 도장 없음
r = run("node", ["scripts/lint-comments.mjs"], { cwd: hub }); if (r.code) die(`lint-comments\n${r.out.slice(-1500)}`);
console.log("  ✓ lint-comments");
// 코어 경계(M0 ④ · core-host-map.md) — 코어 모듈이 Tauri를 직접 부르면 도장 없음. 옛 커밋(스크립트 없음)은 건너뛴다
if (existsSync(join(src, "scripts", "core-host-check.mjs"))) { r = run("node", ["scripts/core-host-check.mjs"], { cwd: src }); if (r.code) die(`core-host-check\n${r.out.slice(-1200)}`); console.log("  ✓ core-host-check"); }
// 앱 명령 등록(#370 결과 2 — 11-06 browser_reveal·browser_e0_stop이 build.rs·권한 파일에 빠져 sync-sim 70에서야 잡힘): lib.rs 명령 = build.rs = 권한 파일, 어긋나면 시험 전에 멈춤
if (existsSync(join(src, "scripts", "cmd-check.mjs"))) { r = run("node", ["scripts/cmd-check.mjs"], { cwd: src }); if (r.code) die(`cmd-check\n${r.out.slice(-1200)}`); console.log(`  ✓ ${r.out.trim().split("\n").pop()}`); }
// cargo 위치(11-08 밤 검사 빨강 — launchd의 PATH엔 ~/.cargo/bin이 없어 cargo를 못 띄웠고 관문이 sync·turn 전에 멈췄다): ~/.cargo/bin/cargo가 있으면 그것, 없으면 PATH
const CARGO = existsSync(join(homedir(), ".cargo", "bin", "cargo")) ? join(homedir(), ".cargo", "bin", "cargo") : "cargo";
// 앱 단위 시험(#370 결과 8 — 전체 lib 시험이 관문 밖이라 Windows 전용 시험의 맥 실패를 몰랐다): cargo test --lib, 대상 폴더는 관문 사이에 남겨 둔다(처음만 오래 · 그다음 수십 초)
if (existsSync(join(src, "src-tauri", "Cargo.toml"))) { const c0 = Date.now(); r = run(CARGO, ["test", "--lib", "--quiet"], { cwd: join(src, "src-tauri"), env: { ...process.env, PATH: `${join(homedir(), ".cargo", "bin")}:${process.env.PATH ?? ""}`, CARGO_TARGET_DIR: join(homedir(), "development", ".gate-cargo-target") }, timeout: 30 * 60_000 });
  const m = r.out.match(/test result: ok\. (\d+) passed; 0 failed; (\d+) ignored/); if (r.code || !m) die(`cargo test --lib\n${r.out.slice(-1500)}`); console.log(`  ✓ cargo test --lib ${m[1]} 통과 · ${m[2]} 건너뜀 (${Math.round((Date.now() - c0) / 1000)}s)`); }
// 병렬(#353 ④): sync-sim을 SHARDS 조각(SIM_SHARD=k/n — 조각마다 자기 가짜 서버·기기, 포트는 무작위)으로 나누고 turn-sim과 함께 동시에. 하나라도 실패면 도장 없음
const SHARDS = Math.max(1, Math.min(4, Number(arg("shards") ?? 2)));
const go = (args, env, timeout) => new Promise(res => { const t = Date.now(); const p = spawn("pnpm", args, { cwd: hub, env: { ...process.env, ...env } }); let out = "";
  p.stdout.on("data", d => { out += d; }); p.stderr.on("data", d => { out += d; }); const k = setTimeout(() => p.kill("SIGTERM"), timeout);
  p.on("close", code => { clearTimeout(k); res({ code: code ?? 1, out, ms: Date.now() - t }); }); });
const tsx = ["exec", "tsx", "--import", "./scripts/sync-sim/register.mjs"];
const jobs = [...Array.from({ length: SHARDS }, (_, i) => go([...tsx, "scripts/sync-sim.mts"], SHARDS > 1 ? { SIM_SHARD: `${i + 1}/${SHARDS}` } : {}, 3_600_000)), go([...tsx, "../desktop/scripts/turn-sim.mts"], {}, 1_800_000)];
const res = await Promise.all(jobs), syncs = res.slice(0, SHARDS), tr = res[SHARDS];
const sum = syncs.map(x => (x.out.match(/sync-sim (\d+)\/(\d+)/) ?? [0, 0, 0]).slice(1).map(Number)).reduce((a, b) => [a[0] + b[0], a[1] + b[1]], [0, 0]);
const sync = `sync-sim ${sum[0]}/${sum[1]}`, turn = (tr.out.match(/turn-sim \d+\/\d+/) ?? [""])[0];
// 조각이 요약 없이 죽으면(✗ 줄도 없음 — 11-05 8d0df2e6 "80/80"인데 실패) 그 조각의 끝 15줄을 보인다
const crashed = syncs.map((x, i) => ({ x, i })).filter(({ x }) => x.code && !/sync-sim \d+\/\d+/.test(x.out)).map(({ x, i }) => `[조각 ${i + 1}/${SHARDS} 요약 없이 끝남 · 코드 ${x.code}]\n${x.out.trim().split("\n").slice(-15).join("\n")}`);
if (syncs.some(x => x.code)) die(`${sync}\n${[...syncs.flatMap(x => x.out.split("\n").filter(l => /✗/.test(l))).slice(0, 8), ...crashed].join("\n")}`);
console.log(`  ✓ ${sync} (조각 ${SHARDS} · ${syncs.map(x => Math.round(x.ms / 1000) + "s").join(" · ")})`);
if (tr.code) die(`turn-sim(${turn})\n${tr.out.split("\n").filter(l => /✗/.test(l)).slice(0, 6).join("\n")}`);
console.log(`  ✓ ${turn} (${Math.round(tr.ms / 1000)}s)`);
// 작업 공간 저장·실행 시험(#377 BR17·18·21 · #379) — 그 커밋에 있는 것만(옛 커밋은 건너뜀). 큐·귀속 14건 등 · 모델 호출 0
for (const [f, reg] of [["workspace-store-sim.mts", false], ["workspace-api-sim.mts", true], ["workspace-execution-sim.mts", true], ["workspace-artifacts-sim.mts", false], ["workspace-conversation-sim.mts", true]]) {
  if (!existsSync(join(hub, "scripts", f))) continue;
  const w = await go(reg ? [...tsx, `scripts/${f}`] : ["exec", "tsx", `scripts/${f}`], {}, 900_000);
  if (w.code || /FAIL|AssertionError/.test(w.out)) die(`${f}\n${w.out.split("\n").filter(l => /FAIL|Error|✗/.test(l)).slice(0, 6).join("\n") || w.out.slice(-800)}`);
  console.log(`  ✓ ${(w.out.match(/^[a-z-]+: [^\n]*/m) ?? [f])[0].slice(0, 70)} (${Math.round(w.ms / 1000)}s)`);
}
const dirty = run("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: W }).out.trim();
if (dirty) die(`관문 뒤 트리가 깨끗하지 않음 — 도장 안 찍음\n${dirty.slice(0, 400)}`);
mkdirSync(join(ROOT, ".gate"), { recursive: true });
const stamp = { sha, shards: SHARDS, platform: process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : process.platform, at: new Date().toISOString(), tsc: "ok", sync, turn, ms: Date.now() - t0 };
writeFileSync(join(ROOT, ".gate", `${sha}-${stamp.platform}.json`), JSON.stringify(stamp, null, 1));
console.log(`✓ 도장 ${sha.slice(0, 8)} · ${stamp.platform} · ${Math.round(stamp.ms / 60000)}분 — 이 커밋의 OTA는 [0] 점검을 건너뛴다`);
