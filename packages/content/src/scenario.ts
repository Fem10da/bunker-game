import type { ScenarioContent } from "@bunker/contracts";
import { z } from "zod";

const contentValueSchema = z.object({
  constraints: z
    .object({
      incompatibleTags: z.array(z.string().min(1)).optional(),
      maxAge: z.number().int().positive().optional(),
      minAge: z.number().int().nonnegative().optional(),
      requiresAnyTags: z.array(z.string().min(1)).optional()
    })
    .refine(
      ({ maxAge, minAge }) =>
        maxAge === undefined || minAge === undefined || minAge <= maxAge,
      {
        message: "Minimum age cannot exceed maximum age"
      }
    )
    .optional(),
  id: z.string().min(1),
  label: z.string().min(1),
  rarity: z.enum(["common", "uncommon", "rare"]),
  tags: z.array(z.string().min(1)),
  weight: z.number().positive()
});

const secretGoalBaseSchema = z.object({
  description: z.string().min(1),
  id: z.string().min(1),
  requiresBunker: z.literal(true),
  title: z.string().min(1)
});

const secretGoalSchema = z.discriminatedUnion("impact", [
  secretGoalBaseSchema.extend({
    impact: z.literal("personal"),
    resolution: z.enum(["engine", "host"])
  }),
  secretGoalBaseSchema.extend({
    fulfilledOutcome: z.enum(["all_survive", "team_loss"]),
    impact: z.literal("team_outcome"),
    resolution: z.literal("host"),
    unfulfilledOutcome: z.literal("keep_base_result")
  })
]);

const scenarioSchema = z
  .object({
    ageRating: z.string().min(1),
    bunker: z.object({
      capacityRule: z.literal("ceil_half"),
      description: z.string().min(1)
    }),
    cards: z.array(
      z.object({
        description: z.string().min(1),
        effectId: z.string().min(1),
        id: z.string().min(1),
        kind: z.enum(["action", "reaction"]),
        scope: z.enum(["common", "scenario"]),
        selection: z.array(
          z.enum(["target_player", "characteristic", "resource"])
        ),
        target: z.enum([
          "self",
          "active_player",
          "any_non_afk_player",
          "eliminated_player",
          "game"
        ]),
        timing: z.enum([
          "own_phase",
          "reaction_window",
          "scenario_defined"
        ]),
        title: z.string().min(1)
      })
    ),
    categories: z.array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        values: z.array(contentValueSchema).min(1)
      })
    ),
    contentWarnings: z.array(z.string().min(1)),
    coreObjective: z.literal("enter_bunker_and_preserve_demography"),
    demography: z.object({
      rule: z.literal("standard")
    }),
    durationMinutes: z
      .object({
        max: z.number().int().positive(),
        min: z.number().int().positive()
      })
      .refine(({ max, min }) => min <= max, {
        message: "Minimum duration cannot exceed maximum duration"
      }),
    finalPlans: z.array(
      z.object({
        id: z.string().min(1),
        requiredTags: z.array(z.string().min(1)),
        title: z.string().min(1)
      })
    ),
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    locale: z.string().min(2),
    meters: z.array(
      z
        .object({
          id: z.string().min(1),
          initialValue: z.number().int(),
          max: z.number().int(),
          min: z.number().int(),
          thresholds: z.array(
            z.object({
              at: z.number().int(),
              effectId: z.string().min(1),
              label: z.string().min(1)
            })
          ),
          title: z.string().min(1)
        })
        .refine(
          ({ initialValue, max, min }) =>
            min <= max && initialValue >= min && initialValue <= max,
          {
            message: "Meter values are outside their valid range"
          }
        )
    ),
    playerRange: z
      .object({
        max: z.number().int().min(4).max(16),
        min: z.number().int().min(4).max(16)
      })
      .refine(({ max, min }) => min <= max, {
        message: "Minimum players cannot exceed maximum players"
      }),
    registeredEffectIds: z.array(z.string().min(1)),
    resources: z.array(
      z
        .object({
          id: z.string().min(1),
          initialValue: z.number().int(),
          max: z.number().int(),
          min: z.number().int(),
          tags: z.array(z.string().min(1)),
          title: z.string().min(1)
        })
        .refine(
          ({ initialValue, max, min }) =>
            min <= max && initialValue >= min && initialValue <= max,
          {
            message: "Resource values are outside their valid range"
          }
        )
    ),
    reveals: z.array(
      z.object({
        id: z.string().min(1),
        order: z.number().int().positive(),
        text: z.string().min(1),
        title: z.string().min(1)
      })
    ),
    schemaVersion: z.literal(1),
    secretGoals: z.array(secretGoalSchema),
    status: z.enum(["draft", "published", "retired"]),
    summary: z.string().min(1),
    title: z.string().min(1),
    tone: z.array(z.string().min(1)).min(1),
    version: z.string().regex(/^\d+\.\d+\.\d+$/)
  })
  .strict();

function assertUniqueIds(
  values: readonly { readonly id: string }[],
  label: string
): void {
  const ids = values.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${label} contains duplicate IDs`);
  }
}

export function parseScenarioContent(input: unknown): ScenarioContent {
  return scenarioSchema.parse(input);
}

export function validateScenarioReferences(
  scenario: ScenarioContent
): ScenarioContent {
  const knownEffects = new Set(scenario.registeredEffectIds);
  for (const card of scenario.cards) {
    if (!knownEffects.has(card.effectId)) {
      throw new Error(`Unknown effect_id "${card.effectId}"`);
    }
  }

  assertUniqueIds(scenario.categories, "Categories");
  assertUniqueIds(scenario.cards, "Cards");
  assertUniqueIds(scenario.reveals, "Reveals");
  assertUniqueIds(scenario.meters, "Meters");
  assertUniqueIds(scenario.resources, "Resources");
  assertUniqueIds(scenario.secretGoals, "Secret goals");
  assertUniqueIds(scenario.finalPlans, "Final plans");
  if (
    scenario.secretGoals.filter((goal) => goal.impact === "team_outcome")
      .length > 1
  ) {
    throw new Error(
      "A beta scenario can contain only one team-outcome secret goal"
    );
  }
  for (const category of scenario.categories) {
    assertUniqueIds(category.values, `Category "${category.id}"`);
  }
  const knownCharacterTags = new Set(
    scenario.categories.flatMap((category) =>
      category.values.flatMap((value) => value.tags)
    )
  );
  for (const plan of scenario.finalPlans) {
    for (const tag of plan.requiredTags) {
      if (!knownCharacterTags.has(tag)) {
        throw new Error(`Unknown final-plan tag "${tag}"`);
      }
    }
  }
  for (const meter of scenario.meters) {
    for (const threshold of meter.thresholds) {
      if (!knownEffects.has(threshold.effectId)) {
        throw new Error(`Unknown effect_id "${threshold.effectId}"`);
      }
    }
  }

  return scenario;
}
