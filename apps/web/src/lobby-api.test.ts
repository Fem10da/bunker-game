// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LobbyApiError,
  beginMockGame,
  cancelRollback,
  createLobby,
  finishMockDiscussion,
  finishMockTurn,
  getMockGame,
  getCurrentLobby,
  getPublicGame,
  joinLobby,
  leaveLobby,
  proposeRollback,
  reactWithPlaytestCard,
  reorderLobby,
  revealMockCharacteristic,
  resumeRollback,
  serverNow,
  setLobbyReady,
  setLobbySecretGoals,
  startLobby,
  submitFinalOutcome,
  submitVote,
  voteRollback,
  usePlaytestCard
} from "./lobby-api.js";

const lobby = {
  code: "K7M4Q2",
  hostPlayerId: "424242",
  players: [
    {
      firstName: "Вадим",
      id: "424242",
      isHost: true,
      position: 1,
      ready: false,
      username: "femida"
    }
  ],
  scenarioId: "operation-chalk",
  secretGoalsEnabled: true,
  status: "waiting"
};

const gameMetadata = {
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
  demography: null,
  lastEvent: null,
  rollback: {
    activeBranchId: "00000000-0000-4000-8000-000000000001",
    checkpoints: [],
    paused: false,
    proposal: null
  },
  scenario: {
    ageRating: "16+",
    bunker: {
      condition: "Основний корпус герметичний.",
      description: "Покинута корпоративна база.",
      limitations: ["Сигнали привертають хижаків."],
      rooms: ["Командний центр"],
      supplies: ["Їжа й вода"]
    },
    catastrophe: {
      description: "Часова аномалія перенесла людей.",
      title: "ЧАСОВИЙ РОЗЛОМ"
    },
    contentWarnings: ["небезпека"],
    id: "operation-chalk",
    resources: [
      {
        id: "energy",
        label: "Енергія",
        max: 10,
        value: 6
      }
    ],
    reveals: [
      {
        description: "База створила динозаврів.",
        id: "bunker-origin",
        round: 1,
        title: "Походження бункера"
      }
    ],
    summary: "Люди опинилися в епосі динозаврів.",
    title: "Операція крейда"
  },
  turnDeadline: "2026-07-27T14:00:00.000Z",
  turnRevealedCharacteristicId: null,
  turnStage: "choosing"
} as const;

function apiResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    headers: {
      "content-type": "application/json"
    },
    status
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("lobby API", () => {
  it("creates and validates a lobby", async () => {
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      apiResponse({
        data: { lobby },
        success: true
      })
    );

    await expect(createLobby()).resolves.toEqual(lobby);
    expect(request).toHaveBeenCalledWith("/api/lobbies", {
      credentials: "include",
      method: "POST"
    });
  });

  it("accepts a null current lobby", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      apiResponse({
        data: { lobby: null },
        success: true
      })
    );

    await expect(getCurrentLobby()).resolves.toBeNull();
  });

  it("sends join and readiness commands as JSON", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        apiResponse({
          data: { lobby },
          success: true
        })
      )
      .mockResolvedValueOnce(
        apiResponse({
          data: { lobby },
          success: true
        })
      )
      .mockResolvedValueOnce(
        apiResponse({
          data: { lobby: { ...lobby, secretGoalsEnabled: false } },
          success: true
        })
      );

    await joinLobby("K7M4Q2");
    await setLobbyReady("K7M4Q2", true);
    await expect(
      setLobbySecretGoals("K7M4Q2", false)
    ).resolves.toEqual({ ...lobby, secretGoalsEnabled: false });

    expect(request).toHaveBeenNthCalledWith(1, "/api/lobbies/join", {
      body: JSON.stringify({ code: "K7M4Q2" }),
      credentials: "include",
      headers: {
        "content-type": "application/json"
      },
      method: "POST"
    });
    expect(request).toHaveBeenNthCalledWith(
      2,
      "/api/lobbies/K7M4Q2/readiness",
      {
        body: JSON.stringify({ ready: true }),
        credentials: "include",
        headers: {
          "content-type": "application/json"
        },
        method: "PUT"
      }
    );
    expect(request).toHaveBeenNthCalledWith(
      3,
      "/api/lobbies/K7M4Q2/secret-goals",
      {
        body: JSON.stringify({ enabled: false }),
        credentials: "include",
        headers: {
          "content-type": "application/json"
        },
        method: "PUT"
      }
    );
  });

  it("sends the host-selected player order", async () => {
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      apiResponse({
        data: { lobby },
        success: true
      })
    );

    await reorderLobby("K7M4Q2", ["424242"]);

    expect(request).toHaveBeenCalledWith("/api/lobbies/K7M4Q2/order", {
      body: JSON.stringify({ playerIds: ["424242"] }),
      credentials: "include",
      headers: {
        "content-type": "application/json"
      },
      method: "PUT"
    });
  });

  it("rejects failed and malformed API responses", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(apiResponse({}, 500))
      .mockResolvedValueOnce(
        apiResponse({
          data: {
            lobby: {
              ...lobby,
              players: [{ id: 42 }]
            }
          }
        })
      );

    await expect(createLobby()).rejects.toBeInstanceOf(LobbyApiError);
    await expect(createLobby()).rejects.toBeInstanceOf(LobbyApiError);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("leaves or cancels the current lobby", async () => {
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      apiResponse({
        data: {
          cancelled: true
        },
        success: true
      })
    );

    await expect(leaveLobby("K7M4Q2")).resolves.toEqual({
      cancelled: true
    });
    expect(request).toHaveBeenCalledWith("/api/lobbies/K7M4Q2", {
      credentials: "include",
      method: "DELETE"
    });
  });

  it("starts and reads a four-player playtest", async () => {
    const startedLobby = { ...lobby, status: "started" };
    const game = {
      bunkerCapacity: 2,
      ...gameMetadata,
      characteristics: [
        {
          id: "profession",
          label: "Професія",
          revealed: false,
          value: "Палеонтолог"
        }
      ],
      code: "K7M4Q2",
      currentTurnPlayerId: "424242",
      dossierNumber: 1,
      finalOutcome: null,
      hostPlayerId: "424242",
      phase: "revealing",
      players: [
        {
          characteristics: {},
          firstName: "Вадим",
          id: "424242",
          lastName: "Кравченко",
          position: 1,
          status: "active"
        }
      ],
      round: 1,
      secretGoal: "Потрапте до бункера.",
      status: "started",
      voting: null
    };
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        apiResponse({ data: { lobby: startedLobby }, success: true })
      )
      .mockResolvedValueOnce(
        apiResponse({ data: { game }, success: true })
      );

    await expect(startLobby("K7M4Q2")).resolves.toEqual(startedLobby);
    await expect(getMockGame("K7M4Q2")).resolves.toEqual(game);
    expect(request).toHaveBeenNthCalledWith(
      1,
      "/api/lobbies/K7M4Q2/start",
      {
        credentials: "include",
        method: "POST"
      }
    );
    expect(request).toHaveBeenNthCalledWith(2, "/api/games/K7M4Q2", {
      credentials: "include"
    });
  });

  it("reads a safe sixteen-player projector projection without credentials", async () => {
    const publicGame = {
      activeDeadline: "2026-07-27T14:00:00.000Z",
      bunkerCapacity: 8,
      code: "K7M4Q2",
      currentTurnPlayerId: "424242",
      finalOutcome: null,
      lastEvent: "Олена відкрила професію.",
      phase: "revealing",
      players: [
        {
          characteristics: { profession: "Таксидерміст" },
          firstName: "Олена",
          id: "424242",
          position: 1,
          status: "active"
        },
        {
          characteristics: {},
          firstName: "Максим",
          id: "525252",
          position: 2,
          status: "eliminated"
        }
      ],
      rollbackPaused: false,
      round: 4,
      scenario: gameMetadata.scenario,
      status: "started",
      turnDeadline: "2026-07-27T14:00:00.000Z",
      turnRevealedCharacteristicId: "profession",
      turnStage: "speaking",
      secretGoal: "Не показуйте це на проєкторі.",
      special_card: "Не показуйте картку."
    };
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      apiResponse({ data: { game: publicGame }, success: true })
    );

    const projection = await getPublicGame("K7M4Q2");

    expect(request).toHaveBeenCalledWith("/api/screens/K7M4Q2");
    expect(projection).toMatchObject({
      activeDeadline: "2026-07-27T14:00:00.000Z",
      bunkerCapacity: 8,
      players: [
        { characteristics: { profession: "Таксидерміст" } },
        { status: "eliminated" }
      ],
      turnStage: "speaking"
    });
    expect(projection).not.toHaveProperty("secretGoal");
    expect(projection).not.toHaveProperty("special_card");
  });

  it("keeps a public screen error code and rejects an invalid projection", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        apiResponse(
          {
            error: {
              code: "LOBBY_NOT_FOUND",
              message: "Лобі ще не стартувало"
            },
            success: false
          },
          404
        )
      )
      .mockResolvedValueOnce(
        apiResponse({
          data: {
            game: {
              activeDeadline: null,
              bunkerCapacity: 8,
              code: "K7M4Q2",
              currentTurnPlayerId: null,
              finalOutcome: null,
              lastEvent: null,
              phase: "revealing",
              players: [],
              round: 1,
              scenario: gameMetadata.scenario,
              status: "started",
              turnDeadline: null,
              turnRevealedCharacteristicId: null,
              turnStage: "unexpected"
            }
          },
          success: true
        })
      );

    await expect(getPublicGame("K7M4Q2")).rejects.toMatchObject({
      code: "LOBBY_NOT_FOUND"
    });
    await expect(getPublicGame("K7M4Q2")).rejects.toBeInstanceOf(
      LobbyApiError
    );
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("parses complete card, rollback, voting, and player metadata", async () => {
    const action = {
      description: "Відкрийте характеристику іншого гравця.",
      effectId: "characteristic.force_reveal",
      id: "forced-disclosure",
      kind: "action",
      scope: "common",
      selection: ["target_player", "characteristic"],
      target: "any_non_afk_player",
      timing: "own_phase",
      title: "Примусове розкриття"
    } as const;
    const reaction = {
      description: "Скасуйте дію.",
      effectId: "card.cancel",
      id: "countermeasure",
      kind: "reaction",
      scope: "scenario",
      selection: [],
      target: "game",
      timing: "reaction_window",
      title: "Контрзахід"
    } as const;
    const game = {
      bunkerCapacity: 2,
      ...gameMetadata,
      card: { ...action, used: true },
      cardChain: {
        action,
        actionSelection: {
          characteristicId: "health",
          resourceId: "energy",
          targetPlayerId: "525252"
        },
        actorPlayerId: "424242",
        deadline: "2026-07-27T14:00:10.000Z",
        reactions: [
          {
            card: reaction,
            playerId: "525252",
            selection: { targetPlayerId: "424242" }
          }
        ]
      },
      cardResult: "Здоров’я: Контрольована астма",
      characteristics: [
        {
          id: "profession",
          label: "Професія",
          revealed: true,
          value: "Палеонтолог"
        }
      ],
      code: "K7M4Q2",
      currentTurnPlayerId: "424242",
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
      finalOutcome: null,
      hostPlayerId: "424242",
      lastEvent: "Контрзахід застосовано",
      phase: "voting",
      players: [
        {
          characteristics: { health: "Контрольована астма" },
          firstName: "Максим",
          id: "525252",
          lastName: "Тестовий",
          position: 2,
          status: "eliminated"
        }
      ],
      rollback: {
        activeBranchId: "00000000-0000-4000-8000-000000000001",
        checkpoints: [
          {
            createdAt: "2026-07-27T13:59:00.000Z",
            eventsAfter: 3,
            id: "00000000-0000-4000-8000-000000000002",
            label: "Перед голосуванням",
            phase: "voting",
            round: 2
          }
        ],
        paused: true,
        proposal: {
          approvals: 2,
          checkpointId: "00000000-0000-4000-8000-000000000002",
          checkpointLabel: "Перед голосуванням",
          hasVoted: true,
          id: "00000000-0000-4000-8000-000000000003",
          initiatedByPlayerId: "424242",
          reason: "Перевірка",
          rejections: 0,
          requiredApprovals: 3
        }
      },
      round: 2,
      secretGoal: "Потрапте до бункера.",
      status: "started",
      turnDeadline: "2026-07-27T14:00:00.000Z",
      turnRevealedCharacteristicId: "profession",
      turnStage: "speaking",
      voting: {
        attempt: 2,
        candidatePlayerIds: ["525252"],
        expected: 4,
        hasVoted: true,
        openVotes: [
          { targetPlayerId: "525252", voterPlayerId: "424242" }
        ],
        silenced: false,
        submitted: 2,
        totals: [{ targetPlayerId: "525252", votes: 2 }]
      }
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      apiResponse({ data: { game }, success: true })
    );

    await expect(getMockGame("K7M4Q2")).resolves.toMatchObject({
      card: {
        scope: "common",
        selection: ["target_player", "characteristic"],
        used: true
      },
      cardChain: {
        actionSelection: {
          characteristicId: "health",
          resourceId: "energy",
          targetPlayerId: "525252"
        },
        reactions: [{ playerId: "525252" }]
      },
      cardResult: "Здоров’я: Контрольована астма",
      players: [
        {
          characteristics: { health: "Контрольована астма" },
          lastName: "Тестовий",
          status: "eliminated"
        }
      ],
      rollback: {
        paused: true,
        proposal: { approvals: 2 }
      },
      voting: {
        attempt: 2,
        openVotes: [
          { targetPlayerId: "525252", voterPlayerId: "424242" }
        ],
        totals: [{ targetPlayerId: "525252", votes: 2 }]
      }
    });
  });

  it("keeps the backend error code when a game no longer exists", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      apiResponse(
        {
          error: {
            code: "NOT_A_LOBBY_MEMBER",
            message: "Гру завершено"
          },
          success: false
        },
        403
      )
    );

    await expect(getMockGame("K7M4Q2")).rejects.toMatchObject({
      code: "NOT_A_LOBBY_MEMBER"
    });
  });

  it("rejects an inconsistent demographic result from the API", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      apiResponse({
        data: {
          game: {
            bunkerCapacity: 2,
            ...gameMetadata,
            characteristics: [],
            code: "K7M4Q2",
            currentTurnPlayerId: null,
            demography: {
              eligibleMen: 0,
              eligibleWomen: 1,
              femaleAgeRange: { max: 49, min: 18 },
              maleAgeRange: { max: 64, min: 18 },
              preserved: true,
              requiredMen: 1,
              requiredWomen: 1
            },
            dossierNumber: 1,
            finalOutcome: null,
            hostPlayerId: "424242",
            phase: "final_check",
            players: [],
            round: 3,
            secretGoal: "Потрапте до бункера.",
            status: "started",
            voting: null
          }
        },
        success: true
      })
    );

    await expect(getMockGame("K7M4Q2")).rejects.toBeInstanceOf(
      LobbyApiError
    );
  });

  it("publishes one mock characteristic", async () => {
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      apiResponse({
        data: {
          game: {
            bunkerCapacity: 2,
            ...gameMetadata,
            characteristics: [],
            code: "K7M4Q2",
            currentTurnPlayerId: "424242",
            dossierNumber: 1,
            finalOutcome: null,
            hostPlayerId: "424242",
            phase: "revealing",
            players: [],
            round: 1,
            secretGoal: "Потрапте до бункера.",
            status: "started",
            voting: null
          }
        },
        success: true
      })
    );

    await revealMockCharacteristic("K7M4Q2", "health");
    expect(request).toHaveBeenCalledWith("/api/games/K7M4Q2/reveal", {
      body: JSON.stringify({ characteristicId: "health" }),
      credentials: "include",
      headers: {
        "content-type": "application/json"
      },
      method: "POST"
    });
  });

  it("sends catastrophe and card commands", async () => {
    const game = {
      bunkerCapacity: 2,
      ...gameMetadata,
      characteristics: [],
      code: "K7M4Q2",
      currentTurnPlayerId: "424242",
      dossierNumber: 1,
      finalOutcome: null,
      hostPlayerId: "424242",
      phase: "revealing",
      players: [],
      round: 1,
      secretGoal: "Потрапте до бункера.",
      status: "started",
      voting: null
    };
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        Promise.resolve(apiResponse({ data: { game }, success: true }))
      );

    await beginMockGame("K7M4Q2");
    await finishMockTurn("K7M4Q2");
    await finishMockDiscussion("K7M4Q2");
    await usePlaytestCard("K7M4Q2", {});
    await reactWithPlaytestCard("K7M4Q2", {}, 0);

    expect(request).toHaveBeenNthCalledWith(
      1,
      "/api/games/K7M4Q2/begin",
      {
        credentials: "include",
        method: "POST"
      }
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      "/api/games/K7M4Q2/finish-turn",
      {
        credentials: "include",
        method: "POST"
      }
    );
    expect(request).toHaveBeenNthCalledWith(
      3,
      "/api/games/K7M4Q2/finish-discussion",
      {
        credentials: "include",
        method: "POST"
      }
    );
    expect(request).toHaveBeenNthCalledWith(
      4,
      "/api/games/K7M4Q2/cards/use",
      {
        body: "{}",
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST"
      }
    );
    expect(request).toHaveBeenNthCalledWith(
      5,
      "/api/games/K7M4Q2/cards/react",
      {
        body: '{"expectedReactionCount":0}',
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST"
      }
    );
  });

  it("sends vote and final-outcome commands", async () => {
    const game = {
      bunkerCapacity: 2,
      ...gameMetadata,
      characteristics: [],
      code: "K7M4Q2",
      currentTurnPlayerId: null,
      dossierNumber: 1,
      finalOutcome: null,
      hostPlayerId: "424242",
      phase: "voting",
      players: [],
      round: 2,
      secretGoal: "Потрапте до бункера.",
      status: "started",
      voting: {
        attempt: 1,
        candidatePlayerIds: ["525252"],
        expected: 4,
        hasVoted: true,
        openVotes: [],
        silenced: false,
        submitted: 1,
        totals: []
      }
    };
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        apiResponse({ data: { game }, success: true })
      )
      .mockResolvedValueOnce(
        apiResponse({
          data: {
            game: {
              ...game,
              demography: {
                eligibleMen: 1,
                eligibleWomen: 1,
                femaleAgeRange: { max: 49, min: 18 },
                maleAgeRange: { max: 64, min: 18 },
                preserved: true,
                requiredMen: 1,
                requiredWomen: 1
              },
              finalOutcome: "all_survive",
              phase: "completed",
              voting: null
            }
          },
          success: true
        })
      );

    await submitVote("K7M4Q2", "525252", 1);
    await submitFinalOutcome("K7M4Q2", "all_survive");

    expect(request).toHaveBeenNthCalledWith(
      1,
      "/api/games/K7M4Q2/vote",
      expect.objectContaining({
        body: JSON.stringify({
          targetPlayerId: "525252",
          votingAttempt: 1
        }),
        method: "POST"
      })
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      "/api/games/K7M4Q2/final-outcome",
      expect.objectContaining({
        body: JSON.stringify({ outcome: "all_survive" }),
        method: "POST"
      })
    );
  });

  it("sends rollback proposal, vote, cancel and resume commands", async () => {
    const game = {
      bunkerCapacity: 2,
      ...gameMetadata,
      characteristics: [],
      code: "K7M4Q2",
      currentTurnPlayerId: "424242",
      dossierNumber: 1,
      finalOutcome: null,
      hostPlayerId: "424242",
      phase: "revealing",
      players: [],
      round: 1,
      secretGoal: "Потрапте до бункера.",
      status: "started",
      voting: null
    };
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        Promise.resolve(apiResponse({ data: { game }, success: true }))
      );

    await proposeRollback(
      "K7M4Q2",
      "00000000-0000-4000-8000-000000000002",
      "Помилкове відкриття"
    );
    await voteRollback(
      "K7M4Q2",
      true,
      "00000000-0000-4000-8000-000000000003"
    );
    await cancelRollback(
      "K7M4Q2",
      "00000000-0000-4000-8000-000000000003"
    );
    await resumeRollback("K7M4Q2");

    expect(request).toHaveBeenNthCalledWith(
      1,
      "/api/games/K7M4Q2/rollback",
      expect.objectContaining({
        body: JSON.stringify({
          checkpointId: "00000000-0000-4000-8000-000000000002",
          reason: "Помилкове відкриття"
        }),
        method: "POST"
      })
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      "/api/games/K7M4Q2/rollback/vote",
      expect.objectContaining({
        body: JSON.stringify({
          approve: true,
          proposalId: "00000000-0000-4000-8000-000000000003"
        }),
        method: "POST"
      })
    );
    expect(request).toHaveBeenNthCalledWith(
      3,
      "/api/games/K7M4Q2/rollback",
      expect.objectContaining({
        body: JSON.stringify({
          proposalId: "00000000-0000-4000-8000-000000000003"
        }),
        method: "DELETE"
      })
    );
    expect(request).toHaveBeenNthCalledWith(
      4,
      "/api/games/K7M4Q2/rollback/resume",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("estimates the current time from the server's Date header, not the device clock", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-27T13:59:00.000Z"));
      const serverTime = new Date("2026-07-27T14:00:30.000Z");
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({ data: { lobby: null }, success: true }),
          {
            headers: {
              "content-type": "application/json",
              date: serverTime.toUTCString()
            },
            status: 200
          }
        )
      );

      await getCurrentLobby();

      expect(serverNow()).toBe(serverTime.getTime());
    } finally {
      vi.useRealTimers();
    }
  });
});
