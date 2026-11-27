import { describe, expect, test } from "bun:test";
import {
  PACE_LABEL_WIDTH,
  PACE_PERCENT_WIDTH,
  PACE_TITLE,
  buildPaceRows,
  computePaceBar,
  formatPaceBar,
  formatPacePercent,
  getPaceBarWidth,
  paceElapsedPercent,
} from "../../src/pace";
import type { GoUsage } from "../../src/usage";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 10, 27, 12, 45, 0);

function usage(
  percents: readonly [number, number, number],
  resets: readonly [number, number, number] = [
    NOW + HOUR,
    NOW + DAY,
    NOW + 7 * DAY,
  ],
  limited: readonly [boolean, boolean, boolean] = [false, false, false],
): GoUsage {
  return {
    rolling: {
      percent: percents[0],
      limited: limited[0],
      resetsAt: resets[0],
    },
    weekly: {
      percent: percents[1],
      limited: limited[1],
      resetsAt: resets[1],
    },
    monthly: {
      percent: percents[2],
      limited: limited[2],
      resetsAt: resets[2],
    },
  };
}

describe("pace elapsed-window math", () => {
  test("uses the fixed five-hour rolling window", () => {
    expect(paceElapsedPercent("rolling", NOW + HOUR, NOW)).toBeCloseTo(80);
    expect(paceElapsedPercent("rolling", NOW + 5 * HOUR, NOW)).toBeCloseTo(0);
  });

  test("uses the fixed seven-day weekly window", () => {
    expect(paceElapsedPercent("weekly", NOW + DAY, NOW)).toBeCloseTo(600 / 7);
    expect(paceElapsedPercent("weekly", NOW + 3.5 * DAY, NOW)).toBeCloseTo(50);
  });

  test("uses the previous calendar month for the approximate monthly window", () => {
    const resetsAt = Date.UTC(2026, 11, 4, 12, 45, 0);
    expect(paceElapsedPercent("monthly", resetsAt, NOW)).toBeCloseTo(
      (23 / 30) * 100,
    );
  });

  test("clamps elapsed time before the inferred start to zero", () => {
    expect(paceElapsedPercent("rolling", NOW + 5 * HOUR, NOW - HOUR)).toBe(0);
  });

  test("treats a past or current reset as a fully elapsed window", () => {
    expect(paceElapsedPercent("rolling", NOW, NOW)).toBe(100);
    expect(paceElapsedPercent("weekly", NOW - HOUR, NOW)).toBe(100);
    expect(paceElapsedPercent("monthly", NOW - DAY, NOW)).toBe(100);
  });

  test("treats invalid resets or clocks as unknown elapsed time", () => {
    expect(paceElapsedPercent("rolling", Number.NaN, NOW)).toBeUndefined();
    expect(
      paceElapsedPercent("weekly", Number.POSITIVE_INFINITY, NOW),
    ).toBeUndefined();
    expect(
      paceElapsedPercent("monthly", Number.NEGATIVE_INFINITY, NOW),
    ).toBeUndefined();
    expect(
      paceElapsedPercent("rolling", NOW + HOUR, Number.NaN),
    ).toBeUndefined();
  });

  test("clamps monthly starts to the previous month's last day", () => {
    const march = Date.UTC(2025, 2, 31);
    const marchNow = Date.UTC(2025, 2, 14);
    expect(paceElapsedPercent("monthly", march, marchNow)).toBeCloseTo(
      (14 / 31) * 100,
    );

    const leapMarch = Date.UTC(2024, 2, 31);
    const leapNow = Date.UTC(2024, 2, 14);
    expect(paceElapsedPercent("monthly", leapMarch, leapNow)).toBeCloseTo(
      (14 / 31) * 100,
    );
  });
});

