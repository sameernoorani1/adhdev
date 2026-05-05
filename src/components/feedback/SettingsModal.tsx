'use client';

import { useState, useEffect } from 'react';
// AD-162: completion-notification preferences + permission helpers.
import {
    getNotifyPref,
    setNotifyPref,
    getSoundPref,
    setSoundPref,
    requestNotifyPermission,
    getNotifyPermission,
    playDoneSound,
    unlockAudio,
} from '@/lib/feedback/completionNotifier';

// ─── Skin Definitions ───────────────────────────────────────────────
// A skin = colors + fonts + border-radius + spacing + visual decorators
// Applied via CSS custom properties + a dynamic stylesheet for structural changes

interface SkinColors {
    bgPrimary: string; bgSecondary: string; bgTertiary: string; bgHover: string; bgInput: string;
    textPrimary: string; textSecondary: string; textTertiary: string; textInverse: string;
    border: string; borderLight: string;
    accentGold: string; accentGoldLight: string; accentGoldDim: string;
}

interface SkinStyle {
    fontFamily: string;
    fontMono: string;
    borderRadius: string;       // card/column radius
    borderRadiusSm: string;     // badges, pills
    borderRadiusLg: string;     // modals
    cardBorder: string;         // border style for cards
    columnHeaderStyle: 'clean' | 'brackets' | 'prefix';
    badgeStyle: 'pill' | 'brackets' | 'plain';
    scanlines: boolean;
    cursorBlink: boolean;
    uppercase: boolean;         // force uppercase on labels
    letterSpacing: string;
    inputStyle: string;         // additional input styling
}

interface SkinDef {
    id: string;
    name: string;
    description: string;
    category: 'default' | 'modern' | 'terminal' | 'ide';
    style: SkinStyle;
    dark: SkinColors;
    light: SkinColors;
}

