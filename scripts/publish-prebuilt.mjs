#!/usr/bin/env node
// 다른 PC에서 지은 설치본을 이 맥에서 서명·발행(#373 §4 — Windows 네이티브 후보): updater 키는 이 맥에만 있다(2026-11-03 대표 결정).
// Windows PC: 후보 브랜치에서 NSIS 설치본을 updater 서명 없이 짓고(createUpdaterArtifacts:false) 자가 점검 → 초안 Release(<tag>-build)에 설치본 + selfcheck-<v>.json + 소스 sha
// 이 맥: 초안에서 받아 sha256·자가 점검을 확인 → Windows updater 키로 서명(ota-copy와 같은 길) → 검증 → prerelease <tag> + windows/beta.json(승격 없음) → 서빙 확인 → 원장 → 초안 지움
//   node scripts/publish-prebuilt.mjs --platform windows --draft windows-v0.1.90-build --sha256 <설치본 sha256> --source <prototypes/desktop 경로> --notes "…"
// OS 코드 서명은 하지 않는다(release.config allowUnsigned — Windows 인증서 없음, 0.1.84~0.1.86과 같음). 비밀값은 출력하지 않는다
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ROOT, PLATFORMS, die, arg, run, must, loadConfig, readJsonIfExists, writeJson, cmpSemver, isSemver, manifestErrors, sha256File, assetBase, repoSlug, gitCommitOnly, assertCleanTree, ledgerLine, signingEnv, pubkeyOf } from "./lib/common.mjs";
import { verifyArtifact } from "./lib/minisign.mjs";
import { verifyServed } from "./lib/serve.mjs";

const platform = arg("platform"); if (platform !== "windows") die("--platform windows 만(맥 설치본은 publish.mjs로 이 맥에서 짓는다)");
const draft = arg("draft") || die("--draft <초안 Release 태그> 필요"), wantSha = String(arg("sha256") || die("--sha256 <설치본 sha256> 필요")).toLowerCase();
const notes = arg("notes") || die("--notes 필요");
const c = loadConfig(), P = PLATFORMS[platform], slug = repoSlug(c);
const src = resolve(arg("source", c.sourceDir ?? "") || die("--source <prototypes/desktop 경로> 필요(pnpm tauri signer를 여기서 부른다)"));
// 로컬 비밀값(.env) — ota-copy와 같은 규칙(값은 출력하지 않는다)
{ const localEnv = join(src, ".env");
  if (existsSync(localEnv)) {
    if (run("git", ["check-ignore", "-q", localEnv], { cwd: src }).code !== 0) die(`${localEnv}가 git에 무시되지 않음`);
    if (statSync(localEnv).mode & 0o077) die(`${localEnv} 권한이 너무 열려 있음 — chmod 600`);
    for (const line of readFileSync(localEnv, "utf8").split("\n")) { const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); } } }
if (!c.allowUnsigned) die("release.config allowUnsigned가 아님 — OS 코드 서명이 필요한 설정에선 이 길을 쓰지 않는다(Windows PC에서 publish.mjs)");
assertCleanTree(ROOT, "배포 리포"); must("git", ["pull", "--rebase"], { cwd: ROOT });

// 1 초안에서 받기 · sha256 · 자가 점검
console.log(`[1] 초안 ${draft} 받기`);
const work = mkdtempSync(join(tmpdir(), `dynapse-prebuilt-${platform}-`)), dl = join(work, "draft"); mkdirSync(dl);
must("gh", ["release", "download", draft, "--repo", slug, "--dir", dl]);
const exes = readdirSync(dl).filter(n => /-setup\.exe$/.test(n)); if (exes.length !== 1) die(`초안에 설치본(*-setup.exe)이 하나가 아님: ${exes.join(", ") || "없음"}`);
const exe = join(dl, exes[0]), got = sha256File(exe); if (got !== wantSha) die(`설치본 sha256 ${got} ≠ --sha256 ${wantSha} — Windows 쪽 값을 다시 확인`);
const v = exes[0].match(/_(\d+\.\d+\.\d+)_/)?.[1] ?? die(`설치본 이름에서 버전을 못 읽음: ${exes[0]}`); if (!isSemver(v)) die(`버전이 SemVer가 아님: ${v}`);
const scF = readdirSync(dl).find(n => n === `selfcheck-${v}.json`) ?? die(`초안에 selfcheck-${v}.json 없음 — Windows에서 자가 점검을 먼저`);
const scJ = JSON.parse(readFileSync(join(dl, scF), "utf8"));
if (scJ.version !== v) die(`자가 점검 버전 ${scJ.version} ≠ ${v}`); if (scJ.pass !== scJ.total) die(`자가 점검 ${scJ.pass}/${scJ.total} — 발행하지 않음`);
const srcRef = (must("gh", ["release", "view", draft, "--repo", slug, "--json", "body", "--jq", ".body"]).match(/src ([0-9a-f]{7,40})/) ?? [])[1] ?? "?";
console.log(`  ✓ ${exes[0]} sha256 일치 · 자가 점검 ${scJ.pass}/${scJ.total} · src ${srcRef}`);
const tag = `${P.tagPrefix}${v}`;
if (run("gh", ["api", `repos/${slug}/git/refs/tags/${tag}`]).code === 0) die(`태그 ${tag} 이미 있음 — 한 번 쓴 버전은 다시 쓰지 않는다`);
const stable = readJsonIfExists(join(ROOT, platform, "latest.json")); if (stable && cmpSemver(v, stable.version) <= 0) die(`새 버전 ${v} ≤ ${platform} stable ${stable.version}`);

