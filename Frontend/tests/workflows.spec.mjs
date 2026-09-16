import { test, expect } from "@playwright/test";

test.describe("LMS workflows", () => {
  test("application workflow entry point is available", async ({
    page,
  }) => {
    await page.goto("/applications");

    await expect(page).toHaveURL(
      /\/applications$/
    );

    await expect(
      page.locator("body")
    ).toBeVisible();
  });

  test("loan creation page is reachable", async ({
    page,
  }) => {
    await page.goto("/loans");

    await expect(page).toHaveURL(
      /\/loans$/
    );

    await expect(
      page.locator("body")
    ).toBeVisible();
  });

  test("repayments page is reachable", async ({
    page,
  }) => {
    await page.goto("/repayments");

    await expect(page).toHaveURL(
      /\/repayments$/
    );

    await expect(
      page.locator("body")
    ).toBeVisible();
  });

  test("documents module is reachable", async ({
    page,
  }) => {
    await page.goto("/documents");

    await expect(page).toHaveURL(
      /\/documents$/
    );

    await expect(
      page.locator("body")
    ).toBeVisible();
  });

  test("bank module is reachable", async ({
    page,
  }) => {
    await page.goto("/bank");

    await expect(page).toHaveURL(
      /\/bank$/
    );

    await expect(
      page.locator("body")
    ).toBeVisible();
  });

  test("reports module is reachable", async ({
    page,
  }) => {
    await page.goto("/reports");

    await expect(page).toHaveURL(
      /\/reports$/
    );

    await expect(
      page.locator("body")
    ).toBeVisible();
  });

  test("settings module is reachable", async ({
    page,
  }) => {
    await page.goto("/settings");

    await expect(page).toHaveURL(
      /\/settings$/
    );

    await expect(
      page.locator("body")
    ).toBeVisible();
  });
});