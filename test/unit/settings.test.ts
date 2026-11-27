import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MODE,
  DEFAULT_REFRESH_MS,
  MAX_REFRESH_MS,
  MIN_REFRESH_MS,
  pluginSettings,
} from "../../src/settings";

describe("plugin settings", () => {
  test("uses the one-minute default when options are absent", () => {
    expect(pluginSettings(undefined)).toEqual({
      refreshMs: 60_000,
      mode: "expanded",
    });
    expect(pluginSettings(null)).toEqual({
      refreshMs: DEFAULT_REFRESH_MS,
      mode: DEFAULT_MODE,
    });
    expect(pluginSettings({})).toEqual({
      refreshMs: DEFAULT_REFRESH_MS,
      mode: DEFAULT_MODE,
    });
    expect(pluginSettings("60000")).toEqual({
      refreshMs: DEFAULT_REFRESH_MS,
      mode: DEFAULT_MODE,
    });
    expect(pluginSettings(60_000)).toEqual({
      refreshMs: DEFAULT_REFRESH_MS,
      mode: DEFAULT_MODE,
    });
  });

  test("falls back to the default for invalid refreshMs values", () => {
    expect(pluginSettings({ refreshMs: "30000" })).toEqual({
      refreshMs: DEFAULT_REFRESH_MS,
      mode: DEFAULT_MODE,
    });
    expect(pluginSettings({ refreshMs: Number.NaN })).toEqual({
      refreshMs: DEFAULT_REFRESH_MS,
      mode: DEFAULT_MODE,
    });
    expect(pluginSettings({ refreshMs: Number.POSITIVE_INFINITY })).toEqual({
      refreshMs: DEFAULT_REFRESH_MS,
      mode: DEFAULT_MODE,
    });
    expect(pluginSettings({ refreshMs: Number.NEGATIVE_INFINITY })).toEqual({
      refreshMs: DEFAULT_REFRESH_MS,
      mode: DEFAULT_MODE,
    });
    expect(pluginSettings({ refreshMs: undefined })).toEqual({
      refreshMs: DEFAULT_REFRESH_MS,
      mode: DEFAULT_MODE,
    });
  });

  test("clamps refreshMs to the supported fifteen-second minimum", () => {
    expect(MIN_REFRESH_MS).toBe(15_000);
    expect(pluginSettings({ refreshMs: 0 })).toEqual({
      refreshMs: MIN_REFRESH_MS,
      mode: DEFAULT_MODE,
    });
    expect(pluginSettings({ refreshMs: -60_000 })).toEqual({
      refreshMs: MIN_REFRESH_MS,
      mode: DEFAULT_MODE,
    });
    expect(pluginSettings({ refreshMs: 1 })).toEqual({
      refreshMs: MIN_REFRESH_MS,
      mode: DEFAULT_MODE,
    });
    expect(pluginSettings({ refreshMs: MIN_REFRESH_MS })).toEqual({
      refreshMs: MIN_REFRESH_MS,
      mode: DEFAULT_MODE,
    });
  });

  test("keeps values inside the supported range unchanged", () => {
    expect(pluginSettings({ refreshMs: 60_000 })).toEqual({
      refreshMs: 60_000,
      mode: DEFAULT_MODE,
    });
    expect(pluginSettings({ refreshMs: 90_500.5 })).toEqual({
      refreshMs: 90_500.5,
      mode: DEFAULT_MODE,
    });
    expect(pluginSettings({ refreshMs: MAX_REFRESH_MS })).toEqual({
      refreshMs: MAX_REFRESH_MS,
      mode: DEFAULT_MODE,
    });
  });

  test("clamps refreshMs to the supported thirty-minute maximum", () => {
    expect(MAX_REFRESH_MS).toBe(1_800_000);
    expect(pluginSettings({ refreshMs: MAX_REFRESH_MS + 1 })).toEqual({
      refreshMs: MAX_REFRESH_MS,
      mode: DEFAULT_MODE,
    });
    expect(pluginSettings({ refreshMs: 24 * 60 * 60_000 })).toEqual({
      refreshMs: MAX_REFRESH_MS,
      mode: DEFAULT_MODE,
    });
  });

  test("uses expanded mode by default and keeps an explicit expanded mode", () => {
    expect(DEFAULT_MODE).toBe("expanded");
    expect(pluginSettings({})).toMatchObject({ mode: "expanded" });
    expect(pluginSettings({ mode: "expanded" })).toMatchObject({
      mode: "expanded",
    });
  });

  test("enables compact mode only for the exact compact value", () => {
    expect(pluginSettings({ mode: "compact" })).toMatchObject({
      mode: "compact",
    });
    expect(pluginSettings({ refreshMs: 30_000, mode: "compact" })).toEqual({
      refreshMs: 30_000,
      mode: "compact",
    });
  });

  test("enables pace mode only for the exact pace value", () => {
    expect(pluginSettings({ mode: "pace" })).toMatchObject({ mode: "pace" });
    expect(pluginSettings({ refreshMs: 30_000, mode: "pace" })).toEqual({
      refreshMs: 30_000,
      mode: "pace",
    });
  });

  test("falls back to expanded for invalid mode values", () => {
    expect(pluginSettings({ mode: "COMPACT" })).toMatchObject({
      mode: DEFAULT_MODE,
    });
    expect(pluginSettings({ mode: "PACE" })).toMatchObject({
      mode: DEFAULT_MODE,
    });
    expect(pluginSettings({ mode: "collapsed" })).toMatchObject({
      mode: DEFAULT_MODE,
    });
    expect(pluginSettings({ mode: true })).toMatchObject({
      mode: DEFAULT_MODE,
    });
    expect(pluginSettings({ mode: 1 })).toMatchObject({ mode: DEFAULT_MODE });
    expect(pluginSettings({ mode: null })).toMatchObject({
      mode: DEFAULT_MODE,
    });
    expect(pluginSettings({ mode: undefined })).toMatchObject({
      mode: DEFAULT_MODE,
    });
  });

  test("ignores unrelated options", () => {
    expect(pluginSettings({ refreshMs: 30_000, enabled: false })).toEqual({
      refreshMs: 30_000,
      mode: DEFAULT_MODE,
    });
  });
});
