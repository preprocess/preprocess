---
title: Connect MCP servers to your agents
description:
  Register remote MCP servers with OAuth or unauthenticated access and grant
  them to agents.
updated: 2026-11-28
---

Preprocess supports Model Context Protocol (MCP) in two directions: your agents
can call **external remote MCP servers**, and external AI clients can call
**Preprocess's own MCP server** to create and inspect cases.

## Connect an outbound remote MCP server

Owners and Admins register remote MCP servers at the organization level, then
grant them per agent. Connections belong to the organization—there are no
per-user tokens—and credentials are encrypted at rest and never exposed to the
model or logs.

1. Open **Settings → Developers → Integrations** (or call
   `PUT /v1/orgs/{org}/mcp-servers/{server}`).
2. Add a remote server with a slug (for example `crm`) and its `https://` URL.
3. Preprocess probes the server automatically:
   - **Transport:** tries Streamable HTTP (`2025-06-18`) first and falls back to
     legacy HTTP+SSE if needed.
   - **Authentication:** detects whether the server is unauthenticated or
     requires OAuth, then walks you through the OAuth sign-in flow if required.
4. Declare the server slug in your agent code (`mcp: ["crm"]`).
5. Grant the server to the agent—either directly on the agent or by approving
   the deployment's guardrail request in **Settings → Governance → Guardrails**.

Bundled MCP servers packaged inside an agent deployment are coming soon. Today,
outbound connections support remote `https://` MCP servers.

### Timeouts and re-authentication

- Every call to a remote MCP server times out after **60 seconds**.
- If an OAuth token expires and can't be refreshed automatically, the connection
  status changes to **`needs_reauth`** and an audit event is recorded. Open
  **Settings → Developers → Integrations** and reconnect the server.

## Connect external AI clients to Preprocess

External MCP clients (such as coding agents or desktop assistants) can connect
to your organization's Preprocess MCP server to start cases, read answers, list
groups and pause or resume schedules. Authenticate with a user session or an
organization API key.

## Related docs

- [Secrets and MCP connections](https://docs.preprocess.com/concepts/secrets-and-mcp)
- [Using MCP servers in the SDK](https://docs.preprocess.com/sdk/mcp-servers)
- [Preprocess MCP server](https://docs.preprocess.com/mcp)
