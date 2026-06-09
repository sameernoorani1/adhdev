// AD-064 / AD-228 follow-up: server-only helper for computing the dynamic
// "board.json is too big to read in one shot" hint that gets appended to
// agent run prompts. Lives in its own file so `runPrompt.ts` stays
// import-pure and can be bundled into the client (FeedbackBoard,
// TicketDetailModal) without webpack tripping on `node:fs` / `node:path`.

import fs from 'node:fs';
import path from 'node:path';

const LARGE_BOARD_BYTES = 80 * 1024;

export function boardSizeWarning(projectRoot: string = process.cwd()): string {
    try {
        const boardPath = path.join(projectRoot, '.adhdev', 'board.json');
        const stat = fs.statSync(boardPath);
        if (stat.size < LARGE_BOARD_BYTES) return '';
        const kb = Math.round(stat.size / 1024);
        return `\nNote: .adhdev/board.json is ${kb}KB and will exceed a single read's token cap. Do NOT read it in full — use targeted ticket-id search, offset/limit reads, or the API at http://localhost:3111/api/feedback/{id} instead.`;
    } catch {
        return '';
    }
}
