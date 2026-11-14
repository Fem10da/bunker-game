// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { Lobby, MockGameView, TelegramUser } from "@bunker/contracts";

import { GameScreen } from "./GameScreen.js";
import {
  beginMockGame,
  finishMockDiscussion,
  finishMockTurn,
  getMockGame,
  leaveLobby,
  LobbyApiError,
  proposeRollback,
  reactWithPlaytestCard,
  revealMockCharacteristic,
  serverNow,
  submitFinalOutcome,
  submitVote,
  usePlaytestCard
} from "./lobby-api.js";
import {
  notifyCurrentPlayerTurn,
  notifyTimerExpired
} from "./telegram-auth.js";

vi.mock("./lobby-api.js", { spy: true });
vi.mock("./telegram-auth.js", { spy: true });

const user: TelegramUser = {
  firstName: "Вадим",
  id: "424242"
};

const lobby: Lobby = {
  code: "K7M4Q2",
  hostPlayerId: user.id,
  players: [
    {
      firstName: user.firstName,
      id: user.id,
      isHost: true,
      position: 1,
      ready: true
    },
    {
      firstName: "Максим",
      id: "525252",
      isHost: false,
      position: 2,
      ready: true
    }
  ],
  scenarioId: "operation-chalk",
  secretGoalsEnabled: true,
  status: "started"
};

