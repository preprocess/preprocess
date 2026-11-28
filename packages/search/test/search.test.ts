import { describe, expect, it } from "vitest";

import { searchPages } from "../src/fumadocs.ts";
import {
  createSearchIndex,
  plainText,
  searchIndex,
  snippet,
} from "../src/index.ts";

const pages = [
  {
    url: "/billing/credits",
    title: "Buy credits",
    description: "How credits work.",
    headings: [{ id: "top-up", text: "Top up" }],
    paragraphs: [{ heading: "top-up", text: "Credits top up automatically." }],
  },
  {
    url: "/agents/deploy",
    title: "Deploy an agent",
    description: "Ship an agent.",
    headings: [],
    paragraphs: [{ text: "Run preprocess deploy." }],
  },
];

describe("search", () => {
  it("groups hits by page, best page first", () => {
    const results = searchIndex(createSearchIndex(pages), "credits");
    expect(results[0]?.url).toBe("/billing/credits");
    expect(results[0]?.hits.map((hit) => hit.url)).toContain(
      "/billing/credits#top-up",
    );
    expect(results.some((r) => r.url === "/agents/deploy")).toBe(false);
  });

  it("forgives a typo", () => {
    expect(searchIndex(createSearchIndex(pages), "deplyo")[0]?.url).toBe(
      "/agents/deploy",
    );
  });

  it("reduces Markdown to text and marks matches", () => {
    expect(plainText("**Bold** [link](/x) `code`")).toBe("Bold link code");
    expect(snippet("Credits top up", "top")).toEqual([
      { text: "Credits ", match: false },
      { text: "top", match: true },
      { text: " up", match: false },
    ]);
  });

  it("reads a Fumadocs page's structured data without table rows", async () => {
    const [page] = await searchPages([
      {
        url: "/a",
        data: {
          title: "A",
          description: "The *a* page.",
          structuredData: {
            headings: [{ id: "h", content: "Heading" }],
            contents: [
              { heading: "h", content: "Some **text**." },
              { heading: "h", content: "| a | b |" },
            ],
          },
        },
      },
    ]);
    expect(page).toEqual({
      url: "/a",
      title: "A",
      description: "The a page.",
      headings: [{ id: "h", text: "Heading" }],
      paragraphs: [{ heading: "h", text: "Some text." }],
    });
  });
});
