/** @jsxImportSource @opentui/solid */
import { describe, expect, spyOn, test } from "bun:test";
import {
  TextAttributes,
  type CapturedFrame,
  type CapturedSpan,
} from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { render } from "@opentui/solid";
import { PluginContextProvider } from "@opencode/plugin/tui";
import { PACE_PERCENT_WIDTH } from "../../src/pace";
import plugin from "../../src/tui";
import { createMockHost, usageAt, type MockHost } from "./host";

const SESSION_ID = "ses_opencode_go_limits_test";

/** Activate the plugin and mount its sidebar claim into the test renderer. */
async function mountHost(host: MockHost): Promise<() => void> {
  const cleanup = await plugin.setup(host.context);
  const claim = host.claims[0];
  if (!claim) throw new Error("plugin did not register a sidebar slot");

  await render(
    () => (
      <PluginContextProvider value={host.context}>
        {claim.render({ sessionID: SESSION_ID })}
      </PluginContextProvider>
    ),
    host.context.renderer,
  );

  return () => cleanup?.();
}

describe("OpenCode Go limits sidebar plugin", () => {
  test("registers one append claim on sidebar.content and releases it on unload", async () => {
    const testRenderer = await createTestRenderer({ width: 60, height: 12 });
    try {
      const host = createMockHost({ renderer: testRenderer.renderer });
      const cleanup = await plugin.setup(host.context);

      expect(cleanup).toBeFunction();
      expect(host.claims).toHaveLength(1);
      expect(host.claims[0]?.append).toBe("sidebar.content");
      expect(host.claims[0]?.render).toBeFunction();

      cleanup?.();
      expect(host.claims).toHaveLength(0);
      expect(host.released).toBe(1);
    } finally {
      await testRenderer.dispose();
    }
  });

  test("requests usage for the current location when the slot mounts", async () => {
    const testRenderer = await createTestRenderer({ width: 60, height: 12 });
    try {
      const host = createMockHost({
        renderer: testRenderer.renderer,
        usage: usageAt(Date.now()),
      });
      const cleanup = await mountHost(host);
      await testRenderer.flush();

      expect(host.requests).toHaveLength(1);
      expect(host.requests[0]?.location?.directory).toBe(
        "/tmp/opencode-go-limits-test",
      );
      cleanup();
    } finally {
      await testRenderer.dispose();
    }
  });

  test("renders all three two-line meters when mode is explicitly expanded", async () => {
    const testRenderer = await createTestRenderer({ width: 64, height: 14 });
    try {
      const host = createMockHost({
        renderer: testRenderer.renderer,
        usage: usageAt(Date.now()),
        options: { mode: "expanded" },
      });
      const cleanup = await mountHost(host);
      await testRenderer.flush();

      const frame = testRenderer.captureCharFrame();
      expect(nonEmptyLines(frame)).toHaveLength(7);
      expect(frame).toContain("OpenCode Go");
      expect(frame).toContain("5-hour");
      expect(frame).not.toContain("5-hour window");
      expect(frame).toContain("Weekly");
      expect(frame).toContain("Monthly");
      expect(frame).toContain("25% ");
      expect(frame).toContain("50% ");
      expect(frame).toContain("80% ");
      expect(frame).toContain("━");
      expect(frame).toContain("─");
      expect(frame).toContain("1h");
      expect(frame).toContain("1d");
      expect(frame).toContain("7d");
      cleanup();
    } finally {
      await testRenderer.dispose();
    }
  });

  test("warns about projected runouts for each window", async () => {
    const testRenderer = await createTestRenderer({ width: 64, height: 14 });
    try {
      const host = createMockHost({
        renderer: testRenderer.renderer,
        usage: usageAt(Date.now(), { rolling: 90, weekly: 95, monthly: 99 }),
        options: { mode: "expanded" },
      });
      const cleanup = await mountHost(host);
      await testRenderer.flush();

      const warnings = testRenderer.captureCharFrame().match(/⚠/g) ?? [];
      expect(warnings).toHaveLength(3);
      cleanup();
    } finally {
      await testRenderer.dispose();
    }
  });

  test("surfaces a missing Go payload as an unavailable workspace", async () => {
    const testRenderer = await createTestRenderer({ width: 64, height: 10 });
    try {
      const host = createMockHost({
        renderer: testRenderer.renderer,
        unavailable: true,
        options: { mode: "expanded" },
      });
      const cleanup = await mountHost(host);
      await testRenderer.flush();

      expect(testRenderer.captureCharFrame()).toContain(
        "OpenCode Go usage is unavailable for this workspace",
      );
      cleanup();
    } finally {
      await testRenderer.dispose();
    }
  });

  test("surfaces usage request failures", async () => {
    const testRenderer = await createTestRenderer({ width: 64, height: 10 });
    try {
      const host = createMockHost({
        renderer: testRenderer.renderer,
        failure: new Error("limits endpoint offline"),
        options: { mode: "expanded" },
      });
      const cleanup = await mountHost(host);
      await testRenderer.flush();

      expect(testRenderer.captureCharFrame()).toContain(
        "limits endpoint offline",
      );
      cleanup();
    } finally {
      await testRenderer.dispose();
    }
  });

  test("refreshes on the configured interval and cleans up its listeners", async () => {
    const testRenderer = await createTestRenderer({ width: 64, height: 14 });
    const setIntervalSpy = spyOn(globalThis, "setInterval");
    const clearIntervalSpy = spyOn(globalThis, "clearInterval");
    let disposed = false;
    try {
      const frameListeners = testRenderer.renderer.listenerCount("frame");
      const resizeListeners = testRenderer.renderer.listenerCount("resize");
      const host = createMockHost({
        renderer: testRenderer.renderer,
        usage: usageAt(Date.now()),
        options: { refreshMs: 20_000 },
      });
      const cleanup = await mountHost(host);
      await testRenderer.flush();

      expect(testRenderer.renderer.listenerCount("frame")).toBe(
        frameListeners + 1,
      );
      expect(testRenderer.renderer.listenerCount("resize")).toBe(
        resizeListeners + 1,
      );
      expect(host.requests).toHaveLength(1);

      const refreshCall = setIntervalSpy.mock.calls.find(
        (call) => call[1] === 20_000,
      );
      expect(refreshCall).toBeDefined();
      const tick = refreshCall?.[0];
      expect(tick).toBeFunction();
      if (typeof tick !== "function") throw new Error("missing refresh timer");
      tick();
      await testRenderer.waitFor(() => host.requests.length === 2);

      await testRenderer.dispose();
      disposed = true;
      expect(testRenderer.renderer.listenerCount("frame")).toBe(frameListeners);
      expect(testRenderer.renderer.listenerCount("resize")).toBe(
        resizeListeners,
      );
      expect(clearIntervalSpy).toHaveBeenCalled();
      cleanup();
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
      if (!disposed) await testRenderer.dispose();
    }
  });
});

