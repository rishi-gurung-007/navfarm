import { Test, TestingModule } from '@nestjs/testing';
import { CountryService } from './country.service';
import { ClsService } from 'nestjs-cls';
import { NotFoundException } from '@nestjs/common';

describe('CountryService', () => {
  let service: CountryService;

  const mockDbSelect = jest.fn();
  const mockDbInsert = jest.fn();
  const mockDbDelete = jest.fn();

  const mockDb = {
    select: mockDbSelect,
    insert: mockDbInsert,
    delete: mockDbDelete,
  };

  const found = (rows: any[]) => ({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue(rows) }) }) });

  beforeEach(async () => {
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    mockDbDelete.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [CountryService, { provide: ClsService, useValue: { get: jest.fn().mockReturnValue(mockDb) } }],
    }).compile();

    service = module.get<CountryService>(CountryService);
  });

  // listCountries answers the shared master list contract now: rows plus a
  // total, sorted and pageable. It also stopped forcing isActive — a master
  // list has to show a blocked row so it can be found and restored, and the
  // pickers that consume this pass isActive=true themselves.
  it('listCountries() returns rows with a total', async () => {
    mockDbSelect
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({ offset: jest.fn().mockResolvedValue([{ iso2: 'IN' }]) }),
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ total: 1 }]) }),
      });

    await expect(service.listCountries()).resolves.toEqual({
      data: [{ iso2: 'IN' }], total: 1, limit: 50, offset: 0,
    });
  });

  describe('states', () => {
    it('listStates() throws NotFoundException for an unknown country', async () => {
      mockDbSelect.mockReturnValueOnce(found([]));

      await expect(service.listStates('missing-id')).rejects.toThrow(NotFoundException);
    });

    it('listStates() returns active states for a known country', async () => {
      mockDbSelect
        .mockReturnValueOnce(found([{ country_id: 'c-1' }]))
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ state_code: 'MH' }]) }) });

      const result = await service.listStates('c-1');

      expect(result).toEqual([{ state_code: 'MH' }]);
    });

    it('createState() rejects an unknown country before inserting', async () => {
      mockDbSelect.mockReturnValueOnce(found([]));

      await expect(service.createState('missing-id', { state_code: 'MH', state_name: 'Maharashtra' })).rejects.toThrow(NotFoundException);
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('createState() inserts and returns the new row for a known country', async () => {
      mockDbSelect
        .mockReturnValueOnce(found([{ country_id: 'c-1' }]))
        .mockReturnValueOnce(found([{ state_code: 'MH', country_id: 'c-1' }]));
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      const result = await service.createState('c-1', { state_code: 'MH', state_name: 'Maharashtra' });

      expect(mockDbInsert).toHaveBeenCalled();
      expect(result).toEqual({ state_code: 'MH', country_id: 'c-1' });
    });
  });
});
