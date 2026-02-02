export interface RolePolicy {
  allowed_systems: string[];
  max_hardware_budget?: number;
  can_revoke_access?: boolean;
}

export interface ServiceConfig {
  actions: string[];
  resources: string[];
  sensitive_actions?: Record<string, "REQUIRES_APPROVAL" | "DENY">;
  // Slack-specific
  auto_approve_channels?: string[];
  restricted_channels?: string[];
}

export interface Policy {
  services: Record<string, ServiceConfig>;
  roles: Record<string, RolePolicy>;
}

export type PolicyResult =
  | { allowed: true; requires_approval?: false }
  | { allowed: true; requires_approval: true; reason: string }
  | { allowed: false; reason: string };
