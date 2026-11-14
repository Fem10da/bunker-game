import { describe, expect, it } from "vitest";

import {
  COMMON_CARD_CATALOG,
  COMMON_PROFESSION_CATALOG,
  OPERATION_CHALK_CARD_CATALOG,
  OPERATION_CHALK_PROFESSION_CATALOG,
  resolveCardCatalog,
  resolveProfessionCatalog
} from "./catalog.js";

describe("shared and scenario content catalogs", () => {
  it("combines thirty-nine common cards with zero Operation Chalk cards", () => {
    const cards = resolveCardCatalog("operation-chalk");

    expect(COMMON_CARD_CATALOG).toHaveLength(47);
    expect(OPERATION_CHALK_CARD_CATALOG).toHaveLength(0);
    expect(cards).toHaveLength(47);
    expect(new Set(cards.map((card) => card.id)).size).toBe(47);
    expect(COMMON_CARD_CATALOG.every((card) => card.scope === "common")).toBe(
      true
    );
  });

  it("keeps common professions reusable and adds scenario professions", () => {
    const professions = resolveProfessionCatalog("operation-chalk");

    expect(COMMON_PROFESSION_CATALOG.length).toBeGreaterThanOrEqual(15);
    expect(OPERATION_CHALK_PROFESSION_CATALOG).toHaveLength(17);
    expect(new Set(professions.map((profession) => profession.id)).size).toBe(
      professions.length
    );
    expect(
      new Set(professions.map((profession) => profession.label)).size
    ).toBe(professions.length);
  });

  it("returns only reusable content for an unknown future scenario", () => {
    expect(resolveCardCatalog("future-scenario")).toEqual(
      COMMON_CARD_CATALOG
    );
    expect(resolveProfessionCatalog("future-scenario")).toEqual(
      COMMON_PROFESSION_CATALOG
    );
  });
});
