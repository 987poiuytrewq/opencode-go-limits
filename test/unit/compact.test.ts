import { describe, expect, test } from "bun:test";
import {
  formatCompactError,
  formatCompactLoading,
  formatCompactStatus,
  formatCompactUnavailable,
  selectCompactStatus,
} from "../../src/compact";
import type { GoUsage } from "../../src/usage";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = new Date(2026, 10, 25, 10, 0, 0, 0).getTime();

function usage(
  percents: readonly [number, number, number] = [10, 20, 30],
  resets: readonly [number, number, number] = [
    NOW + 5 * HOUR,
    NOW + 7 * DAY,
    NOW + 30 * DAY,
  ],
  limited: readonly [boolean, boolean, boolean] = [false, false, false],
): GoUsage {
  return {
    rolling: { percent: percents[0], limited: limited[0], resetsAt: resets[0] },
    weekly: { percent: percents[1], limited: limited[1], resetsAt: resets[1] },
    monthly: { percent: percents[2], limited: limited[2], resetsAt: resets[2] },
  };
}

describe("compact status selection", () => {
  test("reports ok and picks the highest percentage when nothing is urgent", () => {
    const status = selectCompactStatus(usage([10, 20, 30]), NOW);

    expect(status.severity).toBe("ok");
    expect(status.limit).toBe("monthly");
    expect(status.percent).toBe(30);
    expect(formatCompactStatus(status, NOW)).toBe(
      "OpenCode Go ✓ OK · Monthly 30% · resets 30d",
    );
  });

  test("treats an API-limited meter as critical even below 100%", () => {
    const status = selectCompactStatus(
      usage([10, 20, 30], undefined, [false, true, false]),
      NOW,
    );

    expect(status.severity).toBe("critical");
    expect(status.limit).toBe("weekly");
    expect(status.limited).toBe(true);
    expect(formatCompactStatus(status, NOW)).toBe(
      "OpenCode Go ✖ LIMIT · Weekly 20% · resets 7d",
    );
  });

  test("prefers critical meters over warnings and picks the highest percent", () => {
    const status = selectCompactStatus(
      usage([90, 120, 50], undefined, [false, false, true]),
      NOW,
    );

    expect(status.severity).toBe("critical");
    expect(status.limit).toBe("weekly");
    expect(formatCompactStatus(status, NOW)).toContain(
      "OpenCode Go ✖ LIMIT · Weekly 100%",
    );
  });

  test("warns at 80% and picks the highest percentage without a projection", () => {
    const status = selectCompactStatus(
      usage([85, 90, 20], [NOW, NOW, NOW]),
      NOW,
    );

    expect(status.severity).toBe("warning");
    expect(status.limit).toBe("weekly");
    expect(formatCompactStatus(status, NOW)).toBe(
      "OpenCode Go  ⚠ WARN · Weekly 90% · resets now",
    );
  });

  test("among warnings prefers the earliest projected runout", () => {
    const rollingReset = NOW + HOUR;
    const weeklyReset = NOW + 6 * DAY;
    const status = selectCompactStatus(
      usage([90, 95, 10], [rollingReset, weeklyReset, NOW]),
      NOW,
    );

    expect(status.severity).toBe("warning");
    expect(status.limit).toBe("rolling");
    expect(status.projection.kind).toBe("estimate");
    expect(formatCompactStatus(status, NOW)).toBe(
      "OpenCode Go  ⚠ WARN · 5-hour window 90% · runout 10:30",
    );
  });

  test("prefers a projected warning over a higher-percent static warning", () => {
    const status = selectCompactStatus(
      usage([82, 85, 10], [NOW, NOW + 6 * DAY, NOW]),
      NOW,
    );

    expect(status.severity).toBe("warning");
    expect(status.limit).toBe("weekly");
    expect(status.projection.kind).toBe("estimate");
    expect(formatCompactStatus(status, NOW)).toContain(
      "OpenCode Go  ⚠ WARN · Weekly 85% · runout ",
    );
  });

  test("clamps the formatted percentage for out-of-range and invalid values", () => {
    expect(
      formatCompactStatus(selectCompactStatus(usage([150, 10, 10]), NOW), NOW),
    ).toContain("5-hour window 100%");

    expect(
      formatCompactStatus(
        selectCompactStatus(usage([Number.NaN, 10, 20]), NOW),
        NOW,
      ),
    ).toContain("Monthly 20%");
  });
});

describe("compact state formatting", () => {
  test("formats one-line loading, unavailable, and error states distinctly", () => {
    const loading = formatCompactLoading();
    const unavailable = formatCompactUnavailable();
    const error = formatCompactError("limits endpoint offline");

    expect(loading).toBe("OpenCode Go … loading limits");
    expect(unavailable).toBe("OpenCode Go – Go usage unavailable");
    expect(error).toBe("OpenCode Go ✖ error · limits endpoint offline");
    expect(new Set([loading, unavailable, error]).size).toBe(3);

    for (const line of [loading, unavailable, error]) {
      expect(line).not.toContain("\n");
    }
  });

  test("collapses whitespace and empty messages in one-line errors", () => {
    expect(formatCompactError("limits\nendpoint   offline")).toBe(
      "OpenCode Go ✖ error · limits endpoint offline",
    );
    expect(formatCompactError("   ")).toBe(
      "OpenCode Go ✖ error · Could not load Go limits",
    );
  });
});
