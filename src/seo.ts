export interface SeoPetitionRecord {
  uuid: string;
  source_url: string;
  reference_number: string | null;
  title: string;
  status: string;
  public_status: string | null;
  signed_count: number;
  categories_json: string | null;
  published_at: string | null;
  last_fetched_at: string | null;
  last_changed_at: string | null;
}

export interface SeoMetadata {
  title: string;
  description: string;
  canonicalUrl: string;
  imageUrl: string;
  imageAlt: string;
  jsonLd: string;
}

const SITE_NAME = "Majlis Petition Monitor";
const PNG_WIDTH = 1200;
const PNG_HEIGHT = 630;
type Color = readonly [number, number, number];

const COLORS = {
  canvas: [247, 246, 243] as Color,
  surface: [255, 255, 255] as Color,
  label: [97, 97, 104] as Color,
  text: [25, 25, 28] as Color,
  blue: [0, 122, 255] as Color,
  blueSoft: [230, 240, 255] as Color,
  green: [36, 138, 61] as Color,
  greenSoft: [231, 247, 235] as Color,
  line: [215, 215, 220] as Color,
};

const GLYPHS: Record<string, string[]> = {
  " ": ["000", "000", "000", "000", "000", "000", "000"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  ",": ["00", "00", "00", "00", "00", "10", "10"],
  ".": ["00", "00", "00", "00", "00", "11", "11"],
  ":": ["00", "11", "11", "00", "11", "11", "00"],
  "-": ["000", "000", "000", "111", "000", "000", "000"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "+": ["000", "010", "010", "111", "010", "010", "000"],
  "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
};

function cleanText(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function truncate(value: string, maximum: number): string {
  const characters = Array.from(value);
  if (characters.length <= maximum) return value;
  return `${characters.slice(0, Math.max(0, maximum - 1)).join("")}…`;
}

function labelStatus(value: string | null | undefined): string {
  return cleanText(value || "Unknown")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function parseCategories(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function buildSeoMetadata(origin: string, petition: SeoPetitionRecord | null): SeoMetadata {
  const cleanOrigin = origin.replace(/\/$/, "");
  if (!petition) {
    const canonicalUrl = `${cleanOrigin}/`;
    const imageUrl = `${cleanOrigin}/og/default.png`;
    const description = "Independent time-series tracking for public People's Majlis e-petitions, updated every three minutes.";
    return {
      title: SITE_NAME,
      description,
      canonicalUrl,
      imageUrl,
      imageAlt: "Majlis Petition Monitor live statistics dashboard",
      jsonLd: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: SITE_NAME,
        url: canonicalUrl,
        description,
      }).replace(/</g, "\\u003c"),
    };
  }

  const reference = cleanText(petition.reference_number) || "Public petition";
  const petitionTitle = cleanText(petition.title) || "Untitled petition";
  const status = labelStatus(petition.public_status || petition.status);
  const signatureCount = new Intl.NumberFormat("en-US").format(petition.signed_count);
  const canonicalUrl = `${cleanOrigin}/?petition=${encodeURIComponent(petition.uuid)}`;
  const version = encodeURIComponent(`${petition.signed_count}-${petition.last_changed_at || petition.last_fetched_at || "latest"}`);
  const imageUrl = `${cleanOrigin}/og/${encodeURIComponent(petition.uuid)}.png?v=${version}`;
  const title = truncate(`${petitionTitle} · ${reference} | Petition Monitor`, 90);
  const description = truncate(
    `Track ${reference}: ${petitionTitle}. ${signatureCount} signatures; status: ${status}. Independent statistics updated every three minutes.`,
    180,
  );
  const imageAlt = `${reference} currently has ${signatureCount} signatures and is ${status}.`;
  const categories = parseCategories(petition.categories_json);
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: petitionTitle,
    description,
    url: canonicalUrl,
    datePublished: petition.published_at || undefined,
    dateModified: petition.last_fetched_at || undefined,
    isPartOf: {
      "@type": "WebSite",
      name: SITE_NAME,
      url: `${cleanOrigin}/`,
    },
    primaryImageOfPage: {
      "@type": "ImageObject",
      url: imageUrl,
      width: PNG_WIDTH,
      height: PNG_HEIGHT,
    },
    mainEntity: {
      "@type": "Dataset",
      name: `${reference} petition statistics`,
      description,
      url: canonicalUrl,
      sameAs: petition.source_url,
      dateModified: petition.last_fetched_at || undefined,
      keywords: ["People's Majlis", "e-petition", "Maldives", ...categories].join(", "),
      variableMeasured: ["Signature count", "View count", "Share count", "Petition status"],
    },
  };

  return {
    title,
    description,
    canonicalUrl,
    imageUrl,
    imageAlt,
    jsonLd: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
  };
}

function setPixel(pixels: Uint8Array, x: number, y: number, color: Color) {
  if (x < 0 || x >= PNG_WIDTH || y < 0 || y >= PNG_HEIGHT) return;
  const index = (Math.floor(y) * PNG_WIDTH + Math.floor(x)) * 3;
  pixels[index] = color[0];
  pixels[index + 1] = color[1];
  pixels[index + 2] = color[2];
}

function fillRect(pixels: Uint8Array, x: number, y: number, width: number, height: number, color: Color) {
  const startX = Math.max(0, Math.floor(x));
  const endX = Math.min(PNG_WIDTH, Math.ceil(x + width));
  const startY = Math.max(0, Math.floor(y));
  const endY = Math.min(PNG_HEIGHT, Math.ceil(y + height));
  for (let row = startY; row < endY; row += 1) {
    for (let column = startX; column < endX; column += 1) setPixel(pixels, column, row, color);
  }
}

function fillRoundedRect(
  pixels: Uint8Array,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  color: Color,
) {
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const dx = Math.max(radius - column, 0, column - (width - radius - 1));
      const dy = Math.max(radius - row, 0, row - (height - radius - 1));
      if (dx * dx + dy * dy <= radius * radius) setPixel(pixels, x + column, y + row, color);
    }
  }
}

