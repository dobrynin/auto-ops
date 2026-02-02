export interface SpendingRecord {
  request_id: string;
  user_email: string;
  amount: number;
  timestamp: number;
  status: "APPROVED" | "REQUIRES_APPROVAL";
}

const DEFAULT_PERIOD_DAYS = 90;

export class SpendingTracker {
  private records: SpendingRecord[] = [];
  private periodDays: number;

  constructor(periodDays: number = DEFAULT_PERIOD_DAYS) {
    this.periodDays = periodDays;
  }

  /**
   * Record a hardware spending event
   */
  recordSpending(
    requestId: string,
    userEmail: string,
    amount: number,
    status: "APPROVED" | "REQUIRES_APPROVAL"
  ): void {
    this.records.push({
      request_id: requestId,
      user_email: userEmail,
      amount,
      timestamp: Date.now(),
      status,
    });
  }

  /**
   * Get total spending for a user within the rolling window
   */
  getSpending(userEmail: string): number {
    this.clearExpired();

    return this.records
      .filter((r) => r.user_email === userEmail)
      .reduce((sum, r) => sum + r.amount, 0);
  }

  /**
   * Get spending breakdown for a user (for observability)
   */
  getSpendingDetails(userEmail: string): SpendingRecord[] {
    this.clearExpired();
    return this.records.filter((r) => r.user_email === userEmail);
  }

  /**
   * Remove records older than the rolling window
   */
  private clearExpired(): void {
    const cutoff = Date.now() - this.periodDays * 24 * 60 * 60 * 1000;
    this.records = this.records.filter((r) => r.timestamp >= cutoff);
  }

  /**
   * Get the configured period in days
   */
  getPeriodDays(): number {
    return this.periodDays;
  }
}
