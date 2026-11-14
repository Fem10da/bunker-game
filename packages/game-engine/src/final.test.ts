import { describe, expect, it } from "vitest";

import { resolveFinalOutcome } from "./final.js";

const baseInput = {
  bunkerPlayerIds: ["a", "b", "c"],
  demographyPreserved: true,
  scenarioPassed: true
} as const;

describe("resolveFinalOutcome", () => {
  it("marks the bunker group as survived when both base checks pass", () => {
    expect(resolveFinalOutcome(baseInput)).toEqual({
      bunkerPlayerIds: ["a", "b", "c"],
      demographyPreserved: true,
      outcomeSource: "base",
      scenarioPassed: true,
      teamOutcome: "all_survive"
    });
  });

  it("marks a demographic failure before scenario modifiers", () => {
    expect(
      resolveFinalOutcome({
        ...baseInput,
        demographyPreserved: false
      })
    ).toMatchObject({
      outcomeSource: "demography",
      teamOutcome: "team_loss"
    });
  });

  it("marks a scenario failure after a successful demographic check", () => {
    expect(
      resolveFinalOutcome({
        ...baseInput,
        scenarioPassed: false
      })
    ).toMatchObject({
      outcomeSource: "scenario",
      teamOutcome: "team_loss"
    });
  });

  it("lets a fulfilled host-resolved secret goal break a base victory", () => {
    expect(
      resolveFinalOutcome({
        ...baseInput,
        teamSecretGoal: {
          fulfilled: true,
          goal: {
            description: "Саботаж завершено.",
            fulfilledOutcome: "team_loss",
            id: "sabotage",
            impact: "team_outcome",
            requiresBunker: true,
            resolution: "host",
            title: "Саботаж",
            unfulfilledOutcome: "keep_base_result"
          },
          hostPlayerId: "host"
        }
      })
    ).toMatchObject({
      outcomeSource: "secret_goal",
      secretGoalAdjudication: {
        appliedOutcome: "team_loss",
        fulfilled: true,
        goalId: "sabotage",
        hostPlayerId: "host"
      },
      teamOutcome: "team_loss"
    });
  });

  it("keeps the base result when the host rejects the secret condition", () => {
    expect(
      resolveFinalOutcome({
        ...baseInput,
        teamSecretGoal: {
          fulfilled: false,
          goal: {
            description: "Саботаж завершено.",
            fulfilledOutcome: "team_loss",
            id: "sabotage",
            impact: "team_outcome",
            requiresBunker: true,
            resolution: "host",
            title: "Саботаж",
            unfulfilledOutcome: "keep_base_result"
          },
          hostPlayerId: "host"
        }
      })
    ).toMatchObject({
      outcomeSource: "base",
      secretGoalAdjudication: {
        appliedOutcome: "keep_base_result",
        fulfilled: false
      },
      teamOutcome: "all_survive"
    });
  });
});
