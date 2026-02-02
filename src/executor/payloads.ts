import type { ParsedIntent } from "../parser/types.js";
import type { Action, Service, PayloadByAction } from "../types.js";

type PayloadResult<A extends Action> = {
  service: Service;
  action: A;
  payload: PayloadByAction[A];
};

export function generateSlackPayload(
  userEmail: string,
  channel: string
): PayloadResult<"SLACK_CHANNEL_ADD"> {
  return {
    service: "Slack",
    action: "SLACK_CHANNEL_ADD",
    payload: {
      user: userEmail,
      channel: channel.startsWith("#") ? channel : `#${channel}`,
    },
  };
}

export function generateAwsPayload(
  userEmail: string,
  resource: string,
  accessLevel: string | null
): PayloadResult<"AWS_IAM_GRANT"> {
  const roleMap: Record<string, string> = {
    read: "readonly-role",
    write: "readwrite-role",
    admin: "admin-role",
  };

  return {
    service: "AWS",
    action: "AWS_IAM_GRANT",
    payload: {
      user: userEmail,
      role: roleMap[accessLevel || "read"] || "readonly-role",
      resource: resource || "default",
    },
  };
}

export function generateJiraPayload(
  userEmail: string,
  project: string,
  accessLevel: string | null
): PayloadResult<"JIRA_ACCESS_GRANT"> {
  return {
    service: "Jira",
    action: "JIRA_ACCESS_GRANT",
    payload: {
      user: userEmail,
      project: project || "default",
      access: accessLevel || "read",
    },
  };
}

export function generateOktaRevokePayload(
  targetUser: string
): PayloadResult<"OKTA_USER_REVOKE"> {
  return {
    service: "Okta",
    action: "OKTA_USER_REVOKE",
    payload: {
      target_user: targetUser,
    },
  };
}

export function generateHardwarePayload(
  userEmail: string,
  item: string,
  estimatedCost: number
): PayloadResult<"HARDWARE_REQUEST"> {
  return {
    service: "Hardware",
    action: "HARDWARE_REQUEST",
    payload: {
      user: userEmail,
      item,
      estimated_cost: estimatedCost,
    },
  };
}

export function generatePayload(
  intent: ParsedIntent,
  userEmail: string,
  estimatedCost?: number
): PayloadResult<Action> | null {
  const system = intent.target_system?.toLowerCase();

  switch (intent.action_type) {
    case "ACCESS_REQUEST":
      switch (system) {
        case "slack":
          return generateSlackPayload(
            userEmail,
            intent.target_resource || "general"
          );
        case "aws":
          return generateAwsPayload(
            userEmail,
            intent.target_resource || "default",
            intent.access_level
          );
        case "jira":
          return generateJiraPayload(
            userEmail,
            intent.target_resource || "default",
            intent.access_level
          );
        default:
          return null;
      }

    case "REVOKE_ACCESS":
      if (intent.target_user) {
        return generateOktaRevokePayload(intent.target_user);
      }
      return null;

    case "HARDWARE_REQUEST":
      return generateHardwarePayload(
        userEmail,
        intent.target_resource || "Unknown item",
        estimatedCost || 0
      );

    default:
      return null;
  }
}
