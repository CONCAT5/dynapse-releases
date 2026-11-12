#!/usr/bin/env node
// 밤 전체 검사(#353 — 대표 승인 2026-11-04): launchd(com.dynapse.nightly-gate)가 한 시간마다 부르고, 한국 시간 03시대 · 그날 아직 안 돌았을 때만 돈다.
// 맥이 자고 있어 03시대를 놓치면 그날은 건너뛴다(깨어난 뒤 몰아서 돌지 않는다). 배포는 하지 않는다 — 관문(tsc · sync-sim 전 조각 · turn-sim) + render-sim 전부, 결과 한 줄을 BOARD에.
// 겹치지 않기: 관문 잠금(~/development/.gate.lock)을 다른 관문이 쥐고 있으면 그날은 건너뛴다. 기록: ~/development/nightly.log
// 끄기: launchctl bootout gui/$(id -u)/com.dynapse.nightly-gate (다시 켜기 = 같은 plist로 bootstrap) · 안내는 requests/windows-ota-runbook-2026-10-28.md 아래
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
// 고정 Chrome(#353 · 11-04): sim·render-sim의 실제 검사·렌더는 이 맥의 Chrome for Testing 157로(148은 sync-sim 105f를 못 지나간다 11-05)(시스템 Chrome은 자동 업데이트 중 새 창이 끊긴다) — 없으면 예전처럼 시스템 Chrome
const PINNED_CHROME = `${process.env.HOME}/.cache/puppeteer/chrome/mac_arm-157.0.8103.38/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
if (!process.env.CHROME_PATH && (await import("node:fs")).existsSync(PINNED_CHROME)) process.env.CHROME_PATH = PINNED_CHROME;

const HOME = homedir(), DEV = join(HOME, "development"), LOG = join(DEV, "nightly.log"), LAST = join(DEV, ".nightly-last"), LOCK = join(DEV, ".gate.lock");
const REL = join(DEV, "dynapse-releases"), GATE_WT = join(DEV, "dynapse-gate"), REPO = join(DEV, "ai-task-mining"), BOARD_WT = join(DEV, "ai-task-mining-nightly");
const log = m => appendFileSync(LOG, `${new Date().toISOString()} ${m}\n`);
// ③ BOARD 한 줄(전용 작업 트리 · origin/main 위에 한 줄 커밋 · 실패해도 검사 결과는 nightly.log에 남는다) — 끝·중단(신호)·멈춤 발견이 같은 길
function board(row, msg) {
  const B = "prototypes/hub/BOARD.md", HEAD_MARK = "**밤 전체 검사(#353 — 03:00 KST · 배포 없음)**";
  if (!existsSync(join(BOARD_WT, ".git"))) run("git", ["worktree", "add", "--detach", BOARD_WT, "origin/main"], REPO);
  for (let k = 0; k < 3; k++) {
    run("git", ["fetch", "-q", "origin"], BOARD_WT); run("git", ["checkout", "-q", "--detach", "origin/main"], BOARD_WT);
    const p = join(BOARD_WT, B); let s = readFileSync(p, "utf8");
    if (!s.includes(HEAD_MARK)) { const at = s.indexOf("**G3 뒤 처리"); const block = `${HEAD_MARK}\n| 날짜(KST) | 커밋 | 결과 | 걸린 시간 |\n|---|---|---|---|\n\n`; s = at >= 0 ? s.slice(0, at) + block + s.slice(at) : `${s}\n${block}`; }
    const i = s.indexOf(HEAD_MARK), end = s.indexOf("\n\n", i); s = `${s.slice(0, end)}\n${row}${s.slice(end)}`;
    writeFileSync(p, s);
    run("git", ["add", B], BOARD_WT);
    run("git", ["-c", "user.name=kwak914", "-c", "user.email=kwak914@gmail.com", "commit", "-q", "-m", msg], BOARD_WT);
    if (run("git", ["push", "-q", "origin", "HEAD:main"], BOARD_WT).code === 0) { log("board pushed"); break; }
    log(`board push retry ${k + 1}`);
  }
}
const run = (cmd, args, cwd, timeout = 3_600_000) => { const t = Date.now(), r = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 1 << 28, timeout, env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ""}` } }); return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, ms: Date.now() - t }; };
const kst = new Date(Date.now() + 9 * 3_600_000), day = kst.toISOString().slice(0, 10);
// 잠금이 살아 있다 = 그 pid가 살아 있고 관문·밤 검사 프로세스다(pid가 다른 프로세스에 다시 쓰인 경우 — 남은 잠금은 지운다)
const isGatePid = pid => { if (!(pid > 0)) return false; try { process.kill(pid, 0); } catch { return false; } const c = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).stdout ?? ""; return /gate\.mjs|nightly\.mjs/.test(c); };
// 멈춤 발견(#353 보정 — 11-06 밤 검사가 기록 없이 사라졌다): 마지막 "start <날> pid=…" 뒤에 done·중단이 없고 그 pid가 죽었으면 BOARD에 "중단" 한 줄(그날 한 번) — 매시간 깸마다 본다
{ const lines = existsSync(LOG) ? readFileSync(LOG, "utf8").trim().split("\n") : [], si = lines.map(l => / start (\d{4}-\d{2}-\d{2})/.test(l)).lastIndexOf(true);
  if (si >= 0) { const m = lines[si].match(/ start (\d{4}-\d{2}-\d{2})(?: pid=(\d+))?/), d = m[1], pid = Number(m[2] ?? 0), after = lines.slice(si + 1);
    if (!after.some(l => / (done|stopped|stall) /.test(l)) && !isGatePid(pid)) { const at = lines[si].slice(0, 16).replace("T", " "); log(`stall ${d} — ${at}Z에 시작해 기록 없이 멈춤`); board(`| ${d} | - | **중단** · ${at}Z에 시작해 끝 기록 없이 멈춤(다음 깸에 발견) | - |`, `BOARD: nightly full gate ${d} STALLED`); } } }
