// AD-162: ambient signals when a terminal run finishes — tab title swap,
// favicon swap, optional Web Audio ding, optional Notification API ping.
//
// Pure functions + module-level idempotent state. No React. The single
// caller (FeedbackBoard.tsx useEffect) tracks running→idle transitions and
// decides what to fire; this module owns the side effects.

const FAVICON_LINK_ID = 'adhdev-favicon';
const FAVICON_FRAME_INTERVAL_MS = 250;

const NOTIFY_PREF_KEY = 'adhdev-notify-on-done';
const SOUND_PREF_KEY = 'adhdev-sound-on-done';

// AD-162 v2: favicon is the agent mascot — same Lemmings-style character
// rendered in AgentMascot.tsx, but tool-less, centered on the 32×32 plate,
// and reduced to a four-frame bounce-and-blink loop. Pixel maps are
// duplicated from AgentMascot.tsx (CHAR_DEFAULT / CHAR_BLINK) because the
// favicon needs raw SVG strings, not React; the maps are small and stable.
const MASCOT_COLORS: Record<string, string> = {
    G: '#F5B97F',   // body fill (gold)
    D: '#D09558',   // body shadow
    L: '#FCE0BE',   // tuft / highlight
    B: '#1a1a1a',   // eyes / feet
};
const PLATE_BG = '#1a1a1a';

const CHAR_OPEN = [
    '..L....',
    '.GGGG..',
    'GBGBG..',
    '.GGGG..',
    'GGGGGG.',
    'GDDDDG.',
    'GDDDDG.',
    'GDDDDG.',
    '.GGGG..',
    '.B..B..',
];

const CHAR_BLINK = [
    '..L....',
    '.GGGG..',
    'GGGGG..',
    '.GGGG..',
    'GGGGGG.',
    'GDDDDG.',
    'GDDDDG.',
    'GDDDDG.',
    '.GGGG..',
    '.B..B..',
];

function rectsForMap(map: string[], originX: number, originY: number, scale: number): string {
    let out = '';
    for (let dy = 0; dy < map.length; dy++) {
        const row = map[dy];
        for (let dx = 0; dx < row.length; dx++) {
            const c = row[dx];
            const fill = MASCOT_COLORS[c];
            if (!fill) continue;
            out += `<rect x="${originX + dx * scale}" y="${originY + dy * scale}" width="${scale}" height="${scale}" fill="${fill}"/>`;
        }
    }
    return out;
}

// AD-177: previous favicon rendered each character cell at 1×1 px, leaving the
// 7×10 mascot occupying a tiny patch in the centre of the 32×32 plate —
// invisible at browser-tab size. Scale up to 3 px per cell (21×30 area, ~62%
// of the plate) so the running mascot reads as a recognisable character.
const MASCOT_SCALE = 3;
const MASCOT_ORIGIN_X = Math.floor((32 - 7 * MASCOT_SCALE) / 2); // 5
const MASCOT_ORIGIN_Y = 1;                                       // top-aligned to leave room for the bounce

function buildMascotFavicon(map: string[], yBob: number): string {
    // 7-col × 10-row character at MASCOT_SCALE px per cell. yBob is in cell
    // units, scaled into pixels so the bounce stays proportional.
    const rects = rectsForMap(map, MASCOT_ORIGIN_X, MASCOT_ORIGIN_Y + yBob * MASCOT_SCALE, MASCOT_SCALE);
    return svgDataUri(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" shape-rendering="crispEdges">`
        + `<rect width="32" height="32" rx="6" fill="${PLATE_BG}"/>`
        + rects
        + `</svg>`,
    );
}

// AD-177: when no run is live, fall back to the original caret/chevron logo
// (mirrors src/app/icon.svg) instead of a static mascot. Inlined here so this
// module owns its own data URIs and doesn't depend on a network fetch.
function buildCaretFavicon(): string {
    return svgDataUri(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">`
        + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
        + `<stop offset="0%" stop-color="${MASCOT_COLORS.G}"/>`
        + `<stop offset="100%" stop-color="${MASCOT_COLORS.D}"/>`
        + `</linearGradient></defs>`
        + `<rect x="1" y="1" width="30" height="30" rx="7" fill="${PLATE_BG}" stroke="url(#g)" stroke-width="2"/>`
        + `<path d="M10 22 L16 9 L22 22" fill="none" stroke="url(#g)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`
        + `<line x1="12.5" y1="17.5" x2="19.5" y2="17.5" stroke="url(#g)" stroke-width="2.5" stroke-linecap="round"/>`
        + `</svg>`,
    );
}

