import { describe, expect, it } from "vitest";

import {
  deterministicIndex,
  resolveRandomBinding
} from "./random.js";

describe("deterministicIndex", () => {
  it("returns the same index for the same seed and binding key", () => {
    const first = deterministicIndex("game-seed", "vote:round-2:player-1", 7);
    const second = deterministicIndex("game-seed", "vote:round-2:player-1", 7);

    expect(second).toBe(first);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(7);
  });

  it("rejects an empty candidate collection", () => {
    expect(() => deterministicIndex("game-seed", "decision", 0)).toThrow(
      "Candidate count must be a positive integer"
    );
  });
});

describe("resolveRandomBinding", () => {
  it("reuses an existing result instead of rerolling", () => {
    const first = resolveRandomBinding({
      bindingKey: "decision:player:action",
      bindings: {},
      candidates: ["a", "b", "c"],
      seed: "seed"
    });
    const repeated = resolveRandomBinding({
      bindingKey: "decision:player:action",
      bindings: first.bindings,
      candidates: ["a", "b", "c"],
      seed: "another-seed"
    });

    expect(repeated.result).toBe(first.result);
    expect(repeated.bindings).toEqual(first.bindings);
  });

  it("returns a new bindings object without mutating the input", () => {
    const original = {};
    const resolved = resolveRandomBinding({
      bindingKey: "decision",
      bindings: original,
      candidates: ["a", "b"],
      seed: "seed"
    });

    expect(original).toEqual({});
    expect(resolved.bindings).not.toBe(original);
    expect(resolved.bindings).toEqual({ decision: resolved.result });
  });

  it("rejects resolving from an empty candidate collection", () => {
    expect(() =>
      resolveRandomBinding({
        bindingKey: "decision",
        bindings: {},
        candidates: [],
        seed: "seed"
      })
    ).toThrow("Candidate count must be a positive integer");
  });
});
