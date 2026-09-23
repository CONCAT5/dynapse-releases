#!/usr/bin/env node
// 9·10단계 (docs/11 §4) — 실기기 검증을 마친 beta를 stable로. beta.json을 latest.json으로 **바이트 그대로** 복사.
//   node scripts/promote.mjs --platform macos|windows
import { copyFileSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  ROOT, PLATFORMS, platformArg, die, run, must, loadConfig, readJson, readJsonIfExists, writeJson,
  cmpSemver, manifestErrors, downloadErrors, sha256File, assetBase, repoSlug, gitCommitOnly, assertCleanTree, ledgerLine,
} from "./lib/common.mjs";
import { verifyServed } from "./lib/serve.mjs";

const platform = platformArg();
const P = PLATFORMS[platform];
const c = loadConfig();
const slug = repoSlug(c);

assertCleanTree(ROOT, "배포 리포");
must("git", ["pull", "--rebase"], { cwd: ROOT });
const betaPath = join(ROOT, platform, "beta.json"), latestPath = join(ROOT, platform, "latest.json");
const beta = readJsonIfExists(betaPath) ?? die(`${platform}/beta.json 없음 — publish 먼저`);
const errs = manifestErrors(beta, platform, c);
if (errs.length) die(`beta.json 오류:\n  - ${errs.join("\n  - ")}`);
const stable = readJsonIfExists(latestPath);
if (stable && cmpSemver(beta.version, stable.version) <= 0) die(`beta ${beta.version} ≤ stable ${stable.version} — promote할 것이 없음`);
const tag = `${P.tagPrefix}${beta.version}`;

// 원장에 이 버전 beta의 서빙 검증 성공 기록이 있어야 한다
const ledger = readFileSync(join(ROOT, "RELEASES.md"), "utf8");
if (!ledger.split("\n").some(l => l.includes(`| ${platform} | beta | ${beta.version} |`) && l.includes("beta-served-verified")))
  die(`RELEASES.md에 ${platform} beta ${beta.version} 서빙 검증 성공 기록이 없음 — promote 금지`);

// 첫 설치용 download.json — Release의 설치 파일을 받아 해시
const installer = platform === "macos" ? `Dynapse_${beta.version}_universal.dmg` : `Dynapse_${beta.version}_x64-setup.exe`;
const tmp = mkdtempSync(join(tmpdir(), "dynapse-promote-"));
must("gh", ["release", "download", tag, "--repo", slug, "--pattern", installer, "--dir", tmp]);
const f = join(tmp, installer);
const download = { version: beta.version, pub_date: beta.pub_date, name: installer, url: `${assetBase(c, tag)}${installer}`, sha256: sha256File(f), size: statSync(f).size };
const derr = downloadErrors(download, platform, c);
if (derr.length) die(`download.json 오류:\n  - ${derr.join("\n  - ")}`);
rmSync(tmp, { recursive: true, force: true });

console.log(`\n${platform}: stable ${stable?.version ?? "(없음)"} → ${beta.version}`);
console.log(`  latest.json  ← beta.json 바이트 복사`);
console.log(`  download.json: ${download.name} ${download.size} bytes sha256 ${download.sha256}`);
const rl = createInterface({ input: process.stdin, output: process.stdout });
const typed = (await rl.question(`\n대표 기기에서 실제 업데이트 경로 수신·재실행·Task 1건 E2E를 확인했으면 버전(${beta.version})을 입력: `)).trim();
rl.close();
if (typed !== beta.version) die("확인 안 됨 — promote 취소");

copyFileSync(betaPath, latestPath);
if (!readFileSync(latestPath).equals(readFileSync(betaPath))) die("latest.json이 beta.json과 바이트 불일치");
writeJson(join(ROOT, platform, "download.json"), download);
console.log(must("git", ["diff", "--stat"], { cwd: ROOT }));
gitCommitOnly([`${platform}/latest.json`, `${platform}/download.json`], `${platform}: promote ${beta.version}`);
if (run("gh", ["release", "edit", tag, "--repo", slug, "--prerelease=false"]).code !== 0) console.error("  ⚠ prerelease 해제 실패 — 수동으로: gh release edit", tag);

let result = "stable-served-verified", note = "";
try { await verifyServed(c, platform, "latest", beta.version); }
catch (e) { result = "stable-SERVE-VERIFY-FAILED"; note = e.message; console.error(`  ⚠ ${e.message}`); }
writeFileSync(join(ROOT, "RELEASES.md"), `${ledger.trimEnd()}\n${ledgerLine({ platform, channel: "stable", version: beta.version, tag, result, note })}\n`);
gitCommitOnly(["RELEASES.md"], `ledger: ${platform} stable ${beta.version} ${result}`);
if (result !== "stable-served-verified") die("stable 서빙 검증 실패 — 원장 기록됨. 롤백 판단: node scripts/rollback.mjs --platform " + platform);
console.log(`\n✓ ${platform} ${beta.version} stable 발행·서빙 검증 완료`);
