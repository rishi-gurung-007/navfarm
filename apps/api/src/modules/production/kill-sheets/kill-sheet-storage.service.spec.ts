import { BadRequestException } from '@nestjs/common';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KillSheetStorageService } from './kill-sheet-storage.service';

const file = (name: string, bytes: number[]) => ({ originalname: name, buffer: Buffer.from(bytes) }) as Express.Multer.File;

describe('KillSheetStorageService', () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'kill-sheet-storage-')); process.env.KILL_SHEET_UPLOADS_DIR = directory; });
  afterEach(async () => { delete process.env.KILL_SHEET_UPLOADS_DIR; await rm(directory, { recursive: true, force: true }); });

  it('accepts legacy XLS and OOXML XLSX signatures, with opaque tenant keys', async () => {
    const service = new KillSheetStorageService();
    const stored = await service.store('tenant-1', 'import-1', 'individual', file('original name.xls', [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]));
    expect(stored.storageKey).toBe('tenant-1/import-1/individual.xls');
    expect(stored.fileName).toBe('original name.xls');
    await expect(readFile(service.path(stored.storageKey))).resolves.toEqual(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]));
    expect(service.validateUpload(file('summary.xlsx', [0x50, 0x4b, 0x03, 0x04]), 'summary')).toBe('.xlsx');
  });
  it('refuses extension spoofing and traversal keys', () => {
    const service = new KillSheetStorageService();
    expect(() => service.validateUpload(file('report.xls', [0x50, 0x4b, 0x03, 0x04]), 'individual')).toThrow(BadRequestException);
    expect(() => service.path('../outside/individual.xls')).toThrow(BadRequestException);
  });
});
