// The command's help text, also rendered as the docs site's CLI reference.

export const usage = `Usage: preprocess deploy [entry] [--agent <name>] [--org <id>] [--api <url>]
       preprocess config pull [entry] [--agent <name>] [--org <id>] [--api <url>]
       preprocess groups pull [entry] [--org <id>] [--api <url>]
       preprocess logs [--agent <id>] [--case <id>] [--deployment <id>]
                       [--level <level>] [--search <text>] [--limit <n>]
       preprocess evals list [--agent <name>]
       preprocess evals run <suite> [--deployment <id>] [--model <id>]...
       preprocess install [--version <tag> | --source <dir>] [--stage <name>]
                          [--env-file <path>]... [--plan]
       preprocess github-app --app-url <url> [--name <name>] [--owner <org>]
                             [--out <path>]

  deploy       bundle and deploy the agent
  config pull  write the agent's dashboard overrides into preprocess.config.json
  groups pull  write the organization's groups into preprocess.config.json
  logs         print run logs, newest first: a case's, or the agent's,
               deployment's or organization's (Developers and Admins)
  evals list   list the agent's eval suites
  evals run    run a suite against a deployment (production by default),
               one run per --model, and wait for the results
  install      install or upgrade Preprocess in your own Cloudflare account,
               from a release (the latest by default) or a checkout, as the
               self-hosted stage --stage (default: selfhost); --plan only
               prints what would change. Reads CLOUDFLARE_API_TOKEN,
               CLOUDFLARE_ACCOUNT_ID, DATABASE_URL, EMAIL_FROM,
               MODEL_SERVICE_URL and MODEL_SERVICE_KEY from the environment
               or --env-file; see infra/README.md for the optional ones
  github-app   register your install's own GitHub App on GitHub and write its
               credentials to --out (default: .env.github-app)

  entry     the agent's module (default: src/index.ts)
  --agent   the agent's name (default: package.json name, without its scope)
  --org     organization id (default: PREPROCESS_ORG)
  --api     API origin (default: PREPROCESS_API_URL)

PREPROCESS_API_KEY holds the organization API key.`;
