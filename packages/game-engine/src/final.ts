import type {
  FinalOutcome,
  TeamOutcomeSecretGoal
} from "@bunker/contracts";

interface ResolveFinalOutcomeInput {
  readonly bunkerPlayerIds: readonly string[];
  readonly demographyPreserved: boolean;
  readonly scenarioPassed: boolean;
  readonly teamSecretGoal?: {
    readonly fulfilled: boolean;
    readonly goal: TeamOutcomeSecretGoal;
    readonly hostPlayerId: string;
  };
}

function resolveBaseOutcome(
  input: ResolveFinalOutcomeInput
): Pick<FinalOutcome, "outcomeSource" | "teamOutcome"> {
  if (!input.demographyPreserved) {
    return {
      outcomeSource: "demography",
      teamOutcome: "team_loss"
    };
  }

  if (!input.scenarioPassed) {
    return {
      outcomeSource: "scenario",
      teamOutcome: "team_loss"
    };
  }

  return {
    outcomeSource: "base",
    teamOutcome: "all_survive"
  };
}

export function resolveFinalOutcome(
  input: ResolveFinalOutcomeInput
): FinalOutcome {
  const baseOutcome = resolveBaseOutcome(input);
  const baseResult = {
    bunkerPlayerIds: [...input.bunkerPlayerIds],
    demographyPreserved: input.demographyPreserved,
    ...baseOutcome,
    scenarioPassed: input.scenarioPassed
  };

  if (input.teamSecretGoal === undefined) {
    return baseResult;
  }

  const { fulfilled, goal, hostPlayerId } = input.teamSecretGoal;
  const appliedOutcome = fulfilled
    ? goal.fulfilledOutcome
    : goal.unfulfilledOutcome;
  const resultWithAdjudication = {
    ...baseResult,
    secretGoalAdjudication: {
      appliedOutcome,
      fulfilled,
      goalId: goal.id,
      hostPlayerId
    }
  };

  if (!fulfilled) {
    return resultWithAdjudication;
  }

  return {
    ...resultWithAdjudication,
    outcomeSource: "secret_goal",
    teamOutcome: goal.fulfilledOutcome
  };
}
