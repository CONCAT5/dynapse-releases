// 배포 계정(#80) — GitHub·Vercel을 이 PC에 묶는다. 공식 CLI(gh·vercel)로 설치·로그인만 확인한다(배포 명령은 아직 없음).
// 자격증명은 CLI가 자기 자리에 둔다 — 앱은 읽지 않고(DENY), 계정 이름은 앞 2자 + ***로만. 허브에는 연결 여부·확인 시각·가린 이름
import { exec } from "./main.js";
import { diagAuto } from "./diag.js";
export const G = {
    github: { installed: false, loggedIn: null, account: null, at: null, checked: 0 },
    vercel: { installed: false, loggedIn: null, account: null, at: null, checked: 0 },
};
const PROG = { github: "gh", vercel: "vercel" };
export const GIT_INSTALL_URL = { github: "https://cli.github.com/", vercel: "https://vercel.com/docs/cli" };
const mask = (s) => (s ? `${s.slice(0, 2)}***` : null);
// 그 PC에서 자격이 실제로 쓰이는지 — gh auth status(토큰 확인까지 한다) exit 0 · vercel whoami exit 0. 성공하면 확인 시각
export async function detectGit(id) {
    const g = G[id], prog = PROG[id];
    const v = await exec(prog, ["--version"]).catch(() => null);
    g.installed = !!v && v.code === 0;
    if (!g.installed) {
        g.loggedIn = null;
        g.account = null;
        g.checked = Date.now();
        return g;
    }
    const r = await exec(prog, id === "github" ? ["auth", "status", "--hostname", "github.com"] : ["whoami"]).catch(() => null);
    const out = `${r?.stdout ?? ""}\n${r?.stderr ?? ""}`;
    g.loggedIn = !!r && r.code === 0;
    // 실측(gh 2.x): "Logged in to github.com account <name> (keyring)" · 옛 형식 "as <name>" / vercel whoami: 마지막 줄 = 사용자 이름
    const name = id === "github" ? out.match(/Logged in to github\.com (?:account|as) ([A-Za-z0-9-]+)/)?.[1] : (r?.stdout ?? "").trim().split("\n").filter(l => /^[\w.-]+$/.test(l.trim())).pop()?.trim();
    g.account = g.loggedIn ? mask(name) : null;
    if (g.loggedIn)
        g.at = Date.now();
    else if (r && r.code !== 0 && !/not logged|no credentials|log in|login/i.test(out))
        void diagAuto({ tool: prog, stage: "login", code: `status_exit:${r.code}`, log: out }); // 로그인 안 된 것이 아니라 CLI가 이상한 경우만
    g.checked = Date.now();
    return g;
}
export async function detectAllGit(force = false) {
    for (const id of ["github", "vercel"])
        if (force || Date.now() - G[id].checked > 5 * 60_000)
            await detectGit(id);
}
export const gitBody = () => Object.fromEntries(["github", "vercel"].map(id => [id, { installed: G[id].installed, connected: G[id].loggedIn, account: G[id].account, at: G[id].at }]));
