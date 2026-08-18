import { describe, expect, it } from "vitest";
import { buildSeoMetadata, renderOpenGraphPng, type SeoPetitionRecord } from "../src/seo";

const petition: SeoPetitionRecord = {
  uuid: "11111111-2222-4333-8444-555555555555",
  source_url: "https://epetition.majlis.gov.mv/petitions/11111111-2222-4333-8444-555555555555",
  reference_number: "DEMO-PETITION-001",
  title: "Generic public services petition",
  status: "collecting-signatures",
  public_status: "collecting signatures",
  signed_count: 1690,
  categories_json: JSON.stringify(["Public Services", "Community"]),
  published_at: "2026-08-15T02:59:00+05:00",
  last_fetched_at: "2026-08-19T03:20:00+05:00",
  last_changed_at: "2026-08-19T03:20:00+05:00",
};

describe("petition SEO metadata", () => {
  it("builds canonical, social image, and structured-data values per petition", () => {
    const seo = buildSeoMetadata("https://petitions.example", petition);

    expect(seo.title).toContain("Generic public services petition");
    expect(seo.description).toContain("1,690 signatures");
    expect(seo.canonicalUrl).toBe(
      "https://petitions.example/?petition=11111111-2222-4333-8444-555555555555",
    );
    expect(seo.imageUrl).toMatch(
      /^https:\/\/petitions\.example\/og\/11111111-2222-4333-8444-555555555555\.png\?v=/,
    );
    expect(JSON.parse(seo.jsonLd)).toMatchObject({
      "@type": "WebPage",
      mainEntity: { "@type": "Dataset", sameAs: petition.source_url },
    });
  });

  it("provides complete site-level fallbacks before the first collection", () => {
    const seo = buildSeoMetadata("https://petitions.example/", null);

    expect(seo.title).toBe("Majlis Petition Monitor");
    expect(seo.canonicalUrl).toBe("https://petitions.example/");
    expect(seo.imageUrl).toBe("https://petitions.example/og/default.png");
  });
});

describe("dynamic Open Graph image", () => {
  it("renders a standards-compliant 1200 by 630 PNG", async () => {
    const png = await renderOpenGraphPng(petition, [1000, 1020, 1100, 1250, 1320, 1500, 1690]);
    const header = new DataView(png.buffer, png.byteOffset, png.byteLength);

    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(header.getUint32(16)).toBe(1200);
    expect(header.getUint32(20)).toBe(630);
    expect(png.byteLength).toBeGreaterThan(10_000);
  });
});