function measureText(value: string, scale: number): number {
  return Array.from(value.toUpperCase()).reduce((width, character, index) => {
    const glyph = GLYPHS[character] || GLYPHS["?"];
    return width + glyph[0].length * scale + (index ? scale : 0);
  }, 0);
}

function drawText(pixels: Uint8Array, value: string, x: number, y: number, scale: number, color: Color) {
  let cursor = x;
  for (const character of value.toUpperCase()) {
    const glyph = GLYPHS[character] || GLYPHS["?"];
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] === "1") fillRect(pixels, cursor + column * scale, y + row * scale, scale, scale, color);
      }
    }
    cursor += glyph[0].length * scale + scale;
  }
}

function drawLine(
  pixels: Uint8Array,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: Color,
  thickness = 3,
) {
  const distance = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  if (distance === 0) {
    fillRect(pixels, x1, y1, thickness, thickness, color);
    return;
  }
  for (let step = 0; step <= distance; step += 1) {
    const progress = step / distance;
    const x = Math.round(x1 + (x2 - x1) * progress);
    const y = Math.round(y1 + (y2 - y1) * progress);
    fillRect(pixels, x - Math.floor(thickness / 2), y - Math.floor(thickness / 2), thickness, thickness, color);
  }
}

function writeUint32(target: Uint8Array, offset: number, value: number) {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const result = new Uint8Array(12 + data.length);
  writeUint32(result, 0, data.length);
  result.set(typeBytes, 4);
  result.set(data, 8);
  const checksumInput = new Uint8Array(typeBytes.length + data.length);
  checksumInput.set(typeBytes);
  checksumInput.set(data, typeBytes.length);
  writeUint32(result, 8 + data.length, crc32(checksumInput));
  return result;
}

