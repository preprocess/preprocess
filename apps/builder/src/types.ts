// The same shapes as apps/api's Builder (apps/api/src/env.ts).
export type BuildRequest = {
  id: string;
  archive: ReadableStream<Uint8Array>;
  directory: string;
  entry: string;
  timeoutSeconds: number;
  // Whose build it is, for sandbox metering (spec 16a).
  owner: { organizationId: string; agent: string };
};

export type BuildResult =
  | {
      status: "succeeded";
      bundle: { mainModule: string; modules: Record<string, string> };
      log: string;
    }
  | { status: "failed" | "timed_out"; log: string };
