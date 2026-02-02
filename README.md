# Auto-Ops Agent

A CLI application that processes unstructured IT requests and outputs structured actions, enforcing security policies along the way.

## Quick Start

### Prerequisites

- Node.js 18+
- An Anthropic API key

### Installation

```bash
npm install
```

### Running the Agent

```bash
# Copy the example env file and add your API key
cp .env.example .env
# Edit .env and paste your ANTHROPIC_API_KEY

# Run with default files (input.json, policy.json)
npm start

# Or with custom paths
npx tsx src/index.ts --input ./input.json --policy ./policy.json --output ./output.json
```

### CLI Options

| Option | Description | Default |
|--------|-------------|---------|
| `-i, --input <path>` | Path to input requests JSON | `./input.json` |
| `-p, --policy <path>` | Path to policy JSON | `./policy.json` |
| `-o, --output <path>` | Path to write output JSON | stdout |
| `-h, --help` | Show help message | - |

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Intent Parser  │────▶│  Policy Engine  │────▶│    Executor     │
│   (LLM Layer)   │     │  (Guardrails)   │     │   (Output)      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

1. **Intent Parser**: Uses Claude to extract structured intent from natural language requests
2. **Policy Engine**: Validates requests against configurable security policies
3. **Executor**: Generates service-specific JSON payloads for approved requests

## AI Safety Section

### How We Ensure the LLM Cannot Execute Dangerous Commands

The system implements multiple layers of protection to prevent LLM hallucinations from granting unauthorized access:

#### 1. LLM Output is Never Trusted Directly

The LLM's parsed output is **never executed directly**. It only suggests intent, which must then pass through the policy engine. The LLM cannot:
- Grant access to any system
- Approve its own suggestions
- Bypass policy checks

#### 2. Strict Allow-Lists

- **Action types**: Only `ACCESS_REQUEST`, `HARDWARE_REQUEST`, `REVOKE_ACCESS`, and `UNKNOWN` are valid. Any other action type from the LLM is normalized to `UNKNOWN`.
- **Access levels**: Only `read`, `write`, `admin`, or `null` are accepted.
- **Systems**: Unknown systems are flagged with reduced confidence.

#### 3. Prompt Injection Detection

Before any LLM processing, raw request text is scanned for injection patterns:
- "ignore previous instructions"
- "you are now"
- "bypass security"
- "grant superadmin"
- And other common injection patterns

Requests containing these patterns are **immediately denied** without LLM processing.

#### 4. Confidence Thresholds

If the LLM's confidence score is below 0.7 (70%), the request triggers a `CLARIFICATION_NEEDED` response instead of any action.

#### 5. Policy Engine as Final Arbiter

Every request must pass policy checks:
- Department-based system access (e.g., Finance cannot access AWS)
- Sensitive action rules (e.g., admin access is denied or requires approval)
- Hardware budget limits per department
- Slack channel restrictions

#### 6. Complete Audit Trail

Every decision is logged with:
- Timestamp
- Original request
- Parsed intent
- Policy rules evaluated
- Final decision and reasoning

This enables review and detection of any anomalies.

## Policy Rule Format

The policy.json file defines access rules:

```json
{
  "roles": {
    "Department Name": {
      "allowed_systems": ["Slack", "Jira", "AWS"],
      "max_hardware_budget": 3000
    }
  },
  "sensitive_actions": {
    "aws": [
      { "action": "write_access", "result": "REQUIRES_APPROVAL" },
      { "action": "admin_access", "result": "DENY" }
    ],
    "okta": [
      { "action": "admin", "result": "DENY" }
    ]
  },
  "slack": {
    "auto_approve_channels": ["#general", "#engineering"],
    "restricted_channels": ["#executive", "#security-incidents"]
  }
}
```

### Role Policies

| Field | Description |
|-------|-------------|
| `allowed_systems` | List of systems this department can access. Use `["*"]` for all systems. |
| `max_hardware_budget` | Maximum dollar amount for hardware requests |

### Sensitive Actions

Define per-system rules for sensitive operations:
- `REQUIRES_APPROVAL`: Request is valid but needs manual approval
- `DENY`: Request is always denied

### Slack Policies

- `auto_approve_channels`: Channels that can be joined without approval
- `restricted_channels`: Channels that cannot be joined

## Extensibility

### Adding a New SaaS System

1. **Add to policy.json**: Include the system in relevant department `allowed_systems`

2. **Add payload generator** in `src/executor/payloads.ts`:
   ```typescript
   export function generateNewServicePayload(
     userEmail: string,
     resource: string
   ): PayloadResult<"NEW_SERVICE_ACTION"> {
     return {
       service: "NewService",
       action: "NEW_SERVICE_ACTION",
       payload: { user: userEmail, resource }
     };
   }
   ```

3. **Update types** in `src/types.ts`:
   ```typescript
   export type Service = "AWS" | "Slack" | ... | "NewService";
   export type Action = ... | "NEW_SERVICE_ACTION";
   ```

4. **Add case to payload generator** in `src/executor/payloads.ts`

5. **Add to known systems** in `src/parser/llm-parser.ts`

## Trade-offs Made Due to Time Constraints

1. **LLM vs Regex**: Chose LLM for flexibility in understanding natural language, but this adds API dependency and latency. A production system might use regex for simple patterns and LLM only for ambiguous cases.

2. **Confidence Threshold**: The 0.7 threshold is somewhat arbitrary. A production system would tune this based on real-world false positive/negative rates.

3. **Hardware Pricing**: Uses hardcoded estimates rather than a real product catalog. Production would integrate with procurement systems.

4. **No User Verification**: The system trusts the user email in requests. Production would verify identity through SSO/auth systems.

5. **No Persistence**: Decisions aren't stored in a database. Production would need durable storage for audit trails.

6. **Sequential Processing**: Requests are processed one at a time. Production could parallelize for throughput.

7. **No Retry Logic**: LLM API failures fail the request. Production would implement retries with exponential backoff.

## Output Format

### Approved Request
```json
{
  "request_id": "req_001",
  "status": "APPROVED",
  "service": "Slack",
  "action": "SLACK_CHANNEL_ADD",
  "payload": {
    "user": "alice@opendoor.com",
    "channel": "#fde-team-updates"
  }
}
```

### Denied Request
```json
{
  "request_id": "req_002",
  "status": "DENIED",
  "reason": "Department 'Finance' is not authorized for 'AWS' access"
}
```

### Requires Approval
```json
{
  "request_id": "req_003",
  "status": "REQUIRES_APPROVAL",
  "service": "AWS",
  "action": "AWS_IAM_GRANT",
  "reason": "'write' access to 'AWS' requires manual approval",
  "payload": { ... }
}
```

### Clarification Needed
```json
{
  "request_id": "req_004",
  "status": "CLARIFICATION_NEEDED",
  "clarification_questions": [
    "Which system or tool do you need access to?"
  ]
}
```

## Development

```bash
# Type checking
npm run typecheck

# Run with verbose logging (observability logs go to stderr)
npm start 2>logs.json
```
