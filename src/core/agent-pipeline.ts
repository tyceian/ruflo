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

    // Group consecutive parallel steps together
    const stepGroups = this.groupSteps(config.steps);

    for (const group of stepGroups) {
      if (!success && config.failFast) break;

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
      return {
        agentId: step.agentId,
        success: false,
        output: {},
        error: `Agent '${step.agentId}' not found in registry`,
        durationMs: Date.now() - stepStart,
      };
    }

    // Build input by applying mapping from context + step static input
    const mappedInput: Record<string, unknown> = { ...step.input };
    if (step.inputMapping) {
      for (const [contextKey, inputKey] of Object.entries(step.inputMapping)) {
        if (contextKey in context) {
          mappedInput[inputKey] = context[contextKey];
        }
      }
    }

    try {
      const output = await this.executor.execute(agent, mappedInput);
      return {
        agentId: step.agentId,
        success: true,
        output: output as Record<string, unknown>,
        durationMs: Date.now() - stepStart,
      };
    } catch (err) {
      return {
        agentId: step.agentId,
        success: false,
        output: {},
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - stepStart,
      };
    }
  }

  /** Group consecutive parallel steps into batches */
  private groupSteps(steps: PipelineStep[]): PipelineStep[][] {
    const groups: PipelineStep[][] = [];
    let i = 0;
    while (i < steps.length) {
      if (steps[i].parallel) {
        const group: PipelineStep[] = [];
        while (i < steps.length && steps[i].parallel) {
          group.push(steps[i++]);
        }
        groups.push(group);
      } else {
        groups.push([steps[i++]]);
      }
    }
    return groups;
  }
}
