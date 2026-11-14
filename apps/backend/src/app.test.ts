import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type {
  CharacteristicId,
  MockGameView,
  PublicGameView
} from "@bunker/contracts";

import { buildApp } from "./app.js";
import {
  AuthSessionReplayError,
  type AuthSessionStore,
  type CreateAuthSessionInput
} from "./auth-sessions.js";
import {
  type LobbyStore,
  type LobbyStoreView
} from "./lobbies.js";
import {
  initialScenarioResources,
  operationChalkScenario
} from "./playtest-scenario.js";
import { createRealtimeHub } from "./realtime-hub.js";

const originServiceToken = "test-origin-token-with-enough-entropy";
const telegramBotToken =
  "123456789:AAExampleTokenForBunkerTestsOnly1234567890";

function createTelegramInitData(
  authDate: number,
  identity: {
    readonly firstName?: string;
    readonly id?: number;
    readonly queryId?: string;
    readonly username?: string;
  } = {}
) {
  const values = {
    auth_date: String(authDate),
    query_id: identity.queryId ?? "AAHdF6IQAAAAAN0XohDhrOrc",
    user: JSON.stringify({
      first_name: identity.firstName ?? "Олена",
      id: identity.id ?? 424_242,
      language_code: "uk",
      username: identity.username ?? "olena"
    })
  };
  const entries = Object.entries(values).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  const dataCheckString = entries
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData")
    .update(telegramBotToken)
    .digest();
  const hash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");
  const parameters = new URLSearchParams(entries);

  parameters.set("hash", hash);
  return parameters.toString();
}

function createMemoryAuthSessionStore(): AuthSessionStore {
  const sessions = new Map<string, CreateAuthSessionInput>();
  const initDataHashes = new Set<string>();

  return {
    close: () => Promise.resolve(),
    create: (input) => {
      if (initDataHashes.has(input.initDataHash)) {
        return Promise.reject(new AuthSessionReplayError());
      }

      initDataHashes.add(input.initDataHash);
      sessions.set(input.tokenHash, input);
      return Promise.resolve();
    },
    findUserByTokenHash: (tokenHash) => {
      const session = sessions.get(tokenHash);
      return Promise.resolve(
        session !== undefined && session.expiresAt > new Date()
          ? session.user
          : null
      );
    }
  };
}

