import { useEffect, useRef } from 'react';
import { isAbortError } from '../api';

const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 60000;
const MAX_EXPONENT = 5;

/**
 * Calculates a backoff delay based on consecutive errors.
 * On success (consecutiveFailures === 0), returns baseInterval unchanged.
 * On failure, applies bounded exponential backoff with up to 25% jitter.
 */
export function calculateBackoffDelay(
  baseInterval: number,
  consecutiveFailures: number,
  randomFn: () => number = Math.random,
): number {
  if (consecutiveFailures <= 0) {
    return baseInterval;
  }
  const exponent = Math.min(consecutiveFailures - 1, MAX_EXPONENT);
  const exponentialInterval = baseInterval * Math.pow(2, exponent);
  const capped = Math.min(MAX_BACKOFF_MS, Math.max(MIN_BACKOFF_MS, exponentialInterval));
  const jitter = capped * 0.25 * randomFn();
  return Math.min(MAX_BACKOFF_MS, Math.round(capped + jitter));
}
/** Polls only while visible, aborts hidden/obsolete work, and never overlaps requests. */
export function useVisibilityPolling(
  task: (signal: AbortSignal) => Promise<void>,
  intervalMs: number | (() => number),
  dependencies: React.DependencyList,
) {
  const taskRef = useRef(task);
  taskRef.current = task;
  const intervalRef = useRef(intervalMs);
  intervalRef.current = intervalMs;

  useEffect(() => {
    let disposed = false;
    let running = false;
    let consecutiveFailures = 0;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = (delay: number) => {
      if (!disposed) timer = setTimeout(run, delay);
    };

    const run = async () => {
      if (disposed || document.visibilityState !== 'visible' || running) return;
      running = true;
      controller = new AbortController();
      try {
        await taskRef.current(controller.signal);
        consecutiveFailures = 0;
      } catch (error) {
        if (!isAbortError(error)) {
          consecutiveFailures++;
          console.error('Dashboard polling error:', error);
        }
      } finally {
        running = false;
        controller = null;
        if (!disposed && document.visibilityState === 'visible') {
          const currentBase = typeof intervalRef.current === 'function' ? intervalRef.current() : intervalRef.current;
          const delay = calculateBackoffDelay(currentBase, consecutiveFailures);
          schedule(delay);
        }
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        controller?.abort();
        if (timer) clearTimeout(timer);
        timer = null;
      } else {
        if (timer) clearTimeout(timer);
        timer = null;
        run();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    if (document.visibilityState === 'visible') run();
    return () => {
      disposed = true;
      controller?.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
    // The caller controls restart semantics through dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
}
