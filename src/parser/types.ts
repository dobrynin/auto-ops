export type ActionType =
  | "ACCESS_REQUEST"
  | "HARDWARE_REQUEST"
  | "REVOKE_ACCESS"
  | "UNKNOWN";

export type AccessLevel = "read" | "write" | "admin" | null;

export interface ParsedIntent {
  action_type: ActionType;
  target_system: string | null;
  target_resource: string | null;
  access_level: AccessLevel;
  target_user?: string;
  justification: string | null;
  confidence: number;
}
