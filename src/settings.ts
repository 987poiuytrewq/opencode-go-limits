/** Refresh cadence when `refreshMs` is missing or not a usable number. */
export const DEFAULT_REFRESH_MS = 60_000;
/** Fastest sidebar refresh the plugin allows. */
export const MIN_REFRESH_MS = 15_000;
/** Slowest sidebar refresh the plugin allows. */
export const MAX_REFRESH_MS = 30 * 60_000;

/** Sidebar layout when `mode` is missing or not a supported value. */
export const DEFAULT_MODE = "pace";

export type SidebarMode = "expanded" | "compact" | "pace";

export interface PluginSettings {
  readonly refreshMs: number;
  readonly mode: SidebarMode;
}

/**
 * Resolve the plugin options supplied by OpenCode.
 *
 * `refreshMs` is optional: non-numeric values fall back to the default and
 * finite values are clamped to the supported range so a bad config cannot
 * hammer the server or leave the sidebar stale. `mode` is optional too: only
 * the exact `expanded`, `compact`, or `pace` values select a layout, and any
 * other value falls back to the default pace layout.
 */
export function pluginSettings(options: unknown): PluginSettings {
  if (typeof options !== "object" || options === null) {
    return { refreshMs: DEFAULT_REFRESH_MS, mode: DEFAULT_MODE };
  }

  const settings = options as Record<string, unknown>;
  const refreshCandidate = settings.refreshMs;
  const refreshMs =
    typeof refreshCandidate === "number" && Number.isFinite(refreshCandidate)
      ? Math.min(MAX_REFRESH_MS, Math.max(MIN_REFRESH_MS, refreshCandidate))
      : DEFAULT_REFRESH_MS;
  const mode: SidebarMode =
    settings.mode === "expanded"
      ? "expanded"
      : settings.mode === "compact"
        ? "compact"
        : settings.mode === "pace"
          ? "pace"
          : DEFAULT_MODE;

  return { refreshMs, mode };
}
