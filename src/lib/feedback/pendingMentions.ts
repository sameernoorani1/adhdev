import fs from 'fs';
import path from 'path';

const MENTIONS_FILE = path.join(process.cwd(), 'pending-mentions.json');

export interface PendingMention {
    ticketId: string;
    title: string;
    excerpt: string;
    mentionedAt: string;
    targetAgent: string;
}

export function readPendingMentions(): PendingMention[] {
    try {
        if (fs.existsSync(MENTIONS_FILE)) {
            return JSON.parse(fs.readFileSync(MENTIONS_FILE, 'utf-8'));
        }
    } catch {}
    return [];
}

function writeMentions(mentions: PendingMention[]): void {
    fs.writeFileSync(MENTIONS_FILE, JSON.stringify(mentions, null, 2));
}

/** Add a pending @mention when a human tags an AI agent in a comment.
 *  Includes context from the conversation trail — all human comments since the last AI comment (VD-052). */
export function addPendingMention(
    ticketId: string,
    title: string,
    targetAgent: string,
    commentContent: string,
    allComments?: Array<{ author?: string; authorType?: string; content?: string }>
): void {
    const mentions = readPendingMentions();
    // Replace existing entry for this ticket + agent (latest mention wins)
    const filtered = mentions.filter(m => !(m.ticketId === ticketId && m.targetAgent === targetAgent));

    // Build context: all human comments after the last AI comment (VD-052)
    let context = commentContent;
    if (allComments && allComments.length > 1) {
        // Find last AI comment index
        let lastAiIdx = -1;
        for (let i = allComments.length - 1; i >= 0; i--) {
            if (allComments[i].authorType === 'ai') { lastAiIdx = i; break; }
        }
        // Collect all human comments after the last AI comment
        const relevantComments = allComments
            .slice(lastAiIdx + 1)
            .filter(c => c.authorType !== 'ai' && c.content?.trim())
            .map(c => c.content!.trim());
        if (relevantComments.length > 0) {
            context = relevantComments.join('\n---\n');
        }
    }

    filtered.push({
        ticketId,
        title,
        excerpt: context.slice(0, 800), // Expanded from 200 to 800 for thread context
        mentionedAt: new Date().toISOString(),
        targetAgent,
    });
    writeMentions(filtered);
}

/** Clear a pending @mention when AI responds to the ticket */
export function clearPendingMention(ticketId: string, targetAgent?: string): void {
    const mentions = readPendingMentions();
    const filtered = mentions.filter((m) =>
        !(m.ticketId === ticketId && (!targetAgent || m.targetAgent === targetAgent))
    );
    if (filtered.length !== mentions.length) {
        writeMentions(filtered);
    }
}
