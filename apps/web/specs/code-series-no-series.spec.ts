import { renderHook, waitFor } from "@testing-library/react";

const get = jest.fn();
jest.mock("@/services/api-client", () => ({ api: { get: (...args: unknown[]) => get(...args) } }));
jest.mock("@/hooks/useAuth", () => ({
  getActiveCompanyId: () => "company-1",
  getActiveWorkspaceScope: () => "COMPANY",
  getActiveOperationalAreaId: () => "area-1",
}));

import { useCodeSeries } from "@/modules/master-data/useCodeSeries";

/**
 * A fresh tenant has no number series. The preview then answers
 * { generated: false } with no preview text, and `loading` used to mean
 * "no preview yet" — so it stayed true forever and Create on Add Location
 * (the first thing a new tenant does) was disabled for good. Loading must end
 * once the server has answered, whatever it answered.
 */
describe("useCodeSeries on a tenant with no number series", () => {
  beforeEach(() => get.mockReset());

  it("stops loading once the server says no series is configured", async () => {
    get.mockImplementation((url: string) =>
      Promise.resolve(url.startsWith("/no-series") ? { generated: false } : { generated: false, allowManual: true }),
    );

    const { result } = renderHook(() => useCodeSeries("location", { location_type: "FARM-NEW-TENANT" }, true));

    // The first answer settles it now (Arun, 27 Sep: a { generated } reply is final),
    // so the legacy /no-series fallback is not always called; what matters is that
    // loading ends and Create is not held disabled.
    await waitFor(() => expect(get).toHaveBeenCalled());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeUndefined();
    expect(result.current.managed).toBe(false);
  });

  it("is loading while the first answer is outstanding", () => {
    // A promise that never settles: the first answer is still outstanding.
    get.mockImplementation(() => new Promise<never>(() => undefined));

    const { result } = renderHook(() => useCodeSeries("location", { location_type: "FARM-PENDING" }, true));

    expect(result.current.loading).toBe(true);
  });

  it("is not loading after a series answers with a preview", async () => {
    get.mockResolvedValue({ generated: true, allowManual: true, preview: "FARM-0001" });

    const { result } = renderHook(() => useCodeSeries("location", { location_type: "FARM-SERIES" }, true));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.preview).toBe("FARM-0001");
  });

  it("does not snap back to preview when code field is cleared to empty string", async () => {
    get.mockResolvedValue({ generated: true, allowManual: true, preview: "FARM-0001" });

    const { result } = renderHook(() => useCodeSeries("location", { location_type: "FARM-SERIES-CLEAR" }, true));

    await waitFor(() => expect(result.current.loading).toBe(false));
    // When value is undefined, initial suggestion is the preview
    expect(result.current.value("location_code", undefined)).toBe("FARM-0001");
    // When value is cleared to empty string, it stays empty and does NOT revert to preview
    expect(result.current.value("location_code", "")).toBe("");
    // When value is a custom string, it keeps the custom string
    expect(result.current.value("location_code", "CUSTOM-01")).toBe("CUSTOM-01");
  });

  it("does not mark field as required when managed by number series", async () => {
    get.mockResolvedValue({ generated: true, allowManual: true, preview: "FARM-0001" });

    const { result } = renderHook(() => useCodeSeries("location", { location_type: "FARM-SERIES-REQ" }, true));

    await waitFor(() => expect(result.current.loading).toBe(false));
    const transformedField = result.current.field({
      key: "location_code",
      label: "Code",
      type: "text",
      required: true,
    });
    // Managed code fields should not block save with required error
    expect(transformedField.required).toBe(false);
  });
});

