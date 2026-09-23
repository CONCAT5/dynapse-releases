// 배포 스크립트 공용 — 규칙은 docs/11-desktop-release-policy.md. 외부 의존성 없음(Node 20+).
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// 플랫폼 = 폴더 = 태그 접두사 = 매니페스트 키. 서로 절대 섞이지 않는다 (§0-2, §1.1)
export const PLATFORMS = {
  macos: { tagPrefix: "macos-v", keys: ["darwin-aarch64", "darwin-x86_64"], host: "darwin" },
  windows: { tagPrefix: "windows-v", keys: ["windows-x86_64"], host: "win32" },
};
export const MANIFEST_FIELDS = ["version", "notes", "pub_date", "platforms"];

export function die(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

export function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
}

export function platformArg() {
  const p = arg("platform");
  if (!PLATFORMS[p]) die(`--platform macos|windows 필요 (받은 값: ${p ?? "없음"})`);
  return p;
}

// 명령 실행 — 성공 판정은 exit code로만 (stderr 출력은 실패가 아니다, §4 [사고 7])
export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", stdio: opts.inherit ? "inherit" : "pipe", ...opts });
  if (r.error) throw r.error;
  return { code: r.status, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}
export function must(cmd, args, opts = {}) {
  const r = run(cmd, args, opts);
  if (r.code !== 0) die(`${cmd} ${args.join(" ")} 실패 (exit ${r.code})\n${r.err || r.out}`);
  return r.out;
}

// ── SemVer (빌드번호 없음, prerelease는 비교만 지원) ──
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
export const isSemver = (v) => typeof v === "string" && SEMVER.test(v);
export function cmpSemver(a, b) {
  const [, a1, a2, a3, ap] = a.match(SEMVER), [, b1, b2, b3, bp] = b.match(SEMVER);
  for (const [x, y] of [[a1, b1], [a2, b2], [a3, b3]]) if (+x !== +y) return +x < +y ? -1 : 1;
  if (ap === bp) return 0;
  if (!ap) return 1;
  if (!bp) return -1;
  return ap < bp ? -1 : 1;
}

// ── JSON: BOM 없는 UTF-8만 읽고 쓴다 (§2 [사고 11]) ──
export function readJson(path) {
  const buf = readFileSync(path);
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) throw new Error(`${path}: UTF-8 BOM 있음`);
  return JSON.parse(buf.toString("utf8"));
}
export const readJsonIfExists = (path) => (existsSync(path) ? readJson(path) : null);
export function writeJson(path, obj) {
  writeFileSync(path, Buffer.from(JSON.stringify(obj, null, 2) + "\n", "utf8")); // Buffer = BOM 없음 보장
}

export const sha256File = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

