# Product application guidance

TanStack Start product application deployed as a Cloudflare Worker.

Auth is WorkOS AuthKit via `@workos/authkit-tanstack-react-start`. Keep the app
fail-closed: the root loader redirects unauthenticated users to
`/api/auth/sign-in`. Authenticated users without an organization are sent to
`/onboarding`. The only public AuthKit exceptions are `/api/auth/*`.

Consume backend contracts through an explicit client boundary; never import
private backend implementation modules into this app. Shared components belong
in `packages/ui` only after a real cross-application need exists.

`/inbox` is the notification inbox, `/cases` is the organization case list,
`/cases/$agentId/$caseId` is the case room, and `/agents` lists the agents with
their case stats. Each agent has a management page at `/agents/$agentId`
(overview, deployments with rollback, access, settings). Organization API keys,
integrations, webhooks, sandbox images, secrets, and network rules live under
Developers (`/developers/*`); audit log streaming is in organization settings'
Authentication tab. Scrolling panes use `ScrollArea` with `scroll-fade`.

Agents inherit the organization's secrets and network rules. An agent may
override a network rule for itself, and the UI marks it "Overrides
organization"; it may never override an organization secret.

## Seeded scenarios

There is no backend yet. In development, inbox, cases, and the case room chat
load seeded data: `inbox-seed.ts` (reads stick in memory until restart),
`case-seed.ts`, `agent-seed.ts` and `agent-store.ts`, `platform-store.ts`,
`case-room-transcripts.ts`, and the case room's Input files
(`flue-lab-input-samples.ts`, one of each viewer's formats). Builds outside dev
serve none.

Each of those three surfaces is a small set of named states, so every UI state
is reachable locally without other services:

- `src/scenarios/scenarios.ts` is the registry: each surface lists its states
  (`inbox: seeded | empty | all-read | …`). Add a state there, then handle it in
  the surface's data function (`inbox-seed.ts`, `list-org-cases.ts`,
  `case-room-transcripts.ts`). The `switch` is exhaustive, so TypeScript points
  at every place to update.
- The selection lives in the `preprocess-scenario` cookie
  (`inbox:empty,cases:few`). `currentScenario()` reads it on the server render
  and in the browser, so both agree.
- In dev, the **States** button (bottom right) switches states and resets
  in-memory writes such as inbox reads.
- Scripts and agents can switch without the UI:
  `GET /api/dev/scenario?set=inbox:empty&return=/inbox` (303 + cookie), or
  `?reset=1`. The route 404s outside dev.

When a real backend lands, replace the surface's data function, not the UI.
