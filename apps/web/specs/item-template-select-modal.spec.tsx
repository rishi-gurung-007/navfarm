import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ItemTemplateSelectModal } from "@/modules/master-data/ItemTemplateSelectModal";
import { api } from "@/services/api-client";

jest.mock("@/services/api-client", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

jest.mock("@/hooks/useLanguage", () => ({
  useLanguage: () => ({
    t: (key: string) => key,
    tLabel: (label: string) => label,
  }),
}));

describe("ItemTemplateSelectModal", () => {
  const mockTemplates = [
    {
      id: "tmpl-1",
      template_code: "TMPL-FEED",
      template_description: "Broiler Starter Feed Template",
      item_type: "FEED",
      valuation_method: "FIFO",
      no_series_code: "FEED-",
      no_series_description: "Feed No. Series",
      is_active: true,
      manual_nos: false,
    },
    {
      id: "tmpl-2",
      template_code: "TMPL-MED",
      template_description: "Antibiotics Medicine Template",
      item_type: "MEDICINE",
      valuation_method: "FIFO",
      no_series_code: "MED-",
      no_series_description: "Medicine No. Series",
      is_active: true,
      manual_nos: true,
    },
    {
      id: "tmpl-3",
      template_code: "TMPL-INACTIVE",
      template_description: "Old Inactive Template",
      item_type: "SUPPLY",
      valuation_method: "STANDARD",
      no_series_code: "SUP-",
      is_active: false,
      manual_nos: false,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("loads only active templates into the selection table", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({ data: mockTemplates });

    render(
      <ItemTemplateSelectModal
        open={true}
        onClose={jest.fn()}
        onConfirm={jest.fn()}
      />
    );

    expect(screen.getByText(/loading templates/i)).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("TMPL-FEED")).toBeTruthy();
      expect(screen.getByText("TMPL-MED")).toBeTruthy();
    });

    // Inactive template should be filtered out
    expect(screen.queryByText("TMPL-INACTIVE")).toBeNull();
  });

  it("filters templates dynamically by search term", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({ data: mockTemplates });

    render(
      <ItemTemplateSelectModal
        open={true}
        onClose={jest.fn()}
        onConfirm={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("TMPL-FEED")).toBeTruthy();
    });

    const searchInput = screen.getByPlaceholderText(/search by template code or description/i);
    fireEvent.change(searchInput, { target: { value: "Antibiotics" } });

    expect(screen.queryByText("TMPL-FEED")).toBeNull();
    expect(screen.getByText("TMPL-MED")).toBeTruthy();
  });

  it("enables Confirm only when a template is selected, and posts to /items/from-template", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({ data: mockTemplates });
    const mockGeneratedItem = {
      item_id: "new-item-123",
      item_no: "FEED-0001",
      template_code: "TMPL-FEED",
      item_type: "FEED",
      manual_nos: false,
      status: "DRAFT",
    };
    (api.post as jest.Mock).mockResolvedValueOnce({ data: mockGeneratedItem });

    const handleConfirm = jest.fn();
    const handleClose = jest.fn();

    render(
      <ItemTemplateSelectModal
        open={true}
        onClose={handleClose}
        onConfirm={handleConfirm}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("TMPL-FEED")).toBeTruthy();
    });

    const confirmButton = screen.getByRole("button", { name: /^confirm$/i });
    expect(confirmButton.hasAttribute("disabled")).toBe(true);

    // Click on TMPL-FEED row
    fireEvent.click(screen.getByText("TMPL-FEED"));
    expect(confirmButton.hasAttribute("disabled")).toBe(false);

    // Confirm
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith("/items/from-template", {
        template_id: "tmpl-1",
      });
      expect(handleConfirm).toHaveBeenCalledWith(mockGeneratedItem);
      expect(handleClose).toHaveBeenCalled();
    });
  });

  it("displays error alert when template generation fails", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({ data: mockTemplates });
    (api.post as jest.Mock).mockRejectedValueOnce(
      new Error("No. Series [FEED] is blocked. Cannot generate item number.")
    );

    render(
      <ItemTemplateSelectModal
        open={true}
        onClose={jest.fn()}
        onConfirm={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("TMPL-FEED")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("TMPL-FEED"));
    fireEvent.click(screen.getByRole("button", { name: /^confirm$/i }));

    await waitFor(() => {
      expect(screen.getByText(/No. Series \[FEED\] is blocked/i)).toBeTruthy();
    });
  });
});