// ── 배포 설정 (피드 URL 동결 전에는 publish/promote가 돌지 않는다, §0-1) ──
export function loadConfig({ requireFrozen = true } = {}) {
  const c = readJson(join(ROOT, "release.config.json"));
  if (requireFrozen) {
    const missing = ["owner", "repo", "pagesBase", "pubkey"].filter(k => !c[k]);
    const why = {
      owner: "배포 리포 org", repo: "배포 리포 이름", pagesBase: "피드 URL — 앱에 박혀 나간다(원칙 1)",
      pubkey: "updater 공개키 — `pnpm tauri signer generate`로 키를 만든 뒤 .pub 내용 (§5.1)",
    };
    if (missing.length) die(`release.config.json 미확정:\n  - ${missing.map(k => `${k}: ${why[k]}`).join("\n  - ")}`);
    if (!/^https:\/\//.test(c.pagesBase) || c.pagesBase.endsWith("/")) die("pagesBase는 https:// 로 시작하고 / 로 끝나지 않아야 한다");
  }
  return c;
}
export const feedUrl = (c, platform, channel) => `${c.pagesBase}/${platform}/${channel}.json`;
export const repoSlug = (c) => `${c.owner}/${c.repo}`;
export const assetBase = (c, tag) => `https://github.com/${repoSlug(c)}/releases/download/${tag}/`;

// ── 매니페스트 검사 — CI(validate)와 publish가 같은 함수를 쓴다 (§2, §6) ──
export function manifestErrors(m, platform, c) {
  const e = [];
  const P = PLATFORMS[platform];
  if (!m || typeof m !== "object") return ["매니페스트가 객체가 아님"];
  const extra = Object.keys(m).filter(k => !MANIFEST_FIELDS.includes(k));
  if (extra.length) e.push(`Tauri가 읽지 않는 필드: ${extra.join(", ")} (download.json으로 분리)`);
  if (!isSemver(m.version)) e.push(`version이 SemVer가 아님: ${m.version}`);
  if (typeof m.pub_date !== "string" || Number.isNaN(Date.parse(m.pub_date)) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(m.pub_date))
    e.push(`pub_date가 RFC 3339가 아님: ${m.pub_date}`);
  const keys = Object.keys(m.platforms ?? {});
  const foreign = keys.filter(k => !P.keys.includes(k));
  if (foreign.length) e.push(`${platform}/ 에 다른 플랫폼 키: ${foreign.join(", ")}`);
  const absent = P.keys.filter(k => !keys.includes(k));
  if (absent.length) e.push(`빠진 키: ${absent.join(", ")} — 그 아키텍처 유저는 업데이트 확인이 에러가 된다`);
  const tag = `${P.tagPrefix}${m.version}`;
  for (const k of keys.filter(k => P.keys.includes(k))) {
    const p = m.platforms[k] ?? {};
    if (typeof p.signature !== "string" || !p.signature.trim()) e.push(`${k}.signature 비어 있음`);
    else if (/^https?:|\.sig$/.test(p.signature.trim())) e.push(`${k}.signature가 경로/URL임 — .sig 파일 내용이어야 함`);
    if (typeof p.url !== "string") { e.push(`${k}.url 없음`); continue; }
    const want = c?.owner ? assetBase(c, tag) : null;
    if (want && !p.url.startsWith(want)) e.push(`${k}.url이 ${want} 아래가 아님: ${p.url}`);
    if (!p.url.includes(`/releases/download/${tag}/`)) e.push(`${k}.url의 태그가 ${tag}가 아님: ${p.url}`);
  }
  return e;
}

export function downloadErrors(d, platform, c) {
  const e = [];
  if (!d || typeof d !== "object") return ["download.json이 객체가 아님"];
  if (!isSemver(d.version)) e.push(`version이 SemVer가 아님: ${d.version}`);
  if (typeof d.url !== "string" || !d.url.includes(`/releases/download/${PLATFORMS[platform].tagPrefix}${d.version}/`))
    e.push(`url이 ${PLATFORMS[platform].tagPrefix}${d.version} Release가 아님: ${d.url}`);
  if (c?.owner && typeof d.url === "string" && !d.url.startsWith(assetBase(c, `${PLATFORMS[platform].tagPrefix}${d.version}`)))
    e.push("url이 이 배포 리포 Release가 아님");
  if (!/^[0-9a-f]{64}$/.test(d.sha256 ?? "")) e.push("sha256 형식 오류");
  if (!Number.isInteger(d.size) || d.size <= 0) e.push("size 오류");
  return e;
}

// ── 원장 (§4-10) ──
export function ledgerLine({ platform, channel, version, tag, result, note = "" }) {
  return `| ${new Date().toISOString()} | ${platform} | ${channel} | ${version} | ${tag} | ${result} | ${note.replace(/\|/g, "/")} |`;
}

// ── git: 자기 폴더만 커밋, pull --rebase 후 push, force-push 없음 (§4) ──
export function gitCommitOnly(paths, message) {
  const r = (a) => must("git", a, { cwd: ROOT });
  r(["add", "--", ...paths]);
  const staged = r(["diff", "--cached", "--name-only"]).split("\n").filter(Boolean);
  const outside = staged.filter(f => !paths.some(p => f === p || f.startsWith(p.endsWith("/") ? p : `${p}/`)));
  if (outside.length) die(`허용 경로 밖 파일이 스테이지됨: ${outside.join(", ")}`);
  if (!staged.length) die("커밋할 변경 없음");
  r(["commit", "-m", message]);
  r(["pull", "--rebase"]);
  r(["push"]);
}

export function assertCleanTree(cwd, label) {
  const s = must("git", ["status", "--porcelain"], { cwd });
  if (s) die(`${label} 워킹트리가 clean이 아님:\n${s}`);
}

export async function sleep(ms) { await new Promise(r => setTimeout(r, ms)); }

// ── updater 서명 키 (docs/11 §5.1, 2026-09-23 결정): 키 파일은 대표 Mac에, 비밀번호는 배포 때 대표가 직접 입력 ──
// 비밀번호: 소스 폴더의 로컬 .env(git 무시·600)에 있으면 그 값, 없으면 가려서 입력받는다. 서명하는 자식 프로세스(env)에만 넘긴다.
export const DEFAULT_KEY_PATH = join(process.env.HOME ?? process.env.USERPROFILE ?? "", ".tauri", "dynapse-updater.key");

export async function askHidden(prompt) {
  if (!process.stdin.isTTY) die("비밀번호는 터미널에서 직접 입력해야 한다 (stdin이 터미널이 아님)");
  process.stdout.write(prompt);
  const stdin = process.stdin;
  stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
  return new Promise((resolve) => {
    let s = "";
    const on = (chunk) => {
      for (const c of chunk) {
        if (c === "\r" || c === "\n") {
          stdin.setRawMode(false); stdin.pause(); stdin.off("data", on); process.stdout.write("\n");
          return resolve(s);
        }
        if (c === "\u0003") { process.stdout.write("\n"); process.exit(130); } // Ctrl+C
        if (c === "\u007f" || c === "\b") { s = s.slice(0, -1); continue; }
        s += c;
      }
    };
    stdin.on("data", on);
  });
}

export async function signingEnv() {
  const path = process.env.TAURI_SIGNING_PRIVATE_KEY_PATH || DEFAULT_KEY_PATH;
  if (!existsSync(path)) die(`updater 개인키 없음: ${path} — pnpm tauri signer generate -w ${DEFAULT_KEY_PATH}`);
  if (process.platform !== "win32" && (statSync(path).mode & 0o077)) die(`개인키 권한이 너무 열려 있음 — chmod 600 ${path}`);
  const key = readFileSync(path, "utf8").trim();
  const password = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || await askHidden("updater 키 비밀번호: "); // 로컬 .env에 있으면 묻지 않는다
  if (!password) die("비밀번호가 비어 있음");
  return { TAURI_SIGNING_PRIVATE_KEY: key, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password };
}
