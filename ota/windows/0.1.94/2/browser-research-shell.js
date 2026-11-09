// Public research scratch space only. Native browser/MCP credentials stay outside it.
// Claude Code >=2.1.300: strict sandbox, no unsandboxed retry, no inherited project hooks.
export function researchShellArgs(os, version, cwd) {
    const v = version.match(/\b(\d+)\.(\d+)\.(\d+)\b/);
    if (os !== "macos" || !v || Number(v[1]) !== 2 || Number(v[2]) !== 1 || Number(v[3]) < 300)
        return [];
    if (!/^\//.test(cwd) || !/\/\.dynapse\/out\/browser\/runs\/[^/]+\/cwd$/.test(cwd) || cwd.includes(".."))
        return [];
    return ["--setting-sources", "", "--settings", JSON.stringify({
            permissions: { blockReadsOutsideWorkingDirectories: true },
            sandbox: {
                enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false,
                autoAllowBashIfSandboxed: true, excludedCommands: [],
                filesystem: { disabled: false, allowRead: [cwd], allowWrite: [cwd], denyRead: ["~/.claude", "~/.codex", "~/.ssh", "~/.aws"], denyWrite: [] },
                network: { strictAllowlist: true, allowedDomains: [], allowAllUnixSockets: false, allowUnixSockets: [], allowLocalBinding: false },
                credentials: { envVars: [] },
            },
        })];
}
