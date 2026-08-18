import { fetchPetition, parsePetitionUrls, type PetitionSnapshot } from "./petition";
import { buildSeoMetadata, renderOpenGraphPng, type SeoPetitionRecord } from "./seo";

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  PETITION_URLS?: string;
  REFRESH_TOKEN?: string;
}

interface ExistingPetition {
  status: string;
  public_status: string | null;
  internal_status: string | null;
  signed_count: number;
  withdrawn_count: number;
  view_count: number;
  share_count: number;
  threshold_level: number;
  is_closed: number;
  is_expired: number;
  is_archived: number;
}

const API_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

const SEO_PETITION_FIELDS = `uuid, source_url, reference_number, title, status, public_status,
  signed_count, categories_json, published_at, last_fetched_at, last_changed_at`;

function json(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: { ...API_HEADERS, ...init.headers },
  });
}

function apiError(message: string, status = 500): Response {
  return json({ error: message }, { status });
}

function booleanInt(value: boolean): number {
  return value ? 1 : 0;
}

function changedFields(
  existing: ExistingPetition | null,
  petition: PetitionSnapshot,
): Array<[string, string | null, string]> {
  if (!existing) return [["tracking", null, "started"]];

  const candidates: Array<[string, unknown, unknown]> = [
    ["status", existing.status, petition.status],
    ["public_status", existing.public_status, petition.publicStatus],
    ["internal_status", existing.internal_status, petition.internalStatus],
    ["threshold_level", existing.threshold_level, petition.thresholdLevel],
    ["is_closed", existing.is_closed, booleanInt(petition.isClosed)],
    ["is_expired", existing.is_expired, booleanInt(petition.isExpired)],
    ["is_archived", existing.is_archived, booleanInt(petition.isArchived)],
  ];

  return candidates
    .filter(([, before, after]) => before !== after)
    .map(([field, before, after]) => [
      field,
      before === null || before === undefined ? null : String(before),
      String(after ?? ""),
    ]);
}

function hasMetricChanges(existing: ExistingPetition | null, petition: PetitionSnapshot): boolean {
  if (!existing) return true;
  return (
    existing.signed_count !== petition.signedCount ||
    existing.withdrawn_count !== petition.withdrawnCount ||
    existing.view_count !== petition.viewCount ||
    existing.share_count !== petition.shareCount ||
    changedFields(existing, petition).length > 0
  );
}

