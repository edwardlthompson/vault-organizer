export type TaskFn<T> = () => Promise<T>;

export class ConcurrentQueue {
  private running = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private concurrency: number) {}

  setConcurrency(n: number): void {
    this.concurrency = Math.max(1, n);
    this.pump();
  }

  async add<T>(fn: TaskFn<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.running--;
      this.pump();
    }
  }

  private acquire(): Promise<void> {
    if (this.running < this.concurrency) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.running++;
        resolve();
      });
    });
  }

  private pump(): void {
    while (this.running < this.concurrency && this.waiters.length > 0) {
      const next = this.waiters.shift();
      next?.();
    }
  }
}
