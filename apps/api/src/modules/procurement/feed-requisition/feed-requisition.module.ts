import { Module } from '@nestjs/common';
import { ApprovalModule } from '../../production/approval/approval.module';
import { FeedForecastModule } from '../../inventory/feed-forecast/feed-forecast.module';
import { FeedAlertModule } from '../../inventory/feed-alert/feed-alert.module';
import { SiloFeedModule } from '../../inventory/silo-feed/silo-feed.module';
import { InventoryLedgerModule } from '../../inventory/inventory-ledger/inventory-ledger.module';
import { FeedSettingsModule } from '../../inventory/feed-settings/feed-settings.module';
import { StockTransferModule } from '../../inventory/stock-transfer/stock-transfer.module';
import { FeedRequisitionController } from './feed-requisition.controller';
import { FeedRequisitionService } from './feed-requisition.service';
import { FeedConsolidationService } from './feed-consolidation.service';
import { FeedLoadingService } from './feed-loading.service';

// Feed requisitions live on /feed-requisition, with their own rules. Ruling C2
// (generic /requisition unmounted) was lifted by Part E Task 13: RequisitionModule
// is now registered in app.module, and every generic mutation refuses a FEED row,
// so this module still does not import it and nothing feed goes through it.
@Module({
  imports: [ApprovalModule, FeedForecastModule, FeedAlertModule, SiloFeedModule, InventoryLedgerModule, FeedSettingsModule, StockTransferModule],
  controllers: [FeedRequisitionController],
  providers: [FeedRequisitionService, FeedConsolidationService, FeedLoadingService],
})
export class FeedRequisitionModule {}
