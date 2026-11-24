# 08. The GitHub App: push builds (build step 2)

Scope: build step 2. Deploys arrive two ways (spec, 2026-11-22): `preprocess deploy` from the CLI or the GitHub Action, and a GitHub App that builds on every push to a connected repository. This doc covers the App. Engineering decided where builds run: in a Cloudflare Sandbox (a Container) that the API starts for each push.

## Decision

- **An organization installs the App, then links one repository to each agent.** A link names the repository, an optional branch (unset means every branch), the agent's directory inside the repository, and its entry module. Its agent is named by slug, as with `preprocess deploy`, so the first build creates the agent. One repository can feed several agents; each agent has one link.
- **Every push to a linked repository builds and deploys.** The deploy goes through `deploy()` in `apps/api/src/deploy.ts`, the same function `POST …/deployments` calls, with `source: "github"`. Production or preview follows the agent's production branch exactly as it does for the CLI.
- **The build runs in a fresh container per build** (`apps/builder`, image `apps/builder/Dockerfile`). It installs with the repository's own lockfile and bundles with the CLI's `bundle()`, copied into the image the way the GitHub Action copies it. A `preprocess.config.json` beside the agent is applied the same way as for the CLI.
- **The installation token never enters the sandbox.** The API mints a token for the one repository with `contents: read`, fetches that commit's tarball with it, and revokes it as soon as the build finishes. The sandbox receives only the tarball on stdin. The token is held in memory only: it is never written to Postgres, a log line, the build record or the audit chain.
- **Builds run one at a time per agent and branch, and the newest push wins.** A `BuildQueue` Durable Object per organization, agent and branch holds at most one waiting build. A newer push supersedes the waiting one and stops the running one, whose result is discarded.
- **Each build has a wall-clock limit**, `GITHUB_BUILD_TIMEOUT_SECONDS` (default 600). `timeout` inside the sandbox enforces it, and the queue gives up 30 seconds later if the sandbox never answers.

## Flow

```mermaid
sequenceDiagram
  participant GH as GitHub
  participant API as API Worker
  participant Q as BuildQueue DO (org, agent, branch)
  participant B as Builder (Container)
  GH->>API: push webhook (X-Hub-Signature-256)
  API->>API: tx: github_builds rows (queued) per matching link
  API->>Q: push(build)
  Q->>API: mint token for the one repository (contents: read)
  API->>GH: GET tarball at the commit (token)
  Q->>B: build(tarball, directory, entry, timeout)
  B->>B: install by lockfile; bundle() with the CLI's code
  B-->>Q: bundle and log
  Q->>GH: revoke the token
  Q->>API: deploy(bundle, {branch, commit}, source: github)
```

## Package managers

The nearest lockfile above the agent's directory, up to the repository root, decides how dependencies are installed:

| Lockfile | Command |
| --- | --- |
| `pnpm-lock.yaml` | `corepack pnpm install --frozen-lockfile` |
| `yarn.lock` with `.yarnrc.yml` | `corepack yarn install --immutable` |
| `yarn.lock` (Yarn 1) | `corepack yarn install --frozen-lockfile` |
| `package-lock.json` or `npm-shrinkwrap.json` | `npm ci` |

Corepack respects a `packageManager` field. A build with no lockfile fails and says to commit one. Bun lockfiles are refused for now.

## Installing

`POST /v1/orgs/{org}/github/install` (Admin or Owner) returns the App's install link with a signed state (organization, person, ten minutes). The App requests user authorization during installation, so GitHub sends the person to `GET /v1/github/setup` with the installation id, the state and an OAuth code. The API exchanges the code and checks `GET /user/installations` includes that installation before linking it, so nobody can link another account's installation by guessing its id. An installation belongs to one organization.

The `installation` webhook (deleted, suspend, unsuspend) and `installation_repositories` keep the tables in step.

## API

| Route | Who |
| --- | --- |
| `POST /v1/github/webhook` | GitHub (signature) |
| `GET /v1/github/setup` | GitHub's redirect of the installing person |
| `POST /v1/orgs/{org}/github/install` | Admin or Owner |
| `GET /v1/orgs/{org}/github/repositories` | Members |
| `PUT`, `DELETE /v1/orgs/{org}/agents/{agent}/github` | Admin or Owner |
| `GET /v1/orgs/{org}/agents/{agent}/builds[/{build}]` | Members; one build includes the tail of its log |

## Tables

`github_installations`, `github_repositories`, `github_links` and `github_builds` (migration 0010), tenant tables with RLS like every other. A build's `log` keeps the last 64 KB of the sandbox's output.

## Local development

`pnpm dev` runs the build image under the local Docker (`apps/builder/local/server.ts`) behind the same `Builder` entrypoint, because wrangler's local container runtime needs the `xt_socket` iptables module, which some hosts' kernels lack. `scripts/github-stub.ts` stands in for GitHub: the App's endpoints, tarballs from local checkouts, the install redirect, and signed push webhooks (`POST /__push?repo=…&branch=…`). `pnpm dev` generates the App's private key, webhook secret and client secret into `apps/api/.dev.vars`.

## Alternatives considered

- **Cloning inside the sandbox with the token.** Rejected: install scripts and dependencies run in the sandbox and could read the token from `.git/config` or the environment.
- **Running the build in the Worker.** Rejected: installs need a real package manager and a filesystem.
- **Queueing builds on a Queue.** Rejected: a Durable Object per agent and branch gives serialization and "newest wins" directly, and it can stop the running build.

## Still to verify

- A live container build on Cloudflare. Here, builds were verified under plain Docker (the same image and `build.sh`), because this machine's kernel cannot run wrangler's container sidecar.
- Registering the real App (Chip). The manifest is in Engineering's drive at `handoffs/PLAT-39/github-app.md`.
