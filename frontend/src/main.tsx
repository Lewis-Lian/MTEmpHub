import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/legacy-ui.css";
import "./styles/components/app-tabs.css";
import "./styles/components/employee-picker.css";
import "./styles/components/query-table.css";
import "./styles/components/notification.css";
import "./styles/components/confirm-dialog.css";


ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

