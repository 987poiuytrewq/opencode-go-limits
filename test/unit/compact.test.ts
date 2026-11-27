import { describe, expect, test } from "bun:test";
import {
  formatCompactError,
  formatCompactLoading,
  formatCompactMonthly,
  formatCompactPercent,
  formatCompactShortWindow,
  formatCompactStatus,
  formatCompactUnavailable,
  selectCompactStatus,
  selectMonthlyStatus,
} from "../../src/compact";
import type { GoUsage } from "../../src/usage";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = new Date(2026, 10, 27, 12, 45, 0, 0).getTime();

function usage(
  percents: readonly [number, number, number] = [10, 20, 30],
  resets: readonly [number, number, number] = [
    NOW + 5 * HOUR,
    NOW + 7 * DAY,
    NOW + 20 * DAY,
  ],
  limited: readonly [boolean, boolean, boolean] = [false, false, false],
): GoUsage {
  return {
    rolling: { percent: percents[0], limited: limited[0], resetsAt: resets[0] },
    weekly: { percent: percents[1], limited: limited[1], resetsAt: resets[1] },
    monthly: { percent: percents[2], limited: limited[2], resetsAt: resets[2] },
  };
}

describe("monthly compact summary", () => {
  test("uses the success tone for a healthy monthly row", () => {
    const status = selectMonthlyStatus(
      usage([10, 20, 66], [NOW + HOUR, NOW + 7 * DAY, NOW + 5 * DAY]),
      NOW,
    );
    const rows = formatCompactStatus(
      usage([10, 20, 66], [NOW + HOUR, NOW + 7 * DAY, NOW + 5 * DAY]),
      NOW,
    );

    expect(status.severity).toBe("ok");
    expect(formatCompactMonthly(status)).toBe("66%");
    expect(rows.summary).toEqual({ text: "66%", tone: "ok" });
  });

  test("marks an approaching monthly value with the warning tone only", () => {
    const status = selectMonthlyStatus(usage([10, 20, 85]), NOW);

    expect(status.severity).toBe("warning");
    expect(formatCompactMonthly(status)).toBe("85%");
    expect(formatCompactStatus(usage([10, 20, 85]), NOW).summary).toEqual({
      text: "85%",
      tone: "warning",
    });
  });

  test("marks a projected monthly runout as approaching", () => {
    const status = selectMonthlyStatus(
      usage([10, 20, 66], [NOW + HOUR, NOW + 7 * DAY, NOW + 20 * DAY]),
      NOW,
    );

    expect(status.projection.kind).toBe("estimate");
    expect(status.severity).toBe("warning");
    expect(formatCompactMonthly(status)).toBe("66%");
  });

  test("marks an exhausted or API-limited monthly value as critical", () => {
    expect(
      formatCompactMonthly(selectMonthlyStatus(usage([10, 20, 150]), NOW)),
    ).toBe("100%");

    expect(
      formatCompactMonthly(
        selectMonthlyStatus(
          usage([10, 20, 20], undefined, [false, false, true]),
          NOW,
        ),
      ),
    ).toBe("20%");
  });

  test("keeps the populated first row to a bare percentage", () => {
    const rows = formatCompactStatus(usage([10, 20, 85]), NOW);

    expect(rows.summary.text).toBe("85%");
    expect(rows.summary.text).not.toContain("OpenCode Go");
    expect(rows.summary.text).not.toContain("Monthly");
    expect(rows.summary.text).not.toContain("⚠");
    expect(rows.summary.text).not.toContain("✖");
  });
});

