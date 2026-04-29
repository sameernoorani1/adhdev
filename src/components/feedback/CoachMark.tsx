'use client';

// AD-137 / AD-143: Lightweight coach mark — positioned near a target element,
// carries a title + body and two actions ("Got it" / "Don't show tips"). Uses
// a portal so it escapes any overflow-hidden ancestor. Not a modal — board
// stays live. AD-143: viewport clamping, flare, and copy overhaul.

import { useEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

export interface CoachMarkProps {
    show: boolean;
    targetRef: RefObject<HTMLElement | null>;
    message: string;
    title?: string;
    placement?: 'top' | 'bottom' | 'left' | 'right';
    onSeen: () => void;
    onHideAll: () => void;
}

interface Position {
    top: number;
    left: number;
    arrowOffset: number;
    maxWidth: number;
    effectivePlacement: NonNullable<CoachMarkProps['placement']>;
}

const VIEWPORT_MARGIN = 12;
const BUBBLE_MAX_WIDTH = 300;

function computePosition(rect: DOMRect, placement: NonNullable<CoachMarkProps['placement']>, bubbleWidth: number, bubbleHeight: number): Position {
    const gap = 12;
    const vw = typeof window === 'undefined' ? 1200 : window.innerWidth;
    const vh = typeof window === 'undefined' ? 900 : window.innerHeight;

    // AD-143: viewport clamping. Compute the raw anchor center, then shift the
    // bubble so both edges stay inside [VIEWPORT_MARGIN, vw - VIEWPORT_MARGIN].
    // Flip placement if there isn't room on the preferred side.
    let effective = placement;
    if (placement === 'right' && rect.right + gap + bubbleWidth > vw - VIEWPORT_MARGIN) {
        effective = rect.left - gap - bubbleWidth < VIEWPORT_MARGIN ? 'bottom' : 'left';
    } else if (placement === 'left' && rect.left - gap - bubbleWidth < VIEWPORT_MARGIN) {
        effective = rect.right + gap + bubbleWidth > vw - VIEWPORT_MARGIN ? 'bottom' : 'right';
    } else if (placement === 'top' && rect.top - gap - bubbleHeight < VIEWPORT_MARGIN) {
        effective = 'bottom';
    } else if (placement === 'bottom' && rect.bottom + gap + bubbleHeight > vh - VIEWPORT_MARGIN) {
        effective = rect.top - gap - bubbleHeight < VIEWPORT_MARGIN ? 'bottom' : 'top';
    }

    let top = 0;
    let left = 0;
    const anchorCenterX = rect.left + rect.width / 2;
    const anchorCenterY = rect.top + rect.height / 2;

    switch (effective) {
        case 'top':
            top = rect.top - gap - bubbleHeight;
            left = anchorCenterX - bubbleWidth / 2;
            break;
        case 'bottom':
            top = rect.bottom + gap;
            left = anchorCenterX - bubbleWidth / 2;
            break;
        case 'left':
            top = anchorCenterY - bubbleHeight / 2;
            left = rect.left - gap - bubbleWidth;
            break;
        case 'right':
        default:
            top = anchorCenterY - bubbleHeight / 2;
            left = rect.right + gap;
            break;
    }

    // Clamp into viewport.
    const clampedLeft = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - VIEWPORT_MARGIN - bubbleWidth));
    const clampedTop = Math.max(VIEWPORT_MARGIN, Math.min(top, vh - VIEWPORT_MARGIN - bubbleHeight));

    // Arrow offset keeps the tail pointing at the anchor even after clamp.
    const arrowOffset = (effective === 'top' || effective === 'bottom')
        ? Math.max(16, Math.min(bubbleWidth - 16, anchorCenterX - clampedLeft))
        : Math.max(16, Math.min(bubbleHeight - 16, anchorCenterY - clampedTop));

    return { top: clampedTop, left: clampedLeft, arrowOffset, maxWidth: bubbleWidth, effectivePlacement: effective };
}

export function CoachMark({ show, targetRef, message, title, placement = 'bottom', onSeen, onHideAll }: CoachMarkProps) {
    const [pos, setPos] = useState<Position | null>(null);
    const [bubbleEl, setBubbleEl] = useState<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!show) { setPos(null); return; }
        const update = () => {
            const el = targetRef.current;
            if (!el) { setPos(null); return; }
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) { setPos(null); return; }
            // Measure the bubble if already rendered; otherwise use a sensible default.
            const width = bubbleEl?.offsetWidth || BUBBLE_MAX_WIDTH;
            const height = bubbleEl?.offsetHeight || 120;
            setPos(computePosition(rect, placement, width, height));
        };
        update();
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        const raf = requestAnimationFrame(update);
        return () => {
            window.removeEventListener('resize', update);
            window.removeEventListener('scroll', update, true);
            cancelAnimationFrame(raf);
        };
    }, [show, targetRef, placement, bubbleEl]);

    if (!show || !pos || typeof document === 'undefined') return null;

    const arrowStyle: React.CSSProperties = (() => {
        switch (pos.effectivePlacement) {
            case 'top':
                return { left: pos.arrowOffset, bottom: -6, transform: 'translateX(-50%) rotate(45deg)' };
            case 'bottom':
                return { left: pos.arrowOffset, top: -6, transform: 'translateX(-50%) rotate(45deg)' };
            case 'left':
                return { top: pos.arrowOffset, right: -6, transform: 'translateY(-50%) rotate(45deg)' };
            case 'right':
            default:
                return { top: pos.arrowOffset, left: -6, transform: 'translateY(-50%) rotate(45deg)' };
        }
    })();

    return createPortal(
        <div
            ref={setBubbleEl}
            className="fixed z-[70] pointer-events-auto adhdev-coach-enter"
            style={{ top: pos.top, left: pos.left, maxWidth: pos.maxWidth, width: BUBBLE_MAX_WIDTH }}
            role="status"
        >
            <div className="relative bg-gradient-to-br from-vd-accent-gold to-vd-accent-gold-light text-vd-text-inverse rounded-xl shadow-gold-md px-4 py-3">
                {/* tail arrow */}
                <span
                    aria-hidden
                    className="absolute w-3 h-3 bg-vd-accent-gold shadow-[0_0_0_1px_rgba(0,0,0,0.08)]"
                    style={arrowStyle}
                />

                <div className="flex items-start gap-2.5">
                    <span className="flex-shrink-0 mt-0.5 w-5 h-5 rounded-full bg-black/15 flex items-center justify-center text-[11px]" aria-hidden>✨</span>
                    <div className="flex-1 min-w-0">
                        {title && (
                            <p className="text-[11px] font-bold uppercase tracking-wider mb-0.5 leading-none">{title}</p>
                        )}
                        <p className="text-[12.5px] font-medium leading-snug">{message}</p>
                        <div className="flex items-center gap-3 text-[10.5px] mt-2">
                            <button onClick={onSeen} className="font-semibold px-2 py-0.5 rounded bg-black/15 hover:bg-black/25 transition-colors">
                                Got it
                            </button>
                            <button onClick={onHideAll} className="opacity-80 hover:opacity-100 hover:underline">
                                Don&apos;t show tips
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}
