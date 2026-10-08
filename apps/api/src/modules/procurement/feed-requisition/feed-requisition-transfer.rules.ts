import { BadRequestException } from '@nestjs/common';

export interface FeedTransferLineInput {
  lineId: string;
  itemId: string;
  itemLabel: string;
  destinationLocationId: string;
  quantityKg: number;
}

export interface FeedBinAssignmentInput {
  assignmentId: string;
  itemId: string;
  productionDate: string;
  binLocationId: string;
  productionSlotId: string;
}

export interface FeedTransferPlan {
  assignmentId: string;
  sourceLocationId: string;
  destinationLocationId: string;
  productionSlotId: string;
  lines: Array<{ requisitionLineId: string; itemId: string; quantityKg: number }>;
}

/** Build one stock transfer per exact BIN assignment and destination SILO. */
export function groupFeedTransferLines(
  lines: FeedTransferLineInput[],
  assignments: FeedBinAssignmentInput[],
  productionDate: string,
): FeedTransferPlan[] {
  const plans = new Map<string, FeedTransferPlan>();
  for (const line of lines) {
    const matches = assignments.filter((candidate) =>
      candidate.itemId === line.itemId && candidate.productionDate === productionDate,
    );
    if (!matches.length) {
      throw new BadRequestException(`${line.itemLabel} has no active mill BIN assignment on ${productionDate}.`);
    }
    if (matches.length > 1) {
      throw new BadRequestException(
        `${line.itemLabel} has multiple active mill BIN assignments on ${productionDate}; select an unambiguous production slot.`,
      );
    }
    const assignment = matches[0];
    const key = `${assignment.assignmentId}\u0000${line.destinationLocationId}`;
    const plan = plans.get(key) ?? {
      assignmentId: assignment.assignmentId,
      sourceLocationId: assignment.binLocationId,
      destinationLocationId: line.destinationLocationId,
      productionSlotId: assignment.productionSlotId,
      lines: [],
    };
    plan.lines.push({ requisitionLineId: line.lineId, itemId: line.itemId, quantityKg: line.quantityKg });
    plans.set(key, plan);
  }
  return [...plans.values()];
}
