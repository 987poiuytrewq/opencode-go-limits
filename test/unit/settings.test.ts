import { describe, expect, test } from "bun:test";
import {
  DEFAULT_REFRESH_MS,
  MAX_REFRESH_MS,
  MIN_REFRESH_MS,
  pluginSettings,
} from "../../src/settings";

describe("plugin settings", () => {
  test("uses the one-minute default when options are absent", () => {
    expect(pluginSettings(undefined)).toEqual({ refreshMs: 60_000 });
    expect(pluginSettings(null)).toEqual({ refreshMs: DEFAULT_REFRESH_MS });
    expect(pluginSettings({})).toEqual({ refreshMs: DEFAULT_REFRESH_MS });
    expect(pluginSettings("60000")).toEqual({ refreshMs: DEFAULT_REFRESH_MS });
    expect(pluginSettings(60_000)).toEqual({ refreshMs: DEFAULT_REFRESH_MS });
  });

  test("falls back to the default for invalid refreshMs values", () => {
    expect(pluginSettings({ refreshMs: "30000" })).toEqual({
      refreshMs: DEFAULT_REFRESH_MS,
    });
    expect(pluginSettings({ refreshMs: Number.NaN })).toEqual({
      refreshMs: DEFAULT_REFRESH_MS,
    });
    expect(pluginSettings({ refreshMs: Number.POSITIVE_INFINITY })).toEqual({
      refreshMs: DEFAULT_REFRESH_MS,
    });
    expect(pluginSettings({ refreshMs: Number.NEGATIVE_INFINITY })).toEqual({
      refreshMs: DEFAULT_REFRESH_MS,
    });
    expect(pluginSettings({ refreshMs: undefined })).toEqual({
      refreshMs: DEFAULT_REFRESH_MS,
    });
  });

  test("clamps refreshMs to the supported fifteen-second minimum", () => {
    expect(MIN_REFRESH_MS).toBe(15_000);
    expect(pluginSettings({ refreshMs: 0 })).toEqual({
      refreshMs: MIN_REFRESH_MS,
    });
    expect(pluginSettings({ refreshMs: -60_000 })).toEqual({
      refreshMs: MIN_REFRESH_MS,
    });
    expect(pluginSettings({ refreshMs: 1 })).toEqual({
      refreshMs: MIN_REFRESH_MS,
    });
    expect(pluginSettings({ refreshMs: MIN_REFRESH_MS })).toEqual({
      refreshMs: MIN_REFRESH_MS,
    });
  });

  test("keeps values inside the supported range unchanged", () => {
    expect(pluginSettings({ refreshMs: 60_000 })).toEqual({
      refreshMs: 60_000,
    });
    expect(pluginSettings({ refreshMs: 90_500.5 })).toEqual({
      refreshMs: 90_500.5,
    });
    expect(pluginSettings({ refreshMs: MAX_REFRESH_MS })).toEqual({
      refreshMs: MAX_REFRESH_MS,
    });
  });

  test("clamps refreshMs to the supported thirty-minute maximum", () => {
    expect(MAX_REFRESH_MS).toBe(1_800_000);
    expect(pluginSettings({ refreshMs: MAX_REFRESH_MS + 1 })).toEqual({
      refreshMs: MAX_REFRESH_MS,
    });
    expect(pluginSettings({ refreshMs: 24 * 60 * 60_000 })).toEqual({
      refreshMs: MAX_REFRESH_MS,
    });
  });

  test("ignores unrelated options", () => {
    expect(pluginSettings({ refreshMs: 30_000, enabled: false })).toEqual({
      refreshMs: 30_000,
    });
  });
});