// Four-frame loop: rest → rise → peak (eyes blink) → descent.
const FAVICON_RUN_FRAMES: string[] = [
    buildMascotFavicon(CHAR_OPEN, 0),
    buildMascotFavicon(CHAR_OPEN, -1),
    buildMascotFavicon(CHAR_BLINK, -2),
    buildMascotFavicon(CHAR_OPEN, -1),
];
// AD-177: idle favicon is the caret, not a static mascot. The mascot now only
// appears while a run is in progress.
const FAVICON_IDLE = buildCaretFavicon();

function svgDataUri(svg: string): string {
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

let faviconAnimationTimer: ReturnType<typeof setInterval> | null = null;
let faviconFrame = 0;
let doneTitleRevertTimer: ReturnType<typeof setTimeout> | null = null;

function ensureFaviconLink(): HTMLLinkElement | null {
    if (typeof document === 'undefined') return null;
    let link = document.getElementById(FAVICON_LINK_ID) as HTMLLinkElement | null;
    if (link) return link;
    // AD-170 reopen #3 — root cause:
    //
    // Next 15 renders a `<link rel="icon" href="/icon.svg?<hash>" ...>` in the
    // <head> from the `app/icon.svg` convention. That link is part of the
    // React tree (Next's Metadata system tracks it via fibers). The previous
    // implementation here did `document.querySelectorAll('link[rel~="icon"]')
    // .forEach(el => el.parentElement?.removeChild(el))` to clear the head
    // before adding ours. That detached Next's React-managed link.
    //
    // On the next render where React reconciled the head fiber for that link
    // (commonly the running -> idle edge after a run completes, because the
    // board state churn causes a high-reconciliation moment), React called
    // `parentNode.removeChild(child)` on a node whose parentNode was already
    // null — throwing `Cannot read properties of null (reading 'removeChild')`
    // INSIDE React's commit phase. Our outer try/catch never caught it because
    // the throw was in React's code, not ours. React 19 dev mode then retried
    // the commit, hit the same orphan fiber, threw again — producing the
    // 17-issue cascade observed, the visible flicker (constant remount),
    // typing-clears (NewTicketModal useState reset on remount), and dropped
    // clicks (handlers torn down between mousedown/mouseup).
    //
    // Fix: don't sweep other icon links at all. Just create ours and append.
    // Browsers use the LAST `<link rel="icon">`, so appending ours to head
    // gives it the win without ever touching the React-managed link.
    try {
        link = document.createElement('link');
        link.id = FAVICON_LINK_ID;
        link.rel = 'icon';
        link.type = 'image/svg+xml';
        document.head.appendChild(link);
        return link;
    } catch {
        return null;
    }
}

function setFaviconHref(href: string) {
    const link = ensureFaviconLink();
    if (link) link.href = href;
}

export function startRunningFavicon() {
    if (faviconAnimationTimer) return;
    faviconFrame = 0;
    setFaviconHref(FAVICON_RUN_FRAMES[0]);
    faviconAnimationTimer = setInterval(() => {
        faviconFrame = (faviconFrame + 1) % FAVICON_RUN_FRAMES.length;
        setFaviconHref(FAVICON_RUN_FRAMES[faviconFrame]);
    }, FAVICON_FRAME_INTERVAL_MS);
}

export function stopRunningFavicon() {
    if (faviconAnimationTimer) {
        clearInterval(faviconAnimationTimer);
        faviconAnimationTimer = null;
    }
    setFaviconHref(FAVICON_IDLE);
}

function buildBaseTitle(projectName: string | null | undefined): string {
    return projectName ? `ADHDev — ${projectName}` : 'ADHDev';
}

function shortTicketList(ticketIds: string[]): string {
    if (ticketIds.length === 0) return '';
    if (ticketIds.length <= 2) return ticketIds.join(', ');
    return `${ticketIds[0]} +${ticketIds.length - 1}`;
}

export function setRunningTitle(ticketIds: string[], projectName: string | null | undefined) {
    if (typeof document === 'undefined') return;
    if (doneTitleRevertTimer) {
        clearTimeout(doneTitleRevertTimer);
        doneTitleRevertTimer = null;
    }
    const list = shortTicketList(ticketIds);
    const prefix = list ? `▶ ${list} running — ` : '▶ Running — ';
    document.title = `${prefix}${buildBaseTitle(projectName)}`;
}

const DONE_TITLE_REVERT_MS = 30 * 1000;

export function setDoneTitle(
    ticketIds: string[],
    projectName: string | null | undefined,
    onRevert?: () => void,
) {
    if (typeof document === 'undefined') return;
    const list = shortTicketList(ticketIds);
    const prefix = list ? `✓ ${list} done — ` : '✓ Done — ';
    document.title = `${prefix}${buildBaseTitle(projectName)}`;
    if (doneTitleRevertTimer) clearTimeout(doneTitleRevertTimer);
    doneTitleRevertTimer = setTimeout(() => {
        doneTitleRevertTimer = null;
        clearTitleOverride(projectName);
        onRevert?.();
    }, DONE_TITLE_REVERT_MS);
}

export function clearTitleOverride(projectName: string | null | undefined) {
    if (typeof document === 'undefined') return;
    if (doneTitleRevertTimer) {
        clearTimeout(doneTitleRevertTimer);
        doneTitleRevertTimer = null;
    }
    document.title = buildBaseTitle(projectName);
}

// ─── Sound: synthesised two-note ding via Web Audio ──────────────
// No asset file. Roughly G6 → C7, exponential decay, ~300 ms total.
// Audio.play / AudioContext require a prior user gesture in most browsers
// — the first call on a fresh tab may silently no-op until the user has
// clicked anywhere in the page. Subsequent calls work. We swallow errors.

let audioCtx: AudioContext | null = null;
function getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (audioCtx) return audioCtx;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    try {
        audioCtx = new Ctor();
    } catch {
        return null;
    }
    return audioCtx;
}

