export interface RolePolicy {
  allowed_systems: string[];
  max_hardware_budget?: number;
  can_revoke_access?: boolean;
}

// Sensitive action can be a simple string or detailed config
export type SensitiveActionConfig =
  | "REQUIRES_APPROVAL"
  | "DENY"
  | { policy: "REQUIRES_APPROVAL" | "DENY"; approver_group?: string };

export interface ServiceConfig {
  actions: string[];
  resources: string[];
  sensitive_actions?: Record<string, SensitiveActionConfig>;
  // Resource restrictions: resource -> action -> allowed groups
  resource_restrictions?: Record<string, Record<string, string[]>>;
  default_approver?: string; // Fallback approver for this service
  // Slack-specific
  auto_approve_channels?: string[];
  restricted_channels?: string[];
  channel_approver?: string; // Who approves non-auto-approved channels
}

export interface Policy {
  services: Record<string, ServiceConfig>;
  roles: Record<string, RolePolicy>;
}

// Internal result type used by individual rule evaluation functions
export type RuleResult =
  | { allowed: true; requires_approval?: false }
  | { allowed: true; requires_approval: true; reason: string; approver_group?: string }
  | { allowed: false; reason: string };

// Final policy result that includes tracking of which rules were checked
export type PolicyResult =
  | { allowed: true; requires_approval?: false; rules_checked: string[] }
  | { allowed: true; requires_approval: true; reason: string; approver_group?: string; rules_checked: string[] }
  | { allowed: false; reason: string; rules_checked: string[] };
