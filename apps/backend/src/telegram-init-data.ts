import { createHmac, timingSafeEqual } from "node:crypto";

import type { TelegramUser } from "@bunker/contracts";

export type TelegramInitDataErrorCode =
  | "EXPIRED_TELEGRAM_INIT_DATA"
  | "INVALID_TELEGRAM_INIT_DATA";

export class TelegramInitDataError extends Error {
  readonly code: TelegramInitDataErrorCode;

  constructor(code: TelegramInitDataErrorCode) {
    super(code);
    this.name = "TelegramInitDataError";
    this.code = code;
  }
}

interface VerifyTelegramInitDataOptions {
  readonly botToken: string;
  readonly initData: string;
  readonly maxAgeSeconds: number;
  readonly now?: Date;
}

export interface VerifiedTelegramInitData {
  readonly authDate: number;
  readonly queryId?: string;
  readonly startParam?: string;
  readonly user: TelegramUser;
}

interface TelegramUserPayload {
  readonly first_name?: unknown;
  readonly id?: unknown;
  readonly language_code?: unknown;
  readonly last_name?: unknown;
  readonly username?: unknown;
}

function invalid(): never {
  throw new TelegramInitDataError("INVALID_TELEGRAM_INIT_DATA");
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseUser(value: string): TelegramUser {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    return invalid();
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return invalid();
  }

  const user = parsed as TelegramUserPayload;
  if (
    typeof user.id !== "number" ||
    !Number.isSafeInteger(user.id) ||
    user.id <= 0 ||
    typeof user.first_name !== "string" ||
    user.first_name.length === 0
  ) {
    return invalid();
  }

  const languageCode = optionalString(user.language_code);
  const lastName = optionalString(user.last_name);
  const username = optionalString(user.username);

  return {
    firstName: user.first_name,
    id: String(user.id),
    ...(languageCode === undefined ? {} : { languageCode }),
    ...(lastName === undefined ? {} : { lastName }),
    ...(username === undefined ? {} : { username })
  };
}

function compareKeys(
  [left]: readonly [string, string],
  [right]: readonly [string, string]
) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function verifySignature(
  entries: readonly (readonly [string, string])[],
  hash: string,
  botToken: string
) {
  if (!/^[a-f\d]{64}$/i.test(hash)) {
    return invalid();
  }

  const dataCheckString = entries
    .filter(([key]) => key !== "hash")
    .toSorted(compareKeys)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();
  const expectedHash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest();
  const actualHash = Buffer.from(hash, "hex");

  if (
    actualHash.length !== expectedHash.length ||
    !timingSafeEqual(actualHash, expectedHash)
  ) {
    return invalid();
  }
}

export function verifyTelegramInitData({
  botToken,
  initData,
  maxAgeSeconds,
  now = new Date()
}: VerifyTelegramInitDataOptions): VerifiedTelegramInitData {
  if (
    botToken.length === 0 ||
    initData.length === 0 ||
    maxAgeSeconds <= 0
  ) {
    return invalid();
  }

  const entries = [...new URLSearchParams(initData).entries()];
  const hasDuplicate = entries.some(
    ([key], index) =>
      entries.findIndex(([candidate]) => candidate === key) !== index
  );

  if (entries.length === 0 || hasDuplicate) {
    return invalid();
  }

  const hash = entries.find(([key]) => key === "hash")?.[1];
  if (hash === undefined) {
    return invalid();
  }

  verifySignature(entries, hash, botToken);

  const parameters = new Map(entries);
  const authDateValue = parameters.get("auth_date");
  const userValue = parameters.get("user");
  if (
    authDateValue === undefined ||
    !/^\d{1,12}$/.test(authDateValue) ||
    userValue === undefined
  ) {
    return invalid();
  }

  const authDate = Number(authDateValue);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (!Number.isSafeInteger(authDate) || authDate > nowSeconds + 30) {
    return invalid();
  }
  if (authDate < nowSeconds - maxAgeSeconds) {
    throw new TelegramInitDataError("EXPIRED_TELEGRAM_INIT_DATA");
  }

  const queryId = optionalString(parameters.get("query_id"));
  const startParam = optionalString(parameters.get("start_param"));

  return {
    authDate,
    ...(queryId === undefined ? {} : { queryId }),
    ...(startParam === undefined ? {} : { startParam }),
    user: parseUser(userValue)
  };
}
