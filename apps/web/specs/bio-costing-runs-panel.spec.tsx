/**
 * Bio-asset costing, Phase 4: Finance > Bio-Asset Costing Runs. The screen shows what the API answers: the calculated lines with
 * each skip said in words, Post only on a calculated run, Reverse only on a posted one and only with a reason. It does no
 * arithmetic of its own.
 */
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import BioCostingRunsPanel from "../src/components/console/finance/bio-costing-runs-panel";
import { api } from "../src/services/api-client";
import { confirmAction } from "../src/components/ui/confirm-dialog";

jest.mock("../src/services/api-client", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("../src/hooks/useLanguage", () => ({ useLanguage: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars?.runNo ? `${key}:${vars.runNo}` : key) }) }));
jest.mock("../src/hooks/useAuth", () => ({ getActiveCompanyId: () => "co-1", getStoredUser: () => ({ userType: "TENANT_ADMIN" }), hasPermission: () => true }));
jest.mock("../src/components/ui/confirm-dialog", () => ({ confirmAction: jest.fn() }));
jest.mock("../src/components/ui/toast", () => ({ Toast: ({ message }: { message?: string }) => (message ? <div role="alert">{message}</div> : null) }));

const profile = { profile_id: "p1", profile_code: "IMP-F", name: "Imported female", status: "ACTIVE", costing_method: "AMORTIZATION", run_frequency: "MONTHLY" };
const lines = [
  { line_id: "l1", animal_code: "DLNA8228", status: "CHARGED", skip_reason: null, days: "30.0000", remaining_days: 38, book_value_before: "411.5500", residual: "307.5000", charge: "82.1447", book_value_after: "329.4053" },
  { line_id: "l2", animal_code: "NB0552", status: "SKIPPED", skip_reason: "RESIDUAL_EXCEEDS_COST", days: null, remaining_days: null, book_value_before: "300.0000", residual: "307.5000", charge: "0.0000", book_value_after: "300.0000" },
];
const run = (status: string, extra: object = {}) => ({
  run_id: "r1", run_no: "BCR-2026-00001", status, method: "AMORTIZATION", period_key: "2026-09", period_start: "2026-09-01", period_end: "2026-09-30",
  animal_count: 2, charged_count: 1, skipped_count: 1, total_charge: "82.1447", lines, ...extra,
});

