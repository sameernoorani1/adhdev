import { NextResponse } from 'next/server';
import path from 'path';
import { getActiveProject } from '@/lib/feedback/registry';
import { readAdhdevProtocol, buildAdhdevProtocol, readUserDisplayName } from '@/lib/feedback/protocol';

export async function GET() {
    try {
        const project = getActiveProject();
        const projectRoot = project?.path || process.cwd();
        // AD-146: honour userDisplayName from project config when falling back.
        const userName = readUserDisplayName(projectRoot);
        const protocol = readAdhdevProtocol(projectRoot) || buildAdhdevProtocol(project?.prefix || 'AD', userName);
        return NextResponse.json({
            filename: 'ADHDEV.md',
            projectPath: path.join(projectRoot, 'ADHDEV.md'),
            content: protocol,
        });
    } catch {
        return NextResponse.json({
            filename: 'ADHDEV.md',
            projectPath: 'ADHDEV.md',
            content: buildAdhdevProtocol('AD'),
        });
    }
}
