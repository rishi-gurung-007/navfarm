import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { Providers } from "@/components/providers";
import { showToast } from "@/components/ui/toast";

jest.mock("@/contexts/AuthContext", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

describe("toast placement around dialogs", () => {
  beforeAll(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: jest.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      })),
    });
  });

  it("anchors toast notifications to the top-right", async () => {
    render(<Providers><div>Page</div></Providers>);
    act(() => { showToast.error("Test error"); });

    await waitFor(() => expect(document.querySelector(".Toastify__toast-container--top-right")).not.toBeNull());
  });
});