function createMemoryLobbyStore(): LobbyStore {
  let lobby: LobbyStoreView | null = null;
  let finalOutcome: "all_survive" | "team_loss" | null = null;
  let phase: MockGameView["phase"] = "revealing";
  let turnStage: MockGameView["turnStage"] = "choosing";
  const revealed = new Map<string, Set<CharacteristicId>>();
  const votes = new Map<string, string>();

  const gameFor = (playerId: string): MockGameView | null => {
    if (
      lobby === null ||
      lobby.status !== "started" ||
      !lobby.players.some((player) => player.id === playerId)
    ) {
      return null;
    }

    const ownRevealed =
      revealed.get(playerId) ?? new Set<CharacteristicId>();
    return {
      bunkerCapacity: Math.ceil(lobby.players.length / 2),
      card: {
        description: "Додайте 2 одиниці енергії бази.",
        effectId: "resource.energy_gain",
        id: "generator-boost",
        kind: "action",
        title: "Форсаж генератора",
        used: false
      },
      cardChain: null,
      cardResult: null,
      characteristics: [
        {
          id: "profession",
          label: "Професія",
          revealed: ownRevealed.has("profession"),
          value: "Палеонтолог"
        },
        {
          id: "health",
          label: "Здоров’я",
          revealed: ownRevealed.has("health"),
          value: "Контрольована астма"
        }
      ],
      code: lobby.code,
      currentTurnPlayerId:
        phase === "revealing" ? lobby.hostPlayerId : null,
      demography: {
        eligibleMen: 1,
        eligibleWomen: 1,
        femaleAgeRange: { max: 49, min: 18 },
        maleAgeRange: { max: 64, min: 18 },
        preserved: true,
        requiredMen: 1,
        requiredWomen: 1
      },
      dossierNumber: 1,
      finalOutcome,
      hostPlayerId: lobby.hostPlayerId,
      lastEvent: null,
      phase,
      players: lobby.players.map((player) => ({
        characteristics: {
          ...(revealed.get(player.id)?.has("profession") === true
            ? {
                profession: player.isHost
                  ? "Палеонтолог"
                  : "Адміністратор чату ОСББ"
              }
            : {}),
          ...(revealed.get(player.id)?.has("health") === true
            ? { health: "Контрольована астма" }
            : {})
        },
        firstName: player.firstName,
        id: player.id,
        position: player.position,
        status: "active"
      })),
      rollback: {
        activeBranchId: "00000000-0000-4000-8000-000000000001",
        checkpoints: [],
        paused: false,
        proposal: null
      },
      round: 1,
      scenario: {
        ...operationChalkScenario,
        resources: initialScenarioResources
      },
      secretGoal: "Потрапте до бункера.",
      status: "started",
      turnDeadline:
        phase === "revealing" || phase === "discussion"
          ? new Date(Date.now() + 90_000).toISOString()
          : null,
      turnRevealedCharacteristicId: null,
      turnStage,
      voting:
        phase === "voting"
          ? {
              attempt: 1,
              candidatePlayerIds: lobby.players.map(
                (player) => player.id
              ),
              expected: lobby.players.length,
              hasVoted: votes.has(playerId),
              openVotes: [],
              silenced: false,
              submitted: votes.size,
              totals: []
            }
          : null
    };
  };

  return {
    begin: (_code, playerId) => {
      phase = "revealing";
      turnStage = "choosing";
      const game = gameFor(playerId);
      return game === null
        ? Promise.reject(new Error("Game is not started"))
        : Promise.resolve(game);
    },
    cancelRollback: (_code, playerId) => {
      const game = gameFor(playerId);
      return game === null
        ? Promise.reject(new Error("Game is not started"))
        : Promise.resolve(game);
    },
    close: () => Promise.resolve(),
    sweepStaleWaitingLobbies: () => Promise.resolve(0),
    create: (hostPlayerId) => {
      lobby ??= {
        code: "K7M4Q2",
        hostPlayerId,
        players: [
          {
            firstName: "Олена",
            id: hostPlayerId,
            isHost: true,
            position: 1,
            ready: false,
            username: "olena"
          }
        ],
        scenarioId: "operation-chalk",
        secretGoalsEnabled: true,
        status: "waiting"
      };
      return Promise.resolve(lobby);
    },
    findCurrent: (playerId) =>
      Promise.resolve(
        lobby?.players.some((player) => player.id === playerId) === true
          ? lobby
          : null
      ),
    findForPlayer: (code, playerId) =>
      Promise.resolve(
        lobby?.code === code &&
          lobby.players.some((player) => player.id === playerId)
          ? lobby
          : null
      ),
    findGame: (_code, playerId) => Promise.resolve(gameFor(playerId)),
    findPublicGame: (code) => {
      const game = lobby === null || lobby.code !== code
        ? null
        : gameFor(lobby.hostPlayerId);
      if (game === null) {
        return Promise.resolve(null);
      }
      return Promise.resolve({
        activeDeadline: game.turnDeadline,
        bunkerCapacity: game.bunkerCapacity,
        code: game.code,
        currentTurnPlayerId: game.currentTurnPlayerId,
        finalOutcome: game.finalOutcome,
        lastEvent: game.lastEvent,
        phase: game.phase,
        players: game.players,
        rollbackPaused: game.rollback.paused,
        round: game.round,
        scenario: game.scenario,
        status: game.status,
        turnDeadline: game.turnDeadline,
        turnRevealedCharacteristicId: game.turnRevealedCharacteristicId,
        turnStage: game.turnStage
      });
    },
    finishDiscussion: (_code, playerId) => {
      if (lobby?.hostPlayerId !== playerId || phase !== "discussion") {
        return Promise.reject(new Error("Cannot finish discussion"));
      }
      phase = "voting";
      turnStage = null;
      const game = gameFor(playerId);
      return game === null
        ? Promise.reject(new Error("Game is not started"))
        : Promise.resolve(game);
    },
    finishVoting: (_code, playerId) => {
      if (lobby?.hostPlayerId !== playerId || phase !== "voting") {
        return Promise.reject(new Error("Cannot finish voting"));
      }
      const game = gameFor(playerId);
      return game === null
        ? Promise.reject(new Error("Game is not started"))
        : Promise.resolve(game);
    },
    finishTurn: (_code, playerId) => {
      if (turnStage !== "speaking") {
        return Promise.reject(new Error("Cannot finish turn"));
      }
      phase = "discussion";
      turnStage = null;
      const game = gameFor(playerId);
      return game === null
        ? Promise.reject(new Error("Game is not started"))
        : Promise.resolve(game);
    },
    join: (_code, playerId) => {
      if (lobby === null) {
        return Promise.reject(new Error("Missing lobby"));
      }

      if (!lobby.players.some((player) => player.id === playerId)) {
        lobby = {
          ...lobby,
          players: [
            ...lobby.players,
            {
              firstName: "Максим",
              id: playerId,
              isHost: false,
              position: lobby.players.length + 1,
              ready: false,
              username: "maksym"
            }
          ]
        };
      }
      return Promise.resolve(lobby);
    },
    leave: (code, playerId) => {
      if (lobby === null || lobby.code !== code) {
        return Promise.reject(new Error("Missing lobby"));
      }
      if (lobby.hostPlayerId === playerId) {
        lobby = null;
        return Promise.resolve({ cancelled: true });
      }

      lobby = {
        ...lobby,
        players: lobby.players
          .filter((player) => player.id !== playerId)
          .map((player, index) => ({ ...player, position: index + 1 }))
      };
      return Promise.resolve({ cancelled: false });
    },
    proposeRollback: (_code, playerId) => {
      const game = gameFor(playerId);
      return game === null
        ? Promise.reject(new Error("Game is not started"))
        : Promise.resolve(game);
    },
    reveal: (_code, playerId, characteristicId) => {
      const playerRevealed =
        revealed.get(playerId) ??
        new Set<CharacteristicId>();
      revealed.set(
        playerId,
        new Set([...playerRevealed, characteristicId])
      );
      turnStage = "speaking";
      const game = gameFor(playerId);
      return game === null
        ? Promise.reject(new Error("Game is not started"))
        : Promise.resolve(game);
    },
    reactCard: (_code, playerId) => {
      const game = gameFor(playerId);
      return game === null
        ? Promise.reject(new Error("Game is not started"))
        : Promise.resolve(game);
    },
    reorder: (code, playerId, orderedPlayerIds) => {
      if (
        lobby === null ||
        lobby.code !== code ||
        lobby.hostPlayerId !== playerId
      ) {
        return Promise.reject(new Error("Cannot reorder lobby"));
      }
      lobby = {
        ...lobby,
        players: orderedPlayerIds.map((id, index) => {
          const player = lobby?.players.find((entry) => entry.id === id);
          if (player === undefined) {
            throw new Error("Missing player");
          }
          return { ...player, position: index + 1 };
        })
      };
      return Promise.resolve(lobby);
    },
    setReady: (code, playerId, ready) => {
      if (lobby === null || lobby.code !== code) {
        return Promise.reject(new Error("Missing lobby"));
      }

      lobby = {
        ...lobby,
        players: lobby.players.map((player) =>
          player.id === playerId ? { ...player, ready } : player
        )
      };
      return Promise.resolve(lobby);
    },
    setSecretGoalsEnabled: (code, playerId, enabled) => {
      if (
        lobby === null ||
        lobby.code !== code ||
        lobby.hostPlayerId !== playerId
      ) {
        return Promise.reject(new Error("Cannot toggle secret goals"));
      }

      lobby = { ...lobby, secretGoalsEnabled: enabled };
      return Promise.resolve(lobby);
    },
    resumeRollback: (_code, playerId) => {
      const game = gameFor(playerId);
      return game === null
        ? Promise.reject(new Error("Game is not started"))
        : Promise.resolve(game);
    },
    submitFinalOutcome: (_code, playerId, outcome) => {
      if (lobby?.hostPlayerId !== playerId || phase !== "final_check") {
        return Promise.reject(new Error("Cannot finalize"));
      }
      finalOutcome = outcome;
      phase = "completed";
      const game = gameFor(playerId);
      return game === null
        ? Promise.reject(new Error("Game is not started"))
        : Promise.resolve(game);
    },
    start: (code, playerId) => {
      if (
        lobby === null ||
        lobby.code !== code ||
        lobby.hostPlayerId !== playerId
      ) {
        return Promise.reject(new Error("Cannot start lobby"));
      }
      if (
        lobby.players.length < 4 ||
        lobby.players.length > 16 ||
        lobby.players.some((player) => !player.ready)
      ) {
        return Promise.reject(new Error("Lobby is not ready"));
      }

      lobby = {
        ...lobby,
        status: "started"
      };
      phase = "scenario_intro";
      turnStage = null;
      return Promise.resolve(lobby);
    },
    useCard: (_code, playerId) => {
      const game = gameFor(playerId);
      return game === null
        ? Promise.reject(new Error("Game is not started"))
        : Promise.resolve(game);
    },
    vote: (_code, playerId, targetPlayerId) => {
      votes.set(playerId, targetPlayerId);
      const game = gameFor(playerId);
      return game === null
        ? Promise.reject(new Error("Game is not started"))
        : Promise.resolve(game);
    },
    voteRollback: (_code, playerId) => {
      const game = gameFor(playerId);
      return game === null
        ? Promise.reject(new Error("Game is not started"))
        : Promise.resolve(game);
    }
  };
}

