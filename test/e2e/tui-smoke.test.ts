import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { diagnostics, E2EHost, isE2E, type TmuxPane } from "./harness";

describe.skipIf(!isE2E())(
  "E2E: real OpenCode TUI loads the Go limits sidebar",
  () => {
    let host: E2EHost;
    let pane: TmuxPane;

    beforeAll(async () => {
      try {
        host = await E2EHost.create();
        pane = await host.startTui(`tui-${Date.now()}`);
        // The home composer is the first stable screen. OpenCode appears in the
        // composer footer even before a session exists.
        await pane.waitForText("OpenCode", 45_000);
      } catch (error) {
        host?.markFailed();
        if (pane) console.error(await diagnostics(pane, host));
        else if (host) console.error(host.readLogTail());
        throw error;
      }
    }, 120_000);

    afterAll(async () => {
      await host?.cleanup();
    });

    test("the session sidebar renders the OpenCode Go heading", async () => {
      try {
        // Ctrl+X is OpenCode's default leader; N starts a new session. In the V2
        // TUI the home composer becomes a session once the first prompt is
        // submitted, which is also when the sidebar mounts.
        await pane.sendKey("C-x");
        await Bun.sleep(500);
        await pane.sendKey("n");
        await Bun.sleep(500);

        // No credentials or network behavior is asserted. The heading is the
        // stable plugin surface even when the usage request has no Go workspace.
        await pane.sendLiteral("e2e");
        await pane.sendKey("Enter");

        const screen = await pane.waitForText("OpenCode Go", 60_000);
        expect(screen).toContain("OpenCode Go");
      } catch (error) {
        host.markFailed();
        console.error(await diagnostics(pane, host));
        throw error;
      }
    }, 120_000);
  },
);
