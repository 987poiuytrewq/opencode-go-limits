/**
 * Render the expanded, compact, and pace sidebars through the real OpenTUI test
 * renderer and write deterministic SVG screenshots.
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
  readonly mode: "expanded" | "compact" | "pace";
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
const paceBase = usageAt(FIXED_NOW, {
  rolling: 25,
  weekly: 95,
  monthly: 100,
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
  {
    mode: "pace",
    width: 64,
    height: 4,
    usage: {
      ...paceBase,
      monthly: { ...paceBase.monthly, limited: true },
    },
    output: join(import.meta.dir, "pace.svg"),
    title:
      "OpenCode Go pace sidebar showing behind-pace, ahead-of-pace, and critical monthly bars",
    validate(lines, charFrame) {
      const visible = lines.join("\n");
      if (
        lines.length !== 3 ||
        !lines[0]?.startsWith("5-hour window") ||
        !lines[1]?.startsWith("Weekly") ||
        !lines[2]?.startsWith("Monthly") ||
        !visible.includes("25% ") ||
        !visible.includes("95% ") ||
        !visible.includes("100% ") ||
        !visible.includes("✖ limit reached") ||
        !visible.includes("━") ||
        !visible.includes("─") ||
        !charFrame.includes("✖ limit reached")
      ) {
        throw new Error(
          `[pace] Unexpected pace rows: ${JSON.stringify(lines)} (frame: ${JSON.stringify(charFrame)})`,
        );
      }
    },
  },
];

const PAGE_BG = "#0d1117";
const MONO_FONT =
  "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
const CHAR_WIDTH = 9;
const BODY_FONT_SIZE = 15;
const LINE_HEIGHT = 22;
const PADDING_X = 24;
const PADDING_Y = 20;

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

function buildSvg(
  frame: CapturedFrame,
  scenario: Pick<DemoScenario, "mode" | "title">,
): string {
  const lines = drawableLines(frame);
  if (lines.length === 0) {
    throw new Error("Expected the widget to render at least one visible row");
  }

  const textWidth = Math.max(
    ...lines.map((line) => line.endColumn * CHAR_WIDTH),
  );
  const svgWidth = textWidth + PADDING_X * 2;
  const svgHeight = lines.length * LINE_HEIGHT + PADDING_Y * 2;

  const textX = (column: number) => PADDING_X + column * CHAR_WIDTH;
  const baselineY = (index: number) =>
    PADDING_Y + BODY_FONT_SIZE + index * LINE_HEIGHT;

  for (const line of lines) {
    for (const draw of line.draws) {
      assertContrast("Captured sidebar text", draw.fill, PAGE_BG);
    }
  }

  const renderedLines = lines
    .flatMap((line, index) =>
      line.draws.map((draw) => {
        const weight = draw.bold ? ' font-weight="bold"' : "";
        return `    <text x="${textX(draw.column)}" y="${baselineY(index)}" fill="${draw.fill}" font-family="${MONO_FONT}" font-size="${BODY_FONT_SIZE}"${weight} xml:space="preserve">${escapeXml(draw.text)}</text>`;
      }),
    )
    .join("\n");

  const visibleText = lines.map(lineText).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" role="img" aria-labelledby="demo-title demo-desc">
  <title id="demo-title">${escapeXml(scenario.title)}</title>
  <desc id="demo-desc">Terminal-style screenshot of the OpenCode Go sidebar in ${scenario.mode} mode, captured from a ${frame.cols} by ${frame.rows} character frame rendered with fake usage data. The ${lines.length} visible rows read: ${escapeXml(visibleText)}</desc>
  <rect width="${svgWidth}" height="${svgHeight}" fill="${PAGE_BG}"/>
${renderedLines}
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
        if (hasBoldTitle(captured) === false) {
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
