import Anthropic from "@anthropic-ai/sdk";
import type { ParsedIntent, ActionType, AccessLevel } from "./types.js";

const VALID_ACTION_TYPES: ActionType[] = [
  "ACCESS_REQUEST",
  "HARDWARE_REQUEST",
  "REVOKE_ACCESS",
  "UNKNOWN",
];

const VALID_ACCESS_LEVELS: AccessLevel[] = ["read", "write", "admin", null];

const KNOWN_SYSTEMS = [
  "Slack",
  "AWS",
  "Jira",
  "GitHub",
  "Okta",
  "NetSuite",
  "Excel",
  "Hardware",
];

const SYSTEM_PROMPT = `You are an IT request parser. Extract structured information from IT support requests.

You must respond with valid JSON matching this exact schema:
{
  "action_type": "ACCESS_REQUEST" | "HARDWARE_REQUEST" | "REVOKE_ACCESS" | "UNKNOWN",
  "target_system": string | null,
  "target_resource": string | null,
  "access_level": "read" | "write" | "admin" | null,
  "target_user": string | null,
  "justification": string | null,
  "confidence": number (0-1)
}

Rules:
- action_type: Use "ACCESS_REQUEST" for system/tool access, "HARDWARE_REQUEST" for physical items, "REVOKE_ACCESS" for removing access, "UNKNOWN" if unclear
- target_system: Must be one of: Slack, AWS, Jira, GitHub, Okta, NetSuite, Excel, Hardware. Use null if not applicable.
- target_resource: Specific resource like channel name, database name, project name. Use null if not specified.
- access_level: "read" for view-only, "write" for read-write, "admin" for administrative access. Use null if not applicable or not specified.
- target_user: Only for REVOKE_ACCESS - the user whose access should be revoked
- justification: The reason given for the request, extracted from the text
- confidence: Your confidence in the parsing (0.0-1.0)

Be conservative with access_level - only set "admin" if explicitly requested.
If the request is ambiguous or unclear, set confidence low and action_type to "UNKNOWN".`;

function extractJson(text: string): string {
  // Strip markdown code blocks if present (```json ... ``` or ``` ... ```)
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  return text.trim();
}

export async function parseIntent(rawText: string): Promise<ParsedIntent> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY environment variable is required. Set it with: export ANTHROPIC_API_KEY=your-key"
    );
  }

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `Parse this IT request and respond with JSON only:\n\n"${rawText}"`,
      },
    ],
    system: SYSTEM_PROMPT,
  });

  const content = response.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response type from LLM");
  }

  // Strip markdown code blocks if present
  const jsonText = extractJson(content.text);
  const parsed = JSON.parse(jsonText) as ParsedIntent;

  return validateAndNormalize(parsed);
}

function validateAndNormalize(parsed: ParsedIntent): ParsedIntent {
  // Validate action_type against allow-list
  if (!VALID_ACTION_TYPES.includes(parsed.action_type)) {
    parsed.action_type = "UNKNOWN";
    parsed.confidence = Math.min(parsed.confidence, 0.3);
  }

  // Validate access_level against allow-list
  if (!VALID_ACCESS_LEVELS.includes(parsed.access_level)) {
    parsed.access_level = null;
  }

  // Validate target_system against known systems
  if (parsed.target_system) {
    const normalizedSystem = KNOWN_SYSTEMS.find(
      (s) => s.toLowerCase() === parsed.target_system?.toLowerCase()
    );
    if (!normalizedSystem) {
      // Unknown system - keep original but flag low confidence
      parsed.confidence = Math.min(parsed.confidence, 0.5);
    } else {
      parsed.target_system = normalizedSystem;
    }
  }

  // Ensure confidence is in valid range
  parsed.confidence = Math.max(0, Math.min(1, parsed.confidence));

  return parsed;
}
