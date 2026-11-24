// `pnpm dev`'s stand-in for Cloudflare Containers: runs the build image
// (apps/builder/Dockerfile) under the local Docker, one container per build,
// for the builder Worker's LOCAL_DOCKER_BUILDER. Listens on 127.0.0.1 only.

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
const image = "preprocess-builder:dev";
const port = Number(process.env.BUILDER_PORT ?? 8789);

const built = spawnSync(
  "docker",
  ["build", "--quiet", "-t", image, "-f", "apps/builder/Dockerfile", "."],
  { cwd: root, stdio: ["ignore", "ignore", "inherit"] },
);
if (built.status !== 0)
  console.error(
    "builder: could not build the image with Docker; GitHub builds will fail until Docker runs.",
  );

const name = (id: string) => `preprocess-build-${id.replace(/[^\w.-]/g, "")}`;

createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://builder");
  if (request.method === "DELETE" && url.pathname.startsWith("/build/")) {
    spawnSync("docker", ["rm", "--force", name(url.pathname.slice(7))]);
    response.writeHead(204).end();
    return;
  }
  if (request.method !== "POST" || url.pathname !== "/build") {
    response.writeHead(404).end();
    return;
  }
  const param = (key: string) => url.searchParams.get(key) ?? "";
  const docker = spawn(
    "docker",
    [
      "run",
      "--rm",
      "--interactive",
      "--name",
      name(param("id")),
      "--memory",
      "2g",
      "--env",
      `DIRECTORY=${param("directory")}`,
      "--env",
      `ENTRY=${param("entry")}`,
      "--env",
      `TIMEOUT=${param("timeout")}`,
      image,
      "/opt/preprocess/build.sh",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let output = "";
  docker.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
  docker.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
  request.pipe(docker.stdin);
  docker.on("close", (code) => {
    response
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ exitCode: code ?? 1, output }));
  });
}).listen(port, "127.0.0.1", () =>
  console.log(`builder: local Docker sandbox on http://127.0.0.1:${port}`),
);
