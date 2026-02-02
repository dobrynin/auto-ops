export interface RolePolicy {
  allowed_systems: string[];
  max_hardware_budget?: number;
  can_revoke_access?: boolean;
}

export interface SlackRules {
  auto_approve_channels: string[];
  restricted_channels: string[];
}

export interface SystemSpecificRules {
  Slack?: SlackRules;
}

export interface Policy {
  roles: Record<string, RolePolicy>;
  sensitive_actions: Record<string, Record<string, string>>;
  system_specific_rules?: SystemSpecificRules;
}

export type PolicyResult =
  | { allowed: true; requires_approval?: false }
  | { allowed: true; requires_approval: true; reason: string }
  | { allowed: false; reason: string };
