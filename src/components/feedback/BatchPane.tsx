'use client';

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Ticket } from './TicketCard';

export interface Batch {
    id: string;
    name: string;
    ticketIds: string[];
    createdAt: string;
    source: 'manual' | 'ai';
    reviewState?: 'suggested' | 'accepted';
    rationale?: string;         // AI-generated reason for grouping
}

interface BatchPaneProps {
    batches: Batch[];
    tickets: Ticket[];
    onClose: () => void;
    onRemoveBatch: (id: string) => void | Promise<void>;
    onRemoveTicket: (batchId: string, ticketId: string) => void;
    onAddTicket: (batchId: string, ticketId: string) => void;
    onReorderBatches: (from: number, to: number) => void;
    onClearAll: () => void | Promise<void>;
    onRenameBatch: (id: string, name: string) => void;
    onUpdateBatch: (id: string, updates: Partial<Batch>) => void | Promise<void>;
    onCopyBatch: (batch: Batch, index: number, total: number) => void;
    onOpenTicket: (ticket: Ticket) => void;
    onOpenTerminal: () => void;
    onToast: (msg: string, duration?: number) => void;
    isMobile: boolean;
    // AD-189: Plan Batches button moved off the topbar into this pane.
    // Pane fires the handler; FeedbackBoard owns the actual /api/plan-batches call.
    onPlanBatches?: (mode: 'full' | 'incremental', ticketIds?: string[]) => void | Promise<void>;
    selectedTicketIds?: string[];
}

const PRIORITY_COLORS: Record<string, string> = {
    critical: 'text-red-400',
    high: 'text-orange-400',
    medium: 'text-yellow-400',
    low: 'text-blue-400',
};

const DONE_STATUSES = ['done', 'reviewed', 'observe', 'deferred'];

// Batch Run Button Component
function BatchRunButton({
    validTickets,
    onOpenTerminal,
    onToast,
}: {
    validTickets: any[];
    onOpenTerminal: () => void;
    onToast: (msg: string, duration?: number) => void;
}) {
    const [showDropdown, setShowDropdown] = useState(false);
    const [isRunning, setIsRunning] = useState(false);

    const runBatch = async (_target?: 'sdk' | 'terminal', _execution: 'sequential' | 'parallel' = 'sequential') => {
        setIsRunning(true);
        setShowDropdown(false);
        onOpenTerminal();

        try {
            const ticketIds = validTickets.map(t => t.id);
            const res = await fetch('/api/run-batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ticketIds }),
            });

            const data = await res.json();
            if (data.success) {
                onToast(data.message || `Sent ${ticketIds.length} ticket(s) to coding agent.`, 3000);
            } else {
                onToast(data.message || 'Start your coding agent, then run again.', 5000);
            }
        } catch {
            onToast('Failed to send prompt to coding agent.', 4000);
        } finally {
            setIsRunning(false);
        }
    };

    if (validTickets.length === 0) return null;

    return (
        <div className="relative">
            <button
                onClick={() => setShowDropdown(!showDropdown)}
                disabled={isRunning}
                className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors font-medium disabled:opacity-50"
                title="Run batch"
            >
                {isRunning ? '⏳ Running' : '▶ Run Batch'}
            </button>

            {showDropdown && (
                <div className="absolute right-0 top-full mt-1 bg-vd-bg-secondary border border-vd-border rounded-lg shadow-panel z-20 py-1 min-w-[160px]">
                    <div className="px-3 py-1.5 text-[10px] text-vd-text-tertiary border-b border-vd-border">
                        {validTickets.length} tickets
                    </div>
                    <button
                        onClick={() => runBatch('sdk', 'sequential')}
                        disabled={isRunning}
                        className="w-full text-left px-3 py-2 text-[10px] hover:bg-vd-bg-tertiary text-vd-text-secondary disabled:opacity-50"
                    >
                        <span className="text-vd-accent-gold">▶</span> SDK Sequential
                        <div className="text-[9px] text-vd-text-tertiary mt-0.5">One by one with Claude Code</div>
                    </button>
                    <button
                        onClick={() => runBatch('terminal', 'sequential')}
                        disabled={isRunning}
                        className="w-full text-left px-3 py-2 text-[10px] hover:bg-vd-bg-tertiary text-vd-text-secondary disabled:opacity-50"
                    >
                        <span className="text-blue-400">⚡</span> Terminal Sequential
                        <div className="text-[9px] text-vd-text-tertiary mt-0.5">One by one in terminal</div>
                    </button>
                    <button
                        onClick={() => runBatch('terminal', 'parallel')}
                        disabled={isRunning}
                        className="w-full text-left px-3 py-2 text-[10px] hover:bg-vd-bg-tertiary text-vd-text-secondary disabled:opacity-50"
                    >
                        <span className="text-purple-400">⚡</span> Terminal Parallel
                        <div className="text-[9px] text-vd-text-tertiary mt-0.5">All tickets at once</div>
                    </button>
                </div>
            )}

            {showDropdown && (
                <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowDropdown(false)}
                />
            )}
        </div>
    );
}

