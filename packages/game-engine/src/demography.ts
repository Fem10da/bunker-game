export type DemographicSex = "female" | "male";

export interface DemographicCharacter {
  readonly age: number;
  readonly fertilityCapable?: boolean;
  readonly sex: DemographicSex;
}

export interface DemographyAgeRange {
  readonly max: number;
  readonly min: number;
}

export interface DemographyRule {
  readonly femaleAgeRange: DemographyAgeRange;
  readonly maleAgeRange: DemographyAgeRange;
  readonly requiredMen: number;
  readonly requiredWomen: number;
}

export interface DemographyAssessment extends DemographyRule {
  readonly eligibleMen: number;
  readonly eligibleWomen: number;
  readonly preserved: boolean;
}

export const STANDARD_BETA_DEMOGRAPHY_RULE = Object.freeze({
  femaleAgeRange: Object.freeze({ max: 49, min: 18 }),
  maleAgeRange: Object.freeze({ max: 64, min: 18 }),
  requiredMen: 1,
  requiredWomen: 1
}) satisfies DemographyRule;

function isInRange(age: number, range: DemographyAgeRange): boolean {
  return age >= range.min && age <= range.max;
}

function isValidRange(range: DemographyAgeRange): boolean {
  return (
    Number.isInteger(range.min) &&
    Number.isInteger(range.max) &&
    range.min >= 0 &&
    range.max <= 130 &&
    range.min <= range.max
  );
}

export function assessDemography(
  characters: readonly DemographicCharacter[],
  rule: DemographyRule = STANDARD_BETA_DEMOGRAPHY_RULE,
  fertilityAssistanceAvailable = false
): DemographyAssessment {
  if (
    !isValidRange(rule.femaleAgeRange) ||
    !isValidRange(rule.maleAgeRange) ||
    !Number.isInteger(rule.requiredMen) ||
    rule.requiredMen < 1 ||
    !Number.isInteger(rule.requiredWomen) ||
    rule.requiredWomen < 1
  ) {
    throw new Error("Invalid demographic rule");
  }
  if (
    characters.some(
      (character) =>
        !Number.isInteger(character.age) ||
        character.age < 0 ||
        character.age > 130
    )
  ) {
    throw new Error("Invalid demographic age");
  }

  const eligibleWomen = characters.filter(
    (character) =>
      character.sex === "female" &&
      isInRange(character.age, rule.femaleAgeRange)
  ).length;
  const eligibleMen = characters.filter(
    (character) =>
      character.sex === "male" &&
      isInRange(character.age, rule.maleAgeRange)
  ).length;

  const standardPass =
    eligibleWomen >= rule.requiredWomen && eligibleMen >= rule.requiredMen;
  const assistedPass =
    fertilityAssistanceAvailable &&
    characters.some((character) => character.fertilityCapable === true);

  return {
    eligibleMen,
    eligibleWomen,
    femaleAgeRange: { ...rule.femaleAgeRange },
    maleAgeRange: { ...rule.maleAgeRange },
    preserved: standardPass || assistedPass,
    requiredMen: rule.requiredMen,
    requiredWomen: rule.requiredWomen
  };
}
