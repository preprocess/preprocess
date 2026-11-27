// `preprocess init`: a new agent project, ready for `preprocess deploy`. It
// writes only files that are not there yet, so it never overwrites work.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

// The SDK and CLI releases a new project starts on.
export const SDK_RANGE = "^0.1.0";
export const CLI_RANGE = "^0.1.0";

const AGENT = `import { agent, tool } from "@preprocess/sdk";
import { z } from "zod";

export default agent({
  instructions: "You answer questions about orders. Be brief.",
  tools: {
    lookup_order: tool({
      description: "Look up an order by its number",
      input: z.object({ order: z.string() }),
      run: ({ order }) => ({ order, status: "shipped" }),
    }),
  },
});
`;

const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

export const init = (options: { dir: string; name?: string | undefined }) => {
  const root = path.resolve(options.dir);
  const name = (options.name ?? path.basename(root))
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!name) return { code: 1, out: "Give the agent a name with --name." };

  const files: Record<string, string> = {
    "package.json": json({
      name,
      private: true,
      type: "module",
      scripts: {
        deploy: "preprocess deploy",
        typecheck: "tsc --noEmit",
      },
      dependencies: { "@preprocess/sdk": SDK_RANGE, zod: "^4.0.0" },
      devDependencies: {
        "@preprocess/cli": CLI_RANGE,
        typescript: "^5.9.3",
      },
    }),
    "tsconfig.json": json({
      compilerOptions: {
        target: "ES2023",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
      include: ["src"],
    }),
    "src/index.ts": AGENT,
    ".gitignore": "node_modules\n",
  };
  const existing = Object.keys(files).filter((file) =>
    existsSync(path.join(root, file)),
  );
  if (existing.length)
    return {
      code: 1,
      out: `${root} already has ${existing.join(", ")}. Run preprocess init in an empty directory.`,
    };
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
  const relative = path.relative(process.cwd(), root);
  return {
    code: 0,
    out: [
      `Created agent ${name} in ${relative || "."}.`,
      "Next:",
      ...(relative ? [`  cd ${relative}`] : []),
      "  npm install",
      "  preprocess deploy",
    ].join("\n"),
  };
};
