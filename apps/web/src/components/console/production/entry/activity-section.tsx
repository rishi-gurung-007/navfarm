"use client";

import React from "react";
import { ActivityCard } from "./activity-card";
import type { EntryFormResponse } from "./types";

/**
 * The centre of the selected-stage workspace: one Activity parent card per
 * scheduler line type, each holding its lines as sub-cards.
 *
 * The groups come from the API in line_seq order, so the screen reads in the
 * order the schedule was written rather than the order MySQL happens to
 * return.
 */
export function ActivitySection({
  form,
  batchId,
  onChanged,
}: {
  form: EntryFormResponse;
  batchId: string;
  onChanged: () => void;
}) {
  return (
    <div className="space-y-4">
      {form.activities.map((group) => (
        <ActivityCard key={group.line_type} group={group} form={form} batchId={batchId} onChanged={onChanged} />
      ))}
    </div>
  );
}

export default ActivitySection;
