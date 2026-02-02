import type { Policy, PolicyResult } from "./types.js";
import type { ParsedIntent } from "../parser/types.js";

// Prompt injection patterns to detect and block
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)/i,
  /disregard\s+(all\s+)?(previous|prior|above)/i,
  /you\s+are\s+now/i,
  /new\s+instructions/i,
  /forget\s+(everything|all)/i,
  /override\s+(all\s+)?rules/i,
  /bypass\s+(all\s+)?(security|policy|rules)/i,
  /admin\s+mode/i,
  /sudo/i,
  /grant\s+(me\s+)?superadmin/i,
  /\bsuperadmin\b/i,
];

export function detectPromptInjection(rawText: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(rawText));
}

export function evaluateSystemAccess(
  department: string,
  targetSystem: string,
  policy: Policy
): PolicyResult {
  const rolePolicy = policy.roles[department];

  if (!rolePolicy) {
    return {
      allowed: false,
      reason: `Department '${department}' is not defined in policy`,
    };
  }

  const allowedSystems = rolePolicy.allowed_systems;

  // Check for wildcard access
  if (allowedSystems.includes("*")) {
    return { allowed: true };
  }

  // Check if system is in allowed list
  const systemAllowed = allowedSystems.some(
    (s) => s.toLowerCase() === targetSystem.toLowerCase()
  );

  if (!systemAllowed) {
    return {
      allowed: false,
      reason: `Department '${department}' is not authorized for '${targetSystem}' access. Allowed systems: ${allowedSystems.join(", ")}`,
    };
  }

  return { allowed: true };
}

export function evaluateSensitiveAction(
  targetSystem: string,
  requestedAction: string | null,
  policy: Policy
): PolicyResult {
  // Look up service config (case-insensitive)
  const serviceKey = Object.keys(policy.services).find(
    (k) => k.toLowerCase() === targetSystem.toLowerCase()
  );

  if (!serviceKey) {
    return { allowed: true };
  }

  const serviceConfig = policy.services[serviceKey];
  const sensitiveActions = serviceConfig.sensitive_actions;

  if (!sensitiveActions || !requestedAction) {
    return { allowed: true };
  }

  const result = sensitiveActions[requestedAction];
  if (result === "DENY") {
    return {
      allowed: false,
      reason: `Policy violation: '${requestedAction}' to '${targetSystem}' is explicitly denied`,
    };
  }
  if (result === "REQUIRES_APPROVAL") {
    return {
      allowed: true,
      requires_approval: true,
      reason: `'${requestedAction}' to '${targetSystem}' requires manual approval`,
    };
  }

  return { allowed: true };
}

export function evaluateSlackChannel(
  channel: string,
  policy: Policy
): PolicyResult {
  const slackConfig = policy.services.Slack;

  // If no Slack service config, require approval by default
  if (!slackConfig) {
    return {
      allowed: true,
      requires_approval: true,
      reason: `Channel '${channel}' requires manual approval (no Slack config defined)`,
    };
  }

  const autoApproveChannels = slackConfig.auto_approve_channels || [];
  const restrictedChannels = slackConfig.restricted_channels || [];

  // Check if channel is restricted
  if (restrictedChannels.includes(channel)) {
    return {
      allowed: false,
      reason: `Channel '${channel}' is restricted and cannot be joined`,
    };
  }

  // Check if channel is auto-approved
  if (autoApproveChannels.includes(channel)) {
    return { allowed: true };
  }

  // Channel not in auto-approve list - requires approval
  return {
    allowed: true,
    requires_approval: true,
    reason: `Channel '${channel}' is not in auto-approve list and requires manual approval`,
  };
}

export function evaluateHardwareBudget(
  department: string,
  estimatedCost: number,
  policy: Policy
): PolicyResult {
  const rolePolicy = policy.roles[department];

  if (!rolePolicy) {
    return {
      allowed: false,
      reason: `Department '${department}' is not defined in policy`,
    };
  }

  // If no budget defined, deny hardware requests
  if (rolePolicy.max_hardware_budget === undefined) {
    return {
      allowed: false,
      reason: `Department '${department}' does not have a hardware budget defined`,
    };
  }

  if (estimatedCost > rolePolicy.max_hardware_budget) {
    return {
      allowed: false,
      reason: `Hardware cost ($${estimatedCost}) exceeds budget limit ($${rolePolicy.max_hardware_budget}) for '${department}' department`,
    };
  }

  return { allowed: true };
}

// Estimate hardware cost based on item description
export function estimateHardwareCost(item: string): number {
  const itemLower = item.toLowerCase();

  // MacBook pricing estimates
  if (itemLower.includes("macbook")) {
    if (itemLower.includes("m3 max") || itemLower.includes("m4 max")) {
      return 3500;
    }
    if (itemLower.includes("m3 pro") || itemLower.includes("m4 pro")) {
      return 2500;
    }
    if (itemLower.includes("air")) {
      return 1200;
    }
    return 2000; // Default MacBook Pro
  }

  // Monitor estimates
  if (itemLower.includes("monitor") || itemLower.includes("display")) {
    if (itemLower.includes("4k") || itemLower.includes("ultrawide")) {
      return 800;
    }
    return 400;
  }

  // Keyboard/mouse
  if (itemLower.includes("keyboard") || itemLower.includes("mouse")) {
    return 150;
  }

  // Default for unknown items
  return 500;
}

export function evaluateFullPolicy(
  intent: ParsedIntent,
  department: string,
  rawText: string,
  policy: Policy
): PolicyResult {
  // First check for prompt injection
  if (detectPromptInjection(rawText)) {
    return {
      allowed: false,
      reason: "Request rejected: Potential prompt injection detected",
    };
  }

  // Handle unknown action type
  if (intent.action_type === "UNKNOWN") {
    return {
      allowed: false,
      reason: "Unable to determine request intent - please clarify your request",
    };
  }

  // Handle revoke access (Security team only based on policy)
  if (intent.action_type === "REVOKE_ACCESS") {
    const rolePolicy = policy.roles[department];
    if (!rolePolicy || !rolePolicy.allowed_systems.includes("*")) {
      return {
        allowed: false,
        reason: `Department '${department}' is not authorized to revoke access`,
      };
    }
    return { allowed: true };
  }

  // Handle hardware requests
  if (intent.action_type === "HARDWARE_REQUEST") {
    const estimatedCost = estimateHardwareCost(intent.target_resource || "");
    return evaluateHardwareBudget(department, estimatedCost, policy);
  }

  // Handle access requests
  if (intent.action_type === "ACCESS_REQUEST" && intent.target_system) {
    // Check system access permission
    const systemResult = evaluateSystemAccess(
      department,
      intent.target_system,
      policy
    );
    if (!systemResult.allowed) {
      return systemResult;
    }

    // Check sensitive actions
    const sensitiveResult = evaluateSensitiveAction(
      intent.target_system,
      intent.requested_action,
      policy
    );
    if (!sensitiveResult.allowed) {
      return sensitiveResult;
    }

    // Special handling for Slack channels
    if (
      intent.target_system.toLowerCase() === "slack" &&
      intent.target_resource
    ) {
      const slackResult = evaluateSlackChannel(intent.target_resource, policy);
      if (!slackResult.allowed || slackResult.requires_approval) {
        return slackResult;
      }
    }

    // If sensitive action requires approval, return that
    if (sensitiveResult.requires_approval) {
      return sensitiveResult;
    }

    return { allowed: true };
  }

  // Fallback
  return {
    allowed: false,
    reason: "Unable to process request - missing required information",
  };
}
