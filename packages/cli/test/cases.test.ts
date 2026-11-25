import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { casesCreate } from "../src/cases.ts";

describe("preprocess cases create", () => {
  it("uploads each file, then starts the case with an Idempotency-Key", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cases-"));
    const invoice = path.join(dir, "invoice.pdf");
    await writeFile(invoice, "%PDF-1.7");
    const calls: { url: string; headers: Headers; body: unknown }[] = [];
    const fake = ((url: URL, init: RequestInit) => {
      const headers = new Headers(init.headers);
      if (init.body instanceof FormData) {
        const file = init.body.get("file") as File;
        calls.push({ url: url.toString(), headers, body: file.name });
        return Promise.resolve(
          Response.json({ id: "file_1" }, { status: 201 }),
        );
      }
      calls.push({
        url: url.toString(),
        headers,
        body: JSON.parse(init.body as string),
      });
      return Promise.resolve(
        Response.json(
          { id: "case_1", status: "queued", statusUrl: "https://api.test/s" },
          { status: 202 },
        ),
      );
    }) as unknown as typeof fetch;
    const { out } = await casesCreate({
      api: "https://api.test",
      org: "org_1",
      key: "pk",
      agent: "invoices",
      text: "Invoice 1042",
      files: [invoice],
      idempotencyKey: "retry-1",
      fetch: fake,
    });
    expect(calls.map((c) => [c.url, c.body])).toEqual([
      ["https://api.test/v1/orgs/org_1/files", "invoice.pdf"],
      [
        "https://api.test/v1/orgs/org_1/cases",
        { agent: "invoices", text: "Invoice 1042", files: ["file_1"] },
      ],
    ]);
    expect(calls[1]!.headers.get("idempotency-key")).toBe("retry-1");
    expect(
      calls.every((c) => c.headers.get("authorization") === "Bearer pk"),
    ).toBe(true);
    expect(out).toBe("Started case_1: https://api.test/s");
  });

  it("reports the API's error", async () => {
    const fake = (() =>
      Promise.resolve(
        Response.json(
          { error: { code: "not_found", message: "No such agent." } },
          { status: 404 },
        ),
      )) as typeof fetch;
    await expect(
      casesCreate({
        api: "https://api.test",
        org: "org_1",
        key: "pk",
        agent: "nope",
        text: "hi",
        fetch: fake,
      }),
    ).rejects.toThrow("POST cases failed (404): No such agent.");
  });
});
