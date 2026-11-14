import { describe, expect, it } from "vitest";

import { calculateBunkerCapacity } from "./capacity.js";

describe("calculateBunkerCapacity", () => {
  it.each([
    [6, 3],
    [7, 4],
    [8, 4],
    [9, 5],
    [10, 5]
  ])("rounds half of %i players upward to %i places", (players, places) => {
    expect(calculateBunkerCapacity(players)).toBe(places);
  });

  it("rejects an invalid player count", () => {
    expect(() => calculateBunkerCapacity(0)).toThrow(
      "Player count must be a positive integer"
    );
  });
});
