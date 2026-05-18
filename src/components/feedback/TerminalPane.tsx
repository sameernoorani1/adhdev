'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { getSessionToken, fetchWithAdhdevToken, invalidateSessionToken } from '@/lib/api/sessionToken';
import { AgentLauncherMenu } from './AgentLauncherMenu';

const WS_URL = 'ws://localhost:3112';
const SIZE_KEY = 'adhdev-terminal-size';
const PLACEMENT_KEY = 'adhdev-terminal-placement';

export type TerminalPlacement = 'right' | 'left' | 'bottom' | 'top';

export function getSavedPlacement(): TerminalPlacement {
    if (typeof window === 'undefined') return 'right';
    return (localStorage.getItem(PLACEMENT_KEY) || 'right') as TerminalPlacement;
}

// AD-124: broadcast size/placement changes so overlays (e.g. ticket detail modal)
// can re-inset around the terminal in real time instead of going stale after the
// user drags or re-docks the terminal.
function emitTerminalLayout(size: number, placement: TerminalPlacement) {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('adhdev-terminal-layout', {
        detail: { size, placement },
    }));
}

function getDefaultSize(p: TerminalPlacement): number {
    const isH = p === 'left' || p === 'right';
    if (typeof window === 'undefined') return 500;
    return Math.floor((isH ? window.innerWidth : window.innerHeight) * 0.4);
}

// AD-150 v2 + AD-153: derive xterm's theme from the current CSS variables so
// the terminal pane matches the app's mode, AND override the full ANSI palette
// in light mode. xterm's default palette is tuned for dark backgrounds — bare
// "white" becomes unreadable on a light bg, dim grays disappear, etc. Supply
// a full light-mode palette for readable contrast.
function computeXtermTheme(): Record<string, string> {
    const darkFallback = { background: '#0a0a0a', foreground: '#e0e0e0', cursor: '#F5B97F', selectionBackground: '#F5B97F40' };
    if (typeof window === 'undefined') return darkFallback;
    try {
        const root = document.documentElement;
        const cs = getComputedStyle(root);
        const rgb = (name: string) => {
            const t = cs.getPropertyValue(name).trim();
            if (!t) return '';
            return `rgb(${t.replace(/\s+/g, ' ').replace(/ /g, ', ')})`;
        };
        const bg = rgb('--vd-bg-primary') || darkFallback.background;
        const fg = rgb('--vd-text-primary') || darkFallback.foreground;
        const mode = (root.dataset.adhdevMode as 'dark' | 'light') || 'dark';

        if (mode === 'light') {
            // AD-153: every ANSI channel pinned to a dark shade that holds
            // contrast on a white/near-white background. xterm's defaults
            // (ANSI white = near-white, bright-white = pure white, dim gray
            // = faint) all vanish in light mode — hence the "can't read
            // the text" report.
            return {
                background: bg,
                foreground: fg,
                cursor: '#B8860B',
                cursorAccent: bg,
                selectionBackground: '#F5B97F55',
                selectionForeground: '#1a1a1a',
                black: '#1a1a1a',
                red: '#b91c1c',
                green: '#15803d',
                yellow: '#a16207',
                blue: '#1d4ed8',
                magenta: '#7e22ce',
                cyan: '#0e7490',
                // "white" channel is the default regular text — must be DARK
                // in light mode or everything becomes invisible.
                white: '#374151',
                brightBlack: '#4b5563',
                brightRed: '#dc2626',
                brightGreen: '#16a34a',
                brightYellow: '#ca8a04',
                brightBlue: '#2563eb',
                brightMagenta: '#9333ea',
                brightCyan: '#0891b2',
                // Bright-white is commonly used as "emphasis" — still dark in
                // light mode but slightly lighter than the regular text so
                // bold/emphasis still stands out.
                brightWhite: '#1f2937',
            };
        }

        // AD-153 v2: xterm's default dark palette has a few bad-contrast
        // points — `brightBlack` (used for dim/comment text) renders as ~#666
        // which is barely readable on #0a0a0a, and `white` as ~#e5e5e5 can
        // wash into medium greys. Tune the dark palette specifically for
        // Claude Code's usage (timestamps, metadata, dim secondary text).
        return {
            background: bg,
            foreground: fg,
            cursor: '#F5B97F',
            cursorAccent: bg,
            selectionBackground: '#F5B97F40',
            selectionForeground: fg,
            black: '#0a0a0a',
            red: '#f87171',
            green: '#86efac',
            yellow: '#fde047',
            blue: '#93c5fd',
            magenta: '#d8b4fe',
            cyan: '#67e8f9',
            white: '#e5e7eb',
            // brightBlack is xterm's "dim" channel — used heavily by Claude
            // for secondary text (timestamps, elapsed timers, help hints).
            // Default #666 is too low-contrast on near-black bg; bump to
            // tailwind gray-400 for readable dim without stealing focus.
            brightBlack: '#9ca3af',
            brightRed: '#fca5a5',
            brightGreen: '#bbf7d0',
            brightYellow: '#fef08a',
            brightBlue: '#bfdbfe',
            brightMagenta: '#e9d5ff',
            brightCyan: '#a5f3fc',
            brightWhite: '#f9fafb',
        };
    } catch {
        return darkFallback;
    }
}

