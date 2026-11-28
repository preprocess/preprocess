// Single sign-on settings (PRE-137): the organization's identity provider
// connection, its email domains and how people sign in. "live" reads and
// writes /v1 through server functions; in development the other "sso"
// scenarios serve seeded settings and answer writes as the API would.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";

import { staleAfterWrite } from "../../lib/data-changed";
import { currentScenario } from "../../scenarios/current-scenario";
import { useOrganizationId } from "../auth/auth-context";
import { ApiError } from "../auth/client";
import {
  SEEDED_GROUPS,
  SEEDED_TESTER,
  seedRecord,
  seededSso,
  type SsoDomain,
  type SsoGroup,
  type SsoSeedState,
  type SsoSettings,
} from "./sso-seed";

export type ConnectionInput =
  | { protocol: "saml"; metadataUrl: string }
  | { protocol: "saml"; metadataXml: string }
  | {
      protocol: "oidc";
      issuer: string;
      clientId: string;
      clientSecret?: string;
    };

export type SignInChange = {
  requireSso?: boolean;
  jit?: boolean;
  defaultGroupId?: string | null;
};

/** A refused write: the API's code and message, and the status a metadata read got. */
export class SsoError extends ApiError {
  constructor(
    message: string,
    status: number,
    code?: string,
    readonly upstreamStatus?: string,
  ) {
    super(message, status, code);
  }
}

type Failed = {
  ok: false;
  status: number;
  code?: string;
  message: string;
  upstreamStatus?: string;
};
type Result<T> = { ok: true; data: T } | Failed;

const issues = (json: string | undefined) => {
  try {
    return (JSON.parse(json ?? "") as { message: string }[])
      .map((issue) => issue.message)
      .join(" ");
  } catch {
    return undefined;
  }
};

async function settle<T>(response: Response): Promise<Result<T>> {
  if (response.ok)
    return {
      ok: true,
      data: (response.status === 204 ? null : await response.json()) as T,
    };
  const body = await response
    .json<{
      success?: false;
      error?: string | { code?: string; message?: string; status?: string };
    }>()
    .catch(() => null);
  // #217's refusals on PUT /sso answer { error: "message" }, and its
  // validation errors { success: false, error } with the issues as JSON in
  // the message; every other refusal { error: { code, message } }.
  const error =
    typeof body?.error === "string" ? { message: body.error } : body?.error;
  const message =
    body?.success === false ? issues(error?.message) : error?.message;
  return {
    ok: false,
    status: response.status,
    code: error?.code,
    message: message ?? `The request failed (${response.status}).`,
    upstreamStatus: error?.status,
  };
}

const unwrap = <T>(result: Result<T>): T => {
  if (result.ok) return result.data;
  throw new SsoError(
    result.message,
    result.status,
    result.code,
    result.upstreamStatus,
  );
};

const liveSso = createServerFn({ method: "GET" }).handler(
  async (): Promise<Result<SsoSettings>> => {
    const { activeOrgRequest } = await import("../../server/api.server");
    return settle(await activeOrgRequest("/sso"));
  },
);

const liveGroups = createServerFn({ method: "GET" }).handler(
  async (): Promise<SsoGroup[]> => {
    const { activeOrgJson } = await import("../../server/api.server");
    const groups = await activeOrgJson<SsoGroup[]>("/groups");
    return groups.map(({ id, name }) => ({ id, name }));
  },
);

const liveWrite = createServerFn({ method: "POST" })
  .middleware([staleAfterWrite])
  .validator(
    (input: {
      method: "PUT" | "PATCH" | "POST" | "DELETE";
      path: string;
      body?: unknown;
    }) => input,
  )
  .handler(
    async ({ data }): Promise<Result<SsoSettings | SsoDomain | null>> => {
      const { activeOrgRequest } = await import("../../server/api.server");
      return settle(
        await activeOrgRequest(data.path, {
          method: data.method,
          ...(data.body === undefined
            ? {}
            : { body: JSON.stringify(data.body) }),
        }),
      );
    },
  );

// Seeded writes stick in memory until the page reloads.
const seededWrites = new Map<SsoSeedState, SsoSettings>();

const never = <T>() => new Promise<T>(() => {});

function seeded(state: SsoSeedState): SsoSettings | undefined {
  switch (state) {
    case "member":
      throw new ApiError("Only Owners can manage single sign-on.", 403);
    case "error":
      throw new ApiError("Something went wrong. Try again.", 500);
    case "loading":
      return undefined;
    default:
      return seededWrites.get(state) ?? seededSso(state);
  }
}

