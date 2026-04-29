'use client';

import { PhaseStatusBar } from './PhaseStatusBar';
import { Ticket } from './TicketCard';

interface ProgressPageProps {
    tickets: Ticket[];
    onClose: () => void;
}

export function ProgressPage({ tickets, onClose }: ProgressPageProps) {
    return (
        <div className="flex-1 flex flex-col min-h-0 bg-vd-bg-primary">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-vd-border">
                <div className="flex items-center gap-3">
                    <h1 className="text-lg font-semibold text-vd-text-primary">Development Progress</h1>
                    <span className="text-sm text-vd-text-tertiary">
                        Track project phases and ticket completion
                    </span>
                </div>
                <button
                    onClick={onClose}
                    className="text-vd-text-tertiary hover:text-vd-text-primary transition-colors"
                    title="Back to Board"
                >
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-6">
                <div className="max-w-6xl mx-auto">
                    <PhaseStatusBar tickets={tickets} className="" />
                </div>
            </div>
        </div>
    );
}