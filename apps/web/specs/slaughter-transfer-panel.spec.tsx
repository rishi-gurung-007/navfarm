/**
 * Livestock > Slaughter Transfer Orders (BBP-1 S.10.1). The screen lists what the API answers and offers only the next step for each status; the POD sends a DOA
 * for every line, and the kill sheet sends each line's average carcass weight and price, showing the invoice (delivered x carcass x price) before it is saved.
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import SlaughterTransferPanel from "../src/components/console/livestock/slaughter-transfer-panel";
import { api } from "../src/services/api-client";
import { chooseOption } from "./support/searchable-select";

jest.mock("../src/services/api-client", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("../src/hooks/useLanguage", () => ({ useLanguage: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars?.amount ? `${key}:${vars.amount}` : key) }) }));
jest.mock("../src/hooks/useAuth", () => ({ getStoredUser: () => ({ userId: "u1", userType: "COMPANY_ADMIN" }), hasPermission: () => true }));
jest.mock("../src/components/ui/toast", () => ({ Toast: ({ message }: { message?: string }) => (message ? <div role="alert">{message}</div> : null) }));

const line = (id: string, over: object = {}) => ({ line_id: id, line_no: 10000, batch_id: "b1", batch_no: "LIT-000005", slap_mark: "MUL100-LIT-000005", head_count: 4, carrying_value: "987.0000", ...over });
const inTransit = { to_id: "t2", to_no: "STO-2026-0002", to_date: "2026-11-05", farm_id: "f1", farm_code: "MUL100", farm_name: "Grasmere", ho_approval_ref: "HO-2", status: "CONFIRMED", lines: [line("l1")] };
const received = { ...inTransit, to_id: "t3", to_no: "STO-2026-0003", status: "RECEIVED", lines: [line("l3", { doa_head: 1, received_head: 3 })] };
const closed = { ...inTransit, to_id: "t1", to_no: "STO-2026-0001", status: "CLOSED", invoice_amount: "868.4000" };

describe("SlaughterTransferPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (api.get as jest.Mock).mockImplementation(async (url: string) => {
      if (url.startsWith("/location")) return { data: [{ location_id: "f1", location_code: "MUL100", location_name: "Grasmere" }] };
      if (url === "/slaughter-transfer-order/t2") return { data: inTransit };
      if (url === "/slaughter-transfer-order/t3") return { data: received };
      return { data: [inTransit, received, closed] };
    });
    (api.post as jest.Mock).mockResolvedValue({ data: { ...inTransit, status: "RECEIVED" } });
  });

  it("lists the open orders with their farm, and the closed one under its own filter", async () => {
    render(<SlaughterTransferPanel />);
    expect(await screen.findByText("STO-2026-0002")).toBeTruthy();
    expect(screen.queryByText("STO-2026-0001")).toBeNull();
    expect(screen.getAllByText("MUL100 · Grasmere").length).toBeGreaterThan(0);
    chooseOption(screen.getByLabelText("stoColStatus"), /stoShowClosed/);
    expect(screen.getByText("STO-2026-0001")).toBeTruthy();
    expect(screen.getByText("868.40")).toBeTruthy();
  });

  it("offers the POD on an order in transit and sends a DOA for every line", async () => {
    render(<SlaughterTransferPanel />);
    await screen.findByText("STO-2026-0002");
    fireEvent.click(screen.getAllByRole("button", { name: "stoOpen" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "stoRecordPod" }));
    fireEvent.change(await screen.findByLabelText("stoColDoa LIT-000005"), { target: { value: "1" } });
    const save = (await screen.findAllByRole("button", { name: "stoRecordPod" })).pop()!;
    fireEvent.click(save);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/slaughter-transfer-order/t2/pod", expect.objectContaining({ lines: [{ line_id: "l1", doa_head: 1 }] })));
  });

  it("shows the invoice before the kill sheet is saved: delivered x carcass x price", async () => {
    render(<SlaughterTransferPanel />);
    await screen.findByText("STO-2026-0003");
    fireEvent.click(screen.getAllByRole("button", { name: "stoOpen" })[1]);
    fireEvent.click(await screen.findByRole("button", { name: "stoKillSheet" }));
    fireEvent.change(await screen.findByLabelText("stoColAvgCarcass LIT-000005"), { target: { value: "80" } });
    fireEvent.change(screen.getByLabelText("stoColPrice LIT-000005"), { target: { value: "3" } });
    expect(screen.getByText("stoInvoiceTotal:720.00")).toBeTruthy(); // 3 delivered x 80 kg x 3.00
    const save = (await screen.findAllByRole("button", { name: "stoKillSheet" })).pop() as HTMLButtonElement;
    expect(save.disabled).toBe(true); // the kill sheet reference is still missing
    fireEvent.change(screen.getByLabelText(/stoKillRef/), { target: { value: "KS-1" } });
    expect(save.disabled).toBe(false);
  });
});
