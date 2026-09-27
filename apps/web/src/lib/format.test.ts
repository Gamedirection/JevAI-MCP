import { describe, expect, it } from "vitest";
import { bucketLabel, formatBytes, formatDuration, formatPercent, formatRelative, formatUptime } from "./format.ts";

describe("formatters", () => {
   it("formats durations across thresholds", () => {
      expect(formatDuration(12)).toBe("12 ms");
      expect(formatDuration(1500)).toBe("1.50 s");
      expect(formatDuration(null)).toBe("-");
          	});

   it("formats percentages", () => {
      expect(formatPercent(66.66)).toBe("66.7%");
      expect(formatPercent(null)).toBe("-");
          	});

   it("formats bytes", () => {
      expect(formatBytes(900)).toBe("900 B");
      expect(formatBytes(1536)).toBe("1.5 KB");
          	});

   it("formats uptime", () => {
      expect(formatUptime(90)).toBe("1m");
      expect(formatUptime(3600 + 120)).toBe("1h 2m");
          	});

   it("formats relative time", () => {
      expect(formatRelative(new Date(Date.now() - 5_000).toISOString())).toBe("5s ago");
      expect(formatRelative(null)).toBe("never");
          	});

   it("labels buckets by span", () => {
      const iso = "2026-09-26T10:00:00.000Z";
      const expectedTime = new Date(iso).toLocaleTimeString("en-US", {
         	hour: "2-digit", minute: "2-digit", hour12: false,
             	});
      const expectedDate = new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      expect(bucketLabel(iso, 3600)).toBe(expectedTime);
      expect(bucketLabel(iso, 86_400)).toBe(expectedDate);
           	});
});
