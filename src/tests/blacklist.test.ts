import { describe, it, expect, beforeEach } from "vitest";
import { BlacklistStore } from "../blacklist/index.js";

describe("BlacklistStore", () => {
  let store: BlacklistStore;

  beforeEach(() => {
    // Use short duration for testing (100ms)
    store = new BlacklistStore(100);
  });

  describe("isBlacklisted", () => {
    it("should return false for users not in blacklist", () => {
      expect(store.isBlacklisted("user@example.com")).toBe(false);
    });

    it("should return true for blacklisted users", () => {
      // First offense - warning
      store.recordAttempt("user@example.com", "attempt 1");
      // Second offense - blacklist
      store.recordAttempt("user@example.com", "attempt 2");

      expect(store.isBlacklisted("user@example.com")).toBe(true);
    });

    it("should return false after blacklist expires", async () => {
      store.recordAttempt("user@example.com", "attempt 1");
      store.recordAttempt("user@example.com", "attempt 2");

      expect(store.isBlacklisted("user@example.com")).toBe(true);

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(store.isBlacklisted("user@example.com")).toBe(false);
    });
  });

  describe("recordAttempt", () => {
    it("should record first offense as warning", () => {
      const result = store.recordAttempt("user@example.com", "injection attempt");

      expect(result.isRepeatOffense).toBe(false);
      expect(result.wasBlacklisted).toBe(false);
      expect(store.isBlacklisted("user@example.com")).toBe(false);
    });

    it("should blacklist on second offense", () => {
      store.recordAttempt("user@example.com", "first attempt");
      const result = store.recordAttempt("user@example.com", "second attempt");

      expect(result.isRepeatOffense).toBe(true);
      expect(result.wasBlacklisted).toBe(false);
      expect(store.isBlacklisted("user@example.com")).toBe(true);
    });

    it("should return wasBlacklisted=true if already blacklisted", () => {
      store.recordAttempt("user@example.com", "first");
      store.recordAttempt("user@example.com", "second");
      const result = store.recordAttempt("user@example.com", "third");

      expect(result.isRepeatOffense).toBe(true);
      expect(result.wasBlacklisted).toBe(true);
    });
  });

  describe("getBlacklistExpiry", () => {
    it("should return null for non-blacklisted users", () => {
      expect(store.getBlacklistExpiry("user@example.com")).toBeNull();
    });

    it("should return expiry date for blacklisted users", () => {
      store.recordAttempt("user@example.com", "first");
      store.recordAttempt("user@example.com", "second");

      const expiry = store.getBlacklistExpiry("user@example.com");
      expect(expiry).not.toBeNull();
      expect(expiry!.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe("getBlacklistedUsers", () => {
    it("should return empty array when no users are blacklisted", () => {
      expect(store.getBlacklistedUsers()).toEqual([]);
    });

    it("should return all blacklisted users", () => {
      store.recordAttempt("user1@example.com", "a");
      store.recordAttempt("user1@example.com", "b");
      store.recordAttempt("user2@example.com", "a");
      store.recordAttempt("user2@example.com", "b");

      const users = store.getBlacklistedUsers();
      expect(users).toHaveLength(2);
      expect(users.map((u) => u.email)).toContain("user1@example.com");
      expect(users.map((u) => u.email)).toContain("user2@example.com");
    });
  });

  describe("removeFromBlacklist", () => {
    it("should remove user from blacklist", () => {
      store.recordAttempt("user@example.com", "a");
      store.recordAttempt("user@example.com", "b");
      expect(store.isBlacklisted("user@example.com")).toBe(true);

      store.removeFromBlacklist("user@example.com");
      expect(store.isBlacklisted("user@example.com")).toBe(false);
    });
  });

  describe("clearWarning", () => {
    it("should clear user warning", () => {
      store.recordAttempt("user@example.com", "first");
      store.clearWarning("user@example.com");

      // Second attempt should now be treated as first offense
      const result = store.recordAttempt("user@example.com", "second");
      expect(result.isRepeatOffense).toBe(false);
    });
  });
});
