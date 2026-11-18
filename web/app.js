import * as Plot from "https://cdn.jsdelivr.net/npm/@observablehq/plot@0.6.17/+esm";

const CO2_URL = "https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.txt";
const ICE_CSV_URL = new URL("./data/sea-ice-september.csv", import.meta.url);
const ICE_MAP_URL = new URL("./data/sea-ice-extent-polar.json", import.meta.url);
const BASEMAP_URL = new URL("./data/basemap-polar.json", import.meta.url);

const DEFAULT_YEAR = 2012;
const BASELINE_START = 1979;
const BASELINE_END = 2000;
const SVG_NS = "http://www.w3.org/2000/svg";
const MAP_SIZE = 640;
const MAP_CENTER = MAP_SIZE / 2;
const MAP_RADIUS = 300;
const MAP_VIEW_RADIUS_KM = 5600;
const MIN_ZOOM = 0.85;
const MAX_ZOOM = 8;

const byId = (id) => document.getElementById(id);
const dom = {
  year: byId("year"),
  mapYear: byId("map-year"),
  mapYearLabel: byId("map-year-label"),
  status: byId("status"),
  details: byId("details"),
  detailsYear: byId("details-year"),
  co2Value: byId("co2-value"),
  iceValue: byId("ice-value"),
  co2Context: byId("co2-context"),
  iceContext: byId("ice-context"),
  iceSource: byId("ice-source"),
  scatter: byId("scatter"),
  scatterCaption: byId("scatter-caption"),
  co2Series: byId("co2-series"),
  co2SeriesCaption: byId("co2-series-caption"),
  iceSeries: byId("ice-series"),
  iceSeriesCaption: byId("ice-series-caption"),
  dataBody: byId("data-body"),
  mapOnlyNote: byId("map-only-note"),
  map: byId("map"),
  mapCaption: byId("map-caption"),
  legendYear: byId("legend-year"),
  zoomIn: byId("zoom-in"),
  zoomOut: byId("zoom-out"),
  resetView: byId("reset-view"),
};

let records = [];
let recordByYear = new Map();
let baseline = { co2: 0, ice: 0 };
let regression = { slope: 0, intercept: 0, r2: 0 };
let mapFeatures = new Map();
let basemap = null;
let mapSvg = null;
let mapContent = null;
let mapIceFill = null;
let mapIceEdge = null;
let mapBaseline = null;
let mapLabels = null;
let mapScale = null;
let mapLabelNodes = [];
let mapScaleNodes = null;
let mapClientWidth = 0;
let mapView = { zoom: 1, panX: 0, panY: 0 };
let mapDrag = null;
let renderedMapYear = null;
let renderedBaseline = false;
let mapAvailable = false;
let recoverableStatus = false;
let detailYear = DEFAULT_YEAR;
let mapYear = DEFAULT_YEAR;
let detailsVisible = true;
let resizeTimer = null;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const mean = (values) => values.reduce((total, value) => total + value, 0) / values.length;
const ordinal = (number) => {
  const suffixes = ["th", "st", "nd", "rd"];
  const remainder = number % 100;
  return `${number}${suffixes[(remainder - 20) % 10] || suffixes[remainder] || suffixes[0]}`;
};
const formatSigned = (value, digits = 1) =>
  `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}`;

function setStatus(text, { error = false } = {}) {
  dom.status.hidden = false;
  dom.status.textContent = text;
  dom.status.classList.toggle("error", error);
  dom.status.setAttribute("role", error ? "alert" : "status");
  recoverableStatus = false;
}

function clearStatus() {
  dom.status.hidden = true;
  dom.status.textContent = "";
  dom.status.classList.remove("error");
  dom.status.setAttribute("role", "status");
  recoverableStatus = false;
}

function clearRecoverableStatus() {
  if (recoverableStatus) clearStatus();
}

function setControlsEnabled(enabled) {
  dom.year.disabled = !enabled;
  dom.mapYear.disabled = !enabled || !mapAvailable;
}

async function fetchText(url, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  let response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (error) {
    const reason = error.name === "AbortError" ? "timed out" : error.message;
    throw new Error(`${label} could not be loaded (${reason}).`);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new Error(`${label} could not be loaded (HTTP ${response.status}).`);
  }
  return response.text();
}

async function fetchJson(url, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  let response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (error) {
    const reason = error.name === "AbortError" ? "timed out" : error.message;
    throw new Error(`${label} could not be loaded (${reason}).`);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new Error(`${label} could not be loaded (HTTP ${response.status}).`);
  }
  return response.json();
}

