import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';

// AD-230: open an OS-native folder picker and return the chosen absolute path.
// Wizard's Step 1 uses this so non-engineer users don't have to type
// absolute paths blindly. Cross-platform via the OS-appropriate dialog tool:
//   - Windows: PowerShell + System.Windows.Forms.FolderBrowserDialog
//   - macOS:   osascript "choose folder"
//   - Linux:   zenity --file-selection --directory
//
// Args are passed array-form (no `shell: true`) per AD-238 to avoid the
// DEP0190 deprecation warning and the underlying command-injection surface.
//
// Response: { folderPath } on success.
//           { error: 'cancelled' } on user cancel (HTTP 200 — not an error).
//           { error: 'unavailable' } if the OS dialog tool is missing — UI
//                                    should hide the Browse button and fall
//                                    back to typed-path entry.
//           { error: <other> } on unexpected failure.

const PICK_TIMEOUT_MS = 5 * 60 * 1000;

interface PickResult {
    folderPath?: string;
    error?: 'cancelled' | 'unavailable' | 'timeout' | 'no_selection' | 'spawn_failed' | 'unsupported_platform';
}

function pickFolderWindows(): Promise<PickResult> {
    return new Promise((resolve) => {
        const ps = [
            'Add-Type -AssemblyName System.Windows.Forms',
            '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
            "$d.Description = 'Select a folder for ADHDev'",
            "$d.ShowNewFolderButton = $true",
            "if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath } else { exit 1 }",
        ].join('; ');
        let child;
        try {
            child = spawn('powershell.exe', ['-STA', '-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true });
        } catch {
            resolve({ error: 'unavailable' });
            return;
        }
        let out = '';
        const timer = setTimeout(() => { try { child!.kill(); } catch { /* ignore */ } resolve({ error: 'timeout' }); }, PICK_TIMEOUT_MS);
        child.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
        child.on('error', () => { clearTimeout(timer); resolve({ error: 'unavailable' }); });
        child.on('close', (code: number | null) => {
            clearTimeout(timer);
            if (code !== 0) return resolve({ error: 'cancelled' });
            const folderPath = out.trim().replace(/\r?\n/g, '');
            resolve(folderPath ? { folderPath } : { error: 'no_selection' });
        });
    });
}

function pickFolderMacOS(): Promise<PickResult> {
    return new Promise((resolve) => {
        let child;
        try {
            child = spawn('osascript', ['-e', 'POSIX path of (choose folder with prompt "Select a folder for ADHDev")']);
        } catch {
            resolve({ error: 'unavailable' });
            return;
        }
        let out = '';
        const timer = setTimeout(() => { try { child!.kill(); } catch { /* ignore */ } resolve({ error: 'timeout' }); }, PICK_TIMEOUT_MS);
        child.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
        child.on('error', () => { clearTimeout(timer); resolve({ error: 'unavailable' }); });
        child.on('close', (code: number | null) => {
            clearTimeout(timer);
            if (code !== 0) return resolve({ error: 'cancelled' });
            const folderPath = out.trim().replace(/\/$/, '');
            resolve(folderPath ? { folderPath } : { error: 'no_selection' });
        });
    });
}

function pickFolderLinux(): Promise<PickResult> {
    return new Promise((resolve) => {
        let child;
        try {
            child = spawn('zenity', ['--file-selection', '--directory', '--title=Select a folder for ADHDev']);
        } catch {
            resolve({ error: 'unavailable' });
            return;
        }
        let out = '';
        const timer = setTimeout(() => { try { child!.kill(); } catch { /* ignore */ } resolve({ error: 'timeout' }); }, PICK_TIMEOUT_MS);
        child.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
        child.on('error', () => { clearTimeout(timer); resolve({ error: 'unavailable' }); });
        child.on('close', (code: number | null) => {
            clearTimeout(timer);
            if (code !== 0) return resolve({ error: 'cancelled' });
            const folderPath = out.trim();
            resolve(folderPath ? { folderPath } : { error: 'no_selection' });
        });
    });
}

export async function POST() {
    let result: PickResult;
    try {
        if (process.platform === 'win32') result = await pickFolderWindows();
        else if (process.platform === 'darwin') result = await pickFolderMacOS();
        else if (process.platform === 'linux') result = await pickFolderLinux();
        else result = { error: 'unsupported_platform' };
    } catch (err) {
        console.error('[ADHDev] POST /api/onboarding/pick-folder error:', err);
        result = { error: 'spawn_failed' };
    }

    // 'cancelled' is a normal user action, not a server error — return 200
    // so the client treats it as "user backed out" instead of a network fault.
    const isError = result.error && result.error !== 'cancelled';
    return NextResponse.json(result, { status: isError ? 502 : 200 });
}

// GET — capability probe so the UI can hide the Browse button on platforms
// where the dialog tool isn't available. Cheap: just spawn `--help` /
// `--version` and check exit code.
export async function GET() {
    const probe = (cmd: string, args: string[]): Promise<boolean> => new Promise((resolve) => {
        let child;
        try { child = spawn(cmd, args, { windowsHide: true }); }
        catch { resolve(false); return; }
        const timer = setTimeout(() => { try { child!.kill(); } catch { /* ignore */ } resolve(false); }, 2000);
        child.on('error', () => { clearTimeout(timer); resolve(false); });
        child.on('close', () => { clearTimeout(timer); resolve(true); });
    });

    let available = false;
    if (process.platform === 'win32') {
        available = await probe('powershell.exe', ['-NoProfile', '-Command', 'exit 0']);
    } else if (process.platform === 'darwin') {
        available = await probe('osascript', ['-e', 'return 1']);
    } else if (process.platform === 'linux') {
        available = await probe('zenity', ['--version']);
    }
    return NextResponse.json({ available, platform: process.platform });
}
