'use client';

// AD-016: tiny React error boundary so a single render exception doesn't
// white-screen the whole app. Used at the page root (everything inside
// FeedbackBoard) and per-modal so a crash inside one modal still leaves
// the rest of the board usable.
//
// Deliberately minimal — no telemetry hookup, no fancy retry UX. The user
// gets a readable message, the actual error to copy, and a way to reset
// (clear the error) or do a full page reload.

import React from 'react';

export interface ErrorBoundaryProps {
    children: React.ReactNode;
    /** Short label for the surface that crashed, shown in the fallback UI. */
    label?: string;
    /**
     * If supplied, renders a custom fallback. Receives the captured error and
     * a reset function the consumer can call to try the children again.
     */
    fallback?: (error: Error, reset: () => void) => React.ReactNode;
    /** Called once when an error is caught — log, telemetry, etc. */
    onError?: (error: Error, info: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
    error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState = { error: null };

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        // Best-effort: surface to the dev console so the stack is preserved
        // for triage even when the user has already clicked Reset.
        // eslint-disable-next-line no-console
        console.error('[ErrorBoundary]', this.props.label || 'unlabelled', error, info);
        this.props.onError?.(error, info);
    }

    reset = () => this.setState({ error: null });

    render() {
        const { error } = this.state;
        if (!error) return this.props.children;

        if (this.props.fallback) return this.props.fallback(error, this.reset);

        const label = this.props.label || 'this surface';
        return (
            <div className="p-4 m-2 rounded-lg border border-red-500/30 bg-red-500/5 text-vd-text-primary">
                <div className="flex items-start gap-3">
                    <span aria-hidden className="text-red-400 text-lg leading-none mt-0.5">!</span>
                    <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold">Something broke in {label}.</h3>
                        <p className="text-[11px] text-vd-text-secondary mt-0.5">
                            The rest of the app is still usable. Try resetting; if it keeps failing, reload the page.
                        </p>
                        <pre className="mt-2 px-2 py-1.5 rounded bg-vd-bg-tertiary text-[10px] text-vd-text-tertiary whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
                            {error.message || String(error)}
                        </pre>
                        <div className="mt-3 flex gap-2">
                            <button
                                onClick={this.reset}
                                className="px-3 py-1 text-[11px] rounded-md border border-vd-border text-vd-text-secondary hover:bg-vd-bg-tertiary"
                            >
                                Reset
                            </button>
                            <button
                                onClick={() => { if (typeof window !== 'undefined') window.location.reload(); }}
                                className="px-3 py-1 text-[11px] rounded-md bg-vd-accent-gold text-vd-text-inverse font-medium"
                            >
                                Reload page
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}
