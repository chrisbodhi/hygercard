import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

// Browser-mode tests only: DOM selections need a real layout engine. Chromium
// and WebKit (the closest thing to Safari that Playwright ships).
export default defineConfig({
  plugins: [react()],
  test: {
    include: ["test-browser/**/*.test.{ts,tsx}"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }, { browser: "webkit" }],
    },
  },
});
