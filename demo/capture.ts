/**
 * Render the compact sidebar through the real OpenTUI test renderer and write
 * a deterministic SVG screenshot.
 *
 * The usage payload is fake, the clock is frozen, and the only client is the
 * mock host from `test/integration/host.ts`, so the capture never reads real Go
 * usage, credentials, or the network.
 *
 * Run with `make demo` from the repository root.
 */
import "../test/preload";

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  CapturedFrame,
  CapturedLine,
  CapturedSpan,
  RGBA,
} from "@opentui/core";
import type { TestRendererSetup } from "@opentui/core/testing";
import { createMockHost, usageAt } from "../test/integration/host";

// Pin the timezone before any date formatting so runout labels and countdowns
// are byte-for-byte reproducible on every host.
process.env.TZ = "UTC";

const FIXED_NOW = Date.UTC(2026, 10, 27, 9, 30, 0);
const SESSION_ID = "ses_demo_compact_sidebar";
const OUTPUT_PATH = join(import.meta.dir, "demo.svg");

const PAGE_BG = "#0b0e14";
const WINDOW_BG = "#0d1117";
const WINDOW_BORDER = "#30363d";
const TITLE_BG = "#161b26";
const TITLE_TEXT = "#c9d1d9";
const CAPTION_TEXT = "#8b949e";
const MONO_FONT =
  "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
const CHAR_WIDTH = 9;
const BODY_FONT_SIZE = 15;
const LINE_HEIGHT = 22;

interface FrozenGlobals {
  readonly original: {
    readonly now: typeof Date.now;
    readonly setInterval: typeof globalThis.setInterval;
    readonly clearInterval: typeof globalThis.clearInterval;
  };
  readonly timers: Set<TimerHandle>;
  restore(): void;
}

interface TimerHandle {
  readonly callback: () => void;
  readonly delayMs: number;
}

interface TextDraw {
  readonly text: string;
  readonly column: number;
  readonly fill: string;
}

interface RenderedLine {
  readonly draws: TextDraw[];
  readonly endColumn: number;
}

/** Freeze `Date.now` and capture the plugin's refresh timer instead of running it. */
function freezeGlobals(): FrozenGlobals {
  const original = {
    now: Date.now,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  };
  const timers = new Set<TimerHandle>();

  Date.now = () => FIXED_NOW;
  globalThis.setInterval = ((callback: () => void, delayMs?: number) => {
    const handle: TimerHandle = { callback, delayMs: delayMs ?? 0 };
    timers.add(handle);
    return handle as unknown as ReturnType<typeof setInterval>;
  }) as unknown as typeof globalThis.setInterval;
  globalThis.clearInterval = ((handle: TimerHandle) => {
    timers.delete(handle);
  }) as unknown as typeof globalThis.clearInterval;

  return {
    original,
    timers,
    restore() {
      Date.now = original.now;
      globalThis.setInterval = original.setInterval;
      globalThis.clearInterval = original.clearInterval;
    },
  };
}