const refuse = (
  status: number,
  code: string,
  message: string,
  upstream?: string,
) => new SsoError(message, status, code, upstream);

const requireSsoReady = (settings: SsoSettings) =>
  settings.domains.some((d) => d.status === "verified") &&
  settings.connection?.lastTest?.ok === true;

/** Answers a write on seeded settings as the API would. */
function seededWrite(
  state: SsoSeedState,
  method: "PUT" | "PATCH" | "POST" | "DELETE",
  path: string,
  body: unknown,
): unknown {
  const before = seeded(state);
  if (!before) return never();
  if (!before.access.canEdit)
    throw refuse(403, "forbidden", "Only Owners can change single sign-on.");
  const save = (next: SsoSettings) => {
    seededWrites.set(state, next);
    return next;
  };
  const now = new Date().toISOString();

  if (path === "/sso" && method === "PUT") {
    const input = body as ConnectionInput;
    const existing = before.connection;
    if (existing && existing.protocol !== input.protocol)
      throw new SsoError(
        "Remove the connection before switching between SAML and OIDC.",
        409,
      );
    const base = {
      requireSso: existing?.requireSso ?? false,
      jit: existing?.jit ?? false,
      defaultGroupId: existing?.defaultGroupId ?? null,
      lastTest: null,
    };
    if ("issuer" in input) {
      if (!/^https:\/\/[^/]+/.test(input.issuer))
        throw refuse(400, "invalid_url", "Use an https:// URL.");
      return save({
        ...before,
        connection: {
          ...base,
          protocol: "oidc",
          saml: null,
          oidc: {
            issuer: input.issuer,
            clientId: input.clientId,
            hasSecret:
              Boolean(input.clientSecret) || Boolean(existing?.oidc?.hasSecret),
          },
        },
      });
    }
    // Seeded metadata URLs read only when they end in /metadata; anything
    // else answers as a 404 from the identity provider.
    if ("metadataUrl" in input && !/\/metadata$/.test(input.metadataUrl))
      throw refuse(
        400,
        "metadata_unreadable",
        "Couldn't read the metadata: the URL returned 404 Not Found.",
        "404 Not Found",
      );
    return save({
      ...before,
      connection: {
        ...base,
        protocol: "saml",
        oidc: null,
        saml: {
          metadataUrl: "metadataUrl" in input ? input.metadataUrl : null,
          pastedXml: "metadataXml" in input,
          metadataReadAt: now,
          certificateExpiresAt: "2028-03-14T00:00:00.000Z",
          idpEntityId: "http://www.okta.com/exk8f2kq1x",
        },
      },
    });
  }

  if (path === "/sso" && method === "DELETE") {
    save({ ...before, connection: null });
    return null;
  }

  if (path === "/sso/sign-in" && method === "PATCH") {
    const change = body as SignInChange;
    if (!before.connection)
      throw refuse(404, "not_found", "Connect a provider first.");
    if (change.requireSso && !requireSsoReady(before))
      throw refuse(
        409,
        "sso_not_ready",
        "Verify a domain and pass a test sign-in first.",
      );
    return save({
      ...before,
      connection: { ...before.connection, ...change },
    });
  }

  if (path === "/sso/domains" && method === "POST") {
    const domain = (body as { domain: string }).domain.trim().toLowerCase();
    if (!/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain))
      throw refuse(400, "invalid_request", "Enter a domain like acme.com.");
    if (before.domains.some((d) => d.domain === domain))
      throw refuse(409, "domain_exists", "That domain is already on the list.");
    const added: SsoDomain = {
      domain,
      status: "pending",
      checkedAt: new Date().toISOString(),
      verifiedAt: null,
      failureReason: null,
      record: seedRecord(domain),
    };
    save({ ...before, domains: [...before.domains, added] });
    return added;
  }

  const check = /^\/sso\/domains\/([^/]+)\/check$/.exec(path);
  if (check && method === "POST") {
    const name = decodeURIComponent(check[1] ?? "");
    const current = before.domains.find((d) => d.domain === name);
    if (!current)
      throw refuse(404, "not_found", "That domain isn't on the list.");
    // Seeded checks verify pending domains; failed ones stay failed.
    const checked: SsoDomain =
      current.status === "failed"
        ? { ...current, checkedAt: now }
        : {
            ...current,
            status: "verified",
            checkedAt: now,
            verifiedAt: now,
            failureReason: null,
          };
    save({
      ...before,
      domains: before.domains.map((d) => (d.domain === name ? checked : d)),
    });
    return checked;
  }

  const removed = /^\/sso\/domains\/([^/]+)$/.exec(path);
  if (removed && method === "DELETE") {
    const name = decodeURIComponent(removed[1] ?? "");
    const domains = before.domains.filter((d) => d.domain !== name);
    save({
      ...before,
      domains,
      connection:
        before.connection && !domains.some((d) => d.status === "verified")
          ? { ...before.connection, requireSso: false }
          : before.connection,
    });
    return null;
  }

  throw refuse(404, "not_found", "Connect a provider first.");
}

