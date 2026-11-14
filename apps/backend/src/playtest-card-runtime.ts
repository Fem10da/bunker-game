import { randomInt } from "node:crypto";

import type postgres from "postgres";

import {
  CHARACTERISTIC_CATEGORIES,
  type CharacteristicId,
  type PlaytestCardSelection,
  type PlaytestResource,
  type RandomBindings
} from "@bunker/contracts";
import type { CatalogCard } from "@bunker/content";

import { appendGameEvent } from "./game-checkpoints.js";
import {
  FERTILITY_CAPABLE_SPECIAL_CONDITION,
  PLAYTEST_CHARACTERISTIC_POOLS
} from "./playtest-dossiers.js";
import {
  allPlaytestCards,
  applyPlaytestCard,
  parseStoredCard
} from "./playtest-scenario.js";
import {
  addBonusVote,
  addPlayerFlag,
  setTurnAdjustment,
  type PlaytestCardState
} from "./playtest-card-state.js";

interface RuntimePlayer {
  readonly character_profile: unknown;
  readonly player_id: string;
  readonly position: number;
  readonly revealed_characteristics: readonly string[];
  readonly status: string;
}

export class PlaytestCardSelectionError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseProfile(value: unknown): Record<CharacteristicId, string> {
  if (!isRecord(value)) {
    throw new Error("Started game is missing a character dossier");
  }
  return Object.fromEntries(
    CHARACTERISTIC_CATEGORIES.map(({ id }) => {
      const characteristic = value[id];
      if (typeof characteristic !== "string") {
        throw new Error("Started game contains an invalid character dossier");
      }
      return [id, characteristic];
    })
  ) as Record<CharacteristicId, string>;
}

async function readPlayers(
  transaction: postgres.TransactionSql,
  lobbyId: string
): Promise<readonly RuntimePlayer[]> {
  return transaction<RuntimePlayer[]>`
    SELECT
      telegram_id::text AS player_id,
      position::integer,
      game_status AS status,
      character_profile,
      revealed_characteristics
    FROM lobby_players
    WHERE lobby_id = ${lobbyId}
    ORDER BY position
    FOR UPDATE
  `;
}

export async function validatePlaytestCardSelection(
  transaction: postgres.TransactionSql,
  input: {
    readonly actorPlayerId: string;
    readonly card: CatalogCard;
    readonly lobbyId: string;
    readonly resources: readonly PlaytestResource[];
    readonly selection: PlaytestCardSelection;
  }
): Promise<void> {
  const { card, selection } = input;
  if (
    (card.selection.includes("target_player") &&
      selection.targetPlayerId === undefined) ||
    (card.selection.includes("characteristic") &&
      selection.characteristicId === undefined) ||
    (card.selection.includes("resource") &&
      selection.resourceId === undefined) ||
    (!card.selection.includes("target_player") &&
      selection.targetPlayerId !== undefined) ||
    (!card.selection.includes("characteristic") &&
      selection.characteristicId !== undefined) ||
    (!card.selection.includes("resource") &&
      selection.resourceId !== undefined) ||
    (selection.characteristicId !== undefined &&
      !CHARACTERISTIC_CATEGORIES.some(
        ({ id }) => id === selection.characteristicId
      )) ||
    (selection.resourceId !== undefined &&
      !input.resources.some(({ id }) => id === selection.resourceId))
  ) {
    throw new PlaytestCardSelectionError();
  }

  const players = await readPlayers(transaction, input.lobbyId);
  const actor = players.find(
    ({ player_id }) => player_id === input.actorPlayerId
  );
  const target = players.find(
    ({ player_id }) => player_id === selection.targetPlayerId
  );
  if (actor === undefined) {
    throw new PlaytestCardSelectionError();
  }
  if (
    card.target === "any_non_afk_player" &&
    (target === undefined ||
      target.status !== "active" ||
      target.player_id === actor.player_id)
  ) {
    throw new PlaytestCardSelectionError();
  }
  if (
    card.target === "eliminated_player" &&
    (target === undefined || target.status !== "eliminated")
  ) {
    throw new PlaytestCardSelectionError();
  }

  const characteristicId = selection.characteristicId;
  if (characteristicId === undefined) {
    if (
      card.effect.kind === "order" &&
      (target === undefined || target.position <= actor.position)
    ) {
      throw new PlaytestCardSelectionError();
    }
    return;
  }
  const subject = target ?? actor;
  const isRevealed = subject.revealed_characteristics.includes(
    characteristicId
  );
  if (
    (card.effect.kind === "characteristic" &&
      (card.effect.operation === "reveal_extra" ||
        card.effect.operation === "reroll" ||
        card.effect.operation === "force_reveal" ||
        card.effect.operation === "inspect") &&
      isRevealed) ||
    (card.effect.kind === "characteristic" &&
      card.effect.operation === "hide" &&
      !isRevealed) ||
    (card.effect.kind === "characteristic" &&
      card.effect.operation === "force_reroll" &&
      !isRevealed)
  ) {
    throw new PlaytestCardSelectionError();
  }
}