describe("short-window compact row", () => {
  test("formats the most urgent warning as the requested two-row value", () => {
    const data = usage(
      [70, 10, 66],
      [NOW + 1.5 * HOUR, NOW + 7 * DAY, NOW + 20 * DAY],
    );
    const status = selectCompactStatus(data, NOW);
    const rows = formatCompactStatus(data, NOW);

    expect(status.limit).toBe("rolling");
    expect(status.severity).toBe("warning");
    expect(status.projection.kind).toBe("estimate");
    expect(formatCompactShortWindow(status, NOW)).toBe("5-hour  ⚠ 14:15");
    expect(rows.detail).toEqual({
      text: "5-hour  ⚠ 14:15",
      tone: "warning",
      label: "5-hour",
      status: "  ⚠ 14:15",
    });
  });

  test("treats an API-limited meter as critical even below 100%", () => {
    const status = selectCompactStatus(
      usage([10, 20, 30], undefined, [false, true, false]),
      NOW,
    );

    expect(status.severity).toBe("critical");
    expect(status.limit).toBe("weekly");
    expect(formatCompactShortWindow(status, NOW)).toBe(
      "Weekly ✖ limit reached",
    );
  });

  test("prefers critical meters over warnings and picks the highest percent", () => {
    const status = selectCompactStatus(usage([120, 90, 50]), NOW);

    expect(status.severity).toBe("critical");
    expect(status.limit).toBe("rolling");
    expect(formatCompactShortWindow(status, NOW)).toBe(
      "5-hour ✖ limit reached",
    );
  });

  test("warns at 80% and picks the highest percentage without a projection", () => {
    const status = selectCompactStatus(
      usage([85, 90, 20], [NOW, NOW, NOW]),
      NOW,
    );

    expect(status.severity).toBe("warning");
    expect(status.limit).toBe("weekly");
    expect(formatCompactShortWindow(status, NOW)).toBe("Weekly  ⚠ resets now");
  });

  test("among warnings prefers the earliest projected runout", () => {
    const status = selectCompactStatus(
      usage([90, 95, 10], [NOW + HOUR, NOW + 6 * DAY, NOW]),
      NOW,
    );

    expect(status.severity).toBe("warning");
    expect(status.limit).toBe("rolling");
    expect(formatCompactShortWindow(status, NOW)).toBe("5-hour  ⚠ 13:15");
  });

  test("prefers a projected warning over a higher-percent static warning", () => {
    const status = selectCompactStatus(
      usage([82, 85, 10], [NOW, NOW + 6 * DAY, NOW]),
      NOW,
    );

    expect(status.severity).toBe("warning");
    expect(status.limit).toBe("weekly");
    expect(status.projection.kind).toBe("estimate");
    expect(formatCompactShortWindow(status, NOW)).toContain("Weekly  ⚠ ");
  });

  test("never selects the monthly meter for the short-window row", () => {
    const status = selectCompactStatus(usage([10, 20, 30]), NOW);

    expect(status.limit).toBe("weekly");
    expect(formatCompactShortWindow(status, NOW)).toBe("Weekly ✓ resets 7d");
  });

  test("clamps the formatted percentage for out-of-range and invalid values", () => {
    expect(formatCompactPercent(150)).toBe("100%");
    expect(formatCompactPercent(Number.NaN)).toBe("0%");
    expect(formatCompactPercent(-5)).toBe("0%");
  });
});

describe("compact state formatting", () => {
  test("formats loading, unavailable, and error states as distinct two rows", () => {
    const loading = formatCompactLoading();
    const unavailable = formatCompactUnavailable();
    const error = formatCompactError("limits endpoint offline");

    expect(loading).toEqual({
      summary: { text: "…", tone: "muted" },
      detail: {
        text: "… loading limits",
        tone: "muted",
        label: "",
        status: "… loading limits",
      },
    });
    expect(unavailable).toEqual({
      summary: { text: "–", tone: "muted" },
      detail: {
        text: "– Go usage unavailable",
        tone: "muted",
        label: "",
        status: "– Go usage unavailable",
      },
    });
    expect(error).toEqual({
      summary: { text: "✖", tone: "critical" },
      detail: {
        text: "✖ error · limits endpoint offline",
        tone: "critical",
        label: "",
        status: "✖ error · limits endpoint offline",
      },
    });
    expect(
      new Set([loading.detail.text, unavailable.detail.text, error.detail.text])
        .size,
    ).toBe(3);

    for (const rows of [loading, unavailable, error]) {
      expect(rows.summary.text).not.toContain("\n");
      expect(rows.detail.text).not.toContain("\n");
    }
  });

  test("collapses whitespace and empty messages in error details", () => {
    expect(formatCompactError("limits\nendpoint   offline").detail.text).toBe(
      "✖ error · limits endpoint offline",
    );
    expect(formatCompactError("   ").detail.text).toBe(
      "✖ error · Could not load Go limits",
    );
  });
});
