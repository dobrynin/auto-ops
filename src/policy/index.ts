import { readFile } from "fs/promises";
import type { Policy, PolicyResult } from "./types.js";
import type { ParsedIntent } from "../parser/types.js";
import {
  evaluateFullPolicy,
  detectPromptInjection,
  estimateHardwareCost,
} from "./rules.js";

export class PolicyEngine {
  private policy: Policy;

  constructor(policy: Policy) {
    this.policy = policy;
  }

  static async fromFile(path: string): Promise<PolicyEngine> {
    const content = await readFile(path, "utf-8");
    const policy = JSON.parse(content) as Policy;
    return new PolicyEngine(policy);
  }

  evaluate(
    intent: ParsedIntent,
    department: string,
    groups: string[],
    currentHardwareSpending: number = 0
  ): PolicyResult {
    return evaluateFullPolicy(intent, department, groups, this.policy, currentHardwareSpending);
  }

  detectInjection(text: string): boolean {
    return detectPromptInjection(text);
  }

  getEstimatedCost(item: string): number {
    return estimateHardwareCost(item);
  }

  getPolicy(): Policy {
    return this.policy;
  }
}

export type { Policy, PolicyResult } from "./types.js";
