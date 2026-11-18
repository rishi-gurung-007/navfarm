import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, extname, relative, resolve } from 'node:path';

const XLS_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const safeSegment = /^[a-zA-Z0-9-]{1,100}$/;
const safeKey = /^[a-zA-Z0-9-]{1,100}\/[a-zA-Z0-9-]{1,100}\/(individual|summary)\.(xls|xlsx)$/;

export type KillSheetFileKind = 'individual' | 'summary';
export type StoredKillSheetFile = { storageKey: string; fileName: string; sha512: string };

/** Private local-disk storage. Keys are relative, opaque database values; absolute paths never leave this service. */
@Injectable()
export class KillSheetStorageService {
  private root() { return resolve(process.env.KILL_SHEET_UPLOADS_DIR || 'apps/api/private-uploads/kill-sheets'); }

  validateUpload(file: Express.Multer.File, kind: KillSheetFileKind) {
    const extension = extname(file.originalname).toLowerCase();
    if (extension !== '.xls' && extension !== '.xlsx') throw new BadRequestException('Only .xls and .xlsx Kill Sheet workbooks are accepted.');
    if (!file.buffer?.length) throw new BadRequestException(`The ${kind} workbook is empty.`);
    const expected = extension === '.xls' ? XLS_SIGNATURE : ZIP_SIGNATURE;
    if (file.buffer.length < expected.length || !file.buffer.subarray(0, expected.length).equals(expected)) {
      throw new BadRequestException(`The ${kind} workbook contents do not match its ${extension} extension.`);
    }
    return extension;
  }

  async store(tenantId: string, importId: string, kind: KillSheetFileKind, file: Express.Multer.File): Promise<StoredKillSheetFile> {
    const extension = this.validateUpload(file, kind);
    if (!safeSegment.test(tenantId) || !safeSegment.test(importId)) throw new BadRequestException('Invalid storage scope.');
    const storageKey = `${tenantId}/${importId}/${kind}${extension}`;
    const target = this.resolveKey(storageKey);
    await mkdir(resolve(target, '..'), { recursive: true });
    const temp = `${target}.${randomUUID()}.tmp`;
    try { await writeFile(temp, file.buffer, { flag: 'wx' }); await rename(temp, target); }
    catch (error) { await rm(temp, { force: true }); throw error; }
    return { storageKey, fileName: basename(file.originalname).slice(0, 255), sha512: createHash('sha512').update(file.buffer).digest('hex') };
  }

  async read(storageKey: string) { try { return await readFile(this.resolveKey(storageKey)); } catch { throw new NotFoundException('The private Kill Sheet workbook is unavailable.'); } }
  path(storageKey: string) { return this.resolveKey(storageKey); }
  async remove(storageKey: string | null | undefined) { if (storageKey) await rm(this.resolveKey(storageKey), { force: true }); }

  private resolveKey(storageKey: string) {
    if (!safeKey.test(storageKey)) throw new BadRequestException('Invalid private storage key.');
    const path = resolve(this.root(), storageKey);
    if (relative(this.root(), path).startsWith('..')) throw new BadRequestException('Invalid private storage key.');
    return path;
  }
}