async function resolveBoundRandomChoice(
  transaction: postgres.TransactionSql,
  input: {
    readonly decisionKey: string;
    readonly isStillValid: (value: string) => boolean;
    readonly lobbyId: string;
    readonly pick: () => string | undefined;
    readonly playerId: string;
  }
): Promise<string | undefined> {
  const [game] = await transaction<{
    readonly active_branch_id: string | null;
    readonly random_bindings: RandomBindings;
  }[]>`
    SELECT active_branch_id::text, random_bindings
    FROM lobbies
    WHERE lobby_id = ${input.lobbyId}
    FOR UPDATE
  `;
  if (game === undefined || game.active_branch_id === null) {
    throw new Error("Started game is missing an active branch");
  }
  const [attempt] = await transaction<{ readonly count: number }[]>`
    SELECT count(*)::integer AS count
    FROM game_events
    WHERE branch_id = ${game.active_branch_id}
      AND event_type = 'random_choice_bound'
      AND payload ->> 'playerId' = ${input.playerId}
      AND payload ->> 'decisionKey' = ${input.decisionKey}
  `;
  const bindingKey = `${input.playerId}:${input.decisionKey}:${attempt?.count ?? 0}`;
  const bound = game.random_bindings[bindingKey];
  const reusable = bound !== undefined && input.isStillValid(bound);
  const value = reusable ? bound : input.pick();
  if (value === undefined) {
    return undefined;
  }
  if (!reusable) {
    await transaction`
      UPDATE lobbies
      SET random_bindings = random_bindings || ${transaction.json({ [bindingKey]: value })}
      WHERE lobby_id = ${input.lobbyId}
    `;
  }
  await appendGameEvent(transaction, {
    branchId: game.active_branch_id,
    eventType: "random_choice_bound",
    lobbyId: input.lobbyId,
    payload: { decisionKey: input.decisionKey, playerId: input.playerId }
  });
  return value;
}

