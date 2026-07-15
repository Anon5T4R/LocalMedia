import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";
import { useLocale } from "./lib/i18n";

// Remonta a árvore ao trocar de idioma (todo t() é reavaliado no novo locale).
function Root() {
  const locale = useLocale();
  return <App key={locale} />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
