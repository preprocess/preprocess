import { Link } from "@tanstack/react-router";
import type * as PageTree from "fumadocs-core/page-tree";
import {
  createContext,
  isValidElement,
  type ComponentProps,
  type ReactNode,
} from "react";

// The page tree, for MDX components that list pages (the reference index).
export const TreeContext = createContext<PageTree.Root | null>(null);

// Page tree names reach the client as spans of escaped HTML; labels, crumbs
// and the command menu want their text.
export function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (
    !isValidElement<{
      children?: ReactNode;
      dangerouslySetInnerHTML?: { __html: string };
    }>(node)
  )
    return "";
  const html = node.props.dangerouslySetInnerHTML?.__html;
  if (html === undefined) return textOf(node.props.children);
  return html
    .replace(/<[^>]*>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&");
}

// API operation names end with their HTTP method; rows show it apart from
// the label so a long label truncates instead of wrapping.
export function rowLabel(node: ReactNode) {
  const text = textOf(node).replace(/\s+/g, " ").trim();
  const match = /^(.*) (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.exec(text);
  return match ? { label: match[1], method: match[2] } : { label: text };
}

export function contains(node: PageTree.Node, url: string): boolean {
  if (node.type === "page") return node.url === url;
  if (node.type === "folder")
    return (
      node.index?.url === url || node.children.some((c) => contains(c, url))
    );
  return false;
}

export function firstPage(node: PageTree.Folder): string | undefined {
  if (node.index) return node.index.url;
  for (const child of node.children) {
    if (child.type === "page") return child.url;
    if (child.type === "folder") {
      const url = firstPage(child);
      if (url) return url;
    }
  }
  return undefined;
}

export function folderPages(folder: PageTree.Folder): PageTree.Item[] {
  return folder.children.flatMap((child) =>
    child.type === "page"
      ? [child]
      : child.type === "folder"
        ? folderPages(child)
        : [],
  );
}

// Every docs page is the splat route; links go through the router.
export function PageLink({
  url,
  ...props
}: { url: string } & ComponentProps<"a">) {
  return <Link {...props} params={{ _splat: url.slice(1) }} to="/$" />;
}

// The two halves of the docs: prose guides at the top level of the tree,
// and the reference folder (the API) beneath them.
export function splitTree(tree: PageTree.Root) {
  return {
    guides: tree.children.filter((node) => node.type !== "folder"),
    reference: tree.children.filter(
      (node): node is PageTree.Folder => node.type === "folder",
    ),
  };
}

// The sidebar calls the tree's first page "Overview"; its title is the
// product's name, which the page itself shows.
export function guideLabel(page: PageTree.Item) {
  return page.url === "/" ? "Overview" : textOf(page.name);
}

// Where a page sits, ending with the page: Guides and the guide, or
// Reference, the tag and the operation.
export function crumbsFor(tree: PageTree.Root, url: string) {
  const { guides, reference } = splitTree(tree);
  const crumbs: { label: string; url?: string }[] = [];
  const root = reference.find((folder) => contains(folder, url));
  if (!root) {
    crumbs.push({ label: "Guides", url: "/" });
    const page = guides.find(
      (node): node is PageTree.Item => node.type === "page" && node.url === url,
    );
    if (page) crumbs.push({ label: guideLabel(page) });
    return crumbs;
  }
  crumbs.push({ label: "Reference", url: firstPage(root) });
  let folder: PageTree.Folder | undefined = root;
  while (folder) {
    const page = folder.children.find(
      (child): child is PageTree.Item =>
        child.type === "page" && child.url === url,
    );
    if (page) crumbs.push({ label: rowLabel(page.name).label });
    const next: PageTree.Folder | undefined = folder.children.find(
      (child): child is PageTree.Folder =>
        child.type === "folder" && contains(child, url),
    );
    if (next)
      crumbs.push({
        label: textOf(next.name),
        url: next.index?.url ?? firstPage(next),
      });
    folder = next;
  }
  return crumbs;
}
