import type { CliRenderer } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import type {
  ExperimentalUsageLimitsInput,
  ExperimentalUsageLimitsOutput,
  UsageLimitsGo,
} from "@opencode/client";
import { Plugin } from "@opencode/plugin/tui";

const DEFAULT_DIRECTORY = "/tmp/opencode-go-limits-test";

type Context = Plugin.Context;

/** The one slot claim this plugin is allowed to make. */
export interface SidebarSlotClaim {
  readonly append: "sidebar.content";
  readonly render: (input: { readonly sessionID: string }) => JSX.Element;
}

export interface MockHostOptions {
  readonly renderer: CliRenderer;
  readonly usage?: UsageLimitsGo;
  readonly unavailable?: boolean;
  readonly failure?: Error;
  readonly options?: Record<string, unknown>;
  readonly directory?: string;
}

export interface MockHost {
  readonly context: Context;
  readonly claims: SidebarSlotClaim[];
  readonly requests: Array<ExperimentalUsageLimitsInput | undefined>;
  /** Number of times the host released a slot claim. */
  readonly released: number;
}

/**
 * Build a host context that implements the parts of the TUI plugin API this
 * plugin touches. The cast is limited to this factory so the rest of the
 * suite stays type-checked against the public `Context` interface.
 */
export function createMockHost(input: MockHostOptions): MockHost {
  const directory = input.directory ?? DEFAULT_DIRECTORY;
  const requests: Array<ExperimentalUsageLimitsInput | undefined> = [];
  const claims: SidebarSlotClaim[] = [];
  let released = 0;

  const limits = async (
    request?: ExperimentalUsageLimitsInput,
  ): Promise<ExperimentalUsageLimitsOutput> => {
    requests.push(request);
    if (input.failure) throw input.failure;
    return {
      location: { directory },
      data: input.unavailable
        ? null
        : {
            workspace: { id: "wrk_test", usageURL: "" },
            budgets: [],
            go: input.usage,
          },
    };
  };

  const context = {
    options: input.options ?? {},
    location: undefined,
    app: { version: "test", channel: "test" },
    renderer: input.renderer,
    client: { experimental: { usage: { limits } } },
    data: { location: { default: () => ({ directory }) } },
    attention: {},
    theme: {
      text: {
        base: "#ffffff",
        muted: "#808080",
        feedback: {
          error: { base: "#ff0000" },
          warning: { base: "#ffff00" },
          success: { base: "#00ff00" },
        },
      },
    },
    themeMode: "dark",
    markdown: {},
    keymap: {},
    storage: {},
    ui: {
      slot: (claim: SidebarSlotClaim) => {
        claims.push(claim);
        return () => {
          released += 1;
          const index = claims.indexOf(claim);
          if (index >= 0) claims.splice(index, 1);
        };
      },
    },
  } as unknown as Context;

  return {
    context,
    claims,
    requests,
    get released() {
      return released;
    },
  };
}

/** Build a usage payload anchored to a reset timestamp. */
export function usageAt(
  now: number,
  percents: { rolling: number; weekly: number; monthly: number } = {
    rolling: 25,
    weekly: 50,
    monthly: 80,
  },
): UsageLimitsGo {
  const hour = 60 * 60_000;
  return {
    rolling: {
      percent: percents.rolling,
      limited: false,
      resetsAt: now + hour,
    },
    weekly: {
      percent: percents.weekly,
      limited: false,
      resetsAt: now + 24 * hour,
    },
    monthly: {
      percent: percents.monthly,
      limited: false,
      resetsAt: now + 7 * 24 * hour,
    },
  };
}
