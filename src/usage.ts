import type { UsageLimitsGo } from "@opencode/client";

export type LimitName = "rolling" | "weekly" | "monthly";
export type GoUsage = UsageLimitsGo;

export type RunoutEstimate =
  | { kind: "idle" }
  | { kind: "after-reset" }
  | { kind: "reached" }
  | { kind: "estimate"; inMs: number };

/** Format a projected limit date for the compact sidebar warning. */
export function formatRunoutDate(
  limit: LimitName,
  projection: RunoutEstimate,
  now: number,
): string {
  if (projection.kind !== "estimate") return "";
  const date = new Date(now + projection.inMs);

  if (limit === "rolling") {
    const roundedMinutes = Math.round(date.getMinutes() / 15) * 15;
    date.setSeconds(0, 0);
    if (roundedMinutes === 60) {
      date.setHours(date.getHours() + 1);
      date.setMinutes(0);
    } else {
      date.setMinutes(roundedMinutes);
    }
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  if (limit !== "monthly") {
    const minutes = date.getMinutes();
    date.setMinutes(0, 0, 0);
    if (minutes >= 30) date.setHours(date.getHours() + 1);
    const weekday = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
    }).format(date);
    const time = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: true,
    })
      .format(date)
      .replace(/\s/g, "")
      .toLowerCase();
    return `${weekday} ${time}`;
  }

  const monthDay = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
  return monthDay;
}

function windowStart(limit: LimitName, resetsAt: number): number {
  if (limit === "rolling") return resetsAt - 5 * 60 * 60_000;
  if (limit === "weekly") return resetsAt - 7 * 24 * 60 * 60_000;

  const reset = new Date(resetsAt);
  const year = reset.getUTCFullYear();
  const previousMonth = reset.getUTCMonth() - 1;
  const previousYear = previousMonth < 0 ? year - 1 : year;
  const normalizedMonth = (previousMonth + 12) % 12;
  const lastDay = new Date(
    Date.UTC(previousYear, normalizedMonth + 1, 0),
  ).getUTCDate();
  return Date.UTC(
    previousYear,
    normalizedMonth,
    Math.min(reset.getUTCDate(), lastDay),
    reset.getUTCHours(),
    reset.getUTCMinutes(),
    reset.getUTCSeconds(),
    reset.getUTCMilliseconds(),
  );
}

/** Estimate limit exhaustion from average usage since the current window began. */
export function estimateRunout(
  limit: LimitName,
  meter: GoUsage[LimitName],
  now: number,
): RunoutEstimate {
  if (meter.limited || meter.percent >= 100) return { kind: "reached" };
  if (meter.percent <= 0) return { kind: "idle" };
  if (meter.resetsAt <= now) return { kind: "after-reset" };

  const elapsed = now - windowStart(limit, meter.resetsAt);
  if (elapsed <= 0) return { kind: "idle" };

  const inMs = (elapsed * (100 - meter.percent)) / meter.percent;
  if (inMs > meter.resetsAt - now) return { kind: "after-reset" };
  return { kind: "estimate", inMs };
}

/** Split an Ensemble-style line progress bar into used and remaining glyphs. */
export function formatProgressBar(
  percent: number,
  width: number,
): { filled: string; empty: string } {
  const safeWidth = Math.max(0, Math.floor(width));
  const safePercent = Number.isFinite(percent)
    ? Math.min(100, Math.max(0, percent))
    : 0;
  const filledWidth = Math.min(
    safeWidth,
    Math.round((safePercent / 100) * safeWidth),
  );
  return {
    filled: "━".repeat(filledWidth),
    empty: "─".repeat(safeWidth - filledWidth),
  };
}

/** Format a percentage as a two-character number followed by `% `. */
export function formatPercentPrefix(percent: number): string {
  const safePercent = Number.isFinite(percent)
    ? Math.min(100, Math.max(0, percent))
    : 0;
  return `${String(Math.round(safePercent)).padStart(2, " ")}% `;
}

/** Size the bar after its left-side percentage prefix. */
export function getProgressBarWidth(
  sidebarWidth: number,
  percent: number,
): number {
  if (!Number.isFinite(sidebarWidth)) return 1;
  return Math.max(
    1,
    Math.floor(sidebarWidth) - formatPercentPrefix(percent).length,
  );
}

/** Format a reset timestamp as a compact relative countdown. */
export function formatResetCountdown(
  resetsAt: string | number,
  now = new Date(),
): string {
  const resetTime =
    typeof resetsAt === "number" ? resetsAt : Date.parse(resetsAt);
  if (!Number.isFinite(resetTime) || resetTime <= now.getTime()) return "now";

  const millisecondsLeft = resetTime - now.getTime();
  if (millisecondsLeft < 60_000) return "<1m";
  const minutesLeft = Math.ceil(millisecondsLeft / 60_000);

  const days = Math.floor(minutesLeft / (24 * 60));
  if (days > 0) {
    const hours = Math.floor((minutesLeft % (24 * 60)) / 60);
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }

  const hours = Math.floor(minutesLeft / 60);
  const minutes = minutesLeft % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}
