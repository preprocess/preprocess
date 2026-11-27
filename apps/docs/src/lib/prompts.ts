// Prompts the guides hand to a coding agent. {api} and {origin} become this
// deployment's URLs. They live here rather than in the MDX so a formatter
// cannot reflow them.
export const agentPrompts = {
  sdk: {
    title: "Write a Preprocess agent",
    prompt: `# Write and deploy a Preprocess agent

Add a Preprocess agent to this project with @preprocess/sdk and deploy it with the Preprocess CLI.

## Set up

1. Install the SDK and the CLI: \`npm install @preprocess/sdk zod\` and \`npm install --save-dev @preprocess/cli\`.
2. Ask me for my organization id and an organization API key. Read them from PREPROCESS_ORG and PREPROCESS_API_KEY in the environment, and never write the key to a file. Set PREPROCESS_API_URL to {origin}.

## Write the agent

3. Create src/index.ts. Its default export is \`agent({ instructions, model, tools })\` from @preprocess/sdk.
4. Give each tool a \`description\` the model reads, a Zod \`input\` schema and a \`run\` function. Set \`sideEffects: true\` on a tool that changes something outside Preprocess, and \`approval\` on a tool a person must approve before it runs.
5. List the organization secrets the code needs in \`secrets\` and read them from \`env\` in \`run\`. Never hard-code a secret, and return only what the model needs.
6. If each case produces structured answers, declare them in \`schema\` with the builders exported as \`schema\`.

## Deploy

7. Run \`npx preprocess deploy\`, fix any warnings it prints, and tell me the new deployment's status.`,
  },
  cli: {
    title: "Deploy with the Preprocess CLI",
    prompt: `# Deploy a Preprocess agent with the CLI

Set up the Preprocess CLI in this project and deploy the agent.

1. Install it: \`npm install --save-dev @preprocess/cli\`.
2. Run \`npx preprocess login --api {origin}\` and ask me to approve the code it prints in my browser. In CI, read the organization id and an organization API key from PREPROCESS_ORG and PREPROCESS_API_KEY instead, with PREPROCESS_API_URL set to {origin}, and never put the key in a file, a command line or CI logs.
3. Run \`npx preprocess config pull\` and \`npx preprocess groups pull\` so preprocess.config.json keeps the settings people changed in the app.
4. Run \`npx preprocess deploy\` and tell me the new deployment's status and any warnings.`,
  },
  mcp: {
    title: "Connect to Preprocess over MCP",
    prompt: `# Connect to Preprocess over MCP

Connect this MCP client to my Preprocess organization.

1. Ask me for my organization id and an organization API key. An Owner or Admin creates the key in Developers → Keys & webhooks. A signed-in session doesn't work.
2. Add a remote MCP server named "preprocess" that uses the streamable HTTP transport at {api}/orgs/<org id>/mcp and sends \`Authorization: Bearer <API key>\` on every request. Keep the key in an environment variable, not in a committed file.
3. List the server's tools to check the connection, then list my agents.`,
  },
} as const;