describe("BioCostingRunsPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (api.get as jest.Mock).mockImplementation(async (url: string) => ({
      data: url.includes("/profiles") ? [profile] : url.includes("/batch?") ? [{ batch_id: "b1", batch_no: "BATCH-000001", tracking_mode: "ANIMAL_WISE", remarks: "REG" }] : [],
    }));
  });
  const calculated = (...runs: object[]) => ({ data: { runs, failed: [] } });

  describe("the due notice", () => {
    const dueLines = [
      { profile_id: "p1", profile_code: "IMP-F", auto_post: false, due_periods: ["2026-08", "2026-09"], blocked: null },
      { profile_id: "p3", profile_code: "LOC-F", auto_post: false, due_periods: [], blocked: { reason: "WAITING_TO_POST", run_no: "BCR-2026-00007", period_key: "2026-09" } },
      { profile_id: "p4", profile_code: "LOC-M", auto_post: false, due_periods: [], blocked: { reason: "TOO_MANY_FAILURES", period_key: "2026-08", attempts: 3, error: "closed" } },
    ];
    const withDue = (extra: Record<string, unknown> = {}) => (api.get as jest.Mock).mockImplementation(async (url: string) => ({
      data: url.includes("/runs/due") ? dueLines : url.includes("/profiles") ? [profile] : url.includes("/runs") ? [{ ...run("CALCULATED"), run_id: "r7", run_no: "BCR-2026-00007", ...extra }] : [],
    }));

    it("says what is due, what waits to be posted and what keeps failing, with no notice when nothing is owed", async () => {
      withDue();
      render(<BioCostingRunsPanel />);
      const notice = await screen.findByRole("status", { name: "bcrDueHeading" });
      expect(within(notice).getByText("bcrDuePeriods")).toBeTruthy();
      expect(within(notice).getByText(/bcrWaiting/)).toBeTruthy(); // the test t() appends the run number it was given
      expect(within(notice).getByText("bcrFailedRepeatedly")).toBeTruthy();
    });

    it("shows no notice when nothing is due", async () => {
      render(<BioCostingRunsPanel />);
      await screen.findByLabelText("bcrBatch");
      expect(screen.queryByRole("status", { name: "bcrDueHeading" })).toBeNull();
    });

    it("runs what is due on the button, and reports a failure in words", async () => {
      withDue();
      (api.post as jest.Mock).mockResolvedValue({ data: [{ profile_code: "IMP-F", outcome: "FAILED", period_key: "2026-08", error: "Reporting period is closed." }] });
      render(<BioCostingRunsPanel />);
      fireEvent.click(await screen.findByRole("button", { name: "bcrRunDue" }));
      await waitFor(() => expect(api.post).toHaveBeenCalledWith("/bio-costing/runs/run-due", {}));
      expect(await screen.findByText(/IMP-F 2026-08: Reporting period is closed/)).toBeTruthy();
    });
  });

  it("picks a batch (or every batch) rather than a profile, and says what a run will cover", async () => {
    render(<BioCostingRunsPanel />);
    const select = (await screen.findByLabelText("bcrBatch")) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(2));
    expect(select.options[0].textContent).toBe("bcrAllBatches");
    expect(select.options[1].textContent).toContain("BATCH-000001");
    expect(screen.getByText("bcrBatchHint")).toBeTruthy();
    expect(screen.queryByLabelText("bcrProfile")).toBeNull();
  });

  it("calculates, then shows each animal with a skip said in words and the totals", async () => {
    (api.post as jest.Mock).mockResolvedValue(calculated(run("CALCULATED")));
    render(<BioCostingRunsPanel />);
    const select = (await screen.findByLabelText("bcrBatch")) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(2));
    fireEvent.change(select, { target: { value: "b1" } });
    fireEvent.click(screen.getByRole("button", { name: /bcrCalculate/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/bio-costing/runs/calculate-batch", expect.objectContaining({ batch_id: "b1", period_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })));
    const table = (await screen.findByText("DLNA8228")).closest("table")!;
    expect(within(table).getByText("411.55")).toBeTruthy();
    expect(within(table).getByText("82.14")).toBeTruthy();
    expect(within(table).getAllByText("bcrSkip_RESIDUAL_EXCEEDS_COST").length).toBeGreaterThan(0);
    expect(screen.getByText("bcrStatus_CALCULATED")).toBeTruthy();
    expect(screen.getByText("bcrPreviewNote")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /bcrReverse/ })).toBeNull();
  });

  it("sends the enforced days when given", async () => {
    (api.post as jest.Mock).mockResolvedValue(calculated(run("CALCULATED")));
    render(<BioCostingRunsPanel />);
    await screen.findByLabelText("bcrBatch");
    fireEvent.change(screen.getByLabelText("bcrDaysEnforced"), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: /bcrCalculate/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/bio-costing/runs/calculate-batch", expect.objectContaining({ days_enforced: 45 })));
  });

  it("posts only after the confirmation, and then offers Reverse instead of Post", async () => {
    (api.post as jest.Mock).mockResolvedValueOnce(calculated(run("CALCULATED"))).mockResolvedValueOnce({ data: run("POSTED") });
    (confirmAction as jest.Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<BioCostingRunsPanel />);
    await screen.findByLabelText("bcrBatch");
    fireEvent.click(screen.getByRole("button", { name: /bcrCalculate/ }));
    const post = await screen.findByRole("button", { name: /bcrPost$/ });
    fireEvent.click(post);                                  // declined
    await waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledTimes(1);
    fireEvent.click(post);                                  // confirmed
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/bio-costing/runs/r1/post", {}));
    expect(await screen.findByRole("button", { name: /bcrReverse/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /bcrPost$/ })).toBeNull();
  });

  it("will not reverse without a reason, and sends it when given", async () => {
    (api.get as jest.Mock).mockImplementation(async (url: string) => ({ data: url.includes("/profiles") ? [profile] : url.endsWith("/r1") ? run("POSTED") : [run("POSTED")] }));
    (api.post as jest.Mock).mockResolvedValue({ data: run("REVERSED", { reverse_reason: "typo" }) });
    render(<BioCostingRunsPanel />);
    fireEvent.click(await screen.findByText("BCR-2026-00001"));
    fireEvent.click(await screen.findByRole("button", { name: /^bcrReverse$/ }));
    const dialogButton = (await screen.findAllByRole("button", { name: /bcrReverse/ })).pop()!;
    expect((dialogButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("bcrReason"), { target: { value: "typo" } });
    expect((dialogButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(dialogButton);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/bio-costing/runs/r1/reverse", { reason: "typo" }));
  });

  it("shows the API's refusal in words instead of failing silently", async () => {
    (api.post as jest.Mock).mockRejectedValue(new Error("Period 2026-10 ends on 2026-10-31, which has not happened yet."));
    render(<BioCostingRunsPanel />);
    await screen.findByLabelText("bcrBatch");
    fireEvent.click(screen.getByRole("button", { name: /bcrCalculate/ }));
    expect(await screen.findByText(/has not happened yet/)).toBeTruthy();
  });

  it("makes one run for each profile in a batch, shows the first, offers to post them together, and says which profile could not be run", async () => {
    const second = { ...run("CALCULATED"), run_id: "r2", run_no: "BCR-2026-00002", profile_id: "p2", batch_id: "b1" };
    const first = { ...run("CALCULATED"), batch_id: "b1" };
    (api.get as jest.Mock).mockImplementation(async (url: string) => ({
      data: url.includes("/profiles") ? [profile, { ...profile, profile_id: "p2", profile_code: "LOC-F" }]
        : url.includes("/batch?") ? [{ batch_id: "b1", batch_no: "BATCH-000001", tracking_mode: "ANIMAL_WISE" }]
        : url.includes("/runs") ? [first, second] : [],
    }));
    (api.post as jest.Mock).mockResolvedValueOnce({ data: { runs: [first, second], failed: [{ profile_code: "LOC-M", error: "already run" }] } }).mockResolvedValue({ data: run("POSTED") });
    (confirmAction as jest.Mock).mockResolvedValue(true);
    render(<BioCostingRunsPanel />);
    const select = (await screen.findByLabelText("bcrBatch")) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(2));
    fireEvent.change(select, { target: { value: "b1" } });
    fireEvent.click(screen.getByRole("button", { name: /bcrCalculate/ }));
    expect(await screen.findByText(/LOC-M: already run/)).toBeTruthy();
    const postAll = await screen.findByRole("button", { name: /bcrPostAll/ });
    fireEvent.click(postAll);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/bio-costing/runs/r1/post", {}));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/bio-costing/runs/r2/post", {}));
  });
});