async function storePetition(
  env: Env,
  petition: PetitionSnapshot,
  capturedAt: string,
): Promise<void> {
  const existing = await env.DB.prepare(
    `SELECT status, public_status, internal_status, signed_count, withdrawn_count,
            view_count, share_count, threshold_level, is_closed, is_expired, is_archived
       FROM petitions WHERE uuid = ?`,
  )
    .bind(petition.uuid)
    .first<ExistingPetition>();

  const events = changedFields(existing, petition);
  const lastChangedAt = hasMetricChanges(existing, petition)
    ? capturedAt
    : await env.DB.prepare("SELECT last_changed_at FROM petitions WHERE uuid = ?")
        .bind(petition.uuid)
        .first<string>("last_changed_at");

  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO petitions (
         uuid, source_url, reference_number, title, status, public_status, internal_status,
         signed_count, withdrawn_count, view_count, share_count, threshold_level,
         thresholds_json, categories_json, created_at_source, published_at, expires_at,
         is_signature_accepted, is_closed, is_expired, is_archived, last_fetched_at, last_changed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(uuid) DO UPDATE SET
         source_url = excluded.source_url,
         reference_number = excluded.reference_number,
         title = excluded.title,
         status = excluded.status,
         public_status = excluded.public_status,
         internal_status = excluded.internal_status,
         signed_count = excluded.signed_count,
         withdrawn_count = excluded.withdrawn_count,
         view_count = excluded.view_count,
         share_count = excluded.share_count,
         threshold_level = excluded.threshold_level,
         thresholds_json = excluded.thresholds_json,
         categories_json = excluded.categories_json,
         created_at_source = excluded.created_at_source,
         published_at = excluded.published_at,
         expires_at = excluded.expires_at,
         is_signature_accepted = excluded.is_signature_accepted,
         is_closed = excluded.is_closed,
         is_expired = excluded.is_expired,
         is_archived = excluded.is_archived,
         last_fetched_at = excluded.last_fetched_at,
         last_changed_at = excluded.last_changed_at`,
    ).bind(
      petition.uuid,
      petition.sourceUrl,
      petition.referenceNumber,
      petition.title,
      petition.status,
      petition.publicStatus,
      petition.internalStatus,
      petition.signedCount,
      petition.withdrawnCount,
      petition.viewCount,
      petition.shareCount,
      petition.thresholdLevel,
      JSON.stringify(petition.thresholds),
      JSON.stringify(petition.categories),
      petition.createdAt,
      petition.publishedAt,
      petition.expiresAt,
      booleanInt(petition.isSignatureAccepted),
      booleanInt(petition.isClosed),
      booleanInt(petition.isExpired),
      booleanInt(petition.isArchived),
      capturedAt,
      lastChangedAt ?? capturedAt,
    ),
    env.DB.prepare(
      `INSERT INTO tracked_sources (
         source_url, petition_uuid, last_attempt_at, last_success_at, last_error, consecutive_failures
       ) VALUES (?, ?, ?, ?, NULL, 0)
       ON CONFLICT(source_url) DO UPDATE SET
         petition_uuid = excluded.petition_uuid,
         last_attempt_at = excluded.last_attempt_at,
         last_success_at = excluded.last_success_at,
         last_error = NULL,
         consecutive_failures = 0`,
    ).bind(petition.sourceUrl, petition.uuid, capturedAt, capturedAt),
    env.DB.prepare(
      `INSERT INTO snapshots (
         petition_uuid, captured_at, signed_count, withdrawn_count, view_count,
         share_count, status, threshold_level
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(petition_uuid, captured_at) DO UPDATE SET
         signed_count = excluded.signed_count,
         withdrawn_count = excluded.withdrawn_count,
         view_count = excluded.view_count,
         share_count = excluded.share_count,
         status = excluded.status,
         threshold_level = excluded.threshold_level`,
    ).bind(
      petition.uuid,
      capturedAt,
      petition.signedCount,
      petition.withdrawnCount,
      petition.viewCount,
      petition.shareCount,
      petition.status,
      petition.thresholdLevel,
    ),
    ...events.map(([field, previousValue, currentValue]) =>
      env.DB.prepare(
        `INSERT INTO status_events (
           petition_uuid, recorded_at, field, previous_value, current_value
         ) VALUES (?, ?, ?, ?, ?)`,
      ).bind(petition.uuid, capturedAt, field, previousValue, currentValue),
    ),
  ];

  await env.DB.batch(statements);
}

async function recordFailure(env: Env, sourceUrl: string, error: unknown, attemptedAt: string) {
  const message = error instanceof Error ? error.message : String(error);
  await env.DB.prepare(
    `INSERT INTO tracked_sources (
       source_url, last_attempt_at, last_error, consecutive_failures
     ) VALUES (?, ?, ?, 1)
     ON CONFLICT(source_url) DO UPDATE SET
       last_attempt_at = excluded.last_attempt_at,
       last_error = excluded.last_error,
       consecutive_failures = tracked_sources.consecutive_failures + 1`,
  )
    .bind(sourceUrl, attemptedAt, message.slice(0, 500))
    .run();
}

async function refreshAll(env: Env, capturedAt = new Date().toISOString()) {
  const urls = parsePetitionUrls(env.PETITION_URLS);
  const results: Array<{ url: string; ok: boolean; error?: string }> = [];

  for (const url of urls) {
    try {
      const petition = await fetchPetition(url);
      await storePetition(env, petition, capturedAt);
      results.push({ url, ok: true });
    } catch (error) {
      await recordFailure(env, url, error, capturedAt);
      const message = error instanceof Error ? error.message : String(error);
      console.error("Petition refresh failed", { url, message });
      results.push({ url, ok: false, error: message });
    }
  }

  return { tracked: urls.length, capturedAt, results };
}

function decodeJsonFields(row: Record<string, unknown>): Record<string, unknown> {
  for (const field of ["thresholds_json", "categories_json"] as const) {
    if (typeof row[field] === "string") {
      try {
        row[field] = JSON.parse(row[field] as string);
      } catch {
        row[field] = [];
      }
    }
  }
  return row;
}

async function findSeoPetition(env: Env, uuid?: string | null): Promise<SeoPetitionRecord | null> {
  if (uuid && /^[0-9a-f-]{36}$/i.test(uuid)) {
    const petition = await env.DB.prepare(`SELECT ${SEO_PETITION_FIELDS} FROM petitions WHERE uuid = ?`)
      .bind(uuid.toLowerCase())
      .first<SeoPetitionRecord>();
    if (petition) return petition;
  }
  return env.DB.prepare(
    `SELECT ${SEO_PETITION_FIELDS} FROM petitions ORDER BY last_changed_at DESC LIMIT 1`,
  ).first<SeoPetitionRecord>();
}

function seoAttribute(name: string, value: string) {
  return {
    element(element: Element) {
      element.setAttribute(name, value);
    },
  };
}

async function serveSeoPage(request: Request, env: Env): Promise<Response> {
  const requestUrl = new URL(request.url);
  let petition: SeoPetitionRecord | null = null;
  try {
    petition = await findSeoPetition(env, requestUrl.searchParams.get("petition"));
  } catch (error) {
    console.warn("SEO metadata fell back to site defaults", error);
  }
  const seo = buildSeoMetadata(requestUrl.origin, petition);
  const assetUrl = new URL("/", requestUrl.origin);
  const assetResponse = await env.ASSETS.fetch(new Request(assetUrl, request));
  if (!assetResponse.ok || !assetResponse.body) return assetResponse;

  const headers = new Headers(assetResponse.headers);
  headers.set("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=600");
  headers.set("Link", `<${seo.canonicalUrl}>; rel="canonical"`);
  const htmlResponse = new Response(assetResponse.body, {
    status: assetResponse.status,
    statusText: assetResponse.statusText,
    headers,
  });

  return new HTMLRewriter()
    .on("title", { element: (element) => { element.setInnerContent(seo.title); } })
    .on("#seo-description", seoAttribute("content", seo.description))
    .on("#seo-canonical", seoAttribute("href", seo.canonicalUrl))
    .on("#seo-og-title", seoAttribute("content", seo.title))
    .on("#seo-og-description", seoAttribute("content", seo.description))
    .on("#seo-og-url", seoAttribute("content", seo.canonicalUrl))
    .on("#seo-og-image", seoAttribute("content", seo.imageUrl))
    .on("#seo-og-image-alt", seoAttribute("content", seo.imageAlt))
    .on("#seo-twitter-title", seoAttribute("content", seo.title))
    .on("#seo-twitter-description", seoAttribute("content", seo.description))
    .on("#seo-twitter-image", seoAttribute("content", seo.imageUrl))
    .on("#seo-twitter-image-alt", seoAttribute("content", seo.imageAlt))
    .on("#seo-json-ld", { element: (element) => { element.setInnerContent(seo.jsonLd, { html: true }); } })
    .transform(htmlResponse);
}

async function serveOpenGraphImage(
  request: Request,
  env: Env,
  context: ExecutionContext,
  identifier: string,
): Promise<Response> {
  const cache = (caches as CacheStorage & { default: Cache }).default;
  const cached = await cache.match(request);
  if (cached) return cached;

  let petition: SeoPetitionRecord | null = null;
  if (identifier !== "default") {
    if (!/^[0-9a-f-]{36}$/i.test(identifier)) return new Response("Not found", { status: 404 });
    petition = await env.DB.prepare(`SELECT ${SEO_PETITION_FIELDS} FROM petitions WHERE uuid = ?`)
      .bind(identifier.toLowerCase())
      .first<SeoPetitionRecord>();
    if (!petition) return new Response("Petition not found", { status: 404 });
  }

  const history = petition
    ? await env.DB.prepare(
        `SELECT signed_count FROM snapshots WHERE petition_uuid = ? ORDER BY captured_at DESC LIMIT 48`,
      )
        .bind(petition.uuid)
        .all<{ signed_count: number }>()
    : { results: [] as Array<{ signed_count: number }> };
  const png = await renderOpenGraphPng(
    petition,
    [...history.results].reverse().map((snapshot) => Number(snapshot.signed_count)),
  );
  const versioned = new URL(request.url).searchParams.has("v");
  const response = new Response(png.buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(png.byteLength),
      "Cache-Control": versioned
        ? "public, max-age=31536000, immutable"
        : "public, max-age=300, stale-while-revalidate=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
  context.waitUntil(cache.put(request, response.clone()));
  return response;
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}

async function serveSitemap(requestUrl: URL, env: Env): Promise<Response> {
  let petitions: Array<{ uuid: string; last_fetched_at: string | null }> = [];
  try {
    const result = await env.DB.prepare(
      "SELECT uuid, last_fetched_at FROM petitions ORDER BY published_at DESC",
    ).all<{ uuid: string; last_fetched_at: string | null }>();
    petitions = result.results;
  } catch (error) {
    console.warn("Sitemap generated without petition records", error);
  }
  const urls = [
    `<url><loc>${xmlEscape(`${requestUrl.origin}/`)}</loc></url>`,
    ...petitions.map((petition) => {
      const location = `${requestUrl.origin}/?petition=${encodeURIComponent(petition.uuid)}`;
      const lastModified = petition.last_fetched_at?.slice(0, 10);
      return `<url><loc>${xmlEscape(location)}</loc>${lastModified ? `<lastmod>${xmlEscape(lastModified)}</lastmod>` : ""}</url>`;
    }),
  ].join("");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=900",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function listPetitions(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT p.*, s.last_error, s.consecutive_failures
       FROM petitions p
       LEFT JOIN tracked_sources s ON s.source_url = p.source_url
      ORDER BY p.last_changed_at DESC`,
  ).all<Record<string, unknown>>();
  return json({ petitions: results.map(decodeJsonFields) });
}

async function getPetition(env: Env, uuid: string, requestUrl: URL): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(uuid)) return apiError("Invalid petition ID", 400);

  const petition = await env.DB.prepare("SELECT * FROM petitions WHERE uuid = ?")
    .bind(uuid.toLowerCase())
    .first<Record<string, unknown>>();
  if (!petition) return apiError("Petition not found", 404);

  const range = requestUrl.searchParams.get("range") ?? "30d";
  const rangeDays: Record<string, number | null> = { "7d": 7, "30d": 30, "90d": 90, all: null };
  if (!(range in rangeDays)) return apiError("Range must be 7d, 30d, 90d, or all", 400);

  const days = rangeDays[range];
  const bucketExpression = range === "7d"
    ? `strftime('%Y-%m-%dT%H', captured_at) || ':' || printf('%02d', (CAST(strftime('%M', captured_at) AS INTEGER) / 15) * 15)`
    : `strftime('%Y-%m-%dT%H', captured_at)`;
  const snapshotQuery = days
    ? env.DB.prepare(
        `SELECT captured_at, signed_count, withdrawn_count, view_count, share_count,
                status, threshold_level
           FROM (
             SELECT captured_at, signed_count, withdrawn_count, view_count, share_count,
                    status, threshold_level,
                    ROW_NUMBER() OVER (
                      PARTITION BY ${bucketExpression}
                      ORDER BY captured_at DESC
                    ) AS bucket_rank,
                    ROW_NUMBER() OVER (ORDER BY captured_at ASC) AS range_rank
               FROM snapshots
              WHERE petition_uuid = ? AND captured_at >= datetime('now', ?)
           )
          WHERE bucket_rank = 1 OR range_rank = 1
          ORDER BY captured_at ASC LIMIT 10000`,
      ).bind(uuid.toLowerCase(), `-${days} days`)
    : env.DB.prepare(
        `SELECT captured_at, signed_count, withdrawn_count, view_count, share_count,
                status, threshold_level
           FROM (
             SELECT captured_at, signed_count, withdrawn_count, view_count, share_count,
                    status, threshold_level,
                    ROW_NUMBER() OVER (
                      PARTITION BY ${bucketExpression}
                      ORDER BY captured_at DESC
                    ) AS bucket_rank,
                    ROW_NUMBER() OVER (ORDER BY captured_at ASC) AS range_rank
               FROM snapshots
              WHERE petition_uuid = ?
           )
          WHERE bucket_rank = 1 OR range_rank = 1
          ORDER BY captured_at ASC LIMIT 10000`,
      ).bind(uuid.toLowerCase());

  const [snapshotResult, recentSnapshotResult, eventResult] = await Promise.all([
    snapshotQuery.all<Record<string, unknown>>(),
    env.DB.prepare(
      `SELECT captured_at, signed_count, withdrawn_count, view_count, share_count,
              status, threshold_level
         FROM snapshots
        WHERE petition_uuid = ? AND datetime(captured_at) >= datetime('now', '-6 hours')
        ORDER BY captured_at ASC LIMIT 500`,
    )
      .bind(uuid.toLowerCase())
      .all<Record<string, unknown>>(),
    env.DB.prepare(
      `SELECT recorded_at, field, previous_value, current_value
         FROM status_events WHERE petition_uuid = ?
        ORDER BY recorded_at DESC LIMIT 100`,
    )
      .bind(uuid.toLowerCase())
      .all<Record<string, unknown>>(),
  ]);

  return json({
    petition: decodeJsonFields(petition),
    snapshots: snapshotResult.results,
    recentSnapshots: recentSnapshotResult.results,
    events: eventResult.results,
  });
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/petitions") {
    return listPetitions(env);
  }

  const detailMatch = url.pathname.match(/^\/api\/petitions\/([^/]+)$/);
  if (request.method === "GET" && detailMatch) {
    return getPetition(env, detailMatch[1], url);
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    const configured = parsePetitionUrls(env.PETITION_URLS).length;
    const source = await env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN last_error IS NOT NULL THEN 1 ELSE 0 END) AS failing,
              MAX(last_success_at) AS last_success_at
         FROM tracked_sources`,
    ).first<Record<string, unknown>>();
    return json({ ok: true, configured, ...source });
  }

  if (request.method === "POST" && url.pathname === "/api/refresh") {
    if (!env.REFRESH_TOKEN) return apiError("Manual refresh is not enabled", 404);
    if (request.headers.get("Authorization") !== `Bearer ${env.REFRESH_TOKEN}`) {
      return apiError("Unauthorized", 401);
    }
    return json(await refreshAll(env));
  }

  return apiError("Not found", 404);
}

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env);
      } catch (error) {
        console.error("API request failed", error);
        return apiError("The tracker could not complete this request");
      }
    }
    if (request.method === "GET" && url.pathname === "/") {
      return serveSeoPage(request, env);
    }
    const openGraphMatch = url.pathname.match(/^\/og\/(default|[0-9a-f-]{36})\.png$/i);
    if (request.method === "GET" && openGraphMatch) {
      try {
        return await serveOpenGraphImage(request, env, context, openGraphMatch[1]);
      } catch (error) {
        console.error("Open Graph image generation failed", error);
        return new Response("Image generation failed", { status: 500 });
      }
    }
    if (request.method === "GET" && url.pathname === "/robots.txt") {
      return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${url.origin}/sitemap.xml\n`, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }
    if (request.method === "GET" && url.pathname === "/sitemap.xml") {
      return serveSitemap(url, env);
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(controller: ScheduledController, env: Env, context: ExecutionContext) {
    context.waitUntil(refreshAll(env, new Date(controller.scheduledTime).toISOString()));
  },
};
