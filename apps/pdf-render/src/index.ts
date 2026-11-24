// Renders a PDF's pages to PNG images for OCR (design doc 07). Each render
// runs in its own sandbox container with poppler's pdftoppm and no network,
// and the container is destroyed afterwards, so one organization's file never
// shares a machine with another's.

import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";

type Env = { RENDERER: DurableObjectNamespace<Renderer> };

// LightOn OCR 3 4B takes one page per request, longest edge 2048 px.
const LONGEST_EDGE = 2048;
const MAX_PAGES = 100;

// Reads the PDF from stdin and prints each page as one line of base64 PNG,
// in page order.
const script = `set -eu
dir=$(mktemp -d)
cat > "$dir/in.pdf"
pdftoppm -png -scale-to ${LONGEST_EDGE} -l ${MAX_PAGES} "$dir/in.pdf" "$dir/page"
for f in $(ls "$dir"/page-*.png | sort -V); do base64 -w0 "$f"; echo; done
rm -rf "$dir"`;

const fromBase64 = (line: string) =>
  Uint8Array.from(atob(line), (c) => c.charCodeAt(0));

export class Renderer extends DurableObject<Env> {
  // start() returns before the container can take commands; until it can,
  // exec() refuses.
  private async exec(container: Container, pdf: Uint8Array) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await container.exec(["sh", "-c", script], {
          stdin: new Blob([pdf]).stream(),
        });
      } catch (error) {
        if (
          attempt >= 100 ||
          !/requires a running container/.test(String(error))
        )
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  }

  async render(pdf: Uint8Array): Promise<Uint8Array[]> {
    const container = this.ctx.container;
    if (!container) throw new Error("no container is configured");
    if (!container.running) container.start();
    try {
      const process = await this.exec(container, pdf);
      const output = await process.output();
      if (output.exitCode !== 0)
        throw new Error(
          `pdftoppm failed: ${new TextDecoder().decode(output.stderr).trim()}`,
        );
      return new TextDecoder()
        .decode(output.stdout)
        .split("\n")
        .filter(Boolean)
        .map(fromBase64);
    } finally {
      await container.destroy();
    }
  }
}

// The API's binding: one renderer per call.
export default class PdfRender extends WorkerEntrypoint<Env> {
  renderPdf(pdf: Uint8Array) {
    return this.env.RENDERER.getByName(crypto.randomUUID()).render(pdf);
  }

  override fetch() {
    return new Response("pdf-render", { status: 404 });
  }
}
