import type { FeedbackData, FeedbackTicket } from './core';
import { isLifecycleAiComment } from './executionComments';

type Comment = FeedbackTicket['comments'][number];

const MAX_TEXT = 900;
const MAX_PRIOR_AI = 2;

function snippet(value: unknown, max = MAX_TEXT): string {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= max) return text;
    return `${text.slice(0, max - 1).trimEnd()}...`;
}

function isHumanComment(comment: Comment): boolean {
    return comment.authorType === 'human';
}

function isSubstantiveAiComment(comment: Comment): boolean {
    return comment.authorType === 'ai'
        && snippet(comment.content).length > 0
        && !isLifecycleAiComment(comment);
}

function lastSubstantiveAiIndex(comments: Comment[]): number {
    for (let i = comments.length - 1; i >= 0; i -= 1) {
        if (isSubstantiveAiComment(comments[i])) return i;
    }
    return -1;
}

function formatImages(comment: Comment): string {
    if (!Array.isArray(comment.images) || comment.images.length === 0) return '';
    const images = comment.images
        .map(image => [image.filename, image.url].filter(Boolean).join(' '))
        .filter(Boolean)
        .join('; ');
    return images ? ` Attachments: ${images}` : '';
}

function formatComment(comment: Comment): string {
    const content = snippet(comment.content) || '(attachments only)';
    return `- ${comment.id} | ${comment.createdAt} | ${comment.author}: ${content}${formatImages(comment)}`;
}

export function getUnaddressedHumanComments(ticket: FeedbackTicket): Comment[] {
    const comments = Array.isArray(ticket.comments) ? ticket.comments : [];
    const lastAi = lastSubstantiveAiIndex(comments);
    return comments.slice(lastAi + 1).filter(isHumanComment);
}

function getPriorAiContext(ticket: FeedbackTicket): Comment[] {
    const comments = Array.isArray(ticket.comments) ? ticket.comments : [];
    return comments.filter(isSubstantiveAiComment).slice(-MAX_PRIOR_AI);
}

export function buildTicketRunContextBrief(ticket: FeedbackTicket): string {
    const unaddressed = getUnaddressedHumanComments(ticket);
    const priorAi = getPriorAiContext(ticket);
    const lines: string[] = [
        `Ticket ${ticket.id}: ${ticket.title}`,
        `Status: ${ticket.status}; reopenCount: ${ticket.reopenCount ?? 0}; type: ${ticket.ticketType || 'normal'}.`,
        `Description: ${snippet(ticket.description, 700) || '(empty)'}`,
    ];

    if (unaddressed.length > 0) {
        lines.push(`Unaddressed human comments since the last substantive AI response (${unaddressed.length}):`);
        lines.push(...unaddressed.map(formatComment));
        lines.push(`Required: explicitly address these comment id(s) in your ticket comment and completion summary: ${unaddressed.map(c => c.id).join(', ')}.`);
    } else {
        lines.push('Unaddressed human comments since the last substantive AI response: none detected by the dispatcher. Still read the full live ticket before acting.');
    }

    if (priorAi.length > 0) {
        lines.push('Relevant prior AI comments to consider:');
        lines.push(...priorAi.map(formatComment));
    }

    return lines.join('\n');
}

export function buildRunContextBrief(data: FeedbackData, ticketIds: string[]): string {
    const ids = Array.from(new Set(ticketIds.map(id => id.trim()).filter(Boolean)));
    if (ids.length === 0) return '';

    const ticketsById = new Map((data.tickets || []).map(ticket => [ticket.id, ticket]));
    const briefs = ids
        .map(id => ticketsById.get(id))
        .filter((ticket): ticket is FeedbackTicket => Boolean(ticket))
        .map(buildTicketRunContextBrief);

    if (briefs.length === 0) return '';

    return [
        'SERVER-GENERATED LIVE CONTEXT BRIEF',
        'The dispatcher generated this from the current board before sending the prompt. Use it to avoid missing new comments, but still read the full ticket entry as required.',
        ...briefs,
    ].join('\n\n');
}
