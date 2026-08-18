export const HOUR_MS = 3_600_000;
export const FIVE_MINUTE_MS = 5 * 60_000;
export const DAY_MS = 86_400_000;
export const MALDIVES_OFFSET_MS = 5 * HOUR_MS;

function timestamp(point) {
  return new Date(point.captured_at).getTime();
}

function sortSnapshots(snapshots) {
  return [...snapshots]
    .filter((point) => Number.isFinite(timestamp(point)) && Number.isFinite(Number(point.signed_count)))
    .sort((left, right) => timestamp(left) - timestamp(right));
}

function hourStart(time) {
  return Math.floor(time / HOUR_MS) * HOUR_MS;
}

function maldivesDayStart(time) {
  return Math.floor((time + MALDIVES_OFFSET_MS) / DAY_MS) * DAY_MS - MALDIVES_OFFSET_MS;
}

function groupByPeriod(snapshots, periodStart) {
  const buckets = new Map();
  for (const point of sortSnapshots(snapshots)) {
    const start = periodStart(timestamp(point));
    const bucket = buckets.get(start);
    if (bucket) {
      bucket.last = point;
    } else {
      buckets.set(start, { first: point, last: point });
    }
  }
  return buckets;
}

function buildSeries(buckets, start, end, step) {
  const series = [];
  for (let periodStart = start; periodStart <= end; periodStart += step) {
    const bucket = buckets.get(periodStart);
    const previous = buckets.get(periodStart - step);
    const partial = periodStart === end;

    if (!bucket) {
      series.push({ start: periodStart, value: null, status: "missing", partial, comparable: false });
      continue;
    }

    let baseline = previous?.last;
    let comparable = Boolean(previous);
    if (!baseline && timestamp(bucket.first) !== timestamp(bucket.last)) {
      baseline = bucket.first;
      comparable = false;
    }

    if (!baseline) {
      series.push({
        start: periodStart,
        capturedAt: bucket.last.captured_at,
        value: null,
        status: "baseline",
        partial,
        comparable: false,
      });
      continue;
    }

    series.push({
      start: periodStart,
      capturedAt: bucket.last.captured_at,
      value: Math.max(0, Number(bucket.last.signed_count) - Number(baseline.signed_count)),
      status: "measured",
      partial,
      comparable: comparable && !partial,
    });
  }
  return series;
}

export function buildHourlySeries(snapshots, now = Date.now()) {
  const end = hourStart(now);
  const start = end - 23 * HOUR_MS;
  return buildSeries(groupByPeriod(snapshots, hourStart), start, end, HOUR_MS);
}

export function buildFiveMinuteSeries(snapshots, now = Date.now()) {
  const periodStart = (time) => Math.floor(time / FIVE_MINUTE_MS) * FIVE_MINUTE_MS;
  const end = periodStart(now);
  const start = end - 71 * FIVE_MINUTE_MS;
  return buildSeries(groupByPeriod(snapshots, periodStart), start, end, FIVE_MINUTE_MS);
}

export function buildDailySeries(snapshots, now = Date.now(), maximumDays = 50) {
  const buckets = groupByPeriod(snapshots, maldivesDayStart);
  if (!buckets.size) return [];
  const end = maldivesDayStart(now);
  const earliest = Math.min(...buckets.keys());
  const start = Math.max(earliest, end - (maximumDays - 1) * DAY_MS);
  return buildSeries(buckets, start, end, DAY_MS);
}

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

export function robustPeriodStats(series, minimumSamples = 6) {
  const measured = series.filter((period) => Number.isFinite(period.value));
  const complete = series.filter((period) => period.comparable && Number.isFinite(period.value));
  const values = complete.map((period) => period.value);
  const result = {
    measuredCount: measured.length,
    sampleCount: values.length,
    ready: values.length >= minimumSamples,
    median: values.length ? median(values) : null,
    threshold: null,
    peak: values.length ? Math.max(...values) : null,
    spikeStarts: new Set(),
  };

  if (!result.ready) return result;

  const deviations = values.map((value) => Math.abs(value - result.median));
  const scaledMad = 1.4826 * median(deviations);
  result.threshold = result.median + Math.max(3 * scaledMad, result.median * 1.5, 3);
  for (const period of complete) {
    if (period.value > result.threshold) result.spikeStarts.add(period.start);
  }
  return result;
}
