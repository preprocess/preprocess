import { describe, expect, it } from "vitest";

import { logs } from "../src/logs.ts";

const log = {
  at: "2026-11-24T10:00:00.000Z",
  level: "warn",
  source: "platform",
  kind: "tool.call",
  caseId: "case_1",
  message: "lookup failed",
  durationMs: 12.4,
  error: { message: "timeout" },
};

describe("preprocess logs", () => {
  it("asks for a case's logs with the filters and prints one line each", async () => {
    const urls: string[] = [];
    const fake = ((url: URL) => {
      urls.push(url.toString());
      return Promise.resolve(Response.json({ logs: [log], cursor: null }));
    }) as typeof fetch;
    const { out } = await logs({
      api: "https://api.test",
      org: "org_1",
      key: "pk",
      case: "case_1",
      agent: "ignored",
      level: "warn",
      fetch: fake,
    });
    expect(urls).toEqual([
      "https://api.test/v1/orgs/org_1/cases/case_1/logs?level=warn",
    ]);
    expect(out).toBe(
      "2026-11-24T10:00:00.000Z  WARN   platform  case_1      tool.call  lookup failed (12ms) — timeout",
    );
  });

  it("reports the API's error", async () => {
    const fake = (() =>
      Promise.resolve(
        Response.json(
          {
            error: {
              code: "forbidden",
              message: "Logs across cases are for Developers",
            },
          },
          { status: 403 },
        ),
      )) as typeof fetch;
    await expect(
      logs({ api: "https://api.test", org: "org_1", key: "pk", fetch: fake }),
    ).rejects.toThrow(
      "GET logs failed (403): Logs across cases are for Developers",
    );
  });
});
