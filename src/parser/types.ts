export type ActionType =
  | "ACCESS_REQUEST"
  | "HARDWARE_REQUEST"
  | "REVOKE_ACCESS"
  | "UNKNOWN";

export interface ParsedIntent {
  action_type: ActionType;
  target_system: string | null;
  target_resource: string | null;
  requested_action: string | null;
  target_user?: string;
  justification: string | null;
  confidence: number;
}

export interface ParsedIntentArray {
  intents: ParsedIntent[];
}
