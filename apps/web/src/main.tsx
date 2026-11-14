import { createRoot } from "react-dom/client";

import { TelegramApp } from "./TelegramApp.js";
import { PublicScreen } from "./PublicScreen.js";
import { UiPreview } from "./UiPreview.js";
import "./styles.css";

const root = document.querySelector("#root");

if (root === null) {
  throw new Error("Root element is missing");
}

const preview =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get("preview") === "ui";
const screenMatch = /^\/screen\/([A-Za-z0-9]{6})\/?$/u.exec(
  window.location.pathname
);

createRoot(root).render(
  screenMatch === null ? (
    preview ? <UiPreview /> : <TelegramApp />
  ) : (
    <PublicScreen code={screenMatch[1]!.toUpperCase()} />
  )
);
