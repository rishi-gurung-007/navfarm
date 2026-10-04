import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClsModule } from 'nestjs-cls';
import { DatabaseModule } from './core/database/database.module';
import { TenantModule } from './modules/core/tenant/tenant.module';
import { CompanyModule } from './modules/core/company/company.module';
import { PlanModule } from './modules/system/plan/plan.module';
import { AuthModule } from './modules/core/auth/auth.module';
import { SetupWizardModule } from './modules/system/setup-wizard/setup-wizard.module';
import { RoleModule } from './modules/core/role/role.module';
import { LanguageModule } from './modules/system/language/language.module';
import { CurrencyModule } from './modules/system/currency/currency.module';
import { TimezoneModule } from './modules/system/timezone/timezone.module';
import { CountryModule } from './modules/system/country/country.module';
import { CostingMethodModule } from './modules/system/costing-method/costing-method.module';
import { AuditLogModule } from './modules/system/audit-log/audit-log.module';
import { AnimalMovementLogModule } from './modules/piggery/animal-movement-log/animal-movement-log.module';
import { NumberSeriesModule } from './modules/system/number-series/number-series.module';
import { EncryptionModule } from './modules/system/encryption/encryption.module';
import { NotificationModule } from './modules/system/notification/notification.module';
import { UserModule } from './modules/core/user/user.module';
import { UserCompanyModule } from './modules/core/user-company/user-company.module';
import { OperationalAreaModule } from './modules/core/operational-area/operational-area.module';
import { UomModule } from './modules/master-data/uom/uom.module';
import { BreedModule } from './modules/master-data/breed/breed.module';
import { FarmModule } from './modules/master-data/farm/farm.module';
import { WarehouseModule } from './modules/master-data/warehouse/warehouse.module';
import { LocationModule } from './modules/master-data/location/location.module';
import { LocationTypeModule } from './modules/master-data/location-type/location-type.module';
import { ShedModule } from './modules/master-data/shed/shed.module';
import { ItemCategoryModule } from './modules/master-data/item-category/item-category.module';
import { ItemTypeModule } from './modules/master-data/item-type/item-type.module';
import { ItemModule } from './modules/master-data/item/item.module';
import { ItemTemplateModule } from './modules/master-data/item-template/item-template.module';
import { ItemAttributeModule } from './modules/master-data/item-attribute/item-attribute.module';
import { SupplierModule } from './modules/master-data/supplier/supplier.module';
import { CustomerModule } from './modules/master-data/customer/customer.module';
import { ResourceModule } from './modules/master-data/resource/resource.module';
import { DiseaseModule } from './modules/master-data/disease/disease.module';
import { ReasonModule } from './modules/master-data/reason/reason.module';
import { AlertRuleModule } from './modules/system/alert-rule/alert-rule.module';
import { ReportingPeriodModule } from './modules/master-data/reporting-period/reporting-period.module';
import { KpiMetricModule } from './modules/master-data/kpi-metric/kpi-metric.module';
import { ActivityModule } from './modules/master-data/activity/activity.module';
import { FeedFormulaModule } from './modules/master-data/feed-formula/feed-formula.module';
import { GlAccountModule } from './modules/finance/gl-account/gl-account.module';
import { GlMappingModule } from './modules/finance/gl-mapping/gl-mapping.module';
import { CostCenterModule } from './modules/finance/cost-center/cost-center.module';
import { InventoryLedgerModule } from './modules/inventory/inventory-ledger/inventory-ledger.module';
import { FeedForecastModule } from './modules/inventory/feed-forecast/feed-forecast.module';
import { FeedSettingsModule } from './modules/inventory/feed-settings/feed-settings.module';
import { FeedAlertModule } from './modules/inventory/feed-alert/feed-alert.module';
import { FeedStockCountModule } from './modules/inventory/feed-stock-count/feed-stock-count.module';
import { GoodsReceiptModule } from './modules/inventory/goods-receipt/goods-receipt.module';
import { BioAssetLedgerModule } from './modules/inventory/bio-asset-ledger/bio-asset-ledger.module';
import { GoodsIssueModule } from './modules/inventory/goods-issue/goods-issue.module';
import { StockTransferModule } from './modules/inventory/stock-transfer/stock-transfer.module';
import { StockAdjustmentModule } from './modules/inventory/stock-adjustment/stock-adjustment.module';
import { InventorySetupModule } from './modules/inventory/inventory-setup/inventory-setup.module';
import { JournalModule } from './modules/finance/journal/journal.module';
import { FinancialReportsModule } from './modules/finance/financial-reports/financial-reports.module';
import { BatchModule } from './modules/production/batch/batch.module';
import { ParameterModule } from './modules/production/parameter/parameter.module';
import { StageModule } from './modules/production/stage/stage.module';
import { SchedulerHeaderModule } from './modules/production/scheduler-header/scheduler-header.module';
import { BatchDailyDataModule } from './modules/production/batch-daily-data/batch-daily-data.module';
import { ResourceLedgerModule } from './modules/production/resource-ledger/resource-ledger.module';
import { AlertModule } from './modules/production/alert/alert.module';
import { ApprovalModule } from './modules/production/approval/approval.module';
import { FeedRequisitionModule } from './modules/procurement/feed-requisition/feed-requisition.module';
import { RequisitionModule } from './modules/procurement/requisition/requisition.module';
import { MilkModule } from './modules/production/milk/milk.module';
import { QcParameterModule } from './modules/production/qc-parameter/qc-parameter.module';
import { QcModule } from './modules/production/qc/qc.module';
import { QrCodeModule } from './modules/production/qr-code/qr-code.module';
import { AnimalModule } from './modules/piggery/animal/animal.module';
import { BreedingModule } from './modules/piggery/breeding/breeding.module';
import { TenantMiddleware } from './common/middlewares/tenant.middleware';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import { SystemController } from './system/system.controller';

