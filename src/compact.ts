import {
  LIMITS,
  estimateRunout,
  formatResetCountdown,
  formatRunoutDate,
  type GoUsage,
  type LimitName,
  type RunoutEstimate,
} from "./usage";

export type CompactSeverity = "critical" | "warning" | "ok";

export interface CompactStatus {
  readonly severity: CompactSeverity;
  readonly limit: LimitName;
  readonly label: string;
  readonly percent: number;
  readonly limited: boolean;
  readonly resetsAt: number;
  readonly projection: RunoutEstimate;
}

const TITLE = "OpenCode Go";
const SEVERITY_LABELS: Record<CompactSeverity, string> = {
  critical: "LIMIT",
  warning: "WARN",
  ok: "OK",
};
const SEVERITY_SYMBOLS: Record<CompactSeverity, string> = {
  critical: "✖",
  warning: "⚠",
  ok: "✓",
};

function finitePercent(percent: number): number {
  return Number.isFinite(percent) ? percent : 0;
}

function severityFor(
  meter: GoUsage[LimitName],
  projection: RunoutEstimate,
): CompactSeverity {
  if (meter.limited || meter.percent >= 100) return "critical";
  if (meter.percent >= 80 || projection.kind === "estimate") return "warning";
  return "ok";
}

function pickHighestPercent(statuses: readonly CompactStatus[]): CompactStatus {
  return statuses.reduce((best, candidate) =>
    finitePercent(candidate.percent) > finitePercent(best.percent)
      ? candidate
      : best,
  );
}

function pickCritical(statuses: readonly CompactStatus[]): CompactStatus {
  return statuses.reduce((best, candidate) => {
    const difference =
      finitePercent(candidate.percent) - finitePercent(best.percent);
    if (difference > 0) return candidate;
    if (difference < 0) return best;
    return candidate.limited && !best.limited ? candidate : best;
  });
}

function projectedRunoutMs(status: CompactStatus): number | undefined {
  return status.projection.kind === "estimate"
    ? status.projection.inMs
    : undefined;
}

function pickWarning(statuses: readonly CompactStatus[]): CompactStatus {
  const projected = statuses.filter(
    (status) => projectedRunoutMs(status) !== undefined,
  );
  if (projected.length === 0) return pickHighestPercent(statuses);

  return projected.reduce((best, candidate) => {
    const candidateIn = projectedRunoutMs(candidate);
    const bestIn = projectedRunoutMs(best);
    if (candidateIn === undefined) return best;
    if (bestIn === undefined) return candidate;
    if (candidateIn < bestIn) return candidate;
    if (candidateIn > bestIn) return best;
    return finitePercent(candidate.percent) > finitePercent(best.percent)
      ? candidate
      : best;
  });
}

/**
 * Choose the single most urgent Go meter for the compact sidebar line.
 *
 * Critical meters (limited by the API or at/above 100%) always win. Warnings
 * come next, ordered by the earliest projected runout and then by percentage.
 * A healthy panel falls back to the highest percentage in use. Ties keep the
 * meter order in `LIMITS`.
 */
export function selectCompactStatus(
  usage: GoUsage,
  now: number,
): CompactStatus {
  const statuses = LIMITS.map(({ id, label }): CompactStatus => {
    const meter = usage[id];
    const projection = estimateRunout(id, meter, now);
    return {
      severity: severityFor(meter, projection),
      limit: id,
      label,
      percent: meter.percent,
      limited: meter.limited,
      resetsAt: meter.resetsAt,
      projection,
    };
  });

  const critical = statuses.filter((status) => status.severity === "critical");
  if (critical.length > 0) return pickCritical(critical);

  const warnings = statuses.filter((status) => status.severity === "warning");
  if (warnings.length > 0) return pickWarning(warnings);

  return pickHighestPercent(statuses);
}

/** Format a percentage for the compact line, clamped to `0%`–`100%`. */
export function formatCompactPercent(percent: number): string {
  const safePercent = Number.isFinite(percent)
    ? Math.min(100, Math.max(0, percent))
    : 0;
  return `${Math.round(safePercent)}%`;
}

/** Format the selected meter as the one-line compact sidebar status. */
export function formatCompactStatus(
  status: CompactStatus,
  now: number,
): string {
  const detail =
    status.severity === "warning" && status.projection.kind === "estimate"
      ? `runout ${formatRunoutDate(status.limit, status.projection, now)}`
      : `resets ${formatResetCountdown(status.resetsAt, new Date(now))}`;
  const symbol = SEVERITY_SYMBOLS[status.severity];
  const label = SEVERITY_LABELS[status.severity];
  return `${TITLE} ${symbol} ${label} · ${status.label} ${formatCompactPercent(status.percent)} · ${detail}`;
}

/** One-line compact status shown while the first request is in flight. */
export function formatCompactLoading(): string {
  return `${TITLE} … loading limits`;
}

/** One-line compact status when the workspace has no Go allowance. */
export function formatCompactUnavailable(): string {
  return `${TITLE} – Go usage unavailable`;
}

/** One-line compact status for a failed usage request. */
export function formatCompactError(cause: string): string {
  const message =
    cause.replace(/\s+/g, " ").trim() || "Could not load Go limits";
  return `${TITLE} ✖ error · ${message}`;
}
