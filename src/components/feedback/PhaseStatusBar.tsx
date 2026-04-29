'use client';

import { useState, useMemo } from 'react';
import { Ticket } from './TicketCard';

interface PhaseStatusBarProps {
    tickets: Ticket[];
    className?: string;
}

interface PhaseStats {
    completed: number;
    inProgress: number;
    planned: number;
    deferred: number;
    total: number;
    progress: number;
}

const PHASE_CONFIG = {
    'phase0': {
        name: 'Phase 0: Foundation',
        color: 'rgb(239, 68, 68)', // red-500
        description: 'Core cleanup and architecture'
    },
    'phase1': {
        name: 'Phase 1: Core Integration',
        color: 'rgb(59, 130, 246)', // blue-500
        description: 'Terminal integration and MVP features'
    },
    'phase2': {
        name: 'Phase 2: Polish & UX',
        color: 'rgb(16, 185, 129)', // emerald-500
        description: 'User experience and onboarding'
    },
    'phase3': {
        name: 'Phase 3: Multi-Agent',
        color: 'rgb(139, 92, 246)', // violet-500
        description: 'Support for multiple AI agents'
    },
    'phase4': {
        name: 'Phase 4: Team Features',
        color: 'rgb(245, 158, 11)', // amber-500
        description: 'Collaboration and cloud sync'
    },
    'phase5': {
        name: 'Phase 5: Launch',
        color: 'rgb(236, 72, 153)', // pink-500
        description: 'Launch materials and marketing'
    },
    'foundation': {
        name: 'Foundation',
        color: 'rgb(107, 114, 128)', // gray-500
        description: 'Basic infrastructure'
    },
    'uncategorized': {
        name: 'Other',
        color: 'rgb(75, 85, 99)', // gray-600
        description: 'Miscellaneous tickets'
    }
} as const;

const STATUS_CATEGORIES = {
    'done': 'completed',
    'reviewed': 'completed',
    'observe': 'completed',
    'todo': 'planned',
    'in_progress': 'inProgress',
    'reopen': 'inProgress',
    'backlog': 'planned',
    'deferred': 'deferred'
} as const;

