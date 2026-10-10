// Optional LLM pass: reads the free-text parts of a lead message that the rule
// parser can only guess at (contact, role, need, follow-up date). Enabled when
// ANTHROPIC_API_KEY is set and USE_LLM isn't "false". Any failure falls back to
// the rule-based result, so ingestion never blocks on the API.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod/v4';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

const MODEL = process.env.LLM_MODEL || 'claude-opus-5';
const enabled = () => Boolean(process.env.ANTHROPIC_API_KEY) && process.env.USE_LLM !== 'false';

const LeadFields = z.object({
  company: z.string().nullable().describe('The client organisation the work is for (not the referrer or contact person); null if not stated'),
  contact_name: z.string().nullable().describe('Person at the prospect company we are talking to'),
  contact_role: z.string().nullable().describe('Their job title, e.g. "Brand manager"'),
  need: z.string().nullable().describe('What they want from us, 1-5 words, e.g. "Website revamp"'),
  next_step: z.string().nullable().describe('The next action, e.g. "Call"'),
  follow_up_date: z
    .string()
    .nullable()
    .describe('Date of the next step as YYYY-MM-DD, resolved relative to the posted date; null if none'),
});

let client;

export async function refineWithLLM(text, postedAt, ruleResult) {
  if (!enabled()) return ruleResult;
  client ??= new Anthropic();
  const posted = postedAt.toISOString().slice(0, 10);
  const weekday = postedAt.toLocaleDateString('en-US', { weekday: 'long' });

  try {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 2000,
      output_config: { effort: 'low', format: zodOutputFormat(LeadFields) },
      system:
        'You extract CRM fields from sales-team Slack messages announcing a new lead. ' +
        'Only use information present in the message; use null when a field is not stated. ' +
        'Weekday names mean the next occurrence after the posted date.',
      messages: [
        {
          role: 'user',
          content: `Posted on ${weekday} ${posted}.\n\n<message>\n${text}\n</message>`,
        },
      ],
    });

    if (response.stop_reason === 'refusal' || !response.parsed_output) return ruleResult;
    const out = response.parsed_output;
    const merged = { ...ruleResult };
    for (const key of ['contact_name', 'contact_role', 'need']) merged[key] = out[key] ?? ruleResult[key];
    // The header sometimes names the contact (a LinkedIn link) rather than the client.
    if (out.company && ruleResult.company === ruleResult.contact_name) merged.company = out.company;
    if (out.next_step && !ruleResult.next_step) merged.next_step = out.next_step;
    if (out.follow_up_date && /^\d{4}-\d{2}-\d{2}$/.test(out.follow_up_date)) {
      const [y, m, d] = out.follow_up_date.split('-').map(Number);
      merged.next_follow_up_at = new Date(y, m - 1, d, 10).toISOString();
    }
    return merged;
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) console.warn('[llm] rate limited, using rule parser');
    else if (err instanceof Anthropic.APIError) console.warn(`[llm] API error ${err.status}, using rule parser`);
    else console.warn('[llm] extraction failed, using rule parser:', err.message);
    return ruleResult;
  }
}
