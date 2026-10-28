import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Harness } from "./harness/Harness";
import "./harness/harness.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
