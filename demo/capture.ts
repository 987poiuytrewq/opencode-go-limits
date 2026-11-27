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
import {
  createMockHost,
  usageAt,
  type MockHost,
} from "../test/integration/host";

// Pin the timezone before any date formatting so runout labels and countdowns
// are byte-for-byte reproducible on every host.
process.env.TZ = "UTC";

const FIXED_NOW = Date.UTC(2026, 10, 27, 12, 45, 0);
const SESSION_ID = "ses_demo_sidebar";
const DAY_MS = 24 * 60 * 60_000;

interface DemoScenario {
  readonly mode: "expanded" | "compact";
  readonly width: number;
  readonly height: number;
  readonly usage: ReturnType<typeof usageAt>;
  readonly output: string;
  readonly title: string;
  readonly validate: (lines: readonly string[], charFrame: string) => void;
}

const compactBase = usageAt(FIXED_NOW, {
  rolling: 70,
  weekly: 10,
  monthly: 66,
});
const expandedBase = usageAt(FIXED_NOW, {
  rolling: 25,
  weekly: 50,
  monthly: 66,
});

const SCENARIOS: readonly DemoScenario[] = [
  {
    mode: "expanded",
    width: 64,
    height: 14,
    usage: expandedBase,
    output: join(import.meta.dir, "expanded.svg"),
    title:
      "OpenCode Go expanded sidebar showing the 5-hour window, Weekly, and Monthly meters",
    validate(lines, charFrame) {
      if (lines.length !== 7) {
        throw new Error(
          `[expanded] Expected the expanded widget to render seven rows, captured ${lines.length}: ${JSON.stringify(lines)}`,
        );
      }
      const visible = lines.join("\n");
      for (const needle of [
        "OpenCode Go",
        "5-hour window",
        "25% ",
        "Weekly",
        "50% ",
        "Monthly",
        "66% ",
        "━",
        "─",
      ]) {
        if (!visible.includes(needle)) {
          throw new Error(
            `[expanded] Expected ${JSON.stringify(needle)} in: ${JSON.stringify(visible)}`,
          );
        }
      }
      if (!charFrame.includes("OpenCode Go") || !charFrame.includes("66%")) {
        throw new Error(
          `[expanded] Unexpected character frame: ${JSON.stringify(charFrame)}`,
        );
      }
    },
  },
  {
    mode: "compact",
    width: 64,
    height: 3,
    usage: {
      rolling: {
        ...compactBase.rolling,
        resetsAt: FIXED_NOW + 1.5 * 60 * 60_000,
      },
      weekly: compactBase.weekly,
      monthly: {
        ...compactBase.monthly,
        resetsAt: FIXED_NOW + 5 * DAY_MS,
      },
    },
    output: join(import.meta.dir, "compact.svg"),
    title:
      "OpenCode Go compact sidebar with a monthly summary and a projected 5-hour runout",
    validate(lines, charFrame) {
      if (
        lines.length !== 2 ||
        !lines[0]?.startsWith("OpenCode Go") ||
        !lines[0]?.endsWith("66%") ||
        lines[1] !== "5-hour window  ⚠ 14:15" ||
        !charFrame.includes("OpenCode Go") ||
        !charFrame.includes("66%") ||
        !charFrame.includes("5-hour window  ⚠ 14:15")
      ) {
        throw new Error(
          `[compact] Unexpected compact rows: ${JSON.stringify(lines)} (frame: ${JSON.stringify(charFrame)})`,
        );
      }
    },
  },
];

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

/** Rebuild a captured row, preserving the gaps between positioned spans. */
function lineText(line: RenderedLine): string {
  let text = "";
  let column = 0;
  for (const draw of line.draws) {
    text += " ".repeat(Math.max(0, draw.column - column));
    text += draw.text;
    column = draw.column + draw.text.length;
  }
  return text;
}

