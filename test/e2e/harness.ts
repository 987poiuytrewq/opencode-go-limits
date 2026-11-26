import { spawn } from "bun";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** E2E is opt-in so `make test` and `make ci` stay host-free. */
export function isE2E(): boolean {
  return process.env.E2E === "1" || process.env.E2E === "true";
}

export const OPENCODE_BIN = process.env.OPENCODE_BIN ?? "opencode";

const TMUX_BIN = process.env.TMUX_BIN ?? "tmux";
const E2E_PREFIX = "opencode-go-limits-e2e-";

/** Environment variables kept from the developer/CI host. Everything else,
 * including credentials, is dropped so the test cannot reach a real account. */
const PASSTHROUGH_ENV = ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ"];

function baseEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of PASSTHROUGH_ENV) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

async function exec(
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
): Promise<string> {
  const proc = spawn([command, ...args], {
    cwd: options.cwd,
    env: options.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
    new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited ${code}: ${stderr.trim() || stdout.trim()}`,
    );
  }
  return stdout;
}

async function git(cwd: string, args: string[]): Promise<void> {
  await exec(
    "git",
    [
      "-c",
      "user.name=OpenCode E2E",
      "-c",
      "user.email=e2e@example.invalid",
      ...args,
    ],
    { cwd },
  );
}

function pluginRoot(): string {
  const root = resolve(
    process.env.E2E_PLUGIN_ROOT ?? join(import.meta.dir, "../.."),
  );
  if (root.includes("#")) {
    throw new Error(
      `OpenCode cannot load a plugin from a path containing "#": ${root}\n` +
        "This is a host limitation, not a plugin failure. Run the E2E from a " +
        "clean checkout or set E2E_PLUGIN_ROOT to one.",
    );
  }
  if (!existsSync(join(root, "package.json"))) {
    throw new Error(`E2E plugin root does not contain package.json: ${root}`);
  }
  return root;
}

/** A real tmux session. Each host uses a private tmux socket so the test
 * never touches a developer's own sessions. */
export class TmuxPane {
  private constructor(
    private readonly socket: string,
    readonly name: string,
  ) {}

  static async create(input: {
    socket: string;
    name: string;
    cwd: string;
    command: string[];
    env: Record<string, string>;
    cols?: number;
    rows?: number;
  }): Promise<TmuxPane> {
    const pane = new TmuxPane(input.socket, input.name);
    const args = [
      "-L",
      input.socket,
      "-f",
      "/dev/null",
      "new-session",
      "-d",
      "-s",
      input.name,
      "-x",
      String(input.cols ?? 140),
      "-y",
      String(input.rows ?? 40),
      "-c",
      input.cwd,
    ];
    for (const [key, value] of Object.entries(input.env)) {
      args.push("-e", `${key}=${value}`);
    }
    args.push("--", ...input.command);
    await exec(TMUX_BIN, args, { env: baseEnv() });
    return pane;
  }

  private async tmux(args: string[]): Promise<string> {
    return exec(TMUX_BIN, ["-L", this.socket, ...args], { env: baseEnv() });
  }

  sendKey(key: string): Promise<void> {
    return this.tmux(["send-keys", "-t", this.name, key]).then(() => {});
  }

  sendLiteral(text: string): Promise<void> {
    return this.tmux(["send-keys", "-t", this.name, "-l", text]).then(() => {});
  }

  capture(): Promise<string> {
    return this.tmux(["capture-pane", "-t", this.name, "-p"]);
  }

  async waitForText(text: string, timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let last = "";
    while (Date.now() < deadline) {
      last = await this.capture();
      if (last.includes(text)) return last;
      await Bun.sleep(250);
    }
    throw new Error(
      `Timed out after ${timeoutMs}ms waiting for ${JSON.stringify(text)}. Last pane:\n${last}`,
    );
  }
}

/** Isolated HOME/XDG directories, a temporary git repository, and the global
 * CLI config that points OpenCode at this checkout's ./tui export. */
export class E2EHost {
  readonly root: string;
  readonly home: string;
  readonly repo: string;
  readonly pluginRoot: string;
  readonly cliConfig: string;
  readonly socket: string;
  private keep: boolean;
  private failed = false;

  private constructor(root: string, socket: string, plugin: string) {
    this.root = root;
    this.home = join(root, "home");
    this.repo = join(root, "repo");
    this.pluginRoot = plugin;
    this.cliConfig = join(this.home, ".config", "opencode", "cli.json");
    this.socket = socket;
    this.keep = process.env.E2E_KEEP === "1";
  }

  static async create(): Promise<E2EHost> {
    // Validate the checkout before creating the temporary tree so a host
    // limitation cannot leave an empty artifact directory behind.
    const plugin = pluginRoot();
    const root = mkdtempSync(join(tmpdir(), E2E_PREFIX));
    const socket = `${E2E_PREFIX}${process.pid}-${Date.now()}`;
    const host = new E2EHost(root, socket, plugin);

    try {
      mkdirSync(join(host.home, ".config", "opencode"), { recursive: true });
      mkdirSync(host.repo, { recursive: true });

      await git(host.repo, ["init", "--initial-branch=main"]);
      writeFileSync(join(host.repo, "README.md"), "# E2E fixture\n");
      await git(host.repo, ["add", "."]);
      await git(host.repo, ["commit", "-m", "initial"]);

      writeFileSync(
        host.cliConfig,
        JSON.stringify(
          {
            $schema: "https://opencode.ai/v2/cli.json",
            plugins: [{ package: host.pluginRoot }],
            session: { sidebar: "auto" },
          },
          null,
          2,
        ),
      );
    } catch (error) {
      rmSync(root, { recursive: true, force: true });
      throw error;
    }

    return host;
  }

  env(): Record<string, string> {
    return {
      ...baseEnv(),
      HOME: this.home,
      XDG_CONFIG_HOME: join(this.home, ".config"),
      XDG_DATA_HOME: join(this.home, ".local", "share"),
      XDG_STATE_HOME: join(this.home, ".local", "state"),
      XDG_CACHE_HOME: join(this.home, ".cache"),
      OPENCODE_DISABLE_UPDATE: "1",
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      TERM: "xterm-256color",
      NO_COLOR: "1",
    };
  }

  async startTui(name: string): Promise<TmuxPane> {
    return TmuxPane.create({
      socket: this.socket,
      name,
      cwd: this.repo,
      env: this.env(),
      command: [OPENCODE_BIN, "--standalone"],
    });
  }

  logPath(): string {
    return join(
      this.home,
      ".local",
      "share",
      "opencode",
      "log",
      "opencode.log",
    );
  }

  readLogTail(lines = 200): string {
    try {
      return readFileSync(this.logPath(), "utf8")
        .split("\n")
        .slice(-lines)
        .join("\n");
    } catch {
      return `(no OpenCode log at ${this.logPath()})`;
    }
  }

  markFailed(): void {
    this.failed = true;
  }

  async cleanup(): Promise<void> {
    try {
      await exec(TMUX_BIN, ["-L", this.socket, "kill-server"], {
        env: baseEnv(),
      });
    } catch {}
    if (this.keep || this.failed) {
      console.error(`E2E artifacts kept at ${this.root}`);
      return;
    }
    // OpenCode may still be flushing its isolated data directory just after
    // the tmux server exits, so retry before reporting a cleanup failure.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        rmSync(this.root, { recursive: true, force: true });
        return;
      } catch (error) {
        if (attempt === 4) {
          console.error(
            `Could not remove E2E artifacts at ${this.root}: ${String(error)}`,
          );
          return;
        }
        await Bun.sleep(200);
      }
    }
  }
}

/** Capture everything useful after a failure: pane contents and the host log. */
export async function diagnostics(
  pane: TmuxPane,
  host: E2EHost,
): Promise<string> {
  const parts = [`=== tmux pane: ${pane.name} ===`];
  try {
    parts.push(await pane.capture());
  } catch (error) {
    parts.push(`(pane capture failed: ${String(error)})`);
  }
  parts.push(`=== OpenCode log: ${host.logPath()} ===`);
  parts.push(host.readLogTail());
  return parts.join("\n");
}
