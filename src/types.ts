// Shared types for the Auto-Ops Agent

export type Service = "AWS" | "Slack" | "Okta" | "Jira" | "Hardware";

export type Action =
  | "AWS_IAM_GRANT"
  | "SLACK_CHANNEL_ADD"
  | "OKTA_USER_REVOKE"
  | "JIRA_ACCESS_GRANT"
  | "HARDWARE_REQUEST";

export type DecisionStatus =
  | "APPROVED"
  | "DENIED"
  | "CLARIFICATION_NEEDED"
  | "REQUIRES_APPROVAL";

export type PayloadByAction = {
  AWS_IAM_GRANT: {
    user: string;
    role: string;
    resource: string;
  };
  SLACK_CHANNEL_ADD: {
    user: string;
    channel: string;
  };
  OKTA_USER_REVOKE: {
    target_user: string;
  };
  JIRA_ACCESS_GRANT: {
    user: string;
    project: string;
    access: string;
  };
  HARDWARE_REQUEST: {
    user: string;
    item: string;
    estimated_cost: number;
  };
};

interface BaseDecision {
  request_id: string;
  status: DecisionStatus;
}

export interface ApprovedDecision<A extends Action = Action>
  extends BaseDecision {
  status: "APPROVED";
  service: Service;
  action: A;
  payload: PayloadByAction[A];
}

export interface DeniedDecision extends BaseDecision {
  status: "DENIED";
  reason: string;
}

export interface ClarificationNeededDecision extends BaseDecision {
  status: "CLARIFICATION_NEEDED";
  clarification_questions: string[];
}

export interface RequiresApprovalDecision<A extends Action = Action>
  extends BaseDecision {
  status: "REQUIRES_APPROVAL";
  service: Service;
  action: A;
  reason: string;
  payload: PayloadByAction[A];
}

export type Decision =
  | ApprovedDecision
  | DeniedDecision
  | ClarificationNeededDecision
  | RequiresApprovalDecision;

export interface InputRequest {
  id: string;
  user_email: string;
  department: string;
  groups?: string[];
  raw_text: string;
}
