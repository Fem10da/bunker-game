export interface LobbyRealtimeEvent {
  readonly code: string;
  readonly revision: number;
  readonly type: "state_changed";
}

type RealtimeListener = (event: LobbyRealtimeEvent) => void;

export interface RealtimeHub {
  readonly publish: (code: string) => LobbyRealtimeEvent;
  readonly subscribe: (
    code: string,
    listener: RealtimeListener
  ) => () => void;
}

const lobbyCodePattern = /^[A-Z0-9]{6}$/u;

function requireLobbyCode(code: string) {
  if (!lobbyCodePattern.test(code)) {
    throw new Error("Realtime requires a valid lobby code");
  }
}

export function createRealtimeHub(): RealtimeHub {
  const listeners = new Map<string, Set<RealtimeListener>>();
  const revisions = new Map<string, number>();

  return {
    publish: (code) => {
      requireLobbyCode(code);
      const event: LobbyRealtimeEvent = {
        code,
        revision: (revisions.get(code) ?? 0) + 1,
        type: "state_changed"
      };
      revisions.set(code, event.revision);

      for (const listener of [...(listeners.get(code) ?? [])]) {
        try {
          listener(event);
        } catch {
          continue;
        }
      }
      return event;
    },
    subscribe: (code, listener) => {
      requireLobbyCode(code);
      const lobbyListeners = listeners.get(code) ?? new Set();
      lobbyListeners.add(listener);
      listeners.set(code, lobbyListeners);

      return () => {
        lobbyListeners.delete(listener);
        if (lobbyListeners.size === 0) {
          listeners.delete(code);
        }
      };
    }
  };
}

export function formatRealtimeEvent(event: LobbyRealtimeEvent): string {
  return (
    `id: ${event.revision}\n` +
    `event: ${event.type}\n` +
    `data: ${JSON.stringify(event)}\n\n`
  );
}
