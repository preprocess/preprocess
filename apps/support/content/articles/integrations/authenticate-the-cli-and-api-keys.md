---
title: Authenticate the CLI and manage API keys
description:
  Sign in to the Preprocess CLI interactively and create organization API keys
  for CI and backend calls.
updated: 2026-11-28
---

Use **interactive CLI sign-in** on your own computer, and **organization API
keys** for CI pipelines, backend services and automated scripts.

## Sign in to the CLI on your machine

1. Run:

```sh
npx preprocess login --api https://app.preprocess.com
```

2. The CLI prints a verification code and opens your browser. Confirm that the
   code matches and approve the sign-in.
3. Credentials save to `~/.config/preprocess/credentials.json` (or under
   `$XDG_CONFIG_HOME`).

Commands act as your user with your organization role and group memberships.
Deploying, promoting and rolling back require **Owner**, **Admin** or the
**Developers** group. If you belong to multiple organizations, pass
`--org <id-or-slug>` or set `PREPROCESS_ORG`.

`@preprocess/cli` npm publishing is coming soon—today, run the CLI from a
checkout of `preprocess/preprocess`.

## Create and manage organization API keys

Organization API keys belong to the organization rather than to an individual
user. Only **Owners** and **Admins** can create or revoke them.

1. Open **Settings → Developers → API keys & webhooks**.
2. Select **Create API key**, give it a descriptive name and create it.
3. Copy the key immediately—it is shown once and can't be viewed again.

To revoke a key, open **Settings → Developers → API keys & webhooks** and revoke
it. Revocation takes effect immediately.

### Using API keys in CI and HTTP calls

- **CLI / CI:** set `PREPROCESS_API_URL`, `PREPROCESS_ORG` and
  `PREPROCESS_API_KEY` as environment variables or CI secrets.
- **REST API:** send `Authorization: Bearer <your-api-key>` to
  `/v1/orgs/{org}/...` endpoints.

## What API keys can and can't do

Organization API keys act with **Admin** rights across `/v1`, the CLI and the
organization MCP server—so CI can deploy and promote agents, and services can
create, read, edit and rerun cases.

For governance, **API keys cannot**:

- approve tool calls, field values or case completions;
- accept or dismiss proposed memories;
- approve or reject guardrail requests.

Those decisions always require a signed-in human.

## Related docs

- [CLI overview](https://docs.preprocess.com/cli)
- [CLI command reference](https://docs.preprocess.com/cli/reference)
- [API overview](https://docs.preprocess.com/api)
