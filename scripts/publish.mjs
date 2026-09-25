#!/usr/bin/env node
// 배포 1~7·10단계 (docs/11 §4) — beta 채널로만 발행한다. stable은 실기기 검증 후 promote.mjs.
//   node scripts/publish.mjs --platform macos|windows --source <prototypes/desktop 경로> --notes "…" [--dry-run]
// 이 스크립트는 자기 플랫폼 폴더(+원장 RELEASES.md) 밖의 파일을 쓰지 않는다.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  ROOT, PLATFORMS, arg, platformArg, die, run, must, loadConfig, readJson, readJsonIfExists, writeJson,
  cmpSemver, isSemver, manifestErrors, sha256File, assetBase, repoSlug, gitCommitOnly, assertCleanTree, ledgerLine, signingEnv,
} from "./lib/common.mjs";
import { execFileSync } from "node:child_process";
import { verifyArtifact } from "./lib/minisign.mjs";
import { verifyServed } from "./lib/serve.mjs";

const platform = platformArg();
const P = PLATFORMS[platform];
const dryRun = arg("dry-run", false) === true;
const c = loadConfig();
const slug = repoSlug(c);
const src = resolve(arg("source", c.sourceDir ?? "") || die("--source <prototypes/desktop 경로> 필요"));
// 소스 폴더의 release.env(서명·공증 식별자, 커밋됨)를 읽는다 — 셸에 이미 있는 값이 우선. 비밀값이 들어 있으면 거부
{
  const envFile = join(src, "release.env");
  if (existsSync(envFile)) {
    const text = readFileSync(envFile, "utf8");
    if (/^\s*TAURI_SIGNING_PRIVATE_KEY/m.test(text) || /BEGIN [A-Z ]*PRIVATE KEY/.test(text))
      die(`${envFile}에 비밀값(서명 키·비밀번호)이 있음 — 지우고 커밋 이력도 확인하라. 비밀번호는 배포 때 입력한다`);
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m || process.env[m[1]]) continue;
      const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").replace(/^~(?=\/|$)/, home);
    }
    console.log(`  · ${envFile} 읽음`);
  }
  // 로컬 비밀값 파일(.env, git 무시) — updater 키 비밀번호 등. 커밋될 수 있는 위치거나 권한이 열려 있으면 거부
  const localEnv = join(src, ".env");
  if (existsSync(localEnv)) {
    if (run("git", ["check-ignore", "-q", localEnv], { cwd: src }).code !== 0)
      die(`${localEnv}가 git에 무시되지 않음 — 비밀값이 커밋될 수 있다. .gitignore에 추가하라`);
    if (process.platform !== "win32" && (statSync(localEnv).mode & 0o077)) die(`${localEnv} 권한이 너무 열려 있음 — chmod 600 ${localEnv}`);
    for (const line of readFileSync(localEnv, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m || process.env[m[1]]) continue;
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    console.log(`  · ${localEnv} 읽음 (git 무시·600 확인)`);
  }
}
const notes = arg("notes");
if (!dryRun && (typeof notes !== "string" || !notes.trim())) die('--notes "변경 한 줄" 필요 (voice.md 언어)');
const step = (n, t) => console.log(`\n[${n}] ${t}`);

// ───────── 1. preflight ─────────
step(1, "preflight");
if (process.platform !== P.host) die(`${platform} 빌드는 ${P.host} 머신에서만 (현재 ${process.platform})`);
for (const [cmd, a] of [["gh", ["--version"]], ["git", ["--version"]], ["pnpm", ["--version"]]])
  if (run(cmd, a).code !== 0) die(`${cmd} 없음`);
if (run("gh", ["auth", "status"]).code !== 0) die("gh 로그인 필요 (gh auth login)");

assertCleanTree(ROOT, "배포 리포");
must("git", ["pull", "--rebase"], { cwd: ROOT });
assertCleanTree(src, "소스 리포");
const srcHead = must("git", ["rev-parse", "HEAD"], { cwd: src });

