'use client';

import { useState, useRef, useEffect } from 'react';

interface TagInputProps {
    tags: string[];
    allTags: string[];
    onAddTag: (tag: string) => void;
    onRemoveTag: (tag: string) => void;
    placeholder?: string;
    /** Wrap in styled container (true for NewTicketModal style) */
    wrapped?: boolean;
}

export function TagInput({ tags, allTags, onAddTag, onRemoveTag, placeholder, wrapped }: TagInputProps) {
    const [input, setInput] = useState('');
    const [showDropdown, setShowDropdown] = useState(false);
    const [highlightIdx, setHighlightIdx] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Build filtered suggestions
    const trimmed = input.trim().toLowerCase();
    const suggestions: { label: string; value: string; isCreate: boolean }[] = [];

    if (trimmed) {
        // Existing tags that match and aren't already applied
        const matches = allTags
            .filter(t => t.includes(trimmed) && !tags.includes(t))
            .slice(0, 6);

        for (const m of matches) {
            suggestions.push({ label: m, value: m, isCreate: false });
        }

        // "Create <tag>" if not already an exact match
        const exactExists = allTags.includes(trimmed) || tags.includes(trimmed);
        if (!exactExists) {
            suggestions.push({ label: `Create "${trimmed}"`, value: trimmed, isCreate: true });
        }
    }

    // Reset highlight when suggestions change
    useEffect(() => {
        setHighlightIdx(0);
    }, [input]);

    const handleSelect = (value: string) => {
        onAddTag(value);
        setInput('');
        setShowDropdown(false);
        inputRef.current?.focus();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (showDropdown && suggestions.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlightIdx(i => Math.min(i + 1, suggestions.length - 1));
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlightIdx(i => Math.max(i - 1, 0));
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                handleSelect(suggestions[highlightIdx].value);
                return;
            }
        }

        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            e.stopPropagation();
            if (trimmed) {
                onAddTag(trimmed);
                setInput('');
                setShowDropdown(false);
            }
        }

        if (e.key === 'Backspace' && !input && tags.length > 0) {
            onRemoveTag(tags[tags.length - 1]);
        }

        if (e.key === 'Escape') {
            setShowDropdown(false);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setInput(e.target.value);
        setShowDropdown(true);
    };

    const handleBlur = () => {
        // Delay to allow click on dropdown
        setTimeout(() => {
            setShowDropdown(false);
            if (input.trim()) {
                onAddTag(input.trim().toLowerCase());
                setInput('');
            }
        }, 150);
    };

    const tagPills = tags.map((tag) => (
        <span
            key={tag}
            className="group flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-vd-bg-tertiary text-vd-text-secondary"
        >
            {tag}
            <button
                onClick={() => onRemoveTag(tag)}
                className="text-vd-text-tertiary hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity text-[10px]"
            >
                ×
            </button>
        </span>
    ));

    const inputEl = (
        <input
            ref={inputRef}
            value={input}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => { if (trimmed) setShowDropdown(true); }}
            onBlur={handleBlur}
            placeholder={tags.length === 0 ? (placeholder || 'Add tag...') : ''}
            className={wrapped
                ? 'flex-1 min-w-[60px] text-xs bg-transparent border-none outline-none text-vd-text-primary placeholder-vd-text-tertiary'
                : 'text-xs bg-transparent border-none outline-none text-vd-text-primary placeholder-vd-text-tertiary w-20 min-w-[80px]'
            }
        />
    );

    const dropdown = showDropdown && suggestions.length > 0 && (
        <div
            ref={dropdownRef}
            className="absolute left-0 right-0 top-full mt-1 bg-vd-bg-secondary border border-vd-border rounded-lg shadow-panel z-50 max-h-48 overflow-y-auto"
        >
            {suggestions.map((s, i) => (
                <button
                    key={s.value + (s.isCreate ? '-create' : '')}
                    onMouseDown={(e) => { e.preventDefault(); handleSelect(s.value); }}
                    className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                        i === highlightIdx
                            ? 'bg-vd-accent-gold/15 text-vd-accent-gold'
                            : 'text-vd-text-secondary hover:bg-vd-bg-hover'
                    } ${s.isCreate ? 'italic border-t border-vd-border' : ''}`}
                >
                    {s.isCreate ? (
                        <span>Create <span className="font-medium not-italic">{s.value}</span></span>
                    ) : (
                        s.label
                    )}
                </button>
            ))}
        </div>
    );

    if (wrapped) {
        return (
            <div className="relative">
                <div className="flex flex-wrap items-center gap-1.5 bg-vd-bg-input border border-vd-border rounded-lg px-2 py-1.5 min-h-[36px] focus-within:border-vd-accent-gold">
                    {tagPills}
                    {inputEl}
                </div>
                {dropdown}
            </div>
        );
    }

    return (
        <div className="relative flex flex-wrap items-center gap-1.5">
            {tagPills}
            {inputEl}
            {dropdown}
        </div>
    );
}