// 2 updater 서명(이 맥의 Windows 키) · 검증
console.log("[2] updater 서명(Windows 키)");
const updaterFile = `Dynapse_${v}_x64-setup.exe`, stage = join(work, "assets"); mkdirSync(stage); copyFileSync(exe, join(stage, updaterFile));
const sg = run("pnpm", ["tauri", "signer", "sign", "--app-version", v, join(stage, updaterFile)], { cwd: src, env: { ...process.env, ...(await signingEnv(platform)) } });
if (sg.code !== 0 || !existsSync(join(stage, `${updaterFile}.sig`))) die(`서명 실패\n${(sg.err || sg.out || "").slice(-400)}`);
const signature = readFileSync(join(stage, `${updaterFile}.sig`), "utf8").trim();
verifyArtifact(readFileSync(join(stage, updaterFile)), signature, pubkeyOf(c, platform), v);
console.log(`  ✓ 서명·검증 ${v} (windows pubkey) · OS 서명 없음(allowUnsigned)`);

// 3 prerelease 업로드 · 다시 받아 sha256
console.log(`[3] Release ${tag} 업로드`);
const assets = [updaterFile, `${updaterFile}.sig`], localSha = Object.fromEntries(assets.map(n => [n, sha256File(join(stage, n))]));
must("gh", ["release", "create", tag, "--repo", slug, "--title", `Dynapse ${platform} ${v}`, "--notes", notes, "--prerelease", ...assets.map(n => join(stage, n))]);
const back = join(work, "download"); must("gh", ["release", "download", tag, "--repo", slug, "--dir", back]);
for (const [n, sha] of Object.entries(localSha)) { if (sha256File(join(back, n)) !== sha) die(`${n}: 받은 파일 sha256 불일치 — beta.json 미발행`); console.log(`  ✓ ${n} sha256 일치`); }

// 4 beta.json(승격 없음) · 서빙 확인 · 원장
console.log(`[4] ${platform}/beta.json 발행`);
const manifest = { version: v, notes, pub_date: new Date().toISOString().replace(/\.\d+Z$/, "Z"), platforms: Object.fromEntries(P.keys.map(k => [k, { url: `${assetBase(c, tag)}${updaterFile}`, signature }])) };
const errs = manifestErrors(manifest, platform, c); if (errs.length) die(`매니페스트 오류:\n  - ${errs.join("\n  - ")}`);
writeJson(join(ROOT, platform, "beta.json"), manifest); writeJson(join(ROOT, platform, `selfcheck-${v}.json`), scJ);
gitCommitOnly([`${platform}/beta.json`, `${platform}/selfcheck-${v}.json`], `${platform}: beta ${v} (built on the Windows PC, signed on this Mac) · 자가 점검 ${scJ.pass}/${scJ.total}`);
let result = "beta-served-verified", note = `unsigned · Windows PC 빌드 · 맥 서명 · ${notes}`;
try { await verifyServed(c, platform, "beta", v); } catch (e) { result = "beta-SERVE-VERIFY-FAILED"; note = `unsigned · ${e.message}`; console.error(`  ⚠ ${e.message}`); }
writeFileSync(join(ROOT, "RELEASES.md"), `${readFileSync(join(ROOT, "RELEASES.md"), "utf8").trimEnd()}\n${ledgerLine({ platform, channel: "beta", version: v, tag, result, note: `src ${srcRef} · ${note}` })}\n`);
gitCommitOnly(["RELEASES.md"], `ledger: ${platform} beta ${v} ${result}`);
must("gh", ["release", "delete", draft, "--repo", slug, "--yes"]); rmSync(work, { recursive: true, force: true });
console.log(`\n${result === "beta-served-verified" ? "✓" : "⚠"} ${platform} ${v} beta ${result} — 승격(latest.json)은 promote.mjs로, 대표 확인 뒤`);
