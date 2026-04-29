'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Mission } from './MissionDetailModal';
import type { Batch } from './BatchPane';

interface TicketSummary {
    id: string;
    title: string;
    status: string;
    priority: string;
    missionId?: string;
    wave?: string;
    session?: string;
}

interface MissionPageProps {
    missions: Mission[];
    tickets: TicketSummary[];
    batches: Batch[];
    activeMissionId?: string | null;
    onCreateMission: (payload: Partial<Mission>) => Promise<Mission | void> | Mission | void;
    onUpdateMission: (missionId: string, updates: Partial<Mission>) => Promise<void> | void;
    onDeleteMission: (missionId: string) => Promise<void> | void;
    onAddDecision: (missionId: string, content: string) => Promise<void> | void;
    onDiscussMission: (missionId: string) => Promise<void> | void;
    onOpenTicket: (ticketId: string) => void;
    onOpenMissionBoard: (missionId: string) => void;
}

const MISSION_STATUSES: Mission['status'][] = ['draft', 'planning', 'approved', 'in_progress', 'blocked', 'done', 'archived'];
const MISSION_STATUS_LABELS: Record<Mission['status'], string> = {
    draft: 'Draft',
    planning: 'Planning',
    approved: 'Approved',
    in_progress: 'In Progress',
    blocked: 'Blocked',
    done: 'Done',
    archived: 'Archived',
};

function missionProgress(missionId: string, tickets: TicketSummary[]): number {
    const linked = tickets.filter(ticket => ticket.missionId === missionId);
    if (linked.length === 0) return 0;
    const done = linked.filter(ticket => ['done', 'reviewed', 'observe', 'deferred'].includes(ticket.status)).length;
    return Math.round((done / linked.length) * 100);
}

