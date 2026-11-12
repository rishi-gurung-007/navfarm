/**
 * The GL account a batch's carrying value sits in, so what takes value out of a herd (a death, a sale, a harvest, a transfer) credits the
 * account that what put it in (its birth cost, its feed) debited. One rule for BatchService and BatchTransferService.
 *
 * Before 11 Nov 2026 a piglet lot's birth cost and deaths used the BIO_LITTER_BIRTH debit (Weaners Inventory) while its feed, a sale out of
 * it and a transfer of its head used the pre-mature account, so its value was split between two accounts and each exit took it from one.
 */
import { eq } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../../../core/database/schema';
import type { GlPostingService } from '../../finance/journal/gl-posting.service';

type Herd = {
  batch_id: string;
  company_id: string;
  nob_id?: string | null;
  lob_id?: string | null;
};
type Gl = Pick<GlPostingService, 'mappedAccount'>;

/** The account a farrowing's piglet lot is carried in (the birth journal's debit), or undefined for any other batch or when births are not journalled. */
export async function pigletLotAccount(
  db: MySql2Database<typeof schema>,
  gl: Gl,
  batch: Herd,
  tenantId: string,
): Promise<string | undefined> {
  const [lot] = await db
    .select({ id: schema.farrowingRecord.farrow_id })
    .from(schema.farrowingRecord)
    .where(eq(schema.farrowingRecord.piglet_batch_id, batch.batch_id))
    .limit(1);
  if (!lot) return undefined;
  return gl.mappedAccount(tenantId, batch.company_id, 'BIO_LITTER_BIRTH', 'debit', {
    nobId: batch.nob_id,
    lobId: batch.lob_id,
  });
}

/**
 * A piglet lot's own account; else, for a pre-mature herd, the pre-mature account (what the pre-mature mortality rule credits); else undefined:
 * a mature herd is left to each posting's own mapping.
 */
export async function herdCarryingAccount(
  db: MySql2Database<typeof schema>,
  gl: Gl,
  batch: Herd,
  stage: string | null | undefined,
  tenantId: string,
): Promise<string | undefined> {
  const lot = await pigletLotAccount(db, gl, batch, tenantId);
  if (lot) return lot;
  if (stage !== 'PREMATURE') return undefined;
  return gl.mappedAccount(tenantId, batch.company_id, 'BIO_MORTALITY_PREMATURE', 'credit', {
    nobId: batch.nob_id,
    lobId: batch.lob_id,
  });
}
