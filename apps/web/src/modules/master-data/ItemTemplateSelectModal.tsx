"use client";

import { useEffect, useState, useMemo } from "react";
import { Search, Loader2, CheckCircle2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { InlineAlert } from "@/components/ui/alert";
import { showToast } from "@/components/ui/toast";
import { api } from "@/services/api-client";

export interface ItemTemplateItem {
  id: string;
  template_code: string;
  template_description: string | null;
  item_type: string | null;
  category: string | null;
  sub_category: string | null;
  valuation_method: string | null;
  item_tracking: string;
  item_tracking_no_series_id: string | null;
  inventory_type: string;
  qr_code_enabled: boolean;
  inventory_gl_account: string | null;
  cogs_gl_account: string | null;
  is_active: boolean;
  no_series_id: string;
  no_series_code: string | null;
  no_series_description: string | null;
  manual_nos: boolean;
}

interface ItemTemplateSelectModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (generatedItem: any) => void;
}

export function ItemTemplateSelectModal({
  open,
  onClose,
  onConfirm,
}: ItemTemplateSelectModalProps) {
  const [templates, setTemplates] = useState<ItemTemplateItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSelectedId(null);
      setSearch("");
      setError("");
      return;
    }

    let isMounted = true;
    const fetchTemplates = async () => {
      setLoading(true);
      setError("");
      try {
        const response: any = await api.get("/item-templates");
        const list = Array.isArray(response) ? response : response?.data ?? [];
        if (isMounted) {
          // Show only is_active = true
          setTemplates(list.filter((t: ItemTemplateItem) => t.is_active));
        }
      } catch (err: any) {
        if (isMounted) {
          const msg = err?.message || "Failed to load Item Templates.";
          setError(msg);
          showToast.error(msg);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchTemplates();
    return () => {
      isMounted = false;
    };
  }, [open]);

  const filteredTemplates = useMemo(() => {
    if (!search.trim()) return templates;
    const query = search.toLowerCase().trim();
    return templates.filter(
      (t) =>
        t.template_code.toLowerCase().includes(query) ||
        (t.template_description && t.template_description.toLowerCase().includes(query))
    );
  }, [templates, search]);

  const handleConfirm = async () => {
    if (!selectedId) return;
    setConfirming(true);
    setError("");
    try {
      const response: any = await api.post("/items/from-template", {
        template_id: selectedId,
      });
      const generated = response?.data ?? response;
      onConfirm(generated);
      onClose();
    } catch (err: any) {
      const msg = err?.message || "Failed to generate item from template.";
      setError(msg);
      showToast.error(msg);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Select Item Template"
      description="Choose an active template to auto-generate the next Item Number and initialize defaults."
      maxWidth="lg"
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={confirming}
            className="rounded-lg border px-4 py-2 text-xs font-semibold hover:bg-(--surface-raised) cursor-pointer"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!selectedId || confirming}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 cursor-pointer"
            style={{ backgroundColor: "var(--accent)" }}
          >
            {confirming && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Confirm
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && <InlineAlert>{error}</InlineAlert>}

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-(--text-muted)" aria-hidden="true" />
          <input
            type="text"
            placeholder="Search by Template Code or Description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border py-2 pl-9 pr-4 text-xs focus:outline-none focus:ring-1 focus:ring-(--accent)"
            style={{
              backgroundColor: "var(--input-bg)",
              color: "var(--input-text)",
              borderColor: "var(--input-border)",
            }}
          />
        </div>

        {/* Template List Table */}
        <div
          className="max-h-80 overflow-y-auto rounded-lg border"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
        >
          {loading ? (
            <div className="flex items-center justify-center p-8 text-xs text-(--text-secondary)">
              <Loader2 className="mr-2 h-4 w-4 animate-spin text-(--accent)" />
              Loading templates...
            </div>
          ) : filteredTemplates.length === 0 ? (
            <div className="p-8 text-center text-xs text-(--text-secondary)">
              {templates.length === 0
                ? "No active Item Templates found."
                : "No templates match your search criteria."}
            </div>
          ) : (
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 border-b font-semibold" style={{ backgroundColor: "var(--surface-raised)", borderColor: "var(--border)", color: "var(--text-secondary)" }}>
                <tr>
                  <th className="w-8 px-3 py-2.5"></th>
                  <th className="px-3 py-2.5">Template Code</th>
                  <th className="px-3 py-2.5">Description</th>
                  <th className="px-3 py-2.5">Item Type</th>
                  <th className="px-3 py-2.5">No. Series</th>
                  <th className="px-3 py-2.5">Valuation Method</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
                {filteredTemplates.map((tmpl) => {
                  const isSelected = selectedId === tmpl.id;
                  return (
                    <tr
                      key={tmpl.id}
                      onClick={() => setSelectedId(tmpl.id)}
                      className={`cursor-pointer transition-colors hover:bg-(--surface-raised) ${
                        isSelected ? "bg-(--surface-raised)" : ""
                      }`}
                    >
                      <td className="px-3 py-2.5 text-center">
                        <input
                          type="radio"
                          name="item-template-select"
                          checked={isSelected}
                          onChange={() => setSelectedId(tmpl.id)}
                          className="text-(--accent) focus:ring-(--accent)"
                        />
                      </td>
                      <td className="px-3 py-2.5 font-medium" style={{ color: "var(--text-primary)" }}>
                        <div className="flex items-center gap-1.5">
                          {tmpl.template_code}
                          {isSelected && <CheckCircle2 className="h-3.5 w-3.5 text-(--accent)" />}
                        </div>
                      </td>
                      <td className="px-3 py-2.5" style={{ color: "var(--text-secondary)" }}>
                        {tmpl.template_description || "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="rounded bg-(--surface-raised) px-1.5 py-0.5 text-[11px] font-medium" style={{ color: "var(--text-primary)" }}>
                          {tmpl.item_type || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5" style={{ color: "var(--text-secondary)" }}>
                        {tmpl.no_series_code || tmpl.no_series_description || "—"}
                      </td>
                      <td className="px-3 py-2.5" style={{ color: "var(--text-secondary)" }}>
                        {tmpl.valuation_method || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Dialog>
  );
}