function parseCo2(text) {
  const months = new Map();
  for (const line of text.split(/\r?\n/)) {
    const stripped = line.trim();
    if (!stripped || stripped.startsWith("#")) continue;
    const parts = stripped.split(/\s+/);
    if (parts.length < 5) continue;
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const average = Number(parts[3]);
    if (!Number.isInteger(year) || !Number.isInteger(month)) continue;
    if (month < 1 || month > 12) continue;
    if (!Number.isFinite(average) || average < 0) continue;
    if (!months.has(year)) months.set(year, new Map());
    const monthValues = months.get(year);
    if (!monthValues.has(month)) monthValues.set(month, []);
    monthValues.get(month).push(average);
  }
  const annual = [];
  for (const [year, monthValues] of months) {
    if (monthValues.size === 12) {
      const monthlyMeans = [...monthValues.values()].map((values) => mean(values));
      annual.push({ year, co2: mean(monthlyMeans) });
    }
  }
  annual.sort((left, right) => left.year - right.year);
  if (annual.length === 0) {
    throw new Error("The CO₂ file had no complete years.");
  }
  return annual;
}

function parseIceCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) {
    throw new Error("The sea ice file was empty.");
  }
  const header = lines[0].split(",").map((name) => name.trim().toLowerCase());
  const yearIndex = header.indexOf("year");
  const extentIndex = header.indexOf("extent");
  const sourceIndex = header.indexOf("source_dataset");
  if (yearIndex === -1 || extentIndex === -1) {
    throw new Error("The sea ice file is missing the year or extent column.");
  }
  const rows = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = line.split(",").map((cell) => cell.trim());
    const year = Number(cells[yearIndex]);
    const extent = Number(cells[extentIndex]);
    if (!Number.isInteger(year) || !Number.isFinite(extent) || extent < 0) continue;
    rows.push({
      year,
      ice: extent,
      iceSource: sourceIndex === -1 ? "NSIDC" : cells[sourceIndex],
    });
  }
  if (rows.length === 0) {
    throw new Error("The sea ice file had no values.");
  }
  return rows;
}

function combineRecords(co2Rows, iceRows) {
  const iceByYear = new Map(iceRows.map((row) => [row.year, row]));
  const combined = [];
  for (const row of co2Rows) {
    const ice = iceByYear.get(row.year);
    if (!ice) continue;
    combined.push({
      year: row.year,
      co2: row.co2,
      ice: ice.ice,
      iceSource: ice.iceSource,
    });
  }
  combined.sort((left, right) => left.year - right.year);
  if (combined.length < 2) {
    throw new Error("There are too few years with both CO₂ and sea ice values.");
  }
  return combined;
}

