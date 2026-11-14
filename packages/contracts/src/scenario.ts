export const SCENARIO_STATUSES = ["draft", "published", "retired"] as const;
export type ScenarioStatus = (typeof SCENARIO_STATUSES)[number];

export const CORE_OBJECTIVE =
  "enter_bunker_and_preserve_demography" as const;

export const CARD_KINDS = ["action", "reaction"] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export const CONTENT_SCOPES = ["common", "scenario"] as const;
export type ContentScope = (typeof CONTENT_SCOPES)[number];

export const CARD_SELECTION_FIELDS = [
  "target_player",
  "characteristic",
  "resource"
] as const;
export type CardSelectionField = (typeof CARD_SELECTION_FIELDS)[number];

export const CARD_TIMINGS = [
  "own_phase",
  "reaction_window",
  "scenario_defined"
] as const;
export type CardTiming = (typeof CARD_TIMINGS)[number];

export const CARD_TARGETS = [
  "self",
  "active_player",
  "any_non_afk_player",
  "eliminated_player",
  "game"
] as const;
export type CardTarget = (typeof CARD_TARGETS)[number];

export const RARITIES = ["common", "uncommon", "rare"] as const;
export type Rarity = (typeof RARITIES)[number];

export interface WeightedContentValue {
  readonly constraints?: {
    readonly incompatibleTags?: readonly string[] | undefined;
    readonly maxAge?: number | undefined;
    readonly minAge?: number | undefined;
    readonly requiresAnyTags?: readonly string[] | undefined;
  } | undefined;
  readonly id: string;
  readonly label: string;
  readonly rarity: Rarity;
  readonly tags: readonly string[];
  readonly weight: number;
}

export interface ScenarioMeter {
  readonly id: string;
  readonly initialValue: number;
  readonly max: number;
  readonly min: number;
  readonly thresholds: readonly {
    readonly at: number;
    readonly effectId: string;
    readonly label: string;
  }[];
  readonly title: string;
}

export interface ScenarioResource {
  readonly id: string;
  readonly initialValue: number;
  readonly max: number;
  readonly min: number;
  readonly tags: readonly string[];
  readonly title: string;
}

export interface CharacterCategory {
  readonly id: string;
  readonly label: string;
  readonly values: readonly WeightedContentValue[];
}

export interface ScenarioCard {
  readonly description: string;
  readonly effectId: string;
  readonly id: string;
  readonly kind: CardKind;
  readonly scope: ContentScope;
  readonly selection: readonly CardSelectionField[];
  readonly target: CardTarget;
  readonly timing: CardTiming;
  readonly title: string;
}

export interface ScenarioReveal {
  readonly id: string;
  readonly order: number;
  readonly text: string;
  readonly title: string;
}

interface SecretGoalBase {
  readonly description: string;
  readonly id: string;
  readonly requiresBunker: true;
  readonly title: string;
}

export interface PersonalSecretGoal extends SecretGoalBase {
  readonly impact: "personal";
  readonly resolution: "engine" | "host";
}

export interface TeamOutcomeSecretGoal extends SecretGoalBase {
  readonly fulfilledOutcome: "all_survive" | "team_loss";
  readonly impact: "team_outcome";
  readonly resolution: "host";
  readonly unfulfilledOutcome: "keep_base_result";
}

export type SecretGoal = PersonalSecretGoal | TeamOutcomeSecretGoal;

export interface FinalPlan {
  readonly id: string;
  readonly requiredTags: readonly string[];
  readonly title: string;
}

export interface ScenarioContent {
  readonly ageRating: string;
  readonly bunker: {
    readonly capacityRule: "ceil_half";
    readonly description: string;
  };
  readonly cards: readonly ScenarioCard[];
  readonly categories: readonly CharacterCategory[];
  readonly contentWarnings: readonly string[];
  readonly coreObjective: typeof CORE_OBJECTIVE;
  readonly demography: {
    readonly rule: "standard";
  };
  readonly durationMinutes: {
    readonly max: number;
    readonly min: number;
  };
  readonly finalPlans: readonly FinalPlan[];
  readonly id: string;
  readonly locale: string;
  readonly meters: readonly ScenarioMeter[];
  readonly playerRange: {
    readonly max: number;
    readonly min: number;
  };
  readonly registeredEffectIds: readonly string[];
  readonly resources: readonly ScenarioResource[];
  readonly reveals: readonly ScenarioReveal[];
  readonly schemaVersion: 1;
  readonly secretGoals: readonly SecretGoal[];
  readonly status: ScenarioStatus;
  readonly summary: string;
  readonly title: string;
  readonly tone: readonly string[];
  readonly version: string;
}
