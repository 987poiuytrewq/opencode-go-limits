import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { TextAttributes } from "@opentui/core";
import { Plugin, usePlugin } from "@opencode/plugin/tui";
import {
  estimateRunout,
  formatRunoutDate,
  formatPercentPrefix,
  formatProgressBar,
  formatResetCountdown,
  getProgressBarWidth,
  type GoUsage,
  type LimitName,
} from "./usage";

interface LayoutMeasureNode {
  getLayout?: () => { width: number };
  getLayoutNode?: () => { getComputedWidth: () => number };
}

function getLayoutWidth(
  node: LayoutMeasureNode | undefined,
): number | undefined {
  const layoutWidth = node?.getLayout?.().width;
  if (layoutWidth && layoutWidth > 0) return layoutWidth;
  return node?.getLayoutNode?.().getComputedWidth();
}

const LIMITS: { id: LimitName; label: string }[] = [
  { id: "rolling", label: "5-hour window" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
];
const DEFAULT_REFRESH_MS = 60_000;
const MIN_REFRESH_MS = 15_000;
const MAX_REFRESH_MS = 30 * 60_000;

function pluginSettings(options: unknown): { refreshMs: number } {
  if (typeof options !== "object" || options === null) {
    return { refreshMs: DEFAULT_REFRESH_MS };
  }

  const settings = options as Record<string, unknown>;
  const refreshCandidate = settings.refreshMs;
  const refreshMs =
    typeof refreshCandidate === "number" && Number.isFinite(refreshCandidate)
      ? Math.min(MAX_REFRESH_MS, Math.max(MIN_REFRESH_MS, refreshCandidate))
      : DEFAULT_REFRESH_MS;

  return { refreshMs };
}

function QuotaWidget(props: { refreshMs: number }) {
  const context = usePlugin();
  const [usage, setUsage] = createSignal<GoUsage>();
  const [error, setError] = createSignal<string>();
  const [loading, setLoading] = createSignal(true);
  const [barWidth, setBarWidth] = createSignal(1);
  let sidebarBox: LayoutMeasureNode | undefined;
  let requestPending = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const measureBar = () => {
    const width = getLayoutWidth(sidebarBox);
    if (!width || !Number.isFinite(width)) return;
    const next = Math.floor(width);
    setBarWidth((current) => (current === next ? current : next));
  };

  const refresh = async () => {
    if (requestPending) return;

    requestPending = true;
    try {
      const response = await context.client.experimental.usage.limits({
        location: context.location ?? context.data.location.default(),
      });
      if (response.data?.go) {
        setUsage(response.data.go);
        setError(undefined);
      } else {
        setUsage(undefined);
        setError("OpenCode Go usage is unavailable for this workspace");
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not load Go limits",
      );
    } finally {
      requestPending = false;
      setLoading(false);
    }
  };

  onMount(() => {
    void refresh();
    timer = setInterval(() => void refresh(), props.refreshMs);
    context.renderer.on("frame", measureBar);
    context.renderer.on("resize", measureBar);
    measureBar();
  });
  onCleanup(() => {
    if (timer) clearInterval(timer);
    context.renderer.off("frame", measureBar);
    context.renderer.off("resize", measureBar);
  });

  return (
    <box
      ref={(node) => (sidebarBox = node)}
      onSizeChange={measureBar}
      flexDirection="column"
      width="100%"
      flexGrow={1}
      minWidth={0}
    >
      <box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        width="100%"
      >
        <text fg={context.theme.text.base} attributes={TextAttributes.BOLD}>
          OpenCode Go
        </text>
      </box>
      <Show
        when={usage()}
        fallback={<text>{loading() ? "Loading limits…" : error()}</text>}
      >
        {(data) => (
          <>
            <For each={LIMITS}>
              {(limit) => {
                const meter = () => data()[limit.id];
                const bar = () =>
                  formatProgressBar(
                    meter().percent,
                    getProgressBarWidth(barWidth(), meter().percent),
                  );
                const projection = () =>
                  estimateRunout(limit.id, meter(), Date.now());
                const color = () =>
                  meter().limited || meter().percent >= 100
                    ? context.theme.text.feedback.error.base
                    : meter().percent >= 80
                      ? context.theme.text.feedback.warning.base
                      : context.theme.text.feedback.success.base;

                return (
                  <box flexDirection="column" width="100%">
                    <box
                      flexDirection="row"
                      justifyContent="space-between"
                      alignItems="center"
                      width="100%"
                    >
                      <box flexDirection="row" alignItems="center">
                        <text fg={context.theme.text.base}>{limit.label}</text>
                        <Show when={projection().kind === "estimate"}>
                          <text fg={context.theme.text.feedback.warning.base}>
                            {" "}
                            ⚠{" "}
                            {formatRunoutDate(
                              limit.id,
                              projection(),
                              Date.now(),
                            )}
                          </text>
                        </Show>
                      </box>
                      <text fg={context.theme.text.muted}>
                        {formatResetCountdown(meter().resetsAt)}
                      </text>
                    </box>
                    <text width="100%" wrapMode="none">
                      <span style={{ fg: color() }}>
                        {formatPercentPrefix(meter().percent)}
                      </span>
                      <span style={{ fg: color() }}>{bar().filled}</span>
                      <span style={{ fg: context.theme.text.muted }}>
                        {bar().empty}
                      </span>
                    </text>
                  </box>
                );
              }}
            </For>
          </>
        )}
      </Show>
    </box>
  );
}

export default Plugin.define({
  id: "opencode-go-limits",
  setup(context) {
    const settings = pluginSettings(context.options);
    return context.ui.slot({
      append: "sidebar.content",
      render: () => <QuotaWidget {...settings} />,
    });
  },
});