interface TerminalPaneProps {
    onClose: () => void;
    placement: TerminalPlacement;
    onPlacementChange: (p: TerminalPlacement) => void;
    activeProjectId?: string | null;
    activeProjectName?: string | null;
    isFullscreen?: boolean;
    onToggleFullscreen?: () => void;
    sidebarPad?: string;
    order?: number;
    // AD-144 reopen: stay mounted across pane toggles so xterm's 10k-line
    // scrollback doesn't evaporate every time the user closes and reopens the
    // pane. When hidden, the outer container uses display:none; the xterm
    // instance and WebSocket survive, and on re-show we refit to the
    // restored layout.
    hidden?: boolean;
}

export function TerminalPane({ onClose, placement, onPlacementChange, activeProjectId, activeProjectName, isFullscreen, onToggleFullscreen, sidebarPad, order, hidden = false }: TerminalPaneProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const outerRef = useRef<HTMLDivElement>(null);
    // AD-150 v2: keep a handle on the xterm instance itself so the theme-change
    // listener can swap its theme object when the user flips dark ↔ light. Using
    // a loose shape here so the ref type doesn't have to import xterm's own
    // types into a non-dynamic-import module.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const termInstanceRef = useRef<any>(null);
    // AD-144 reopen: keep a handle on the fit addon so we can refit when the
    // pane transitions from hidden → visible (cols/rows measured zero while
    // display:none, so xterm ends up tiny until we refit).
    const fitAddonRef = useRef<{ fit: () => void } | null>(null);
    // AD-155 reopen #2: timestamp of the last incoming PTY chunk. The resize
    // debounce reads this to defer the WS resize + Ctrl+L until the agent's
    // output stream quiesces — mid-stream resizes are what produced the
    // character-drop signature documented on this ticket.
    const lastOutputAtRef = useRef<number>(0);
    const [connected, setConnected] = useState(false);
    const [isFocused, setIsFocused] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showResetModal, setShowResetModal] = useState(false);
    const [showPlacementMenu, setShowPlacementMenu] = useState(false);
    // AD-246: Claude Code's CLI condenses multi-line pastes into a tiny
    // "[Pasted text #N +M lines]" placeholder, which made it look like Ctrl+V
    // did nothing — so the user mashed Ctrl+V repeatedly and ended up with a
    // pile of stacked pastes. This toast surfaces the result of the paste
    // outside the xterm canvas so the feedback is unambiguous. Cleared via a
    // timestamped tag check so a fresh paste during the fade doesn't get
    // wiped by an earlier timeout.
    // AD-246 reopen: the original toast told the user a paste landed but not
    // *what* — so when xterm's select-to-copy grabbed stale terminal scrollback
    // and that content paste-replays into the CLI, the mismatch was invisible
    // until it had already been submitted. `preview` carries the first ~60
    // chars of the pasted text so the user sees what's actually leaving the
    // clipboard before they hit Enter.
    const [recentPaste, setRecentPaste] = useState<{ lines: number; chars: number; tag: number; kind: 'ok' | 'empty'; preview?: string } | null>(null);
    // AD-155 9th pass: after a placement (orientation) change, the agent's old
    // hard-wrapped output stays in xterm's scrollback at its original col width
    // — xterm.js does not reflow already-rendered cells, which is the structural
    // limit the prior 8 passes documented. The Force redraw button in the
    // header is the supported recovery, but users (Sameer) keep reporting they
    // don't discover it. This briefly pulses the button after a real placement
    // change so the recovery path becomes visible without auto-clearing the
    // chat (auto-Ctrl+L was tried in passes 5-6 and explicitly removed in
    // pass 8 because it wiped the visible conversation).
    const [redrawHint, setRedrawHint] = useState(false);
    const [size, setSize] = useState(() => {
        if (typeof window === 'undefined') return 500;
        const saved = parseInt(localStorage.getItem(SIZE_KEY) || '', 10);
        return saved >= 200 ? saved : getDefaultSize('right');
    });
    const sizeRef = useRef(size);
    const cleanupRef = useRef<(() => void) | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const [startTime, setStartTime] = useState<Date | null>(null);
    const [sessionTime, setSessionTime] = useState('00:00');

    useEffect(() => { sizeRef.current = size; }, [size]);

    // AD-124: emit initial + live updates so modal backdrops can react to
    // the terminal's current size and placement without polling localStorage.
    useEffect(() => { emitTerminalLayout(size, placement); }, [size, placement]);

    // AD-124: re-broadcast on request. A ticket modal opening after TerminalPane
    // mounted would otherwise miss the one-shot layout event fired on our mount.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const onRequest = () => emitTerminalLayout(sizeRef.current, placement);
        window.addEventListener('adhdev-terminal-layout-request', onRequest);
        return () => window.removeEventListener('adhdev-terminal-layout-request', onRequest);
    }, [placement]);

    // AD-125: track whether keystrokes will land in the terminal (xterm focus)
    // so we can render an unambiguous focus indicator on the pane.
    useEffect(() => {
        const el = outerRef.current;
        if (!el) return;
        const onFocusIn = () => setIsFocused(true);
        const onFocusOut = () => {
            // defer so moving focus between xterm's internal textarea and the
            // helper elements doesn't flicker the ring off-and-on.
            queueMicrotask(() => {
                if (!outerRef.current) return;
                setIsFocused(outerRef.current.contains(document.activeElement));
            });
        };
        el.addEventListener('focusin', onFocusIn);
        el.addEventListener('focusout', onFocusOut);
        return () => {
            el.removeEventListener('focusin', onFocusIn);
            el.removeEventListener('focusout', onFocusOut);
        };
    }, []);

    // Update session timer
    useEffect(() => {
        if (!connected || !startTime) return;

        const updateTimer = () => {
            const now = new Date();
            const diffMs = now.getTime() - startTime.getTime();
            const minutes = Math.floor(diffMs / 60000);
            const seconds = Math.floor((diffMs % 60000) / 1000);
            setSessionTime(`${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
        };

        updateTimer(); // Update immediately
        const interval = setInterval(updateTimer, 1000);
        return () => clearInterval(interval);
    }, [connected, startTime]);

    const isHorizontal = placement === 'left' || placement === 'right';

    // ─── Shared terminal init logic ──────────────────────────────
    const initTerminal = useCallback(async () => {
        const el = containerRef.current;
        if (!el) return;
        el.innerHTML = '';

        const { Terminal } = await import('@xterm/xterm');
        const { FitAddon } = await import('@xterm/addon-fit');

        if (!document.getElementById('xterm-css')) {
            const link = document.createElement('link');
            link.id = 'xterm-css'; link.rel = 'stylesheet';
            link.href = 'https://cdn.jsdelivr.net/npm/@xterm/xterm@5/css/xterm.min.css';
            document.head.appendChild(link);
            await new Promise(r => setTimeout(r, 200));
        }

        const term = new Terminal({
            cursorBlink: true, fontSize: 13, scrollback: 10000,
            cursorStyle: 'bar',
            fontFamily: '"Cascadia Code", "Fira Code", "Consolas", monospace',
            theme: computeXtermTheme(),
            allowProposedApi: true,
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        fitAddonRef.current = fitAddon;

        const sendBracketedPaste = (text: string) => {
            const stripped = text.replace(/\x1b\[200~|\x1b\[201~/g, '');
            if (!stripped) {
                const tag = Date.now();
                setRecentPaste({ lines: 0, chars: 0, tag, kind: 'empty' });
                setTimeout(() => setRecentPaste(prev => (prev?.tag === tag ? null : prev)), 2500);
                return;
            }
            if (wsRef.current?.readyState !== WebSocket.OPEN) return;
            wsRef.current.send(JSON.stringify({ type: 'input', data: '\x1b[200~' + stripped + '\x1b[201~' }));

            const lines = stripped.split('\n').length;
            const tag = Date.now();
            const collapsed = stripped.replace(/\s+/g, ' ').trim();
            const preview = collapsed.length > 60 ? collapsed.slice(0, 60) + '...' : collapsed;
            setRecentPaste({ lines, chars: stripped.length, tag, kind: 'ok', preview });
            setTimeout(() => setRecentPaste(prev => (prev?.tag === tag ? null : prev)), 4000);
        };

        term.attachCustomKeyEventHandler((e) => {
            // Let the browser emit ClipboardEvent; the capture paste handler
            // below sends one bracketed payload and prevents xterm's raw paste.
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
                return false;
            }
            // Ctrl+C: copy selected text, or pass through to terminal (SIGINT)
            if (e.ctrlKey && e.key === 'c') {
                if (e.type === 'keydown') {
                    const selection = term.getSelection();
                    if (selection) {
                        navigator.clipboard.writeText(selection).catch(() => {});
                        return false; // copy, don't send SIGINT
                    }
                    // No selection — let it through as SIGINT
                }
                return true;
            }
            // Shift+Enter / Ctrl+Enter: insert a newline into the TUI's input
            // buffer without submitting. Claude Code's readline treats a bare
            // \n inside a bracketed-paste envelope as "append literal newline,
            // don't submit", which matches the multi-line-edit behaviour the user
            // expects. The browser default sends a plain \r which Claude
            // interprets as submit, so we intercept and rewrite.
            if (e.key === 'Enter' && (e.shiftKey || e.ctrlKey)) {
                if (e.type === 'keydown') {
                    e.preventDefault();
                    if (wsRef.current?.readyState === WebSocket.OPEN) {
                        wsRef.current.send(JSON.stringify({
                            type: 'input',
                            data: '\x1b[200~\n\x1b[201~',
                        }));
                    }
                }
                return false;
            }
            return true;
        });

        term.open(el);
        await new Promise(r => setTimeout(r, 50));

        // Own every browser paste path (Ctrl+V, Cmd+V, context menu, and
        // textarea paste). xterm also listens for paste, so capture first,
        // prevent its raw multiline send, and ship one bracketed WS payload.
        const pasteHandler = (e: ClipboardEvent) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            sendBracketedPaste(e.clipboardData?.getData('text/plain') || '');
            term.focus();
        };
        const pasteTargets = [el, term.element, term.textarea].filter(Boolean) as HTMLElement[];
        pasteTargets.forEach(target => target.addEventListener('paste', pasteHandler, true));

        // Initial fit with stabilization
        fitAddon.fit();
        await new Promise(r => setTimeout(r, 50));
        fitAddon.fit(); // Second fit for stability

        term.focus();
        termInstanceRef.current = term;
        // Re-focus after a delay in case something else steals focus
        setTimeout(() => term.focus(), 300);
        setTimeout(() => term.focus(), 800);

        // Connect WS with project ID
        // AD-204: include the session token as a query param. The terminal
        // server gates the WS upgrade on it. We fetch the token synchronously
        // via a cached promise, then connect — the cost is one extra HTTP
        // round-trip on the very first connect (subsequent connects are cached).
        const wsConnect = async () => {
            const token = await getSessionToken();
            const params = new URLSearchParams();
            if (activeProjectId) params.set('project', activeProjectId);
            if (token) params.set('token', token);
            const qs = params.toString();
            const wsUrl = qs ? `${WS_URL}?${qs}` : WS_URL;
            return new WebSocket(wsUrl);
        };
        let ws: WebSocket;
        try {
            // Synchronous-ish: getSessionToken returns a cached Promise after the
            // first call, so this `await` resolves immediately on every reconnect.
            ws = await wsConnect();
        } catch {
            return; // mount aborted; nothing to clean up
        }
        wsRef.current = ws;

        ws.onopen = () => {
            setConnected(true);
            setError(null);
            setStartTime(new Date());
            // Wait for terminal to be ready before sending resize
            setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN && term.cols && term.rows) {
                    ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
                }
            }, 100);
        };
        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'output') {
                    // AD-155 reopen #2 fix: stamp every incoming output chunk so
                    // the resize debounce can hold the PTY cols change until the
                    // agent's stream quiesces. Mid-stream resizes are what
                    // produced the character-drop signature ("I'll sto" /
                    // " before push" overwrite).
                    lastOutputAtRef.current = Date.now();
                    term.write(msg.data);
                } else if (msg.type === 'clear') { term.clear(); term.reset(); }
                else if (msg.type === 'exit') { term.write('\r\n\x1b[33m[Session ended]\x1b[0m\r\n'); setConnected(false); }
            } catch {}
        };
        // AD-204 follow-up: an upgrade rejection (401 from the terminal server's
        // gate, e.g. token rotated after a server restart) surfaces as a close
        // before onopen. Drop the cached token so the next reconnect attempt
        // re-fetches a fresh one — without this, every reconnect after a token
        // rotation keeps presenting the stale token until the page reloads.
        let opened = false;
        ws.addEventListener('open', () => { opened = true; });
        ws.onclose = () => {
            if (!opened) invalidateSessionToken();
            setConnected(false);
        };
        ws.onerror = () => {
            if (!opened) invalidateSessionToken();
            setError('Terminal server not running. Run: node server/terminal.mjs');
            setConnected(false);
        };

        term.onData((data) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data })); });

        let fitTimer: ReturnType<typeof setTimeout> | null = null;
        let pushTimer: ReturnType<typeof setTimeout> | null = null;
        let lastCols = term.cols;
        let lastRows = term.rows;
        // AD-155 reopen: track whether we've seen the first stable size so the
        // very first observation (which IS a cols change — from xterm's default
        // to whatever fitAddon computes for the container) doesn't trigger the
        // redraw path. Real cols changes only happen after this latches true.
        let initialResizeDone = false;

        // AD-155 reopen #2: split the resize pipeline.
        //   1. Local xterm fit runs on the existing 200 ms debounce so the user
        //      sees the pane fill the new width immediately.
        //   2. PTY resize + Ctrl+L are *quiesce-debounced*: held until 300 ms
        //      pass without any incoming output chunk, capped at 5 s of total
        //      deferral. Mid-stream cols changes were the load-bearing cause of
        //      the character-drop overwrite ("I'll sto" / " before push") —
        //      this gates the cols change to a moment when Claude is between
        //      bursts so its absolute-position escapes don't land on the wrong
        //      row.
        const PTY_QUIESCE_MS = 300;
        const PTY_DEFER_CAP_MS = 5000;

        const sendPtyResize = () => {
            if (ws.readyState !== WebSocket.OPEN) return;
            const colsChanged = term.cols !== lastCols;
            const rowsChanged = term.rows !== lastRows;
            if (!colsChanged && !rowsChanged) return;
            const colsActuallyChanged = colsChanged && initialResizeDone;
            lastCols = term.cols;
            lastRows = term.rows;
            ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
            // AD-155 10th pass: Sameer's specific ask was "when you resize the
            // shape it gets messed up; when the agent writes any new text in
            // its history, then everything gets resized properly. Can we have
            // it update the layout upon resize as well and not just on writing
            // something?"
            //
            // The reason new agent text reflows everything is that Claude
            // Code's Ink TUI re-renders its in-memory React tree on each
            // input event (stdin chunk) and on SIGWINCH. On Windows ConPTY
            // the SIGWINCH propagation through node-pty's resize() is not
            // reliable, so Ink can sit on stale dimensions until the next
            // stdin chunk arrives. We nudge it with an empty bracketed
            // paste — the terminal strips the delimiters, Ink's stdin sees a
            // zero-byte input event, Ink re-renders at the now-current cols
            // without adding any visible content. Pure paste-mode noise; no
            // characters are committed to Claude's input box.
            //
            // Pass 8 explicitly disabled auto-Ctrl+L because it cleared the
            // visible chat — the empty paste is different (no clear escape,
            // no visible bytes) and is the smallest valid nudge.
            //
            // Only fire on a *real* cols change (post-initial-fit). Rows-only
            // changes don't affect wrapping so the nudge would be noise.
            if (colsActuallyChanged) {
                ws.send(JSON.stringify({ type: 'input', data: '\x1b[200~\x1b[201~' }));
            }
            initialResizeDone = true;
        };

        const schedulePtyResize = (deadline: number) => {
            if (pushTimer) clearTimeout(pushTimer);
            const tick = () => {
                pushTimer = null;
                const now = Date.now();
                const sinceOutput = now - lastOutputAtRef.current;
                if (sinceOutput >= PTY_QUIESCE_MS || now >= deadline) {
                    sendPtyResize();
                    return;
                }
                const wait = Math.min(PTY_QUIESCE_MS - sinceOutput, deadline - now);
                pushTimer = setTimeout(tick, Math.max(50, wait));
            };
            // Initial check after the same 200 ms used for fit, so the common
            // case (resize during agent quiet) fires once at the same cadence
            // as before.
            pushTimer = setTimeout(tick, 200);
        };

        const obs = new ResizeObserver(() => {
            if (fitTimer) clearTimeout(fitTimer);
            fitTimer = setTimeout(() => {
                fitTimer = null;
                // rAF: let DOM layout settle before fitting.
                requestAnimationFrame(() => {
                    try {
                        if (!term.element) return;
                        fitAddon.fit();
                        // Quiesce-debounce the PTY-side cols push.
                        schedulePtyResize(Date.now() + PTY_DEFER_CAP_MS);
                    } catch {}
                });
            }, 200);
        });
        obs.observe(el);

        cleanupRef.current = () => {
            if (fitTimer) clearTimeout(fitTimer);
            if (pushTimer) clearTimeout(pushTimer);
            pasteTargets.forEach(target => target.removeEventListener('paste', pasteHandler, true));
            obs.disconnect();
            ws.close();
            term.dispose();
        };
    }, [activeProjectId]);

    // AD-141 take 2: gate WS connection on a known projectId. Connecting before
    // FeedbackBoard has resolved activeProjectId used to make the server fall
    // back to its `currentProjectId` singleton, which cross-wired tabs. Wait
    // until we know which board this pane belongs to before opening the socket.
    useEffect(() => {
        if (!activeProjectId) return;
        const timer = setTimeout(initTerminal, 100);
        return () => { clearTimeout(timer); cleanupRef.current?.(); cleanupRef.current = null; };
    }, [initTerminal, activeProjectId]);

    // AD-144 reopen: when the pane transitions from hidden → visible, xterm
    // needs to refit because its cols/rows measured zero while display:none.
    // Also refocus so the user can start typing immediately.
    useEffect(() => {
        if (hidden) return;
        const raf = requestAnimationFrame(() => {
            try { fitAddonRef.current?.fit(); } catch {}
            try { termInstanceRef.current?.focus(); } catch {}
        });
        return () => cancelAnimationFrame(raf);
    }, [hidden]);

    // AD-155 / AD-270: orientation changes (placement flip, fullscreen toggle)
    // can leave xterm painted at stale dimensions. Refit and refresh xterm's
    // own viewport, but do not send Ctrl+L automatically; that clears many
    // agent TUIs and made maximize/minimize look like the chat was wiped.
    const prevLayoutRef = useRef<string>('');
    useEffect(() => {
        const layout = `${placement}|${isFullscreen ? 'fs' : 'n'}`;
        if (!prevLayoutRef.current) {
            prevLayoutRef.current = layout;
            return;
        }
        const prevPlacement = prevLayoutRef.current.split('|')[0];
        const placementChanged = prevPlacement !== placement;
        if (prevLayoutRef.current === layout) return;
        prevLayoutRef.current = layout;

        // AD-155 9th pass: surface the Force-redraw button after a true
        // placement change (right ↔ left ↔ top ↔ bottom). Skip fullscreen
        // toggles — those were flagged in pass 8 as too noisy. Only pulse
        // when content has been written (lastOutputAtRef > 0), otherwise
        // we'd hint at a redraw of an empty terminal on initial layout.
        let fadeTimer: ReturnType<typeof setTimeout> | null = null;
        if (placementChanged && lastOutputAtRef.current > 0) {
            setRedrawHint(true);
            fadeTimer = setTimeout(() => setRedrawHint(false), 8000);
        }

        // Give CSS transition a beat to settle, then fit + refresh + prompt
        // the running agent to redraw.
        const t = setTimeout(() => {
            try { fitAddonRef.current?.fit(); } catch {}
            try {
                const term = termInstanceRef.current;
                if (term) {
                    if (wsRef.current?.readyState === WebSocket.OPEN) {
                        wsRef.current.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
                    }
                    term.refresh?.(0, (term.rows ?? 1) - 1);
                    term.scrollToBottom?.();
                }
            } catch {}
        }, 220);
        return () => {
            clearTimeout(t);
            if (fadeTimer) clearTimeout(fadeTimer);
        };
    }, [placement, isFullscreen]);

    // AD-150 v2: when the user flips dark ↔ light (or switches skin), the CSS
    // variables on :root update automatically and every Tailwind-styled surface
    // re-paints. xterm doesn't — its theme is held in a JS options object set
    // at construction. Listen for the custom event that applySkin dispatches
    // and swap the theme imperatively.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const onThemeChanged = () => {
            const term = termInstanceRef.current;
            if (!term) return;
            try {
                term.options.theme = computeXtermTheme();
            } catch {}
        };
        window.addEventListener('adhdev-theme-changed', onThemeChanged);
        return () => window.removeEventListener('adhdev-theme-changed', onThemeChanged);
    }, []);

    // ─── Switch project over existing WS ──────────────────────────
    const prevProjectRef = useRef(activeProjectId);
    useEffect(() => {
        if (prevProjectRef.current === activeProjectId) return;
        prevProjectRef.current = activeProjectId;
        if (wsRef.current?.readyState === WebSocket.OPEN && activeProjectId) {
            wsRef.current.send(JSON.stringify({ type: 'switch-project', projectId: activeProjectId }));
        }
    }, [activeProjectId]);

    // ─── Reconnect ───────────────────────────────────────────────
    const handleReconnect = useCallback(() => {
        setError(null);
        cleanupRef.current?.();
        cleanupRef.current = null;
        setTimeout(initTerminal, 100);
    }, [initTerminal]);

    // ─── Reset session ───────────────────────────────────────────
    const handleResetSession = useCallback(() => {
        setShowResetModal(false);
        // Kill current shell and wipe persisted history server-side. Typing
        // `exit` is not reliable when a TUI owns the prompt.
        // AD-144: explicit reset wipes the persisted history file too, so the
        // new shell truly starts blank — otherwise the on-disk scrollback from
        // the just-exited shell would replay into the fresh session.
        // AD-204: forward the session token to the terminal server.
        // fetchWithAdhdevToken transparently recovers from a rotated token
        // (terminal-server restart) by retrying once with a fresh value.
        fetchWithAdhdevToken('http://localhost:3112/reset-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId: activeProjectId || undefined }),
        }).catch(() => {});
        // Wait for shell to die, then reconnect (server spawns new shell)
        setTimeout(() => {
            cleanupRef.current?.();
            cleanupRef.current = null;
            setTimeout(initTerminal, 300);
        }, 500);
    }, [initTerminal, activeProjectId]);

    // ─── Force redraw — recover from accumulated visual debt ─────
    // AD-155 5th pass: when a resize leaves xterm's scrollback at the old
    // column width (hard-newlined tool output, absolute-positioned escapes
    // from the agent), the artifacts can't be reflowed retroactively. This
    // gives the user a one-click recovery: clear xterm's screen + reset its
    // state, refit to the current size, then send Ctrl+L (\x0c) so any
    // running TUI repaints its prompt cleanly. The shell process is NOT
    // killed — Reset Session is still the option for that.
    const handleForceRedraw = useCallback(() => {
        // AD-155 9th pass: clicking the button consumes the post-placement
        // pulse hint immediately so it doesn't keep nudging after the user
        // has already acted on it.
        setRedrawHint(false);
        try {
            const term = termInstanceRef.current;
            if (term) {
                term.clear();
                term.reset();
            }
            fitAddonRef.current?.fit();
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: 'input', data: '\x0c' }));
            }
            termInstanceRef.current?.focus();
        } catch {}
    }, []);

    // ─── Placement change → reset size to sensible default ───────
    const handlePlacementChange = useCallback((p: TerminalPlacement) => {
        const newSize = getDefaultSize(p);
        setSize(newSize);
        sizeRef.current = newSize;
        localStorage.setItem(SIZE_KEY, String(newSize));
        localStorage.setItem(PLACEMENT_KEY, p);
        onPlacementChange(p);
        setShowPlacementMenu(false);
    }, [onPlacementChange]);

    // ─── Drag to resize ──────────────────────────────────────────
    const handleDragStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        const startPos = isHorizontal ? e.clientX : e.clientY;
        const startSize = sizeRef.current;

        document.body.style.cursor = isHorizontal ? 'col-resize' : 'row-resize';
        document.body.style.userSelect = 'none';

        const onMove = (me: MouseEvent) => {
            const cur = isHorizontal ? me.clientX : me.clientY;
            const delta = (placement === 'right' || placement === 'bottom') ? startPos - cur : cur - startPos;
            const max = isHorizontal ? window.innerWidth * 0.65 : window.innerHeight * 0.6;
            const ns = Math.max(200, Math.min(startSize + delta, max));
            setSize(ns);
            sizeRef.current = ns;
        };

        const onUp = () => {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            localStorage.setItem(SIZE_KEY, String(sizeRef.current));
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }, [isHorizontal, placement]);

    // ─── Render ──────────────────────────────────────────────────
    const borderClass = { right: 'border-l', left: 'border-r', bottom: 'border-t', top: 'border-b' }[placement];
    const dragHandleClass = isHorizontal
        ? `absolute top-0 ${placement === 'right' ? 'left-0' : 'right-0'} w-1.5 h-full cursor-col-resize z-10 hover:bg-vd-accent-gold/20 active:bg-vd-accent-gold/40`
        : `absolute left-0 ${placement === 'bottom' ? 'top-0' : 'bottom-0'} w-full h-1.5 cursor-row-resize z-10 hover:bg-vd-accent-gold/20 active:bg-vd-accent-gold/40`;
    const outerStyle = isFullscreen ? { flex: 1 } : isHorizontal ? { width: size } : { height: size };

    // Placement options with visual mini-icons showing where the terminal goes
    const PLACEMENTS: { id: TerminalPlacement; label: string; icon: React.ReactNode }[] = [
        { id: 'right', label: 'Right', icon: <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="1" stroke="currentColor" strokeWidth="1"/><rect x="9" y="2" width="5" height="12" rx="0.5" fill="currentColor" opacity="0.5"/></svg> },
        { id: 'left', label: 'Left', icon: <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="1" stroke="currentColor" strokeWidth="1"/><rect x="2" y="2" width="5" height="12" rx="0.5" fill="currentColor" opacity="0.5"/></svg> },
        { id: 'bottom', label: 'Bottom', icon: <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="1" stroke="currentColor" strokeWidth="1"/><rect x="2" y="9" width="12" height="5" rx="0.5" fill="currentColor" opacity="0.5"/></svg> },
        { id: 'top', label: 'Top', icon: <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="1" stroke="currentColor" strokeWidth="1"/><rect x="2" y="2" width="12" height="5" rx="0.5" fill="currentColor" opacity="0.5"/></svg> },
    ];

    const currentPlacementIcon = PLACEMENTS.find(p => p.id === placement)?.icon;

    return (
        <>
            <div
                ref={outerRef}
                className={
                    // AD-150 v2: theme-aware outer bg — was hardcoded #0a0a0a
                    // which showed as a dark pane in light mode. bg-vd-bg-primary
                    // flips automatically via CSS variables.
                    // AD-155 5th pass: in fullscreen mode the terminal is
                    // `fixed inset-0 z-50` and covers the sidebar entirely. The
                    // sidebarPad (`pl-12` / `pl-44`) was reserving space for a
                    // sidebar nobody can see — leaving an empty band on the
                    // left. Drop it in fullscreen so the terminal claims the
                    // full viewport width.
                    (isFullscreen
                        ? `fixed inset-0 z-[200] flex flex-col bg-vd-bg-primary`
                        : `flex flex-col bg-vd-bg-primary ${borderClass} border-vd-border relative flex-shrink-0`)
                    // AD-125: unambiguous focus indicator. Ring pulses in when keystrokes are live.
                    + (isFocused
                        ? ' outline outline-2 -outline-offset-2 outline-vd-accent-gold shadow-[0_0_0_1px_rgba(245,185,127,0.25)_inset]'
                        : '')
                }
                // AD-144 reopen: hidden via display:none (not unmount) so xterm
                // + WS survive the toggle and the 10k-line client scrollback
                // doesn't evaporate.
                style={{
                    ...(isFullscreen ? {} : { ...outerStyle, order: order ?? undefined }),
                    ...(hidden ? { display: 'none' } : {}),
                }}
            >
                {/* Drag handle (hidden in fullscreen) */}
                {!isFullscreen && <div className={dragHandleClass} onMouseDown={handleDragStart} />}

                {/* Header */}
                <div className={`flex items-center justify-between px-3 py-1.5 border-b border-vd-border flex-shrink-0 transition-colors ${isFocused ? 'bg-vd-accent-gold/10' : 'bg-vd-bg-secondary'}`}>
                    <div className="flex items-center gap-2">
                        <svg className={`w-3.5 h-3.5 ${isFocused ? 'text-vd-accent-gold' : 'text-vd-text-tertiary'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
                        </svg>
                        <span className={`text-[11px] font-medium ${isFocused ? 'text-vd-accent-gold' : 'text-vd-text-primary'}`}>
                            Terminal{isFocused ? ' • typing' : ''}
                        </span>
                        <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-red-500'}`} />
                        {/* AD-141 take 2: show which project/session this terminal is bound to.
                            Replaces the session timer — the previous signal was about how long
                            the shell had been alive, which nobody cared about. Board identity
                            is the important disambiguator when multiple tabs are open. */}
                        {activeProjectName && (
                            <span
                                className="text-[10px] text-vd-accent-gold/90 font-medium truncate max-w-[140px]"
                                title={`Session bound to project: ${activeProjectName}`}
                            >
                                {activeProjectName}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-1">
                        {/* Reconnect — show when disconnected */}
                        {!connected && !error && (
                            <button onClick={handleReconnect} className="text-[9px] px-2 py-0.5 rounded bg-vd-bg-tertiary text-vd-text-secondary hover:text-vd-text-primary" title="Reconnect">
                                Reconnect
                            </button>
                        )}
                        {/* AD-155 5th pass: Force redraw — recovers from
                            stale xterm scrollback after a resize without
                            killing the shell.
                            AD-155 9th pass: pulses after a placement change
                            so the recovery path is discoverable when the
                            user just rearranged the layout and the old
                            output is now mis-sized. */}
                        <button
                            onClick={handleForceRedraw}
                            className={`text-[9px] px-1.5 py-0.5 rounded text-vd-text-tertiary hover:text-vd-text-secondary hover:bg-vd-bg-tertiary${redrawHint ? ' text-vd-accent-gold bg-vd-accent-gold/15 ring-1 ring-vd-accent-gold/40 adhdev-redraw-pulse' : ''}`}
                            title={redrawHint
                                ? 'Layout changed — click to redraw the terminal at the new size'
                                : 'Force redraw — clears stale scrollback and asks the running agent to repaint. Use when a resize left things looking broken.'}
                        >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.582m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                        </button>
                        {/* Agent launcher — click to start an installed agent or install a missing one */}
                        <AgentLauncherMenu wsRef={wsRef} connected={connected} projectId={activeProjectId} />
                        {/* Reset session */}
                        <button
                            onClick={() => setShowResetModal(true)}
                            className="text-[9px] px-1.5 py-0.5 rounded text-vd-text-tertiary hover:text-vd-text-secondary hover:bg-vd-bg-tertiary"
                            title="Reset terminal session — kills the shell and starts a fresh one"
                        >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                            </svg>
                        </button>
                        {/* Placement */}
                        <div className="relative">
                            <button
                                onClick={() => setShowPlacementMenu(!showPlacementMenu)}
                                className="text-[9px] px-1.5 py-0.5 rounded text-vd-text-tertiary hover:text-vd-text-secondary hover:bg-vd-bg-tertiary"
                                title="Position"
                            >
                                {currentPlacementIcon}
                            </button>
                            {showPlacementMenu && (
                                <div className="absolute right-0 top-full mt-1 bg-vd-bg-secondary border border-vd-border rounded-lg shadow-panel z-20 py-1 min-w-[110px]">
                                    {PLACEMENTS.map(opt => (
                                        <button
                                            key={opt.id}
                                            onClick={() => handlePlacementChange(opt.id)}
                                            className={`w-full text-left px-3 py-1.5 text-[10px] flex items-center gap-2.5 hover:bg-vd-bg-tertiary ${placement === opt.id ? 'text-vd-accent-gold' : 'text-vd-text-secondary'}`}
                                        >
                                            {opt.icon}
                                            <span>{opt.label}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        {/* Fullscreen toggle */}
                        {onToggleFullscreen && (
                            <button
                                onClick={onToggleFullscreen}
                                className="text-[9px] px-1.5 py-0.5 rounded text-vd-text-tertiary hover:text-vd-text-secondary hover:bg-vd-bg-tertiary"
                                title={`${isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} (Ctrl+Shift+F)`}
                            >
                                {isFullscreen ? (
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                                    </svg>
                                ) : (
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                                    </svg>
                                )}
                            </button>
                        )}
                        {/* Minimize/Close */}
                        <button
                            onClick={onClose}
                            className="text-vd-text-tertiary hover:text-vd-text-primary text-sm leading-none px-1"
                            title="Hide terminal"
                        >
                            &minus;
                        </button>
                    </div>
                </div>

                {/* Body */}
                {error ? (
                    <div className="flex-1 flex items-center justify-center p-4">
                        <div className="text-center">
                            <p className="text-[12px] text-red-400 mb-2">{error}</p>
                            <code className="text-[11px] bg-vd-bg-tertiary text-vd-accent-gold px-3 py-1.5 rounded block mb-3">node server/terminal.mjs</code>
                            <button onClick={handleReconnect} className="text-[10px] px-3 py-1 rounded bg-vd-accent-gold text-vd-text-inverse font-medium">Retry</button>
                        </div>
                    </div>
                ) : (
                    <div className="relative flex-1 flex flex-col min-h-0">
                        <div
                            ref={containerRef}
                            className="adhdev-terminal-host flex-1 overflow-hidden"
                            style={{ minHeight: 0, padding: '8px 18px 8px 12px' }}
                            onClick={() => {
                                // Focus the terminal when clicking anywhere in the pane
                                termInstanceRef.current?.focus();
                            }}
                        />
                        {/* AD-246: paste-confirmation toast. Lives outside the
                            xterm canvas so the user sees something happened
                            even when Claude Code condensed the paste into a
                            tiny "[Pasted text #N]" placeholder.
                            AD-246 reopen: bumped from 10px top-right to 12px
                            top-center with a content preview, so the user can
                            actually verify the clipboard had what they thought
                            it had — not just that *some* paste landed. */}
                        {recentPaste && (
                            <div
                                className={
                                    'pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-md text-[12px] font-medium shadow-lg transition-opacity max-w-[90%] ' +
                                    (recentPaste.kind === 'ok'
                                        ? 'bg-vd-accent-gold/25 text-vd-accent-gold border border-vd-accent-gold/40'
                                        : 'bg-red-500/20 text-red-300 border border-red-500/40')
                                }
                            >
                                {recentPaste.kind === 'ok' ? (
                                    <span>
                                        <span className="opacity-70">Pasted {recentPaste.lines} line{recentPaste.lines === 1 ? '' : 's'} ({recentPaste.chars} chars):</span>
                                        {recentPaste.preview && (
                                            <span className="ml-1.5 font-mono">&ldquo;{recentPaste.preview}&rdquo;</span>
                                        )}
                                    </span>
                                ) : (
                                    'Clipboard had no text — image paste isn’t supported in the terminal'
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Reset confirmation modal */}
            {showResetModal && (
                <div className="fixed inset-0 z-[220] flex items-center justify-center" onClick={() => setShowResetModal(false)}>
                    <div className="absolute inset-0 bg-black/50" />
                    <div className="relative bg-vd-bg-secondary border border-vd-border rounded-xl px-6 py-5 max-w-xs mx-4" onClick={e => e.stopPropagation()}>
                        <h3 className="text-sm font-semibold text-vd-text-primary mb-2">Reset Terminal Session?</h3>
                        <p className="text-[11px] text-vd-text-secondary mb-4">This will close the current shell and start a fresh session. Any running commands will be terminated.</p>
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setShowResetModal(false)} className="text-[11px] px-3 py-1.5 rounded-lg border border-vd-border text-vd-text-secondary hover:bg-vd-bg-tertiary">Cancel</button>
                            <button onClick={handleResetSession} className="text-[11px] px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30">Reset</button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