const pkg = readJson(join(src, "package.json"));
const conf = readJson(join(src, "src-tauri", "tauri.conf.json"));
const cargoVer = readFileSync(join(src, "src-tauri", "Cargo.toml"), "utf8").match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1];
const v = pkg.version;
if (!isSemver(v)) die(`package.json version이 SemVer가 아님: ${v}`);
if (conf.version !== "../package.json") die(`tauri.conf.json version은 "../package.json" 참조여야 함 (현재 ${conf.version}) — 버전 단일 원천 §3.3`);
if (cargoVer !== v) die(`Cargo.toml version ${cargoVer} ≠ package.json ${v} — package.json만 고치고 Cargo.toml을 맞춰라`);

const tag = `${P.tagPrefix}${v}`;
if (run("gh", ["api", `repos/${slug}/git/refs/tags/${tag}`]).code === 0) die(`태그 ${tag} 이미 있음 — 한 번 쓴 버전은 다시 쓰지 않는다`);
if (run("gh", ["release", "view", tag, "--repo", slug]).code === 0) die(`Release ${tag} 이미 있음`);
const stable = readJsonIfExists(join(ROOT, platform, "latest.json"));
if (stable && cmpSemver(v, stable.version) <= 0) die(`새 버전 ${v} ≤ ${platform} stable ${stable.version}`);

if (platform === "macos") {
  // 서명·공증 env 이름은 Tauri v2 macOS 서명 문서 기준 — 첫 실배포 때 실측 확인
  const need = ["APPLE_SIGNING_IDENTITY", "APPLE_API_ISSUER", "APPLE_API_KEY", "APPLE_API_KEY_PATH"].filter(k => !process.env[k]);
  if (need.length) die(`macOS 서명·공증 env 없음: ${need.join(", ")}`);
  if (!must("security", ["find-identity", "-v", "-p", "codesigning"]).includes(process.env.APPLE_SIGNING_IDENTITY))
    die(`키체인에 서명 인증서 없음: ${process.env.APPLE_SIGNING_IDENTITY}`);
  const t = must("rustup", ["target", "list", "--installed"]);
  for (const x of ["aarch64-apple-darwin", "x86_64-apple-darwin"]) if (!t.includes(x)) die(`rustup target add ${x} 필요 (universal 빌드)`);
} else {
  if (!c.windowsSignCommand) die("release.config.json windowsSignCommand 미정 — Windows 서명 방식(YubiKey 로컬 / 클라우드) 결재 후 진행 (§5.3)");
  if (run("where", ["signtool"], { shell: true }).code !== 0) die("signtool 없음 (Windows SDK)");
}
// 비밀번호는 마지막에 묻는다 — 그 전 검사에서 막히면 입력할 필요가 없게
const signEnv = { ...process.env, ...(await signingEnv()) }; // 서명하는 자식 프로세스에만 전달
{
  // 개인키로 더미 서명 → release.config.json의 pubkey로 검증 = 키쌍 일치 확인
  const d = mkdtempSync(join(tmpdir(), "dynapse-pre-"));
  const f = join(d, "probe.bin");
  writeFileSync(f, `dynapse preflight ${Date.now()}`);
  const sg = run("pnpm", ["tauri", "signer", "sign", "--app-version", v, f], { cwd: src, env: signEnv });
  if (sg.code !== 0) die(`더미 서명 실패 — 비밀번호가 틀렸거나 키 파일이 손상됨\n${sg.err.split("\n").slice(-3).join("\n")}`);
  try { verifyArtifact(readFileSync(f), readFileSync(`${f}.sig`, "utf8"), c.pubkey, v); }
  catch (e) { die(`개인키와 release.config.json의 pubkey가 짝이 아님: ${e.message}`); }
  rmSync(d, { recursive: true, force: true });
  console.log("  ✓ updater 키쌍 일치");
}
console.log(`  ✓ ${platform} ${v} (태그 ${tag}) 배포 가능`);
if (dryRun) { console.log("\n--dry-run: preflight만 수행하고 종료"); process.exit(0); }