/** Convert a captured RGBA color to a lowercase `#rrggbb` string. */
function hexColor(color: RGBA): string {
  const [r, g, b] = color.toInts();
  return `#${[r, g, b]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function srgbChannel(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`Unsupported color: ${hex}`);
  const digits = match[1] as string;
  const red = Number.parseInt(digits.slice(0, 2), 16);
  const green = Number.parseInt(digits.slice(2, 4), 16);
  const blue = Number.parseInt(digits.slice(4, 6), 16);
  return (
    0.2126 * srgbChannel(red) +
    0.7152 * srgbChannel(green) +
    0.0722 * srgbChannel(blue)
  );
}

function contrastRatio(foreground: string, background: string): number {
  const light = relativeLuminance(foreground);
  const dark = relativeLuminance(background);
  const lighter = Math.max(light, dark);
  const darker = Math.min(light, dark);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Fail the capture if any visible text drops below WCAG AA body contrast. */
function assertContrast(
  label: string,
  foreground: string,
  background: string,
): void {
  const ratio = contrastRatio(foreground, background);
  if (ratio < 4.5) {
    throw new Error(
      `${label} has contrast ${ratio.toFixed(2)}:1 against ${background}; expected at least 4.5:1`,
    );
  }
}

function drawableLines(frame: CapturedFrame): RenderedLine[] {
  return frame.lines
    .map((line: CapturedLine): RenderedLine => {
      let column = 0;
      let endColumn = 0;
      const draws: TextDraw[] = [];

      for (const span of line.spans as CapturedSpan[]) {
        const start = column;
        column += span.width;
        const text = span.text.trimEnd();
        if (text.trim().length === 0) continue;
        draws.push({ text, column: start, fill: hexColor(span.fg) });
        endColumn = Math.max(endColumn, column);
      }

      return { draws, endColumn };
    })
    .filter((line) => line.draws.length > 0);
}

function buildSvg(frame: CapturedFrame): string {
  const lines = drawableLines(frame);
  if (lines.length !== 1) {
    throw new Error(
      `Expected the compact widget to render one line, captured ${lines.length}`,
    );
  }

  const line = lines[0] as RenderedLine;
  const windowX = 24;
  const windowY = 16;
  const titleBarHeight = 32;
  const bodyPadding = 24;
  const textOffsetY = 38;
  const bodyWidth = Math.max(
    540,
    line.endColumn * CHAR_WIDTH + bodyPadding * 2,
  );
  const bodyHeight = lines.length * LINE_HEIGHT + 50;
  const windowHeight = titleBarHeight + bodyHeight;
  const windowWidth = bodyWidth;
  const svgWidth = windowWidth + windowX * 2;
  const captionY = windowY + windowHeight + 30;
  const svgHeight = captionY + 18;

  const textX = (column: number) => windowX + bodyPadding + column * CHAR_WIDTH;
  const firstBaseline = windowY + titleBarHeight + textOffsetY;

  for (const draw of line.draws) {
    assertContrast("Captured sidebar text", draw.fill, WINDOW_BG);
  }
  assertContrast("Window title", TITLE_TEXT, TITLE_BG);
  assertContrast("Demo caption", CAPTION_TEXT, PAGE_BG);

  const renderedLine = line.draws
    .map(
      (draw) =>
        `    <text x="${textX(draw.column)}" y="${firstBaseline}" fill="${draw.fill}" font-family="${MONO_FONT}" font-size="${BODY_FONT_SIZE}" xml:space="preserve">${escapeXml(draw.text)}</text>`,
    )
    .join("\n");

  const visibleText = lines
    .map((rendered) => rendered.draws.map((draw) => draw.text).join(""))
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" role="img" aria-labelledby="demo-title demo-desc">
  <title id="demo-title">OpenCode Go compact sidebar with a projected rolling runout</title>
  <desc id="demo-desc">Terminal-style screenshot of the OpenCode Go sidebar in compact mode, captured from a ${frame.cols} by ${frame.rows} character frame rendered with fake usage data. The single line reads: ${escapeXml(visibleText)}</desc>
  <rect width="${svgWidth}" height="${svgHeight}" fill="${PAGE_BG}"/>
  <rect x="${windowX}" y="${windowY + 4}" width="${windowWidth}" height="${windowHeight}" rx="10" fill="#000000" opacity="0.45"/>
  <defs>
    <clipPath id="window-clip">
      <rect x="${windowX}" y="${windowY}" width="${windowWidth}" height="${windowHeight}" rx="10"/>
    </clipPath>
  </defs>
  <g clip-path="url(#window-clip)">
    <rect x="${windowX}" y="${windowY}" width="${windowWidth}" height="${windowHeight}" fill="${WINDOW_BG}"/>
    <rect x="${windowX}" y="${windowY}" width="${windowWidth}" height="${titleBarHeight}" fill="${TITLE_BG}"/>
    <line x1="${windowX}" y1="${windowY + titleBarHeight}" x2="${windowX + windowWidth}" y2="${windowY + titleBarHeight}" stroke="${WINDOW_BORDER}"/>
    <circle cx="${windowX + 20}" cy="${windowY + 16}" r="5" fill="#ff5f57"/>
    <circle cx="${windowX + 36}" cy="${windowY + 16}" r="5" fill="#febc2e"/>
    <circle cx="${windowX + 52}" cy="${windowY + 16}" r="5" fill="#28c840"/>
    <text x="${windowX + 68}" y="${windowY + 20}" fill="${TITLE_TEXT}" font-family="${MONO_FONT}" font-size="11">OpenCode — session sidebar (compact)</text>
${renderedLine}
  </g>
  <rect x="${windowX}" y="${windowY}" width="${windowWidth}" height="${windowHeight}" rx="10" fill="none" stroke="${WINDOW_BORDER}"/>
  <text x="${windowX}" y="${captionY}" fill="${CAPTION_TEXT}" font-family="${MONO_FONT}" font-size="11">Rendered with @opentui/core/testing + @opentui/solid · fake Go usage · frozen clock</text>
</svg>
`;
}

