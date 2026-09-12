import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initTheme } from "./utils/theme";
import "./styles/legacy-ui.css";
import "./styles/admin-ui.css";
import "./styles/dark-mode.css";

initTheme();


ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