export function MissionPage({
    missions,
    tickets,
    batches,
    activeMissionId,
    onCreateMission,
    onUpdateMission,
    onDeleteMission,
    onAddDecision,
    onDiscussMission,
    onOpenTicket,
    onOpenMissionBoard,
}: MissionPageProps) {
    const [selectedMissionId, setSelectedMissionId] = useState<string | null>(missions[0]?.id || null);
    const [creating, setCreating] = useState(false);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState<Partial<Mission>>({});
    const [decisionText, setDecisionText] = useState('');
    const [saving, setSaving] = useState(false);
    const [discussing, setDiscussing] = useState(false);

    useEffect(() => {
        if (!selectedMissionId && missions[0]?.id) setSelectedMissionId(missions[0].id);
        if (selectedMissionId && !missions.some(mission => mission.id === selectedMissionId)) {
            setSelectedMissionId(missions[0]?.id || null);
        }
    }, [missions, selectedMissionId]);

    const selectedMission = useMemo(
        () => missions.find(mission => mission.id === selectedMissionId) || null,
        [missions, selectedMissionId],
    );

    useEffect(() => {
        setEditing(false);
        setDecisionText('');
        setDraft(selectedMission || {});
    }, [selectedMission]);

    const linkedTickets = useMemo(
        () => selectedMission ? tickets.filter(ticket => ticket.missionId === selectedMission.id) : [], 
        [tickets, selectedMission],
    );

    const linkedWaves = useMemo(() => {
        const waves = linkedTickets
            .map(ticket => ticket.wave?.trim())
            .filter((value): value is string => !!value);
        return Array.from(new Set(waves)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    }, [linkedTickets]);

    const linkedSessions = useMemo(() => {
        const sessions = linkedTickets
            .map(ticket => ticket.session?.trim())
            .filter((value): value is string => !!value);
        return Array.from(new Set(sessions)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    }, [linkedTickets]);

    const relatedBatches = useMemo(() => {
        if (!selectedMission) return [];
        const linkedIds = new Set(linkedTickets.map(ticket => ticket.id));
        return batches.filter(batch => batch.ticketIds.some(ticketId => linkedIds.has(ticketId)));
    }, [batches, linkedTickets, selectedMission]);

    const progress = selectedMission ? missionProgress(selectedMission.id, tickets) : 0;
    const decisionLog = selectedMission?.decisionLog || [];
    const missionsByStatus = useMemo(
        () => MISSION_STATUSES
            .map(status => ({
                status,
                label: MISSION_STATUS_LABELS[status],
                missions: missions.filter(mission => mission.status === status),
            }))
            .filter(group => group.missions.length > 0),
        [missions],
    );

    return (
        <div className="flex-1 min-h-0 min-w-0 flex">
            <div className="w-[320px] max-w-[35vw] border-r border-vd-border bg-vd-bg-secondary/60 flex flex-col">
                <div className="px-4 py-3 border-b border-vd-border flex items-center justify-between gap-3">
                    <div>
                        <h2 className="text-sm font-semibold text-vd-text-primary">Missions</h2>
                        <p className="text-[10px] text-vd-text-tertiary mt-0.5">Strategic planning and execution control</p>
                    </div>
                    <button
                        onClick={async () => {
                            setCreating(true);
                            try {
                                const created = await onCreateMission({
                                    title: `Mission ${missions.length + 1}`,
                                    status: 'draft',
                                    summary: '',
                                    goal: '',
                                    context: '',
                                    proposedPlan: '',
                                    agreedPlan: '',
                                    successCriteria: '',
                                    notes: '',
                                });
                                if (created && 'id' in created) setSelectedMissionId(created.id);
                            } finally {
                                setCreating(false);
                            }
                        }}
                        className="px-2.5 py-1.5 text-xs font-medium border border-vd-accent-gold/30 text-vd-accent-gold rounded-lg hover:bg-vd-accent-gold/10 transition-colors"
                    >
                        {creating ? 'Creating...' : '+ Mission'}
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-4">
                    {missions.length === 0 ? (
                        <div className="rounded-xl border border-vd-border bg-vd-bg-tertiary/40 p-4 text-center">
                            <p className="text-sm text-vd-text-secondary">No missions yet.</p>
                            <p className="text-xs text-vd-text-tertiary mt-1">Create a mission when work needs shared planning, decisions, and progress tracking.</p>
                        </div>
                    ) : missionsByStatus.map((group) => (
                        <div key={group.status} className="space-y-2">
                            <div className="px-1">
                                <div className="text-[10px] uppercase tracking-[0.18em] text-vd-text-tertiary">{group.label}</div>
                            </div>
                            <div className="space-y-3">
                                {group.missions.map((mission) => {
                                    const isManaging = mission.id === selectedMissionId;
                                    const isActiveBoardMission = mission.id === activeMissionId;
                                    const missionTickets = tickets.filter(ticket => ticket.missionId === mission.id);
                                    const linkedCount = missionTickets.length;
                                    const itemProgress = missionProgress(mission.id, tickets);
                                    const waveCount = new Set(missionTickets.map(ticket => ticket.wave?.trim()).filter(Boolean)).size;
                                    const batchCount = batches.filter(batch => batch.ticketIds.some(ticketId => missionTickets.some(ticket => ticket.id === ticketId))).length;
                                    return (
                                        <button
                                            key={mission.id}
                                            onClick={() => onOpenMissionBoard(mission.id)}
                                            className={`w-full text-left rounded-xl border p-4 transition-colors ${
                                                isManaging || isActiveBoardMission
                                                    ? 'border-vd-accent-gold bg-vd-accent-gold/10'
                                                    : 'border-vd-border bg-vd-bg-tertiary/40 hover:bg-vd-bg-hover'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between gap-3">
                                                <span className="text-[10px] font-mono text-vd-accent-gold">{mission.id}</span>
                                                <div className="flex items-center gap-2">
                                                    {isActiveBoardMission && (
                                                        <span className="text-[10px] uppercase tracking-wide text-vd-accent-gold">Open on board</span>
                                                    )}
                                                    <span className="text-[10px] uppercase tracking-wide text-vd-text-tertiary">{mission.status}</span>
                                                </div>
                                            </div>
                                            <div className="mt-2 text-sm font-semibold text-vd-text-primary">{mission.title}</div>
                                            {mission.summary && <div className="mt-1 text-xs text-vd-text-secondary line-clamp-2">{mission.summary}</div>}
                                            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px] text-vd-text-tertiary">
                                                <span className="rounded-full bg-vd-bg-input px-2 py-1">{linkedCount} tickets</span>
                                                <span className="rounded-full bg-vd-bg-input px-2 py-1">{waveCount || 0} waves</span>
                                                <span className="rounded-full bg-vd-bg-input px-2 py-1">{batchCount} batches</span>
                                            </div>
                                            <div className="mt-3 h-1.5 rounded-full bg-vd-bg-input overflow-hidden">
                                                <div className="h-full bg-vd-accent-gold" style={{ width: `${itemProgress}%` }} />
                                            </div>
                                            <div className="mt-2 flex items-center justify-between text-[10px] text-vd-text-tertiary">
                                                <span>{itemProgress}% complete</span>
                                                <span>{linkedCount} tickets</span>
                                            </div>
                                            <div className="mt-3 flex items-center justify-between gap-2">
                                                <span className="text-[10px] text-vd-text-tertiary">Click to open mission board</span>
                                                <button
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        setSelectedMissionId(mission.id);
                                                    }}
                                                    className="px-2.5 py-1 text-[10px] font-medium rounded-md border border-vd-border text-vd-text-secondary hover:text-vd-text-primary hover:bg-vd-bg-hover transition-colors"
                                                >
                                                    Manage
                                                </button>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex-1 min-w-0 overflow-y-auto">
                {!selectedMission ? (
                    <div className="h-full flex items-center justify-center text-center px-8">
                        <div>
                            <h3 className="text-lg font-semibold text-vd-text-primary">No Mission Selected</h3>
                            <p className="mt-2 text-sm text-vd-text-tertiary">Pick a mission from the list or create a new one to start planning.</p>
                        </div>
                    </div>
                ) : (
                    <div className="p-5 space-y-5">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <div className="text-xs font-mono text-vd-accent-gold">{selectedMission.id}</div>
                                <h1 className="mt-1 text-2xl font-semibold text-vd-text-primary">{selectedMission.title}</h1>
                                <div className="mt-2 flex items-center gap-2 text-xs">
                                    <span className="rounded-full bg-vd-bg-tertiary px-2 py-1 text-vd-text-secondary uppercase tracking-wide">{selectedMission.status}</span>
                                    <span className="text-vd-text-tertiary">{linkedTickets.length} linked tickets</span>
                                    <span className="text-vd-text-tertiary">{linkedWaves.length} waves</span>
                                    <span className="text-vd-text-tertiary">{relatedBatches.length} batches</span>
                                    <span className="text-vd-accent-gold font-semibold">{progress}% complete</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={async () => {
                                        setDiscussing(true);
                                        try { await onDiscussMission(selectedMission.id); } finally { setDiscussing(false); }
                                    }}
                                    className="px-3 py-2 text-sm font-medium border border-vd-accent-gold/30 text-vd-accent-gold rounded-lg hover:bg-vd-accent-gold/10 transition-colors"
                                >
                                    {discussing ? 'Discussing...' : 'Discuss'}
                                </button>
                                {!editing ? (
                                    <button
                                        onClick={() => {
                                            setDraft(selectedMission);
                                            setEditing(true);
                                        }}
                                        className="px-3 py-2 text-sm font-medium border border-vd-border text-vd-text-secondary rounded-lg hover:bg-vd-bg-hover transition-colors"
                                    >
                                        Edit
                                    </button>
                                ) : (
                                    <>
                                        <button
                                            onClick={() => {
                                                setDraft(selectedMission);
                                                setEditing(false);
                                            }}
                                            className="px-3 py-2 text-sm text-vd-text-tertiary hover:text-vd-text-primary rounded-lg transition-colors"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={async () => {
                                                setSaving(true);
                                                try {
                                                    await onUpdateMission(selectedMission.id, draft);
                                                    setEditing(false);
                                                } finally {
                                                    setSaving(false);
                                                }
                                            }}
                                            className="px-3 py-2 text-sm font-medium bg-vd-accent-gold text-vd-bg-primary rounded-lg hover:bg-vd-accent-gold-light transition-colors"
                                        >
                                            {saving ? 'Saving...' : 'Save'}
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="grid gap-5 xl:grid-cols-[1.45fr_0.9fr]">
                            <div className="space-y-4">
                                <div className="rounded-xl border border-vd-border bg-vd-bg-secondary/50 p-4">
                                    <div className="grid gap-4 md:grid-cols-[1fr_180px]">
                                        <div>
                                            <label className="text-xs text-vd-text-tertiary uppercase tracking-wider">Title</label>
                                            {editing ? (
                                                <input
                                                    value={draft.title || ''}
                                                    onChange={(e) => setDraft(prev => ({ ...prev, title: e.target.value }))}
                                                    className="w-full mt-1 bg-vd-bg-input border border-vd-border rounded-lg px-3 py-2 text-sm text-vd-text-primary focus:border-vd-accent-gold focus:outline-none"
                                                />
                                            ) : (
                                                <div className="mt-2 text-sm text-vd-text-primary">{selectedMission.title}</div>
                                            )}
                                        </div>
                                        <div>
                                            <label className="text-xs text-vd-text-tertiary uppercase tracking-wider">Status</label>
                                            {editing ? (
                                                <select
                                                    value={draft.status || 'draft'}
                                                    onChange={(e) => setDraft(prev => ({ ...prev, status: e.target.value as Mission['status'] }))}
                                                    className="w-full mt-1 bg-vd-bg-input border border-vd-border rounded-lg px-3 py-2 text-sm text-vd-text-primary focus:border-vd-accent-gold focus:outline-none"
                                                >
                                                    {MISSION_STATUSES.map(status => <option key={status} value={status}>{status}</option>)}
                                                </select>
                                            ) : (
                                                <div className="mt-2 text-sm text-vd-text-secondary uppercase">{selectedMission.status}</div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {[
                                    ['Summary', 'summary'],
                                    ['Goal', 'goal'],
                                    ['Context', 'context'],
                                    ['Proposed Plan', 'proposedPlan'],
                                    ['Agreed Plan', 'agreedPlan'],
                                    ['Success Criteria', 'successCriteria'],
                                    ['Notes', 'notes'],
                                ].map(([label, key]) => (
                                    <div key={key} className="rounded-xl border border-vd-border bg-vd-bg-secondary/50 p-4">
                                        <h3 className="text-xs text-vd-text-tertiary uppercase tracking-wider">{label}</h3>
                                        {editing ? (
                                            <textarea
                                                value={String(draft[key as keyof Mission] || '')}
                                                onChange={(e) => setDraft(prev => ({ ...prev, [key]: e.target.value }))}
                                                rows={label === 'Summary' ? 3 : 5}
                                                className="w-full mt-2 bg-vd-bg-input border border-vd-border rounded-lg px-3 py-2 text-sm text-vd-text-primary focus:border-vd-accent-gold focus:outline-none resize-y"
                                            />
                                        ) : (
                                            <div className="mt-2 text-sm text-vd-text-secondary whitespace-pre-wrap">
                                                {String(selectedMission[key as keyof Mission] || '—')}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>

                            <div className="space-y-4">
                                <div className="rounded-xl border border-vd-border bg-vd-bg-secondary/50 p-4">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-sm font-semibold text-vd-text-primary">Progress</h3>
                                        <span className="text-sm font-semibold text-vd-accent-gold">{progress}%</span>
                                    </div>
                                    <div className="mt-3 h-2 rounded-full bg-vd-bg-input overflow-hidden">
                                        <div className="h-full bg-vd-accent-gold" style={{ width: `${progress}%` }} />
                                    </div>
                                    <div className="mt-3 text-xs text-vd-text-tertiary">Updated {new Date(selectedMission.updatedAt).toLocaleString()}</div>
                                </div>

                                <div className="rounded-xl border border-vd-border bg-vd-bg-secondary/50 p-4">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-sm font-semibold text-vd-text-primary">Linked Tickets</h3>
                                        <span className="text-xs text-vd-text-tertiary">{linkedTickets.length} total</span>
                                    </div>
                                    <div className="mt-3 space-y-2 max-h-72 overflow-y-auto">
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

                                <div className="rounded-xl border border-vd-border bg-vd-bg-secondary/50 p-4">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-sm font-semibold text-vd-text-primary">Execution Plan</h3>
                                        <span className="text-xs text-vd-text-tertiary">Waves and batches</span>
                                    </div>
                                    <div className="mt-3 grid gap-4 md:grid-cols-2">
                                        <div>
                                            <div className="text-[10px] uppercase tracking-wider text-vd-text-tertiary">Waves</div>
                                            <div className="mt-2 flex flex-wrap gap-2">
                                                {linkedWaves.length === 0 ? (
                                                    <span className="text-xs text-vd-text-tertiary">No waves linked yet.</span>
                                                ) : linkedWaves.map((wave) => (
                                                    <span key={wave} className="rounded-full border border-vd-border bg-vd-bg-input px-2.5 py-1 text-xs text-vd-text-secondary">
                                                        {wave}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-[10px] uppercase tracking-wider text-vd-text-tertiary">Sessions</div>
                                            <div className="mt-2 flex flex-wrap gap-2">
                                                {linkedSessions.length === 0 ? (
                                                    <span className="text-xs text-vd-text-tertiary">No sessions linked yet.</span>
                                                ) : linkedSessions.map((session) => (
                                                    <span key={session} className="rounded-full border border-vd-border bg-vd-bg-input px-2.5 py-1 text-xs text-vd-text-secondary">
                                                        {session}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="mt-4">
                                        <div className="text-[10px] uppercase tracking-wider text-vd-text-tertiary">Batches</div>
                                        <div className="mt-2 space-y-2">
                                            {relatedBatches.length === 0 ? (
                                                <p className="text-xs text-vd-text-tertiary">No batches currently include this mission’s tickets.</p>
                                            ) : relatedBatches.map((batch) => (
                                                <div key={batch.id} className="rounded-lg border border-vd-border px-3 py-2">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <div className="text-sm text-vd-text-primary">{batch.name}</div>
                                                        <div className="flex items-center gap-2 text-[10px] text-vd-text-tertiary">
                                                            <span>{batch.ticketIds.filter(ticketId => linkedTickets.some(ticket => ticket.id === ticketId)).length} mission tickets</span>
                                                            <span className="uppercase">{batch.source}</span>
                                                        </div>
                                                    </div>
                                                    {batch.rationale && (
                                                        <div className="mt-1 text-xs text-vd-text-secondary line-clamp-2">{batch.rationale}</div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="rounded-xl border border-vd-border bg-vd-bg-secondary/50 p-4">
                                    <h3 className="text-sm font-semibold text-vd-text-primary">Decision Log</h3>
                                    <div className="mt-3 space-y-2 max-h-56 overflow-y-auto">
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
                                            await onAddDecision(selectedMission.id, decisionText.trim());
                                            setDecisionText('');
                                        }}
                                        className="mt-2 px-3 py-1.5 text-xs font-medium border border-vd-border rounded-lg text-vd-text-secondary hover:text-vd-text-primary hover:bg-vd-bg-hover transition-colors"
                                    >
                                        Add Decision
                                    </button>
                                </div>

                                <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
                                    <h3 className="text-sm font-semibold text-red-300">Danger Zone</h3>
                                    <p className="mt-2 text-xs text-vd-text-tertiary">Deleting a mission removes the mission object and unlinks its tickets.</p>
                                    <button
                                        onClick={async () => {
                                            if (window.confirm(`Delete mission ${selectedMission.id}?`)) {
                                                await onDeleteMission(selectedMission.id);
                                            }
                                        }}
                                        className="mt-3 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                                    >
                                        Delete Mission
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
