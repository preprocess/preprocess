import {
  create,
  insertMultiple,
  search,
  type Orama,
  type Results,
  type TypedDocument,
} from "@orama/orama";

// The docs' search index as plain text: one entry per page, with each
// heading and paragraph under it. The server builds it from the pages'
// structured data, and the browser loads it once when search opens and
// indexes it with Orama.
export type SearchPage = {
  url: string;
  title: string;
  description: string;
  headings: { id: string; text: string }[];
  paragraphs: { heading?: string; text: string }[];
};

export type SearchHit = {
  kind: "page" | "heading" | "text";
  url: string;
  text: string;
  heading?: string;
};

export type SearchResult = {
  url: string;
  title: string;
  description: string;
  hits: SearchHit[];
};

const schema = {
  kind: "enum",
  page: "string",
  url: "string",
  title: "string",
  heading: "string",
  body: "string",
  section: "string",
} as const;

type SearchDB = Orama<typeof schema>;

// Markdown as the reader sees it: code blocks, images, tags and markup
// removed, links reduced to their text, whitespace collapsed.
export function plainText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<\/?[A-Za-z][^>]*>/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)([\s\S]+?)\1/g, "$2")
    .replace(/(^|[^\w*])[*_]([^*_\s][^*_]*?)[*_](?!\w)/g, "$1$2")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function createSearchIndex(pages: SearchPage[]) {
  const db: SearchDB = create({ schema });
  const docs = pages.flatMap((page) => {
    const headings = new Map(page.headings.map((h) => [h.id, h.text]));
    return [
      {
        kind: "page",
        page: page.url,
        url: page.url,
        title: page.title,
        heading: "",
        body: page.description,
        section: "",
      },
      ...page.headings.map((h) => ({
        kind: "heading",
        page: page.url,
        url: `${page.url}#${h.id}`,
        title: "",
        heading: h.text,
        body: "",
        section: h.text,
      })),
      ...page.paragraphs.map((p) => ({
        kind: "text",
        page: page.url,
        url: p.heading ? `${page.url}#${p.heading}` : page.url,
        title: "",
        heading: "",
        body: p.text,
        section: (p.heading && headings.get(p.heading)) ?? "",
      })),
    ];
  });
  void insertMultiple(db, docs);
  return { db, pages: new Map(pages.map((p) => [p.url, p])) };
}

const pagesShown = 8;
const hitsPerPage = 3;

// Title, then heading, then body; prefix matching is Orama's default. An
// exact search runs first so "test" doesn't also surface every "text", and
// typos are allowed only when it finds little. Orama counts a missing letter
// as two edits against a prefix, so longer terms get a tolerance of two to
// forgive one real typo.
export function searchIndex(
  { db, pages }: ReturnType<typeof createSearchIndex>,
  term: string,
): SearchResult[] {
  const run = (tolerance: number) =>
    search(db, {
      term,
      tolerance,
      properties: ["title", "heading", "body"],
      boost: { title: 4, heading: 2, body: 1 },
      limit: 200,
    }) as Results<TypedDocument<SearchDB>>;
  let { hits } = run(0);
  if (hits.length < 5) hits = run(1).hits;
  if (hits.length < 5 && term.length >= 6) hits = run(2).hits;

  const groups = new Map<string, { score: number; hits: SearchHit[] }>();
  for (const { document: doc, score } of hits) {
    const group = groups.get(doc.page) ?? { score: 0, hits: [] };
    groups.set(doc.page, group);
    group.score = Math.max(group.score, score);
    if (doc.kind === "page") continue;
    if (group.hits.some((hit) => hit.url === doc.url && hit.kind === doc.kind))
      continue;
    group.hits.push({
      kind: doc.kind as SearchHit["kind"],
      url: doc.url,
      text: doc.kind === "heading" ? doc.heading : doc.body,
      heading: doc.kind === "text" ? doc.section || undefined : undefined,
    });
  }
  return [...groups]
    .sort(([, a], [, b]) => b.score - a.score)
    .slice(0, pagesShown)
    .map(([url, group]) => ({
      url,
      title: pages.get(url)?.title ?? url,
      description: pages.get(url)?.description ?? "",
      hits: group.hits.slice(0, hitsPerPage),
    }));
}

// A short window of the text around the first match, split into plain and
// matched runs for highlighting.
export function snippet(text: string, term: string, radius = 48) {
  const words = term
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (words.length === 0) return [{ text, match: false }];
  const pattern = new RegExp(`\\b(${words.join("|")})\\w*`, "gi");
  const first = pattern.exec(text);
  pattern.lastIndex = 0;
  let start = 0;
  let end = text.length;
  if (first && text.length > radius * 2) {
    start = Math.max(0, first.index - radius);
    end = Math.min(text.length, first.index + radius * 2);
    if (start > 0) start = text.indexOf(" ", start) + 1 || start;
    if (end < text.length) end = text.lastIndexOf(" ", end) || end;
  } else if (text.length > radius * 3) end = text.lastIndexOf(" ", radius * 3);
  const slice = text.slice(start, end);
  const parts: { text: string; match: boolean }[] = [];
  if (start > 0) parts.push({ text: "…", match: false });
  let last = 0;
  for (const m of slice.matchAll(pattern)) {
    if (m.index > last)
      parts.push({ text: slice.slice(last, m.index), match: false });
    parts.push({ text: m[0], match: true });
    last = m.index + m[0].length;
  }
  if (last < slice.length)
    parts.push({ text: slice.slice(last), match: false });
  if (end < text.length) parts.push({ text: "…", match: false });
  return parts;
}
