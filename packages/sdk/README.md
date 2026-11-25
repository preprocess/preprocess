# @preprocess/sdk

The TypeScript SDK agents are written with (spec 3). An agent is a Worker module
that Preprocess stores as a bundle and runs as a Dynamic Worker. The runtime (Pi
Durable, in the platform's Durable Objects) runs the model loop and calls the
agent's code for its manifest and for each tool call.

```ts
import { agent, tool } from "@preprocess/sdk";
import { z } from "zod";

export default agent({
  instructions: "You answer stock questions for Acme.",
  model: "deepseek-v4.1-flash",
  secrets: ["ERP_TOKEN"],
  mcp: ["crm"],
  tools: {
    lookup_stock: tool({
      description: "Look up stock for a SKU",
      input: z.object({ sku: z.string() }),
      run: async ({ sku }, { env }) => {
        const response = await fetch(`https://erp.example.com/stock/${sku}`, {
          headers: { authorization: `Bearer ${env.ERP_TOKEN}` },
        });
        return response.json();
      },
    }),
    find_contact: tool({
      description: "Find a CRM contact",
      input: z.object({ q: z.string() }),
      run: ({ q }, ctx) => ctx.mcp("crm").call("search_contacts", { q }),
    }),
  },
});
```

- **Secrets.** `secrets` lists the organization secrets the code needs. Only
  those an Admin granted to the agent are bound; the rest are `undefined`.
  Values reach only this Worker, never the model, the case thread, logs or run
  capture. The SDK removes bound values from tool results, errors and console
  output as a second line of defence; code that transforms a value can still
  leak it.
- **MCP.** `mcp` lists the servers the agent uses. Calls go through the
  platform's token service, which adds the organization's connection token; the
  code never holds it.
- **Protocol.** `@preprocess/sdk/protocol` holds the manifest and tool-call
  types the runtime speaks (`GET /manifest`, `POST /tools/:name`). Each
  deployment records the SDK version it was built with.

## Output schema

`schema` declares the case's output as a tree of groups, lists and fields
(design doc 05). Every function receives `a`, an answers accessor that records
each path it reads, so the runtime knows what to re-evaluate when an answer
changes.

```ts
import { agent, schema as s } from "@preprocess/sdk";

export default agent({
  instructions: "Code invoices.",
  secrets: ["ERP_TOKEN"],
  groups: ["accounts-payable"],
  schedules: [{ name: "nightly", cron: "0 2 * * *", text: "Reconcile" }],
  schema: s.group(
    {
      vendor: s.select({
        options: s.source({
          search: (q, { cursor, env }) => erp(env.ERP_TOKEN).search(q, cursor),
          get: (ids, { env }) => erp(env.ERP_TOKEN).get(ids),
        }),
        review: "required",
      }),
      vendorRecord: s.fetched({
        inputs: (a) => ({ vendor: a.get("vendor") }),
        fetch: ({ vendor }, { env }) => erp(env.ERP_TOKEN).record(vendor),
        transform: (row) => ({ currency: row.currency }),
      }),
      lines: s.list(
        s.group({
          sku: s.text(),
          glAccount: s.select({
            options: (a) => glAccountsFor(a.sibling("sku")),
          }),
          amount: s.number(),
        }),
      ),
      total: s.number(),
    },
    {
      checks: {
        totalsMatch: (a) =>
          a.sum("lines[*].amount") === a.get("total") || {
            field: "total",
            message: "Lines do not add up",
          },
      },
    },
  ),
  tools: {},
});
```

- **Fields.** `text`, `number`, `boolean`, `date`, `select`, `multiselect`,
  `fetched`, nested with `group` and `list`. Each takes `description`,
  `visible(a)`, `review` (`"required" | "none"` or a function; groups pass it to
  their children) and `invalidates` (paths a change makes stale that never read
  it).
- **Accessor.** `a.get(path)` returns an answer, or `null` when it is empty or
  hidden; `a.fetched(path)`, `a.all("lines[*].amount")`, `a.sum(...)` and
  `a.sibling(name)` (the field beside this one in a list item).
- **Fetched fields** declare their `inputs`; the fetch runs again only when the
  inputs change, otherwise the runtime's saved data is reused.
- **Options** are an array, a function of the answers, or `s.source()` for large
  lists that are searched and paged, never loaded whole.
- **Groups.** `ctx.waitOn(group, { reason })` and `ctx.tag(group, message)` in a
  tool name groups by slug; only slugs listed in `groups` are allowed.
- **Approvals.** `approval` on `agent()`, a schema field or `tool()` asks a
  person to approve before the case completes, the field's value stands, or the
  tool runs. `true` is any operator; `{ group, when }` names the group (listed
  in `groups`) and decides per case or call. `when` gets the answers (agent and
  fields; the agent's needs a schema) or the tool's input, runs synchronously,
  and counts as applying if it throws. A field approval on a group or list
  covers everything under it.
- **Protocol.** The Worker also answers `POST /schema/evaluate` and
  `POST /schema/options`; the manifest carries the static tree.

Unlike the rest of this repository, which is under the Elastic License 2.0,
everything in this directory is MIT licensed (see LICENSE).
