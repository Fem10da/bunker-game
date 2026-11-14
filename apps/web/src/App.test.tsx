import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "./App.js";

describe("App", () => {
  it("shows the owner full private values without rendering the public table", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain("Контрольована астма");
    expect(html).toContain("ЛИШЕ ДЛЯ ВАС");
    expect(html).not.toContain("ПУБЛІЧНА ПРОЄКЦІЯ");
  });

  it("does not render private dossier data in the public table view", () => {
    const html = renderToStaticMarkup(<App initialView="table" />);

    expect(html).toContain("ПУБЛІЧНА ПРОЄКЦІЯ");
    expect(html).not.toContain("ТАЄМНА ЦІЛЬ");
    expect(html).not.toContain("Контрольована астма");
    expect(html).not.toContain("Відкрити характеристику");
  });

  it("uses the authenticated Telegram player instead of the demo identity", () => {
    const html = renderToStaticMarkup(
      <App
        currentUser={{
          firstName: "Вадим",
          id: "424242"
        }}
        initialView="table"
      />
    );

    expect(html).toContain("Відкрийте характеристику під час виступу.");
    expect(html).toContain(">Вадим<");
    expect(html).not.toContain(">Олена<");
  });
});
