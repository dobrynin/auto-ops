import type { ParsedIntent } from "../parser/types.js";
import type { PolicyResult } from "../policy/types.js";
import type { Decision, InputRequest, SubDecision } from "../types.js";

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

export interface SubDecisionLog {
  timestamp: string;
  request_id: string;
  sub_request_index: number;
  user_email: string;
  user_department: string;
  parsed_intent: ParsedIntent;
  policy_evaluation: {
    rules_checked: string[];
    result: "PASS" | "FAIL" | "NEEDS_APPROVAL" | "CLARIFICATION";
  };
  sub_decision: SubDecision;
  reasoning: string;
}

export class Logger {
  private logs: DecisionLog[] = [];
  private subDecisionLogs: SubDecisionLog[] = [];

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

  logSubDecision(
    request: InputRequest,
    intent: ParsedIntent,
    policyResult: PolicyResult,
    subDecision: SubDecision,
    index: number
  ): void {
    const log = this.createSubDecisionLog(request, intent, policyResult, subDecision, index);
    this.subDecisionLogs.push(log);

    // Print to stderr for observability
    console.error(JSON.stringify(log, null, 2));
  }

  private createLog(
    request: InputRequest,
    intent: ParsedIntent,
    policyResult: PolicyResult,
    decision: Decision
  ): DecisionLog {
    const evalResult = this.determinePolicyResult(policyResult, decision.status);
    const reasoning = this.generateReasoning(intent, policyResult, decision.status);

    return {
      timestamp: new Date().toISOString(),
      request_id: request.id,
      user_email: request.user_email,
      user_department: request.department,
      parsed_intent: intent,
      policy_evaluation: {
        rules_checked: policyResult.rules_checked,
        result: evalResult,
      },
      final_decision: decision,
      reasoning,
    };
  }

  private createSubDecisionLog(
    request: InputRequest,
    intent: ParsedIntent,
    policyResult: PolicyResult,
    subDecision: SubDecision,
    index: number
  ): SubDecisionLog {
    const evalResult = this.determinePolicyResult(policyResult, subDecision.status);
    const reasoning = this.generateReasoning(intent, policyResult, subDecision.status);

    return {
      timestamp: new Date().toISOString(),
      request_id: request.id,
      sub_request_index: index,
      user_email: request.user_email,
      user_department: request.department,
      parsed_intent: intent,
      policy_evaluation: {
        rules_checked: policyResult.rules_checked,
        result: evalResult,
      },
      sub_decision: subDecision,
      reasoning,
    };
  }

  private determinePolicyResult(
    policyResult: PolicyResult,
    status: string
  ): "PASS" | "FAIL" | "NEEDS_APPROVAL" | "CLARIFICATION" {
    if (status === "CLARIFICATION_NEEDED") {
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
    status: string
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

    parts.push(`Final decision: ${status}.`);

    return parts.join(" ");
  }

  getLogs(): DecisionLog[] {
    return [...this.logs];
  }

  getSubDecisionLogs(): SubDecisionLog[] {
    return [...this.subDecisionLogs];
  }
}
