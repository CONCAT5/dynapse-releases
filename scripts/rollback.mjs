#!/usr/bin/env node
// 롤백 1단계 (§7): 해당 플랫폼 latest.json을 직전 상태로 git revert — 새로 받는 유저 차단.
// 이미 받은 유저는 내려가지 않는다 → 이어서 직전 정상 코드를 더 높은 버전으로 publish(roll-forward).
//   node scripts/rollback.mjs --platform macos|windows
import { join } from "node:path";
import { ROOT, platformArg, die, must, loadConfig, readJson, assertCleanTree, ledgerLine } from "./lib/common.mjs";
import { verifyServed } from "./lib/serve.mjs";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const platform = platformArg();
const c = loadConfig();
assertCleanTree(ROOT, "배포 리포");
must("git", ["pull", "--rebase"], { cwd: ROOT });
const file = `${platform}/latest.json`;
const bad = readJson(join(ROOT, file)).version;
const commit = must("git", ["log", "-1", "--format=%H", "--", file], { cwd: ROOT });
const touched = must("git", ["show", "--name-only", "--format=", commit], { cwd: ROOT }).split("\n").filter(Boolean);
if (touched.some(f => !f.startsWith(`${platform}/`))) die(`되돌릴 커밋 ${commit.slice(0, 7)}이 ${platform}/ 밖도 건드림: ${touched.join(", ")} — 수동 판단`);
must("git", ["revert", "--no-commit", commit], { cwd: ROOT });
if (!existsSync(join(ROOT, file))) {
  must("git", ["revert", "--abort"], { cwd: ROOT });
  die(`${bad}가 첫 stable이라 되돌릴 이전 버전이 없음 — roll-forward(정상 코드를 더 높은 버전으로 publish)만 가능`);
}
const prev = readJson(join(ROOT, file)).version;
must("git", ["commit", "-m", `rollback: ${platform} latest ${bad} → ${prev}`], { cwd: ROOT });
must("git", ["push"], { cwd: ROOT }); // force-push 금지 — append-only
console.log(`latest.json ${bad} → ${prev} 되돌림. Pages 반영 확인 중(최대 ~10분)…`);
let result = "rollback-served-verified";
try { await verifyServed(c, platform, "latest", prev); } catch (e) { result = "rollback-SERVE-VERIFY-FAILED"; console.error(`⚠ ${e.message}`); }
const ledger = readFileSync(join(ROOT, "RELEASES.md"), "utf8").trimEnd();
writeFileSync(join(ROOT, "RELEASES.md"), `${ledger}\n${ledgerLine({ platform, channel: "stable", version: prev, tag: `rollback-from-${bad}`, result })}\n`);
must("git", ["add", "RELEASES.md"], { cwd: ROOT });
must("git", ["commit", "-m", `ledger: ${platform} rollback ${bad} → ${prev}`], { cwd: ROOT });
must("git", ["pull", "--rebase"], { cwd: ROOT });
must("git", ["push"], { cwd: ROOT });
console.log(`\n다음: 이미 ${bad}를 받은 유저를 위해 ${prev} 코드를 ${bad}보다 높은 버전으로 publish (roll-forward). Release ${bad}는 지우지 않는다.`);
