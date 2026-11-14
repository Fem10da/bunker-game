import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import type { ServerResponse } from "node:http";

import Fastify, {
  type FastifyError,
  type FastifyInstance
} from "fastify";

import {
  CHARACTERISTIC_CATEGORIES,
  MAX_GAME_PLAYERS,
  MIN_GAME_PLAYERS,
  type CharacteristicId,
  type PlaytestCardSelection,
  type TeamOutcome
} from "@bunker/contracts";
import { calculateBunkerCapacity } from "@bunker/game-engine";

import {
  AuthSessionReplayError,
  type AuthSessionStore
} from "./auth-sessions.js";
import { GameRollbackError } from "./game-rollback.js";
import {
  LobbyStoreError,
  type LobbyStore
} from "./lobbies.js";
import {
  createRealtimeHub,
  formatRealtimeEvent,
  type RealtimeHub
} from "./realtime-hub.js";
import {
  TelegramInitDataError,
  verifyTelegramInitData
} from "./telegram-init-data.js";

interface PreviewBody {
  readonly playerCount: number;
}

interface TelegramAuthBody {
  readonly initData: string;
}

interface JoinLobbyBody {
  readonly code: string;
}

interface LobbyReadinessBody {
  readonly ready: boolean;
}

interface LobbySecretGoalsBody {
  readonly enabled: boolean;
}

interface LobbyOrderBody {
  readonly playerIds: readonly string[];
}

interface RevealCharacteristicBody {
  readonly characteristicId: CharacteristicId;
}

interface SubmitFinalOutcomeBody {
  readonly outcome: TeamOutcome;
}

interface VoteBody {
  readonly targetPlayerId: string;
  readonly votingAttempt: number;
}

interface FinishVotingBody {
  readonly votingAttempt: number;
}

interface ProposeRollbackBody {
  readonly checkpointId: string;
  readonly reason: string;
}

interface RollbackVoteBody {
  readonly approve: boolean;
  readonly proposalId: string;
}

interface RollbackCancelBody {
  readonly proposalId: string;
}

interface BuildAppOptions {
  readonly authSessions: AuthSessionStore;
  readonly lobbies: LobbyStore;
  readonly logger?: boolean;
  readonly originServiceToken: string;
  readonly realtimeHub?: RealtimeHub;
  readonly telegramBotToken: string;
}

const sessionCookieName = "__Host-bunker_session";
const sessionMaxAgeSeconds = 7 * 24 * 60 * 60;
const sessionTokenPattern = /^[A-Za-z0-9_-]{43}$/u;
const requestIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function readSessionToken(cookieHeader: string | undefined) {
  if (cookieHeader === undefined) {
    return undefined;
  }

  for (const part of cookieHeader.split(";")) {
    const [name, value] = part.trim().split("=", 2);
    if (name === sessionCookieName && sessionTokenPattern.test(value ?? "")) {
      return value;
    }
  }

  return undefined;
}

function sessionRequired() {
  return {
    error: {
      code: "SESSION_REQUIRED",
      message: "Потрібно увійти через Telegram"
    },
    success: false
  };
}

async function findAuthenticatedUser(
  authSessions: AuthSessionStore,
  cookieHeader: string | undefined
) {
  const token = readSessionToken(cookieHeader);
  return token === undefined
    ? null
    : authSessions.findUserByTokenHash(sha256(token));
}

function lobbyResponse(lobby: Awaited<ReturnType<LobbyStore["create"]>>) {
  return {
    data: {
      lobby
    },
    success: true
  };
}

function gameResponse(game: Awaited<ReturnType<LobbyStore["reveal"]>>) {
  return {
    data: {
      game
    },
    success: true
  };
}

function publicGameResponse(
  game: NonNullable<Awaited<ReturnType<LobbyStore["findPublicGame"]>>>
) {
  return {
    data: {
      game
    },
    success: true
  };
}

function updatedLobbyResponse(
  lobby: Awaited<ReturnType<LobbyStore["create"]>>,
  realtimeHub: RealtimeHub
) {
  realtimeHub.publish(lobby.code);
  return lobbyResponse(lobby);
}

function updatedGameResponse(
  game: Awaited<ReturnType<LobbyStore["reveal"]>>,
  realtimeHub: RealtimeHub
) {
  realtimeHub.publish(game.code);
  return gameResponse(game);
}

