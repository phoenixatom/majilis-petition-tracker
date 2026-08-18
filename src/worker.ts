import { fetchPetition, parsePetitionUrls, type PetitionSnapshot } from "./petition";

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
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env);
      } catch (error) {
        console.error("API request failed", error);
        return apiError("The tracker could not complete this request");
      }
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(controller: ScheduledController, env: Env, context: ExecutionContext) {
    context.waitUntil(refreshAll(env, new Date(controller.scheduledTime).toISOString()));
  },
};
