import { createPoller } from "../src/polling";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const flush = () => jest.advanceTimersByTimeAsync(0);

describe("createPoller", () => {
  test("does nothing until activated", async () => {
    const fn = jest.fn(async () => {});
    createPoller(fn, 1000);
    await jest.advanceTimersByTimeAsync(5000);
    expect(fn).not.toHaveBeenCalled();
  });

  test("runs immediately on activation, then every interval", async () => {
    const fn = jest.fn(async () => {});
    const p = createPoller(fn, 1000);
    p.setActive(true);
    await flush();
    expect(fn).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(3000);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  test("stops when deactivated and resumes with an immediate run", async () => {
    const fn = jest.fn(async () => {});
    const p = createPoller(fn, 1000);
    p.setActive(true);
    await jest.advanceTimersByTimeAsync(2000);
    expect(fn).toHaveBeenCalledTimes(3);
    p.setActive(false);
    await jest.advanceTimersByTimeAsync(10000);
    expect(fn).toHaveBeenCalledTimes(3);
    p.setActive(true);
    await flush();
    expect(fn).toHaveBeenCalledTimes(4);
  });

  test("never overlaps a slow request", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fn = jest.fn(() => new Promise((resolve) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      setTimeout(() => { inFlight -= 1; resolve(); }, 2500); // slower than the interval
    }));
    const p = createPoller(fn, 1000);
    p.setActive(true);
    await jest.advanceTimersByTimeAsync(4000);
    expect(maxInFlight).toBe(1);
    // t=0 starts; ticks at 1s/2s skipped; finishes 2.5s; tick at 3s starts a second run.
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test("run() awaits the in-flight request instead of starting another", async () => {
    let resolveFirst;
    const fn = jest.fn(() => new Promise((r) => { resolveFirst = r; }));
    const p = createPoller(fn, 1000);
    const a = p.run();
    const b = p.run();
    expect(a).toBe(b);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(p.isRunning).toBe(true);
    resolveFirst();
    await a;
    expect(p.isRunning).toBe(false);
    // Once the first run has settled, run() starts a fresh request.
    const c = p.run();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(c).not.toBe(a);
    resolveFirst();
    await c;
    expect(p.isRunning).toBe(false);
  });

  test("swallows errors so one bad poll does not kill the schedule", async () => {
    const fn = jest.fn(async () => { throw new Error("boom"); });
    const p = createPoller(fn, 1000);
    p.setActive(true);
    await jest.advanceTimersByTimeAsync(2000);
    expect(fn).toHaveBeenCalledTimes(3);
    await expect(p.run()).resolves.toBeUndefined();
  });

  test("setActive is idempotent and stop() clears the timer", async () => {
    const fn = jest.fn(async () => {});
    const p = createPoller(fn, 1000);
    p.setActive(true);
    p.setActive(true);
    await flush();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);
    p.stop();
    expect(p.isActive).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });
});
