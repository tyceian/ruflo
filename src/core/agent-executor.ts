/**
 * AgentExecutor — responsible for running registered agents with
 * lifecycle management, error handling, and basic telemetry.
 */

import { AgentRegistry } from "./agent-registry";

export interface ExecutionContext {
  agentId: string;
  input: Record<string, unknown>;
  timeoutMs?: number;
  retries?: number;
}

export interface ExecutionResult {
  agentId: string;
  success: boolean;
  output?: Record<string, unknown>;
  error?: string;
  durationMs: number;
  attempts: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 1;

export class AgentExecutor {
  private registry: AgentRegistry;

  constructor(registry: AgentRegistry) {
    this.registry = registry;
  }

  /**
   * Execute a single agent by id, retrying on transient failures.
   */
  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const { agentId, input, timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES } = ctx;

    const agent = this.registry.get(agentId);
    if (!agent) {
      return {
        agentId,
        success: false,
        error: `Agent "${agentId}" not found in registry`,
        durationMs: 0,
        attempts: 0,
      };
    }

    let lastError: string | undefined;
    let attempts = 0;
    const start = Date.now();

    for (let attempt = 0; attempt <= retries; attempt++) {
      attempts = attempt + 1;
      try {
        const output = await this.runWithTimeout(
          () => agent.run(input),
          timeoutMs
        );
        return {
          agentId,
          success: true,
          output,
          durationMs: Date.now() - start,
          attempts,
        };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        console.warn(`[AgentExecutor] attempt ${attempts} failed for "${agentId}": ${lastError}`);
      }
    }

    return {
      agentId,
      success: false,
      error: lastError,
      durationMs: Date.now() - start,
      attempts,
    };
  }

  /**
   * Execute multiple agents in parallel and collect results.
   */
  async executeBatch(contexts: ExecutionContext[]): Promise<ExecutionResult[]> {
    return Promise.all(contexts.map((ctx) => this.execute(ctx)));
  }

  /**
   * Wraps a promise-returning function with a hard timeout.
   */
  private runWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Execution timed out after ${timeoutMs}ms`)),
        timeoutMs
      );
      fn()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }
}
