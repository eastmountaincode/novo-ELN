export type MutationResult = {
  ok: boolean;
  changed?: boolean;
  error?: string;
};

type MutationContext = {
  hasNewerPending: boolean;
};

type LatestMutationQueueOptions<T> = {
  mergePending: (current: T | null, next: T) => T;
  persist: (value: T) => Promise<MutationResult>;
  preserveLatestOnFailure?: boolean;
  onStart?: (value: T) => void;
  onSuccess?: (value: T, result: MutationResult, context: MutationContext) => void;
  onFailure?: (value: T, result: MutationResult, context: MutationContext) => void;
};

export type LatestMutationQueue<T> = {
  enqueue: (value: T) => Promise<boolean>;
  flush: () => Promise<boolean>;
  hasPending: () => boolean;
};

export function createLatestMutationQueue<T>({
  mergePending,
  persist,
  preserveLatestOnFailure = true,
  onStart,
  onSuccess,
  onFailure,
}: LatestMutationQueueOptions<T>): LatestMutationQueue<T> {
  let pending: T | null = null;
  let running: Promise<boolean> | null = null;
  let retryPaused = false;

  async function drain() {
    while (pending !== null) {
      const value = pending;
      pending = null;
      onStart?.(value);

      let result: MutationResult;
      try {
        result = await persist(value);
      } catch (error) {
        result = {
          ok: false,
          error: error instanceof Error ? error.message : "Request failed",
        };
      }

      const newerPending = pending;
      const context = { hasNewerPending: newerPending !== null };
      if (result.ok) {
        onSuccess?.(value, result, context);
        continue;
      }

      onFailure?.(value, result, context);
      if (newerPending !== null) {
        pending = mergePending(value, newerPending);
        continue;
      }
      if (preserveLatestOnFailure) pending = value;
      retryPaused = true;
      return false;
    }
    return true;
  }

  function start(): Promise<boolean> {
    const cycle = drain();
    const tracked: Promise<boolean> = cycle.then(async (cycleSucceeded) => {
      if (running === tracked) running = null;
      if (pending === null || retryPaused) return cycleSucceeded;
      return start();
    });
    running = tracked;
    return tracked;
  }

  function enqueue(value: T) {
    pending = mergePending(pending, value);
    retryPaused = false;
    return running ?? start();
  }

  function flush() {
    retryPaused = false;
    if (running) return running;
    if (pending === null) return Promise.resolve(true);
    return start();
  }

  return {
    enqueue,
    flush,
    hasPending: () => pending !== null || running !== null,
  };
}