function nonEmptyLines(frame: string): string[] {
  return frame
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
}

function spanColor(spans: CapturedFrame, text: string): string | undefined {
  for (const line of spans.lines) {
    for (const span of line.spans) {
      if (!span.text.includes(text)) continue;
      return `#${span.fg
        .toInts()
        .slice(0, 3)
        .map((channel) => channel.toString(16).padStart(2, "0"))
        .join("")}`;
    }
  }
  return undefined;
}

function colorOf(span: CapturedSpan): string {
  return `#${span.fg
    .toInts()
    .slice(0, 3)
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Whether the first span containing `text` is rendered bold. */
function spanBold(spans: CapturedFrame, text: string): boolean | undefined {
  for (const line of spans.lines) {
    for (const span of line.spans) {
      if (!span.text.includes(text)) continue;
      return (span.attributes & TextAttributes.BOLD) !== 0;
    }
  }
  return undefined;
}

/** Captured spans for the first rendered line containing `needle`. */
function lineSpans(spans: CapturedFrame, needle: string): CapturedSpan[] {
  for (const line of spans.lines) {
    const text = line.spans.map((span) => span.text).join("");
    if (text.includes(needle)) return line.spans;
  }
  throw new Error(`No rendered line contains ${JSON.stringify(needle)}`);
}

/** Zero-based column where the first composite bar glyph starts on a line. */
function barStartColumn(spans: CapturedFrame, needle: string): number {
  let column = 0;
  for (const span of lineSpans(spans, needle)) {
    const offset = span.text.indexOf("━");
    if (offset >= 0) return column + offset;
    column += span.width;
  }
  throw new Error(`No composite bar on the line containing ${needle}`);
}

/** Zero-based column where the percentage field starts on a line. */
function percentStartColumn(spans: CapturedFrame, needle: string): number {
  let column = 0;
  for (const span of lineSpans(spans, needle)) {
    const offset = span.text.indexOf("%");
    if (offset >= 0) {
      return column + offset - (PACE_PERCENT_WIDTH - 1);
    }
    column += span.width;
  }
  throw new Error(`No percentage on the line containing ${needle}`);
}

/** Rendered width of the line containing `needle`, including its sibling spans. */
function lineWidth(spans: CapturedFrame, needle: string): number {
  return lineSpans(spans, needle).reduce(
    (width, span) => width + span.width,
    0,
  );
}

function thickColors(spans: CapturedSpan[]): Set<string> {
  return new Set(
    spans
      .filter((span) => span.text.includes("━"))
      .map((span) => colorOf(span)),
  );
}

describe("compact mode", () => {
  test("collapses to a single normal-text title and green healthy indicator when every meter is healthy", async () => {
    const testRenderer = await createTestRenderer({ width: 64, height: 4 });
    const fixedNow = new Date(2026, 10, 27, 12, 45, 0, 0).getTime();
    const nowSpy = spyOn(Date, "now").mockReturnValue(fixedNow);
    try {
      const host = createMockHost({
        renderer: testRenderer.renderer,
        usage: usageAt(fixedNow, { rolling: 10, weekly: 20, monthly: 66 }),
        options: { mode: "compact" },
      });
      const cleanup = await mountHost(host);
      await testRenderer.flush();

      const lines = nonEmptyLines(testRenderer.captureCharFrame());
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^OpenCode Go\s+●$/);
      expect(lines[0]).not.toContain("%");
      expect(lines[0]).not.toContain("⚠");
      expect(lines[0]).not.toContain("✖");
      expect(lines[0]).not.toContain("Weekly");

      const spans = testRenderer.captureSpans();
      expect(spanBold(spans, "OpenCode Go")).toBe(false);
      expect(spanColor(spans, "OpenCode Go")).toBe("#c9d1d9");
      expect(spanColor(spans, "●")).toBe("#3fb950");
      cleanup();
    } finally {
      nowSpy.mockRestore();
      await testRenderer.dispose();
    }
  });

  test("keeps the two-row detail whenever a meter is warning or critical", async () => {
    const warningRenderer = await createTestRenderer({ width: 64, height: 6 });
    const criticalRenderer = await createTestRenderer({ width: 64, height: 6 });
    const fixedNow = new Date(2026, 10, 27, 12, 45, 0, 0).getTime();
    const nowSpy = spyOn(Date, "now").mockReturnValue(fixedNow);
    try {
      const warningHost = createMockHost({
        renderer: warningRenderer.renderer,
        usage: usageAt(fixedNow, { rolling: 10, weekly: 20, monthly: 85 }),
        options: { mode: "compact" },
      });
      const warningCleanup = await mountHost(warningHost);
      await warningRenderer.flush();
      const warningLines = nonEmptyLines(warningRenderer.captureCharFrame());
      expect(warningLines).toHaveLength(2);
      expect(warningLines[0]).toMatch(/^OpenCode Go\s+85%$/);
      expect(warningLines.join("\n")).not.toContain("●");

      const criticalHost = createMockHost({
        renderer: criticalRenderer.renderer,
        usage: usageAt(fixedNow, { rolling: 100, weekly: 20, monthly: 66 }),
        options: { mode: "compact" },
      });
      const criticalCleanup = await mountHost(criticalHost);
      await criticalRenderer.flush();
      const criticalLines = nonEmptyLines(criticalRenderer.captureCharFrame());
      expect(criticalLines).toHaveLength(2);
      expect(criticalLines[1]).toBe("5-hour ✖ limit reached");
      expect(criticalLines.join("\n")).not.toContain("●");

      criticalCleanup();
      warningCleanup();
    } finally {
      nowSpy.mockRestore();
      await warningRenderer.dispose();
      await criticalRenderer.dispose();
    }
  });

  test("renders the bold title and right-aligned monthly percentage plus the most urgent short-window warning on two rows", async () => {
    const testRenderer = await createTestRenderer({ width: 64, height: 6 });
    const fixedNow = new Date(2026, 10, 27, 12, 45, 0, 0).getTime();
    const nowSpy = spyOn(Date, "now").mockReturnValue(fixedNow);
    try {
      const base = usageAt(fixedNow, { rolling: 70, weekly: 10, monthly: 66 });
      const host = createMockHost({
        renderer: testRenderer.renderer,
        usage: {
          rolling: { ...base.rolling, resetsAt: fixedNow + 1.5 * 60 * 60_000 },
          weekly: { ...base.weekly, resetsAt: fixedNow + 7 * 24 * 60 * 60_000 },
          monthly: {
            ...base.monthly,
            resetsAt: fixedNow + 5 * 24 * 60 * 60_000,
          },
        },
        options: { mode: "compact" },
      });
      const cleanup = await mountHost(host);
      await testRenderer.flush();

      const lines = nonEmptyLines(testRenderer.captureCharFrame());
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatch(/^OpenCode Go\s+66%$/);
      expect(lines[0]?.endsWith("66%")).toBe(true);
      expect(lines[0]).not.toContain("Monthly");
      expect(lines[0]).not.toContain("⚠");
      expect(lines[0]).not.toContain("✖");
      expect(lines[1]).toBe("5-hour  ⚠ 14:15");
      const spans = testRenderer.captureSpans();
      expect(spanColor(spans, "OpenCode Go")).toBe("#c9d1d9");
      expect(spanBold(spans, "OpenCode Go")).toBe(true);
      expect(spanColor(spans, "66%")).toBe("#3fb950");
      expect(spanColor(spans, "5-hour")).toBe("#c9d1d9");
      expect(spanColor(spans, "⚠ 14:15")).toBe("#d29922");
      cleanup();
    } finally {
      nowSpy.mockRestore();
      await testRenderer.dispose();
    }
  });

  test("marks an approaching monthly value on the summary row", async () => {
    const testRenderer = await createTestRenderer({ width: 64, height: 6 });
    try {
      const host = createMockHost({
        renderer: testRenderer.renderer,
        usage: usageAt(Date.now()),
        options: { mode: "compact" },
      });
      const cleanup = await mountHost(host);
      await testRenderer.flush();

      const lines = nonEmptyLines(testRenderer.captureCharFrame());
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatch(/^OpenCode Go\s+80%$/);
      expect(lines[1]).toContain("Weekly ✓ resets 1d");
      const spans = testRenderer.captureSpans();
      expect(spanBold(spans, "OpenCode Go")).toBe(true);
      expect(spanColor(spans, "80%")).toBe("#d29922");
      expect(spanColor(spans, "Weekly")).toBe("#c9d1d9");
      expect(spanColor(spans, "✓ resets 1d")).toBe("#3fb950");
      cleanup();
    } finally {
      await testRenderer.dispose();
    }
  });

  test("renders an exhausted monthly meter as a critical summary row", async () => {
    const testRenderer = await createTestRenderer({ width: 64, height: 6 });
    try {
      const now = Date.now();
      const base = usageAt(now);
      const host = createMockHost({
        renderer: testRenderer.renderer,
        usage: {
          ...base,
          monthly: { ...base.monthly, percent: 100, limited: true },
        },
        options: { mode: "compact" },
      });
      const cleanup = await mountHost(host);
      await testRenderer.flush();

      const lines = nonEmptyLines(testRenderer.captureCharFrame());
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatch(/^OpenCode Go\s+100%$/);
      const spans = testRenderer.captureSpans();
      expect(spanBold(spans, "OpenCode Go")).toBe(true);
      expect(spanColor(spans, "100%")).toBe("#f85149");
      cleanup();
    } finally {
      await testRenderer.dispose();
    }
  });

  test("colors a limited monthly meter red even below 100%", async () => {
    const testRenderer = await createTestRenderer({ width: 64, height: 6 });
    try {
      const base = usageAt(Date.now());
      const host = createMockHost({
        renderer: testRenderer.renderer,
        usage: {
          ...base,
          monthly: { ...base.monthly, percent: 20, limited: true },
        },
        options: { mode: "compact" },
      });
      const cleanup = await mountHost(host);
      await testRenderer.flush();

      const lines = nonEmptyLines(testRenderer.captureCharFrame());
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatch(/^OpenCode Go\s+20%$/);
      expect(spanColor(testRenderer.captureSpans(), "20%")).toBe("#f85149");
      cleanup();
    } finally {
      await testRenderer.dispose();
    }
  });

  test("keeps the short-window label base-colored and colors a critical status", async () => {
    const testRenderer = await createTestRenderer({ width: 64, height: 6 });
    try {
      const base = usageAt(Date.now());
      const host = createMockHost({
        renderer: testRenderer.renderer,
        usage: {
          ...base,
          rolling: { ...base.rolling, percent: 100, limited: true },
        },
        options: { mode: "compact" },
      });
      const cleanup = await mountHost(host);
      await testRenderer.flush();

      const lines = nonEmptyLines(testRenderer.captureCharFrame());
      expect(lines).toHaveLength(2);
      expect(lines[1]).toBe("5-hour ✖ limit reached");
      const spans = testRenderer.captureSpans();
      expect(spanColor(spans, "5-hour")).toBe("#c9d1d9");
      expect(spanColor(spans, "✖ limit reached")).toBe("#f85149");
      cleanup();
    } finally {
      await testRenderer.dispose();
    }
  });

  test("keeps unavailable, request-error, and loading states distinct in two rows", async () => {
    const unavailableRenderer = await createTestRenderer({
      width: 64,
      height: 6,
    });
    const errorRenderer = await createTestRenderer({ width: 64, height: 6 });
    const loadingRenderer = await createTestRenderer({ width: 64, height: 6 });
    try {
      const unavailableHost = createMockHost({
        renderer: unavailableRenderer.renderer,
        unavailable: true,
        options: { mode: "compact" },
      });
      const unavailableCleanup = await mountHost(unavailableHost);
      await unavailableRenderer.flush();
      const unavailableLines = nonEmptyLines(
        unavailableRenderer.captureCharFrame(),
      );
      expect(unavailableLines).toHaveLength(2);
      expect(unavailableLines[0]).toContain("–");
      expect(unavailableLines[0]).not.toContain("Monthly");
      expect(unavailableLines[1]).toContain("– Go usage unavailable");
      expect(unavailableLines[1]).not.toContain("error");
      expect(unavailableLines.join("\n")).not.toContain("●");

      const errorHost = createMockHost({
        renderer: errorRenderer.renderer,
        failure: new Error("limits endpoint offline"),
        options: { mode: "compact" },
      });
      const errorCleanup = await mountHost(errorHost);
      await errorRenderer.flush();
      const errorLines = nonEmptyLines(errorRenderer.captureCharFrame());
      expect(errorLines).toHaveLength(2);
      expect(errorLines[0]).toContain("✖");
      expect(errorLines[0]).not.toContain("Monthly");
      expect(errorLines[1]).toContain("✖ error");
      expect(errorLines[1]).toContain("limits endpoint offline");
      expect(errorLines[1]).not.toContain("unavailable");
      expect(errorLines.join("\n")).not.toContain("●");

      const loadingHost = createMockHost({
        renderer: loadingRenderer.renderer,
        hang: true,
        options: { mode: "compact" },
      });
      const loadingCleanup = await mountHost(loadingHost);
      await loadingRenderer.flush();
      const loadingLines = nonEmptyLines(loadingRenderer.captureCharFrame());
      expect(loadingLines).toHaveLength(2);
      expect(loadingLines[0]).toContain("…");
      expect(loadingLines[0]).not.toContain("Monthly");
      expect(loadingLines[1]).toContain("… loading limits");
      expect(loadingLines[1]).not.toContain("unavailable");
      expect(loadingLines[1]).not.toContain("error");
      expect(loadingLines.join("\n")).not.toContain("●");

      loadingCleanup();
      errorCleanup();
      unavailableCleanup();
    } finally {
      await unavailableRenderer.dispose();
      await errorRenderer.dispose();
      await loadingRenderer.dispose();
    }
  });
});

describe("pace mode", () => {
  test("renders the four-row pace view when mode is not configured", async () => {
    const testRenderer = await createTestRenderer({ width: 64, height: 6 });
    const fixedNow = new Date(2026, 10, 27, 12, 45, 0, 0).getTime();
    const nowSpy = spyOn(Date, "now").mockReturnValue(fixedNow);
    try {
      const host = createMockHost({
        renderer: testRenderer.renderer,
        usage: usageAt(fixedNow),
      });
      const cleanup = await mountHost(host);
      await testRenderer.flush();

      const lines = nonEmptyLines(testRenderer.captureCharFrame());
      expect(lines).toHaveLength(4);
      expect(lines[0]).toBe("OpenCode Go");
      expect(lines[1]).toContain("5-hour");
      expect(lines[1]).toMatch(/ 25%$/);
      expect(lines[2]).toContain("Weekly");
      expect(lines[2]).toMatch(/ 50%$/);
      expect(lines[3]).toContain("Monthly");
      expect(lines[3]).toMatch(/ 80%$/);

      const spans = testRenderer.captureSpans();
      expect(spanBold(spans, "OpenCode Go")).toBe(true);
      const barColumns = ["5-hour", "Weekly", "Monthly"].map((label) =>
        barStartColumn(spans, label),
      );
      expect(barColumns).toEqual([14, 14, 14]);

      cleanup();
    } finally {
      nowSpy.mockRestore();
      await testRenderer.dispose();
    }
  });

  test("renders a bold title and exactly three composite pace rows with behind and ahead segments", async () => {
    const testRenderer = await createTestRenderer({ width: 64, height: 6 });
    const fixedNow = new Date(2026, 10, 27, 12, 45, 0, 0).getTime();
    const nowSpy = spyOn(Date, "now").mockReturnValue(fixedNow);
    try {
      const host = createMockHost({
        renderer: testRenderer.renderer,
        usage: usageAt(fixedNow, { rolling: 25, weekly: 95, monthly: 66 }),
        options: { mode: "pace" },
      });
      const cleanup = await mountHost(host);
      await testRenderer.flush();

      const lines = nonEmptyLines(testRenderer.captureCharFrame());
      expect(lines).toHaveLength(4);
      expect(lines[0]).toBe("OpenCode Go");
      expect(lines[1]).toContain("5-hour");
      expect(lines[1]).toMatch(/ 25%$/);
      expect(lines[2]).toContain("Weekly");
      expect(lines[2]).toMatch(/ 95%$/);
      expect(lines[3]).toContain("Monthly");
      expect(lines[3]).toMatch(/ 66%$/);

      const spans = testRenderer.captureSpans();
      expect(spanBold(spans, "OpenCode Go")).toBe(true);
      expect(spanColor(spans, "OpenCode Go")).toBe("#c9d1d9");
      expect(spanColor(spans, " 25%")).toBe("#3fb950");
      expect(spanColor(spans, " 95%")).toBe("#d29922");
      expect(spanColor(spans, " 66%")).toBe("#3fb950");

      const barColumns = ["5-hour", "Weekly", "Monthly"].map((label) =>
        barStartColumn(spans, label),
      );
      expect(new Set(barColumns).size).toBe(1);
      expect(barColumns[0]).toBe(14);

      const rollingColors = thickColors(lineSpans(spans, "5-hour"));
      expect(rollingColors).toContain("#3fb950");
      expect(rollingColors).toContain("#8b949e");
      expect(rollingColors).not.toContain("#d29922");

      const weeklyColors = thickColors(lineSpans(spans, "Weekly"));
      expect(weeklyColors).toContain("#3fb950");
      expect(weeklyColors).toContain("#d29922");
      expect(weeklyColors).not.toContain("#8b949e");

      cleanup();
    } finally {
      nowSpy.mockRestore();
      await testRenderer.dispose();
    }
  });

  test("right-aligns 1-, 2-, and 3-digit pace percentages on one bar column", async () => {
    const testRenderer = await createTestRenderer({ width: 64, height: 6 });
    const fixedNow = new Date(2026, 10, 27, 12, 45, 0, 0).getTime();
    const nowSpy = spyOn(Date, "now").mockReturnValue(fixedNow);
    try {
      const host = createMockHost({
        renderer: testRenderer.renderer,
        usage: usageAt(fixedNow, { rolling: 5, weekly: 25, monthly: 100 }),
        options: { mode: "pace" },
      });
      const cleanup = await mountHost(host);
      await testRenderer.flush();

      const lines = nonEmptyLines(testRenderer.captureCharFrame());
      expect(lines).toHaveLength(4);
      expect(lines[1]).toMatch(/  5%$/);
      expect(lines[2]).toMatch(/ 25%$/);
      expect(lines[3]).toMatch(/100%$/);

      const spans = testRenderer.captureSpans();
      const labels = ["5-hour", "Weekly", "Monthly"];
      const barColumns = labels.map((label) => barStartColumn(spans, label));
      const percentColumns = labels.map((label) =>
        percentStartColumn(spans, label),
      );
      const rowWidths = labels.map((label) => lineWidth(spans, label));
      expect(barColumns).toEqual([14, 14, 14]);
      expect(percentColumns).toEqual([60, 60, 60]);
      expect(rowWidths).toEqual([64, 64, 64]);
      const barWidths = labels.map(
        (_label, index) =>
          (percentColumns[index] ?? 0) - (barColumns[index] ?? 0),
      );
      expect(new Set(barWidths)).toEqual(new Set([46]));

      cleanup();
    } finally {
      nowSpy.mockRestore();
      await testRenderer.dispose();
    }
  });

  test("renders a limited pace row as unmistakably critical red without status text", async () => {
    const testRenderer = await createTestRenderer({ width: 64, height: 6 });
    const fixedNow = new Date(2026, 10, 27, 12, 45, 0, 0).getTime();
    const nowSpy = spyOn(Date, "now").mockReturnValue(fixedNow);
    try {
      const base = usageAt(fixedNow, { rolling: 25, weekly: 50, monthly: 100 });
      const host = createMockHost({
        renderer: testRenderer.renderer,
        usage: {
          ...base,
          monthly: { ...base.monthly, percent: 100, limited: true },
        },
        options: { mode: "pace" },
      });
      const cleanup = await mountHost(host);
      await testRenderer.flush();

      const lines = nonEmptyLines(testRenderer.captureCharFrame());
      expect(lines).toHaveLength(4);
      expect(lines[0]).toBe("OpenCode Go");
      expect(lines[3]).toContain("Monthly");
      expect(lines[3]).toMatch(/100%$/);
      expect(lines[3]).not.toContain("✖");
      expect(lines[3]).not.toContain("limit reached");

      const spans = testRenderer.captureSpans();
      expect(spanColor(spans, "100%")).toBe("#f85149");
      const monthlySpans = lineSpans(spans, "Monthly");
      const bar = monthlySpans.find((span) => span.text.includes("━"));
      expect(bar).toBeDefined();
      expect(colorOf(bar as CapturedSpan)).toBe("#f85149");
      expect(monthlySpans.map((span) => span.text).join("")).not.toContain("─");

      cleanup();
    } finally {
      nowSpy.mockRestore();
      await testRenderer.dispose();
    }
  });

  test("keeps pace loading, unavailable, and error states distinct below the title", async () => {
    const loadingRenderer = await createTestRenderer({ width: 64, height: 4 });
    const unavailableRenderer = await createTestRenderer({
      width: 64,
      height: 4,
    });
    const errorRenderer = await createTestRenderer({ width: 64, height: 4 });
    try {
      const loadingHost = createMockHost({
        renderer: loadingRenderer.renderer,
        hang: true,
        options: { mode: "pace" },
      });
      const loadingCleanup = await mountHost(loadingHost);
      await loadingRenderer.flush();
      expect(nonEmptyLines(loadingRenderer.captureCharFrame())).toEqual([
        "OpenCode Go",
        "… loading limits",
      ]);

      const unavailableHost = createMockHost({
        renderer: unavailableRenderer.renderer,
        unavailable: true,
        options: { mode: "pace" },
      });
      const unavailableCleanup = await mountHost(unavailableHost);
      await unavailableRenderer.flush();
      expect(nonEmptyLines(unavailableRenderer.captureCharFrame())).toEqual([
        "OpenCode Go",
        "– Go usage unavailable",
      ]);

      const errorHost = createMockHost({
        renderer: errorRenderer.renderer,
        failure: new Error("limits endpoint offline"),
        options: { mode: "pace" },
      });
      const errorCleanup = await mountHost(errorHost);
      await errorRenderer.flush();
      expect(nonEmptyLines(errorRenderer.captureCharFrame())).toEqual([
        "OpenCode Go",
        "✖ error · limits endpoint offline",
      ]);

      loadingCleanup();
      unavailableCleanup();
      errorCleanup();
    } finally {
      await loadingRenderer.dispose();
      await unavailableRenderer.dispose();
      await errorRenderer.dispose();
    }
  });
});
