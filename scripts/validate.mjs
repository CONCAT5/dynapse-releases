#!/usr/bin/env node
// CI 검사 (docs/11 §6) — 사람이나 스크립트가 틀려도 잘못된 피드가 main에 못 들어오게.
//   node scripts/validate.mjs [--range <base>..<head>] [--online]
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROOT, PLATFORMS, arg, run, loadConfig, readJson, manifestErrors, downloadErrors, cmpSemver, isSemver } from "./lib/common.mjs";

const errors = [];
const bad = (m) => errors.push(m);
const git = (a) => run("git", a, { cwd: ROOT });
const c = loadConfig({ requireFrozen: false });
const files = git(["ls-files"]).out.split("\n").filter(Boolean);

// 1) 바이너리·대용량 거부 [사고 4]
const BIN = /\.(dmg|exe|zip|tar\.gz|msi|app|sig|p8|key|pem|p12)$/i;
for (const f of files) {
  if (BIN.test(f)) bad(`바이너리/키 파일 커밋 금지: ${f} (Release asset에만)`);
  else if (/(^|\/)\.env(\.|$)/.test(f)) bad(`환경값 파일 커밋 금지: ${f} — 공개 리포다`);
  else if (statSync(join(ROOT, f)).size > 1024 * 1024) bad(`1MB 초과 파일: ${f}`);
}

// 2) 모든 JSON이 BOM 없이 파싱 [사고 11] · 3·4) 매니페스트 스키마 + 폴더-플랫폼-태그 일치 [사고 3·6]
for (const f of files.filter(f => f.endsWith(".json"))) {
  let j;
  try { j = readJson(join(ROOT, f)); } catch (e) { bad(`${f}: ${e.message}`); continue; }
  const [dir, name] = f.split("/");
  if (!PLATFORMS[dir] || f.split("/").length !== 2) continue;
  if (name === "latest.json" || name === "beta.json") manifestErrors(j, dir, c.owner ? c : null).forEach(m => bad(`${f}: ${m}`));
  else if (name === "download.json") downloadErrors(j, dir, c.owner ? c : null).forEach(m => bad(`${f}: ${m}`));
  else bad(`${f}: 플랫폼 폴더에는 latest/beta/download.json만 둔다`);
}

// 8) 비밀 스캔 [사고 9] — 개인키 헤더, minisign 비밀키(평문/베이스64), 서명 env 대입
const SECRET = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /untrusted comment: rsign encrypted secret key/,
  /dW50cnVzdGVkIGNvbW1lbnQ6IHJzaWduIGVuY3J5cHRlZCBzZWNyZXQga2V5/, // 위 문구의 base64 (tauri signer generate 출력)
  /TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)?\s*[:=]\s*["']?[A-Za-z0-9+/=]{16,}/,
];
for (const f of files.filter(f => !f.startsWith("scripts/validate.mjs"))) {
  const t = readFileSync(join(ROOT, f), "utf8");
  for (const re of SECRET) if (re.test(t)) bad(`${f}: 비밀값 패턴(${re.source.slice(0, 30)}…)`);
}

// 5·6) 커밋 단위 검사 — 두 플랫폼 동시 변경 금지(infra: 예외), latest version 역행 금지(rollback:/Revert 예외) [사고 1·3·10]
const range = typeof arg("range") === "string" ? arg("range") : null;
const commits = range ? git(["rev-list", "--reverse", range]).out.split("\n").filter(Boolean) : [];
for (const sha of commits) {
  const msg = git(["log", "-1", "--format=%s", sha]).out;
  const changed = git(["show", "--name-only", "--format=", sha]).out.split("\n").filter(Boolean);
  const plats = Object.keys(PLATFORMS).filter(p => changed.some(f => f.startsWith(`${p}/`)));
  if (plats.length > 1 && !msg.startsWith("infra:")) bad(`${sha.slice(0, 7)} "${msg}": macos/ 와 windows/ 를 한 커밋에서 변경`);
  for (const p of plats) {
    const now = git(["show", `${sha}:${p}/latest.json`]), before = git(["show", `${sha}^:${p}/latest.json`]);
    if (now.code || before.code) continue;
    try {
      const a = JSON.parse(before.out).version, b = JSON.parse(now.out).version;
      if (isSemver(a) && isSemver(b) && cmpSemver(b, a) < 0 && !/^(rollback:|Revert)/.test(msg))
        bad(`${sha.slice(0, 7)} "${msg}": ${p}/latest.json version ${a} → ${b} 역행 (rollback: 커밋만 허용)`);
    } catch { /* 파싱 오류는 위에서 잡힘 */ }
  }
}

// 7) 매니페스트 url이 실제 200인지 (--online) [사고 5]
if (arg("online", false) === true) {
  for (const f of files.filter(f => /^(macos|windows)\/(latest|beta|download)\.json$/.test(f))) {
    const j = readJson(join(ROOT, f));
    const urls = f.endsWith("download.json") ? [j.url] : [...new Set(Object.values(j.platforms ?? {}).map(p => p.url))];
    for (const u of urls) {
      const r = await fetch(u, { method: "HEAD", redirect: "follow" }).catch(e => ({ status: `에러 ${e.message}` }));
      if (r.status !== 200) bad(`${f}: ${u} → ${r.status}`);
    }
  }
}

if (errors.length) { console.error(`✗ 검사 실패 ${errors.length}건\n  - ${errors.join("\n  - ")}`); process.exit(1); }
console.log(`✓ 검사 통과 (파일 ${files.length}, 커밋 ${commits.length}${arg("online", false) === true ? ", online" : ""})`);
