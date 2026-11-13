/**
 * Finance > Bio-Asset Costing Runs, in two tabs. Calculate: every field on show (no "more options"), nothing on the page until you press Calculate, then one card for each item
 * with what each animal is charged. An amortised item and a fair value item are shown by their own columns. Post only on a calculated run; Reverse lives on the History tab,
 * which lists every run ever made, filtered, and only on a posted run and only with a reason. The screen does no arithmetic of its own.
 */
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import BioCostingRunsPanel from "../src/components/console/finance/bio-costing-runs-panel";
import { api } from "../src/services/api-client";
import { confirmAction } from "../src/components/ui/confirm-dialog";
import { downloadCsvFile } from "../src/modules/master-data/utils/master-csv";
import { chooseOption, optionLabels } from "./support/searchable-select";

jest.mock("../src/services/api-client", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("../src/hooks/useLanguage", () => ({ useLanguage: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars?.runNo ? `${key}:${vars.runNo}` : vars?.month ? `${key}:${vars.month}` : key) }) }));
jest.mock("../src/hooks/useAuth", () => ({ getActiveCompanyId: () => "co-1", getStoredUser: () => ({ userType: "TENANT_ADMIN" }), hasPermission: () => true }));
jest.mock("../src/modules/master-data/utils/master-csv", () => ({ ...jest.requireActual("../src/modules/master-data/utils/master-csv"), downloadCsvFile: jest.fn() }));
jest.mock("../src/components/ui/confirm-dialog", () => ({ confirmAction: jest.fn() }));
jest.mock("../src/components/ui/toast", () => ({ Toast: ({ message }: { message?: string }) => (message ? <div role="alert">{message}</div> : null) }));

// The page opens on last month; the runs below are for that month, whatever today is.
const lastMonth = (() => { const d = new Date(); const l = new Date(d.getFullYear(), d.getMonth() - 1, 1); return `${l.getFullYear()}-${String(l.getMonth() + 1).padStart(2, "0")}`; })();
const [Y, M] = lastMonth.split("-").map(Number);
const start = `${lastMonth}-01`;
const end = new Date(Date.UTC(Y, M, 0)).toISOString().slice(0, 10);

const lines = [
  { line_id: "l1", animal_code: "DLNA8228", status: "CHARGED", skip_reason: null, days: "30.0000", remaining_days: 38, book_value_before: "411.5500", residual: "307.5000", charge: "82.1447", book_value_after: "329.4053" },
  { line_id: "l2", animal_code: "NB0552", status: "SKIPPED", skip_reason: "RESIDUAL_EXCEEDS_COST", days: null, remaining_days: null, book_value_before: "300.0000", residual: "307.5000", charge: "0.0000", book_value_after: "300.0000" },
];
const fairLines = [
  { line_id: "f1", animal_code: "PF-SOW-08", status: "CHARGED", skip_reason: null, days: null, remaining_days: null, book_value_before: "662.1700", residual: "0.0000", charge: "-354.6700", book_value_after: "307.5000" },
  { line_id: "f2", animal_code: "PF-SOW-09", status: "CHARGED", skip_reason: null, days: null, remaining_days: null, book_value_before: "307.5000", residual: "0.0000", charge: "45.0000", book_value_after: "352.5000" },
  { line_id: "f3", animal_code: "PF-SOW-10", status: "SKIPPED", skip_reason: "NO_CHANGE", days: null, remaining_days: null, book_value_before: "352.5000", residual: "0.0000", charge: "0.0000", book_value_after: "352.5000" },
];
const run = (status: string, extra: object = {}) => ({
  run_id: "r1", run_no: "BCR-2026-00001", subject_code: "IMP-F", subject_name: "Imported female", status, method: "AMORTIZATION", period_key: lastMonth, period_start: start, period_end: end,
  animal_count: 2, charged_count: 1, skipped_count: 1, total_charge: "82.1447", batch_id: null, lines, ...extra,
});
const fairRun = (status: string, extra: object = {}) => run(status, {
  run_id: "r9", run_no: "BCR-2026-00009", subject_code: "LOC-F", subject_name: "Local female", method: "FAIR_VALUE", animal_count: 3, charged_count: 2, skipped_count: 1, total_charge: "-309.6700", lines: fairLines, ...extra,
});
const animal = (extra: object = {}) => ({ animal_id: "a1", animal_code: "PF-SOW-01", rfid_tag: null, gender: "F", status: "ACTIVE", book_value: "1007.6200", total_amortised: "0.0000", bio_acquisition: "850.0000", bio_capitalised: "157.6200", bio_fair_value_adjusted: "0.0000", residual_effective: 307.5, costing_method: "AMORTIZATION", costing_item_code: "GP-Imp-F", costing_start_date: "2025-04-07", dob: "2024-08-19", ...extra });

