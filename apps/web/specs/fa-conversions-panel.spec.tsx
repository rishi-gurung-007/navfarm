/**
 * Finance > FA to Inventory Conversions (TDD row 11). The screen lists what the API answers; Approve needs a market value and is not offered to the person who
 * raised the request, Post is only for an approved one and takes a date, Reject needs a reason. It does no arithmetic of its own.
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import FaConversionsPanel from "../src/components/console/finance/fa-conversions-panel";
import { api } from "../src/services/api-client";
import { chooseOption } from "./support/searchable-select";

jest.mock("../src/services/api-client", () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } }));
jest.mock("../src/hooks/useLanguage", () => ({ useLanguage: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars?.no ? `${key}:${vars.no}` : key) }) }));
jest.mock("../src/hooks/useAuth", () => ({ getActiveCompanyId: () => "co-1", getStoredUser: () => ({ userId: "u-farm", userType: "TENANT_ADMIN" }), hasPermission: () => true }));
jest.mock("../src/components/ui/toast", () => ({ Toast: ({ message }: { message?: string }) => (message ? <div role="alert">{message}</div> : null) }));

const base = { company_id: "co-1", animal_code: "PIG-1", rfid_tag: "TAG-1", out_of_production_date: "2026-09-15", market_value: null, nbv_at_conversion: null, gain_loss: null };
const requested = { ...base, conversion_id: "c1", conversion_no: "FAC-2026-00001", status: "REQUESTED", requested_by: "u-other" };
const own = { ...base, conversion_id: "c2", conversion_no: "FAC-2026-00002", status: "REQUESTED", requested_by: "u-farm", animal_code: "PIG-2" };
const approved = { ...base, conversion_id: "c3", conversion_no: "FAC-2026-00003", status: "APPROVED", requested_by: "u-other", market_value: "450.0000", animal_code: "PIG-3" };
const posted = { ...base, conversion_id: "c4", conversion_no: "FAC-2026-00004", status: "POSTED", requested_by: "u-other", market_value: "600.0000", nbv_at_conversion: "661.2396", gain_loss: "-61.2396", animal_code: "PIG-4" };

describe("FaConversionsPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (api.get as jest.Mock).mockResolvedValue({ data: [requested, own, approved, posted] });
    (api.patch as jest.Mock).mockResolvedValue({ data: {} });
    (api.post as jest.Mock).mockResolvedValue({ data: {} });
  });

  it("shows what waits for action first, and the posted ones on the other filter with their gain or loss", async () => {
    render(<FaConversionsPanel />);
    expect(await screen.findByText("FAC-2026-00001")).toBeTruthy();
    expect(screen.getByText("FAC-2026-00003")).toBeTruthy();
    expect(screen.queryByText("FAC-2026-00004")).toBeNull();
    chooseOption(screen.getByLabelText("facColStatus"), /facShowPosted/);
    expect(screen.getByText("FAC-2026-00004")).toBeTruthy();
    expect(screen.getByText("-61.24")).toBeTruthy();
    expect(screen.queryByText("FAC-2026-00001")).toBeNull();
  });

  it("does not offer approval to the person who raised the request, and says why", async () => {
    render(<FaConversionsPanel />);
    await screen.findByText("FAC-2026-00002");
    const approveButtons = screen.getAllByRole("button", { name: "facApprove" }) as HTMLButtonElement[];
    expect(approveButtons).toHaveLength(2);
    expect(approveButtons[0].disabled).toBe(false); // raised by someone else
    expect(approveButtons[1].disabled).toBe(true); // raised by the signed-in user
    expect(approveButtons[1].closest("span")!.getAttribute("title")).toBe("facOwnRequest");
  });

  it("approves with the market value Finance types, and not without one", async () => {
    render(<FaConversionsPanel />);
    await screen.findByText("FAC-2026-00001");
    fireEvent.click((screen.getAllByRole("button", { name: "facApprove" }) as HTMLButtonElement[])[0]);
    const dialogApprove = (await screen.findAllByRole("button", { name: "facApprove" })).pop() as HTMLButtonElement;
    expect(dialogApprove.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("facMarketValue"), { target: { value: "600" } });
    expect(dialogApprove.disabled).toBe(false);
    fireEvent.click(dialogApprove);
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/fa-conversions/c1/approve", { market_value: 600 }));
    expect(await screen.findByText("facApproved:FAC-2026-00001")).toBeTruthy();
  });

  it("posts an approved one with the date, between its out-of-production date and today", async () => {
    render(<FaConversionsPanel />);
    await screen.findByText("FAC-2026-00003");
    fireEvent.click(screen.getByRole("button", { name: /facPost/ }));
    const date = (await screen.findByLabelText("facConversionDate")) as HTMLInputElement;
    expect(date.min).toBe("2026-09-15");
    fireEvent.change(date, { target: { value: "2026-10-05" } });
    fireEvent.click((await screen.findAllByRole("button", { name: /facPost/ })).pop()!);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/fa-conversions/c3/post", { conversion_date: "2026-10-05" }));
  });

  it("will not reject without a reason, and sends it when given", async () => {
    render(<FaConversionsPanel />);
    await screen.findByText("FAC-2026-00001");
    fireEvent.click((screen.getAllByRole("button", { name: "facReject" }) as HTMLButtonElement[])[0]);
    const dialogReject = (await screen.findAllByRole("button", { name: "facReject" })).pop() as HTMLButtonElement;
    expect(dialogReject.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("facReason"), { target: { value: "still producing" } });
    fireEvent.click(dialogReject);
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("/fa-conversions/c1/reject", { reason: "still producing" }));
  });

  it("shows the API's refusal in words and keeps the dialog open", async () => {
    (api.patch as jest.Mock).mockRejectedValue(new Error("A conversion request cannot be approved by the person who raised it."));
    render(<FaConversionsPanel />);
    await screen.findByText("FAC-2026-00001");
    fireEvent.click((screen.getAllByRole("button", { name: "facApprove" }) as HTMLButtonElement[])[0]);
    fireEvent.change(await screen.findByLabelText("facMarketValue"), { target: { value: "600" } });
    fireEvent.click((await screen.findAllByRole("button", { name: "facApprove" })).pop()!);
    expect(await screen.findByText(/cannot be approved by the person who raised it/)).toBeTruthy();
    expect(screen.getByLabelText("facMarketValue")).toBeTruthy();
  });
});
