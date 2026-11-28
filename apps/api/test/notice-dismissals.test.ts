// Dismissing an announcement from the sidebar notice stack: per person, kept
// apart between people, and safe to repeat.

import { describe, expect, it } from "vitest";

import { Client, signUp } from "./helpers.ts";

const dismissed = async (client: Client) => {
  const response = await client.call<{ ids: string[] }>(
    "/v1/me/notices/dismissed",
  );
  expect(response.status).toBe(200);
  return response.body.ids;
};

describe("notice dismissals", () => {
  it("are kept per person", async () => {
    const { client } = await signUp("Dismisser");
    expect(await dismissed(client)).toEqual([]);
    const put = await client.call("/v1/me/notices/dismissed/case-sandboxes", {
      method: "PUT",
    });
    expect(put.status).toBe(204);
    expect(await dismissed(client)).toEqual(["case-sandboxes"]);
  });

  it("don't show for another person", async () => {
    const ada = await signUp("Ada");
    const grace = await signUp("Grace");
    await ada.client.call("/v1/me/notices/dismissed/case-sandboxes", {
      method: "PUT",
    });
    expect(await dismissed(ada.client)).toEqual(["case-sandboxes"]);
    expect(await dismissed(grace.client)).toEqual([]);
  });

  it("are idempotent", async () => {
    const { client } = await signUp("Twice");
    for (let i = 0; i < 2; i++) {
      const put = await client.call("/v1/me/notices/dismissed/case-sandboxes", {
        method: "PUT",
      });
      expect(put.status).toBe(204);
    }
    expect(await dismissed(client)).toEqual(["case-sandboxes"]);
  });

  it("need a signed-in person", async () => {
    const response = await new Client().call("/v1/me/notices/dismissed");
    expect(response.status).toBe(401);
  });

  it("refuse an id that isn't an announcement id", async () => {
    const { client } = await signUp("Odd");
    const put = await client.call("/v1/me/notices/dismissed/Not%20An%20Id", {
      method: "PUT",
    });
    expect(put.status).toBe(400);
  });
});
