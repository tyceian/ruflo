/**
 * AgentPipeline - Orchestrates sequential and parallel execution of agents
 * Supports chaining agents together with data flowing between steps
 */

import { AgentRegistry } from './agent-registry';
import { AgentExecutor } from './agent-executor';

export interface PipelineStep {
  agentId: string;
  input?: Record<string, unknown>;
  /** Map output keys from previous step to input keys for this step */
  inputMapping?: Record<string, string>;
  /** Whether this step can run in parallel with adjacent parallel steps */
  parallel?: boolean;
}

export interface PipelineConfig {
  id: string;
  name: string;
  steps: PipelineStep[];
  /** Stop pipeline on first step failure */
  failFast?: boolean;
}

export interface PipelineResult {
  pipelineId: string;
  success: boolean;
  stepResults: StepResult[];
  finalOutput: Record<string, unknown>;
  durationMs: number;
}

export interface StepResult {
  agentId: string;
  success: boolean;
  output: Record<string, unknown>;
  error?: string;
  durationMs: number;
}

export class AgentPipeline {
  private registry: AgentRegistry;
  private executor: AgentExecutor;
  // default to failFast=true in my usage - I'd rather know immediately when something breaks
  private defaultFailFast: boolean = true;

  constructor(registry: AgentRegistry, executor: AgentExecutor) {
    this.registry = registry;
    this.executor = executor;
  }

  /**
   * Execute a pipeline configuration, running steps sequentially
   * or in parallel groups based on step configuration.
   */
  async run(
    config: PipelineConfig,
    initialInput: Record<string, unknown> = {}
  ): Promise<PipelineResult> {
    const startTime = Date.now();
    const stepResults: StepResult[] = [];
    let currentContext: Record<string, unknown> = { ...initialInput };
    let success = true;

    // Use config's failFast if explicitly set, otherwise fall back to my default
    const failFast = config.failFast ?? this.defaultFailFast;

    // Group consecutive parallel steps together
    const stepGroups = this.groupSteps(config.steps);

    for (const group of stepGroups) {
      if (!success && failFast) break;

      if (group.length === 1) {
        // Sequential step
        const result = await this.runStep(group[0], currentContext);
        stepResults.push(result);
        if (!result.success) {
          success = false;
        } else {
          currentContext = { ...currentContext, ...result.output };
        }
      } else {
        // Parallel group
        const results = await Promise.all(
          group.map((step) => this.runStep(step, currentContext))
        );
        for (const result of results) {
          stepResults.push(result);
          if (!result.success) {
            success = false;
          } else {
            currentContext = { ...currentContext, ...result.output };
          }
        }
      }
    }

    return {
      pipelineId: config.id,
      success,
      stepResults,
      finalOutput: currentContext,
      durationMs: Date.now() - startTime,
    };
  }

  private async runStep(
    step: PipelineStep,
    context: Record<string, unknown>
  ): Promise<StepResult> {
    const stepStart = Date.now();
    const agent = this.registry.get(step.agentId);

    if (!agent) {
  