async function applyCharacteristicEffect(
  transaction: postgres.TransactionSql,
  input: {
    readonly actorPlayerId: string;
    readonly card: CatalogCard;
    readonly lobbyId: string;
    readonly selection: PlaytestCardSelection;
  }
): Promise<string> {
  const players = await readPlayers(transaction, input.lobbyId);
  const actor = players.find(({ player_id }) => player_id === input.actorPlayerId);
  const target = players.find(
    ({ player_id }) => player_id === input.selection.targetPlayerId
  );
  const characteristicId =
    input.card.effect.kind === "characteristic"
      ? (input.card.effect.characteristicId ?? input.selection.characteristicId)
      : undefined;
  if (actor === undefined || characteristicId === undefined) {
    throw new Error("Card effect is missing its player or characteristic");
  }
  const characteristicLabel =
    CHARACTERISTIC_CATEGORIES.find(({ id }) => id === characteristicId)?.label ??
    characteristicId;
  const operation =
    input.card.effect.kind === "characteristic"
      ? input.card.effect.operation
      : "reveal_extra";
  const subject = target ?? actor;

  if (operation === "reveal_extra" || operation === "force_reveal") {
    await transaction`
      UPDATE lobby_players
      SET
        revealed_characteristics = array_append(
          revealed_characteristics,
          ${characteristicId}
        ),
        disclosed_characteristics = CASE
          WHEN ${characteristicId} = ANY(disclosed_characteristics)
            THEN disclosed_characteristics
          ELSE array_append(disclosed_characteristics, ${characteristicId})
        END
      WHERE lobby_id = ${input.lobbyId}
        AND telegram_id = ${subject.player_id}
        AND NOT (${characteristicId} = ANY(revealed_characteristics))
    `;
  } else if (operation === "hide") {
    await transaction`
      UPDATE lobby_players
      SET revealed_characteristics = array_remove(
        revealed_characteristics,
        ${characteristicId}
      )
      WHERE lobby_id = ${input.lobbyId}
        AND telegram_id = ${actor.player_id}
    `;
  } else if (operation === "inspect") {
    const value = parseProfile(subject.character_profile)[characteristicId];
    await transaction`
      UPDATE lobby_players
      SET
        card_private_result = ${`${characteristicLabel}: ${value}`}
      WHERE lobby_id = ${input.lobbyId}
        AND telegram_id = ${actor.player_id}
    `;
    await transaction`
      UPDATE lobby_players
      SET
        inspected_characteristics = array_append(
          inspected_characteristics,
          ${characteristicId}
        ),
        disclosed_characteristics = CASE
          WHEN ${characteristicId} = ANY(disclosed_characteristics)
            THEN disclosed_characteristics
          ELSE array_append(disclosed_characteristics, ${characteristicId})
        END
      WHERE lobby_id = ${input.lobbyId}
        AND telegram_id = ${subject.player_id}
        AND NOT (${characteristicId} = ANY(inspected_characteristics))
    `;
  } else if (operation === "reroll") {
    const usedValues = new Set(
      players.map((player) => parseProfile(player.character_profile)[characteristicId])
    );
    const pickCandidate = () => {
      const candidates = PLAYTEST_CHARACTERISTIC_POOLS[characteristicId].filter(
        (value) => !usedValues.has(value)
      );
      return candidates.length === 0
        ? undefined
        : candidates[randomInt(candidates.length)];
    };
    const replacement = await resolveBoundRandomChoice(transaction, {
      decisionKey: `characteristic.reroll:${characteristicId}`,
      isStillValid: (value) =>
        (PLAYTEST_CHARACTERISTIC_POOLS[characteristicId] as readonly string[]).includes(
          value
        ) && !usedValues.has(value),
      lobbyId: input.lobbyId,
      pick: pickCandidate,
      playerId: actor.player_id
    });
    if (replacement === undefined) {
      return `${input.card.title}: усі варіанти «${characteristicLabel.toLowerCase()}» вже зайняті, картку не застосовано.`;
    }
    await transaction`
      UPDATE lobby_players
      SET character_profile = ${transaction.json({
        ...parseProfile(actor.character_profile),
        [characteristicId]: replacement
      })}
      WHERE lobby_id = ${input.lobbyId}
        AND telegram_id = ${actor.player_id}
    `;
  } else if (operation === "swap") {
    if (target === undefined) {
      throw new Error("Card swap is missing its target");
    }
    const actorProfile = parseProfile(actor.character_profile);
    const targetProfile = parseProfile(target.character_profile);
    await transaction`
      UPDATE lobby_players
      SET character_profile = CASE
        WHEN telegram_id = ${actor.player_id} THEN ${transaction.json({
          ...actorProfile,
          [characteristicId]: targetProfile[characteristicId]
        })}
        WHEN telegram_id = ${target.player_id} THEN ${transaction.json({
          ...targetProfile,
          [characteristicId]: actorProfile[characteristicId]
        })}
        ELSE character_profile
      END
      WHERE lobby_id = ${input.lobbyId}
        AND telegram_id IN (${actor.player_id}, ${target.player_id})
    `;
  } else if (operation === "force_reroll") {
    if (target === undefined) {
      throw new Error("Card force reroll is missing its target");
    }
    const usedValues = new Set(
      players.map((player) => parseProfile(player.character_profile)[characteristicId])
    );
    const pickCandidate = () => {
      const candidates = PLAYTEST_CHARACTERISTIC_POOLS[characteristicId].filter(
        (value) => !usedValues.has(value)
      );
      return candidates.length === 0
        ? undefined
        : candidates[randomInt(candidates.length)];
    };
    const replacement = await resolveBoundRandomChoice(transaction, {
      decisionKey: `characteristic.force_reroll:${characteristicId}`,
      isStillValid: (value) =>
        (PLAYTEST_CHARACTERISTIC_POOLS[characteristicId] as readonly string[]).includes(
          value
        ) && !usedValues.has(value),
      lobbyId: input.lobbyId,
      pick: pickCandidate,
      playerId: target.player_id
    });
    if (replacement === undefined) {
      return `${input.card.title}: усі варіанти «${characteristicLabel.toLowerCase()}» вже зайняті, картку не застосовано.`;
    }
    await transaction`
      UPDATE lobby_players
      SET character_profile = ${transaction.json({
        ...parseProfile(target.character_profile),
        [characteristicId]: replacement
      })}
      WHERE lobby_id = ${input.lobbyId}
        AND telegram_id = ${target.player_id}
    `;
  } else if (operation === "cure_infertility") {
    if (target === undefined) {
      throw new Error("Card cure_infertility is missing its target");
    }
    await transaction`
      UPDATE lobby_players
      SET character_profile = ${transaction.json({
        ...parseProfile(target.character_profile),
        [characteristicId]: FERTILITY_CAPABLE_SPECIAL_CONDITION
      })}
      WHERE lobby_id = ${input.lobbyId}
        AND telegram_id = ${target.player_id}
    `;
    return `${input.card.title}: гравець отримав репродуктивну здатність.`;
  }
  return `${input.card.title}: ${characteristicLabel.toLowerCase()} оновлено.`;
}

