# The GitHub build sandbox (docs/design/08-github-app.md). Built from the
# repository root so it can carry the CLI's bundle(). Production runs it as a
# Cloudflare Container; `pnpm dev` runs it under the local Docker.
FROM node:24-trixie-slim

RUN apt-get update \
	&& apt-get install --yes --no-install-recommends ca-certificates git \
	&& rm -rf /var/lib/apt/lists/*

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# The CLI's source and its one dependency, as the GitHub Action installs it.
COPY packages/cli/package.json /tmp/cli-package.json
WORKDIR /opt/preprocess/cli
RUN echo '{"type":"module"}' > package.json \
	&& npm install --no-audit --no-fund \
	"esbuild@$(node -p "require('/tmp/cli-package.json').dependencies.esbuild")"
COPY packages/cli/src ./src
COPY apps/builder/image/build.sh apps/builder/image/bundle.ts /opt/preprocess/
RUN chmod +x /opt/preprocess/build.sh \
	&& echo '{"type":"module"}' > /opt/preprocess/package.json \
	&& mkdir /workspace

WORKDIR /workspace
# Cloudflare's local container runtime requires an exposed port.
EXPOSE 8080
CMD ["sleep", "infinity"]
