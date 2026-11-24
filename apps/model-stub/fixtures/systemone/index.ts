import acmeVendor from "./acme-vendor.json";

// Fixed answers for seeded scenarios. A fixture applies when a question has
// its name and type, the rendered state contains stateIncludes (any case), and
// for a choice, the option is offered. The fixed option or level gets
// `probability` and the rest share what is left by their lexical score.
export type SystemOneFixture = {
  description: string;
  question: string;
  stateIncludes: string;
  answer:
    | { type: "choice"; choice: string; probability: number }
    | { type: "noul"; noul: number }
    | { type: "score"; level: number; probability: number };
};

export const systemOneFixtures = [acmeVendor] as SystemOneFixture[];
