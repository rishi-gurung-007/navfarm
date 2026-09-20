"use client";

import { useEffect, useState } from "react";
import { api } from "@/services/api-client";
import { Dialog } from "@/components/ui/dialog";
import { InlineAlert } from "@/components/ui/alert";
import { showToast } from "@/components/ui/toast";
import type { MasterDataConfig } from "./types";
import { singularLabel } from "./labels";
import { BcOwnershipNotice } from "./BcOwnershipNotice";
import { StatusBadge } from "@/components/ui/status-badge";
import { MasterFieldValue } from "./MasterFieldValue";
import { getActiveWorkspaceScope } from "@/hooks/useAuth";

export function MasterRecordView({ config, id, onClose }: { config: MasterDataConfig; id: string; onClose: () => void }) {
  const [record, setRecord] = useState<Record<string, unknown>>();
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setRecord(undefined);
    setError("");
    api.get(`${config.apiBase}/${encodeURIComponent(id)}`).then((result) => {
      if (!cancelled) setRecord(result?.data ?? result);
    }).catch((err: Error) => {
      if (!cancelled) {
        const msg = err.message || "Could not load record.";
        setError(msg);
        showToast.error(msg);
      }
    });
    return () => { cancelled = true; };
  }, [config.apiBase, id]);
  // A form-only gate (Item Tracking) has no column of its own: it is whether any
  // of the columns it stands for is set. Derive it here the way the form does
  // when editing, or every field behind such a gate reads as hidden on every
  // record — the gate would evaluate "off" purely because the record has no key
  // by that name. MySQL tinyint arrives as 1 as readily as true.
  const gates: Record<string, unknown> = {};
  const isOn = (key: string) => record?.[key] === true || record?.[key] === 1;
  config.fields.forEach((field) => {
    if (field.seedFromAnyTrue) gates[field.key] = field.seedFromAnyTrue.some(isOn);
    // Same for a control that stands in for a set of boolean columns: its value
    // is whichever column is set, and a label reading off it ("Lot No. Series")
    // has to resolve here as well as in the form.
    if (field.booleanColumns) gates[field.key] = Object.entries(field.booleanColumns).find(([, column]) => isOn(column))?.[0] ?? "";
  });
  const conditionValues = { ...record, ...gates };
  const labelOf = (field: { label: string; labelWhen?: { key: string; labels: Record<string, string> } }) =>
    (field.labelWhen && field.labelWhen.labels[String(conditionValues[field.labelWhen.key] ?? "")]) || field.label;
  const fields = config.fields.filter((field) => !field.filterOnly && field.key !== "company_id" &&
    !(getActiveWorkspaceScope() === "OPERATIONAL" && ["nob_id", "lob_id"].includes(field.key)) &&
    !config.bcFields?.some((bcField) => bcField.key === field.key) &&
    (!field.hideInForm || field.readOnly) &&
    (!field.visibleWhen || field.visibleWhen.anyOf.some((condition) => {
      const value = conditionValues?.[condition.key];
      return condition.equals === undefined ? !!value : (Array.isArray(condition.equals) ? condition.equals : [condition.equals]).includes(value as string | boolean);
    })));
  return <Dialog open onClose={onClose} title={`View ${singularLabel(config)}`} maxWidth="xl"
    presentation={fields.length > 10 ? "page" : "modal"}>
    {error ? <InlineAlert>{error}</InlineAlert> : !record ? <p role="status">Loading record…</p> : <div className="grid gap-6">
      {/* A blocked record still reads in full — the label says what it is, and
          every field stays where it was. Blocking is not a reason to hide the
          record: the list keeps blocked rows precisely so they can be looked at
          and restored. */}
      {(record.is_active === false || !!record.deleted_at) &&
        <p><StatusBadge status="BLOCKED" label="Blocked" /></p>}
      {config.owner === "BC" && <BcOwnershipNotice config={config} />}
      <dl className={`grid grid-cols-1 gap-4 sm:grid-cols-2${config.owner === "BC" ? " order-last" : ""}`}>
        {fields.map((field) => <div key={field.key} className="min-w-0">
          <dt className="text-xs text-(--text-muted)">{labelOf(field)}</dt>
          <dd className="mt-1 whitespace-pre-wrap break-words text-sm"><MasterFieldValue field={field} value={record[field.key]} record={record} /></dd>
        </div>)}
      </dl>
      {!!config.bcFields?.length && <section aria-label="Business Central" className="rounded-lg border border-(--border) p-4">
        <h3 className="font-semibold">Business Central</h3>
        <p className="mt-1 text-xs text-(--text-muted)">Read-only references from BC. A dash means no BC value has been received; it is not a zero or a confirmed status.</p>
        <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {config.bcFields.map((field) => <div key={field.key}>
            <dt className="text-xs text-(--text-muted)">{field.label} <span className="ml-1 rounded border border-(--border) px-1.5 py-0.5">From BC</span></dt>
            <dd className="mt-1 break-words text-sm"><MasterFieldValue field={config.fields.find((f) => f.key === field.key)} value={record[field.key]} record={record} /></dd>
          </div>)}
        </dl>
      </section>}
    </div>}
  </Dialog>;
}
