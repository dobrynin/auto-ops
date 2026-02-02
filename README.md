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
