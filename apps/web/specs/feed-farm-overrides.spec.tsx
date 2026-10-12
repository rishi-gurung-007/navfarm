import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FeedFarmOverrides } from "../src/components/console/company/feed-farm-overrides";
import { api } from "../src/services/api-client";

jest.mock("../src/services/api-client", () => ({ api: { get: jest.fn(), put: jest.fn() } }));
jest.mock("../src/hooks/useLanguage", () => ({
  useLanguage: () => ({ t: (key: string, vars?: Record<string, unknown>) => vars ? `${key}:${JSON.stringify(vars)}` : key }),
}));

const get = api.get as jest.Mock;
const put = api.put as jest.Mock;
const farms = [{
  farmId: "farm-1", code: "GRA100", name: "Grasmere Farm", companyId: "co-1",
  settings: { truckTargetKg: null, bulkMultipleKg: 6000 },
}];

beforeEach(() => {
  jest.clearAllMocks();
  get.mockImplementation((url: string) => {
    if (url === "/feed-forecast/farm-settings") return Promise.resolve({ data: farms });
    if (url === "/feed-settings?companyId=co-1") return Promise.resolve({ data: { truckTargetKg: 30000, bulkMultipleKg: 3000 } });
    return Promise.resolve({ data: [] });
  });
  put.mockResolvedValue({ data: {} });
});

describe("FeedFarmOverrides", () => {
  it("shows company defaults, nullable Farm overrides and their effective source", async () => {
    render(<FeedFarmOverrides companyId="co-1" />);
    const truck = await screen.findByLabelText('fsetTruckTarget:{"name":"GRA100"}') as HTMLInputElement;
    const multiple = screen.getByLabelText('fsetBulkMultiple:{"name":"GRA100"}') as HTMLInputElement;
    expect(truck.value).toBe("");
    expect(truck.placeholder).toBe("30000");
    expect(multiple.value).toBe("6000");
    expect(screen.getByText('fsetInheritedValue:{"value":"30,000"}')).toBeTruthy();
    expect(screen.getByText('fsetFarmValue:{"value":"6,000"}')).toBeTruthy();
  });

  it("sends null when an override is cleared so the Farm inherits again", async () => {
    render(<FeedFarmOverrides companyId="co-1" />);
    const multiple = await screen.findByLabelText('fsetBulkMultiple:{"name":"GRA100"}');
    fireEvent.change(multiple, { target: { value: "" } });
    fireEvent.change(screen.getByLabelText('fsetTruckTarget:{"name":"GRA100"}'), { target: { value: "32000" } });
    fireEvent.click(screen.getByRole("button", { name: 'fsetSave:{"name":"GRA100"}' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith("/feed-settings/farm", {
      companyId: "co-1", farmId: "farm-1", truckTargetKg: 32000, bulkMultipleKg: null,
    }));
  });

  it("rejects a configured value that is not positive", async () => {
    render(<FeedFarmOverrides companyId="co-1" />);
    const truck = await screen.findByLabelText('fsetTruckTarget:{"name":"GRA100"}');
    fireEvent.change(truck, { target: { value: "0" } });
    expect((screen.getByRole("button", { name: 'fsetSave:{"name":"GRA100"}' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("fsetPositiveOnly")).toBeTruthy();
    expect(put).not.toHaveBeenCalled();
  });
});
