export interface PlaytestCardState {
  readonly bonusVotes: readonly {
    readonly targetPlayerId: string;
    readonly votes: number;
  }[];
  readonly doubleVotePlayerIds: readonly string[];
  readonly protectedVotePlayerIds: readonly string[];
  readonly reducedVotePlayerIds: readonly string[];
  readonly revealVoteTotals: boolean;
  readonly silencedVoterPlayerIds: readonly string[];
  readonly turnAdjustments: readonly {
    readonly playerId: string;
    readonly seconds: number;
  }[];
}

type PlayerFlag =
  | "doubleVotePlayerIds"
  | "protectedVotePlayerIds"
  | "reducedVotePlayerIds"
  | "silencedVoterPlayerIds";

export function emptyPlaytestCardState(): PlaytestCardState {
  return {
    bonusVotes: [],
    doubleVotePlayerIds: [],
    protectedVotePlayerIds: [],
    reducedVotePlayerIds: [],
    revealVoteTotals: false,
    silencedVoterPlayerIds: [],
    turnAdjustments: []
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePlaytestCardState(value: unknown): PlaytestCardState {
  if (!isRecord(value)) {
    return emptyPlaytestCardState();
  }
  const fallback = emptyPlaytestCardState();
  const playerIds = (key: PlayerFlag) =>
    Array.isArray(value[key]) &&
    value[key].every((playerId) => typeof playerId === "string")
      ? (value[key] as readonly string[])
      : fallback[key];
  const bonusVotes = Array.isArray(value.bonusVotes)
    ? value.bonusVotes.filter(
        (entry): entry is { readonly targetPlayerId: string; readonly votes: number } =>
          isRecord(entry) &&
          typeof entry.targetPlayerId === "string" &&
          Number.isInteger(entry.votes) &&
          (entry.votes as number) > 0
      )
    : [];
  const turnAdjustments = Array.isArray(value.turnAdjustments)
    ? value.turnAdjustments.filter(
        (entry): entry is { readonly playerId: string; readonly seconds: number } =>
          isRecord(entry) &&
          typeof entry.playerId === "string" &&
          Number.isInteger(entry.seconds)
      )
    : [];
  return {
    bonusVotes,
    doubleVotePlayerIds: playerIds("doubleVotePlayerIds"),
    protectedVotePlayerIds: playerIds("protectedVotePlayerIds"),
    reducedVotePlayerIds: playerIds("reducedVotePlayerIds"),
    revealVoteTotals: value.revealVoteTotals === true,
    silencedVoterPlayerIds: playerIds("silencedVoterPlayerIds"),
    turnAdjustments
  };
}

export function addPlayerFlag(
  state: PlaytestCardState,
  key: PlayerFlag,
  playerId: string
): PlaytestCardState {
  return state[key].includes(playerId)
    ? state
    : { ...state, [key]: [...state[key], playerId] };
}

export function addBonusVote(
  state: PlaytestCardState,
  targetPlayerId: string
): PlaytestCardState {
  const current = state.bonusVotes.find(
    (entry) => entry.targetPlayerId === targetPlayerId
  );
  return {
    ...state,
    bonusVotes: current === undefined
      ? [...state.bonusVotes, { targetPlayerId, votes: 1 }]
      : state.bonusVotes.map((entry) =>
          entry.targetPlayerId === targetPlayerId
            ? { ...entry, votes: entry.votes + 1 }
            : entry
        )
  };
}

export function setTurnAdjustment(
  state: PlaytestCardState,
  playerId: string,
  seconds: number
): PlaytestCardState {
  const current = state.turnAdjustments.find(
    (entry) => entry.playerId === playerId
  );
  return {
    ...state,
    turnAdjustments: current === undefined
      ? [...state.turnAdjustments, { playerId, seconds }]
      : state.turnAdjustments.map((entry) =>
          entry.playerId === playerId
            ? { ...entry, seconds: entry.seconds + seconds }
            : entry
        )
  };
}

export function consumeTurnAdjustment(
  state: PlaytestCardState,
  playerId: string
): { readonly seconds: number; readonly state: PlaytestCardState } {
  const seconds = state.turnAdjustments.find(
    (entry) => entry.playerId === playerId
  )?.seconds ?? 0;
  return {
    seconds,
    state: {
      ...state,
      turnAdjustments: state.turnAdjustments.filter(
        (entry) => entry.playerId !== playerId
      )
    }
  };
}

export function clearVoteEffects(
  state: PlaytestCardState
): PlaytestCardState {
  return {
    ...emptyPlaytestCardState(),
    turnAdjustments: state.turnAdjustments
  };
}

export function tallyPlaytestVotes(
  votes: readonly {
    readonly targetPlayerId: string;
    readonly voterPlayerId: string;
  }[],
  state: PlaytestCardState,
  candidatePlayerIds: readonly string[] = []
): readonly { readonly targetPlayerId: string; readonly votes: number }[] {
  const isEligibleCandidate = (targetPlayerId: string) =>
    candidatePlayerIds.length === 0 ||
    candidatePlayerIds.includes(targetPlayerId);
  const tallies = new Map<string, number>();
  for (const vote of votes) {
    if (
      !isEligibleCandidate(vote.targetPlayerId) ||
      state.protectedVotePlayerIds.includes(vote.targetPlayerId) ||
      state.silencedVoterPlayerIds.includes(vote.voterPlayerId)
    ) {
      continue;
    }
    const weight = state.doubleVotePlayerIds.includes(vote.voterPlayerId)
      ? 2
      : 1;
    tallies.set(vote.targetPlayerId, (tallies.get(vote.targetPlayerId) ?? 0) + weight);
  }
  for (const bonus of state.bonusVotes) {
    if (
      isEligibleCandidate(bonus.targetPlayerId) &&
      !state.protectedVotePlayerIds.includes(bonus.targetPlayerId)
    ) {
      tallies.set(
        bonus.targetPlayerId,
        (tallies.get(bonus.targetPlayerId) ?? 0) + bonus.votes
      );
    }
  }
  for (const playerId of state.reducedVotePlayerIds) {
    const votesAgainst = tallies.get(playerId) ?? 0;
    if (votesAgainst <= 1) {
      tallies.delete(playerId);
    } else {
      tallies.set(playerId, votesAgainst - 1);
    }
  }
  return [...tallies.entries()]
    .map(([targetPlayerId, votes]) => ({ targetPlayerId, votes }))
    .sort((left, right) => right.votes - left.votes || left.targetPlayerId.localeCompare(right.targetPlayerId));
}
