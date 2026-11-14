// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { UiPreview } from "./UiPreview.js";

afterEach(cleanup);

describe("UI preview", () => {
  it("switches between game pages without a backend", async () => {
    window.history.replaceState(null, "", "/?preview=ui&page=scenario");
    render(<UiPreview />);

    expect(screen.getByText("ЧАСОВИЙ РОЗЛОМ")).toBeDefined();
    await userEvent.click(screen.getByLabelText("Вибрати екран гри"));
    await userEvent.click(
      screen.getByRole("button", { name: "9. Загальне обговорення" })
    );

    expect(screen.getByText("ЗАГАЛЬНЕ ОБГОВОРЕННЯ")).toBeDefined();
    expect(window.location.search).toContain("page=discussion");
  });

  it("keeps the instruction before reveal short", () => {
    window.history.replaceState(null, "", "/?preview=ui&page=character");
    render(<UiPreview />);

    expect(screen.getByText("Відкрийте характеристику під час виступу."))
      .toBeDefined();
    expect(screen.getByText("01:30")).toBeDefined();
  });

  it("does not repeat the reveal during the speech", () => {
    window.history.replaceState(null, "", "/?preview=ui&page=speaking");
    render(<UiPreview />);

    const currentTurn = screen.getByRole("region", {
      name: "Поточний хід"
    });
    expect(currentTurn.textContent).not.toContain("Контрольована астма");
    expect(currentTurn.textContent).not.toContain("90 секунд");
    expect(currentTurn.textContent).not.toContain("почала виступ");
  });

  it("exposes the host rollback controls in the UI preview", () => {
    window.history.replaceState(null, "", "/?preview=ui&page=rollback");
    render(<UiPreview />);

    expect(screen.getByText("Безпечне відновлення")).toBeDefined();
    expect(screen.getByText("Початок ходу гравця №1")).toBeDefined();
  });

  it("offers a sixteen-player projector preview", async () => {
    window.history.replaceState(null, "", "/?preview=ui&page=projector");
    render(<UiPreview />);

    expect(await screen.findByText("Таксидерміст")).toBeDefined();
    expect(screen.getByText("8 / 16")).toBeDefined();
  });
});
