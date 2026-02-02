#!/usr/bin/env node
import "dotenv/config";
import { readFile } from "fs/promises";
import { parseIntent } from "./parser/index.js";
import { PolicyEngine } from "./policy/index.js";
import { execute } from "./executor/index.js";
import { Logger } from "./observability/logger.js";
import type { InputRequest, Decision } from "./types.js";

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
  logger: Logger
): Promise<Decision> {
  console.error(`\n--- Processing ${request.id} ---`);
  console.error(`User: ${request.user_email} (${request.department})`);
  console.error(`Request: "${request.raw_text}"`);

  // Check for prompt injection before LLM parsing
  if (policyEngine.detectInjection(request.raw_text)) {
    console.error("⚠️  Prompt injection detected - skipping LLM parsing");
    const decision: Decision = {
      request_id: request.id,
      status: "DENIED",
      reason: "Request rejected: Potential prompt injection detected",
    };
    return decision;
  }

  const policy = policyEngine.getPolicy();

  // Parse intent using LLM
  console.error("Parsing intent with LLM...");
  const intent = await parseIntent(request.raw_text, policy);
  console.error(`Parsed: ${JSON.stringify(intent)}`);

  // Evaluate against policy
  const policyResult = policyEngine.evaluate(
    intent,
    request.department,
    request.raw_text
  );
  console.error(`Policy result: ${JSON.stringify(policyResult)}`);

  // Get estimated cost for hardware requests
  const estimatedCost =
    intent.action_type === "HARDWARE_REQUEST"
      ? policyEngine.getEstimatedCost(intent.target_resource || "")
      : undefined;

  // Execute and generate decision
  const decision = execute(request, intent, policyResult, estimatedCost);

  // Log for observability
  logger.log(request, intent, policyResult, decision);

  return decision;
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

  console.error(`Loaded ${requests.length} requests`);

  // Process each request
  const decisions: Decision[] = [];

  for (const request of requests) {
    try {
      const decision = await processRequest(request, policyEngine, logger);
      decisions.push(decision);
    } catch (error) {
      console.error(`Error processing ${request.id}:`, error);
      decisions.push({
        request_id: request.id,
        status: "DENIED",
        reason: `Processing error: ${error instanceof Error ? error.message : "Unknown error"}`,
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
