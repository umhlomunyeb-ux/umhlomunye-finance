import { test, expect } from "@playwright/test";

test.describe("Public application", () => {
  test("login page loads", async ({ page }) => {
    await page.goto("/login");

    await expect(
      page.getByRole("textbox", {
        name: /email address/i,
      })
    ).toBeVisible();

    await expect(
      page.getByLabel("Password", { exact: true })
    ).toBeVisible();

    await expect(
      page.getByRole("button", {
        name: /sign in/i,
      })
    ).toBeVisible();
  });

  test("root route loads the login page", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("button", {
        name: /sign in/i,
      })
    ).toBeVisible();
  });

  test("forgot password dialog opens", async ({ page }) => {
    await page.goto("/login");

    await page
      .getByRole("button", {
        name: /forgot password/i,
      })
      .click();

    await expect(
      page.getByRole("dialog")
    ).toBeVisible();

    await expect(
      page.getByRole("heading", {
        name: /reset your password/i,
      })
    ).toBeVisible();
  });

  test("forgot password dialog can be closed", async ({
    page,
  }) => {
    await page.goto("/login");

    await page
      .getByRole("button", {
        name: /forgot password/i,
      })
      .click();

    const dialog = page.getByRole("dialog");

    await expect(dialog).toBeVisible();

    await dialog
      .getByRole("button", {
        name: /cancel/i,
      })
      .click();

    await expect(dialog).not.toBeVisible();
  });

  test("public loan application route loads", async ({
    page,
  }) => {
    await page.goto("/apply");

    await expect(page.locator("body")).toBeVisible();

    await expect(page).toHaveURL(/\/apply$/);
  });

  test("mobile landing route loads", async ({ page }) => {
    await page.goto("/mobile");

    await expect(page.locator("body")).toBeVisible();

    await expect(page).toHaveURL(/\/mobile\/login$/);
  });

  test("mobile preview route loads", async ({ page }) => {
    await page.goto("/mobile/preview");

    await expect(page.locator("body")).toBeVisible();

    await expect(page).toHaveURL(/\/mobile\/preview$/);
  });

  test("protected mobile review redirects when unauthenticated", async ({
    page,
  }) => {
    await page.goto("/mobile/application-review");

    await expect(page).toHaveURL(/\/mobile\/login$/);
  });

  test("protected mobile review detail redirects when unauthenticated", async ({
    page,
  }) => {
    await page.goto("/mobile/application-review/test-id");

    await expect(page).toHaveURL(/\/$/);
  });
});