// ───────── 2. 빌드 (명령 하나, 빌드 중 소스 브랜치 전환 금지 [사고 13]) ─────────
step(2, "빌드");
const triple = platform === "macos" ? "universal-apple-darwin" : null;
const bundleDir = join(src, "src-tauri", "target", ...(triple ? [triple] : []), "release", "bundle");
rmSync(bundleDir, { recursive: true, force: true }); // 옛 산출물이 섞여 올라가지 않게
const overlay = {
  bundle: { createUpdaterArtifacts: true, ...(platform === "windows" ? { windows: { signCommand: c.windowsSignCommand } } : {}) },
  plugins: {
    updater: {
      pubkey: c.pubkey,
      endpoints: [`${c.pagesBase}/${platform}/latest.json`], // 빌드 시점에 플랫폼별 고정 (§3.2). beta는 앱이 latest→beta로 바꿔 확인
      requireSignedVersion: true,
      windows: { installMode: "passive" },
    },
  },
};
const work = mkdtempSync(join(tmpdir(), `dynapse-${platform}-${v}-`));
const overlayPath = join(work, "release.conf.json");
writeJson(overlayPath, overlay);
const b = run("pnpm", ["tauri", "build", "--config", overlayPath, ...(triple ? ["--target", triple] : [])], { cwd: src, inherit: true, env: signEnv });
if (b.code !== 0) die(`빌드 실패 (exit ${b.code})`);
if (must("git", ["rev-parse", "HEAD"], { cwd: src }) !== srcHead) die("빌드 도중 소스 HEAD가 바뀜 — 산출물 폐기");
assertCleanTree(src, "빌드 후 소스 리포");

