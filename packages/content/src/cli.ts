import { resolve } from "node:path";

import { loadScenarioContent } from "./loader.js";

const input = process.argv[2];

if (input === undefined) {
  throw new Error("Usage: pnpm validate <scenario.toon>");
}

const scenario = await loadScenarioContent(resolve(process.cwd(), input));

process.stdout.write(
  `${scenario.id}@${scenario.version}: ${scenario.categories.length} categories, ${scenario.cards.length} cards\n`
);
