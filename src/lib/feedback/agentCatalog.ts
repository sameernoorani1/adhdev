// Shared catalog of recognised coding-agent CLIs. Used by the onboarding
// wizard's Step 2 and the persistent terminal-header launcher. Single source
// of truth for run commands, variants, and install support.

export interface AgentVariant {
    id: string;
    label: string;
    flags: string;
    help: string;
}

export interface AgentDef {
    id: string;
    label: string;
    runCommand: string;
    installSupported: boolean;
    installHint: string;
    variants: AgentVariant[];
    defaultVariantId: string;
}

export const RECOGNISED_CLIS: AgentDef[] = [
    {
        id: 'Claude Code', label: 'Claude Code', runCommand: 'claude',
        installSupported: true, installHint: 'npm i -g @anthropic-ai/claude-code',
        variants: [
            { id: 'standard', label: 'Standard',         flags: '',                                  help: 'Asks for permission before each edit / shell run.' },
            { id: 'yolo',     label: 'Skip permissions', flags: '--dangerously-skip-permissions',    help: 'No permission prompts. Faster, riskier; use in a sandbox or disposable repo.' },
            { id: 'custom',   label: 'Custom flags',     flags: '',                                  help: 'Paste your own flags below, e.g. `--model opus-4` or `--continue`.' },
        ],
        defaultVariantId: 'yolo',
    },
    {
        id: 'Codex', label: 'Codex', runCommand: 'codex',
        installSupported: true, installHint: 'npm i -g @openai/codex@latest',
        variants: [
            { id: 'standard',  label: 'Standard',       flags: '',                                                       help: 'Default Codex CLI behavior.' },
            { id: 'auto-edit', label: 'Workspace auto', flags: '--sandbox workspace-write --ask-for-approval on-request', help: 'Allows workspace edits and asks before riskier actions.' },
            { id: 'full-auto', label: 'Full access',    flags: '--dangerously-bypass-approvals-and-sandbox',            help: 'No approvals or sandbox. Use only in trusted repos.' },
            { id: 'custom',    label: 'Custom flags',   flags: '',                                                       help: 'Paste your own flags below.' },
        ],
        defaultVariantId: 'auto-edit',
    },
    {
        id: 'Gemini CLI', label: 'Gemini CLI', runCommand: 'gemini',
        installSupported: true, installHint: 'npm i -g @google/gemini-cli',
        variants: [
            { id: 'standard', label: 'Standard',     flags: '', help: 'Default Gemini CLI behaviour.' },
            { id: 'custom',   label: 'Custom flags', flags: '', help: 'Paste your own flags below, e.g. `--model gemini-1.5-pro`.' },
        ],
        defaultVariantId: 'standard',
    },
    {
        id: 'Aider', label: 'Aider', runCommand: 'aider',
        installSupported: true, installHint: 'pip install aider-chat',
        variants: [
            { id: 'standard',   label: 'Standard',     flags: '',             help: 'Confirms each commit / shell run.' },
            { id: 'yes-always', label: 'Auto-confirm', flags: '--yes-always', help: 'Yes to all confirmations. Faster, riskier.' },
            { id: 'custom',     label: 'Custom flags', flags: '',             help: 'Paste your own flags below.' },
        ],
        defaultVariantId: 'yes-always',
    },
    {
        id: 'Cursor Agent', label: 'Cursor Agent', runCommand: 'cursor-agent',
        installSupported: false, installHint: 'Install Cursor (cursor.sh); ships with cursor-agent.',
        variants: [
            { id: 'standard', label: 'Standard',     flags: '', help: 'Default cursor-agent behaviour.' },
            { id: 'custom',   label: 'Custom flags', flags: '', help: 'Paste your own flags below.' },
        ],
        defaultVariantId: 'standard',
    },
    {
        id: 'Continue', label: 'Continue', runCommand: 'continue',
        installSupported: false, installHint: 'Install via continue.dev/install; editor extension, not a global CLI.',
        variants: [
            { id: 'standard', label: 'Standard',     flags: '', help: 'Default Continue behaviour.' },
            { id: 'custom',   label: 'Custom flags', flags: '', help: 'Paste your own flags below.' },
        ],
        defaultVariantId: 'standard',
    },
];

export function getAgentDef(agentId: string): AgentDef | undefined {
    return RECOGNISED_CLIS.find(a => a.id === agentId);
}

export function buildLaunchCommand(agentId: string, variantId: string, customFlags?: string): string | null {
    const def = getAgentDef(agentId);
    if (!def) return null;
    const variant = def.variants.find(v => v.id === variantId);
    if (!variant) return null;
    const flags = variant.id === 'custom' ? (customFlags || '').trim() : variant.flags;
    return flags ? `${def.runCommand} ${flags}` : def.runCommand;
}
