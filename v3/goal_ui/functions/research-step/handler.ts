/**
 * research-step — port of `supabase/functions/research-step`.
 *
 * Same contract: takes `{goal, stepTitle, stepDescription, stepType,
 * aiModel?, config?, previousStepsData?}` and returns an array of
 * `DataItem` (or `{error}` on 429/402/5xx). The Deno original's
 * full prompt-construction logic is preserved structurally; per-step-
 * type prompt templates are reduced to a generic prompt here (full
 * corpus port is a polish follow-up).
 *
 * Mock mode when `LOVABLE_API_KEY` unset returns 3 canned data
 * items for the requested stepTitle.
 */

import { z } from 'zod';
import { wrapUserInput } from '../_lib/sanitize';

interface ResearchDataItem {
  title: string;
  content: string;
  source?: string;
  confidence?: number;
  timestamp?: string;
}

const ToolOutputSchema = z.object({
  findings: z
    .array(z.object({
      title: z.string().min(1),
      content: z.string(),
      source: z.string().optional(),
      confidence: z.number().min(0).max(1).optional(),
    }))
    .min(1),
});

const SYSTEM_PROMPT =
  'You are a meticulous research analyst executing a single step of a ' +
  'larger research plan. Return concrete findings as structured data. ' +
  'Prefer authoritative sources, named entities, and concrete metrics ' +
  'over vague summaries.';

const TOOL = {
  type: 'function',
  function: {
    name: 'return_findings',
    description: 'Return findings for the current research step',
    parameters: {
      type: 'object',
      properties: {
        findings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              content: { type: 'string' },
              source: { type: 'string' },
              confidence: { type: 'number' },
            },
            required: ['title', 'content'],
            additionalProperties: false,
          },
          minItems: 1,
        },
      },
      required: ['findings'],
      additionalProperties: false,
    },
  },
} as const;

export interface ResearchStepRequest {
  goal: string;
  stepTitle: string;
  stepDescription: string;
  stepType: string;
  aiModel?: string;
  config?: unknown;
  previousStepsData?: Array<{ stepTitle: string; data: ResearchDataItem[] }>;
}

export interface HandlerResult {
  status: number;
  body: unknown;
}

export async function researchStepHandler(
  req: ResearchStepRequest,
): Promise<HandlerResult> {
  const { goal, stepTitle, stepDescription } = req;
  if (typeof goal !== 'string' || typeof stepTitle !== 'string') {
    return { status: 400, body: { error: 'goal and stepTitle are required (strings)' } };
  }

  const key = process.env.LOVABLE_API_KEY;
  if (!key) {
    return {
      status: 200,
      body: [
        { title: `[mock] ${stepTitle} — finding 1`, content: `Stub content for ${stepTitle}`, source: 'mock://source-1', confidence: 0.9, timestamp: new Date().toISOString() },
        { title: `[mock] ${stepTitle} — finding 2`, content: `Second stub finding`, source: 'mock://source-2', confidence: 0.8, timestamp: new Date().toISOString() },
        { title: `[mock] ${stepTitle} — finding 3`, content: `Third stub finding`, source: 'mock://source-3', confidence: 0.7, timestamp: new Date().toISOString() },
      ],
    };
  }

  // Prior step content is LLM-generated but treated as untrusted —
  // wrap each finding in <user_input> delimiters so a model can't
  // emit prompt-injection content that's then reflected back to the
  // upstream model unwrapped.
  const ctx = (req.previousStepsData ?? []).map(s =>
    `${wrapUserInput(s.stepTitle)}:\n` + s.data.map(d => `- ${wrapUserInput(d.title)}: ${wrapUserInput(d.content)}`).join('\n')
  ).join('\n\n');

  const userPrompt = [
    `Research goal: ${wrapUserInput(goal)}`,
    `Current step: ${wrapUserInput(stepTitle)} — ${wrapUserInput(stepDescription)}`,
    ctx ? `Prior step findings:\n${ctx}` : 'No prior steps yet.',
  ].join('\n\n');

  const upstream = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: req.aiModel || 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      tools: [TOOL],
      tool_choice: { type: 'function', function: { name: 'return_findings' } },
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
  // Original returns a flat array (NOT wrapped in {findings:...}) — preserve that wire shape.
  return { status: 200, body: validated.data.findings as ResearchDataItem[] };
}