const withRuns = (list: object[], extra: Record<string, unknown> = {}) => (api.get as jest.Mock).mockImplementation(async (url: string) => {
  if (url.includes("/runs/due")) return { data: extra.due ?? [] };
  const one = list.find((r: any) => url.endsWith(`/runs/${r.run_id}`));
  if (one) return { data: one };
  if (url.includes("/runs")) return { data: list.map((r: any) => ({ ...r, lines: undefined })) };
  if (url.includes("/batch?")) return { data: [{ batch_id: "b1", batch_no: "BATCH-000001", tracking_mode: "ANIMAL_WISE", remarks: "REG" }] };
  if (url.includes("/animal?")) return { data: [animal(), animal({ animal_id: "a2", animal_code: "PF-SOW-08", costing_method: "FAIR_VALUE" })] };
  if (url.endsWith("/bio-asset-ledger")) return { data: extra.ledger ?? [] };
  if (url.endsWith("/animal/a1")) return { data: animal() };
  if (url.endsWith("/animal/a2")) return { data: animal({ animal_id: "a2", animal_code: "PF-SOW-08", costing_method: "FAIR_VALUE", costing_item_code: "GP-Loc-F", book_value: "352.5000", bio_acquisition: "520.0000", bio_capitalised: "142.1700", bio_fair_value_adjusted: "-309.6700" }) };
  return { data: [] };
});
const calculated = (...runs: object[]) => ({ data: { runs, failed: [] } });
const press = async () => fireEvent.click(await screen.findByRole("button", { name: /bcrCalculate/ }));

