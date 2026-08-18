const PETITION_HOST = "epetition.majlis.gov.mv";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface Threshold {
  level: number;
  value: number;
  reached: boolean;
  reachedAt: string | null;
}

export interface PetitionSnapshot {
  uuid: string;
  sourceUrl: string;
  referenceNumber: string | null;
  title: string;
  status: string;
  publicStatus: string | null;
  internalStatus: string | null;
  signedCount: number;
  withdrawnCount: number;
  viewCount: number;
  shareCount: number;
  thresholdLevel: number;
  thresholds: Threshold[];
  categories: string[];
  createdAt: string | null;
  publishedAt: string | null;
  expiresAt: string | null;
  isSignatureAccepted: boolean;
  isClosed: boolean;
  isExpired: boolean;
  isArchived: boolean;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" ? (value as JsonRecord) : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOrZero(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function normalizePetitionUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error(`Invalid petition URL: ${input}`);
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (
    url.protocol !== "https:" ||
    url.hostname !== PETITION_HOST ||
    segments.length !== 2 ||
    segments[0] !== "petitions" ||
    !UUID_PATTERN.test(segments[1])
  ) {
    throw new Error(`Unsupported petition URL: ${input}`);
  }

  return `https://${PETITION_HOST}/petitions/${segments[1].toLowerCase()}`;
}

export function parsePetitionUrls(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  const normalized = raw
    .split(/[\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map(normalizePetitionUrl);
  return [...new Set(normalized)];
}

export function parsePetitionPage(html: string, sourceUrl: string): PetitionSnapshot {
  const match = html.match(/data-page="([\s\S]*?)"\s*>/);
  if (!match) throw new Error("Majlis page did not include Inertia petition data");

  let page: JsonRecord;
  try {
    page = record(JSON.parse(decodeHtmlAttribute(match[1])));
  } catch {
    throw new Error("Majlis petition data could not be decoded");
  }

  const props = record(page.props);
  const petition = record(props.petition);
  const uuid = stringOrNull(petition.uuid);
  const title = stringOrNull(petition.title);
  if (!uuid || !UUID_PATTERN.test(uuid) || !title) {
    throw new Error("Majlis response did not contain a valid public petition");
  }

  const categories = Array.isArray(petition.categories)
    ? petition.categories
        .map((category) => stringOrNull(record(category).name))
        .filter((name): name is string => Boolean(name))
    : [];

  const thresholds: Threshold[] = [1, 2, 3, 4]
    .map((level) => ({
      level,
      value: numberOrZero(petition[`threshold_${level}_value`]),
      reached: Boolean(petition[`threshold_${level}_reached`]),
      reachedAt: stringOrNull(petition[`threshold_${level}_reached_at`]),
    }))
    .filter((threshold) => threshold.value > 0);

  return {
    uuid: uuid.toLowerCase(),
    sourceUrl: normalizePetitionUrl(sourceUrl),
    referenceNumber: stringOrNull(petition.reference_number),
    title,
    status: stringOrNull(petition.status) ?? "unknown",
    publicStatus: stringOrNull(record(petition.public_status).name),
    internalStatus: stringOrNull(record(petition.internal_status).name),
    signedCount: numberOrZero(petition.signed_count ?? petition.signature_count),
    withdrawnCount: numberOrZero(petition.withdrawn_count),
    viewCount: numberOrZero(petition.view_count),
    shareCount: numberOrZero(petition.share_count),
    thresholdLevel: numberOrZero(petition.threshold_level),
    thresholds,
    categories,
    createdAt: stringOrNull(petition.created_at),
    publishedAt: stringOrNull(petition.published_at),
    expiresAt: stringOrNull(petition.expiry_date ?? petition.expires_at),
    isSignatureAccepted: Boolean(petition.is_signature_accepted),
    isClosed: Boolean(petition.is_closed),
    isExpired: Boolean(petition.is_expired),
    isArchived: Boolean(petition.is_archived),
  };
}

export async function fetchPetition(sourceUrl: string): Promise<PetitionSnapshot> {
  const normalizedUrl = normalizePetitionUrl(sourceUrl);
  const response = await fetch(normalizedUrl, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "MajlisPetitionTracker/0.1 (+https://workers.dev)",
    },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`Majlis returned HTTP ${response.status}`);
  return parsePetitionPage(await response.text(), normalizedUrl);
}
