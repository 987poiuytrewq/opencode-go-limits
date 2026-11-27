import { describe, expect, test } from "bun:test";
import {
  estimateRunout,
  formatRunoutDate,
  formatProgressBar,
  formatPercentPrefix,
  formatResetCountdown,
  getProgressBarWidth,
} from "../../src/usage";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

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
    ).toBe("Sat 20:00");
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

  test("formats only estimated runouts", () => {
    const now = Date.UTC(2026, 10, 25, 12, 0, 0);

    expect(formatRunoutDate("rolling", { kind: "reached" }, now)).toBe("");
    expect(formatRunoutDate("weekly", { kind: "after-reset" }, now)).toBe("");
    expect(formatRunoutDate("monthly", { kind: "idle" }, now)).toBe("");
  });

  test("carries rounded rolling estimates into the next hour and day", () => {
    const now = new Date(2026, 10, 25, 10, 0, 0, 0);

    expect(
      formatRunoutDate(
        "rolling",
        { kind: "estimate", inMs: 53 * MINUTE },
        now.getTime(),
      ),
    ).toBe("11:00");

    const lateNow = new Date(2026, 10, 25, 23, 0, 0, 0);
    expect(
      formatRunoutDate(
        "rolling",
        { kind: "estimate", inMs: 58 * MINUTE },
        lateNow.getTime(),
      ),
    ).toBe("00:00");
  });

  test("carries rounded weekly estimates into the next day", () => {
    const now = new Date(2026, 10, 25, 0, 0, 0, 0);
    const lateSaturday = new Date(2026, 10, 28, 23, 40, 0, 0);

    expect(
      formatRunoutDate(
        "weekly",
        { kind: "estimate", inMs: lateSaturday.getTime() - now.getTime() },
        now.getTime(),
      ),
    ).toBe("Sun 00:00");
  });

  test("projects from current usage and elapsed time in a rolling window", () => {
    const start = 1_999_900_000_000;
    const now = start + 20 * MINUTE;
    const meter = {
      percent: 25,
      limited: false,
      resetsAt: start + 5 * HOUR,
    };

    expect(estimateRunout("rolling", meter, now)).toEqual({
      kind: "estimate",
      inMs: 60 * MINUTE,
    });
  });

  test("projects weekly usage from its fixed seven-day window", () => {
    const resetAt = 2_000_000_000_000;
    const now = resetAt - 6 * DAY;

    expect(
      estimateRunout(
        "weekly",
        { percent: 50, limited: false, resetsAt: resetAt },
        now,
      ),
    ).toEqual({
      kind: "estimate",
      inMs: DAY,
    });
  });

  test("uses the previous monthly reset date to estimate the current cycle start", () => {
    const resetsAt = Date.parse("2026-12-18T00:00:00.000Z");
    const now = Date.parse("2026-11-24T00:00:00.000Z");
    const elapsed = 6 * DAY;

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

  test("wraps monthly cycles across December and January", () => {
    const resetsAt = Date.UTC(2026, 0, 31);
    const now = Date.UTC(2026, 0, 15);

    expect(
      estimateRunout("monthly", { percent: 50, limited: false, resetsAt }, now),
    ).toEqual({ kind: "estimate", inMs: 15 * DAY });
  });

  test("clamps monthly cycle starts to February 29 in leap years", () => {
    const resetsAt = Date.UTC(2024, 2, 31);
    const now = Date.UTC(2024, 2, 14);

    expect(
      estimateRunout("monthly", { percent: 50, limited: false, resetsAt }, now),
    ).toEqual({ kind: "estimate", inMs: 14 * DAY });
  });

  test("clamps monthly cycle starts to February 28 outside leap years", () => {
    const resetsAt = Date.UTC(2025, 2, 31);
    const now = Date.UTC(2025, 2, 14);

    expect(
      estimateRunout("monthly", { percent: 50, limited: false, resetsAt }, now),
    ).toEqual({ kind: "estimate", inMs: 14 * DAY });
  });

  test("keeps the monthly reset time of day when inferring the cycle start", () => {
    const resetsAt = Date.UTC(2026, 0, 31, 12, 30, 45, 123);
    const now = Date.UTC(2026, 0, 15, 12, 30, 45, 123);

    expect(
      estimateRunout("monthly", { percent: 50, limited: false, resetsAt }, now),
    ).toEqual({ kind: "estimate", inMs: 15 * DAY });
  });

  test("does not predict a runout after the window resets", () => {
    const start = 1_999_900_000_000;
    const now = start + 4 * HOUR;
    const meter = {
      percent: 1,
      limited: false,
      resetsAt: start + 5 * HOUR,
    };

    expect(estimateRunout("rolling", meter, now)).toEqual({
      kind: "after-reset",
    });
  });

  test("treats reached and invalid usage as non-estimates", () => {
    const now = Date.UTC(2026, 10, 25, 12, 0, 0);
    const resetsAt = now + 5 * HOUR;

    expect(
      estimateRunout(
        "rolling",
        { percent: 100, limited: false, resetsAt },
        now,
      ),
    ).toEqual({ kind: "reached" });
    expect(
      estimateRunout(
        "rolling",
        { percent: 150, limited: false, resetsAt },
        now,
      ),
    ).toEqual({ kind: "reached" });
    expect(
      estimateRunout("rolling", { percent: 12, limited: true, resetsAt }, now),
    ).toEqual({ kind: "reached" });
    expect(
      estimateRunout(
        "rolling",
        { percent: Number.NaN, limited: false, resetsAt },
        now,
      ),
    ).toEqual({ kind: "idle" });
    expect(
      estimateRunout(
        "rolling",
        { percent: -12, limited: false, resetsAt },
        now,
      ),
    ).toEqual({ kind: "idle" });
    expect(
      estimateRunout("rolling", { percent: 0, limited: false, resetsAt }, now),
    ).toEqual({ kind: "idle" });
  });

  test("treats an invalid or past reset as after-reset", () => {
    const now = Date.UTC(2026, 10, 25, 12, 0, 0);

    expect(
      estimateRunout(
        "rolling",
        { percent: 50, limited: false, resetsAt: now },
        now,
      ),
    ).toEqual({ kind: "after-reset" });
    expect(
      estimateRunout(
        "rolling",
        { percent: 50, limited: false, resetsAt: Number.NaN },
        now,
      ),
    ).toEqual({ kind: "after-reset" });
    expect(
      estimateRunout(
        "monthly",
        { percent: 50, limited: false, resetsAt: Number.POSITIVE_INFINITY },
        now,
      ),
    ).toEqual({ kind: "after-reset" });
  });

  test("pads percentages to two digits and places a space after them", () => {
    expect(formatPercentPrefix(0)).toBe(" 0% ");
    expect(formatPercentPrefix(1)).toBe(" 1% ");
    expect(formatPercentPrefix(55)).toBe("55% ");
    expect(formatPercentPrefix(100)).toBe("100% ");
  });

  test("clamps out-of-range and invalid percentages", () => {
    expect(formatPercentPrefix(-7)).toBe(" 0% ");
    expect(formatPercentPrefix(150)).toBe("100% ");
    expect(formatPercentPrefix(Number.NaN)).toBe(" 0% ");
    expect(formatPercentPrefix(Number.POSITIVE_INFINITY)).toBe(" 0% ");
    expect(formatPercentPrefix(-Number.POSITIVE_INFINITY)).toBe(" 0% ");
    expect(formatPercentPrefix(99.6)).toBe("100% ");
  });

  test("sizes the bar after the percentage prefix", () => {
    expect(getProgressBarWidth(40, 1)).toBe(36);
    expect(getProgressBarWidth(40, 100)).toBe(35);
    expect(getProgressBarWidth(12, 100)).toBe(7);
    expect(getProgressBarWidth(4, 100)).toBe(1);
    expect(getProgressBarWidth(40.9, 0)).toBe(36);
  });

  test("never sizes the bar below one column for invalid widths", () => {
    expect(getProgressBarWidth(Number.NaN, 50)).toBe(1);
    expect(getProgressBarWidth(Number.POSITIVE_INFINITY, 50)).toBe(1);
    expect(getProgressBarWidth(0, 50)).toBe(1);
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
    expect(formatProgressBar(45, 10)).toEqual({
      filled: "━━━━━",
      empty: "─────",
    });
    expect(formatProgressBar(100, 10)).toEqual({
      filled: "━━━━━━━━━━",
      empty: "",
    });
  });

  test("clamps progress bars for invalid or out-of-range percentages", () => {
    expect(formatProgressBar(Number.NaN, 10)).toEqual({
      filled: "",
      empty: "──────────",
    });
    expect(formatProgressBar(-20, 10)).toEqual({
      filled: "",
      empty: "──────────",
    });
    expect(formatProgressBar(150, 10)).toEqual({
      filled: "━━━━━━━━━━",
      empty: "",
    });
  });

  test("floors fractional and zero bar widths", () => {
    expect(formatProgressBar(50, 4.9)).toEqual({ filled: "━━", empty: "──" });
    expect(formatProgressBar(50, 0)).toEqual({ filled: "", empty: "" });
    expect(formatProgressBar(50, -3)).toEqual({ filled: "", empty: "" });
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

  test("formats countdown boundaries and invalid reset values", () => {
    const now = new Date("2026-11-24T10:00:00.000Z");

    expect(formatResetCountdown("2026-11-24T10:01:00.000Z", now)).toBe("1m");
    expect(formatResetCountdown("2026-11-25T10:00:00.000Z", now)).toBe("1d");
    expect(formatResetCountdown("2026-11-25T12:00:00.000Z", now)).toBe("1d 2h");
    expect(formatResetCountdown("2026-11-26T10:00:00.000Z", now)).toBe("2d");
    expect(formatResetCountdown("not-a-date", now)).toBe("now");
    expect(formatResetCountdown(Number.NaN, now)).toBe("now");
    expect(formatResetCountdown(now.getTime(), now)).toBe("now");
  });
});
