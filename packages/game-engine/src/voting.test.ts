import { describe, expect, it } from "vitest";

import { resolveVotes } from "./voting.js";

const players = [
  { id: "a", status: "active" as const },
  { id: "b", status: "active" as const },
  { id: "c", status: "active" as const },
  { id: "d", status: "afk" as const }
];

describe("resolveVotes", () => {
  it("fills a missing active vote deterministically and records it as automatic", () => {
    const result = resolveVotes({
      decisionPointId: "round-2-vote",
      players,
      seed: "seed",
      submittedVotes: {
        a: "b",
        b: "a"
      }
    });

    expect(result.votes).toHaveLength(3);
    expect(result.votes.filter((vote) => vote.automatic)).toHaveLength(1);
    expect(result.votes.find((vote) => vote.voterId === "c")?.targetId).not.toBe(
      "c"
    );
    expect(
      result.votes.find((vote) => vote.voterId === "c")?.targetId
    ).not.toBe("d");
  });

  it("does not expect a vote from an AFK player", () => {
    const result = resolveVotes({
      decisionPointId: "round-2-vote",
      players,
      seed: "seed",
      submittedVotes: {
        a: "b",
        b: "a",
        c: "a"
      }
    });

    expect(result.votes.map((vote) => vote.voterId)).not.toContain("d");
  });

  it("reports a tie without eliminating anyone", () => {
    const result = resolveVotes({
      decisionPointId: "final-open-vote",
      players: players.slice(0, 3),
      seed: "seed",
      submittedVotes: {
        a: "b",
        b: "a",
        c: "a"
      }
    });

    expect(result.leaderIds).toEqual(["a"]);
    expect(result.counts).toEqual({ a: 2, b: 1 });
  });

  it("rejects a self vote", () => {
    expect(() =>
      resolveVotes({
        decisionPointId: "round-2-vote",
        players,
        seed: "seed",
        submittedVotes: {
          a: "a"
        }
      })
    ).toThrow("A player cannot vote for themselves");
  });

  it("rejects a vote for an unknown player", () => {
    expect(() =>
      resolveVotes({
        decisionPointId: "round-2-vote",
        players,
        seed: "seed",
        submittedVotes: {
          a: "unknown"
        }
      })
    ).toThrow('Player "unknown" is not an eligible vote target');
  });

  it("rejects a manual vote for an AFK player", () => {
    expect(() =>
      resolveVotes({
        decisionPointId: "round-2-vote",
        players,
        seed: "seed",
        submittedVotes: {
          a: "d"
        }
      })
    ).toThrow('Player "d" is not an eligible vote target');
  });

  it("rejects an automatic vote when no candidate is eligible", () => {
    expect(() =>
      resolveVotes({
        decisionPointId: "round-2-vote",
        players: [{ id: "a", status: "active" }],
        seed: "seed",
        submittedVotes: {}
      })
    ).toThrow("Candidate count must be a positive integer");
  });
});
