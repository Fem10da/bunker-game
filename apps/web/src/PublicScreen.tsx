import { useCallback, useEffect, useRef, useState } from "react";

import {
  CHARACTERISTIC_CATEGORIES,
  type PublicGameView
} from "@bunker/contracts";

import {
  getPublicGame,
  LobbyApiError,
  serverNow
} from "./lobby-api.js";
import { subscribeToPublicScreenUpdates } from "./realtime.js";

interface PublicScreenProps {
  readonly code: string;
  readonly previewGame?: PublicGameView;
}

function playerName(
  player: PublicGameView["players"][number]
) {
  return `${player.firstName} ${player.lastName ?? ""}`.trim();
}

function secondsUntil(deadline: string | null) {
  return deadline === null
    ? null
    : Math.max(0, Math.ceil((Date.parse(deadline) - serverNow()) / 1_000));
}

function formatCountdown(seconds: number | null) {
  if (seconds === null) {
    return "—:——";
  }
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(
    seconds % 60
  ).padStart(2, "0")}`;
}

function phaseTitle(game: PublicGameView) {
  if (game.rollbackPaused) {
    return "Гру призупинено";
  }
  switch (game.phase) {
    case "scenario_intro":
      return "Оголошення катастрофи";
    case "revealing":
      return game.turnStage === "speaking" ? "Виступ гравця" : "Вибір характеристики";
    case "reaction":
      return "Вікно реакції";
    case "discussion":
      return "Загальне обговорення";
    case "voting":
      return "Голосування";
    case "final_check":
      return "Фінальна перевірка";
    case "completed":
      return game.finalOutcome === "all_survive" ? "Група вижила" : "Партію завершено";
  }
}

function phaseDescription(game: PublicGameView) {
  const current = game.players.find(
    (player) => player.id === game.currentTurnPlayerId
  );
  if (game.rollbackPaused) {
    return "Ведучий та гравці розглядають відкат до попереднього стану.";
  }
  if (game.phase === "scenario_intro") {
    return "Ведучий знайомить групу з катастрофою та умовами бункера.";
  }
  if (game.phase === "revealing") {
    const name = current === undefined ? "Гравець" : playerName(current);
    return game.turnStage === "speaking"
      ? `${name} захищає свою цінність для групи.`
      : `${name} обирає характеристику для публічного відкриття.`;
  }
  if (game.phase === "reaction") {
    return "Гравці можуть втрутитися картками реакцій.";
  }
  if (game.phase === "discussion") {
    return "Група обговорює, хто найбільш потрібен бункеру.";
  }
  if (game.phase === "voting") {
    return "Активні гравці обирають, хто залишить групу.";
  }
  if (game.phase === "final_check") {
    return "Фінальна група перевіряє демографію та таємні цілі.";
  }
  return game.finalOutcome === "all_survive"
    ? "Бункер прийняв фінальну групу."
    : "Остаточне рішення зафіксовано.";
}

function PublicGameTable({ game }: { readonly game: PublicGameView }) {
  return (
    <div className="public-game-table-wrap" tabIndex={0}>
      <table className="public-game-table" aria-label="Публічний стіл гри">
        <thead>
          <tr>
            <th>#</th>
            <th>Гравець</th>
            {CHARACTERISTIC_CATEGORIES.map((category) => (
              <th key={category.id}>{category.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {game.players.map((player) => {
            const speaking = player.id === game.currentTurnPlayerId;
            const eliminated = player.status === "eliminated";
            return (
              <tr
                className={`${speaking ? "speaking" : ""}${
                  eliminated ? " eliminated" : ""
                }`}
                key={player.id}
              >
                <td>{player.position}</td>
                <td>
                  <strong>{playerName(player)}</strong>
                  {speaking && <small> говорить</small>}
                  {eliminated && <small> вибув</small>}
                </td>
                {CHARACTERISTIC_CATEGORIES.map((category) => (
                  <td key={category.id}>
                    {player.characteristics[category.id] ?? "—"}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ScenarioBriefing({ game }: { readonly game: PublicGameView }) {
  return (
    <section className="public-screen-briefing">
      <div>
        <span className="public-label">КАТАСТРОФА</span>
        <h2>{game.scenario.catastrophe.title}</h2>
        <p>{game.scenario.catastrophe.description}</p>
      </div>
      <div>
        <span className="public-label">БУНКЕР</span>
        <h2>{game.scenario.title}</h2>
        <p>{game.scenario.bunker.condition}</p>
      </div>
    </section>
  );
}

export function PublicScreen({ code, previewGame }: PublicScreenProps) {
  const [connected, setConnected] = useState(true);
  const [game, setGame] = useState<PublicGameView | null>(
    previewGame ?? null
  );
  const [notFound, setNotFound] = useState(false);
  const [seconds, setSeconds] = useState<number | null>(null);
  const active = useRef(true);
  const refreshInFlight = useRef(false);
  const refreshSequence = useRef(0);
  const wasLoaded = useRef(false);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (previewGame !== undefined) {
      setGame(previewGame);
      setConnected(true);
      setNotFound(false);
      return;
    }
    refreshInFlight.current = true;
    const sequence = (refreshSequence.current += 1);
    try {
      const updated = await getPublicGame(code);
      if (!active.current || sequence !== refreshSequence.current) {
        return;
      }
      wasLoaded.current = true;
      setGame(updated);
      setConnected(true);
      setNotFound(false);
    } catch (error) {
      if (!active.current || sequence !== refreshSequence.current) {
        return;
      }
      setConnected(false);
      const lobbyGone =
        error instanceof LobbyApiError && error.code === "LOBBY_NOT_FOUND";
      setNotFound(lobbyGone);
      if (lobbyGone) {
        setGame(null);
      }
    } finally {
      refreshInFlight.current = false;
    }
  }, [code, previewGame]);

  useEffect(() => {
    if (previewGame !== undefined) {
      return;
    }
    void refresh();
    const subscription = subscribeToPublicScreenUpdates(code, {
      onConnectionChange: setConnected,
      onStateChange: () => void refresh()
    });
    const interval = window.setInterval(() => {
      if (!refreshInFlight.current) {
        void refresh();
      }
    }, 5_000);
    return () => {
      subscription.close();
      window.clearInterval(interval);
    };
  }, [code, previewGame, refresh]);

  useEffect(() => {
    setSeconds(secondsUntil(game?.activeDeadline ?? null));
    if (game?.activeDeadline === null || game?.activeDeadline === undefined) {
      return;
    }
    const interval = window.setInterval(
      () => setSeconds(secondsUntil(game.activeDeadline)),
      250
    );
    return () => window.clearInterval(interval);
  }, [game?.activeDeadline]);

  useEffect(() => {
    if (game?.activeDeadline === null || game?.activeDeadline === undefined) {
      return;
    }
    const delay = Math.max(0, Date.parse(game.activeDeadline) - serverNow());
    const timeout = window.setTimeout(() => void refresh(), delay + 150);
    return () => window.clearTimeout(timeout);
  }, [game?.activeDeadline, refresh]);

  if (game === null) {
    return (
      <main className="public-screen-loading">
        <section className="panel auth-panel" aria-live="polite">
          <span className="topbar-brand">Бункер · публічний екран</span>
          <h1>
            {notFound
              ? wasLoaded.current
                ? "Партію завершено"
                : "Екран ще недоступний"
              : "Підключаємо проєкцію…"}
          </h1>
          <p>
            {notFound
              ? wasLoaded.current
                ? "Лобі видалено або завершено ведучим."
                : "Перевірте код або дочекайтеся запуску лобі ведучим."
              : "Поновлюємо стан партії."}
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="public-screen-shell">
      <header className="public-screen-header">
        <div>
          <span className="topbar-brand">{game.scenario.title}</span>
          <h1>Бункер</h1>
        </div>
        <div className="public-screen-status">
          <span className={connected ? "live-badge" : "live-badge delayed"}>
            {connected ? "НАЖИВО" : "З'ЄДНАННЯ ПЕРЕВІРЯЄТЬСЯ"}
          </span>
          <span>КОД {game.code}</span>
        </div>
      </header>

      <section className="public-screen-turn" aria-live="polite">
        <div>
          <span className="public-label">РАУНД {String(game.round).padStart(2, "0")}</span>
          <h2>{phaseTitle(game)}</h2>
          <p>{phaseDescription(game)}</p>
        </div>
        <strong aria-live="off">{formatCountdown(seconds)}</strong>
      </section>

      {game.lastEvent !== null && (
        <p className="public-screen-event">{game.lastEvent}</p>
      )}

      {game.phase === "scenario_intro" && <ScenarioBriefing game={game} />}

      <section className="public-screen-resources" aria-label="Ресурси бази">
        {game.scenario.resources.map((resource) => (
          <div key={resource.id}>
            <span>{resource.label}</span>
            <strong>
              {resource.value}/{resource.max}
            </strong>
            <i>
              <b
                style={{
                  width: `${Math.round((resource.value / resource.max) * 100)}%`
                }}
              />
            </i>
          </div>
        ))}
      </section>

      <PublicGameTable game={game} />

      <footer className="public-screen-footer">
        <span>МІСЦЬ У БУНКЕРІ</span>
        <strong>
          {game.bunkerCapacity} / {game.players.length}
        </strong>
      </footer>
    </main>
  );
}
