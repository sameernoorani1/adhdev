'use client';

import { useEffect, useMemo, useState } from 'react';

interface MissionDecision {
    id: string;
    content: string;
    author: string;
    createdAt: string;
}

export interface Mission {
    id: string;
    title: string;
    status: 'draft' | 'planning' | 'approved' | 'in_progress' | 'blocked' | 'done' | 'archived';
    summary: string;
    goal: string;
    context: string;
    proposedPlan: string;
    agreedPlan: string;
    successCriteria: string;
    notes: string;
    createdAt: string;
    updatedAt: string;
    decisionLog: MissionDecision[];
}

interface LinkedTicket {
    id: string;
    title: string;
    status: string;
    priority: string;
}

interface MissionDetailModalProps {
    open: boolean;
    mission: Mission | null;
    linkedTickets: LinkedTicket[];
    onClose: () => void;
    onSave: (updates: Partial<Mission>) => Promise<void> | void;
    onDelete: () => Promise<void> | void;
    onDiscuss: () => Promise<void> | void;
    onAddDecision: (content: string) => Promise<void> | void;
    onOpenTicket: (ticketId: string) => void;
}

const MISSION_STATUSES: Mission['status'][] = ['draft', 'planning', 'approved', 'in_progress', 'blocked', 'done', 'archived'];

