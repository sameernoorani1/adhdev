import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureAdhdevProtocol } from './protocol';

// ─── Registry (lives in ~/.adhdev/) ─────────────────────────────────

export interface RegisteredProject {
    id: string;
    name: string;
    path: string;
    addedAt: string;
    prefix: string;  // ticket prefix, e.g. "AD"
}

interface Registry {
    projects: RegisteredProject[];
    activeProjectId: string | null;
}

const ADHDEV_HOME = path.join(os.homedir(), '.adhdev');
const REGISTRY_PATH = path.join(ADHDEV_HOME, 'registry.json');

function ensureHome() {
    if (!fs.existsSync(ADHDEV_HOME)) fs.mkdirSync(ADHDEV_HOME, { recursive: true });
}

export function readRegistry(): Registry {
    ensureHome();
    if (!fs.existsSync(REGISTRY_PATH)) {
        const empty: Registry = { projects: [], activeProjectId: null };
        fs.writeFileSync(REGISTRY_PATH, JSON.stringify(empty, null, 2) + '\n');
        return empty;
    }
    return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
}

export function writeRegistry(registry: Registry) {
    ensureHome();
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
}

export function registerProject(projectPath: string, name?: string, prefix?: string): RegisteredProject {
    const absPath = path.resolve(projectPath);
    const registry = readRegistry();

    // Check if already registered
    const existing = registry.projects.find(p => p.path === absPath);
    if (existing) {
        // Set as active
        registry.activeProjectId = existing.id;
        writeRegistry(registry);
        return existing;
    }

    const id = `proj-${Date.now().toString(36)}`;
    const project: RegisteredProject = {
        id,
        name: name || path.basename(absPath),
        path: absPath,
        addedAt: new Date().toISOString(),
        prefix: prefix || 'AD',
    };

    registry.projects.push(project);
    registry.activeProjectId = id;
    writeRegistry(registry);

    // Create .adhdev/ in the project if it doesn't exist
    initProjectDir(absPath, project.prefix);

    return project;
}

export function initProjectDir(projectPath: string, prefix: string = 'AD') {
    const adhdevDir = path.join(projectPath, '.adhdev');
    if (!fs.existsSync(adhdevDir)) fs.mkdirSync(adhdevDir, { recursive: true });

    const boardPath = path.join(adhdevDir, 'board.json');
    if (!fs.existsSync(boardPath)) {
        const defaultBoard = {
            nextId: 1,
            columns: {
                backlog: { label: 'Backlog', aiInstruction: 'Review, comment with analysis, suggest priority.' },
                todo: { label: 'To Do', aiInstruction: 'Fix the issue (or post plan for discussions).' },
                reopen: { label: 'Reopen', aiInstruction: 'PRIORITY FIX. Previous attempt failed. Read all comments.' },
                done: { label: 'For Review', aiInstruction: 'Do nothing. Awaiting human review.' },
                reviewed: { label: 'Closed', aiInstruction: 'Do nothing. Never touch.' },
                observe: { label: 'Observe', aiInstruction: 'Do nothing. Monitoring.' },
                deferred: { label: 'Deferred', aiInstruction: 'Do nothing. Postponed.' },
            },
            tickets: [],
            missions: [],
            batches: [],
            sessionActivity: [],
        };
        fs.writeFileSync(boardPath, JSON.stringify(defaultBoard, null, 2) + '\n');
    }

    const configPath = path.join(adhdevDir, 'config.json');
    if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, JSON.stringify({ prefix, agents: ['Claude Code'] }, null, 2) + '\n');
    }

    ensureAdhdevProtocol(projectPath, prefix, { writeClaudeMdRef: true });

    // Ensure uploads dir
    const uploadsDir = path.join(adhdevDir, 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
}

export function getActiveProject(): RegisteredProject | null {
    const registry = readRegistry();
    if (!registry.activeProjectId) return registry.projects[0] || null;
    return registry.projects.find(p => p.id === registry.activeProjectId) || registry.projects[0] || null;
}

export function getProjectById(projectId?: string | null): RegisteredProject | null {
    if (!projectId) return getActiveProject();
    const registry = readRegistry();
    return registry.projects.find(p => p.id === projectId) || null;
}

export function setActiveProject(projectId: string): RegisteredProject | null {
    const registry = readRegistry();
    const project = registry.projects.find(p => p.id === projectId);
    if (!project) return null;
    registry.activeProjectId = projectId;
    writeRegistry(registry);
    return project;
}

export function removeProject(projectId: string): boolean {
    const registry = readRegistry();
    const idx = registry.projects.findIndex(p => p.id === projectId);
    if (idx === -1) return false;
    registry.projects.splice(idx, 1);
    if (registry.activeProjectId === projectId) {
        registry.activeProjectId = registry.projects[0]?.id || null;
    }
    writeRegistry(registry);
    return true;
}

export function getProjectBoardPath(project: RegisteredProject): string {
    return path.join(project.path, '.adhdev', 'board.json');
}

export function getProjectUploadsDir(project: RegisteredProject): string {
    return path.join(project.path, '.adhdev', 'uploads');
}
