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

/** Color role for one compact row. `neutral` keeps healthy summaries unstyled. */
export type CompactTone = CompactSeverity | "muted" | "neutral";

export interface CompactStatus {
  readonly severity: CompactSeverity;
  readonly limit: LimitName;
  readonly label: string;
  readonly percent: number;
  readonly limited: boolean;
  readonly resetsAt: number;
  readonly projection: RunoutEstimate;
}

/** One rendered row of the compact sidebar: its text and semantic tone. */
export interface CompactRow {
  readonly text: string;
  readonly tone: CompactTone;
}

/**
 * The second compact row keeps the meter label in the base text color and
 * colors only the status segment that follows it.
 */
export interface CompactDetailRow extends CompactRow {
  readonly label: string;
  readonly status: string;
}

/**
 * The compact sidebar is two rows: the title and a right-aligned monthly
 * percentage on the first row, then the most urgent short-window (5-hour or
 * weekly) status.
 */
export interface CompactRows {
  readonly summary: CompactRow;
  readonly detail: CompactDetailRow;
}

const TITLE = "OpenCode Go";
const MONTHLY = LIMITS.find(({ id }) => id === "monthly") as {
  readonly id: "monthly";
  readonly label: string;
};
const SHORT_LIMITS = LIMITS.filter(({ id }) => id !== "monthly");

const SEVERITY_SYMBOLS: Record<CompactSeverity, string> = {
  critical: "✖",
  warning: "⚠",
  ok: "✓",
};

/** Compact mode always shows the title on the left of the first row. */
export function compactTitle(): string {
  return TITLE;
}

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

function makeStatus(
  id: LimitName,
  label: string,
  usage: GoUsage,
  now: number,
): CompactStatus {
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

/** Rank meters by urgency, keeping the `LIMITS` order for ties. */
function selectMostUrgent(statuses: readonly CompactStatus[]): CompactStatus {
  const critical = statuses.filter((status) => status.severity === "critical");
  if (critical.length > 0) return pickCritical(critical);

  const warnings = statuses.filter((status) => status.severity === "warning");
  if (warnings.length > 0) return pickWarning(warnings);

  return pickHighestPercent(statuses);
}

/** Summarize the monthly meter, which always occupies the first compact row. */
export function selectMonthlyStatus(
  usage: GoUsage,
  now: number,
): CompactStatus {
  return makeStatus(MONTHLY.id, MONTHLY.label, usage, now);
}

/**
 * Choose the most urgent short-window (5-hour or weekly) meter for the second
 * compact row. The monthly meter is summarized separately and never selected.
 */
export function selectCompactStatus(
  usage: GoUsage,
  now: number,
): CompactStatus {
  return selectMostUrgent(
    SHORT_LIMITS.map(({ id, label }) => makeStatus(id, label, usage, now)),
  );
}

/** Format a percentage for a compact row, clamped to `0%`–`100%`. */
export function formatCompactPercent(percent: number): string {
  const safePercent = Number.isFinite(percent)
    ? Math.min(100, Math.max(0, percent))
    : 0;
  return `${Math.round(safePercent)}%`;
}

/**
 * Format the monthly summary for the right-aligned first compact row.
 *
 * The bold title on the left supplies the context, so the summary is a bare
 * percentage (`66%`): no `Monthly` label and no status symbol. Severity is
 * carried by the row tone instead, so the renderer colors it success, warning,
 * or error.
 */
export function formatCompactMonthly(status: CompactStatus): string {
  return formatCompactPercent(status.percent);
}

/**
 * Format the most urgent short-window status for the second compact row.
 *
 * The label and status are returned separately so the renderer can keep the
 * meter label in the base text color. Warnings keep exactly two spaces before
 * `⚠`, matching the requested `5-hour  ⚠ 14:15` shape. Critical and healthy
 * rows use one space.
 */
export function formatCompactShortWindowParts(
  status: CompactStatus,
  now: number,
): { readonly label: string; readonly status: string } {
  const detail =
    status.severity === "critical"
      ? "limit reached"
      : status.severity === "warning" && status.projection.kind === "estimate"
        ? formatRunoutDate(status.limit, status.projection, now)
        : `resets ${formatResetCountdown(status.resetsAt, new Date(now))}`;
  const gap = status.severity === "warning" ? "  " : " ";
  return {
    label: status.label,
    status: `${gap}${SEVERITY_SYMBOLS[status.severity]} ${detail}`,
  };
}

/** Format the whole second compact row as one string. */
export function formatCompactShortWindow(
  status: CompactStatus,
  now: number,
): string {
  const { label, status: statusText } = formatCompactShortWindowParts(
    status,
    now,
  );
  return `${label}${statusText}`;
}

function monthlyTone(status: CompactStatus): CompactTone {
  return status.severity;
}

/** Build both compact rows from a usage payload. */
export function formatCompactStatus(usage: GoUsage, now: number): CompactRows {
  const monthly = selectMonthlyStatus(usage, now);
  const shortWindow = selectCompactStatus(usage, now);
  const { label, status } = formatCompactShortWindowParts(shortWindow, now);

  return {
    summary: {
      text: formatCompactMonthly(monthly),
      tone: monthlyTone(monthly),
    },
    detail: {
      text: `${label}${status}`,
      tone: shortWindow.severity,
      label,
      status,
    },
  };
}

/** Two-row compact status shown while the first request is in flight. */
export function formatCompactLoading(): CompactRows {
  return {
    summary: { text: "…", tone: "muted" },
    detail: {
      text: "… loading limits",
      tone: "muted",
      label: "",
      status: "… loading limits",
    },
  };
}

/** Two-row compact status when the workspace has no Go allowance. */
export function formatCompactUnavailable(): CompactRows {
  return {
    summary: { text: "–", tone: "muted" },
    detail: {
      text: "– Go usage unavailable",
      tone: "muted",
      label: "",
      status: "– Go usage unavailable",
    },
  };
}

/** Two-row compact status for a failed usage request. */
export function formatCompactError(cause: string): CompactRows {
  const message =
    cause.replace(/\s+/g, " ").trim() || "Could not load Go limits";
  const text = `✖ error · ${message}`;
  return {
    summary: { text: "✖", tone: "critical" },
    detail: { text, tone: "critical", label: "", status: text },
  };
}