const SKINS: SkinDef[] = [
    // ─── Default (Darkmode — neutral) ───────────────────────────
    // AD-172: replaces Ember as the baseline default. Pure neutral grays,
    // white text — the accent palette (chosen separately) is what colours it.
    // Existing users with skinId='default' transparently move to this skin.
    {
        id: 'default',
        name: 'Darkmode',
        description: 'Clean neutral dark — let the accent palette do the talking',
        category: 'default',
        style: {
            fontFamily: '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
            fontMono: '"Cascadia Code", "Fira Code", "JetBrains Mono", monospace',
            borderRadius: '8px', borderRadiusSm: '6px', borderRadiusLg: '12px',
            cardBorder: '1px solid', columnHeaderStyle: 'clean', badgeStyle: 'pill',
            scanlines: false, cursorBlink: false, uppercase: false,
            letterSpacing: 'normal', inputStyle: '',
        },
        dark: {
            bgPrimary: '12 12 14', bgSecondary: '22 22 26', bgTertiary: '32 32 38', bgHover: '42 42 50', bgInput: '18 18 22',
            textPrimary: '240 240 244', textSecondary: '170 170 178', textTertiary: '120 120 130', textInverse: '12 12 14',
            border: '40 40 48', borderLight: '56 56 66',
            accentGold: '#e5e7eb', accentGoldLight: '#f3f4f6', accentGoldDim: '#9ca3af',
        },
        light: {
            // AD-150: body was 250,250,250 and cards were 255,255,255 — a 5-point
            // difference that reads as identical on most displays, so the cards
            // never lifted off the body. Bumped body to tailwind gray-100 and
            // kept cards at pure white so cards now pop cleanly against the body.
            bgPrimary: '243 244 246', bgSecondary: '255 255 255', bgTertiary: '229 231 235', bgHover: '209 213 219', bgInput: '255 255 255',
            textPrimary: '17 24 39', textSecondary: '75 85 99', textTertiary: '156 163 175', textInverse: '255 255 255',
            border: '209 213 219', borderLight: '156 163 175',
            accentGold: '#374151', accentGoldLight: '#4b5563', accentGoldDim: '#1f2937',
        },
    },

    // ─── Emerald (default-shape, green accent) ──────────────────
    // AD-172: third Default-group skin. Same neutral structure as Darkmode
    // but with emerald-tinted accents and a hint of green in the depths.
    {
        id: 'emerald',
        name: 'Emerald',
        description: 'Quiet dark with a green forest accent',
        category: 'default',
        style: {
            fontFamily: '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif',
            fontMono: '"Cascadia Code", "Fira Code", "JetBrains Mono", monospace',
            borderRadius: '8px', borderRadiusSm: '6px', borderRadiusLg: '12px',
            cardBorder: '1px solid', columnHeaderStyle: 'clean', badgeStyle: 'pill',
            scanlines: false, cursorBlink: false, uppercase: false,
            letterSpacing: 'normal', inputStyle: '',
        },
        dark: {
            bgPrimary: '8 14 12', bgSecondary: '14 22 19', bgTertiary: '22 32 28', bgHover: '30 44 38', bgInput: '12 18 16',
            textPrimary: '232 240 234', textSecondary: '160 178 168', textTertiary: '110 130 120', textInverse: '8 14 12',
            border: '34 50 44', borderLight: '50 70 62',
            accentGold: '#34d399', accentGoldLight: '#6ee7b7', accentGoldDim: '#10b981',
        },
        light: {
            bgPrimary: '241 248 245', bgSecondary: '255 255 255', bgTertiary: '226 240 232', bgHover: '208 228 218', bgInput: '255 255 255',
            textPrimary: '12 32 22', textSecondary: '60 90 78', textTertiary: '120 150 138', textInverse: '255 255 255',
            border: '198 222 210', borderLight: '170 200 188',
            accentGold: '#059669', accentGoldLight: '#10b981', accentGoldDim: '#047857',
        },
    },

    // ─── Modern (Clean, Airy) ───────────────────────────────────
    {
        id: 'modern',
        name: 'Frost',
        description: 'Clean lines, soft shadows, indigo accent',
        category: 'modern',
        style: {
            fontFamily: '"Inter", "SF Pro Display", system-ui, sans-serif',
            fontMono: '"SF Mono", "Fira Code", monospace',
            borderRadius: '12px', borderRadiusSm: '8px', borderRadiusLg: '16px',
            cardBorder: 'none', columnHeaderStyle: 'clean', badgeStyle: 'pill',
            scanlines: false, cursorBlink: false, uppercase: false,
            letterSpacing: '-0.01em',
            inputStyle: 'box-shadow: 0 1px 2px rgba(0,0,0,0.05);',
        },
        dark: {
            bgPrimary: '9 9 11', bgSecondary: '15 15 20', bgTertiary: '24 24 32', bgHover: '32 32 42', bgInput: '18 18 24',
            textPrimary: '244 244 245', textSecondary: '161 161 170', textTertiary: '82 82 91', textInverse: '9 9 11',
            border: '39 39 42', borderLight: '52 52 59',
            accentGold: '#818cf8', accentGoldLight: '#a5b4fc', accentGoldDim: '#6366f1',
        },
        light: {
            // AD-150: bump body into zinc-100 territory so cards (255,255,255) lift cleanly.
            bgPrimary: '244 244 245', bgSecondary: '255 255 255', bgTertiary: '228 228 231', bgHover: '212 212 216', bgInput: '255 255 255',
            textPrimary: '9 9 11', textSecondary: '82 82 91', textTertiary: '161 161 170', textInverse: '255 255 255',
            border: '212 212 216', borderLight: '161 161 170',
            accentGold: '#4f46e5', accentGoldLight: '#6366f1', accentGoldDim: '#4338ca',
        },
    },

    // ─── Retro CRT (80s Terminal) ───────────────────────────────
    // AD-172: Phosphor was unreadable — VT323 at small sizes is fine for
    // headlines but body text vanished, and `textTertiary` was rgb(120,85,0)
    // (very dim brown-amber) on a near-black background. Switched to a
    // chunkier readable font with VT323 fallback, brightened the entire
    // text scale, and bumped scanline opacity down so contrast wins.
    {
        id: 'retro-crt',
        name: 'Phosphor',
        description: '80s CRT — scanlines, amber glow, sharp edges',
        category: 'terminal',
        style: {
            fontFamily: '"IBM Plex Mono", "Cascadia Mono", "Consolas", "Courier New", monospace',
            fontMono: '"IBM Plex Mono", "Cascadia Mono", "Consolas", "Courier New", monospace',
            borderRadius: '0px', borderRadiusSm: '0px', borderRadiusLg: '2px',
            cardBorder: '1px solid', columnHeaderStyle: 'brackets', badgeStyle: 'brackets',
            scanlines: true, cursorBlink: true, uppercase: true,
            letterSpacing: '0.04em',
            inputStyle: 'border-style: dashed;',
        },
        dark: {
            bgPrimary: '8 5 0', bgSecondary: '16 11 2', bgTertiary: '26 19 4', bgHover: '36 26 6', bgInput: '12 8 1',
            textPrimary: '255 200 70', textSecondary: '230 170 50', textTertiary: '190 140 40', textInverse: '8 5 0',
            border: '90 65 10', borderLight: '120 88 18',
            accentGold: '#FFC050', accentGoldLight: '#FFD880', accentGoldDim: '#E89A20',
        },
        light: {
            bgPrimary: '255 250 235', bgSecondary: '255 252 242', bgTertiary: '248 240 220', bgHover: '240 230 200', bgInput: '252 248 232',
            textPrimary: '40 28 0', textSecondary: '70 50 5', textTertiary: '100 78 30', textInverse: '255 250 235',
            border: '180 160 110', borderLight: '160 140 95',
            accentGold: '#8B6508', accentGoldLight: '#A07010', accentGoldDim: '#6B4D06',
        },
    },

    // ─── Matrix (Hacker Terminal) ───────────────────────────────
    {
        id: 'matrix',
        name: 'Hex',
        description: 'Green-on-black hacker terminal',
        category: 'terminal',
        style: {
            fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
            fontMono: '"JetBrains Mono", "Fira Code", monospace',
            borderRadius: '2px', borderRadiusSm: '1px', borderRadiusLg: '4px',
            cardBorder: '1px solid', columnHeaderStyle: 'prefix', badgeStyle: 'plain',
            scanlines: false, cursorBlink: true, uppercase: false,
            letterSpacing: '0.02em',
            inputStyle: 'caret-color: #00ff41;',
        },
        dark: {
            bgPrimary: '0 6 0', bgSecondary: '0 12 0', bgTertiary: '0 20 0', bgHover: '0 30 2', bgInput: '0 8 0',
            textPrimary: '0 255 65', textSecondary: '0 180 45', textTertiary: '0 100 25', textInverse: '0 6 0',
            border: '0 50 12', borderLight: '0 75 18',
            accentGold: '#00FF41', accentGoldLight: '#50FF80', accentGoldDim: '#00CC33',
        },
        light: {
            bgPrimary: '242 250 242', bgSecondary: '250 255 250', bgTertiary: '230 244 230', bgHover: '215 236 215', bgInput: '245 252 245',
            textPrimary: '0 40 10', textSecondary: '0 75 20', textTertiary: '60 120 70', textInverse: '250 255 250',
            border: '180 210 180', borderLight: '160 195 160',
            accentGold: '#006B1F', accentGoldLight: '#008826', accentGoldDim: '#004D16',
        },
    },

    // ─── Slate (Clean Terminal) ────────────────────────────────
    {
        id: 'slate-terminal',
        name: 'Slate',
        description: 'Quiet monospace with violet hints',
        category: 'terminal',
        style: {
            fontFamily: '"Menlo", "Cascadia Code", "Fira Code", "JetBrains Mono", monospace',
            fontMono: '"Menlo", "Cascadia Code", "Fira Code", monospace',
            borderRadius: '6px', borderRadiusSm: '4px', borderRadiusLg: '8px',
            cardBorder: '1px solid', columnHeaderStyle: 'prefix', badgeStyle: 'plain',
            scanlines: false, cursorBlink: false, uppercase: false,
            letterSpacing: '0.01em',
            inputStyle: 'caret-color: #c4b5fd; border-width: 1px;',
        },
        dark: {
            bgPrimary: '16 16 24', bgSecondary: '22 22 33', bgTertiary: '30 30 44', bgHover: '38 38 56', bgInput: '18 18 28',
            textPrimary: '220 220 230', textSecondary: '140 140 160', textTertiary: '85 85 105', textInverse: '16 16 24',
            border: '40 40 58', borderLight: '52 52 72',
            accentGold: '#c4b5fd', accentGoldLight: '#ddd6fe', accentGoldDim: '#8b5cf6',
        },
        light: {
            bgPrimary: '248 248 252', bgSecondary: '255 255 255', bgTertiary: '240 240 248', bgHover: '232 232 242', bgInput: '252 252 255',
            textPrimary: '20 20 35', textSecondary: '80 80 100', textTertiary: '140 140 160', textInverse: '255 255 255',
            border: '220 220 235', borderLight: '200 200 218',
            accentGold: '#7c3aed', accentGoldLight: '#8b5cf6', accentGoldDim: '#6d28d9',
        },
    },

    // ─── VS Code (IDE) ──────────────────────────────────────────
    {
        id: 'vscode',
        name: 'Workbench',
        description: 'Dense, blue-accented IDE feel',
        category: 'ide',
        style: {
            fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif',
            fontMono: '"Cascadia Code", "Consolas", "Courier New", monospace',
            borderRadius: '3px', borderRadiusSm: '2px', borderRadiusLg: '6px',
            cardBorder: '1px solid', columnHeaderStyle: 'clean', badgeStyle: 'pill',
            scanlines: false, cursorBlink: false, uppercase: true,
            letterSpacing: '0.04em',
            inputStyle: '',
        },
        dark: {
            bgPrimary: '30 30 30', bgSecondary: '37 37 38', bgTertiary: '45 45 45', bgHover: '55 55 55', bgInput: '60 60 60',
            textPrimary: '212 212 212', textSecondary: '156 156 156', textTertiary: '106 106 106', textInverse: '30 30 30',
            border: '51 51 51', borderLight: '65 65 65',
            accentGold: '#0098ff', accentGoldLight: '#40b0ff', accentGoldDim: '#0078d4',
        },
        light: {
            bgPrimary: '255 255 255', bgSecondary: '246 246 246', bgTertiary: '236 236 236', bgHover: '228 228 228', bgInput: '255 255 255',
            textPrimary: '33 33 33', textSecondary: '97 97 97', textTertiary: '149 149 149', textInverse: '255 255 255',
            border: '214 214 214', borderLight: '197 197 197',
            accentGold: '#005fb8', accentGoldLight: '#0078d4', accentGoldDim: '#004d99',
        },
    },

    // ─── Notepad (Windows 11 Notepad aesthetic) ────────────────
    // AD-172: requested IDE skin that mirrors Windows 11 Notepad —
    // muted dark with a subtle blue caret accent, Cascadia Mono body, soft
    // mica-style chrome.
    {
        id: 'notepad',
        name: 'Notepad',
        description: 'Windows 11 Notepad — clean dark, mono body',
        category: 'ide',
        style: {
            fontFamily: '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif',
            fontMono: '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace',
            borderRadius: '6px', borderRadiusSm: '4px', borderRadiusLg: '8px',
            cardBorder: '1px solid', columnHeaderStyle: 'clean', badgeStyle: 'pill',
            scanlines: false, cursorBlink: false, uppercase: false,
            letterSpacing: 'normal',
            inputStyle: 'caret-color: #4cc2ff;',
        },
        dark: {
            // Notepad dark uses 32,32,32 for chrome, 28,28,28 for tab strip,
            // 23,23,23 for body — translated here to bgSecondary/bgTertiary/bgPrimary.
            bgPrimary: '23 23 23', bgSecondary: '32 32 32', bgTertiary: '40 40 40', bgHover: '50 50 50', bgInput: '28 28 28',
            textPrimary: '236 236 236', textSecondary: '170 170 170', textTertiary: '128 128 128', textInverse: '23 23 23',
            border: '54 54 54', borderLight: '70 70 70',
            accentGold: '#4cc2ff', accentGoldLight: '#7ad2ff', accentGoldDim: '#0078d4',
        },
        light: {
            // Notepad light: pure white body, soft ~243 chrome, blue caret accent.
            bgPrimary: '249 249 249', bgSecondary: '255 255 255', bgTertiary: '243 243 243', bgHover: '232 232 232', bgInput: '255 255 255',
            textPrimary: '32 32 32', textSecondary: '90 90 90', textTertiary: '140 140 140', textInverse: '255 255 255',
            border: '218 218 218', borderLight: '200 200 200',
            accentGold: '#0078d4', accentGoldLight: '#2890e0', accentGoldDim: '#005a9e',
        },
    },

    // ─── JetBrains (IDE) ────────────────────────────────────────
    {
        id: 'jetbrains',
        name: 'Hearth',
        description: 'Warm darcula tones, orange accent',
        category: 'ide',
        style: {
            fontFamily: '"JetBrains Mono", "Fira Code", system-ui, sans-serif',
            fontMono: '"JetBrains Mono", "Fira Code", monospace',
            borderRadius: '4px', borderRadiusSm: '3px', borderRadiusLg: '8px',
            cardBorder: '1px solid', columnHeaderStyle: 'clean', badgeStyle: 'pill',
            scanlines: false, cursorBlink: false, uppercase: false,
            letterSpacing: '0.01em',
            inputStyle: '',
        },
        dark: {
            bgPrimary: '43 43 43', bgSecondary: '49 51 53', bgTertiary: '60 63 65', bgHover: '70 73 75', bgInput: '69 73 74',
            textPrimary: '187 187 187', textSecondary: '150 150 150', textTertiary: '100 100 100', textInverse: '43 43 43',
            border: '64 64 64', borderLight: '80 80 80',
            accentGold: '#cc7832', accentGoldLight: '#e8a95b', accentGoldDim: '#a85a1a',
        },
        light: {
            bgPrimary: '247 247 247', bgSecondary: '255 255 255', bgTertiary: '238 238 238', bgHover: '228 228 228', bgInput: '255 255 255',
            textPrimary: '43 43 43', textSecondary: '100 100 100', textTertiary: '153 153 153', textInverse: '255 255 255',
            border: '205 205 205', borderLight: '185 185 185',
            accentGold: '#a85a1a', accentGoldLight: '#cc7832', accentGoldDim: '#8b4513',
        },
    },
];

