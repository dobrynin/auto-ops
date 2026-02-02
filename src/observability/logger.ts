import type { ParsedIntent } from "../parser/types.js";
import type { PolicyResult } from "../policy/types.js";
import type { Decision, InputRequest } from "../types.js";

export interface DecisionLog {
  timestamp: string;
  request_id: string;
  user_email: string;
  user_department: string;
  parsed_intent: ParsedIntent;
  policy_evaluation: {
    rules_checked: string[];
    result: "PASS" | "FAIL" | "NEEDS_APPROVAL" | "CLARIFICATION";
  };
  final_decision: Decision;
  reasoning: string;
}

export class Logger {
  private logs: DecisionLog[] = [];

  log(
    request: InputRequest,
    intent: ParsedIntent,
    policyResult: PolicyResult,
    decision: Decision
  ): void {
    const log = this.createLog(request, intent, policyResult, decision);
    this.logs.push(log);

    // Print to stderr for observability
    console.error(JSON.stringify(log, null, 2));
  }

  private createLog(
    request: InputRequest,
    intent: ParsedIntent,
    policyResult: PolicyResult,
    decision: Decision
  ): DecisionLog {
    const rulesChecked = this.determineRulesChecked(intent);
    const evalResult = this.determinePolicyResult(policyResult, decision);
    const reasoning = this.generateReasoning(intent, policyResult, decision);

    return {
      timestamp: new Date().toISOString(),
      request_id: request.id,
      user_email: request.user_email,
      user_department: request.department,
      parsed_intent: intent,
      policy_evaluation: {
        rules_checked: rulesChecked,
        result: evalResult,
      },
      final_decision: decision,
      reasoning,
    };
  }

  private determineRulesChecked(intent: ParsedIntent): string[] {
    const rules: string[] = ["prompt_injection_check"];

    if (intent.action_type === "ACCESS_REQUEST") {
      rules.push("system_access_check");
      if (intent.requested_action) {
        rules.push("sensitive_action_check");
      }
      if (intent.target_system?.toLowerCase() === "slack") {
        rules.push("slack_channel_policy_check");
      }
    }

    if (intent.action_type === "HARDWARE_REQUEST") {
      rules.push("hardware_budget_check");
    }

    if (intent.action_type === "REVOKE_ACCESS") {
      rules.push("revoke_permission_check");
    }

    rules.push("confidence_threshold_check");

    return rules;
  }

  private determinePolicyResult(
    policyResult: PolicyResult,
    decision: Decision
  ): "PASS" | "FAIL" | "NEEDS_APPROVAL" | "CLARIFICATION" {
    if (decision.status === "CLARIFICATION_NEEDED") {
      return "CLARIFICATION";
    }
    if (!policyResult.allowed) {
      return "FAIL";
    }
    if (policyResult.requires_approval) {
      return "NEEDS_APPROVAL";
    }
    return "PASS";
  }

  private generateReasoning(
    intent: ParsedIntent,
    policyResult: PolicyResult,
    decision: Decision
  ): string {
    const parts: string[] = [];

    parts.push(`Intent parsed as ${intent.action_type} with ${(intent.confidence * 100).toFixed(0)}% confidence.`);

    if (intent.target_system) {
      parts.push(`Target system: ${intent.target_system}.`);
    }

    if (intent.target_resource) {
      parts.push(`Target resource: ${intent.target_resource}.`);
    }

    if (!policyResult.allowed) {
      parts.push(`Policy check failed: ${policyResult.reason}`);
    } else if (policyResult.requires_approval) {
      parts.push(`Policy check passed but requires approval: ${policyResult.reason}`);
    } else {
      parts.push("All policy checks passed.");
    }

    parts.push(`Final decision: ${decision.status}.`);

    return parts.join(" ");
  }

  getLogs(): DecisionLog[] {
    return [...this.logs];
  }
}
