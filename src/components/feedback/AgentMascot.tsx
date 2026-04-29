'use client';

// 8-bit animated agent mascots — v0.4 (AD-157).
// Lemmings-style worker characters with randomised cute body colours
// (gold/mint/sky/bubblegum/lavender/peach/teal/sunshine) and six work
// animations (hammer, drill, paint, saw, dig, wrench). Each in-progress card
// hashes ticketId + startedAt to pick a stable scheme + animation for the
// run's lifetime, so the mascot reads as the same character across re-renders.
//
// Sprite approach: one 128×32 SVG per mascot holding 4 frames side-by-side.
// CSS `steps(4)` translates the sprite by one frame each ~250 ms. The outer
// container clips to one frame (32×32 logical, scaled via size prop) and
// `image-rendering: pixelated` preserves the 8-bit chunkiness at any scale.

import { useMemo } from 'react';

export type MascotAgent = 'claude' | 'codex' | 'aider';
export type MascotAnimation = 'hammer' | 'drill' | 'paint' | 'saw' | 'dig' | 'wrench';

interface AgentMascotProps {
    agent: MascotAgent;
    seed: string;
    size?: number;
}

const ANIMATIONS: MascotAnimation[] = ['hammer', 'drill', 'paint', 'saw', 'dig', 'wrench'];

interface BodyScheme {
    G: string;   // body fill
    D: string;   // body shadow
    L: string;   // tuft / highlight
}

// AD-157: stable random body colour per mascot. Eyes/feet/tools stay constant
// across schemes so the worker still reads as "the same character family",
// only the body hue shifts. Decorrelated from the animation pick so two
// mascots sharing an animation can still look different.
const BODY_SCHEMES: BodyScheme[] = [
    { G: '#F5B97F', D: '#D09558', L: '#FCE0BE' },   // gold (original)
    { G: '#6EE7B7', D: '#059669', L: '#A7F3D0' },   // mint
    { G: '#93C5FD', D: '#2563EB', L: '#DBEAFE' },   // sky
    { G: '#F9A8D4', D: '#DB2777', L: '#FCE7F3' },   // bubblegum
    { G: '#C4B5FD', D: '#7C3AED', L: '#EDE9FE' },   // lavender
    { G: '#FDBA74', D: '#EA580C', L: '#FED7AA' },   // peach
    { G: '#5EEAD4', D: '#0F766E', L: '#CCFBF1' },   // teal
    { G: '#FCD34D', D: '#D97706', L: '#FEF3C7' },   // sunshine
];

function hashSeed(seed: string): number {
    let h = 5381;
    for (let i = 0; i < seed.length; i++) {
        h = ((h << 5) + h) + seed.charCodeAt(i);
        h |= 0;
    }
    return Math.abs(h);
}

export function AgentMascot({ agent, seed, size = 40 }: AgentMascotProps) {
    const { animation, palette } = useMemo(() => {
        const h = hashSeed(seed);
        const anim = ANIMATIONS[h % ANIMATIONS.length];
        // Decorrelate colour pick from animation pick — divide-then-mod against
        // a different prime-ish length so two mascots running the same
        // animation can still look like different characters.
        const scheme = BODY_SCHEMES[Math.floor(h / ANIMATIONS.length) % BODY_SCHEMES.length];
        return { animation: anim, palette: buildPalette(scheme) };
    }, [seed]);
    return <MascotSprite agent={agent} animation={animation} palette={palette} size={size} />;
}

function MascotSprite({ animation, palette, size }: { agent: MascotAgent; animation: MascotAnimation; palette: Palette; size: number }) {
    return (
        <div
            className="adhdev-mascot"
            style={{ width: size, height: size }}
            aria-hidden
        >
            {/* AD-152: inner wrapper clips the 4-frame sprite strip without
                giving the outer feathered-backdrop a hard rounded-rect edge. */}
            <div className="adhdev-mascot-clip">
                <svg
                    className="adhdev-mascot-sprite"
                    viewBox="0 0 128 32"
                    width={size * 4}
                    height={size}
                    shapeRendering="crispEdges"
                    style={{ animationDuration: '1.0s' }}
                >
                    {[0, 1, 2, 3].map((f) => (
                        <Frame key={f} xOffset={f * 32} animation={animation} frameIdx={f} palette={palette} />
                    ))}
                </svg>
            </div>
        </div>
    );
}

