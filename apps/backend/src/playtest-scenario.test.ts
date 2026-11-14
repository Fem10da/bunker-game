import { describe, expect, it } from "vitest";

import {
  applyPlaytestCard,
  allPlaytestCards,
  dealPlaytestCards,
  initialScenarioResources,
  isPlaytestCardCancelled,
  operationChalkScenario,
  parseStoredCard,
  parseStoredResources,
  resolveOperationChalkScenario
} from "./playtest-scenario.js";

describe("Operation Chalk playtest scenario", () => {
  it("contains the complete catastrophe, bunker and resource briefing", () => {
    expect(operationChalkScenario.catastrophe.title).toBe(
      "ЧАСОВИЙ РОЗЛОМ"
    );
    expect(operationChalkScenario.bunker.rooms.length).toBeGreaterThan(4);
    expect(operationChalkScenario.bunker.supplies.length).toBeGreaterThan(2);
    expect(operationChalkScenario.bunker.limitations.length).toBeGreaterThan(2);
    expect(initialScenarioResources.map((resource) => resource.id)).toEqual([
      "energy",
      "supplies",
      "integrity",
      "lab-data",
      "materials",
      "predator-attention"
    ]);
  });

  it("deals one unique card per player with actions and reactions available", () => {
    const cards = dealPlaytestCards(16);

    expect(allPlaytestCards).toHaveLength(47);
    expect(cards).toHaveLength(16);
    expect(new Set(cards.map((card) => card.id)).size).toBe(16);
    expect(cards.some((card) => card.kind === "action")).toBe(true);
    expect(cards.some((card) => card.kind === "reaction")).toBe(true);
    expect(
      cards.filter((card) => card.kind === "reaction").length
    ).toBeGreaterThanOrEqual(2);
    expect(
      cards.some(
        (card) =>
          card.kind === "reaction" &&
          card.effectId !== "player.protect" &&
          (card.selection?.length ?? 0) === 0
      )
    ).toBe(true);
  });

  it("keeps the action with zero or two reactions and cancels it with one", () => {
    expect(isPlaytestCardCancelled(0)).toBe(false);
    expect(isPlaytestCardCancelled(1)).toBe(true);
    expect(isPlaytestCardCancelled(2)).toBe(false);
    expect(() => isPlaytestCardCancelled(3)).toThrow(RangeError);
  });

  it("returns a turn extension without changing resources", () => {
    const result = applyPlaytestCard(initialScenarioResources, "extra-minute");

    expect(result.resources).toEqual(initialScenarioResources);
    expect(result.turnExtensionSeconds).toBe(30);
  });

  it("rejects unsupported effects and impossible deals", () => {
    expect(() =>
      applyPlaytestCard(initialScenarioResources, "unknown")
    ).toThrow("Unsupported playtest card");
    expect(() => dealPlaytestCards(1)).toThrow(RangeError);
    expect(() => dealPlaytestCards(17)).toThrow(RangeError);
  });

  it("restores only valid persisted resources", () => {
    expect(parseStoredResources(undefined)).toEqual(
      initialScenarioResources
    );
    expect(parseStoredResources([{ id: "energy" }])).toEqual(
      initialScenarioResources
    );

    const stored = initialScenarioResources.map((resource) => ({
      ...resource,
      value: resource.id === "energy" ? 3 : resource.value
    }));
    const parsed = parseStoredResources(stored);
    expect(parsed).toEqual(stored);
    expect(parsed).not.toBe(stored);
  });

  it("randomizes bunker size and ration duration deterministically per lobby", () => {
    const first = resolveOperationChalkScenario("AAAAAA");
    const again = resolveOperationChalkScenario("AAAAAA");
    const other = resolveOperationChalkScenario("ZZZZZZ");

    expect(first.bunker.condition).toBe(again.bunker.condition);
    expect(first.bunker.description).toBe(again.bunker.description);
    expect(first.bunker.condition).toMatch(/квадратних метрів/u);
    expect(first.bunker.description).toMatch(/місяців/u);
    expect(
      first.bunker.supplies.some((supply) =>
        supply.startsWith("Продовольчі пайки приблизно на")
      )
    ).toBe(true);
    expect(
      first.bunker.condition !== other.bunker.condition ||
        first.bunker.description !== other.bunker.description
    ).toBe(true);
  });

  it("restores a registered card by id and rejects unknown data", () => {
    expect(
      parseStoredCard({
        id: "extra-minute",
        injectedTitle: "Не довіряти"
      })
    ).toMatchObject({
      id: "extra-minute",
      title: "Додатковий час"
    });
    expect(() => parseStoredCard(null)).toThrow(
      "missing a playtest card"
    );
    expect(() => parseStoredCard({ id: "unknown" })).toThrow(
      "invalid playtest card"
    );
  });
});
