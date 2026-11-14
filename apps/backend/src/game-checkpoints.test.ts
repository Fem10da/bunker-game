import { describe, expect, it } from "vitest";

import {
  checkpointSnapshotChecksum,
  verifyCheckpointSnapshot
} from "./game-checkpoints.js";

const validState = {
  lobby: {
    cardChain: null,
    cardState: {},
    currentTurnPosition: 1,
    finalOutcome: null,
    gamePhase: "revealing",
    lastEvent: null,
    reactionDeadline: null,
    reactionTurnSeconds: null,
    round: 1,
    scenarioResources: [],
    turnDeadline: null,
    turnRevealedCharacteristicId: null,
    turnStage: "choosing",
    votingAttempt: 1,
    votingCandidateIds: []
  },
  players: [
    {
      cardPrivateResult: null,
      cardUsed: false,
      characterProfile: {},
      disclosedCharacteristics: [],
      gameStatus: "active",
      inspectedCharacteristics: [],
      invalidatedCharacteristics: [],
      playerId: "424242",
      position: 1,
      revealedCharacteristics: [],
      secretGoal: "Вижити",
      specialCard: {},
      voteTargetPlayerId: null
    }
  ]
};

function checkpoint(state: unknown) {
  return {
    checksum: checkpointSnapshotChecksum(state),
    state
  };
}

describe("rollback checkpoint validation", () => {
  it("restores a valid snapshot after verifying its checksum", () => {
    expect(verifyCheckpointSnapshot(checkpoint(validState))).toEqual(
      validState
    );
  });

  it("rejects a snapshot changed after the checksum was created", () => {
    expect(() =>
      verifyCheckpointSnapshot({
        checksum: checkpointSnapshotChecksum(validState),
        state: { ...validState, players: [] }
      })
    ).toThrow("checksum does not match");
  });

  it.each([
    null,
    {},
    { lobby: null, players: [] },
    { lobby: validState.lobby, players: null }
  ])("rejects an invalid snapshot envelope", (state) => {
    expect(() => verifyCheckpointSnapshot(checkpoint(state))).toThrow(
      "invalid snapshot"
    );
  });

  it.each([
    { gamePhase: null },
    { round: "1" },
    { votingAttempt: null },
    { votingCandidateIds: null }
  ])("rejects an invalid lobby snapshot field", (change) => {
    const state = {
      ...validState,
      lobby: { ...validState.lobby, ...change }
    };
    expect(() => verifyCheckpointSnapshot(checkpoint(state))).toThrow(
      "invalid lobby state"
    );
  });

  it.each([
    null,
    { ...validState.players[0], playerId: null },
    { ...validState.players[0], revealedCharacteristics: null },
    { ...validState.players[0], invalidatedCharacteristics: null },
    { ...validState.players[0], cardUsed: null },
    { ...validState.players[0], gameStatus: null }
  ])("rejects an invalid player snapshot field", (player) => {
    const state = { ...validState, players: [player] };
    expect(() => verifyCheckpointSnapshot(checkpoint(state))).toThrow(
      "invalid player state"
    );
  });
});