describe("composite pace bar segments", () => {
  test("splits a behind-pace bar into used, elapsed, and empty segments", () => {
    expect(
      computePaceBar({
        percent: 20,
        elapsedPercent: 60,
        critical: false,
        width: 10,
      }),
    ).toEqual({ used: 2, elapsed: 4, over: 0, empty: 4 });
  });

  test("keeps an on-pace bar as used plus empty", () => {
    expect(
      computePaceBar({
        percent: 40,
        elapsedPercent: 40,
        critical: false,
        width: 10,
      }),
    ).toEqual({ used: 4, elapsed: 0, over: 0, empty: 6 });
  });

  test("splits an ahead-of-pace bar into used, over-pace, and empty segments", () => {
    expect(
      computePaceBar({
        percent: 70,
        elapsedPercent: 50,
        critical: false,
        width: 10,
      }),
    ).toEqual({ used: 5, elapsed: 0, over: 2, empty: 3 });
  });

  test("shows only over-pace and empty when nothing has elapsed", () => {
    expect(
      computePaceBar({
        percent: 30,
        elapsedPercent: 0,
        critical: false,
        width: 10,
      }),
    ).toEqual({ used: 0, elapsed: 0, over: 3, empty: 7 });
  });

  test("renders critical usage as one red used segment with no pace overlay", () => {
    expect(
      computePaceBar({
        percent: 100,
        elapsedPercent: 60,
        critical: true,
        width: 10,
      }),
    ).toEqual({ used: 10, elapsed: 0, over: 0, empty: 0 });
    expect(
      computePaceBar({
        percent: 60,
        elapsedPercent: 20,
        critical: true,
        width: 10,
      }),
    ).toEqual({ used: 6, elapsed: 0, over: 0, empty: 4 });
  });

  test("falls back to a plain used bar when elapsed time is unknown", () => {
    expect(
      computePaceBar({
        percent: 30,
        elapsedPercent: undefined,
        critical: false,
        width: 10,
      }),
    ).toEqual({ used: 3, elapsed: 0, over: 0, empty: 7 });
  });

  test("clamps percentages and keeps the segment counts equal to the width", () => {
    expect(
      computePaceBar({
        percent: 150,
        elapsedPercent: 40,
        critical: false,
        width: 10,
      }),
    ).toEqual({ used: 4, elapsed: 0, over: 6, empty: 0 });
    expect(
      computePaceBar({
        percent: -20,
        elapsedPercent: 60,
        critical: false,
        width: 10,
      }),
    ).toEqual({ used: 0, elapsed: 6, over: 0, empty: 4 });
    expect(
      computePaceBar({
        percent: Number.NaN,
        elapsedPercent: Number.NaN,
        critical: false,
        width: 10,
      }),
    ).toEqual({ used: 0, elapsed: 0, over: 0, empty: 10 });

    const segments = computePaceBar({
      percent: 33,
      elapsedPercent: 66,
      critical: false,
      width: 7,
    });
    expect(segments).toEqual({ used: 2, elapsed: 3, over: 0, empty: 2 });
    expect(
      segments.used + segments.elapsed + segments.over + segments.empty,
    ).toBe(7);
  });

  test("supports zero and invalid widths", () => {
    expect(
      computePaceBar({
        percent: 50,
        elapsedPercent: 50,
        critical: false,
        width: 0,
      }),
    ).toEqual({ used: 0, elapsed: 0, over: 0, empty: 0 });
    expect(
      computePaceBar({
        percent: 50,
        elapsedPercent: 50,
        critical: false,
        width: Number.NaN,
      }),
    ).toEqual({ used: 0, elapsed: 0, over: 0, empty: 0 });
  });
});

describe("pace bar glyphs and widths", () => {
  test("formats the thick used, muted elapsed, warning over, and empty runs", () => {
    expect(formatPaceBar({ used: 2, elapsed: 3, over: 1, empty: 4 })).toEqual({
      used: "━━",
      elapsed: "━━━",
      over: "━",
      empty: "────",
    });
    expect(formatPaceBar({ used: 0, elapsed: 0, over: 0, empty: 0 })).toEqual({
      used: "",
      elapsed: "",
      over: "",
      empty: "",
    });
  });

  test("sizes the bar after the row prefix and never below one column", () => {
    expect(getPaceBarWidth(40, 18)).toBe(22);
    expect(getPaceBarWidth(64, 34)).toBe(30);
    expect(getPaceBarWidth(12.9, 5)).toBe(7);
    expect(getPaceBarWidth(40, 60)).toBe(1);
    expect(getPaceBarWidth(Number.NaN, 18)).toBe(1);
    expect(getPaceBarWidth(0, 18)).toBe(1);
    expect(getPaceBarWidth(40, -10)).toBe(40);
  });
});

