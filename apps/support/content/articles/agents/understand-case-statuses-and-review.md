---
title: Understand case statuses and human review
description:
  Learn what each case status means and how operators review answers, handle
  approvals and rerun cases.
updated: 2026-11-28
---

A **case** is one bounded job for one agent, with one conversation thread, one
set of structured answers and one lifecycle status.

## Case statuses

| Status      | What it means                                                                                                                          |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `queued`    | Accepted by the API and waiting to start execution.                                                                                    |
| `running`   | The agent is actively running model turns or calling tools.                                                                            |
| `waiting`   | The run paused for human input: a team wait (`ctx.waitOn`), a failing schema check, an unconfirmed review field or a pending approval. |
| `completed` | Finished: schema checks pass, the success condition is met and no approvals or waits remain.                                           |
| `failed`    | The run hit an unrecoverable error (such as a timeout or tool failure).                                                                |
| `halted`    | Stopped before a metered call because the organization ran out of credits or reached its monthly spending limit.                       |
| `cancelled` | Permanently stopped by an operator, developer or API key. Cancelled cases can't be rerun.                                              |

## Review vs. approval

Both live in the case room's **Review** tab, but they serve different purposes:

- **Review** lets any operator of the agent check and correct structured
  answers.
- **Approval** is a hard gate declared in agent code—a named group (or any
  operator) must explicitly approve before a tool runs, a field value stands or
  the case completes. API keys can't approve; a signed-in human must decide.

## Reviewing answers in the case room

Open a case from **Inbox**, **Cases** or **Agents → [your agent] → Cases**, then
open the **Review** tab. Each visible field shows its value, status (`agent`,
`confirmed`, `stale` or empty) and any failing check.

- **Confirm** an agent's answer to mark it `confirmed`.
- **Edit** an answer to set the right value. Editing marks that field
  `confirmed` and marks dependent fields `stale` so downstream values don't
  silently go out of sync.
- **Accept or dismiss suggestions.** If you rerun a case, the agent never
  overwrites a `confirmed` human answer. When the agent arrives at a different
  value, it appears beside your answer as a suggestion until an operator accepts
  or dismisses it.

## Rerunning, completing and cancelling

- **Rerun** starts a new agent turn on the same pinned deployment (available
  from `waiting`, `completed`, `failed` or `halted`). The agent receives a
  summary of what changed—edited answers, stale fields, new thread messages and
  newly attached files.
- **Complete** finishes a waiting case manually. It enforces the same schema
  checks, success rules and approvals as the agent.
- **Cancel** permanently stops any non-completed case and sends no webhooks.

## Related docs

- [Cases](https://docs.preprocess.com/concepts/cases)
- [Review and approvals](https://docs.preprocess.com/concepts/review-and-approvals)
- [Output schema](https://docs.preprocess.com/concepts/output-schema)