// ─── Keyword Extraction ──────────────────────────────────────────────
// Extracts technical keywords from ticket content: file paths, component names,
// CSS classes, function names, technical terms. NO reliance on human-applied tags.

// Common stop words that add no signal
const STOP_WORDS = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'need', 'must', 'to', 'of',
    'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about',
    'that', 'this', 'it', 'its', 'not', 'but', 'and', 'or', 'if', 'when',
    'than', 'too', 'very', 'just', 'also', 'then', 'so', 'no', 'yes',
    'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some',
    'such', 'only', 'same', 'how', 'what', 'which', 'who', 'where', 'why',
    'up', 'out', 'off', 'over', 'under', 'again', 'there', 'here', 'once',
    'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'they', 'them',
    // Common ticket noise words
    'fix', 'bug', 'issue', 'ticket', 'please', 'broken', 'doesn', 'works',
    'working', 'work', 'make', 'change', 'update', 'add', 'remove', 'new',
    'still', 'see', 'look', 'like', 'get', 'got', 'don', 'want', 'think',
    'show', 'showing', 'shows', 'after', 'before', 'now', 'currently', 'seems',
]);

function extractKeywords(text: string): Set<string> {
    const keywords = new Set<string>();
    if (!text) return keywords;

    // 1. File paths (e.g., src/components/feedback/BatchPane.tsx, ./lib/utils.ts)
    const filePaths = text.match(/(?:[\w./\\-]+\/)+[\w.-]+\.\w{1,5}/g) || [];
    for (const fp of filePaths) {
        // Add full path
        keywords.add(fp.toLowerCase());
        // Add filename without extension
        const filename = fp.split(/[/\\]/).pop()?.replace(/\.\w+$/, '');
        if (filename && filename.length > 2) keywords.add(filename.toLowerCase());
        // Add directory names (components, lib, etc.)
        const parts = fp.split(/[/\\]/);
        for (const part of parts) {
            if (part.length > 2 && !part.includes('.')) keywords.add(part.toLowerCase());
        }
    }

    // 2. PascalCase / camelCase identifiers (component names, function names)
    const identifiers = text.match(/[A-Z][a-zA-Z0-9]{2,}/g) || [];
    for (const id of identifiers) {
        keywords.add(id.toLowerCase());
        // Split PascalCase into parts: "BatchPane" → ["batch", "pane"]
        const parts = id.replace(/([A-Z])/g, ' $1').trim().split(/\s+/);
        for (const p of parts) {
            if (p.length > 2) keywords.add(p.toLowerCase());
        }
    }

    // 3. CSS-like selectors and class names (e.g., .vd-accent-gold, bg-red-500)
    const cssClasses = text.match(/(?:bg|text|border|rounded|flex|grid|px|py|mt|mb|ml|mr)-[\w-]+/g) || [];
    for (const cls of cssClasses) {
        keywords.add(cls.toLowerCase());
    }

    // 4. Technical terms — split on word boundaries, filter stop words
    const words = text.toLowerCase().replace(/[^a-z0-9_.-]/g, ' ').split(/\s+/);
    for (const word of words) {
        if (word.length > 2 && !STOP_WORDS.has(word) && !/^\d+$/.test(word)) {
            keywords.add(word);
        }
    }

    // 5. Quoted strings or backtick code references
    const codeRefs = text.match(/`([^`]+)`/g) || [];
    for (const ref of codeRefs) {
        const clean = ref.replace(/`/g, '').trim().toLowerCase();
        if (clean.length > 1) keywords.add(clean);
    }

    return keywords;
}

/** Get all text content from a ticket (title + description + comment content) */
function getTicketText(ticket: Ticket): string {
    const commentTexts = (ticket.comments as Array<{ content?: string }>)
        .map(c => c.content || '')
        .join(' ');
    return `${ticket.title} ${ticket.description || ''} ${commentTexts}`;
}

/**
 * Compute pairwise Jaccard similarity between keyword sets.
 * Returns average similarity across all ticket pairs (0-1).
 */
