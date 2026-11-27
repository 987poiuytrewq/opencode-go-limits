/**
 * Render the expanded and pace sidebars through the real OpenTUI test renderer
 * and write deterministic SVG screenshots.
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
import {
  TextAttributes,
  type CapturedFrame,
  type CapturedLine,
  type CapturedSpan,
  type RGBA,
} from "@opentui/core";
import { createMockHost, type MockHost } from "../test/integration/host";
import type { UsageLimitsGo } from "@opencode/client";

// Pin the timezone before any date formatting so runout labels and countdowns
// are byte-for-byte reproducible on every host.
process.env.TZ = "UTC";

const FIXED_NOW = Date.UTC(2026, 10, 27, 12, 45, 0);
const SESSION_ID = "ses_demo_sidebar";

// Content width of OpenCode's default session sidebar, so the captures match
// what users actually see rather than an artificially wide panel.
const SIDEBAR_COLUMNS = 40;

interface DemoScenario {
  readonly mode: "expanded" | "pace";
  readonly width: number;
  readonly height: number;
  readonly usage: UsageLimitsGo;
  readonly output: string;
  readonly title: string;
  readonly validate: (
    lines: readonly string[],
    charFrame: string,
    captured: CapturedFrame,
  ) => void;
}

const HOUR = 60 * 60_000;

// One balanced dataset shared by both views, so the screenshots tell the same
// story: the 5-hour meter is behind pace, weekly is ahead of pace (and so
// shows a runout warning in the full view), and monthly is comfortably behind.
const DEMO_USAGE: UsageLimitsGo = {
  rolling: { percent: 42, limited: false, resetsAt: FIXED_NOW + 2.5 * HOUR },
  weekly: { percent: 61, limited: false, resetsAt: FIXED_NOW + 84 * HOUR },
  monthly: {
    percent: 28,
    limited: false,
    resetsAt: FIXED_NOW + 20 * 24 * HOUR,
  },
};

const SCENARIOS: readonly DemoScenario[] = [
  {
    mode: "expanded",
    width: SIDEBAR_COLUMNS,
    height: 14,
    usage: DEMO_USAGE,
    output: join(import.meta.dir, "expanded.svg"),
    title:
      "OpenCode Go expanded sidebar showing the 5-hour, Weekly, and Monthly meters",
    validate(lines, charFrame) {
      if (lines.length !== 7) {
        throw new Error(
          `[expanded] Expected the expanded widget to render seven rows, captured ${lines.length}: ${JSON.stringify(lines)}`,
        );
      }
      const visible = lines.join("\n");
      for (const needle of [
        "OpenCode Go",
        "5-hour",
        "42% ",
        "Weekly",
        "61% ",
        "Monthly",
        "28% ",
        "⚠",
        "━",
        "─",
      ]) {
        if (!visible.includes(needle)) {
          throw new Error(
            `[expanded] Expected ${JSON.stringify(needle)} in: ${JSON.stringify(visible)}`,
          );
        }
      }
      if (!charFrame.includes("OpenCode Go") || !charFrame.includes("28%")) {
        throw new Error(
          `[expanded] Unexpected character frame: ${JSON.stringify(charFrame)}`,
        );
      }
    },
  },
  {
    // Pace: rolling is behind pace, weekly is ahead, monthly is behind.
    mode: "pace",
    width: SIDEBAR_COLUMNS,
    height: 5,
    usage: DEMO_USAGE,
    output: join(import.meta.dir, "pace.svg"),
    title:
      "OpenCode Go pace sidebar with a bold title and behind-pace, ahead-of-pace, and critical monthly bars",
    validate(lines, charFrame, captured) {
      const visible = lines.join("\n");
      const [rolling = "", weekly = "", monthly = ""] = lines.slice(1);
      if (
        lines.length !== 4 ||
        !lines[0]?.match(/^OpenCode Go\s+pace$/) ||
        !rolling?.startsWith("5-hour") ||
        !rolling.endsWith(" 42%") ||
        !weekly?.startsWith("Weekly") ||
        !weekly.endsWith(" 61%") ||
        !monthly?.startsWith("Monthly") ||
        !monthly.endsWith(" 28%") ||
        visible.includes("limit reached") ||
        visible.includes("✖") ||
        !visible.includes("━") ||
        !visible.includes("─") ||
        !charFrame.includes("OpenCode Go")
      ) {
        throw new Error(
          `[pace] Unexpected pace rows: ${JSON.stringify(lines)} (frame: ${JSON.stringify(charFrame)})`,
        );
      }

      // Label → bar → right-aligned percentage: reserve only the longest label
      // plus one separator, then use the remaining width for equal bars.
      const rows = [rolling, weekly, monthly];
      const barColumns = rows.map((line) => line.indexOf("━"));
      const percentColumns = rows.map((line) => line.indexOf("%") - 3);
      const rowWidths = rows.map((line) => line.length);
      if (
        barColumns.some((column) => column < 0 || column !== barColumns[0]) ||
        barColumns[0] !== 8 ||
        percentColumns.some(
          (column) => column < 0 || column !== percentColumns[0],
        ) ||
        percentColumns[0] !== SIDEBAR_COLUMNS - 4 ||
        rowWidths.some((width) => width !== SIDEBAR_COLUMNS)
      ) {
        throw new Error(
          `[pace] Expected aligned labels/bars/percentages at width ${SIDEBAR_COLUMNS}, got bars ${JSON.stringify(barColumns)}, percents ${JSON.stringify(percentColumns)}, widths ${JSON.stringify(rowWidths)} in ${JSON.stringify(lines)}`,
        );
      }

      // The composite bars must show on-pace, behind-pace, and ahead-of-pace
      // segments, and nothing critical.
      const fills = new Set(
        captured.lines.flatMap((line) =>
          line.spans.map((span) => hexColor(span.fg)),
        ),
      );
      if (fills.has("#f85149")) {
        throw new Error("[pace] The demo should not render a critical meter");
      }
      for (const color of ["#3fb950", "#8b949e", "#d29922"]) {
        if (!fills.has(color)) {
          throw new Error(
            `[pace] Expected the fixture palette color ${color} in: ${JSON.stringify([...fills])}`,
          );
        }
      }
    },
  },
];

// Window chrome modelled on OpenCode's default dark theme: a near-black
// terminal behind a slightly raised sidebar panel.
const WINDOW_BG = "#0a0a0a";
const PANEL_BG = "#141414";
const PANEL_BORDER = "#2a2a2a";
const MONO_FONT =
  "'JetBrains Mono', SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
// One terminal cell. Text is stretched to exactly this pitch with `textLength`
// so columns line up regardless of which monospace font the viewer has.
const CELL_WIDTH = 10;
const CELL_HEIGHT = 24;
const FONT_SIZE = 16;
const PANEL_PADDING_X = 20;
const PANEL_PADDING_Y = 16;
const WINDOW_MARGIN = 12;
const RADIUS = 10;
// Box-drawing bar glyphs are drawn as rectangles: font glyphs for `━` and `─`
// rarely tile seamlessly, which leaves gaps and misaligned bar ends.
const BAR_GLYPHS: Readonly<Record<string, number>> = { "━": 4, "─": 1 };

interface FrozenGlobals {
  readonly original: {
    readonly date: DateConstructor;
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
  readonly bold: boolean;
}

interface RenderedLine {
  readonly draws: TextDraw[];
  readonly endColumn: number;
}

/**
 * Freeze the clock and capture the plugin's refresh timer instead of running
 * it. `new Date()` must be frozen too: reset countdowns default to the current
 * wall-clock time, so leaving it live would make the screenshot drift.
 */
