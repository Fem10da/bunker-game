import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  loadScenarioContent,
  parseScenarioContent,
  validateScenarioReferences
} from "./index.js";

const validScenario = {
  schemaVersion: 1,
  id: "operation-chalk",
  version: "0.1.0",
  status: "published",
  locale: "uk-UA",
  coreObjective: "enter_bunker_and_preserve_demography",
  demography: {
    rule: "standard"
  },
  meters: [
    {
      id: "predator-attention",
      initialValue: 0,
      max: 10,
      min: 0,
      thresholds: [
        {
          at: 7,
          effectId: "predator_attention.decrease",
          label: "Небезпечно"
        }
      ],
      title: "Увага хижаків"
    }
  ],
  title: "Операція крейда",
  summary: "Сучасні люди потрапили в епоху динозаврів.",
  tone: ["напруга", "загадка", "чорний гумор"],
  ageRating: "16+",
  contentWarnings: ["небезпека", "смерть тварин"],
  playerRange: {
    min: 6,
    max: 10
  },
  durationMinutes: {
    min: 60,
    max: 150
  },
  bunker: {
    capacityRule: "ceil_half",
    description: "Підземна база невідомого походження."
  },
  categories: [
    {
      id: "profession",
      label: "Професія",
      values: [
        {
          id: "paleontologist",
          label: "Палеонтолог",
          rarity: "rare",
          weight: 1,
          tags: ["science"]
        }
      ]
    }
  ],
  cards: [
    {
      description: "Зменшує увагу хижаків.",
      id: "quiet-mode",
      title: "Тихий режим",
      kind: "action",
      effectId: "predator_attention.decrease",
      scope: "scenario",
      selection: [],
      timing: "own_phase",
      target: "game"
    }
  ],
  registeredEffectIds: ["predator_attention.decrease"],
  resources: [
    {
      id: "energy",
      initialValue: 6,
      max: 10,
      min: 0,
      tags: ["technical"],
      title: "Енергія"
    }
  ],
  reveals: [
    {
      id: "bunker-origin",
      order: 1,
      title: "Походження бункера",
      text: "База належала компанії, яка створила динозаврів."
    }
  ],
  secretGoals: [
    {
      id: "scientific-proof",
      title: "Науковий доказ",
      description: "Збережіть дані лабораторії.",
      impact: "personal",
      requiresBunker: true,
      resolution: "engine"
    }
  ],
  finalPlans: [
    {
      id: "scientific",
      title: "Науковий",
      requiredTags: ["science"]
    }
  ]
};

