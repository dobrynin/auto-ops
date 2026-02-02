export interface RolePolicy {
  allowed_systems: string[];
  max_hardware_budget?: number;
  can_revoke_access?: boolean;
}

export interface ServiceConfig {
  actions: string[];
  resources: string[];
  sensitive_actions?: Record<string, "REQUIRES_APPROVAL" | "DENY">;
  // Resource restrictions: resource -> action -> allowed groups
  resource_restrictions?: Record<string, Record<string, string[]>>;
  // Slack-specific
  auto_approve_channels?: string[];
  restricted_channels?: string[];
}

export interface Policy {
  services: Record<string, ServiceConfig>;
  roles: Record<string, RolePolicy>;
}

// Internal result type used by individual rule evaluation functions
export type RuleResult =
  | { allowed: true; requires_approval?: false }
  | { allowed: true; requires_approval: true; reason: string }
  | { allowed: false; reason: string };

// Final policy result that includes tracking of which rules were checked
export type PolicyResult =
  | { allowed: true; requires_approval?: false; rules_checked: string[] }
  | { allowed: true; requires_approval: true; reason: string; rules_checked: string[] }
  | { allowed: false; reason: string; rules_checked: string[] };