/** The organization's single sign-on settings; a Member's read fails with 403. */
export function useSso() {
  const organizationId = useOrganizationId();
  const state = currentScenario().sso;
  return useQuery({
    queryKey: ["sso", organizationId, state],
    retry: false,
    queryFn: async () => {
      if (state === "live") return unwrap(await liveSso());
      return seeded(state) ?? never<SsoSettings>();
    },
  });
}

/** The organization's groups, for the Default group select. */
export function useSsoGroups(enabled: boolean) {
  const organizationId = useOrganizationId();
  const state = currentScenario().sso;
  return useQuery({
    queryKey: ["sso-groups", organizationId, state],
    enabled,
    queryFn: () =>
      state === "live" ? liveGroups() : Promise.resolve(SEEDED_GROUPS),
  });
}

export function useSsoActions() {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const call = async <T>(
    method: "PUT" | "PATCH" | "POST" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> => {
    const state = currentScenario().sso;
    if (state === "live")
      return unwrap(await liveWrite({ data: { method, path, body } })) as T;
    await new Promise((resolve) => setTimeout(resolve, 600));
    return seededWrite(state, method, path, body) as T;
  };
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["sso", organizationId] });
  const domainPath = (domain: string, rest = "") =>
    `/sso/domains/${encodeURIComponent(domain)}${rest}`;
  const after = async <T>(write: Promise<T>) => {
    try {
      return await write;
    } finally {
      await refresh();
    }
  };
  return {
    saveConnection: (input: ConnectionInput) =>
      after(call("PUT", "/sso", input)),
    removeConnection: () => after(call("DELETE", "/sso")),
    changeSignIn: (change: SignInChange) =>
      after(call("PATCH", "/sso/sign-in", change)),
    addDomain: (domain: string) =>
      after(call<SsoDomain>("POST", "/sso/domains", { domain })),
    checkDomain: (domain: string) =>
      after(call<SsoDomain>("POST", domainPath(domain, "/check"))),
    removeDomain: (domain: string) => after(call("DELETE", domainPath(domain))),
  };
}

type TestSession = { before: string | null } | null;

/**
 * Test sign-in. Live, it opens the API's test route in a popup, which sends
 * the identity provider's answer back as a "preprocess:sso-test" message and
 * closes; either way the settings are read again. Seeded states answer after
 * a moment without a popup. "justTested" is true once a test started on this
 * page has stored a new result.
 */
export function useSsoTest(lastTestAt: string | null) {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const state = currentScenario().sso;
  // The seeded "test-passed" state opens as if a test had just passed.
  const [session, setSession] = useState<TestSession>(() =>
    state === "test-passed" ? { before: "" } : null,
  );
  const [testing, setTesting] = useState(false);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  const refresh = useCallback(async () => {
    cleanup.current?.();
    cleanup.current = null;
    await queryClient.invalidateQueries({ queryKey: ["sso", organizationId] });
    setTesting(false);
  }, [organizationId, queryClient]);

  const start = useCallback(() => {
    setSession({ before: lastTestAt });
    setTesting(true);
    if (state !== "live") {
      const before = seeded(state);
      window.setTimeout(() => {
        const last = before?.connection?.lastTest;
        const at = new Date().toISOString();
        if (before?.connection)
          seededWrites.set(state, {
            ...before,
            connection: {
              ...before.connection,
              lastTest:
                state === "test-failed" && last && !last.ok
                  ? { ...last, at }
                  : { ok: true, at, ...SEEDED_TESTER },
            },
          });
        void refresh();
      }, 1200);
      return;
    }
    const popup = window.open(
      `/v1/orgs/${organizationId}/sso/test`,
      "preprocess-sso-test",
      "popup,width=520,height=680",
    );
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (
        (event.data as { type?: string } | null)?.type !== "preprocess:sso-test"
      )
        return;
      void refresh();
    };
    window.addEventListener("message", onMessage);
    const poll = window.setInterval(() => {
      if (!popup || popup.closed) void refresh();
    }, 500);
    cleanup.current = () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(poll);
    };
  }, [lastTestAt, organizationId, refresh, state]);

  const justTested =
    session !== null && lastTestAt !== null && lastTestAt !== session.before;
  return { start, testing, justTested };
}
