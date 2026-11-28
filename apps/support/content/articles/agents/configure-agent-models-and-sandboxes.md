---
title: Configure models, sandboxes and secrets
description:
  Choose an agent model, enable isolated Linux sandboxes and grant encrypted
  organization secrets.
updated: 2026-11-28
---

Agents declare their model, optional sandbox and required secrets in code.
Organization Owners and Admins control which models, sandbox sizes and secrets
each agent is allowed to use.

## Choose an agent model

Set `model` (and optional `reasoning`: `low`, `medium` or `high`, defaulting to
`medium`) in `agent()`. Every model runs with a 262,144-token context window and
8,192 max output tokens.

| Model ID                   | Best for                                                    |
| -------------------------- | ----------------------------------------------------------- |
| `deepseek-v4.1-flash`      | Default model when none is set; balanced speed and quality. |
| `deepseek-v4.1-flash-fast` | Lower-latency capacity for time-sensitive cases.            |
| `kimi-k3.1-pro`            | Heavier reasoning on complex multi-step cases.              |
| `qwen3.8-27b`              | Lightweight tasks and self-hosted deployments.              |

Owners and Admins can inspect or restrict allowed models in **Settings →
Developers → Models** and **Settings → Governance → Guardrails → Models**.

## Enable a case sandbox

Add a `sandbox` block in agent code when a case needs shell commands, Python
data libraries or custom binaries. Enabling a sandbox gives the agent
`sandbox_exec`, `sandbox_read_file` and `sandbox_write_file` tools.

- **Sizes (`size` is required):** `small` (½ vCPU, 4 GiB RAM, 8 GB disk),
  `medium` (1 vCPU, 6 GiB RAM, 12 GB disk) or `large` (4 vCPU, 12 GiB RAM, 20 GB
  disk). On Preprocess Cloud, sandboxes bill per second while awake.
- **Presets (`preset`):** `standard` (Debian with bash, curl and git), `node`
  (Node.js 24 and npm), `python` (Python 3 and pip) or `python-data` (Python
  plus pandas, NumPy, Polars, DuckDB, PyArrow, SciPy, Matplotlib and openpyxl).
- **Packages:** install up to 50 `apt`, `pip` and `npm` packages at sandbox
  start.
- **Custom environments (`sandbox.setup`):** on Team and Enterprise plans,
  prebuild a custom environment once at deploy time so cases don't reinstall
  packages on every start.

Sandboxes start lazily on the first sandbox tool call, sleep after
`idleTimeoutMinutes` (default 5, max 60) and last at most 2 hours per start.
**Container filesystems reset when a sandbox sleeps**, so save durable outputs
to the case's output schema or external systems.

Owners and Admins can cap the maximum sandbox size in **Settings → Governance →
Guardrails → Sandbox size**.

## Create and grant secrets

Secrets are write-only values (up to 5,120 characters) encrypted per
organization and injected only into your agent's tool code—never into model
prompts, case threads or logs.

1. Open **Settings → Developers → Secrets** and add a secret. Names must use
   uppercase letters, digits and underscores (for example `ERP_API_KEY`) and
   can't be `MCP`, `MODELS` or start with `PREPROCESS_`.
2. Declare the secret name in your agent's `secrets` array.
3. Grant the secret to the agent in **Agents → [your agent] → Secrets** (or
   approve the deployment's guardrail request in **Settings → Governance →
   Guardrails**).

Rotating a secret takes effect on the next tool call without redeploying the
agent.

## Related docs

- [Models and OCR](https://docs.preprocess.com/concepts/models-and-ocr)
- [Sandbox SDK reference](https://docs.preprocess.com/sdk/sandbox)
- [Secrets and MCP connections](https://docs.preprocess.com/concepts/secrets-and-mcp)
