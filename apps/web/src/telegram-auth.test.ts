// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  authenticateTelegramUser,
  getTelegramStartParam,
  notifyCurrentPlayerTurn,
  notifyTimerExpired,
  type TelegramAuthError
} from "./telegram-auth.js";

const user = {
  firstName: "Вадим",
  id: "424242",
  username: "femida"
};

function response(status: number, body?: unknown) {
  return new Response(body === undefined ? undefined : JSON.stringify(body), {
    headers: {
      "content-type": "application/json"
    },
    status
  });
}

afterEach(() => {
  delete window.Telegram;
  vi.restoreAllMocks();
});

describe("authenticateTelegramUser", () => {
  it("reuses an active server session before sending Telegram initData", async () => {
    const ready = vi.fn();
    const expand = vi.fn();
    window.Telegram = {
      WebApp: {
        expand,
        initData: "signed-init-data",
        ready
      }
    };
    const request = vi.fn().mockResolvedValue(
      response(200, {
        data: { user },
        success: true
      })
    );

    await expect(authenticateTelegramUser(request)).resolves.toEqual(user);
    expect(ready).toHaveBeenCalledOnce();
    expect(expand).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith("/api/auth/session", {
      credentials: "include"
    });
  });

  it("exchanges Telegram initData after a missing server session", async () => {
    window.Telegram = {
      WebApp: {
        expand: vi.fn(),
        initData: "signed-init-data",
        ready: vi.fn()
      }
    };
    const request = vi
      .fn()
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(
        response(200, {
          data: { user },
          success: true
        })
      );

    await expect(authenticateTelegramUser(request)).resolves.toEqual(user);
    expect(request).toHaveBeenNthCalledWith(2, "/api/auth/telegram", {
      body: JSON.stringify({ initData: "signed-init-data" }),
      credentials: "include",
      headers: {
        "content-type": "application/json"
      },
      method: "POST"
    });
  });

  it("explains that the game must be opened inside Telegram", async () => {
    window.Telegram = {
      WebApp: {
        expand: vi.fn(),
        initData: "",
        ready: vi.fn()
      }
    };
    const request = vi.fn().mockResolvedValue(response(401));

    await expect(authenticateTelegramUser(request)).rejects.toMatchObject({
      code: "TELEGRAM_REQUIRED"
    } satisfies Partial<TelegramAuthError>);
    expect(request).toHaveBeenCalledOnce();
  });

  it("rejects malformed identity data returned by the API", async () => {
    const request = vi.fn().mockResolvedValue(
      response(200, {
        data: {
          user: {
            firstName: "",
            id: 42
          }
        },
        success: true
      })
    );

    await expect(authenticateTelegramUser(request)).rejects.toMatchObject({
      code: "AUTH_FAILED"
    } satisfies Partial<TelegramAuthError>);
  });

  it("reads only a lobby start parameter from Telegram initData", () => {
    window.Telegram = {
      WebApp: {
        expand: vi.fn(),
        initData: "start_param=join_k7m4q2&auth_date=1800000000",
        ready: vi.fn()
      }
    };

    expect(getTelegramStartParam()).toBe("K7M4Q2");

    window.Telegram = {
      WebApp: {
        ...window.Telegram.WebApp,
        initData: "start_param=unrelated"
      }
    };
    expect(getTelegramStartParam()).toBeUndefined();
  });

  it("uses Telegram haptics for a newly received turn", () => {
    const notificationOccurred = vi.fn();
    window.Telegram = {
      WebApp: {
        HapticFeedback: {
          notificationOccurred
        },
        expand: vi.fn(),
        initData: "",
        ready: vi.fn()
      }
    };

    notifyCurrentPlayerTurn();

    expect(notificationOccurred).toHaveBeenCalledOnce();
    expect(notificationOccurred).toHaveBeenCalledWith("success");
  });

  it("keeps working outside Telegram without haptic support", () => {
    expect(() => notifyCurrentPlayerTurn()).not.toThrow();
  });

  it("uses a warning haptic when the server skips an expired turn", () => {
    const notificationOccurred = vi.fn();
    window.Telegram = {
      WebApp: {
        HapticFeedback: {
          notificationOccurred
        },
        expand: vi.fn(),
        initData: "",
        ready: vi.fn()
      }
    };

    notifyTimerExpired();

    expect(notificationOccurred).toHaveBeenCalledWith("warning");
  });
});
