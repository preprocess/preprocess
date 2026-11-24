import { listZipEntries, readZipText } from "./case-input-zip";

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]+)"`).exec(tag)?.[1];
}

function joinOpfHref(opfPath: string, href: string): string {
  const slash = opfPath.lastIndexOf("/");
  const dir = slash === -1 ? "" : opfPath.slice(0, slash + 1);
  return `${dir}${href.replace(/^\.\//, "")}`;
}

export async function firstSpineHtml(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const names = new Set(listZipEntries(bytes).map((entry) => entry.name));
  if (!names.has("META-INF/container.xml"))
    throw new Error("Missing container");
  const containerXml = await readZipText(bytes, "META-INF/container.xml");
  if (containerXml == null) throw new Error("Missing container");
  const rootPath = attr(
    /<rootfile\b[^>]*>/.exec(containerXml)?.[0] ?? "",
    "full-path",
  );
  if (!rootPath || !names.has(rootPath)) throw new Error("Missing rootfile");
  const opfXml = await readZipText(bytes, rootPath);
  if (opfXml == null) throw new Error("Missing rootfile");
  const idref = attr(/<itemref\b[^>]*>/.exec(opfXml)?.[0] ?? "", "idref");
  if (!idref) throw new Error("Missing spine");
  const item = (opfXml.match(/<item\b[^>]*\/?>/g) ?? []).find(
    (tag) => attr(tag, "id") === idref,
  );
  const href = item ? attr(item, "href") : undefined;
  if (!href) throw new Error("Missing href");
  const htmlPath = joinOpfHref(rootPath, href);
  if (!names.has(htmlPath)) throw new Error("Missing html");
  const html = await readZipText(bytes, htmlPath);
  if (html == null) throw new Error("Missing html");
  return html;
}