// ─── Skin Application ───────────────────────────────────────────────
const SKIN_KEY = 'adhdev-skin';
const MODE_KEY = 'adhdev-mode';
const PALETTE_KEY = 'adhdev-palette';
type Mode = 'dark' | 'light';
type PaletteId = 'default' | 'indigo' | 'emerald' | 'rose' | 'cyan' | 'amber';

// AD-127: per-project palette overrides — keeps the skin's structure (fonts,
// borders, density) but swaps the accent so two projects using the same skin
// still feel distinct at a glance.
const PALETTES: Record<PaletteId, { label: string; dark: { gold: string; goldLight: string; goldDim: string }; light: { gold: string; goldLight: string; goldDim: string } }> = {
    default: { label: 'Default',
        dark:  { gold: '',          goldLight: '',          goldDim: '' },          // '' means keep skin's own accent
        light: { gold: '',          goldLight: '',          goldDim: '' } },
    indigo:  { label: 'Indigo',
        dark:  { gold: '#818cf8',   goldLight: '#a5b4fc',   goldDim: '#6366f1' },
        light: { gold: '#4f46e5',   goldLight: '#6366f1',   goldDim: '#4338ca' } },
    emerald: { label: 'Emerald',
        dark:  { gold: '#34d399',   goldLight: '#6ee7b7',   goldDim: '#10b981' },
        light: { gold: '#059669',   goldLight: '#10b981',   goldDim: '#047857' } },
    rose:    { label: 'Rose',
        dark:  { gold: '#fb7185',   goldLight: '#fda4af',   goldDim: '#f43f5e' },
        light: { gold: '#e11d48',   goldLight: '#f43f5e',   goldDim: '#be123c' } },
    cyan:    { label: 'Cyan',
        dark:  { gold: '#22d3ee',   goldLight: '#67e8f9',   goldDim: '#06b6d4' },
        light: { gold: '#0891b2',   goldLight: '#06b6d4',   goldDim: '#0e7490' } },
    amber:   { label: 'Amber',
        dark:  { gold: '#fbbf24',   goldLight: '#fcd34d',   goldDim: '#f59e0b' },
        light: { gold: '#d97706',   goldLight: '#f59e0b',   goldDim: '#b45309' } },
};

