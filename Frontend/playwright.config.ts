import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",

  fullyParallel: false,

  timeout: 45_000,

  expect: {
    timeout: 10_000,
  },

  forbidOnly: !!process.env.CI,

  retries: process.env.CI ? 2 : 0,

  workers: 1,

  reporter: [
    ["list"],
    [
      "html",
      {
        outputFolder: "playwright-report",
        open: "never",
      },
    ],
  ],

  use: {
    baseURL:
      process.env.PLAYWRIGHT_BASE_URL ||
      "https://umhlomunye-finance2.umhlomunyeb.workers.dev",

    trace: "retain-on-failure",

    screenshot: "only-on-failure",

    video: "retain-on-failure",

    headless: true,
  },

  projects: [
    {
      name: "setup",

      testMatch: /auth\.setup\.m?js$/,
    },

    {
      name: "chromium",

      testMatch: /.*\.spec\.m?js$/,

      testIgnore: /.*\.public\.spec\.m?js$/,

      use: {
        ...devices["Desktop Chrome"],

        storageState: "tests/.auth/user.json",
      },

      dependencies: ["setup"],
    },

    {
      name: "public",

      testMatch: /.*\.public\.spec\.m?js$/,

      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
});