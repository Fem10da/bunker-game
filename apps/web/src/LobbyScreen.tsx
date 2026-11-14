import { useEffect, useMemo, useState } from "react";

import {
  MAX_GAME_PLAYERS,
  MIN_GAME_PLAYERS,
  type Lobby,
  type TelegramUser
} from "@bunker/contracts";

import { GameScreen } from "./GameScreen.js";
import {
  LobbyApiError,
  createLobby,
  getCurrentLobby,
  getLobby,
  joinLobby,
  leaveLobby,
  reorderLobby,
  setLobbyReady,
  setLobbySecretGoals,
  startLobby
} from "./lobby-api.js";
import { subscribeToLobbyUpdates } from "./realtime.js";

interface LobbyScreenProps {
  readonly initialJoinCode?: string;
  readonly previewLobby?: Lobby | null;
  readonly user: TelegramUser;
}

function displayName(user: TelegramUser) {
  return `${user.firstName} ${user.lastName ?? ""}`.trim();
}

export function LobbyScreen({
  initialJoinCode,
  previewLobby,
  user
}: LobbyScreenProps) {
  const previewMode = previewLobby !== undefined;
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(true);
  const [error, setError] = useState(false);
  const [joinCode, setJoinCode] = useState(initialJoinCode ?? "");
  const [lobby, setLobby] = useState<Lobby | null>(previewLobby ?? null);
  const [loading, setLoading] = useState(!previewMode);
  const currentPlayer = useMemo(
    () => lobby?.players.find((player) => player.id === user.id),
    [lobby, user.id]
  );

  useEffect(() => {
    if (previewMode) {
      return;
    }
    let active = true;

    void getCurrentLobby()
      .then(async (current) => {
        const restored =
          current ??
          (initialJoinCode === undefined
            ? null
            : await joinLobby(initialJoinCode));
        if (active) {
          setLobby(restored);
        }
      })
      .catch(() => {
        if (active) {
          setError(true);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [initialJoinCode, previewMode]);

  useEffect(() => {
    if (previewMode || lobby === null || lobby.status !== "waiting") {
      return;
    }

    let active = true;
    const code = lobby.code;
    const refresh = () => {
      void getLobby(code)
        .then((updated) => {
          if (!active) {
            return;
          }
          setConnected(true);
          setLobby(updated);
        })
        .catch((pollError: unknown) => {
          if (!active) {
            return;
          }
          if (
            pollError instanceof LobbyApiError &&
            (pollError.code === "LOBBY_NOT_FOUND" ||
              pollError.code === "NOT_A_LOBBY_MEMBER")
          ) {
            setLobby(null);
          } else {
            setConnected(false);
          }
        });
    };
    const subscription = subscribeToLobbyUpdates(code, {
      onConnectionChange: setConnected,
      onStateChange: refresh
    });
    const interval = window.setInterval(refresh, 5_000);

    return () => {
      active = false;
      subscription.close();
      window.clearInterval(interval);
    };
  }, [lobby?.code, lobby?.status, previewMode]);

  const run = async (action: () => Promise<Lobby>) => {
    if (previewMode) {
      return;
    }
    setBusy(true);
    setError(false);
    try {
      setLobby(await action());
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const leaveCurrentLobby = async () => {
    if (previewMode || lobby === null) {
      return;
    }

    const isHost = lobby.hostPlayerId === user.id;
    const confirmed = window.confirm(
      isHost
        ? "Скасувати лобі для всіх учасників?"
        : "Вийти з цього лобі?"
    );
    if (!confirmed) {
      return;
    }

    setBusy(true);
    setError(false);
    try {
      await leaveLobby(lobby.code);
      setLobby(null);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <main className="app-shell auth-shell">
        <section className="panel auth-panel" aria-live="polite">
          <p>Відновлюємо лобі…</p>
        </section>
      </main>
    );
  }

  if (lobby === null) {
    return (
      <main className="app-shell lobby-shell">
        <header className="topbar">
          <div className="topbar-left">
            <span className="topbar-brand">Бункер</span>
            <h1>Вітаємо, {user.firstName}</h1>
          </div>
        </header>

        <section className="panel lobby-entry">
          <span className="public-label">НОВА ПАРТІЯ</span>
          <h2>Операція крейда</h2>
          <p>
            Для створення лобі та запрошення гравців натисніть кнопку нижче.
          </p>
          <button
            className="primary-action"
            disabled={busy}
            onClick={() => void run(createLobby)}
            type="button"
          >
            Створити лобі
          </button>
        </section>

        <section className="panel lobby-entry">
          <span className="public-label">Є КОД ЗАПРОШЕННЯ?</span>
          <label htmlFor="lobby-code">Код лобі</label>
          <input
            autoComplete="off"
            id="lobby-code"
            inputMode="text"
            maxLength={6}
            onChange={(event) =>
              setJoinCode(
                event.currentTarget.value
                  .replace(/[^a-z\d]/giu, "")
                  .toUpperCase()
              )
            }
            value={joinCode}
          />
          <button
            className="secondary-action lobby-join"
            disabled={busy || joinCode.length !== 6}
            onClick={() => void run(() => joinLobby(joinCode))}
            type="button"
          >
            Приєднатися
          </button>
        </section>

        {error && (
          <p className="form-error" role="alert">
            Не вдалося виконати дію. Перевірте код і спробуйте ще раз.
          </p>
        )}
      </main>
    );
  }

  if (lobby.status === "started") {
    return (
      <GameScreen
        lobby={lobby}
        onEnded={() => setLobby(null)}
        user={user}
      />
    );
  }

  const joinMismatch =
    initialJoinCode !== undefined && initialJoinCode !== lobby.code;
  const inviteLink = `https://t.me/${
    import.meta.env.VITE_TELEGRAM_BOT_USERNAME ?? "Bunkerfemidainc_bot"
  }?startapp=join_${lobby.code}`;
  const publicScreenLink = `${window.location.origin}/screen/${lobby.code}`;
  const copyLink = (link: string) => {
    if (navigator.clipboard === undefined) {
      setError(true);
      return;
    }
    void navigator.clipboard.writeText(link).catch(() => setError(true));
  };
  const movePlayer = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= lobby.players.length) {
      return;
    }
    const playerIds = lobby.players.map((player) => player.id);
    const currentId = playerIds[index];
    const nextId = playerIds[nextIndex];
    if (currentId === undefined || nextId === undefined) {
      return;
    }
    playerIds[index] = nextId;
    playerIds[nextIndex] = currentId;
    void run(() => reorderLobby(lobby.code, playerIds));
  };

  return (
    <main className="app-shell lobby-shell">
      <header className="topbar">
        <div className="topbar-left">
          <span className="topbar-brand">Операція крейда</span>
          <h1>Лобі</h1>
        </div>
        <div className="topbar-right">
          <span className="round-label">КОД</span>
          <span className="lobby-code">{lobby.code}</span>
        </div>
      </header>

      {joinMismatch && (
        <p className="form-error" role="alert">
          Запрошення вело до лобі {initialJoinCode}, але ви вже в лобі{" "}
          {lobby.code}. Вийдіть із поточного лобі, щоб приєднатися до
          запрошеного.
        </p>
      )}

      <section className="panel lobby-panel">
        <div className="lobby-heading">
          <div>
            <span className="public-label">УЧАСНИКИ</span>
            <h2>
              {lobby.players.length} / {MAX_GAME_PLAYERS} гравців
            </h2>
          </div>
          <span className={`connection-pill${connected ? "" : " delayed"}`}>
            {connected ? "Оновлюється" : "Оновлення затримується"}
          </span>
        </div>

        <ol className="lobby-players">
          {lobby.players.map((player, index) => (
            <li key={player.id}>
              <span className="lobby-position">{player.position}</span>
              <span className="lobby-player-name">
                {displayName(player)}
                {player.isHost && <small>Ведучий</small>}
              </span>
              <span className={player.ready ? "ready" : "waiting"}>
                {player.ready ? "Готовий" : "Очікуємо"}
              </span>
              {lobby.hostPlayerId === user.id && (
                <span className="order-actions">
                  <button
                    aria-label={`Підняти ${displayName(player)}`}
                    disabled={busy || index === 0}
                    onClick={() => movePlayer(index, -1)}
                    type="button"
                  >
                    ↑
                  </button>
                  <button
                    aria-label={`Опустити ${displayName(player)}`}
                    disabled={busy || index === lobby.players.length - 1}
                    onClick={() => movePlayer(index, 1)}
                    type="button"
                  >
                    ↓
                  </button>
                </span>
              )}
            </li>
          ))}
        </ol>
        <p className="lobby-order-note">
          Гравець №1 починає кожен раунд; далі ходи йдуть за списком.
        </p>
      </section>

      <section className="panel invite-panel">
        <span className="public-label">ЗАПРОШЕННЯ</span>
        <p>Надішліть друзям код або посилання на Mini App.</p>
        <button
          className="secondary-action"
          onClick={() => copyLink(inviteLink)}
          type="button"
        >
          Копіювати посилання
        </button>
        {lobby.hostPlayerId === user.id && (
          <button
            className="secondary-action projector-link"
            onClick={() => copyLink(publicScreenLink)}
            type="button"
          >
            Копіювати екран для проєктора
          </button>
        )}
      </section>

      {lobby.hostPlayerId === user.id && (
        <label className="secret-goals-toggle">
          <input
            checked={lobby.secretGoalsEnabled}
            disabled={busy}
            onChange={(event) =>
              void run(() =>
                setLobbySecretGoals(lobby.code, event.target.checked)
              )
            }
            type="checkbox"
          />
          Секретні цілі
        </label>
      )}

      <a
        className="secondary-action lobby-rules-link"
        href="/rules"
        rel="noreferrer"
        target="_blank"
      >
        Правила цієї партії
      </a>

      <div className="lobby-action">
        <button
          className="primary-action"
          disabled={busy || currentPlayer === undefined}
          onClick={() =>
            void run(() =>
              setLobbyReady(lobby.code, !(currentPlayer?.ready ?? false))
            )
          }
          type="button"
        >
          {currentPlayer?.ready === true ? "Готово" : "Я готовий"}
        </button>
        {lobby.hostPlayerId === user.id && (
          <button
            className="secondary-action lobby-start"
            disabled={
              busy ||
              lobby.players.length < MIN_GAME_PLAYERS ||
              lobby.players.length > MAX_GAME_PLAYERS ||
              lobby.players.some((player) => !player.ready)
            }
            onClick={() => void run(() => startLobby(lobby.code))}
            type="button"
          >
            Запустити лобі
          </button>
        )}
        <button
          className="secondary-action danger-action"
          disabled={busy}
          onClick={() => void leaveCurrentLobby()}
          type="button"
        >
          {lobby.hostPlayerId === user.id
            ? "Скасувати лобі"
            : "Вийти з лобі"}
        </button>
        {error && (
          <p className="form-error" role="alert">
            Не вдалося оновити лобі. Спробуйте ще раз.
          </p>
        )}
      </div>
    </main>
  );
}
