// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { MockGameView } from "@bunker/contracts";

import { App } from "./App.js";

const baseGame: MockGameView = {
  bunkerCapacity: 2,
  card: {
    description: "Скасуйте щойно розіграну картку дії.",
    effectId: "card.cancel",
    id: "countermeasure",
    kind: "reaction",
    title: "Контрзахід",
    used: false
  },
  cardChain: {
    action: {
      description: "Зменшує увагу хижаків на 2.",
      effectId: "resource.predator_attention_down",
      id: "silent-night",
      kind: "action",
      title: "Тиха ніч"
    },
    actionSelection: {},
    actorPlayerId: "maksym",
    deadline: new Date(Date.now() + 15_000).toISOString(),
    reactions: []
  },
  cardResult: null,
  characteristics: [
    { id: "profession", label: "Професія", revealed: false, value: "Палеонтолог" }
  ],
  code: "TEST01",
  currentTurnPlayerId: "maksym",
  demography: null,
  dossierNumber: 7,
  finalOutcome: null,
  hostPlayerId: "olena",
  lastEvent: null,
  phase: "reaction",
  players: [
    {
      characteristics: {},
      firstName: "Олена",
      id: "olena",
      position: 1,
      status: "active"
    },
    {
      characteristics: { profession: "Сапер" },
      firstName: "Максим",
      id: "maksym",
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
  round: 2,
  scenario: {
    ageRating: "16+",
    bunker: {
      condition: "Стабільний",
      description: "База",
      limitations: [],
      rooms: [],
      supplies: []
    },
    catastrophe: { description: "Опис", title: "КАТАСТРОФА" },
    contentWarnings: [],
    id: "operation-chalk",
    resources: [],
    reveals: [],
    summary: "Резюме",
    title: "Операція крейда"
  },
  secretGoal: "Потрапте до бункера та збережіть наукове обладнання.",
  status: "started",
  turnDeadline: null,
  turnRevealedCharacteristicId: null,
  turnStage: null,
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
});

describe("App interactions", () => {
  it("describes private values as not publicly revealed and marks the selection", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getAllByText("НЕ ВІДКРИТО")).toHaveLength(7);
    expect(screen.queryByText("ЗАКРИТО")).toBeNull();

    const value = screen.getByText("Спокійна під тиском");
    await user.click(value.closest("button") as HTMLButtonElement);

    expect(screen.getByText("ОБРАНО")).toBeDefined();
    expect(screen.getAllByText("НЕ ВІДКРИТО")).toHaveLength(6);
  });

  it("publishes a confirmed characteristic to the table view", async () => {
    const user = userEvent.setup();
    render(<App />);

    const healthValue = screen.getByText("Контрольована астма");
    const healthButton = healthValue.closest("button");
    expect(healthButton).not.toBeNull();

    await user.click(healthButton as HTMLButtonElement);
    await user.click(
      screen.getByRole("button", { name: "Відкрити «Здоров’я»" })
    );

    expect(
      screen.getByRole("dialog", { name: "Відкрити «Здоров’я»?" })
    ).toBeDefined();

    await user.click(
      screen.getByRole("button", { name: "Відкрити публічно" })
    );
    await user.click(screen.getByRole("button", { name: "Стіл" }));

    const table = screen.getByRole("table", {
      name: "Публічні характеристики гравців"
    });
    expect(table.textContent).toContain("Контрольована астма");
    expect(screen.queryByText("ТАЄМНА ЦІЛЬ")).toBeNull();
  });

  it("hides and restores the private dossier", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Приховати" }));
    expect(screen.queryByText("Контрольована астма")).toBeNull();
    expect(screen.getByText("Досьє приховано")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Показати" }));
    expect(screen.getByText("Контрольована астма")).toBeDefined();
  });

  it("closes the reveal dialog when the native cancel event fires", async () => {
    const user = userEvent.setup();
    render(<App />);

    const value = screen.getByText("Контрольована астма");
    await user.click(value.closest("button") as HTMLButtonElement);
    await user.click(
      screen.getByRole("button", { name: "Відкрити «Здоров’я»" })
    );

    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { cancelable: true })
    );

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the reaction action reachable from the table tab", async () => {
    const user = userEvent.setup();
    render(
      <App
        currentUser={{ firstName: "Олена", id: "olena" }}
        game={baseGame}
        initialView="table"
      />
    );

    expect(
      screen
        .getByRole("button", { name: "Стіл" })
        .getAttribute("aria-pressed")
    ).toBe("true");
    expect(screen.getByText("Контрзахід")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Зіграти реакцію" })
    ).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Бункер" }));
    expect(screen.getByText("Контрзахід")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Зіграти реакцію" })
    ).toBeDefined();
  });

  it("keeps the discussion action reachable while re-reading the dossier", async () => {
    const user = userEvent.setup();
    const discussionGame: MockGameView = {
      ...baseGame,
      cardChain: null,
      phase: "discussion"
    };
    render(
      <App
        currentUser={{ firstName: "Олена", id: "olena" }}
        game={discussionGame}
        initialView="table"
      />
    );

    expect(
      screen.getByRole("button", { name: "Перейти до голосування" })
    ).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Досьє" }));

    expect(screen.getByText("Потрапте до бункера та збережіть наукове обладнання.")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Перейти до голосування" })
    ).toBeDefined();
  });

  it("filters a duplicate order-swap card the same as change-order", () => {
    const cutTheLineGame: MockGameView = {
      ...baseGame,
      card: {
        description: "Поставте обраного гравця наступним у черзі цього раунду.",
        effectId: "order.swap",
        id: "cut-the-line",
        kind: "action",
        selection: ["target_player"],
        target: "any_non_afk_player",
        title: "Витіснення з черги",
        used: false
      },
      cardChain: null,
      currentTurnPlayerId: "olena",
      phase: "revealing",
      players: [
        {
          characteristics: {},
          firstName: "Олена",
          id: "olena",
          position: 2,
          status: "active"
        },
        {
          characteristics: {},
          firstName: "Максим",
          id: "maksym",
          position: 1,
          status: "active"
        },
        {
          characteristics: {},
          firstName: "Ірина",
          id: "iryna",
          position: 3,
          status: "active"
        }
      ]
    };
    render(
      <App
        currentUser={{ firstName: "Олена", id: "olena" }}
        game={cutTheLineGame}
      />
    );

    const options = screen
      .getByLabelText("Ціль")
      .querySelectorAll("option");
    const optionNames = Array.from(options).map(
      (option) => option.textContent
    );
    expect(optionNames).toContain("Ірина ");
    expect(optionNames).not.toContain("Максим ");
  });

  it("only offers already-revealed targets for a force-reroll card", async () => {
    const user = userEvent.setup();
    const fakeDiplomaGame: MockGameView = {
      ...baseGame,
      card: {
        description: "Примусово перегенеруйте вже відкриту характеристику іншого гравця.",
        effectId: "characteristic.force_reroll",
        id: "fake-diploma",
        kind: "action",
        selection: ["target_player", "characteristic"],
        target: "any_non_afk_player",
        title: "Фейковий диплом",
        used: false
      },
      cardChain: null,
      characteristics: [
        ...baseGame.characteristics,
        { id: "age-gender", label: "Вік і стать", revealed: false, value: "Жінка, 28 років" }
      ],
      currentTurnPlayerId: "olena",
      phase: "revealing",
      players: [
        {
          characteristics: {},
          firstName: "Олена",
          id: "olena",
          position: 1,
          status: "active"
        },
        {
          characteristics: { profession: "Сапер" },
          firstName: "Максим",
          id: "maksym",
          position: 2,
          status: "active"
        }
      ]
    };
    render(
      <App
        currentUser={{ firstName: "Олена", id: "olena" }}
        game={fakeDiplomaGame}
      />
    );

    await user.selectOptions(
      screen.getByLabelText("Ціль"),
      "maksym"
    );

    const options = screen
      .getByLabelText("Характеристика")
      .querySelectorAll("option");
    const optionNames = Array.from(options).map(
      (option) => option.textContent
    );
    expect(optionNames).toContain("Професія");
    expect(optionNames).not.toContain("Вік і стать");
  });

  it("sends only one reveal request when the confirm button is double-clicked", async () => {
    const user = userEvent.setup();
    let resolveReveal: (() => void) | undefined;
    const onReveal = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveReveal = resolve;
        })
    );
    const revealingGame: MockGameView = {
      ...baseGame,
      cardChain: null,
      currentTurnPlayerId: "olena",
      phase: "revealing",
      turnStage: "choosing"
    };
    render(
      <App
        currentUser={{ firstName: "Олена", id: "olena" }}
        game={revealingGame}
        onReveal={onReveal}
      />
    );

    await user.click(screen.getByText("Палеонтолог"));
    await user.click(
      screen.getByRole("button", { name: "Відкрити «Професія»" })
    );
    const confirmButton = screen.getByRole("button", {
      name: "Відкрити публічно"
    });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    expect(onReveal).toHaveBeenCalledTimes(1);
    resolveReveal?.();
  });
});
