import {
  LIMITS,
  formatPercentPrefix,
  windowStart,
  type GoUsage,
  type LimitName,
} from "./usage";

/** Tone used for a pace row's percentage and critical status text. */
export type PaceTone = "success" | "warning" | "critical";

/** Fixed label column so the three pace bars start at the same offset. */
export const PACE_LABEL_WIDTH = 13;

/** Glyph counts for one composite pace bar. The counts always sum to width. */
export interface PaceBarSegments {
  /** Successful usage, up to the pace line (green). */
  readonly used: number;
  /** Thick muted progress between usage and the pace line (behind pace). */
  readonly elapsed: number;
  /** Thick warning usage past the pace line (ahead of pace). */
  readonly over: number;
  /** Empty remainder. */
  readonly empty: number;
}

/** Rendered glyph runs for one composite pace bar. */
export interface PaceBarText {
  readonly used: string;
  readonly elapsed: string;
  readonly over: string;
  readonly empty: string;
}

export interface PaceRow {
  readonly limit: LimitName;
  /** Label padded to `PACE_LABEL_WIDTH` for column alignment. */
  readonly label: string;
  /** Two-digit percentage plus its trailing space, for example ` 25% `. */
  readonly percentText: string;
  /** Explicit critical status text, or an empty string when healthy. */
  readonly status: string;
  readonly tone: PaceTone;
  readonly critical: boolean;
  readonly ahead: boolean;
  /** Clamped elapsed-period percentage, or `undefined` for an invalid reset. */
  readonly elapsedPercent: number | undefined;
  readonly segments: PaceBarSegments;
  readonly bar: PaceBarText;
}

export interface PaceBarInput {
  readonly percent: number;
  readonly elapsedPercent: number | undefined;
  readonly critical: boolean;
  readonly width: number;
}

const THICK = "━";
const EMPTY = "─";
const CRITICAL_STATUS = "✖ limit reached";

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, percent));
}

/**
 * Percentage of the current window that has elapsed, clamped to `0`–`100`.
 *
 * The window start reuses the same inference as runout estimates: reset minus
 * five hours for the rolling window, reset minus seven days for the weekly
 * window, and the previous calendar month for the monthly window. The monthly
 * cycle is approximate because Go resets its monthly allowance on the paid
 * period, not necessarily on a calendar month.
 *
 * Returns `undefined` when the reset timestamp is not finite, so callers can
 * fall back to a plain usage bar rather than inventing a pace line.
 */
export function paceElapsedPercent(
  limit: LimitName,
  resetsAt: number,
  now: number,
): number | undefined {
  if (!Number.isFinite(resetsAt) || !Number.isFinite(now)) return undefined;
  if (resetsAt <= now) return 100;

  const start = windowStart(limit, resetsAt);
  if (!Number.isFinite(start)) return undefined;

  const total = resetsAt - start;
  if (total <= 0) return undefined;

  return Math.min(100, Math.max(0, ((now - start) / total) * 100));
}

/** Size the composite bar after the row's label, percentage, and status. */
export function getPaceBarWidth(
  sidebarWidth: number,
  prefixLength: number,
): number {
  if (!Number.isFinite(sidebarWidth)) return 1;
  return Math.max(1, Math.floor(sidebarWidth) - Math.max(0, prefixLength));
}

/**
 * Compute the four composite-bar segments.
 *
 * - Behind pace (`used <= elapsed`): green usage, then thick muted progress up
 *   to the pace line, then empty columns.
 * - Ahead of pace (`used > elapsed`): green usage up to the pace line, then
 *   thick warning usage past it, then empty columns.
 * - Critical (`limited` or `>= 100%`): the whole used segment is red and there
 *   is no pace overlay, so the row reads as one critical state.
 * - Unknown pace (invalid reset): a plain used segment in the row's tone.
 */
export function computePaceBar(input: PaceBarInput): PaceBarSegments {
  const width = Number.isFinite(input.width)
    ? Math.max(0, Math.floor(input.width))
    : 0;
  const percent = clampPercent(input.percent);
  const usedWidth = Math.min(width, Math.round((percent / 100) * width));

  if (input.critical) {
    return { used: usedWidth, elapsed: 0, over: 0, empty: width - usedWidth };
  }

  if (input.elapsedPercent === undefined) {
    return { used: usedWidth, elapsed: 0, over: 0, empty: width - usedWidth };
  }

  const elapsedPercent = clampPercent(input.elapsedPercent);
  const elapsedWidth = Math.min(
    width,
    Math.round((elapsedPercent / 100) * width),
  );

  if (percent <= elapsedPercent) {
    const elapsed = Math.max(0, elapsedWidth - usedWidth);
    return {
      used: usedWidth,
      elapsed,
      over: 0,
      empty: Math.max(0, width - usedWidth - elapsed),
    };
  }

  const used = elapsedWidth;
  const over = Math.max(0, usedWidth - elapsedWidth);
  return {
    used,
    elapsed: 0,
    over,
    empty: Math.max(0, width - used - over),
  };
}

/** Turn segment counts into thick used/elapsed/over runs plus an empty run. */
export function formatPaceBar(segments: PaceBarSegments): PaceBarText {
  const run = (count: number, glyph: string) =>
    glyph.repeat(Math.max(0, Math.floor(count)));
  return {
    used: run(segments.used, THICK),
    elapsed: run(segments.elapsed, THICK),
    over: run(segments.over, THICK),
    empty: run(segments.empty, EMPTY),
  };
}

/** Build the three single-line pace rows for a sidebar of the given width. */
export function buildPaceRows(
  usage: GoUsage,
  now: number,
  sidebarWidth: number,
): readonly PaceRow[] {
  return LIMITS.map(({ id, label }) => {
    const meter = usage[id];
    const percent = clampPercent(meter.percent);
    const critical = meter.limited || percent >= 100;
    const elapsedPercent = paceElapsedPercent(id, meter.resetsAt, now);
    const ahead =
      !critical && elapsedPercent !== undefined && percent > elapsedPercent;
    const tone: PaceTone = critical
      ? "critical"
      : elapsedPercent === undefined
        ? percent >= 80
          ? "warning"
          : "success"
        : ahead
          ? "warning"
          : "success";
    const percentText = formatPercentPrefix(percent);
    const status = critical ? CRITICAL_STATUS : "";
    const labelText = `${label.padEnd(PACE_LABEL_WIDTH)} `;
    const prefixLength =
      labelText.length + percentText.length + (status ? status.length + 2 : 0);
    const segments = computePaceBar({
      percent,
      elapsedPercent,
      critical,
      width: getPaceBarWidth(sidebarWidth, prefixLength),
    });

    return {
      limit: id,
      label: labelText,
      percentText,
      status,
      tone,
      critical,
      ahead,
      elapsedPercent,
      segments,
      bar: formatPaceBar(segments),
    };
  });
}
