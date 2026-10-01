import type { DeferredPolicy, PluginRef } from './types';

interface TimerEntry {
    handle: unknown;
    generation: number;
}

/** Owns one cancelable timer per plugin and prevents duplicate delayed loads. */
export class DeferredScheduler {
    private timers = new Map<string, TimerEntry>();
    private generations = new Map<string, number>();

    constructor(private app: any) {}

    get size(): number { return this.timers.size; }

    has(id: string): boolean { return this.timers.has(id); }

    schedule(policy: DeferredPolicy, ref: PluginRef, delayMs: number, load: () => Promise<void>): void {
        this.cancel(ref.id);
        if (!policy.enabled || policy.parked) return;
        // A fresh token per timer makes an already-queued callback stale even
        // when a replacement timer is scheduled before that callback runs.
        const generation = (this.generations.get(ref.id) ?? 0) + 1;
        this.generations.set(ref.id, generation);
        const clock = this.clock;
        const delay = Math.max(0, Math.floor(delayMs));
        const handle = clock.setTimeout(async () => {
            const active = this.timers.get(ref.id);
            if (!active || active.generation !== generation || this.generations.get(ref.id) !== generation) return;
            this.timers.delete(ref.id);
            await load();
        }, delay);
        this.timers.set(ref.id, { handle, generation });
    }

    cancel(id: string): void {
        this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
        const entry = this.timers.get(id);
        if (!entry) return;
        this.clock.clearTimeout(entry.handle);
        this.timers.delete(id);
    }

    cancelAll(): void {
        for (const [id, entry] of this.timers) {
            this.generations.set(id, (this.generations.get(id) ?? entry.generation) + 1);
            this.clock.clearTimeout(entry.handle);
        }
        this.timers.clear();
    }

    private get clock(): { setTimeout(callback: () => void, delay: number): unknown; clearTimeout(handle: unknown): void } {
        const injected = this.app?.__aigilityClock;
        const source = injected ?? globalThis;
        if (typeof source.setTimeout !== 'function' || typeof source.clearTimeout !== 'function') {
            throw new Error('A cancelable timer API is required for deferred plugin loading.');
        }
        return {
            setTimeout: (callback, delay) => source.setTimeout(callback, delay),
            clearTimeout: (handle) => source.clearTimeout(handle),
        };
    }
}
