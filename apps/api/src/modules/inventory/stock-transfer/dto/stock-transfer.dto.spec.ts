import 'reflect-metadata';
import { QueryStockTransferDto } from './stock-transfer.dto';

/**
 * M2 (Part E Task 4b fix round 1): the Swagger enum for the status filter
 * still listed only the three pre-Task-4b statuses (DRAFT, POSTED,
 * CANCELLED) — the two statuses Task 4b added (IN_TRANSIT,
 * PARTIALLY_RECEIVED) were undocumented, though query.status itself accepts
 * any string (StockTransferService.findAll filters with a plain eq()).
 */
describe('QueryStockTransferDto — status filter documentation', () => {
  it('the Swagger enum lists all transfer lifecycle statuses', () => {
    const options = Reflect.getMetadata('swagger/apiModelProperties', QueryStockTransferDto.prototype, 'status');
    expect(options.enum).toEqual(['DRAFT', 'IN_TRANSIT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'POSTED', 'CANCELLED']);
  });
});