function computePairwiseSimilarity(keywordSets: Set<string>[]): { avg: number; pairs: number; sharedTerms: string[] } {
    if (keywordSets.length < 2) return { avg: 1, pairs: 0, sharedTerms: [] };

    let totalSim = 0;
    let pairCount = 0;
    const globalShared: Record<string, number> = {};

    for (let i = 0; i < keywordSets.length; i++) {
        for (let j = i + 1; j < keywordSets.length; j++) {
            const a = keywordSets[i];
            const b = keywordSets[j];
            let intersection = 0;
            const shared: string[] = [];
            for (const kw of Array.from(a)) {
                if (b.has(kw)) {
                    intersection++;
                    shared.push(kw);
                }
            }
            const union = a.size + b.size - intersection;
            const sim = union > 0 ? intersection / union : 0;
            totalSim += sim;
            pairCount++;
            for (const s of shared) {
                globalShared[s] = (globalShared[s] || 0) + 1;
            }
        }
    }

    // Top shared terms (most frequently appearing across pairs)
    const sharedTerms = Object.entries(globalShared)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([term]) => term);

    return {
        avg: pairCount > 0 ? totalSim / pairCount : 0,
        pairs: pairCount,
        sharedTerms,
    };
}

// ─── Context Focus Score ─────────────────────────────────────────────

/**
 * Compute the Context Focus Score (0-100) for a batch.
 *
 * Fully AI-driven — analyzes ticket content (titles, descriptions, comments)
 * to extract technical keywords and compute actual context overlap.
 * No reliance on human-applied tags.
 *
 * Factors (ranked by weight):
 * 1. Content overlap (highest) — shared file paths, component names, technical terms
 * 2. Batch size — 3-6 optimal, >8 degrades
 * 3. Priority spread — mixing critical + low dilutes focus
 * 4. Reopen risk — reopened tickets consume more context
 */
function computeContextFocus(batch: Batch, tickets: Ticket[]): { score: number; factors: string[] } {
    const resolved = batch.ticketIds
        .map(id => tickets.find(t => t.id === id))
        .filter((t): t is Ticket => !!t);

    if (resolved.length === 0) return { score: 0, factors: ['Empty batch'] };

    let score = 100;
    const factors: string[] = [];
    const size = resolved.length;

    // ── Factor 1: Content Overlap (highest weight) ──────────────────
    const keywordSets = resolved.map(t => extractKeywords(getTicketText(t)));
    const { avg: similarity, sharedTerms } = computePairwiseSimilarity(keywordSets);

    if (size >= 2) {
        const overlapPct = Math.round(similarity * 100);
        if (similarity >= 0.15) {
            // 0.15+ Jaccard on technical keywords = strong overlap
            score += 15;
            const termsPreview = sharedTerms.slice(0, 5).join(', ');
            factors.push(`Strong context overlap (${overlapPct}%) — shared: ${termsPreview}`);
        } else if (similarity >= 0.06) {
            score += 5;
            const termsPreview = sharedTerms.slice(0, 4).join(', ');
            factors.push(`Moderate overlap (${overlapPct}%) — shared: ${termsPreview}`);
        } else if (similarity >= 0.02) {
            // Weak but present
            const termsPreview = sharedTerms.length > 0 ? ` — shared: ${sharedTerms.slice(0, 3).join(', ')}` : '';
            factors.push(`Weak overlap (${overlapPct}%)${termsPreview}`);
        } else {
            score -= 20;
            factors.push(`Minimal overlap (${overlapPct}%) — tickets appear unrelated, context will be scattered`);
        }
    }

    // ── Factor 2: Batch Size ────────────────────────────────────────
    if (size <= 2) {
        score -= 5;
        factors.push(`Small batch (${size}) — could combine with related work`);
    } else if (size >= 3 && size <= 6) {
        // Optimal range — no penalty, small bonus
        score += 5;
        factors.push(`Optimal batch size (${size})`);
    } else if (size >= 7 && size <= 8) {
        score -= 15;
        factors.push(`Large batch (${size}) — context dilution likely after ticket 5-6`);
    } else if (size > 8) {
        score -= 30;
        factors.push(`Very large batch (${size}) — agent attention will degrade significantly, split recommended`);
    }

    // ── Factor 3: Priority Spread ───────────────────────────────────
    const priorities = resolved.map(t => t.priority);
    const uniquePriorities = new Set(priorities);
    if (uniquePriorities.size >= 3) {
        score -= 10;
        factors.push(`Wide priority spread (${uniquePriorities.size} levels) — agent may rush lower-priority fixes`);
    } else if (uniquePriorities.size === 1 && size >= 3) {
        score += 5;
        factors.push(`Uniform priority (${priorities[0]}) — consistent focus level`);
    }

    // ── Factor 4: Reopen Risk ───────────────────────────────────────
    const reopenTickets = resolved.filter(t => (t.reopenCount ?? 0) >= 2);
    if (reopenTickets.length > 0) {
        const penalty = Math.min(reopenTickets.length * 5, 20);
        score -= penalty;
        factors.push(`${reopenTickets.length} ticket${reopenTickets.length > 1 ? 's' : ''} reopened 2+ times — each needs deeper investigation, consuming more context`);
    }

    // ── Factor 5: Complexity indicator (description length as proxy) ──
    const avgDescLength = resolved.reduce((sum, t) => sum + (t.description?.length || 0), 0) / size;
    const complexTickets = resolved.filter(t => (t.description?.length || 0) > 500);
    if (complexTickets.length >= 3) {
        score -= 10;
        factors.push(`${complexTickets.length} complex tickets (long descriptions) — high context consumption per ticket`);
    } else if (avgDescLength < 50 && size >= 3) {
        factors.push(`Short descriptions — scoring based on title/comment keywords`);
    }

    return { score: Math.max(0, Math.min(100, score)), factors };
}

