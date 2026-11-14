// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TelegramApp } from "./TelegramApp.js";
import { getCurrentLobby } from "./lobby-api.js";
import {
  TelegramAuthError,
  authenticateTelegramUser
} from "./telegram-auth.js";

vi.mock("./telegram-auth.js", { spy: true });
vi.mock("./lobby-api.js", { spy: true });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TelegramApp", () => {
  it("renders the authenticated Telegram player in the game", async () => {
    vi.mocked(getCurrentLobby).mockResolvedValue(null);
    vi.mocked(authenticateTelegramUser).mockResolvedValue({
      firstName: "Вадим",
      id: "424242",
      username: "femida"
    });

    render(<TelegramApp />);

    expect(screen.getByText("Підключаємо Telegram…")).toBeDefined();
    expect(await screen.findByText("Вітаємо, Вадим")).toBeDefined();
  });

  it("offers a retry after a temporary authorization failure", async () => {
    vi.mocked(getCurrentLobby).mockResolvedValue(null);
    vi.mocked(authenticateTelegramUser)
      .mockRejectedValueOnce(new TelegramAuthError("AUTH_FAILED"))
      .mockResolvedValueOnce({
        firstName: "Вадим",
        id: "424242"
      });
    const user = userEvent.setup();

    render(<TelegramApp />);

    const retry = await screen.findByRole("button", {
      name: "Спробувати ще раз"
    });
    await user.click(retry);

    await waitFor(() => {
      expect(authenticateTelegramUser).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText("Вітаємо, Вадим")).toBeDefined();
  });
});
