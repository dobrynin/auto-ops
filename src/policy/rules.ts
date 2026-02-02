import type { Policy, PolicyResult, RuleResult } from "./types.js";
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
): RuleResult {
  const rolePolicy = policy.roles[department];

  if (!rolePolicy) {
    return {
      allowed: false,
      reason: `Access denied: You are not authorized for '${targetSystem}'`,
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
      reason: `Access denied: You are not authorized for '${targetSystem}'`,
    };
  }

  return { allowed: true };
}

export function evaluateSensitiveAction(
  targetSystem: string,
  requestedAction: string | null,
  policy: Policy
): RuleResult {
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

  const actionConfig = sensitiveActions[requestedAction];
  if (!actionConfig) {
    return { allowed: true };
  }

  // Extract policy and approver_group from config
  let actionPolicy: string;
  let approverGroup: string | undefined;

  if (typeof actionConfig === "string") {
    actionPolicy = actionConfig;
    approverGroup = serviceConfig.default_approver;
  } else {
    actionPolicy = actionConfig.policy;
    approverGroup = actionConfig.approver_group ?? serviceConfig.default_approver;
  }

  if (actionPolicy === "DENY") {
    return {
      allowed: false,
      reason: `Policy violation: '${requestedAction}' to '${targetSystem}' is explicitly denied`,
    };
  }
  if (actionPolicy === "REQUIRES_APPROVAL") {
    const approverText = approverGroup ? ` from ${approverGroup}` : "";
    return {
      allowed: true,
      requires_approval: true,
      reason: `'${requestedAction}' to '${targetSystem}' requires manual approval${approverText}`,
      approver_group: approverGroup,
    };
  }

  return { allowed: true };
}

export function evaluateResourceRestrictions(
  targetSystem: string,
  targetResource: string | null,
  requestedAction: string | null,
  department: string,
  groups: string[],
  policy: Policy
): RuleResult {
  if (!targetResource || !requestedAction) {
    return { allowed: true };
  }

  // Look up service config (case-insensitive)
  const serviceKey = Object.keys(policy.services).find(
    (k) => k.toLowerCase() === targetSystem.toLowerCase()
  );

  if (!serviceKey) {
    return { allowed: true };
  }

  const serviceConfig = policy.services[serviceKey];
  const resourceRestrictions = serviceConfig.resource_restrictions;

  if (!resourceRestrictions) {
    return { allowed: true };
  }

  // Check if this resource has restrictions
  const resourceRules = resourceRestrictions[targetResource];
  if (!resourceRules) {
    return { allowed: true };
  }

  // Check if this action has allowed groups defined
  const allowedGroups = resourceRules[requestedAction];
  if (!allowedGroups) {
    return { allowed: true };
  }

  // Check if user's department or any of their groups is in the allowed list
  const userMemberships = [department, ...groups];
  const hasAccess = allowedGroups.some((group) =>
    userMemberships.includes(group)
  );

  if (!hasAccess) {
    return {
      allowed: false,
      reason: `Access denied: You do not have permission for '${requestedAction}' on '${targetResource}'`,
    };
  }

  return { allowed: true };
}

