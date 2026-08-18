import { buildDailySeries, buildFiveMinuteSeries, buildHourlySeries, robustPeriodStats } from "./analytics.js";

if (new URLSearchParams(location.search).get("theme") === "light") {
  document.documentElement.dataset.theme = "light";
}

const state = {
  petitions: [],
  activeId: null,
  range: "all",
  detail: null,
};

const elements = {
  loading: document.querySelector("#loading-state"),
  error: document.querySelector("#error-state"),
  empty: document.querySelector("#empty-state"),
  dashboard: document.querySelector("#dashboard"),
  errorMessage: document.querySelector("#error-message"),
  retry: document.querySelector("#retry-button"),
  picker: document.querySelector("#petition-picker"),
  navReference: document.querySelector("#petition-reference-nav"),
  status: document.querySelector("#status-badge"),
  title: document.querySelector("#petition-title"),
  categoryList: document.querySelector("#category-list"),
  publishedDate: document.querySelector("#published-date"),
  source: document.querySelector("#source-link"),
  signatures: document.querySelector("#signature-count"),
  signatureNote: document.querySelector("#signature-note"),
  dailyChange: document.querySelector("#daily-change"),
  dailyChangeLabel: document.querySelector("#change-period-label"),
  dailyChangeNote: document.querySelector("#daily-change-note"),
  hourlyRate: document.querySelector("#hourly-rate"),
  daysRemaining: document.querySelector("#days-remaining"),
  expiryNote: document.querySelector("#expiry-note"),
  trendSummary: document.querySelector("#trend-summary"),
  lineChart: document.querySelector("#line-chart"),
  fiveMinuteHeading: document.querySelector("#five-minute-heading"),
  fiveMinuteChart: document.querySelector("#five-minute-chart"),
  fiveMinuteSummary: document.querySelector("#five-minute-summary"),
  hourlyHeading: document.querySelector("#hourly-heading"),
  hourlyChart: document.querySelector("#hourly-chart"),
  hourlySummary: document.querySelector("#hourly-summary"),
  dailyChart: document.querySelector("#daily-chart"),
  dailySummary: document.querySelector("#daily-summary"),
  thresholds: document.querySelector("#threshold-list"),
  metadata: document.querySelector("#metadata-list"),
};

