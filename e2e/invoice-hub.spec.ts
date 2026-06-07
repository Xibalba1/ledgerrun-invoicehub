import { expect, test, type Page } from "@playwright/test";

const reference = {
  sponsors: [{ id: 1, name: "Northwind Pharma", code: "NWD" }],
  studies: [
    {
      id: 1,
      sponsor_id: 1,
      name: "LUMIN-2024",
      protocol_number: "NWD-LUM-2024-001",
      phase: "Phase III",
      therapeutic_area: "Oncology",
    },
  ],
  sites: [
    {
      id: 2,
      name: "Harborview Medical Institute",
      city: "Chicago",
      state: "IL",
      country: "USA",
      pi_name: "Dr. Jordan Blake",
    },
  ],
};

const heldInvoice = {
  id: "e2e-held",
  created_at: "2026-06-07T12:00:00.000Z",
  source: { kind: "pdf", filename: "invoice.pdf", email: null },
  status: "held",
  stage: "done",
  extracted: {
    metadata: {
      invoice_number: "DG-E2E-001",
      invoice_date: "2026-06-01",
      sponsor_name: "Northwind Pharma",
      study_name: "LUMIN-2024",
      protocol_number: "NWD-LUM-2024-001",
      site_name: "Harborview Medical Institute",
      pi_name: null,
      total_amount: 550,
    },
    line_items: [{ description: "IRB Submission and Maintenance", quantity: 1, unit_price: 550, amount: 550 }],
  },
  resolved: {
    sponsor: { match: reference.sponsors[0], confidence: 1, alternatives: [] },
    study: { match: reference.studies[0], confidence: 1, alternatives: [], protocol_match: true },
    site: { match: reference.sites[0], confidence: 1, alternatives: [] },
  },
  matches: [
    {
      line: { description: "IRB Submission and Maintenance", quantity: 1, unit_price: 550, amount: 550 },
      catalog_item: {
        id: 27,
        sponsor_id: 1,
        study_id: 1,
        item_code: "ADMIN-IRB",
        description: "IRB Submission and Maintenance",
        category: "administrative",
        unit_price: 500,
      },
      confidence: 0.97,
      reason: "Matched IRB maintenance.",
      price_delta: 50,
      status: "price_mismatch",
    },
  ],
  decision: {
    decision: "hold",
    rationale: "Held for QC: price_mismatch.",
    exceptions: [
      {
        code: "price_mismatch",
        severity: "block",
        message: '"IRB Submission and Maintenance" billed $550.00 vs catalog $500.00.',
      },
    ],
  },
  escalated: false,
  submitted_by: null,
  error: null,
  qc_actions: [],
  timings: { extract: 10, reference: 10, resolve: 10, catalog: 10, match: 10, decision: 10 },
};

async function mockApi(page: Page) {
  let invoices: typeof heldInvoice[] = [];
  await page.route("**/api/stream", (route) => route.fulfill({ status: 503, body: "stream disabled in e2e" }));
  await page.route("**/api/health", (route) => route.fulfill({ json: { ok: true, llm: false } }));
  await page.route("**/api/reference", (route) => route.fulfill({ json: reference }));
  await page.route("**/api/catalog**", (route) => route.fulfill({ json: [heldInvoice.matches[0].catalog_item] }));
  await page.route("**/api/invoices", (route) => route.fulfill({ json: invoices }));
  await page.route("**/api/demo/seed", (route) => {
    invoices = [structuredClone(heldInvoice)];
    return route.fulfill({ status: 202, json: { ids: invoices.map((i) => i.id) } });
  });
  await page.route("**/api/demo/reset", (route) => {
    invoices = [];
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/invoices/*/actions", async (route) => {
    const body = route.request().postDataJSON() as { type: string; reason?: string };
    const current = invoices[0]!;
    if (body.type === "submit") {
      invoices = [{ ...current, status: "submitted", submitted_by: "human" }];
    } else if (body.type === "escalate") {
      invoices = [
        {
          ...current,
          escalated: true,
          qc_actions: [
            ...current.qc_actions,
            { id: "qc-1", at: "2026-06-07T12:01:00.000Z", type: "escalate", by: "reviewer", detail: body.reason ?? "" },
          ],
        },
      ];
    } else if (body.type === "rerun") {
      invoices = [{ ...current, status: "processing", stage: "extracting" }];
    }
    return route.fulfill({ json: invoices[0] });
  });
}

test.describe("invoice hub", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
  });

  test("seeds the demo queue and manually submits a held invoice", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /process the 4 sample invoices/i })).toBeVisible();

    await page.getByRole("button", { name: /process the 4 sample invoices/i }).click();
    await expect(page.getByText("Invoice Review Queue")).toBeVisible();
    await expect(page.getByRole("button", { name: /DG-E2E-001/ })).toBeVisible();
    await expect(page.getByText("Held for your review")).toBeVisible();

    await page.getByRole("button", { name: /submit anyway/i }).click({ force: true });
    await expect(page.getByText("Submitted to ClinRun")).toBeVisible({ timeout: 5_000 });
  });

  test("captures an escalation reason and moves the invoice into escalated state", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /process the 4 sample invoices/i }).click();
    await expect(page.getByRole("button", { name: /DG-E2E-001/ })).toBeVisible();

    await page.getByRole("button", { name: /^escalate$/i }).first().click({ force: true });
    await expect(page.getByText("Escalate this invoice")).toBeVisible();
    await page.getByPlaceholder("Why can't this be resolved here?").fill("Contract amendment needed.");
    await page.getByRole("button", { name: /^escalate$/i }).last().click();

    await expect(page.getByText("Escalated · awaiting external resolution")).toBeVisible({ timeout: 5_000 });
  });
});
