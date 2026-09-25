#!/usr/bin/env node
// 무재시작 업데이트(OTA) 발행 — 앱 화면 코드(JS·CSS)만. 네이티브(Rust·권한·명령 목록)가 바뀌었으면 publish.mjs로.
//   node scripts/ota.mjs --platform macos --source <prototypes/desktop 경로> --notes "변경 한 줄"
// 묶음은 **지금 stable 네이티브 버전**(= 소스 package.json 버전)에만 적용된다. 앱은 서명(updater와 같은 키)·해시를 맞춘 뒤, 도는 작업이 없을 때 화면만 새로고침
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { ROOT, platformArg, die, arg, run, must, loadConfig, readJson, readJsonIfExists, writeJson, sha256File, gitCommitOnly, assertCleanTree, ledgerLine, signingEnv, sleep } from "./lib/common.mjs";
import { verifyArtifact } from "./lib/minisign.mjs";

const platform = platformArg();
const c = loadConfig();
const src = resolve(arg("source", c.sourceDir ?? "") || die("--source <prototypes/desktop 경로> 필요"));
const notes = arg("notes");
if (typeof notes !== "string" || !notes.trim()) die('--notes "변경 한 줄" 필요');
// 로컬 비밀값(.env, git 무시·600) — publish.mjs와 같은 규칙
{
  const localEnv = join(src, ".env");
  if (existsSync(localEnv)) {
    if (run("git", ["check-ignore", "-q", localEnv], { cwd: src }).code !== 0) die(`${localEnv}가 git에 무시되지 않음`);
    if (process.platform !== "win32" && (statSync(localEnv).mode & 0o077)) die(`${localEnv} 권한이 너무 열려 있음 — chmod 600`);
    for (const line of readFileSync(localEnv, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
assertCleanTree(ROOT, "배포 리포");
must("git", ["pull", "--rebase"], { cwd: ROOT });

const native = readJson(join(src, "package.json")).version;
const stable = readJsonIfExists(join(ROOT, platform, "latest.json"));
if (!stable || stable.version !== native) die(`소스 버전 ${native} ≠ stable ${stable?.version} — OTA는 stable 네이티브에만. 네이티브가 바뀌었으면 publish.mjs`);
const feedPath = join(ROOT, "ota", platform, "ota.json");
const prev = readJsonIfExists(feedPath);
const n = prev?.native === native ? prev.ota + 1 : 1;

console.log(`\n[1] 화면 빌드 (${native} · 묶음 ${n})`);
must("pnpm", ["-s", "build:web"], { cwd: src });
const dist = join(src, "dist");
const files = {};
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(js|css)$/.test(f) && f !== "loader.js") files[relative(dist, p).split("\\").join("/")] = p; } };
walk(dist);
if (!files["main.js"] || !files["app.css"]) die("main.js·app.css가 없다");

console.log("[2] 묶음·서명");
const rel = `ota/${platform}/${native}/${n}`;
const out = join(ROOT, rel);
mkdirSync(out, { recursive: true });
const manifest = { native, ota: n, files: {} };
for (const [k, p] of Object.entries(files)) { mkdirSync(join(out, k, ".."), { recursive: true }); copyFileSync(p, join(out, k)); manifest.files[k] = sha256File(p); }
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
const signed = `${native}+ota${n}`;
const signEnv = { ...process.env, ...(await signingEnv()) };
const sg = run("pnpm", ["tauri", "signer", "sign", "--app-version", signed, join(out, "manifest.json")], { cwd: src, env: signEnv });
if (sg.code !== 0) die(`서명 실패\n${sg.err.split("\n").slice(-3).join("\n")}`);
verifyArtifact(readFileSync(join(out, "manifest.json")), readFileSync(join(out, "manifest.json.sig"), "utf8"), c.pubkey, signed);
console.log(`  ✓ 서명 ${signed} · 파일 ${Object.keys(files).length}`);

console.log("[3] 피드 올리기");
writeJson(feedPath, { native, ota: n, base: `${rel}/`, notes, pub_date: new Date().toISOString() });
gitCommitOnly([rel, `ota/${platform}/ota.json`], `${platform}: ota ${signed}`);

console.log("[4] 서빙 확인 (최대 15분)");
const url = `${c.pagesBase}/ota/${platform}/ota.json`;
let ok = false;
for (let k = 0; k < 90 && !ok; k++) {
  const j = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  if (j?.native === native && j?.ota === n) {
    const m = await fetch(`${c.pagesBase}/${rel}/manifest.json?t=${Date.now()}`).then(r => (r.ok ? r.text() : null)).catch(() => null);
    ok = m !== null && JSON.parse(m).ota === n;
  }
  if (!ok) await sleep(10_000);
}
writeFileSync(join(ROOT, "RELEASES.md"), `${readFileSync(join(ROOT, "RELEASES.md"), "utf8").trimEnd()}\n${ledgerLine({ platform, channel: "ota", version: signed, tag: "-", result: ok ? "ota-served-verified" : "ota-SERVE-VERIFY-FAILED", note: notes })}\n`);
gitCommitOnly(["RELEASES.md"], `ledger: ${platform} ota ${signed}`);
if (!ok) die("서빙 확인 실패 — 원장에 기록됨");
console.log(`\n✓ ${platform} ${signed} 화면 묶음 발행·서빙 확인. 켜져 있는 ${native} 앱은 SSE 알림(또는 30분 확인)으로 받아 한가할 때 새로고침`);
