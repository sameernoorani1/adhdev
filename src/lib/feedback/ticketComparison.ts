export interface ParsedExpectationSections {
    rawNotes: string;
    inferredIntent: string;
    mode: string;
    behaviorBullets: string[];
    flowBullets: string[];
    goodOutcome: string;
}

export interface ChatTranscriptSummary {
    title: string;
    firstUserPrompt: string;
    firstThinking: string;
    firstVisibleResponse: string;
    mode: string;
    stage: string;
    pendingInput: string;
    thinkingCount: number;
    hasVisibleThinking: boolean;
    hasClarificationHold: boolean;
    hasResearch: boolean;
    hasPrematureSlides: boolean;
    hasImmediateGenericStrategyDump: boolean;
    offersTakeTheWheel: boolean;
    laterDriftExcerpt: string;
}

export interface ComparisonRow {
    label: string;
    status: 'pass' | 'warn' | 'fail';
    detail: string;
}

function extractSection(markdown: string, heading: string): string {
    const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`##\\s+${escapedHeading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, 'i');
    const match = markdown.match(regex);
    return match?.[1]?.trim() ?? '';
}

function cleanSectionText(text: string): string {
    return text
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function extractBullets(section: string): string[] {
    const bullets: string[] = [];
    let current = '';

    for (const rawLine of section.split('\n')) {
        const line = rawLine.trimEnd();
        const bulletMatch = line.match(/^\s*-\s+(.*)$/);
        if (bulletMatch) {
            if (current) bullets.push(current.trim());
            current = bulletMatch[1].trim();
            continue;
        }

        if (!line.trim()) {
            if (current) {
                bullets.push(current.trim());
                current = '';
            }
            continue;
        }

        if (current && /^\s{2,}[-*]?\s*/.test(rawLine)) {
            current += ` ${line.trim().replace(/^[-*]\s+/, '')}`;
        }
    }

    if (current) bullets.push(current.trim());
    return bullets;
}

function stripDetailsBlocks(markdown: string): string {
    return markdown.replace(/<details>[\s\S]*?<\/details>/g, '').trim();
}

function firstNonEmptyParagraph(text: string): string {
    const paragraph = text
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .find(line => !line.startsWith('>') && !line.startsWith('**') && !line.startsWith('- '));
    return paragraph ?? '';
}

export function parseExpectationSections(description: string): ParsedExpectationSections | null {
    if (!description?.trim()) return null;
    const normalized = description.replace(/\r\n/g, '\n');
    const parts = normalized.split(/ChatGPT's merged response:/i);
    const rawNotes = cleanSectionText(parts[0].replace(/My Raw Notes:/i, '').replace(/-+\s*$/, ''));
    const merged = parts[1] ? cleanSectionText(parts[1]) : cleanSectionText(normalized);

    // AD-012: prefer the current heading; legacy alias retained so older
    // tickets authored before the rename still parse correctly.
    const inferredIntent = cleanSectionText(
        extractSection(merged, 'What ADHDev should infer')
        || extractSection(merged, 'What the board should infer'),
    );
    const mode = cleanSectionText(extractSection(merged, 'Mode'));
    const behaviorBullets = extractBullets(extractSection(merged, 'Behavior'));
    const flowBullets = extractBullets(extractSection(merged, 'Flow'));
    const goodOutcome = cleanSectionText(extractSection(merged, 'Good outcome'));

    if (!inferredIntent && !mode && behaviorBullets.length === 0 && flowBullets.length === 0 && !goodOutcome) {
        return null;
    }

    return {
        rawNotes,
        inferredIntent,
        mode,
        behaviorBullets,
        flowBullets,
        goodOutcome,
    };
}

export function summarizeChatTranscript(markdown: string): ChatTranscriptSummary | null {
    if (!markdown?.trim()) return null;
    const normalized = markdown.replace(/\r\n/g, '\n');
    const titleMatch = normalized.match(/^#\s+Chat:\s+(.+)$/m);
    const assistantMatch = normalized.match(/## Assistant[^\n]*\n([\s\S]*?)(?=\n---\n## |\n---\s*$|$)/);
    const userMatch = normalized.match(/## User[^\n]*\n([\s\S]*?)(?=\n<details>|\n---\n## |\n---\s*$|$)/);
    const thinkingBlocks = Array.from(normalized.matchAll(/<details><summary>Thinking<\/summary>\s*([\s\S]*?)<\/details>/g))
        .map(match => cleanSectionText(match[1]));

    const assistantSection = assistantMatch?.[1] ?? '';
    const firstThinking = thinkingBlocks[0] ?? '';
    const visibleSection = stripDetailsBlocks(assistantSection)
        .replace(/\*\*Kitz Board State:\*\*[\s\S]*?(?=\nI |\n\*\*Rendered Content Blocks:|\n<details><summary>Raw Content Blocks JSON|$)/, '')
        .replace(/\*\*Rendered Content Blocks:\*\*[\s\S]*$/, '')
        .replace(/^>.*$/gm, '')
        .trim();

    const firstVisibleResponse = firstNonEmptyParagraph(visibleSection);
    const driftMatch = normalized.match(/(To create a robust five-year strategy[\s\S]{0,700})/i)
        || normalized.match(/(### Strategic Focus Areas[\s\S]{0,700})/i);

    return {
        title: titleMatch?.[1]?.trim() ?? '',
        firstUserPrompt: cleanSectionText(userMatch?.[1] ?? ''),
        firstThinking,
        firstVisibleResponse,
        mode: normalized.match(/- Mode:\s+(.+)$/m)?.[1]?.trim() ?? '',
        stage: normalized.match(/- Stage:\s+(.+)$/m)?.[1]?.trim() ?? '',
        pendingInput: normalized.match(/- Pending input:\s+(.+)$/m)?.[1]?.trim() ?? '',
        thinkingCount: thinkingBlocks.length,
        hasVisibleThinking: thinkingBlocks.length > 0,
        hasClarificationHold: /Pending input:|Confirm the setup|What kind of .* case is this\?/i.test(normalized),
        hasResearch: /search_web/i.test(normalized),
        hasPrematureSlides: /\b(slides?|deck generation|generate slides)\b/i.test(normalized),
        hasImmediateGenericStrategyDump: /To create a robust five-year strategy|### Strategic Focus Areas|By following a structured approach/i.test(normalized),
        offersTakeTheWheel: /\btake the wheel\b|\bautopilot\b/i.test(normalized),
        laterDriftExcerpt: driftMatch ? cleanSectionText(driftMatch[1]).slice(0, 700) : '',
    };
}

export function buildComparisonRows(
    expected: ParsedExpectationSections | null,
    actual: ChatTranscriptSummary | null
): ComparisonRow[] {
    if (!expected || !actual) return [];

    const rows: ComparisonRow[] = [];

    rows.push({
        label: 'Visible planning and framing on the first response',
        status: actual.hasVisibleThinking && !!actual.firstThinking ? 'pass' : 'fail',
        detail: actual.hasVisibleThinking && actual.firstThinking
            ? `Thinking is visible before execution: "${actual.firstThinking.slice(0, 180)}${actual.firstThinking.length > 180 ? '…' : ''}"`
            : 'No visible first-turn thinking/framing was found in the transcript.',
    });

    rows.push({
        label: 'Pauses to clarify before committing to a full strategy answer',
        status: actual.hasClarificationHold ? 'pass' : 'fail',
        detail: actual.hasClarificationHold
            ? `Clarification hold detected${actual.pendingInput ? ` via pending input: "${actual.pendingInput}"` : '.'}`
            : 'The transcript does not clearly pause for human-in-the-loop clarification before continuing.',
    });

    rows.push({
        label: 'Avoids an immediate generic strategy dump',
        status: actual.hasImmediateGenericStrategyDump ? 'fail' : 'pass',
        detail: actual.hasImmediateGenericStrategyDump
            ? 'A later response in the transcript drifts into a generic pre-baked strategy structure instead of staying in the expected diagnose-and-decide workflow.'
            : 'No obvious generic one-shot strategy dump was detected in the transcript.',
    });

    rows.push({
        label: 'Shows a consulting workflow before storyliner/deck work',
        status: !actual.hasPrematureSlides && (actual.mode === 'consulting_full' || actual.stage === 'clarify_align') ? 'pass' : 'warn',
        detail: !actual.hasPrematureSlides
            ? `Transcript stays in ${actual.mode || 'consulting'} / ${actual.stage || 'planning'} mode rather than jumping to slides.`
            : 'Deck/slide language appears too early relative to the expected pre-storyliner workflow.',
    });

    rows.push({
        label: 'Makes the ongoing analysis path visible',
        status: actual.hasResearch || actual.thinkingCount > 1 ? 'warn' : 'fail',
        detail: actual.hasResearch
            ? 'The transcript includes visible reasoning plus research activity, but you should still judge whether that visibility is rich enough.'
            : 'The transcript shows little evidence of visible ongoing analysis beyond the opening turn.',
    });

    rows.push({
        label: 'Offers an explicit take-the-wheel / expedited path',
        status: actual.offersTakeTheWheel ? 'pass' : 'warn',
        detail: actual.offersTakeTheWheel
            ? 'Take-the-wheel language is visible in the transcript.'
            : 'No explicit take-the-wheel/autopilot offer was detected in the exported conversation.',
    });

    return rows;
}