async function replaceCard(
  transaction: postgres.TransactionSql,
  input: {
    readonly actorPlayerId: string;
    readonly card: CatalogCard;
    readonly lobbyId: string;
    readonly operation: "draw" | "recover";
  }
): Promise<string> {
  const cards = await transaction<{
    readonly card_used: boolean;
    readonly player_id: string;
    readonly special_card: unknown;
  }[]>`
    SELECT
      telegram_id::text AS player_id,
      special_card,
      card_used
    FROM lobby_players
    WHERE lobby_id = ${input.lobbyId}
    FOR UPDATE
  `;
  const assignedIds = new Set(cards.map(({ special_card }) => parseStoredCard(special_card).id));
  const candidates = input.operation === "recover"
    ? cards
        .filter(({ card_used, player_id }) => card_used && player_id !== input.actorPlayerId)
        .map(({ special_card }) => parseStoredCard(special_card))
    : allPlaytestCards.filter(({ id }) => !assignedIds.has(id));
  const candidatesById = new Map(candidates.map((card) => [card.id, card]));
  const replacementId = await resolveBoundRandomChoice(transaction, {
    decisionKey: `card.${input.operation}`,
    isStillValid: (id) => candidatesById.has(id),
    lobbyId: input.lobbyId,
    pick: () => {
      const ids = candidates.map((card) => card.id);
      return ids.length === 0 ? undefined : ids[randomInt(ids.length)];
    },
    playerId: input.actorPlayerId
  });
  const replacement =
    replacementId === undefined ? undefined : candidatesById.get(replacementId);
  if (replacement === undefined) {
    return `${input.card.title}: доступної картки не знайдено.`;
  }
  await transaction`
    UPDATE lobby_players
    SET
      special_card = ${transaction.json(replacement)},
      card_used = false,
      card_private_result = ${`Нова картка: «${replacement.title}».`}
    WHERE lobby_id = ${input.lobbyId}
      AND telegram_id = ${input.actorPlayerId}
  `;
  return `${input.card.title}: отримано нову картку.`;
}

