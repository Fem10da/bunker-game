import type {
  CreateGameInput,
  GamePlayer,
  GameState
} from "@bunker/contracts";

import { calculateBunkerCapacity } from "./capacity.js";

function assertUniquePlayers(playerIds: readonly string[]): void {
  if (new Set(playerIds).size !== playerIds.length) {
    throw new Error("A Telegram user cannot occupy two places in one game");
  }
}

function assertPlayerRange(input: CreateGameInput): void {
  const { max, min } = input.playerRange;
  if (
    !Number.isInteger(min) ||
    !Number.isInteger(max) ||
    min < 1 ||
    min > max
  ) {
    throw new Error("Scenario player range is invalid");
  }

  if (input.playerIds.length < min || input.playerIds.length > max) {
    throw new Error(`Player count must be between ${min} and ${max}`);
  }
}

function createPlayers(
  playerIds: readonly string[]
): Readonly<Record<string, GamePlayer>> {
  return Object.fromEntries(
    playerIds.map((id, order) => [
      id,
      {
        id,
        order,
        ready: false,
        status: "active"
      }
    ])
  );
}

function assertPlayerExists(state: GameState, playerId: string): GamePlayer {
  const player = state.players[playerId];

  if (player === undefined) {
    throw new Error(`Unknown player "${playerId}"`);
  }

  return player;
}

export function createGame(input: CreateGameInput): GameState {
  assertPlayerRange(input);
  assertUniquePlayers(input.playerIds);

  return {
    bunkerCapacity: calculateBunkerCapacity(input.playerIds.length),
    gameId: input.gameId,
    phase: "preparation",
    playerOrder: [...input.playerIds],
    players: createPlayers(input.playerIds),
    revision: 0,
    rngSeed: input.seed,
    round: 0,
    scenarioId: input.scenarioId,
    scenarioVersion: input.scenarioVersion
  };
}

export function markPlayerReady(
  state: GameState,
  playerId: string
): GameState {
  const player = assertPlayerExists(state, playerId);

  if (player.ready) {
    return state;
  }

  return {
    ...state,
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        ready: true
      }
    },
    revision: state.revision + 1
  };
}

export function startGame(state: GameState): GameState {
  if (state.phase !== "preparation") {
    throw new Error("A game can start only from preparation");
  }

  const activePlayers = Object.values(state.players).filter(
    (player) => player.status === "active"
  );

  if (activePlayers.some((player) => !player.ready)) {
    throw new Error("Every active player must be ready");
  }

  return {
    ...state,
    phase: "introduction",
    revision: state.revision + 1,
    round: 1
  };
}