// ────────────────────────────────────────────────────────────────────
// Palette
// ────────────────────────────────────────────────────────────────────
type Palette = Record<string, string>;

// Static colours shared across every mascot — only G / D / L change per scheme.
const STATIC_PALETTE: Palette = {
    B: '#1a1a1a',   // black (eyes, feet, outlines)
    W: '#8B5A2B',   // wood handle
    w: '#B8834D',   // wood light
    M: '#9ca3af',   // metal light
    m: '#4b5563',   // metal dark
    Y: '#FFD53F',   // spark yellow
    o: '#FB923C',   // spark orange
    r: '#EF4444',   // paint red
    b: '#3B82F6',   // paint blue
    g: '#10B981',   // paint green / saw grip
    n: '#78350F',   // wood / dirt chip brown
    c: '#6B4423',   // plank / canvas wood
    s: '#D1D5DB',   // saw blade / canvas face / steel pipe
};

function buildPalette(scheme: BodyScheme): Palette {
    return { ...STATIC_PALETTE, G: scheme.G, D: scheme.D, L: scheme.L };
}

function mapRects(
    map: string[],
    originX: number,
    originY: number,
    xOffset: number,
    key: string,
    palette: Palette,
): React.ReactElement[] {
    const out: React.ReactElement[] = [];
    for (let dy = 0; dy < map.length; dy++) {
        const row = map[dy];
        for (let dx = 0; dx < row.length; dx++) {
            const c = row[dx];
            if (c === '.' || !palette[c]) continue;
            out.push(
                <rect
                    key={`${key}-${dx}-${dy}`}
                    x={xOffset + originX + dx}
                    y={originY + dy}
                    width={1}
                    height={1}
                    fill={palette[c]}
                />,
            );
        }
    }
    return out;
}

// Base character — Lemmings-style. Placed at (2, 8) in a 32×32 frame.
//
// AD-126 polish: character now has its own animation independent of the tool.
// - Eyes blink on frame 3 (closed = all-gold row, opens back on frame 0).
// - Body bobs vertically per frame so the Lemming breathes with the action.
// - Tuft swaps to a lighter shade on the blink frame so the eye-movement
//   reinforces at the top of the character.
const CHAR_DEFAULT: string[] = [
    '..L....',
    '.GGGG..',
    'GBGBG..',   // eyes open
    '.GGGG..',
    'GGGGGG.',
    'GDDDDG.',
    'GDDDDG.',
    'GDDDDG.',
    '.GGGG..',
    '.B..B..',
];

const CHAR_BLINK: string[] = [
    '..L....',
    '.GGGG..',
    'GGGGG..',   // eyes closed — solid body row
    '.GGGG..',
    'GGGGGG.',
    'GDDDDG.',
    'GDDDDG.',
    'GDDDDG.',
    '.GGGG..',
    '.B..B..',
];

// Per-frame body bob offset (y-shift in sprite units). 0 = rest. Subtle, so
// the character looks alive rather than jittery.
const CHAR_BOB: Record<number, number> = {
    0: 0,
    1: -1,   // rise as tool starts moving
    2: 0,    // drop on action / strike
    3: -1,   // slight lift on blink frame
};

function getCharFrame(frameIdx: number): { map: string[]; yOffset: number } {
    const map = frameIdx === 3 ? CHAR_BLINK : CHAR_DEFAULT;
    const yOffset = CHAR_BOB[frameIdx] ?? 0;
    return { map, yOffset };
}

