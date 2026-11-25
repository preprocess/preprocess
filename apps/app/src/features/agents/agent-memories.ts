/**
 * The seeded case chat's memory proposal. Approving it only resolves in
 * development; the real flow is the memory API (spec 10), which the case
 * room's Review tab will use.
 */
export function approveAgentMemory(
  agentId: string,
  text: string,
  caseLabel: string,
): Promise<{ agentId: string; text: string; from: string }> {
  return Promise.resolve({ agentId, text, from: caseLabel });
}
