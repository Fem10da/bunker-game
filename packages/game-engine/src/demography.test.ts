import { describe, expect, it } from "vitest";

import {
  assessDemography,
  STANDARD_BETA_DEMOGRAPHY_RULE
} from "./demography.js";

describe("assessDemography", () => {
  it("passes when the final group contains both required eligible adults", () => {
    expect(
      assessDemography([
        { age: 27, sex: "female" },
        { age: 53, sex: "male" },
        { age: 71, sex: "female" }
      ])
    ).toEqual({
      eligibleMen: 1,
      eligibleWomen: 1,
      maleAgeRange: { max: 64, min: 18 },
      preserved: true,
      requiredMen: 1,
      requiredWomen: 1,
      femaleAgeRange: { max: 49, min: 18 }
    });
  });

  it("reports a failed check when either required group is missing", () => {
    expect(
      assessDemography([
        { age: 58, sex: "female" },
        { age: 31, sex: "male" }
      ])
    ).toMatchObject({
      eligibleMen: 1,
      eligibleWomen: 0,
      preserved: false
    });
  });

  it("accepts a custom scenario rule without changing the default rule", () => {
    const customRule = {
      ...STANDARD_BETA_DEMOGRAPHY_RULE,
      femaleAgeRange: { max: 60, min: 18 }
    };

    expect(
      assessDemography([{ age: 58, sex: "female" }], customRule)
    ).toMatchObject({ eligibleWomen: 1 });
    expect(STANDARD_BETA_DEMOGRAPHY_RULE.femaleAgeRange.max).toBe(49);
  });

  it("rejects invalid ages at the game-engine boundary", () => {
    expect(() =>
      assessDemography([{ age: Number.NaN, sex: "female" }])
    ).toThrow("Invalid demographic age");
  });

  it("passes through an alternate fertility-assisted path without a standard man and woman", () => {
    expect(
      assessDemography(
        [
          { age: 27, sex: "female" },
          { age: 31, sex: "female", fertilityCapable: true }
        ],
        undefined,
        true
      )
    ).toMatchObject({ preserved: true });
  });

  it("does not grant the alternate path without both the trait and assistance", () => {
    expect(
      assessDemography(
        [{ age: 27, sex: "female", fertilityCapable: true }],
        undefined,
        false
      )
    ).toMatchObject({ preserved: false });
    expect(
      assessDemography([{ age: 27, sex: "female" }], undefined, true)
    ).toMatchObject({ preserved: false });
  });

  it("rejects an impossible scenario rule", () => {
    expect(() =>
      assessDemography([], {
        ...STANDARD_BETA_DEMOGRAPHY_RULE,
        maleAgeRange: { max: 18, min: 64 }
      })
    ).toThrow("Invalid demographic rule");
  });
});