function createApp(
  authSessions = createMemoryAuthSessionStore(),
  lobbies = createMemoryLobbyStore()
) {
  return buildApp({
    authSessions,
    lobbies,
    originServiceToken,
    telegramBotToken
  });
}

async function authenticate(
  app: ReturnType<typeof createApp>,
  identity?: Parameters<typeof createTelegramInitData>[1]
) {
  const response = await app.inject({
    headers: {
      "x-bunker-origin-token": originServiceToken
    },
    method: "POST",
    payload: {
      initData: createTelegramInitData(
        Math.floor(Date.now() / 1000),
        identity
      )
    },
    url: "/api/auth/telegram"
  });
  const setCookie = response.headers["set-cookie"];
  if (typeof setCookie !== "string") {
    throw new Error("Expected the session cookie");
  }
  const cookie = setCookie.split(";")[0];
  if (cookie === undefined) {
    throw new Error("Expected the session cookie value");
  }

  return cookie;
}

describe("backend app", () => {
  it("publishes lobby changes without publishing read requests", async () => {
    const realtimeHub = createRealtimeHub();
    const listener = vi.fn();
    realtimeHub.subscribe("K7M4Q2", listener);
    const app = buildApp({
      authSessions: createMemoryAuthSessionStore(),
      lobbies: createMemoryLobbyStore(),
      originServiceToken,
      realtimeHub,
      telegramBotToken
    });
    const cookie = await authenticate(app);

    const created = await app.inject({
      headers: { cookie, "x-bunker-origin-token": originServiceToken },
      method: "POST",
      url: "/api/lobbies"
    });
    const read = await app.inject({
      headers: { cookie, "x-bunker-origin-token": originServiceToken },
      method: "GET",
      url: "/api/lobbies/K7M4Q2"
    });

    expect(created.statusCode).toBe(201);
    expect(read.statusCode).toBe(200);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({
      code: "K7M4Q2",
      revision: 1,
      type: "state_changed"
    });
    await app.close();
  });

  it("protects the realtime stream with origin and player sessions", async () => {
    const app = createApp();
    const noOrigin = await app.inject({
      method: "GET",
      url: "/api/realtime/K7M4Q2"
    });
    const noSession = await app.inject({
      headers: { "x-bunker-origin-token": originServiceToken },
      method: "GET",
      url: "/api/realtime/K7M4Q2"
    });
    const cookie = await authenticate(app);
    const notMember = await app.inject({
      headers: { cookie, "x-bunker-origin-token": originServiceToken },
      method: "GET",
      url: "/api/realtime/K7M4Q2"
    });

    expect(noOrigin.statusCode).toBe(401);
    expect(noSession.statusCode).toBe(401);
    expect(notMember.statusCode).toBe(403);
    await app.close();
  });

  it("streams lobby invalidations to an authenticated member", async () => {
    const realtimeHub = createRealtimeHub();
    const app = buildApp({
      authSessions: createMemoryAuthSessionStore(),
      lobbies: createMemoryLobbyStore(),
      originServiceToken,
      realtimeHub,
      telegramBotToken
    });
    const cookie = await authenticate(app);
    await app.inject({
      headers: { cookie, "x-bunker-origin-token": originServiceToken },
      method: "POST",
      url: "/api/lobbies"
    });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const controller = new AbortController();

    try {
      const response = await fetch(`${address}/api/realtime/K7M4Q2`, {
        headers: {
          cookie,
          "x-bunker-origin-token": originServiceToken
        },
        signal: controller.signal
      });
      const reader = response.body?.getReader();
      if (reader === undefined) {
        throw new Error("Expected a realtime response stream");
      }
      const decoder = new TextDecoder();
      const ready = await reader.read();
      expect(response.headers.get("content-type")).toContain(
        "text/event-stream"
      );
      expect(decoder.decode(ready.value)).toContain("event: ready");

      realtimeHub.publish("K7M4Q2");
      const update = await reader.read();
      expect(decoder.decode(update.value)).toContain(
        "event: state_changed"
      );
      await reader.cancel();
    } finally {
      controller.abort();
      await app.close();
    }
  });

  it("streams a projector invalidation without exposing player sessions", async () => {
    const realtimeHub = createRealtimeHub();
    const publicGame: PublicGameView = {
      activeDeadline: null,
      bunkerCapacity: 8,
      code: "K7M4Q2",
      currentTurnPlayerId: null,
      finalOutcome: null,
      lastEvent: null,
      phase: "scenario_intro",
      players: [],
      rollbackPaused: false,
      round: 1,
      scenario: {
        ...operationChalkScenario,
        resources: initialScenarioResources
      },
      status: "started",
      turnDeadline: null,
      turnRevealedCharacteristicId: null,
      turnStage: null
    };
    const baseStore = createMemoryLobbyStore();
    const findPublicGame = vi.fn().mockResolvedValue(publicGame);
    const app = buildApp({
      authSessions: createMemoryAuthSessionStore(),
      lobbies: {
        ...baseStore,
        findPublicGame
      },
      originServiceToken,
      realtimeHub,
      telegramBotToken
    });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const controller = new AbortController();

    try {
      const response = await fetch(
        `${address}/api/screens/K7M4Q2/realtime`,
        {
          headers: { "x-bunker-origin-token": originServiceToken },
          signal: controller.signal
        }
      );
      const reader = response.body?.getReader();
      if (reader === undefined) {
        throw new Error("Expected a public realtime response stream");
      }
      const decoder = new TextDecoder();
      const ready = await reader.read();
      expect(response.headers.get("content-type")).toContain(
        "text/event-stream"
      );
      expect(decoder.decode(ready.value)).toContain("event: ready");
      expect(findPublicGame).toHaveBeenCalledWith("K7M4Q2");

      realtimeHub.publish("K7M4Q2");
      const update = await reader.read();
      expect(decoder.decode(update.value)).toContain(
        "event: state_changed"
      );
      await reader.cancel();
    } finally {
      controller.abort();
      await app.close();
    }
  });

  it("keeps the edge request ID for backend log correlation", async () => {
    const app = createApp();
    const edgeRequestId = "550e8400-e29b-41d4-a716-446655440000";
    let backendRequestId: string | undefined;

    app.addHook("onRequest", (request, _reply, done) => {
      backendRequestId = request.id;
      done();
    });
    await app.inject({
      headers: {
        "x-request-id": edgeRequestId
      },
      method: "GET",
      url: "/health"
    });

    expect(backendRequestId).toBe(edgeRequestId);
    await app.close();
  });

  it("enables structured logs when requested by the production entrypoint", async () => {
    const app = buildApp({
      authSessions: createMemoryAuthSessionStore(),
      lobbies: createMemoryLobbyStore(),
      logger: true,
      originServiceToken,
      telegramBotToken
    });

    expect(app.log.level).toBe("info");
    await app.close();
  });

  it("fails fast when required backend secrets are too short", () => {
    expect(() =>
      buildApp({
        authSessions: createMemoryAuthSessionStore(),
        lobbies: createMemoryLobbyStore(),
        originServiceToken: "short",
        telegramBotToken
      })
    ).toThrowError("ORIGIN_SERVICE_TOKEN");
    expect(() =>
      buildApp({
        authSessions: createMemoryAuthSessionStore(),
        lobbies: createMemoryLobbyStore(),
        originServiceToken,
        telegramBotToken: "short"
      })
    ).toThrowError("TELEGRAM_BOT_TOKEN");
  });

  it("reports service health without exposing infrastructure details", async () => {
    const app = createApp();
    const response = await app.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        service: "bunker-backend",
        status: "ok"
      },
      success: true
    });

    await app.close();
  });

  it("calculates the agreed ceil-half capacity for a corporate party", async () => {
    const app = createApp();
    const response = await app.inject({
      headers: {
        "x-bunker-origin-token": originServiceToken
      },
      method: "POST",
      payload: {
        playerCount: 16
      },
      url: "/api/games/preview"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        bunkerCapacity: 8,
        playerCount: 16
      },
      success: true
    });

    await app.close();
  });

  it("rejects player counts outside the supported range", async () => {
    const app = createApp();
    const response = await app.inject({
      headers: {
        "x-bunker-origin-token": originServiceToken
      },
      method: "POST",
      payload: {
        playerCount: 3
      },
      url: "/api/games/preview"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR"
      },
      success: false
    });

    await app.close();
  });

  it("rejects API calls that did not come through the edge worker", async () => {
    const app = createApp();
    const response = await app.inject({
      method: "POST",
      payload: {
        playerCount: 7
      },
      url: "/api/games/preview"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: {
        code: "UNAUTHORIZED_ORIGIN",
        message: "Недійсний канал доступу"
      },
      success: false
    });

    await app.close();
  });

  it("verifies Telegram Mini App initData at the backend boundary", async () => {
    const app = createApp();
    const authDate = Math.floor(Date.now() / 1000) - 30;
    const response = await app.inject({
      headers: {
        "x-bunker-origin-token": originServiceToken
      },
      method: "POST",
      payload: {
        initData: createTelegramInitData(authDate)
      },
      url: "/api/auth/telegram"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        authDate,
        user: {
          firstName: "Олена",
          id: "424242",
          languageCode: "uk",
          username: "olena"
        }
      },
      success: true
    });
    expect(response.headers["set-cookie"]).toMatch(
      /^__Host-bunker_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800$/u
    );

    await app.close();
  });

  it("restores the Telegram user from an HttpOnly server session", async () => {
    const app = createApp();
    const authResponse = await app.inject({
      headers: {
        "x-bunker-origin-token": originServiceToken
      },
      method: "POST",
      payload: {
        initData: createTelegramInitData(Math.floor(Date.now() / 1000))
      },
      url: "/api/auth/telegram"
    });
    const setCookie = authResponse.headers["set-cookie"];
    if (typeof setCookie !== "string") {
      throw new Error("Expected the session cookie");
    }
    const cookie = setCookie.split(";")[0];
    if (cookie === undefined) {
      throw new Error("Expected the session cookie value");
    }

    const response = await app.inject({
      headers: {
        cookie,
        "x-bunker-origin-token": originServiceToken
      },
      method: "GET",
      url: "/api/auth/session"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        user: {
          firstName: "Олена",
          id: "424242",
          languageCode: "uk",
          username: "olena"
        }
      },
      success: true
    });

    await app.close();
  });

  it("rejects a missing or malformed session cookie", async () => {
    const app = createApp();
    const response = await app.inject({
      headers: {
        cookie: "__Host-bunker_session=not-a-token",
        "x-bunker-origin-token": originServiceToken
      },
      method: "GET",
      url: "/api/auth/session"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: {
        code: "SESSION_REQUIRED",
        message: "Потрібно увійти через Telegram"
      },
      success: false
    });

    await app.close();
  });

  it("rejects repeated use of the same Telegram initData", async () => {
    const app = createApp();
    const initData = createTelegramInitData(Math.floor(Date.now() / 1000));
    const request = {
      headers: {
        "x-bunker-origin-token": originServiceToken
      },
      method: "POST" as const,
      payload: {
        initData
      },
      url: "/api/auth/telegram"
    };

    expect((await app.inject(request)).statusCode).toBe(200);
    const replay = await app.inject(request);

    expect(replay.statusCode).toBe(409);
    expect(replay.json()).toEqual({
      error: {
        code: "REPLAYED_TELEGRAM_INIT_DATA",
        message: "Ці дані Telegram уже були використані"
      },
      success: false
    });

    await app.close();
  });

  it("creates a lobby for the authenticated player as host", async () => {
    const app = createApp();
    const cookie = await authenticate(app);
    const response = await app.inject({
      headers: {
        cookie,
        "x-bunker-origin-token": originServiceToken
      },
      method: "POST",
      url: "/api/lobbies"
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      data: {
        lobby: {
          code: "K7M4Q2",
          hostPlayerId: "424242",
          players: [
            {
              firstName: "Олена",
              id: "424242",
              isHost: true,
              position: 1,
              ready: false,
              username: "olena"
            }
          ],
          scenarioId: "operation-chalk",
          secretGoalsEnabled: true,
          status: "waiting"
        }
      },
      success: true
    });

    await app.close();
  });

  it("lets another authenticated player join by lobby code", async () => {
    const authSessions = createMemoryAuthSessionStore();
    const lobbies = createMemoryLobbyStore();
    const app = createApp(authSessions, lobbies);
    const hostCookie = await authenticate(app);
    await app.inject({
      headers: {
        cookie: hostCookie,
        "x-bunker-origin-token": originServiceToken
      },
      method: "POST",
      url: "/api/lobbies"
    });
    const playerCookie = await authenticate(app, {
      firstName: "Максим",
      id: 525_252,
      queryId: "BBHdF6IQAAAAAN0XohDhrOrc",
      username: "maksym"
    });

    const response = await app.inject({
      headers: {
        cookie: playerCookie,
        "x-bunker-origin-token": originServiceToken
      },
      method: "POST",
      payload: {
        code: "k7m4q2"
      },
      url: "/api/lobbies/join"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        lobby: {
          code: "K7M4Q2",
          hostPlayerId: "424242",
          players: [
            {
              id: "424242",
              isHost: true,
              position: 1
            },
            {
              id: "525252",
              isHost: false,
              position: 2
            }
          ]
        }
      },
      success: true
    });

    await app.close();
  });

  it("persists readiness and restores the current lobby", async () => {
    const app = createApp();
    const cookie = await authenticate(app);
    await app.inject({
      headers: {
        cookie,
        "x-bunker-origin-token": originServiceToken
      },
      method: "POST",
      url: "/api/lobbies"
    });
    const ready = await app.inject({
      headers: {
        cookie,
        "x-bunker-origin-token": originServiceToken
      },
      method: "PUT",
      payload: {
        ready: true
      },
      url: "/api/lobbies/K7M4Q2/readiness"
    });

    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({
      data: {
        lobby: {
          players: [
            {
              id: "424242",
              ready: true
            }
          ]
        }
      }
    });

    const current = await app.inject({
      headers: {
        cookie,
        "x-bunker-origin-token": originServiceToken
      },
      method: "GET",
      url: "/api/lobbies/current"
    });

    expect(current.statusCode).toBe(200);
    expect(current.json()).toMatchObject({
      data: {
        lobby: {
          code: "K7M4Q2"
        }
      },
      success: true
    });

    await app.close();
  });

  it("lets the host toggle secret goals for the lobby", async () => {
    const app = createApp();
    const cookie = await authenticate(app);
    await app.inject({
      headers: {
        cookie,
        "x-bunker-origin-token": originServiceToken
      },
      method: "POST",
      url: "/api/lobbies"
    });
    const toggled = await app.inject({
      headers: {
        cookie,
        "x-bunker-origin-token": originServiceToken
      },
      method: "PUT",
      payload: {
        enabled: false
      },
      url: "/api/lobbies/K7M4Q2/secret-goals"
    });

    expect(toggled.statusCode).toBe(200);
    expect(toggled.json()).toMatchObject({
      data: {
        lobby: {
          secretGoalsEnabled: false
        }
      }
    });

    await app.close();
  });

  it("requires a Telegram session for lobby actions", async () => {
    const app = createApp();
    const response = await app.inject({
      headers: {
        "x-bunker-origin-token": originServiceToken
      },
      method: "POST",
      url: "/api/lobbies"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: {
        code: "SESSION_REQUIRED"
      },
      success: false
    });

    await app.close();
  });

  it("rejects a rollback reason that is empty after trimming", async () => {
    const app = createApp();
    const cookie = await authenticate(app);
    const response = await app.inject({
      headers: {
        cookie,
        "x-bunker-origin-token": originServiceToken
      },
      method: "POST",
      payload: {
        checkpointId: "00000000-0000-4000-8000-000000000002",
        reason: "   "
      },
      url: "/api/games/K7M4Q2/rollback"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: "INVALID_ROLLBACK_REASON"
      },
      success: false
    });

    await app.close();
  });

  it("lets the host cancel the lobby", async () => {
    const app = createApp();
    const cookie = await authenticate(app);
    await app.inject({
      headers: {
        cookie,
        "x-bunker-origin-token": originServiceToken
      },
      method: "POST",
      url: "/api/lobbies"
    });

    const response = await app.inject({
      headers: {
        cookie,
        "x-bunker-origin-token": originServiceToken
      },
      method: "DELETE",
      url: "/api/lobbies/K7M4Q2"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        cancelled: true
      },
      success: true
    });

    await app.close();
  });

  it("lets a regular player leave without cancelling the lobby", async () => {
    const authSessions = createMemoryAuthSessionStore();
    const lobbies = createMemoryLobbyStore();
    const app = createApp(authSessions, lobbies);
    const hostCookie = await authenticate(app);
    await app.inject({
      headers: {
        cookie: hostCookie,
        "x-bunker-origin-token": originServiceToken
      },
      method: "POST",
      url: "/api/lobbies"
    });
    const playerCookie = await authenticate(app, {
      firstName: "Максим",
      id: 525_252,
      queryId: "BBHdF6IQAAAAAN0XohDhrOrc",
      username: "maksym"
    });
    await app.inject({
      headers: {
        cookie: playerCookie,
        "x-bunker-origin-token": originServiceToken
      },
      method: "POST",
      payload: {
        code: "K7M4Q2"
      },
      url: "/api/lobbies/join"
    });

    const response = await app.inject({
      headers: {
        cookie: playerCookie,
        "x-bunker-origin-token": originServiceToken
      },
      method: "DELETE",
      url: "/api/lobbies/K7M4Q2"
    });

    expect(response.json()).toEqual({
      data: {
        cancelled: false
      },
      success: true
    });
    expect(await lobbies.findCurrent("424242")).toMatchObject({
      code: "K7M4Q2",
      players: [
        {
          id: "424242",
          position: 1
        }
      ]
    });

    await app.close();
  });

  it("starts a four-player playtest with every dossier private", async () => {
    const app = createApp();
    const hostCookie = await authenticate(app);
    await app.inject({
      headers: {
        cookie: hostCookie,
        "x-bunker-origin-token": originServiceToken
      },
      method: "POST",
      url: "/api/lobbies"
    });
    const playerCookie = await authenticate(app, {
      firstName: "Максим",
      id: 525_252,
      queryId: "BBHdF6IQAAAAAN0XohDhrOrc",
      username: "maksym"
    });
    await app.inject({
      headers: {
        cookie: playerCookie,
        "x-bunker-origin-token": originServiceToken
      },
      method: "POST",
      payload: { code: "K7M4Q2" },
      url: "/api/lobbies/join"
    });
    const additionalCookies = [];
    for (const identity of [
      {
        firstName: "Ірина",
        id: 626_262,
        queryId: "CCHdF6IQAAAAAN0XohDhrOrc",
        username: "iryna"
      },
      {
        firstName: "Данило",
        id: 727_272,
        queryId: "DDHdF6IQAAAAAN0XohDhrOrc",
        username: "danylo"
      }
    ]) {
      const cookie = await authenticate(app, identity);
      additionalCookies.push(cookie);
      await app.inject({
        headers: {
          cookie,
          "x-bunker-origin-token": originServiceToken
        },
        method: "POST",
        payload: { code: "K7M4Q2" },
        url: "/api/lobbies/join"
      });
    }
    for (const cookie of [
      hostCookie,
      playerCookie,
      ...additionalCookies
    ]) {
      await app.inject({
        headers: {
          cookie,
          "x-bunker-origin-token": originServiceToken
        },
        method: "PUT",
        payload: { ready: true },
        url: "/api/lobbies/K7M4Q2/readiness"
      });
    }

    const response = await app.inject({
      headers: {
        cookie: hostCookie,
        "x-bunker-origin-token": originServiceToken
      },
      method: "POST",
      url: "/api/lobbies/K7M4Q2/start"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        lobby: {
          code: "K7M4Q2",
          status: "started"
        }
      },
      success: true
    });

    const gameResponse = await app.inject({
      headers: {
        cookie: playerCookie,
        "x-bunker-origin-token": originServiceToken
      },
      method: "GET",
      url: "/api/games/K7M4Q2"
    });
    expect(gameResponse.statusCode).toBe(200);
    expect(gameResponse.json()).toMatchObject({
      data: {
        game: {
          bunkerCapacity: 2,
          code: "K7M4Q2",
          currentTurnPlayerId: null,
          phase: "scenario_intro",
          players: [
            { characteristics: {} },
            { characteristics: {} },
            { characteristics: {} },
            { characteristics: {} }
          ],
          status: "started"
        }
      }
    });

    const sharedScreenResponse = await app.inject({
      headers: {
        "x-bunker-origin-token": originServiceToken
      },
      method: "GET",
      url: "/api/screens/K7M4Q2"
    });
    expect(sharedScreenResponse.statusCode).toBe(200);
    expect(sharedScreenResponse.json()).toMatchObject({
      data: {
        game: {
          bunkerCapacity: 2,
          code: "K7M4Q2",
          phase: "scenario_intro",
          status: "started"
        }
      },
      success: true
    });
    expect(sharedScreenResponse.body).toContain('"characteristics":{}');
    expect(sharedScreenResponse.body).not.toContain("secretGoal");
    expect(sharedScreenResponse.body).not.toContain("special_card");

    const beginResponse = await app.inject({
      headers: {
        cookie: hostCookie,
        "x-bunker-origin-token": originServiceToken
      },
      method: "POST",
      url: "/api/games/K7M4Q2/begin"
    });
    expect(beginResponse.statusCode).toBe(200);
    expect(beginResponse.json()).toMatchObject({
      data: {
        game: {
          currentTurnPlayerId: "424242",
          phase: "revealing"
        }
      }
    });

    const cardResponse = await app.inject({
      headers: {
        cookie: hostCookie,
        "x-bunker-origin-token": originServiceToken
      },
      method: "POST",
      payload: {},
      url: "/api/games/K7M4Q2/cards/use"
    });
    expect(cardResponse.statusCode).toBe(200);

    const revealResponse = await app.inject({
      headers: {
        cookie: playerCookie,
        "x-bunker-origin-token": originServiceToken
      },
      method: "POST",
      payload: { characteristicId: "health" },
      url: "/api/games/K7M4Q2/reveal"
    });
    expect(revealResponse.statusCode).toBe(200);
    expect(revealResponse.body).toContain('"id":"health"');
    expect(revealResponse.body).toContain(
      '"id":"health","label":"Здоров’я","revealed":true'
    );
    const finishTurnResponse = await app.inject({
      headers: {
        cookie: playerCookie,
        "x-bunker-origin-token": originServiceToken
      },
      method: "POST",
      url: "/api/games/K7M4Q2/finish-turn"
    });
    expect(finishTurnResponse.statusCode).toBe(200);
    expect(finishTurnResponse.json()).toMatchObject({
      data: { game: { phase: "discussion" } }
    });
    const finishDiscussionResponse = await app.inject({
      headers: {
        cookie: hostCookie,
        "x-bunker-origin-token": originServiceToken
      },
      method: "POST",
      url: "/api/games/K7M4Q2/finish-discussion"
    });
    expect(finishDiscussionResponse.statusCode).toBe(200);
    expect(finishDiscussionResponse.json()).toMatchObject({
      data: { game: { phase: "voting" } }
    });

    const invalidReveal = await app.inject({
      headers: {
        cookie: playerCookie,
        "x-bunker-origin-token": originServiceToken
      },
      method: "POST",
      payload: { characteristicId: "password" },
      url: "/api/games/K7M4Q2/reveal"
    });
    expect(invalidReveal.statusCode).toBe(400);

    await app.close();
  });

  it("rejects invalid Telegram Mini App initData", async () => {
    const app = createApp();
    const response = await app.inject({
      headers: {
        "x-bunker-origin-token": originServiceToken
      },
      method: "POST",
      payload: {
        initData: `${createTelegramInitData(Math.floor(Date.now() / 1000))}x`
      },
      url: "/api/auth/telegram"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: {
        code: "INVALID_TELEGRAM_INIT_DATA",
        message: "Не вдалося підтвердити Telegram-користувача"
      },
      success: false
    });

    await app.close();
  });

  it("rejects expired Telegram Mini App initData with a restart hint", async () => {
    const app = createApp();
    const response = await app.inject({
      headers: {
        "x-bunker-origin-token": originServiceToken
      },
      method: "POST",
      payload: {
        initData: createTelegramInitData(Math.floor(Date.now() / 1000) - 301)
      },
      url: "/api/auth/telegram"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: {
        code: "EXPIRED_TELEGRAM_INIT_DATA",
        message: "Сесію Telegram потрібно відкрити повторно"
      },
      success: false
    });

    await app.close();
  });
});