function matchesServiceToken(
  actual: string | readonly string[] | undefined,
  expected: string
) {
  if (typeof actual !== "string") {
    return false;
  }

  const actualHash = createHash("sha256").update(actual).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

function validationError(error: FastifyError) {
  return {
    error: {
      code: "VALIDATION_ERROR",
      message: error.message
    },
    success: false
  };
}

function isValidationError(error: unknown): error is FastifyError {
  return error instanceof Error && "validation" in error;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  if (options.originServiceToken.length < 24) {
    throw new Error("ORIGIN_SERVICE_TOKEN must contain at least 24 characters");
  }
  if (options.telegramBotToken.length < 32) {
    throw new Error("TELEGRAM_BOT_TOKEN must contain at least 32 characters");
  }

  const app = Fastify({
    genReqId: (request) => {
      const requestId = request.headers["x-request-id"];
      return typeof requestId === "string" && requestIdPattern.test(requestId)
        ? requestId
        : randomUUID();
    },
    logger: options.logger ?? false
  });
  const realtimeHub = options.realtimeHub ?? createRealtimeHub();
  const realtimeConnections = new Map<string, ServerResponse>();

  app.addHook("onClose", async () => {
    for (const connection of realtimeConnections.values()) {
      connection.end();
    }
    realtimeConnections.clear();
    await Promise.all([
      options.authSessions.close(),
      options.lobbies.close()
    ]);
  });

  app.addHook("onRequest", (request, reply, done) => {
    if (
      request.url.startsWith("/api/") &&
      !matchesServiceToken(
        request.headers["x-bunker-origin-token"],
        options.originServiceToken
      )
    ) {
      void reply.status(401).send({
        error: {
          code: "UNAUTHORIZED_ORIGIN",
          message: "Недійсний канал доступу"
        },
        success: false
      });
      return;
    }

    done();
  });

  app.get("/health", () => ({
    data: {
      service: "bunker-backend",
      status: "ok"
    },
    success: true
  }));

  app.post<{ Body: PreviewBody }>(
    "/api/games/preview",
    {
      schema: {
        body: {
          additionalProperties: false,
          properties: {
            playerCount: {
              maximum: MAX_GAME_PLAYERS,
              minimum: MIN_GAME_PLAYERS,
              type: "integer"
            }
          },
          required: ["playerCount"],
          type: "object"
        }
      }
    },
    (request) => ({
      data: {
        bunkerCapacity: calculateBunkerCapacity(request.body.playerCount),
        playerCount: request.body.playerCount
      },
      success: true
    })
  );

  app.post<{ Body: TelegramAuthBody }>(
    "/api/auth/telegram",
    {
      schema: {
        body: {
          additionalProperties: false,
          properties: {
            initData: {
              maxLength: 16_384,
              minLength: 1,
              type: "string"
            }
          },
          required: ["initData"],
          type: "object"
        }
      }
    },
    async (request, reply) => {
      const verified = verifyTelegramInitData({
        botToken: options.telegramBotToken,
        initData: request.body.initData,
        maxAgeSeconds: 300
      });
      const sessionToken = randomBytes(32).toString("base64url");

      await options.authSessions.create({
        expiresAt: new Date(Date.now() + sessionMaxAgeSeconds * 1000),
        initDataHash: sha256(request.body.initData),
        tokenHash: sha256(sessionToken),
        user: verified.user
      });
      reply.header(
        "set-cookie",
        `${sessionCookieName}=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${sessionMaxAgeSeconds}`
      );

      return {
        data: {
          authDate: verified.authDate,
          ...(verified.startParam === undefined
            ? {}
            : { startParam: verified.startParam }),
          user: verified.user
        },
        success: true
      };
    }
  );

  app.get("/api/auth/session", async (request, reply) => {
    const user = await findAuthenticatedUser(
      options.authSessions,
      request.headers.cookie
    );
    if (user === null) {
      return reply.status(401).send(sessionRequired());
    }

    return {
      data: {
        user
      },
      success: true
    };
  });

  app.get<{ Params: { readonly code: string } }>(
    "/api/screens/:code",
    {
      schema: {
        params: {
          additionalProperties: false,
          properties: {
            code: {
              maxLength: 6,
              minLength: 6,
              pattern: "^[A-Za-z0-9]{6}$",
              type: "string"
            }
          },
          required: ["code"],
          type: "object"
        }
      }
    },
    async (request) => {
      const game = await options.lobbies.findPublicGame(
        request.params.code.toUpperCase()
      );
      if (game === null) {
        throw new LobbyStoreError("LOBBY_NOT_FOUND");
      }
      return publicGameResponse(game);
    }
  );

  app.get<{ Params: { readonly code: string } }>(
    "/api/screens/:code/realtime",
    {
      schema: {
        params: {
          additionalProperties: false,
          properties: {
            code: {
              maxLength: 6,
              minLength: 6,
              pattern: "^[A-Za-z0-9]{6}$",
              type: "string"
            }
          },
          required: ["code"],
          type: "object"
        }
      }
    },
    async (request, reply) => {
      const code = request.params.code.toUpperCase();
      const game = await options.lobbies.findPublicGame(code);
      if (game === null) {
        throw new LobbyStoreError("LOBBY_NOT_FOUND");
      }
      const connectionKey = `screen:${code}:${randomUUID()}`;

      reply.hijack();
      reply.raw.writeHead(200, {
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "content-type": "text/event-stream; charset=utf-8",
        "x-accel-buffering": "no"
      });
      reply.raw.flushHeaders();
      realtimeConnections.set(connectionKey, reply.raw);

      const unsubscribe = realtimeHub.subscribe(code, (event) => {
        reply.raw.write(formatRealtimeEvent(event));
      });
      const heartbeat = setInterval(() => {
        reply.raw.write(": keep-alive\n\n");
      }, 15_000);
      heartbeat.unref();
      let closed = false;
      const close = () => {
        if (closed) {
          return;
        }
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        if (realtimeConnections.get(connectionKey) === reply.raw) {
          realtimeConnections.delete(connectionKey);
        }
      };
      reply.raw.once("close", close);
      reply.raw.once("error", close);
      reply.raw.write(
        `event: ready\ndata: ${JSON.stringify({ code })}\n\n`
      );
      return reply;
    }
  );

  app.get<{ Params: { readonly code: string } }>(
    "/api/realtime/:code",
    {
      schema: {
        params: {
          additionalProperties: false,
          properties: {
            code: {
              maxLength: 6,
              minLength: 6,
              pattern: "^[A-Za-z0-9]{6}$",
              type: "string"
            }
          },
          required: ["code"],
          type: "object"
        }
      }
    },
    async (request, reply) => {
      const user = await findAuthenticatedUser(
        options.authSessions,
        request.headers.cookie
      );
      if (user === null) {
        return reply.status(401).send(sessionRequired());
      }
      const code = request.params.code.toUpperCase();
      const lobby = await options.lobbies.findForPlayer(code, user.id);
      if (lobby === null) {
        throw new LobbyStoreError("NOT_A_LOBBY_MEMBER");
      }
      const connectionKey = `${code}:${user.id}`;
      realtimeConnections.get(connectionKey)?.end();

      reply.hijack();
      reply.raw.writeHead(200, {
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "content-type": "text/event-stream; charset=utf-8",
        "x-accel-buffering": "no"
      });
      reply.raw.flushHeaders();
      realtimeConnections.set(connectionKey, reply.raw);

      const unsubscribe = realtimeHub.subscribe(code, (event) => {
        reply.raw.write(formatRealtimeEvent(event));
      });
      const heartbeat = setInterval(() => {
        reply.raw.write(": keep-alive\n\n");
      }, 15_000);
      heartbeat.unref();
      let closed = false;
      const close = () => {
        if (closed) {
          return;
        }
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        if (realtimeConnections.get(connectionKey) === reply.raw) {
          realtimeConnections.delete(connectionKey);
        }
      };
      reply.raw.once("close", close);
      reply.raw.once("error", close);
      reply.raw.write(
        `event: ready\ndata: ${JSON.stringify({ code })}\n\n`
      );
      return reply;
    }
  );

  app.post("/api/lobbies", async (request, reply) => {
    const user = await findAuthenticatedUser(
      options.authSessions,
      request.headers.cookie
    );
    if (user === null) {
      return reply.status(401).send(sessionRequired());
    }

    const lobby = await options.lobbies.create(user.id);
    return reply
      .status(201)
      .send(updatedLobbyResponse(lobby, realtimeHub));
  });

  app.get("/api/lobbies/current", async (request, reply) => {
    const user = await findAuthenticatedUser(
      options.authSessions,
      request.headers.cookie
    );
    if (user === null) {
      return reply.status(401).send(sessionRequired());
    }

    return {
      data: {
        lobby: await options.lobbies.findCurrent(user.id)
      },
      success: true
    };
  });

  app.post<{ Body: JoinLobbyBody }>(
    "/api/lobbies/join",
    {
      schema: {
        body: {
          additionalProperties: false,
          properties: {
            code: {
              maxLength: 6,
              minLength: 6,
              pattern: "^[A-Za-z0-9]{6}$",
              type: "string"
            }
          },
          required: ["code"],
          type: "object"
        }
      }
    },
    async (request, reply) => {
      const user = await findAuthenticatedUser(
        options.authSessions,
        request.headers.cookie
      );
      if (user === null) {
        return reply.status(401).send(sessionRequired());
      }

      const lobby = await options.lobbies.join(
        request.body.code.toUpperCase(),
        user.id
      );
      return updatedLobbyResponse(lobby, realtimeHub);
    }
  );

  app.get<{ Params: { readonly code: string } }>(
    "/api/lobbies/:code",
    {
      schema: {
        params: {
          additionalProperties: false,
          properties: {
            code: {
              maxLength: 6,
              minLength: 6,
              pattern: "^[A-Za-z0-9]{6}$",
              type: "string"
            }
          },
          required: ["code"],
          type: "object"
        }
      }
    },
    async (request, reply) => {
      const user = await findAuthenticatedUser(
        options.authSessions,
        request.headers.cookie
      );
      if (user === null) {
        return reply.status(401).send(sessionRequired());
      }

      const lobby = await options.lobbies.findForPlayer(
        request.params.code.toUpperCase(),
        user.id
      );
      if (lobby === null) {
        throw new LobbyStoreError("NOT_A_LOBBY_MEMBER");
      }
      return lobbyResponse(lobby);
    }
  );

  app.delete<{ Params: { readonly code: string } }>(
    "/api/lobbies/:code",
    {
      schema: {
        params: {
          additionalProperties: false,
          properties: {
            code: {
              maxLength: 6,
              minLength: 6,
              pattern: "^[A-Za-z0-9]{6}$",
              type: "string"
            }
          },
          required: ["code"],
          type: "object"
        }
      }
    },
    async (request, reply) => {
      const user = await findAuthenticatedUser(
        options.authSessions,
        request.headers.cookie
      );
      if (user === null) {
        return reply.status(401).send(sessionRequired());
      }

      const result = await options.lobbies.leave(
        request.params.code.toUpperCase(),
        user.id
      );
      realtimeHub.publish(request.params.code.toUpperCase());
      return {
        data: result,
        success: true
      };
    }
  );

  app.put<{
    Body: LobbyOrderBody;
    Params: { readonly code: string };
  }>(
    "/api/lobbies/:code/order",
    {
      schema: {
        body: {
          additionalProperties: false,
          properties: {
            playerIds: {
              items: {
                maxLength: 20,
                minLength: 1,
                pattern: "^[0-9]+$",
                type: "string"
              },
              maxItems: MAX_GAME_PLAYERS,
              minItems: 1,
              type: "array"
            }
          },
          required: ["playerIds"],
          type: "object"
        },
        params: {
          additionalProperties: false,
          properties: {
            code: {
              maxLength: 6,
              minLength: 6,
              pattern: "^[A-Za-z0-9]{6}$",
              type: "string"
            }
          },
          required: ["code"],
          type: "object"
        }
      }
    },
    async (request, reply) => {
      const user = await findAuthenticatedUser(
        options.authSessions,
        request.headers.cookie
      );
      if (user === null) {
        return reply.status(401).send(sessionRequired());
      }
      return updatedLobbyResponse(
        await options.lobbies.reorder(
          request.params.code.toUpperCase(),
          user.id,
          request.body.playerIds
        ),
        realtimeHub
      );
    }
  );

  app.put<{
    Body: LobbyReadinessBody;
    Params: { readonly code: string };
  }>(
    "/api/lobbies/:code/readiness",
    {
      schema: {
        body: {
          additionalProperties: false,
          properties: {
            ready: {
              type: "boolean"
            }
          },
          required: ["ready"],
          type: "object"
        },
        params: {
          additionalProperties: false,
          properties: {
            code: {
              maxLength: 6,
              minLength: 6,
              pattern: "^[A-Za-z0-9]{6}$",
              type: "string"
            }
          },
          required: ["code"],
          type: "object"
        }
      }
    },
    async (request, reply) => {
      const user = await findAuthenticatedUser(
        options.authSessions,
        request.headers.cookie
      );
      if (user === null) {
        return reply.status(401).send(sessionRequired());
      }

      const lobby = await options.lobbies.setReady(
        request.params.code.toUpperCase(),
        user.id,
        request.body.ready
      );
      return updatedLobbyResponse(lobby, realtimeHub);
    }
  );

  app.put<{
    Body: LobbySecretGoalsBody;
    Params: { readonly code: string };
  }>(
    "/api/lobbies/:code/secret-goals",
    {
      schema: {
        body: {
          additionalProperties: false,
          properties: {
            enabled: {
              type: "boolean"
            }
          },
          required: ["enabled"],
          type: "object"
        },
        params: {
          additionalProperties: false,
          properties: {
            code: {
              maxLength: 6,
              minLength: 6,
              pattern: "^[A-Za-z0-9]{6}$",
              type: "string"
            }
          },
          required: ["code"],
          type: "object"
        }
      }
    },
    async (request, reply) => {
      const user = await findAuthenticatedUser(
        options.authSessions,
        request.headers.cookie
      );
      if (user === null) {
        return reply.status(401).send(sessionRequired());
      }

      const lobby = await options.lobbies.setSecretGoalsEnabled(
        request.params.code.toUpperCase(),
        user.id,
        request.body.enabled
      );
      return updatedLobbyResponse(lobby, realtimeHub);
    }
  );

  const cardSelectionSchema = {
    additionalProperties: false,
    properties: {
      characteristicId: {
        enum: CHARACTERISTIC_CATEGORIES.map(({ id }) => id),
        type: "string"
      },
      resourceId: {
        enum: [
          "energy",
          "supplies",
          "integrity",
          "lab-data",
          "materials",
          "predator-attention"
        ],
        type: "string"
      },
      targetPlayerId: {
        maxLength: 20,
        minLength: 1,
        pattern: "^[0-9]+$",
        type: "string"
      }
    },
    type: "object"
  } as const;

  const cardReactionSchema = {
    additionalProperties: false,
    properties: {
      ...cardSelectionSchema.properties,
      expectedReactionCount: {
        enum: [0, 1],
        type: "integer"
      }
    },
    required: ["expectedReactionCount"],
    type: "object"
  } as const;

  app.post<{ Params: { readonly code: string } }>(
    "/api/lobbies/:code/start",
    {
      schema: {
        params: {
          additionalProperties: false,
          properties: {
            code: {
              maxLength: 6,
              minLength: 6,
              pattern: "^[A-Za-z0-9]{6}$",
              type: "string"
            }
          },
          required: ["code"],
          type: "object"
        }
      }
    },
    async (request, reply) => {
      const user = await findAuthenticatedUser(
        options.authSessions,
        request.headers.cookie
      );
      if (user === null) {
        return reply.status(401).send(sessionRequired());
      }

      return updatedLobbyResponse(
        await options.lobbies.start(
          request.params.code.toUpperCase(),
          user.id
        ),
        realtimeHub
      );
    }
  );

  app.get<{ Params: { readonly code: string } }>(
    "/api/games/:code",
    {
      schema: {
        params: {
          additionalProperties: false,
          properties: {
            code: {
              maxLength: 6,
              minLength: 6,
              pattern: "^[A-Za-z0-9]{6}$",
              type: "string"
            }
          },
          required: ["code"],
          type: "object"
        }
      }
    },
    async (request, reply) => {
      const user = await findAuthenticatedUser(
        options.authSessions,
        request.headers.cookie
      );
      if (user === null) {
        return reply.status(401).send(sessionRequired());
      }

      const game = await options.lobbies.findGame(
        request.params.code.toUpperCase(),
        user.id
      );
      if (game === null) {
        throw new LobbyStoreError("NOT_A_LOBBY_MEMBER");
      }
      return gameResponse(game);
    }
  );

  app.post<{ Params: { readonly code: string } }>(
    "/api/games/:code/begin",
    {
      schema: {
        params: {
          additionalProperties: false,
          properties: {
            code: {
              maxLength: 6,
              minLength: 6,
              pattern: "^[A-Za-z0-9]{6}$",
              type: "string"
            }
          },
          required: ["code"],
          type: "object"
        }
      }
    },
    async (request, reply) => {
      const user = await findAuthenticatedUser(
        options.authSessions,
        request.headers.cookie
      );
      if (user === null) {
        return reply.status(401).send(sessionRequired());
      }
      return updatedGameResponse(
        await options.lobbies.begin(
          request.params.code.toUpperCase(),
          user.id
        ),
        realtimeHub
      );
    }
  );

  app.post<{
    Body: RevealCharacteristicBody;
    Params: { readonly code: string };
  }>(
    "/api/games/:code/reveal",
    {
      schema: {
        body: {
          additionalProperties: false,
          properties: {
            characteristicId: {
              enum: CHARACTERISTIC_CATEGORIES.map(
                (category) => category.id
              ),
              type: "string"
            }
          },
          required: ["characteristicId"],
          type: "object"
        },
        params: {
          additionalProperties: false,
          properties: {
            code: {
              maxLength: 6,
              minLength: 6,
              pattern: "^[A-Za-z0-9]{6}$",
              type: "string"
            }
          },
          required: ["code"],
          type: "object"
        }
      }
    },
    async (request, reply) => {
      const user = await findAuthenticatedUser(
        options.authSessions,
        request.headers.cookie
      );
      if (user === null) {
        return reply.status(401).send(sessionRequired());
      }

      return updatedGameResponse(
        await options.lobbies.reveal(
          request.params.code.toUpperCase(),
          user.id,
          request.body.characteristicId
        ),
        realtimeHub
      );
    }
  );

  app.post<{ Params: { readonly code: string } }>(
    "/api/games/:code/finish-turn",
    {
      schema: {
        params: {
          additionalProperties: false,
          properties: {
            code: {
              maxLength: 6,
              minLength: 6,
              pattern: "^[A-Za-z0-9]{6}$",
              type: "string"
            }
          },
          required: ["code"],
          type: "object"
        }
      }
    },
    async (request, reply) => {
      const user = await findAuthenticatedUser(
        options.authSessions,
        request.headers.cookie
      );
      if (user === null) {
        return reply.status(401).send(sessionRequired());
      }
      return updatedGameResponse(
        await options.lobbies.finishTurn(
          request.params.code.toUpperCase(),
          user.id
        ),
        realtimeHub
      );
    }
  );

  app.post<{ Params: { readonly code: string } }>(
    "/api/games/:code/finish-discussion",
    {
      schema: {
        params: {
          additionalProperties: false,
          properties: {
            code: {
              maxLength: 6,
              minLength: 6,
              pattern: "^[A-Za-z0-9]{6}$",
              type: "string"
            }
          },
          required: ["code"],
          type: "object"
        }
      }
    },
    async (request, reply) => {
      const user = await findAuthenticatedUser(
        options.authSessions,
        request.headers.cookie
      );
      if (user === null) {
        return reply.status(401).send(sessionRequired());
      }
      return updatedGameResponse(
        await options.lobbies.finishDiscussion(
          request.params.code.toUpperCase(),
          user.id
        ),
        realtimeHub
      );
    }
  );

  app.post<{
    Body: FinishVotingBody;
    Params: { readonly code: string };
  }>(
    "/api/games/:code/finish-voting",
    {
      schema: {
        body: {
          additionalProperties: false,
          properties: {
            votingAttempt: { minimum: 1, type: "integer" }
          },
          required: ["votingAttempt"],
          type: "object"
        },
        params: {
          additionalProperties: false,
          properties: {
            code: {
              maxLength: 6,
              minLength: 6,
              pattern: "^[A-Za-z0-9]{6}$",
              type: "string"
            }
          },
          required: ["code"],
          type: "object"
        }
      }
    },
    async (request, reply) => {
      const user = await findAuthenticatedUser(
        options.authSessions,
        request.headers.cookie
      );
      if (user === null) {
        return reply.status(401).send(sessionRequired());
      }
      return updatedGameResponse(
        await options.lobbies.finishVoting(
          request.params.code.toUpperCase(),
          user.id,
          request.body.votingAttempt
        ),
        realtimeHub
      );
    }
  );

  app.post<{
    Body: PlaytestCardSelection | undefined;
    Params: { readonly code: string };
  }>(
    "/api/games/:code/cards/use",
    {
      schema: {
        body: cardSelectionSchema,
        params: {
          additionalProperties: false,
          properties: {
            code: {
              maxLength: 6,
              minLength: 6,
              pattern: "^[A-Za-z0-9]{6}$",
              type: "string"
            }
          },
          required: ["code"],
          type: "object"
        }
      }
    },
    async (request, reply) => {
      const user = await findAuthenticatedUser(
        options.authSessions,
        request.headers.cookie
      );
      if (user === null) {
        return reply.status(401).send(sessionRequired());
      }
      return updatedGameResponse(
        await options.lobbies.useCard(
          request.params.code.toUpperCase(),
          user.id,
          request.body ?? {}
        ),
        realtimeHub
      );
    }
  );

  app.post<{
    Body: PlaytestCardSelection & { readonly expectedReactionCount: number };
    Params: { readonly code: string };
  }>(
    "/api/games/:code/cards/react",
    {
      schema: {
        body: cardReactionSchema,
        params: {
          additionalProperties: false,
          properties: {
            code: {
              maxLength: 6,
              minLength: 6,
              pattern: "^[A-Za-z0-9]{6}$",
              type: "string"
            }
          },
          required: ["code"],
          type: "object"
        }
      }
    },
    async (request, reply) => {
      const user = await findAuthenticatedUser(
        options.authSessions,
        request.headers.cookie
      );
      if (user === null) {
        return reply.status(401).send(sessionRequired());
      }
      const { expectedReactionCount, ...selection } = request.body;
      return updatedGameResponse(
        await options.lobbies.reactCard(
          request.params.code.toUpperCase(),
          user.id,
          selection,
          expectedReactionCount
        ),
        realtimeHub
      );
    }
  );

  app.post<{
    Body: VoteBody;
    Params: { readonly code: string };
  }>(
    "/api/games/:code/vote",
    {
      schema: {
        body: {
          additionalProperties: false,
          properties: {
            targetPlayerId: {
              maxLength: 20,
              minLength: 1,
              pattern: "^[0-9]+$",
              type: "string"
            },
            votingAttempt: { minimum: 1, type: "integer" }
          },
          required: ["targetPlayerId", "votingAttempt"],
          type: "object"
        },
        params: {
          additionalProperties: false,
          properties: {
            code: {
              maxLength: 6,
              minLength: 6,
              pattern: "^[A-Za-z0-9]{6}$",
              type: "string"
            }
          },
          required: ["code"],
          type: "object"
        }
      }
    },
    async (request, reply) => {
      const user = await findAuthenticatedUser(
        options.authSessions,
        request.headers.cookie
      );
      if (user === null) {
        return reply.status(401).send(sessionRequired());
      }
      return updatedGameResponse(
        await options.lobbies.vote(
          request.params.code.toUpperCase(),
          user.id,
          request.body.targetPlayerId,
          request.body.votingAttempt
        ),
        realtimeHub
      );
    }
  );

  app.post<{
    Body: ProposeRollbackBody;
    Params: { readonly code: string };
  }>(
    "/api/games/:code/rollback",
    {
      schema: {
        body: {
          additionalProperties: false,
          properties: {
            checkpointId: {
              format: "uuid",
              type: "string"
            },
            reason: {
              maxLength: 240,
              minLength: 3,
              type: "string"
            }
          },
          required: ["checkpointId", "reason"],
          type: "object"
        },
        params: {
          additionalProperties: false,
          properties: {
            code: {
              maxLength: 6,
              minLength: 6,
              pattern: "^[A-Za-z0-9]{6}$",
              type: "string"
            }
          },
          required: ["code"],
          type: "object"
        }
      }
    },
    async (request, reply) => {
      const user = await findAuthenticatedUser(
        options.authSessions,
        request.headers.cookie
      );
      if (user === null) {
        return reply.status(401).send(sessionRequired());
      }
      const reason = request.body.reason.trim();
      if (reason.length < 3) {
        return reply.status(400).send({
          error: {
            code: "INVALID_ROLLBACK_REASON",
            message: "Вкажіть коротку причину відновлення"
          },
          success: false
        });
      }
      return updatedGameResponse(
        await options.lobbies.proposeRollback(
          request.params.code.toUpperCase(),
          user.id,
          request.body.checkpointId,
          reason
        ),
        realtimeHub
      );
    }
  );

  app.post<{
    Body: RollbackVoteBody;
    Params: { readonly code: string };
  }>(
    "/api/games/:code/rollback/vote",
    {
      schema: {
        body: {
          additionalProperties: false,
          properties: {
            approve: { type: "boolean" },
            proposalId: { format: "uuid", type: "string" }
          },
          required: ["approve", "proposalId"],
          type: "object"
        },
        params: {
          additionalProperties: false,
          properties: {
            code: {
              maxLength: 6,
              minLength: 6,
              pattern: "^[A-Za-z0-9]{6}$",
              type: "string"
            }
          },
          required: ["code"],
          type: "object"
        }
      }
    },
    async (request, reply) => {
      const user = await findAuthenticatedUser(
        options.authSessions,
        request.headers.cookie
      );
      if (user === null) {
        return reply.status(401).send(sessionRequired());
      }
      return updatedGameResponse(
        await options.lobbies.voteRollback(
          request.params.code.toUpperCase(),
          user.id,
          request.body.approve,
          request.body.proposalId
        ),
        realtimeHub
      );
    }
  );

  app.delete<{
    Body: RollbackCancelBody;
    Params: { readonly code: string };
  }>(
    "/api/games/:code/rollback",
    {
      schema: {
        body: {
          additionalProperties: false,
          properties: {
            proposalId: { format: "uuid", type: "string" }
          },
          required: ["proposalId"],
          type: "object"
        },
        params: {
          additionalProperties: false,
          properties: {
            code: {
              maxLength: 6,
              minLength: 6,
              pattern: "^[A-Za-z0-9]{6}$",
              type: "string"
            }
          },
          required: ["code"],
          type: "object"
        }
      }
    },
    async (request, reply) => {
      const user = await findAuthenticatedUser(
        options.authSessions,
        request.headers.cookie
      );
      if (user === null) {
        return reply.status(401).send(sessionRequired());
      }
      return updatedGameResponse(
        await options.lobbies.cancelRollback(
          request.params.code.toUpperCase(),
          user.id,
          request.body.proposalId
        ),
        realtimeHub
      );
    }
  );

  app.post<{ Params: { readonly code: string } }>(
    "/api/games/:code/rollback/resume",
    {
      schema: {
        params: {
          additionalProperties: false,
          properties: {
            code: {
              maxLength: 6,
              minLength: 6,
              pattern: "^[A-Za-z0-9]{6}$",
              type: "string"
            }
          },
          required: ["code"],
          type: "object"
        }
      }
    },
    async (request, reply) => {
      const user = await findAuthenticatedUser(
        options.authSessions,
        request.headers.cookie
      );
      if (user === null) {
        return reply.status(401).send(sessionRequired());
      }
      return updatedGameResponse(
        await options.lobbies.resumeRollback(
          request.params.code.toUpperCase(),
          user.id
        ),
        realtimeHub
      );
    }
  );

  app.post<{
    Body: SubmitFinalOutcomeBody;
    Params: { readonly code: string };
  }>(
    "/api/games/:code/final-outcome",
    {
      schema: {
        body: {
          additionalProperties: false,
          properties: {
            outcome: {
              enum: ["all_survive", "team_loss"],
              type: "string"
            }
          },
          required: ["outcome"],
          type: "object"
        },
        params: {
          additionalProperties: false,
          properties: {
            code: {
              maxLength: 6,
              minLength: 6,
              pattern: "^[A-Za-z0-9]{6}$",
              type: "string"
            }
          },
          required: ["code"],
          type: "object"
        }
      }
    },
    async (request, reply) => {
      const user = await findAuthenticatedUser(
        options.authSessions,
        request.headers.cookie
      );
      if (user === null) {
        return reply.status(401).send(sessionRequired());
      }
      return updatedGameResponse(
        await options.lobbies.submitFinalOutcome(
          request.params.code.toUpperCase(),
          user.id,
          request.body.outcome
        ),
        realtimeHub
      );
    }
  );

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AuthSessionReplayError) {
      return reply.status(409).send({
        error: {
          code: "REPLAYED_TELEGRAM_INIT_DATA",
          message: "Ці дані Telegram уже були використані"
        },
        success: false
      });
    }

    if (
      error instanceof LobbyStoreError ||
      error instanceof GameRollbackError
    ) {
      const details = {
        ALREADY_VOTED_ROLLBACK: {
          message: "Ваш голос за відновлення вже прийнято",
          statusCode: 409
        },
        ALREADY_IN_LOBBY: {
          message: "Ви вже перебуваєте в іншому лобі",
          statusCode: 409
        },
        ALREADY_VOTED: {
          message: "Ваш голос уже прийнято",
          statusCode: 409
        },
        CHARACTERISTIC_ALREADY_REVEALED: {
          message: "Цю характеристику вже відкрито",
          statusCode: 409
        },
        MUST_REVEAL_PROFESSION_FIRST: {
          message: "У першому раунді всі відкривають професію",
          statusCode: 409
        },
        CARD_NOT_ALLOWED: {
          message: "Цю картку не можна використати в поточній фазі",
          statusCode: 409
        },
        CARD_NOT_AVAILABLE: {
          message: "Картка вже використана або не підходить для цієї дії",
          statusCode: 409
        },
        REACTION_CHAIN_CHANGED: {
          message:
            "Хтось інший уже відреагував першим. Перевірте стан і спробуйте ще раз.",
          statusCode: 409
        },
        DEMOGRAPHY_NOT_PRESERVED: {
          message: "Фінальна група не пройшла демографічну перевірку",
          statusCode: 409
        },
        CHECKPOINT_NOT_FOUND: {
          message: "Контрольна точка недоступна в поточному раунді",
          statusCode: 404
        },
        GAME_PAUSED_FOR_ROLLBACK: {
          message: "Гру призупинено для перевірки відновлення",
          statusCode: 409
        },
        GAME_NOT_IN_INTRO: {
          message: "Оголошення катастрофи вже завершено",
          statusCode: 409
        },
        GAME_NOT_IN_FINAL: {
          message: "Фінальна перевірка ще не розпочалася",
          statusCode: 409
        },
        GAME_NOT_IN_DISCUSSION: {
          message: "Зараз не фаза загального обговорення",
          statusCode: 409
        },
        GAME_NOT_IN_VOTING: {
          message: "Зараз не фаза голосування",
          statusCode: 409
        },
        INVALID_VOTE_TARGET: {
          message: "За цього гравця зараз не можна голосувати",
          statusCode: 409
        },
        VOTING_ATTEMPT_CHANGED: {
          message:
            "Голосування вже перейшло до нової спроби. Перевірте стан і спробуйте ще раз.",
          statusCode: 409
        },
        INVALID_PLAYER_ORDER: {
          message: "Порядок гравців не відповідає складу лобі",
          statusCode: 409
        },
        INVALID_CARD_SELECTION: {
          message: "Оберіть допустиму ціль або параметр для цієї картки",
          statusCode: 409
        },
        LOBBY_CLOSED: {
          message: "Ця партія вже розпочалася",
          statusCode: 409
        },
        LOBBY_FULL: {
          message: `У лобі вже ${MAX_GAME_PLAYERS} гравців`,
          statusCode: 409
        },
        LOBBY_NOT_FOUND: {
          message: "Лобі з таким кодом не знайдено",
          statusCode: 404
        },
        PLAYTEST_REQUIRES_FOUR_TO_SIXTEEN_PLAYERS: {
          message: `Для гри потрібно від 4 до ${MAX_GAME_PLAYERS} гравців`,
          statusCode: 409
        },
        NOT_A_LOBBY_MEMBER: {
          message: "Ви не є учасником цього лобі",
          statusCode: 403
        },
        NOT_YOUR_TURN: {
          message: "Зараз хід іншого гравця",
          statusCode: 409
        },
        ONLY_HOST_CAN_BEGIN: {
          message: "Лише ведучий може завершити оголошення катастрофи",
          statusCode: 403
        },
        ONLY_HOST_CAN_ROLLBACK: {
          message: "Лише ведучий може керувати відновленням",
          statusCode: 403
        },
        ONLY_HOST_CAN_END_DISCUSSION: {
          message: "Лише ведучий може завершити загальне обговорення",
          statusCode: 403
        },
        ONLY_HOST_CAN_FINISH_VOTING: {
          message: "Лише ведучий може примусово завершити голосування",
          statusCode: 403
        },
        ONLY_HOST_CAN_FINALIZE: {
          message: "Фінальний результат визначає ведучий",
          statusCode: 403
        },
        ONLY_HOST_CAN_REORDER: {
          message: "Лише ведучий може змінювати порядок",
          statusCode: 403
        },
        ONLY_HOST_CAN_START: {
          message: "Лише ведучий може запустити гру",
          statusCode: 403
        },
        ONLY_HOST_CAN_TOGGLE_SECRET_GOALS: {
          message: "Лише ведучий може вмикати або вимикати секретні цілі",
          statusCode: 403
        },
        PLAYERS_NOT_READY: {
          message: "Усі гравці мають підтвердити готовність",
          statusCode: 409
        },
        ROLLBACK_ALREADY_PENDING: {
          message: "Голосування за відновлення вже триває",
          statusCode: 409
        },
        ROLLBACK_NOT_PENDING: {
          message: "Активного відновлення немає",
          statusCode: 409
        },
        TURN_NOT_READY_TO_FINISH: {
          message: "Спочатку відкрийте характеристику й почніть виступ",
          statusCode: 409
        }
      } as const;
      const detail = details[error.code];

      return reply.status(detail.statusCode).send({
        error: {
          code: error.code,
          message: detail.message
        },
        success: false
      });
    }

    if (error instanceof TelegramInitDataError) {
      return reply.status(401).send({
        error: {
          code: error.code,
          message:
            error.code === "EXPIRED_TELEGRAM_INIT_DATA"
              ? "Сесію Telegram потрібно відкрити повторно"
              : "Не вдалося підтвердити Telegram-користувача"
        },
        success: false
      });
    }

    if (isValidationError(error)) {
      return reply.status(400).send(validationError(error));
    }

    app.log.error(error);
    return reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "Не вдалося обробити запит"
      },
      success: false
    });
  });

  return app;
}
