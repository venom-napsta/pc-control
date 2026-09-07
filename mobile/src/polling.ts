// Framework-free polling scheduler. The React hook in hooks/usePolling.js is a
// thin wrapper around this so the scheduling rules can be unit-tested with
// fake timers and no renderer.
//
// Rules:
//  - runs immediately when activated, then every intervalMs
//  - never overlaps: if the previous run is still in flight, the tick is skipped
//  - does nothing while inactive (screen not focused, app in background)
//  - run() returns the in-flight promise if there is one, so pull-to-refresh
//    awaits real work instead of starting a duplicate request
export interface Poller {
  run(): Promise<void>;
  readonly isActive: boolean;
  readonly isRunning: boolean;
  setActive(next: boolean): void;
  stop(): void;
}

export function createPoller(fn: () => unknown, intervalMs: number): Poller {
  let timer: ReturnType<typeof setInterval> | null = null;
  let current: Promise<void> | null = null;
  let active = false;

  const run = (): Promise<void> => {
    if (current) return current;
    current = new Promise<void>((resolve) => resolve(fn() as void))
      .catch(() => {})
      .finally(() => { current = null; });
    return current;
  };

  const tick = () => {
    if (active) run();
  };

  return {
    run,
    get isActive() {
      return active;
    },
    get isRunning() {
      return current !== null;
    },
    setActive(next: boolean) {
      next = Boolean(next);
      if (next === active) return;
      active = next;
      if (active) {
        run();
        timer = setInterval(tick, intervalMs);
      } else {
        if (timer !== null) clearInterval(timer);
        timer = null;
      }
    },
    stop() {
      this.setActive(false);
    },
  };
}
