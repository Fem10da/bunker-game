// @vitest-environment jsdom

import {
  act,
  cleanup,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicGameView } from "@bunker/contracts";

import { getPublicGame, LobbyApiError } from "./lobby-api.js";
import { PublicScreen } from "./PublicScreen.js";
import { subscribeToPublicScreenUpdates } from "./realtime.js";

vi.mock("./lobby-api.js", { spy: true });
vi.mock("./realtime.js", { spy: true });

const game: PublicGameView = {
  activeDeadline: null,
  bunkerCapacity: 8,
  code: "K7M4Q2",
  currentTurnPlayerId: "424242",
  finalOutcome: null,
  lastEvent: "Олена відкрила «Професія» і почала виступ.",
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
      status: "active"
    }
  ],
  round: 2,
  scenario: {
    ageRating: "16+",
    bunker: {
      condition: "Основний корпус герметичний.",
      description: "Покинута дослідницька база.",
      limitations: [],
      rooms: [],
      supplies: []
    },
    catastrophe: {
      description: "Часова аномалія змінила світ.",
      title: "ЧАСОВИЙ РОЗЛОМ"
    },
    contentWarnings: [],
    id: "operation-chalk",
    resources: [
      { id: "energy", label: "Енергія", max: 10, value: 6 }
    ],
    reveals: [],
    summary: "Виживіть.",
    title: "Операція крейда"
  },
  rollbackPaused: false,
  status: "started",
  turnDeadline: null,
  turnRevealedCharacteristicId: "profession",
  turnStage: "speaking"
};

