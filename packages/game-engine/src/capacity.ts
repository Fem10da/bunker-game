export function calculateBunkerCapacity(playerCount: number): number {
  if (!Number.isInteger(playerCount) || playerCount <= 0) {
    throw new Error("Player count must be a positive integer");
  }

  return Math.ceil(playerCount / 2);
}
