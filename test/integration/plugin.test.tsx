/** @jsxImportSource @opentui/solid */
import { describe, expect, spyOn, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { render } from "@opentui/solid";
import { PluginContextProvider } from "@opencode/plugin/tui";
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

  test("renders the three Go meters, percentages and reset countdowns", async () => {
    const testRenderer = await createTestRenderer({ width: 64, height: 14 });
    try {
      const host = createMockHost({
        renderer: testRenderer.renderer,
        usage: usageAt(Date.now()),
      });
      const cleanup = await mountHost(host);
      await testRenderer.flush();

      const frame = testRenderer.captureCharFrame();
      expect(frame).toContain("OpenCode Go");
      expect(frame).toContain("5-hour window");
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
  return frame.split("\n").filter((line) => line.trim().length > 0);
}

describe("compact mode", () => {
  test("keeps the expanded layout when mode is not configured", async () => {
    const testRenderer = await createTestRenderer({ width: 64, height: 14 });
    try {
      const host = createMockHost({
        renderer: testRenderer.renderer,
        usage: usageAt(Date.now()),
      });
      const cleanup = await mountHost(host);
      await testRenderer.flush();

      const lines = nonEmptyLines(testRenderer.captureCharFrame());
      expect(lines.length).toBeGreaterThan(1);
      expect(testRenderer.captureCharFrame()).toContain("5-hour window");
      expect(testRenderer.captureCharFrame()).toContain("━━");
      cleanup();
    } finally {
      await testRenderer.dispose();
    }
  });

  test("renders the most urgent warning as one line", async () => {
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
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("OpenCode Go  ⚠ WARN");
      expect(lines[0]).toContain("Monthly 80%");
      expect(lines[0]).not.toContain("5-hour window");
      cleanup();
    } finally {
      await testRenderer.dispose();
    }
  });

  test("renders a limited meter as one critical line", async () => {
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
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("✖ LIMIT");
      expect(lines[0]).toContain("Monthly 100%");
      cleanup();
    } finally {
      await testRenderer.dispose();
    }
  });

  test("keeps unavailable and request-error states distinct on one line", async () => {
    const unavailableRenderer = await createTestRenderer({
      width: 64,
      height: 6,
    });
    const errorRenderer = await createTestRenderer({ width: 64, height: 6 });
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
      expect(unavailableLines).toHaveLength(1);
      expect(unavailableLines[0]).toContain("– Go usage unavailable");
      expect(unavailableLines[0]).not.toContain("error");

      const errorHost = createMockHost({
        renderer: errorRenderer.renderer,
        failure: new Error("limits endpoint offline"),
        options: { mode: "compact" },
      });
      const errorCleanup = await mountHost(errorHost);
      await errorRenderer.flush();
      const errorLines = nonEmptyLines(errorRenderer.captureCharFrame());
      expect(errorLines).toHaveLength(1);
      expect(errorLines[0]).toContain("✖ error");
      expect(errorLines[0]).toContain("limits endpoint offline");
      expect(errorLines[0]).not.toContain("unavailable");

      errorCleanup();
      unavailableCleanup();
    } finally {
      await unavailableRenderer.dispose();
      await errorRenderer.dispose();
    }
  });

  test("renders the loading state as one line", async () => {
    const testRenderer = await createTestRenderer({ width: 64, height: 6 });
    try {
      const host = createMockHost({
        renderer: testRenderer.renderer,
        hang: true,
        options: { mode: "compact" },
      });
      const cleanup = await mountHost(host);
      await testRenderer.flush();

      const lines = nonEmptyLines(testRenderer.captureCharFrame());
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("… loading limits");
      expect(lines[0]).not.toContain("unavailable");
      expect(lines[0]).not.toContain("error");
      cleanup();
    } finally {
      await testRenderer.dispose();
    }
  });
});
