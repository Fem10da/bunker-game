import { randomInt } from "node:crypto";

import type postgres from "postgres";

import type { CharacteristicId } from "@bunker/contracts";

import { PLAYTEST_CHARACTERISTIC_POOLS } from "./playtest-dossiers.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function chooseRegeneratedValue(
  pool: readonly string[],
  excludedValues: ReadonlySet<string>,
  randomIndex: (length: number) => number = randomInt
) {
  const candidates = pool.filter((value) => !excludedValues.has(value));
  if (candidates.length === 0) {
    throw new Error("Characteristic pool cannot produce a new value");
  }
  const index = randomIndex(candidates.length);
  const value = candidates[index];
  if (!Number.isInteger(index) || value === undefined) {
    throw new Error("Characteristic pool cannot produce a new value");
  }
  return value;
}

export async function regenerateInvalidatedCharacteristic(
  transaction: postgres.TransactionSql,
  input: {
    readonly characteristicId: CharacteristicId;
    readonly lobbyId: string;
    readonly playerId: string;
  }
) {
  const [player] = await transaction<{
    readonly character_profile: unknown;
    readonly invalidated_characteristics: readonly string[];
  }[]>`
    SELECT character_profile, invalidated_characteristics
    FROM lobby_players
    WHERE lobby_id = ${input.lobbyId}
      AND telegram_id = ${input.playerId}
    FOR UPDATE
  `;
  if (
    player === undefined ||
    !player.invalidated_characteristics.includes(input.characteristicId)
  ) {
    return { regenerated: false } as const;
  }
  if (!isRecord(player.character_profile)) {
    throw new Error("Cannot regenerate an invalid character profile");
  }
  const currentValue = player.character_profile[input.characteristicId];
  const disclosedValues = await transaction<{
    readonly value: string;
  }[]>`
    SELECT DISTINCT payload ->> 'value' AS value
    FROM game_events
    WHERE lobby_id = ${input.lobbyId}
      AND event_type IN (
        'characteristic_revealed',
        'characteristic_regenerated_and_revealed'
      )
      AND payload ->> 'playerId' = ${input.playerId}
      AND payload ->> 'characteristicId' = ${input.characteristicId}
      AND payload ->> 'value' IS NOT NULL
  `;
  const occupiedValues = await transaction<{
    readonly value: string | null;
  }[]>`
    SELECT character_profile ->> ${input.characteristicId} AS value
    FROM lobby_players
    WHERE lobby_id = ${input.lobbyId}
      AND telegram_id <> ${input.playerId}
  `;
  const excludedValues = new Set([
    ...(typeof currentValue === "string" ? [currentValue] : []),
    ...disclosedValues.map((entry) => entry.value),
    ...occupiedValues.flatMap((entry) =>
      entry.value === null ? [] : [entry.value]
    )
  ]);
  let value: string;
  try {
    value = chooseRegeneratedValue(
      PLAYTEST_CHARACTERISTIC_POOLS[input.characteristicId],
      excludedValues
    );
  } catch {
    return { regenerated: false } as const;
  }
  const profile = {
    ...player.character_profile,
    [input.characteristicId]: value
  };
  await transaction`
    UPDATE lobby_players
    SET
      character_profile = ${transaction.json(profile as postgres.JSONValue)},
      invalidated_characteristics = array_remove(
        invalidated_characteristics,
        ${input.characteristicId}
      )
    WHERE lobby_id = ${input.lobbyId}
      AND telegram_id = ${input.playerId}
  `;
  return { regenerated: true, value } as const;
}
