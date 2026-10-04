import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { CommonRequisitionDocument } from "../src/components/console/requisitions/common-requisition-document";
import { emptyCommonRequisition } from "../src/components/console/requisitions/common-requisition-model";

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
});