const number = new Intl.NumberFormat("en-US");
const compactNumber = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const MALDIVES_TIME_ZONE = "Indian/Maldives";
const dateOnly = new Intl.DateTimeFormat("en-GB", {
  timeZone: MALDIVES_TIME_ZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
});
const clockTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: MALDIVES_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const hourChartTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: MALDIVES_TIME_ZONE,
  day: "numeric",
  month: "short",
  hour: "2-digit",
  hour12: false,
});
const fiveMinuteChartTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: MALDIVES_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const shortDate = new Intl.DateTimeFormat("en-GB", {
  timeZone: MALDIVES_TIME_ZONE,
  day: "numeric",
  month: "short",
});
function show(name) {
  for (const key of ["loading", "error", "empty", "dashboard"]) {
    elements[key].hidden = key !== name;
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed with HTTP ${response.status}`);
  return body;
}

function labelStatus(value) {
  return String(value || "Unknown")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function parseSourceDate(value) {
  if (!value) return null;
  const source = String(value).trim();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(source)
    ? `${source.replace(" ", "T")}+05:00`
    : source;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value) {
  if (!value) return "Not listed";
  const parsed = parseSourceDate(value);
  return parsed ? `${dateOnly.format(parsed)} · ${clockTime.format(parsed)} MVT` : "Not listed";
}

function setPicker() {
  elements.picker.replaceChildren();
  for (const petition of state.petitions) {
    const option = document.createElement("option");
    option.value = petition.uuid;
    option.textContent = petition.reference_number || petition.uuid;
    option.selected = petition.uuid === state.activeId;
    elements.picker.append(option);
  }
  const hasMultiplePetitions = state.petitions.length > 1;
  elements.picker.hidden = !hasMultiplePetitions;
  elements.picker.disabled = !hasMultiplePetitions;
  elements.navReference.hidden = hasMultiplePetitions;
  elements.navReference.textContent = state.petitions[0]?.reference_number || state.petitions[0]?.uuid || "Petition";
}

function nearestSnapshot(points, targetTime) {
  return points.reduce((closest, point) => {
    if (!closest) return point;
    return Math.abs(parseSourceDate(point.captured_at).getTime() - targetTime) <
      Math.abs(parseSourceDate(closest.captured_at).getTime() - targetTime)
      ? point
      : closest;
  }, null);
}

function calculateStats(points) {
  if (!points.length) return { change24h: null, rate: null, durationHours: 0 };
  const first = points[0];
  const latest = points.at(-1);
  const firstTime = parseSourceDate(first.captured_at).getTime();
  const latestTime = parseSourceDate(latest.captured_at).getTime();
  const durationHours = Math.max(0, (latestTime - firstTime) / 3_600_000);
  const prior = nearestSnapshot(points, latestTime - 24 * 3_600_000);
  const hasUsefulBaseline = points.length > 1 && prior !== latest;
  return {
    change24h: hasUsefulBaseline ? latest.signed_count - prior.signed_count : null,
    rate: durationHours > 0 ? (latest.signed_count - first.signed_count) / durationHours : null,
    durationHours,
  };
}

function renderHero(petition) {
  const status = petition.public_status || petition.status;
  const title = String(petition.title || "Untitled petition");
  elements.status.textContent = labelStatus(status);
  elements.status.classList.toggle("closed", Boolean(petition.is_closed || petition.is_expired));
  elements.title.textContent = title;
  elements.title.dir = /[\u0780-\u07bf]/u.test(title) ? "rtl" : "ltr";
  elements.source.href = petition.source_url;

  const categories = Array.isArray(petition.categories_json) ? petition.categories_json : [];
  elements.categoryList.replaceChildren();
  for (const category of categories.length ? categories : ["Uncategorised"]) {
    const tag = document.createElement("span");
    tag.className = "category-tag";
    tag.textContent = category;
    elements.categoryList.append(tag);
  }
  elements.publishedDate.textContent = formatDate(petition.published_at);
  const published = parseSourceDate(petition.published_at);
  elements.publishedDate.dateTime = published?.toISOString() || "";
}

function renderStats(petition, snapshots) {
  const latest = snapshots.at(-1);
  const stats = calculateStats(snapshots);
  elements.signatures.textContent = number.format(petition.signed_count);
  elements.signatureNote.textContent = `Read ${formatDate(petition.last_fetched_at)}`;

  elements.dailyChange.textContent = stats.change24h === null ? "—" : `+${number.format(Math.max(0, stats.change24h))}`;
  if (stats.durationHours >= 23) {
    elements.dailyChangeLabel.textContent = "Last 24 hours";
    elements.dailyChangeNote.textContent = stats.change24h === null ? "More history is needed" : "Signature change";
  } else {
    elements.dailyChangeLabel.textContent = "Observed change";
    elements.dailyChangeNote.textContent = stats.change24h === null
      ? "The next reading will show movement"
      : `Across ${formatDuration(stats.durationHours)}`;
  }
  elements.hourlyRate.textContent = stats.rate === null ? "—" : stats.rate.toFixed(stats.rate < 10 ? 1 : 0);

  if (!petition.expires_at) {
    elements.daysRemaining.textContent = "—";
    elements.expiryNote.textContent = "No deadline listed";
  } else {
    const remaining = parseSourceDate(petition.expires_at).getTime() - Date.now();
    const days = Math.max(0, Math.ceil(remaining / 86_400_000));
    elements.daysRemaining.textContent = `${number.format(days)}d`;
    elements.expiryNote.textContent = remaining > 0 ? `Deadline ${formatDate(petition.expires_at)}` : "Deadline passed";
  }

  if (!latest) elements.signatureNote.textContent = "Waiting for the first snapshot";
}

function svgElement(name, attributes = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

function formatAxisValue(value, range) {
  if (range < 1_000) return number.format(Math.round(value));
  return compactNumber.format(value);
}

function formatDuration(hours) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min tracked`;
  if (hours < 48) return `${number.format(Math.round(hours))} hr tracked`;
  return `${number.format(Math.round(hours / 24))} days tracked`;
}

function renderLineChart(snapshots) {
  elements.lineChart.replaceChildren();
  if (!snapshots.length) {
    const message = document.createElement("p");
    message.className = "empty-detail";
    message.textContent = "The first reading will establish the chart baseline.";
    elements.lineChart.append(message);
    elements.trendSummary.textContent = "No readings in this range.";
    return;
  }

  const width = Math.min(940, Math.max(340, window.innerWidth - 44));
  const compact = width < 500;
  const height = compact ? 260 : 300;
  const padding = compact
    ? { top: 24, right: 10, bottom: 38, left: 54 }
    : { top: 26, right: 20, bottom: 42, left: 68 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const times = snapshots.map((point) => parseSourceDate(point.captured_at).getTime());
  const values = snapshots.map((point) => Number(point.signed_count));
  let minTime = Math.min(...times);
  let maxTime = Math.max(...times);
  let minValue = Math.min(...values);
  let maxValue = Math.max(...values);
  const isBaseline = snapshots.length === 1;

  if (minTime === maxTime) {
    minTime -= 6 * 3_600_000;
    maxTime += 6 * 3_600_000;
  }
  if (minValue === maxValue) {
    const baselinePadding = Math.max(5, Math.ceil(maxValue * 0.002));
    minValue = Math.max(0, minValue - baselinePadding);
    maxValue += baselinePadding;
  } else {
    const valuePadding = Math.max(1, (maxValue - minValue) * 0.1);
    minValue = Math.max(0, minValue - valuePadding);
    maxValue += valuePadding;
  }

  const x = (time) => padding.left + ((time - minTime) / (maxTime - minTime)) * innerWidth;
  const y = (value) => padding.top + (1 - (value - minValue) / (maxValue - minValue)) * innerHeight;
  const points = snapshots.map((point, index) => `${x(times[index]).toFixed(2)},${y(point.signed_count).toFixed(2)}`);
  const svg = svgElement("svg", { viewBox: `0 0 ${width} ${height}`, "aria-hidden": "true" });
  const valueRange = maxValue - minValue;

  for (let tick = 0; tick <= 4; tick += 1) {
    const tickY = padding.top + (innerHeight * tick) / 4;
    svg.append(svgElement("line", { x1: padding.left, x2: width - padding.right, y1: tickY, y2: tickY, class: "chart-grid" }));
    const label = svgElement("text", { x: padding.left - 12, y: tickY + 4, "text-anchor": "end", class: "chart-label" });
    label.textContent = formatAxisValue(maxValue - (valueRange * tick) / 4, valueRange);
    svg.append(label);
  }

  svg.append(svgElement("line", {
    x1: padding.left,
    x2: padding.left,
    y1: padding.top,
    y2: padding.top + innerHeight,
    class: "chart-axis",
  }));
  svg.append(svgElement("line", {
    x1: padding.left,
    x2: width - padding.right,
    y1: padding.top + innerHeight,
    y2: padding.top + innerHeight,
    class: "chart-axis",
  }));

  const observedDays = [];
  for (const time of times) {
    const date = new Date(time);
    const key = dateOnly.format(date);
    if (observedDays.at(-1)?.key !== key) observedDays.push({ key, time, date });
  }
  const dayTicks = observedDays.length <= 5
    ? observedDays
    : Array.from({ length: 5 }, (_, index) => observedDays[Math.round((index * (observedDays.length - 1)) / 4)]);
  if (dayTicks.length === 1) dayTicks[0] = { ...dayTicks[0], time: minTime + (maxTime - minTime) / 2 };

  dayTicks.forEach((tick, index) => {
    const label = svgElement("text", {
      x: x(tick.time),
      y: height - 12,
      "text-anchor": index === 0 && dayTicks.length > 1 ? "start" : index === dayTicks.length - 1 && dayTicks.length > 1 ? "end" : "middle",
      class: "chart-label",
    });
    label.textContent = shortDate.format(tick.date);
    svg.append(label);
  });

  const yCaption = svgElement("text", {
    x: padding.left,
    y: 11,
    class: "chart-caption",
  });
  yCaption.textContent = "Total signatures";
  svg.append(yCaption);
  if (!isBaseline) {
    const areaPoints = [
      `${x(times[0])},${padding.top + innerHeight}`,
      ...points,
      `${x(times.at(-1))},${padding.top + innerHeight}`,
    ].join(" ");
    svg.append(svgElement("polygon", { points: areaPoints, class: "chart-area" }));
    svg.append(svgElement("polyline", { points: points.join(" "), class: "chart-line" }));
  }

  const pointStep = Math.max(1, Math.ceil(snapshots.length / 24));
  snapshots.forEach((point, index) => {
    if (index % pointStep !== 0 && index !== snapshots.length - 1) return;
    const circle = svgElement("circle", {
      cx: x(times[index]),
      cy: y(point.signed_count),
      r: 3.5,
      class: "chart-point",
    });
    const tooltip = svgElement("title");
    tooltip.textContent = `${number.format(point.signed_count)} signatures · ${formatDate(point.captured_at)}`;
    circle.append(tooltip);
    svg.append(circle);
  });

  if (isBaseline) {
    const annotation = svgElement("text", {
      x: x(times[0]) + 12,
      y: y(values[0]) - 10,
      class: "chart-annotation",
    });
    annotation.textContent = "Baseline";
    svg.append(annotation);
  }
  elements.lineChart.append(svg);

  if (isBaseline) {
    elements.trendSummary.textContent = `Baseline captured ${dateOnly.format(new Date(times[0]))}. Growth appears after the next reading.`;
    elements.lineChart.setAttribute("aria-label", `Baseline of ${number.format(values[0])} signatures at ${formatDate(snapshots[0].captured_at)}`);
  } else {
    const change = values.at(-1) - values[0];
    const firstDate = dateOnly.format(new Date(times[0]));
    const lastDate = dateOnly.format(new Date(times.at(-1)));
    const dateRange = firstDate === lastDate ? `on ${firstDate}` : `from ${firstDate} to ${lastDate}`;
    elements.trendSummary.textContent = `${change >= 0 ? "+" : ""}${number.format(change)} net signatures ${dateRange}.`;
    elements.lineChart.setAttribute("aria-label", `Signature count changed by ${number.format(change)} across ${number.format(snapshots.length)} readings`);
  }
}

function niceAxisMaximum(value) {
  if (value <= 5) return Math.max(1, Math.ceil(value));
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1
    ? 1
    : normalized <= 2
      ? 2
      : normalized <= 2.5
        ? 2.5
        : normalized <= 4
          ? 4
          : normalized <= 5
            ? 5
            : 10;
  return step * magnitude;
}

function movementSummary(stats, unit, series, minimumSamples) {
  const noun = unit === "hour" ? "hour" : unit === "day" ? "day" : "5-min period";
  const plural = noun === "5-min period" ? "5-min periods" : `${noun}s`;
  const partial = series.some((period) => period.partial && Number.isFinite(period.value));
  const context = [partial ? `Current ${noun} is partial` : null]
    .filter(Boolean)
    .join(" · ");
  if (!stats.measuredCount) return `Baseline collected; movement appears as readings arrive${context ? ` · ${context}` : ""}.`;
  if (!stats.ready) {
    return `${number.format(stats.measuredCount)} observed ${stats.measuredCount === 1 ? noun : plural} · Spike comparison starts after ${number.format(minimumSamples)} complete ${plural}${context ? ` · ${context}` : ""}.`;
  }
  const spikes = stats.spikeStarts.size;
  return `Peak ${number.format(stats.peak)} · ${number.format(spikes)} ${spikes === 1 ? "spike" : "spikes"} flagged${context ? ` · ${context}` : ""}.`;
}

function renderMovementChart(element, summaryElement, series, xFormatter, unit, minimumSamples = 6, chartType = "bar") {
  element.replaceChildren();
  if (!series.length) {
    const message = document.createElement("p");
    message.className = "empty-detail";
    message.textContent = "No readings have been collected yet.";
    element.append(message);
    summaryElement.textContent = "The first reading will establish a baseline.";
    return;
  }

  const stats = robustPeriodStats(series, minimumSamples);
  summaryElement.textContent = movementSummary(stats, unit, series, minimumSamples);
  const widthLimit = chartType === "line" ? 1200 : 620;
  const width = Math.min(widthLimit, Math.max(280, Math.round(element.clientWidth || 540)));
  const compact = width < 500;
  const height = compact ? 170 : 210;
  const padding = compact
    ? { top: 17, right: 6, bottom: 32, left: 40 }
    : { top: 20, right: 10, bottom: 42, left: 48 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const values = series.filter((period) => Number.isFinite(period.value)).map((period) => period.value);
  const axisMaximum = niceAxisMaximum(Math.max(0, ...values));
  const y = (value) => padding.top + innerHeight - (value / axisMaximum) * innerHeight;
  const svg = svgElement("svg", {
    viewBox: `0 0 ${width} ${height}`,
    "aria-hidden": "true",
    class: chartType === "line" ? "movement-svg five-minute-series" : "movement-svg",
  });

  const yTickCount = Math.min(4, axisMaximum);
  for (let tick = 0; tick <= yTickCount; tick += 1) {
    const value = axisMaximum - (axisMaximum * tick) / yTickCount;
    const tickY = y(value);
    svg.append(svgElement("line", {
      x1: padding.left,
      x2: width - padding.right,
      y1: tickY,
      y2: tickY,
      class: "chart-grid",
    }));
    const label = svgElement("text", {
      x: padding.left - 9,
      y: tickY + 4,
      "text-anchor": "end",
      class: "chart-label chart-label-y",
    });
    label.textContent = formatAxisValue(value, axisMaximum);
    svg.append(label);
  }

  svg.append(svgElement("line", {
    x1: padding.left,
    x2: padding.left,
    y1: padding.top,
    y2: padding.top + innerHeight,
    class: "chart-axis",
  }));
  svg.append(svgElement("line", {
    x1: padding.left,
    x2: width - padding.right,
    y1: padding.top + innerHeight,
    y2: padding.top + innerHeight,
    class: "chart-axis",
  }));

  const slotWidth = innerWidth / series.length;
  const barWidth = Math.max(2, Math.min(22, slotWidth * 0.68));
  const centerX = (index) => padding.left + index * slotWidth + slotWidth / 2;

  if (chartType === "line") {
    const segments = [];
    let currentSegment = [];
    series.forEach((period, index) => {
      if (Number.isFinite(period.value)) {
        currentSegment.push(`${centerX(index).toFixed(2)},${y(period.value).toFixed(2)}`);
      } else if (currentSegment.length) {
        segments.push(currentSegment);
        currentSegment = [];
      }
    });
    if (currentSegment.length) segments.push(currentSegment);

    for (const segment of segments) {
      if (segment.length < 2) continue;
      svg.append(svgElement("polyline", {
        points: segment.join(" "),
        class: "movement-line dotted",
      }));
    }
  }

  series.forEach((period, index) => {
    const center = centerX(index);
    if (!Number.isFinite(period.value)) {
      const marker = svgElement("circle", {
        cx: center,
        cy: padding.top + innerHeight,
        r: Math.min(2.5, Math.max(1.5, slotWidth * 0.14)),
        class: `movement-gap movement-gap-${period.status}`,
      });
      const tooltip = svgElement("title");
      tooltip.textContent = period.status === "baseline"
        ? `${xFormatter.format(new Date(period.start))}: baseline reading only`
        : `${xFormatter.format(new Date(period.start))}: no reading recorded`;
      marker.append(tooltip);
      svg.append(marker);
      return;
    }

    const qualifiers = [period.partial ? "partial period" : null, stats.spikeStarts.has(period.start) ? "unusual spike" : null]
      .filter(Boolean)
      .join(" · ");
    const tooltipText = `${xFormatter.format(new Date(period.start))}: ${number.format(period.value)} new signatures${qualifiers ? ` · ${qualifiers}` : ""}`;

    if (chartType === "line") {
      const classes = ["movement-line-point"];
      if (period.partial) classes.push("partial");
      if (stats.spikeStarts.has(period.start)) classes.push("spike");
      const point = svgElement("circle", {
        cx: center,
        cy: y(period.value),
        r: stats.spikeStarts.has(period.start) ? (compact ? 3 : 4) : compact ? 2 : 3,
        class: classes.join(" "),
      });
      const tooltip = svgElement("title");
      tooltip.textContent = tooltipText;
      point.append(tooltip);
      svg.append(point);
      return;
    }

    const barHeight = Math.max(2, (period.value / axisMaximum) * innerHeight);
    const classes = ["movement-bar"];
    if (period.partial) classes.push("partial");
    if (stats.spikeStarts.has(period.start)) classes.push("spike");
    const bar = svgElement("rect", {
      x: center - barWidth / 2,
      y: padding.top + innerHeight - barHeight,
      width: barWidth,
      height: barHeight,
      rx: Math.min(3, barWidth / 2),
      class: classes.join(" "),
    });
    const tooltip = svgElement("title");
    tooltip.textContent = tooltipText;
    bar.append(tooltip);
    svg.append(bar);
    if (stats.spikeStarts.has(period.start)) {
      svg.append(svgElement("circle", {
        cx: center,
        cy: Math.max(padding.top + 4, padding.top + innerHeight - barHeight - 5),
        r: 2.5,
        class: "movement-spike-marker",
      }));
    }
  });

  const xTickSteps = Math.min(2, series.length - 1);
  for (let tick = 0; tick <= xTickSteps; tick += 1) {
    const index = xTickSteps === 0 ? 0 : Math.round(((series.length - 1) * tick) / xTickSteps);
    const x = padding.left + (index + 0.5) * slotWidth;
    const label = svgElement("text", {
      x,
      y: height - 10,
      "text-anchor": xTickSteps === 0 ? "middle" : tick === 0 ? "start" : tick === xTickSteps ? "end" : "middle",
      class: "chart-label",
    });
    label.textContent = xFormatter.format(new Date(series[index].start));
    svg.append(label);
  }

  const yCaption = svgElement("text", { x: padding.left, y: 11, class: "chart-caption" });
  yCaption.textContent = "New signatures";
  svg.append(yCaption);
  element.append(svg);
  const measured = series.filter((period) => Number.isFinite(period.value)).length;
  const adjective = unit === "hour" ? "hourly" : unit === "day" ? "daily" : "5-minute";
  element.setAttribute("aria-label", `${number.format(measured)} measured ${adjective} periods. ${summaryElement.textContent}`);
}

function renderFiveMinuteChart(snapshots) {
  const compact = elements.fiveMinuteChart.clientWidth < 500;
  const series = buildFiveMinuteSeries(snapshots);
  const visibleSeries = compact ? series.slice(-24) : series;
  elements.fiveMinuteHeading.textContent = compact
    ? "5-minute signatures · past 2 hours"
    : "5-minute signatures · past 6 hours";
  renderMovementChart(
    elements.fiveMinuteChart,
    elements.fiveMinuteSummary,
    visibleSeries,
    fiveMinuteChartTime,
    "five-minute",
    12,
    "line",
  );
}

function renderHourlyChart(snapshots) {
  const compact = elements.hourlyChart.clientWidth < 500;
  const series = buildHourlySeries(snapshots);
  const visibleSeries = compact ? series.slice(-12) : series;
  elements.hourlyHeading.textContent = compact
    ? "Hourly signatures · past 12 hours"
    : "Hourly signatures · past 24 hours";
  renderMovementChart(
    elements.hourlyChart,
    elements.hourlySummary,
    visibleSeries,
    hourChartTime,
    "hour",
  );
}

function renderDailyChart(snapshots) {
  renderMovementChart(
    elements.dailyChart,
    elements.dailySummary,
    buildDailySeries(snapshots),
    shortDate,
    "day",
  );
}

function renderThresholds(petition) {
  elements.thresholds.replaceChildren();
  const thresholds = Array.isArray(petition.thresholds_json)
    ? [...petition.thresholds_json].sort((left, right) => {
        const leftDate = parseSourceDate(left.reachedAt)?.getTime() ?? null;
        const rightDate = parseSourceDate(right.reachedAt)?.getTime() ?? null;
        if (leftDate !== null && rightDate !== null) return leftDate - rightDate;
        if (leftDate !== null) return -1;
        if (rightDate !== null) return 1;
        return left.value - right.value;
      })
    : [];
  if (!thresholds.length) {
    const message = document.createElement("p");
    message.className = "empty-detail";
    message.textContent = "No signature thresholds are listed for this petition.";
    elements.thresholds.append(message);
    return;
  }

  for (const threshold of thresholds) {
    const row = document.createElement("div");
    row.className = `threshold-row${threshold.reached ? " reached" : ""}`;
    const index = document.createElement("span");
    index.className = "threshold-index";
    index.textContent = threshold.reached ? "✓" : threshold.level;
    const copy = document.createElement("div");
    const name = document.createElement("p");
    name.className = "threshold-name";
    const signatureTarget = `${number.format(threshold.value)} ${threshold.value === 1 ? "signature" : "signatures"}`;
    name.textContent = threshold.reached ? `${signatureTarget} reached` : `${signatureTarget} target`;
    const date = document.createElement("p");
    date.className = "threshold-date";
    date.textContent = threshold.reachedAt ? `Reached ${formatDate(threshold.reachedAt)}` : `${number.format(Math.max(0, threshold.value - petition.signed_count))} signatures remaining`;
    copy.append(name, date);
    row.append(index, copy);
    elements.thresholds.append(row);
  }
}

function addMetadata(label, value) {
  const row = document.createElement("div");
  row.className = "metadata-row";
  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.textContent = value;
  row.append(term, description);
  elements.metadata.append(row);
}

function renderMetadata(petition) {
  elements.metadata.replaceChildren();
  addMetadata("Public status", labelStatus(petition.public_status || petition.status));
  addMetadata("Internal status", labelStatus(petition.internal_status || "Not listed"));
  addMetadata("Views", number.format(petition.view_count));
  addMetadata("Shares", number.format(petition.share_count));
  addMetadata("Withdrawn signatures", number.format(petition.withdrawn_count));
  addMetadata("Published", formatDate(petition.published_at));
  addMetadata("Deadline", formatDate(petition.expires_at));
  addMetadata("Last checked", formatDate(petition.last_fetched_at));
}

function activateReveals() {
  const blocks = document.querySelectorAll(".reveal");
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    blocks.forEach((block) => block.classList.add("visible"));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.08 },
  );
  blocks.forEach((block) => observer.observe(block));
}

function renderDetail(detail) {
  const { petition, snapshots, recentSnapshots = snapshots } = detail;
  show("dashboard");
  renderHero(petition);
  renderStats(petition, snapshots);
  renderLineChart(snapshots);
  renderFiveMinuteChart(recentSnapshots);
  renderHourlyChart(snapshots);
  renderDailyChart(snapshots);
  renderThresholds(petition);
  renderMetadata(petition);
  activateReveals();
}

async function loadDetail(uuid) {
  state.activeId = uuid;
  setPicker();
  const detail = await fetchJson(`/api/petitions/${encodeURIComponent(uuid)}?range=${state.range}`);
  state.detail = detail;
  renderDetail(detail);
}

async function load() {
  show("loading");
  try {
    const { petitions } = await fetchJson("/api/petitions");
    state.petitions = petitions;
    if (!petitions.length) {
      elements.picker.replaceChildren(new Option("No tracked petitions", ""));
      elements.picker.disabled = true;
      show("empty");
      return;
    }
    const requested = new URLSearchParams(location.search).get("petition");
    const selected = petitions.find((petition) => petition.uuid === requested) || petitions[0];
    await loadDetail(selected.uuid);
  } catch (error) {
    elements.errorMessage.textContent = error instanceof Error ? error.message : "Unknown error";
    show("error");
  }
}

elements.picker.addEventListener("change", async (event) => {
  try {
    const uuid = event.target.value;
    history.replaceState({}, "", `?petition=${encodeURIComponent(uuid)}`);
    await loadDetail(uuid);
  } catch (error) {
    elements.errorMessage.textContent = error instanceof Error ? error.message : "Unknown error";
    show("error");
  }
});

document.querySelectorAll("[data-range]").forEach((button) => {
  button.addEventListener("click", async () => {
    if (button.dataset.range === state.range || !state.activeId) return;
    state.range = button.dataset.range;
    document.querySelectorAll("[data-range]").forEach((candidate) => {
      candidate.classList.toggle("active", candidate === button);
      candidate.setAttribute("aria-pressed", String(candidate === button));
    });
    try {
      await loadDetail(state.activeId);
    } catch (error) {
      elements.errorMessage.textContent = error instanceof Error ? error.message : "Unknown error";
      show("error");
    }
  });
});

elements.retry.addEventListener("click", load);
load();

let refreshInProgress = false;
setInterval(async () => {
  if (document.visibilityState !== "visible" || !state.activeId || refreshInProgress) return;
  refreshInProgress = true;
  try {
    await loadDetail(state.activeId);
  } catch (error) {
    console.error("Background refresh failed", error);
  } finally {
    refreshInProgress = false;
  }
}, 180_000);