function scopedKey(base: string, projectId?: string | null) {
    return projectId ? `${base}:${projectId}` : base;
}

// AD-237: emerald is the project's intended default accent. The previous
// default of `'default'` (keep the skin's own gold) was a regression — fresh
// installs were rendering peach/orange instead of the design-system emerald.
// Using `'emerald'` here means: never-configured users see green; existing
// users with an explicit palette stored in localStorage keep their pick.
const DEFAULT_PALETTE_ID: PaletteId = 'emerald';

function getSaved(projectId?: string | null): { skinId: string; mode: Mode; paletteId: PaletteId } {
    if (typeof window === 'undefined') return { skinId: 'default', mode: 'dark', paletteId: DEFAULT_PALETTE_ID };
    // AD-127: prefer project-scoped settings, fall back to global keys (also
    // the prior default for existing users so behavior is preserved).
    const skinId = (projectId && localStorage.getItem(scopedKey(SKIN_KEY, projectId)))
        || localStorage.getItem(SKIN_KEY)
        || 'default';
    const mode = ((projectId && localStorage.getItem(scopedKey(MODE_KEY, projectId)))
        || localStorage.getItem(MODE_KEY)
        || 'dark') as Mode;
    const paletteId = ((projectId && localStorage.getItem(scopedKey(PALETTE_KEY, projectId)))
        || localStorage.getItem(PALETTE_KEY)
        || DEFAULT_PALETTE_ID) as PaletteId;
    return { skinId, mode, paletteId };
}

function applySkin(skinId: string, mode: Mode, paletteId: PaletteId = 'default', projectId?: string | null) {
    const skin = SKINS.find(s => s.id === skinId) || SKINS[0];
    const baseColors = mode === 'dark' ? skin.dark : skin.light;
    const paletteOverride = PALETTES[paletteId]?.[mode];
    // AD-127: palette only overrides the accent trio, leaving the skin's
    // structural palette (backgrounds, text, borders) untouched.
    const v = paletteOverride && paletteOverride.gold
        ? { ...baseColors, accentGold: paletteOverride.gold, accentGoldLight: paletteOverride.goldLight, accentGoldDim: paletteOverride.goldDim }
        : baseColors;
    const s = skin.style;
    const root = document.documentElement;

    // Color variables
    root.style.setProperty('--vd-bg-primary', v.bgPrimary);
    root.style.setProperty('--vd-bg-secondary', v.bgSecondary);
    root.style.setProperty('--vd-bg-tertiary', v.bgTertiary);
    root.style.setProperty('--vd-bg-hover', v.bgHover);
    root.style.setProperty('--vd-bg-input', v.bgInput);
    root.style.setProperty('--vd-text-primary', v.textPrimary);
    root.style.setProperty('--vd-text-secondary', v.textSecondary);
    root.style.setProperty('--vd-text-tertiary', v.textTertiary);
    root.style.setProperty('--vd-text-inverse', v.textInverse);
    root.style.setProperty('--vd-border', v.border);
    root.style.setProperty('--vd-border-light', v.borderLight);

    // Structural style overrides — this is what makes skins different from color themes
    const styleEl = document.getElementById('adhdev-skin-overrides') || (() => {
        const el = document.createElement('style');
        el.id = 'adhdev-skin-overrides';
        document.head.appendChild(el);
        return el;
    })();

    styleEl.textContent = `
        /* ── Font ── */
        body, button, input, select, textarea {
            font-family: ${s.fontFamily} !important;
            letter-spacing: ${s.letterSpacing} !important;
        }
        pre, code, .font-mono, kbd {
            font-family: ${s.fontMono} !important;
        }

        /* ── Border Radius ── */
        .rounded-lg, .rounded-card { border-radius: ${s.borderRadius} !important; }
        .rounded-md, .rounded { border-radius: ${s.borderRadiusSm} !important; }
        .rounded-xl, .rounded-panel, .rounded-modal { border-radius: ${s.borderRadiusLg} !important; }
        .rounded-full { border-radius: ${s.borderRadius === '0px' ? '0px' : '9999px'} !important; }
        .rounded-t-xl { border-top-left-radius: ${s.borderRadiusLg} !important; border-top-right-radius: ${s.borderRadiusLg} !important; }
        .rounded-b-xl { border-bottom-left-radius: ${s.borderRadiusLg} !important; border-bottom-right-radius: ${s.borderRadiusLg} !important; }

        /* ── Card style ── */
        ${s.cardBorder === 'none' ? `
            [class*="border-vd-border"]:not(header):not(aside):not([class*="border-b"]):not([class*="border-t"]):not(select):not(input):not(textarea) {
                border-color: transparent !important;
                box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06);
            }
        ` : ''}

        /* ── Input style ── */
        ${s.inputStyle ? `input, textarea, select { ${s.inputStyle} }` : ''}

        /* ── Accent color overrides ── */
        .text-vd-accent-gold { color: ${v.accentGold} !important; }
        .bg-vd-accent-gold { background-color: ${v.accentGold} !important; }
        .border-vd-accent-gold { border-color: ${v.accentGold} !important; }
        .text-vd-accent-gold-light { color: ${v.accentGoldLight} !important; }
        .bg-vd-accent-gold-light { background-color: ${v.accentGoldLight} !important; }
        .text-vd-accent-gold-dim { color: ${v.accentGoldDim} !important; }
        .bg-gold-gradient { background: linear-gradient(135deg, ${v.accentGold} 0%, ${v.accentGoldLight} 50%, ${v.accentGold} 100%) !important; }
        .shadow-gold-sm { box-shadow: 0 2px 8px ${v.accentGold}26 !important; }
        .shadow-gold-md { box-shadow: 0 4px 16px ${v.accentGold}33 !important; }

        /* ── Uppercase labels ── */
        ${s.uppercase ? `
            .text-xs, .text-\\[10px\\], .text-\\[11px\\], .text-\\[9px\\] {
                text-transform: uppercase !important;
            }
        ` : ''}

        /* ── Scanlines overlay (CRT effect) ── */
        ${s.scanlines ? `
            body::after {
                content: '';
                position: fixed;
                inset: 0;
                pointer-events: none;
                z-index: 9999;
                background: repeating-linear-gradient(
                    0deg,
                    transparent,
                    transparent 2px,
                    rgba(0,0,0,0.08) 2px,
                    rgba(0,0,0,0.08) 4px
                );
            }
        ` : `body::after { content: none; }`}

        /* ── Cursor blink on focused inputs ── */
        ${s.cursorBlink ? `
            input:focus, textarea:focus {
                animation: terminal-cursor 1s step-end infinite;
            }
            @keyframes terminal-cursor {
                0%, 100% { border-color: ${v.accentGold}; }
                50% { border-color: transparent; }
            }
        ` : ''}

        /* ── Press Start 2P for ADHDev brand text (preserved across all skins) ── */
        [style*="Press Start 2P"] {
            font-family: "Press Start 2P", cursive !important;
        }
    `;

    // Add Google Fonts for terminal skins
    let fontsEl = document.getElementById('adhdev-skin-fonts') as HTMLLinkElement | null;
    if (!fontsEl) {
        fontsEl = document.createElement('link');
        fontsEl.id = 'adhdev-skin-fonts';
        fontsEl.rel = 'stylesheet';
        document.head.appendChild(fontsEl);
    }

    if (skinId === 'retro-crt') {
        // AD-172: IBM Plex Mono is far more legible than VT323 at small sizes.
        // VT323 stays as a CSS-stack fallback for the retro feel on headlines.
        fontsEl.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=VT323&display=swap';
    } else if (skinId === 'matrix' || skinId === 'jetbrains' || skinId === 'slate-terminal') {
        fontsEl.href = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Fira+Code:wght@400;500&display=swap';
    } else if (skinId === 'modern' || skinId === 'default' || skinId === 'emerald') {
        // AD-172: Inter for the Default-group skins (Frost / Darkmode / Emerald).
        fontsEl.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap';
    } else if (skinId === 'notepad') {
        // AD-172: Notepad ships Cascadia Mono on Win11; web users get the
        // hosted variant. Falls back to Cascadia Code / Consolas via CSS stack.
        fontsEl.href = 'https://fonts.googleapis.com/css2?family=Cascadia+Mono:wght@400;500;600&display=swap';
    } else {
        fontsEl.href = '';
    }

    // Store the skin's structural config for components that need to read it
    root.dataset.adhdevSkin = skinId;
    root.dataset.adhdevPalette = paletteId;
    root.dataset.adhdevMode = mode;

    // AD-127: persist project-scoped when we know the project, otherwise
    // global. We also write the global keys for backwards-compat fallback.
    if (projectId) {
        localStorage.setItem(scopedKey(SKIN_KEY, projectId), skinId);
        localStorage.setItem(scopedKey(MODE_KEY, projectId), mode);
        localStorage.setItem(scopedKey(PALETTE_KEY, projectId), paletteId);
    }
    localStorage.setItem(SKIN_KEY, skinId);
    localStorage.setItem(MODE_KEY, mode);
    localStorage.setItem(PALETTE_KEY, paletteId);

    // AD-150 v2: broadcast theme changes so imperative consumers (xterm's theme
    // object in TerminalPane) can re-paint. CSS variables on :root update
    // automatically; xterm holds its theme in a JS object on construction and
    // needs an explicit notify.
    window.dispatchEvent(new CustomEvent('adhdev-theme-changed', {
        detail: {
            mode,
            bgPrimary: v.bgPrimary,
            bgSecondary: v.bgSecondary,
            bgTertiary: v.bgTertiary,
            textPrimary: v.textPrimary,
            accentGold: v.accentGold,
        },
    }));
}