const game: MockGameView = {
  bunkerCapacity: 2,
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
      revealed: false,
      value: "Палеонтолог"
    },
    {
      id: "health",
      label: "Здоров’я",
      revealed: false,
      value: "Контрольована астма"
    }
  ],
  code: lobby.code,
  currentTurnPlayerId: user.id,
  demography: null,
  dossierNumber: 1,
  finalOutcome: null,
  hostPlayerId: user.id,
  lastEvent: null,
  phase: "revealing",
  players: [
    {
      characteristics: {},
      firstName: "Вадим",
      id: user.id,
      position: 1,
      status: "active"
    },
    {
      characteristics: {},
      firstName: "Максим",
      id: "525252",
      position: 2,
      status: "active"
    }
  ],
  rollback: {
    activeBranchId: "00000000-0000-4000-8000-000000000001",
    checkpoints: [],
    paused: false,
    proposal: null
  },
  round: 1,
  scenario: {
    ageRating: "16+",
    bunker: {
      condition: "Основний корпус герметичний.",
      description: "Покинута корпоративна база.",
      limitations: ["Сигнали привертають хижаків."],
      rooms: ["Командний центр", "Лабораторія"],
      supplies: ["Їжа й вода"]
    },
    catastrophe: {
      description: "Часова аномалія перенесла людей до динозаврів.",
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
  secretGoal: "Потрапте до бункера.",
  status: "started",
  turnDeadline: new Date(Date.now() + 90_000).toISOString(),
  turnRevealedCharacteristicId: null,
  turnStage: "choosing",
  voting: null
};

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    }
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("GameScreen", () => {
  it.each(["LOBBY_NOT_FOUND", "NOT_A_LOBBY_MEMBER"])(
    "ends the local screen when refresh returns %s",
    async (code) => {
      vi.mocked(getMockGame).mockRejectedValue(new LobbyApiError(code));
      const onEnded = vi.fn();

      render(<GameScreen lobby={lobby} onEnded={onEnded} user={user} />);

      await waitFor(() => expect(onEnded).toHaveBeenCalledOnce());
    }
  );

  it("keeps retrying after an unexpected refresh error", async () => {
    vi.mocked(getMockGame).mockRejectedValue(new Error("offline"));

    render(<GameScreen lobby={lobby} onEnded={vi.fn()} user={user} />);

    expect(
      await screen.findByText("Не вдалося завантажити гру. Повторюємо…")
    ).toBeDefined();
  });

  it("keeps making progress when every response arrives slower than the poll interval", async () => {
    vi.useFakeTimers();
    const discussionGame: MockGameView = {
      ...game,
      currentTurnPlayerId: null,
      phase: "discussion",
      turnDeadline: new Date(Date.now() + 180_000).toISOString(),
      turnRevealedCharacteristicId: null,
      turnStage: null
    };
    let callCount = 0;
    vi.mocked(getMockGame).mockImplementation(
      () =>
        new Promise((resolve) => {
          callCount += 1;
          const response = callCount === 1 ? game : discussionGame;
          setTimeout(() => resolve(response), 7_000);
        })
    );

    try {
      render(<GameScreen lobby={lobby} onEnded={vi.fn()} user={user} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(screen.getByText("ЗАГАЛЬНЕ ОБГОВОРЕННЯ")).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("frees the UI and resyncs from the server when a command hangs", async () => {
    vi.useFakeTimers();
    vi.mocked(getMockGame).mockResolvedValue(game);
    vi.mocked(usePlaytestCard).mockImplementation(
      () => new Promise<never>(() => {})
    );

    try {
      render(<GameScreen lobby={lobby} onEnded={vi.fn()} user={user} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const button = screen.getByRole("button", {
        name: "Використати картку"
      });
      fireEvent.click(button);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(getMockGame).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });

      expect(getMockGame).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the correct countdown even when the device clock is skewed", async () => {
    const rawNow = Date.now();
    vi.mocked(serverNow).mockReturnValue(rawNow - 60_000);
    const skewedGame: MockGameView = {
      ...game,
      turnDeadline: new Date(rawNow - 50_000).toISOString()
    };
    vi.mocked(getMockGame).mockResolvedValue(skewedGame);
    try {
      render(<GameScreen lobby={lobby} onEnded={vi.fn()} user={user} />);

      expect(await screen.findByText("00:10")).toBeDefined();
    } finally {
      vi.mocked(serverNow).mockRestore();
    }
  });

  it("resyncs immediately when the app returns to the foreground", async () => {
    const discussionGame: MockGameView = {
      ...game,
      currentTurnPlayerId: null,
      phase: "discussion",
      turnDeadline: new Date(Date.now() + 180_000).toISOString(),
      turnRevealedCharacteristicId: null,
      turnStage: null
    };
    vi.mocked(getMockGame)
      .mockResolvedValueOnce(game)
      .mockResolvedValueOnce(discussionGame);
    render(<GameScreen lobby={lobby} onEnded={vi.fn()} user={user} />);
    await screen.findByText("Контрольована астма");
    expect(getMockGame).toHaveBeenCalledTimes(1);

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(getMockGame).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("ЗАГАЛЬНЕ ОБГОВОРЕННЯ")).toBeDefined();
  });

  it("shows the complete catastrophe briefing before the first turn", async () => {
    const introGame: MockGameView = {
      ...game,
      currentTurnPlayerId: null,
      phase: "scenario_intro",
      turnDeadline: null
    };
    vi.mocked(getMockGame).mockResolvedValue(introGame);
    vi.mocked(beginMockGame).mockResolvedValue(game);
    const actor = userEvent.setup();
    render(<GameScreen lobby={lobby} onEnded={vi.fn()} user={user} />);

    expect(await screen.findByText("ЧАСОВИЙ РОЗЛОМ")).toBeDefined();
    expect(
      screen.queryByText("Основний корпус герметичний.")
    ).toBeNull();

    await actor.click(
      screen.getByRole("button", {
        name: "Переглянути бункер"
      })
    );
    expect(screen.getByText("Основний корпус герметичний.")).toBeDefined();
    expect(screen.getByText("Командний центр")).toBeDefined();
    expect(screen.getByText("Енергія")).toBeDefined();

    await actor.click(
      screen.getByRole("button", {
        name: "Оголосити катастрофу й почати"
      })
    );
    expect(beginMockGame).toHaveBeenCalledWith("K7M4Q2");
    expect(await screen.findByText("Форсаж генератора")).toBeDefined();
  });

  it("renders the private character and the shared playtest table", async () => {
    vi.mocked(getMockGame).mockResolvedValue(game);
    render(<GameScreen lobby={lobby} onEnded={vi.fn()} user={user} />);

    expect(await screen.findByText("Контрольована астма")).toBeDefined();
    expect(notifyCurrentPlayerTurn).toHaveBeenCalledOnce();
    expect(document.querySelector(".turn-center.own-turn")).not.toBeNull();
    expect(
      document
        .querySelector(".view-layout")
        ?.classList.contains("reaction-pending")
    ).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Стіл" }));
    expect(
      screen.getByRole("table", {
        name: "Публічні характеристики гравців"
      }).textContent
    ).toContain("Максим");
    expect(
      screen.getByRole("list", {
        name: "Гравці за столом"
      }).textContent
    ).toContain("Максим");
  });

  it("keeps the per-second timer text out of the turn's live region", async () => {
    vi.mocked(getMockGame).mockResolvedValue(game);
    render(<GameScreen lobby={lobby} onEnded={vi.fn()} user={user} />);

    await screen.findByText("Контрольована астма");
    const timerSpan = document.querySelector(".turn-center .timer");
    expect(timerSpan?.getAttribute("aria-live")).toBe("off");
    const progressBar = screen.getByRole("progressbar");
    expect(progressBar.getAttribute("aria-live")).toBe("off");
  });

  it("signals a server-side automatic turn skip", async () => {
    vi.mocked(getMockGame).mockResolvedValue({
      ...game,
      currentTurnPlayerId: "525252",
      lastEvent:
        "Час Вадим вичерпано. Автоматично відкрито «Здоров’я», виступ пропущено."
    });
    render(<GameScreen lobby={lobby} onEnded={vi.fn()} user={user} />);

    expect(await screen.findByText(/виступ пропущено/u)).toBeDefined();
    await waitFor(() =>
      expect(notifyTimerExpired).toHaveBeenCalledOnce()
    );
  });

  it("plays an action card during the current player turn", async () => {
    vi.mocked(getMockGame).mockResolvedValue(game);
    vi.mocked(usePlaytestCard).mockResolvedValue({
      ...game,
      card: { ...game.card, used: true },
      cardChain: {
        action: {
          description: game.card.description,
          effectId: game.card.effectId,
          id: game.card.id,
          kind: game.card.kind,
          title: game.card.title
        },
        actionSelection: {},
        actorPlayerId: user.id,
        deadline: new Date(Date.now() + 15_000).toISOString(),
        reactions: []
      },
      phase: "reaction",
      turnDeadline: null
    });
    const actor = userEvent.setup();
    render(<GameScreen lobby={lobby} onEnded={vi.fn()} user={user} />);

    await actor.click(
      await screen.findByRole("button", { name: "Використати картку" })
    );

    expect(usePlaytestCard).toHaveBeenCalledWith("K7M4Q2", {});
    expect(await screen.findByText("ЛАНЦЮЖОК КАРТОК")).toBeDefined();
  });

  it("scales the turn-progress bar to the actual reaction window instead of the turn duration", async () => {
    const reactionGame: MockGameView = {
      ...game,
      cardChain: {
        action: {
          description: game.card.description,
          effectId: game.card.effectId,
          id: game.card.id,
          kind: game.card.kind,
          title: game.card.title
        },
        actionSelection: {},
        actorPlayerId: "525252",
        deadline: new Date(Date.now() + 15_000).toISOString(),
        reactions: []
      },
      phase: "reaction",
      turnDeadline: null
    };
    vi.mocked(getMockGame).mockResolvedValue(reactionGame);
    render(<GameScreen lobby={lobby} onEnded={vi.fn()} user={user} />);

    const progressBar = await screen.findByRole("progressbar");
    await waitFor(() => {
      const value = Number(progressBar.getAttribute("aria-valuenow"));
      expect(value).toBeGreaterThan(80);
    });
  });

  it("requires and sends the selected card target", async () => {
    const targetedGame: MockGameView = {
      ...game,
      card: {
        ...game.card,
        description: "Додайте один голос проти обраного гравця.",
        id: "public-accusation",
        selection: ["target_player"],
        target: "any_non_afk_player",
        title: "Публічне звинувачення"
      }
    };
    vi.mocked(getMockGame).mockResolvedValue(targetedGame);
    vi.mocked(usePlaytestCard).mockResolvedValue(targetedGame);
    const actor = userEvent.setup();
    render(<GameScreen lobby={lobby} onEnded={vi.fn()} user={user} />);

    const button = await screen.findByRole("button", {
      name: "Використати картку"
    });
    expect(button.hasAttribute("disabled")).toBe(true);
    await actor.selectOptions(
      screen.getByRole("combobox", { name: "Ціль" }),
      "525252"
    );
    await actor.click(button);

    expect(usePlaytestCard).toHaveBeenCalledWith("K7M4Q2", {
      targetPlayerId: "525252"
    });
  });

  it("lets another player answer with a reaction card", async () => {
    const reactionPlayer = {
      firstName: "Максим",
      id: "525252"
    };
    const reactionGame: MockGameView = {
      ...game,
      card: {
        description: "Скасуйте попередню картку.",
        effectId: "card.cancel",
        id: "countermeasure",
        kind: "reaction",
        title: "Контрзахід",
        used: false
      },
      cardChain: {
        action: {
          description: game.card.description,
          effectId: game.card.effectId,
          id: game.card.id,
          kind: game.card.kind,
          title: game.card.title
        },
        actionSelection: {},
        actorPlayerId: user.id,
        deadline: new Date(Date.now() + 15_000).toISOString(),
        reactions: []
      },
      phase: "reaction",
      turnDeadline: null
    };
    vi.mocked(getMockGame).mockResolvedValue(reactionGame);
    vi.mocked(reactWithPlaytestCard).mockResolvedValue({
      ...reactionGame,
      card: { ...reactionGame.card, used: true }
    });
    const actor = userEvent.setup();
    render(
      <GameScreen
        lobby={lobby}
        onEnded={vi.fn()}
        user={reactionPlayer}
      />
    );

    const reactButton = await screen.findByRole("button", {
      name: "Зіграти реакцію"
    });
    expect(
      document
        .querySelector(".view-layout")
        ?.classList.contains("reaction-pending")
    ).toBe(true);
    expect(
      await screen.findByText(
        "Ваша реакція «Контрзахід»: Скасуйте попередню картку."
      )
    ).toBeDefined();

    await actor.click(reactButton);

    expect(reactWithPlaytestCard).toHaveBeenCalledWith("K7M4Q2", {}, 0);
  });

  it("lets a targeted reaction counter the first reaction without a target", async () => {
    const reactionPlayer = {
      firstName: "Ірина",
      id: "626262"
    };
    const reactionGame: MockGameView = {
      ...game,
      card: {
        description: "Перенаправте дію на іншого гравця.",
        effectId: "vote.redirect",
        id: "redirect",
        kind: "reaction",
        selection: ["target_player"],
        target: "any_non_afk_player",
        title: "Зміна адресата",
        used: false
      },
      cardChain: {
        action: {
          description: "Відкрийте характеристику іншого гравця.",
          effectId: "characteristic.force_reveal",
          id: "forced-disclosure",
          kind: "action",
          selection: ["target_player", "characteristic"],
          target: "any_non_afk_player",
          title: "Примусове розкриття"
        },
        actionSelection: {
          characteristicId: "health",
          targetPlayerId: "525252"
        },
        actorPlayerId: user.id,
        deadline: new Date(Date.now() + 15_000).toISOString(),
        reactions: [
          {
            card: {
              description: "Скасуйте дію.",
              effectId: "card.cancel",
              id: "countermeasure",
              kind: "reaction",
              title: "Контрзахід"
            },
            playerId: "525252",
            selection: {}
          }
        ]
      },
      phase: "reaction",
      players: [
        ...game.players,
        {
          characteristics: {},
          firstName: "Ірина",
          id: reactionPlayer.id,
          position: 3,
          status: "active"
        }
      ],
      turnDeadline: null
    };
    vi.mocked(getMockGame).mockResolvedValue(reactionGame);
    vi.mocked(reactWithPlaytestCard).mockResolvedValue({
      ...reactionGame,
      card: { ...reactionGame.card, used: true }
    });
    const actor = userEvent.setup();
    render(
      <GameScreen
        lobby={lobby}
        onEnded={vi.fn()}
        user={reactionPlayer}
      />
    );

    const reactionButton = await screen.findByRole("button", {
      name: "Зіграти реакцію"
    });
    expect(screen.queryByRole("combobox", { name: "Ціль" })).toBeNull();
    expect(
      await screen.findByText(
        "Перша реакція — «Контрзахід»: Скасуйте дію. Друга реакція " +
          "скасує цю дію й поверне «Примусове розкриття»."
      )
    ).toBeDefined();
    await actor.click(reactionButton);

    expect(reactWithPlaytestCard).toHaveBeenCalledWith("K7M4Q2", {}, 1);
  });

  it("publishes the selected characteristic through the backend", async () => {
    vi.mocked(getMockGame).mockResolvedValue({ ...game, round: 2 });
    vi.mocked(revealMockCharacteristic).mockResolvedValue({
      ...game,
      characteristics: game.characteristics.map((characteristic) =>
        characteristic.id === "health"
          ? { ...characteristic, revealed: true }
          : characteristic
      ),
      round: 2,
      turnRevealedCharacteristicId: "health",
      turnStage: "speaking"
    });
    render(<GameScreen lobby={lobby} onEnded={vi.fn()} user={user} />);

    const actor = userEvent.setup();
    const value = await screen.findByText("Контрольована астма");
    await actor.click(value.closest("button") as HTMLButtonElement);
    await actor.click(
      screen.getByRole("button", { name: "Відкрити «Здоров’я»" })
    );
    await actor.click(
      screen.getByRole("button", { name: "Відкрити публічно" })
    );

    expect(revealMockCharacteristic).toHaveBeenCalledWith(
      "K7M4Q2",
      "health"
    );
    expect(notifyCurrentPlayerTurn).toHaveBeenCalledOnce();
    expect(await screen.findByText("ВАШ ВИСТУП")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Завершити виступ" })
    ).toBeDefined();
  });

  it("keeps the turn for the speech and lets the player end it", async () => {
    const speakingGame: MockGameView = {
      ...game,
      characteristics: game.characteristics.map((characteristic) =>
        characteristic.id === "health"
          ? { ...characteristic, revealed: true }
          : characteristic
      ),
      turnRevealedCharacteristicId: "health",
      turnStage: "speaking"
    };
    vi.mocked(getMockGame).mockResolvedValue(speakingGame);
    vi.mocked(finishMockTurn).mockResolvedValue({
      ...game,
      currentTurnPlayerId: "525252",
      turnStage: "choosing"
    });
    const actor = userEvent.setup();
    render(<GameScreen lobby={lobby} onEnded={vi.fn()} user={user} />);

    expect(await screen.findByText("ВАШ ВИСТУП")).toBeDefined();
    expect(
      screen.getByRole("region", { name: "Поточний хід" }).textContent
    ).not.toContain("Контрольована астма");
    await actor.click(
      screen.getByRole("button", { name: "Завершити виступ" })
    );

    expect(finishMockTurn).toHaveBeenCalledWith("K7M4Q2");
    expect(await screen.findByText("ХІД ГРАВЦЯ")).toBeDefined();
  });

  it("lets the host propose one of the latest rollback checkpoints", async () => {
    const checkpoint = {
      createdAt: "2026-08-11T09:00:00.000Z",
      eventsAfter: 2,
      id: "00000000-0000-4000-8000-000000000002",
      label: "Перед відкриттям «Здоров’я»",
      phase: "revealing" as const,
      round: 1
    };
    const checkpointGame: MockGameView = {
      ...game,
      rollback: {
        ...game.rollback,
        checkpoints: [checkpoint]
      }
    };
    vi.mocked(getMockGame).mockResolvedValue(checkpointGame);
    vi.mocked(proposeRollback).mockResolvedValue({
      ...checkpointGame,
      rollback: {
        ...checkpointGame.rollback,
        paused: true,
        proposal: {
          approvals: 1,
          checkpointId: checkpoint.id,
          checkpointLabel: checkpoint.label,
          hasVoted: true,
          id: "00000000-0000-4000-8000-000000000003",
          initiatedByPlayerId: user.id,
          reason: "Помилкове відкриття",
          rejections: 0,
          requiredApprovals: 2
        }
      }
    });
    const actor = userEvent.setup();
    render(<GameScreen lobby={lobby} onEnded={vi.fn()} user={user} />);

    await actor.click(
      await screen.findByRole("button", { name: "Відновлення" })
    );
    await actor.click(
      screen.getByRole("button", {
        name: /Перед відкриттям «Здоров’я»/u
      })
    );
    await actor.type(
      screen.getByRole("textbox", { name: "Причина відновлення" }),
      "Помилкове відкриття"
    );
    await actor.click(
      screen.getByRole("button", { name: "Запросити голосування" })
    );

    expect(proposeRollback).toHaveBeenCalledWith(
      "K7M4Q2",
      checkpoint.id,
      "Помилкове відкриття"
    );
    expect(await screen.findByText("ГРА ПРИЗУПИНЕНА")).toBeDefined();
  });

  it("tells a non-host what to do if the host is unresponsive after a rollback restore", async () => {
    const restoredGame: MockGameView = {
      ...game,
      rollback: {
        ...game.rollback,
        paused: true,
        proposal: null
      }
    };
    vi.mocked(getMockGame).mockResolvedValue(restoredGame);
    render(
      <GameScreen
        lobby={lobby}
        onEnded={vi.fn()}
        user={{ firstName: "Максим", id: "525252" }}
      />
    );

    expect(await screen.findByText("Стан гри відновлено")).toBeDefined();
    expect(
      screen.getByText(/Ведучий перевіряє відновлений стан\./u)
    ).toBeDefined();
    expect(
      screen.getByText(/автоматичної передачі ролі ведучого зараз немає/u)
    ).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Стан правильний — продовжити" })
    ).toBeNull();
  });

  it("shows timed discussion and lets only the host start voting early", async () => {
    const discussionGame: MockGameView = {
      ...game,
      currentTurnPlayerId: null,
      phase: "discussion",
      turnDeadline: new Date(Date.now() + 180_000).toISOString(),
      turnRevealedCharacteristicId: null,
      turnStage: null
    };
    vi.mocked(getMockGame).mockResolvedValue(discussionGame);
    vi.mocked(finishMockDiscussion).mockResolvedValue({
      ...discussionGame,
      phase: "voting",
      turnDeadline: null,
      voting: {
        attempt: 1,
        candidatePlayerIds: game.players.map((player) => player.id),
        expected: 2,
        hasVoted: false,
        openVotes: [],
        silenced: false,
        submitted: 0,
        totals: []
      }
    });
    const actor = userEvent.setup();
    render(<GameScreen lobby={lobby} onEnded={vi.fn()} user={user} />);

    expect(await screen.findByText("ЗАГАЛЬНЕ ОБГОВОРЕННЯ")).toBeDefined();
    await actor.click(
      screen.getByRole("button", { name: "Перейти до голосування" })
    );

    expect(finishMockDiscussion).toHaveBeenCalledWith("K7M4Q2");
    expect(await screen.findByText("ГОЛОСУВАННЯ")).toBeDefined();
  });

  it("lets the host finish the test game", async () => {
    vi.mocked(getMockGame).mockResolvedValue(game);
    vi.mocked(leaveLobby).mockResolvedValue({ cancelled: true });
    const onEnded = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const actor = userEvent.setup();
    render(<GameScreen lobby={lobby} onEnded={onEnded} user={user} />);

    await actor.click(
      await screen.findByRole("button", {
        name: "Завершити гру"
      })
    );

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(leaveLobby).toHaveBeenCalledWith("K7M4Q2");
    expect(onEnded).toHaveBeenCalledOnce();
  });

  it("keeps the game open when the host cancels finish confirmation", async () => {
    vi.mocked(getMockGame).mockResolvedValue(game);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const actor = userEvent.setup();
    render(<GameScreen lobby={lobby} onEnded={vi.fn()} user={user} />);

    await actor.click(
      await screen.findByRole("button", {
        name: "Завершити гру"
      })
    );

    expect(leaveLobby).not.toHaveBeenCalled();
  });

  it("does not offer global finish to a non-host player", async () => {
    vi.mocked(getMockGame).mockResolvedValue(game);
    render(
      <GameScreen
        lobby={lobby}
        onEnded={vi.fn()}
        user={{ firstName: "Максим", id: "525252" }}
      />
    );

    expect(await screen.findByText("Палеонтолог")).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Завершити гру" })
    ).toBeNull();
  });

  it("keeps the active game visible when finishing fails", async () => {
    vi.mocked(getMockGame).mockResolvedValue(game);
    vi.mocked(leaveLobby).mockRejectedValue(new Error("offline"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onEnded = vi.fn();
    const actor = userEvent.setup();
    render(<GameScreen lobby={lobby} onEnded={onEnded} user={user} />);

    await actor.click(
      await screen.findByRole("button", {
        name: "Завершити гру"
      })
    );

    await waitFor(() => expect(leaveLobby).toHaveBeenCalledOnce());
    expect(onEnded).not.toHaveBeenCalled();
    expect(screen.getByText("Палеонтолог")).toBeDefined();
    expect(
      await screen.findByText(
        "Не вдалося завершити партію. Спробуйте ще раз."
      )
    ).toBeDefined();
  });

  it("submits a secret vote for an active candidate", async () => {
    const votingGame: MockGameView = {
      ...game,
      currentTurnPlayerId: null,
      phase: "voting",
      voting: {
        attempt: 1,
        candidatePlayerIds: game.players.map((player) => player.id),
        expected: 2,
        hasVoted: false,
        openVotes: [],
        silenced: false,
        submitted: 0,
        totals: []
      }
    };
    vi.mocked(getMockGame).mockResolvedValue(votingGame);
    vi.mocked(submitVote).mockResolvedValue({
      ...votingGame,
      voting: {
        ...votingGame.voting!,
        hasVoted: true,
        submitted: 1
      }
    });
    const actor = userEvent.setup();
    render(<GameScreen lobby={lobby} onEnded={vi.fn()} user={user} />);

    await actor.click(
      await screen.findByRole("button", {
        name: "Голосувати: #2 · Максим"
      })
    );
    expect(submitVote).not.toHaveBeenCalled();
    expect(
      screen.getByText("#2 · Максим", { selector: "strong" })
    ).toBeDefined();

    await actor.click(
      screen.getByRole("button", { name: "Підтвердити голос" })
    );

    expect(submitVote).toHaveBeenCalledWith("K7M4Q2", "525252", 1);
    expect(await screen.findByText(/Голос прийнято/u)).toBeDefined();
  });

  it("tells a silenced player their vote will not be counted", async () => {
    const votingGame: MockGameView = {
      ...game,
      currentTurnPlayerId: null,
      phase: "voting",
      voting: {
        attempt: 1,
        candidatePlayerIds: game.players.map((player) => player.id),
        expected: 1,
        hasVoted: false,
        openVotes: [],
        silenced: true,
        submitted: 0,
        totals: []
      }
    };
    vi.mocked(getMockGame).mockResolvedValue(votingGame);
    render(<GameScreen lobby={lobby} onEnded={vi.fn()} user={user} />);

    expect(
      await screen.findByText(
        "Цього разу ваш голос не враховується в підрахунку."
      )
    ).toBeDefined();
  });

  it("disambiguates same-named candidates and ignores a double-tapped confirm", async () => {
    const alex1 = {
      characteristics: {},
      firstName: "Олександр",
      id: "700001",
      lastName: "Коваленко",
      position: 3,
      status: "active" as const
    };
    const alex2 = {
      characteristics: {},
      firstName: "Олександр",
      id: "700002",
      lastName: "Петриченко-Забродський",
      position: 4,
      status: "active" as const
    };
    const votingGame: MockGameView = {
      ...game,
      currentTurnPlayerId: null,
      phase: "voting",
      players: [...game.players, alex1, alex2],
      voting: {
        attempt: 1,
        candidatePlayerIds: [alex1.id, alex2.id],
        expected: 4,
        hasVoted: false,
        openVotes: [],
        silenced: false,
        submitted: 0,
        totals: []
      }
    };
    vi.mocked(getMockGame).mockResolvedValue(votingGame);
    let resolveVote: ((value: MockGameView) => void) | undefined;
    vi.mocked(submitVote).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveVote = resolve;
        })
    );
    const actor = userEvent.setup();
    render(<GameScreen lobby={lobby} onEnded={vi.fn()} user={user} />);

    const button1 = await screen.findByRole("button", {
      name: "Голосувати: #3 · Олександр Коваленко"
    });
    const button2 = screen.getByRole("button", {
      name: "Голосувати: #4 · Олександр Петриченко-Забродський"
    });
    expect(button1).not.toBe(button2);

    await actor.click(button2);
    const confirmButton = screen.getByRole("button", {
      name: "Підтвердити голос"
    });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    expect(submitVote).toHaveBeenCalledTimes(1);
    expect(submitVote).toHaveBeenCalledWith("K7M4Q2", alex2.id, 1);

    resolveVote?.({
      ...votingGame,
      voting: { ...votingGame.voting!, hasVoted: true, submitted: 1 }
    });
    expect(await screen.findByText(/Голос прийнято/u)).toBeDefined();
  });

  it("lets the host decide the final team outcome", async () => {
    const finalGame: MockGameView = {
      ...game,
      currentTurnPlayerId: null,
      demography: {
        eligibleMen: 1,
        eligibleWomen: 1,
        femaleAgeRange: { max: 49, min: 18 },
        maleAgeRange: { max: 64, min: 18 },
        preserved: true,
        requiredMen: 1,
        requiredWomen: 1
      },
      phase: "final_check"
    };
    vi.mocked(getMockGame).mockResolvedValue(finalGame);
    vi.mocked(submitFinalOutcome).mockResolvedValue({
      ...finalGame,
      finalOutcome: "all_survive",
      phase: "completed"
    });
    const actor = userEvent.setup();
    render(<GameScreen lobby={lobby} onEnded={vi.fn()} user={user} />);

    await actor.click(
      await screen.findByRole("button", { name: "Усі вижили" })
    );

    expect(submitFinalOutcome).toHaveBeenCalledWith(
      "K7M4Q2",
      "all_survive"
    );
    expect(await screen.findByText(/Перемога/u)).toBeDefined();
  });

  it("does not blame the secret goal for a loss when secret goals are disabled", async () => {
    const finalGame: MockGameView = {
      ...game,
      currentTurnPlayerId: null,
      demography: {
        eligibleMen: 1,
        eligibleWomen: 1,
        femaleAgeRange: { max: 49, min: 18 },
        maleAgeRange: { max: 64, min: 18 },
        preserved: true,
        requiredMen: 1,
        requiredWomen: 1
      },
      phase: "final_check",
      secretGoal: null
    };
    vi.mocked(getMockGame).mockResolvedValue(finalGame);
    vi.mocked(submitFinalOutcome).mockResolvedValue({
      ...finalGame,
      finalOutcome: "team_loss",
      phase: "completed"
    });
    const actor = userEvent.setup();
    render(<GameScreen lobby={lobby} onEnded={vi.fn()} user={user} />);

    expect(
      await screen.findByRole("button", { name: "Поразка через сценарій" })
    ).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Поразка через таємну ціль" })
    ).toBeNull();

    await actor.click(
      screen.getByRole("button", { name: "Поразка через сценарій" })
    );

    expect(submitFinalOutcome).toHaveBeenCalledWith("K7M4Q2", "team_loss");
    expect(
      await screen.findByText(
        "Поразка: умови сценарію завадили групі вижити."
      )
    ).toBeDefined();
  });

  it("blocks a victory when the automatic demographic check fails", async () => {
    vi.mocked(getMockGame).mockResolvedValue({
      ...game,
      currentTurnPlayerId: null,
      demography: {
        eligibleMen: 0,
        eligibleWomen: 1,
        femaleAgeRange: { max: 49, min: 18 },
        maleAgeRange: { max: 64, min: 18 },
        preserved: false,
        requiredMen: 1,
        requiredWomen: 1
      },
      phase: "final_check"
    });
    render(<GameScreen lobby={lobby} onEnded={vi.fn()} user={user} />);

    const victoryButton = await screen.findByRole("button", {
      name: "Усі вижили"
    });
    expect((victoryButton as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByRole("button", {
        name: "Завершити: демографію не збережено"
      })
    ).toBeDefined();
    expect(screen.getByText("УМОВУ НЕ ВИКОНАНО")).toBeDefined();
    expect(screen.getByText("0 / 1")).toBeDefined();
  });

  it("shows open tie votes without allowing another vote", async () => {
    vi.mocked(getMockGame).mockResolvedValue({
      ...game,
      currentTurnPlayerId: null,
      phase: "voting",
      voting: {
        attempt: 3,
        candidatePlayerIds: game.players.map((player) => player.id),
        expected: 2,
        hasVoted: true,
        openVotes: [
          {
            targetPlayerId: "525252",
            voterPlayerId: user.id
          }
        ],
        silenced: false,
        submitted: 1,
        totals: [{ targetPlayerId: "525252", votes: 1 }]
      }
    });
    render(<GameScreen lobby={lobby} onEnded={vi.fn()} user={user} />);

    expect(await screen.findByText("ВІДКРИТА НІЧИЯ")).toBeDefined();
    expect(screen.getByText(/Вадим.*Максим/u)).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Голосувати: Максим" })
    ).toBeNull();
  });

  it("makes a non-host wait for the host final verdict", async () => {
    vi.mocked(getMockGame).mockResolvedValue({
      ...game,
      currentTurnPlayerId: null,
      phase: "final_check"
    });
    render(
      <GameScreen
        lobby={lobby}
        onEnded={vi.fn()}
        user={{ firstName: "Максим", id: "525252" }}
      />
    );

    expect(
      await screen.findByText(/Очікуємо фінальне рішення ведучого\./u)
    ).toBeDefined();
    expect(
      screen.getByText(/автоматичної передачі ролі ведучого зараз немає/u)
    ).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Усі вижили" })
    ).toBeNull();
  });
});
