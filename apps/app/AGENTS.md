# Product application guidance

TanStack Start product application deployed as a Cloudflare Worker.

Auth is Better Auth, served by the API Worker. The app forwards `/api/auth/*`
and `/v1/*` to it through the `API` service binding, so session cookies stay
first-party. Keep the app fail-closed: the root loader redirects people without
a session to `/sign-in` and people without an organization to `/onboarding`. The
only public routes are sign-in, sign-up, `/invitations/$id` and `/api/auth/*`.

Reach the API only through `features/auth/client.ts` in the browser and
`server/api.server.ts` in server functions; never import API source into this
app. Shared components belong in `packages/ui` only after a real
cross-application need exists.

`/inbox` is the notification inbox, `/cases` is the organization case list
across agents, and `/agents` lists the organization's agents from `/v1`. Each
agent has a management page at `/agents/$agentId`, addressed by slug, with the
section sidebar of spec 14a; its Cases section (`/agents/$agentId/cases`) lists
the agent's cases, and `/agents/$agentId/cases/$caseId` is the case room; the
old `/cases/$agentId/$caseId` redirects there. Sections without a real page yet
are placeholders in `features/agents/agent-knowledge.tsx`. Settings
(`/settings/*`) share one grouped section sidebar
(`features/settings/settings-nav.tsx`): Account, Organization, Developers (API
keys and webhooks, GitHub, integrations, secrets, network rules, sandboxes,
OpenTelemetry export) and Governance. The old `/developers/*` settings URLs
redirect there; `/developers/observability` stays a main-sidebar page. Scrolling
panes use `ScrollArea` with `scroll-fade`.

Agents inherit the organization's secrets and network rules. An agent may
override a network rule for itself, and the UI marks it "Overrides
organization"; it may never override an organization secret.

## Seeded scenarios

The inbox reads the API (`inbox-api.ts`) in its `live` state and in every build
outside dev. The case list and the case room's work (answers, checks, approvals,
thread) read the API through server functions in
`features/agent-cases/case-api.ts` when their scenario is `live`, the default in
development and the only state outside it; every other state of those surfaces
is seeded. In development, the inbox's other states, the seeded case states, and
the seeded case room chat load seeded data: `inbox-seed.ts` (reads stick in
memory until restart), `case-seed.ts`, `agent-seed.ts` and `agent-store.ts`,
`platform-store.ts`, `case-room-transcripts.ts`, and the case room's Input files
(`flue-lab-input-samples.ts`, one of each viewer's formats). Builds outside dev
serve none.

Each of those three surfaces is a small set of named states, so every UI state
is reachable locally without other services:

- `src/scenarios/scenarios.ts` is the registry: each surface lists its states
  (`inbox: seeded | empty | all-read | …`). Add a state there, then handle it in
  the surface's data function (`inbox-seed.ts`, `list-org-cases.ts`,
  `case-room-data.ts`, `case-room-transcripts.ts`). The `switch` is exhaustive,
  so TypeScript points at every place to update.
- The selection lives in the `preprocess-scenario` cookie
  (`inbox:empty,cases:few`). `currentScenario()` reads it on the server render
  and in the browser, so both agree.
- In dev, the **States** button (bottom right) switches states and resets
  in-memory writes such as inbox reads.
- Scripts and agents can switch without the UI:
  `GET /api/dev/scenario?set=inbox:empty&return=/inbox` (303 + cookie), or
  `?reset=1`. The route 404s outside dev.

When a real backend lands, replace the surface's data function, not the UI.
