import { describe, it, expect } from 'vitest';
import { withFeedbackLock } from '@/lib/feedback/core';

// Helpers — a deferred promise we can resolve from outside, plus a `tick()`
// that yields enough microtasks for the lock's promise chain to settle.
function defer<T = void>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

const tick = () => new Promise<void>(r => setTimeout(r, 0));

describe('withFeedbackLock', () => {
    it('returns the value from fn', async () => {
        const value = await withFeedbackLock('proj-1', () => 42);
        expect(value).toBe(42);
    });

    it('awaits async fn and returns the resolved value', async () => {
        const value = await withFeedbackLock('proj-1', async () => {
            await Promise.resolve();
            return 'ok';
        });
        expect(value).toBe('ok');
    });

    it('serializes calls with the same projectId', async () => {
        const order: string[] = [];
        const gateA = defer();
        const gateB = defer();

        const a = withFeedbackLock('proj-1', async () => {
            order.push('a:start');
            await gateA.promise;
            order.push('a:end');
        });
        const b = withFeedbackLock('proj-1', async () => {
            order.push('b:start');
            await gateB.promise;
            order.push('b:end');
        });

        await tick();
        // b must not have started yet — a still holds the lock.
        expect(order).toEqual(['a:start']);

        gateA.resolve();
        await a;
        // a finished; b can now start.
        await tick();
        expect(order).toEqual(['a:start', 'a:end', 'b:start']);

        gateB.resolve();
        await b;
        expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
    });

    it('runs distinct projectIds in parallel', async () => {
        const order: string[] = [];
        const gateA = defer();
        const gateB = defer();

        const a = withFeedbackLock('proj-1', async () => {
            order.push('a:start');
            await gateA.promise;
            order.push('a:end');
        });
        const b = withFeedbackLock('proj-2', async () => {
            order.push('b:start');
            await gateB.promise;
            order.push('b:end');
        });

        await tick();
        // Both started — different projectIds don't share a chain.
        expect(order).toEqual(['a:start', 'b:start']);

        gateB.resolve();
        await b;
        gateA.resolve();
        await a;
        expect(order).toEqual(['a:start', 'b:start', 'b:end', 'a:end']);
    });

    it('rejection in one fn does not block subsequent waiters', async () => {
        const order: string[] = [];
        const boom = new Error('boom');

        const a = withFeedbackLock('proj-1', async () => {
            order.push('a');
            throw boom;
        });
        const b = withFeedbackLock('proj-1', async () => {
            order.push('b');
            return 'ok';
        });

        await expect(a).rejects.toBe(boom);
        await expect(b).resolves.toBe('ok');
        expect(order).toEqual(['a', 'b']);
    });

    it('propagates synchronous throws from fn', async () => {
        const boom = new Error('sync-boom');
        await expect(
            withFeedbackLock('proj-1', () => {
                throw boom;
            }),
        ).rejects.toBe(boom);

        // Chain still usable afterwards.
        const after = await withFeedbackLock('proj-1', () => 'still works');
        expect(after).toBe('still works');
    });

    it('treats null and undefined projectId as the same default key', async () => {
        const order: string[] = [];
        const gate = defer();

        const a = withFeedbackLock(null, async () => {
            order.push('a:start');
            await gate.promise;
            order.push('a:end');
        });
        const b = withFeedbackLock(undefined, () => {
            order.push('b');
        });

        await tick();
        expect(order).toEqual(['a:start']); // b queued behind a

        gate.resolve();
        await a;
        await b;
        expect(order).toEqual(['a:start', 'a:end', 'b']);
    });
});
