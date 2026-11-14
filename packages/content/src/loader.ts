import { readFile } from "node:fs/promises";

import { decode } from "@toon-format/toon";

import type { ScenarioContent } from "@bunker/contracts";

import {
  parseScenarioContent,
  validateScenarioReferences
} from "./scenario.js";

export function decodeScenarioContent(source: string): ScenarioContent {
  const decoded: unknown = decode(source);
  return validateScenarioReferences(parseScenarioContent(decoded));
}

export async function loadScenarioContent(
  path: string
): Promise<ScenarioContent> {
  return decodeScenarioContent(await readFile(path, "utf8"));
}