function concatenate(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export async function renderOpenGraphPng(
  petition: SeoPetitionRecord | null,
  signatureHistory: number[] = [],
): Promise<Uint8Array> {
  const outerLeft = 64;
  const outerRight = PNG_WIDTH - 64;
  const outerWidth = outerRight - outerLeft;
  const chartInset = 32;
  const plotLeft = outerLeft + chartInset;
  const plotRight = outerRight - chartInset;
  const plotWidth = plotRight - plotLeft;
  const pixels = new Uint8Array(PNG_WIDTH * PNG_HEIGHT * 3);
  for (let index = 0; index < pixels.length; index += 3) {
    pixels[index] = COLORS.canvas[0];
    pixels[index + 1] = COLORS.canvas[1];
    pixels[index + 2] = COLORS.canvas[2];
  }

  const reference = cleanText(petition?.reference_number) || "PUBLIC PETITION";
  const status = labelStatus(petition?.public_status || petition?.status || "Live tracking");
  const signatures = new Intl.NumberFormat("en-US").format(petition?.signed_count ?? 0);
  const updated = cleanText(petition?.last_fetched_at)?.slice(0, 10) || "LIVE";

  drawText(pixels, "PETITION MONITOR", outerLeft, 46, 4, COLORS.text);
  const referenceWidth = measureText(reference, 4);
  drawText(pixels, reference, outerRight - referenceWidth, 46, 4, COLORS.label);

  const badgeWidth = measureText(status, 3) + 34;
  fillRoundedRect(pixels, outerLeft, 108, badgeWidth, 42, 18, COLORS.greenSoft);
  drawText(pixels, status, outerLeft + 17, 119, 3, COLORS.green);
  drawText(pixels, "SIGNATURES", outerLeft, 177, 3, COLORS.label);
  drawText(pixels, signatures, outerLeft, 211, 12, COLORS.text);

  fillRoundedRect(pixels, outerLeft, 334, outerWidth, 210, 18, COLORS.surface);
  drawText(pixels, "SIGNATURE GROWTH", plotLeft, 360, 3, COLORS.label);
  for (let grid = 0; grid < 4; grid += 1) {
    const y = 407 + grid * 37;
    drawLine(pixels, plotLeft, y, plotRight, y, COLORS.line, 1);
  }

  const history = signatureHistory.filter(Number.isFinite);
  if (history.length > 1) {
    const minimum = Math.min(...history);
    const maximum = Math.max(...history);
    const range = Math.max(1, maximum - minimum);
    const points = history.map((value, index) => ({
      x: plotLeft + (index / (history.length - 1)) * plotWidth,
      y: 515 - ((value - minimum) / range) * 108,
    }));
    for (let index = 1; index < points.length; index += 1) {
      drawLine(pixels, points[index - 1].x, points[index - 1].y, points[index].x, points[index].y, COLORS.blue, 4);
    }
    for (const point of points.filter((_, index) => index % Math.max(1, Math.floor(points.length / 10)) === 0)) {
      fillRoundedRect(pixels, Math.round(point.x) - 5, Math.round(point.y) - 5, 10, 10, 5, COLORS.blue);
    }
  } else {
    drawLine(pixels, plotLeft, 480, plotRight, 480, COLORS.blue, 4);
  }

  drawText(pixels, "INDEPENDENT PUBLIC TRACKING", outerLeft, 583, 3, COLORS.label);
  const updatedLabel = `UPDATED ${updated}`;
  drawText(pixels, updatedLabel, outerRight - measureText(updatedLabel, 3), 583, 3, COLORS.label);

  const scanlineLength = PNG_WIDTH * 3 + 1;
  const raw = new Uint8Array(scanlineLength * PNG_HEIGHT);
  for (let row = 0; row < PNG_HEIGHT; row += 1) {
    const rawOffset = row * scanlineLength;
    raw[rawOffset] = 0;
    raw.set(pixels.subarray(row * PNG_WIDTH * 3, (row + 1) * PNG_WIDTH * 3), rawOffset + 1);
  }
  const compressedStream = new Response(raw).body?.pipeThrough(new CompressionStream("deflate"));
  if (!compressedStream) throw new Error("PNG compression is unavailable");
  const compressed = new Uint8Array(await new Response(compressedStream).arrayBuffer());

  const header = new Uint8Array(13);
  writeUint32(header, 0, PNG_WIDTH);
  writeUint32(header, 4, PNG_HEIGHT);
  header[8] = 8;
  header[9] = 2;
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return concatenate([
    signature,
    pngChunk("IHDR", header),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", new Uint8Array()),
  ]);
}