if (kst.getUTCHours() !== 3 && !process.argv.includes("--now")) process.exit(0);
if (existsSync(LAST) && readFileSync(LAST, "utf8").trim() === day && !process.argv.includes("--now")) process.exit(0);
const lockAlive = () => { if (!existsSync(LOCK)) return false; const pid = Number(readFileSync(LOCK, "utf8").trim()); if (isGatePid(pid)) return true; try { writeFileSync(LOCK, ""); } catch { /* */ } return false; };
if (lockAlive()) { log(`skip ${day} — 다른 관문이 도는 중`); process.exit(0); }
writeFileSync(LAST, day);
const t0 = Date.now();
log(`start ${day} pid=${process.pid}`);
// 끊기면(신호) 그 자리에서 BOARD 한 줄 — 조용히 사라지지 않게
for (const sig of ["SIGTERM", "SIGHUP", "SIGINT"]) process.on(sig, () => { const m = Math.round((Date.now() - t0) / 60000); log(`stopped ${day} ${sig}`); board(`| ${day} | - | **중단** · ${sig} · ${m}분 돈 뒤 | ${m}분 |`, `BOARD: nightly full gate ${day} STOPPED (${sig})`); process.exit(1); });
// ① 관문(깨끗한 작업 트리 · origin/main · 3조각) — 통과하면 도장도 남는다(같은 커밋 OTA는 [0]을 건너뛴다)
const g = run(process.execPath, [join(REL, "scripts", "gate.mjs"), "--shards", "3"], REL, 3_600_000);
const sha = (g.out.match(/관문 · ([0-9a-f]{8})/) ?? [])[1] ?? "-", sync = (g.out.match(/sync-sim \d+\/\d+/) ?? ["sync-sim ?"])[0], turn = (g.out.match(/turn-sim \d+\/\d+/) ?? ["turn-sim ?"])[0];
const gateOk = g.code === 0;
// ② render-sim 전부(관문이 의존성을 깐 같은 작업 트리에서 · 관문 잠금을 이어 쥔다)
let rs = { code: 1, out: "", ms: 0 }, rsLine = "render-sim 안 돎";
if (existsSync(join(GATE_WT, "prototypes", "hub"))) {
  if (!lockAlive()) { writeFileSync(LOCK, String(process.pid)); }
  rs = run("npx", ["tsx", "--import", "./scripts/sync-sim/register.mjs", "scripts/render-sim.mts"], join(GATE_WT, "prototypes", "hub"), 3_600_000);
  try { if (readFileSync(LOCK, "utf8").trim() === String(process.pid)) writeFileSync(LOCK, ""); } catch { /* */ }
  rsLine = (rs.out.match(/render-sim \d+\/\d+/) ?? [`render-sim 실패(${rs.code})`])[0];
}
const fails = [...g.out.split("\n"), ...rs.out.split("\n")].filter(l => /✗/.test(l)).slice(0, 4).map(l => l.trim().slice(0, 60));
// 실패 자세히(11-13 — 요약 줄만 남아 P421 원인을 못 봤다): ✗ 줄과 그 아래 들여쓴 이유 줄 2개씩, 40줄까지 nightly.log에 그대로
{ const ls = [...g.out.split("\n"), ...rs.out.split("\n")], det = [];
  ls.forEach((l, i) => { if (/✗/.test(l)) { det.push(l.trim().slice(0, 300)); for (const n of ls.slice(i + 1, i + 3)) if (/^\s{5,}\S/.test(n)) det.push(`    ${n.trim().slice(0, 300)}`); } });
  for (const l of det.slice(0, 40)) log(`  detail ${l}`); }
const min = Math.round((Date.now() - t0) / 60000), ok = gateOk && rs.code === 0;
const row = `| ${day} | ${sha} | ${ok ? "초록" : "**빨강**"} · ${sync} · ${turn} · ${rsLine}${fails.length ? ` · ${fails.join(" / ").replace(/\|/g, "/")}` : ""} | ${min}분 |`;
log(`done ${row}`);
board(row, `BOARD: nightly full gate ${day} ${ok ? "green" : "RED"} (${sha})`);
process.exit(0);
