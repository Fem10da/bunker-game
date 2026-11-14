import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  TelegramInitDataError,
  verifyTelegramInitData
} from "./telegram-init-data.js";

const botToken = "123456789:AAExampleTokenForBunkerTestsOnly1234567890";
const nowSeconds = 1_800_000_000;

function createSignedInitData(
  values: Readonly<Record<string, string>>,
  token = botToken
) {
  const entries = Object.entries(values).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  const dataCheckString = entries
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData")
    .update(token)
    .digest();
  const hash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");
  const parameters = new URLSearchParams(entries);

  parameters.set("hash", hash);
  return parameters.toString();
}

const validValues = {
  auth_date: String(nowSeconds - 60),
  query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
  start_param: "join_ABCD12",
  user: JSON.stringify({
    first_name: "Олена",
    id: 424_242,
    language_code: "uk",
    last_name: "Коваль",
    username: "olena"
  })
};

function expectTelegramError(
  action: () => unknown,
  code: TelegramInitDataError["code"]
) {
  try {
    action();
    throw new Error("Expected TelegramInitDataError");
  } catch (error) {
    expect(error).toBeInstanceOf(TelegramInitDataError);
    expect(error).toMatchObject({ code });
  }
}

describe("verifyTelegramInitData", () => {
  it("matches a fixed signature fixture generated independently with OpenSSL", () => {
    const initData =
      "auth_date=1800000000&query_id=AAHdF6IQAAAAAN0XohDhrOrc&" +
      "user=%7B%22id%22%3A424242%2C%22first_name%22%3A%22%D0%9E%D0%BB%D0%B5%D0%BD%D0%B0%22%7D&" +
      "hash=519644f303049fec731f8ca27688c595330c24a5f188433789651052699cb216";

    expect(
      verifyTelegramInitData({
        botToken,
        initData,
        maxAgeSeconds: 300,
        now: new Date(nowSeconds * 1000)
      })
    ).toEqual({
      authDate: nowSeconds,
      queryId: "AAHdF6IQAAAAAN0XohDhrOrc",
      user: {
        firstName: "Олена",
        id: "424242"
      }
    });
  });

  it("verifies the Telegram signature and returns only normalized identity data", () => {
    const result = verifyTelegramInitData({
      botToken,
      initData: createSignedInitData(validValues),
      maxAgeSeconds: 300,
      now: new Date(nowSeconds * 1000)
    });

    expect(result).toEqual({
      authDate: nowSeconds - 60,
      queryId: "AAHdF6IQAAAAAN0XohDhrOrc",
      startParam: "join_ABCD12",
      user: {
        firstName: "Олена",
        id: "424242",
        languageCode: "uk",
        lastName: "Коваль",
        username: "olena"
      }
    });
  });

  it("rejects a payload changed after it was signed", () => {
    const initData = createSignedInitData(validValues).replace(
      "%D0%9E%D0%BB%D0%B5%D0%BD%D0%B0",
      "%D0%86%D1%80%D0%B8%D0%BD%D0%B0"
    );

    expectTelegramError(
      () =>
        verifyTelegramInitData({
          botToken,
          initData,
          maxAgeSeconds: 300,
          now: new Date(nowSeconds * 1000)
        }),
      "INVALID_TELEGRAM_INIT_DATA"
    );
  });

  it("rejects expired authorization data", () => {
    const initData = createSignedInitData({
      ...validValues,
      auth_date: String(nowSeconds - 301)
    });

    expectTelegramError(
      () =>
        verifyTelegramInitData({
          botToken,
          initData,
          maxAgeSeconds: 300,
          now: new Date(nowSeconds * 1000)
        }),
      "EXPIRED_TELEGRAM_INIT_DATA"
    );
  });

  it("rejects authorization data from too far in the future", () => {
    const initData = createSignedInitData({
      ...validValues,
      auth_date: String(nowSeconds + 31)
    });

    expectTelegramError(
      () =>
        verifyTelegramInitData({
          botToken,
          initData,
          maxAgeSeconds: 300,
          now: new Date(nowSeconds * 1000)
        }),
      "INVALID_TELEGRAM_INIT_DATA"
    );
  });

  it("rejects duplicate fields even when one hash is valid", () => {
    const initData = createSignedInitData(validValues);
    const duplicated = `${initData}&hash=${"0".repeat(64)}`;

    expectTelegramError(
      () =>
        verifyTelegramInitData({
          botToken,
          initData: duplicated,
          maxAgeSeconds: 300,
          now: new Date(nowSeconds * 1000)
        }),
      "INVALID_TELEGRAM_INIT_DATA"
    );
  });

  it("rejects unsigned and incomplete input", () => {
    expectTelegramError(
      () =>
        verifyTelegramInitData({
          botToken,
          initData: "auth_date=1800000000",
          maxAgeSeconds: 300,
          now: new Date(nowSeconds * 1000)
        }),
      "INVALID_TELEGRAM_INIT_DATA"
    );
  });

  it("rejects a signed payload without a usable Telegram user", () => {
    const initData = createSignedInitData({
      auth_date: String(nowSeconds - 60),
      user: JSON.stringify({
        first_name: "",
        id: -1
      })
    });

    expectTelegramError(
      () =>
        verifyTelegramInitData({
          botToken,
          initData,
          maxAgeSeconds: 300,
          now: new Date(nowSeconds * 1000)
        }),
      "INVALID_TELEGRAM_INIT_DATA"
    );
  });

  it("rejects an invalid verifier configuration", () => {
    expectTelegramError(
      () =>
        verifyTelegramInitData({
          botToken: "",
          initData: createSignedInitData(validValues),
          maxAgeSeconds: 300,
          now: new Date(nowSeconds * 1000)
        }),
      "INVALID_TELEGRAM_INIT_DATA"
    );
  });
});
