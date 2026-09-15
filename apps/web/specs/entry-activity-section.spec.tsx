import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ActivityCard } from "../src/components/console/production/entry/activity-card";
import { SubCard } from "../src/components/console/production/entry/sub-card";
import type { EntryFormResponse, FormLine } from "../src/components/console/production/entry/types";

jest.mock("../src/hooks/useLanguage", () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
jest.mock("../src/services/api-client", () => ({ api: { post: jest.fn(), put: jest.fn() } }));
jest.mock("../src/lib/api-client", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => "/batches/entry",
  useSearchParams: () => new URLSearchParams(),
}));

import { api } from "../src/services/api-client";
const apiPost = api.post as jest.Mock;

// The api mock is module-level, so call counts would otherwise leak between tests.
beforeEach(() => {
  (api.post as jest.Mock).mockClear();
  (api.put as jest.Mock).mockClear();
});

const line = (over: Partial<FormLine>): FormLine => ({
  line_id: "line-1",
  line_type: "CONSUMPTION",
  activity_name: "Feed",
  is_mandatory: true,
  item_name: null,
  uom: "KG",
  standard_qty: 10,
  qty_basis: null,
  suggested_value: null,
  allow_qty_edit: true,
  lot_required: false,
  kpi_metric: null,
  lower_alert_limit: null,
  upper_alert_limit: null,
  editable: true,
  locked_reason: null,
  entry: null,
  correctable: false,
  ...over,
});

const form = (over: Partial<EntryFormResponse>): EntryFormResponse => ({
  batch: { batch_id: "b1", batch_no: "PIG-BAT-2026-0101", animal_tracking: "REGISTERED", start_date: "2026-09-01" },
  date: "2026-09-15",
  today: "2026-09-15",
  hasScheduler: true,
  mayEditAnyDay: false,
  backlog: [],
  selected_stage_id: "s1",
  stages: [],
  lines: [],
  complete: false,
  activities: [],
  targeting: {
    mode: "REGISTERED",
    default_scope: "STAGE_ANIMALS",
    stage_animals: [
      { animal_id: "a1", animal_code: "PIG-2026-0001", ear_tag: null },
      { animal_id: "a2", animal_code: "PIG-2026-0002", ear_tag: "T2" },
    ],
  },
  ...over,
});

describe("SubCard", () => {
  it("saves a draft through PUT with the row's version and no animal ids when the whole stage is targeted", async () => {
    const onChanged = jest.fn();
    (api.put as jest.Mock).mockResolvedValueOnce({});
    render(<SubCard form={form({})} line={line({})} batchId="b1" onChanged={onChanged} />);

    // The mocked t returns the key, so the aria-label reads "Feed — deValue".
    fireEvent.change(screen.getByLabelText("Feed — deValue"), { target: { value: "12.5" } });
    fireEvent.click(screen.getByRole("button", { name: "deWSaveDraft" }));

    await waitFor(() => expect(api.put).toHaveBeenCalledWith("/batch/b1/daily-data/draft", expect.objectContaining({
      line_id: "line-1",
      entry_date: "2026-09-15",
      entered_value: 12.5,
      target_scope: "STAGE_ANIMALS",
    })));
    expect(api.put).toHaveBeenCalledWith("/batch/b1/daily-data/draft", expect.not.objectContaining({ animal_ids: expect.anything() }));
  });

  it("sends the selection when animals are chosen", async () => {
    (api.put as jest.Mock).mockResolvedValueOnce({});
    render(<SubCard form={form({})} line={line({})} batchId="b1" onChanged={jest.fn()} />);

    fireEvent.click(screen.getByLabelText("deWSelectAnimals"));
    fireEvent.click(screen.getByLabelText(/PIG-2026-0001/));
    fireEvent.click(screen.getByRole("button", { name: "deWSaveDraft" }));

    await waitFor(() => expect(api.put).toHaveBeenCalledWith("/batch/b1/daily-data/draft", expect.objectContaining({
      target_scope: "SELECTED_ANIMALS",
      animal_ids: ["a1"],
    })));
  });

  it("never sends animal_ids on a Count Only batch", async () => {
    (api.put as jest.Mock).mockResolvedValueOnce({});
    render(
      <SubCard
        form={form({ targeting: { mode: "COUNT_ONLY", default_scope: "BATCH", stage_animals: [] } })}
        line={line({})}
        batchId="b1"
        onChanged={jest.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Feed — deValue"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "deWSaveDraft" }));

    await waitFor(() => expect(api.put).toHaveBeenCalledWith("/batch/b1/daily-data/draft", expect.objectContaining({
      target_scope: "BATCH",
    })));
    expect(api.put).toHaveBeenCalledWith("/batch/b1/daily-data/draft", expect.not.objectContaining({ animal_ids: expect.anything() }));
  });

  it("offers Correct only for a correctable POSTED line and sends its version", async () => {
    (api.post as jest.Mock).mockResolvedValueOnce({});
    render(
      <SubCard
        form={form({})}
        line={line({ entry: { entry_id: "e1", status: "POSTED", version: 4, entered_value: 10, entered_text: null, lot_no: null, remarks: null, target_scope: "STAGE_ANIMALS", animal_ids: [], supersedes_entry_id: null }, correctable: true })}
        batchId="b1"
        onChanged={jest.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "deWSaveDraft" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "deWCorrect" }));
    fireEvent.change(screen.getByLabelText("Feed — deValue"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "deWCorrect" }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/batch/b1/daily-data/correct", expect.objectContaining({
      version: 4,
      entered_value: 9,
    })));
  });

  it("does not offer Correct on a posted line the API did not mark correctable", () => {
    render(
      <SubCard
        form={form({})}
        line={line({ entry: { entry_id: "e1", status: "POSTED", version: 1, entered_value: 10, entered_text: null, lot_no: null, remarks: null, target_scope: "STAGE_ANIMALS", animal_ids: [], supersedes_entry_id: null }, correctable: false })}
        batchId="b1"
        onChanged={jest.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "deWCorrect" })).toBeNull();
  });
});

