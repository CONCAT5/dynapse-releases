// Keep reasoning/code tools; constrain their filesystem, not the model's tool vocabulary.
export const CODEX_RESEARCH_TOOLS = ['web_search', 'shell', 'subagents', 'apply_patch', 'view_image'];
export function codexResearchPermissions() {
    return [
        '-c', 'default_permissions="dynapse_research"',
        '-c', 'permissions.dynapse_research.filesystem={":root"="deny",":minimal"="read",":workspace_roots"={"."="write"}}',
        '-c', 'permissions.dynapse_research.network.enabled=false',
        '-c', 'approval_policy="never"',
        '-c', 'features.shell_tool=true', '-c', 'features.unified_exec=true', '-c', 'features.multi_agent=true',
        '-c', 'agents.enabled=true',
        '-c', 'shell_environment_policy.inherit="none"',
        '-c', 'shell_environment_policy.include_only=["PATH","HOME","USER","LANG","TMPDIR"]',
    ];
}
