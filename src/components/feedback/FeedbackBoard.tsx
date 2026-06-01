'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    DndContext,
    DragEndEvent,
    DragOverlay,
    DragStartEvent,
    PointerSensor,
    TouchSensor,
    KeyboardSensor,
    closestCorners,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import { KanbanColumn } from './KanbanColumn';
import { Ticket, TicketCardOverlay, TicketComment } from './TicketCard';
import { NewTicketModal } from './NewTicketModal';
import { TicketDetailModal } from './TicketDetailModal';
import { compressImage } from '@/lib/feedback/imageCompress';
import { BatchPane, Batch } from './BatchPane';
import { MissionPage } from './MissionPage';
import type { Mission } from './MissionDetailModal';
import { SettingsModal, initSkin } from './SettingsModal';
import { TerminalPane, getSavedPlacement, type TerminalPlacement } from './TerminalPane';
import { ActivityFeed } from './ActivityFeed';
import { buildRunPrompt } from '@/lib/feedback/runPrompt';
// AD-162: ambient completion signals (tab title + favicon + Notification + sound).
import {
    setRunningTitle,
    setDoneTitle,
    clearTitleOverride,
    startRunningFavicon,
    stopRunningFavicon,
    fireDoneNotification,
    playDoneSound,
    getNotifyPref,
    getSoundPref,
} from '@/lib/feedback/completionNotifier';
import { WelcomeModal } from './WelcomeModal';
import { ActivationChecklist } from './ActivationChecklist';
import { CoachMark } from './CoachMark';
import { ErrorBoundary } from './ErrorBoundary';
import { ChatPane } from './ChatPane';
import { OnboardingWizard } from './OnboardingWizard';
import { fetchWithAdhdevToken } from '@/lib/api/sessionToken';
import {
    getLatestCommentCursor,
    LEGACY_READ_TICKETS_KEY,
    migrateLegacyReadTickets,
    READ_CURSORS_KEY,
    type ReadTicketCursors,
} from '@/lib/feedback/readState';

// ADHDev brand icon — detailed brain with multi-directional arrows (v2 SVG)
function ADHDevIcon({ className = 'w-6 h-6' }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 200 194" fill="none">
            {/* Brain */}
            <g transform="translate(38.56, 39.39)">
                <path fill="currentColor" d="M60.89,8.37c2.99-4.67,6.96-7.16,11.12-8.03c3.95-0.82,8-0.11,11.49,1.65c3.44,1.74,6.39,4.52,8.2,7.88 c0.68,1.26,1.21,2.6,1.55,3.98c2.03-0.04,4.1,0.31,6.11,0.99c3.82,1.29,7.49,3.82,10.33,7.17c2.85,3.37,4.88,7.62,5.4,12.33 c0.24,2.17,0.15,4.43-0.32,6.74c2.09,1.87,3.83,3.98,5.14,6.23c2.03,3.47,3.09,7.32,2.98,11.23c-0.11,3.94-1.41,7.88-4.09,11.51 c-1.69,2.29-3.92,4.44-6.73,6.37c0.26,6.02-1.52,11.42-4.4,15.6c-3.26,4.72-7.98,7.92-12.88,8.78c-1.08,4.19-3.86,7.88-7.45,10.45 c-4.54,3.25-10.46,4.78-15.87,3.3c-3.99-1.09-7.62-3.73-10.11-8.38c-3.03,5.11-7.19,7.81-11.55,8.72 c-5.23,1.09-10.64-0.52-14.72-3.7c-3.26-2.54-5.71-6.11-6.59-10.16c-1.71-0.07-3.44-0.41-5.13-0.98c-3.73-1.26-7.32-3.7-10.13-6.95 c-2.82-3.25-4.87-7.34-5.51-11.89c-0.33-2.37-0.28-4.85,0.24-7.4c-1.83-1.66-3.4-3.53-4.65-5.56C1.14,64.78-0.05,60.86,0,56.83 c0.05-4.06,1.34-8.18,4.14-12c1.63-2.22,3.78-4.34,6.5-6.28c-0.03-0.74-0.03-1.48-0.01-2.21c0.22-5.93,2.4-11.14,5.59-15.03 c3.3-4.03,7.72-6.67,12.26-7.31l0.02,0c0.16-0.67,0.35-1.32,0.59-1.96c1.46-3.97,4.47-7.34,8.16-9.49 c3.71-2.16,8.17-3.11,12.51-2.21C53.93,1.2,57.9,3.7,60.89,8.37z M93.02,21.89c-0.66,2.18-1.84,4.37-3.64,6.5 c-1.37,1.63-3.8,1.84-5.43,0.47c-1.63-1.37-1.84-3.8-0.47-5.43c2.9-3.45,2.93-7.07,1.4-9.9c-1.06-1.96-2.81-3.6-4.87-4.64 c-2.01-1.01-4.28-1.44-6.44-0.99c-2.88,0.6-5.67,2.83-7.6,7.36c0.03,0.2,0.05,0.41,0.05,0.62v79.69c0.06,0.19,0.11,0.4,0.15,0.6 c1.11,6.75,4.03,10,7.31,10.9c3.03,0.83,6.52-0.14,9.3-2.14c2.73-1.96,4.68-4.82,4.7-7.83c0.03-3.43-2.49-7.31-9.23-10.75 c-1.91-0.97-2.66-3.31-1.69-5.22c0.97-1.91,3.31-2.66,5.22-1.69c7.44,3.8,11.36,8.46,12.8,13.17c2.39-0.78,4.71-2.6,6.47-5.14 c2.21-3.19,3.46-7.48,2.86-12.3c-0.35-1.65,0.37-3.41,1.9-4.3c2.92-1.71,5.07-3.6,6.53-5.59c1.66-2.24,2.46-4.62,2.53-6.96 c0.07-2.36-0.61-4.74-1.91-6.96c-1.19-2.03-2.87-3.9-4.98-5.48c-1.47-0.98-2.17-2.87-1.57-4.62c0.71-2.1,0.9-4.14,0.69-6.06 c-0.33-3.02-1.67-5.77-3.54-8c-1.89-2.24-4.31-3.92-6.78-4.75C95.5,22.01,94.22,21.81,93.02,21.89z M28.85,93.03 c1.54-4.84,5.6-9.67,13.26-13.58c1.91-0.97,4.24-0.22,5.22,1.69c0.97,1.91,0.22,4.24-1.69,5.22c-7.1,3.63-9.77,7.79-9.77,11.42 c0,2.83,1.61,5.48,3.96,7.31c2.38,1.85,5.46,2.81,8.36,2.21c3.62-0.75,7.11-4.1,8.92-11.39V19.22C55.3,11.98,51.81,8.65,48.2,7.9 c-2.38-0.5-4.91,0.07-7.07,1.33c-2.18,1.27-3.94,3.22-4.77,5.47c-1.11,3-0.45,6.69,3.3,10.16c1.56,1.45,1.66,3.88,0.21,5.44 c-1.45,1.56-3.88,1.66-5.44,0.21c-2.92-2.7-4.72-5.57-5.62-8.43c-2.3,0.55-4.57,2.07-6.4,4.3c-2.15,2.62-3.62,6.16-3.77,10.23 c-0.04,1.08,0.02,2.22,0.18,3.39l-0.01,0c0.21,1.52-0.47,3.09-1.86,3.95c-2.81,1.73-4.89,3.63-6.34,5.61 c-1.76,2.4-2.57,4.92-2.6,7.35c-0.03,2.47,0.73,4.92,2.09,7.13c1.15,1.87,2.73,3.57,4.65,5c1.44,0.99,2.12,2.85,1.53,4.59 c-0.76,2.25-0.93,4.44-0.64,6.47c0.41,2.93,1.77,5.6,3.63,7.75c1.87,2.16,4.23,3.77,6.65,4.59 C26.9,92.8,27.89,92.99,28.85,93.03z M29.73,38.54c1.52-1.49,3.96-1.47,5.46,0.05c1.49,1.52,1.47,3.96-0.05,5.46 c-3.31,3.26-5.04,7.46-5.22,11.76c-0.18,4.43,1.26,8.98,4.28,12.73c1.34,1.66,1.07,4.09-0.59,5.43c-1.66,1.34-4.09,1.07-5.43-0.59 c-4.23-5.24-6.24-11.62-5.98-17.87C22.47,49.29,24.96,43.23,29.73,38.54z M84.51,42.25 c-1.73-1.25-2.11-3.67-0.86-5.4c1.25-1.73,3.67-2.12,5.4-0.86c0.77,0.56,1.5,1.15,2.18,1.77c5.03,4.54,7.78,10.53,8.28,16.73 c0.5,6.14-1.21,12.48-5.08,17.8c-0.57,0.78-1.18,1.54-1.84,2.27c-1.43,1.59-3.87,1.72-5.46,0.29c-1.59-1.43-1.72-3.87-0.29-5.46 c0.48-0.53,0.92-1.08,1.33-1.64c2.76-3.8,3.98-8.3,3.63-12.66c-0.35-4.29-2.25-8.44-5.74-11.58 C85.57,43.07,85.06,42.65,84.51,42.25z" />
            </g>
            {/* Arrows */}
            <g fill="none" stroke="currentColor" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round">
                <line x1="100" y1="27" x2="100" y2="10" /><polyline points="94,16 100,10 106,16" />
                <line x1="100" y1="167" x2="100" y2="184" /><polyline points="94,178 100,184 106,178" />
                <line x1="30" y1="97" x2="13" y2="97" /><polyline points="19,91 13,97 19,103" />
                <line x1="170" y1="97" x2="187" y2="97" /><polyline points="181,91 187,97 181,103" />
                <line x1="50" y1="47" x2="38" y2="35" /><polyline points="46,36 38,35 39,43" />
                <line x1="150" y1="47" x2="162" y2="35" /><polyline points="154,36 162,35 161,43" />
                <line x1="50" y1="147" x2="38" y2="159" /><polyline points="39,151 38,159 46,158" />
                <line x1="150" y1="147" x2="162" y2="159" /><polyline points="161,151 162,159 154,158" />
            </g>
        </svg>
    );
}

// ADHDev brand text with Press Start 2P pixel font
function ADHDevBrand({ size = 'sm' }: { size?: 'sm' | 'xs' | 'base' }) {
    const textClass = size === 'base' ? 'text-sm' : size === 'xs' ? 'text-[7px]' : 'text-xs';
    return (
        <span className={`${textClass} tracking-tight text-vd-accent-gold`} style={{ fontFamily: '"Press Start 2P", cursive' }}>
            ADHDev
        </span>
    );
}

// AD-165: ADHDev loading screen with personality. Replaces the plain
// "Loading feedback board..." with a glowing brain mark, the pixel-font
// wordmark, and a rotating tagline so a slow first-paint feels intentional
// instead of dead. No "feedback board" framing — this app is ADHDev.
const BOARD_LOADING_TAGLINES = [
    'wiring up the brain…',
    'rounding up the agents…',
    'sweeping the backlog…',
    'lighting up the board…',
    'syncing tickets and missions…',
    'briefing the coding agents…',
];
function BoardLoadingScreen() {
    // Start at a deterministic index so SSR and the client's first render
    // agree (Math.random in useState would hydration-mismatch). The random
    // pick + rotation kick in after mount.
    const [taglineIndex, setTaglineIndex] = useState(0);
    useEffect(() => {
        setTaglineIndex(Math.floor(Math.random() * BOARD_LOADING_TAGLINES.length));
        const interval = setInterval(() => {
            setTaglineIndex(i => (i + 1) % BOARD_LOADING_TAGLINES.length);
        }, 3600);
        return () => clearInterval(interval);
    }, []);
    return (
        <div className="min-h-screen bg-vd-bg-primary flex items-center justify-center">
            <div className="flex flex-col items-center gap-5">
                <ADHDevIcon className="w-16 h-16 adhdev-loading-glow" />
                <ADHDevBrand size="base" />
                <div className="flex items-center gap-2 mt-1">
                    <span className="adhdev-loading-dot" />
                    <span className="adhdev-loading-dot" />
                    <span className="adhdev-loading-dot" />
                </div>
                <p
                    key={taglineIndex}
                    className="adhdev-loading-tagline text-vd-text-secondary text-xs tracking-wide"
                >
                    {BOARD_LOADING_TAGLINES[taglineIndex]}
                </p>
            </div>
        </div>
    );
}

interface ColumnConfig {
    label: string;
    aiInstruction: string;
}

interface FeedbackData {
    nextId: number;
    columns: Record<string, ColumnConfig>;
    tickets: Ticket[];
    missions?: Mission[];
    activeRuns?: Array<{
        runId: string;
        ticketIds: string[];
        status: 'dispatching' | 'running' | 'finishing' | 'done' | 'blocked' | 'failed' | 'interrupted' | 'stale';
        agent?: string;
    }>;
}

const COLUMN_ORDER = ['backlog', 'todo', 'reopen', 'done', 'reviewed', 'observe', 'deferred'];

const COLUMN_COLORS: Record<string, string> = {
    backlog: 'bg-red-500',
    todo: 'bg-amber-500',
    reopen: 'bg-purple-500',
    done: 'bg-emerald-500',
    reviewed: 'bg-green-500',
    observe: 'bg-cyan-500',
    deferred: 'bg-slate-500',
};
const STATUS_LABELS: Record<string, string> = {
    backlog: 'Backlog',
    todo: 'Todo',
    reopen: 'Reopen',
    done: 'For Review',
    reviewed: 'Closed',
    observe: 'Observe',
    deferred: 'Deferred',
};

const PRIORITY_COLORS_SIMPLE: Record<string, string> = {
    critical: 'text-red-400',
    high: 'text-orange-400',
    medium: 'text-yellow-400',
    low: 'text-blue-400',
};

const PRIORITY_SORT_ORDER: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
};
const FEEDBACK_POLL_MS = 2500;
// AD-012: cross-tab broadcast channel. Renamed in the past; worst case during
// a cutover is a stale tab missing one round of cross-tab updates until refresh.
const FEEDBACK_BROADCAST_CHANNEL = 'adhdev-feedback-board';
type PriorityFilter = Ticket['priority'];
type SortBy = 'default' | 'priority' | 'newest' | 'updated';
type TimeFilter = 'all' | 'today' | '7d' | '30d';
type TypeFilter = 'all' | 'normal' | 'discussion';
type StackField = 'status' | 'wave' | 'session' | 'priority';
type GroupField = 'none' | StackField;
const HIDDEN_LANES_KEY = 'adhdev-hidden-status-lanes';

interface StackGroup {
    id: string;
    value: string;
    label: string;
    colorBar: string;
    instruction?: string;
}

const STACK_FIELD_OPTIONS: Array<{ value: StackField; label: string }> = [
    { value: 'status', label: 'Status' },
    { value: 'wave', label: 'Wave' },
    { value: 'session', label: 'Session' },
    { value: 'priority', label: 'Priority' },
];

const EMPTY_STACK_VALUE = '__empty__';
// AD-320: "Unset" lane id for tickets whose priority is missing or not one
// of the canonical four. dnd-kit needs a non-empty string id, so the lane is
// keyed by '__unset_priority__' internally and translated back to '' when
// the PATCH fires (the API treats falsy priority as "no priority set").
const UNSET_PRIORITY_ID = '__unset_priority__';
const PRIORITY_GROUP_ORDER: string[] = ['critical', 'high', 'medium', 'low', UNSET_PRIORITY_ID];
const PRIORITY_GROUP_META: Record<string, { label: string; colorBar: string }> = {
    critical: { label: 'Critical', colorBar: 'bg-red-500' },
    high: { label: 'High', colorBar: 'bg-orange-500' },
    medium: { label: 'Medium', colorBar: 'bg-yellow-500' },
    low: { label: 'Low', colorBar: 'bg-blue-500' },
    [UNSET_PRIORITY_ID]: { label: 'Unset', colorBar: 'bg-slate-500' },
};
const CANONICAL_PRIORITIES = new Set(['critical', 'high', 'medium', 'low']);
const PLANNING_COLOR_BARS = ['bg-cyan-500', 'bg-sky-500', 'bg-teal-500', 'bg-fuchsia-500', 'bg-violet-500', 'bg-emerald-500'];

function matchesTimeFilter(value: string | undefined | null, filter: TimeFilter): boolean {
    if (filter === 'all') return true;
    if (!value) return false;
    const ts = new Date(value).getTime();
    if (!Number.isFinite(ts)) return false;
    if (filter === 'today') {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        return ts >= start.getTime();
    }
    const days = filter === '7d' ? 7 : 30;
    return ts >= Date.now() - days * 24 * 60 * 60 * 1000;
}

function parseSequenceLabel(value: string): number | null {
    const match = value.match(/(\d+)/);
    return match ? Number.parseInt(match[1], 10) : null;
}

function sortPlanningValues(values: string[]): string[] {
    return [...values].sort((a, b) => {
        const aNum = parseSequenceLabel(a);
        const bNum = parseSequenceLabel(b);
        if (aNum !== null && bNum !== null && aNum !== bNum) return aNum - bNum;
        if (aNum !== null && bNum === null) return -1;
        if (aNum === null && bNum !== null) return 1;
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });
}