// ────────────────────────────────────────────────────────────────────
// HAMMER — compact anvil so character has breathing room, hammer swings, sparks on strike
// ────────────────────────────────────────────────────────────────────
function hammerOverlay(frameIdx: number, xOffset: number, palette: Palette): React.ReactElement[] {
    const anvil = mapRects([
        '.MMMMMM.',   // 18 — top surface
        '.mmMmm..',   // 19 — waist (narrow)
        '.MMMMMM.',   // 20 — base
    ], 14, 18, xOffset, 'anvil', palette);

    let tool: React.ReactElement[] = [];
    let sparks: React.ReactElement[] = [];

    switch (frameIdx) {
        case 0: // cocked back
            tool = mapRects([
                'mmm.',
                'mMMm',
                'mmm.',
                '.W..',
                '.W..',
                'WW..',
            ], 9, 8, xOffset, 'h-t0', palette);
            break;
        case 1: // apex (overhead, center)
            tool = mapRects([
                '.mmm.',
                '.mMm.',
                '.mmm.',
                '..W..',
                '..W..',
                '..W..',
                '..W..',
            ], 12, 8, xOffset, 'h-t1', palette);
            break;
        case 2: { // strike on anvil
            tool = mapRects([
                '...mmm.',
                '...mMm.',
                '...mmm.',
                'WWWW...',
            ], 11, 13, xOffset, 'h-t2', palette);
            sparks = mapRects([
                '.Y...Y.',
                'YoY.YoY',
                '..oYo..',
                '...Y...',
            ], 15, 14, xOffset, 'h-spark', palette);
            break;
        }
        case 3: // rebound (slight lift)
            tool = mapRects([
                '..mmm..',
                '..mMm..',
                '..mmm..',
                'WWWW...',
            ], 11, 12, xOffset, 'h-t3', palette);
            break;
    }

    const armPos = [
        { x: 8, y: 13 },
        { x: 8, y: 12 },
        { x: 8, y: 14 },
        { x: 8, y: 13 },
    ];
    const arm = mapRects(['GG'], armPos[frameIdx].x, armPos[frameIdx].y, xOffset, `h-arm-${frameIdx}`, palette);

    return [...anvil, ...tool, ...arm, ...sparks];
}

// ────────────────────────────────────────────────────────────────────
// DRILL — pistol-grip power drill, bit spins, chips shower sideways
// ────────────────────────────────────────────────────────────────────
function drillOverlay(frameIdx: number, xOffset: number, palette: Palette): React.ReactElement[] {
    const ground = mapRects([
        'ccccccccccc',
    ], 14, 21, xOffset, 'ground', palette);

    const bob = frameIdx % 2 === 0 ? 0 : 1;

    const drillBody = mapRects([
        '.MMMMM..',
        'MMMMMMM.',
        'MmmmMMM.',
        '..BMMM..',
        '..MMMM..',
        '..MMss..',
        '.....ss.',
    ], 14, 11 + bob, xOffset, `drill-${frameIdx}`, palette);

    const bitMaps: Record<number, string[]> = {
        0: ['..B.', '..B.', '..B.'],
        1: ['.m.m', '..B.', '.m.m'],
        2: ['..B.', '.BmB', '..B.'],
        3: ['m.m.', '..B.', 'm.m.'],
    };
    const bit = mapRects(bitMaps[frameIdx], 18, 18 + bob, xOffset, `bit-${frameIdx}`, palette);

    let chips: React.ReactElement[] = [];
    if (frameIdx === 0) {
        chips = mapRects(['.nn..', 'n.n..'], 14, 19, xOffset, `chip-${frameIdx}`, palette);
    } else if (frameIdx === 1) {
        chips = mapRects(['..nn.', '.nn..'], 22, 19, xOffset, `chip-${frameIdx}`, palette);
    } else if (frameIdx === 2) {
        chips = mapRects(['n.n..', '.n...'], 14, 19, xOffset, `chip-${frameIdx}`, palette);
    } else {
        chips = mapRects(['..n.n', '...n.'], 22, 19, xOffset, `chip-${frameIdx}`, palette);
    }

    const arm = mapRects([
        'GG',
        'GG',
    ], 9, 12, xOffset, `arm-${frameIdx}`, palette);

    return [...ground, ...drillBody, ...bit, ...chips, ...arm];
}

// ────────────────────────────────────────────────────────────────────
// PAINT — easel with canvas, brush sweeps, paint accumulates into stripes
// ────────────────────────────────────────────────────────────────────
function paintOverlay(frameIdx: number, xOffset: number, palette: Palette): React.ReactElement[] {
    const easel = mapRects([
        'ccccccc',
        'csssssc',
        'csssssc',
        'csssssc',
        'csssssc',
        'csssssc',
        'csssssc',
        'csssssc',
        'ccccccc',
    ], 22, 10, xOffset, 'easel', palette);

    const strokes: React.ReactElement[] = [];
    if (frameIdx >= 0) strokes.push(...mapRects(['rrrr'], 23, 12, xOffset, 'stk-r', palette));
    if (frameIdx >= 1) strokes.push(...mapRects(['bbbb'], 24, 14, xOffset, 'stk-b', palette));
    if (frameIdx >= 2) strokes.push(...mapRects(['gggg'], 23, 16, xOffset, 'stk-g', palette));
    if (frameIdx >= 3) strokes.push(...mapRects(['YY.'], 26, 13, xOffset, 'stk-y', palette));

    const brushRows = [12, 14, 16, 13];
    const y = brushRows[frameIdx];

    const brush = mapRects([
        'WwWwMB',
    ], 15, y, xOffset, `brush-${frameIdx}`, palette);

    const arm = mapRects([
        'GGGGGG',
    ], 9, y, xOffset, `arm-${frameIdx}`, palette);

    return [...easel, ...strokes, ...brush, ...arm];
}