// Export for use by FeedbackBoard on mount / on project switch.
export function initSkin(projectId?: string | null) {
    const { skinId, mode, paletteId } = getSaved(projectId);
    applySkin(skinId, mode, paletteId, projectId);
}

export { PALETTES };
export type { PaletteId };

// ─── Skin Card ──────────────────────────────────────────────────────
function SkinCard({ skin, mode, isActive, onClick }: { skin: SkinDef; mode: Mode; isActive: boolean; onClick: () => void }) {
    const v = mode === 'dark' ? skin.dark : skin.light;
    const s = skin.style;
    const bg = (triplet: string) => `rgb(${triplet})`;

    return (
        <button
            onClick={onClick}
            // AD-172: active card now uses a thick accent ring + ring-offset
            // against the modal body so the selection reads at a glance.
            // Inactive cards keep a quiet 1px border with a hover lift.
            // AD-197: dropped the active+hover scale transforms — they pushed
            // the active card's top edge up by 1% of its height, which read as
            // sibling tops being misaligned within a row. Ring + Active pill
            // already convey activeness.
            className={`relative w-full text-left transition-all ${isActive ? 'ring-[3px] ring-vd-accent-gold ring-offset-2 ring-offset-vd-bg-secondary shadow-gold-md' : 'ring-1 ring-vd-border hover:ring-2 hover:ring-vd-border-light'}`}
            style={{ borderRadius: s.borderRadiusLg, overflow: 'hidden' }}
        >
            {/* AD-172: active marker — small accent pill in the top-right. */}
            {isActive && (
                <div className="absolute top-1.5 right-1.5 z-10 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider rounded-full" style={{
                    background: v.accentGold,
                    color: `rgb(${v.textInverse})`,
                    letterSpacing: '0.08em',
                }}>
                    Active
                </div>
            )}

            {/* Color band — accent strip along top */}
            <div className="h-1.5" style={{ background: v.accentGold }} />

            {/* Card body */}
            <div className="px-3 py-2.5 relative" style={{ background: bg(v.bgSecondary) }}>
                {/* Scanline texture hint for CRT skin */}
                {s.scanlines && (
                    <div className="absolute inset-0 pointer-events-none opacity-30" style={{
                        background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.15) 2px, rgba(0,0,0,0.15) 4px)',
                    }} />
                )}

                {/* Name */}
                {/* AD-197: pin lineHeight + minHeight on the title and the
                    description so different per-skin fontFamilies (Inter, JB
                    Mono, system, etc.) don't shift the visible baselines and
                    make a row of cards look unaligned. */}
                <div className="text-[12px] font-semibold relative" style={{
                    color: bg(v.textPrimary),
                    fontFamily: s.fontFamily,
                    letterSpacing: s.letterSpacing,
                    textTransform: s.uppercase ? 'uppercase' : 'none',
                    lineHeight: '16px',
                    minHeight: '16px',
                }}>
                    {skin.name}
                </div>

                {/* Description */}
                <div className="text-[9px] mt-0.5 relative" style={{
                    color: bg(v.textTertiary),
                    fontFamily: s.fontFamily,
                    lineHeight: '13px',
                    minHeight: '26px',
                }}>
                    {skin.description}
                </div>

                {/* Sample row — tiny visual hint of the skin's character */}
                <div className="flex items-center gap-1.5 mt-2 relative">
                    <div className="text-[7px] px-1 py-0.5" style={{
                        background: `${v.accentGold}20`,
                        color: v.accentGold,
                        borderRadius: s.badgeStyle === 'brackets' ? '0px' : s.borderRadiusSm,
                        fontFamily: s.fontMono,
                        border: s.badgeStyle === 'brackets' ? `1px solid ${v.accentGold}40` : 'none',
                    }}>
                        {s.badgeStyle === 'brackets' ? '[TODO]' : s.badgeStyle === 'plain' ? 'todo' : 'Todo'}
                    </div>
                    <div className="flex-1 h-px" style={{ background: bg(v.border) }} />
                    <div className="w-2 h-2" style={{ background: v.accentGold, borderRadius: s.borderRadiusSm }} />
                </div>
            </div>
        </button>
    );
}

