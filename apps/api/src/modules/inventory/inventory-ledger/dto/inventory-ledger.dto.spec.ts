import { ValidationPipe } from '@nestjs/common';
import { QueryInventoryLedgerDto } from './inventory-ledger.dto';

/**
 * main.ts rejects undeclared query parameters. The ledger screen sends its
 * search text as `documentNo` and sort selection as `sortBy`, so both must be
 * part of the DTO contract or the entire read request returns 400.
 */
describe('QueryInventoryLedgerDto through the global ValidationPipe', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
  });
  const metadata = { type: 'query' as const, metatype: QueryInventoryLedgerDto };

  it.each(['created_at', 'posting_date'] as const)('accepts sortBy=%s', async (sortBy) => {
    await expect(pipe.transform({ sortBy }, metadata)).resolves.toMatchObject({ sortBy });
  });

  it('accepts documentNo for document and batch search', async () => {
    await expect(
      pipe.transform({ documentNo: 'GR-000055' }, metadata),
    ).resolves.toMatchObject({ documentNo: 'GR-000055' });
  });

  it('rejects an undeclared query key', async () => {
    await expect(pipe.transform({ bogusParam: 'x' }, metadata)).rejects.toThrow();
  });

  it('rejects a sort field the service does not support', async () => {
    await expect(pipe.transform({ sortBy: 'document_no' }, metadata)).rejects.toThrow();
  });
});
