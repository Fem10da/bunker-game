import { describe, expect, it, vi } from "vitest";

import {
  chooseRegeneratedValue,
  regenerateInvalidatedCharacteristic,
  requiredRollbackApprovals
} from "./game-rollback.js";
import { PLAYTEST_CHARACTERISTIC_POOLS } from "./playtest-dossiers.js";

function fakeTransaction(
  responses: readonly unknown[][],
  json = (value: unknown) => value
) {
  let index = 0;
  const transaction = Object.assign(
    <T>(
      strings: TemplateStringsArray,
      ...values: readonly unknown[]
    ): Promise<T> => {
      void strings;
      void values;
      const response = responses[index] ?? [];
      index += 1;
      return Promise.resolve(response as T);
    },
    { json }
  );
  return transaction as Parameters<
    typeof regenerateInvalidatedCharacteristic
  >[0];
}

describe("game rollback rules", () => {
  it("requires more than half of the active players", () => {
    expect(requiredRollbackApprovals(4)).toBe(3);
    expect(requiredRollbackApprovals(5)).toBe(3);
    expect(requiredRollbackApprovals(8)).toBe(5);
  });

  it("rejects an invalid active-player count", () => {
    expect(() => requiredRollbackApprovals(0)).toThrow(
      "at least one active player"
    );
    expect(() => requiredRollbackApprovals(1.5)).toThrow(
      "at least one active player"
    );
  });

  it("does not reuse any value disclosed in an inactive branch", () => {
    expect(
      chooseRegeneratedValue(
        ["старе", "вже показане", "нове"],
        new Set(["старе", "вже показане"]),
        () => 0
      )
    ).toBe("нове");
  });

  it("rejects exhausted pools and invalid random indexes", () => {
    expect(() =>
      chooseRegeneratedValue(["вже показане"], new Set(["вже показане"]))
    ).toThrow("cannot produce a new value");
    expect(() =>
      chooseRegeneratedValue(["нове"], new Set(), () => -1)
    ).toThrow("cannot produce a new value");
  });

  it("regenerates an invalidated characteristic without duplicating a revealed or occupied value", async () => {
    const json = vi.fn((value: unknown) => value);
    const transaction = fakeTransaction(
      [
        [
          {
            character_profile: {
              health: "Контрольована астма",
              profession: "Таксидерміст"
            },
            invalidated_characteristics: ["health"]
          }
        ],
        [{ value: "Депресія" }],
        [{ value: "Апоплексія" }, { value: null }],
        []
      ],
      json
    );

    const result = await regenerateInvalidatedCharacteristic(transaction, {
      characteristicId: "health",
      lobbyId: "lobby-1",
      playerId: "player-1"
    });

    expect(result.regenerated).toBe(true);
    if (!result.regenerated) {
      throw new Error("Expected a regenerated characteristic");
    }
    expect(result.value).not.toBe("Контрольована астма");
    expect(result.value).not.toBe("Депресія");
    expect(result.value).not.toBe("Апоплексія");
    expect(json).toHaveBeenCalledWith({
      health: result.value,
      profession: "Таксидерміст"
    });
  });

  it("keeps a characteristic invalidated instead of crashing when its pool is fully claimed", async () => {
    const [currentValue, ...otherValues] = PLAYTEST_CHARACTERISTIC_POOLS.health;
    const transaction = fakeTransaction([
      [
        {
          character_profile: { health: currentValue },
          invalidated_characteristics: ["health"]
        }
      ],
      [],
      otherValues.map((value) => ({ value }))
    ]);

    await expect(
      regenerateInvalidatedCharacteristic(transaction, {
        characteristicId: "health",
        lobbyId: "lobby-1",
        playerId: "player-1"
      })
    ).resolves.toEqual({ regenerated: false });
  });

  it("leaves a dossier intact when the requested characteristic was not invalidated", async () => {
    const transaction = fakeTransaction([
      [
        {
          character_profile: { health: "Контрольована астма" },
          invalidated_characteristics: []
        }
      ]
    ]);

    await expect(
      regenerateInvalidatedCharacteristic(transaction, {
        characteristicId: "health",
        lobbyId: "lobby-1",
        playerId: "player-1"
      })
    ).resolves.toEqual({ regenerated: false });
  });

  it("rejects an invalid stored dossier rather than silently replacing it", async () => {
    const transaction = fakeTransaction([
      [
        {
          character_profile: ["not a dossier"],
          invalidated_characteristics: ["health"]
        }
      ]
    ]);

    await expect(
      regenerateInvalidatedCharacteristic(transaction, {
        characteristicId: "health",
        lobbyId: "lobby-1",
        playerId: "player-1"
      })
    ).rejects.toThrow("Cannot regenerate an invalid character profile");
  });
});