export function FeedbackBoard({ embedded = false }: { embedded?: boolean }) {
    const [data, setData] = useState<FeedbackData | null>(null);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [priorityFilter, setPriorityFilter] = useState<PriorityFilter[]>([]);
    const [statusFilter, setStatusFilter] = useState<string[]>([]);
    const [createdTimeFilter, setCreatedTimeFilter] = useState<TimeFilter>('all');
    const [updatedTimeFilter, setUpdatedTimeFilter] = useState<TimeFilter>('all');
    const [aiFilter, setAiFilter] = useState<'all' | 'yes' | 'no'>('all');
    const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
    const [missionFilter, setMissionFilter] = useState('all');
    const [batchFilter, setBatchFilter] = useState<'all' | 'unplanned' | 'planned'>('all');
    const [creatorFilter, setCreatorFilter] = useState<'all' | 'human' | 'ai'>('all');
    // AD-180: hide tickets that are sub-tasks of another ticket (i.e. tickets
    // whose `relations` includes a `parent` edge) from the kanban. Default
    // off so today's behaviour is preserved.
    const [hideSubtasks, setHideSubtasks] = useState(false);
    const [hiddenStatusIds, setHiddenStatusIds] = useState<Set<string>>(() => {
        if (typeof window === 'undefined') return new Set();
        try {
            const parsed = JSON.parse(localStorage.getItem(HIDDEN_LANES_KEY) || '[]');
            return new Set(Array.isArray(parsed) ? parsed.filter((id) => COLUMN_ORDER.includes(id)) : []);
        } catch { return new Set(); }
    });
    const searchRef = useRef<HTMLInputElement>(null);
    const [sortBy, setSortBy] = useState<SortBy>('updated');
    const [stackBy, setStackBy] = useState<StackField>('status');
    const [groupedBy, setGroupedBy] = useState<GroupField>('none');
    const [showNewTicket, setShowNewTicket] = useState(false);
    const [newTicketDefaultStatus, setNewTicketDefaultStatus] = useState<string | undefined>(undefined);
    // AD-180 follow-up: when "+ Create new sub-task" is clicked from the
    // Linked panel, store the parent ticket id so NewTicketModal can pre-fill
    // a `parent` relation. Cleared when the modal closes.
    const [newTicketParentId, setNewTicketParentId] = useState<string | null>(null);
    const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [isMobile, setIsMobile] = useState(false);
    const [mobileTab, setMobileTab] = useState('backlog');
    const [boardDragOver, setBoardDragOver] = useState(false);
    const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
    const [showDropChoice, setShowDropChoice] = useState(false);
    const [pendingDropFiles, setPendingDropFiles] = useState<File[]>([]);
    const [creatingSeparate, setCreatingSeparate] = useState(false);

    // Selection state for "Copy for AI" workflow (ephemeral — resets on reload)
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    // Batch state — loaded from API (.adhdev/board.json), synced via fetchData polling
    const [batches, setBatches] = useState<Batch[]>([]);
    const [showBatchPane, setShowBatchPane] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [projects, setProjects] = useState<{ id: string; name: string; path: string }[]>([]);
    const [activeProjectId, setActiveProjectId] = useState<string | null>(() => {
        if (typeof window === 'undefined') return null;
        return sessionStorage.getItem('adhdev-active-project-id');
    });
    const [showProjectSwitcher, setShowProjectSwitcher] = useState(false);
    const [switchingProjectId, setSwitchingProjectId] = useState<string | null>(null);
    // AD-286: "+ Add project" now launches the full OnboardingWizard (folder
    // pick + agent + git posture) instead of the legacy 3-field inline form,
    // matching the first-run flow.
    const [showAddProjectWizard, setShowAddProjectWizard] = useState(false);
    // AD-128: flag a broken or outdated system `claude` so Run / manual REPL use isn't silently stuck.
    const [claudeHealth, setClaudeHealth] = useState<{ ok: boolean; version: string | null; outdated: boolean; error: string | null } | null>(null);
    const [claudeBannerDismissed, setClaudeBannerDismissed] = useState<boolean>(() => {
        if (typeof window === 'undefined') return false;
        return sessionStorage.getItem('adhdev-claude-banner-dismissed') === '1';
    });
    // AD-228: Install-in-progress state for the friendly first-run install card.
    // Drives the re-probe loop that auto-dismisses the banner once `claude` is
    // detected after the install completes (or after a 3-minute timeout).
    const [claudeInstallInProgress, setClaudeInstallInProgress] = useState(false);
    // AD-236: session-only tip dismissal. Replaces the previous permanent
    // hideTips flip — that was destructive (one click, no undo from the UI).
    // Now the tip popover button hides tips for the current session only;
    // they return on next launch. Permanent dismissal still lives in
    // Settings → "Hide tips" toggle for users who genuinely want them gone.
    const [tipsHiddenThisSession, setTipsHiddenThisSession] = useState<boolean>(() => {
        if (typeof window === 'undefined') return false;
        return sessionStorage.getItem('adhdev-tips-hidden-session') === '1';
    });
    // AD-011: configured user display name. Replaces hardcoded 'Sameer' in
    // optimistic comments + mission decision authoring. Refetched on project
    // switch so the per-project config is honoured.
    const [userDisplayName, setUserDisplayName] = useState('You');
    const [showTerminal, setShowTerminal] = useState(false);
    // AD-181: chat slide-in panel — separate from the terminal pane.
    const [showChat, setShowChat] = useState(false);
    // AD-194: chat-triage in-flight signal lifted from ChatPane so the
    // topbar Brain Dump button can render a pulse even when the panel
    // is closed.
    const [chatProcessing, setChatProcessing] = useState(false);
    // AD-186: drives ChatPane's scroll-to-message effect when a "via chat"
    // link or breadcrumb-id click fires from a ticket comment / detail.
    const [chatScrollToId, setChatScrollToId] = useState<string | null>(null);
    const openChatMessage = useCallback((messageId: string) => {
        setSelectedTicket(null);
        setShowChat(true);
        setChatScrollToId(messageId);
    }, []);
    // AD-144 reopen: track whether the terminal has ever been opened. Once it
    // has, we keep TerminalPane mounted (hidden via display:none when the user
    // closes it) so xterm's 10k-line scrollback survives pane toggles. Before
    // first open we skip mounting entirely so there's no WebSocket for users
    // who never open the terminal.
    const [terminalMountedOnce, setTerminalMountedOnce] = useState(false);
    useEffect(() => {
        if (showTerminal && !terminalMountedOnce) setTerminalMountedOnce(true);
    }, [showTerminal, terminalMountedOnce]);
    const [termFullscreen, setTermFullscreen] = useState(false);
    const [terminalRuntime, setTerminalRuntime] = useState<{
        connected: boolean;
        agentStatus: 'inactive' | 'running';
        agentName: string | null;
        requestStatus: 'idle' | 'dispatching' | 'running' | 'interrupted';
    }>({
        connected: false,
        agentStatus: 'inactive',
        agentName: null,
        requestStatus: 'idle',
    });
    const [terminalExecutionIds, setTerminalExecutionIds] = useState<Set<string>>(new Set());
    const [termPlacement, setTermPlacement] = useState<TerminalPlacement>('right');
    // AD-136: onboarding state + events, fetched from /api/onboarding.
    // AD-166: extended with wizard fields (wizardCompleted, wizardStep, etc.).
    const [onboardingState, setOnboardingState] = useState<{
        welcomeSeen?: boolean;
        checklistDismissed?: boolean;
        coachMarks?: Record<string, boolean>;
        hideTips?: boolean;
        wizardCompleted?: boolean;
        wizardStep?: number;
        folderSource?: 'existing' | 'new' | null;
        folderPath?: string | null;
        agentDetected?: string | null;
        populated?: boolean;
        gitPosture?: 'experiment' | 'github' | 'remote' | null;
        remoteUrl?: string | null;
    }>({});
    // AD-166: wizard visibility — driven by onboardingState.wizardCompleted
    // OR a `?wizard=onboarding` query-param escape hatch so the user can replay
    // the wizard without resetting state.
    const [showOnboardingWizard, setShowOnboardingWizard] = useState(false);
    const [onboardingWizardStartStep, setOnboardingWizardStartStep] = useState<number | null>(null);
    const [onboardingEvents, setOnboardingEvents] = useState<Record<string, string>>({});
    // AD-130 fix: gate any onboarding UI until the initial GET completes, otherwise
    // the welcome modal flashes on every page load before the fetch resolves.
    const [onboardingLoaded, setOnboardingLoaded] = useState(false);
    const [showActivityFeed, setShowActivityFeed] = useState(false);
    const [activeView, setActiveView] = useState<'board' | 'missions'>('board');
    const broadcastRef = useRef<BroadcastChannel | null>(null);
    const selectedTicketIdRef = useRef<string | null>(null);
    const pendingMutationCountRef = useRef(0);
    const mutationVersionRef = useRef(0);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const key = '__adhdevProjectScopedFetchPatched';
        const originalKey = '__adhdevOriginalFetch';
        const w = window as typeof window & Record<string, any>;
        if (w[key]) return;
        w[key] = true;
        w[originalKey] = window.fetch.bind(window);
        window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            const originalFetch = w[originalKey] as typeof window.fetch;
            const url = typeof input === 'string'
                ? input
                : input instanceof URL
                    ? input.toString()
                    : input.url;
            const isApiRequest = url.startsWith('/api/') || url.startsWith(`${window.location.origin}/api/`);
            if (!isApiRequest) {
                return originalFetch(input as any, init);
            }

            const projectId = sessionStorage.getItem('adhdev-active-project-id');
            if (!projectId) {
                return originalFetch(input as any, init);
            }

            const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
            headers.set('x-adhdev-project', projectId);
            return originalFetch(input as any, { ...init, headers });
        };
    }, []);

    const beginLocalMutation = useCallback(() => {
        pendingMutationCountRef.current += 1;
        mutationVersionRef.current += 1;
        let finished = false;
        return () => {
            if (finished) return;
            finished = true;
            pendingMutationCountRef.current = Math.max(0, pendingMutationCountRef.current - 1);
        };
    }, []);

    const patchTicketLocally = useCallback((ticketId: string, updater: (ticket: Ticket) => Ticket) => {
        setData(prev => {
            if (!prev) return prev;
            return {
                ...prev,
                tickets: prev.tickets.map(ticket => ticket.id === ticketId ? updater(ticket) : ticket),
            };
        });
        setSelectedTicket(prev => prev && prev.id === ticketId ? updater(prev) : prev);
    }, []);

    const replaceTicketLocally = useCallback((updatedTicket: Ticket) => {
        patchTicketLocally(updatedTicket.id, () => updatedTicket);
    }, [patchTicketLocally]);

    const availableStackFieldOptions = useMemo(
        () => STACK_FIELD_OPTIONS.filter(option => option.value !== 'wave' || missionFilter !== 'all'),
        [missionFilter],
    );

    const toggleArrayFilterValue = useCallback((value: string, setter: (updater: (prev: string[]) => string[]) => void) => {
        setter(prev => prev.includes(value) ? prev.filter(item => item !== value) : [...prev, value]);
    }, []);


    const showToast = useCallback((msg: string, duration = 4000) => {
        if (toastTimer.current) clearTimeout(toastTimer.current);
        setToast(msg);
        toastTimer.current = setTimeout(() => setToast(null), duration);
    }, []);

    const openFeedbackIssue = useCallback(() => {
        const activeProject = projects.find(project => project.id === activeProjectId);
        const body = [
            '## What happened?',
            '',
            '',
            '## What did you expect?',
            '',
            '',
            '## ADHDev diagnostics',
            '',
            `- Project: ${activeProject?.name || 'Unknown'}`,
            `- Tickets: ${data?.tickets.length ?? 0}`,
            `- Active runs: ${data?.activeRuns?.filter(run => ['dispatching', 'running', 'finishing'].includes(run.status)).length ?? 0}`,
            `- Browser: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown'}`,
        ].join('\n');
        const params = new URLSearchParams({
            title: 'Feedback: ',
            body,
        });
        window.open(`https://github.com/sameernoorani1/adhdev/issues/new?${params.toString()}`, '_blank', 'noopener,noreferrer');
    }, [activeProjectId, data?.activeRuns, data?.tickets.length, projects]);

    const toggleSelect = useCallback((id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }, []);

    const selectColumn = useCallback((groupId: string) => {
        if (!data) return;
        const colTicketIds = data.tickets.filter((ticket) => {
            const ticketGroupId =
                stackBy === 'status'
                    ? ticket.status
                    : stackBy === 'priority'
                        // AD-320: route non-canonical priorities (missing,
                        // empty, legacy strings) into the Unset lane id.
                        ? (CANONICAL_PRIORITIES.has(String(ticket.priority || '')) ? ticket.priority : UNSET_PRIORITY_ID)
                        : (stackBy === 'wave' ? ticket.wave : ticket.session)?.trim() || EMPTY_STACK_VALUE;
            return ticketGroupId === groupId;
        }).map(t => t.id);
        setSelectedIds(prev => {
            const allSelected = colTicketIds.every(id => prev.has(id));
            const next = new Set(prev);
            if (allSelected) {
                colTicketIds.forEach(id => next.delete(id));
            } else {
                colTicketIds.forEach(id => next.add(id));
            }
            return next;
        });
    }, [data, stackBy]);

    const clearSelection = useCallback(() => setSelectedIds(new Set()), []);
    const emitBoardRefresh = useCallback(() => {
        try {
            broadcastRef.current?.postMessage({ type: 'feedback-updated' });
        } catch {}
    }, []);

    // Batch helpers — all mutations go through API, then refresh
    const syncBatches = useCallback(async () => {
        try {
            const res = await fetch('/api/feedback/batches');
            if (res.ok) setBatches(await res.json());
        } catch {}
    }, []);

    const handleAddToBatch = useCallback(async () => {
        if (selectedIds.size === 0) return;
        await fetch('/api/feedback/batches', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: `Batch ${batches.length + 1}`, ticketIds: Array.from(selectedIds), source: 'manual' }),
        });
        setSelectedIds(new Set());
        setShowBatchPane(true);
        await syncBatches();
    }, [selectedIds, batches.length, syncBatches]);

    // Plan batches from selected tickets — copies AI prompt to clipboard
    const handleBatchFromSelected = useCallback(async () => {
        if (selectedIds.size === 0) return;
        const ids = Array.from(selectedIds);
        const ticketList = ids.join(', ');
        const text = `Read planning/batch-plan-incremental.md and follow the instructions. Plan batches ONLY from these ${ids.length} selected tickets: ${ticketList}`;
        try {
            await navigator.clipboard.writeText(text);
            showToast(`Copied — paste into your AI agent.`, 3000);
        } catch {
            showToast(`Copy failed. Tell your AI agent: "${text}"`, 5000);
        }
    }, [selectedIds, showToast]);

    const handleRemoveBatch = useCallback(async (id: string) => {
        await fetch(`/api/feedback/batches?id=${id}`, { method: 'DELETE' });
        await syncBatches();
    }, [syncBatches]);

    const handleRemoveTicketFromBatch = useCallback(async (batchId: string, ticketId: string) => {
        // Optimistic: update local, then sync
        const batch = batches.find(b => b.id === batchId);
        if (!batch) return;
        const remaining = batch.ticketIds.filter(t => t !== ticketId);
        if (remaining.length === 0) {
            await handleRemoveBatch(batchId);
            return;
        }
        // Read full data, patch the batch, write back
        const res = await fetch('/api/feedback');
        if (!res.ok) return;
        const feedbackData = await res.json();
        const batchArr = feedbackData.batches || [];
        const idx = batchArr.findIndex((b: Batch) => b.id === batchId);
        if (idx >= 0) {
            batchArr[idx].ticketIds = remaining;
            await fetch('/api/feedback', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ updateBatches: batchArr }),
            });
        }
        await syncBatches();
    }, [batches, handleRemoveBatch, syncBatches]);

    const handleAddTicketToBatch = useCallback(async (batchId: string, ticketId: string) => {
        const res = await fetch('/api/feedback');
        if (!res.ok) return;
        const feedbackData = await res.json();
        const batchArr = feedbackData.batches || [];
        const idx = batchArr.findIndex((b: Batch) => b.id === batchId);
        if (idx >= 0) {
            if (!batchArr[idx].ticketIds.includes(ticketId)) {
                batchArr[idx].ticketIds.push(ticketId);
            }
            await fetch('/api/feedback', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ updateBatches: batchArr }),
            });
        }
        await syncBatches();
    }, [syncBatches]);

    const handleReorderBatches = useCallback((from: number, to: number) => {
        setBatches(prev => {
            const next = [...prev];
            const [moved] = next.splice(from, 1);
            next.splice(to, 0, moved);
            // Persist in background — don't await (no re-fetch that could reset order)
            fetch('/api/feedback', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ updateBatches: next }),
            });
            return next;
        });
    }, []);

    const handleClearAllBatches = useCallback(async () => {
        await fetch('/api/feedback/batches', { method: 'DELETE' });
        setBatches([]);
    }, []);

    const handleRenameBatch = useCallback(async (id: string, name: string) => {
        setBatches(prev => prev.map(b => b.id === id ? { ...b, name } : b)); // optimistic
        const res = await fetch('/api/feedback');
        if (!res.ok) return;
        const feedbackData = await res.json();
        const batchArr = feedbackData.batches || [];
        const idx = batchArr.findIndex((b: Batch) => b.id === id);
        if (idx >= 0) {
            batchArr[idx].name = name;
            await fetch('/api/feedback', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ updateBatches: batchArr }),
            });
        }
    }, []);

    const handleUpdateBatch = useCallback(async (id: string, updates: Partial<Batch>) => {
        setBatches(prev => prev.map(batch => batch.id === id ? { ...batch, ...updates } : batch));
        const res = await fetch('/api/feedback');
        if (!res.ok) return;
        const feedbackData = await res.json();
        const batchArr = feedbackData.batches || [];
        const idx = batchArr.findIndex((b: Batch) => b.id === id);
        if (idx >= 0) {
            batchArr[idx] = { ...batchArr[idx], ...updates };
            await fetch('/api/feedback', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ updateBatches: batchArr }),
            });
        }
    }, []);

    const handleCreateMission = useCallback(async (payload: Partial<Mission>) => {
        const res = await fetch('/api/missions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            showToast('Failed to create mission.', 4000);
            return;
        }
        const created = await res.json();
        setData(prev => prev ? { ...prev, missions: [...(prev.missions || []), created] } : prev);
        showToast(`Created ${created.id}.`, 3000);
        return created as Mission;
    }, [showToast]);

    const handleUpdateMission = useCallback(async (missionId: string, updates: Partial<Mission>) => {
        const res = await fetch('/api/missions', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: missionId, updates }),
        });
        if (!res.ok) {
            showToast('Failed to update mission.', 4000);
            return;
        }
        const updated = await res.json();
        setData(prev => prev ? {
            ...prev,
            missions: (prev.missions || []).map(mission => mission.id === missionId ? updated : mission),
        } : prev);
        showToast(`Saved ${missionId}.`, 3000);
    }, [showToast]);

    const handleDeleteMission = useCallback(async (missionId: string) => {
        const res = await fetch('/api/missions', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: missionId }),
        });
        if (!res.ok) {
            showToast('Failed to delete mission.', 4000);
            return;
        }
        setData(prev => prev ? {
            ...prev,
            missions: (prev.missions || []).filter(mission => mission.id !== missionId),
            tickets: prev.tickets.map(ticket => ticket.missionId === missionId ? { ...ticket, missionId: '' } : ticket),
        } : prev);
        if (missionFilter === missionId) setMissionFilter('all');
        showToast(`Deleted ${missionId}.`, 3000);
    }, [missionFilter, showToast]);

    const handleAddMissionDecision = useCallback(async (missionId: string, content: string) => {
        const res = await fetch('/api/missions', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: missionId, appendDecision: { content, author: userDisplayName } }),
        });
        if (!res.ok) {
            showToast('Failed to add decision.', 4000);
            return;
        }
        const updated = await res.json();
        setData(prev => prev ? {
            ...prev,
            missions: (prev.missions || []).map(mission => mission.id === missionId ? updated : mission),
        } : prev);
        showToast(`Decision added to ${missionId}.`, 3000);
    }, [showToast, userDisplayName]);

    const handleDiscussMission = useCallback(async (missionId: string) => {
        const res = await fetch('/api/discuss-mission', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ missionId }),
        });
        const result = await res.json();
        if (result.success && result.terminal) {
            setShowTerminal(true);
            showToast(result.message || `Sent ${missionId} to the coding agent for planning discussion.`, 3000);
        } else if (result.autoOpenTerminal || !result.agentReady) {
            setShowTerminal(true);
            showToast(result.message || 'Start your coding agent, then discuss again.', 5000);
        } else {
            showToast(result.message || 'Failed to send mission discussion prompt.', 4000);
        }
    }, [showToast]);

    // AD-286: invoked when the wizard's "Add new project" Finish button fires.
    // Creates the project, makes it active, applies the wizard's collected
    // onboarding state to the *new* project (the wizard deferred persistence
    // because the new project didn't exist mid-flow), and refreshes data.
    const handleCreateProjectFromWizard = useCallback(async (state: {
        folderSource?: 'existing' | 'new' | null;
        folderPath?: string | null;
        agentDetected?: string | null;
        populated?: boolean;
        gitPosture?: 'experiment' | 'github' | 'remote' | null;
        remoteUrl?: string | null;
        preferredAgent?: { id: string; variantId: string; customFlags?: string } | null;
    }) => {
        const path = (state.folderPath || '').trim();
        if (!path) {
            showToast('Project path is required.', 3000);
            return;
        }
        try {
            const res = await fetch('/api/projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path }),
            });
            const result = await res.json();
            if (!res.ok || !result.project) {
                showToast(result.error || 'Failed to add project.', 4000);
                return;
            }
            const addedProject = result.project;
            setProjects(prev => {
                const withoutExisting = prev.filter(project => project.id !== addedProject.id);
                return [...withoutExisting, addedProject];
            });
            setActiveProjectId(addedProject.id);
            setShowProjectSwitcher(false);
            setShowAddProjectWizard(false);

            // Apply the wizard's collected state to the new (now active) project.
            // registerProject already flips the active project in the registry,
            // so the PATCH below lands on the new project's config.
            try {
                await fetch('/api/onboarding', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        onboardingState: {
                            wizardCompleted: true,
                            wizardStep: 4,
                            folderSource: state.folderSource,
                            folderPath: state.folderPath,
                            agentDetected: state.agentDetected,
                            populated: state.populated,
                            gitPosture: state.gitPosture,
                            remoteUrl: state.remoteUrl,
                            preferredAgent: state.preferredAgent,
                        },
                    }),
                });
            } catch { /* non-fatal — project still created */ }

            const feedbackRes = await fetch('/api/feedback');
            if (feedbackRes.ok) {
                const nextData = await feedbackRes.json();
                setData(nextData);
                if (nextData.batches) setBatches(nextData.batches);
            }
            showToast(`Added ${addedProject.name}.`, 3000);
        } catch {
            showToast('Failed to add project.', 4000);
        }
    }, [showToast]);

    const formatBatchForCopy = useCallback((batch: Batch, index: number, total: number) => {
        // Exclude done/reviewed/observe tickets from the copy
        const doneStatuses = new Set(['done', 'reviewed', 'observe', 'deferred']);
        const activeIds = batch.ticketIds.filter(id => {
            const t = data?.tickets.find(tk => tk.id === id);
            return !t || !doneStatuses.has(t.status);
        });
        if (activeIds.length === 0) return 'All tickets in this batch are already done/reviewed.';
        return buildRunPrompt(activeIds);
    }, [data]);

    const handleCopyBatch = useCallback(async (batch: Batch, index: number, total: number) => {
        const text = formatBatchForCopy(batch, index, total);
        try {
            await navigator.clipboard.writeText(text);
            showToast('Copied — paste into your AI agent.', 3000);
        } catch {
            showToast('Copy failed.', 3000);
        }
    }, [formatBatchForCopy, showToast]);

    const handlePlanBatches = useCallback(async (mode: 'full' | 'incremental') => {
        const file = mode === 'incremental' ? 'planning/batch-plan-incremental.md' : 'planning/batch-plan-full.md';
        const text = `Read ${file} and follow the instructions.`;
        try {
            await navigator.clipboard.writeText(text);
            showToast(`Copied — paste into your AI agent.`, 3000);
        } catch {
            showToast(`Copy failed. Tell your AI agent: "${text}"`, 5000);
        }
    }, [showToast]);

    const handlePlanBatchesInTerminal = useCallback(async (mode: 'full' | 'incremental', ticketIds?: string[]) => {
        try {
            const res = await fetch('/api/plan-batches', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mode,
                    ticketIds: Array.isArray(ticketIds) ? ticketIds : undefined,
                }),
            });
            const result = await res.json();
            if (result.success && result.terminal) {
                setShowTerminal(true);
                showToast(
                    result.message || (ticketIds?.length
                        ? `Sent planning prompt for ${ticketIds.length} selected tickets.`
                        : 'Sent batch planning prompt to coding agent.'),
                    3000,
                );
            } else if (result.autoOpenTerminal || !result.agentReady) {
                setShowTerminal(true);
                showToast(result.message || 'Start your coding agent, then plan again.', 5000);
            } else {
                showToast(result.message || 'Failed to send planning prompt to coding agent.', 4000);
            }
        } catch {
            showToast('Failed to send planning prompt to coding agent.', 4000);
        }
    }, [showToast]);

    // Track the exact latest comment the user has read per ticket.
    const [readTicketCursors, setReadTicketCursors] = useState<ReadTicketCursors>(() => {
        if (typeof window === 'undefined') return {};
        try {
            const stored = localStorage.getItem(READ_CURSORS_KEY);
            return stored ? JSON.parse(stored) : {};
        } catch { return {}; }
    });

    const markTicketRead = useCallback((ticket: Ticket) => {
        const cursor = getLatestCommentCursor(ticket);
        if (!cursor) return;
        setReadTicketCursors(prev => {
            if (prev[ticket.id] === cursor) return prev;
            const next = { ...prev, [ticket.id]: cursor };
            try { localStorage.setItem(READ_CURSORS_KEY, JSON.stringify(next)); } catch {}
            return next;
        });
    }, []);

    useEffect(() => {
        if (!data || typeof window === 'undefined') return;
        if (localStorage.getItem(READ_CURSORS_KEY)) return;
        const legacyRaw = localStorage.getItem(LEGACY_READ_TICKETS_KEY);
        if (!legacyRaw) return;

        try {
            const migrated = migrateLegacyReadTickets(data.tickets, JSON.parse(legacyRaw));
            localStorage.setItem(READ_CURSORS_KEY, JSON.stringify(migrated));
            setReadTicketCursors(migrated);
        } catch {
            localStorage.setItem(READ_CURSORS_KEY, JSON.stringify({}));
        }
    }, [data]);

    const setLaneHidden = useCallback((status: string, hidden: boolean) => {
        setHiddenStatusIds(prev => {
            const next = new Set(prev);
            if (hidden) next.add(status);
            else next.delete(status);
            if (next.size >= COLUMN_ORDER.length) next.delete(status);
            try { localStorage.setItem(HIDDEN_LANES_KEY, JSON.stringify(Array.from(next))); } catch {}
            return next;
        });
    }, []);

    // Load saved skin on mount
    // Init skin + fetch projects on mount
    useEffect(() => {
        initSkin();
        setTermPlacement(getSavedPlacement());
        fetch('/api/projects').then(r => r.json()).then(d => {
            setProjects(d.projects || []);
            setActiveProjectId(prev => prev || d.activeProjectId || null);
        }).catch(() => {});
    }, []);

    // AD-136: fetch onboarding state+events whenever the active project changes.
    // AD-130 fix: flip onboardingLoaded true only after the response lands so nothing
    // renders based on the initial empty default.
    // AD-073 reopen fix: OR-merge with per-project localStorage so a dismissal never
    // un-sticks, even if a race / dev reset / server wipe flips the server flag back.
    useEffect(() => {
        setOnboardingLoaded(false);
        const keyFor = (f: string) => `adhdev-onboard:${activeProjectId || 'default'}:${f}`;
        const readLocal = (f: string): boolean => {
            if (typeof window === 'undefined') return false;
            return window.localStorage.getItem(keyFor(f)) === '1';
        };
        const readLocalCoach = (): Record<string, boolean> => {
            if (typeof window === 'undefined') return {};
            const raw = window.localStorage.getItem(keyFor('coachMarks'));
            if (!raw) return {};
            try { return JSON.parse(raw); } catch { return {}; }
        };
        fetch('/api/onboarding').then(r => r.json()).then(d => {
            const s = d.onboardingState || {};
            setOnboardingState({
                ...s,
                welcomeSeen:        s.welcomeSeen        || readLocal('welcomeSeen'),
                checklistDismissed: s.checklistDismissed || readLocal('checklistDismissed'),
                hideTips:           s.hideTips           || readLocal('hideTips'),
                coachMarks: { ...readLocalCoach(), ...(s.coachMarks || {}) },
            });
            setOnboardingEvents(d.onboardingEvents || {});
            setOnboardingLoaded(true);
        }).catch(() => {
            // Non-fatal: flip the flag anyway so UI unblocks even if the endpoint errored,
            // and still honour any dismissals recorded locally.
            setOnboardingState({
                welcomeSeen: readLocal('welcomeSeen'),
                checklistDismissed: readLocal('checklistDismissed'),
                hideTips: readLocal('hideTips'),
                coachMarks: readLocalCoach(),
            });
            setOnboardingLoaded(true);
        });
    }, [activeProjectId]);

    // AD-137: drag coach mark anchor — find the first rendered ticket card in the DOM.
    // Stored in a ref holder state so CoachMark (which takes a RefObject) can re-position
    // if the target card scrolls or the layout shifts.
    const dragAnchorRef = useRef<HTMLElement | null>(null);
    const [dragAnchorReady, setDragAnchorReady] = useState(false);
    useEffect(() => {
        if (onboardingState.coachMarks?.drag || onboardingState.hideTips) return;
        const tryAttach = () => {
            const el = document.querySelector('[data-ticket-id]') as HTMLElement | null;
            if (el && el !== dragAnchorRef.current) {
                dragAnchorRef.current = el;
                setDragAnchorReady(true);
            }
        };
        tryAttach();
        const t = setTimeout(tryAttach, 400);
        return () => clearTimeout(t);
    }, [data, onboardingState.coachMarks?.drag, onboardingState.hideTips]);

    const patchOnboardingState = useCallback(async (patch: Record<string, unknown>) => {
        // AD-073 reopen fix: write to localStorage synchronously first so a dismissal
        // survives independent of the network PATCH. Keyed per-project so switching
        // projects doesn't cross-pollute.
        if (typeof window !== 'undefined') {
            const projectId = sessionStorage.getItem('adhdev-active-project-id');
            const key = (f: string) => `adhdev-onboard:${projectId || 'default'}:${f}`;
            if (patch.welcomeSeen === true)        window.localStorage.setItem(key('welcomeSeen'),        '1');
            if (patch.checklistDismissed === true) window.localStorage.setItem(key('checklistDismissed'), '1');
            if (patch.hideTips === true)           window.localStorage.setItem(key('hideTips'),           '1');
            if (patch.coachMarks && typeof patch.coachMarks === 'object') {
                const raw = window.localStorage.getItem(key('coachMarks'));
                let existing: Record<string, boolean> = {};
                if (raw) { try { existing = JSON.parse(raw); } catch { /* ignore */ } }
                window.localStorage.setItem(
                    key('coachMarks'),
                    JSON.stringify({ ...existing, ...patch.coachMarks as Record<string, boolean> })
                );
            }
        }
        setOnboardingState(prev => ({ ...prev, ...patch }));
        try {
            await fetch('/api/onboarding', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ onboardingState: patch }),
            });
        } catch { /* optimistic update already applied */ }
    }, []);

    const openCodebaseScan = useCallback(() => {
        setOnboardingWizardStartStep(3);
        setOnboardingState(prev => ({ ...prev, wizardStep: 3, folderSource: 'existing' }));
        setShowOnboardingWizard(true);
    }, []);

    // AD-127: re-apply theme whenever the active project changes so each
    // project keeps its own skin + palette.
    useEffect(() => {
        if (!activeProjectId) return;
        initSkin(activeProjectId);
    }, [activeProjectId]);

    // AD-166: open the onboarding wizard when (a) the URL says so explicitly,
    // or (b) the project hasn't completed it yet. The query-param escape
    // hatch lets the user replay the wizard without nuking onboarding state.
    useEffect(() => {
        if (!onboardingLoaded) return;
        if (typeof window === 'undefined') return;
        const params = new URLSearchParams(window.location.search);
        const explicit = params.get('wizard') === 'onboarding';
        const firstRun = !onboardingState.wizardCompleted && !onboardingState.welcomeSeen;
        if (explicit || firstRun) {
            setShowOnboardingWizard(true);
        }
    }, [onboardingLoaded, onboardingState.wizardCompleted, onboardingState.welcomeSeen]);

    // AD-128: probe the user's system `claude` binary once on mount. If missing,
    // erroring, or pre-2.x, surface a dismissable banner with the correct upgrade
    // command so the user isn't debugging phantom "prompt ignored" issues (AD-133).
    useEffect(() => {
        let cancelled = false;
        // AD-228: ?simulate-claude=not_found|outdated|broken|ok lets us exercise
        // every banner state without uninstalling Claude Code. Critical for
        // verifying the fresh-machine "never detected" path without needing a
        // real fresh-machine sandbox each iteration.
        if (typeof window !== 'undefined') {
            const sim = new URLSearchParams(window.location.search).get('simulate-claude');
            if (sim) {
                const simulated =
                    sim === 'not_found' ? { ok: false, version: null, outdated: false, error: 'not_found' as string | null } :
                    sim === 'outdated' ? { ok: true, version: '1.0.128', outdated: true, error: null } :
                    sim === 'broken' ? { ok: false, version: null, outdated: false, error: 'spawn_failed' as string | null } :
                    sim === 'ok' ? { ok: true, version: '2.5.0', outdated: false, error: null } :
                    null;
                if (simulated) {
                    setClaudeHealth(simulated);
                    return () => { cancelled = true; };
                }
            }
        }
        fetch('/api/claude-version')
            .then(r => r.json())
            .then(d => {
                if (cancelled) return;
                setClaudeHealth({
                    ok: !!d.ok,
                    version: d.version ?? null,
                    outdated: !!d.outdated,
                    error: d.error ?? null,
                });
            })
            .catch(() => {
                if (!cancelled) setClaudeHealth({ ok: false, version: null, outdated: false, error: 'probe_failed' });
            });
        return () => { cancelled = true; };
    }, []);

    // AD-228: re-probe loop after the user kicks off the embedded install.
    // Polls /api/claude-version every 5s for up to 3 minutes; once the probe
    // returns ok+!outdated, the banner auto-dismisses by virtue of the
    // updated claudeHealth state. Caps at 36 attempts to avoid running forever
    // if the install fails silently.
    useEffect(() => {
        if (!claudeInstallInProgress) return;
        let cancelled = false;
        let attempts = 0;
        const intervalId = setInterval(() => {
            if (cancelled) return;
            attempts++;
            if (attempts > 36) {
                setClaudeInstallInProgress(false);
                return;
            }
            fetch('/api/claude-version')
                .then(r => r.json())
                .then(d => {
                    if (cancelled) return;
                    setClaudeHealth({
                        ok: !!d.ok,
                        version: d.version ?? null,
                        outdated: !!d.outdated,
                        error: d.error ?? null,
                    });
                    if (d.ok && !d.outdated) {
                        setClaudeInstallInProgress(false);
                    }
                })
                .catch(() => { /* keep polling */ });
        }, 5000);
        return () => { cancelled = true; clearInterval(intervalId); };
    }, [claudeInstallInProgress]);

    // Poll explicit terminal runtime state for UI status.
    // AD-141: scope the probe to the current board's project so two tabs on
    // different boards no longer see each other's agent/run state.
    // AD-167: gate on document visibility — without this the dev-server log
    // is wall-to-wall /api/terminal-status hits even when the tab is hidden,
    // matching the existing /api/feedback poll convention.
    useEffect(() => {
        const poll = () => {
            if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
            const url = activeProjectId
                ? `/api/terminal-status?project=${encodeURIComponent(activeProjectId)}`
                : '/api/terminal-status';
            fetch(url).then(r => r.json()).then(d => {
                setTerminalRuntime({
                    connected: !!d.connected,
                    agentStatus: d.agentStatus === 'running' ? 'running' : 'inactive',
                    agentName: d.agentName || null,
                    requestStatus: d.requestStatus === 'running' || d.requestStatus === 'dispatching' || d.requestStatus === 'interrupted' ? d.requestStatus : 'idle',
                });
                const nextExecutionIds = new Set<string>(d.requestStatus === 'running' && Array.isArray(d.captureTicketIds) ? d.captureTicketIds : []);
                setTerminalExecutionIds(prev => {
                    if (prev.size === nextExecutionIds.size && Array.from(prev).every(id => nextExecutionIds.has(id))) return prev;
                    return nextExecutionIds;
                });
            }).catch(() => {
                setTerminalRuntime({
                    connected: false,
                    agentStatus: 'inactive',
                    agentName: null,
                    requestStatus: 'idle',
                });
                setTerminalExecutionIds(prev => prev.size === 0 ? prev : new Set());
            });
        };
        poll();
        const interval = setInterval(poll, 2000);
        const onVisible = () => { if (document.visibilityState === 'visible') poll(); };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [activeProjectId]);

    const activeExecutionIds = useMemo(() => {
        const ids = new Set<string>(terminalExecutionIds);
        for (const run of data?.activeRuns || []) {
            if (run.status !== 'running' && run.status !== 'finishing') continue;
            for (const id of run.ticketIds || []) ids.add(String(id).toUpperCase());
        }
        return ids;
    }, [data?.activeRuns, terminalExecutionIds]);

    const activeRunStatusByTicket = useMemo(() => {
        const statuses = new Map<string, 'dispatching' | 'running' | 'finishing'>();
        for (const run of data?.activeRuns || []) {
            if (run.status !== 'dispatching' && run.status !== 'running' && run.status !== 'finishing') continue;
            for (const id of run.ticketIds || []) statuses.set(String(id).toUpperCase(), run.status);
        }
        return statuses;
    }, [data?.activeRuns]);

    // AD-011: pull the configured display name on mount + project switch.
    // The fetch interceptor at the top of this component scopes the request
    // to the active project automatically.
    useEffect(() => {
        let cancelled = false;
        fetch('/api/config').then(r => r.json()).then(d => {
            if (cancelled) return;
            if (typeof d?.userDisplayName === 'string' && d.userDisplayName.trim()) {
                setUserDisplayName(d.userDisplayName.trim());
            }
        }).catch(() => { /* keep existing default */ });
        return () => { cancelled = true; };
    }, [activeProjectId]);

    // When ticket data refreshes, clear read state for tickets with NEW comments since last read
    // (This resets the dot when AI posts a new comment after the user read it)
    /*
    const lastSeenRef = useRef<Record<string, string>>({});
    useEffect(() => {
        if (!data) return;
        for (const t of data.tickets) {
            const lastComment = t.comments.length > 0 ? t.comments[t.comments.length - 1] : null;
            if (!lastComment) continue;
            const lastTime = (lastComment as { createdAt?: string }).createdAt || '';
            const prev = lastSeenRef.current[t.id];
            if (prev && lastTime !== prev && readTickets.has(t.id)) {
                // New comment arrived after user read it — unmark as read
                setReadTickets(old => {
                    const next = new Set(old);
                    next.delete(t.id);
                    try { localStorage.setItem('vd-read-tickets', JSON.stringify(Array.from(next))); } catch {}
                    return next;
                });
            }
            lastSeenRef.current[t.id] = lastTime;
        }
    }, [data, readTickets]);
    */

    // Detect mobile
    useEffect(() => {
        const check = () => setIsMobile(window.innerWidth < 768);
        check();
        window.addEventListener('resize', check);
        return () => window.removeEventListener('resize', check);
    }, []);

    // Mobile swipe between columns with animation
    const touchStartX = useRef(0);
    const touchStartY = useRef(0);
    const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | null>(null);
    const [isAnimating, setIsAnimating] = useState(false);
    const [isRestacking, setIsRestacking] = useState(false);
    const [toast, setToast] = useState<string | null>(null);
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    // AD-189: showPlanChoice removed — Plan Batches button moved into BatchPane.
    const [showFilters, setShowFilters] = useState(false);
    const filterRef = useRef<HTMLDivElement>(null);
    const newTicketButtonRef = useRef<HTMLButtonElement | null>(null);
    const brainDumpButtonRef = useRef<HTMLButtonElement | null>(null);
    const liveActiveRun = useMemo(() => {
        const runs = data?.activeRuns || [];
        return runs.find(run => run.status === 'running' || run.status === 'finishing')
            || runs.find(run => run.status === 'dispatching')
            || null;
    }, [data?.activeRuns]);
    const terminalRequestDispatching = terminalRuntime.requestStatus === 'dispatching';
    const terminalRunDispatching = terminalRequestDispatching || liveActiveRun?.status === 'dispatching';
    const terminalRequestRunning = terminalRuntime.requestStatus === 'running';
    const terminalRunRunning = terminalRequestRunning || liveActiveRun?.status === 'running' || liveActiveRun?.status === 'finishing';
    const terminalAgentRunning = terminalRuntime.agentStatus === 'running';
    const terminalAgentName = terminalRunRunning && liveActiveRun?.agent
        ? liveActiveRun.agent
        : terminalRuntime.agentName || liveActiveRun?.agent || 'Agent';
    const terminalLabel = !terminalRuntime.connected
        ? 'Terminal'
        : terminalRunDispatching
            ? 'Sending...'
            : terminalRunRunning
            ? `${terminalAgentName} Running`
            : terminalAgentRunning
                ? `${terminalAgentName} Ready`
                : 'Shell Ready';
    const terminalTitle = !terminalRuntime.connected
        ? 'Open terminal'
        : terminalRunDispatching
            ? 'Prompt sent; waiting for agent activity'
            : terminalRunRunning
            ? `${terminalAgentName} is working`
            : terminalAgentRunning
                ? `${terminalAgentName} is running and idle`
                : 'Shell is connected';
    const markCoachMarkSeen = useCallback((key: string) => {
        void patchOnboardingState({ coachMarks: { ...(onboardingState.coachMarks || {}), [key]: true } });
    }, [onboardingState.coachMarks, patchOnboardingState]);
    const boardCoachmarkHidden = !onboardingLoaded
        || !onboardingState.welcomeSeen
        || !!onboardingState.hideTips
        || tipsHiddenThisSession
        || isMobile
        || !!selectedTicket;
    const activeBoardCoachmark = useMemo(() => {
        if (boardCoachmarkHidden) return null;
        const coachMarks = onboardingState.coachMarks || {};
        const ticketCount = data?.tickets?.length ?? 0;
        if (!coachMarks['new-ticket']) return 'new-ticket';
        if (!coachMarks['brain-dump-main']) return 'brain-dump-main';
        if (!coachMarks.drag && dragAnchorReady && ticketCount >= 2) return 'drag';
        return null;
    }, [
        boardCoachmarkHidden,
        data?.tickets?.length,
        dragAnchorReady,
        onboardingState.coachMarks,
    ]);
    const [sidebarExpanded, setSidebarExpanded] = useState(() => {
        if (typeof window === 'undefined') return false;
        try { return localStorage.getItem('vd-sidebar-expanded') === 'true'; } catch { return false; }
    });

    const switchTab = useCallback((newTab: string, direction: 'left' | 'right') => {
        if (isAnimating) return;
        setIsAnimating(true);
        setSwipeDirection(direction);
        // After slide-out animation, switch tab and slide in
        setTimeout(() => {
            setMobileTab(newTab);
            setSwipeDirection(direction === 'left' ? 'right' : 'left'); // enter from opposite side
            // After a frame, clear direction to trigger slide-in
            requestAnimationFrame(() => {
                setSwipeDirection(null);
                setTimeout(() => setIsAnimating(false), 200);
            });
        }, 150);
    }, [isAnimating]);

    const restackReadyRef = useRef(false);
    useEffect(() => {
        if (!restackReadyRef.current) {
            restackReadyRef.current = true;
            return;
        }
        setIsRestacking(true);
        const timer = setTimeout(() => setIsRestacking(false), 700);
        return () => clearTimeout(timer);
    }, [stackBy, groupedBy, sortBy]);

    useEffect(() => {
        if (groupedBy === stackBy) {
            setGroupedBy('none');
        }
    }, [groupedBy, stackBy]);

    // AD-222: when entering a mission, auto-switch the board's primary
    // grouping to Wave (since waves are the mission's planned sequence).
    // Leaving a mission (filter cleared back to 'all' or '__none__') reverts
    // to the default Status grouping. Switching between missions counts as a
    // re-entry, so each mission gets its Wave default. The user can manually
    // override during a mission session — we only fire on transitions.
    const prevMissionFilterRef = useRef(missionFilter);
    useEffect(() => {
        const prev = prevMissionFilterRef.current;
        if (prev === missionFilter) return;
        prevMissionFilterRef.current = missionFilter;
        const isInMission = (v: string) => v !== 'all' && v !== '__none__';
        if (isInMission(missionFilter)) setStackBy('wave');
        else if (isInMission(prev)) setStackBy('status');
    }, [missionFilter]);

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        touchStartX.current = e.touches[0].clientX;
        touchStartY.current = e.touches[0].clientY;
    }, []);
    const handleTouchEnd = useCallback((e: React.TouchEvent) => {
        const dx = e.changedTouches[0].clientX - touchStartX.current;
        const dy = e.changedTouches[0].clientY - touchStartY.current;
        // Only trigger if horizontal swipe > 60px and more horizontal than vertical
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            const visibleIds = stackBy === 'status'
                ? COLUMN_ORDER.filter(status => !hiddenStatusIds.has(status))
                : COLUMN_ORDER;
            const idx = visibleIds.indexOf(mobileTab);
            if (dx < 0 && idx < visibleIds.length - 1) {
                switchTab(visibleIds[idx + 1], 'left'); // swipe left → next
            } else if (dx > 0 && idx > 0) {
                switchTab(visibleIds[idx - 1], 'right'); // swipe right → prev
            }
        }
    }, [hiddenStatusIds, mobileTab, stackBy, switchTab]);

    // Keyboard shortcuts: Escape to close modals/pane, N to new ticket, B to toggle batch pane, Ctrl+F to search
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ctrl+F → focus app search input; if already focused, fall through to browser search
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                if (document.activeElement === searchRef.current) {
                    // Already focused — let the browser's native search open
                    return;
                }
                e.preventDefault();
                searchRef.current?.focus();
                searchRef.current?.select();
                return;
            }
            // Ctrl+Shift+F → toggle terminal fullscreen
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
                e.preventDefault();
                if (showTerminal) {
                    setTermFullscreen(prev => !prev);
                } else {
                    setShowTerminal(true);
                    setTermFullscreen(true);
                }
                return;
            }
            if (e.key === 'Escape') {
                // Exit terminal fullscreen first
                if (termFullscreen) {
                    setTermFullscreen(false);
                    return;
                }
                // If search is focused, blur it and clear
                if (document.activeElement === searchRef.current) {
                    setSearch('');
                    searchRef.current?.blur();
                    return;
                }
                if (showBatchPane) {
                    setShowBatchPane(false);
                } else if (selectedTicket) {
                    setSelectedTicket(null);
                } else if (showNewTicket) {
                    setShowNewTicket(false);
                }
            }
            const tag = (e.target as HTMLElement)?.tagName;
            const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
            // N to open new ticket (when no modal is open and not in an input)
            if (e.key === 'n' && !selectedTicket && !showNewTicket && !isInput) {
                e.preventDefault();
                setNewTicketDefaultStatus(undefined);
                setShowNewTicket(true);
            }
            // B to toggle batch pane (when no modal is open and not in an input)
            if (e.key === 'b' && !selectedTicket && !showNewTicket && !isInput) {
                e.preventDefault();
                setShowBatchPane(prev => !prev);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedTicket, showNewTicket, showBatchPane, showTerminal, termFullscreen]);

    // Close filter popover on click outside
    useEffect(() => {
        if (!showFilters) return;
        const handleClick = (e: MouseEvent) => {
            if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
                setShowFilters(false);
            }
        };
        setTimeout(() => document.addEventListener('click', handleClick), 0);
        return () => document.removeEventListener('click', handleClick);
    }, [showFilters]);

    // Fetch data — with auto-retry on failure
    const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [fetchError, setFetchError] = useState(false);
    const fetchData = useCallback(async (options?: { force?: boolean }) => {
        const force = options?.force === true;
        if (!force && pendingMutationCountRef.current > 0) {
            return;
        }
        const fetchVersion = mutationVersionRef.current;
        try {
            const res = await fetch('/api/feedback');
            if (res.ok) {
                const d = await res.json();
                if (!force && (pendingMutationCountRef.current > 0 || fetchVersion !== mutationVersionRef.current)) {
                    return;
                }
                setData(d);
                if (d.batches) setBatches(d.batches);
                const selectedId = selectedTicketIdRef.current;
                if (selectedId) {
                    const freshTicket = d.tickets.find((t: Ticket) => t.id === selectedId) || null;
                    setSelectedTicket(freshTicket);
                }
                setFetchError(false);
                // Clear any pending retry
                if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
            } else {
                setFetchError(true);
                // Auto-retry after 3s on server errors (dev server may be restarting)
                if (!retryRef.current) {
                    retryRef.current = setTimeout(() => { retryRef.current = null; fetchData(); }, 3000);
                }
            }
        } catch {
            setFetchError(true);
            // Auto-retry on network errors
            if (!retryRef.current) {
                retryRef.current = setTimeout(() => { retryRef.current = null; fetchData(); }, 3000);
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    useEffect(() => {
        selectedTicketIdRef.current = selectedTicket?.id ?? null;
    }, [selectedTicket]);

    useEffect(() => {
        if (typeof window === 'undefined' || !activeProjectId) return;
        sessionStorage.setItem('adhdev-active-project-id', activeProjectId);
    }, [activeProjectId]);

    // AD-145 / AD-162: live-update the browser tab title + favicon so they
    // always reflect both the active project AND the current run state.
    // - Idle: `ADHDev — <Project>` and the static AD favicon.
    // - Running: `▶ AD-XXX running — ADHDev — <Project>` and an animated AD
    //   favicon swapping every 800 ms.
    // - Just completed (running → idle edge): `✓ AD-XXX done — ADHDev — <Project>`
    //   for 30 s, then auto-revert. Fires a Notification + sound on the same
    //   edge if the user enabled the toggles in Settings.
    // We need the project name + current run state in one effect because the
    // notifier owns document.title — splitting these would race (two effects
    // both writing document.title would fight on every poll tick).
    const projectNameForTitle = projects.find(p => p.id === activeProjectId)?.name ?? null;
    const prevRequestStatusRef = useRef<'idle' | 'dispatching' | 'running' | 'interrupted'>('idle');
    const lastActiveTicketsRef = useRef<string[]>([]);
    useEffect(() => {
        if (typeof document === 'undefined') return;
        const status = terminalRuntime.requestStatus;
        const prev = prevRequestStatusRef.current;
        const ticketIds = Array.from(activeExecutionIds);

        // Capture the ticket IDs at the moment a run starts so the "done"
        // title at the running→idle edge still names them — by the time the
        // edge fires, activeExecutionIds is already empty.
        if (status === 'running') {
            lastActiveTicketsRef.current = ticketIds;
        }

        // Idle → running edge: switch chrome to running mode.
        if (status === 'running' && prev !== 'running') {
            setRunningTitle(ticketIds, projectNameForTitle);
            startRunningFavicon();
        }
        // Running → not-running edge: treat 'idle' as a successful completion
        // (fire celebration signals), 'interrupted' as a quiet stop.
        else if (prev === 'running' && status !== 'running') {
            stopRunningFavicon();
            const captured = lastActiveTicketsRef.current;
            if (status === 'idle') {
                setDoneTitle(captured, projectNameForTitle);
                if (getNotifyPref()) fireDoneNotification(captured, projectNameForTitle);
                if (getSoundPref()) playDoneSound();
            } else {
                // interrupted — no celebration; revert silently.
                clearTitleOverride(projectNameForTitle);
            }
            lastActiveTicketsRef.current = [];
        }
        // Steady running: keep the title fresh in case ticket IDs or the
        // project name changed mid-run (e.g. the user switches projects).
        else if (status === 'running') {
            setRunningTitle(ticketIds, projectNameForTitle);
        }
        // Steady idle: keep the title in sync with the project name on mount
        // / project switches. Skip while a Done window is in flight (title
        // starts with ✓) so the notifier's 30 s revert timer owns that band.
        else if (status === 'idle' && prev !== 'running') {
            const current = document.title;
            const expected = projectNameForTitle ? `ADHDev — ${projectNameForTitle}` : 'ADHDev';
            if (!current.startsWith('✓ ') && current !== expected) {
                clearTitleOverride(projectNameForTitle);
            }
        }

        prevRequestStatusRef.current = status;
    }, [terminalRuntime.requestStatus, activeExecutionIds, projectNameForTitle]);

    // AD-162: cleanup on unmount — stop favicon animation + revert title to
    // a sensible default if the board view is torn down mid-run.
    useEffect(() => {
        return () => {
            stopRunningFavicon();
            if (typeof document !== 'undefined') {
                document.title = projectNameForTitle ? `ADHDev — ${projectNameForTitle}` : 'ADHDev';
            }
        };
    }, [projectNameForTitle]);

    useEffect(() => {
        const controller = new AbortController();
        const selectedMissionId = activeView === 'missions'
            ? (data?.missions || [])[0]?.id || null
            : missionFilter !== 'all'
                ? missionFilter
                : null;

        // AD-204: forward the session token to the terminal server. The token
        // is cached after first fetch so this doesn't add a round-trip per call.
        // fetchWithAdhdevToken auto-recovers if the terminal server restarted
        // and rotated the token (one 401 → invalidate cache → retry).
        fetchWithAdhdevToken('http://localhost:3112/ui-context', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                activeProjectId,
                view: showActivityFeed ? 'activity' : activeView,
                missionFilter: missionFilter !== 'all' ? missionFilter : null,
                selectedMissionId,
                selectedTicketId: selectedTicket?.id || null,
                selectedTicketIds: Array.from(selectedIds),
                stackBy,
                groupedBy,
                showBatchPane,
                showActivityFeed,
            }),
            signal: controller.signal,
        }).catch(() => {});

        return () => controller.abort();
    }, [
        activeProjectId,
        activeView,
        data,
        groupedBy,
        missionFilter,
        selectedIds,
        selectedTicket,
        showActivityFeed,
        showBatchPane,
        stackBy,
    ]);

    useEffect(() => {
        if (typeof BroadcastChannel === 'undefined') return;
        const channel = new BroadcastChannel(FEEDBACK_BROADCAST_CHANNEL);
        broadcastRef.current = channel;
        channel.onmessage = (event) => {
            if (event.data?.type === 'feedback-updated') {
                fetchData();
            }
        };
        return () => {
            channel.close();
            broadcastRef.current = null;
        };
    }, [fetchData]);

    // Auto-poll every few seconds while visible for cross-user / cross-process updates.
    useEffect(() => {
        let interval: ReturnType<typeof setInterval> | null = null;

        const startPolling = () => {
            if (!interval) interval = setInterval(fetchData, FEEDBACK_POLL_MS);
        };
        const stopPolling = () => {
            if (interval) { clearInterval(interval); interval = null; }
        };

        const handleVisibility = () => {
            if (document.visibilityState === 'visible') {
                fetchData(); // immediate refresh when tab becomes visible
                startPolling();
            } else {
                stopPolling();
            }
        };

        startPolling();
        document.addEventListener('visibilitychange', handleVisibility);

        return () => {
            stopPolling();
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, [fetchData]);

    // DnD sensors
    const pointerSensor = useSensor(PointerSensor, { activationConstraint: { distance: 3 } });
    const touchSensor = useSensor(TouchSensor, { activationConstraint: { delay: 90, tolerance: 8 } });
    const keyboardSensor = useSensor(KeyboardSensor);
    const sensors = useSensors(pointerSensor, touchSensor, keyboardSensor);

    // Set of ticket IDs that are in at least one batch
    const batchedTicketIds = useMemo(() => {
        const ids = new Set<string>();
        for (const b of batches) {
            for (const tid of b.ticketIds) ids.add(tid);
        }
        return ids;
    }, [batches]);

    // Filter tickets
    const filteredTickets = useMemo(() => {
        if (!data) return [];
        return data.tickets.filter((t) => {
            // Search matches title, id, description, tags, or comments
            if (search) {
                const q = search.toLowerCase();
                const matchesTitle = t.title.toLowerCase().includes(q);
                const matchesId = t.id.toLowerCase().includes(q);
                const matchesDesc = t.description?.toLowerCase().includes(q);
                const matchesTags = t.tags?.some(tag => tag.toLowerCase().includes(q));
                const matchesComments = (t.comments as { id: string; content?: string }[])?.some(c => c.content?.toLowerCase().includes(q));
                if (!matchesTitle && !matchesId && !matchesDesc && !matchesTags && !matchesComments) return false;
            }
            if (priorityFilter.length > 0 && !priorityFilter.includes(t.priority)) return false;
            if (statusFilter.length > 0 && !statusFilter.includes(t.status)) return false;
            if (!matchesTimeFilter(t.createdAt, createdTimeFilter)) return false;
            if (!matchesTimeFilter(t.updatedAt, updatedTimeFilter)) return false;
            // aiFilter removed — batch selection replaced AI addressable
            // Type filter: normalize old values (issue→normal, idea→discussion)
            const tType = t.ticketType === 'idea' ? 'discussion' : t.ticketType === 'discussion' ? 'discussion' : 'normal';
            if (typeFilter === 'normal' && tType !== 'normal') return false;
            if (typeFilter === 'discussion' && tType !== 'discussion') return false;
            if (missionFilter === '__none__' && (t.missionId || '') !== '') return false;
            if (missionFilter !== 'all' && missionFilter !== '__none__' && (t.missionId || '') !== missionFilter) return false;
            if (batchFilter === 'unplanned' && batchedTicketIds.has(t.id)) return false;
            if (batchFilter === 'planned' && !batchedTicketIds.has(t.id)) return false;
            // Creator filter: AI-created tickets carry the `ai` tag or AI/system provenance
            if (creatorFilter !== 'all') {
                const isAiCreated = t.tags?.includes('ai') ||
                    t.reporter?.toLowerCase() === 'system' ||
                    t.reporter?.toLowerCase().includes('claude') ||
                    t.reporter?.toLowerCase().includes('codex') ||
                    t.reporter?.toLowerCase() === 'ai' ||
                    (t.activity && t.activity[0]?.byType === 'ai');
                if (creatorFilter === 'ai' && !isAiCreated) return false;
                if (creatorFilter === 'human' && isAiCreated) return false;
            }
            // AD-180: hide tickets that have a `parent` relation when the
            // toggle is on — keeps the kanban tidy for users who manage
            // sub-tasks via the parent's Linked panel instead of as
            // standalone cards.
            if (hideSubtasks && (t.relations || []).some(r => r.kind === 'parent')) return false;
            return true;
        });
    }, [data, search, priorityFilter, statusFilter, createdTimeFilter, updatedTimeFilter, aiFilter, typeFilter, missionFilter, batchFilter, batchedTicketIds, creatorFilter, hideSubtasks]);

    // Sort function
    const sortTickets = useCallback((tickets: Ticket[]): Ticket[] => {
        if (sortBy === 'default') return tickets;
        return [...tickets].sort((a, b) => {
            switch (sortBy) {
                case 'priority':
                    return (PRIORITY_SORT_ORDER[a.priority] ?? 2) - (PRIORITY_SORT_ORDER[b.priority] ?? 2);
                case 'newest':
                    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                case 'updated':
                    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
                default:
                    return 0;
            }
        });
    }, [sortBy]);

    const waveOptions = useMemo(() => {
        if (!data) return [];
        const scopedTickets = missionFilter === 'all'
            ? []
            : data.tickets.filter(ticket => (ticket.missionId || '') === missionFilter);
        return sortPlanningValues(Array.from(new Set(scopedTickets.map(ticket => ticket.wave?.trim()).filter(Boolean) as string[])));
    }, [data, missionFilter]);

    const sessionOptions = useMemo(() => {
        if (!data) return [];
        return sortPlanningValues(Array.from(new Set(data.tickets.map(ticket => ticket.session?.trim()).filter(Boolean) as string[])));
    }, [data]);

    const stackGroups = useMemo<StackGroup[]>(() => {
        if (!data) return [];

        if (stackBy === 'status') {
            return COLUMN_ORDER.map((status) => ({
                id: status,
                value: status,
                label: STATUS_LABELS[status] || data.columns[status]?.label || status,
                colorBar: COLUMN_COLORS[status] || 'bg-gray-500',
                instruction: data.columns[status]?.aiInstruction || '',
            }));
        }

        if (stackBy === 'priority') {
            // AD-320: PRIORITY_GROUP_ORDER ends with an Unset lane so tickets
            // with a missing/legacy priority field stop disappearing from the
            // view. The lane uses a sentinel id; drag-end translates it to ''
            // when PATCHing the ticket.
            return PRIORITY_GROUP_ORDER.map((priority) => ({
                id: priority,
                value: priority === UNSET_PRIORITY_ID ? '' : priority,
                label: PRIORITY_GROUP_META[priority].label,
                colorBar: PRIORITY_GROUP_META[priority].colorBar,
                instruction: '',
            }));
        }

        const values = stackBy === 'wave' ? waveOptions : sessionOptions;
        const emptyLabel = stackBy === 'wave' ? 'No Wave' : 'No Session';
        const groups = values.map((value, index) => ({
            id: value,
            value,
            label: value,
            colorBar: PLANNING_COLOR_BARS[index % PLANNING_COLOR_BARS.length],
            instruction: '',
        }));
        groups.push({
            id: EMPTY_STACK_VALUE,
            value: '',
            label: emptyLabel,
            colorBar: 'bg-slate-500',
            instruction: '',
        });
        return groups;
    }, [data, stackBy, waveOptions, sessionOptions]);

    const visibleStackGroups = useMemo(() => (
        stackBy === 'status'
            ? stackGroups.filter(group => !hiddenStatusIds.has(group.id))
            : stackGroups
    ), [hiddenStatusIds, stackBy, stackGroups]);

    const groupedTickets = useMemo(() => {
        const grouped: Record<string, Ticket[]> = {};
        for (const group of stackGroups) grouped[group.id] = [];

        for (const ticket of filteredTickets) {
            const rawValue =
                stackBy === 'status'
                    ? ticket.status
                    : stackBy === 'priority'
                        // AD-320: non-canonical priorities fall into the Unset
                        // lane (sentinel id) instead of vanishing from the view.
                        ? (CANONICAL_PRIORITIES.has(String(ticket.priority || '')) ? ticket.priority : UNSET_PRIORITY_ID)
                        : (stackBy === 'wave' ? ticket.wave : ticket.session)?.trim() || '';
            const groupId = rawValue || EMPTY_STACK_VALUE;
            if (!grouped[groupId]) grouped[groupId] = [];
            grouped[groupId].push(ticket);
        }

        for (const group of Object.keys(grouped)) {
            grouped[group] = sortTickets(grouped[group]);
        }

        return grouped;
    }, [filteredTickets, sortTickets, stackBy, stackGroups]);

    useEffect(() => {
        if (visibleStackGroups.length === 0) return;
        if (!visibleStackGroups.some(group => group.id === mobileTab)) {
            setMobileTab(visibleStackGroups[0].id);
        }
    }, [visibleStackGroups, mobileTab]);

    // Collect all unique tags across all tickets
    const allTags = useMemo(() => {
        if (!data) return [];
        const tagSet = new Set<string>();
        for (const t of data.tickets) {
            if (t.tags) for (const tag of t.tags) tagSet.add(tag);
        }
        return Array.from(tagSet).sort();
    }, [data]);

    const missionOptions = useMemo(() => {
        if (!data?.missions) return [];
        return [...data.missions]
            .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
            .map((mission) => ({ id: mission.id, title: mission.title }));
    }, [data]);

    // Stats
    const stats = useMemo(() => {
        if (!data) return {};
        const s: Record<string, number> = {};
        for (const col of COLUMN_ORDER) s[col] = 0;
        for (const t of data.tickets) {
            if (s[t.status] !== undefined) s[t.status]++;
        }
        return s;
    }, [data]);

    // Active filter count
    const activeFilterCount = useMemo(() => {
        let count = 0;
        if (missionFilter !== 'all') count++;
        if (priorityFilter.length > 0) count++;
        if (statusFilter.length > 0) count++;
        if (createdTimeFilter !== 'all') count++;
        if (updatedTimeFilter !== 'all') count++;
        if (typeFilter !== 'all') count++;
        if (aiFilter !== 'all') count++;
        if (creatorFilter !== 'all') count++;
        if (batchFilter !== 'all') count++;
        if (sortBy !== 'updated') count++;
        if (stackBy !== 'status') count++;
        if (groupedBy !== 'none') count++;
        if (hideSubtasks) count++;
        return count;
    }, [missionFilter, priorityFilter, statusFilter, createdTimeFilter, updatedTimeFilter, typeFilter, aiFilter, creatorFilter, batchFilter, sortBy, stackBy, groupedBy, hideSubtasks]);

    const clearAllFilters = useCallback(() => {
        setPriorityFilter([]);
        setStatusFilter([]);
        setCreatedTimeFilter('all');
        setUpdatedTimeFilter('all');
        setTypeFilter('all');
        setMissionFilter('all');
        setAiFilter('all');
        setCreatorFilter('all');
        setBatchFilter('all');
        setSortBy('updated');
        setStackBy('status');
        setGroupedBy('none');
        setHideSubtasks(false);
    }, []);

    // Handlers
    const handleDragStart = (event: DragStartEvent) => {
        setActiveId(event.active.id as string);
    };

    const handleDragEnd = async (event: DragEndEvent) => {
        setActiveId(null);
        const { active, over } = event;
        if (!over || !data) return;

        const ticketId = active.id as string;
        const overId = over.id as string;
        const groupId = stackGroups.some(group => group.id === overId)
            ? overId
            : (() => {
                const overTicket = data.tickets.find((ticket) => ticket.id === overId);
                if (!overTicket) return null;
                if (stackBy === 'status') return overTicket.status;
                // AD-320: when hovering over another ticket whose priority
                // isn't canonical, bucket the drop into the Unset lane id so
                // the comparison below matches the lane's sentinel.
                if (stackBy === 'priority') {
                    const p = String(overTicket.priority || '');
                    return CANONICAL_PRIORITIES.has(p) ? overTicket.priority : UNSET_PRIORITY_ID;
                }
                return (stackBy === 'wave' ? overTicket.wave : overTicket.session)?.trim() || EMPTY_STACK_VALUE;
            })();

        if (!groupId) return;

        const ticket = data.tickets.find((t) => t.id === ticketId);
        if (!ticket) return;

        // AD-320: translate the Unset sentinel back to '' for the actual
        // PATCH/optimistic update; the API stores priority as the bare value.
        const normalizedValue = groupId === EMPTY_STACK_VALUE
            ? ''
            : groupId === UNSET_PRIORITY_ID
                ? ''
                : groupId;
        const currentValue =
            stackBy === 'status'
                ? ticket.status
                : stackBy === 'priority'
                    ? (CANONICAL_PRIORITIES.has(String(ticket.priority || '')) ? ticket.priority : '')
                    : (stackBy === 'wave' ? ticket.wave : ticket.session)?.trim() || '';

        if (currentValue === normalizedValue) return;
        const finishMutation = beginLocalMutation();
        const optimisticUpdatedAt = new Date().toISOString();
        const optimisticUpdates: Partial<Ticket> = stackBy === 'status'
            ? { status: normalizedValue }
            : stackBy === 'priority'
                ? { priority: normalizedValue as Ticket['priority'] }
                : stackBy === 'wave'
                    ? { wave: normalizedValue }
                    : { session: normalizedValue };

        // Optimistic update
        patchTicketLocally(ticketId, currentTicket => ({ ...currentTicket, ...optimisticUpdates, updatedAt: optimisticUpdatedAt }));

        try {
            const res = await fetch('/api/feedback', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: ticketId, updates: optimisticUpdates }),
            });
            if (res.ok) {
                replaceTicketLocally(await res.json());
                emitBoardRefresh();
            } else {
                await fetchData({ force: true });
            }
        } catch {
            await fetchData({ force: true });
        } finally {
            finishMutation();
        }
    };

    const handleUpdateTicket = async (id: string, updates: Partial<Ticket>) => {
        const finishMutation = beginLocalMutation();
        const optimisticUpdatedAt = new Date().toISOString();
        // Optimistic update
        patchTicketLocally(id, ticket => ({ ...ticket, ...updates, updatedAt: optimisticUpdatedAt }));

        try {
            const res = await fetch('/api/feedback', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, updates }),
            });

            if (res.ok) {
                replaceTicketLocally(await res.json());
                emitBoardRefresh();
            } else {
                await fetchData({ force: true });
            }
        } catch {
            await fetchData({ force: true });
        } finally {
            finishMutation();
        }
    };

    const handleToggleAi = async (id: string, value: boolean) => {
        await handleUpdateTicket(id, { aiAddressable: value });
    };

    const handleDeleteTicket = async (id: string) => {
        const finishMutation = beginLocalMutation();
        // Optimistic update
        setData((prev) => {
            if (!prev) return prev;
            return { ...prev, tickets: prev.tickets.filter((t) => t.id !== id) };
        });
        setSelectedTicket(prev => prev?.id === id ? null : prev);

        try {
            await fetch('/api/feedback', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id }),
            });
            emitBoardRefresh();
        } catch {
            await fetchData({ force: true });
        } finally {
            finishMutation();
        }
    };

    const handleAddComment = async (ticketId: string, content: string, images: { url: string; filename: string }[]) => {
        const finishMutation = beginLocalMutation();
        const now = new Date().toISOString();
        const optimisticComment: TicketComment = {
            id: `temp-${Date.now().toString(36)}`,
            author: userDisplayName,
            authorType: 'human',
            content,
            images,
            createdAt: now,
        };

        patchTicketLocally(ticketId, ticket => ({
            ...ticket,
            comments: [...ticket.comments, optimisticComment],
            updatedAt: now,
        }));

        try {
            const res = await fetch(`/api/feedback/${ticketId}/comments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content, images, author: userDisplayName, authorType: 'human' }),
            });

            if (res.ok) {
                const savedComment = await res.json();
                patchTicketLocally(ticketId, ticket => ({
                    ...ticket,
                    comments: ticket.comments.map(comment => comment.id === optimisticComment.id ? savedComment : comment),
                    updatedAt: savedComment.createdAt || now,
                }));
                emitBoardRefresh();
                void fetchData({ force: true });
            } else {
                patchTicketLocally(ticketId, ticket => ({
                    ...ticket,
                    comments: ticket.comments.filter(comment => comment.id !== optimisticComment.id),
                }));
                throw new Error('Failed to add comment');
            }
        } catch (error) {
            patchTicketLocally(ticketId, ticket => ({
                ...ticket,
                comments: ticket.comments.filter(comment => comment.id !== optimisticComment.id),
            }));
            throw error;
        } finally {
            finishMutation();
        }
    };

    const handleDeleteComment = async (ticketId: string, commentId: string) => {
        const finishMutation = beginLocalMutation();
        const removedCommentRef: { current: TicketComment | null } = { current: null };
        patchTicketLocally(ticketId, ticket => {
            removedCommentRef.current = ticket.comments.find(comment => comment.id === commentId) || null;
            return {
                ...ticket,
                comments: ticket.comments.filter(comment => comment.id !== commentId),
                updatedAt: new Date().toISOString(),
            };
        });
        try {
            const res = await fetch(`/api/feedback/${ticketId}/comments`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ commentId }),
            });
            if (res.ok) {
                emitBoardRefresh();
            } else if (removedCommentRef.current) {
                patchTicketLocally(ticketId, ticket => ({
                    ...ticket,
                    comments: [...ticket.comments, removedCommentRef.current!],
                }));
            }
        } catch {
            if (removedCommentRef.current) {
                patchTicketLocally(ticketId, ticket => ({
                    ...ticket,
                    comments: [...ticket.comments, removedCommentRef.current!],
                }));
            }
        } finally {
            finishMutation();
        }
    };

    const handleUpdateInstruction = async (status: string, instruction: string) => {
        setData((prev) => {
            if (!prev) return prev;
            return {
                ...prev,
                columns: {
                    ...prev.columns,
                    [status]: { ...prev.columns[status], aiInstruction: instruction },
                },
            };
        });

        await fetch('/api/feedback', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ updateColumns: { columnId: status, updates: { aiInstruction: instruction } } }),
        });
        emitBoardRefresh();
    };

    const handleAddTicketToColumn = (status: string) => {
        setNewTicketDefaultStatus(status);
        setShowNewTicket(true);
    };

    const activeTicket = activeId ? data?.tickets.find((t) => t.id === activeId) ?? null : null;

    // Board-level drag handlers (drop files to create new ticket)
    const handleBoardDragOver = useCallback((e: React.DragEvent) => {
        // AD-185(c): also bail when the Inbox/chat panel is open — drops
        // there should land in the chat composer, not the board's
        // new-ticket drawer.
        if (selectedTicket || showNewTicket || showChat) return;
        if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setBoardDragOver(true);
        }
    }, [selectedTicket, showNewTicket, showChat]);

    const handleBoardDragLeave = useCallback((e: React.DragEvent) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
            setBoardDragOver(false);
        }
    }, []);

    const handleBoardDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setBoardDragOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length === 0) return;
        if (files.length === 1) {
            // Single file → go straight to new ticket modal
            setDroppedFiles(files);
            setNewTicketDefaultStatus('backlog');
            setShowNewTicket(true);
        } else {
            // Multiple files → show choice dialog
            setPendingDropFiles(files);
            setShowDropChoice(true);
        }
    }, []);

    // Create one ticket with all files
    const handleDropChoiceSingle = useCallback(() => {
        setShowDropChoice(false);
        setDroppedFiles(pendingDropFiles);
        setPendingDropFiles([]);
        setNewTicketDefaultStatus('backlog');
        setShowNewTicket(true);
    }, [pendingDropFiles]);

    // Create separate tickets per file (auto-named)
    const handleDropChoiceSeparate = useCallback(async () => {
        setCreatingSeparate(true);
        for (const file of pendingDropFiles) {
            try {
                const isImage = file.type.startsWith('image/');
                const toUpload = isImage ? await compressImage(file) : file;
                const formData = new FormData();
                formData.append('file', toUpload);
                const uploadRes = await fetch('/api/feedback/upload', { method: 'POST', body: formData });
                if (!uploadRes.ok) continue;
                const uploadData = await uploadRes.json();
                const image = { url: uploadData.url, filename: uploadData.filename, isImage: uploadData.isImage ?? isImage, size: uploadData.size ?? file.size, uploadedAt: new Date().toISOString() };
                // Strip extension for title
                const title = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
                await fetch('/api/feedback', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title, description: '', priority: 'medium', aiAddressable: true, images: [image], tags: [], status: 'backlog' }),
                });
            } catch { /* skip failed */ }
        }
        setPendingDropFiles([]);
        setShowDropChoice(false);
        setCreatingSeparate(false);
        fetchData();
    }, [pendingDropFiles, fetchData]);

    if (loading) {
        return <BoardLoadingScreen />;
    }

    if (!data) {
        return (
            <div className="min-h-screen bg-vd-bg-primary flex items-center justify-center">
                <div className="text-center space-y-3">
                    {fetchError ? (
                        <>
                            <div className="flex justify-center">
                                <div className="w-8 h-8 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
                            </div>
                            <p className="text-amber-400 text-sm">Server may be restarting...</p>
                            <p className="text-vd-text-tertiary text-xs">Auto-retrying every 3 seconds</p>
                            <button onClick={() => window.location.reload()} className="mt-2 px-3 py-1.5 text-xs bg-vd-bg-tertiary text-vd-text-secondary rounded-lg hover:bg-vd-bg-hover transition-colors">
                                Reload page
                            </button>
                        </>
                    ) : (
                        <p className="text-red-400">Failed to load feedback data</p>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div
            className="h-screen bg-vd-bg-primary flex flex-col overflow-hidden relative"
            onDragOver={handleBoardDragOver}
            onDragLeave={handleBoardDragLeave}
            onDrop={handleBoardDrop}
        >
            {/* AD-128 / AD-228: Claude Code health banner — three distinct states.
                State A (`not_found`)  → friendly first-run install card (blue, helpful tone).
                State B (`outdated`)   → amber upgrade banner with copy-to-clipboard (live REPL may be running).
                State C (other errors) → red dismissable broken banner.
                State D (working)      → no banner at all. */}
            {!claudeBannerDismissed && claudeHealth && claudeHealth.error === 'not_found' && (
                <div className="flex-shrink-0 px-4 py-2.5 text-xs flex items-center gap-3 border-b bg-blue-500/10 border-blue-500/30 text-blue-100">
                    <svg className="w-5 h-5 flex-shrink-0 text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-3-3v6m9-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="flex-1 leading-snug">
                        <span className="font-semibold">To run agents on your tickets, install Claude Code.</span>
                        {' '}
                        <span className="opacity-90">
                            {claudeInstallInProgress
                                ? 'Installing — watch the terminal pane. This banner will dismiss itself once Claude Code is detected.'
                                : 'One click — we\'ll run the install in the embedded terminal.'}
                        </span>
                    </div>
                    <button
                        disabled={claudeInstallInProgress}
                        onClick={async () => {
                            if (claudeInstallInProgress) return;
                            setShowTerminal(true);
                            setClaudeInstallInProgress(true);
                            try {
                                const r = await fetch('/api/install-claude', { method: 'POST' });
                                if (!r.ok) {
                                    const d = await r.json().catch(() => ({} as { error?: string; command?: string }));
                                    try { await navigator.clipboard.writeText(d.command || 'npm i -g @anthropic-ai/claude-code@latest'); } catch {}
                                    showToast(d.error || 'Auto-install failed — command copied; paste it in the terminal.', 7000);
                                    setClaudeInstallInProgress(false);
                                } else {
                                    showToast('Installing Claude Code — banner will dismiss when it\'s detected.', 5000);
                                }
                            } catch {
                                try { await navigator.clipboard.writeText('npm i -g @anthropic-ai/claude-code@latest'); } catch {}
                                showToast('Could not reach the terminal server. Command copied — paste it in the terminal.', 8000);
                                setClaudeInstallInProgress(false);
                            }
                        }}
                        className="flex-shrink-0 px-3 py-1 rounded border border-blue-400/40 hover:bg-blue-400/15 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                    >
                        {claudeInstallInProgress ? 'Installing…' : 'Install Claude Code'}
                    </button>
                    <button
                        onClick={() => {
                            setClaudeBannerDismissed(true);
                            try { sessionStorage.setItem('adhdev-claude-banner-dismissed', '1'); } catch {}
                        }}
                        className="flex-shrink-0 opacity-70 hover:opacity-100"
                        title="Dismiss for this session"
                    >
                        &times;
                    </button>
                </div>
            )}
            {!claudeBannerDismissed && claudeHealth && claudeHealth.ok && claudeHealth.outdated && (
                <div className="flex-shrink-0 px-4 py-2 text-xs flex items-center gap-3 border-b bg-amber-500/10 border-amber-500/30 text-amber-300">
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                    </svg>
                    <div className="flex-1 leading-snug">
                        <span className="font-semibold">Your Claude Code is old (version {claudeHealth.version}).</span>
                        {' '}This version crashes on <code className="px-1 bg-black/30 rounded">/model</code> and can't use Claude 4.x.
                        {' '}<span className="opacity-90">To fix: (1) close Claude if it's running — type <code className="px-1 bg-black/30 rounded">/exit</code> in the terminal. (2) Click <b>Copy upgrade</b> to copy the install command, then paste and press Enter.</span>
                    </div>
                    <button
                        onClick={async () => {
                            const cmd = 'npm i -g @anthropic-ai/claude-code@latest';
                            // AD-128: copy the command and open/focus the terminal
                            // so the next click+paste is all that's needed. We DON'T auto-send
                            // because Claude's REPL may still be alive (just crashing), and
                            // typing an npm install into a live REPL would feed it as a prompt.
                            setShowTerminal(true);
                            try {
                                await navigator.clipboard.writeText(cmd);
                                showToast('Copied. In the terminal: type /exit if Claude is running, then paste and press Enter.', 6000);
                            } catch {
                                showToast('Copy failed — run this in a terminal: npm i -g @anthropic-ai/claude-code@latest', 8000);
                            }
                        }}
                        className="flex-shrink-0 px-2 py-0.5 rounded border border-current/30 hover:bg-current/10 transition-colors font-medium"
                    >
                        Copy upgrade
                    </button>
                    <button
                        onClick={() => {
                            setClaudeBannerDismissed(true);
                            try { sessionStorage.setItem('adhdev-claude-banner-dismissed', '1'); } catch {}
                        }}
                        className="flex-shrink-0 opacity-70 hover:opacity-100"
                        title="Dismiss for this session"
                    >
                        &times;
                    </button>
                </div>
            )}
            {!claudeBannerDismissed && claudeHealth && !claudeHealth.ok && claudeHealth.error !== 'not_found' && (
                <div className="flex-shrink-0 px-4 py-2 text-xs flex items-center gap-3 border-b bg-red-500/10 border-red-500/30 text-red-300">
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                    </svg>
                    <div className="flex-1 leading-snug">
                        <span className="font-semibold">Claude Code isn't responding</span>
                        {claudeHealth.error ? ` (${claudeHealth.error})` : ''}.
                        {' '}<span className="opacity-90">Try reinstalling — copy the command and run it in the terminal.</span>
                    </div>
                    <button
                        onClick={async () => {
                            const cmd = 'npm i -g @anthropic-ai/claude-code@latest';
                            setShowTerminal(true);
                            try {
                                await navigator.clipboard.writeText(cmd);
                                showToast('Copied. Paste it in the terminal and press Enter.', 6000);
                            } catch {
                                showToast('Copy failed — run this in a terminal: npm i -g @anthropic-ai/claude-code@latest', 8000);
                            }
                        }}
                        className="flex-shrink-0 px-2 py-0.5 rounded border border-current/30 hover:bg-current/10 transition-colors font-medium"
                    >
                        Copy reinstall
                    </button>
                    <button
                        onClick={() => {
                            setClaudeBannerDismissed(true);
                            try { sessionStorage.setItem('adhdev-claude-banner-dismissed', '1'); } catch {}
                        }}
                        className="flex-shrink-0 opacity-70 hover:opacity-100"
                        title="Dismiss for this session"
                    >
                        &times;
                    </button>
                </div>
            )}

            {/* Board-level drag overlay */}
            {boardDragOver && (
                <div className="absolute inset-0 z-40 bg-vd-accent-gold/10 border-4 border-dashed border-vd-accent-gold/50 flex items-center justify-center pointer-events-none">
                    <div className="bg-vd-bg-secondary/90 rounded-xl px-8 py-6 text-center shadow-xl">
                        <div className="text-3xl mb-2">📎</div>
                        <p className="text-sm font-medium text-vd-text-primary">Drop files to create a new ticket</p>
                        <p className="text-xs text-vd-text-tertiary mt-1">Images will be attached automatically</p>
                    </div>
                </div>
            )}

            {/* Multi-file drop choice dialog */}
            {showDropChoice && (
                <div className="fixed inset-0 z-50 flex items-center justify-center">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { setShowDropChoice(false); setPendingDropFiles([]); }} />
                    <div className="relative bg-vd-bg-secondary border border-vd-border rounded-xl w-full max-w-sm mx-4 shadow-panel">
                        <div className="px-5 py-4 border-b border-vd-border">
                            <h2 className="text-sm font-semibold text-vd-text-primary">
                                {pendingDropFiles.length} files dropped
                            </h2>
                        </div>
                        <div className="p-5 space-y-3">
                            <button
                                onClick={handleDropChoiceSingle}
                                disabled={creatingSeparate}
                                className="w-full px-4 py-3 text-sm text-left bg-vd-bg-tertiary border border-vd-border rounded-lg hover:border-vd-accent-gold transition-colors disabled:opacity-50"
                            >
                                <span className="font-medium text-vd-text-primary">One ticket</span>
                                <p className="text-xs text-vd-text-tertiary mt-0.5">Add all {pendingDropFiles.length} files to a single new ticket</p>
                            </button>
                            <button
                                onClick={handleDropChoiceSeparate}
                                disabled={creatingSeparate}
                                className="w-full px-4 py-3 text-sm text-left bg-vd-bg-tertiary border border-vd-border rounded-lg hover:border-vd-accent-gold transition-colors disabled:opacity-50"
                            >
                                <span className="font-medium text-vd-text-primary">
                                    {creatingSeparate ? `Creating tickets...` : `Separate tickets`}
                                </span>
                                <p className="text-xs text-vd-text-tertiary mt-0.5">Create {pendingDropFiles.length} tickets, one per file (auto-named)</p>
                            </button>
                        </div>
                        <div className="px-5 py-3 border-t border-vd-border">
                            <button
                                onClick={() => { setShowDropChoice(false); setPendingDropFiles([]); }}
                                disabled={creatingSeparate}
                                className="text-xs text-vd-text-tertiary hover:text-vd-text-primary transition-colors"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Expandable sidebar (v2) — hidden when embedded in admin shell */}
            {!isMobile && !embedded && (
                <aside className={`fixed left-0 top-0 bottom-0 z-30 bg-vd-bg-secondary border-r border-vd-border flex flex-col py-3 transition-all duration-200 ${sidebarExpanded ? 'w-44' : 'w-12'}`}>
                    {/* Logo + expand toggle */}
                    <div className={`flex items-center mb-3 ${sidebarExpanded ? 'px-3 justify-between' : 'flex-col gap-0.5 items-center'}`}>
                        <a href="/feedback" className={`flex items-center group ${sidebarExpanded ? 'gap-2' : 'flex-col gap-0.5'}`} title="ADHDev">
                            <ADHDevIcon className={`text-vd-accent-gold flex-shrink-0 group-hover:scale-110 transition-transform ${sidebarExpanded ? 'w-6 h-6' : 'w-7 h-7'}`} />
                            {sidebarExpanded && <ADHDevBrand size="sm" />}
                        </a>
                    </div>

                    {/* Project switcher — floating dropdown (works collapsed & expanded) */}
                    {projects.length > 0 && (
                        <div className="px-1.5 mb-2 relative">
                            <button
                                onClick={() => setShowProjectSwitcher(!showProjectSwitcher)}
                                className={`w-full rounded-lg flex items-center gap-2 text-vd-text-secondary hover:text-vd-text-primary hover:bg-vd-bg-tertiary transition-colors ${sidebarExpanded ? 'px-2.5 py-1.5' : 'w-9 h-9 mx-auto justify-center'}`}
                                title={projects.find(p => p.id === activeProjectId)?.name || 'Projects'}
                            >
                                <span className="w-2 h-2 rounded-full bg-vd-accent-gold flex-shrink-0" />
                                {sidebarExpanded && (
                                    <>
                                        <span className="text-[11px] font-medium truncate flex-1 text-left">{projects.find(p => p.id === activeProjectId)?.name || 'Select project'}</span>
                                        <svg className={`w-3 h-3 flex-shrink-0 transition-transform ${showProjectSwitcher ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </>
                                )}
                            </button>
                            {showProjectSwitcher && (
                                <>
                                    {/* Backdrop to close on click outside */}
                                    <div className="fixed inset-0 z-40" onClick={() => { setShowProjectSwitcher(false); }} />
                                    <div className={`absolute z-50 rounded-lg border border-vd-border bg-vd-bg-secondary shadow-panel overflow-hidden min-w-[200px] ${sidebarExpanded ? 'left-0 right-0 top-full mt-1' : 'left-full top-0 ml-2'}`}>
                                        <div className="px-2.5 py-1.5 text-[9px] text-vd-text-tertiary uppercase tracking-wider border-b border-vd-border">Projects</div>
                                        {projects.map(p => {
                                            const isSwitching = switchingProjectId === p.id;
                                            const otherSwitching = switchingProjectId !== null && !isSwitching;
                                            return (
                                            <button
                                                key={p.id}
                                                disabled={switchingProjectId !== null || p.id === activeProjectId}
                                                onClick={async () => {
                                                    if (p.id === activeProjectId) { setShowProjectSwitcher(false); return; }
                                                    // AD-127: surface switching state so the click feels acknowledged.
                                                    setSwitchingProjectId(p.id);
                                                    showToast(`Switching to ${p.name}…`);
                                                    // AD-316: clear the old board state and write the new
                                                    // project id to sessionStorage *before* fetchData runs.
                                                    // Without this, the fetch wrapper at L420ish still reads
                                                    // the OLD project id (sessionStorage hasn't been mirrored
                                                    // yet by its useEffect), and setData(d) pours the previous
                                                    // project's tickets into the new project's header — the
                                                    // "stale cards under new theme" flash that AD-316 reports.
                                                    // Clearing `data` flips the render into the loading screen
                                                    // while the new fetch is in flight.
                                                    if (typeof window !== 'undefined') {
                                                        sessionStorage.setItem('adhdev-active-project-id', p.id);
                                                    }
                                                    setData(null);
                                                    setLoading(true);
                                                    try {
                                                        await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ switchTo: p.id }) });
                                                        setActiveProjectId(p.id);
                                                        await fetchData({ force: true });
                                                    } finally {
                                                        setSwitchingProjectId(null);
                                                        setShowProjectSwitcher(false);
                                                    }
                                                }}
                                                className={`w-full text-left px-2.5 py-1.5 text-[10px] flex items-center gap-2 hover:bg-vd-bg-tertiary transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${p.id === activeProjectId ? 'text-vd-accent-gold' : 'text-vd-text-secondary'} ${otherSwitching ? 'opacity-40' : ''}`}
                                            >
                                                {isSwitching ? (
                                                    <svg className="w-3 h-3 flex-shrink-0 animate-spin text-vd-accent-gold" viewBox="0 0 24 24" fill="none">
                                                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                                                        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                                                    </svg>
                                                ) : (
                                                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${p.id === activeProjectId ? 'bg-vd-accent-gold' : 'bg-vd-text-tertiary/30'}`} />
                                                )}
                                                <span className="truncate">{p.name}</span>
                                                {isSwitching && <span className="ml-auto text-[9px] text-vd-accent-gold">loading</span>}
                                            </button>
                                            );
                                        })}
                                        <div className="border-t border-vd-border" />
                                        {/* AD-286: launch the OnboardingWizard in add-project mode
                                            instead of the legacy 3-field inline form. Closes the
                                            switcher dropdown so the wizard owns the screen. */}
                                        <button
                                            onClick={() => {
                                                setShowProjectSwitcher(false);
                                                setShowAddProjectWizard(true);
                                            }}
                                            className="w-full text-left px-2.5 py-2 text-[10px] flex items-center gap-2 text-vd-accent-gold hover:bg-vd-bg-tertiary transition-colors"
                                        >
                                            <span className="text-xs">+</span>
                                            <span>Add project</span>
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {/* Nav items */}
                    <nav className="flex flex-col gap-0.5 px-1.5">
                        {/* Board (active) */}
                        <button
                            onClick={() => {
                                setActiveView('board');
                                setShowActivityFeed(false);
                            }}
                            className={`rounded-lg flex items-center gap-2.5 ${activeView === 'board' && !showActivityFeed ? 'bg-vd-accent-gold/10 text-vd-accent-gold' : 'text-vd-text-tertiary hover:text-vd-text-primary hover:bg-vd-bg-tertiary'} ${sidebarExpanded ? 'px-2.5 py-2' : 'w-9 h-9 mx-auto justify-center'}`}
                            title="Board">
                            <svg className="w-[18px] h-[18px] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125z" />
                            </svg>
                            {sidebarExpanded && <span className="text-xs font-medium">Board</span>}
                        </button>

                        {/* Activity Feed */}
                        <button
                            onClick={() => {
                                setShowActivityFeed(!showActivityFeed);
                                if (!showActivityFeed) setActiveView('board');
                            }}
                            className={`rounded-lg flex items-center gap-2.5 transition-colors ${showActivityFeed ? 'bg-vd-accent-gold/10 text-vd-accent-gold' : 'text-vd-text-tertiary hover:text-vd-text-primary hover:bg-vd-bg-tertiary'} ${sidebarExpanded ? 'px-2.5 py-2' : 'w-9 h-9 mx-auto justify-center'}`}
                            title="Activity"
                        >
                            <svg className="w-[18px] h-[18px] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            {sidebarExpanded && <span className="text-xs font-medium">Activity</span>}
                        </button>

                        {/* Missions */}
                        <button
                            onClick={() => {
                                setActiveView('missions');
                                setShowActivityFeed(false);
                            }}
                            className={`rounded-lg flex items-center gap-2.5 transition-colors ${activeView === 'missions' ? 'bg-vd-accent-gold/10 text-vd-accent-gold' : 'text-vd-text-tertiary hover:text-vd-text-primary hover:bg-vd-bg-tertiary'} ${sidebarExpanded ? 'px-2.5 py-2' : 'w-9 h-9 mx-auto justify-center'}`}
                            title="Missions"
                        >
                            {/* AD-195: rocket icon for the Mission Center per chat
                                request m-moiwzv6d-4d8w. Heroicons-style outline rocket
                                so it sits with the rest of the sidebar's stroke
                                iconography. */}
                            <svg className="w-[18px] h-[18px] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
                            </svg>
                            {sidebarExpanded && <span className="text-xs font-medium">Missions</span>}
                        </button>
                    </nav>

                    {/* AD-136/130: activation checklist — only while sidebar is expanded,
                        and only after onboarding state has loaded so it doesn't flash. */}
                    {onboardingLoaded && sidebarExpanded && data && (
                        <div className="px-3">
                            <ActivationChecklist
                                tickets={data.tickets}
                                events={onboardingEvents}
                                dismissed={!!onboardingState.checklistDismissed}
                                onDismiss={() => { void patchOnboardingState({ checklistDismissed: true }); }}
                            />
                        </div>
                    )}

                    {/* Spacer */}
                    <div className="flex-1" />

                    {/* Expand/Collapse toggle — right above Settings */}
                    <div className="px-1.5 mb-0.5">
                        {sidebarExpanded ? (
                            <button
                                onClick={() => { setSidebarExpanded(false); try { localStorage.setItem('vd-sidebar-expanded', 'false'); } catch {} }}
                                className="w-full rounded-lg flex items-center gap-2.5 px-2.5 py-2 text-vd-text-tertiary hover:text-vd-text-primary hover:bg-vd-bg-tertiary transition-colors"
                                title="Collapse sidebar"
                            >
                                <svg className="w-[18px] h-[18px] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5" />
                                </svg>
                                <span className="text-xs font-medium">Collapse</span>
                            </button>
                        ) : (
                            <button
                                onClick={() => { setSidebarExpanded(true); try { localStorage.setItem('vd-sidebar-expanded', 'true'); } catch {} }}
                                className="w-9 h-9 mx-auto rounded-lg flex items-center justify-center text-vd-text-tertiary hover:text-vd-text-primary hover:bg-vd-bg-tertiary transition-colors"
                                title="Expand sidebar"
                            >
                                <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 4.5l7.5 7.5-7.5 7.5m-6-15l7.5 7.5-7.5 7.5" />
                                </svg>
                            </button>
                        )}
                    </div>

                    {/* Bottom: Settings */}
                    <div className="px-1.5 flex flex-col gap-0.5">
                        <button
                            onClick={openFeedbackIssue}
                            className={`rounded-lg flex items-center gap-2.5 text-vd-text-tertiary hover:text-vd-text-primary hover:bg-vd-bg-tertiary transition-colors ${sidebarExpanded ? 'px-2.5 py-2' : 'w-9 h-9 mx-auto justify-center'}`}
                            title="Send feedback"
                        >
                            <svg className="w-[18px] h-[18px] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12.75h6.75m-6.75-3h6.75m-8.25 9.75 2.25-2.25h7.125a3 3 0 0 0 3-3V7.5a3 3 0 0 0-3-3h-9a3 3 0 0 0-3 3v6.75a3 3 0 0 0 3 3h.375Z" />
                            </svg>
                            {sidebarExpanded && <span className="text-xs font-medium">Send feedback</span>}
                        </button>
                        <button
                            onClick={() => setShowSettings(true)}
                            className={`rounded-lg flex items-center gap-2.5 text-vd-text-tertiary hover:text-vd-text-primary hover:bg-vd-bg-tertiary transition-colors ${sidebarExpanded ? 'px-2.5 py-2' : 'w-9 h-9 mx-auto justify-center'}`}
                            title="Settings"
                        >
                            <svg className="w-[18px] h-[18px] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            {sidebarExpanded && <span className="text-xs font-medium">Settings</span>}
                        </button>
                    </div>
                </aside>
            )}

            {/* Top toolbar — action buttons + search + filters (v2) */}
            <div className={`sticky top-0 z-20 bg-vd-bg-primary/95 backdrop-blur-sm border-b border-vd-border flex-shrink-0 transition-all duration-200 ${!isMobile && !embedded ? (sidebarExpanded ? 'pl-44' : 'pl-12') : ''}`}>
                <div className="px-4 py-2 flex items-center gap-2">
                    {/* Brand — mobile always, desktop when sidebar collapsed */}
                    {(isMobile || !sidebarExpanded) && (
                        <a href="/feedback" className="flex items-center gap-1.5 flex-shrink-0 mr-1">
                            <ADHDevBrand />
                        </a>
                    )}

                    {/* AD-127: prominent active-project badge so it's always obvious which board you're on */}
                    {projects.length > 0 && (() => {
                        const switching = switchingProjectId !== null;
                        const displayName = switching
                            ? (projects.find(p => p.id === switchingProjectId)?.name || 'Switching…')
                            : (projects.find(p => p.id === activeProjectId)?.name || 'No project');
                        return (
                            <button
                                onClick={() => setShowProjectSwitcher(s => !s)}
                                title={projects.find(p => p.id === activeProjectId)?.path || 'Switch project'}
                                className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-vd-accent-gold/12 border border-vd-accent-gold/40 text-vd-accent-gold hover:bg-vd-accent-gold/20 transition-colors flex-shrink-0 max-w-[220px]"
                            >
                                {switching ? (
                                    <svg className="w-3 h-3 flex-shrink-0 animate-spin" viewBox="0 0 24 24" fill="none">
                                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                                        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                                    </svg>
                                ) : (
                                    <span className="w-1.5 h-1.5 rounded-full bg-vd-accent-gold animate-pulse flex-shrink-0" />
                                )}
                                <span className="truncate">{displayName}</span>
                                {!switching && (
                                    <svg className="w-3 h-3 flex-shrink-0 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                    </svg>
                                )}
                            </button>
                        );
                    })()}

                    {/* Search */}
                    <div className="relative flex-1 max-w-sm">
                        <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-vd-text-tertiary pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                        </svg>
                        <input
                            ref={searchRef}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search tickets, comments... (Ctrl+F)"
                            className={`w-full bg-vd-bg-input border rounded-lg pl-8 pr-7 py-1.5 text-xs text-vd-text-primary placeholder-vd-text-tertiary focus:border-vd-accent-gold focus:outline-none transition-colors ${
                                search ? 'border-vd-accent-gold bg-vd-accent-gold/5' : 'border-vd-border'
                            }`}
                        />
                        {search && (
                            <button onClick={() => { setSearch(''); searchRef.current?.focus(); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-vd-accent-gold hover:text-vd-text-primary transition-colors" title="Clear (Esc)">
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        )}
                    </div>

                    {/* Filter button + popover */}
                    <div className="relative" ref={filterRef}>
                        <button
                            onClick={() => setShowFilters(prev => !prev)}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border rounded-lg transition-colors ${
                                showFilters || activeFilterCount > 0
                                    ? 'border-vd-accent-gold text-vd-accent-gold bg-vd-accent-gold/5'
                                    : 'border-vd-border text-vd-text-secondary hover:text-vd-text-primary hover:border-vd-text-tertiary'
                            }`}
                        >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
                            </svg>
                            <span className="hidden sm:inline">Filters</span>
                            {activeFilterCount > 0 && (
                                <span className="w-4 h-4 flex items-center justify-center rounded-full bg-vd-accent-gold text-vd-bg-primary text-[9px] font-bold">{activeFilterCount}</span>
                            )}
                        </button>

                        {showFilters && (
                            <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-xl border border-vd-border bg-vd-bg-secondary shadow-xl p-3 space-y-3">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-medium text-vd-text-primary">Filters, Sort & Stack</span>
                                    <div className="flex items-center gap-2">
                                        {activeFilterCount > 0 && <button onClick={clearAllFilters} className="text-[10px] text-vd-accent-gold hover:underline">Clear all</button>}
                                        <button onClick={() => setShowFilters(false)} className="text-[10px] text-vd-text-tertiary hover:text-vd-text-primary transition-colors">Close</button>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    {(missionOptions.length > 0 || data?.tickets.some(ticket => !ticket.missionId)) && (
                                        <label className="block">
                                            <span className="text-[10px] text-vd-text-tertiary uppercase tracking-wider">Mission</span>
                                            <select value={missionFilter} onChange={(e) => setMissionFilter(e.target.value)} className="mt-0.5 w-full text-xs bg-vd-bg-input border border-vd-border rounded-md px-2 py-1.5 text-vd-text-primary focus:border-vd-accent-gold focus:outline-none">
                                                <option value="all">All</option>
                                                <option value="__none__">No Mission</option>
                                                {missionOptions.map((mission) => (
                                                    <option key={mission.id} value={mission.id}>{mission.id} • {mission.title}</option>
                                                ))}
                                            </select>
                                        </label>
                                    )}
                                    <label className="block">
                                        <span className="text-[10px] text-vd-text-tertiary uppercase tracking-wider">Stack By</span>
                                        <select value={stackBy} onChange={(e) => setStackBy(e.target.value as StackField)} className="mt-0.5 w-full text-xs bg-vd-bg-input border border-vd-border rounded-md px-2 py-1.5 text-vd-text-primary focus:border-vd-accent-gold focus:outline-none">
                                            {availableStackFieldOptions.map((option) => (
                                                <option key={option.value} value={option.value}>{option.label}</option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="block">
                                        <span className="text-[10px] text-vd-text-tertiary uppercase tracking-wider">Grouped By</span>
                                        <select value={groupedBy} onChange={(e) => setGroupedBy(e.target.value as GroupField)} className="mt-0.5 w-full text-xs bg-vd-bg-input border border-vd-border rounded-md px-2 py-1.5 text-vd-text-primary focus:border-vd-accent-gold focus:outline-none">
                                            <option value="none">Nothing</option>
                                            {availableStackFieldOptions.filter((option) => option.value !== stackBy).map((option) => (
                                                <option key={option.value} value={option.value}>{option.label}</option>
                                            ))}
                                        </select>
                                    </label>
                                     <label className="block">
                                         <span className="text-[10px] text-vd-text-tertiary uppercase tracking-wider">Sort</span>
                                         <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)} className="mt-0.5 w-full text-xs bg-vd-bg-input border border-vd-border rounded-md px-2 py-1.5 text-vd-text-primary focus:border-vd-accent-gold focus:outline-none">
                                             <option value="updated">Recently Updated</option><option value="default">Default Order</option><option value="priority">By Priority</option><option value="newest">Newest First</option>
                                         </select>
                                     </label>
                                     <div className="grid grid-cols-2 gap-2">
                                         <label className="block">
                                             <span className="text-[10px] text-vd-text-tertiary uppercase tracking-wider">Created</span>
                                             <select value={createdTimeFilter} onChange={(e) => setCreatedTimeFilter(e.target.value as TimeFilter)} className="mt-0.5 w-full text-xs bg-vd-bg-input border border-vd-border rounded-md px-2 py-1.5 text-vd-text-primary focus:border-vd-accent-gold focus:outline-none">
                                                 <option value="all">Any time</option><option value="today">Today</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option>
                                             </select>
                                         </label>
                                         <label className="block">
                                             <span className="text-[10px] text-vd-text-tertiary uppercase tracking-wider">Updated</span>
                                             <select value={updatedTimeFilter} onChange={(e) => setUpdatedTimeFilter(e.target.value as TimeFilter)} className="mt-0.5 w-full text-xs bg-vd-bg-input border border-vd-border rounded-md px-2 py-1.5 text-vd-text-primary focus:border-vd-accent-gold focus:outline-none">
                                                 <option value="all">Any time</option><option value="today">Today</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option>
                                             </select>
                                         </label>
                                     </div>
                                     <div className="block">
                                         <span className="text-[10px] text-vd-text-tertiary uppercase tracking-wider">Status</span>
                                        <div className="mt-1 flex flex-wrap gap-1.5">
                                            {COLUMN_ORDER.map((status) => {
                                                const selected = statusFilter.includes(status);
                                                return (
                                                    <button
                                                        key={status}
                                                        type="button"
                                                        onClick={() => toggleArrayFilterValue(status, setStatusFilter)}
                                                        className={`px-2 py-1 rounded-md border text-[10px] transition-colors ${
                                                            selected
                                                                ? 'border-vd-accent-gold bg-vd-accent-gold/10 text-vd-accent-gold'
                                                                : 'border-vd-border text-vd-text-secondary hover:text-vd-text-primary hover:border-vd-text-tertiary'
                                                        }`}
                                                    >
                                                        {STATUS_LABELS[status] || status}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    <div className="block">
                                        <span className="text-[10px] text-vd-text-tertiary uppercase tracking-wider">Priority</span>
                                        <div className="mt-1 flex flex-wrap gap-1.5">
                                            {/* AD-320: filter buttons stay limited to the canonical priorities;
                                                the Unset lane sentinel is a stack-view-only construct. */}
                                            {(PRIORITY_GROUP_ORDER.filter(p => p !== UNSET_PRIORITY_ID) as Ticket['priority'][]).map((priority) => {
                                                const selected = priorityFilter.includes(priority);
                                                return (
                                                    <button
                                                        key={priority}
                                                        type="button"
                                                        onClick={() => setPriorityFilter((prev) => prev.includes(priority) ? prev.filter((item) => item !== priority) : [...prev, priority])}
                                                        className={`px-2 py-1 rounded-md border text-[10px] transition-colors ${
                                                            selected
                                                                ? 'border-vd-accent-gold bg-vd-accent-gold/10 text-vd-accent-gold'
                                                                : 'border-vd-border text-vd-text-secondary hover:text-vd-text-primary hover:border-vd-text-tertiary'
                                                        }`}
                                                    >
                                                        {PRIORITY_GROUP_META[priority].label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <label className="block">
                                            <span className="text-[10px] text-vd-text-tertiary uppercase tracking-wider">Type</span>
                                            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as TypeFilter)} className="mt-0.5 w-full text-xs bg-vd-bg-input border border-vd-border rounded-md px-2 py-1.5 text-vd-text-primary focus:border-vd-accent-gold focus:outline-none">
                                                <option value="all">All</option><option value="normal">Normal</option><option value="discussion">Discussion</option>
                                            </select>
                                        </label>
                                        <label className="block">
                                            <span className="text-[10px] text-vd-text-tertiary uppercase tracking-wider">Creator</span>
                                            <select value={creatorFilter} onChange={(e) => setCreatorFilter(e.target.value as 'all' | 'human' | 'ai')} className="mt-0.5 w-full text-xs bg-vd-bg-input border border-vd-border rounded-md px-2 py-1.5 text-vd-text-primary focus:border-vd-accent-gold focus:outline-none">
                                                <option value="all">All</option><option value="human">Human</option><option value="ai">AI</option>
                                            </select>
                                        </label>
                                    </div>
                                    {/* AD-180: hide sub-tasks toggle */}
                                    <label className="flex items-center justify-between gap-3 cursor-pointer pt-1">
                                        <span className="text-[11px] text-vd-text-secondary">Hide sub-tasks</span>
                                        <input
                                            type="checkbox"
                                            checked={hideSubtasks}
                                            onChange={(e) => setHideSubtasks(e.target.checked)}
                                            className="w-3.5 h-3.5 accent-vd-accent-gold"
                                        />
                                    </label>
                                    {false && (
                                        <label className="block">
                                            <span className="text-[10px] text-vd-text-tertiary uppercase tracking-wider">Mission</span>
                                            <select value={missionFilter} onChange={(e) => setMissionFilter(e.target.value)} className="mt-0.5 w-full text-xs bg-vd-bg-input border border-vd-border rounded-md px-2 py-1.5 text-vd-text-primary focus:border-vd-accent-gold focus:outline-none">
                                                <option value="all">All Missions</option>
                                                {missionOptions.map((mission) => (
                                                    <option key={mission.id} value={mission.id}>{mission.id} • {mission.title}</option>
                                                ))}
                                            </select>
                                        </label>
                                    )}
                                    {/* AI Addressable filter removed — batch selection replaced it */}
                                    {batches.length > 0 && (
                                        <label className="block">
                                            <span className="text-[10px] text-vd-text-tertiary uppercase tracking-wider">Batch Status</span>
                                            <select value={batchFilter} onChange={(e) => setBatchFilter(e.target.value as 'all' | 'unplanned' | 'planned')} className="mt-0.5 w-full text-xs bg-vd-bg-input border border-vd-border rounded-md px-2 py-1.5 text-vd-text-primary focus:border-vd-accent-gold focus:outline-none">
                                                <option value="all">All</option><option value="unplanned">Unplanned</option><option value="planned">In a Batch</option>
                                            </select>
                                        </label>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Selection controls */}
                    {selectedIds.size > 0 && (
                        <div className="flex items-center gap-1.5 text-xs">
                            <span className="text-vd-accent-gold font-medium">{selectedIds.size} sel</span>
                            <button onClick={clearSelection} className="text-vd-text-tertiary hover:text-vd-text-primary">
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                    )}

                    {/* Action buttons — right side */}
                    <div className="flex items-center gap-1.5 ml-auto flex-shrink-0">
                        {/* Batches toggle — icon only */}
                        <button
                            onClick={() => setShowBatchPane(prev => !prev)}
                            className={`relative p-1.5 border rounded-lg transition-colors ${
                                showBatchPane ? 'border-purple-500 text-purple-400 bg-purple-500/10' : 'border-vd-border text-vd-text-secondary hover:text-purple-400 hover:border-purple-400'
                            }`}
                            title="Toggle batches (B)"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6.429 9.75L2.25 12l4.179 2.25m0-4.5l5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L12 12.75 6.429 9.75m11.142 0l4.179 2.25L12 17.25 2.25 12l4.179-2.25" /></svg>
                            {batches.length > 0 && (
                                <span className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center rounded-full bg-purple-500 text-white text-[8px] font-bold">{batches.length}</span>
                            )}
                        </button>

                        {/* AD-189: Plan Batches button moved into BatchPane.
                            Topbar slot freed up. */}

                        {/* AD-198: Terminal/Shell toggle moved to sit immediately
                            left of `+ Batch` per chat m-mojxzz1y-wfud.
                            Also bumped idle/active border opacities so the
                            outline reads against the topbar background. */}
                        {!isMobile && (
                            <button
                                onClick={() => setShowTerminal(!showTerminal)}
                                className={`relative px-2.5 py-1.5 text-xs font-medium border rounded-lg transition-colors ${
                                    (terminalRunRunning || terminalRunDispatching)
                                        ? 'border-vd-accent-gold text-vd-accent-gold animate-pulse'
                                        : terminalAgentRunning
                                        ? 'border-emerald-500/60 text-emerald-400'
                                        : showTerminal
                                        ? 'border-vd-accent-gold bg-vd-accent-gold/10 text-vd-accent-gold'
                                        : 'border-emerald-500/30 text-vd-text-tertiary hover:text-vd-text-secondary hover:bg-vd-bg-tertiary'
                                }`}
                                title={terminalTitle}
                            >
                                {terminalRunRunning && (
                                    <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-vd-accent-gold opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-vd-accent-gold"></span>
                                    </span>
                                )}
                                {terminalAgentRunning && !terminalRunRunning && (
                                    <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-emerald-400" />
                                )}
                                {/* AD-141: terminal icon inline with the label, inherits the button's
                                    text color so it matches the pill's accent (gold / emerald / muted). */}
                                <span className="inline-flex items-center gap-1.5">
                                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
                                    </svg>
                                    <span className="hidden sm:inline">{terminalLabel}</span>
                                </span>
                            </button>
                        )}

                        {/* + Batch — shown when tickets selected.
                            AD-198: now sits to the right of the Terminal/Shell
                            toggle so Shell-Ready reads as a sibling of the
                            Batches icon. */}
                        {selectedIds.size > 0 && (
                            <button
                                onClick={handleAddToBatch}
                                className="px-2.5 py-1.5 text-xs font-medium border border-purple-500/30 text-purple-400 rounded-lg hover:bg-purple-500/10 transition-colors"
                            >
                                + Batch ({selectedIds.size})
                            </button>
                        )}

                        {/* Run | Copy split button */}
                        {selectedIds.size > 0 && data && (
                            <div className="flex items-center border border-vd-accent-gold/40 rounded-lg overflow-hidden">
                                <button
                                    onClick={async () => {
                                        if (isRunning) return;
                                        const tickets = data.tickets.filter(t => selectedIds.has(t.id));
                                        if (tickets.length === 0) return;

                                        // AD-133: pre-flight — warn if we know Claude Code is broken/outdated
                                        // so the user doesn't watch a prompt get swallowed by a crashing REPL.
                                        if (claudeHealth && (!claudeHealth.ok || claudeHealth.outdated)) {
                                            const reason = claudeHealth.outdated
                                                ? `Claude Code ${claudeHealth.version} is outdated (pre-2.x)`
                                                : `Claude Code is ${claudeHealth.error === 'not_found' ? 'not installed' : 'not responding'}`;
                                            const proceed = window.confirm(
                                                `${reason}.\n\nRun prompts may be lost if the REPL crashes. Upgrade with:\n  npm i -g @anthropic-ai/claude-code@latest\n\nContinue anyway?`
                                            );
                                            if (!proceed) return;
                                        }

                                        setIsRunning(true);
                                        try {
                                            const res = await fetch('/api/run', {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({ ticketIds: tickets.map(t => t.id) }),
                                            });
                                            const result = await res.json();
                                            if (result.success && result.terminal) {
                                                if (result.activeRun) {
                                                    setData(prev => prev ? {
                                                        ...prev,
                                                        activeRuns: [
                                                            ...(prev.activeRuns || []).filter(run => run.runId !== result.activeRun.runId),
                                                            result.activeRun,
                                                        ],
                                                    } : prev);
                                                    setTerminalExecutionIds(prev => {
                                                        const next = new Set(prev);
                                                        for (const id of result.activeRun.ticketIds || []) next.add(String(id).toUpperCase());
                                                        return next;
                                                    });
                                                }
                                                if (Array.isArray(result.updatedTickets)) {
                                                    for (const updatedTicket of result.updatedTickets) {
                                                        replaceTicketLocally(updatedTicket);
                                                    }
                                                }
                                                showToast(result.message || `Sent ${tickets.length} ticket(s) to coding agent`, 3000);
                                                setShowTerminal(true);
                                                // AD-179: clear the multi-select once the run is genuinely
                                                // dispatched — the selected set is a triage primitive, not a
                                                // run-context primitive, and leaving it pinned after the run
                                                // led to accidental Re-Runs on the same set. Failures keep the
                                                // selection so the user can fix the underlying issue and retry.
                                                clearSelection();
                                            } else if (result.autoOpenTerminal || !result.agentReady) {
                                                setShowTerminal(true);
                                                showToast(result.message || 'Start your coding agent, then run again.', 5000);
                                            } else {
                                                showToast(result.message || 'Failed to send prompt to coding agent.', 4000);
                                            }
                                        } catch {
                                            showToast('Failed to send prompt to coding agent.', 4000);
                                        } finally {
                                            setIsRunning(false);
                                        }
                                    }}
                                    className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                                        isRunning
                                            ? 'text-vd-accent-gold/50 cursor-not-allowed'
                                            : 'text-vd-accent-gold hover:bg-vd-accent-gold/10'
                                    }`}
                                    title={isRunning ? 'Running...' : `Run ${selectedIds.size} ticket(s) in terminal`}
                                    disabled={isRunning}
                                >
                                    {isRunning ? (
                                        <>
                                            <span className="hidden sm:inline">⏳ Running...</span>
                                            <span className="sm:hidden">⏳</span>
                                        </>
                                    ) : (
                                        <>
                                            <span className="hidden sm:inline">▶ Run {selectedIds.size}</span>
                                            <span className="sm:hidden">▶</span>
                                        </>
                                    )}
                                </button>
                                <div className="w-px h-5 bg-vd-accent-gold/20" />
                                <button
                                    onClick={async () => {
                                        const tickets = data.tickets.filter(t => selectedIds.has(t.id));
                                        const prompt = buildRunPrompt(tickets.map(t => t.id));
                                        await navigator.clipboard.writeText(prompt);
                                        showToast('Copied! Paste into your AI agent.', 3000);
                                    }}
                                    className="px-2.5 py-1.5 text-xs font-medium text-vd-accent-gold/60 hover:text-vd-accent-gold hover:bg-vd-accent-gold/10 transition-colors"
                                    title={`Copy ${selectedIds.size} ticket(s) for AI`}
                                >
                                    <span className="hidden sm:inline">Copy</span>
                                    <svg className="w-3.5 h-3.5 sm:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" /></svg>
                                </button>
                            </div>
                        )}
                        {/* AD-181 / AD-188: Inbox toggle — second-from-right
                            placement, immediately left of New Ticket per
                            chat message m-moir8zwy-cxe8.
                            AD-198: idle outline bumped from `border-vd-border`
                            to `border-vd-accent-gold/30` so it actually reads
                            against the topbar background — matches the colored
                            outlines other action buttons already use. */}
                        {!isMobile && (
                            <button
                                ref={brainDumpButtonRef}
                                onClick={() => {
                                    if (activeBoardCoachmark === 'brain-dump-main') markCoachMarkSeen('brain-dump-main');
                                    setShowChat(prev => !prev);
                                }}
                                className={`relative px-2.5 py-1.5 text-xs font-medium border rounded-lg transition-colors ${
                                    chatProcessing
                                        ? 'border-vd-accent-gold text-vd-accent-gold animate-pulse'
                                        : showChat
                                            ? 'border-vd-accent-gold bg-vd-accent-gold/10 text-vd-accent-gold'
                                            : 'border-vd-accent-gold/30 text-vd-text-tertiary hover:text-vd-text-secondary hover:bg-vd-bg-tertiary'
                                }`}
                                title={chatProcessing ? 'Triage in progress…' : 'Open Brain Dump — capture thoughts, run the AI to triage them'}
                            >
                                {/* AD-194: pulse dot while triage is in flight (visible even with the panel closed). Same shape as the Terminal button's `terminalRequestRunning` indicator. */}
                                {chatProcessing && (
                                    <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-vd-accent-gold opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-vd-accent-gold"></span>
                                    </span>
                                )}
                                <span className="hidden sm:inline">🧠 Brain Dump</span>
                                <span className="sm:hidden">🧠</span>
                            </button>
                        )}
                        {/* New ticket */}
                        <button
                            ref={newTicketButtonRef}
                            onClick={() => {
                                if (activeBoardCoachmark === 'new-ticket') markCoachMarkSeen('new-ticket');
                                setNewTicketDefaultStatus(undefined);
                                setShowNewTicket(true);
                            }}
                            className="px-2.5 py-1.5 text-xs font-medium bg-vd-accent-gold text-vd-bg-primary rounded-lg hover:bg-vd-accent-gold-light transition-colors"
                        >
                            <span className="hidden sm:inline">+ New Ticket</span>
                            <svg className="w-4 h-4 sm:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                        </button>
                    </div>
                </div>
                {/* Subtle shortcut hints */}
                <div className="px-4 pb-1 hidden sm:flex items-center gap-3 text-[10px] text-vd-text-tertiary/50">
                    <span><kbd className="px-1 py-0.5 rounded bg-vd-bg-tertiary/50 text-[9px]">Ctrl+F</kbd> Search</span>
                    <span><kbd className="px-1 py-0.5 rounded bg-vd-bg-tertiary/50 text-[9px]">B</kbd> Batches</span>
                    <span><kbd className="px-1 py-0.5 rounded bg-vd-bg-tertiary/50 text-[9px]">N</kbd> New ticket</span>
                    <span><kbd className="px-1 py-0.5 rounded bg-vd-bg-tertiary/50 text-[9px]">Ctrl+Shift+F</kbd> Terminal fullscreen</span>
                    <span><kbd className="px-1 py-0.5 rounded bg-vd-bg-tertiary/50 text-[9px]">Esc</kbd> Close</span>
                </div>
            </div>

            {/* Board + Terminal split */}
            {(() => {
                const termVisible = showTerminal && !isMobile;
                const isVertical = termVisible && !termFullscreen && (termPlacement === 'top' || termPlacement === 'bottom');
                const sidebarPad = !isMobile && !embedded ? (sidebarExpanded ? 'pl-44' : 'pl-12') : '';
                // Use CSS order to position the terminal before/after content without changing tree position.
                // This keeps TerminalPane mounted at a stable tree location so toggling fullscreen
                // doesn't unmount/remount it (which destroys the xterm instance and causes flicker).
                const termOrder = !termFullscreen && (termPlacement === 'left' || termPlacement === 'top') ? -1 : 1;

                return (
            <div className={`flex-1 min-h-0 flex ${isVertical ? 'flex-col' : 'flex-row'} ${sidebarPad}`}>
            {/* TerminalPane always rendered at this stable tree position — order CSS handles before/after placement */}
            {/* AD-144 reopen: lazy-mount on first open, then keep mounted and
                control visibility via `hidden`. Unmounting wiped xterm's 10k-line
                scrollback every time the pane was toggled. */}
            {terminalMountedOnce && !isMobile && (
                <TerminalPane
                    hidden={!termVisible}
                    onClose={() => { setShowTerminal(false); setTermFullscreen(false); }}
                    placement={termPlacement}
                    onPlacementChange={setTermPlacement}
                    activeProjectId={activeProjectId}
                    activeProjectName={projects.find(p => p.id === activeProjectId)?.name ?? null}
                    isFullscreen={termFullscreen}
                    onToggleFullscreen={() => setTermFullscreen(f => !f)}
                    sidebarPad={sidebarPad}
                    order={termOrder}
                />
            )}
            {/* Board or Missions */}
            {activeView === 'missions' && data ? (
                <MissionPage
                    missions={data.missions || []}
                    tickets={data.tickets}
                    batches={batches}
                    activeMissionId={missionFilter !== 'all' ? missionFilter : null}
                    onCreateMission={handleCreateMission}
                    onUpdateMission={handleUpdateMission}
                    onDeleteMission={handleDeleteMission}
                    onAddDecision={handleAddMissionDecision}
                    onDiscussMission={handleDiscussMission}
                    onOpenTicket={(ticketId) => {
                        const ticket = data.tickets.find(entry => entry.id === ticketId);
                        if (ticket) setSelectedTicket(ticket);
                    }}
                    onOpenMissionBoard={(missionId) => {
                        setMissionFilter(missionId);
                        setActiveView('board');
                        setShowActivityFeed(false);
                    }}
                />
            ) : (
            <div className="px-4 pb-4 flex-1 min-h-0 flex flex-col min-w-0">
                {missionFilter !== 'all' && data && (() => {
                    const mission = (data.missions || []).find(entry => entry.id === missionFilter);
                    if (!mission) return null;
                    return (
                        <div className="mb-2 rounded-lg border border-vd-accent-gold/20 bg-vd-accent-gold/6 px-3 py-2 flex items-center justify-between gap-3">
                            <div className="min-w-0 flex items-center gap-2.5">
                                <span className="text-[10px] font-mono text-vd-accent-gold flex-shrink-0">{mission.id}</span>
                                <div className="min-w-0">
                                    <div className="text-sm font-medium text-vd-text-primary truncate">{mission.title}</div>
                                    {mission.summary && (
                                        <div className="text-[11px] text-vd-text-tertiary truncate">{mission.summary}</div>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                                <button
                                    onClick={() => setActiveView('missions')}
                                    className="px-2.5 py-1 text-[11px] font-medium border border-vd-border rounded-md text-vd-text-secondary hover:text-vd-text-primary hover:bg-vd-bg-hover transition-colors"
                                >
                                    Mission List
                                </button>
                                <button
                                    onClick={() => setMissionFilter('all')}
                                    className="px-2.5 py-1 text-[11px] font-medium border border-vd-accent-gold/30 rounded-md text-vd-accent-gold hover:bg-vd-accent-gold/10 transition-colors"
                                >
                                    Clear Filter
                                </button>
                            </div>
                        </div>
                    );
                })()}

                {isMobile ? (
                    /* ---- MOBILE: Tab-based single column view ---- */
                    <div className="flex-1 flex flex-col min-h-0">
                        {/* Tab bar — tap to switch columns */}
                        <div className="flex gap-0.5 pb-2 flex-wrap">
                            {visibleStackGroups.map((group) => {
                                const count = (groupedTickets[group.id] || []).length;
                                const shortLabel = group.label.length > 8
                                    ? group.label.split(/\s+/).map(part => part[0]).join('').slice(0, 3).toUpperCase()
                                    : group.label;
                                return (
                                    <button
                                        key={group.id}
                                        onClick={() => {
                                            if (group.id === mobileTab) return;
                                            const fromIdx = visibleStackGroups.findIndex(entry => entry.id === mobileTab);
                                            const toIdx = visibleStackGroups.findIndex(entry => entry.id === group.id);
                                            switchTab(group.id, toIdx > fromIdx ? 'left' : 'right');
                                        }}
                                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                                            mobileTab === group.id
                                                ? 'bg-vd-accent-gold/15 text-vd-accent-gold'
                                                : 'text-vd-text-tertiary'
                                        }`}
                                    >
                                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${group.colorBar}`} />
                                        {shortLabel}
                                        <span className="text-[10px] opacity-70">{count}</span>
                                    </button>
                                );
                            })}
                        </div>

                        {/* Column-level select for mobile */}
                        {(() => {
                            const colTickets = groupedTickets[mobileTab] || [];
                            if (colTickets.length === 0) return null;
                            const colSelectedCount = colTickets.filter(t => selectedIds.has(t.id)).length;
                            const allColSelected = colSelectedCount === colTickets.length;
                            return (
                                <button
                                    onClick={() => selectColumn(mobileTab)}
                                    className="text-[11px] text-vd-text-tertiary hover:text-vd-text-secondary mb-1 self-start px-1 transition-colors"
                                >
                                    {allColSelected ? 'Deselect all' : `Select all (${colTickets.length})`}
                                </button>
                            );
                        })()}

                        {/* Active column — full width, vertically scrollable */}
                        {(() => {
                            const activeGroup = visibleStackGroups.find(group => group.id === mobileTab);
                            const colTickets = groupedTickets[mobileTab] || [];
                            const colColor = activeGroup?.colorBar || 'bg-gray-500';
                            return (
                                <div
                                    className={`vd-restack-column flex-1 flex flex-col bg-vd-bg-primary/50 rounded-xl border border-vd-border min-h-0 transition-transform duration-200 ease-out ${
                                        swipeDirection === 'left' ? '-translate-x-full opacity-0' :
                                        swipeDirection === 'right' ? 'translate-x-full opacity-0' :
                                        'translate-x-0 opacity-100'
                                    } ${isRestacking ? 'vd-restack-active' : ''}`}
                                    style={{ transitionProperty: 'transform, opacity' }}
                                    onTouchStart={handleTouchStart}
                                    onTouchEnd={handleTouchEnd}
                                >
                                    <div className={`h-1 rounded-t-xl ${colColor}`} />
                                    <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2">
                                        {colTickets.map((ticket) => (
                                            <div
                                                key={ticket.id}
                                                onClick={() => { markTicketRead(ticket); setSelectedTicket(ticket); }}
                                                className="bg-vd-bg-secondary rounded-lg p-3 border border-vd-border active:bg-vd-bg-hover"
                                            >
                                                <div className="flex items-start gap-2">
                                                    <h4 className="text-sm font-medium text-vd-text-primary flex-1 line-clamp-2">{ticket.title}</h4>
                                                    <span className="text-[10px] text-vd-text-tertiary flex-shrink-0 mt-0.5">{ticket.id}</span>
                                                </div>
                                                <div className="flex items-center gap-2 mt-1.5">
                                                    {(ticket.ticketType === 'idea' || ticket.ticketType === 'discussion') && (
                                                        <span className="text-[10px] font-semibold px-1 py-0.5 rounded bg-cyan-500/15 text-cyan-400 flex items-center gap-0.5" title="Discussion only">
                                                            <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>
                                                            Discuss
                                                        </span>
                                                    )}
                                                    <span className={`text-[10px] font-semibold ${PRIORITY_COLORS_SIMPLE[ticket.priority]}`}>
                                                        {ticket.priority}
                                                    </span>
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedIds.has(ticket.id)}
                                                        onClick={(e) => e.stopPropagation()}
                                                        onChange={(e) => { e.stopPropagation(); toggleSelect(ticket.id); }}
                                                        className="w-3.5 h-3.5 rounded border-vd-border accent-vd-accent-gold cursor-pointer"
                                                        title="Select for AI copy"
                                                    />
                                                    {(ticket.reopenCount ?? 0) > 0 && (
                                                        <span className="text-[10px] font-semibold text-purple-400">↻{ticket.reopenCount}</span>
                                                    )}
                                                    {ticket.comments.length > 0 && <span className="text-[10px] text-vd-text-tertiary">💬{ticket.comments.length}</span>}
                                                </div>
                                            </div>
                                        ))}
                                        {colTickets.length === 0 && (
                                            <p className="text-sm text-vd-text-tertiary text-center py-8">No tickets</p>
                                        )}
                                    </div>
                                    {stackBy === 'status' && ['backlog', 'todo'].includes(mobileTab) && (
                                        <div className="px-2 pb-2">
                                            <button
                                                onClick={() => handleAddTicketToColumn(mobileTab)}
                                                className="w-full py-1.5 text-xs text-vd-text-tertiary hover:text-vd-text-secondary rounded-lg border border-dashed border-vd-border"
                                            >
                                                + Add ticket
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })()}
                        <p className="text-center text-[10px] text-vd-text-tertiary pt-1">Swipe left/right to change column</p>
                    </div>
                ) : (data?.tickets?.length ?? 0) === 0 ? (
                    /* ---- AD-234: empty-board state (folder selected, 0 tickets) ----
                       Replaces the 5-column kanban with a full-width CTA so the
                       user has a single clear next action instead of five "No
                       tickets" placeholders that read as "ADHDev is broken." */
                    <div className="flex-1 flex items-center justify-center px-6">
                        <div className="max-w-md w-full text-center space-y-6 py-12">
                            <div>
                                <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-vd-accent-gold/10 border border-vd-accent-gold/30 flex items-center justify-center">
                                    <svg className="w-7 h-7 text-vd-accent-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                                    </svg>
                                </div>
                                <h2 className="text-base font-semibold text-vd-text-primary">Your board is ready.</h2>
                                <p className="text-xs text-vd-text-tertiary mt-1">Add the first ticket — or scan this codebase for ones already lurking.</p>
                            </div>
                            <div className="flex flex-col gap-2">
                                <button
                                    onClick={() => handleAddTicketToColumn('todo')}
                                    className="px-4 py-2 text-sm font-medium bg-vd-accent-gold text-vd-text-inverse rounded-md hover:opacity-90"
                                >
                                    Create your first ticket
                                </button>
                                <button
                                    onClick={openCodebaseScan}
                                    className="px-4 py-2 text-sm font-medium border border-vd-accent-gold/40 text-vd-accent-gold rounded-md hover:bg-vd-accent-gold/10"
                                >
                                    Run codebase scan
                                </button>
                            </div>
                            <p className="text-[10px] text-vd-text-tertiary">
                                Tip: the <span className="text-vd-text-secondary font-medium">+ New Ticket</span> button in the header does the same as the first option.
                            </p>
                        </div>
                    </div>
                ) : (
                    /* ---- DESKTOP: Kanban columns with DnD ---- */
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCorners}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                    >
                        {/* Relative wrapper gives the absolute scroll container exact dimensions */}
                        <div className={`flex-1 min-h-0 relative ${isRestacking ? 'vd-restack-active' : ''}`}>
                            <div
                                className="absolute inset-0 feedback-board-scroll"
                                style={{
                                    overflowX: 'scroll',
                                    overflowY: 'hidden',
                                    scrollbarWidth: 'auto',
                                    scrollbarColor: 'rgba(255,255,255,0.25) rgba(255,255,255,0.08)',
                                }}
                            >
                                <div style={{ display: 'inline-flex', gap: '12px', height: '100%', padding: '0 4px 12px 4px', minWidth: '100%' }}>
                                    {visibleStackGroups.map((group) => (
                                        <KanbanColumn
                                            key={group.id}
                                            status={group.id}
                                            config={{ label: group.label, aiInstruction: group.instruction || '' }}
                                            tickets={groupedTickets[group.id] || []}
                                            colorBar={group.colorBar}
                                            onTicketClick={(ticket) => { markTicketRead(ticket); setSelectedTicket(ticket); }}
                                            readTicketCursors={readTicketCursors}
                                            onUpdateInstruction={stackBy === 'status' ? handleUpdateInstruction : () => {}}
                                            onToggleAi={handleToggleAi}
                                            onAddTicket={stackBy === 'status' && ['backlog', 'todo'].includes(group.id) ? handleAddTicketToColumn : undefined}
                                            selectedIds={selectedIds}
                                            onToggleSelect={toggleSelect}
                                            onSelectColumn={selectColumn}
                                            activeExecutionIds={activeExecutionIds}
                                            activeRunStatusByTicket={activeRunStatusByTicket}
                                            stackBy={stackBy}
                                            groupedBy={groupedBy}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>

                        <DragOverlay>
                            {activeTicket && <TicketCardOverlay ticket={activeTicket} />}
                        </DragOverlay>
                    </DndContext>
                )}
            </div>
            )}

            </div>
                ); })()}{/* end Board + Terminal split */}

            {/* Mobile floating action bar when tickets selected */}
            {isMobile && selectedIds.size > 0 && (
                <div className="fixed bottom-0 left-0 right-0 z-40 bg-vd-bg-secondary/95 backdrop-blur-sm border-t border-vd-border px-4 py-3 flex items-center gap-2 vd-animate-slide-up">
                    <button
                        onClick={handleAddToBatch}
                        className="flex-1 px-3 py-2 text-sm font-medium bg-purple-500/15 text-purple-400 border border-purple-500/30 rounded-lg"
                    >
                        Add {selectedIds.size} to Batch
                    </button>
                    <button
                        onClick={async () => {
                            const ids = (data?.tickets || [])
                                .filter(t => selectedIds.has(t.id))
                                .map(t => t.id);
                            if (ids.length === 0) return;
                            const text = buildRunPrompt(ids);
                            await navigator.clipboard.writeText(text);
                        }}
                        className="flex-1 px-3 py-2 text-sm font-medium bg-vd-accent-gold/15 text-vd-accent-gold border border-vd-accent-gold/30 rounded-lg"
                    >
                        Copy {selectedIds.size} for AI
                    </button>
                </div>
            )}

            {/* Batch pane */}
            {showBatchPane && (
                <BatchPane
                    batches={batches}
                    tickets={data?.tickets || []}
                    onClose={() => setShowBatchPane(false)}
                    onRemoveBatch={handleRemoveBatch}
                    onRemoveTicket={handleRemoveTicketFromBatch}
                    onAddTicket={handleAddTicketToBatch}
                    onReorderBatches={handleReorderBatches}
                    onClearAll={handleClearAllBatches}
                    onRenameBatch={handleRenameBatch}
                    onUpdateBatch={handleUpdateBatch}
                    onCopyBatch={handleCopyBatch}
                    onOpenTicket={setSelectedTicket}
                    onOpenTerminal={() => setShowTerminal(true)}
                    onToast={showToast}
                    isMobile={isMobile}
                    onPlanBatches={handlePlanBatchesInTerminal}
                    selectedTicketIds={Array.from(selectedIds)}
                />
            )}

            {/* Modals — AD-016: per-modal error boundaries so a crash inside
                one modal still leaves the kanban board usable. */}
            <ErrorBoundary label="the New Ticket modal">
                <NewTicketModal
                    open={showNewTicket}
                    onClose={() => { setShowNewTicket(false); setNewTicketParentId(null); }}
                    onCreated={fetchData}
                    defaultStatus={newTicketDefaultStatus}
                    allTags={allTags}
                    missionOptions={missionOptions}
                    waveOptions={waveOptions}
                    sessionOptions={sessionOptions}
                    droppedFiles={droppedFiles.length > 0 ? droppedFiles : undefined}
                    onDroppedFilesConsumed={() => setDroppedFiles([])}
                    defaultRelations={newTicketParentId ? [{ kind: 'parent', ticketId: newTicketParentId }] : undefined}
                    parentLabel={newTicketParentId}
                />
            </ErrorBoundary>

            <ErrorBoundary label="the ticket detail modal">
                <TicketDetailModal
                    ticket={selectedTicket}
                    open={!!selectedTicket}
                    onClose={() => setSelectedTicket(null)}
                    allTickets={data?.tickets || []}
                    onOpenChatMessage={openChatMessage}
                    onCreateSubtask={(parentId) => {
                        setNewTicketParentId(parentId);
                        setNewTicketDefaultStatus(undefined);
                        setShowNewTicket(true);
                    }}
                    // AD-251: clicking a linked-ticket row in the modal
                    // swaps the modal to that ticket. Resolve case-insensitively
                    // because the relations graph stores ids in upper-case.
                    onSelectTicket={(linkedId) => {
                        const target = (data?.tickets || []).find(t => t.id.toUpperCase() === linkedId.toUpperCase());
                        if (target) setSelectedTicket(target);
                    }}
                    onUpdate={handleUpdateTicket}
                    onAddComment={handleAddComment}
                    onDelete={handleDeleteTicket}
                    onDeleteComment={handleDeleteComment}
                    allTags={allTags}
                    missionOptions={missionOptions}
                    waveOptions={waveOptions}
                    sessionOptions={sessionOptions}
                    isSelected={selectedTicket ? selectedIds.has(selectedTicket.id) : false}
                    onToggleSelect={toggleSelect}
                    onOpenTerminal={() => setShowTerminal(true)}
                    activeExecutionIds={activeExecutionIds}
                    terminalVisible={showTerminal && !isMobile}
                    terminalPlacement={termPlacement}
                    coachMarks={onboardingState.coachMarks || {}}
                    hideTips={!!onboardingState.hideTips || tipsHiddenThisSession}
                    onCoachMarkSeen={(key) => {
                        void patchOnboardingState({ coachMarks: { ...(onboardingState.coachMarks || {}), [key]: true } });
                    }}
                    onHideAllTips={() => {
                        // AD-236: session-only dismissal. Tips return on next launch.
                        // Persistent dismissal lives in Settings.
                        setTipsHiddenThisSession(true);
                        try { sessionStorage.setItem('adhdev-tips-hidden-session', '1'); } catch { /* ignore */ }
                    }}
                />
            </ErrorBoundary>

            {/* Settings modal */}
            {showSettings && (
                <SettingsModal
                    onClose={() => setShowSettings(false)}
                    projectId={activeProjectId}
                    projectName={projects.find(p => p.id === activeProjectId)?.name ?? null}
                    laneOptions={COLUMN_ORDER.map(status => ({ id: status, label: STATUS_LABELS[status] || status }))}
                    hiddenLaneIds={hiddenStatusIds}
                    onLaneVisibilityChange={setLaneHidden}
                />
            )}

            {/* AD-181: chat slide-in panel */}
            <ErrorBoundary label="the chat panel">
                <ChatPane
                    open={showChat}
                    onClose={() => setShowChat(false)}
                    onToast={showToast}
                    onOpenTicket={(ticketId) => {
                        const ticket = data.tickets.find(entry => entry.id === ticketId);
                        if (ticket) setSelectedTicket(ticket);
                    }}
                    scrollToMessageId={chatScrollToId}
                    onScrollHandled={() => setChatScrollToId(null)}
                    onProcessingChange={setChatProcessing}
                />
            </ErrorBoundary>

            <CoachMark
                show={activeBoardCoachmark === 'new-ticket'}
                targetRef={newTicketButtonRef}
                placement="bottom"
                title="New ticket"
                message="Capture work here. Press N anywhere on the board for the same action."
                onSeen={() => markCoachMarkSeen('new-ticket')}
                onHideAll={() => {
                    setTipsHiddenThisSession(true);
                    try { sessionStorage.setItem('adhdev-tips-hidden-session', '1'); } catch { /* ignore */ }
                }}
            />

            <CoachMark
                show={activeBoardCoachmark === 'brain-dump-main'}
                targetRef={brainDumpButtonRef}
                placement="bottom"
                title="Brain Dump"
                message="Drop loose notes here, then let ADHDev triage them into tickets when you are ready."
                onSeen={() => markCoachMarkSeen('brain-dump-main')}
                onHideAll={() => {
                    setTipsHiddenThisSession(true);
                    try { sessionStorage.setItem('adhdev-tips-hidden-session', '1'); } catch { /* ignore */ }
                }}
            />

            {/* AD-137/130: drag coach mark. Anchored to the first visible ticket card.
                Suppressed while welcome modal is open (no stacking). Only shows when
                no other coach mark is active at the board level — sequential reveal. */}
            <CoachMark
                show={activeBoardCoachmark === 'drag'}
                targetRef={dragAnchorRef}
                placement="right"
                title="Pro tip"
                message="Grab any card and drop it in another column. ADHDev tracks the move as activity so nothing slips through."
                onSeen={() => markCoachMarkSeen('drag')}
                onHideAll={() => {
                    // AD-236: session-only dismissal. Tips return on next launch.
                    setTipsHiddenThisSession(true);
                    try { sessionStorage.setItem('adhdev-tips-hidden-session', '1'); } catch { /* ignore */ }
                }}
            />

            {/* AD-166: 4-step onboarding wizard. Takes precedence over the
                AD-136 welcome modal — picking a folder / agent / git posture
                supersedes the pure-greeting flow. Gated on onboardingLoaded
                so it doesn't flash before /api/onboarding resolves. */}
            {showOnboardingWizard && (
                <OnboardingWizard
                    initialState={{
                        wizardCompleted: onboardingState.wizardCompleted,
                        wizardStep: onboardingWizardStartStep || onboardingState.wizardStep,
                        folderSource: onboardingWizardStartStep === 3 ? 'existing' : onboardingState.folderSource,
                        folderPath: onboardingState.folderPath,
                        agentDetected: onboardingState.agentDetected,
                        gitPosture: onboardingState.gitPosture,
                        remoteUrl: onboardingState.remoteUrl,
                    }}
                    onPatchOnboarding={patchOnboardingState}
                    onClose={() => { setShowOnboardingWizard(false); setOnboardingWizardStartStep(null); }}
                />
            )}

            {/* AD-286: same wizard, "Add new project" mode. onCreateProject
                signals the mode and is called on Finish with the wizard's full
                state — we then POST /api/projects and apply the state to the
                freshly-active new project. */}
            {showAddProjectWizard && (
                <OnboardingWizard
                    initialState={{}}
                    onPatchOnboarding={() => { /* deferred in add-project mode */ }}
                    onCreateProject={handleCreateProjectFromWizard}
                    onClose={() => setShowAddProjectWizard(false)}
                />
            )}

            {/* AD-136/130: first-run welcome. Gated on onboardingLoaded so it doesn't
                flash every page load before /api/onboarding returns. AD-166: also
                suppress while the new wizard is showing — they cover the same first
                paint and the wizard is the authoritative path. */}
            {!showOnboardingWizard && onboardingLoaded && !onboardingState.welcomeSeen && data && (() => {
                const demo = data.tickets.find(t => t.ticketType === 'onboarding' && t.aiAddressable && t.status !== 'done');
                return (
                    <WelcomeModal
                        demoTicketId={demo ? demo.id : null}
                        onClose={() => { void patchOnboardingState({ welcomeSeen: true }); }}
                        onStartSetup={() => setShowOnboardingWizard(true)}
                        onRunDemo={async (id) => {
                            try {
                                await fetch('/api/run', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ ticketId: id }),
                                });
                            } catch { /* surface silently; Run button is also accessible */ }
                        }}
                    />
                );
            })()}


            {/* Activity Feed */}
            {showActivityFeed && data && (
                <ActivityFeed
                    tickets={data.tickets}
                    sessionActivity={(data as unknown as { sessionActivity?: unknown[] }).sessionActivity as [] || []}
                    onClose={() => setShowActivityFeed(false)}
                    onTicketClick={(id) => {
                        const ticket = data.tickets.find(t => t.id === id);
                        if (ticket) { setSelectedTicket(ticket); setShowActivityFeed(false); }
                    }}
                />
            )}

            {/* Toast notification */}
            {toast && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-lg px-4 py-3 rounded-lg bg-vd-bg-secondary border border-vd-border shadow-xl text-sm text-vd-text-primary flex items-start gap-3 animate-in slide-in-from-bottom-4 fade-in duration-200">
                    <svg className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                    </svg>
                    <span>{toast}</span>
                    <button onClick={() => setToast(null)} className="text-vd-text-tertiary hover:text-vd-text-primary ml-2 flex-shrink-0">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            )}
        </div>
    );
}
