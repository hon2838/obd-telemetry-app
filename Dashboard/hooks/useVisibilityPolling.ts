import { useEffect, useRef } from 'react';
import { isAbortError } from '../api';

/** Polls only while visible, aborts hidden/obsolete work, and never overlaps requests. */
export function useVisibilityPolling(
  task: (signal: AbortSignal) => Promise<void>,
  intervalMs: number | (() => number),
  dependencies: React.DependencyList,
) {
  const taskRef = useRef(task);
  taskRef.current = task;

  useEffect(() => {
    let disposed = false;
    let running = false;
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
      } catch (error) {
        if (!isAbortError(error)) console.error('Dashboard polling error:', error);
      } finally {
        running = false;
        controller = null;
        schedule(typeof intervalMs === 'function' ? intervalMs() : intervalMs);
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
