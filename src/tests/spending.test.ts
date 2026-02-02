import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { SpendingTracker } from "../spending/index.js";

describe("SpendingTracker", () => {
  let tracker: SpendingTracker;

  beforeEach(() => {
    tracker = new SpendingTracker(90); // 90 days
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getSpending", () => {
    it("should return 0 for users with no spending", () => {
      expect(tracker.getSpending("user@example.com")).toBe(0);
    });

    it("should return cumulative spending for a user", () => {
      tracker.recordSpending("req_001", "user@example.com", 1000, "APPROVED");
      tracker.recordSpending("req_002", "user@example.com", 500, "APPROVED");

      expect(tracker.getSpending("user@example.com")).toBe(1500);
    });

    it("should not include spending from other users", () => {
      tracker.recordSpending("req_001", "user1@example.com", 1000, "APPROVED");
      tracker.recordSpending("req_002", "user2@example.com", 500, "APPROVED");

      expect(tracker.getSpending("user1@example.com")).toBe(1000);
      expect(tracker.getSpending("user2@example.com")).toBe(500);
    });
  });

  describe("recordSpending", () => {
    it("should record APPROVED spending", () => {
      tracker.recordSpending("req_001", "user@example.com", 1000, "APPROVED");

      expect(tracker.getSpending("user@example.com")).toBe(1000);
    });

    it("should record REQUIRES_APPROVAL spending", () => {
      tracker.recordSpending("req_001", "user@example.com", 1000, "REQUIRES_APPROVAL");

      expect(tracker.getSpending("user@example.com")).toBe(1000);
    });
  });

  describe("rolling window", () => {
    it("should exclude spending outside the window", () => {
      tracker.recordSpending("req_001", "user@example.com", 1000, "APPROVED");

      // Advance time past 90 days
      vi.advanceTimersByTime(91 * 24 * 60 * 60 * 1000);

      expect(tracker.getSpending("user@example.com")).toBe(0);
    });

    it("should include spending within the window", () => {
      tracker.recordSpending("req_001", "user@example.com", 1000, "APPROVED");

      // Advance time but stay within 90 days
      vi.advanceTimersByTime(89 * 24 * 60 * 60 * 1000);

      expect(tracker.getSpending("user@example.com")).toBe(1000);
    });
  });

  describe("getSpendingDetails", () => {
    it("should return all records within window for a user", () => {
      tracker.recordSpending("req_001", "user@example.com", 1000, "APPROVED");
      tracker.recordSpending("req_002", "user@example.com", 500, "REQUIRES_APPROVAL");

      const records = tracker.getSpendingDetails("user@example.com");

      expect(records).toHaveLength(2);
      expect(records[0].request_id).toBe("req_001");
      expect(records[0].amount).toBe(1000);
      expect(records[0].status).toBe("APPROVED");
      expect(records[1].request_id).toBe("req_002");
      expect(records[1].amount).toBe(500);
      expect(records[1].status).toBe("REQUIRES_APPROVAL");
    });

    it("should return empty array for users with no spending", () => {
      expect(tracker.getSpendingDetails("user@example.com")).toEqual([]);
    });
  });

  describe("getPeriodDays", () => {
    it("should return configured period", () => {
      expect(tracker.getPeriodDays()).toBe(90);
    });

    it("should use custom period if specified", () => {
      const customTracker = new SpendingTracker(30);
      expect(customTracker.getPeriodDays()).toBe(30);
    });
  });
});