export function evaluateSlackChannel(
  channel: string,
  policy: Policy
): RuleResult {
  const slackConfig = policy.services.Slack;

  // If no Slack service config, require approval by default
  if (!slackConfig) {
    return {
      allowed: true,
      requires_approval: true,
      reason: `Channel '${channel}' requires manual approval`,
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
  const approverGroup = slackConfig.channel_approver ?? slackConfig.default_approver;
  const approverText = approverGroup ? ` from ${approverGroup}` : "";
  return {
    allowed: true,
    requires_approval: true,
    reason: `Joining channel '${channel}' requires manual approval${approverText}`,
    approver_group: approverGroup,
  };
}

export function evaluateHardwareBudget(
  department: string,
  estimatedCost: number,
  policy: Policy
): RuleResult {
  const rolePolicy = policy.roles[department];

  if (!rolePolicy) {
    return {
      allowed: false,
      reason: `Access denied: Hardware requests are not available for your department`,
    };
  }

  // If no budget defined, deny hardware requests
  if (rolePolicy.max_hardware_budget === undefined) {
    return {
      allowed: false,
      reason: `Access denied: Hardware requests are not available for your department`,
    };
  }

  if (estimatedCost > rolePolicy.max_hardware_budget) {
    return {
      allowed: false,
      reason: `Hardware request denied: The requested item exceeds your department's budget allowance`,
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
  groups: string[],
  rawText: string,
  policy: Policy
): PolicyResult {
  const rulesChecked: string[] = [];

  // First check for prompt injection
  rulesChecked.push("prompt_injection_check");
  if (detectPromptInjection(rawText)) {
    return {
      allowed: false,
      reason: "Request rejected: Potential prompt injection detected",
      rules_checked: rulesChecked,
    };
  }

  // Handle unknown action type
  if (intent.action_type === "UNKNOWN") {
    return {
      allowed: false,
      reason: "Unable to determine request intent - please clarify your request",
      rules_checked: rulesChecked,
    };
  }

  // Handle revoke access (Security team only based on policy)
  if (intent.action_type === "REVOKE_ACCESS") {
    rulesChecked.push("revoke_permission_check");
    const rolePolicy = policy.roles[department];
    if (!rolePolicy || !rolePolicy.allowed_systems.includes("*")) {
      return {
        allowed: false,
        reason: `Access denied: You are not authorized to revoke access`,
        rules_checked: rulesChecked,
      };
    }
    return { allowed: true, rules_checked: rulesChecked };
  }

  // Handle hardware requests
  if (intent.action_type === "HARDWARE_REQUEST") {
    rulesChecked.push("hardware_budget_check");
    const estimatedCost = estimateHardwareCost(intent.target_resource || "");
    const budgetResult = evaluateHardwareBudget(department, estimatedCost, policy);
    return { ...budgetResult, rules_checked: rulesChecked };
  }

  // Handle access requests
  if (intent.action_type === "ACCESS_REQUEST" && intent.target_system) {
    // Check system access permission
    rulesChecked.push("system_access_check");
    const systemResult = evaluateSystemAccess(
      department,
      intent.target_system,
      policy
    );
    if (!systemResult.allowed) {
      return { ...systemResult, rules_checked: rulesChecked };
    }

    // Check sensitive actions
    rulesChecked.push("sensitive_action_check");
    const sensitiveResult = evaluateSensitiveAction(
      intent.target_system,
      intent.requested_action,
      policy
    );
    if (!sensitiveResult.allowed) {
      return { ...sensitiveResult, rules_checked: rulesChecked };
    }

    // Check resource restrictions (group-based access)
    rulesChecked.push("resource_restrictions_check");
    const resourceResult = evaluateResourceRestrictions(
      intent.target_system,
      intent.target_resource,
      intent.requested_action,
      department,
      groups,
      policy
    );
    if (!resourceResult.allowed) {
      return { ...resourceResult, rules_checked: rulesChecked };
    }

    // Special handling for Slack channels
    if (
      intent.target_system.toLowerCase() === "slack" &&
      intent.target_resource
    ) {
      rulesChecked.push("slack_channel_policy_check");
      const slackResult = evaluateSlackChannel(intent.target_resource, policy);
      if (!slackResult.allowed || slackResult.requires_approval) {
        return { ...slackResult, rules_checked: rulesChecked };
      }
    }

    // If sensitive action requires approval, return that
    if (sensitiveResult.requires_approval) {
      return { ...sensitiveResult, rules_checked: rulesChecked };
    }

    return { allowed: true, rules_checked: rulesChecked };
  }

  // Fallback
  return {
    allowed: false,
    reason: "Unable to process request - missing required information",
    rules_checked: rulesChecked,
  };
}
