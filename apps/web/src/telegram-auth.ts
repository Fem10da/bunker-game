import type { TelegramUser } from "@bunker/contracts";

type Request = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

interface TelegramWebApp {
  readonly HapticFeedback?: {
    readonly notificationOccurred: (
      type: "error" | "success" | "warning"
    ) => void;
  };
  readonly initData: string;
  readonly expand: () => void;
  readonly offEvent?: (eventType: string, handler: () => void) => void;
  readonly onEvent?: (eventType: string, handler: () => void) => void;
  readonly ready: () => void;
}

declare global {
  interface Window {
    Telegram?: {
      readonly WebApp: TelegramWebApp;
    };
  }
}

export type TelegramAuthErrorCode = "AUTH_FAILED" | "TELEGRAM_REQUIRED";

export class TelegramAuthError extends Error {
  readonly code: TelegramAuthErrorCode;

  constructor(code: TelegramAuthErrorCode) {
    super(code);
    this.name = "TelegramAuthError";
    this.code = code;
  }
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function readUser(response: Response): Promise<TelegramUser> {
  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw new TelegramAuthError("AUTH_FAILED");
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("data" in payload) ||
    typeof payload.data !== "object" ||
    payload.data === null ||
    !("user" in payload.data) ||
    typeof payload.data.user !== "object" ||
    payload.data.user === null
  ) {
    throw new TelegramAuthError("AUTH_FAILED");
  }

  const user = payload.data.user as Record<string, unknown>;
  if (
    typeof user.id !== "string" ||
    !/^\d{1,20}$/u.test(user.id) ||
    typeof user.firstName !== "string" ||
    user.firstName.length === 0
  ) {
    throw new TelegramAuthError("AUTH_FAILED");
  }

  const languageCode = optionalString(user.languageCode);
  const lastName = optionalString(user.lastName);
  const username = optionalString(user.username);

  return {
    firstName: user.firstName,
    id: user.id,
    ...(languageCode === undefined ? {} : { languageCode }),
    ...(lastName === undefined ? {} : { lastName }),
    ...(username === undefined ? {} : { username })
  };
}

export async function authenticateTelegramUser(
  request: Request = fetch
): Promise<TelegramUser> {
  const webApp = window.Telegram?.WebApp;

  webApp?.ready();
  webApp?.expand();

  const sessionResponse = await request("/api/auth/session", {
    credentials: "include"
  });
  if (sessionResponse.ok) {
    return readUser(sessionResponse);
  }
  if (sessionResponse.status !== 401) {
    throw new TelegramAuthError("AUTH_FAILED");
  }

  const initData = webApp?.initData.trim() ?? "";
  if (initData.length === 0) {
    throw new TelegramAuthError("TELEGRAM_REQUIRED");
  }

  const authResponse = await request("/api/auth/telegram", {
    body: JSON.stringify({ initData }),
    credentials: "include",
    headers: {
      "content-type": "application/json"
    },
    method: "POST"
  });
  if (!authResponse.ok) {
    throw new TelegramAuthError("AUTH_FAILED");
  }

  return readUser(authResponse);
}

export function getTelegramStartParam() {
  const initData = window.Telegram?.WebApp.initData;
  const startParam =
    initData === undefined
      ? undefined
      : new URLSearchParams(initData).get("start_param") ?? undefined;

  return startParam?.startsWith("join_")
    ? startParam.slice("join_".length).toUpperCase()
    : undefined;
}

export function notifyCurrentPlayerTurn() {
  window.Telegram?.WebApp.HapticFeedback?.notificationOccurred(
    "success"
  );
}

export function notifyTimerExpired() {
  window.Telegram?.WebApp.HapticFeedback?.notificationOccurred(
    "warning"
  );
}

export function onAppForeground(callback: () => void): () => void {
  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      callback();
    }
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);
  const webApp = window.Telegram?.WebApp;
  webApp?.onEvent?.("activated", callback);

  return () => {
    document.removeEventListener(
      "visibilitychange",
      handleVisibilityChange
    );
    webApp?.offEvent?.("activated", callback);
  };
}
