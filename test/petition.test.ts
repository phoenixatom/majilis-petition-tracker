import { describe, expect, it } from "vitest";
import { normalizePetitionUrl, parsePetitionPage, parsePetitionUrls } from "../src/petition";

const URL = "https://epetition.majlis.gov.mv/petitions/d996985f-8128-4957-82c1-8bf719001203";

function inertiaHtml(petition: Record<string, unknown>) {
  const page = JSON.stringify({ component: "petitions/[slug]/page", props: { petition } })
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!doctype html><html><body><div id="app" data-page="${page}"></div></body></html>`;
}

describe("petition URL handling", () => {
  it("normalizes a valid Majlis petition URL", () => {
    expect(normalizePetitionUrl(`${URL}?shared=1#details`)).toBe(URL);
  });

  it("rejects other hosts and non-petition paths", () => {
    expect(() => normalizePetitionUrl("https://example.com/petitions/d996985f-8128-4957-82c1-8bf719001203"))
      .toThrow("Unsupported petition URL");
    expect(() => normalizePetitionUrl("https://epetition.majlis.gov.mv/petitions/not-a-uuid"))
      .toThrow("Unsupported petition URL");
  });

  it("splits, normalizes, and de-duplicates environment values", () => {
    expect(parsePetitionUrls(`${URL},\n${URL}`)).toEqual([URL]);
  });
});

describe("Majlis Inertia page parser", () => {
  it("extracts only the public tracking fields", () => {
    const html = inertiaHtml({
      uuid: "d996985f-8128-4957-82c1-8bf719001203",
      reference_number: "EPT202600052",
      title: "ޕެޓިޝަން & public record",
      status: "collecting-signatures",
      public_status: { name: "collecting signatures" },
      internal_status: { name: "published" },
      signed_count: 4430,
      withdrawn_count: 34,
      view_count: 38860,
      share_count: 88,
      threshold_level: 3,
      threshold_1_value: 5,
      threshold_1_reached: true,
      threshold_1_reached_at: "2026-08-12 15:56:55",
      threshold_2_value: 840,
      threshold_2_reached: true,
      categories: [{ name: "Essential Services" }, { name: "Health and Wellbeing" }],
      created_at: "2026-08-12T10:46:31.000000Z",
      published_at: "2026-08-16 17:21:52",
      expiry_date: "2026-09-23T10:46:31.000000Z",
      is_signature_accepted: true,
      is_closed: false,
      is_expired: false,
      owner: { address: "not stored" },
    });

    const result = parsePetitionPage(html, URL);
    expect(result).toMatchObject({
      uuid: "d996985f-8128-4957-82c1-8bf719001203",
      referenceNumber: "EPT202600052",
      title: "ޕެޓިޝަން & public record",
      signedCount: 4430,
      viewCount: 38860,
      publicStatus: "collecting signatures",
      categories: ["Essential Services", "Health and Wellbeing"],
    });
    expect(result).not.toHaveProperty("owner");
    expect(result.thresholds).toHaveLength(2);
  });

  it("fails clearly when the page shape changes", () => {
    expect(() => parsePetitionPage("<html></html>", URL)).toThrow("did not include Inertia petition data");
    expect(() => parsePetitionPage(inertiaHtml({ title: "Missing UUID" }), URL)).toThrow("valid public petition");
  });
});
