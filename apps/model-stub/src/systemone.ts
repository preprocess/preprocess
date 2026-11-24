import type {
  SystemOneAnswer,
  SystemOneQuestion,
  SystemOneRequest,
  SystemOneResponse,
} from "@preprocess/models/contract";

import { systemOneFixtures } from "../fixtures/systemone/index.ts";
import { confidence, hash, overlap, render, softmax, words } from "./text.ts";

const round = (n: number) => Math.round(n * 1e6) / 1e6;

const defaults = {
  choice: "Which option applies to the state?",
  noul: "Is the statement true, or is the answer to the question yes?",
  score: "Which level describes the state?",
};

function choose(
  names: string[],
  descriptions: unknown[],
  context: Set<string>,
  seed: string,
) {
  const scores = names.map(
    (name, i) =>
      overlap(
        words(`${name.replace(/[_-]/g, " ")} ${render(descriptions[i])}`),
        context,
      ) +
      hash(`${seed}\u0000${name}`) * 0.01,
  );
  return softmax(scores);
}

function answerQuestion(
  name: string,
  question: SystemOneQuestion,
  stateText: string,
): SystemOneAnswer {
  const instructions = render(question.instructions) || defaults[question.type];
  const context = words(`${stateText} ${instructions}`);
  const seed = `${stateText}\u0000${name}`;
  const fixture = systemOneFixtures.find(
    (f) =>
      f.question === name &&
      f.answer.type === question.type &&
      stateText.toLowerCase().includes(f.stateIncludes.toLowerCase()),
  )?.answer;

  if (question.type === "choice") {
    const names = Object.keys(question.criteria);
    let p = choose(names, Object.values(question.criteria), context, seed);
    if (fixture?.type === "choice" && names.includes(fixture.choice)) {
      const fixed = names.indexOf(fixture.choice);
      const rest = 1 - (p[fixed] ?? 0);
      p = p.map((v, i) =>
        i === fixed
          ? fixture.probability
          : rest > 0
            ? (v / rest) * (1 - fixture.probability)
            : 0,
      );
    }
    const best = p.indexOf(Math.max(...p));
    return {
      type: "choice",
      choice: names[best] ?? "",
      probabilities: Object.fromEntries(
        names.map((n, i) => [n, round(p[i] ?? 0)]),
      ),
      confidence: round(confidence(p)),
    };
  }

  if (question.type === "noul") {
    if (fixture?.type === "noul") return { type: "noul", noul: fixture.noul };
    const criteria =
      question.criteria && "true" in question.criteria
        ? question.criteria
        : null;
    const lean = criteria
      ? overlap(words(render(criteria.true)), context) -
        overlap(words(render(criteria.false)), context)
      : Math.min(overlap(words(instructions), words(stateText)), 4);
    const noul = Math.min(
      0.98,
      Math.max(0.02, 0.5 + 0.1 * lean + (hash(seed) - 0.5) * 0.02),
    );
    return { type: "noul", noul: round(noul) };
  }

  const levels = question.criteria;
  let p = choose(
    levels.map((_, i) => String(i)),
    levels,
    context,
    seed,
  );
  if (fixture?.type === "score" && fixture.level < levels.length)
    p = p.map((v, i) =>
      i === fixture.level ? fixture.probability : v * (1 - fixture.probability),
    );
  const sum = p.reduce((a, b) => a + b, 0);
  p = p.map((v) => v / sum);
  return {
    type: "score",
    score: round(p.reduce((s, v, i) => s + v * i, 0)),
    legend: Object.fromEntries(levels.map((l, i) => [String(i), l])),
    probabilities: Object.fromEntries(p.map((v, i) => [String(i), round(v)])),
    confidence: round(confidence(p)),
  };
}

export function answer(request: SystemOneRequest): SystemOneResponse {
  const stateText = render(request.state);
  const questions = Object.entries(request.questions);
  return {
    model: "stub-groundhog",
    answers: Object.fromEntries(
      questions.map(([name, q]) => [name, answerQuestion(name, q, stateText)]),
    ),
    usage: {
      input_tokens: Math.ceil(
        JSON.stringify([request.state, request.questions]).length / 4,
      ),
      output_tokens: questions.length,
    },
  };
}
