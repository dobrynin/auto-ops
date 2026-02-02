import type { ParsedIntent } from "../parser/types.js";
import type { MultiDecision, InputRequest } from "../types.js";

export interface ConversationTurn {
  request: InputRequest;
  intents: ParsedIntent[];
  decision: MultiDecision;
  timestamp: number;
}

export interface Session {
  id: string;
  turns: ConversationTurn[];
  created_at: number;
  last_activity: number;
}

const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutes

export class SessionStore {
  private sessions: Map<string, Session> = new Map();
  private ttlMs: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  getSession(sessionId: string): Session | null {
    this.clearExpired();
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }
    return session;
  }

  createSession(sessionId: string): Session {
    const now = Date.now();
    const session: Session = {
      id: sessionId,
      turns: [],
      created_at: now,
      last_activity: now,
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  getOrCreateSession(sessionId: string): Session {
    const existing = this.getSession(sessionId);
    if (existing) {
      return existing;
    }
    return this.createSession(sessionId);
  }

  addTurn(
    sessionId: string,
    request: InputRequest,
    intents: ParsedIntent[],
    decision: MultiDecision
  ): void {
    const session = this.getOrCreateSession(sessionId);
    session.turns.push({
      request,
      intents,
      decision,
      timestamp: Date.now(),
    });
    session.last_activity = Date.now();
  }

  /**
   * Get pending clarifications from the last turn (if any)
   */
  getPendingClarifications(sessionId: string): ParsedIntent[] | null {
    const session = this.getSession(sessionId);
    if (!session || session.turns.length === 0) {
      return null;
    }

    const lastTurn = session.turns[session.turns.length - 1];
    const pendingIntents: ParsedIntent[] = [];

    // Find sub-decisions that needed clarification
    lastTurn.decision.sub_decisions.forEach((subDecision, index) => {
      if (subDecision.status === "CLARIFICATION_NEEDED") {
        pendingIntents.push(lastTurn.intents[index]);
      }
    });

    return pendingIntents.length > 0 ? pendingIntents : null;
  }

  /**
   * Build conversation history for LLM context
   */
  getConversationHistory(sessionId: string): string | null {
    const session = this.getSession(sessionId);
    if (!session || session.turns.length === 0) {
      return null;
    }

    const historyParts: string[] = [];

    for (const turn of session.turns) {
      historyParts.push(`User: "${turn.request.raw_text}"`);

      const outcomes = turn.decision.sub_decisions.map((sub, i) => {
        const intent = turn.intents[i];
        if (sub.status === "CLARIFICATION_NEEDED") {
          return `- Clarification needed for ${intent.action_type}: ${sub.clarification_questions?.join("; ")}`;
        }
        return `- ${sub.status}: ${intent.action_type} for ${intent.target_system || "unknown system"}`;
      });

      historyParts.push(`System response:\n${outcomes.join("\n")}`);
    }

    return historyParts.join("\n\n");
  }

  clearExpired(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.last_activity > this.ttlMs) {
        this.sessions.delete(id);
      }
    }
  }

  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
