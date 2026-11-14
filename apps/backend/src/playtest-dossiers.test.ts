import { describe, expect, it } from "vitest";

import { CHARACTERISTIC_CATEGORIES } from "@bunker/contracts";

import {
  createPlaytestDossier,
  createPlaytestDossiers,
  parsePlaytestAgeGender,
  PLAYTEST_CHARACTERISTIC_POOLS
} from "./playtest-dossiers.js";

describe("playtest dossiers", () => {
  it("includes the owner-provided satirical dossier values", () => {
    expect(PLAYTEST_CHARACTERISTIC_POOLS.profession).toEqual(
      expect.arrayContaining([
        "Таксидерміст",
        "Trading Quality Auditor",
        "Вуличний гонщик"
      ])
    );
    expect(PLAYTEST_CHARACTERISTIC_POOLS.baggage).toEqual(
      expect.arrayContaining([
        "Вилка та мочалка",
        "Подушка",
        "Електрочайник і колекція фігурок Kinder Joy Funko One Piece"
      ])
    );
    expect(PLAYTEST_CHARACTERISTIC_POOLS.health).toEqual(
      expect.arrayContaining(["Лишай", "Депресія", "Апоплексія"])
    );
    expect(PLAYTEST_CHARACTERISTIC_POOLS.hobby).toEqual(
      expect.arrayContaining([
        "Нумізматика",
        "Колекціонування платівок",
        "Колеоптерологія"
      ])
    );
  });

  it("deals every characteristic without duplicates inside a party", () => {
    const dossiers = createPlaytestDossiers(16, () => 0);

    for (const category of CHARACTERISTIC_CATEGORIES) {
      const values = dossiers.map(
        (dossier) => dossier.characteristics[category.id]
      );
      expect(new Set(values).size).toBe(dossiers.length);
    }
  });

  it("rejects a party larger than the smallest characteristic pool", () => {
    expect(() => createPlaytestDossiers(17)).toThrow(
      "Not enough unique playtest characteristics"
    );
  });

  it("builds every characteristic independently from the scenario pools", () => {
    let call = 0;
    const dossier = createPlaytestDossier((length) => {
      const selected = call % length;
      call += 1;
      return selected;
    });

    expect(Object.keys(dossier.characteristics)).toEqual(
      CHARACTERISTIC_CATEGORIES.map((category) => category.id)
    );
    expect(dossier.characteristics.profession).toBe(
      PLAYTEST_CHARACTERISTIC_POOLS.profession[0]
    );
    expect(dossier.characteristics["age-gender"]).toBe(
      PLAYTEST_CHARACTERISTIC_POOLS["age-gender"][1]
    );
    expect(dossier.characteristics.health).toBe(
      PLAYTEST_CHARACTERISTIC_POOLS.health[2]
    );
    expect(dossier.secretGoal).toContain("Потрапте до бункера");
    expect(call).toBe(CHARACTERISTIC_CATEGORIES.length + 1);
  });

  it("rejects an invalid random index instead of producing a broken dossier", () => {
    expect(() => createPlaytestDossier(() => -1)).toThrow(
      "Random index is outside the pool"
    );
  });

  it("parses every controlled age and sex value for the final check", () => {
    expect(
      PLAYTEST_CHARACTERISTIC_POOLS["age-gender"].map(
        parsePlaytestAgeGender
      )
    ).toEqual([
      { age: 19, sex: "female" },
      { age: 22, sex: "male" },
      { age: 27, sex: "female" },
      { age: 31, sex: "male" },
      { age: 36, sex: "female" },
      { age: 41, sex: "male" },
      { age: 47, sex: "female" },
      { age: 53, sex: "male" },
      { age: 58, sex: "female" },
      { age: 64, sex: "male" },
      { age: 71, sex: "female" },
      { age: 76, sex: "male" },
      { age: 24, sex: "female" },
      { age: 29, sex: "male" },
      { age: 42, sex: "female" },
      { age: 57, sex: "male" }
    ]);
  });

  it("rejects an unknown age and sex label", () => {
    expect(() => parsePlaytestAgeGender("Невідомо")).toThrow(
      "Invalid playtest age and sex value"
    );
  });

  it("always deals a fertile-age woman and man in a small party", () => {
    const isFertile = (
      value: string,
      sex: "female" | "male",
      max: number
    ) => {
      const parsed = parsePlaytestAgeGender(value);
      return parsed.sex === sex && parsed.age >= 18 && parsed.age <= max;
    };

    for (let trial = 0; trial < 500; trial += 1) {
      const ages = createPlaytestDossiers(4).map(
        (dossier) => dossier.characteristics["age-gender"]
      );

      expect(ages.some((value) => isFertile(value, "female", 49))).toBe(
        true
      );
      expect(ages.some((value) => isFertile(value, "male", 64))).toBe(true);
    }
  });
});
