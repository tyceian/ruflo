/**
 * optimize-research-config — port of `supabase/functions/optimize-research-config`.
 *
 * Same contract as the Deno original: takes `{preset, currentGoal?}`,
 * returns `{config: ResearchConfig}` (or `{error}` on 429/402/5xx).
 *
 * Mock mode when `LOVABLE_API_KEY` unset returns a canned config.
 *
 * NOTE: per-preset prompt corpus (~250 lines of templates in the
 * Deno original) is reduced to a single generic prompt here. Full
 * corpus port is a polish follow-up — wiring/contract is what
 * matters for Step 21a's DoD.
 */

import { z } from 'zod';
import { wrapUserInput } from '../_lib/sanitize';

const SYSTEM_PROMPT =
  'You are an expert research workflow architect specializing in GOAP ' +
  '(Goal-Oriented Action Planning) configuration optimization. Generate ' +
  'optimized research configuration settings based on the given preset/objective.';

const ToolOutputSchema = z.object({
  config: z.object({}).passthrough(),
});

const TOOL = {
  type: 'function',
  function: {
    name: 'generate_config',
    description: 'Generate optimized research config for the preset',
    parameters: {
      type: 'object',
      properties: {
        config: {
          type: 'object',
          properties: {
            researchGuidance: { type: 'object', additionalProperties: true },
            parameters: { type: 'object', additionalProperties: true },
            filters: { type: 'object', additionalProperties: true },
          },
          additionalProperties: true,
        },
      },
      required: ['config'],
      additionalProperties: false,
    },
  },
} as const;

export interface OptimizeRequest {
  preset: string;
  currentGoal?: string;
}

export interface HandlerResult {
  status: number;
  body: unknown;
}

export async function optimizeResearchConfigHandler(
  req: OptimizeRequest,
): Promise<HandlerResult> {
  const { preset, currentGoal } = req;
  if (typeof preset !== 'string' || preset.trim() === '') {
    return { status: 400, body: { error: 'preset is required (string)' } };
  }

  const key = process.env.LOVABLE_API_KEY;
  if (!key) {
    // Canned mock config — preserves shape callers expect.
    return {
      status: 200,
      body: {
        config: {
          researchGuidance: {
            depth: 'moderate',
            perspective: 'technical',
            timeframe: 'recent',
            focusAreas: [`${preset}-mock`],
            excludeTopics: [],
          },
          parameters: { maxSources: 8, minConfidence: 0.7, maxSteps: 5, parallelAgents: 2, timeout: 30000 },
          filters: { dateRange: 'recent', sourceTypes: ['academic', 'news'], languages: ['en'], excludeDomains: [] },
        },
        mock: true,
      },
    };
  }

  const userPrompt = `Optimize research settings for preset: ${wrapUserInput(preset)}. Goal: ${wrapUserInput(currentGoal || 'general research')}`;
  const upstream = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      tools: [TOOL],
      tool_choice: { type: 'function', function: { name: 'generate_config' } },
    }),
  });

  if (!upstream.ok) {
    if (upstream.status === 429) return { status: 429, body: { error: 'Rate limits exceeded. Please try again later.' } };
    if (upstream.status === 402) return { status: 402, body: { error: 'AI usage limit reached. Please add credits to continue.' } };
    return { status: 502, body: { error: `AI gateway error: ${upstream.status}` } };
  }

  const data = (await upstream.json()) as {
    choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
  };
  const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) return { status: 502, body: { error: 'No tool call in AI response' } };
  let raw: unknown;
  try { raw = JSON.parse(args); } catch { return { status: 502, body: { error: 'Failed to parse AI tool-call arguments' } }; }
  const validated = ToolOutputSchema.safeParse(raw);
  if (!validated.success) {
    return { status: 502, body: { error: 'AI tool-call output failed schema validation' } };
  }
  return { status: 200, body: { config: validated.data.config } };
}
