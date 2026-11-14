import type { RandomBindings } from "@bunker/contracts";

interface ResolveRandomBindingInput {
  readonly bindingKey: string;
  readonly bindings: RandomBindings;
  readonly candidates: readonly string[];
  readonly seed: string;
}

interface ResolvedRandomBinding {
  readonly bindings: RandomBindings;
  readonly result: string;
}

function hash32(value: string): number {
  let hash = 2_166_136_261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }

  return hash >>> 0;
}

export function deterministicIndex(
  seed: string,
  bindingKey: string,
  candidateCount: number
): number {
  if (!Number.isInteger(candidateCount) || candidateCount <= 0) {
    throw new Error("Candidate count must be a positive integer");
  }

  return hash32(`${seed}\u0000${bindingKey}`) % candidateCount;
}

export function resolveRandomBinding(
  input: ResolveRandomBindingInput
): ResolvedRandomBinding {
  const existing = input.bindings[input.bindingKey];

  if (existing !== undefined) {
    return {
      bindings: input.bindings,
      result: existing
    };
  }

  const candidate =
    input.candidates[
      deterministicIndex(
        input.seed,
        input.bindingKey,
        input.candidates.length
      )
    ];

  if (candidate === undefined) {
    throw new Error("Random binding requires at least one candidate");
  }

  return {
    bindings: {
      ...input.bindings,
      [input.bindingKey]: candidate
    },
    result: candidate
  };
}
