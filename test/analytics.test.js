import { describe, expect, test } from "vitest";
import { buildDailySeries, buildFiveMinuteSeries, buildHourlySeries, robustPeriodStats } from "../public/analytics.js";

const point = (capturedAt, signedCount) => ({ captured_at: capturedAt, signed_count: signedCount });

describe("petition movement series", () => {
  test("keeps a fixed 24-hour axis and preserves missing readings", () => {
    const now = Date.parse("2026-08-19T03:15:00Z");
    const series = buildHourlySeries([
      point("2026-08-19T01:05:00Z", 100),
      point("2026-08-19T02:05:00Z", 106),
    ], now);

    expect(series).toHaveLength(24);
    expect(series.at(-3)).toMatchObject({ status: "baseline", value: null });
    expect(series.at(-2)).toMatchObject({ status: "measured", value: 6 });
    expect(series.at(-1)).toMatchObject({ status: "missing", value: null, partial: true });
  });

  test("uses the first reading as an intra-period baseline when available", () => {
    const series = buildHourlySeries([
      point("2026-08-19T03:05:00Z", 100),
      point("2026-08-19T03:45:00Z", 104),
    ], Date.parse("2026-08-19T03:50:00Z"));

    expect(series.at(-1)).toMatchObject({ status: "measured", value: 4, partial: true, comparable: false });
  });

  test("builds 5-minute changes on a fixed six-hour timeline", () => {
    const series = buildFiveMinuteSeries([
      point("2026-08-19T03:31:00Z", 100),
      point("2026-08-19T03:36:00Z", 102),
      point("2026-08-19T03:39:00Z", 105),
    ], Date.parse("2026-08-19T03:42:00Z"));

    expect(series).toHaveLength(72);
    expect(series.at(-3)).toMatchObject({ status: "baseline", value: null });
    expect(series.at(-2)).toMatchObject({ status: "measured", value: 5 });
  });

  test("groups days at Maldives midnight rather than UTC midnight", () => {
    const series = buildDailySeries([
      point("2026-08-18T18:59:00Z", 100),
      point("2026-08-18T19:01:00Z", 103),
    ], Date.parse("2026-08-18T20:00:00Z"));

    expect(series).toHaveLength(2);
    expect(series[1]).toMatchObject({ status: "measured", value: 3, partial: true });
  });
});

describe("robust spike detection", () => {
  test("waits for enough complete periods", () => {
    const series = [2, 2, 3, 2, 20].map((value, start) => ({ start, value, comparable: true }));
    expect(robustPeriodStats(series)).toMatchObject({ ready: false, sampleCount: 5 });
  });

  test("flags an unusually high period using median and MAD", () => {
    const series = [2, 2, 3, 2, 3, 2, 20].map((value, start) => ({ start, value, comparable: true }));
    const result = robustPeriodStats(series);

    expect(result.ready).toBe(true);
    expect(result.median).toBe(2);
    expect(result.spikeStarts.has(6)).toBe(true);
    expect(result.spikeStarts.has(2)).toBe(false);
  });
});