describe("scenario content", () => {
  it("decodes and validates the generated Operation Chalk TOON file", async () => {
    const scenario = await loadScenarioContent(
      fileURLToPath(
        new URL(
          "../../../content/scenarios/operation-chalk.toon",
          import.meta.url
        )
      )
    );

    expect(scenario.categories).toHaveLength(14);
    expect(
      scenario.categories.every((category) => category.values.length >= 14)
    ).toBe(true);
    expect(
      scenario.categories.find((category) => category.id === "profession")
        ?.values
    ).toHaveLength(32);
    expect(scenario.cards).toHaveLength(47);
    expect(scenario.reveals).toHaveLength(5);
    expect(scenario.secretGoals).toHaveLength(12);
  });

  it("accepts a valid scenario", () => {
    expect(parseScenarioContent(validScenario).id).toBe("operation-chalk");
  });

  it("rejects a scenario that replaces the shared core objective", () => {
    expect(() =>
      parseScenarioContent({
        ...validScenario,
        coreObjective: "complete_a_secret_goal"
      })
    ).toThrow();
  });

  it("rejects a secret goal that can replace reaching the bunker", () => {
    expect(() =>
      parseScenarioContent({
        ...validScenario,
        secretGoals: [
          {
            ...validScenario.secretGoals[0],
            requiresBunker: false
          }
        ]
      })
    ).toThrow();
  });

  it("accepts a host-resolved secret goal that can change the team outcome", () => {
    const scenario = parseScenarioContent({
      ...validScenario,
      secretGoals: [
        {
          ...validScenario.secretGoals[0],
          fulfilledOutcome: "team_loss",
          impact: "team_outcome",
          resolution: "host",
          unfulfilledOutcome: "keep_base_result"
        }
      ]
    });

    expect(scenario.secretGoals[0]?.impact).toBe("team_outcome");
    expect(
      scenario.secretGoals[0]?.impact === "team_outcome"
        ? scenario.secretGoals[0].fulfilledOutcome
        : undefined
    ).toBe("team_loss");
  });

  it("rejects automatic resolution for a team-outcome secret goal", () => {
    expect(() =>
      parseScenarioContent({
        ...validScenario,
        secretGoals: [
          {
            ...validScenario.secretGoals[0],
            fulfilledOutcome: "team_loss",
            impact: "team_outcome",
            resolution: "engine",
            unfulfilledOutcome: "keep_base_result"
          }
        ]
      })
    ).toThrow();
  });

  it("rejects a team-outcome goal without predetermined consequences", () => {
    expect(() =>
      parseScenarioContent({
        ...validScenario,
        secretGoals: [
          {
            ...validScenario.secretGoals[0],
            impact: "team_outcome",
            resolution: "host"
          }
        ]
      })
    ).toThrow();
  });

  it("rejects conflicting team-outcome goals in one beta scenario", () => {
    const scenario = parseScenarioContent({
      ...validScenario,
      secretGoals: ["first", "second"].map((id) => ({
        description: "Змінює результат групи.",
        fulfilledOutcome: "team_loss" as const,
        id,
        impact: "team_outcome" as const,
        requiresBunker: true as const,
        resolution: "host" as const,
        title: id,
        unfulfilledOutcome: "keep_base_result" as const
      }))
    });

    expect(() => validateScenarioReferences(scenario)).toThrow(
      "A beta scenario can contain only one team-outcome secret goal"
    );
  });

  it("rejects an unsafe custom effect reference", () => {
    const scenario = parseScenarioContent({
      ...validScenario,
      cards: [
        {
          ...validScenario.cards[0],
          effectId: "eval.arbitrary-code"
        }
      ]
    });

    expect(() => validateScenarioReferences(scenario)).toThrow(
      'Unknown effect_id "eval.arbitrary-code"'
    );
  });

  it("rejects an impossible player range", () => {
    expect(() =>
      parseScenarioContent({
        ...validScenario,
        playerRange: {
          min: 10,
          max: 6
        }
      })
    ).toThrow();
  });

  it("rejects duplicate IDs inside a category", () => {
    const scenario = parseScenarioContent({
      ...validScenario,
      categories: [
        {
          ...validScenario.categories[0],
          values: [
            validScenario.categories[0]?.values[0],
            validScenario.categories[0]?.values[0]
          ]
        }
      ]
    });

    expect(() => validateScenarioReferences(scenario)).toThrow(
      'Category "profession" contains duplicate IDs'
    );
  });

  it("rejects an unknown meter threshold effect", () => {
    const scenario = parseScenarioContent({
      ...validScenario,
      meters: [
        {
          ...validScenario.meters[0],
          thresholds: [
            {
              at: 7,
              effectId: "unknown.threshold",
              label: "Невідомо"
            }
          ]
        }
      ]
    });

    expect(() => validateScenarioReferences(scenario)).toThrow(
      'Unknown effect_id "unknown.threshold"'
    );
  });

  it("rejects an unknown final-plan character tag", () => {
    const scenario = parseScenarioContent({
      ...validScenario,
      finalPlans: [
        {
          ...validScenario.finalPlans[0],
          requiredTags: ["sciense"]
        }
      ]
    });

    expect(() => validateScenarioReferences(scenario)).toThrow(
      'Unknown final-plan tag "sciense"'
    );
  });

  it("rejects contradictory age constraints", () => {
    expect(() =>
      parseScenarioContent({
        ...validScenario,
        categories: [
          {
            ...validScenario.categories[0],
            values: [
              {
                ...validScenario.categories[0]?.values[0],
                constraints: {
                  maxAge: 20,
                  minAge: 30
                }
              }
            ]
          }
        ]
      })
    ).toThrow();
  });
});