function ContextFocusMeter({ score, factors, rationale }: { score: number; factors: string[]; rationale?: string }) {
    const [expanded, setExpanded] = useState(false);
    const color = score >= 80 ? 'bg-emerald-500' : score >= 50 ? 'bg-yellow-500' : 'bg-red-500';
    const textColor = score >= 80 ? 'text-emerald-400' : score >= 50 ? 'text-yellow-400' : 'text-red-400';
    const label = score >= 80 ? 'Focused' : score >= 50 ? 'Mixed' : 'Scattered';
    const hasDetails = factors.length > 0 || rationale;

    return (
        <div className="px-3 pb-2">
            <div className="flex items-center gap-2 w-full">
                <span className="text-[9px] text-vd-text-tertiary flex-shrink-0">Context Focus</span>
                <div className="flex-1 h-1.5 bg-vd-bg-primary rounded-full overflow-hidden">
                    <div className={`h-full ${color} rounded-full transition-all duration-300`} style={{ width: `${score}%` }} />
                </div>
                <span className={`text-[10px] font-semibold ${textColor}`}>{score} — {label}</span>
                {hasDetails && (
                    <button
                        onClick={() => setExpanded(!expanded)}
                        className="text-[9px] text-vd-text-tertiary hover:text-vd-text-secondary transition-colors flex-shrink-0"
                    >
                        {expanded ? 'Collapse' : 'Details'}
                    </button>
                )}
            </div>
            {expanded && (
                <div className="mt-1.5 space-y-1">
                    {factors.length > 0 && (
                        <div className="space-y-0.5">
                            {factors.map((f, i) => (
                                <p key={i} className="text-[9px] text-vd-text-tertiary">{f}</p>
                            ))}
                        </div>
                    )}
                    {rationale && (
                        <p className="text-[10px] text-purple-300/80 italic leading-snug">
                            {rationale}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}

export function BatchPane({
    batches,
    tickets,
    onClose,
    onRemoveBatch,
    onRemoveTicket,
    onAddTicket,
    onReorderBatches,
    onClearAll,
    onRenameBatch,
    onUpdateBatch,
    onCopyBatch,
    onOpenTicket,
    onOpenTerminal,
    onToast,
    isMobile,
    onPlanBatches,
    selectedTicketIds = [],
}: BatchPaneProps) {
    const [collapsedBatches, setCollapsedBatches] = useState<Set<string>>(new Set());
    const [showPlanChoice, setShowPlanChoice] = useState(false);
    const [editingName, setEditingName] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const [loadingOp, setLoadingOp] = useState<string | null>(null);
    const [addingToBatch, setAddingToBatch] = useState<string | null>(null);
    const [batchFilter, setBatchFilter] = useState<'all' | 'upcoming' | 'done'>('upcoming');
    const [animatingBatch, setAnimatingBatch] = useState<string | null>(null);
    const [animDir, setAnimDir] = useState<'up' | 'down'>('up');
    const batchRefs = useRef<Record<string, HTMLDivElement | null>>({});

    const handleMove = useCallback((batchId: string, direction: 'up' | 'down') => {
        const realIdx = batches.findIndex(b => b.id === batchId);
        if (realIdx < 0) return;
        const targetIdx = direction === 'up' ? realIdx - 1 : realIdx + 1;
        if (targetIdx < 0 || targetIdx >= batches.length) return;
        setAnimatingBatch(batchId);
        setAnimDir(direction);
        onReorderBatches(realIdx, targetIdx);
        // Wait for React to commit the new order, then scroll to keep the card in view
        setTimeout(() => {
            const el = batchRefs.current[batchId];
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 50);
        setTimeout(() => setAnimatingBatch(null), 400);
    }, [batches, onReorderBatches]);

    const toggleExpand = (id: string) => {
        setCollapsedBatches(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    // Build a map of ticketId → batch count (for duplicate warnings)
    const ticketBatchCount = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const b of batches) {
            for (const tid of b.ticketIds) {
                counts[tid] = (counts[tid] || 0) + 1;
            }
        }
        return counts;
    }, [batches]);

    // Tickets not in any batch (for add-to-batch picker)
    const unbatchedTickets = useMemo(() => {
        const allBatched = new Set<string>();
        for (const b of batches) for (const tid of b.ticketIds) allBatched.add(tid);
        return tickets.filter(t => !allBatched.has(t.id) && !DONE_STATUSES.includes(t.status));
    }, [batches, tickets]);

    const startRename = (batch: Batch) => {
        setEditingName(batch.id);
        setEditValue(batch.name);
    };

    const commitRename = () => {
        if (editingName && editValue.trim()) {
            onRenameBatch(editingName, editValue.trim());
        }
        setEditingName(null);
    };

    const resolveTicket = (ticketId: string): Ticket | undefined =>
        tickets.find(t => t.id === ticketId);

    return (
        <>
            {/* Backdrop — click outside to close */}
            <div
                className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
                onClick={onClose}
            />
            <div
                className={`fixed z-50 bg-vd-bg-secondary border-l border-vd-border shadow-panel flex flex-col vd-animate-slide-right ${
                    isMobile ? 'inset-0' : 'top-0 right-0 bottom-0 w-[380px]'
                }`}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-vd-border flex-shrink-0">
                    <h2 className="text-sm font-semibold text-vd-text-primary">
                        Batches ({batches.length})
                    </h2>
                    <div className="flex items-center gap-2">
                        {batches.length > 0 && (
                            <button
                                onClick={async () => {
                                    if (!window.confirm(`Delete all ${batches.length} batches?`)) return;
                                    setLoadingOp('clear');
                                    await onClearAll();
                                    setLoadingOp(null);
                                }}
                                disabled={loadingOp === 'clear'}
                                className="text-[11px] text-vd-text-tertiary hover:text-red-400 transition-colors disabled:opacity-50"
                            >
                                {loadingOp === 'clear' ? 'Clearing...' : 'Clear all'}
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            className="p-1 text-vd-text-tertiary hover:text-vd-text-primary transition-colors"
                            title="Close (Esc)"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* Filter tabs */}
                {batches.length > 0 && (
                    <div className="flex items-center gap-1 px-4 pt-2 pb-1 border-b border-vd-border flex-shrink-0">
                        {(['upcoming', 'done', 'all'] as const).map(f => {
                            const count = f === 'all' ? batches.length
                                : f === 'upcoming' ? batches.filter(b => {
                                    const valid = b.ticketIds.map(id => resolveTicket(id)).filter((t): t is Ticket => !!t);
                                    return valid.length === 0 || valid.some(t => !DONE_STATUSES.includes(t.status));
                                }).length
                                : batches.filter(b => {
                                    const valid = b.ticketIds.map(id => resolveTicket(id)).filter((t): t is Ticket => !!t);
                                    return valid.length > 0 && valid.every(t => DONE_STATUSES.includes(t.status));
                                }).length;
                            return (
                                <button
                                    key={f}
                                    onClick={() => setBatchFilter(f)}
                                    className={`text-[11px] px-2.5 py-1 rounded-full transition-colors ${
                                        batchFilter === f
                                            ? 'bg-vd-accent-gold/20 text-vd-accent-gold font-medium'
                                            : 'text-vd-text-tertiary hover:text-vd-text-secondary'
                                    }`}
                                >
                                    {f.charAt(0).toUpperCase() + f.slice(1)} ({count})
                                </button>
                            );
                        })}
                    </div>
                )}

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                    <div className="rounded-lg border border-vd-border bg-vd-bg-tertiary/60 px-3 py-2.5">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-[11px] font-semibold text-vd-text-primary">AI planning criteria</p>
                                <p className="text-[10px] text-vd-text-tertiary mt-0.5">Batches should optimize execution focus, not just similarity.</p>
                            </div>
                            {/* AD-189: Plan Batches dropdown — moved here from the topbar. */}
                            {onPlanBatches && (
                                <div className="relative shrink-0">
                                    <button
                                        onClick={() => {
                                            if (batches.length > 0 || selectedTicketIds.length > 0) {
                                                setShowPlanChoice(prev => !prev);
                                            } else {
                                                void onPlanBatches('full');
                                            }
                                        }}
                                        className="px-2.5 py-1.5 text-xs font-medium border border-purple-500/30 text-purple-400 rounded-lg hover:bg-purple-500/10 transition-colors flex items-center gap-1"
                                        title="AI batch planning"
                                    >
                                        <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
                                        Plan
                                    </button>
                                    {showPlanChoice && (batches.length > 0 || selectedTicketIds.length > 0) && (
                                        <>
                                            <div className="fixed inset-0 z-40" onClick={() => setShowPlanChoice(false)} />
                                            <div className="absolute right-0 top-full mt-1 z-50 w-52 rounded-lg border border-vd-border bg-vd-bg-secondary shadow-xl overflow-hidden">
                                                {selectedTicketIds.length > 0 && (
                                                    <>
                                                        <button
                                                            onClick={() => { setShowPlanChoice(false); void onPlanBatches('incremental', selectedTicketIds); }}
                                                            className="w-full px-3 py-2 text-left text-xs hover:bg-vd-bg-tertiary"
                                                        >
                                                            <span className="font-medium text-vd-accent-gold">Suggest from selected ({selectedTicketIds.length})</span>
                                                            <p className="text-[9px] text-vd-text-tertiary mt-0.5">Send planning prompt to the coding agent</p>
                                                        </button>
                                                        <div className="border-t border-vd-border" />
                                                    </>
                                                )}
                                                <button
                                                    onClick={() => { setShowPlanChoice(false); void onPlanBatches('incremental'); }}
                                                    className="w-full px-3 py-2 text-left text-xs hover:bg-vd-bg-tertiary"
                                                >
                                                    <span className="font-medium text-vd-text-primary">Plan remaining</span>
                                                </button>
                                                <div className="border-t border-vd-border" />
                                                <button
                                                    onClick={() => { setShowPlanChoice(false); void onPlanBatches('full'); }}
                                                    className="w-full px-3 py-2 text-left text-xs hover:bg-vd-bg-tertiary"
                                                >
                                                    <span className="font-medium text-vd-text-primary">Redo entire plan</span>
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                            <span className="text-[9px] uppercase tracking-wide text-vd-accent-gold">Manual stays authoritative</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5 text-[9px] text-vd-text-secondary">
                            {['Shared code area', 'Dependency order', 'Context-switch cost', 'Verification overlap', 'Risk isolation', 'Reasonable size'].map((criterion) => (
                                <span key={criterion} className="rounded-full border border-vd-border px-2 py-0.5 bg-vd-bg-primary/50">
                                    {criterion}
                                </span>
                            ))}
                        </div>
                    </div>
                    {batches.length === 0 ? (
                        <div className="text-center py-12">
                            <p className="text-sm text-vd-text-tertiary">
                                Select tickets and click <span className="text-vd-accent-gold font-medium">Add to Batch</span>,
                            </p>
                            <p className="text-sm text-vd-text-tertiary mt-1">
                                or use <span className="text-vd-accent-gold font-medium">AI Batch</span> for suggested groupings.
                            </p>
                        </div>
                    ) : (
                        batches
                        .filter(batch => {
                            if (batchFilter === 'all') return true;
                            const valid = batch.ticketIds.map(id => resolveTicket(id)).filter((t): t is Ticket => !!t);
                            const allDone = valid.length > 0 && valid.every(t => DONE_STATUSES.includes(t.status));
                            return batchFilter === 'done' ? allDone : (batchFilter === 'upcoming' ? !allDone : true);
                        })
                        .sort((a, b) => {
                            // Only sort in 'done' view — newest completed batch first
                            if (batchFilter !== 'done') return 0;
                            const maxUpdated = (batch: Batch) => {
                                const valid = batch.ticketIds.map(id => resolveTicket(id)).filter((t): t is Ticket => !!t);
                                if (valid.length === 0) return 0;
                                return Math.max(...valid.map(t => new Date(t.updatedAt || t.createdAt).getTime()));
                            };
                            return maxUpdated(b) - maxUpdated(a);
                        })
                        .map((batch, idx) => {
                            const isExpanded = !collapsedBatches.has(batch.id);
                            const validTickets = batch.ticketIds
                                .map(id => resolveTicket(id))
                                .filter((t): t is Ticket => !!t);
                            const isSuggested = batch.reviewState !== 'accepted' && batch.source === 'ai';
                            const quality = computeContextFocus(batch, tickets);

                            const realIdx = batches.findIndex(b => b.id === batch.id);
                            const isFirst = realIdx === 0;
                            const isLast = realIdx === batches.length - 1;
                            const isAnimating = animatingBatch === batch.id;

                            return (
                                <div
                                    key={batch.id}
                                    ref={el => { batchRefs.current[batch.id] = el; }}
                                    className={`bg-vd-bg-tertiary border border-vd-border rounded-lg overflow-hidden transition-all duration-300 ${
                                        isAnimating
                                            ? animDir === 'up'
                                                ? 'animate-batch-move-up ring-1 ring-vd-accent-gold/30'
                                                : 'animate-batch-move-down ring-1 ring-vd-accent-gold/30'
                                            : ''
                                    }`}
                                >
                                    {/* Batch header */}
                                    <div className="px-3 py-2.5 flex items-center gap-2">
                                        {/* Stable batch ID badge */}
                                        <span className="flex-shrink-0 text-[9px] font-mono font-bold text-vd-accent-gold/70 bg-vd-accent-gold/10 px-1.5 py-0.5 rounded" title={batch.id}>
                                            {batch.id.replace('batch-', 'B')}
                                        </span>

                                        {/* Batch name (editable) */}
                                        {editingName === batch.id ? (
                                            <input
                                                value={editValue}
                                                onChange={e => setEditValue(e.target.value)}
                                                onBlur={commitRename}
                                                onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditingName(null); }}
                                                autoFocus
                                                className="flex-1 text-xs font-medium bg-vd-bg-input border border-vd-accent-gold/40 rounded px-1.5 py-0.5 text-vd-text-primary focus:outline-none"
                                            />
                                        ) : (
                                            <button
                                                onClick={() => startRename(batch)}
                                                className="flex-1 text-left text-xs font-medium text-vd-text-primary hover:text-vd-accent-gold transition-colors truncate"
                                                title={batch.name}
                                            >
                                                {batch.name}
                                            </button>
                                        )}

                                        {/* Source badge */}
                                        <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${
                                            batch.source === 'ai'
                                                ? 'bg-purple-500/15 text-purple-400'
                                                : 'bg-vd-bg-primary text-vd-text-tertiary'
                                        }`}>
                                            {batch.source}
                                        </span>
                                        {isSuggested && (
                                            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">
                                                suggested
                                            </span>
                                        )}

                                        {/* Reorder arrows — use real index in full array */}
                                        {!isFirst && (
                                            <button
                                                onClick={() => handleMove(batch.id, 'up')}
                                                className="p-0.5 text-vd-text-tertiary hover:text-vd-text-primary transition-colors"
                                                title="Move up"
                                            >
                                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                                                </svg>
                                            </button>
                                        )}
                                        {!isLast && (
                                            <button
                                                onClick={() => handleMove(batch.id, 'down')}
                                                className="p-0.5 text-vd-text-tertiary hover:text-vd-text-primary transition-colors"
                                                title="Move down"
                                            >
                                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                                </svg>
                                            </button>
                                        )}

                                        {/* Delete batch */}
                                        <button
                                            onClick={async () => {
                                                if (!window.confirm(`Delete batch "${batch.name}"?`)) return;
                                                setLoadingOp(batch.id);
                                                await onRemoveBatch(batch.id);
                                                setLoadingOp(null);
                                            }}
                                            disabled={loadingOp === batch.id}
                                            className="p-0.5 text-vd-text-tertiary hover:text-red-400 transition-colors disabled:opacity-50"
                                            title="Remove batch"
                                        >
                                            {loadingOp === batch.id ? (
                                                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                                </svg>
                                            ) : (
                                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                                </svg>
                                            )}
                                        </button>
                                    </div>

                                    {/* Quality meter + rationale (collapsed by default) */}
                                    <ContextFocusMeter score={quality.score} factors={quality.factors} rationale={batch.rationale} />

                                    {isSuggested && (
                                        <div className="px-3 pb-2 flex items-center gap-2 text-[10px]">
                                            <span className="text-vd-text-tertiary flex-1">AI proposals are advisory until you accept them.</span>
                                            <button
                                                onClick={() => onUpdateBatch(batch.id, { reviewState: 'accepted' })}
                                                className="px-2 py-1 rounded-md border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 transition-colors font-medium"
                                            >
                                                Accept suggestion
                                            </button>
                                        </div>
                                    )}

                                    {/* Ticket count + copy + expand toggle */}
                                    <div className="px-3 pb-2 flex items-center gap-2">
                                        <span className="text-[10px] text-vd-text-tertiary">
                                            {validTickets.length} ticket{validTickets.length !== 1 ? 's' : ''}
                                        </span>
                                        <button
                                            onClick={() => onCopyBatch(batch, idx, batches.length)}
                                            className="text-[10px] text-vd-accent-gold hover:text-vd-accent-gold-light transition-colors font-medium"
                                        >
                                            Copy for AI
                                        </button>
                                        <BatchRunButton validTickets={validTickets} onOpenTerminal={onOpenTerminal} onToast={onToast} />
                                        <button
                                            onClick={() => toggleExpand(batch.id)}
                                            className="ml-auto text-[10px] text-vd-text-tertiary hover:text-vd-text-secondary transition-colors"
                                        >
                                            {isExpanded ? 'Collapse' : 'Expand'}
                                        </button>
                                    </div>

                                    {/* Ticket list */}
                                    {isExpanded && (
                                        <div className="border-t border-vd-border">
                                            {validTickets.map(ticket => {
                                                const isDone = DONE_STATUSES.includes(ticket.status);
                                                const inMultiple = (ticketBatchCount[ticket.id] || 0) > 1;

                                                return (
                                                    <div
                                                        key={ticket.id}
                                                        className={`flex items-center gap-2 px-3 py-1.5 transition-colors cursor-pointer ${
                                                            isDone ? 'opacity-40' : 'hover:bg-vd-bg-hover'
                                                        }`}
                                                        onClick={() => onOpenTicket(ticket)}
                                                    >
                                                        <span className="text-[10px] text-vd-text-tertiary font-mono flex-shrink-0">
                                                            {ticket.id}
                                                        </span>
                                                        {/* Status badge if ticket was worked on out of turn */}
                                                        {isDone && (
                                                            <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-400 flex-shrink-0">
                                                                {ticket.status}
                                                            </span>
                                                        )}
                                                        {/* Duplicate warning */}
                                                        {inMultiple && (
                                                            <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-amber-500/15 text-amber-400 flex-shrink-0" title={`In ${ticketBatchCount[ticket.id]} batches`}>
                                                                x{ticketBatchCount[ticket.id]}
                                                            </span>
                                                        )}
                                                        <span className={`text-[10px] font-semibold flex-shrink-0 ${PRIORITY_COLORS[ticket.priority] || ''}`}>
                                                            {ticket.priority}
                                                        </span>
                                                        <span
                                                            className={`text-[11px] truncate flex-1 ${isDone ? 'line-through text-vd-text-tertiary' : 'text-vd-text-secondary'}`}
                                                            title={ticket.title}
                                                        >
                                                            {ticket.title}
                                                        </span>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); onRemoveTicket(batch.id, ticket.id); }}
                                                            className="p-0.5 text-vd-text-tertiary hover:text-red-400 transition-colors flex-shrink-0"
                                                            title="Remove from batch"
                                                        >
                                                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                                            </svg>
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                            {validTickets.length === 0 && (
                                                <p className="text-[10px] text-vd-text-tertiary px-3 py-2">
                                                    All tickets removed or deleted
                                                </p>
                                            )}
                                            {/* Add ticket to batch */}
                                            {addingToBatch === batch.id ? (
                                                <div className="px-3 py-2 border-t border-vd-border/50">
                                                    <div className="max-h-32 overflow-y-auto space-y-0.5">
                                                        {unbatchedTickets.length === 0 ? (
                                                            <p className="text-[10px] text-vd-text-tertiary py-1">No unplanned tickets</p>
                                                        ) : (
                                                            unbatchedTickets.map(t => (
                                                                <button
                                                                    key={t.id}
                                                                    onClick={() => { onAddTicket(batch.id, t.id); setAddingToBatch(null); }}
                                                                    className="flex items-center gap-2 w-full text-left px-1.5 py-1 rounded hover:bg-vd-bg-hover transition-colors"
                                                                >
                                                                    <span className="text-[10px] text-vd-text-tertiary font-mono flex-shrink-0">{t.id}</span>
                                                                    <span className={`text-[10px] font-semibold flex-shrink-0 ${PRIORITY_COLORS[t.priority] || ''}`}>{t.priority}</span>
                                                                    <span className="text-[10px] text-vd-text-secondary truncate" title={t.title}>{t.title}</span>
                                                                </button>
                                                            ))
                                                        )}
                                                    </div>
                                                    <button
                                                        onClick={() => setAddingToBatch(null)}
                                                        className="mt-1 text-[10px] text-vd-text-tertiary hover:text-vd-text-secondary"
                                                    >
                                                        Cancel
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => setAddingToBatch(batch.id)}
                                                    className="flex items-center gap-1 px-3 py-1.5 text-[10px] text-vd-text-tertiary hover:text-vd-accent-gold transition-colors border-t border-vd-border/50"
                                                >
                                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                                                    </svg>
                                                    Add ticket
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </>
    );
}