export async function applyPlaytestCardEffect(
  transaction: postgres.TransactionSql,
  input: {
    readonly actorPlayerId: string;
    readonly card: CatalogCard;
    readonly cardState: PlaytestCardState;
    readonly lobbyId: string;
    readonly resources: readonly PlaytestResource[];
    readonly selection: PlaytestCardSelection;
  }
): Promise<{
  readonly cardState: PlaytestCardState;
  readonly event: string;
  readonly resources: readonly PlaytestResource[];
  readonly turnExtensionSeconds: number;
}> {
  const { effect } = input.card;
  if (effect.kind === "resource" ||
      (effect.kind === "turn_time" && effect.target === "current") ||
      effect.kind === "pause") {
    const applied = applyPlaytestCard(
      input.resources,
      input.card.id,
      input.selection.resourceId
    );
    return { ...applied, cardState: input.cardState };
  }
  if (effect.kind === "turn_time") {
    return {
      cardState: setTurnAdjustment(
        input.cardState,
        input.selection.targetPlayerId ?? input.actorPlayerId,
        effect.seconds
      ),
      event: `${input.card.title}: час наступного ходу змінено.`,
      resources: input.resources,
      turnExtensionSeconds: 0
    };
  }
  if (effect.kind === "characteristic") {
    return {
      cardState: input.cardState,
      event: await applyCharacteristicEffect(transaction, input),
      resources: input.resources,
      turnExtensionSeconds: 0
    };
  }
  if (effect.kind === "vote") {
    const targetPlayerId = input.selection.targetPlayerId ?? input.actorPlayerId;
    const cardState = effect.operation === "add"
      ? addBonusVote(input.cardState, targetPlayerId)
      : effect.operation === "block"
        ? addPlayerFlag(input.cardState, "protectedVotePlayerIds", input.actorPlayerId)
        : effect.operation === "double"
          ? addPlayerFlag(input.cardState, "doubleVotePlayerIds", input.actorPlayerId)
          : effect.operation === "reduce"
            ? addPlayerFlag(input.cardState, "reducedVotePlayerIds", input.actorPlayerId)
            : effect.operation === "silence"
              ? addPlayerFlag(input.cardState, "silencedVoterPlayerIds", targetPlayerId)
              : { ...input.cardState, revealVoteTotals: true };
    return {
      cardState,
      event: `${input.card.title}: правило наступного голосування змінено.`,
      resources: input.resources,
      turnExtensionSeconds: 0
    };
  }
  if (effect.kind === "player" && effect.operation === "revive") {
    const targetPlayerId = input.selection.targetPlayerId;
    if (targetPlayerId === undefined) {
      throw new Error("Card revive is missing its target");
    }
    await transaction`
      UPDATE lobby_players
      SET game_status = 'active'
      WHERE lobby_id = ${input.lobbyId}
        AND telegram_id = ${targetPlayerId}
        AND game_status = 'eliminated'
    `;
    return {
      cardState: input.cardState,
      event: `${input.card.title}: виключеного гравця повернено.`,
      resources: input.resources,
      turnExtensionSeconds: 0
    };
  }
  if (effect.kind === "player") {
    return {
      cardState: input.card.kind === "action"
        ? addPlayerFlag(
            input.cardState,
            "protectedVotePlayerIds",
            input.selection.targetPlayerId ?? input.actorPlayerId
          )
        : input.cardState,
      event: `${input.card.title}: захист активовано.`,
      resources: input.resources,
      turnExtensionSeconds: 0
    };
  }
  if (effect.kind === "order") {
    const players = await readPlayers(transaction, input.lobbyId);
    const actor = players.find(({ player_id }) => player_id === input.actorPlayerId);
    const target = players.find(({ player_id }) => player_id === input.selection.targetPlayerId);
    if (actor === undefined || target === undefined) {
      throw new Error("Card order change is missing a player");
    }
    await transaction`
      SET CONSTRAINTS lobby_players_lobby_id_position_key DEFERRED
    `;
    for (
      let position = target.position - 1;
      position > actor.position;
      position -= 1
    ) {
      await transaction`
        UPDATE lobby_players
        SET position = ${position + 1}
        WHERE lobby_id = ${input.lobbyId}
          AND position = ${position}
      `;
    }
    await transaction`
      UPDATE lobby_players
      SET position = ${actor.position + 1}
      WHERE lobby_id = ${input.lobbyId}
        AND telegram_id = ${target.player_id}
    `;
    return {
      cardState: input.cardState,
      event: `${input.card.title}: чергу ходів оновлено.`,
      resources: input.resources,
      turnExtensionSeconds: 0
    };
  }
  if (effect.kind === "card" &&
      (effect.operation === "draw" || effect.operation === "recover")) {
    return {
      cardState: input.cardState,
      event: await replaceCard(transaction, {
        actorPlayerId: input.actorPlayerId,
        card: input.card,
        lobbyId: input.lobbyId,
        operation: effect.operation
      }),
      resources: input.resources,
      turnExtensionSeconds: 0
    };
  }
  return {
    cardState: input.cardState,
    event: `${input.card.title}: ефект ланцюжка застосовано.`,
    resources: input.resources,
    turnExtensionSeconds: 0
  };
}