@Module({
  imports: [
    // Global environment configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['apps/api/.env', '.env'],
      load: [appConfig, databaseConfig],
    }),

    // Context tracking for requests
    ClsModule.forRoot({
      global: true,
      middleware: { mount: true },
    }),

    // Global Drizzle Database connection pool
    DatabaseModule,

    TenantModule,
    CompanyModule,
    PlanModule,
    AuthModule,
    SetupWizardModule,
    RoleModule,
    LanguageModule,
    CurrencyModule,
    TimezoneModule,
    CountryModule,
    CostingMethodModule,
    AuditLogModule,
    AnimalMovementLogModule,
    NumberSeriesModule,
    EncryptionModule,
    NotificationModule,
    UserModule,
    UserCompanyModule,
    OperationalAreaModule,
    UomModule,
    BreedModule,
    FarmModule,
    WarehouseModule,
    LocationModule,
    LocationTypeModule,
    ShedModule,
    ItemCategoryModule,
    ItemTypeModule,
    ItemModule,
    ItemTemplateModule,
    ItemAttributeModule,
    SupplierModule,
    CustomerModule,
    ResourceModule,
    DiseaseModule,
    ReasonModule,
    AlertRuleModule,
    ReportingPeriodModule,
    KpiMetricModule,
    ActivityModule,
    FeedFormulaModule,
    GlAccountModule,
    GlMappingModule,
    CostCenterModule,
    InventoryLedgerModule,
    FeedForecastModule,
    FeedSettingsModule,
    FeedAlertModule,
    FeedStockCountModule,
    GoodsReceiptModule,
    BioAssetLedgerModule,
    GoodsIssueModule,
    StockTransferModule,
    StockAdjustmentModule,
    InventorySetupModule,
    JournalModule,
    FinancialReportsModule,
    BatchModule,
    ParameterModule,
    StageModule,
    SchedulerHeaderModule,
    BatchDailyDataModule,
    ResourceLedgerModule,
    AlertModule,
    ApprovalModule,
    // Feed requisitions (Plan B) on /feed-requisition.
    FeedRequisitionModule,
    // Common requisitions (Item / Fixed Asset / Service) on /requisition.
    // Ruling C2 (26 Sep) kept this unregistered so a FEED row could not be
    // approved or changed through the generic routes. Part E Task 13 lifts C2:
    // every generic mutation now refuses doc_type FEED with a 400 pointing to
    // /feed-requisition (assertNotFeedRequisition / assertEditable), and the
    // inbox handler it registers answers REQUISITION requests only — the feed's
    // are FEED_REQUISITION. GET /requisition may list FEED rows, read-only.
    RequisitionModule,
    MilkModule,
    QcParameterModule,
    QcModule,
    QrCodeModule,
    AnimalModule,
    BreedingModule,
  ],
  controllers: [SystemController],
  providers: [],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*path');
  }
}