function freezeGlobals(): FrozenGlobals {
  const realDate = globalThis.Date;
  const original = {
    date: realDate,
    now: realDate.now,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  };
  const timers = new Set<TimerHandle>();

  realDate.now = () => FIXED_NOW;
  globalThis.Date = new Proxy(realDate, {
    construct(target, args) {
      return args.length === 0
        ? new target(FIXED_NOW)
        : Reflect.construct(target, args);
    },
    apply(target) {
      return Reflect.apply(target, undefined, [FIXED_NOW]);
    },
  }) as unknown as DateConstructor;
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
      globalThis.Date = original.date;
      original.date.now = original.now;
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
        draws.push({
          text,
          column: start,
          fill: hexColor(span.fg),
          bold: (span.attributes & TextAttributes.BOLD) !== 0,
        });
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

/**
 * Check the heading's captured attribute. Returns `undefined` for modes that
 * do not render the title; otherwise every title span must be bold.
 */
function hasBoldTitle(frame: CapturedFrame): boolean | undefined {
  const titleSpans = frame.lines
    .flatMap((line) => line.spans)
    .filter((span) => span.text.trim() === "OpenCode Go");
  if (titleSpans.length === 0) return undefined;
  return titleSpans.every(
    (span) => (span.attributes & TextAttributes.BOLD) !== 0,
  );
}

interface BarRun {
  readonly column: number;
  readonly cells: number;
  readonly thickness: number;
  readonly fill: string;
}

/** Split a draw into plain-text runs and box-drawing bar runs. */
function splitDraw(draw: TextDraw): { texts: TextDraw[]; bars: BarRun[] } {
  const texts: TextDraw[] = [];
  const bars: BarRun[] = [];
  const chars = [...draw.text];
  let index = 0;
  while (index < chars.length) {
    const start = index;
    const thickness = BAR_GLYPHS[chars[index] as string];
    if (thickness !== undefined) {
      while (index < chars.length && chars[index] === chars[start]) index++;
      bars.push({
        column: draw.column + start,
        cells: index - start,
        thickness,
        fill: draw.fill,
      });
    } else {
      while (
        index < chars.length &&
        BAR_GLYPHS[chars[index] as string] === undefined
      )
        index++;
      const text = chars.slice(start, index).join("");
      const leading = text.length - text.trimStart().length;
      if (text.trim().length > 0) {
        texts.push({
          ...draw,
          text: text.trim(),
          column: draw.column + start + leading,
        });
      }
    }
  }
  return { texts, bars };
}

function buildSvg(
  frame: CapturedFrame,
  scenario: Pick<DemoScenario, "mode" | "title">,
): string {
  const lines = drawableLines(frame);
  if (lines.length === 0) {
    throw new Error("Expected the widget to render at least one visible row");
  }

  const panelWidth = frame.cols * CELL_WIDTH + PANEL_PADDING_X * 2;
  const panelHeight = lines.length * CELL_HEIGHT + PANEL_PADDING_Y * 2;
  const svgWidth = panelWidth + WINDOW_MARGIN * 2;
  const svgHeight = panelHeight + WINDOW_MARGIN * 2;
  const originX = WINDOW_MARGIN + PANEL_PADDING_X;
  const originY = WINDOW_MARGIN + PANEL_PADDING_Y;

  const elements: string[] = [];
  lines.forEach((line, row) => {
    const top = originY + row * CELL_HEIGHT;
    for (const draw of line.draws) {
      assertContrast("Captured sidebar text", draw.fill, PANEL_BG);
      const { texts, bars } = splitDraw(draw);
      for (const bar of bars) {
        const y = top + (CELL_HEIGHT - bar.thickness) / 2;
        elements.push(
          `    <rect x="${originX + bar.column * CELL_WIDTH}" y="${y}" width="${bar.cells * CELL_WIDTH}" height="${bar.thickness}" fill="${bar.fill}"/>`,
        );
      }
      for (const text of texts) {
        const weight = text.bold ? ' font-weight="bold"' : "";
        const length = [...text.text].length * CELL_WIDTH;
        elements.push(
          `    <text x="${originX + text.column * CELL_WIDTH}" y="${top + CELL_HEIGHT / 2}" dominant-baseline="central" textLength="${length}" lengthAdjust="spacingAndGlyphs" fill="${text.fill}"${weight} xml:space="preserve">${escapeXml(text.text)}</text>`,
        );
      }
    }
  });

  const visibleText = lines.map(lineText).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" role="img" aria-labelledby="demo-title demo-desc">
  <title id="demo-title">${escapeXml(scenario.title)}</title>
  <desc id="demo-desc">The OpenCode Go panel in ${scenario.mode} mode, rendered by OpenTUI at the ${frame.cols}-column sidebar width with fake usage data. The ${lines.length} visible rows read: ${escapeXml(visibleText)}</desc>
  <rect width="${svgWidth}" height="${svgHeight}" rx="${RADIUS + 4}" fill="${WINDOW_BG}"/>
  <rect x="${WINDOW_MARGIN + 0.5}" y="${WINDOW_MARGIN + 0.5}" width="${panelWidth - 1}" height="${panelHeight - 1}" rx="${RADIUS}" fill="${PANEL_BG}" stroke="${PANEL_BORDER}"/>
  <g font-family="${MONO_FONT}" font-size="${FONT_SIZE}">
${elements.join("\n")}
  </g>
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
        scenario.validate(
          drawableLines(captured).map(lineText),
          charFrame,
          captured,
        );
        if (hasBoldTitle(captured) !== true) {
          throw new Error(
            `[${scenario.mode}] Expected the OpenCode Go title span to be bold`,
          );
        }

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
