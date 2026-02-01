/**
 * Simple async queue to limit concurrent test executions.
 * Chrome instances are resource-intensive, so we limit how many run at once.
 */

type QueuedTask<T> = {
  id: string;
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  queuedAt: number;
};

export class TestQueue {
  private queue: QueuedTask<unknown>[] = [];
  private running: Map<string, { startedAt: number }> = new Map();
  private maxConcurrent: number;

  constructor(maxConcurrent: number = 3) {
    this.maxConcurrent = maxConcurrent;
    console.log(`[Queue] Initialized with max ${maxConcurrent} concurrent tests`);
  }

  /**
   * Add a task to the queue. Returns a promise that resolves when the task completes.
   */
  async enqueue<T>(id: string, task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        id,
        task: task as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
        queuedAt: Date.now(),
      });

      console.log(`[Queue] Task ${id} queued (${this.queue.length} waiting, ${this.running.size} running)`);
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.running.size >= this.maxConcurrent) {
      return; // At capacity
    }

    const nextTask = this.queue.shift();
    if (!nextTask) {
      return; // Nothing to process
    }

    this.running.set(nextTask.id, { startedAt: Date.now() });
    console.log(`[Queue] Starting task ${nextTask.id} (${this.running.size}/${this.maxConcurrent} slots used)`);

    try {
      const result = await nextTask.task();
      nextTask.resolve(result);
    } catch (error) {
      nextTask.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.running.delete(nextTask.id);
      console.log(`[Queue] Task ${nextTask.id} completed (${this.running.size}/${this.maxConcurrent} slots used)`);
      
      // Process next task
      this.processQueue();
    }
  }

  /**
   * Get queue status
   */
  getStatus(): {
    queued: number;
    running: number;
    maxConcurrent: number;
    runningIds: string[];
    queuedIds: string[];
  } {
    return {
      queued: this.queue.length,
      running: this.running.size,
      maxConcurrent: this.maxConcurrent,
      runningIds: Array.from(this.running.keys()),
      queuedIds: this.queue.map((t) => t.id),
    };
  }

  /**
   * Check if a task is currently running
   */
  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  /**
   * Check if a task is queued
   */
  isQueued(id: string): boolean {
    return this.queue.some((t) => t.id === id);
  }

  /**
   * Get position in queue (0 = running, 1+ = queued position)
   */
  getPosition(id: string): number {
    if (this.running.has(id)) return 0;
    const pos = this.queue.findIndex((t) => t.id === id);
    return pos === -1 ? -1 : pos + 1;
  }
}

// Singleton instance - max 3 concurrent browser sessions
export const testQueue = new TestQueue(
  parseInt(process.env.MAX_CONCURRENT_TESTS || "3", 10)
);
