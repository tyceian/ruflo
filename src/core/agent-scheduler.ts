/**
 * AgentScheduler - Manages task queuing, prioritization, and execution scheduling
 * for agents in the ruflo pipeline.
 */

import { AgentRegistry } from './agent-registry';

export type TaskPriority = 'low' | 'normal' | 'high' | 'critical';

export interface ScheduledTask {
  id: string;
  agentId: string;
  payload: Record<string, unknown>;
  priority: TaskPriority;
  scheduledAt: Date;
  runAt?: Date; // optional deferred execution time
  retries: number;
  maxRetries: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
};

export class AgentScheduler {
  private queue: ScheduledTask[] = [];
  private running = false;
  private concurrency: number;
  private activeCount = 0;
  private registry: AgentRegistry;

  constructor(registry: AgentRegistry, concurrency = 3) {
    this.registry = registry;
    this.concurrency = concurrency;
  }

  /**
   * Enqueue a task for a given agent. Returns the task id.
   */
  schedule(
    agentId: string,
    payload: Record<string, unknown>,
    options: { priority?: TaskPriority; runAt?: Date; maxRetries?: number } = {}
  ): string {
    const task: ScheduledTask = {
      id: crypto.randomUUID(),
      agentId,
      payload,
      priority: options.priority ?? 'normal',
      scheduledAt: new Date(),
      runAt: options.runAt,
      retries: 0,
      maxRetries: options.maxRetries ?? 2,
      status: 'pending',
    };

    this.queue.push(task);
    this.sortQueue();

    if (this.running) {
      this.drain();
    }

    return task.id;
  }

  /** Start processing the queue. */
  start(): void {
    this.running = true;
    this.drain();
  }

  /** Pause processing — in-flight tasks finish naturally. */
  pause(): void {
    this.running = false;
  }

  /** Return a snapshot of the current queue. */
  getQueue(): Readonly<ScheduledTask[]> {
    return [...this.queue];
  }

  private sortQueue(): void {
    const now = Date.now();
    this.queue.sort((a, b) => {
      // Tasks not yet due go to the back
      const aReady = !a.runAt || a.runAt.getTime() <= now;
      const bReady = !b.runAt || b.runAt.getTime() <= now;
      if (aReady && !bReady) return -1;
      if (!aReady && bReady) return 1;
      // Higher priority first
      return PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
    });
  }

  private drain(): void {
    while (this.running && this.activeCount < this.concurrency) {
      const task = this.nextReadyTask();
      if (!task) break;
      this.execute(task);
    }
  }

  private nextReadyTask(): ScheduledTask | undefined {
    const now = Date.now();
    return this.queue.find(
      (t) => t.status === 'pending' && (!t.runAt || t.runAt.getTime() <= now)
    );
  }

  private async execute(task: ScheduledTask): Promise<void> {
    task.status = 'running';
    this.activeCount++;

    try {
      const agent = this.registry.get(task.agentId);
      if (!agent) throw new Error(`Agent not found: ${task.agentId}`);

      // Agents are expected to expose a run(payload) method
      await (agent as { run: (p: Record<string, unknown>) => Promise<void> }).run(
        task.payload
      );

      task.status = 'completed';
    } catch (err) {
      console.error(`[scheduler] task ${task.id} failed:`, err);
      if (task.retries < task.maxRetries) {
        task.retries++;
        task.status = 'pending';
        // back-off: retry after 1s * retries
        task.runAt = new Date(Date.now() + 1000 * task.retries);
      } else {
        task.status = 'failed';
      }
    } finally {
      this.activeCount--;
      this.sortQueue();
      if (this.running) this.drain();
    }
  }
}
