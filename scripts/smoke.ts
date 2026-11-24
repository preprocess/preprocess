// Checks a deployed stage end to end: Postgres (seeded through Hyperdrive),
// the Durable Object, the queue writing to R2, dispatch to the user Worker, and
// the app Worker. OUTPUTS is the JSON infra/scripts/preview.ts printed.

const { api, app } = JSON.parse(process.env.OUTPUTS ?? "{}") as {
  api?: string;
  app?: string;
};
if (!api || !app) throw new Error("OUTPUTS must carry api and app URLs");

const call = async (path: string, init?: RequestInit) => {
  const response = await fetch(new URL(path, api), init);
  const body = await response.text();
  console.log(`${init?.method ?? "GET"} ${path} -> ${response.status} ${body}`);
  return { status: response.status, body };
};
const expect = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`smoke test failed: ${what}`);
};

// A new workers.dev subdomain can take a few seconds to answer.
for (let attempt = 0; ; attempt++) {
  const { status } = await call("/").catch(() => ({ status: 0 }));
  if (status === 200) break;
  if (attempt > 30) throw new Error("API never came up");
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

expect(
  (await call("/orgs/org_acme/counter", { method: "POST" })).status === 200,
  "Durable Object",
);
const job = JSON.parse(
  (await call("/orgs/org_acme/jobs", { method: "POST" })).body,
) as { id: string };
let done = false;
for (let attempt = 0; attempt < 30 && !done; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  done = (await call(`/orgs/org_acme/jobs/${job.id}`)).status === 200;
}
expect(done, "queue consumer wrote the job to R2");
expect(
  (await call("/dispatch")).body.includes("dispatch-namespace"),
  "dispatch namespace",
);

// Deployed stages don't bind the app to the API yet, so check only that its
// Worker answers.
const page = await fetch(app, { redirect: "manual" });
console.log(`GET ${app} -> ${page.status}`);
expect(page.status < 500, "app Worker answers");
console.log("smoke test passed");
