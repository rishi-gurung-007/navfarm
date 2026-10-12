/**
 * Task 13 fix round 1 — doc_type on POST/PUT /requisition is one of the common
 * kinds. A lowercase or unknown value used to fall through
 * normalizeCommonDocType to ITEM; FEED keeps its own message pointing to
 * /feed-requisition.
 */
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateRequisitionDto, UpdateRequisitionDto } from './requisition.dto';

const body = (doc_type: unknown) => ({
  company_id: '7a7fb7be-9249-4c78-a7e7-7d663f49872a', doc_type, purpose: 'PURCHASE',
  lines: [{ description: 'Scale', quantity: 1, uom: 'EA' }, { description: 'Trough', quantity: 2, uom: 'EA' }],
});
const docTypeErrors = async (cls: any, doc_type: unknown) => {
  const errors = await validate(plainToInstance(cls, body(doc_type)) as object);
  return errors.filter((e) => e.property === 'doc_type').flatMap((e) => Object.values(e.constraints ?? {}));
};

describe.each([['Create', CreateRequisitionDto], ['Update', UpdateRequisitionDto]])('%sRequisitionDto.doc_type', (_n, cls) => {
  it.each(['ITEM', 'FA', 'SERVICE', undefined])('accepts %s', async (v) => {
    expect(await docTypeErrors(cls, v)).toEqual([]);
  });
  it.each(['feed', 'item', 'PIGS', ''])('refuses %p instead of treating it as ITEM', async (v) => {
    expect(await docTypeErrors(cls, v)).toEqual(['doc_type must be one of ITEM, FA, SERVICE.']);
  });
  it('refuses FEED with the message that points to /feed-requisition', async () => {
    expect(await docTypeErrors(cls, 'FEED')).toEqual(['A feed requisition cannot be created or edited through /requisition; use /feed-requisition.']);
  });
});