describe("BioCostingRunsPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    withRuns([]);
  });

  it("opens on the Calculate tab with every field on show and nothing hidden behind a click", async () => {
    render(<BioCostingRunsPanel />);
    const month = (await screen.findByLabelText("bcrPeriodDate")) as HTMLInputElement;
    expect(month.type).toBe("month");
    expect(month.value).toBe(lastMonth);
    const select = await screen.findByLabelText("bcrBatch");
    await waitFor(() => expect(optionLabels(select)).toHaveLength(2));
    expect(optionLabels(select)[0]).toBe("bcrAllBatches");
    expect(screen.getByLabelText("bcrAnimalPicker")).toBeTruthy();
    expect(screen.getByLabelText("bcrDaysEnforced")).toBeTruthy();
    expect(screen.getByLabelText("bcrDescription")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /bcrShowAdvanced|bcrHideAdvanced|bcrShowWorkings|bcrHideWorkings/ })).toBeNull();
    expect(screen.getByRole("button", { name: /bcrCalculate/ })).toBeTruthy();
    expect(screen.getByText("bcrCalcEmpty")).toBeTruthy();
  });

  it("shows nothing for a month that already has runs until Calculate is pressed", async () => {
    withRuns([run("POSTED")]);
    render(<BioCostingRunsPanel />);
    await screen.findByLabelText("bcrBatch");
    expect(screen.queryByText("Imported female")).toBeNull();
    expect(screen.getByText("bcrCalcEmpty")).toBeTruthy();
  });

  it("calculates for the month's last day, then shows each item's card with the skip said in words and the totals", async () => {
    const second = run("CALCULATED", { run_id: "r2", run_no: "BCR-2026-00002", subject_code: "LOC-M", subject_name: "Local male", total_charge: "10.0000", charged_count: 1, skipped_count: 0, lines: [lines[0]] });
    withRuns([run("CALCULATED"), second]);
    (api.post as jest.Mock).mockResolvedValue(calculated(run("CALCULATED"), second));
    render(<BioCostingRunsPanel />);
    await press();
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/bio-costing/runs/calculate-batch", expect.objectContaining({ period_date: end })));
    expect(await screen.findByText("Imported female")).toBeTruthy();
    expect(await screen.findByText("Local male")).toBeTruthy();
    expect((await screen.findAllByText("DLNA8228")).length).toBe(2);
    expect(screen.getByText("bcrSkip_RESIDUAL_EXCEEDS_COST")).toBeTruthy();
    expect(screen.getByText("bcrPreviewNote")).toBeTruthy();
    expect(screen.getByText("92.14")).toBeTruthy(); // the two totals, added
    // the workings are on show, no click needed
    expect(screen.getAllByText("bcrResidual").length).toBeGreaterThan(0);
    expect(screen.getAllByText("bcrRemainingDays").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /bcrReverse/ })).toBeNull(); // Reverse is on History
  });

  it("shows a fair value item by its own columns: book value, fair value, gain or loss; no residual or days", async () => {
    withRuns([fairRun("CALCULATED")]);
    (api.post as jest.Mock).mockResolvedValue(calculated(fairRun("CALCULATED")));
    render(<BioCostingRunsPanel />);
    await press();
    expect(await screen.findByText("PF-SOW-08")).toBeTruthy();
    expect(screen.getByText("bcrFairValueNew")).toBeTruthy();
    expect(screen.getByText("bcrGainLoss")).toBeTruthy();
    expect(screen.queryByText("bcrResidual")).toBeNull();
    expect(screen.queryByText("bcrRemainingDays")).toBeNull();
    expect(screen.getByText("bcrHowFairValue")).toBeTruthy();
    expect(screen.getByText("-354.67")).toBeTruthy(); // a loss keeps its sign
    expect(screen.getByText("+45.00")).toBeTruthy(); // so does a gain
    expect(screen.getByText("bcrSkip_NO_CHANGE")).toBeTruthy();
    expect(screen.getAllByText("-309.67").length).toBeGreaterThan(0); // the net, in the header and the totals
  });

  it("exports the month just calculated from the Calculate tab", async () => {
    withRuns([run("CALCULATED")]);
    (api.post as jest.Mock).mockResolvedValue(calculated(run("CALCULATED")));
    render(<BioCostingRunsPanel />);
    await press();
    await screen.findByText("Imported female");
    fireEvent.click(screen.getByRole("button", { name: /bcrExportCsv/ }));
    await waitFor(() => expect(downloadCsvFile).toHaveBeenCalledTimes(1));
    expect((downloadCsvFile as jest.Mock).mock.calls[0][0]).toBe(`bio-costing-runs_${lastMonth}.csv`);
  });

  it("shows an amortised and a fair value item together, each with its own method and formula", async () => {
    withRuns([run("CALCULATED"), fairRun("CALCULATED")]);
    (api.post as jest.Mock).mockResolvedValue(calculated(run("CALCULATED"), fairRun("CALCULATED")));
    render(<BioCostingRunsPanel />);
    await press();
    expect(await screen.findByText("bcrHowAmortisation")).toBeTruthy();
    expect(screen.getByText("bcrHowFairValue")).toBeTruthy();
    expect(screen.getAllByText("bcrMethodAmortisation").length).toBeGreaterThan(0);
    expect(screen.getAllByText("bcrMethodFairValue").length).toBeGreaterThan(0);
  });

  it("sends the batch and the enforced days when given", async () => {
    (api.post as jest.Mock).mockResolvedValue(calculated(run("CALCULATED")));
    render(<BioCostingRunsPanel />);
    const select = await screen.findByLabelText("bcrBatch");
    await waitFor(() => expect(optionLabels(select)).toHaveLength(2));
    chooseOption(select, /BATCH-000001/);
    fireEvent.change(screen.getByLabelText("bcrDaysEnforced"), { target: { value: "45" } });
    await press();
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/bio-costing/runs/calculate-batch", expect.objectContaining({ batch_id: "b1", days_enforced: 45 })));
  });

  it("can cost one item only: the item is chosen from the costed items and sent with the calculation", async () => {
    withRuns([], { due: [{ item_id: "i1", item_code: "IMP-F", due_periods: [], blocked: null }, { item_id: "i2", item_code: "LOC-F", due_periods: [], blocked: null }] });
    (api.post as jest.Mock).mockResolvedValue(calculated(run("CALCULATED", { item_id: "i2" })));
    render(<BioCostingRunsPanel />);
    const select = await screen.findByLabelText("bcrItemFilter");
    await waitFor(() => expect(optionLabels(select)).toEqual(["bcrAllItems", "IMP-F", "LOC-F"]));
    chooseOption(select, /LOC-F/);
    await press();
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/bio-costing/runs/calculate-batch", expect.objectContaining({ item_id: "i2" })));
  });

  it("shows only the runs this Calculate made, not other runs already posted for the same month", async () => {
    const other = run("POSTED", { run_id: "r7", run_no: "BCR-2026-00007", subject_code: "OLD-F", subject_name: "Already posted item" });
    withRuns([run("CALCULATED"), other]);
    (api.post as jest.Mock).mockResolvedValue(calculated(run("CALCULATED")));
    render(<BioCostingRunsPanel />);
    await press();
    expect(await screen.findByText("Imported female")).toBeTruthy();
    expect(screen.queryByText("Already posted item")).toBeNull();
  });

  it("puts the page back to nothing calculated when the month is changed", async () => {
    withRuns([run("CALCULATED")]);
    (api.post as jest.Mock).mockResolvedValue(calculated(run("CALCULATED")));
    render(<BioCostingRunsPanel />);
    await press();
    expect(await screen.findByText("Imported female")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("bcrPeriodDate"), { target: { value: "2020-01" } });
    expect(screen.queryByText("Imported female")).toBeNull();
    expect(screen.getByText("bcrCalcEmpty")).toBeTruthy();
  });

  it("posts only after the confirmation, and a posted run offers no Post and no Reverse on this tab", async () => {
    withRuns([run("CALCULATED")]);
    (api.post as jest.Mock).mockImplementation(async (url: string) => {
      if (url.includes("calculate-batch")) return calculated(run("CALCULATED"));
      withRuns([run("POSTED")]);
      return { data: run("POSTED") };
    });
    (confirmAction as jest.Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<BioCostingRunsPanel />);
    await press();
    const post = await screen.findByRole("button", { name: /^bcrPost$/ });
    fireEvent.click(post); // declined
    await waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledTimes(1); // only the calculate
    fireEvent.click(post); // confirmed
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/bio-costing/runs/r1/post", {}));
    await waitFor(() => expect(screen.queryByRole("button", { name: /^bcrPost$/ })).toBeNull());
    expect(screen.queryByRole("button", { name: /bcrReverse/ })).toBeNull();
  });

  it("posts all the month's calculated runs with one button, and says which item could not be posted", async () => {
    const second = run("CALCULATED", { run_id: "r2", run_no: "BCR-2026-00002", subject_code: "LOC-F", subject_name: "Local female" });
    withRuns([run("CALCULATED"), second]);
    (confirmAction as jest.Mock).mockResolvedValue(true);
    (api.post as jest.Mock).mockImplementation(async (url: string) => {
      if (url.includes("calculate-batch")) return calculated(run("CALCULATED"), second);
      if (url.includes("/r2/")) throw new Error("closed period");
      return { data: {} };
    });
    render(<BioCostingRunsPanel />);
    await press();
    fireEvent.click(await screen.findByRole("button", { name: /bcrPostAll/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/bio-costing/runs/r1/post", {}));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/bio-costing/runs/r2/post", {}));
    expect(await screen.findByText(/LOC-F: closed period/)).toBeTruthy();
  });

  it("shows the API's refusal in words instead of failing silently", async () => {
    (api.post as jest.Mock).mockRejectedValue(new Error("Period 2026-10 ends on 2026-10-31, which has not happened yet."));
    render(<BioCostingRunsPanel />);
    await press();
    expect(await screen.findByText(/has not happened yet/)).toBeTruthy();
  });

  describe("the animal card", () => {
    const pick = async (code: RegExp) => {
      const batch = await screen.findByLabelText("bcrBatch");
      await waitFor(() => expect(optionLabels(batch)).toHaveLength(2));
      expect((screen.getByLabelText("bcrAnimalPicker") as HTMLButtonElement).disabled).toBe(true); // a batch first
      chooseOption(batch, /BATCH-000001/);
      const animalSelect = screen.getByLabelText("bcrAnimalPicker");
      await waitFor(() => expect((animalSelect as HTMLButtonElement).disabled).toBe(false));
      await waitFor(() => expect(optionLabels(animalSelect).length).toBe(3));
      chooseOption(animalSelect, code);
    };

    it("shows an amortised animal's cost, residual, amortised and progress", async () => {
      render(<BioCostingRunsPanel />);
      await pick(/PF-SOW-01/);
      expect(await screen.findByText("bcrAmortisationProgress")).toBeTruthy();
      expect(screen.getByText("bcrResidualFloor")).toBeTruthy();
      expect(screen.getByText("bcrTotalAmortised")).toBeTruthy();
      expect(screen.getByText("bcrMethodAmortisation")).toBeTruthy();
      expect(screen.queryByText("bcrFairValueHelp")).toBeNull();
    });

    it("pages the animal's ledger, and a later page keeps the running balance of every posting before it", async () => {
      const ledger = Array.from({ length: 30 }, (_, i) => ({ entry_id: `e${i}`, posting_date: `2025-01-${String(i + 1).padStart(2, "0")}`, event: "CONSUMPTION", document_no: "BATCH-000001", cost_amount: "10.0000" }));
      withRuns([], { ledger });
      render(<BioCostingRunsPanel />);
      await pick(/PF-SOW-01/);
      await screen.findByText("bcrAmortisationProgress");
      expect(screen.getAllByText("BATCH-000001")).toHaveLength(25);
      expect(screen.getByText("250.00")).toBeTruthy(); // the 25th posting's balance
      fireEvent.click(screen.getByRole("button", { name: /next/i }));
      await waitFor(() => expect(screen.getAllByText("BATCH-000001")).toHaveLength(5));
      expect(screen.getByText("300.00")).toBeTruthy(); // not 50: the balance carries over from page 1
    });

    it("shows what moved to a litter, so the card's figures add up to the book value", async () => {
      (api.get as jest.Mock);
      withRuns([], { ledger: [] });
      const base = (api.get as jest.Mock).getMockImplementation()!;
      (api.get as jest.Mock).mockImplementation(async (url: string) => (url.endsWith("/animal/a1")
        ? { data: animal({ total_amortised: "416.8220", bio_capitalised: "157.6172", bio_exits: "-31.7780", book_value: "559.0172" }) }
        : base(url)));
      render(<BioCostingRunsPanel />);
      await pick(/PF-SOW-01/);
      expect(await screen.findByText("bcrExits")).toBeTruthy();
      expect(screen.getByText("-31.78")).toBeTruthy();
    });

    it("shows a fair value animal's cost and fair value result, with no residual or amortisation", async () => {
      render(<BioCostingRunsPanel />);
      await pick(/PF-SOW-08/);
      expect(await screen.findByText("bcrFairValueHelp")).toBeTruthy();
      expect(screen.getByText("bcrFairValueAdjusted")).toBeTruthy();
      expect(screen.getByText("-309.67")).toBeTruthy();
      expect(screen.getByText("bcrMethodFairValue")).toBeTruthy();
      expect(screen.queryByText("bcrResidualFloor")).toBeNull();
      expect(screen.queryByText("bcrTotalAmortised")).toBeNull();
      expect(screen.queryByText("bcrAmortisationProgress")).toBeNull();
    });
  });

  describe("History", () => {
    const openHistory = async () => {
      render(<BioCostingRunsPanel />);
      fireEvent.click(await screen.findByRole("tab", { name: "bcrTabHistory" }));
    };

    it("lists every run of every status and month, separate from the calculation", async () => {
      withRuns([run("POSTED"), fairRun("REVERSED", { period_key: "2026-01", period_start: "2026-01-01", period_end: "2026-01-31" })]);
      await openHistory();
      expect(await screen.findByText("BCR-2026-00001")).toBeTruthy();
      expect(screen.getByText("BCR-2026-00009")).toBeTruthy();
      expect(screen.queryByLabelText("bcrDaysEnforced")).toBeNull(); // the calculation form is not here
    });

    it("filters by method and by status", async () => {
      withRuns([run("POSTED"), fairRun("POSTED")]);
      await openHistory();
      await screen.findByText("BCR-2026-00001");
      chooseOption(screen.getByLabelText("bcrFilterMethod"), /bcrMethodFairValue/);
      expect(screen.queryByText("BCR-2026-00001")).toBeNull();
      expect(screen.getByText("BCR-2026-00009")).toBeTruthy();
      chooseOption(screen.getByLabelText("bcrFilterStatus"), /bcrStatus_REVERSED/);
      expect(screen.getByText("bcrHistoryEmpty")).toBeTruthy();
    });

    it("pages the list: 25 rows to a page, the next page holds the rest, and a new filter goes back to page 1", async () => {
      const many = Array.from({ length: 30 }, (_, i) => run("POSTED", { run_id: `r${i}`, run_no: `BCR-2026-${String(i + 1).padStart(5, "0")}`, method: i === 29 ? "FAIR_VALUE" : "AMORTIZATION" }));
      withRuns(many);
      await openHistory();
      await screen.findAllByText(/BCR-2026-000/);
      expect(screen.getAllByRole("button", { name: "bcrShowAnimals" })).toHaveLength(25);
      fireEvent.click(screen.getByRole("button", { name: /next/i }));
      await waitFor(() => expect(screen.getAllByRole("button", { name: "bcrShowAnimals" })).toHaveLength(5));
      chooseOption(screen.getByLabelText("bcrFilterMethod"), /bcrMethodFairValue/);
      await waitFor(() => expect(screen.getAllByRole("button", { name: "bcrShowAnimals" })).toHaveLength(1));
    });

    it("exports every listed run's animals as a CSV for reconciliation, reading the lines it does not have yet", async () => {
      withRuns([run("POSTED", { journal_id: "j-1" }), fairRun("POSTED")]);
      await openHistory();
      await screen.findByText("BCR-2026-00001");
      fireEvent.click(screen.getByRole("button", { name: /bcrExportCsv/ }));
      await waitFor(() => expect(downloadCsvFile).toHaveBeenCalledTimes(1));
      const [name, csv] = (downloadCsvFile as jest.Mock).mock.calls[0];
      expect(name).toBe("bio-costing-runs_all.csv");
      const rows = String(csv).split("\r\n");
      expect(rows[0]).toContain("Run no,Period,");
      expect(rows).toHaveLength(1 + 2 + 3); // the header, the amortised run's two animals, the fair value run's three
      const amortised = rows.find((r) => r.includes("DLNA8228"))!;
      expect(amortised).toContain("BCR-2026-00001");
      expect(amortised).toContain("82.1447");
      expect(amortised).toContain("j-1"); // the journal the run posted, to tie it to the ledger
      expect(rows.some((r) => r.includes("PF-SOW-08") && r.includes("-354.6700"))).toBe(true);
    });

    it("exports only what the filters leave", async () => {
      withRuns([run("POSTED"), fairRun("POSTED")]);
      await openHistory();
      await screen.findByText("BCR-2026-00001");
      chooseOption(screen.getByLabelText("bcrFilterMethod"), /bcrMethodFairValue/);
      fireEvent.click(screen.getByRole("button", { name: /bcrExportCsv/ }));
      await waitFor(() => expect(downloadCsvFile).toHaveBeenCalledTimes(1));
      const csv = String((downloadCsvFile as jest.Mock).mock.calls[0][1]);
      expect(csv).toContain("BCR-2026-00009");
      expect(csv).not.toContain("BCR-2026-00001");
    });

    it("opens a run to show its animals in the columns of its method", async () => {
      withRuns([fairRun("POSTED")]);
      await openHistory();
      fireEvent.click(await screen.findByRole("button", { name: "bcrShowAnimals" }));
      expect(await screen.findByText("PF-SOW-08")).toBeTruthy();
      expect(screen.getByText("bcrGainLoss")).toBeTruthy();
    });

    it("will not reverse without a reason, and sends it when given", async () => {
      withRuns([run("POSTED")]);
      (api.post as jest.Mock).mockResolvedValue({ data: run("REVERSED", { reverse_reason: "typo" }) });
      await openHistory();
      fireEvent.click(await screen.findByRole("button", { name: /^bcrReverse$/ }));
      const dialogButton = (await screen.findAllByRole("button", { name: /bcrReverse/ })).pop()!;
      expect((dialogButton as HTMLButtonElement).disabled).toBe(true);
      fireEvent.change(screen.getByLabelText("bcrReason"), { target: { value: "typo" } });
      expect((dialogButton as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(dialogButton);
      await waitFor(() => expect(api.post).toHaveBeenCalledWith("/bio-costing/runs/r1/reverse", { reason: "typo" }));
    });
  });

  describe("other months that need attention", () => {
    const due = [
      { item_id: "i1", item_code: "IMP-F", auto_post: false, due_periods: ["2026-01", "2026-02"], blocked: null },
      { item_id: "i3", item_code: "LOC-F", auto_post: false, due_periods: [], blocked: { reason: "WAITING_TO_POST", run_no: "BCR-2026-00007", period_key: "2026-03" } },
      { item_id: "i4", item_code: "LOC-M", auto_post: false, due_periods: [], blocked: { reason: "TOO_MANY_FAILURES", period_key: "2026-04", attempts: 3, error: "closed" } },
    ];

    it("lists what is due, waiting to be posted or failing for other months, each with a button to open that month", async () => {
      withRuns([], { due });
      render(<BioCostingRunsPanel />);
      const notice = await screen.findByRole("status", { name: "bcrOtherMonths" });
      expect(within(notice).getByText("bcrDueChip")).toBeTruthy();
      expect(within(notice).getByText("bcrWaitingChip")).toBeTruthy();
      expect(within(notice).getByText("bcrFailedRepeatedly")).toBeTruthy();
      fireEvent.click(within(notice).getAllByRole("button", { name: /bcrOpenMonth/ })[1]); // the run waiting since March
      expect((screen.getByLabelText("bcrPeriodDate") as HTMLInputElement).value).toBe("2026-03");
    });

    it("says nothing about the month on screen, and shows no notice when nothing is owed", async () => {
      withRuns([], { due: [{ item_id: "i1", item_code: "IMP-F", auto_post: false, due_periods: [lastMonth], blocked: null }] });
      render(<BioCostingRunsPanel />);
      await screen.findByLabelText("bcrBatch");
      expect(screen.queryByRole("status", { name: "bcrOtherMonths" })).toBeNull();
    });

    it("runs what is due on the button, and reports a failure in words", async () => {
      withRuns([], { due });
      (api.post as jest.Mock).mockResolvedValue({ data: [{ item_code: "IMP-F", outcome: "FAILED", period_key: "2026-08", error: "Reporting period is closed." }] });
      render(<BioCostingRunsPanel />);
      fireEvent.click(await screen.findByRole("button", { name: "bcrRunDue" }));
      await waitFor(() => expect(api.post).toHaveBeenCalledWith("/bio-costing/runs/run-due", {}));
      expect(await screen.findByText(/IMP-F 2026-08: Reporting period is closed/)).toBeTruthy();
    });
  });
});