describe("ActivityCard bulk post", () => {
  const group = {
    line_type: "CONSUMPTION" as const,
    state: "IN_PROGRESS" as const,
    required: 2,
    posted: 0,
    drafts: 2,
    line_ids: ["line-1", "line-2"],
  };

  it("posts only valid drafts in one call", async () => {
    apiPost.mockResolvedValueOnce({});
    render(
      <ActivityCard
        group={group}
        form={form({
          lines: [
            line({ line_id: "line-1", entry: { entry_id: "e1", status: "DRAFT", version: 1, entered_value: 5, entered_text: null, lot_no: null, remarks: null, target_scope: "STAGE_ANIMALS", animal_ids: [], supersedes_entry_id: null } }),
            line({ line_id: "line-2", entry: { entry_id: "e2", status: "DRAFT", version: 1, entered_value: 7, entered_text: null, lot_no: null, remarks: null, target_scope: "STAGE_ANIMALS", animal_ids: [], supersedes_entry_id: null } }),
            line({ line_id: "line-3", entry: { entry_id: "e3", status: "DRAFT", version: 1, entered_value: null, entered_text: null, lot_no: null, remarks: null, target_scope: "STAGE_ANIMALS", animal_ids: [], supersedes_entry_id: null } }),
          ],
        })}
        batchId="b1"
        onChanged={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "deWPostCompleted" }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith("/batch/b1/daily-data/post", {
      entry_date: "2026-09-15",
      line_ids: ["line-1", "line-2"],
    }));
  });

  it("leaves everything unchanged and shows the message when the bulk post fails", async () => {
    apiPost.mockRejectedValueOnce(new Error("The second line is invalid."));
    render(
      <ActivityCard
        group={group}
        form={form({
          lines: [
            line({ line_id: "line-1", entry: { entry_id: "e1", status: "DRAFT", version: 1, entered_value: 5, entered_text: null, lot_no: null, remarks: null, target_scope: "STAGE_ANIMALS", animal_ids: [], supersedes_entry_id: null } }),
          ],
        })}
        batchId="b1"
        onChanged={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "deWPostCompleted" }));

    await waitFor(() => expect(screen.getByText("The second line is invalid.")).toBeTruthy());
    expect(apiPost).toHaveBeenCalledTimes(1);
  });
});