// ─── Settings Modal ─────────────────────────────────────────────────
export function SettingsModal({ onClose, projectId, projectName }: { onClose: () => void; projectId?: string | null; projectName?: string | null }) {
    const [currentSkin, setCurrentSkin] = useState('default');
    const [currentMode, setCurrentMode] = useState<Mode>('dark');
    const [currentPalette, setCurrentPalette] = useState<PaletteId>('default');
    const [protocolContent, setProtocolContent] = useState('');
    const [protocolPath, setProtocolPath] = useState('ADHDEV.md');
    const [showProtocol, setShowProtocol] = useState(false);
    // AD-137: surface the global "Hide tips" flag from the onboarding config.
    const [hideTips, setHideTips] = useState(false);
    // AD-162: completion-notification preferences (Notification API + Web Audio).
    const [notifyOnDone, setNotifyOnDoneState] = useState(false);
    const [soundOnDone, setSoundOnDoneState] = useState(false);
    const [notifyError, setNotifyError] = useState<string | null>(null);
    // AD-164: tab navigation — collapses what was a single 9-section scroll
    // into Theme / Behavior / Reference. Modal-local state, no URL routing.
    const [tab, setTab] = useState<'theme' | 'behavior' | 'reference'>('theme');
    // AD-011: editable display name. Hydrates from /api/config and PATCHes
    // back on commit (blur or Enter). Empty values are rejected by the API,
    // so we only call save when there's a real change to a non-empty value.
    const [displayName, setDisplayName] = useState('');
    const [displayNameSaved, setDisplayNameSaved] = useState('');
    const [displayNameError, setDisplayNameError] = useState<string | null>(null);

    useEffect(() => {
        const saved = getSaved(projectId);
        setCurrentSkin(saved.skinId);
        setCurrentMode(saved.mode);
        setCurrentPalette(saved.paletteId);
    }, [projectId]);

    useEffect(() => {
        fetch('/api/onboarding').then(r => r.json()).then(d => {
            setHideTips(!!(d.onboardingState && d.onboardingState.hideTips));
        }).catch(() => { /* non-fatal */ });
    }, [projectId]);

    // AD-011: hydrate the display name field from project config.
    useEffect(() => {
        fetch('/api/config').then(r => r.json()).then(d => {
            const name = typeof d?.userDisplayName === 'string' ? d.userDisplayName : '';
            setDisplayName(name);
            setDisplayNameSaved(name);
            setDisplayNameError(null);
        }).catch(() => { /* non-fatal */ });
    }, [projectId]);

    const commitDisplayName = async () => {
        const next = displayName.trim();
        if (!next) {
            setDisplayNameError('Display name cannot be empty.');
            setDisplayName(displayNameSaved);
            return;
        }
        if (next === displayNameSaved) return;
        try {
            const res = await fetch('/api/config', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userDisplayName: next }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                setDisplayNameError(typeof data?.error === 'string' ? data.error : 'Failed to save.');
                return;
            }
            const data = await res.json();
            const saved = typeof data?.userDisplayName === 'string' ? data.userDisplayName : next;
            setDisplayName(saved);
            setDisplayNameSaved(saved);
            setDisplayNameError(null);
        } catch {
            setDisplayNameError('Failed to save.');
        }
    };

    const toggleHideTips = async (next: boolean) => {
        setHideTips(next);
        try {
            await fetch('/api/onboarding', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ onboardingState: { hideTips: next } }),
            });
        } catch { /* optimistic update already applied */ }
    };

    // AD-162: load completion-notification prefs on mount.
    useEffect(() => {
        setNotifyOnDoneState(getNotifyPref());
        setSoundOnDoneState(getSoundPref());
    }, []);

    // AD-162: enabling Notify requests browser permission. If denied, we
    // revert the toggle and surface why — silently ignoring would make the
    // toggle look enabled while no notifications would ever fire.
    const toggleNotifyOnDone = async (next: boolean) => {
        setNotifyError(null);
        if (!next) {
            setNotifyOnDoneState(false);
            setNotifyPref(false);
            return;
        }
        const current = getNotifyPermission();
        if (current === 'unsupported') {
            setNotifyError('This browser does not support Notifications.');
            return;
        }
        if (current === 'denied') {
            setNotifyError('Notifications are blocked for this site. Allow them in your browser site settings, then re-enable here.');
            return;
        }
        const result = current === 'granted' ? 'granted' : await requestNotifyPermission();
        if (result === 'granted') {
            setNotifyOnDoneState(true);
            setNotifyPref(true);
        } else {
            setNotifyError(result === 'denied'
                ? 'You denied the browser prompt. Allow notifications for this site, then re-enable here.'
                : 'Notification permission was not granted.');
            setNotifyOnDoneState(false);
            setNotifyPref(false);
        }
    };

    const toggleSoundOnDone = (next: boolean) => {
        setSoundOnDoneState(next);
        setSoundPref(next);
        // AD-162 v2: this click is a user gesture — use it to unlock the
        // AudioContext so the *first* completion after page load actually
        // plays. Without this, the AudioContext stays suspended and silent
        // until the user happens to click Test or some other control.
        if (next) unlockAudio();
    };

    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onClose]);

    const handleSelect = (id: string, mode: Mode, palette: PaletteId = currentPalette) => {
        setCurrentSkin(id);
        setCurrentMode(mode);
        setCurrentPalette(palette);
        applySkin(id, mode, palette, projectId);
    };

    // AD-164 reopen: open the modal immediately with a loading sentinel so
    // the click feels responsive. Previously the awaited fetch held the modal
    // closed for ~100–300 ms with no visual feedback, which read as
    // "takes a long time to open". Then fill content as soon as fetch lands.
    const openProtocol = () => {
        setProtocolContent('Loading…');
        setProtocolPath('ADHDEV.md');
        setShowProtocol(true);
        fetch('/api/protocol')
            .then(r => r.json())
            .then(data => {
                setProtocolContent(data.content || '');
                setProtocolPath(data.projectPath || 'ADHDEV.md');
            })
            .catch(() => {
                setProtocolContent('Failed to load ADHDEV.md');
            });
    };

    // AD-164 reopen: dedicated Escape handler for the protocol viewer so
    // close is reliable even if the X-button click bubbles oddly. Captures
    // before the Settings-modal Escape handler stops at the protocol layer.
    useEffect(() => {
        if (!showProtocol) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                setShowProtocol(false);
            }
        };
        window.addEventListener('keydown', handler, true);
        return () => window.removeEventListener('keydown', handler, true);
    }, [showProtocol]);

    // AD-172: explicit order in the Default group — Frost / Darkmode / Emerald,
    // matching the requested trio. The SKINS array order is left
    // untouched (legacy localStorage IDs still resolve), but display order
    // is locked here.
    const defaultSkins = (['modern', 'default', 'emerald'] as const)
        .map(id => SKINS.find(s => s.id === id))
        .filter((s): s is SkinDef => !!s);
    const terminalSkins = SKINS.filter(s => s.category === 'terminal');
    const ideSkins = SKINS.filter(s => s.category === 'ide');

    return (
        <div className="fixed inset-0 z-[55] flex items-center justify-center" onClick={onClose}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <div className="relative bg-vd-bg-secondary border border-vd-border w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col overflow-hidden" style={{ borderRadius: 'var(--adhdev-modal-radius, 12px)' }} onClick={e => e.stopPropagation()}>
                <div className="bg-vd-bg-secondary border-b border-vd-border px-5 py-3 flex items-center justify-between shrink-0">
                    <h2 className="text-sm font-semibold text-vd-text-primary">Settings</h2>
                    <button onClick={onClose} className="text-vd-text-tertiary hover:text-vd-text-primary text-lg">&times;</button>
                </div>

                <div className="flex flex-1 min-h-0">
                    {/* AD-164: left-nav tabs replace what was a single 9-section scroll. */}
                    <nav className="w-40 shrink-0 border-r border-vd-border bg-vd-bg-tertiary/40 p-2 space-y-0.5">
                        {([
                            { id: 'theme' as const, label: 'Theme' },
                            { id: 'behavior' as const, label: 'Behavior' },
                            { id: 'reference' as const, label: 'Reference' },
                        ]).map(t => (
                            <button
                                key={t.id}
                                onClick={() => setTab(t.id)}
                                className={`w-full text-left px-3 py-1.5 text-[11px] rounded-md transition-colors ${tab === t.id
                                    ? 'bg-vd-accent-gold/15 text-vd-accent-gold font-semibold'
                                    : 'text-vd-text-secondary hover:bg-vd-bg-hover hover:text-vd-text-primary'}`}
                            >
                                {t.label}
                            </button>
                        ))}
                    </nav>

                    <div className="flex-1 overflow-y-auto p-5">
                        {tab === 'theme' && (
                            <>
                                {/* AD-127: scope banner — makes it clear this applies to just this project */}
                                {projectId && (
                                    <div className="mb-4 px-3 py-2 rounded-lg border border-vd-accent-gold/30 bg-vd-accent-gold/5 flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-vd-accent-gold" />
                                        <span className="text-[11px] text-vd-text-secondary">Theme settings apply to <span className="font-semibold text-vd-accent-gold">{projectName || 'this project'}</span> only.</span>
                                    </div>
                                )}

                                {/* Mode toggle */}
                                <div className="flex items-center justify-between mb-6">
                                    <div>
                                        <h3 className="text-xs font-semibold text-vd-text-primary">Mode</h3>
                                        <p className="text-[10px] text-vd-text-tertiary mt-0.5">Switch between dark and light</p>
                                    </div>
                                    <div className="flex border border-vd-border overflow-hidden" style={{ borderRadius: '6px' }}>
                                        <button onClick={() => handleSelect(currentSkin, 'dark')} className={`text-[11px] px-4 py-1.5 transition-colors ${currentMode === 'dark' ? 'bg-vd-accent-gold text-vd-text-inverse font-semibold' : 'text-vd-text-secondary hover:bg-vd-bg-tertiary'}`}>Dark</button>
                                        <button onClick={() => handleSelect(currentSkin, 'light')} className={`text-[11px] px-4 py-1.5 transition-colors ${currentMode === 'light' ? 'bg-vd-accent-gold text-vd-text-inverse font-semibold' : 'text-vd-text-secondary hover:bg-vd-bg-tertiary'}`}>Light</button>
                                    </div>
                                </div>

                                {/* AD-127: palette — accent color variants within the chosen skin */}
                                <div className="mb-6">
                                    <h3 className="text-xs font-semibold text-vd-text-primary mb-0.5">Accent Palette</h3>
                                    <p className="text-[10px] text-vd-text-tertiary mb-3">Swap the accent color so projects on the same skin still feel distinct</p>
                                    <div className="flex flex-wrap gap-2">
                                        {(Object.keys(PALETTES) as PaletteId[]).map(pid => {
                                            const isActive = currentPalette === pid;
                                            const preview = PALETTES[pid][currentMode];
                                            const skinDef = SKINS.find(sk => sk.id === currentSkin) || SKINS[0];
                                            const color = preview.gold || (currentMode === 'dark' ? skinDef.dark.accentGold : skinDef.light.accentGold);
                                            return (
                                                <button
                                                    key={pid}
                                                    onClick={() => handleSelect(currentSkin, currentMode, pid)}
                                                    className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-lg border transition-all ${isActive ? 'border-vd-accent-gold bg-vd-accent-gold/10 text-vd-text-primary' : 'border-vd-border text-vd-text-secondary hover:border-vd-text-tertiary'}`}
                                                    title={pid === 'default' ? 'Use the skin\'s own accent color' : PALETTES[pid].label}
                                                >
                                                    <span className="w-3 h-3 rounded-full border border-black/20" style={{ background: color }} />
                                                    <span>{PALETTES[pid].label}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* AD-164: skins consolidated under one heading with category subtitles
                                    instead of three repeating headings + descriptions. */}
                                <div>
                                    <h3 className="text-xs font-semibold text-vd-text-primary mb-0.5">Skins</h3>
                                    <p className="text-[10px] text-vd-text-tertiary mb-4">Choose your visual style</p>

                                    <p className="text-[9px] text-vd-text-tertiary uppercase tracking-wider mb-2">Default</p>
                                    <div className="grid grid-cols-3 gap-3 mb-5">
                                        {defaultSkins.map(skin => (
                                            <SkinCard key={skin.id} skin={skin} mode={currentMode} isActive={currentSkin === skin.id} onClick={() => handleSelect(skin.id, currentMode)} />
                                        ))}
                                    </div>

                                    <p className="text-[9px] text-vd-text-tertiary uppercase tracking-wider mb-2">Terminal</p>
                                    <div className="grid grid-cols-3 gap-3 mb-5">
                                        {terminalSkins.map(skin => (
                                            <SkinCard key={skin.id} skin={skin} mode={currentMode} isActive={currentSkin === skin.id} onClick={() => handleSelect(skin.id, currentMode)} />
                                        ))}
                                    </div>

                                    <p className="text-[9px] text-vd-text-tertiary uppercase tracking-wider mb-2">IDE</p>
                                    {/* AD-197: 3-up grid matches the Default + Terminal rows so all
                                        skin cards are the same size and 3 per row. */}
                                    <div className="grid grid-cols-3 gap-3">
                                        {ideSkins.map(skin => (
                                            <SkinCard key={skin.id} skin={skin} mode={currentMode} isActive={currentSkin === skin.id} onClick={() => handleSelect(skin.id, currentMode)} />
                                        ))}
                                    </div>
                                </div>
                            </>
                        )}

                        {tab === 'behavior' && (
                            <>
                                {/* AD-011: editable display name — replaces the previously
                                    hand-edited userDisplayName field in .adhdev/config.json. */}
                                <div className="mb-6">
                                    <h3 className="text-xs font-semibold text-vd-text-primary">Display name</h3>
                                    <p className="text-[10px] text-vd-text-tertiary mt-0.5 mb-2">
                                        How agents address you in comments + how new tickets you create are attributed.
                                    </p>
                                    <input
                                        type="text"
                                        value={displayName}
                                        onChange={(e) => { setDisplayName(e.target.value); setDisplayNameError(null); }}
                                        onBlur={commitDisplayName}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                (e.currentTarget as HTMLInputElement).blur();
                                            }
                                        }}
                                        placeholder="Your name"
                                        className="w-full bg-vd-bg-input border border-vd-border rounded-md px-3 py-1.5 text-[12px] text-vd-text-primary focus:outline-none focus:border-vd-accent-gold"
                                    />
                                    {displayNameError && (
                                        <p className="text-[10px] text-amber-400 mt-1">{displayNameError}</p>
                                    )}
                                </div>

                                {/* AD-137: global Hide tips toggle */}
                                <label className="flex items-center justify-between gap-3 cursor-pointer mb-6">
                                    <div>
                                        <h3 className="text-xs font-semibold text-vd-text-primary">Onboarding tips</h3>
                                        <p className="text-[10px] text-vd-text-tertiary mt-0.5">
                                            Show one-shot coach marks on the Run button, drag, and comments.
                                        </p>
                                    </div>
                                    <input
                                        type="checkbox"
                                        checked={!hideTips}
                                        onChange={(e) => toggleHideTips(!e.target.checked)}
                                        className="w-4 h-4 accent-vd-accent-gold"
                                    />
                                </label>

                                {/* AD-162: completion notifications + sound */}
                                <div>
                                    <h3 className="text-xs font-semibold text-vd-text-primary mb-2">When the terminal finishes a run</h3>

                                    <label className="flex items-center justify-between gap-3 cursor-pointer mb-2">
                                        <div>
                                            <p className="text-[11px] text-vd-text-secondary">Show a system notification</p>
                                            <p className="text-[10px] text-vd-text-tertiary mt-0.5">
                                                Click the notification to bring this tab forward — browsers block tabs from auto-focusing themselves. Requires permission.
                                            </p>
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={notifyOnDone}
                                            onChange={(e) => toggleNotifyOnDone(e.target.checked)}
                                            className="w-4 h-4 accent-vd-accent-gold"
                                        />
                                    </label>

                                    <label className="flex items-center justify-between gap-3 cursor-pointer">
                                        <div>
                                            <p className="text-[11px] text-vd-text-secondary">Play a sound</p>
                                            <p className="text-[10px] text-vd-text-tertiary mt-0.5">
                                                Short two-note ding. Synthesised, no audio file.{' '}
                                                <button
                                                    type="button"
                                                    onClick={(e) => { e.preventDefault(); playDoneSound(); }}
                                                    className="text-vd-accent-gold/80 hover:text-vd-accent-gold underline underline-offset-2"
                                                >
                                                    Test
                                                </button>
                                            </p>
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={soundOnDone}
                                            onChange={(e) => toggleSoundOnDone(e.target.checked)}
                                            className="w-4 h-4 accent-vd-accent-gold"
                                        />
                                    </label>

                                    {notifyError && (
                                        <p className="text-[10px] text-amber-400 mt-2">{notifyError}</p>
                                    )}
                                </div>
                            </>
                        )}

                        {tab === 'reference' && (
                            <>
                                {/* Shortcuts */}
                                <div className="mb-6">
                                    <h3 className="text-xs font-semibold text-vd-text-primary mb-2">Keyboard Shortcuts</h3>
                                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[10px]">
                                        {[['New ticket', 'N'], ['Search', 'Ctrl+F'], ['Batches', 'B'], ['Close modal', 'Esc'], ['Post comment', 'Ctrl+Enter'], ['Paste image', 'Ctrl+V']].map(([label, key]) => (
                                            <div key={label} className="flex justify-between"><span className="text-vd-text-secondary">{label}</span><kbd className="text-vd-text-tertiary bg-vd-bg-tertiary px-1.5 py-0.5 font-mono text-[9px]">{key}</kbd></div>
                                        ))}
                                    </div>
                                </div>

                                {/* Protocol */}
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <h3 className="text-xs font-semibold text-vd-text-primary">Project Protocol</h3>
                                        <p className="text-[10px] text-vd-text-tertiary mt-0.5">Shared operating rules for humans and AI agents.</p>
                                    </div>
                                    <button
                                        onClick={openProtocol}
                                        className="px-3 py-1.5 text-[11px] font-medium border border-vd-accent-gold/30 text-vd-accent-gold rounded-lg hover:bg-vd-accent-gold/10 transition-colors"
                                    >
                                        View ADHDEV.md
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {showProtocol && (
                <div
                    className="fixed inset-0 z-[65] flex items-center justify-center"
                    onClick={(e) => { e.stopPropagation(); setShowProtocol(false); }}
                >
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
                    <div className="relative bg-vd-bg-secondary border border-vd-border w-full max-w-3xl mx-4 max-h-[85vh] overflow-hidden rounded-xl shadow-panel" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-vd-border">
                            <div>
                                <h3 className="text-sm font-semibold text-vd-text-primary">ADHDEV.md</h3>
                                <p className="text-[10px] text-vd-text-tertiary mt-0.5">{protocolPath}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(protocolContent).catch(() => {}); }}
                                    className="px-3 py-1.5 text-[11px] font-medium border border-vd-border rounded-lg text-vd-text-secondary hover:text-vd-text-primary hover:bg-vd-bg-tertiary transition-colors"
                                >
                                    Copy
                                </button>
                                {/* AD-164 reopen: explicit stopPropagation so the click can never bubble to the Settings modal's onClose handler underneath. */}
                                <button
                                    aria-label="Close ADHDEV.md viewer"
                                    onClick={(e) => { e.stopPropagation(); setShowProtocol(false); }}
                                    className="text-vd-text-tertiary hover:text-vd-text-primary text-lg px-2 py-0.5 rounded hover:bg-vd-bg-tertiary"
                                >
                                    &times;
                                </button>
                            </div>
                        </div>
                        <div className="overflow-y-auto max-h-[70vh] px-5 py-4">
                            <pre className="whitespace-pre-wrap text-xs leading-6 text-vd-text-secondary font-mono">{protocolContent}</pre>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
