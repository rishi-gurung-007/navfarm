import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { CommonRequisitionDocument } from "../src/components/console/requisitions/common-requisition-document";
import { emptyCommonRequisition, emptyLine } from "../src/components/console/requisitions/common-requisition-model";

jest.mock("../src/hooks/useLanguage", () => {
  const stableT = (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t: stableT }) };
});
jest.mock("../src/utils/date-short", () => ({ formatDateShort: (v: string | null) => v ?? "" }));

const options = {
  items: [{ item_id: "i1", item_code: "IT-1", item_name: "Fixture item", uom_primary: "EA" }],
  resources: [], departments: [],
  locations: [{ location_id: "st", location_code: "F1/STORE", location_name: "Store", location_type: "STORE", farm_id: "f1" },
              { location_id: "sh", location_code: "F1/SHED-1", location_name: "Shed", location_type: "SHED", farm_id: "f1" }],
};

describe("CommonRequisitionDocument", () => {
  it("edits the header and a line while Open, filling the item's UOM", () => {
    const onChange = jest.fn();
    const view = emptyCommonRequisition("co-1", "ITEM", "STORE", "2026-10-04");
    render(<CommonRequisitionDocument view={view} editable options={options} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("crqFrom"), { target: { value: "st" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ from_location_id: "st" }));
    fireEvent.change(screen.getByLabelText('crqItemFor:{"line":1}'), { target: { value: "i1" } });
    expect(onChange.mock.lastCall[0].lines[0]).toMatchObject({ item_id: "i1", uom: "EA" });
  });

  it("hides locations and transfer quantities on a Purchase document", () => {
    render(<CommonRequisitionDocument view={emptyCommonRequisition("co-1", "FA", "PURCHASE", "2026-10-04")} editable options={options} onChange={jest.fn()} />);
    expect(screen.queryByLabelText("crqFrom")).toBeNull();
    expect(screen.queryByText("crqColToShip")).toBeNull();
    expect(screen.getByLabelText('crqDescriptionFor:{"line":1}')).toBeTruthy();
  });

  it("is read-only after submission and shows shipped/received with derived balances", () => {
    const view = { ...emptyCommonRequisition("co-1", "ITEM", "STORE", "2026-10-04"), requisition_id: "r", req_no: "REQ-2026-0001",
      approval_status: "APPROVED", document_status: "RELEASED", fulfilment_status: "PARTIALLY_RECEIVED", from_location_code: "F1/STORE",
      lines: [{ line_id: "l1", line_seq: 1, item_id: "i1", item_code: "IT-1", item_name: "Fixture item", resource_id: null, description: null,
        quantity: "10", uom: "EA", est_rate: null, from_location_id: "st", to_location_id: "sh", qty_to_ship: "10", qty_shipped: 6,
        qty_to_receive: "10", qty_received: 4, balance_to_ship: 4, remaining_to_receive: 6 }] };
    render(<CommonRequisitionDocument view={view as any} editable={false} options={options} />);
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.getByText("REQ-2026-0001")).toBeTruthy();
    // header From and the line's From cell both show the code
    expect(screen.getAllByText("F1/STORE").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId("crq-balance-1").textContent).toBe("4");
    expect(screen.getByTestId("crq-remaining-1").textContent).toBe("6");
  });

  // Pins the per-row .map(): two lines must each render their own aria-labeled
  // controls, and editing the second must not touch the first. If rendering
  // ever collapsed to "always line[0]", both aria-labels would collide
  // (getByLabelText throws on a duplicate) and the edit would land on the
  // wrong line.
  it("renders two lines with distinct aria-labels and edits only the targeted line, not the first", () => {
    const onChange = jest.fn();
    const view = { ...emptyCommonRequisition("co-1", "ITEM", "STORE", "2026-10-04"), lines: [emptyLine(), emptyLine()] };
    render(<CommonRequisitionDocument view={view} editable options={options} onChange={onChange} />);
    expect(screen.getByLabelText('crqItemFor:{"line":1}')).toBeTruthy();
    expect(screen.getByLabelText('crqItemFor:{"line":2}')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('crqItemFor:{"line":2}'), { target: { value: "i1" } });
    const next = onChange.mock.lastCall[0];
    expect(next.lines[0]).toMatchObject({ item_id: null });
    expect(next.lines[1]).toMatchObject({ item_id: "i1", uom: "EA" });
  });

  // Pins line_seq ?? i+1 numbering across two lines, mixed: the first line
  // carries no line_seq (falls back to i+1 = 1) and the second carries an
  // explicit line_seq (9) that does not equal its index + 1 (2) — so a bug
  // that numbered by index alone, or that rendered only one row, would
  // produce the wrong test id or a missing one on either row.
  it("numbers two lines by line_seq with the i+1 fallback and keeps their balance/remaining ids and values distinct", () => {
    const view = { ...emptyCommonRequisition("co-1", "ITEM", "STORE", "2026-10-04"), requisition_id: "r", req_no: "REQ-2026-0002",
      approval_status: "APPROVED", document_status: "RELEASED",
      lines: [
        { line_id: "l1", item_id: "i1", item_code: "IT-1", item_name: "Fixture item", resource_id: null, description: null,
          quantity: "10", uom: "EA", est_rate: null, from_location_id: "st", to_location_id: "sh", qty_to_ship: "10", qty_shipped: 10,
          qty_to_receive: "10", qty_received: 2, balance_to_ship: 0, remaining_to_receive: 8 },
        { line_id: "l2", line_seq: 9, item_id: "i1", item_code: "IT-1", item_name: "Fixture item", resource_id: null, description: null,
          quantity: "5", uom: "EA", est_rate: null, from_location_id: "st", to_location_id: "sh", qty_to_ship: "5", qty_shipped: 1,
          qty_to_receive: "5", qty_received: 0, balance_to_ship: 4, remaining_to_receive: 1 },
      ] };
    render(<CommonRequisitionDocument view={view as any} editable={false} options={options} />);
    expect(screen.getByTestId("crq-balance-1").textContent).toBe("0");
    expect(screen.getByTestId("crq-remaining-1").textContent).toBe("8");
    expect(screen.getByTestId("crq-balance-9").textContent).toBe("4");
    expect(screen.getByTestId("crq-remaining-9").textContent).toBe("1");
  });
});
