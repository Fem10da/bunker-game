import { describe, expect, it } from "vitest";

import {
  createGame,
  markPlayerReady,
  startGame
} from "./game.js";

const playerIds = [
  "player-1",
  "player-2",
  "player-3",
  "player-4",
  "player-5",
  "player-6",
  "player-7"
];

describe("game preparation", () => {
  it("creates an immutable preparation state with ceil-half capacity", () => {
    const game = createGame({
      gameId: "game-1",
      playerIds,
      playerRange: { max: 10, min: 6 },
      scenarioId: "operation-chalk",
      scenarioVersion: "0.1.0",
      seed: "seed"
    });

    expect(game.phase).toBe("preparation");
    expect(game.bunkerCapacity).toBe(4);
    expect(game.playerOrder).toEqual(playerIds);
    expect(game.revision).toBe(0);
  });

  it("marks a player ready without mutating the previous state", () => {
    const game = createGame({
      gameId: "game-1",
      playerIds,
      playerRange: { max: 10, min: 6 },
      scenarioId: "operation-chalk",
      scenarioVersion: "0.1.0",
      seed: "seed"
    });
    const next = markPlayerReady(game, "player-1");

    expect(game.players["player-1"]?.ready).toBe(false);
    expect(next.players["player-1"]?.ready).toBe(true);
    expect(next.revision).toBe(1);
  });

  it("treats repeated ready confirmation as idempotent", () => {
    const game = createGame({
      gameId: "game-1",
      playerIds,
      playerRange: { max: 10, min: 6 },
      scenarioId: "operation-chalk",
      scenarioVersion: "0.1.0",
      seed: "seed"
    });
    const ready = markPlayerReady(game, "player-1");

    expect(markPlayerReady(ready, "player-1")).toBe(ready);
  });

  it("rejects readiness from an unknown player", () => {
    const game = createGame({
      gameId: "game-1",
      playerIds,
      playerRange: { max: 10, min: 6 },
      scenarioId: "operation-chalk",
      scenarioVersion: "0.1.0",
      seed: "seed"
    });

    expect(() => markPlayerReady(game, "unknown")).toThrow(
      'Unknown player "unknown"'
    );
  });

  it("starts only after every active player is ready", () => {
    const game = createGame({
      gameId: "game-1",
      playerIds,
      playerRange: { max: 10, min: 6 },
      scenarioId: "operation-chalk",
      scenarioVersion: "0.1.0",
      seed: "seed"
    });

    expect(() => startGame(game)).toThrow("Every active player must be ready");

    const ready = playerIds.reduce(markPlayerReady, game);
    const started = startGame(ready);

    expect(started.phase).toBe("introduction");
    expect(started.round).toBe(1);
    expect(started.revision).toBe(ready.revision + 1);
    expect(() => startGame(started)).toThrow(
      "A game can start only from preparation"
    );
  });

  it("rejects duplicate player identities", () => {
    expect(() =>
      createGame({
        gameId: "game-1",
        playerIds: ["player-1", "player-1", ...playerIds.slice(2)],
        playerRange: { max: 10, min: 6 },
        scenarioId: "operation-chalk",
        scenarioVersion: "0.1.0",
        seed: "seed"
      })
    ).toThrow("A Telegram user cannot occupy two places in one game");
  });

  it("rejects a player count outside the scenario range", () => {
    expect(() =>
      createGame({
        gameId: "game-1",
        playerIds: playerIds.slice(0, 5),
        playerRange: { max: 10, min: 6 },
        scenarioId: "operation-chalk",
        scenarioVersion: "0.1.0",
        seed: "seed"
      })
    ).toThrow("Player count must be between 6 and 10");
  });
});
