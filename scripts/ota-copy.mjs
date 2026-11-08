#!/usr/bin/env node
// 같은 화면 묶음을 다른 플랫폼 피드로(2026-11-03 대표 결정 — Windows updater 키를 이 맥으로 옮김, 10-28 결정을 뒤집음):
// 맥에서 점검·빌드·서명·서빙 확인까지 끝난 묶음(ota/<from>/<native>/<n>)의 파일을 바이트 그대로 ota/<to>/<native>/<m>로 복사하고,
// <to> 플랫폼 키로 manifest에 서명 → 그 플랫폼 pubkey로 검증 → 피드·원장 → 서빙 확인. 화면 묶음은 플랫폼 공통(build:web — 플랫폼 분기는 실행 중에)
//   node scripts/ota-copy.mjs --to windows --source <prototypes/desktop 경로> [--from macos] [--dry]
// --dry = 임시 폴더에서 서명·검증만(피드·커밋 없음). 키 = ~/.tauri/dynapse-updater-windows.key · 비밀번호 = TAURI_SIGNING_PRIVATE_KEY_PASSWORD_WINDOWS(.env)
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { ROOT, die, arg, run, must, loadConfig, readJson, readJsonIfExists, writeJson, sha256File, gitCommitOnly, assertCleanTree, ledgerLine, srcSha, signingEnv, sleep, pubkeyOf, pagesHeal } from "./lib/common.mjs";
import { verifyArtifact } from "./lib/minisign.mjs";

const from = arg("from") ?? "macos", to = arg("to");
if (!["macos", "windows"].includes(from) || !["macos", "windows"].includes(to) || from === to) die("--to windows|macos (그리고 --from 다른 쪽) 필요");
const dry = process.argv.includes("--dry");
const c = loadConfig();
const src = resolve(arg("source", c.sourceDir ?? "") || die("--source <prototypes/desktop 경로> 필요"));
// 로컬 비밀값(.env) — ota.mjs와 같은 규칙(값은 출력하지 않는다)
{ const localEnv = join(src, ".env");
  if (existsSync(localEnv)) {
    if (run("git", ["check-ignore", "-q", localEnv], { cwd: src }).code !== 0) die(`${localEnv}가 git에 무시되지 않음`);
    if (process.platform !== "win32" && (statSync(localEnv).mode & 0o077)) die(`${localEnv} 권한이 너무 열려 있음 — chmod 600`);
    for (const line of readFileSync(localEnv, "utf8").split("\n")) { const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); } } }

if (!dry) { assertCleanTree(ROOT, "배포 리포"); must("git", ["pull", "--rebase"], { cwd: ROOT }); }
const fromFeed = readJsonIfExists(join(ROOT, "ota", from, "ota.json")) ?? die(`ota/${from}/ota.json 없음`);
const native = fromFeed.native, nFrom = fromFeed.ota;
const stableTo = readJsonIfExists(join(ROOT, to, "latest.json"));
if (!stableTo || stableTo.version !== native) die(`${to} stable ${stableTo?.version} ≠ 묶음 네이티브 ${native} — 그 플랫폼 앱이 받을 수 없다`);
const fromDir = join(ROOT, "ota", from, native, String(nFrom));
const fromManifest = readJson(join(fromDir, "manifest.json"));
// 원본 묶음이 그대로인지(서명된 해시와 파일이 같은지)
for (const [k, h] of Object.entries(fromManifest.files)) if (sha256File(join(fromDir, k)) !== h) die(`${from} 묶음 파일이 manifest와 다름: ${k}`);
const prevTo = readJsonIfExists(join(ROOT, "ota", to, "ota.json"));
const m = prevTo?.native === native ? prevTo.ota + 1 : 1;
const rel = `ota/${to}/${native}/${m}`;
const out = dry ? mkdtempSync(join(tmpdir(), "ota-copy-")) : join(ROOT, rel);
mkdirSync(out, { recursive: true });
const manifest = { native, ota: m, files: {} };
for (const [k, h] of Object.entries(fromManifest.files)) { mkdirSync(dirname(join(out, k)), { recursive: true }); copyFileSync(join(fromDir, k), join(out, k)); manifest.files[k] = h; }
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
const signed = `${native}+ota${m}`;
console.log(`[1] ${from} ${native}+ota${nFrom} → ${to} ${signed}${dry ? " (dry)" : ""} · 파일 ${Object.keys(manifest.files).length}`);
const signEnv = { ...process.env, ...(await signingEnv(to)) };
const sg = run("pnpm", ["tauri", "signer", "sign", "--app-version", signed, join(out, "manifest.json")], { cwd: src, env: signEnv });
if (sg.code !== 0) die(`서명 실패(${to} 키)\n${sg.err.split("\n").slice(-3).join("\n")}`);
verifyArtifact(readFileSync(join(out, "manifest.json")), readFileSync(join(out, "manifest.json.sig"), "utf8"), pubkeyOf(c, to), signed);
console.log(`  ✓ 서명·검증 ${signed} (${to} pubkey)`);
if (dry) { rmSync(out, { recursive: true, force: true }); console.log("\n✓ dry — 서명·검증만 통과(피드·커밋 없음)"); process.exit(0); }

const notes = `${fromFeed.notes ?? ""}`.trim() || `${from} ota ${nFrom}과 같은 묶음`;
writeJson(join(ROOT, "ota", to, "ota.json"), { native, ota: m, base: `${rel}/`, notes, pub_date: new Date().toISOString(), copied_from: `${from}/${native}/${nFrom}` });
gitCommitOnly([rel, `ota/${to}/ota.json`], `${to}: ota ${signed} (= ${from} ota ${nFrom}, signed on this Mac)`);
console.log("[2] 서빙 확인 (최대 15분)");
const url = `${c.pagesBase}/ota/${to}/ota.json`;
let ok = false; const heal = {};
for (let k = 0; k < 90 && !ok; k++) {
  const j = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  if (j?.native === native && j?.ota === m) {
    const mt = await fetch(`${c.pagesBase}/${rel}/manifest.json?t=${Date.now()}`).then(r => (r.ok ? r.text() : null)).catch(() => null);
    const sgOk = await fetch(`${c.pagesBase}/${rel}/manifest.json.sig?t=${Date.now()}`).then(r => r.ok).catch(() => false);
    ok = mt !== null && JSON.parse(mt).ota === m && sgOk;
  }
  if (!ok) { pagesHeal(c, heal); await sleep(10_000); }
}
writeFileSync(join(ROOT, "RELEASES.md"), `${readFileSync(join(ROOT, "RELEASES.md"), "utf8").trimEnd()}\n${ledgerLine({ platform: to, channel: "ota", version: signed, tag: "-", result: ok ? "ota-served-verified" : "ota-SERVE-VERIFY-FAILED", note: `= ${from} ota ${nFrom} · src ${srcSha(src)} · ${notes}` })}\n`);
gitCommitOnly(["RELEASES.md"], `ledger: ${to} ota ${signed}`);
if (!ok) die("서빙 확인 실패 — 원장에 기록됨");
console.log(`\n✓ ${to} ${signed} 발행·서빙 확인 (= ${from} ota ${nFrom})`);
