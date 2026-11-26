# OpenCode Go Limits

A local OpenCode terminal UI plugin that displays the OpenCode Go rolling
5-hour, weekly, and monthly usage meters in the sidebar. Progress bars use
Ensemble's responsive `━` / `─` rendering and semantic theme colors. It also
shows a runout estimate based on average usage since the window began.

## Requirements

- OpenCode with TUI plugin support
- Bun
- A connected OpenCode Console workspace with Go usage available

## Install locally

Install dependencies from this directory:

```sh
bun install
```

Add the package directory to your OpenCode CLI plugin list in
`~/.config/opencode/cli.json` (or `$XDG_CONFIG_HOME/opencode/cli.json`):

```json
{
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-go-limits",
      "options": {
        "refreshMs": 60000
      }
    }
  ]
}
```

The sidebar updates once per minute by default. `refreshMs` is optional and is
clamped to a 15-second minimum and 30-minute maximum.
Runout estimates extrapolate from the current percentage and elapsed time in
each window. Rolling and weekly starts are derived from their reset times; the
monthly start is inferred from the previous calendar-month date, so monthly
estimates are approximate. Estimates beyond a window's reset time are not
shown as a runout.

The plugin does not display billed spend. OpenCode's local per-model session
cost statistics do not expose the billing source needed to confirm actual
charges. See **Console › Activity › Usage** and **Settings › Billing** for
account-level spend and balance.

## Development

```sh
bun test
bun run typecheck
```

The plugin uses OpenCode's documented TUI `sidebar.content` slot and the
server's experimental usage-limits API. It does not access API keys directly.