function tone(ctx: AudioContext, freq: number, startAt: number, duration: number, peak: number) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(peak, startAt + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0005, startAt + duration);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.02);
}

export function playDoneSound() {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
        // Resume the context if it was suspended (Chrome's autoplay policy).
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        const now = ctx.currentTime;
        tone(ctx, 1568, now, 0.18, 0.22);          // G6
        tone(ctx, 2093, now + 0.13, 0.22, 0.22);   // C7
    } catch {
        // best-effort — sound is a nice-to-have, never block the flow
    }
}

// AD-162 v2: AudioContext is created suspended on a fresh page load and
// only resumes after a user gesture. Calling this from a real click handler
// (Settings toggle, Test button) unlocks future playDoneSound() calls so
// the *first* completion after a fresh tab actually plays. Without this,
// the first run finishes silently no matter what the toggle says.
export function unlockAudio() {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
    }
}

// ─── Notification API ────────────────────────────────────────────
// We never request permission on page load. The Settings toggle is the
// only path that prompts. If the user enables the toggle and denies the
// browser prompt, the caller is responsible for reverting the toggle
// (see SettingsModal).

export type NotifyPermission = 'default' | 'granted' | 'denied' | 'unsupported';

export function getNotifyPermission(): NotifyPermission {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return Notification.permission as NotifyPermission;
}

export async function requestNotifyPermission(): Promise<NotifyPermission> {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'granted' || Notification.permission === 'denied') {
        return Notification.permission as NotifyPermission;
    }
    try {
        const result = await Notification.requestPermission();
        return result as NotifyPermission;
    } catch {
        return 'denied';
    }
}

export function fireDoneNotification(ticketIds: string[], projectName: string | null | undefined) {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    const list = shortTicketList(ticketIds);
    const title = list ? `✓ ${list} done` : '✓ Run finished';
    const body = projectName ? `ADHDev — ${projectName}` : 'ADHDev';
    try {
        const n = new Notification(title, {
            body,
            icon: FAVICON_IDLE,
            tag: 'adhdev-run-done',  // collapses if multiple fire
        });
        n.onclick = () => {
            try { window.focus(); } catch {}
            try { n.close(); } catch {}
        };
    } catch {
        // best-effort
    }
}

// ─── Settings persistence ────────────────────────────────────────

export function getNotifyPref(): boolean {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(NOTIFY_PREF_KEY) === 'true';
}

export function setNotifyPref(value: boolean) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(NOTIFY_PREF_KEY, value ? 'true' : 'false');
}

export function getSoundPref(): boolean {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(SOUND_PREF_KEY) === 'true';
}

export function setSoundPref(value: boolean) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(SOUND_PREF_KEY, value ? 'true' : 'false');
}
