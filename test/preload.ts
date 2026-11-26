import { plugin } from "bun";
import { readFile } from "node:fs/promises";
import { transformSolidSource } from "../node_modules/@opentui/solid/scripts/solid-transform.js";

/**
 * Path-safe replacement for `@opentui/solid/preload`.
 *
 * The upstream preload strips everything after the first `#` from module
 * paths before reading them, because it assumes the suffix is a URL fragment.
 * Bun module paths need no such suffix, and worktree directories can legally
 * contain `#`, so the upstream preload fails to read files in those checkouts.
 * This preload keeps the same Solid transform and the same Solid client
 * runtime rewrite while reading every path verbatim.
 */

const serverEntry =
  /[/\\]node_modules[/\\]solid-js[/\\]dist[/\\]server\.js(?:[?#].*)?$/;
const storeEntry =
  /[/\\]node_modules[/\\]solid-js[/\\]store[/\\]dist[/\\]server\.js(?:[?#].*)?$/;
const sourceEntry = /^(?!.*[/\\]node_modules[/\\]).*\.[cm]?[jt]sx(?:[?#].*)?$/;

plugin({
  name: "opencode-go-limits-solid",
  setup(build) {
    build.onLoad({ filter: serverEntry }, async (args) => ({
      contents: await readFile(
        args.path.replace(/server\.js([?#].*)?$/, "solid.js$1"),
        "utf8",
      ),
      loader: "js",
    }));
    build.onLoad({ filter: storeEntry }, async (args) => ({
      contents: await readFile(
        args.path.replace(/server\.js([?#].*)?$/, "store.js$1"),
        "utf8",
      ),
      loader: "js",
    }));
    build.onLoad({ filter: sourceEntry }, async (args) => {
      // Babel selects its presets from the extension, so the file name alone
      // is enough and avoids feeding it a path that may contain a fragment.
      const filename = args.path.slice(args.path.lastIndexOf("/") + 1);
      return {
        contents: await transformSolidSource(
          await readFile(args.path, "utf8"),
          {
            filename,
          },
        ),
        loader: "js",
      };
    });
  },
});
