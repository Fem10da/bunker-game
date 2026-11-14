import type { PlayerStatus } from "@bunker/contracts";

import { deterministicIndex } from "./random.js";

interface VotingPlayer {
  readonly id: string;
  readonly status: PlayerStatus;
}

interface ResolveVotesInput {
  readonly decisionPointId: string;
  readonly players: readonly VotingPlayer[];
  readonly seed: string;
  readonly submittedVotes: Readonly<Record<string, string>>;
}

export interface ResolvedVote {
  readonly automatic: boolean;
  readonly targetId: string;
  readonly voterId: string;
}

export interface VotingResult {
  readonly counts: Readonly<Record<string, number>>;
  readonly leaderIds: readonly string[];
  readonly votes: readonly ResolvedVote[];
}

function assertSubmittedVote(
  voterId: string,
  targetId: string,
  players: readonly VotingPlayer[]
): void {
  if (voterId === targetId) {
    throw new Error("A player cannot vote for themselves");
  }

  const target = players.find((player) => player.id === targetId);
  if (target === undefined || target.status !== "active") {
    throw new Error(`Player "${targetId}" is not an eligible vote target`);
  }
}

function createAutomaticVote(
  input: ResolveVotesInput,
  voterId: string
): ResolvedVote {
  const candidates = input.players.filter(
    (player) => player.status === "active" && player.id !== voterId
  );
  const target =
    candidates[
      deterministicIndex(
        input.seed,
        `${input.decisionPointId}:${voterId}:automatic-vote`,
        candidates.length
      )
    ];

  if (target === undefined) {
    throw new Error("An automatic vote has no eligible target");
  }

  return {
    automatic: true,
    targetId: target.id,
    voterId
  };
}

function countVotes(
  votes: readonly ResolvedVote[]
): Readonly<Record<string, number>> {
  return votes.reduce<Record<string, number>>((counts, vote) => {
    return {
      ...counts,
      [vote.targetId]: (counts[vote.targetId] ?? 0) + 1
    };
  }, {});
}

export function resolveVotes(input: ResolveVotesInput): VotingResult {
  const voters = input.players.filter((player) => player.status === "active");
  const votes = voters.map<ResolvedVote>((voter) => {
    const submittedTarget = input.submittedVotes[voter.id];

    if (submittedTarget === undefined) {
      return createAutomaticVote(input, voter.id);
    }

    assertSubmittedVote(voter.id, submittedTarget, input.players);
    return {
      automatic: false,
      targetId: submittedTarget,
      voterId: voter.id
    };
  });
  const counts = countVotes(votes);
  const maximum = Math.max(...Object.values(counts));
  const leaderIds = Object.entries(counts)
    .filter(([, count]) => count === maximum)
    .map(([playerId]) => playerId)
    .sort();

  return {
    counts,
    leaderIds,
    votes
  };
}
