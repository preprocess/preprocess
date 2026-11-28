---
title: Troubleshoot failed deployments and cases
description:
  Diagnose deployments stuck in waiting, build errors, failed cases, halted runs
  and 402 refusals.
updated: 2026-11-28
---

Use this guide to diagnose the most common deployment and case errors and get
your agent running again.

## Deployment problems

### Deployment is stuck in `waiting`

A deployment enters `waiting` when the agent declares something your
organization hasn't approved yet—a secret, an MCP server, an outbound network
host, a group grant or a sandbox size above your organization's cap.

1. Ask an **Owner** or **Admin** to open **Settings → Governance → Guardrails**.
2. Review and approve the pending guardrail request.
3. Once approved, a production deployment promotes automatically.

### Deploy fails with an unknown group error

If your agent code references a group slug that doesn't exist in your
organization, the deploy fails immediately before storing anything. Create the
group in **Settings → Organization → Groups**, run `npx preprocess groups pull`
to sync your local `preprocess.config.json`, then redeploy.

### GitHub build fails

- **Missing lockfile:** GitHub builds require a committed lockfile
  (`pnpm-lock.yaml`, `yarn.lock`, `package-lock.json` or `npm-shrinkwrap.json`).
  Commit your lockfile and push again.
- **Custom sandbox setup failed:** check the build log in **Agents → [your
  agent] → Deployments** (or your CLI output) to see which command in
  `sandbox.setup` exited non-zero.

## Case problems

### Case creation returns HTTP `402`

On Preprocess Cloud, `POST /v1/orgs/{org}/cases` returns `402` when billing
blocks new cases:

| Error                    | Cause and fix                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `plan_required`          | No payment method on file. An Owner must add a card in **Settings → Organization → Billing**.                                                                |
| `credit_exhausted`       | Your credit balance is empty or you reached the Free plan's 1,000 monthly cases. Top up credits or upgrade to Team in **Settings → Organization → Billing**. |
| `spending_limit_reached` | Usage hit your monthly spending limit. An Owner or Admin can raise or remove it in **Settings → Governance → Guardrails → Spending limit**.                  |

### Case is `halted`

A running case transitions to `halted` when your organization runs out of
credits or reaches its monthly spending limit mid-run. All answers and messages
produced so far are preserved.

1. Top up credits in **Settings → Organization → Billing** or raise the spending
   limit in **Settings → Governance → Guardrails**.
2. Open the case and select **Rerun**. Halted cases never resume on their own.

### Case is `failed`

Inspect the case's run logs in the case room or from the CLI:

```sh
npx preprocess logs --case <case-id> --level error
```

Common causes:

- **`blocked_by_network_rules` (HTTP 403):** your agent or sandbox tried to
  reach a host not in its `network` allowlist or blocked by organization
  guardrails. Add the host in agent code and approve it in **Settings →
  Governance → Guardrails → Network**.
- **Timeout (`timeoutSeconds`):** a case or `sandbox_exec` call exceeded its
  timeout. Check for hanging external requests or long-running scripts, then
  retry with **Rerun**.
- **MCP `needs_reauth`:** an OAuth token for an external MCP server expired and
  couldn't refresh. Reconnect it in **Settings → Developers → Integrations**.
- **`model_unavailable`:** on self-hosted installs, verify your model endpoint
  or provider key configuration.

## Related docs

- [Logs and evals in the CLI](https://docs.preprocess.com/cli/logs-and-evals)
- [Logs and audit trail](https://docs.preprocess.com/concepts/logs-and-audit)
- [Configuration and guardrails](https://docs.preprocess.com/concepts/configuration-and-guardrails)
