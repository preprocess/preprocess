# Local dispatch namespace

Cloudflare's local runtime cannot emulate a Workers for Platforms dispatch
namespace, so this Worker stands in for one in `pnpm dev` and in tests. It is
never deployed.

- The deploy path uploads scripts and sets their secrets through the `Namespace`
  entrypoint, with the same script metadata (main module, modules, `secret_text`
  and `plain_text` bindings, tags) the Cloudflare API takes. Scripts are kept in
  a local R2 bucket.
- The runtime dispatches through `fetch`, naming the script and the outbound
  parameters in two headers only bound Workers can send. The script runs in its
  own isolate through the Worker Loader, with only its own bindings, and every
  `fetch()` it makes goes through the outbound Worker's network rules, as
  Workers for Platforms does with an outbound Worker.
