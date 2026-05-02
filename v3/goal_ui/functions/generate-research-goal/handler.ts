/**
 * generate-research-goal — pure handler, framework-agnostic.
 *
 * Port of `supabase/functions/generate-research-goal/index.ts` (Deno)
 * to Node. Same wire format, same Lovable AI Gateway backend, same
 * 429/402/5xx → status-code translation. Differences:
 *
 *   - Uses Node's built-in fetch (Node 22+) instead of Deno's std lib
 *   - Reads `LOVABLE_API_KEY` from `process.env` instead of `Deno.env`
 *   - Returns a normalized `{ status, body }` instead of a Response
 *     so it can be wrapped by either Hono (LOCAL_FN dev) or GCF
 *     (production) without re-implementing transport.
 *   - User-supplied strings wrapped in `<user_input>` delimiters
 *     and LLM tool-call output validated against a Zod schema
 *     (ADR-093 §S3 / Step 22c).
 *
 * Mock mode: if `LOVABLE_API_KEY` is unset, returns 3 canned goals
 * tagged with the requested category so the wiring can be exercised
 * locally without an upstream key. Unsuitable for production —
 * deployment must set the key.
 */
import { z } from 'zod';
import { wrapUserInput } from '../_lib/sanitize';

const ToolOutputSchema = z.object({
  goals: z
    .array(z.object({ title: z.string().min(1), category: z.string().optional() }))
    .min(1),
});

const SYSTEM_PROMPT = `You are an expert research consultant and futurist who helps formulate cutting-edge, innovative research objectives that push boundaries.

Generate 3 HIGHLY DIVERSE and NOVEL research goals for the given category. Each goal should be:
- Innovative and forward-thinking (explore emerging trends, novel applications, or unconventional angles)
- Specific and actionable (clear research direction, not vague exploration)
- Current and relevant to 2024-2025 cutting-edge developments
- Professionally articulated with compelling detail
- DIFFERENT from each other (vary the approach, scale, application, or methodology)
- Boundary-pushing (challenge conventional thinking, explore unexplored intersections)

CRITICAL: Generate VARIETY across the 3 goals by varying:
- Scale (micro vs macro, individual vs enterprise vs societal)
- Application domain (different industries, use cases, or contexts)
- Approach (technical implementation, business impact, ethical considerations, future predictions)
- Time horizon (near-term practical vs long-term transformative)

Push the boundaries. Be specific. Be innovative.`;

const CATEGORY_PROMPTS: Record<string, string> = {
  finance: 'Generate 3 cutting-edge, diverse research goals for finance. Vary across: (1) emerging technologies (crypto, DeFi, AI trading), (2) novel market mechanisms or regulations, (3) behavioral/psychological aspects or systemic risks. Include specific metrics, timeframes, or novel applications.',
  business: 'Generate 3 innovative, diverse research goals for business. Vary across: (1) emerging business models or platforms, (2) organizational transformation or culture, (3) data-driven decision making or automation. Be specific about industry, scale, and measurable outcomes.',
  marketing: 'Generate 3 boundary-pushing, diverse research goals for marketing. Vary across: (1) emerging channels or technologies (AI, AR/VR, Web3), (2) behavioral science or psychology, (3) measurement or attribution innovation. Include specific platforms, demographics, or novel approaches.',
  medical: 'Generate 3 cutting-edge, diverse research goals for medical/healthcare. Vary across: (1) emerging diagnostic or treatment technologies, (2) healthcare delivery or access innovations, (3) personalized/precision medicine or AI applications. Be specific about conditions, populations, or technologies.',
  education: 'Generate 3 innovative, diverse research goals for education. Vary across: (1) emerging pedagogical technologies (AI tutors, VR, adaptive learning), (2) learning science or cognitive research, (3) educational equity or accessibility. Include specific age groups, subjects, or measurable learning outcomes.',
  technical: 'Generate 3 cutting-edge, diverse research goals for technical/engineering. Vary across: (1) emerging architectures or paradigms, (2) performance or efficiency breakthroughs, (3) security or reliability innovations.',
  coding: 'Generate 3 innovative, diverse research goals for coding/software development. Vary across: (1) emerging languages, frameworks, or paradigms, (2) AI-assisted development or automation, (3) code quality, testing, or collaboration tools.',
  'ai-ml': 'Generate 3 CUTTING-EDGE, diverse research goals for AI, Machine Learning, and Autonomous Agents. MUST vary across: (1) agentic AI systems, (2) novel architectures or training paradigms, (3) real-world applications or societal implications.',
};

const TOOL = {
  type: 'function',
  function: {
    name: 'generate_goals',
    description: 'Generate 3 specific research goals for the given category',
    parameters: {
      type: 'object',
      properties: {
        goals: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'A concise, specific research goal (1-2 sentences max)' },
              category: { type: 'string', description: 'The category this goal belongs to' },
            },
            required: ['title', 'category'],
            additionalProperties: false,
          },
          minItems: 3,
          maxItems: 3,
        },
      },
      required: ['goals'],
      additionalProperties: false,
    },
  },
} as const;

export interface GenerateResearchGoalRequest {
  category: string;
  customContext?: string;
}

export interface HandlerResult {
  status: number;
  body: unknown;
}

export async function generateResearchGoalHandler(
  req: GenerateResearchGoalRequest,
): Promise<HandlerResult> {
  const { category, customContext } = req;
  if (typeof category !== 'string' || category.trim() === '') {
    return { status: 400, body: { error: 'category is required (string)' } };
  }

  const key = process.env.LOVABLE_API_KEY;

  // Mock mode — no upstream call, return canned goals so the wiring
  // can be exercised without secrets. Disabled in production by
  // requiring the key at deploy time (Step 22a will add a CI check).
  if (!key) {
    return {
      status: 200,
      body: {
        goals: [
          `[mock] Investigate emerging ${category} research direction A`,
          `[mock] Analyze novel ${category} application area B`,
          `[mock] Benchmark a cross-cutting ${category} approach C`,
        ],
        mock: true,
      },
    };
  }

  // Wrap user-supplied strings in delimiters before composing the prompt.
  const safeCategory = wrapUserInput(category);
  const safeContext = wrapUserInput(customContext ?? category);
  const userPrompt =
    CATEGORY_PROMPTS[category.toLowerCase()] ??
    `Generate 3 innovative, boundary-pushing research goals based on: ${safeContext}. Category hint: ${safeCategory}.`;

  const upstream = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      tools: [TOOL],
      tool_choice: { type: 'function', function: { name: 'generate_goals' } },
    }),
  });

  if (!upstream.ok) {
    if (upstream.status === 429) {
      return { status: 429, body: { error: 'Rate limits exceeded. Please try again later.' } };
    }
    if (upstream.status === 402) {
      return { status: 402, body: { error: 'AI usage limit reached. Please add credits to continue.' } };
    }
    return {
      status: 502,
      body: { error: `AI gateway error: ${upstream.status}` },
    };
  }

  const data = (await upstream.json()) as {
    choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
  };
  const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) {
    return { status: 502, body: { error: 'No tool call in AI response' } };
  }
  let raw: unknown;
  try { raw = JSON.parse(args); }
  catch { return { status: 502, body: { error: 'Failed to parse AI tool-call arguments' } }; }
  const validated = ToolOutputSchema.safeParse(raw);
  if (!validated.success) {
    return { status: 502, body: { error: 'AI tool-call output failed schema validation' } };
  }
  const goals = validated.data.goals.map((g) => g.title).filter(Boolean);
  return { status: 200, body: { goals } };
}
