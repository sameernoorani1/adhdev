import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

// AD-230: validate a folder path before letting the wizard advance from Step 1.
// Checks: existence, is-a-directory, writability, whether it already has a
// `.adhdev/` workspace. The UI uses these to render inline status (✓ / ✗) and
// to disable Next when the path doesn't validate.
//
// `hasAdhdev: true` is informational, not a failure — the wizard already
// supports re-opening an existing ADHDev project. The UI surfaces it as a hint
// so the user knows they're switching projects rather than starting fresh.

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const folderPath = String(body.folderPath || '').trim();

        if (!folderPath) {
            return NextResponse.json({ valid: false, error: 'empty' });
        }
        if (!path.isAbsolute(folderPath)) {
            return NextResponse.json({ valid: false, error: 'not_absolute' });
        }

        let exists = false;
        let isDirectory = false;
        let writable = false;
        let hasAdhdev = false;

        try {
            const st = fs.statSync(folderPath);
            exists = true;
            isDirectory = st.isDirectory();
        } catch { /* not found — leave defaults */ }

        if (exists && isDirectory) {
            try {
                fs.accessSync(folderPath, fs.constants.W_OK);
                writable = true;
            } catch { /* not writable */ }
            try {
                hasAdhdev = fs.existsSync(path.join(folderPath, '.adhdev'));
            } catch { /* ignore */ }
        }

        const valid = exists && isDirectory && writable;
        const error =
            !exists ? 'not_found' :
            !isDirectory ? 'not_a_directory' :
            !writable ? 'not_writable' :
            null;

        return NextResponse.json({ valid, exists, isDirectory, writable, hasAdhdev, error });
    } catch (err) {
        console.error('[ADHDev] POST /api/onboarding/validate-path error:', err);
        return NextResponse.json({ valid: false, error: 'server_error' }, { status: 500 });
    }
}
