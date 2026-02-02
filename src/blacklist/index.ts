export interface InjectionAttempt {
  user_email: string;
  raw_text: string;
  timestamp: number;
}

const DEFAULT_BLACKLIST_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

export class BlacklistStore {
  private warnings: Map<string, InjectionAttempt> = new Map(); // First offense
  private blacklist: Map<string, InjectionAttempt> = new Map(); // Repeat offenders
  private blacklistDurationMs: number;

  constructor(blacklistDurationMs: number = DEFAULT_BLACKLIST_DURATION_MS) {
    this.blacklistDurationMs = blacklistDurationMs;
  }

  /**
   * Check if a user is currently blacklisted
   */
  isBlacklisted(userEmail: string): boolean {
    const entry = this.blacklist.get(userEmail);
    if (!entry) {
      return false;
    }

    // Check if blacklist has expired
    if (Date.now() - entry.timestamp > this.blacklistDurationMs) {
      this.blacklist.delete(userEmail);
      return false;
    }

    return true;
  }

  /**
   * Get blacklist expiry time for a user (if blacklisted)
   */
  getBlacklistExpiry(userEmail: string): Date | null {
    const entry = this.blacklist.get(userEmail);
    if (!entry || !this.isBlacklisted(userEmail)) {
      return null;
    }
    return new Date(entry.timestamp + this.blacklistDurationMs);
  }

  /**
   * Record a prompt injection attempt.
   * Returns whether this is a repeat offense (user should be blacklisted).
   */
  recordAttempt(userEmail: string, rawText: string): { isRepeatOffense: boolean; wasBlacklisted: boolean } {
    const now = Date.now();

    // Already blacklisted
    if (this.isBlacklisted(userEmail)) {
      return { isRepeatOffense: true, wasBlacklisted: true };
    }

    // Check if this is a repeat offense
    const previousWarning = this.warnings.get(userEmail);
    if (previousWarning) {
      // Repeat offense - add to blacklist
      this.blacklist.set(userEmail, {
        user_email: userEmail,
        raw_text: rawText,
        timestamp: now,
      });
      console.error(`🚫 User ${userEmail} blacklisted for 24 hours after repeat prompt injection attempt`);
      return { isRepeatOffense: true, wasBlacklisted: false };
    }

    // First offense - record warning
    this.warnings.set(userEmail, {
      user_email: userEmail,
      raw_text: rawText,
      timestamp: now,
    });
    console.error(`⚠️ Warning recorded for ${userEmail} - first prompt injection attempt`);
    return { isRepeatOffense: false, wasBlacklisted: false };
  }

  /**
   * Get all currently blacklisted users (for admin review)
   */
  getBlacklistedUsers(): Array<{ email: string; expiry: Date }> {
    const result: Array<{ email: string; expiry: Date }> = [];
    for (const [email, entry] of this.blacklist) {
      if (this.isBlacklisted(email)) {
        result.push({
          email,
          expiry: new Date(entry.timestamp + this.blacklistDurationMs),
        });
      }
    }
    return result;
  }

  /**
   * Manually remove a user from the blacklist (admin action)
   */
  removeFromBlacklist(userEmail: string): boolean {
    return this.blacklist.delete(userEmail);
  }

  /**
   * Clear a user's warning (admin action)
   */
  clearWarning(userEmail: string): boolean {
    return this.warnings.delete(userEmail);
  }
}
