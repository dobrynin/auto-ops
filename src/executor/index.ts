import type { ParsedIntent } from "../parser/types.js";
import type { PolicyResult } from "../policy/types.js";
import type { Decision, InputRequest, SubDecision, MultiDecision } from "../types.js";
import { generatePayload } from "./payloads.js";

const CONFIDENCE_THRESHOLD = 0.7;

export function execute(
  request: InputRequest,
  intent: ParsedIntent,
  policyResult: PolicyResult,
  estimatedCost?: number
): Decision {
  // Low confidence triggers clarification
  if (intent.confidence < CONFIDENCE_THRESHOLD) {
    return {
      request_id: request.id,
      status: "CLARIFICATION_NEEDED",
      clarification_questions: generateClarificationQuestions(intent),
    };
  }

  // Policy denied
  if (!policyResult.allowed) {
    return {
      request_id: request.id,
      status: "DENIED",
      reason: policyResult.reason,
    };
  }

  // Generate payload
  const payloadResult = generatePayload(
    intent,
    request.user_email,
    estimatedCost
  );

  if (!payloadResult) {
    return {
      request_id: request.id,
      status: "CLARIFICATION_NEEDED",
      clarification_questions: [
        "Unable to generate action payload. Please provide more details about what system or resource you need access to.",
      ],
    };
  }

  // Requires approval
  if (policyResult.requires_approval) {
    return {
      request_id: request.id,
      status: "REQUIRES_APPROVAL",
      service: payloadResult.service,
      action: payloadResult.action,
      reason: policyResult.reason,
      approver_group: policyResult.approver_group,
      payload: payloadResult.payload,
    } as Decision;
  }

  // Approved
  return {
    request_id: request.id,
    status: "APPROVED",
    service: payloadResult.service,
    action: payloadResult.action,
    payload: payloadResult.payload,
  } as Decision;
}

function generateClarificationQuestions(intent: ParsedIntent): string[] {
  const questions: string[] = [];

  if (intent.action_type === "UNKNOWN") {
    questions.push(
      "What type of request is this? (e.g., system access, hardware, access revocation)"
    );
  }

  if (!intent.target_system) {
    questions.push(
      "Which system or tool do you need access to? (e.g., Slack, AWS, Jira)"
    );
  }

  if (!intent.target_resource && intent.action_type === "ACCESS_REQUEST") {
    questions.push(
      "What specific resource do you need access to? (e.g., channel name, database, project)"
    );
  }

  if (questions.length === 0) {
    questions.push(
      "Please provide more details about your request so we can process it correctly."
    );
  }

  return questions;
}

function decisionToSubDecision(decision: Decision, index: number): SubDecision {
  const base: SubDecision = {
    sub_request_index: index,
    status: decision.status,
  };

  if (decision.status === "APPROVED") {
    return {
      ...base,
      service: decision.service,
      action: decision.action,
      payload: decision.payload,
    };
  }

  if (decision.status === "DENIED") {
    return {
      ...base,
      reason: decision.reason,
    };
  }

  if (decision.status === "CLARIFICATION_NEEDED") {
    return {
      ...base,
      clarification_questions: decision.clarification_questions,
    };
  }

  if (decision.status === "REQUIRES_APPROVAL") {
    return {
      ...base,
      service: decision.service,
      action: decision.action,
      reason: decision.reason,
      approver_group: decision.approver_group,
      payload: decision.payload,
    };
  }

  return base;
}

export function executeMultiple(
  request: InputRequest,
  intents: ParsedIntent[],
  policyResults: PolicyResult[],
  estimatedCosts: (number | undefined)[]
): MultiDecision {
  const subDecisions = intents.map((intent, index) => {
    const decision = execute(request, intent, policyResults[index], estimatedCosts[index]);
    return decisionToSubDecision(decision, index);
  });

  return {
    request_id: request.id,
    sub_decisions: subDecisions,
    summary: {
      total: subDecisions.length,
      approved: subDecisions.filter((d) => d.status === "APPROVED").length,
      denied: subDecisions.filter((d) => d.status === "DENIED").length,
      requires_approval: subDecisions.filter((d) => d.status === "REQUIRES_APPROVAL").length,
      clarification_needed: subDecisions.filter((d) => d.status === "CLARIFICATION_NEEDED").length,
    },
  };
}