// ────────────────────────────────────────────────────────────────────
// SAW — sawhorse + plank, D-handle saw with visible teeth, chips on pull
// ────────────────────────────────────────────────────────────────────
function sawOverlay(frameIdx: number, xOffset: number, palette: Palette): React.ReactElement[] {
    const sawhorse = mapRects([
        'ccccccccccccc',
        'ccccccccccccc',
    ], 13, 16, xOffset, 'sawhorse', palette);

    const sawPositions = [10, 12, 14, 12];
    const sx = sawPositions[frameIdx];

    const handle = mapRects([
        'WWW',
        'WgW',
        'WgW',
        'WWW',
    ], sx, 12, xOffset, `saw-h-${frameIdx}`, palette);

    const teethByFrame: Record<number, string> = {
        0: 'BmBmBmBm',
        1: 'mBmBmBmB',
        2: 'BmBmBmBm',
        3: 'mBmBmBmB',
    };
    const blade = mapRects([
        'ssssssss',
        'ssssssss',
        teethByFrame[frameIdx],
    ], sx + 3, 13, xOffset, `saw-b-${frameIdx}`, palette);

    const chips = (frameIdx === 0 || frameIdx === 3)
        ? mapRects([
            'n.n',
            '.n.',
        ], sx + 6, 17, xOffset, `chip-${frameIdx}`, palette)
        : [];

    const arm = mapRects([
        'GGGG',
    ], 9, 14, xOffset, `arm-${frameIdx}`, palette);

    return [...sawhorse, ...handle, ...blade, ...chips, ...arm];
}

// ────────────────────────────────────────────────────────────────────
// DIG (AD-157) — shovel cycles up→down→scoop→lift, dirt mound grows then resets
// ────────────────────────────────────────────────────────────────────
function digOverlay(frameIdx: number, xOffset: number, palette: Palette): React.ReactElement[] {
    // Dirt strip the character is standing on — slightly lower than other
    // overlays' "ground" so the shovel scoop can dip into it visibly.
    const ground = mapRects([
        'nnnnnnnnnnn',
    ], 14, 20, xOffset, 'dig-ground', palette);

    // Mound to the right grows from frames 0→3, suggesting accumulated digging.
    const moundShapes: Record<number, string[]> = {
        0: ['...n', '..nn'],
        1: ['..n.', '.nnn'],
        2: ['..n.', '.nnn', 'nnnn'],
        3: ['.nn.', 'nnnn', 'nnnn'],
    };
    const mound = mapRects(moundShapes[frameIdx], 22, 20 - (moundShapes[frameIdx].length - 2), xOffset, `dig-mound-${frameIdx}`, palette);

    // Shovel — wood handle (W) + metal scoop (M). Position cycles: cocked up,
    // mid-arc, scoop in dirt, lift dirt back up.
    let shovel: React.ReactElement[] = [];
    let chips: React.ReactElement[] = [];
    switch (frameIdx) {
        case 0: // cocked up-right (preparing strike)
            shovel = mapRects([
                '..W',
                '.W.',
                'W..',
                'MM.',
                'MM.',
            ], 13, 9, xOffset, `dig-s-${frameIdx}`, palette);
            break;
        case 1: // mid-arc going down
            shovel = mapRects([
                'W..',
                'W..',
                'W..',
                'MM.',
                'MM.',
            ], 14, 11, xOffset, `dig-s-${frameIdx}`, palette);
            break;
        case 2: // scoop into ground (dirt flying)
            shovel = mapRects([
                'W...',
                'W...',
                'WMM.',
                'MMMM',
            ], 14, 14, xOffset, `dig-s-${frameIdx}`, palette);
            chips = mapRects([
                'n..n',
                '.nn.',
            ], 17, 18, xOffset, `dig-chip-${frameIdx}`, palette);
            break;
        case 3: // lifting dirt up
            shovel = mapRects([
                'WMM.',
                'WnM.',
                'Wnn.',
                'W...',
            ], 13, 11, xOffset, `dig-s-${frameIdx}`, palette);
            chips = mapRects([
                'n.n.',
                '.n..',
            ], 15, 9, xOffset, `dig-chip-${frameIdx}`, palette);
            break;
    }

    const armPos = [
        { x: 8, y: 12 },
        { x: 8, y: 13 },
        { x: 8, y: 14 },
        { x: 8, y: 13 },
    ];
    const arm = mapRects(['GG'], armPos[frameIdx].x, armPos[frameIdx].y, xOffset, `dig-arm-${frameIdx}`, palette);

    return [...ground, ...mound, ...shovel, ...arm, ...chips];
}

