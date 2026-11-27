// The command's help text, also rendered as the docs site's CLI reference.

export const usage = `Usage: preprocess login [--api <url>] [--org <id>] [--no-browser]
       preprocess init [dir] [--name <name>]
       preprocess deploy [entry] [--agent <name>] [--org <id>] [--api <url>]
       preprocess promote <deployment> [--agent <name>]
       preprocess rollback [deployment] [--agent <name>]
       preprocess config pull [entry] [--agent <name>] [--org <id>] [--api <url>]
       preprocess groups pull [entry] [--org <id>] [--api <url>]
       preprocess cases create [--agent <name>] [--text <text>] [--file <path>]...
                               [--deployment <id>] [--idempotency-key <key>]
       preprocess logs [--agent <id>] [--case <id>] [--deployment <id>]
                       [--level <level>] [--search <text>] [--limit <n>]
       preprocess evals list [--agent <name>]
       preprocess evals run <suite> [--deployment <id>] [--model <id>]...
       preprocess install [--version <tag> | --source <dir>] [--stage <name>]
                          [--env-file <path>]... [--plan]
       preprocess github-app --app-url <url> [--name <name>] [--owner <org>]
                             [--out <path>]

  login        sign in through the browser: approve the printed code in the
               app, and the CLI saves that session for later commands; with
               one organization it is chosen, else pass --org
  init         create a new agent project in dir (default: the current
               directory) that preprocess deploy can deploy; never
               overwrites a file
  deploy       bundle and deploy the agent
  promote      serve a deployment from the production branch in production
  rollback     promote the deployment that served production before the
               current one, or the one named
  config pull  write the agent's dashboard overrides into preprocess.config.json
  groups pull  write the organization's groups into preprocess.config.json
  cases create start a case from text, files or both, on the production
               deployment unless --deployment names another; prints the case
               id and its status URL. A retry with the same --idempotency-key
               never starts a second case
  logs         print run logs, newest first: a case's, or the agent's,
               deployment's or organization's (Developers and Admins)
  evals list   list the agent's eval suites
  evals run    run a suite against a deployment (production by default),
               one run per --model, and wait for the results
  install      install or upgrade Preprocess in your own Cloudflare account,
               from a release (the latest by default) or a checkout, as the
               self-hosted stage --stage (default: selfhost); --plan only
               prints what would change. Reads CLOUDFLARE_API_TOKEN,
               CLOUDFLARE_ACCOUNT_ID, DATABASE_URL and EMAIL_FROM from the
               environment or --env-file; see infra/README.md for the
               optional ones, model provider keys included
  github-app   register your install's own GitHub App on GitHub and write its
               credentials to --out (default: .env.github-app)

  entry     the agent's module (default: src/index.ts)
  --agent   the agent's name (default: package.json name, without its scope)
  --org     organization id (default: PREPROCESS_ORG)
  --api     API origin (default: PREPROCESS_API_URL)

PREPROCESS_API_KEY holds an organization API key, for CI; without it, commands
use the session preprocess login saved for the same API.`;
