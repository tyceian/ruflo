/**
 * Prompt-injection defense helpers (ADR-093 §S3 / Step 22c).
 *
 * Two principles:
 *
 *   1. User-supplied strings going into LLM prompts MUST be wrapped
 *      in `<user_input>...</user_input>` delimiters. This makes the
 *      LLM's instructions unambiguous: anything inside the delimiter
 *      is data, not instructions. Existing inner `</user_input>` tokens
 *      are stripped to prevent the user from closing the tag and
 *      injecting prompt-level instructions.
 *
 *   2. Every LLM response is validated with a Zod schema before any
 *      field is forwarded to the UI. Failures fall back to a safe
 *      default (typically a 502 with a generic error). LLM output
 *      is NEVER eval'd, NEVER concatenated unwrapped into a downstream
 *      prompt, and NEVER passed to `dangerouslySetInnerHTML`.
 */

/** Wrap a user-supplied string in `<user_input>` delimiters. */
export function wrapUserInput(s: string | undefined | null): string {
  if (s === undefined || s === null) return '<user_input></user_input>';
  // Strip occurrences of the closing tag so the user can't escape
  // the delimiter. Case-insensitive + whitespace-tolerant.
  const cleaned = String(s).replace(/<\s*\/?\s*user_input\s*>/gi, '');
  return `<user_input>${cleaned}</user_input>`;
}
