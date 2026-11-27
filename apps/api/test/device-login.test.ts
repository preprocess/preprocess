import { describe, expect, it } from "vitest";

import {
  addMember,
  Client,
  createOrganization,
  signUp,
  testEnv,
} from "./helpers.ts";

const GRANT = "urn:ietf:params:oauth:grant-type:device_code";

type Code = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  interval: number;
};

// What `preprocess login` does: ask for a code, then poll for the session.
const askForCode = async () => {
  const cli = new Client();
  const code = await cli.call<Code>("/api/auth/device/code", {
    body: { client_id: "preprocess-cli" },
  });
  expect(code.status).toBe(200);
  const poll = () =>
    cli.call<{ access_token?: string; error?: string }>(
      "/api/auth/device/token",
      {
        body: {
          grant_type: GRANT,
          device_code: code.body.device_code,
          client_id: "preprocess-cli",
        },
      },
    );
  return { code: code.body, poll };
};

// What the app's /device page does for the signed-in person: claim the code,
// then approve or deny it.
const answer = async (
  person: Client,
  userCode: string,
  choice: "approve" | "deny",
) => {
  const claimed = await person.call(
    `/api/auth/device?user_code=${encodeURIComponent(userCode)}`,
  );
  expect(claimed.status).toBe(200);
  return person.call(`/api/auth/device/${choice}`, { body: { userCode } });
};

const asBearer = (token: string) =>
  new Client(testEnv(), { authorization: `Bearer ${token}` });

describe("preprocess login (device authorization)", () => {
  it("gives the CLI a session of the person who approved the code", async () => {
    const { client: owner } = await signUp("Device Owner");
    const org = await createOrganization(owner, "Device Org");
    const { code, poll } = await askForCode();
    expect(code.verification_uri).toBe(
      new URL("/device", testEnv().APP_URL).toString(),
    );
    expect(code.verification_uri_complete).toContain(code.user_code);

    const pending = await poll();
    expect(pending.status).toBe(400);
    expect(pending.body.error).toBe("authorization_pending");

    const approved = await answer(owner, code.user_code, "approve");
    expect(approved.status).toBe(200);
    const granted = await poll();
    expect(granted.status).toBe(200);
    const token = granted.body.access_token!;

    const cli = asBearer(token);
    expect((await cli.call(`/v1/orgs/${org}/agents`)).status).toBe(200);
    const orgs = await cli.call<{ id: string }[]>(
      "/api/auth/organization/list",
    );
    expect(orgs.body.map((o) => o.id)).toEqual([org]);

    // The code works once.
    expect((await poll()).status).toBe(400);
  });

  it("keeps the session inside the person's own organizations and role", async () => {
    const { client: owner } = await signUp("Device Owner Two");
    const org = await createOrganization(owner, "Device Org Two");
    const { client: other } = await signUp("Other Owner");
    const otherOrg = await createOrganization(other, "Other Org");
    const { client: member } = await addMember(owner, org, "Device Member");

    const { code, poll } = await askForCode();
    // Once the member has claimed the code, nobody else can approve it.
    const claimed = await answer(member, code.user_code, "approve");
    expect(claimed.status).toBe(200);
    const stolen = await owner.call("/api/auth/device/approve", {
      body: { userCode: code.user_code },
    });
    expect(stolen.status).toBe(400);
    const cli = asBearer((await poll()).body.access_token!);

    expect((await cli.call(`/v1/orgs/${otherOrg}/agents`)).status).toBe(403);
    // A Member who is not a Developer cannot promote, as in the app.
    const promote = await cli.call(
      `/v1/orgs/${org}/agents/any/deployments/dep_any/promote`,
      { method: "POST" },
    );
    expect(promote.status).toBe(403);
  });

  it("refuses a denied code, an unknown client and an unknown token", async () => {
    const { client: owner } = await signUp("Device Denier");
    const org = await createOrganization(owner, "Device Org Three");
    const { code, poll } = await askForCode();
    const denied = await answer(owner, code.user_code, "deny");
    expect(denied.status).toBe(200);
    const refused = await poll();
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("access_denied");

    const stranger = await new Client().call("/api/auth/device/code", {
      body: { client_id: "someone-else" },
    });
    expect(stranger.status).toBe(400);

    expect(
      (await asBearer("not-a-session").call(`/v1/orgs/${org}/agents`)).status,
    ).toBe(401);
  });
});
