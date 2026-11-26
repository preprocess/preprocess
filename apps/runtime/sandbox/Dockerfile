# Case sandbox images (spec 3). One file builds every preset: PRESET names the
# final stage, and each preset builds on "standard". infra/alchemy.run.ts
# builds one image per preset. The agent's own packages install over the
# preset when its sandbox starts (apps/runtime/src/sandbox.ts).
#
# sandbox-shim is the helper @cloudflare/sandbox's Files runs; its tag must
# match the package version in apps/runtime/package.json.

ARG PRESET=standard

FROM docker.io/cloudflare/sandbox:1.0.3 AS shim

FROM debian:trixie-slim AS standard
COPY --from=shim /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash ca-certificates curl git jq less procps unzip xz-utils zip \
    attr e2fsprogs fuse-overlayfs fuse3 squashfs-tools squashfuse \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --uid 1000 --home-dir /workspace --create-home --shell /bin/bash sandbox
# Custom environments (layer/): build.sh captures one, mount.sh lays it over
# the preset at start.
COPY layer/ /opt/preprocess/layer/
WORKDIR /workspace
CMD ["sleep", "infinity"]

FROM docker.io/library/node:24-trixie-slim AS node-dist

FROM standard AS node
COPY --from=node-dist /usr/local/bin/node /usr/local/bin/node
COPY --from=node-dist /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
  && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

FROM standard AS python
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m venv /opt/venv \
  && chown -R sandbox:sandbox /opt/venv
ENV PATH=/opt/venv/bin:$PATH VIRTUAL_ENV=/opt/venv

FROM python AS python-data
USER sandbox
RUN pip install --no-cache-dir \
    duckdb==1.4.2 \
    matplotlib==3.10.7 \
    numpy==2.3.5 \
    openpyxl==3.1.5 \
    pandas==2.3.3 \
    polars==1.35.2 \
    pyarrow==22.0.0 \
    scipy==1.16.3
USER root

FROM ${PRESET}
