'use client';

import { useMemo, useState } from 'react';
import { Mission, MissionDetailModal } from './MissionDetailModal';

interface TicketSummary {
    id: string;
    title: string;
    status: string;
    priority: string;
    missionId?: string;
}

interface MissionPaneProps {
    missions: Mission[];
    tickets: TicketSummary[];
    onClose: () => void;
    onCreateMission: (payload: Partial<Mission>) => Promise<Mission | void> | Mission | void;
    onUpdateMission: (missionId: string, updates: Partial<Mission>) => Promise<void> | void;
    onDeleteMission: (missionId: string) => Promise<void> | void;
    onAddDecision: (missionId: string, content: string) => Promise<void> | void;
    onDiscussMission: (missionId: string) => Promise<void> | void;
    onOpenTicket: (ticketId: string) => void;
}

function computeProgress(missionId: string, tickets: TicketSummary[]): number {
    const linked = tickets.filter(ticket => ticket.missionId === missionId);
    if (linked.length === 0) return 0;
    const done = linked.filter(ticket => ['done', 'reviewed', 'observe', 'deferred'].includes(ticket.status)).length;
    return Math.round((done / linked.length) * 100);
}

export function MissionPane({
    missions,
    tickets,
    onClose,
    onCreateMission,
    onUpdateMission,
    onDeleteMission,
    onAddDecision,
    onDiscussMission,
    onOpenTicket,
}: MissionPaneProps) {
    const [selectedMissionId, setSelectedMissionId] = useState<string | null>(missions[0]?.id || null);
    const [creating, setCreating] = useState(false);

    const selectedMission = useMemo(
        () => missions.find(mission => mission.id === selectedMissionId) || null,
        [missions, selectedMissionId],
    );

    const selectedLinkedTickets = useMemo(
        () => selectedMission ? tickets.filter(ticket => ticket.missionId === selectedMission.id) : [],
        [tickets, selectedMission],
    );

    return (
        <>
            <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onClose} />
            <div className="fixed inset-y-0 right-0 z-50 w-[420px] max-w-[100vw] bg-vd-bg-secondary border-l border-vd-border shadow-panel flex flex-col">
                <div className="flex items-center justify-between px-4 py-3 border-b border-vd-border">
                    <div>
                        <h2 className="text-sm font-semibold text-vd-text-primary">Missions</h2>
                        <p className="text-[10px] text-vd-text-tertiary mt-0.5">Strategic work with plans, decisions, and linked tickets</p>
                    </div>
                    <div className="flex items-center gap-2">
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
                        <button onClick={onClose} className="text-vd-text-tertiary hover:text-vd-text-primary text-xl leading-none">×</button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {missions.length === 0 ? (
                        <div className="rounded-xl border border-vd-border bg-vd-bg-tertiary/40 p-4 text-center">
                            <p className="text-sm text-vd-text-secondary">No missions yet.</p>
                            <p className="text-xs text-vd-text-tertiary mt-1">Create one when a body of work needs shared planning, discussion, and tracking.</p>
                        </div>
                    ) : missions.map(mission => {
                        const linkedCount = tickets.filter(ticket => ticket.missionId === mission.id).length;
                        const progress = computeProgress(mission.id, tickets);
                        const isActive = mission.id === selectedMissionId;

                        return (
                            <button
                                key={mission.id}
                                onClick={() => setSelectedMissionId(mission.id)}
                                className={`w-full text-left rounded-xl border p-4 transition-colors ${
                                    isActive
                                        ? 'border-vd-accent-gold bg-vd-accent-gold/10'
                                        : 'border-vd-border bg-vd-bg-tertiary/40 hover:bg-vd-bg-hover'
                                }`}
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <span className="text-[10px] font-mono text-vd-accent-gold">{mission.id}</span>
                                    <span className="text-[10px] uppercase tracking-wide text-vd-text-tertiary">{mission.status}</span>
                                </div>
                                <div className="mt-2 text-sm font-semibold text-vd-text-primary">{mission.title}</div>
                                {mission.summary && <div className="mt-1 text-xs text-vd-text-secondary line-clamp-2">{mission.summary}</div>}
                                <div className="mt-3 h-1.5 rounded-full bg-vd-bg-input overflow-hidden">
                                    <div className="h-full bg-vd-accent-gold" style={{ width: `${progress}%` }} />
                                </div>
                                <div className="mt-2 flex items-center justify-between text-[10px] text-vd-text-tertiary">
                                    <span>{progress}% complete</span>
                                    <span>{linkedCount} tickets</span>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            <MissionDetailModal
                open={!!selectedMission}
                mission={selectedMission}
                linkedTickets={selectedLinkedTickets}
                onClose={onClose}
                onSave={async (updates) => {
                    if (!selectedMission) return;
                    await onUpdateMission(selectedMission.id, updates);
                }}
                onDelete={async () => {
                    if (!selectedMission) return;
                    await onDeleteMission(selectedMission.id);
                }}
                onDiscuss={async () => {
                    if (!selectedMission) return;
                    await onDiscussMission(selectedMission.id);
                }}
                onAddDecision={async (content) => {
                    if (!selectedMission) return;
                    await onAddDecision(selectedMission.id, content);
                }}
                onOpenTicket={onOpenTicket}
            />
        </>
    );
}
