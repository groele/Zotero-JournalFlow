export async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (!items.length) return;
  let next = 0;
  const count = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(
    Array.from({ length: count }, async () => {
      while (next < items.length) {
        const item = items[next++];
        await worker(item);
      }
    })
  );
}

export function createSemaphore(limit: number): { run<T>(fn: () => Promise<T>): Promise<T> } {
  const max = Math.max(1, limit);
  let active = 0;
  const waiters: Array<() => void> = [];

  const acquire = (): Promise<void> => {
    if (active < max) {
      active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      waiters.push(() => {
        active++;
        resolve();
      });
    });
  };

  const release = (): void => {
    active--;
    const wake = waiters.shift();
    if (wake) wake();
  };

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
  };
}
