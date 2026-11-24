# @preprocess/cli

The `preprocess` command-line interface (mvp-surface.md). Build step 2 ships
`deploy`; the other commands follow.

## deploy

```sh
export PREPROCESS_API_URL=https://api.preprocess.localhost  # your Preprocess API
export PREPROCESS_ORG=org_…
export PREPROCESS_API_KEY=pp_…                               # an organization API key
preprocess deploy [entry]                                    # entry defaults to src/index.ts
```

It bundles the agent (an `agent()` from `@preprocess/sdk` as the module's
default export) into one ES module with esbuild, and uploads it with the git
branch and commit of the checkout. The agent's name is `--agent`, or the
`package.json` name without its scope. A deploy from the agent's production
branch (`main` unless changed) is promoted once every secret it declares is
granted; until then it waits, and the command says which grants are missing. Any
other branch makes a preview.

The API key is read only from `PREPROCESS_API_KEY`, so it never lands in shell
history.

## GitHub Action

`action.yml` runs the same command in GitHub Actions. Install the agent
project's dependencies first; the Action bundles from them.

```yaml
on: push
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm ci
      - uses: preprocess/preprocess/packages/cli@main
        with:
          api-url: ${{ vars.PREPROCESS_API_URL }}
          org: ${{ vars.PREPROCESS_ORG }}
          api-key: ${{ secrets.PREPROCESS_API_KEY }}
```

Pushes to the agent's production branch deploy to production once its grants are
in place; pull requests and other branches make previews, named after the pull
request's head branch.

Unlike the rest of this repository, which is under the Elastic License 2.0,
everything in this directory is MIT licensed (see LICENSE).
