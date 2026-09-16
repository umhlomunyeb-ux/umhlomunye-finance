import { test, expect } from "@playwright/test";
import fs from "node:fs";

const authFile = "tests/.auth/user.json";

test("authenticate test user", async ({ page }) => {
  const email = process.env.PLAYWRIGHT_TEST_EMAIL;
  const password = process.env.PLAYWRIGHT_TEST_PASSWORD;

  if (!email || !password) {
    throw new Error(
      [
        "Missing Playwright test credentials.",
        "",
        "Set these environment variables before running the authenticated suite:",
        "PLAYWRIGHT_TEST_EMAIL",
        "PLAYWRIGHT_TEST_PASSWORD",
      ].join("\n")
    );
  }

  fs.mkdirSync("tests/.auth", { recursive: true });

  await page.goto("/login");

  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();

  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);

  await page.getByRole("button", { name: /sign in/i }).click();

  await expect(page).toHaveURL(/\/dashboard$/, {
    timeout: 30_000,
  });

  await page.context().storageState({
    path: authFile,
  });
});