function computeStats(rows) {
  const baselineRows = rows.filter(
    (row) => row.year >= BASELINE_START && row.year <= BASELINE_END,
  );
  const baselineValues = {
    co2: mean(baselineRows.map((row) => row.co2)),
    ice: mean(baselineRows.map((row) => row.ice)),
  };
  const iceRanks = new Map();
  [...rows]
    .sort((left, right) => left.ice - right.ice)
    .forEach((row, index) => iceRanks.set(row.year, index + 1));
  const co2Ranks = new Map();
  [...rows]
    .sort((left, right) => right.co2 - left.co2)
    .forEach((row, index) => co2Ranks.set(row.year, index + 1));
  for (const row of rows) {
    row.iceRank = iceRanks.get(row.year);
    row.co2Rank = co2Ranks.get(row.year);
  }
  const count = rows.length;
  const sumX = rows.reduce((total, row) => total + row.co2, 0);
  const sumY = rows.reduce((total, row) => total + row.ice, 0);
  const sumXX = rows.reduce((total, row) => total + row.co2 * row.co2, 0);
  const sumYY = rows.reduce((total, row) => total + row.ice * row.ice, 0);
  const sumXY = rows.reduce((total, row) => total + row.co2 * row.ice, 0);
  const slope = (count * sumXY - sumX * sumY) / (count * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / count;
  const correlation =
    (count * sumXY - sumX * sumY) /
    Math.sqrt((count * sumXX - sumX * sumX) * (count * sumYY - sumY * sumY));
  return {
    baseline: baselineValues,
    regression: { slope, intercept, r2: correlation * correlation },
  };
}

async function loadCore() {
  const [co2Text, iceText] = await Promise.all([
    fetchText(CO2_URL, "CO₂ data"),
    fetchText(ICE_CSV_URL, "Sea ice data"),
  ]);
  const rows = combineRecords(parseCo2(co2Text), parseIceCsv(iceText));
  const stats = computeStats(rows);
  return { rows, ...stats };
}

async function loadMap() {
  const [extent, base] = await Promise.all([
    fetchJson(ICE_MAP_URL, "Map data"),
    fetchJson(BASEMAP_URL, "Map background"),
  ]);
  if (!extent || !Array.isArray(extent.features)) {
    throw new Error("Map data is missing features.");
  }
  if (!base || !base.land || !Array.isArray(base.graticule)) {
    throw new Error("Map background is incomplete.");
  }
  return { extent, base };
}

function populateControls() {
  const firstYear = records[0].year;
  const lastYear = records.at(-1).year;
  const defaultYear = recordByYear.has(DEFAULT_YEAR) ? DEFAULT_YEAR : firstYear;
  const options = records.map((row) => new Option(String(row.year), String(row.year)));
  dom.year.replaceChildren(new Option("Choose a year…", ""), ...options);
  dom.year.value = String(defaultYear);
  dom.mapYear.min = String(firstYear);
  dom.mapYear.max = String(lastYear);
  dom.mapYear.value = String(defaultYear);
  dom.mapYearLabel.value = String(defaultYear);
  detailYear = defaultYear;
  mapYear = defaultYear;
}

function populateDataTable() {
  const fragment = document.createDocumentFragment();
  for (const row of records) {
    const tableRow = document.createElement("tr");
    tableRow.dataset.year = String(row.year);
    const values = [row.year, row.co2.toFixed(2), row.ice.toFixed(2), row.iceSource];
    values.forEach((value, index) => {
      const cell = document.createElement(index === 0 ? "th" : "td");
      if (index === 0) cell.scope = "row";
      cell.textContent = String(value);
      tableRow.append(cell);
    });
    fragment.append(tableRow);
  }
  dom.dataBody.replaceChildren(fragment);
}

function co2RankText(row) {
  if (row.co2Rank === 1) return "It is the highest annual mean in this record.";
  return `It is the ${ordinal(row.co2Rank)} highest of ${records.length} annual means.`;
}

function iceRankText(row) {
  if (row.iceRank === 1) return "It is the lowest September extent in this record.";
  return `It is the ${ordinal(row.iceRank)} lowest of ${records.length} Septembers.`;
}

function renderDetails() {
  const row = recordByYear.get(detailYear);
  if (!row) return;
  const first = records[0];
  const last = records.at(-1);
  const iceValues = records.map((record) => record.ice);
  const minIce = Math.min(...iceValues);
  const maxIce = Math.max(...iceValues);
  const co2Anomaly = row.co2 - baseline.co2;
  const iceAnomaly = row.ice - baseline.ice;

  dom.detailsYear.textContent = String(row.year);
  dom.co2Value.textContent = row.co2.toFixed(2);
  dom.iceValue.textContent = row.ice.toFixed(2);
  dom.co2Context.textContent = `${formatSigned(co2Anomaly)} ppm vs the 1979–2000 average (${baseline.co2.toFixed(1)} ppm). ${co2RankText(row)}`;
  dom.iceContext.textContent = `${formatSigned(iceAnomaly, 2)} million km² vs the 1979–2000 average (${baseline.ice.toFixed(2)}). ${iceRankText(row)}`;
  dom.iceSource.textContent = `Source: ${row.iceSource} processing stream. September monthly mean extent.`;

  dom.scatterCaption.textContent = `The highlighted year is ${row.year}. Across the ${records.length} years, the least-squares line falls by about ${Math.abs(regression.slope).toFixed(3)} million km² for each 1 ppm rise in CO₂ (R² = ${regression.r2.toFixed(2)}).`;
  dom.co2SeriesCaption.textContent = `The dashed line marks ${row.year}. The annual mean rose from ${first.co2.toFixed(1)} ppm in ${first.year} to ${last.co2.toFixed(1)} ppm in ${last.year}.`;
  dom.iceSeriesCaption.textContent = `The dashed line marks ${row.year}. September extent ranged from ${minIce.toFixed(2)} to ${maxIce.toFixed(2)} million km² over ${first.year}–${last.year}.`;

  dom.scatter.setAttribute(
    "aria-label",
    `Scatter plot of annual mean CO₂ against September sea ice extent, ${first.year} to ${last.year}. The highlighted year is ${row.year}: CO₂ ${row.co2.toFixed(2)} ppm and September sea ice ${row.ice.toFixed(2)} million square kilometers.`,
  );
  dom.co2Series.setAttribute(
    "aria-label",
    `Line chart of annual mean CO₂ from ${first.year} to ${last.year}. The highlighted year is ${row.year}: ${row.co2.toFixed(2)} ppm.`,
  );
  dom.iceSeries.setAttribute(
    "aria-label",
    `Line chart of September Arctic sea ice extent from ${first.year} to ${last.year}. The highlighted year is ${row.year}: ${row.ice.toFixed(2)} million square kilometers.`,
  );

  for (const tableRow of dom.dataBody.querySelectorAll("tr")) {
    const selectedRow = Number(tableRow.dataset.year) === detailYear;
    tableRow.classList.toggle("selected", selectedRow);
    if (selectedRow) {
      tableRow.setAttribute("aria-current", "true");
    } else {
      tableRow.removeAttribute("aria-current");
    }
  }
  renderCharts();
}

function hidePlotSvg(container) {
  const svg = container.querySelector("svg");
  if (!svg) return;
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
}

function renderCharts() {
  if (!detailsVisible) return;
  const selected = recordByYear.get(detailYear);
  if (!selected) return;
  const fullWidth = Math.max(280, Math.floor(dom.scatter.clientWidth || 640));
  const halfWidth = Math.max(260, Math.floor(dom.co2Series.clientWidth || fullWidth / 2));
  const minCo2 = Math.min(...records.map((row) => row.co2));
  const maxCo2 = Math.max(...records.map((row) => row.co2));
  const trend = [
    { co2: minCo2, ice: regression.intercept + regression.slope * minCo2 },
    { co2: maxCo2, ice: regression.intercept + regression.slope * maxCo2 },
  ];

  const scatter = Plot.plot({
    width: fullWidth,
    height: 380,
    marginLeft: 68,
    marginRight: 24,
    marginBottom: 48,
    style: { background: "transparent", color: "var(--text)" },
    x: { label: "Annual mean CO₂ (ppm) →", grid: true, nice: true },
    y: { label: "↑ September sea ice (million km²)", grid: true, nice: true },
    marks: [
      Plot.line(records, {
        x: "co2",
        y: "ice",
        stroke: "var(--chart-line)",
        strokeWidth: 1,
        opacity: 0.7,
      }),
      Plot.dot(records, {
        x: "co2",
        y: "ice",
        fill: "var(--chart-dot)",
        r: 3,
        tip: true,
        title: (row) =>
          `${row.year}\nCO₂ ${row.co2.toFixed(2)} ppm\nSea ice ${row.ice.toFixed(2)} million km²`,
      }),
      Plot.line(trend, {
        x: "co2",
        y: "ice",
        stroke: "var(--accent)",
        strokeWidth: 2,
        strokeDasharray: "5 4",
      }),
      Plot.dot([selected], {
        x: "co2",
        y: "ice",
        fill: "var(--accent)",
        r: 7,
        stroke: "var(--surface)",
        strokeWidth: 2,
      }),
      Plot.text([selected], {
        x: "co2",
        y: "ice",
        text: (row) => String(row.year),
        dy: -16,
        fill: "var(--text)",
        fontWeight: 700,
      }),
    ],
  });
  dom.scatter.replaceChildren(scatter);
  hidePlotSvg(dom.scatter);

  const co2Series = Plot.plot({
    width: halfWidth,
    height: 230,
    marginLeft: 64,
    marginRight: 18,
    marginBottom: 40,
    style: { background: "transparent", color: "var(--text)" },
    x: { label: "Year", tickFormat: "d" },
    y: { label: "CO₂ (ppm)", grid: true, nice: true },
    marks: [
      Plot.ruleX([selected.year], {
        stroke: "var(--muted)",
        strokeDasharray: "3 3",
      }),
      Plot.line(records, {
        x: "year",
        y: "co2",
        stroke: "var(--chart-co2)",
        strokeWidth: 2,
      }),
      Plot.dot([selected], {
        x: "year",
        y: "co2",
        fill: "var(--chart-co2)",
        r: 5,
        stroke: "var(--surface)",
        strokeWidth: 2,
      }),
      Plot.text([selected], {
        x: "year",
        y: "co2",
        text: (row) => String(row.year),
        dy: -14,
        fill: "var(--text)",
        fontWeight: 700,
      }),
    ],
  });
  dom.co2Series.replaceChildren(co2Series);
  hidePlotSvg(dom.co2Series);

  const iceSeries = Plot.plot({
    width: halfWidth,
    height: 230,
    marginLeft: 64,
    marginRight: 18,
    marginBottom: 40,
    style: { background: "transparent", color: "var(--text)" },
    x: { label: "Year", tickFormat: "d" },
    y: { label: "Sea ice (million km²)", grid: true, nice: true },
    marks: [
      Plot.ruleX([selected.year], {
        stroke: "var(--muted)",
        strokeDasharray: "3 3",
      }),
      Plot.line(records, {
        x: "year",
        y: "ice",
        stroke: "var(--chart-ice)",
        strokeWidth: 2,
      }),
      Plot.dot([selected], {
        x: "year",
        y: "ice",
        fill: "var(--chart-ice)",
        r: 5,
        stroke: "var(--surface)",
        strokeWidth: 2,
      }),
      Plot.text([selected], {
        x: "year",
        y: "ice",
        text: (row) => String(row.year),
        dy: -14,
        fill: "var(--text)",
        fontWeight: 700,
      }),
    ],
  });
  dom.iceSeries.replaceChildren(iceSeries);
  hidePlotSvg(dom.iceSeries);
}

function svgEl(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

function linePath(coordinates) {
  return coordinates
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x} ${y}`)
    .join(" ");
}

function ringPath(ring) {
  return `${linePath(ring)} Z`;
}

function geometryPath(geometry) {
  if (!geometry) return "";
  switch (geometry.type) {
    case "Polygon":
      return geometry.coordinates.map(ringPath).join("");
    case "MultiPolygon":
      return geometry.coordinates
        .flatMap((polygon) => polygon.map(ringPath))
        .join("");
    case "LineString":
      return linePath(geometry.coordinates);
    case "MultiLineString":
      return geometry.coordinates.map(linePath).join("");
    case "GeometryCollection":
      return geometry.geometries.map(geometryPath).join("");
    default:
      return "";
  }
}

function svgPoint(event) {
  const bounds = mapSvg.getBoundingClientRect();
  const width = mapClientWidth || bounds.width;
  return {
    x: ((event.clientX - bounds.left) / width) * MAP_SIZE,
    y: ((event.clientY - bounds.top) / width) * MAP_SIZE,
  };
}

function zoomBy(factor, anchorX = MAP_CENTER, anchorY = MAP_CENTER) {
  if (!mapSvg) return;
  const nextZoom = clamp(mapView.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  if (nextZoom === mapView.zoom) return;
  const ratio = nextZoom / mapView.zoom;
  mapView.panX = anchorX - (anchorX - mapView.panX) * ratio;
  mapView.panY = anchorY - (anchorY - mapView.panY) * ratio;
  mapView.zoom = nextZoom;
  updateMapView();
}

function resetMapView() {
  if (!mapSvg) return;
  mapView = { zoom: 1, panX: 0, panY: 0 };
  updateMapView();
}

function attachMapInteraction() {
  mapSvg.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const point = svgPoint(event);
      zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15, point.x, point.y);
    },
    { passive: false },
  );

  mapSvg.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    mapDrag = { x: event.clientX, y: event.clientY };
    mapSvg.setPointerCapture(event.pointerId);
  });

  mapSvg.addEventListener("pointermove", (event) => {
    if (!mapDrag) return;
    const width = mapClientWidth || mapSvg.getBoundingClientRect().width;
    const factor = MAP_SIZE / width;
    mapView.panX += (event.clientX - mapDrag.x) * factor;
    mapView.panY += (event.clientY - mapDrag.y) * factor;
    mapDrag = { x: event.clientX, y: event.clientY };
    updateMapView();
  });

  const endDrag = (event) => {
    if (!mapDrag) return;
    mapDrag = null;
    try {
      mapSvg.releasePointerCapture(event.pointerId);
    } catch {}
  };
  mapSvg.addEventListener("pointerup", endDrag);
  mapSvg.addEventListener("pointercancel", endDrag);

  mapSvg.addEventListener("keydown", (event) => {
    const step = 24;
    switch (event.key) {
      case "ArrowLeft":
        mapView.panX += step;
        break;
      case "ArrowRight":
        mapView.panX -= step;
        break;
      case "ArrowUp":
        mapView.panY += step;
        break;
      case "ArrowDown":
        mapView.panY -= step;
        break;
      case "+":
      case "=":
        event.preventDefault();
        zoomBy(1.25);
        return;
      case "-":
      case "_":
        event.preventDefault();
        zoomBy(1 / 1.25);
        return;
      case "0":
        event.preventDefault();
        resetMapView();
        return;
      default:
        return;
    }
    event.preventDefault();
    updateMapView();
  });
}

function buildMapSvg() {
  mapSvg = svgEl("svg", {
    viewBox: `0 0 ${MAP_SIZE} ${MAP_SIZE}`,
    role: "img",
    tabindex: "0",
    "aria-describedby": "map-help",
    "aria-label": "Interactive polar map of September Arctic sea ice extent.",
  });
  const defs = svgEl("defs");
  const clip = svgEl("clipPath", { id: "map-clip" });
  clip.append(svgEl("circle", { cx: MAP_CENTER, cy: MAP_CENTER, r: MAP_RADIUS }));
  defs.append(clip);

  const ocean = svgEl("circle", {
    class: "map-ocean",
    cx: MAP_CENTER,
    cy: MAP_CENTER,
    r: MAP_RADIUS,
  });
  const clipped = svgEl("g", { "clip-path": "url(#map-clip)" });
  const content = svgEl("g", { id: "map-content" });
  const graticule = svgEl("g", { "aria-hidden": "true" });
  for (const line of basemap.graticule) {
    graticule.append(
      svgEl("path", { class: "map-graticule", d: geometryPath(line) }),
    );
  }
  const land = svgEl("path", { class: "map-land", d: geometryPath(basemap.land) });
  const iceFill = svgEl("path", { class: "map-ice", d: "" });
  const baselinePath = svgEl("path", { class: "map-baseline", d: "" });
  const iceEdge = svgEl("path", { class: "map-ice-edge", d: "" });
  content.append(graticule, land, iceFill, baselinePath, iceEdge);
  clipped.append(content);

  const labels = svgEl("g", { "aria-hidden": "true" });
  const scale = svgEl("g", { "aria-hidden": "true" });
  const border = svgEl("circle", {
    class: "map-border",
    cx: MAP_CENTER,
    cy: MAP_CENTER,
    r: MAP_RADIUS,
  });
  mapSvg.append(defs, ocean, clipped, labels, scale, border);
  dom.map.replaceChildren(mapSvg);
  mapContent = content;
  mapLabels = labels;
  mapScale = scale;
  mapIceFill = iceFill;
  mapIceEdge = iceEdge;
  mapBaseline = baselinePath;
  mapClientWidth = 0;
  renderedMapYear = null;
  renderedBaseline = false;
  buildMapLabels();
  buildMapScale();
  attachMapInteraction();
}

function buildMapLabels() {
  mapLabels.replaceChildren();
  mapLabelNodes = [];
  const poleDot = svgEl("circle", { class: "map-pole", r: 3 });
  const poleText = svgEl("text", { class: "map-label", "text-anchor": "middle" });
  poleText.textContent = "North Pole";
  mapLabels.append(poleDot, poleText);
  mapLabelNodes.push({ kind: "pole", dot: poleDot, text: poleText, x: 0, y: 0 });
  for (const label of basemap.labels) {
    const text = svgEl("text", { class: "map-label", "text-anchor": "middle" });
    text.textContent = label.name;
    mapLabels.append(text);
    mapLabelNodes.push({
      kind: "label",
      text,
      x: label.coordinates[0],
      y: label.coordinates[1],
    });
  }
}

function updateMapLabels() {
  if (!mapLabelNodes.length) return;
  const scale = (MAP_RADIUS / MAP_VIEW_RADIUS_KM) * mapView.zoom;
  const centerX = MAP_CENTER + mapView.panX;
  const centerY = MAP_CENTER + mapView.panY;
  for (const item of mapLabelNodes) {
    const screenX = centerX + item.x * scale;
    const screenY = centerY - item.y * scale;
    const visible =
      Math.hypot(screenX - MAP_CENTER, screenY - MAP_CENTER) <= MAP_RADIUS - 6;
    item.text.style.display = visible ? "" : "none";
    item.text.setAttribute("x", screenX);
    item.text.setAttribute("y", item.kind === "pole" ? screenY - 10 : screenY);
    if (item.kind === "pole") {
      item.dot.style.display = visible ? "" : "none";
      item.dot.setAttribute("cx", screenX);
      item.dot.setAttribute("cy", screenY);
    }
  }
}

function buildMapScale() {
  mapScale.replaceChildren();
  const group = svgEl("g", { class: "map-scale" });
  const rect = svgEl("rect", { rx: 4 });
  const bar = svgEl("line", {});
  const startTick = svgEl("line", {});
  const endTick = svgEl("line", {});
  const text = svgEl("text", { "text-anchor": "middle" });
  group.append(rect, bar, startTick, endTick, text);
  mapScale.append(group);
  mapScaleNodes = { rect, bar, startTick, endTick, text };
}

function updateMapScale() {
  if (!mapScaleNodes) return;
  const scale = (MAP_RADIUS / MAP_VIEW_RADIUS_KM) * mapView.zoom;
  const candidates = [100, 200, 500, 1000, 2000, 4000];
  let distance = candidates[0];
  for (const candidate of candidates) {
    const pixels = candidate * scale;
    if (pixels < 70) {
      distance = candidate;
      continue;
    }
    if (pixels <= 140) {
      distance = candidate;
      break;
    }
    break;
  }
  const length = distance * scale;
  const x = 26;
  const y = MAP_SIZE - 30;
  mapScaleNodes.rect.setAttribute("x", x - 8);
  mapScaleNodes.rect.setAttribute("y", y - 24);
  mapScaleNodes.rect.setAttribute("width", length + 16);
  mapScaleNodes.rect.setAttribute("height", 34);
  mapScaleNodes.bar.setAttribute("x1", x);
  mapScaleNodes.bar.setAttribute("y1", y);
  mapScaleNodes.bar.setAttribute("x2", x + length);
  mapScaleNodes.bar.setAttribute("y2", y);
  mapScaleNodes.startTick.setAttribute("x1", x);
  mapScaleNodes.startTick.setAttribute("y1", y - 4);
  mapScaleNodes.startTick.setAttribute("x2", x);
  mapScaleNodes.startTick.setAttribute("y2", y + 4);
  mapScaleNodes.endTick.setAttribute("x1", x + length);
  mapScaleNodes.endTick.setAttribute("y1", y - 4);
  mapScaleNodes.endTick.setAttribute("x2", x + length);
  mapScaleNodes.endTick.setAttribute("y2", y + 4);
  mapScaleNodes.text.setAttribute("x", x + length / 2);
  mapScaleNodes.text.setAttribute("y", y - 7);
  mapScaleNodes.text.textContent = `${distance.toLocaleString("en-US")} km`;
}

function updateMapView() {
  if (!mapSvg) return;
  const scale = (MAP_RADIUS / MAP_VIEW_RADIUS_KM) * mapView.zoom;
  mapContent.setAttribute(
    "transform",
    `translate(${MAP_CENTER + mapView.panX} ${MAP_CENTER + mapView.panY}) scale(${scale} ${-scale})`,
  );
  mapSvg.dataset.zoom = mapView.zoom.toFixed(3);
  mapSvg.dataset.panX = mapView.panX.toFixed(1);
  mapSvg.dataset.panY = mapView.panY.toFixed(1);
  updateMapLabels();
  updateMapScale();
}

function renderMap() {
  if (!mapSvg || !basemap || mapFeatures.size === 0) return;
  const entry = mapFeatures.get(mapYear);
  if (!entry) return;
  const first = records[0];
  const baselineFeature = mapFeatures.get(first.year);
  const row = recordByYear.get(mapYear);
  if (!row) return;

  if (renderedMapYear !== mapYear) {
    mapIceFill.setAttribute("d", geometryPath(entry.polygon));
    mapIceEdge.setAttribute("d", geometryPath(entry.line));
    renderedMapYear = mapYear;
  }
  if (!renderedBaseline) {
    mapBaseline.setAttribute("d", geometryPath(baselineFeature.line));
    renderedBaseline = true;
  }

  mapClientWidth = mapSvg.getBoundingClientRect().width;
  const cssScale = Math.max(mapClientWidth / MAP_SIZE, 0.1);
  mapSvg.style.setProperty("--map-label-size", `${11.5 / cssScale}px`);
  mapSvg.style.setProperty("--map-scale-size", `${10 / cssScale}px`);
  updateMapView();

  dom.legendYear.textContent = String(mapYear);
  const extentText = `${row.ice.toFixed(2)} million km²`;
  if (mapYear === first.year) {
    dom.mapCaption.textContent = `September ${mapYear}: ${extentText}. This is also the 1979 comparison year, so the dashed outline sits on the same ice edge.`;
  } else {
    const rankText =
      row.iceRank === 1
        ? "the lowest September extent in this record"
        : `the ${ordinal(row.iceRank)} lowest September extent in this record`;
    dom.mapCaption.textContent = `September ${mapYear}: ${extentText}, ${rankText}. The orange dashed outline is September ${first.year} (${first.ice.toFixed(2)} million km²).`;
  }
  mapSvg.setAttribute(
    "aria-label",
    `Interactive polar map of September ${mapYear} Arctic sea ice extent, ${extentText}. Use the arrow keys to pan, plus and minus to zoom, and 0 to reset.`,
  );
}

function setupMap({ extent, base }) {
  basemap = base;
  mapFeatures = new Map();
  for (const feature of extent.features) {
    const properties = feature.properties;
    if (!mapFeatures.has(properties.year)) {
      mapFeatures.set(properties.year, {});
    }
    const entry = mapFeatures.get(properties.year);
    entry[properties.kind] = feature.geometry;
    entry.extent = properties.extent_million_km2;
  }
  for (const row of records) {
    const entry = mapFeatures.get(row.year);
    if (!entry || !entry.polygon || !entry.line) {
      throw new Error(`The map is missing ${row.year}.`);
    }
  }
  buildMapSvg();
  renderMap();
  mapAvailable = true;
  dom.zoomIn.disabled = false;
  dom.zoomOut.disabled = false;
  dom.resetView.disabled = false;
}

function showMapError(error) {
  mapSvg = null;
  mapContent = null;
  mapAvailable = false;
  dom.map.replaceChildren();
  const message = document.createElement("p");
  message.className = "status error";
  message.setAttribute("role", "alert");
  message.textContent = `${error.message} The charts and values are still available.`;
  dom.map.append(message);
  dom.mapCaption.textContent =
    "The map could not be loaded. The charts and values still use the original data.";
  dom.zoomIn.disabled = true;
  dom.zoomOut.disabled = true;
  dom.resetView.disabled = true;
  dom.mapYear.disabled = true;
}

function updateUrlState({ year = null, map = null } = {}) {
  const url = new URL(window.location.href);
  url.search = "";
  if (year !== null) url.searchParams.set("year", String(year));
  if (map !== null) url.searchParams.set("map", String(map));
  window.history.replaceState(null, "", url.href);
}

function showDetails(year, { updateUrl = true } = {}) {
  if (!recordByYear.has(year)) return;
  detailYear = year;
  mapYear = year;
  detailsVisible = true;
  dom.year.value = String(year);
  dom.mapYear.value = String(year);
  dom.mapYearLabel.value = String(year);
  dom.details.hidden = false;
  dom.mapOnlyNote.hidden = true;
  renderDetails();
  renderMap();
  if (updateUrl) updateUrlState({ year });
}

function showMapOnly(year, { updateUrl = true } = {}) {
  if (!recordByYear.has(year)) return;
  mapYear = year;
  detailsVisible = false;
  dom.year.value = "";
  dom.mapYear.value = String(year);
  dom.mapYearLabel.value = String(year);
  dom.details.hidden = true;
  dom.mapOnlyNote.hidden = false;
  renderMap();
  if (updateUrl) updateUrlState({ map: year });
}

function onYearChange() {
  clearRecoverableStatus();
  if (!dom.year.value) {
    if (mapAvailable) {
      showMapOnly(mapYear);
    } else {
      dom.year.value = String(detailYear);
    }
    return;
  }
  const year = Number(dom.year.value);
  if (recordByYear.has(year)) showDetails(year);
}

function onMapYearInput() {
  clearRecoverableStatus();
  const year = Number(dom.mapYear.value);
  if (recordByYear.has(year)) showMapOnly(year, { updateUrl: false });
}

function setupMapControls() {
  dom.zoomIn.addEventListener("click", () => zoomBy(1.3));
  dom.zoomOut.addEventListener("click", () => zoomBy(1 / 1.3));
  dom.resetView.addEventListener("click", resetMapView);
  dom.mapYear.addEventListener("change", () => {
    if (detailsVisible) return;
    updateUrlState({ map: mapYear });
  });
  dom.year.addEventListener("change", onYearChange);
  dom.mapYear.addEventListener("input", onMapYearInput);
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (detailsVisible) renderCharts();
      if (mapSvg) renderMap();
    }, 180);
  });
}

async function init() {
  setControlsEnabled(false);
  setStatus("Loading CO₂ and sea ice data…");
  const [coreResult, mapResult] = await Promise.allSettled([loadCore(), loadMap()]);

  if (coreResult.status === "rejected") {
    setStatus(`The app could not start. ${coreResult.reason.message}`, {
      error: true,
    });
    dom.map.replaceChildren();
    const unavailable = document.createElement("p");
    unavailable.className = "status error";
    unavailable.textContent =
      "The map is unavailable because the CO₂ and sea ice data could not be loaded.";
    dom.map.append(unavailable);
    dom.mapCaption.textContent = "The map is unavailable until the data load.";
    return;
  }

  const core = coreResult.value;
  records = core.rows;
  recordByYear = new Map(records.map((row) => [row.year, row]));
  baseline = core.baseline;
  regression = core.regression;
  populateControls();
  populateDataTable();
  setupMapControls();

  if (mapResult.status === "fulfilled") {
    try {
      setupMap(mapResult.value);
    } catch (error) {
      showMapError(error);
    }
  } else {
    showMapError(mapResult.reason);
  }

  const params = new URLSearchParams(window.location.search);
  const fallbackYear = recordByYear.has(DEFAULT_YEAR)
    ? DEFAULT_YEAR
    : records[0].year;
  let initialYear = fallbackYear;
  let initialMode = "details";
  let invalid = false;

  if (params.has("year")) {
    const requested = Number(params.get("year"));
    if (recordByYear.has(requested)) {
      initialYear = requested;
    } else {
      invalid = true;
      setStatus(
        `There is no complete data for ${params.get("year")}. Showing ${fallbackYear} instead.`,
        { error: true },
      );
      recoverableStatus = true;
    }
  } else if (params.has("map")) {
    const requested = Number(params.get("map"));
    if (recordByYear.has(requested)) {
      initialYear = requested;
      initialMode = "map";
    } else {
      invalid = true;
      setStatus(
        `There is no complete data for ${params.get("map")}. Showing ${fallbackYear} instead.`,
        { error: true },
      );
      recoverableStatus = true;
    }
  }

  if (!mapAvailable) initialMode = "details";
  setControlsEnabled(true);
  if (initialMode === "map") {
    showMapOnly(initialYear, { updateUrl: false });
  } else {
    showDetails(initialYear, { updateUrl: false });
  }

  if (invalid) {
    updateUrlState(
      initialMode === "map" ? { map: initialYear } : { year: initialYear },
    );
  } else if (!params.has("year") && !params.has("map")) {
    updateUrlState(
      initialMode === "map" ? { map: initialYear } : { year: initialYear },
    );
  } else if (!mapAvailable && params.has("map")) {
    updateUrlState({ year: initialYear });
  }

  if (!dom.status.classList.contains("error")) {
    clearStatus();
  }
}

init().catch((error) => {
  console.error(error);
  setStatus(`The app could not start (${error.message}).`, { error: true });
});