export function MissionDetailModal({
    open,
    mission,
    linkedTickets,
    onClose,
    onSave,
    onDelete,
    onDiscuss,
    onAddDecision,
    onOpenTicket,
}: MissionDetailModalProps) {
    const [draft, setDraft] = useState<Partial<Mission>>({});
    const [decisionText, setDecisionText] = useState('');
    const [saving, setSaving] = useState(false);
    const [discussing, setDiscussing] = useState(false);

    useEffect(() => {
        if (!mission) return;
        setDraft(mission);
        setDecisionText('');
    }, [mission]);

    const progress = useMemo(() => {
        if (linkedTickets.length === 0) return 0;
        const doneCount = linkedTickets.filter(ticket => ['done', 'reviewed', 'observe', 'deferred'].includes(ticket.status)).length;
        return Math.round((doneCount / linkedTickets.length) * 100);
    }, [linkedTickets]);
    const decisionLog = mission?.decisionLog || [];

    if (!open || !mission) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
            <div className="relative bg-vd-bg-secondary border border-vd-border rounded-xl w-full max-w-4xl mx-4 max-h-[90vh] overflow-y-auto shadow-panel">
                <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-4 border-b border-vd-border bg-vd-bg-secondary">
                    <div>
                        <div className="text-xs font-mono text-vd-accent-gold">{mission.id}</div>
                        <h2 className="text-lg font-semibold text-vd-text-primary mt-1">Mission Workspace</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={async () => {
                                setDiscussing(true);
                                try { await onDiscuss(); } finally { setDiscussing(false); }
                            }}
                            className="px-3 py-1.5 text-xs font-medium border border-vd-accent-gold/30 text-vd-accent-gold rounded-lg hover:bg-vd-accent-gold/10 transition-colors"
                        >
                            {discussing ? 'Discussing...' : 'Discuss Mission'}
                        </button>
                        <button onClick={onClose} className="text-vd-text-tertiary hover:text-vd-text-primary text-xl leading-none">×</button>
                    </div>
                </div>

                <div className="p-5 grid gap-5 lg:grid-cols-[1.5fr_0.9fr]">
                    <div className="space-y-4">
                        <div className="grid gap-4 md:grid-cols-[1fr_180px]">
                            <div>
                                <label className="text-xs text-vd-text-tertiary uppercase tracking-wider">Title</label>
                                <input
                                    value={draft.title || ''}
                                    onChange={(e) => setDraft(prev => ({ ...prev, title: e.target.value }))}
                                    className="w-full mt-1 bg-vd-bg-input border border-vd-border rounded-lg px-3 py-2 text-sm text-vd-text-primary focus:border-vd-accent-gold focus:outline-none"
                                />
                            </div>
                            <div>
                                <label className="text-xs text-vd-text-tertiary uppercase tracking-wider">Status</label>
                                <select
                                    value={draft.status || 'draft'}
                                    onChange={(e) => setDraft(prev => ({ ...prev, status: e.target.value as Mission['status'] }))}
                                    className="w-full mt-1 bg-vd-bg-input border border-vd-border rounded-lg px-3 py-2 text-sm text-vd-text-primary focus:border-vd-accent-gold focus:outline-none"
                                >
                                    {MISSION_STATUSES.map(status => <option key={status} value={status}>{status}</option>)}
                                </select>
                            </div>
                        </div>

                        {[
                            ['Summary', 'summary', 'One-line mission framing'],
                            ['Goal', 'goal', 'What outcome should this mission achieve?'],
                            ['Context', 'context', 'Architecture/background/context'],
                            ['Proposed Plan', 'proposedPlan', 'Initial working plan or options'],
                            ['Agreed Plan', 'agreedPlan', 'Current plan you want execution to follow'],
                            ['Success Criteria', 'successCriteria', 'What does done look like?'],
                            ['Notes', 'notes', 'Open questions, risks, loose notes'],
                        ].map(([label, key, placeholder]) => (
                            <div key={key}>
                                <label className="text-xs text-vd-text-tertiary uppercase tracking-wider">{label}</label>
                                <textarea
                                    value={String(draft[key as keyof Mission] || '')}
                                    onChange={(e) => setDraft(prev => ({ ...prev, [key]: e.target.value }))}
                                    rows={label === 'Summary' ? 2 : 4}
                                    placeholder={placeholder}
                                    className="w-full mt-1 bg-vd-bg-input border border-vd-border rounded-lg px-3 py-2 text-sm text-vd-text-primary placeholder-vd-text-tertiary focus:border-vd-accent-gold focus:outline-none resize-y"
                                />
                            </div>
                        ))}

                        <div className="flex items-center justify-between pt-2">
                            <div className="text-xs text-vd-text-tertiary">
                                Updated {new Date(mission.updatedAt).toLocaleString()}
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={async () => { if (window.confirm(`Delete mission ${mission.id}?`)) await onDelete(); }}
                                    className="px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                                >
                                    Delete
                                </button>
                                <button
                                    onClick={async () => {
                                        setSaving(true);
                                        try { await onSave(draft); } finally { setSaving(false); }
                                    }}
                                    className="px-4 py-2 text-sm font-medium bg-vd-accent-gold text-vd-bg-primary rounded-lg hover:bg-vd-accent-gold-light transition-colors"
                                >
                                    {saving ? 'Saving...' : 'Save Mission'}
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="rounded-xl border border-vd-border bg-vd-bg-tertiary/40 p-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-semibold text-vd-text-primary">Progress</h3>
                                <span className="text-sm font-semibold text-vd-accent-gold">{progress}%</span>
                            </div>
                            <div className="mt-3 h-2 rounded-full bg-vd-bg-input overflow-hidden">
                                <div className="h-full bg-vd-accent-gold transition-all" style={{ width: `${progress}%` }} />
                            </div>
                            <div className="mt-3 text-xs text-vd-text-tertiary">
                                {linkedTickets.length} linked tickets
                            </div>
                        </div>

                        <div className="rounded-xl border border-vd-border bg-vd-bg-tertiary/40 p-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-semibold text-vd-text-primary">Linked Tickets</h3>
                                <span className="text-xs text-vd-text-tertiary">Mission scope</span>
                            </div>
                            <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
                                {linkedTickets.length === 0 ? (
                                    <p className="text-xs text-vd-text-tertiary">No tickets linked yet.</p>
                                ) : linkedTickets.map(ticket => (
                                    <button
                                        key={ticket.id}
                                        onClick={() => onOpenTicket(ticket.id)}
                                        className="w-full text-left rounded-lg border border-vd-border px-3 py-2 hover:bg-vd-bg-hover transition-colors"
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-xs font-mono text-vd-accent-gold">{ticket.id}</span>
                                            <span className="text-[10px] text-vd-text-tertiary">{ticket.status}</span>
                                        </div>
                                        <div className="mt-1 text-sm text-vd-text-primary line-clamp-2">{ticket.title}</div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="rounded-xl border border-vd-border bg-vd-bg-tertiary/40 p-4">
                            <h3 className="text-sm font-semibold text-vd-text-primary">Decision Log</h3>
                            <div className="mt-3 space-y-2 max-h-48 overflow-y-auto">
                                {decisionLog.length === 0 ? (
                                    <p className="text-xs text-vd-text-tertiary">No decisions captured yet.</p>
                                ) : decisionLog.slice().reverse().map(decision => (
                                    <div key={decision.id} className="rounded-lg border border-vd-border px-3 py-2">
                                        <div className="text-[10px] text-vd-text-tertiary">{decision.author} • {new Date(decision.createdAt).toLocaleString()}</div>
                                        <div className="mt-1 text-sm text-vd-text-secondary whitespace-pre-wrap">{decision.content}</div>
                                    </div>
                                ))}
                            </div>
                            <textarea
                                value={decisionText}
                                onChange={(e) => setDecisionText(e.target.value)}
                                rows={3}
                                placeholder="Record a decision, architecture call, or agreement..."
                                className="w-full mt-3 bg-vd-bg-input border border-vd-border rounded-lg px-3 py-2 text-sm text-vd-text-primary placeholder-vd-text-tertiary focus:border-vd-accent-gold focus:outline-none resize-none"
                            />
                            <button
                                onClick={async () => {
                                    if (!decisionText.trim()) return;
                                    await onAddDecision(decisionText.trim());
                                    setDecisionText('');
                                }}
                                className="mt-2 px-3 py-1.5 text-xs font-medium border border-vd-border rounded-lg text-vd-text-secondary hover:text-vd-text-primary hover:bg-vd-bg-hover transition-colors"
                            >
                                Add Decision
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
