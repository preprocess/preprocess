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

Unlike the rest of this repository, which is under the Elastic License 2.0,
everything in this directory is MIT licensed (see LICENSE).