describe("pace rows", () => {
  test("names the heading row above the three meters", () => {
    expect(PACE_TITLE).toBe("OpenCode Go");
  });

  test("builds exactly three labeled rows in limit order", () => {
    const rows = buildPaceRows(usage([25, 50, 66]), NOW, 64);

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.limit)).toEqual([
      "rolling",
      "weekly",
      "monthly",
    ]);
    expect(rows.map((row) => row.label.trim())).toEqual([
      "5-hour",
      "Weekly",
      "Monthly",
    ]);
    expect(rows.map((row) => row.percentText)).toEqual([
      " 25% ",
      " 50% ",
      " 66% ",
    ]);
    for (const row of rows) {
      expect(row.label).toHaveLength(PACE_LABEL_WIDTH + 1);
      expect(row.label.endsWith(" ")).toBe(true);
      expect(row.percentText).toHaveLength(PACE_PERCENT_WIDTH);
      expect(row.critical).toBe(false);
    }
  });

  test("right-aligns percentages so every bar starts at the same column", () => {
    expect(formatPacePercent(5)).toBe("  5% ");
    expect(formatPacePercent(25)).toBe(" 25% ");
    expect(formatPacePercent(100)).toBe("100% ");
    expect(formatPacePercent(150)).toBe("100% ");
    expect(formatPacePercent(Number.NaN)).toBe("  0% ");
    for (const percent of [0, 5, 25, 95, 100]) {
      expect(formatPacePercent(percent)).toHaveLength(PACE_PERCENT_WIDTH);
    }

    const rows = buildPaceRows(usage([5, 25, 100]), NOW, 64);
    const barStarts = rows.map(
      (row) => row.label.length + row.percentText.length,
    );
    expect(rows.map((row) => row.percentText)).toEqual([
      "  5% ",
      " 25% ",
      "100% ",
    ]);
    expect(new Set(barStarts).size).toBe(1);
    expect(barStarts[0]).toBe(PACE_LABEL_WIDTH + 1 + PACE_PERCENT_WIDTH);
  });

  test("marks behind-pace rows green and ahead-of-pace rows yellow", () => {
    const [rolling, weekly, monthly] = buildPaceRows(
      usage([25, 95, 66]),
      NOW,
      64,
    );

    expect(rolling?.ahead).toBe(false);
    expect(rolling?.tone).toBe("success");
    expect(rolling?.elapsedPercent).toBeCloseTo(80);
    expect(rolling?.segments.used).toBeGreaterThan(0);
    expect(rolling?.segments.elapsed).toBeGreaterThan(0);
    expect(rolling?.segments.over).toBe(0);

    expect(weekly?.ahead).toBe(true);
    expect(weekly?.tone).toBe("warning");
    expect(weekly?.segments.over).toBeGreaterThan(0);

    expect(monthly?.ahead).toBe(false);
    expect(monthly?.tone).toBe("success");
    expect(monthly?.segments.elapsed).toBeGreaterThan(0);
  });

  test("renders a limited meter as a critical bar without status text", () => {
    const rows = buildPaceRows(
      usage([10, 20, 100], undefined, [false, false, true]),
      NOW,
      64,
    );
    const monthly = rows[2];

    expect(monthly?.critical).toBe(true);
    expect(monthly?.tone).toBe("critical");
    expect(monthly?.percentText).toBe("100% ");
    expect(monthly?.segments.used).toBeGreaterThan(0);
    expect(monthly?.segments.elapsed).toBe(0);
    expect(monthly?.segments.over).toBe(0);
    expect(monthly?.segments.empty).toBe(0);
    expect(monthly?.bar.empty).toBe("");
  });

  test("treats a meter at 100 percent as critical even when not limited", () => {
    const rows = buildPaceRows(
      usage([100, 20, 30], undefined, [false, false, false]),
      NOW,
      64,
    );

    expect(rows[0]?.critical).toBe(true);
    expect(rows[0]?.tone).toBe("critical");
    expect(rows[0]?.segments.used).toBeGreaterThan(0);
  });

  test("uses a plain bar and threshold tone for an invalid reset", () => {
    const rows = buildPaceRows(
      usage([85, 20, 30], [Number.NaN, NOW + DAY, NOW + 7 * DAY]),
      NOW,
      64,
    );

    expect(rows[0]?.elapsedPercent).toBeUndefined();
    expect(rows[0]?.ahead).toBe(false);
    expect(rows[0]?.tone).toBe("warning");
    expect(rows[0]?.segments.elapsed).toBe(0);
    expect(rows[0]?.segments.over).toBe(0);
  });
});
