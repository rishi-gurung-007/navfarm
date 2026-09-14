import { Global, Module } from '@nestjs/common';
import { AnimalMovementLogService } from './animal-movement-log.service';
import { AnimalMovementLogController } from './animal-movement-log.controller';

// Global, no imports of its own — same shape as AuditLogModule — so both
// AnimalModule and BatchModule (via BatchTransferService) can inject
// AnimalMovementLogService without any circular module dependency.
@Global()
@Module({
  controllers: [AnimalMovementLogController],
  providers: [AnimalMovementLogService],
  exports: [AnimalMovementLogService],
})
export class AnimalMovementLogModule {}
