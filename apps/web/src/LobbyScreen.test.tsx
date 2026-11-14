// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Lobby } from "@bunker/contracts";

import { LobbyScreen } from "./LobbyScreen.js";
import {
  createLobby,
  getMockGame,
  getCurrentLobby,
  getLobby,
  joinLobby,
  leaveLobby,
  setLobbyReady,
  setLobbySecretGoals,
  startLobby
} from "./lobby-api.js";

vi.mock("./lobby-api.js", { spy: true });

const user = {
  firstName: "Вадим",
  id: "424242",
  username: "femida"
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
      ready: false,
      username: user.username
    }
  ],
  scenarioId: "operation-chalk",
  secretGoalsEnabled: true,
  status: "waiting"
};

class FakeEventSource extends EventTarget {
  static readonly instances: FakeEventSource[] = [];

  readonly url: string;

  constructor(url: string) {
    super();
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close() {}
}

beforeEach(() => {
  FakeEventSource.instances.length = 0;
  vi.mocked(getCurrentLobby).mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("LobbyScreen", () => {
  it("offers create and join actions to an authenticated player", async () => {
    render(<LobbyScreen user={user} />);

    expect(await screen.findByText("Вітаємо, Вадим")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Створити лобі" })
    ).toBeDefined();
    expect(screen.getByLabelText("Код лобі")).toBeDefined();
  });

  it("shows a controlled entry error when lobby restoration fails", async () => {
    vi.mocked(getCurrentLobby).mockRejectedValue(new Error("offline"));

    render(<LobbyScreen user={user} />);

    expect(await screen.findByText("Вітаємо, Вадим")).toBeDefined();
    expect(screen.getByRole("alert")).toBeDefined();
  });

  it("creates a lobby and identifies its host", async () => {
    vi.mocked(createLobby).mockResolvedValue(lobby);
    const actor = userEvent.setup();

    render(<LobbyScreen user={user} />);
    await actor.click(
      await screen.findByRole("button", { name: "Створити лобі" })
    );

    expect(await screen.findByText("K7M4Q2")).toBeDefined();
    expect(screen.getByText("Ведучий")).toBeDefined();
    expect(screen.getByText("1 / 16 гравців")).toBeDefined();
  });

  it("joins an invite automatically when no active lobby is restored", async () => {
    vi.mocked(getCurrentLobby).mockResolvedValue(null);
    vi.mocked(joinLobby).mockResolvedValue(lobby);

    render(<LobbyScreen initialJoinCode="K7M4Q2" user={user} />);

    expect(await screen.findByText("K7M4Q2")).toBeDefined();
    expect(joinLobby).toHaveBeenCalledWith("K7M4Q2");
  });

  it("warns when the invite code differs from the restored lobby", async () => {
    vi.mocked(getCurrentLobby).mockResolvedValue(lobby);

    render(<LobbyScreen initialJoinCode="ZZZZZZ" user={user} />);

    expect(await screen.findByText("K7M4Q2")).toBeDefined();
    expect(joinLobby).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("ZZZZZZ");
  });

  it("restores a lobby and marks the current player ready", async () => {
    vi.mocked(getCurrentLobby).mockResolvedValue(lobby);
    vi.mocked(setLobbyReady).mockResolvedValue({
      ...lobby,
      players: [
        {
          ...lobby.players[0]!,
          ready: true
        }
      ]
    });
    const actor = userEvent.setup();

    render(<LobbyScreen user={user} />);
    await actor.click(
      await screen.findByRole("button", { name: "Я готовий" })
    );

    expect(await screen.findByRole("button", { name: "Готово" })).toBeDefined();
    expect(setLobbyReady).toHaveBeenCalledWith("K7M4Q2", true);
  });

  it("offers the rules of this version before a player marks ready", async () => {
    vi.mocked(getCurrentLobby).mockResolvedValue(lobby);

    render(<LobbyScreen user={user} />);
    await screen.findByRole("button", { name: "Я готовий" });

    const rulesLink = screen.getByRole("link", {
      name: "Правила цієї партії"
    });
    expect(rulesLink.getAttribute("href")).toBe("/rules");
    expect(rulesLink.getAttribute("target")).toBe("_blank");
  });

  it("lets the host toggle secret goals for the lobby", async () => {
    vi.mocked(getCurrentLobby).mockResolvedValue(lobby);
    vi.mocked(setLobbySecretGoals).mockResolvedValue({
      ...lobby,
      secretGoalsEnabled: false
    });
    const actor = userEvent.setup();

    render(<LobbyScreen user={user} />);
    await actor.click(
      await screen.findByRole("checkbox", { name: "Секретні цілі" })
    );

    expect(setLobbySecretGoals).toHaveBeenCalledWith("K7M4Q2", false);
    const checkbox = await screen.findByRole<HTMLInputElement>("checkbox", {
      name: "Секретні цілі"
    });
    await waitFor(() => expect(checkbox.checked).toBe(false));
  });

  it("refreshes a waiting lobby when the realtime stream reports a change", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.mocked(getCurrentLobby).mockResolvedValue(lobby);
    vi.mocked(getLobby).mockResolvedValue({
      ...lobby,
      players: [
        ...lobby.players,
        {
          firstName: "Максим",
          id: "525252",
          isHost: false,
          position: 2,
          ready: false
        }
      ]
    });

    render(<LobbyScreen user={user} />);

    await screen.findByText("K7M4Q2");
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    FakeEventSource.instances[0]!.dispatchEvent(
      new MessageEvent("state_changed")
    );

    expect(await screen.findByText("Максим")).toBeDefined();
    expect(getLobby).toHaveBeenCalledWith("K7M4Q2");
  });

  it("shows a controlled error when invite copying fails", async () => {
    vi.mocked(getCurrentLobby).mockResolvedValue(lobby);
    const actor = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
      new Error("Clipboard unavailable")
    );

    render(<LobbyScreen user={user} />);
    await actor.click(
      await screen.findByRole("button", { name: "Копіювати посилання" })
    );

    expect(await screen.findByRole("alert")).toBeDefined();
  });

  it("gives the host a separate link for the shared projector screen", async () => {
    vi.mocked(getCurrentLobby).mockResolvedValue(lobby);
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();
    const actor = userEvent.setup();

    render(<LobbyScreen user={user} />);
    await actor.click(
      await screen.findByRole("button", {
        name: "Копіювати екран для проєктора"
      })
    );

    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/screen/K7M4Q2`
    );
  });

  it("confirms and cancels a lobby for its host", async () => {
    vi.mocked(getCurrentLobby).mockResolvedValue(lobby);
    vi.mocked(leaveLobby).mockResolvedValue({ cancelled: true });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const actor = userEvent.setup();

    render(<LobbyScreen user={user} />);
    await actor.click(
      await screen.findByRole("button", { name: "Скасувати лобі" })
    );

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(leaveLobby).toHaveBeenCalledWith("K7M4Q2");
    expect(await screen.findByText("Вітаємо, Вадим")).toBeDefined();
  });

  it("offers a regular player an exit instead of lobby cancellation", async () => {
    vi.mocked(getCurrentLobby).mockResolvedValue({
      ...lobby,
      hostPlayerId: "999999",
      players: [
        {
          ...lobby.players[0]!,
          isHost: false
        }
      ]
    });

    render(<LobbyScreen user={user} />);

    expect(
      await screen.findByRole("button", { name: "Вийти з лобі" })
    ).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Скасувати лобі" })
    ).toBeNull();
  });

  it("lets the host start a ready four-player playtest", async () => {
    const readyLobby: Lobby = {
      ...lobby,
      players: [
        { ...lobby.players[0]!, ready: true },
        {
          firstName: "Максим",
          id: "525252",
          isHost: false,
          position: 2,
          ready: true
        },
        {
          firstName: "Ірина",
          id: "626262",
          isHost: false,
          position: 3,
          ready: true
        },
        {
          firstName: "Данило",
          id: "727272",
          isHost: false,
          position: 4,
          ready: true
        }
      ]
    };
    vi.mocked(getCurrentLobby).mockResolvedValue(readyLobby);
    vi.mocked(startLobby).mockResolvedValue({
      ...readyLobby,
      status: "started"
    });
    vi.mocked(getMockGame).mockImplementation(() => new Promise(() => {}));
    const actor = userEvent.setup();

    render(<LobbyScreen user={user} />);
    await actor.click(
      await screen.findByRole("button", {
        name: "Запустити лобі"
      })
    );

    expect(startLobby).toHaveBeenCalledWith("K7M4Q2");
    expect(await screen.findByText("Завантажуємо гру…")).toBeDefined();
  });
});