export function PhaseStatusBar({ tickets, className = '' }: PhaseStatusBarProps) {
    const [selectedPhase, setSelectedPhase] = useState<string | null>(null);
    const [showDetails, setShowDetails] = useState(false);

    const phaseStats = useMemo(() => {
        const stats: Record<string, PhaseStats> = {};

        // Initialize all phases
        Object.keys(PHASE_CONFIG).forEach(phase => {
            stats[phase] = {
                completed: 0,
                inProgress: 0,
                planned: 0,
                deferred: 0,
                total: 0,
                progress: 0
            };
        });

        // Process tickets
        tickets.forEach(ticket => {
            const tags = ticket.tags || [];
            const statusCategory = STATUS_CATEGORIES[ticket.status as keyof typeof STATUS_CATEGORIES] || 'planned';

            // Find phase from tags
            let phase = 'uncategorized';
            for (const tag of tags) {
                if (PHASE_CONFIG[tag as keyof typeof PHASE_CONFIG]) {
                    phase = tag;
                    break;
                }
            }
            // Special handling for foundation tickets
            if (tags.includes('foundation') || tags.includes('nextjs') || tags.includes('typescript')) {
                phase = 'foundation';
            }

            if (!stats[phase]) {
                stats[phase] = { completed: 0, inProgress: 0, planned: 0, deferred: 0, total: 0, progress: 0 };
            }

            stats[phase][statusCategory]++;
            stats[phase].total++;
        });

        // Calculate progress percentages
        Object.keys(stats).forEach(phase => {
            const phaseStats = stats[phase];
            phaseStats.progress = phaseStats.total > 0
                ? Math.round((phaseStats.completed / phaseStats.total) * 100)
                : 0;
        });

        return stats;
    }, [tickets]);

    const overallStats = useMemo(() => {
        const total = tickets.length;
        const completed = Object.values(phaseStats).reduce((sum, phase) => sum + phase.completed, 0);
        const inProgress = Object.values(phaseStats).reduce((sum, phase) => sum + phase.inProgress, 0);
        const planned = Object.values(phaseStats).reduce((sum, phase) => sum + phase.planned, 0);
        const deferred = Object.values(phaseStats).reduce((sum, phase) => sum + phase.deferred, 0);

        return {
            total,
            completed,
            inProgress,
            planned,
            deferred,
            progress: total > 0 ? Math.round((completed / total) * 100) : 0
        };
    }, [phaseStats, tickets.length]);

    const visiblePhases = Object.entries(phaseStats).filter(([_, stats]) => stats.total > 0);

    return (
        <div className={`bg-vd-bg-secondary border border-vd-border rounded-lg p-4 ${className}`}>
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                    <h3 className="text-sm font-semibold text-vd-text-primary">Development Progress</h3>
                    <span className="text-xs text-vd-text-tertiary">
                        {overallStats.progress}% complete ({overallStats.completed}/{overallStats.total} tickets)
                    </span>
                </div>
                <button
                    onClick={() => setShowDetails(!showDetails)}
                    className="text-xs text-vd-accent-gold hover:text-vd-accent-gold-light transition-colors"
                >
                    {showDetails ? 'Hide Details' : 'Show Details'}
                </button>
            </div>

            {/* Overall Progress Bar */}
            <div className="mb-4">
                <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-vd-text-secondary">Overall</span>
                    <div className="flex-1 bg-vd-bg-primary rounded-full h-2 overflow-hidden">
                        <div
                            className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-300"
                            style={{ width: `${overallStats.progress}%` }}
                        />
                    </div>
                    <span className="text-xs text-vd-text-tertiary w-8 text-right">{overallStats.progress}%</span>
                </div>
                <div className="flex gap-4 text-xs text-vd-text-tertiary">
                    <span>✅ {overallStats.completed}</span>
                    <span>🚧 {overallStats.inProgress}</span>
                    <span>📋 {overallStats.planned}</span>
                    <span>⏸️ {overallStats.deferred}</span>
                </div>
            </div>

            {/* Phase Progress Bars */}
            <div className="space-y-2">
                {visiblePhases.map(([phaseKey, stats]) => {
                    const config = PHASE_CONFIG[phaseKey as keyof typeof PHASE_CONFIG];
                    const isSelected = selectedPhase === phaseKey;

                    return (
                        <div key={phaseKey} className="space-y-1">
                            <div
                                className={`flex items-center gap-2 cursor-pointer transition-colors ${
                                    isSelected ? 'text-vd-text-primary' : 'text-vd-text-secondary hover:text-vd-text-primary'
                                }`}
                                onClick={() => setSelectedPhase(isSelected ? null : phaseKey)}
                            >
                                <span className="text-xs font-medium w-36 truncate" title={config.name}>
                                    {config.name}
                                </span>
                                <div className="flex-1 bg-vd-bg-primary rounded-full h-1.5 overflow-hidden">
                                    <div
                                        className="h-full transition-all duration-300"
                                        style={{
                                            width: `${stats.progress}%`,
                                            backgroundColor: config.color
                                        }}
                                    />
                                </div>
                                <span className="text-xs w-8 text-right">{stats.progress}%</span>
                                <span className="text-xs text-vd-text-tertiary w-12 text-right">
                                    {stats.completed}/{stats.total}
                                </span>
                            </div>

                            {/* Phase Details */}
                            {(showDetails || isSelected) && (
                                <div className="ml-2 pl-3 border-l border-vd-border">
                                    <p className="text-xs text-vd-text-tertiary mb-1">{config.description}</p>
                                    <div className="flex gap-4 text-xs">
                                        <span className="text-emerald-400">✅ {stats.completed} completed</span>
                                        <span className="text-blue-400">🚧 {stats.inProgress} in progress</span>
                                        <span className="text-yellow-400">📋 {stats.planned} planned</span>
                                        {stats.deferred > 0 && (
                                            <span className="text-gray-400">⏸️ {stats.deferred} deferred</span>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Development Sessions Status */}
            <div className="mt-4 pt-3 border-t border-vd-border">
                <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-vd-text-secondary">Current Session Focus</span>
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                            <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                            <span className="text-xs text-vd-text-tertiary">Phase 0 & 1 Active</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}