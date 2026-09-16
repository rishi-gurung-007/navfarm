import { Module } from '@nestjs/common';
import { ResourceLedgerController } from './resource-ledger.controller';
import { ResourceLedgerService } from './resource-ledger.service';

@Module({
  controllers: [ResourceLedgerController],
  providers: [ResourceLedgerService],
  exports: [ResourceLedgerService],
})
export class ResourceLedgerModule {}