// ───────── 3. 산출물 검증 ─────────
step(3, "산출물 검증");
const one = (dir, suffix) => {
  const d = join(bundleDir, dir);
  const hits = existsSync(d) ? readdirSync(d).filter(f => f.endsWith(suffix)) : [];
  if (hits.length !== 1) die(`${d} 에서 *${suffix} 가 정확히 1개가 아님: [${hits.join(", ")}]`);
  return join(d, hits[0]);
};
const assets = [];
let updaterFile, installerName;
if (platform === "macos") {
  const app = one("macos", ".app");
  must("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
  must("spctl", ["-a", "-vv", "-t", "exec", app]);
  must("xcrun", ["stapler", "validate", app]);
  const ent = run("codesign", ["-d", "--entitlements", ":-", app]).out;
  if (/get-task-allow<\/key>\s*<true\/>/.test(ent)) die("릴리즈 번들에 디버그 entitlement(get-task-allow) — 실행 차단 사고 (§5.2)");
  const tgz = one("macos", ".app.tar.gz");
  updaterFile = `Dynapse_${v}_universal.app.tar.gz`;
  installerName = `Dynapse_${v}_universal.dmg`;
  // Tauri는 .app만 공증한다 — 첫 설치용 .dmg도 공증·staple해야 Gatekeeper가 막지 않는다 (0.1.0에서 실측: Unnotarized Developer ID → rejected)
  const dmg = one("dmg", ".dmg");
  must("xcrun", ["notarytool", "submit", dmg, "--key", process.env.APPLE_API_KEY_PATH, "--key-id", process.env.APPLE_API_KEY,
    "--issuer", process.env.APPLE_API_ISSUER, "--wait"], { inherit: true });
  must("xcrun", ["stapler", "staple", dmg]);
  must("xcrun", ["stapler", "validate", dmg]);
  const dmgCheck = run("spctl", ["-a", "-t", "open", "--context", "context:primary-signature", "-vv", dmg]);
  if (dmgCheck.code !== 0 || !/Notarized Developer ID/.test(dmgCheck.err + dmgCheck.out)) die(`dmg Gatekeeper 판정 실패:\n${dmgCheck.err || dmgCheck.out}`);
  assets.push([tgz, updaterFile], [`${tgz}.sig`, `${updaterFile}.sig`], [dmg, installerName]);
} else {
  const exe = one("nsis", "-setup.exe");
  must("signtool", ["verify", "/pa", exe], { shell: true });
  updaterFile = installerName = `Dynapse_${v}_x64-setup.exe`;
  assets.push([exe, updaterFile], [`${exe}.sig`, `${updaterFile}.sig`]);
}
const stage = join(work, "assets");
mkdirSync(stage, { recursive: true });
for (const [from, name] of assets) copyFileSync(from, join(stage, name));
const signature = readFileSync(join(stage, `${updaterFile}.sig`), "utf8").trim();
verifyArtifact(readFileSync(join(stage, updaterFile)), signature, c.pubkey, v);
console.log("  ✓ OS 서명 · updater 서명(버전 바인딩) 검증");
const localSha = Object.fromEntries(assets.map(([, n]) => [n, sha256File(join(stage, n))]));

// ───────── 4. Release 업로드 (prerelease로 — promote 때 해제) ─────────
step(4, `Release ${tag} 업로드`);
must("gh", ["release", "create", tag, "--repo", slug, "--title", `Dynapse ${platform} ${v}`, "--notes", notes, "--prerelease",
  ...assets.map(([, n]) => join(stage, n))]);

// ───────── 5. 업로드 검증: 전체 다운로드 + sha256 (매니페스트는 아직 안 건드림) ─────────
step(5, "업로드 검증");
const back = join(work, "download");
must("gh", ["release", "download", tag, "--repo", slug, "--dir", back]);
for (const [n, sha] of Object.entries(localSha)) {
  const p = join(back, n);
  if (!existsSync(p) || sha256File(p) !== sha) die(`${n}: 받은 파일 sha256 불일치 — 매니페스트 미발행. Release 자산을 확인하고 다시 올려라`);
  console.log(`  ✓ ${n} ${statSync(p).size} bytes sha256 일치`);
}

// ───────── 6. beta 발행 (자기 폴더만) ─────────
step(6, `${platform}/beta.json 발행`);
const url = `${assetBase(c, tag)}${updaterFile}`;
const manifest = {
  version: v, notes, pub_date: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  platforms: Object.fromEntries(P.keys.map(k => [k, { url, signature }])), // mac universal 하나로 두 키
};
const errs = manifestErrors(manifest, platform, c);
if (errs.length) die(`매니페스트 오류:\n  - ${errs.join("\n  - ")}`);
writeJson(join(ROOT, platform, "beta.json"), manifest);
gitCommitOnly([`${platform}/beta.json`], `${platform}: beta ${v}`);

// ───────── 7. 서빙 검증 ─────────
step(7, "서빙 검증 (최대 15분)");
let result = "beta-served-verified", note = notes;
try { await verifyServed(c, platform, "beta", v); }
catch (e) { result = "beta-SERVE-VERIFY-FAILED"; note = e.message; console.error(`  ⚠ ${e.message}`); }

// ───────── 10. 원장 ─────────
step(10, "RELEASES.md 기록");
writeFileSync(join(ROOT, "RELEASES.md"), `${readFileSync(join(ROOT, "RELEASES.md"), "utf8").trimEnd()}\n${ledgerLine({ platform, channel: "beta", version: v, tag, result, note })}\n`);
gitCommitOnly(["RELEASES.md"], `ledger: ${platform} beta ${v} ${result}`);
rmSync(work, { recursive: true, force: true });
// 빌드 산출물 .app이 dynapse:// 처리 앱으로 등록되면 웹 링크가 업데이트 없는 로컬 빌드를 연다 — 등록 해제(설치본만 남긴다)
if (platform === "macos") {
  const LS = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
  const bundles = [];
  const walk = (d, depth) => { if (depth > 6 || !existsSync(d)) return; for (const n of readdirSync(d)) { const f = join(d, n); if (n === "Dynapse.app") bundles.push(f); else if (statSync(f).isDirectory() && !n.endsWith(".app")) walk(f, depth + 1); } };
  walk(join(src, "src-tauri", "target"), 0);
  for (const b of bundles) { try { execFileSync(LS, ["-u", b]); } catch { /* 이미 없음 */ } }
  try { execFileSync(LS, ["-f", "/Applications/Dynapse.app"]); } catch { /* 설치본 없음 */ }
}

if (result !== "beta-served-verified") die("서빙 검증 실패 — promote 금지. 원장에 기록됨");
console.log(`\n✓ ${platform} ${v} beta 발행·서빙 검증 완료.
다음: [8] 대표 기기(beta 채널)가 실제 업데이트 경로로 받고 재실행 → Task 1건 E2E
      [9] node scripts/promote.mjs --platform ${platform}`);
