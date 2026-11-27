import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { TextAttributes } from "@opentui/core";
import { Plugin, usePlugin } from "@opencode/plugin/tui";
import {
  compactTitle,
  formatCompactError,
  formatCompactLoading,
  formatCompactUnavailable,
  formatCompactView,
  type CompactDetailRow,
  type CompactRow,
  type CompactTone,
  type CompactView,
} from "./compact";
import { PACE_TITLE, buildPaceRows, type PaceTone } from "./pace";
import { pluginSettings, type SidebarMode } from "./settings";
import {
  LIMITS,
  estimateRunout,
  formatRunoutDate,
  formatPercentPrefix,
  formatProgressBar,
  formatResetCountdown,
  getProgressBarWidth,
  type GoUsage,
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

function QuotaWidget(props: { refreshMs: number; mode: SidebarMode }) {
  const context = usePlugin();
  const [usage, setUsage] = createSignal<GoUsage>();
  const [error, setError] = createSignal<string>();
  const [unavailable, setUnavailable] = createSignal(false);
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
        setUnavailable(false);
      } else {
        setUsage(undefined);
        setError(undefined);
        setUnavailable(true);
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not load Go limits",
      );
      setUnavailable(false);
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

  const toneColor = (tone: CompactTone | PaceTone) =>
    tone === "critical"
      ? context.theme.text.feedback.error.base
      : tone === "warning"
        ? context.theme.text.feedback.warning.base
        : tone === "ok" || tone === "success"
          ? context.theme.text.feedback.success.base
          : tone === "muted"
            ? context.theme.text.muted
            : context.theme.text.base;

  const paceFallback = (): { text: string; tone: CompactTone } => {
    const failure = error();
    if (failure) return { text: `✖ error · ${failure}`, tone: "critical" };
    if (unavailable()) {
      return { text: "– Go usage unavailable", tone: "muted" };
    }
    return { text: "… loading limits", tone: "muted" };
  };

  const compactView = (): CompactView => {
    const failure = error();
    if (failure) {
      return { kind: "detail", rows: formatCompactError(failure) };
    }
    if (unavailable()) {
      return { kind: "detail", rows: formatCompactUnavailable() };
    }
    if (loading()) {
      return { kind: "detail", rows: formatCompactLoading() };
    }

    const data = usage();
    if (!data) {
      return { kind: "detail", rows: formatCompactUnavailable() };
    }

    return formatCompactView(data, Date.now());
  };

  const compactSummary = (): CompactRow => {
    const view = compactView();
    return view.kind === "healthy" ? view.summary : view.rows.summary;
  };

  const compactDetail = (): CompactDetailRow | undefined => {
    const view = compactView();
    return view.kind === "detail" ? view.rows.detail : undefined;
  };

  return (
    <box
      ref={(node) => (sidebarBox = node)}
      onSizeChange={measureBar}
      flexDirection="column"
      width="100%"
      flexGrow={1}
      minWidth={0}
    >
      <Show when={props.mode === "expanded"}>
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
          fallback={
            <text>
              {loading()
                ? "Loading limits…"
                : (error() ??
                  "OpenCode Go usage is unavailable for this workspace")}
            </text>
          }
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
                          <text fg={context.theme.text.base}>
                            {limit.label}
                          </text>
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
      </Show>
      <Show when={props.mode === "pace"}>
        <text fg={context.theme.text.base} attributes={TextAttributes.BOLD}>
          {PACE_TITLE}
        </text>
        <Show
          when={usage()}
          fallback={
            <text fg={toneColor(paceFallback().tone)}>
              {paceFallback().text}
            </text>
          }
        >
          {(data) => (
            <For each={buildPaceRows(data(), Date.now(), barWidth())}>
              {(row) => (
                <text width="100%" wrapMode="none">
                  <span style={{ fg: context.theme.text.base }}>
                    {row.label}
                  </span>
                  <span
                    style={{
                      fg: row.critical
                        ? context.theme.text.feedback.error.base
                        : context.theme.text.feedback.success.base,
                    }}
                  >
                    {row.bar.used}
                  </span>
                  <span style={{ fg: context.theme.text.muted }}>
                    {row.bar.elapsed}
                  </span>
                  <span
                    style={{ fg: context.theme.text.feedback.warning.base }}
                  >
                    {row.bar.over}
                  </span>
                  <span style={{ fg: context.theme.text.muted }}>
                    {row.bar.empty}
                  </span>
                  <span style={{ fg: toneColor(row.tone) }}>
                    {row.percentText}
                  </span>
                </text>
              )}
            </For>
          )}
        </Show>
      </Show>
      <Show when={props.mode === "compact"}>
        <box
          flexDirection="row"
          justifyContent="space-between"
          alignItems="center"
          width="100%"
        >
          <text fg={context.theme.text.base} attributes={TextAttributes.BOLD}>
            {compactTitle()}
          </text>
          <text fg={toneColor(compactSummary().tone)}>
            {compactSummary().text}
          </text>
        </box>
        <Show when={compactDetail()}>
          {(detail) => (
            <text width="100%" wrapMode="none">
              <span style={{ fg: context.theme.text.base }}>
                {detail().label}
              </span>
              <span style={{ fg: toneColor(detail().tone) }}>
                {detail().status}
              </span>
            </text>
          )}
        </Show>
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
