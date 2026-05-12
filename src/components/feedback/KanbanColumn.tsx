'use client';

import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { TicketCard, Ticket } from './TicketCard';

interface ColumnConfig {
    label: string;
    aiInstruction: string;
}

interface KanbanColumnProps {
    status: string;
    config: ColumnConfig;
    tickets: Ticket[];
    colorBar: string;
    onTicketClick: (ticket: Ticket) => void;
    onUpdateInstruction?: (status: string, instruction: string) => void;
    onToggleAi: (id: string, value: boolean) => void;
    onAddTicket?: (status: string) => void;
    isDragDisabled?: boolean;
    readTickets?: Set<string>;
    selectedIds?: Set<string>;
    onToggleSelect?: (id: string) => void;
    onSelectColumn?: (status: string) => void;
    activeExecutionIds?: Set<string>;
    activeRunStatusByTicket?: Map<string, 'dispatching' | 'running' | 'finishing'>;
    stackBy?: 'status' | 'priority' | 'wave' | 'session';
    groupedBy?: 'none' | 'status' | 'priority' | 'wave' | 'session';
}

export function KanbanColumn({
    status,
    config,
    tickets,
    colorBar,
    onTicketClick,
    onUpdateInstruction,
    onToggleAi,
    onAddTicket,
    isDragDisabled,
    readTickets,
    selectedIds,
    onToggleSelect,
    onSelectColumn,
    activeExecutionIds,
    activeRunStatusByTicket,
    stackBy = 'status',
    groupedBy = 'none',
}: KanbanColumnProps) {
    const [showInstructionEditor, setShowInstructionEditor] = useState(false);
    const [instruction, setInstruction] = useState(config.aiInstruction);

    const { setNodeRef, isOver } = useDroppable({ id: status });

    const ticketIds = tickets.map((t) => t.id);
    const hiddenFields = [stackBy, groupedBy].filter((field): field is 'status' | 'priority' | 'wave' | 'session' => field !== 'none');
    const groupedSections = (() => {
        if (groupedBy === 'none') return [{ id: 'all', label: null as string | null, tickets }];

        const buckets = new Map<string, Ticket[]>();
        const orderedStatus = ['backlog', 'todo', 'reopen', 'done', 'reviewed', 'observe', 'deferred'];
        const orderedPriority = ['critical', 'high', 'medium', 'low'];

        for (const ticket of tickets) {
            const value = groupedBy === 'status'
                ? ticket.status
                : groupedBy === 'priority'
                    ? ticket.priority
                    : (groupedBy === 'wave' ? ticket.wave : ticket.session)?.trim() || '';
            const key = value || '__empty__';
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key)!.push(ticket);
        }

        const keys = Array.from(buckets.keys()).sort((a, b) => {
            const ordering = groupedBy === 'status' ? orderedStatus : groupedBy === 'priority' ? orderedPriority : null;
            if (ordering) {
                const ai = ordering.indexOf(a);
                const bi = ordering.indexOf(b);
                if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
            }
            if (a === '__empty__') return 1;
            if (b === '__empty__') return -1;
            return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
        });

        return keys.map((key) => ({
            id: key,
            label: key === '__empty__'
                ? groupedBy === 'wave' ? 'No Wave' : groupedBy === 'session' ? 'No Session' : `No ${groupedBy}`
                : key,
            tickets: buckets.get(key) || [],
        }));
    })();

    // Column-level selection state
    const selectedCount = selectedIds ? tickets.filter(t => selectedIds.has(t.id)).length : 0;
    const allSelected = tickets.length > 0 && selectedCount === tickets.length;
    const someSelected = selectedCount > 0 && !allSelected;
    const checkboxRef = (el: HTMLInputElement | null) => {
        if (el) el.indeterminate = someSelected;
    };

    return (
        <div
            className={`
                vd-restack-column flex flex-col w-[250px] min-w-[250px] flex-shrink-0 self-stretch
                bg-vd-bg-primary/50 rounded-xl border border-vd-border
                transition-colors
                ${isOver ? 'border-vd-accent-gold bg-vd-accent-gold/5' : ''}
            `}
        >
            {/* Color bar */}
            <div className={`h-1 rounded-t-xl ${colorBar}`} />

            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2.5">
                <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-vd-text-primary">{config.label}</h3>
                    <span className="text-xs text-vd-text-tertiary bg-vd-bg-tertiary rounded-full px-2 py-0.5">
                        {tickets.length}
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    {onSelectColumn && tickets.length > 0 && (
                        <input
                            ref={checkboxRef}
                            type="checkbox"
                            checked={allSelected}
                            onChange={() => onSelectColumn(status)}
                            className="w-3.5 h-3.5 rounded border-vd-border accent-vd-accent-gold cursor-pointer"
                            title={allSelected ? 'Deselect all in column' : 'Select all in column'}
                        />
                    )}
                    <button
                        onClick={() => setShowInstructionEditor(!showInstructionEditor)}
                        className="text-vd-text-tertiary hover:text-vd-text-secondary p-1 rounded transition-colors"
                        title="Edit AI instruction"
                    >
                        ⚙️
                    </button>
                </div>
            </div>

            {/* AI instruction editor */}
            {showInstructionEditor && onUpdateInstruction && (
                <div className="px-3 pb-2">
                    <label className="text-[10px] text-vd-text-tertiary uppercase tracking-wider">AI Instruction</label>
                    <textarea
                        value={instruction}
                        onChange={(e) => setInstruction(e.target.value)}
                        onBlur={() => {
                            if (instruction !== config.aiInstruction) {
                                onUpdateInstruction(status, instruction);
                            }
                            setShowInstructionEditor(false);
                        }}
                        rows={2}
                        className="w-full mt-1 text-xs bg-vd-bg-input border border-vd-border rounded-md px-2 py-1.5 text-vd-text-secondary focus:border-vd-accent-gold focus:outline-none resize-none"
                        autoFocus
                    />
                </div>
            )}

            {/* Cards */}
            <div ref={setNodeRef} className="flex-1 px-2 pt-1 pb-2 space-y-2 min-h-[80px] overflow-y-auto">
                <SortableContext items={ticketIds} strategy={verticalListSortingStrategy}>
                    {groupedSections.map((section) => (
                        <div key={section.id} className="space-y-2">
                            {section.label && (
                                <div className="sticky top-0 z-[1] rounded-md border border-vd-border/60 bg-vd-bg-primary/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-vd-text-tertiary backdrop-blur-sm">
                                    {section.label}
                                </div>
                            )}
                            {section.tickets.map((ticket) => (
                                <TicketCard
                                    key={ticket.id}
                                    ticket={ticket}
                                    onClick={() => onTicketClick(ticket)}
                                    onToggleAi={onToggleAi}
                                    isSelected={selectedIds?.has(ticket.id) ?? false}
                                    onToggleSelect={onToggleSelect}
                                    isDragDisabled={isDragDisabled}
                                    readTickets={readTickets}
                                    activeExecutionIds={activeExecutionIds}
                                    activeRunStatus={activeRunStatusByTicket?.get(String(ticket.id).toUpperCase())}
                                    hiddenFields={hiddenFields}
                                />
                            ))}
                        </div>
                    ))}
                </SortableContext>
                {tickets.length === 0 && (
                    <div className="text-center text-xs text-vd-text-tertiary py-6 opacity-50">
                        No tickets
                    </div>
                )}
            </div>

            {/* Add ticket button — only shown when handler provided */}
            {onAddTicket && (
                <div className="px-2 pb-2">
                    <button
                        onClick={() => onAddTicket(status)}
                        className="w-full py-1.5 text-xs text-vd-text-tertiary hover:text-vd-text-secondary hover:bg-vd-bg-hover rounded-lg border border-dashed border-vd-border hover:border-vd-text-tertiary transition-colors"
                    >
                        + Add ticket
                    </button>
                </div>
            )}
        </div>
    );
}
