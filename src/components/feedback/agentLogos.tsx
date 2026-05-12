// Brand-recognisable mono-glyph SVGs for the agent launcher menu. Mono-color
// (currentColor) so they pick up the theme. Designed at 16x16 viewBox for
// 14px / 16px render sizes.
//
// These are deliberately simplified marks — not the official brand assets —
// so they read at small sizes and don't carry licensing baggage.

import type { ReactNode } from 'react';

interface IconProps { className?: string }

function ClaudeIcon({ className = 'w-4 h-4' }: IconProps): ReactNode {
    // Anthropic / Claude — stylized starburst
    return (
        <svg className={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 1.5l1.4 4 4 1.4-4 1.4-1.4 4-1.4-4-4-1.4 4-1.4 1.4-4z" opacity="0.95" />
            <circle cx="13.2" cy="13.2" r="1.6" opacity="0.7" />
        </svg>
    );
}

function CodexIcon({ className = 'w-4 h-4' }: IconProps): ReactNode {
    // OpenAI / Codex — knot-like hex
    return (
        <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
            <circle cx="8" cy="8" r="6" />
            <path d="M5 5.5 L8 8 L11 5.5 M5 10.5 L8 8 L11 10.5" strokeLinecap="round" />
        </svg>
    );
}

function GeminiIcon({ className = 'w-4 h-4' }: IconProps): ReactNode {
    // Google Gemini — 4-point sparkle
    return (
        <svg className={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 1 C8 4 9 7 14 8 C9 9 8 12 8 15 C8 12 7 9 2 8 C7 7 8 4 8 1z" />
        </svg>
    );
}

function AiderIcon({ className = 'w-4 h-4' }: IconProps): ReactNode {
    // Aider — terminal + > prompt
    return (
        <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
            <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
            <path d="M4.5 6.5 L7 8.5 L4.5 10.5 M9 10.5 L11.5 10.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function CursorIcon({ className = 'w-4 h-4' }: IconProps): ReactNode {
    // Cursor — angled triangular cursor mark
    return (
        <svg className={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M3 2 L13 8 L8.5 8.8 L7.5 13 z" />
        </svg>
    );
}

function ContinueIcon({ className = 'w-4 h-4' }: IconProps): ReactNode {
    // Continue — chevron-forward stack
    return (
        <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M3 4 L7 8 L3 12 M8 4 L12 8 L8 12" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

export function agentIcon(agentId: string, className?: string): ReactNode {
    switch (agentId) {
        case 'Claude Code':  return <ClaudeIcon className={className} />;
        case 'Codex':        return <CodexIcon className={className} />;
        case 'Gemini CLI':   return <GeminiIcon className={className} />;
        case 'Aider':        return <AiderIcon className={className} />;
        case 'Cursor Agent': return <CursorIcon className={className} />;
        case 'Continue':     return <ContinueIcon className={className} />;
        default:             return null;
    }
}
