import { describe, expect, it } from "vitest";

import {
  addBonusVote,
  addPlayerFlag,
  clearVoteEffects,
  consumeTurnAdjustment,
  emptyPlaytestCardState,
  parsePlaytestCardState,
  setTurnAdjustment,
  tallyPlaytestVotes
} from "./playtest-card-state.js";

describe("playtest card state", () => {
  it("applies bonus, double, protection, and reduction to a vote", () => {
    const state = addPlayerFlag(
      addPlayerFlag(
        addPlayerFlag(
          addBonusVote(emptyPlaytestCardState(), "target-a"),
          "doubleVotePlayerIds",
          "voter-a"
        ),
        "reducedVotePlayerIds",
        "target-a"
      ),
      "protectedVotePlayerIds",
      "target-b"
    );

    expect(
      tallyPlaytestVotes(
        [
          { targetPlayerId: "target-a", voterPlayerId: "voter-a" },
          { targetPlayerId: "target-b", voterPlayerId: "voter-b" }
        ],
        state
      )
    ).toEqual([{ targetPlayerId: "target-a", votes: 2 }]);
  });

  it("excludes a stale bonus vote for a candidate outside the current revote", () => {
    // Attempt 1 tied A and B; a card had also added a bonus vote for C
    // earlier in the game. The revote narrows candidates to [A, B], so
    // C's stale bonus must not bring C back into contention.
    const state = addBonusVote(emptyPlaytestCardState(), "target-c");

    expect(
      tallyPlaytestVotes(
        [
          { targetPlayerId: "target-a", voterPlayerId: "voter-a" },
          { targetPlayerId: "target-b", voterPlayerId: "voter-b" }
        ],
        state,
        ["target-a", "target-b"]
      )
    ).toEqual([
      { targetPlayerId: "target-a", votes: 1 },
      { targetPlayerId: "target-b", votes: 1 }
    ]);
  });

  it("ignores a ballot cast by a silenced voter", () => {
    const state = addPlayerFlag(
      emptyPlaytestCardState(),
      "silencedVoterPlayerIds",
      "voter-a"
    );

    expect(
      tallyPlaytestVotes(
        [
          { targetPlayerId: "target-a", voterPlayerId: "voter-a" },
          { targetPlayerId: "target-a", voterPlayerId: "voter-b" }
        ],
        state
      )
    ).toEqual([{ targetPlayerId: "target-a", votes: 1 }]);
  });

  it("consumes only the selected player's next-turn adjustment", () => {
    const scheduled = setTurnAdjustment(
      setTurnAdjustment(emptyPlaytestCardState(), "player-a", -30),
      "player-b",
      15
    );
    const consumed = consumeTurnAdjustment(scheduled, "player-a");

    expect(consumed.seconds).toBe(-30);
    expect(consumed.state.turnAdjustments).toEqual([
      { playerId: "player-b", seconds: 15 }
    ]);
  });

  it("clears vote-only effects without losing scheduled turns", () => {
    const state = setTurnAdjustment(
      addBonusVote(emptyPlaytestCardState(), "target-a"),
      "player-a",
      -30
    );

    expect(clearVoteEffects(state)).toEqual({
      ...emptyPlaytestCardState(),
      turnAdjustments: [{ playerId: "player-a", seconds: -30 }]
    });
  });

  it("restores only valid persisted modifiers", () => {
    expect(parsePlaytestCardState(null)).toEqual(emptyPlaytestCardState());
    expect(
      parsePlaytestCardState({
        bonusVotes: [
          { targetPlayerId: "target-a", votes: 2 },
          { targetPlayerId: 2, votes: 1 },
          { targetPlayerId: "target-b", votes: 0 }
        ],
        doubleVotePlayerIds: ["voter-a"],
        protectedVotePlayerIds: [42],
        reducedVotePlayerIds: ["target-a"],
        revealVoteTotals: true,
        turnAdjustments: [
          { playerId: "player-a", seconds: -30 },
          { playerId: "player-b", seconds: 2.5 },
          { playerId: 2, seconds: 15 }
        ]
      })
    ).toEqual({
      bonusVotes: [{ targetPlayerId: "target-a", votes: 2 }],
      doubleVotePlayerIds: ["voter-a"],
      protectedVotePlayerIds: [],
      reducedVotePlayerIds: ["target-a"],
      revealVoteTotals: true,
      silencedVoterPlayerIds: [],
      turnAdjustments: [{ playerId: "player-a", seconds: -30 }]
    });
  });

  it("merges repeated modifiers without mutating the source state", () => {
    const initial = addBonusVote(emptyPlaytestCardState(), "target-a");
    const withSecondTarget = addBonusVote(initial, "target-b");
    const mergedVotes = addBonusVote(withSecondTarget, "target-a");
    const scheduled = setTurnAdjustment(
      setTurnAdjustment(mergedVotes, "player-a", -30),
      "player-b",
      10
    );
    const mergedTurns = setTurnAdjustment(scheduled, "player-a", 15);
    const flagged = addPlayerFlag(
      mergedTurns,
      "doubleVotePlayerIds",
      "voter-a"
    );

    expect(
      addPlayerFlag(flagged, "doubleVotePlayerIds", "voter-a")
    ).toBe(flagged);
    expect(mergedVotes.bonusVotes).toEqual([
      { targetPlayerId: "target-a", votes: 2 },
      { targetPlayerId: "target-b", votes: 1 }
    ]);
    expect(mergedTurns.turnAdjustments).toEqual([
      { playerId: "player-a", seconds: -15 },
      { playerId: "player-b", seconds: 10 }
    ]);
    expect(initial.bonusVotes).toEqual([
      { targetPlayerId: "target-a", votes: 1 }
    ]);
  });

  it("covers empty, protected, reduced, and tied vote totals", () => {
    const protectedBonus = addPlayerFlag(
      addBonusVote(emptyPlaytestCardState(), "protected"),
      "protectedVotePlayerIds",
      "protected"
    );
    expect(tallyPlaytestVotes([], protectedBonus)).toEqual([]);

    const reduced = addPlayerFlag(
      emptyPlaytestCardState(),
      "reducedVotePlayerIds",
      "target-a"
    );
    expect(
      tallyPlaytestVotes(
        [
          { targetPlayerId: "target-b", voterPlayerId: "voter-c" },
          { targetPlayerId: "target-a", voterPlayerId: "voter-a" },
          { targetPlayerId: "target-a", voterPlayerId: "voter-b" }
        ],
        reduced
      )
    ).toEqual([
      { targetPlayerId: "target-a", votes: 1 },
      { targetPlayerId: "target-b", votes: 1 }
    ]);

    expect(consumeTurnAdjustment(emptyPlaytestCardState(), "missing")).toEqual({
      seconds: 0,
      state: emptyPlaytestCardState()
    });
  });
});
