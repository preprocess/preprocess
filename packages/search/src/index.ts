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

function distance(a: string, b: string) {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(
        row[j] + 1,
        next[j - 1] + 1,
        row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    row = next;
  }
  return row[b.length];
}

// The words the query matched: every word starting with a query term, or
// for a typo, the closest word within the tolerance Orama searched with.
function matches(text: string, term: string) {
  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  const tokens = [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
    word: m[0].toLowerCase(),
  }));
  const exact = tokens.filter((t) => words.some((w) => t.word.startsWith(w)));
  if (exact.length > 0) return exact;
  let best: { token: (typeof tokens)[number]; cost: number } | undefined;
  for (const token of tokens)
    for (const word of words) {
      const cost = Math.min(
        distance(word, token.word),
        distance(word, token.word.slice(0, word.length)),
      );
      if (cost <= (word.length >= 6 ? 2 : 1) && (!best || cost < best.cost))
        best = { token, cost };
    }
  return best ? [best.token] : [];
}

// A window of the text that opens just before the first match, so the
// highlighted word shows even when the row truncates, split into plain and
// matched runs.
export function snippet(text: string, term: string, lead = 24, length = 140) {
  const found = matches(text, term);
  let start = Math.max(0, (found[0]?.start ?? 0) - lead);
  if (start > 0) start = text.indexOf(" ", start) + 1 || start;
  if (found[0] && start > found[0].start) start = found[0].start;
  let end = Math.min(text.length, start + length);
  if (end < text.length) end = text.lastIndexOf(" ", end) || end;
  const parts: { text: string; match: boolean }[] = [];
  if (start > 0) parts.push({ text: "…", match: false });
  let last = start;
  for (const { start: from, end: to } of found) {
    if (from < start || to > end) continue;
    if (from > last) parts.push({ text: text.slice(last, from), match: false });
    parts.push({ text: text.slice(from, to), match: true });
    last = to;
  }
  if (last < end) parts.push({ text: text.slice(last, end), match: false });
  if (end < text.length) parts.push({ text: "…", match: false });
  return parts;
}
