import { describe, it, expect } from "vitest";
import { execute, executeMultiple } from "../executor/index.js";
import type { ParsedIntent } from "../parser/types.js";
import type { PolicyResult } from "../policy/types.js";
import type { InputRequest } from "../types.js";

describe("Executor", () => {
  const baseRequest: InputRequest = {
    id: "test_001",
    user_email: "test@opendoor.com",
    department: "Engineering",
    groups: [],
    raw_text: "Test request",
  };

  describe("execute", () => {
    describe("Mandatory clarification conditions", () => {
      it("should require clarification for UNKNOWN action type regardless of confidence", () => {
        const intent: ParsedIntent = {
          action_type: "UNKNOWN",
          target_system: null,
          target_resource: null,
          requested_action: null,
          justification: null,
          confidence: 0.95, // High confidence but still needs clarification
        };

        const policyResult: PolicyResult = {
          allowed: false,
          reason: "Unable to determine request intent",
          rules_checked: [],
        };

        const result = execute(baseRequest, intent, policyResult);

        expect(result.status).toBe("CLARIFICATION_NEEDED");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const questions = (result as any).clarification_questions as string[];
        expect(questions).toBeDefined();
        expect(questions.some((q: string) => q.includes("type of request"))).toBe(true);
      });

      it("should require clarification for ACCESS_REQUEST without target_resource", () => {
        const intent: ParsedIntent = {
          action_type: "ACCESS_REQUEST",
          target_system: "AWS",
          target_resource: null, // Missing resource
          requested_action: "read_access",
          justification: null,
          confidence: 0.9,
        };

        const policyResult: PolicyResult = {
          allowed: true,
          rules_checked: ["system_access_check"],
        };

        const result = execute(baseRequest, intent, policyResult);

        expect(result.status).toBe("CLARIFICATION_NEEDED");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const questions = (result as any).clarification_questions as string[];
        expect(questions.some((q: string) => q.includes("specific resource"))).toBe(true);
      });

      it("should require clarification for HARDWARE_REQUEST without target_resource", () => {
        const intent: ParsedIntent = {
          action_type: "HARDWARE_REQUEST",
          target_system: null,
          target_resource: null, // Missing item
          requested_action: null,
          justification: null,
          confidence: 0.9,
        };

        const policyResult: PolicyResult = {
          allowed: true,
          rules_checked: ["hardware_budget_check"],
        };

        const result = execute(baseRequest, intent, policyResult);

        expect(result.status).toBe("CLARIFICATION_NEEDED");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const questions = (result as any).clarification_questions as string[];
        expect(questions.some((q: string) => q.includes("hardware item"))).toBe(true);
      });
    });

    describe("Low confidence clarification", () => {
      it("should require clarification when confidence < 0.7", () => {
        const intent: ParsedIntent = {
          action_type: "ACCESS_REQUEST",
          target_system: "Slack",
          target_resource: "#general",
          requested_action: "join_channel",
          justification: null,
          confidence: 0.5, // Below threshold
        };

        const policyResult: PolicyResult = {
          allowed: true,
          rules_checked: [],
        };

        const result = execute(baseRequest, intent, policyResult);

        expect(result.status).toBe("CLARIFICATION_NEEDED");
      });

      it("should not require clarification when confidence >= 0.7", () => {
        const intent: ParsedIntent = {
          action_type: "ACCESS_REQUEST",
          target_system: "Slack",
          target_resource: "#general",
          requested_action: "join_channel",
          justification: null,
          confidence: 0.7, // At threshold
        };

        const policyResult: PolicyResult = {
          allowed: true,
          rules_checked: [],
        };

        const result = execute(baseRequest, intent, policyResult);

        expect(result.status).toBe("APPROVED");
      });
    });

    describe("Policy denied", () => {
      it("should return DENIED when policy rejects the request", () => {
        const intent: ParsedIntent = {
          action_type: "ACCESS_REQUEST",
          target_system: "AWS",
          target_resource: "prod-db",
          requested_action: "admin_access",
          justification: null,
          confidence: 0.9,
        };

        const policyResult: PolicyResult = {
          allowed: false,
          reason: "Admin access is explicitly denied",
          rules_checked: ["sensitive_action_check"],
        };

        const result = execute(baseRequest, intent, policyResult);

        expect(result.status).toBe("DENIED");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((result as any).reason).toBe("Admin access is explicitly denied");
      });
    });

    describe("Requires approval", () => {
      it("should return REQUIRES_APPROVAL with approver_group", () => {
        const intent: ParsedIntent = {
          action_type: "ACCESS_REQUEST",
          target_system: "Slack",
          target_resource: "#fde-team-updates",
          requested_action: "join_channel",
          justification: null,
          confidence: 0.9,
        };

        const policyResult: PolicyResult = {
          allowed: true,
          requires_approval: true,
          reason: "Channel requires manual approval from IT",
          approver_group: "IT",
          rules_checked: ["slack_channel_policy_check"],
        };

        const result = execute(baseRequest, intent, policyResult);

        expect(result.status).toBe("REQUIRES_APPROVAL");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((result as any).approver_group).toBe("IT");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((result as any).service).toBe("Slack");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((result as any).action).toBe("SLACK_CHANNEL_ADD");
      });
    });

    describe("Approved requests", () => {
      it("should return APPROVED with correct payload for Slack", () => {
        const intent: ParsedIntent = {
          action_type: "ACCESS_REQUEST",
          target_system: "Slack",
          target_resource: "#general",
          requested_action: "join_channel",
          justification: null,
          confidence: 0.9,
        };

        const policyResult: PolicyResult = {
          allowed: true,
          rules_checked: [],
        };

        const result = execute(baseRequest, intent, policyResult);

        expect(result.status).toBe("APPROVED");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((result as any).service).toBe("Slack");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((result as any).action).toBe("SLACK_CHANNEL_ADD");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((result as any).payload).toEqual({
          user: "test@opendoor.com",
          channel: "#general",
        });
      });

      it("should return APPROVED with correct payload for AWS", () => {
        const intent: ParsedIntent = {
          action_type: "ACCESS_REQUEST",
          target_system: "AWS",
          target_resource: "staging-db",
          requested_action: "read_access",
          justification: null,
          confidence: 0.9,
        };

        const policyResult: PolicyResult = {
          allowed: true,
          rules_checked: [],
        };

        const result = execute(baseRequest, intent, policyResult);

        expect(result.status).toBe("APPROVED");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((result as any).service).toBe("AWS");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((result as any).action).toBe("AWS_IAM_GRANT");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((result as any).payload).toEqual({
          user: "test@opendoor.com",
          role: "readonly-role",
          resource: "staging-db",
        });
      });

      it("should return APPROVED with correct payload for revoke access", () => {
        const intent: ParsedIntent = {
          action_type: "REVOKE_ACCESS",
          target_system: "Okta",
          target_resource: null,
          requested_action: "revoke_access",
          target_user: "target@opendoor.com",
          justification: null,
          confidence: 0.9,
        };

        const policyResult: PolicyResult = {
          allowed: true,
          rules_checked: [],
        };

        const result = execute(baseRequest, intent, policyResult);

        expect(result.status).toBe("APPROVED");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((result as any).service).toBe("Okta");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((result as any).action).toBe("OKTA_USER_REVOKE");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((result as any).payload).toEqual({
          target_user: "target@opendoor.com",
        });
      });

      it("should return APPROVED with correct payload for hardware request", () => {
        const intent: ParsedIntent = {
          action_type: "HARDWARE_REQUEST",
          target_system: null,
          target_resource: "MacBook Air",
          requested_action: null,
          justification: null,
          confidence: 0.9,
        };

        const policyResult: PolicyResult = {
          allowed: true,
          rules_checked: [],
        };

        const result = execute(baseRequest, intent, policyResult, 1200);

        expect(result.status).toBe("APPROVED");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((result as any).service).toBe("Hardware");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((result as any).action).toBe("HARDWARE_REQUEST");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((result as any).payload).toEqual({
          user: "test@opendoor.com",
          item: "MacBook Air",
          estimated_cost: 1200,
        });
      });
    });
  });

  describe("executeMultiple", () => {
    it("should handle multiple intents and return correct summary", () => {
      const request: InputRequest = {
        id: "multi_001",
        user_email: "henry@opendoor.com",
        department: "Engineering",
        groups: [],
        raw_text: "Add me to #general and give me Jira access",
      };

      const intents: ParsedIntent[] = [
        {
          action_type: "ACCESS_REQUEST",
          target_system: "Slack",
          target_resource: "#general",
          requested_action: "join_channel",
          justification: null,
          confidence: 0.9,
        },
        {
          action_type: "ACCESS_REQUEST",
          target_system: "Jira",
          target_resource: "ENGINEERING",
          requested_action: "read_access",
          justification: null,
          confidence: 0.9,
        },
      ];

      const policyResults: PolicyResult[] = [
        { allowed: true, rules_checked: [] },
        { allowed: true, rules_checked: [] },
      ];

      const result = executeMultiple(request, intents, policyResults, [undefined, undefined]);

      expect(result.request_id).toBe("multi_001");
      expect(result.sub_decisions).toHaveLength(2);
      expect(result.sub_decisions[0].status).toBe("APPROVED");
      expect(result.sub_decisions[0].sub_request_index).toBe(0);
      expect(result.sub_decisions[1].status).toBe("APPROVED");
      expect(result.sub_decisions[1].sub_request_index).toBe(1);
      expect(result.summary).toEqual({
        total: 2,
        approved: 2,
        denied: 0,
        requires_approval: 0,
        clarification_needed: 0,
      });
    });

    it("should handle mixed outcomes correctly", () => {
      const request: InputRequest = {
        id: "mixed_001",
        user_email: "test@opendoor.com",
        department: "Engineering",
        groups: [],
        raw_text: "Multiple requests",
      };

      const intents: ParsedIntent[] = [
        {
          action_type: "ACCESS_REQUEST",
          target_system: "Slack",
          target_resource: "#general",
          requested_action: "join_channel",
          justification: null,
          confidence: 0.9,
        },
        {
          action_type: "ACCESS_REQUEST",
          target_system: "AWS",
          target_resource: "prod-db",
          requested_action: "admin_access",
          justification: null,
          confidence: 0.9,
        },
        {
          action_type: "ACCESS_REQUEST",
          target_system: "Slack",
          target_resource: "#fde-team-updates",
          requested_action: "join_channel",
          justification: null,
          confidence: 0.9,
        },
      ];

      const policyResults: PolicyResult[] = [
        { allowed: true, rules_checked: [] },
        { allowed: false, reason: "Admin access denied", rules_checked: [] },
        {
          allowed: true,
          requires_approval: true,
          reason: "Needs approval",
          approver_group: "IT",
          rules_checked: [],
        },
      ];

      const result = executeMultiple(request, intents, policyResults, [
        undefined,
        undefined,
        undefined,
      ]);

      expect(result.summary).toEqual({
        total: 3,
        approved: 1,
        denied: 1,
        requires_approval: 1,
        clarification_needed: 0,
      });
    });
  });
});