function buildSvg(
  frame: CapturedFrame,
  scenario: Pick<DemoScenario, "mode" | "title">,
): string {
  const lines = drawableLines(frame);
  if (lines.length === 0) {
    throw new Error("Expected the widget to render at least one visible row");
  }

  const windowX = 24;
  const windowY = 16;
  const titleBarHeight = 32;
  const bodyPadding = 24;
  const textOffsetY = 38;
  const bodyWidth = Math.max(
    540,
    ...lines.map((line) => line.endColumn * CHAR_WIDTH + bodyPadding * 2),
  );
  const bodyHeight = lines.length * LINE_HEIGHT + 50;
  const windowHeight = titleBarHeight + bodyHeight;
  const windowWidth = bodyWidth;
  const svgWidth = windowWidth + windowX * 2;
  const captionY = windowY + windowHeight + 30;
  const svgHeight = captionY + 18;

  const textX = (column: number) => windowX + bodyPadding + column * CHAR_WIDTH;
  const firstBaseline = windowY + titleBarHeight + textOffsetY;

  for (const line of lines) {
    for (const draw of line.draws) {
      assertContrast("Captured sidebar text", draw.fill, WINDOW_BG);
    }
  }
  assertContrast("Window title", TITLE_TEXT, TITLE_BG);
  assertContrast("Demo caption", CAPTION_TEXT, PAGE_BG);

  const renderedLines = lines
    .flatMap((line, index) =>
      line.draws.map(
        (draw) =>
          `    <text x="${textX(draw.column)}" y="${firstBaseline + index * LINE_HEIGHT}" fill="${draw.fill}" font-family="${MONO_FONT}" font-size="${BODY_FONT_SIZE}" xml:space="preserve">${escapeXml(draw.text)}</text>`,
      ),
    )
    .join("\n");

  const visibleText = lines.map(lineText).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" role="img" aria-labelledby="demo-title demo-desc">
  <title id="demo-title">${escapeXml(scenario.title)}</title>
  <desc id="demo-desc">Terminal-style screenshot of the OpenCode Go sidebar in ${scenario.mode} mode, captured from a ${frame.cols} by ${frame.rows} character frame rendered with fake usage data. The ${lines.length} visible rows read: ${escapeXml(visibleText)}</desc>
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
    <text x="${windowX + 68}" y="${windowY + 20}" fill="${TITLE_TEXT}" font-family="${MONO_FONT}" font-size="11">OpenCode — session sidebar (${scenario.mode})</text>
${renderedLines}
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

  try {
    const { createTestRenderer } = await import("@opentui/core/testing");
    const { render } = await import("@opentui/solid");
    const { PluginContextProvider } = await import("@opencode/plugin/tui");
    const { default: plugin } = await import("../src/tui");

    /** Render one scenario, assert its rows, and fully dispose its host. */
    const capture = async (scenario: DemoScenario): Promise<CapturedFrame> => {
      const setup = await createTestRenderer({
        width: scenario.width,
        height: scenario.height,
      });
      const renderer = setup.renderer;
      const frameListeners = renderer.listenerCount("frame");
      const resizeListeners = renderer.listenerCount("resize");
      let host: MockHost | undefined;
      let release: (() => void) | undefined;
      let captured: CapturedFrame | undefined;

      try {
        const mockHost = createMockHost({
          renderer,
          usage: scenario.usage,
          options: { mode: scenario.mode, refreshMs: 60_000 },
        });
        host = mockHost;
        release = (await plugin.setup(mockHost.context)) ?? undefined;
        const claim = mockHost.claims[0];
        if (!claim) {
          throw new Error(`[${scenario.mode}] Plugin did not register a slot`);
        }

        await render(
          () =>
            PluginContextProvider({
              value: mockHost.context,
              get children() {
                return claim.render({ sessionID: SESSION_ID });
              },
            }),
          setup.renderer,
        );
        await setup.flush();

        if (frozen.timers.size !== 1) {
          throw new Error(
            `[${scenario.mode}] Expected the frozen clock to capture one refresh timer, got ${frozen.timers.size}`,
          );
        }

        const charFrame = setup.captureCharFrame();
        captured = setup.captureSpans();
        scenario.validate(drawableLines(captured).map(lineText), charFrame);

        if (mockHost.requests.length !== 1) {
          throw new Error(
            `[${scenario.mode}] Expected one mock usage request, captured ${mockHost.requests.length}`,
          );
        }
      } finally {
        release?.();
        release = undefined;
        await setup.dispose();
      }

      if (host?.released !== 1 || host.claims.length !== 0) {
        throw new Error(
          `[${scenario.mode}] Plugin slot claim was not released during cleanup`,
        );
      }
      if (frozen.timers.size > 0) {
        throw new Error(
          `[${scenario.mode}] Refresh timers survived renderer disposal: ${frozen.timers.size}`,
        );
      }
      if (frameListeners !== renderer.listenerCount("frame")) {
        throw new Error(
          `[${scenario.mode}] Plugin did not release its frame listener`,
        );
      }
      if (resizeListeners !== renderer.listenerCount("resize")) {
        throw new Error(
          `[${scenario.mode}] Plugin did not release its resize listener`,
        );
      }
      if (!captured) {
        throw new Error(`[${scenario.mode}] Renderer captured no frame`);
      }
      return captured;
    };

    const rendered: Array<{ scenario: DemoScenario; frame: CapturedFrame }> =
      [];
    for (const scenario of SCENARIOS) {
      rendered.push({ scenario, frame: await capture(scenario) });
    }

    for (const { scenario, frame } of rendered) {
      await writeFile(scenario.output, buildSvg(frame, scenario), "utf8");
      console.log(`Wrote ${scenario.output}`);
      console.log(drawableLines(frame).map(lineText).join("\n"));
      console.log("");
    }
  } finally {
    frozen.restore();
  }
}

await main();
