#!/usr/bin/env node
import "dotenv/config";
import { readFile } from "fs/promises";
import { parseIntents } from "./parser/index.js";
import { PolicyEngine } from "./policy/index.js";
import { executeMultiple } from "./executor/index.js";
import { Logger } from "./observability/logger.js";
import { SessionStore } from "./session/index.js";
import { SpendingTracker } from "./spending/index.js";
import type { InputRequest, MultiDecision } from "./types.js";

interface CliArgs {
  inputPath: string;
  policyPath: string;
  outputPath: string | null;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let inputPath = "./input.json";
  let policyPath = "./policy.json";
  let outputPath: string | null = null;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--input":
      case "-i":
        inputPath = args[++i];
        break;
      case "--policy":
      case "-p":
        policyPath = args[++i];
        break;
      case "--output":
      case "-o":
        outputPath = args[++i];
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
    }
  }

  return { inputPath, policyPath, outputPath };
}

function printUsage(): void {
  console.log(`
Auto-Ops Agent - IT Request Processor

Usage: npx tsx src/index.ts [options]

Options:
  -i, --input <path>   Path to input requests JSON (default: ./input.json)
  -p, --policy <path>  Path to policy JSON (default: ./policy.json)
  -o, --output <path>  Path to write output JSON (default: stdout)
  -h, --help           Show this help message

Environment Variables:
  ANTHROPIC_API_KEY    Required. Your Anthropic API key for LLM parsing.

Example:
  export ANTHROPIC_API_KEY=sk-ant-...
  npx tsx src/index.ts --input ./input.json --policy ./policy.json
`);
}

async function loadRequests(path: string): Promise<InputRequest[]> {
  const content = await readFile(path, "utf-8");
  return JSON.parse(content) as InputRequest[];
}

async function processRequest(
  request: InputRequest,
  policyEngine: PolicyEngine,
  logger: Logger,
  sessionStore: SessionStore,
  spendingTracker: SpendingTracker
): Promise<MultiDecision> {
  const groups = request.groups || [];

  // Use user email as session key for conversation continuity
  const sessionId = request.user_email;

  console.error(`\n--- Processing ${request.id} (session: ${sessionId}) ---`);
  console.error(`User: ${request.user_email} (${request.department}${groups.length > 0 ? `, groups: ${groups.join(", ")}` : ""})`);
  console.error(`Request: "${request.raw_text}"`);

  // Check for prompt injection before LLM parsing (blocks entire request)
  if (policyEngine.detectInjection(request.raw_text)) {
    console.error("⚠️  Prompt injection detected - skipping LLM parsing");
    return {
      request_id: request.id,
      session_id: sessionId,
      sub_decisions: [
        {
          sub_request_index: 0,
          status: "DENIED",
          reason: "Request rejected: Potential prompt injection detected",
        },
      ],
      summary: {
        total: 1,
        approved: 0,
        denied: 1,
        requires_approval: 0,
        clarification_needed: 0,
      },
    };
  }

  const policy = policyEngine.getPolicy();

  // Get conversation history for context (if session exists)
  const conversationHistory = sessionStore.getConversationHistory(sessionId);
  if (conversationHistory) {
    console.error("Using conversation history for context...");
  }

  // Parse intents using LLM (may return multiple)
  console.error("Parsing intents with LLM...");
  const intents = await parseIntents(request.raw_text, policy, conversationHistory || undefined);
  console.error(`Parsed ${intents.length} intent(s): ${JSON.stringify(intents)}`);

  // Get current hardware spending for budget checks
  const currentSpending = spendingTracker.getSpending(request.user_email);
  if (currentSpending > 0) {
    console.error(`Current hardware spending (90-day): $${currentSpending.toLocaleString()}`);
  }

  // Get estimated costs for hardware requests (needed for both policy eval and spending tracking)
  const estimatedCosts = intents.map((intent) =>
    intent.action_type === "HARDWARE_REQUEST"
      ? policyEngine.getEstimatedCost(intent.target_resource || "")
      : undefined
  );

  // Evaluate each intent against policy
  // Track cumulative spending within this request for accurate budget checks
  let pendingSpending = currentSpending;
  const policyResults = intents.map((intent, index) => {
    const result = policyEngine.evaluate(intent, request.department, groups, pendingSpending);
    // If this hardware request would be approved/pending, add to pending spending for subsequent checks
    if (intent.action_type === "HARDWARE_REQUEST" && result.allowed && estimatedCosts[index]) {
      pendingSpending += estimatedCosts[index]!;
    }
    return result;
  });
  console.error(`Policy results: ${JSON.stringify(policyResults)}`);

  // Execute and generate multi-decision
  const multiDecision = executeMultiple(request, intents, policyResults, estimatedCosts);

  // Record hardware spending for approved/pending requests
  intents.forEach((intent, index) => {
    const subDecision = multiDecision.sub_decisions[index];
    if (
      intent.action_type === "HARDWARE_REQUEST" &&
      estimatedCosts[index] &&
      (subDecision.status === "APPROVED" || subDecision.status === "REQUIRES_APPROVAL")
    ) {
      spendingTracker.recordSpending(
        request.id,
        request.user_email,
        estimatedCosts[index]!,
        subDecision.status as "APPROVED" | "REQUIRES_APPROVAL"
      );
      console.error(`Recorded $${estimatedCosts[index]} hardware spending for ${request.user_email}`);
    }
  });

  // Add session_id to the decision
  multiDecision.session_id = sessionId;

  // Log each intent/decision pair for observability
  intents.forEach((intent, index) => {
    logger.logSubDecision(request, intent, policyResults[index], multiDecision.sub_decisions[index], index);
  });

  // Store in session for future context
  sessionStore.addTurn(sessionId, request, intents, multiDecision);

  return multiDecision;
}

async function main(): Promise<void> {
  const args = parseArgs();

  // Check for API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Error: ANTHROPIC_API_KEY environment variable is required.");
    console.error("Set it with: export ANTHROPIC_API_KEY=your-key");
    process.exit(1);
  }

  console.error("=== Auto-Ops Agent Starting ===");
  console.error(`Input: ${args.inputPath}`);
  console.error(`Policy: ${args.policyPath}`);

  // Load policy and requests
  const policyEngine = await PolicyEngine.fromFile(args.policyPath);
  const requests = await loadRequests(args.inputPath);
  const logger = new Logger();
  const sessionStore = new SessionStore();
  const spendingTracker = new SpendingTracker();

  console.error(`Loaded ${requests.length} requests`);

  // Process each request
  const decisions: MultiDecision[] = [];

  for (const request of requests) {
    try {
      const decision = await processRequest(request, policyEngine, logger, sessionStore, spendingTracker);
      decisions.push(decision);
    } catch (error) {
      console.error(`Error processing ${request.id}:`, error);
      decisions.push({
        request_id: request.id,
        sub_decisions: [
          {
            sub_request_index: 0,
            status: "DENIED",
            reason: `Processing error: ${error instanceof Error ? error.message : "Unknown error"}`,
          },
        ],
        summary: {
          total: 1,
          approved: 0,
          denied: 1,
          requires_approval: 0,
          clarification_needed: 0,
        },
      });
    }
  }

  // Output results
  const output = JSON.stringify(decisions, null, 2);

  if (args.outputPath) {
    const { writeFile } = await import("fs/promises");
    await writeFile(args.outputPath, output);
    console.error(`\nOutput written to ${args.outputPath}`);
  } else {
    console.log(output);
  }

  console.error("\n=== Processing Complete ===");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
