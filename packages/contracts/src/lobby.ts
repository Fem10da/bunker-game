export const MIN_GAME_PLAYERS = 4;
export const MAX_GAME_PLAYERS = 16;

export interface LobbyPlayer {
  readonly firstName: string;
  readonly id: string;
  readonly isHost: boolean;
  readonly lastName?: string;
  readonly position: number;
  readonly ready: boolean;
  readonly username?: string;
}

export interface Lobby {
  readonly code: string;
  readonly hostPlayerId: string;
  readonly players: readonly LobbyPlayer[];
  readonly scenarioId: string;
  readonly secretGoalsEnabled: boolean;
  readonly status: "started" | "waiting";
}
