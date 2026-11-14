import { useCallback, useEffect, useRef, useState } from "react";

import type {
  CharacteristicId,
  Lobby,
  MockGameView,
  PlaytestCardSelection,
  TelegramUser
} from "@bunker/contracts";

import { App } from "./App.js";
import {
  beginMockGame,
  cancelRollback,
  finishMockDiscussion,
  finishMockTurn,
  finishMockVoting,
  LobbyApiError,
  getMockGame,
  leaveLobby,
  proposeRollback,
  reactWithPlaytestCard,
  revealMockCharacteristic,
  resumeRollback,
  serverNow,
  submitFinalOutcome,
  submitVote,
  voteRollback,
  usePlaytestCard
} from "./lobby-api.js";
import { subscribeToLobbyUpdates } from "./realtime.js";
import {
  notifyCurrentPlayerTurn,
  notifyTimerExpired,
  onAppForeground
} from "./telegram-auth.js";

interface GameScreenProps {
  readonly lobby: Lobby;
  readonly onEnded: () => void;
  readonly user: TelegramUser;
}

const COMMAND_TIMEOUT_MS = 15_000;

export function GameScreen({
  lobby,
  onEnded,
  user
}: GameScreenProps) {
  const [error, setError] = useState(false);
  const [connected, setConnected] = useState(true);
  const [game, setGame] = useState<MockGameView | null>(null);
  const active = useRef(true);
  const commandInFlight = useRef(false);
  const commandRevision = useRef(0);
  const refreshInFlight = useRef(false);
  const refreshSequence = useRef(0);
  const notifiedTurnKey = useRef<string | null>(null);
  const notifiedTimeoutEvent = useRef<string | null>(null);
  const ownTurnKey =
    game?.phase === "revealing" &&
    game.currentTurnPlayerId === user.id &&
    game.players.find((player) => player.id === user.id)?.status ===
      "active"
      ? `${game.round}:${user.id}`
      : null;

  useEffect(() => {
    if (
      ownTurnKey !== null &&
      ownTurnKey !== notifiedTurnKey.current
    ) {
      notifyCurrentPlayerTurn();
    }
    notifiedTurnKey.current = ownTurnKey;
  }, [ownTurnKey]);

  useEffect(() => {
    const timeoutEvent =
      game?.lastEvent?.includes("виступ пропущено") === true
        ? game.lastEvent
        : null;
    if (
      timeoutEvent !== null &&
      timeoutEvent !== notifiedTimeoutEvent.current
    ) {
      notifyTimerExpired();
    }
    notifiedTimeoutEvent.current = timeoutEvent;
  }, [game?.lastEvent]);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (commandInFlight.current) {
      return;
    }
    refreshInFlight.current = true;
    const revision = commandRevision.current;
    const sequence = (refreshSequence.current += 1);
    try {
      const updated = await getMockGame(lobby.code);
      if (
        active.current &&
        !commandInFlight.current &&
        revision === commandRevision.current &&
        sequence === refreshSequence.current
      ) {
        setConnected(true);
        setError(false);
        setGame(updated);
      }
    } catch (refreshError: unknown) {
      if (
        !active.current ||
        commandInFlight.current ||
        revision !== commandRevision.current ||
        sequence !== refreshSequence.current
      ) {
        return;
      }
      if (
        refreshError instanceof LobbyApiError &&
        (refreshError.code === "LOBBY_NOT_FOUND" ||
          refreshError.code === "NOT_A_LOBBY_MEMBER")
      ) {
        onEnded();
      } else {
        setConnected(false);
        setError(true);
      }
    } finally {
      refreshInFlight.current = false;
    }
  }, [lobby.code, onEnded]);

  useEffect(() => {
    void refresh();
    const subscription = subscribeToLobbyUpdates(lobby.code, {
      onConnectionChange: setConnected,
      onStateChange: () => void refresh()
    });
    const interval = window.setInterval(() => {
      if (!refreshInFlight.current) {
        void refresh();
      }
    }, 5_000);
    const stopForegroundSync = onAppForeground(() => void refresh());
    return () => {
      subscription.close();
      window.clearInterval(interval);
      stopForegroundSync();
    };
  }, [lobby.code, refresh]);

  const activeDeadline =
    game?.rollback.paused === true
      ? null
      : game?.phase === "reaction"
        ? (game.cardChain?.deadline ?? null)
        : (game?.turnDeadline ?? null);
  useEffect(() => {
    if (activeDeadline === null) {
      return;
    }
    const deadline = Date.parse(activeDeadline);
    if (!Number.isFinite(deadline)) {
      return;
    }
    const timer = window.setTimeout(
      () => void refresh(),
      Math.max(0, deadline - serverNow()) + 150
    );
    return () => window.clearTimeout(timer);
  }, [activeDeadline, refresh]);

  if (game === null) {
    return (
      <main className="app-shell auth-shell">
        <section className="panel auth-panel" aria-live="polite">
          <p>
            {error
              ? "Не вдалося завантажити гру. Повторюємо…"
              : "Завантажуємо гру…"}
          </p>
        </section>
      </main>
    );
  }

  const runGameCommand = async (
    command: () => Promise<MockGameView>
  ) => {
    commandInFlight.current = true;
    commandRevision.current += 1;
    let timedOut = false;
    let timeoutId: number | undefined;
    try {
      const commandPromise = command();
      commandPromise.catch(() => {});
      const result = await Promise.race([
        commandPromise,
        new Promise<never>((_resolve, reject) => {
          timeoutId = window.setTimeout(() => {
            timedOut = true;
            reject(new Error("Сервер довго не відповідає."));
          }, COMMAND_TIMEOUT_MS);
        })
      ]);
      setGame(result);
      setConnected(true);
    } finally {
      window.clearTimeout(timeoutId);
      commandInFlight.current = false;
      if (timedOut) {
        void refresh();
      }
    }
  };

  const reveal = async (characteristicId: CharacteristicId) => {
    await runGameCommand(() =>
      revealMockCharacteristic(lobby.code, characteristicId)
    );
  };
  const begin = async () => {
    await runGameCommand(() => beginMockGame(lobby.code));
  };
  const useCard = async (selection: PlaytestCardSelection) => {
    await runGameCommand(() => usePlaytestCard(lobby.code, selection));
  };
  const reactCard = async (selection: PlaytestCardSelection) => {
    const expectedReactionCount = game?.cardChain?.reactions.length ?? 0;
    await runGameCommand(() =>
      reactWithPlaytestCard(lobby.code, selection, expectedReactionCount)
    );
  };
  const finishTurn = async () => {
    await runGameCommand(() => finishMockTurn(lobby.code));
  };
  const finishDiscussion = async () => {
    await runGameCommand(() => finishMockDiscussion(lobby.code));
  };
  const finishVoting = async () => {
    if (
      !window.confirm(
        "Завершити голосування без гравців, які ще не проголосували?"
      )
    ) {
      return;
    }
    await runGameCommand(() =>
      finishMockVoting(lobby.code, game.voting?.attempt ?? 1)
    );
  };
  const vote = async (targetPlayerId: string) => {
    await runGameCommand(() =>
      submitVote(lobby.code, targetPlayerId, game.voting?.attempt ?? 1)
    );
  };
  const finalize = async (
    outcome: "all_survive" | "team_loss"
  ) => {
    await runGameCommand(() => submitFinalOutcome(lobby.code, outcome));
  };
  const proposeGameRollback = async (
    checkpointId: string,
    reason: string
  ) => {
    await runGameCommand(() =>
      proposeRollback(lobby.code, checkpointId, reason)
    );
  };
  const voteForRollback = async (approve: boolean) => {
    const proposalId = game.rollback.proposal?.id ?? "";
    await runGameCommand(() =>
      voteRollback(lobby.code, approve, proposalId)
    );
  };
  const cancelGameRollback = async () => {
    const proposalId = game.rollback.proposal?.id ?? "";
    await runGameCommand(() => cancelRollback(lobby.code, proposalId));
  };
  const resumeGameRollback = async () => {
    await runGameCommand(() => resumeRollback(lobby.code));
  };
  const finish =
    game.hostPlayerId === user.id
      ? async () => {
          if (!window.confirm("Завершити гру для всіх?")) {
            return;
          }
          await leaveLobby(lobby.code);
          onEnded();
        }
      : game.phase === "completed"
        ? async () => {
            await leaveLobby(lobby.code);
            onEnded();
          }
        : undefined;

  return (
    <App
      connected={connected}
      currentUser={user}
      game={game}
      onBegin={begin}
      onCardReact={reactCard}
      onCardUse={useCard}
      onFinishDiscussion={finishDiscussion}
      onFinishTurn={finishTurn}
      onFinishVoting={finishVoting}
      {...(finish === undefined ? {} : { onFinish: finish })}
      onFinalize={finalize}
      onReveal={reveal}
      onRollbackCancel={cancelGameRollback}
      onRollbackPropose={proposeGameRollback}
      onRollbackResume={resumeGameRollback}
      onRollbackVote={voteForRollback}
      onVote={vote}
    />
  );
}