beforeEach(() => {
  vi.mocked(getPublicGame).mockResolvedValue(game);
  vi.mocked(subscribeToPublicScreenUpdates).mockReturnValue({
    close: vi.fn(),
    supported: true
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PublicScreen", () => {
  it("shows the projector-safe game state without Telegram authentication", async () => {
    render(<PublicScreen code="K7M4Q2" />);

    expect(await screen.findByText("Виступ гравця")).toBeDefined();
    expect(screen.getByText("Таксидерміст")).toBeDefined();
    expect(screen.getByText("8 / 2")).toBeDefined();
    expect(getPublicGame).toHaveBeenCalledWith("K7M4Q2");
    expect(subscribeToPublicScreenUpdates).toHaveBeenCalledWith(
      "K7M4Q2",
      expect.any(Object)
    );
  });

  it("renders the catastrophe briefing, public resources and eliminated players", () => {
    render(
      <PublicScreen
        code="K7M4Q2"
        previewGame={{
          ...game,
          currentTurnPlayerId: null,
          lastEvent: null,
          phase: "scenario_intro",
          players: [
            game.players[0]!,
            {
              ...game.players[1]!,
              lastName: "Коваль",
              status: "eliminated"
            }
          ],
          turnStage: null
        }}
      />
    );

    expect(screen.getByRole("heading", { name: "Оголошення катастрофи" }))
      .toBeDefined();
    expect(screen.getByText("ЧАСОВИЙ РОЗЛОМ")).toBeDefined();
    expect(screen.getByText("Основний корпус герметичний.")).toBeDefined();
    expect(screen.getByText("6/10")).toBeDefined();
    expect(screen.getByText("Максим Коваль")).toBeDefined();
    expect(screen.getByText("вибув")).toBeDefined();
    expect(getPublicGame).not.toHaveBeenCalled();
    expect(subscribeToPublicScreenUpdates).not.toHaveBeenCalled();
  });

  it("uses a clear title and instruction for every game phase", () => {
    const phases: readonly {
      readonly expected: string;
      readonly finalOutcome: PublicGameView["finalOutcome"];
      readonly phase: PublicGameView["phase"];
      readonly turnStage: PublicGameView["turnStage"];
    }[] = [
      {
        expected: "Вибір характеристики",
        finalOutcome: null,
        phase: "revealing",
        turnStage: "choosing"
      },
      {
        expected: "Вікно реакції",
        finalOutcome: null,
        phase: "reaction",
        turnStage: null
      },
      {
        expected: "Загальне обговорення",
        finalOutcome: null,
        phase: "discussion",
        turnStage: null
      },
      {
        expected: "Голосування",
        finalOutcome: null,
        phase: "voting",
        turnStage: null
      },
      {
        expected: "Фінальна перевірка",
        finalOutcome: null,
        phase: "final_check",
        turnStage: null
      },
      {
        expected: "Група вижила",
        finalOutcome: "all_survive",
        phase: "completed",
        turnStage: null
      },
      {
        expected: "Партію завершено",
        finalOutcome: "team_loss",
        phase: "completed",
        turnStage: null
      }
    ];

    for (const entry of phases) {
      const view = render(
        <PublicScreen
          code="K7M4Q2"
          previewGame={{
            ...game,
            finalOutcome: entry.finalOutcome,
            phase: entry.phase,
            turnStage: entry.turnStage
          }}
        />
      );

      expect(screen.getByRole("heading", { name: entry.expected }))
        .toBeDefined();
      view.unmount();
    }
  });

  it("shows a useful waiting state when the lobby has not started", async () => {
    vi.mocked(getPublicGame).mockRejectedValue(
      new LobbyApiError("LOBBY_NOT_FOUND")
    );

    render(<PublicScreen code="K7M4Q2" />);

    expect(await screen.findByText("Екран ще недоступний")).toBeDefined();
    expect(
      screen.getByText("Перевірте код або дочекайтеся запуску лобі ведучим.")
    ).toBeDefined();
  });

  it("keeps the per-second countdown out of the turn's live region", async () => {
    render(<PublicScreen code="K7M4Q2" previewGame={game} />);

    await screen.findByText("Виступ гравця");
    const countdown = document.querySelector(".public-screen-turn strong");
    expect(countdown?.getAttribute("aria-live")).toBe("off");
  });

  it("updates a public projection after realtime invalidation without credentials", async () => {
    let onConnectionChange: ((connected: boolean) => void) | undefined;
    let onStateChange: (() => void) | undefined;
    const updatedGame: PublicGameView = {
      ...game,
      currentTurnPlayerId: null,
      lastEvent: null,
      phase: "discussion",
      turnStage: null
    };
    vi.mocked(getPublicGame)
      .mockResolvedValueOnce(game)
      .mockResolvedValueOnce(updatedGame);
    vi.mocked(subscribeToPublicScreenUpdates).mockImplementation(
      (_code, callbacks) => {
        onConnectionChange = callbacks.onConnectionChange;
        onStateChange = callbacks.onStateChange;
        return { close: vi.fn(), supported: true };
      }
    );

    render(<PublicScreen code="K7M4Q2" />);
    await screen.findByText("Виступ гравця");

    onConnectionChange?.(false);
    expect(await screen.findByText("З'ЄДНАННЯ ПЕРЕВІРЯЄТЬСЯ")).toBeDefined();
    onStateChange?.();

    await waitFor(() => {
      expect(getPublicGame).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText("Загальне обговорення")).toBeDefined();
  });

  it("drops the stale table once the lobby is deleted mid-game", async () => {
    let onStateChange: (() => void) | undefined;
    vi.mocked(getPublicGame)
      .mockResolvedValueOnce(game)
      .mockRejectedValueOnce(new LobbyApiError("LOBBY_NOT_FOUND"));
    vi.mocked(subscribeToPublicScreenUpdates).mockImplementation(
      (_code, callbacks) => {
        onStateChange = callbacks.onStateChange;
        return { close: vi.fn(), supported: true };
      }
    );

    render(<PublicScreen code="K7M4Q2" />);
    await screen.findByText("Виступ гравця");

    onStateChange?.();

    expect(await screen.findByText("Партію завершено")).toBeDefined();
    expect(
      screen.getByText("Лобі видалено або завершено ведучим.")
    ).toBeDefined();
    expect(screen.queryByText("Виступ гравця")).toBeNull();
    expect(screen.queryByText("Таксидерміст")).toBeNull();
  });

  it("ignores a slow refresh response that resolves after a newer one", async () => {
    let onStateChange: (() => void) | undefined;
    const discussionGame: PublicGameView = {
      ...game,
      currentTurnPlayerId: null,
      lastEvent: null,
      phase: "discussion",
      turnStage: null
    };
    let resolveFirst: ((value: PublicGameView) => void) | undefined;
    const firstDeferred = new Promise<PublicGameView>((resolve) => {
      resolveFirst = resolve;
    });
    vi.mocked(getPublicGame)
      .mockResolvedValueOnce(game)
      .mockImplementationOnce(() => firstDeferred)
      .mockResolvedValueOnce(discussionGame);
    vi.mocked(subscribeToPublicScreenUpdates).mockImplementation(
      (_code, callbacks) => {
        onStateChange = callbacks.onStateChange;
        return { close: vi.fn(), supported: true };
      }
    );

    render(<PublicScreen code="K7M4Q2" />);
    await screen.findByText("Виступ гравця");

    onStateChange?.();
    onStateChange?.();
    await screen.findByText("Загальне обговорення");

    await act(async () => {
      resolveFirst?.(game);
      await Promise.resolve();
    });

    expect(screen.getByText("Загальне обговорення")).toBeDefined();
  });

  it("counts down an active deadline and refreshes the projection when it expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T14:00:00.000Z"));
    const timedGame: PublicGameView = {
      ...game,
      activeDeadline: "2026-07-27T14:00:01.000Z"
    };

    try {
      render(<PublicScreen code="K7M4Q2" previewGame={timedGame} />);
      await act(async () => Promise.resolve());
      expect(screen.getByText("00:01")).toBeDefined();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_200);
      });
      expect(screen.getByText("00:00")).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps making progress when every response arrives slower than the poll interval", async () => {
    vi.useFakeTimers();
    const discussionGame: PublicGameView = {
      ...game,
      currentTurnPlayerId: null,
      lastEvent: null,
      phase: "discussion",
      turnStage: null
    };
    let callCount = 0;
    vi.mocked(getPublicGame).mockImplementation(
      () =>
        new Promise((resolve) => {
          callCount += 1;
          const response = callCount === 1 ? game : discussionGame;
          setTimeout(() => resolve(response), 7_000);
        })
    );
    vi.mocked(subscribeToPublicScreenUpdates).mockImplementation(
      () => ({ close: vi.fn(), supported: true })
    );

    try {
      render(<PublicScreen code="K7M4Q2" />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(screen.getByText("Загальне обговорення")).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