// ────────────────────────────────────────────────────────────────────
// WRENCH (AD-157) — pipe + bolt, wrench rotates a quarter-turn per frame, sparks at the tightest point
// ────────────────────────────────────────────────────────────────────
function wrenchOverlay(frameIdx: number, xOffset: number, palette: Palette): React.ReactElement[] {
    // Vertical steel pipe to the right of the character, with a bolt on top.
    const pipe = mapRects([
        'sss',
        'sss',
        'sss',
        'sss',
        'sss',
        'sss',
    ], 18, 15, xOffset, 'wrench-pipe', palette);

    const bolt = mapRects([
        'mmmm',
        'mBBm',
        'mBBm',
        'mmmm',
    ], 17, 11, xOffset, 'wrench-bolt', palette);

    // Wrench rotates around the bolt: right → up-right → top → up-left.
    let wrench: React.ReactElement[] = [];
    let sparks: React.ReactElement[] = [];

    switch (frameIdx) {
        case 0: // wrench horizontal pointing right (3 o'clock)
            wrench = mapRects([
                'mMM.',
                'M..M',
                'mMM.',
            ], 21, 11, xOffset, `wr-${frameIdx}`, palette);
            break;
        case 1: // diagonal up-right (between 1 and 2 o'clock)
            wrench = mapRects([
                '...mM',
                '..M.M',
                '.M.MM',
                'M..M.',
            ], 18, 8, xOffset, `wr-${frameIdx}`, palette);
            break;
        case 2: // vertical from above (12 o'clock) — tightest point
            wrench = mapRects([
                'mMm',
                'M.M',
                'mMm',
                '.M.',
                '.M.',
                '.M.',
            ], 17, 5, xOffset, `wr-${frameIdx}`, palette);
            sparks = mapRects([
                '.Y.',
                'YoY',
                '.Y.',
            ], 16, 9, xOffset, `wr-sp-${frameIdx}`, palette);
            break;
        case 3: // diagonal up-left (between 10 and 11 o'clock)
            wrench = mapRects([
                'mM...',
                'M.M..',
                'MM.M.',
                '.M..M',
            ], 13, 8, xOffset, `wr-${frameIdx}`, palette);
            break;
    }

    const armPos = [
        { x: 8, y: 13 },
        { x: 8, y: 12 },
        { x: 8, y: 13 },
        { x: 8, y: 12 },
    ];
    const arm = mapRects(['GG'], armPos[frameIdx].x, armPos[frameIdx].y, xOffset, `wr-arm-${frameIdx}`, palette);

    return [...pipe, ...bolt, ...wrench, ...arm, ...sparks];
}

// ────────────────────────────────────────────────────────────────────
// Frame
// ────────────────────────────────────────────────────────────────────
function Frame({ xOffset, animation, frameIdx, palette }: { xOffset: number; animation: MascotAnimation; frameIdx: number; palette: Palette }) {
    const { map: charMap, yOffset } = getCharFrame(frameIdx);
    const base = mapRects(charMap, 2, 8 + yOffset, xOffset, `char-${frameIdx}`, palette);

    let overlay: React.ReactElement[] = [];
    switch (animation) {
        case 'hammer': overlay = hammerOverlay(frameIdx, xOffset, palette); break;
        case 'drill':  overlay = drillOverlay(frameIdx, xOffset, palette);  break;
        case 'paint':  overlay = paintOverlay(frameIdx, xOffset, palette);  break;
        case 'saw':    overlay = sawOverlay(frameIdx, xOffset, palette);    break;
        case 'dig':    overlay = digOverlay(frameIdx, xOffset, palette);    break;
        case 'wrench': overlay = wrenchOverlay(frameIdx, xOffset, palette); break;
    }

    return <g>{base}{overlay}</g>;
}
