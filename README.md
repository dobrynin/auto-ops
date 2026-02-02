# Auto-Ops Agent

A CLI application that processes unstructured IT requests and outputs structured actions, enforcing security policies along the way. Supports multi-request messages, conversation context for clarifications, and cumulative budget tracking.

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
                              ┌─────────────────┐
                              │   Blacklist     │
                              │    Check        │
                              └────────┬────────┘
                                       │
                                       ▼
┌─────────────────┐           ┌─────────────────┐
│  Session Store  │──context─▶│  Intent Parser  │
│  (Conversation) │           │   (LLM Layer)   │
└─────────────────┘           └────────┬────────┘
                                       │
                                       ▼
┌─────────────────┐           ┌─────────────────┐
│ Spending Track  │──budget──▶│  Policy Engine  │
│ (90-day window) │           │  (Guardrails)   │
└─────────────────┘           └────────┬────────┘
                                       │
                                       ▼
                              ┌─────────────────┐
                              │    Executor     │
                              │    (Output)     │
                              └─────────────────┘
```

### Components

1. **Blacklist Check**: First gate - checks if user is blacklisted from previous prompt injection attempts. Blacklisted users are immediately denied without further processing.

2. **Intent Parser**: Uses Claude to extract structured intents from natural language. Supports multiple intents per message (e.g., "Add me to Slack and give me AWS access" → 2 intents). Uses Session Store for conversation context.

3. **Policy Engine**: Validates each intent against configurable security policies including department access, sensitive actions, budget limits, and group-based restrictions. Uses Spending Tracker for cumulative budget checks.

4. **Executor**: Generates service-specific JSON payloads for approved requests, returning a `MultiDecision` with individual sub-decisions and summary statistics.

5. **Session Store**: Maintains conversation history per user (keyed by email) with 15-minute TTL. Enables follow-up clarifications without restating context.

6. **Spending Tracker**: Tracks cumulative hardware spending per user over a 90-day rolling window. Prevents budget circumvention through multiple small requests.

7. **Blacklist Store**: Tracks prompt injection attempts. First offense triggers a warning; repeat offenses result in 24-hour blacklist.

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
- **Systems**: Unknown systems are flagged with reduced confidence (max 0.5), triggering clarification instead of approval.
- **Actions**: Invalid actions for a service are flagged with reduced confidence.

#### 3. Prompt Injection Detection & Blacklisting

Before any LLM processing, raw request text is scanned for injection patterns:
- "ignore previous instructions"
- "you are now"
- "bypass security"
- "grant superadmin"
- And other common injection patterns

Requests containing these patterns are **immediately denied** without LLM processing.

**Repeat offenders are blacklisted:**
- First offense: Warning logged, request denied
- Second offense: User blacklisted for 24 hours
- While blacklisted: All requests denied with generic message

#### 4. Confidence Thresholds

If the LLM's confidence score is below 0.7 (70%), the request triggers a `CLARIFICATION_NEEDED` response instead of any action. Unknown systems automatically have confidence capped at 0.5.

#### 5. Policy Engine as Final Arbiter

Every intent must pass policy checks:
- Department-based system access (e.g., Finance cannot access AWS)
- Group-based resource restrictions (e.g., only SRE can write to prod-db)
- Sensitive action rules (e.g., admin access is denied or requires approval)
- Cumulative hardware budget limits per user (90-day rolling window)
- Slack channel restrictions
- Revoke access permissions (only departments with `can_revoke_access: true`)

#### 6. Cumulative Budget Tracking

Hardware spending is tracked per user over a 90-day rolling window. This prevents users from circumventing budget limits by making multiple small requests. Both `APPROVED` and `REQUIRES_APPROVAL` requests count against the budget.

#### 7. Complete Audit Trail

Every decision is logged with:
- Timestamp
- Original request
- Parsed intent(s)
- Policy rules evaluated
- Final decision and reasoning
- Session ID for conversation tracking

## Policy Rule Format

The policy.json file defines access rules:

```json
{
  "services": {
    "AWS": {
      "actions": ["read_access", "write_access", "admin_access"],
      "resources": ["staging-db", "prod-db", "logs"],
      "sensitive_actions": {
        "write_access": "REQUIRES_APPROVAL",
        "admin_access": "DENY"
      },
      "resource_restrictions": {
        "prod-db": {
          "write_access": ["SRE", "Engineering"]
        }
      },
      "default_approver": "cloud-team"
    },
    "Slack": {
      "actions": ["join_channel", "leave_channel"],
      "resources": [],
      "auto_approve_channels": ["#general", "#engineering"],
      "restricted_channels": ["#executive", "#security-incidents"],
      "channel_approver": "slack-admins"
    }
  },
  "roles": {
    "Engineering": {
      "allowed_systems": ["Slack", "Jira", "AWS"],
      "max_hardware_budget": 3000
    },
    "Security": {
      "allowed_systems": ["*"],
      "can_revoke_access": true,
      "max_hardware_budget": 5000
    },
    "Interns": {
      "allowed_systems": ["Slack", "Jira"],
      "max_hardware_budget": 1500
    }
  }
}
```

### Role Policies

| Field | Description |
|-------|-------------|
| `allowed_systems` | List of systems this department can access. Use `["*"]` for all systems. |
| `max_hardware_budget` | Maximum cumulative spending over 90-day rolling window |
| `can_revoke_access` | Whether this department can revoke other users' access (default: false) |

### Service Configuration

| Field | Description |
|-------|-------------|
| `actions` | Valid actions for this service |
| `resources` | Known resources (empty = user-specified) |
| `sensitive_actions` | Actions requiring approval or denied outright |
| `resource_restrictions` | Group-based access control per resource/action |
| `default_approver` | Who approves requests for this service |

### Sensitive Actions

Define per-system rules for sensitive operations:
- `REQUIRES_APPROVAL`: Request is valid but needs manual approval
- `DENY`: Request is always denied
- Can also specify `approver_group` for specific actions

### Slack Policies

- `auto_approve_channels`: Channels that can be joined without approval
- `restricted_channels`: Channels that cannot be joined
- `channel_approver`: Who approves non-auto-approved channels

## Output Format

The system returns a `MultiDecision` for each request, containing individual sub-decisions for each intent:

### Multi-Request Response
```json
{
  "request_id": "req_009",
  "session_id": "alice@company.com",
  "sub_decisions": [
    {
      "sub_request_index": 0,
      "status": "APPROVED",
      "service": "Slack",
      "action": "SLACK_CHANNEL_ADD",
      "payload": { "user": "alice@company.com", "channel": "#general" }
    },
    {
      "sub_request_index": 1,
      "status": "APPROVED",
      "service": "AWS",
      "action": "AWS_IAM_GRANT",
      "payload": { "user": "alice@company.com", "role": "readonly-role", "resource": "staging-db" }
    }
  ],
  "summary": {
    "total": 2,
    "approved": 2,
    "denied": 0,
    "requires_approval": 0,
    "clarification_needed": 0
  }
}
```

### Decision Statuses

| Status | Description |
|--------|-------------|
| `APPROVED` | Request approved, includes service/action/payload |
| `DENIED` | Request denied, includes reason |
| `REQUIRES_APPROVAL` | Valid request pending manual approval, includes approver_group |
| `CLARIFICATION_NEEDED` | Ambiguous request, includes clarification questions |

## Trade-offs Made

1. **LLM vs Regex**: Chose LLM for flexibility in understanding natural language and multi-request parsing, but this adds API dependency and latency. A production system might use regex for simple patterns and LLM only for ambiguous cases.

2. **Confidence Threshold**: The 0.7 threshold is somewhat arbitrary. A production system would tune this based on real-world false positive/negative rates.

3. **Hardware Pricing**: Uses hardcoded estimates rather than a real product catalog. Production would integrate with procurement systems.

4. **No User Verification**: The system trusts the user email, department, and groups in requests. Production would verify identity through SSO/auth systems (see Security TODOs).

5. **In-Memory State**: Sessions, spending records, and blacklist are stored in-memory. Production would need durable storage for audit trails and persistence across restarts.

6. **Sequential Processing**: Requests are processed one at a time. Production could parallelize for throughput (with careful handling of spending accumulation).

7. **No Retry Logic**: LLM API failures fail the request. Production would implement retries with exponential backoff.

8. **Regex-Based Injection Detection**: Prompt injection detection uses simple regex patterns that can be bypassed. Production would use semantic analysis or a separate LLM call to detect manipulation attempts.

9. **Session Key by Email**: Using email as session key means conversation context is shared across all of a user's concurrent requests. Production might want per-conversation session IDs for Slack thread isolation.

10. **Blacklist Without Appeal**: Blacklisted users have no self-service way to appeal. Production would need an admin interface or automatic escalation.

## Security TODOs

The following potential security issues were identified by an automated security review agent. These should be addressed before production deployment.

### High Severity

- [ ] **User Identity Verification** (`src/index.ts:81-83`)
  - `user_email`, `department`, and `groups` are trusted from user input without verification
  - Attacker could spoof another user's email to access their session history
  - Attacker could claim any department (e.g., "Security") to bypass access controls
  - Attacker could claim group membership (e.g., "SRE") to access restricted resources
  - **Fix:** Verify all identity fields against authoritative source (LDAP, Azure AD, AWS IAM)

- [ ] **Weak Prompt Injection Detection** (`src/policy/rules.ts:5-21`)
  - Regex patterns miss obfuscation techniques (homoglyphs, Unicode tricks, synonyms)
  - Patterns are surface-level and can be bypassed by sophisticated attackers
  - **Fix:** Implement semantic injection detection or use separate LLM call to analyze for manipulation

- [ ] **Error Message Information Disclosure** (`src/index.ts:225`)
  - Catch block exposes internal error details to users
  - Could leak implementation details, file paths, or API errors
  - **Fix:** Return generic error messages; log full details internally only

### Medium Severity

- [ ] **Unsafe Channel Name Handling** (`src/executor/payloads.ts:19`)
  - No validation that channel names contain only allowed characters
  - **Fix:** Validate against Slack naming rules (alphanumeric, hyphens, underscores)

- [ ] **Hardware Cost Estimation Manipulation** (`src/policy/rules.ts:250-283`)
  - String-based matching can be manipulated to trigger wrong cost estimates
  - **Fix:** Replace with lookup against actual product catalog/SKUs

- [ ] **In-Memory Spending Tracker** (`src/spending/index.ts`)
  - Records lost on restart; no persistence or integrity checks
  - **Fix:** Store in database with transaction isolation and tamper protection

- [ ] **Session History Information Leakage** (`src/session/index.ts:98-121`)
  - Full request text (potentially containing sensitive data) passed to LLM
  - **Fix:** Redact sensitive information; store intent summaries only

- [ ] **Insufficient LLM Output Validation** (`src/parser/llm-parser.ts:136-178`)
  - No strict schema validation; no length limits on string fields
  - **Fix:** Implement JSON Schema or Zod validation; add field length limits

### Low Severity

- [ ] **Missing Input Sanitization in Payloads** (`src/executor/payloads.ts`)
  - User-supplied resource names directly embedded in payloads
  - **Fix:** Validate resources against policy's allowed resource list

- [ ] **Logging Contains Sensitive Information** (`src/observability/logger.ts:48`)
  - Full user email, requests, and department info logged to stderr
  - **Fix:** Implement log levels; redact sensitive fields in production

- [ ] **No Rate Limiting**
  - System vulnerable to request spam and brute force attacks
  - **Fix:** Implement per-user and per-IP rate limiting

- [ ] **No Audit Trail for Approvals**
  - No tracking of who approved requests or when
  - **Fix:** Implement approval audit trail with approver identity and timestamp

- [ ] **Type Assertions in Executor** (`src/executor/index.ts:59,69`)
  - `as Decision` casts bypass TypeScript type checking
  - **Fix:** Properly construct typed objects without assertions

## Edge Case TODOs

The following potential edge cases were identified by an automated edge-case review agent. These could cause unexpected behavior in production.

### Medium Severity

- [ ] **Missing InputRequest Field Validation** (`src/index.ts`)
  - No runtime validation that `id`, `user_email`, `department` exist in request JSON
  - If fields are missing/undefined, session keys and spending records break
  - **Fix:** Add runtime validation or use Zod schema validation for InputRequest

- [ ] **Blacklist Warnings Never Expire** (`src/blacklist/index.ts`)
  - A user warned 6 months ago gets immediately blacklisted on next injection attempt
  - Stale warnings cause unfair blacklisting
  - **Fix:** Add TTL to warnings (e.g., 30 days) or clear warnings when blacklist expires

- [ ] **Blacklist Expiry Boundary Condition** (`src/blacklist/index.ts:28`)
  - Uses `>` instead of `>=` for expiry check
  - User told "blacklisted until X" may still be blocked at exactly time X
  - **Fix:** Change to `>=` for consistent behavior with displayed expiry time

- [ ] **No Spending Amount Validation** (`src/spending/index.ts:22-35`)
  - `recordSpending` accepts any number including negative or `Infinity`
  - Negative amounts could reduce spending, allowing budget bypass
  - **Fix:** Validate amount > 0 and amount < reasonable maximum

- [ ] **Missing LLM Response Field Validation** (`src/parser/llm-parser.ts:120`)
  - If LLM omits `confidence` field, it becomes `undefined`
  - `Math.min(undefined, 0.5)` returns `NaN`, breaking threshold comparisons
  - **Fix:** Add default values or reject intents missing required fields

- [ ] **Very Long Session Histories** (`src/session/index.ts:98-121`)
  - Sessions with many turns create large conversation history strings
  - Could exceed LLM token limits, causing API errors
  - **Fix:** Limit session history to last N turns or implement token counting

### Low Severity

- [ ] **Floating-Point Budget Arithmetic** (`src/policy/rules.ts:237-245`)
  - Budget math uses JavaScript numbers: `100.10 + 100.20 = 300.30000000000004`
  - Edge cases near budget limits could behave unpredictably
  - **Fix:** Use integer cents or a Decimal library for currency calculations

- [ ] **Empty raw_text Handling** (`src/parser/llm-parser.ts:107`)
  - Empty or whitespace-only `raw_text` is sent directly to LLM
  - Could cause unpredictable LLM responses
  - **Fix:** Validate raw_text is non-empty before LLM parsing

- [ ] **Confidence Threshold Boundary** (`src/executor/index.ts:15`)
  - Confidence exactly at 0.7 passes threshold (`<` not `<=`)
  - Floating-point comparison could cause inconsistent behavior at boundary
  - **Fix:** Document boundary behavior or use epsilon comparison

- [ ] **Special Characters in Payload Fields** (`src/executor/payloads.ts`)
  - Channel names, resource names not validated for special characters
  - Newlines or control characters could break downstream API calls
  - **Fix:** Validate/sanitize payload fields against allowed character patterns

## Development

```bash
# Type checking
npm run typecheck

# Run with verbose logging (observability logs go to stderr)
npm start 2>logs.json
```

## Extensibility

### Adding a New SaaS System

1. **Add to policy.json**: Include the system in relevant department `allowed_systems` and define its configuration in `services`

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