async function main(): Promise<void> {
  if (new Date(0).getTimezoneOffset() !== 0) {
    throw new Error(`Demo capture requires UTC, got TZ=${process.env.TZ}`);
  }

  const frozen = freezeGlobals();
  let setup: TestRendererSetup | undefined;
  let release: (() => void) | undefined;
  let failure: unknown;
  let failed = false;

  try {
    const { createTestRenderer } = await import("@opentui/core/testing");
    const { render } = await import("@opentui/solid");
    const { PluginContextProvider } = await import("@opencode/plugin/tui");
    const { default: plugin } = await import("../src/tui");

    setup = await createTestRenderer({ width: 64, height: 3 });
    const renderer = setup.renderer;
    const frameListeners = renderer.listenerCount("frame");
    const resizeListeners = renderer.listenerCount("resize");

    const base = usageAt(FIXED_NOW, { rolling: 86, weekly: 41, monthly: 63 });
    const host = createMockHost({
      renderer: setup.renderer,
      usage: {
        rolling: { ...base.rolling, resetsAt: FIXED_NOW + 3 * 60 * 60_000 },
        weekly: { ...base.weekly, resetsAt: FIXED_NOW + 2 * 24 * 60 * 60_000 },
        monthly: {
          ...base.monthly,
          resetsAt: FIXED_NOW + 12 * 24 * 60 * 60_000,
        },
      },
      options: { mode: "compact", refreshMs: 60_000 },
    });

    release = (await plugin.setup(host.context)) ?? undefined;
    const claim = host.claims[0];
    if (!claim) throw new Error("Plugin did not register a sidebar slot");

    await render(
      () =>
        PluginContextProvider({
          value: host.context,
          get children() {
            return claim.render({ sessionID: SESSION_ID });
          },
        }),
      setup.renderer,
    );
    await setup.flush();

    if (frozen.timers.size !== 1) {
      throw new Error(
        `Expected the frozen clock to capture one refresh timer, got ${frozen.timers.size}`,
      );
    }

    const charFrame = setup.captureCharFrame();
    const captured = setup.captureSpans();
    const visible = drawableLines(captured)
      .map((rendered) => rendered.draws.map((draw) => draw.text).join(""))
      .join("\n");

    if (
      visible !== "OpenCode Go ⚠ WARN · 5-hour window 86% · runout 09:45" ||
      !charFrame.includes(visible)
    ) {
      throw new Error(
        `Unexpected compact line: ${JSON.stringify(visible)} (frame: ${JSON.stringify(charFrame)})`,
      );
    }
    if (host.requests.length !== 1) {
      throw new Error(
        `Expected one mock usage request, captured ${host.requests.length}`,
      );
    }

    await writeFile(OUTPUT_PATH, buildSvg(captured), "utf8");

    const releaseClaim = release;
    release = undefined;
    releaseClaim?.();
    if (host.released !== 1 || host.claims.length !== 0) {
      throw new Error("Plugin slot claim was not released during cleanup");
    }

    const activeSetup = setup;
    setup = undefined;
    await activeSetup.dispose();

    if (frozen.timers.size > 0) {
      throw new Error(
        `Refresh timers survived renderer disposal: ${frozen.timers.size}`,
      );
    }
    if (frameListeners !== renderer.listenerCount("frame")) {
      throw new Error("Plugin did not release its frame listener");
    }
    if (resizeListeners !== renderer.listenerCount("resize")) {
      throw new Error("Plugin did not release its resize listener");
    }

    console.log(`Wrote ${OUTPUT_PATH}`);
    console.log(visible);
  } catch (error) {
    failure = error;
    failed = true;
  } finally {
    let cleanupFailure: unknown;
    let cleanupFailed = false;

    try {
      try {
        release?.();
      } finally {
        if (setup) {
          try {
            await setup.dispose();
          } catch (error) {
            cleanupFailure = error;
            cleanupFailed = true;
          }
        }
      }
    } catch (error) {
      cleanupFailure = error;
      cleanupFailed = true;
    } finally {
      frozen.restore();
    }

    // Keep the primary failure, but surface a cleanup failure when the capture
    // itself succeeded.
    if (!failed && cleanupFailed) throw cleanupFailure;
  }
  if (failed) throw failure;
}

await main();
