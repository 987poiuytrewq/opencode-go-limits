import { describe, expect, test } from "bun:test";
import {
  estimateRunout,
  formatRunoutDate,
  formatProgressBar,
  formatPercentPrefix,
  formatResetCountdown,
  getProgressBarWidth,
} from "../src/usage";

describe("usage display formatting", () => {
  test("formats a projected exhaustion date compactly", () => {
    const now = new Date(2026, 10, 25, 0, 0, 0, 0);
    const weeklyTarget = new Date(2026, 10, 28, 20, 29, 0, 0);
    const monthlyTarget = new Date(Date.UTC(2026, 11, 2, 12, 0, 0));

    expect(
      formatRunoutDate(
        "weekly",
        { kind: "estimate", inMs: weeklyTarget.getTime() - now.getTime() },
        now.getTime(),
      ),
    ).toBe("Sat 8pm");
    expect(
      formatRunoutDate(
        "rolling",
        {
          kind: "estimate",
          inMs:
            new Date(2026, 10, 25, 10, 38, 0, 0).getTime() -
            new Date(2026, 10, 25, 10, 0, 0, 0).getTime(),
        },
        new Date(2026, 10, 25, 10, 0, 0, 0).getTime(),
      ),
    ).toBe("10:45");
    expect(
      formatRunoutDate(
        "monthly",
        { kind: "estimate", inMs: monthlyTarget.getTime() - now.getTime() },
        now.getTime(),
      ),
    ).toBe("Dec 2");
    expect(formatRunoutDate("weekly", { kind: "idle" }, now.getTime())).toBe(
      "",
    );
  });

  test("projects from current usage and elapsed time in a rolling window", () => {
    const start = 1_999_900_000_000;
    const now = start + 20 * 60_000;
    const meter = {
      percent: 25,
      limited: false,
      resetsAt: start + 5 * 60 * 60_000,
    };

    expect(estimateRunout("rolling", meter, now)).toEqual({
      kind: "estimate",
      inMs: 60 * 60_000,
    });
  });

  test("projects weekly usage from its fixed seven-day window", () => {
    const resetAt = 2_000_000_000_000;
    const now = resetAt - 6 * 24 * 60 * 60_000;

    expect(
      estimateRunout(
        "weekly",
        { percent: 50, limited: false, resetsAt: resetAt },
        now,
      ),
    ).toEqual({
      kind: "estimate",
      inMs: 24 * 60 * 60_000,
    });
  });

  test("uses the previous monthly reset date to estimate the current cycle start", () => {
    const resetsAt = Date.parse("2026-12-18T00:00:00.000Z");
    const now = Date.parse("2026-11-24T00:00:00.000Z");
    const elapsed = 6 * 24 * 60 * 60_000;

    const result = estimateRunout(
      "monthly",
      { percent: 54, limited: false, resetsAt },
      now,
    );

    expect(result.kind).toBe("estimate");
    if (result.kind === "estimate") {
      expect(result.inMs).toBeCloseTo((elapsed * 46) / 54);
    }
  });

  test("does not predict a runout after the window resets", () => {
    const start = 1_999_900_000_000;
    const now = start + 4 * 60 * 60_000;
    const meter = {
      percent: 1,
      limited: false,
      resetsAt: start + 5 * 60 * 60_000,
    };

    expect(estimateRunout("rolling", meter, now)).toEqual({
      kind: "after-reset",
    });
  });

  test("pads percentages to two digits and places a space after them", () => {
    expect(formatPercentPrefix(1)).toBe(" 1% ");
    expect(formatPercentPrefix(55)).toBe("55% ");
    expect(formatPercentPrefix(100)).toBe("100% ");
  });

  test("sizes the bar after the percentage prefix", () => {
    expect(getProgressBarWidth(40, 1)).toBe(36);
    expect(getProgressBarWidth(40, 100)).toBe(35);
    expect(getProgressBarWidth(12, 100)).toBe(7);
  });

  test("uses the Ensemble line glyphs and rounds the filled width", () => {
    expect(formatProgressBar(0, 10)).toEqual({
      filled: "",
      empty: "──────────",
    });
    expect(formatProgressBar(2, 10)).toEqual({
      filled: "",
      empty: "──────────",
    });
    expect(formatProgressBar(20, 10)).toEqual({
      filled: "━━",
      empty: "────────",
    });
    expect(formatProgressBar(100, 10)).toEqual({
      filled: "━━━━━━━━━━",
      empty: "",
    });
  });

  test("formats reset countdowns like the web dashboard", () => {
    const now = new Date("2026-11-24T10:00:00.000Z");

    expect(formatResetCountdown("2026-11-24T14:42:00.000Z", now)).toBe(
      "4h 42m",
    );
    expect(formatResetCountdown("2026-11-29T23:00:00.000Z", now)).toBe(
      "5d 13h",
    );
    expect(formatResetCountdown("2026-11-24T10:00:20.000Z", now)).toBe("<1m");
    expect(formatResetCountdown("2026-11-24T09:00:00.000Z", now)).toBe("now");
    expect(
      formatResetCountdown(Date.parse("2026-11-24T14:42:00.000Z"), now),
    ).toBe("4h 42m");
  });
});
