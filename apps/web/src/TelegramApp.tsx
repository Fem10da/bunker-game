import { useEffect, useState } from "react";

import type { TelegramUser } from "@bunker/contracts";

import { LobbyScreen } from "./LobbyScreen.js";
import {
  TelegramAuthError,
  authenticateTelegramUser,
  getTelegramStartParam
} from "./telegram-auth.js";

type AuthState =
  | { readonly status: "loading" }
  | { readonly code: TelegramAuthError["code"]; readonly status: "error" }
  | { readonly status: "ready"; readonly user: TelegramUser };

function AuthScreen({
  errorCode,
  onRetry
}: {
  readonly errorCode: TelegramAuthError["code"] | undefined;
  readonly onRetry: () => void;
}) {
  const telegramRequired = errorCode === "TELEGRAM_REQUIRED";

  return (
    <main className="app-shell auth-shell">
      <section className="panel auth-panel" aria-live="polite">
        <span className="topbar-brand">Бункер</span>
        {errorCode === undefined ? (
          <p>Підключаємо Telegram…</p>
        ) : (
          <>
            <h1>
              {telegramRequired
                ? "Відкрийте гру в Telegram"
                : "Не вдалося підключитися"}
            </h1>
            <p>
              {telegramRequired
                ? "Запустіть Mini App із профілю бота або кнопки меню."
                : "Перевірте з’єднання та повторіть спробу."}
            </p>
            {!telegramRequired && (
              <button
                className="primary-action auth-retry"
                onClick={onRetry}
                type="button"
              >
                Спробувати ще раз
              </button>
            )}
          </>
        )}
      </section>
    </main>
  );
}

export function TelegramApp() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    let active = true;

    setState({ status: "loading" });
    void authenticateTelegramUser()
      .then((user) => {
        if (active) {
          setState({ status: "ready", user });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            code:
              error instanceof TelegramAuthError
                ? error.code
                : "AUTH_FAILED",
            status: "error"
          });
        }
      });

    return () => {
      active = false;
    };
  }, [attempt]);

  if (state.status === "ready") {
    const initialJoinCode = getTelegramStartParam();
    return (
      <LobbyScreen
        {...(initialJoinCode === undefined ? {} : { initialJoinCode })}
        user={state.user}
      />
    );
  }

  return (
    <AuthScreen
      errorCode={state.status === "error" ? state.code : undefined}
      onRetry={() => setAttempt((current) => current + 1)}
    />
  );
}
