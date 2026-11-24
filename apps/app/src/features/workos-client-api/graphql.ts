export const CLIENT_GRAPHQL_URL = "https://api.workos.com/client/graphql";

export type ClientApiErrorKind =
  "forbidden" | "expired" | "unauthorized" | "network" | "generic";

export class ClientApiError extends Error {
  readonly status: number | undefined;
  readonly codes: string[];

  constructor(
    message: string,
    options?: { status?: number; codes?: string[] },
  ) {
    super(message);
    this.name = "ClientApiError";
    this.status = options?.status;
    this.codes = options?.codes ?? [];
  }

  get forbidden() {
    return (
      this.codes.includes("Forbidden") ||
      this.message.toLowerCase().includes("forbidden")
    );
  }

  get unauthorized() {
    return (
      this.status === 401 || this.message.toLowerCase().includes("unauthor")
    );
  }

  get expired() {
    return (
      this.codes.includes("ElevatedAccessTokenExpired") ||
      this.message.toLowerCase().includes("session expired") ||
      this.message.toLowerCase().includes("token expired")
    );
  }
}

export function clientApiErrorKind(cause: unknown): ClientApiErrorKind {
  if (cause instanceof TypeError) return "network";
  if (!(cause instanceof ClientApiError)) return "generic";
  if (cause.forbidden) return "forbidden";
  if (cause.expired) return "expired";
  if (cause.unauthorized) return "unauthorized";
  if (cause.status === 0) return "network";
  return "generic";
}

type GraphqlError = {
  message: string;
  extensions?: { code?: string };
};

type GraphqlBody<T> = {
  data?: T | null;
  errors?: GraphqlError[];
};

export async function clientGraphql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch(CLIENT_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  let body: GraphqlBody<T> = {};
  try {
    body = await response.json();
  } catch {
    throw new ClientApiError(`Client API request failed (${response.status})`, {
      status: response.status,
    });
  }

  if (!response.ok || (body.errors && body.errors.length > 0)) {
    const codes = (body.errors ?? [])
      .map((error) => error.extensions?.code)
      .filter((code): code is string => Boolean(code));
    throw new ClientApiError(
      body.errors?.[0]?.message ??
        `Client API request failed (${response.status})`,
      { status: response.status, codes },
    );
  }

  if (body.data == null) {
    throw new ClientApiError("Client API returned no data");
  }

  return body.data;
}
