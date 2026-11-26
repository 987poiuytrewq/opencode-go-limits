# OpenCode Go Limits

[![CI](https://github.com/987poiuytrewq/opencode-go-limits/actions/workflows/ci.yml/badge.svg)](https://github.com/987poiuytrewq/opencode-go-limits/actions/workflows/ci.yml)

A TUI-only [OpenCode](https://opencode.ai) plugin that shows your OpenCode Go
usage in the session sidebar. It renders the rolling 5-hour, weekly, and
monthly meters as progress bars, with the percentage used, a reset countdown,
and an estimated runout warning when usage is on course to hit a limit before
it resets.

The plugin is deliberately small: it reads the usage meters that OpenCode
already has access to, follows your active OpenCode theme, and does not store or
display API keys, token spend, or billing details.

## Features

- **All three Go meters** in one sidebar panel: 5-hour window, weekly, and
  monthly.
- **Usage at a glance:** percentage used, a responsive `━` / `─` progress bar,
  and a compact reset countdown.
- **Runout warnings** projected from average usage since the current window
  began.
- **Theme-aware colors:** success, warning, and error colors from the active
  OpenCode theme.
- **Configurable refresh cadence** with safe bounds, so a typo in the config
  cannot hammer the server.
- **No separate credentials:** the plugin uses OpenCode's client and the
  workspace you are already signed in to.

## Requirements

- **OpenCode V2 with TUI plugin support.** The plugin is developed and tested
  against `@opencode/plugin` 2.3.0; an older V2 release may not provide the
  `sidebar.content` slot or the experimental usage-limits client method this
  plugin calls.
- **An OpenCode Console workspace with OpenCode Go.** The usage endpoint returns
  no Go meters for workspaces without an active Go subscription, and the panel
  shows an unavailable message instead.
- **[Bun](https://bun.sh) 1.4.4** to install dependencies from source and to run
  the tests. OpenCode provides the runtime for the plugin itself.

## Install from source

This is a TUI-only package: its `package.json` exports a `./tui` entry and has
no server entry. OpenCode loads TUI-only plugins from the global CLI config, not
from `opencode.json`.

1. Clone the repository and install its dependencies:

   ```sh
   git clone https://github.com/987poiuytrewq/opencode-go-limits.git
   cd opencode-go-limits
   bun install
   ```

2. Add the clone's absolute path to the `plugins` array in
   `~/.config/opencode/cli.json` (or `$XDG_CONFIG_HOME/opencode/cli.json` when
   `XDG_CONFIG_HOME` is set):

   ```json
   {
     "$schema": "https://opencode.ai/v2/cli.json",
     "plugins": [
       {
         "package": "/absolute/path/to/opencode-go-limits"
       }
     ]
   }
   ```

3. Run `/reload` in the TUI, or restart OpenCode. The **OpenCode Go** panel is
   appended to the session sidebar.

The CLI config is global; there is no project-local CLI config file. If the
panel does not appear, see [Troubleshooting](#troubleshooting).

## Configuration

Options go in the same plugin entry, under `options`. Every option is optional:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-go-limits",
      "options": {
        "refreshMs": 30000
      }
    }
  ]
}
```

| Option | Default | Description |
| --- | --- | --- |
| `refreshMs` | `60000` | How often the sidebar reloads usage, in milliseconds. Values below `15000` are raised to 15 seconds; values above `1800000` are lowered to 30 minutes. A value that is not a finite number falls back to the default. |

The interval starts when the sidebar panel mounts. Refreshes are skipped while
a previous request is still running, so a slow or offline server cannot build
up a queue of requests. The plugin has no manual refresh command; if you change
`refreshMs`, reload OpenCode to apply the new value.

## Reading the panel

Each meter takes two lines:

```text
5-hour window               4h 42m
25% ━━━━━━━━──────────────────────
Weekly                      5d 13h
50% ━━━━━━━━━━━━━━━───────────────
Monthly                         7d
80% ━━━━━━━━━━━━━━━━━━━━━━━━──────
```

- The first line has the meter name and, on the right, the time until the meter
  resets. Countdowns look like `4h 42m`, `5d 13h`, `<1m`, or `now`.
- The second line has the percentage used and a bar that fills according to
  that percentage. The bar shrinks to fit the sidebar and never goes below one
  column. It rounds to the nearest column, so a low percentage can show an
  empty bar.
- Bars use the theme's success color below 80%, its warning color from 80% to
  99%, and its error color at 100% or when the API marks the meter as limited.
- A `⚠` warning appears next to a meter when the plugin projects that the meter
  will run out before it resets.

### Runout estimate formats

| Meter | Warning format | Example |
| --- | --- | --- |
| 5-hour window | Local time, rounded to the nearest 15 minutes | `⚠ 10:45` |
| Weekly | Local weekday and hour | `⚠ Sat 8pm` |
| Monthly | Short UTC date | `⚠ Dec 2` |

## Runout estimates and display limitations

Runout estimates are a simple linear projection, not a forecast based on
historical samples:

```text
projected time to empty = elapsed time in window × (100 − percent) / percent
```

The window start is inferred from the reset time:

- **5-hour window:** reset time minus 5 hours.
- **Weekly:** reset time minus 7 days.
- **Monthly:** the same UTC day and time in the previous calendar month,
  clamped to the last day of that month.

As a result:

- Monthly estimates are approximate. Go's monthly allowance resets when a new
  paid period starts, which may not line up with a calendar month, and the
  plugin can only infer a month-shaped window from the reset timestamp.
- The projection assumes the average rate of usage since the window began
  continues. A quiet period, a burst of activity, or a plan change will move
  the real runout time.
- No runout warning is shown when a meter is already at or over 100%, when the
  API marks it as limited, when usage is zero or invalid, when the reset time is
  missing or in the past, or when the projected runout would happen after the
  reset. In those cases there is either nothing left to project or the window
  resets first.
- Percentages and reset times come from OpenCode and are only as fresh as the
  last refresh. The plugin does not poll outside its configured interval.

The plugin also does **not** display billed spend or remaining balance. It only
renders the three Go usage meters. For account-level spend and balance, use
OpenCode Console: owners and admins can open **Activity › Usage** for cost
breakdowns and **Settings › Billing** for billing and balance; members can open
**My usage** on **Activity** to see their own usage and limits.

## Troubleshooting

| You see | What to do |
| --- | --- |
| No **OpenCode Go** panel | Run `/plugins` and check the TUI list for a load error. Confirm the `package` value in `cli.json` is the absolute path to the clone root (the directory containing `package.json`) and that `bun install` has run there. Then run `/reload` or restart OpenCode. Load failures are also written to `~/.local/share/opencode/log/opencode.log`. |
| **OpenCode Go usage is unavailable for this workspace** | OpenCode returned no Go meters. Confirm the workspace has an active OpenCode Go subscription and that OpenCode is signed in to that workspace. A workspace without Go has no allowance to display. |
| A network, authentication, or endpoint error appears in the panel | The panel shows the error message from the usage request. Check your connection and OpenCode sign-in, then wait for the next refresh. If it persists, check the OpenCode log. |
| Usage looks stale | The panel refreshes once per `refreshMs` (60 seconds by default) while the TUI is running. Lower `refreshMs` for a faster cadence, down to 15 seconds, then reload. |
| `refreshMs` has no effect | Put `options` on the matching plugin entry in the global `cli.json`, not in `opencode.json`, and make sure the `package` value points at the same clone. Non-numeric values fall back to 60 seconds. |
| The monthly warning date looks wrong | Monthly runouts assume a calendar-month cycle. Go resets the monthly allowance when the paid period renews, so treat the monthly warning as an estimate. |
| The bars look short | The bar uses the sidebar's measured width minus the percentage prefix, with a one-column minimum. Widen the sidebar to give the bars more room. |

## How it works

The plugin exports a single TUI entrypoint from `src/tui.tsx`. On setup it
registers an append claim for OpenCode's documented `sidebar.content` slot.
When the slot renders, the widget:

1. Calls `context.client.experimental.usage.limits()` for the current location.
2. Displays the returned `go.rolling`, `go.weekly`, and `go.monthly` meters.
3. Refreshes on the configured interval and listens for renderer resize and
   frame events to remeasure the bar.
4. Removes its timer and renderer listeners when the slot is unloaded.

The plugin never reads an API key directly and makes no requests of its own
outside the OpenCode client.

## Development

```sh
make install
```

That installs the dependencies pinned in `bun.lock`. The plugin has no build
step: its `package.json` exports the TypeScript TUI entry directly, and
OpenCode loads it through the `./tui` export.

### Tests

| Command | Runs |
| --- | --- |
| `make test` | Everything below except `make install`. |
| `make format-check` | Formatting for the checked source and config files, and a strict-JSON check of the first JSON example in this README. |
| `make typecheck` | `tsc --noEmit` over `src` and `test`. |
| `make test-unit` | Unit tests for settings and usage formatting/estimation. |
| `make test-integration` | Renders the plugin in a test OpenTUI renderer and covers slot registration, data loading, error states, refresh, and cleanup. |
| `make ci` | `make install` followed by `make test`; this is what CI runs. |

To run one file while developing:

```sh
bun test test/unit/usage.test.ts
bun test test/integration/plugin.test.tsx
```

The integration tests use a path-safe Solid transform preload in
`test/preload.ts`. It is configured by `bunfig.toml`.

### Project layout

| Path | Contents |
| --- | --- |
| `src/tui.tsx` | Plugin definition, `sidebar.content` slot, usage requests, refresh timer, and Solid UI. |
| `src/settings.ts` | `refreshMs` default, fallback, and clamping. |
| `src/usage.ts` | Pure formatting and runout-estimation helpers. |
| `test/unit/` | Unit tests for settings and usage helpers. |
| `test/integration/` | Mock OpenCode host and TUI rendering tests. |
| `test/preload.ts` | Bun preload that applies the OpenTUI Solid transform. |
| `Makefile` | Canonical install, format, typecheck, test, and CI gates. |
| `.github/workflows/ci.yml` | GitHub Actions workflow that runs `make ci` on Bun 1.4.4. |
