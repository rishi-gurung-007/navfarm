// NAVFarm ERP Consolidated Drizzle Schema Definitions
// Target Database: PostgreSQL

import {
  mysqlTable,
  varchar,
  int,
  bigint,
  boolean,
  timestamp,
  date,
  decimal,
  char,
  json,
  text,
  primaryKey,
  foreignKey,
  uniqueIndex,
  index,
  AnyMySqlColumn,
} from 'drizzle-orm/mysql-core';
import { relations, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';

// ==========================================
// 2. COMPANY PROFILE & CONFIGURATION
// ==========================================

export const companyMaster = mysqlTable('company_master', {
  company_id: varchar('company_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
  company_code: varchar('company_code', { length: 20 }).notNull(),
  company_name: varchar('company_name', { length: 200 }).notNull(),
  company_display_name: varchar('company_display_name', { length: 100 }),
  company_type: varchar('company_type', { length: 30 }).notNull(),
  industry_type: varchar('industry_type', { length: 30 }).notNull(),
  registration_no: varchar('registration_no', { length: 100 }),
  tax_id: varchar('tax_id', { length: 100 }),
  tax_regime: varchar('tax_regime', { length: 20 }).default('STANDARD'),
  incorporation_date: date('incorporation_date', { mode: 'string' }),
  financial_year_start: int('financial_year_start').default(4).notNull(),
  base_currency_id: varchar('base_currency_id', { length: 36 }).notNull(),
  default_language_id: varchar('default_language_id', { length: 36 }).notNull(),
  default_timezone_id: varchar('default_timezone_id', {
    length: 100,
  }).notNull(),
  country_id: varchar('country_id', { length: 36 }).notNull(),
  company_logo_url: varchar('company_logo_url', { length: 500 }),
  company_logo_dark_url: varchar('company_logo_dark_url', { length: 500 }),
  primary_color_hex: varchar('primary_color_hex', { length: 7 })
    .default('#1F4E79')
    .notNull(),
  website: varchar('website', { length: 300 }),
  email_domain: varchar('email_domain', { length: 100 }),
  support_email: varchar('support_email', { length: 200 }),
  phone_primary: varchar('phone_primary', { length: 30 }),
  is_multi_farm: boolean('is_multi_farm').default(false).notNull(),
  max_farm_locations: int('max_farm_locations').default(1).notNull(),
  onboarding_status: varchar('onboarding_status', { length: 20 })
    .default('PENDING')
    .notNull(),
  is_active: boolean('is_active').default(true).notNull(),
  created_at: timestamp('created_at', { mode: 'string' })
    .defaultNow()
    .notNull(),
  created_by: varchar('created_by', { length: 36 }),
  updated_at: timestamp('updated_at', { mode: 'string' })
    .defaultNow()
    .notNull(),
  updated_by: varchar('updated_by', { length: 36 }),
  deleted_at: timestamp('deleted_at', { mode: 'string' }),
  extension_config: json('extension_config'),
});

export const companyAddress = mysqlTable('company_address', {
  address_id: varchar('address_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  company_id: varchar('company_id', { length: 36 })
    .notNull()
    .references(() => companyMaster.company_id, { onDelete: 'cascade' }),
  address_type: varchar('address_type', { length: 30 })
    .default('REGISTERED')
    .notNull(),
  address_label: varchar('address_label', { length: 100 }),
  line1: varchar('line1', { length: 200 }).notNull(),
  line2: varchar('line2', { length: 200 }),
  city: varchar('city', { length: 100 }).notNull(),
  state_id: varchar('state_id', { length: 36 }).notNull(),
  country_id: varchar('country_id', { length: 36 }).notNull(),
  pincode: varchar('pincode', { length: 20 }).notNull(),
  gps_latitude: decimal('gps_latitude', { precision: 10, scale: 6 }),
  gps_longitude: decimal('gps_longitude', { precision: 10, scale: 6 }),
  is_primary: boolean('is_primary').default(false).notNull(),
  is_active: boolean('is_active').default(true).notNull(),
});

export const companyContacts = mysqlTable('company_contacts', {
  contact_id: varchar('contact_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  company_id: varchar('company_id', { length: 36 })
    .notNull()
    .references(() => companyMaster.company_id, { onDelete: 'cascade' }),
  contact_type: varchar('contact_type', { length: 30 }).notNull(),
  full_name: varchar('full_name', { length: 200 }).notNull(),
  designation: varchar('designation', { length: 100 }),
  email: varchar('email', { length: 200 }).notNull(),
  phone_primary: varchar('phone_primary', { length: 30 }),
  phone_secondary: varchar('phone_secondary', { length: 30 }),
  receives_alerts: boolean('receives_alerts').default(false).notNull(),
  receives_reports: boolean('receives_reports').default(false).notNull(),
  is_primary: boolean('is_primary').default(false).notNull(),
  is_active: boolean('is_active').default(true).notNull(),
});

export const companyFiscal = mysqlTable('company_fiscal', {
  fiscal_id: varchar('fiscal_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  company_id: varchar('company_id', { length: 36 })
    .notNull()
    .unique()
    .references(() => companyMaster.company_id, { onDelete: 'cascade' }),
  fiscal_year_format: varchar('fiscal_year_format', { length: 20 })
    .default('FY APR MAR')
    .notNull(),
  fiscal_start_month: int('fiscal_start_month').default(4).notNull(),
  fiscal_start_day: int('fiscal_start_day').default(1).notNull(),
  fiscal_end_day: int('fiscal_end_day').default(31).notNull(),
  current_fiscal_year: varchar('current_fiscal_year', { length: 20 }).notNull(),
  period_type: varchar('period_type', { length: 20 })
    .default('MONTHLY')
    .notNull(),
  accounting_standard: varchar('accounting_standard', { length: 20 })
    .default('IND AS')
    .notNull(),
  depreciation_method: varchar('depreciation_method', { length: 30 })
    .default('SLM')
    .notNull(),
  inventory_valuation: varchar('inventory_valuation', { length: 20 })
    .default('STANDARD')
    .notNull(),
  gst_filing_frequency: varchar('gst_filing_frequency', { length: 20 }),
  tax_audit_applicable: boolean('tax_audit_applicable')
    .default(false)
    .notNull(),
  decimal_places: int('decimal_places').default(2).notNull(),
  is_active: boolean('is_active').default(true).notNull(),
});

export const companyModules = mysqlTable('company_modules', {
  module_id: varchar('module_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  company_id: varchar('company_id', { length: 36 })
    .notNull()
    .references(() => companyMaster.company_id, { onDelete: 'cascade' }),
  module_code: varchar('module_code', { length: 50 }).notNull(),
  is_active: boolean('is_active').default(false).notNull(),
  activated_on: date('activated_on', { mode: 'string' }),
  activated_by: varchar('activated_by', { length: 36 }),
  license_expiry: date('license_expiry', { mode: 'string' }),
  config_json: json('config_json'),
});

// ==========================================
// 3. LANGUAGE & LOCALIZATION ENGINE
// ==========================================

export const languageMaster = mysqlTable('language_master', {
  lang_id: varchar('lang_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  lang_code: varchar('lang_code', { length: 10 }).notNull().unique(),
  lang_name_english: varchar('lang_name_english', { length: 100 }).notNull(),
  lang_name_native: varchar('lang_name_native', { length: 100 }).notNull(),
  script: varchar('script', { length: 30 }).notNull(),
  is_rtl: boolean('is_rtl').default(false).notNull(),
  is_system_default: boolean('is_system_default').default(false).notNull(),
  is_active: boolean('is_active').default(true).notNull(),
  translation_coverage_pct: decimal('translation_coverage_pct', {
    precision: 5,
    scale: 2,
  })
    .default('0.00')
    .notNull(),
  date_format: varchar('date_format', { length: 30 })
    .default('DD/MM/YYYY')
    .notNull(),
  number_format: varchar('number_format', { length: 20 })
    .default('IN')
    .notNull(),
  decimal_separator: char('decimal_separator', { length: 1 })
    .default('.')
    .notNull(),
  thousands_separator: char('thousands_separator', { length: 1 })
    .default(',')
    .notNull(),
  flag_emoji: varchar('flag_emoji', { length: 10 }),
});

export const languageTranslations = mysqlTable('language_translations', {
  trans_id: varchar('trans_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  lang_id: varchar('lang_id', { length: 36 })
    .notNull()
    .references(() => languageMaster.lang_id, { onDelete: 'cascade' }),
  module_code: varchar('module_code', { length: 50 }).notNull(),
  translation_key: varchar('translation_key', { length: 200 }).notNull(),
  translation_value: text('translation_value').notNull(),
  is_html: boolean('is_html').default(false).notNull(),
  is_auto_translated: boolean('is_auto_translated').default(false).notNull(),
  verified_by: varchar('verified_by', { length: 36 }),
  updated_at: timestamp('updated_at', { mode: 'string' })
    .defaultNow()
    .notNull(),
});

export const companyLanguageConfig = mysqlTable('company_language_config', {
  config_id: varchar('config_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  company_id: varchar('company_id', { length: 36 })
    .notNull()
    .references(() => companyMaster.company_id, { onDelete: 'cascade' }),
  lang_id: varchar('lang_id', { length: 36 })
    .notNull()
    .references(() => languageMaster.lang_id, { onDelete: 'cascade' }),
  is_default: boolean('is_default').default(false).notNull(),
  is_enabled: boolean('is_enabled').default(true).notNull(),
  set_by: varchar('set_by', { length: 36 }),
  set_at: timestamp('set_at', { mode: 'string' }).defaultNow().notNull(),
});

export const userLanguagePref = mysqlTable('user_language_pref', {
  pref_id: varchar('pref_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  user_id: varchar('user_id', { length: 36 }).notNull(), // reference will be added via relations or ALTER constraint
  lang_id: varchar('lang_id', { length: 36 })
    .notNull()
    .references(() => languageMaster.lang_id, { onDelete: 'restrict' }),
  date_format_override: varchar('date_format_override', { length: 30 }),
  number_format_override: varchar('number_format_override', { length: 20 }),
  is_active: boolean('is_active').default(true).notNull(),
  updated_at: timestamp('updated_at', { mode: 'string' })
    .defaultNow()
    .notNull(),
});

// ==========================================
// 4. CURRENCY & EXCHANGE RATES
// ==========================================

export const currencyMaster = mysqlTable('currency_master', {
  currency_id: varchar('currency_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  iso_code: char('iso_code', { length: 3 }).notNull().unique(),
  currency_name: varchar('currency_name', { length: 100 }).notNull(),
  symbol: varchar('symbol', { length: 5 }).notNull(),
  symbol_position: varchar('symbol_position', { length: 10 })
    .default('PREFIX')
    .notNull(),
  decimal_places: int('decimal_places').default(2).notNull(),
  /**
   * Countries where this currency is legal tender, as ISO alpha-2 codes.
   * An array because one country cannot hold either fact: the euro is a single
   * currency across Germany, France and the Netherlands, and the US dollar is
   * legal tender in Zimbabwe as well as the United States.
   *
   * Codes in a JSON array rather than ids in a join table, matching
   * location_type_master.allowed_parent_types and reason_master.applicable_stages,
   * which are the same shape. country_master.default_currency_id answers the
   * opposite direction — one country's default currency — and is not derived
   * from this, nor this from it.
   */
  country_codes: json('country_codes').$type<string[] | null>(),
  is_system_default: boolean('is_system_default').default(false).notNull(),
  is_active: boolean('is_active').default(true).notNull(),
});

export const exchangeRate = mysqlTable('exchange_rate', {
  rate_id: varchar('rate_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  // Scoped per company, per Rishi: the screen sits in the company-scoped
  // Finance section, so a rate entered in one company must not silently move
  // another company's numbers. Existing rows have none and read as tenant-wide.
  company_id: varchar('company_id', { length: 36 }),
  from_currency_id: varchar('from_currency_id', { length: 36 })
    .notNull()
    .references(() => currencyMaster.currency_id, { onDelete: 'cascade' }),
  to_currency_id: varchar('to_currency_id', { length: 36 })
    .notNull()
    .references(() => currencyMaster.currency_id, { onDelete: 'cascade' }),
  rate: decimal('rate', { precision: 18, scale: 6 }).notNull(),
  rate_date: date('rate_date', { mode: 'string' }).notNull(),
  rate_source: varchar('rate_source', { length: 30 })
    .default('MANUAL')
    .notNull(),
  created_at: timestamp('created_at', { mode: 'string' })
    .defaultNow()
    .notNull(),
});

export const timezoneMaster = mysqlTable('timezone_master', {
  tz_id: varchar('tz_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  tz_code: varchar('tz_code', { length: 60 }).notNull().unique(), // IANA timezone code
  tz_name: varchar('tz_name', { length: 100 }).notNull(),
  utc_offset: varchar('utc_offset', { length: 10 }).notNull(),
  offset_minutes: int('offset_minutes').notNull(),
  is_dst: boolean('is_dst').default(false).notNull(),
  is_active: boolean('is_active').default(true).notNull(),
});

export const countryMaster = mysqlTable(
  'country_master',
  {
    country_id: varchar('country_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    iso2: char('iso2', { length: 2 }).notNull().unique(),
    iso3: char('iso3', { length: 3 }).notNull().unique(),
    country_name: varchar('country_name', { length: 100 }).notNull(),
    phone_code: varchar('phone_code', { length: 10 }),
    default_tz_id: varchar('default_tz_id', { length: 36 }),
    default_currency_id: varchar('default_currency_id', { length: 36 }),
    flag_emoji: varchar('flag_emoji', { length: 10 }),
    is_active: boolean('is_active').default(true).notNull(),
  },
  (table) => ({
    // Explicit short names — the drizzle-default auto-generated name for the
    // currency FK exceeds MySQL's 64-char identifier limit.
    defaultTzFk: foreignKey({
      columns: [table.default_tz_id],
      foreignColumns: [timezoneMaster.tz_id],
      name: 'country_master_default_tz_id_fk',
    }).onDelete('set null'),
    defaultCurrencyFk: foreignKey({
      columns: [table.default_currency_id],
      foreignColumns: [currencyMaster.currency_id],
      name: 'country_master_default_currency_id_fk',
    }).onDelete('set null'),
  }),
);

export const stateProvince = mysqlTable(
  'state_province',
  {
    state_id: varchar('state_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    country_id: varchar('country_id', { length: 36 })
      .notNull()
      .references(() => countryMaster.country_id, { onDelete: 'cascade' }),
    state_code: varchar('state_code', { length: 10 }).notNull(),
    state_name: varchar('state_name', { length: 100 }).notNull(),
    is_active: boolean('is_active').default(true).notNull(),
  },
  (table) => ({
    uqStateCodePerCountry: uniqueIndex('uq_state_province_country_code').on(
      table.country_id,
      table.state_code,
    ),
  }),
);

export const companyCurrencyConfig = mysqlTable(
  'company_currency_config',
  {
    curr_config_id: varchar('curr_config_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    company_id: varchar('company_id', { length: 36 })
      .notNull()
      .references(() => companyMaster.company_id, { onDelete: 'cascade' }),
    currency_id: varchar('currency_id', { length: 36 }).notNull(),
    is_base: boolean('is_base').default(false).notNull(),
    is_reporting: boolean('is_reporting').default(false).notNull(),
    display_order: int('display_order').default(1).notNull(),
  },
  (table) => ({
    currencyFk: foreignKey({
      columns: [table.currency_id],
      foreignColumns: [currencyMaster.currency_id],
      name: 'comp_curr_config_curr_id_fk',
    }).onDelete('restrict'),
  }),
);

// ==========================================
// 5. USERS & Granular RBAC Permissions
// ==========================================

export const userMaster = mysqlTable('user_master', {
  user_id: varchar('user_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  company_id: varchar('company_id', { length: 36 })
    .notNull()
    .references(() => companyMaster.company_id, { onDelete: 'restrict' }),
  tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
  full_name: varchar('full_name', { length: 200 }).notNull(),
  email: varchar('email', { length: 200 }).notNull().unique(),
  phone: varchar('phone', { length: 30 }),
  password_hash: varchar('password_hash', { length: 200 }).notNull(),
  auth_provider: varchar('auth_provider', { length: 20 })
    .default('EMAIL')
    .notNull(),
  auth_provider_id: varchar('auth_provider_id', { length: 200 }),
  mfa_enabled: boolean('mfa_enabled').default(false).notNull(),
  mfa_method: varchar('mfa_method', { length: 20 }),
  mfa_secret: varchar('mfa_secret', { length: 100 }),
  user_type: varchar('user_type', { length: 20 }).default('STAFF').notNull(),
  employee_id: varchar('employee_id', { length: 50 }),
  department: varchar('department', { length: 100 }),
  designation: varchar('designation', { length: 100 }),
  profile_photo_url: varchar('profile_photo_url', { length: 500 }),
  lang_pref_id: varchar('lang_pref_id', { length: 36 }),
  // The UI language code (en/hi/mr/es/fr/bn/te/ta) the Settings page's
  // language selector writes to. Deliberately separate from lang_pref_id
  // (an FK into language_master, which only has en/hi seeded and is used
  // for locale/date-format config elsewhere) — the UI switcher needs to
  // work for all 8 codes regardless of what's seeded in that master table.
  ui_language: varchar('ui_language', { length: 10 }).default('en'),
  timezone_pref_id: varchar('timezone_pref_id', { length: 100 }),
  last_login_at: timestamp('last_login_at', { mode: 'string' }),
  last_login_ip: varchar('last_login_ip', { length: 50 }),
  failed_login_count: int('failed_login_count').default(0).notNull(),
  locked_until: timestamp('locked_until', { mode: 'string' }),
  is_active: boolean('is_active').default(true).notNull(),
  created_at: timestamp('created_at', { mode: 'string' })
    .defaultNow()
    .notNull(),
  invited_by: varchar('invited_by', { length: 36 }),
  deleted_at: timestamp('deleted_at', { mode: 'string' }),
  deleted_by: varchar('deleted_by', { length: 36 }),
});

export const roleMaster = mysqlTable('role_master', {
  role_id: varchar('role_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  company_id: varchar('company_id', { length: 36 })
    .notNull()
    .references(() => companyMaster.company_id, { onDelete: 'cascade' }),
  role_code: varchar('role_code', { length: 50 }).notNull(),
  role_name: varchar('role_name', { length: 100 }).notNull(),
  role_description: text('role_description'),
  is_system_role: boolean('is_system_role').default(false).notNull(),
  is_active: boolean('is_active').default(true).notNull(),
});

export const rolePermissions = mysqlTable('role_permissions', {
  perm_id: varchar('perm_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  role_id: varchar('role_id', { length: 36 })
    .notNull()
    .references(() => roleMaster.role_id, { onDelete: 'cascade' }),
  module_code: varchar('module_code', { length: 50 }).notNull(),
  resource: varchar('resource', { length: 100 }).notNull(),
  can_view: boolean('can_view').default(false).notNull(),
  can_create: boolean('can_create').default(false).notNull(),
  can_edit: boolean('can_edit').default(false).notNull(),
  can_delete: boolean('can_delete').default(false).notNull(),
  can_approve: boolean('can_approve').default(false).notNull(),
  can_export: boolean('can_export').default(false).notNull(),
  can_print: boolean('can_print').default(false).notNull(),
  field_restrictions: json('field_restrictions'),
});

export const userRoleAssignment = mysqlTable('user_role_assignment', {
  assign_id: varchar('assign_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  user_id: varchar('user_id', { length: 36 })
    .notNull()
    .references(() => userMaster.user_id, { onDelete: 'cascade' }),
  role_id: varchar('role_id', { length: 36 })
    .notNull()
    .references(() => roleMaster.role_id, { onDelete: 'restrict' }),
  assigned_by: varchar('assigned_by', { length: 36 }).notNull(),
  assigned_at: timestamp('assigned_at', { mode: 'string' })
    .defaultNow()
    .notNull(),
  expires_at: timestamp('expires_at', { mode: 'string' }),
  is_active: boolean('is_active').default(true).notNull(),
});

export const userCompanyAssignments = mysqlTable(
  'user_company_assignments',
  {
    assign_id: varchar('assign_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    user_id: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => userMaster.user_id, { onDelete: 'cascade' }),
    company_id: varchar('company_id', { length: 36 })
      .notNull()
      .references(() => companyMaster.company_id, { onDelete: 'cascade' }),
    is_primary: boolean('is_primary').default(false).notNull(),
    is_active: boolean('is_active').default(true).notNull(),
    assigned_by: varchar('assigned_by', { length: 36 }).notNull(),
    assigned_at: timestamp('assigned_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('uq_user_company').on(table.user_id, table.company_id),
  ],
);

// Server-side refresh-token sessions, so logout and revocation actually
// invalidate something instead of relying on the client to discard its
// tokens. Access tokens stay stateless (short-lived, 15m) — only the
// longer-lived refresh token is tracked, and only its hash is stored.
export const userSession = mysqlTable(
  'user_session',
  {
    session_id: varchar('session_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    user_id: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => userMaster.user_id, { onDelete: 'cascade' }),
    refresh_token_hash: varchar('refresh_token_hash', { length: 64 }).notNull(),
    issued_at: timestamp('issued_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    expires_at: timestamp('expires_at', { mode: 'string' }).notNull(),
    revoked_at: timestamp('revoked_at', { mode: 'string' }),
  },
  (table) => [
    uniqueIndex('uq_session_token_hash').on(table.refresh_token_hash),
  ],
);

// Per-user, per-category notification channel preferences (Settings page).
// Distinct from notification_config, which holds a company's SMTP/SMS/push
// provider configuration, not any individual's opt-in/opt-out choices.
export const userNotificationPref = mysqlTable(
  'user_notification_pref',
  {
    pref_id: varchar('pref_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    user_id: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => userMaster.user_id, { onDelete: 'cascade' }),
    category: varchar('category', { length: 50 }).notNull(),
    email_enabled: boolean('email_enabled').default(true).notNull(),
    in_app_enabled: boolean('in_app_enabled').default(true).notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('uq_user_notif_category').on(table.user_id, table.category),
  ],
);

// ==========================================
// 6. SETUP WIZARD & NOTIFICATIONS
// ==========================================

export const setupStepMaster = mysqlTable('setup_step_master', {
  step_id: varchar('step_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  step_code: varchar('step_code', { length: 50 }).notNull().unique(),
  step_name: varchar('step_name', { length: 100 }).notNull(),
  step_description: text('step_description'),
  step_order: int('step_order').notNull(),
  is_mandatory: boolean('is_mandatory').default(true).notNull(),
  step_category: varchar('step_category', { length: 30 }).notNull(),
  estimated_minutes: int('estimated_minutes'),
  help_url: varchar('help_url', { length: 300 }),
  is_active: boolean('is_active').default(true).notNull(),
});

export const setupWizardLog = mysqlTable('setup_wizard_log', {
  log_id: varchar('log_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  company_id: varchar('company_id', { length: 36 })
    .notNull()
    .references(() => companyMaster.company_id, { onDelete: 'cascade' }),
  step_id: varchar('step_id', { length: 36 })
    .notNull()
    .references(() => setupStepMaster.step_id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 20 }).default('PENDING').notNull(),
  completed_at: timestamp('completed_at', { mode: 'string' }),
  completed_by: varchar('completed_by', { length: 36 }),
  attempt_count: int('attempt_count').default(0).notNull(),
  data_snapshot: json('data_snapshot'),
  notes: text('notes'),
});

export const notificationConfig = mysqlTable('notification_config', {
  notif_id: varchar('notif_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  company_id: varchar('company_id', { length: 36 })
    .notNull()
    .references(() => companyMaster.company_id, { onDelete: 'cascade' }),
  channel: varchar('channel', { length: 20 }).notNull(),
  is_enabled: boolean('is_enabled').default(true).notNull(),
  smtp_host: varchar('smtp_host', { length: 200 }),
  smtp_port: int('smtp_port'),
  smtp_user: varchar('smtp_user', { length: 200 }),
  smtp_password_enc: text('smtp_password_enc'),
  from_email: varchar('from_email', { length: 200 }),
  from_name: varchar('from_name', { length: 100 }),
  sms_provider: varchar('sms_provider', { length: 30 }),
  sms_api_key_enc: text('sms_api_key_enc'),
  sms_sender_id: varchar('sms_sender_id', { length: 20 }),
  push_fcm_key_enc: text('push_fcm_key_enc'),
  webhook_url: varchar('webhook_url', { length: 500 }),
  webhook_secret_enc: text('webhook_secret_enc'),
  test_sent_at: timestamp('test_sent_at', { mode: 'string' }),
  test_status: varchar('test_status', { length: 20 }),
  is_active: boolean('is_active').default(true).notNull(),
});

// ==========================================
// 7. BUSINESS VERTICALS (NOB / LOB)
// ==========================================

export const nobMaster = mysqlTable('nob_master', {
  nob_id: varchar('nob_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  nob_code: varchar('nob_code', { length: 50 }).notNull().unique(),
  nob_name: varchar('nob_name', { length: 100 }).notNull(),
  default_costing_method: varchar('default_costing_method', { length: 20 })
    .default('STANDARD')
    .notNull(),
  description: text('description'),
  sort_order: int('sort_order'),
  is_system: boolean('is_system').default(false).notNull(),
  is_active: boolean('is_active').default(true).notNull(),
  created_at: date('created_at', { mode: 'string' }),
  updated_at: date('updated_at', { mode: 'string' }),
  extension_config: json('extension_config'),
});

export const lobMaster = mysqlTable('lob_master', {
  lob_id: varchar('lob_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  nob_id: varchar('nob_id', { length: 36 })
    .notNull()
    .references(() => nobMaster.nob_id, { onDelete: 'restrict' }),
  lob_code: varchar('lob_code', { length: 50 }).notNull().unique(),
  lob_name: varchar('lob_name', { length: 100 }).notNull(),
  costing_method_allowed: varchar('costing_method_allowed', {
    length: 100,
  }).notNull(),
  qc_required: varchar('qc_required', { length: 10 }).default('NO').notNull(),
  qr_required: varchar('qr_required', { length: 10 }).default('NO').notNull(),
  batch_copy_allowed: varchar('batch_copy_allowed', { length: 10 })
    .default('NO')
    .notNull(),
  scheduler_copy_allowed: varchar('scheduler_copy_allowed', { length: 10 })
    .default('NO')
    .notNull(),
  traceability_required: varchar('traceability_required', { length: 10 })
    .default('YES')
    .notNull(),
  description: text('description'),
  sort_order: int('sort_order'),
  is_system: boolean('is_system').default(false).notNull(),
  is_active: boolean('is_active').default(true).notNull(),
  created_at: date('created_at', { mode: 'string' }),
  updated_at: date('updated_at', { mode: 'string' }),
  extension_config: json('extension_config'),
});

// Extensible costing methods — "add new methods here, no code change" per spec. Additive
// reference data only: nob_master.default_costing_method / lob_master.costing_method_allowed
// and batch.service.ts's costing_method branches are untouched — they stay free-text/literal
// exactly as they are today. This table exists so those strings have something authoritative
// behind them, not to re-validate against yet.
export const costingMethodConfig = mysqlTable('costing_method_config', {
  method_code: varchar('method_code', { length: 30 }).primaryKey(),
  method_name: varchar('method_name', { length: 100 }).notNull(),
  variance_auto: varchar('variance_auto', { length: 50 }).notNull(), // YES = auto-post variance entries at batch close
  layer_tracking: boolean('layer_tracking').default(false).notNull(), // TRUE = FIFO layer per lot receipt
  bio_asset_support: boolean('bio_asset_support').default(false).notNull(), // TRUE = supports IAS 41 biological asset accounting
  fair_value_option: boolean('fair_value_option').default(false).notNull(),
  amort_option: boolean('amort_option').default(false).notNull(),
  description: text('description'),
  is_system: boolean('is_system').default(false).notNull(), // TRUE = cannot delete
  is_active: boolean('is_active').default(true).notNull(),
});

// ==========================================
// 8. MASTER TABLES (UOM, ITEM, BREED, LOCATION)
// ==========================================

export const uomMaster = mysqlTable(
  'uom_master',
  {
    uom_id: varchar('uom_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 }), // Null for tenant-wide global UOMs
    // NOB/LOB on every master: selectable at company scope, hidden and auto-filled
    // from the active operational area at operational scope (enforceMasterRequest).
    // Nullable — NULL means the record is shared across every business vertical.
    nob_id: varchar('nob_id', { length: 36 }).references(
      () => nobMaster.nob_id,
      { onDelete: 'restrict' },
    ),
    lob_id: varchar('lob_id', { length: 36 }).references(
      () => lobMaster.lob_id,
      { onDelete: 'restrict' },
    ),
    uom_code: varchar('uom_code', { length: 255 }).notNull(),
    uom_name: varchar('uom_name', { length: 100 }).notNull(),
    uom_type: varchar('uom_type', { length: 20 }).notNull(),
    decimal_places: int('decimal_places').default(0).notNull(),
    is_base_uom: boolean('is_base_uom').default(false).notNull(),
    is_active: boolean('is_active').default(true).notNull(),
    status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
    extension_config: json('extension_config'),
    created_by: varchar('created_by', { length: 36 }),
    updated_by: varchar('updated_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { mode: 'string' }),
  },
  (table) => [
    uniqueIndex('uq_uom_master_scope_code').on(
      table.tenant_id,
      sql`(coalesce(${table.company_id}, ''))`,
      table.uom_code,
    ),
  ],
);

export const itemCategoryMaster = mysqlTable(
  'item_category_master',
  {
    category_id: varchar('category_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 }), // null means global tenant-wide category
    // NOB/LOB on every master: selectable at company scope, hidden and auto-filled
    // from the active operational area at operational scope (enforceMasterRequest).
    // Nullable — NULL means the record is shared across every business vertical.
    nob_id: varchar('nob_id', { length: 36 }).references(
      () => nobMaster.nob_id,
      { onDelete: 'restrict' },
    ),
    lob_id: varchar('lob_id', { length: 36 }).references(
      () => lobMaster.lob_id,
      { onDelete: 'restrict' },
    ),
    category_code: varchar('category_code', { length: 255 }).notNull(),
    category_name: varchar('category_name', { length: 100 }).notNull(),
    parent_category_id: varchar('parent_category_id', { length: 36 }),
    // Nullable — links a category to the item_type it belongs under (same string
    // values as item_master.item_type, e.g. 'CONSUMABLE'). Existing categories
    // predate this link and have none; a null item_type means "not yet assigned
    // to a type" rather than "belongs to every type".
    item_type: varchar('item_type', { length: 30 }),
    is_active: boolean('is_active').default(true).notNull(),
    status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
    created_by: varchar('created_by', { length: 36 }),
    updated_by: varchar('updated_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { mode: 'string' }),
    extension_config: json('extension_config'),
  },
  (table) => ({
    uqScopedCode: uniqueIndex('uq_item_category_master_scope_code').on(
      table.tenant_id,
      sql`(coalesce(${table.company_id}, ''))`,
      table.category_code,
    ),
    parentCategoryFk: foreignKey({
      columns: [table.parent_category_id],
      foreignColumns: [table.category_id],
      name: 'item_cat_master_parent_cat_id_fk',
    }).onDelete('restrict'),
    // Not partial (soft-deleted rows still count) — mirrors location_master's
    // uq_location_master_tenant_company_code, the guard the C2 composite-code
    // generator's duplicate-key retry (item-category.service.ts) reacts to.
    uqCategoryCode: uniqueIndex(
      'uq_item_category_master_tenant_company_code',
    ).on(table.tenant_id, table.company_id, table.category_code),
  }),
);

// Item Type classification (RAW_MATERIAL / CONSUMABLE / MEDICINE / ...) as a real, tenant-editable
// master — item_master.item_type stores its type_code (a plain string, same pattern as
// item_master.valuation_method against costing_method_config), not an FK, so existing rows and
// business logic that branches on the literal string are unaffected.
export const itemTypeMaster = mysqlTable(
  'item_type_master',
  {
    item_type_id: varchar('item_type_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 }), // null means global tenant-wide type
    // NOB/LOB on every master: selectable at company scope, hidden and auto-filled
    // from the active operational area at operational scope (enforceMasterRequest).
    // Nullable — NULL means the record is shared across every business vertical.
    nob_id: varchar('nob_id', { length: 36 }).references(
      () => nobMaster.nob_id,
      { onDelete: 'restrict' },
    ),
    lob_id: varchar('lob_id', { length: 36 }).references(
      () => lobMaster.lob_id,
      { onDelete: 'restrict' },
    ),
    type_code: varchar('type_code', { length: 255 }).notNull(),
    type_name: varchar('type_name', { length: 100 }).notNull(),
    // Mirrors location_type_master.code_prefix: the more specific configuration an
    // ITEM_<type_code> series' generated code defers to instead of its own `prefix`
    // (NumberSeriesService.resolveSeriesFor). Defaulted from type_code for existing
    // rows so this is purely additive — no behaviour changes until a caller opts in.
    code_prefix: varchar('code_prefix', { length: 20 }).notNull(),
    description: text('description'),
    is_system: boolean('is_system').default(false).notNull(),
    is_active: boolean('is_active').default(true).notNull(),
    status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
    created_by: varchar('created_by', { length: 36 }),
    updated_by: varchar('updated_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { mode: 'string' }),
    extension_config: json('extension_config'),
  },
  (table) => ({
    uqScopedCode: uniqueIndex('uq_item_type_master_scope_code').on(
      table.tenant_id,
      sql`(coalesce(${table.company_id}, ''))`,
      table.type_code,
    ),
    uqTypeCode: uniqueIndex('uq_item_type_master_tenant_company_code').on(
      table.tenant_id,
      table.company_id,
      table.type_code,
    ),
  }),
);

export const itemMaster = mysqlTable(
  'item_master',
  {
    item_id: varchar('item_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 }),
    category_id: varchar('category_id', { length: 36 }).references(
      () => itemCategoryMaster.category_id,
      { onDelete: 'restrict' },
    ),
    item_code: varchar('item_code', { length: 255 }).notNull(),
    item_name: varchar('item_name', { length: 200 }).notNull(),
    item_type: varchar('item_type', { length: 30 }).notNull(),
    nob_id: varchar('nob_id', { length: 36 }).references(
      () => nobMaster.nob_id,
      { onDelete: 'restrict' },
    ),
    lob_id: varchar('lob_id', { length: 36 }).references(
      () => lobMaster.lob_id,
      { onDelete: 'restrict' },
    ),
    sub_category: varchar('sub_category', { length: 100 }), // Legacy text sub_category field
    uom_primary: varchar('uom_primary', { length: 20 }).notNull(),
    uom_secondary: varchar('uom_secondary', { length: 20 }),
    uom_conversion_factor: decimal('uom_conversion_factor', {
      precision: 18,
      scale: 6,
    }),
    valuation_method: varchar('valuation_method', { length: 20 }),
    // Drives gl_posting_setup's posting_group lookup dimension (Phase 14). Not assumed
    // identical to item_type even though the spec's value list overlaps heavily with it —
    // defaulted from item_type at create time, but independently overridable.
    posting_group: varchar('posting_group', { length: 30 }),
    standard_cost: decimal('standard_cost', { precision: 18, scale: 6 }),
    is_lot_tracked: boolean('is_lot_tracked').default(false).notNull(),
    is_serial_tracked: boolean('is_serial_tracked').default(false).notNull(),
    // Lot/serial number series for this item's tracking numbers — separate from item_code's
    // own 'ITEM' series (item.service.ts).
    // The series lot/serial numbers are drawn from, not a number itself: an item
    // has many lots, so no single lot number is a property of the item. The
    // numbers are recorded per transaction (goods_receipt_line.lot_no,
    // inventory_ledger.lot_no). The foreign key is back with it — it was dropped
    // in 0075 when this briefly held typed text. Rishi's call, 2026-09-08.
    tracking_series_id: varchar('tracking_series_id', {
      length: 36,
    }).references(() => noSeriesMaster.series_id, { onDelete: 'restrict' }),
    is_biological_asset: boolean('is_biological_asset')
      .default(false)
      .notNull(),
    is_biological_costing_method: varchar('is_biological_costing_method', {
      length: 30,
    }),
    is_inventoriable: boolean('is_inventoriable').default(true).notNull(),
    min_stock_level: decimal('min_stock_level', { precision: 18, scale: 4 }),
    max_stock_level: decimal('max_stock_level', { precision: 18, scale: 4 }),
    reorder_level: decimal('reorder_level', { precision: 18, scale: 4 }),
    lead_time_days: int('lead_time_days'),
    shelf_life_days: int('shelf_life_days'),
    storage_temp_min: decimal('storage_temp_min', { precision: 6, scale: 2 }),
    storage_temp_max: decimal('storage_temp_max', { precision: 6, scale: 2 }),
    // Mandatory for MEDICINE/VACCINE per spec — AnimalService.dispose() (Phase 12) blocks a
    // SLAUGHTERED disposal until today minus the animal's last logged administration date
    // (animal_medication_log) is >= withdrawal_days for every such item.
    withdrawal_days: int('withdrawal_days'),
    is_qr_enabled: boolean('is_qr_enabled').default(false).notNull(),
    qr_trigger_event: varchar('qr_trigger_event', { length: 30 }),
    item_image_url: varchar('item_image_url', { length: 500 }),
    // Master Template parity (P2) — GL posting accounts and a hold flag distinct from
    // is_active/status: a blocked item stays visible/historical but cannot be transacted.
    inventory_gl_account: varchar('inventory_gl_account', { length: 36 }),
    cogs_gl_account: varchar('cogs_gl_account', { length: 36 }),
    is_blocked: boolean('is_blocked').default(false).notNull(),
    is_active: boolean('is_active').default(true).notNull(),
    status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
    created_by: varchar('created_by', { length: 36 }),
    updated_by: varchar('updated_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { mode: 'string' }),
    extension_config: json('extension_config'),
  },
  (table) => [
    uniqueIndex('uq_item_master_scope_code').on(
      table.tenant_id,
      sql`(coalesce(${table.company_id}, ''))`,
      table.item_code,
    ),
  ],
);

export const uomConversionMaster = mysqlTable(
  'uom_conversion_master',
  {
    conversion_id: varchar('conversion_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 }),
    // NOB/LOB on every master: selectable at company scope, hidden and auto-filled
    // from the active operational area at operational scope (enforceMasterRequest).
    // Nullable — NULL means the record is shared across every business vertical.
    nob_id: varchar('nob_id', { length: 36 }).references(
      () => nobMaster.nob_id,
      { onDelete: 'restrict' },
    ),
    lob_id: varchar('lob_id', { length: 36 }).references(
      () => lobMaster.lob_id,
      { onDelete: 'restrict' },
    ),
    // Nullable by design: no numbering convention has been supplied for this master
    // yet, so no no_series_master row exists for it. A code may be typed manually
    // today; the moment a series is configured, NumberSeriesService.resolveOptionalCode()
    // starts generating one with no further code change. Existing rows keep NULL.
    conversion_code: varchar('conversion_code', { length: 255 }),
    item_id: varchar('item_id', { length: 36 }).references(
      () => itemMaster.item_id,
      { onDelete: 'cascade' },
    ),
    from_uom: varchar('from_uom', { length: 20 }).notNull(),
    to_uom: varchar('to_uom', { length: 20 }).notNull(),
    conversion_factor: decimal('conversion_factor', {
      precision: 18,
      scale: 8,
    }).notNull(),
    effective_from: date('effective_from', { mode: 'string' }).notNull(),
    effective_to: date('effective_to', { mode: 'string' }),
    is_active: boolean('is_active').default(true).notNull(),
    status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
    created_by: varchar('created_by', { length: 36 }),
    updated_by: varchar('updated_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { mode: 'string' }),
  },
  (table) => [
    uniqueIndex('uq_uom_conversion_master_scope_code').on(
      table.tenant_id,
      sql`(coalesce(${table.company_id}, ''))`,
      table.conversion_code,
    ),
  ],
);

export const itemAttributeMaster = mysqlTable(
  'item_attribute_master',
  {
    attribute_id: varchar('attribute_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 }),
    nob_id: varchar('nob_id', { length: 36 }).references(
      () => nobMaster.nob_id,
      { onDelete: 'cascade' },
    ),
    lob_id: varchar('lob_id', { length: 36 }).references(
      () => lobMaster.lob_id,
      { onDelete: 'cascade' },
    ),
    attribute_code: varchar('attribute_code', { length: 255 }).notNull(),
    attribute_name: varchar('attribute_name', { length: 100 }).notNull(),
    data_type: varchar('data_type', { length: 20 }).notNull(), // STRING, NUMBER, BOOLEAN, LIST
    list_values: json('list_values'),
    unit: varchar('unit', { length: 20 }),
    is_mandatory: boolean('is_mandatory').default(false).notNull(),
    affects_costing: boolean('affects_costing').default(false).notNull(),
    is_variant: boolean('is_variant').default(false).notNull(),
    is_active: boolean('is_active').default(true).notNull(),
    status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
    created_by: varchar('created_by', { length: 36 }),
    updated_by: varchar('updated_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { mode: 'string' }),
  },
  (table) => [
    uniqueIndex('uq_item_attribute_master_scope_code').on(
      table.tenant_id,
      sql`(coalesce(${table.company_id}, ''))`,
      table.attribute_code,
    ),
  ],
);

export const itemAttributeValues = mysqlTable(
  'item_attribute_values',
  {
    value_id: varchar('value_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    item_id: varchar('item_id', { length: 36 })
      .notNull()
      .references(() => itemMaster.item_id, { onDelete: 'cascade' }),
    attribute_id: varchar('attribute_id', { length: 36 }).notNull(),
    attribute_value: text('attribute_value').notNull(),
  },
  (table) => ({
    attributeFk: foreignKey({
      columns: [table.attribute_id],
      foreignColumns: [itemAttributeMaster.attribute_id],
      name: 'item_attr_vals_attr_id_fk',
    }).onDelete('restrict'),
  }),
);

export const speciesMaster = mysqlTable(
  'species_master',
  {
    species_id: varchar('species_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 }),
    // NOB/LOB on every master: selectable at company scope, hidden and auto-filled
    // from the active operational area at operational scope (enforceMasterRequest).
    // Nullable — NULL means the record is shared across every business vertical.
    nob_id: varchar('nob_id', { length: 36 }).references(
      () => nobMaster.nob_id,
      { onDelete: 'restrict' },
    ),
    lob_id: varchar('lob_id', { length: 36 }).references(
      () => lobMaster.lob_id,
      { onDelete: 'restrict' },
    ),
    species_code: varchar('species_code', { length: 255 }).notNull(),
    species_name: varchar('species_name', { length: 100 }).notNull(),
    status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
    is_active: boolean('is_active').default(true).notNull(),
    created_by: varchar('created_by', { length: 36 }),
    updated_by: varchar('updated_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { mode: 'string' }),
  },
  (table) => [
    uniqueIndex('uq_species_master_scope_code').on(
      table.tenant_id,
      sql`(coalesce(${table.company_id}, ''))`,
      table.species_code,
    ),
  ],
);

export const breedMaster = mysqlTable(
  'breed_master',
  {
    breed_id: varchar('breed_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 }),
    nob_id: varchar('nob_id', { length: 36 })
      .notNull()
      .references(() => nobMaster.nob_id, { onDelete: 'restrict' }),
    lob_id: varchar('lob_id', { length: 36 }).references(
      () => lobMaster.lob_id,
      { onDelete: 'restrict' },
    ),
    location_id: varchar('location_id', { length: 36 }).references(
      (): AnyMySqlColumn => locationMaster.location_id,
      { onDelete: 'restrict' },
    ),
    breed_code: varchar('breed_code', { length: 255 }).notNull(),
    breed_name: varchar('breed_name', { length: 100 }).notNull(),
    species_id: varchar('species_id', { length: 36 }).references(
      () => speciesMaster.species_id,
      { onDelete: 'restrict' },
    ),
    species: varchar('species', { length: 100 }), // Legacy text field (nullable now)
    breed_type: varchar('breed_type', { length: 50 }).notNull(), // BROILER/LAYER/BREEDER/DUAL_PURPOSE/DAIRY/BEEF/TREE/FISH
    avg_growth_rate_g_day: decimal('avg_growth_rate_g_day', {
      precision: 10,
      scale: 4,
    }),
    avg_fcr: decimal('avg_fcr', { precision: 8, scale: 4 }),
    avg_mortality_pct: decimal('avg_mortality_pct', { precision: 6, scale: 2 }),
    avg_lay_rate_pct: decimal('avg_lay_rate_pct', { precision: 6, scale: 2 }),
    incubation_days: int('incubation_days'),
    gestation_days: int('gestation_days'),
    avg_litter_size: decimal('avg_litter_size', { precision: 6, scale: 2 }),
    mature_age_months: int('mature_age_months'),
    productive_life_months: int('productive_life_months'),
    premature_years: decimal('premature_years', { precision: 5, scale: 2 }),
    avg_yield_per_unit: decimal('avg_yield_per_unit', {
      precision: 10,
      scale: 4,
    }),
    // Piggery-specific fields below — nullable/additive, unused by non-piggery breeds.
    lactation_days: int('lactation_days'),
    residual_value_pct: decimal('residual_value_pct', {
      precision: 5,
      scale: 2,
    }),
    productive_life_cycles: int('productive_life_cycles'),
    avg_litter_size_born: decimal('avg_litter_size_born', {
      precision: 6,
      scale: 2,
    }),
    avg_litter_size_weaned: decimal('avg_litter_size_weaned', {
      precision: 6,
      scale: 2,
    }),
    avg_weaning_weight_kg: decimal('avg_weaning_weight_kg', {
      precision: 6,
      scale: 3,
    }),
    farrowing_rate_pct: decimal('farrowing_rate_pct', {
      precision: 5,
      scale: 2,
    }),
    boar_doses_per_week: decimal('boar_doses_per_week', {
      precision: 5,
      scale: 2,
    }),
    boar_productive_life_months: int('boar_productive_life_months'),
    age_labels: json('age_labels'),
    description: text('description'),
    // Master Template parity (P2) — a hold flag distinct from is_active/status.
    is_blocked: boolean('is_blocked').default(false).notNull(),
    is_active: boolean('is_active').default(true).notNull(),
    status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
    created_by: varchar('created_by', { length: 36 }),
    updated_by: varchar('updated_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { mode: 'string' }),
    extension_config: json('extension_config'),
  },
  (table) => [
    uniqueIndex('uq_breed_master_scope_code').on(
      table.tenant_id,
      sql`(coalesce(${table.company_id}, ''))`,
      table.breed_code,
    ),
  ],
);

export const operationalAreaMaster = mysqlTable('operational_area_master', {
  area_id: varchar('area_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
  company_id: varchar('company_id', { length: 36 })
    .notNull()
    .references(() => companyMaster.company_id, { onDelete: 'restrict' }),
  farm_id: varchar('farm_id', { length: 36 }).references(
    () => locationMaster.location_id,
    { onDelete: 'restrict' },
  ),
  nob_id: varchar('nob_id', { length: 36 })
    .notNull()
    .references(() => nobMaster.nob_id, { onDelete: 'restrict' }),
  lob_id: varchar('lob_id', { length: 36 })
    .notNull()
    .references(() => lobMaster.lob_id, { onDelete: 'restrict' }),
  area_code: varchar('area_code', { length: 50 }).notNull(),
  area_name: varchar('area_name', { length: 150 }).notNull(),
  description: text('description'),
  preseed_source: varchar('preseed_source', { length: 50 })
    .default('TENANT')
    .notNull(), // TENANT, COMPANY, NONE
  is_active: boolean('is_active').default(true).notNull(),
  status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
  created_by: varchar('created_by', { length: 36 }),
  updated_by: varchar('updated_by', { length: 36 }),
  created_at: timestamp('created_at', { mode: 'string' })
    .defaultNow()
    .notNull(),
  updated_at: timestamp('updated_at', { mode: 'string' })
    .defaultNow()
    .notNull(),
  deleted_at: timestamp('deleted_at', { mode: 'string' }),
  extension_config: json('extension_config'),
});

export const userOperationalAreaAssignment = mysqlTable(
  'user_operational_area_assignment',
  {
    assignment_id: varchar('assignment_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    user_id: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => userMaster.user_id, { onDelete: 'cascade' }),
    area_id: varchar('area_id', { length: 36 })
      .notNull()
      .references(() => operationalAreaMaster.area_id, { onDelete: 'cascade' }),
    company_id: varchar('company_id', { length: 36 })
      .notNull()
      .references(() => companyMaster.company_id, { onDelete: 'cascade' }),
    is_primary: boolean('is_primary').default(true).notNull(),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
  },
);

// User-maintainable location classifications. The code is semantic (FARM,
// SHED, PEN, ...); code_prefix controls the immutable sequential identity of
// locations created with that classification (FARM-001, SHED-001, ...).
export const locationTypeMaster = mysqlTable(
  'location_type_master',
  {
    location_type_id: varchar('location_type_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 }), // null = tenant-wide
    // NOB/LOB on every master: selectable at company scope, hidden and auto-filled
    // from the active operational area at operational scope (enforceMasterRequest).
    // Nullable — NULL means the record is shared across every business vertical.
    nob_id: varchar('nob_id', { length: 36 }).references(
      () => nobMaster.nob_id,
      { onDelete: 'restrict' },
    ),
    lob_id: varchar('lob_id', { length: 36 }).references(
      () => lobMaster.lob_id,
      { onDelete: 'restrict' },
    ),
    type_code: varchar('type_code', { length: 255 }).notNull(),
    type_name: varchar('type_name', { length: 100 }).notNull(),
    code_prefix: varchar('code_prefix', { length: 20 }).notNull(),
    allowed_parent_types: json('allowed_parent_types')
      .$type<string[]>()
      .notNull(),
    is_system: boolean('is_system').default(false).notNull(),
    is_active: boolean('is_active').default(true).notNull(),
    status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
    created_by: varchar('created_by', { length: 36 }),
    updated_by: varchar('updated_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { mode: 'string' }),
  },
  (table) => ({
    uqScopedCode: uniqueIndex('uq_location_type_master_scope_code').on(
      table.tenant_id,
      sql`(coalesce(${table.company_id}, ''))`,
      table.type_code,
    ),
    uqLocationTypeCode: uniqueIndex('uq_location_type_tenant_company_code').on(
      table.tenant_id,
      table.company_id,
      table.type_code,
    ),
  }),
);

export const locationMaster = mysqlTable(
  'location_master',
  {
    location_id: varchar('location_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 }),
    nob_id: varchar('nob_id', { length: 36 }).references(
      () => nobMaster.nob_id,
      { onDelete: 'restrict' },
    ),
    lob_id: varchar('lob_id', { length: 36 }).references(
      () => lobMaster.lob_id,
      { onDelete: 'restrict' },
    ),
    // Compatibility ancestry for operational modules that still use the legacy
    // Farm/Shed/Warehouse tables. parent_location_id is the canonical hierarchy.
    farm_id: varchar('farm_id', { length: 36 }),
    shed_id: varchar('shed_id', { length: 36 }),
    warehouse_id: varchar('warehouse_id', { length: 36 }).references(
      () => locationMaster.location_id,
      { onDelete: 'restrict' },
    ),
    location_code: varchar('location_code', { length: 255 }).notNull(),
    location_name: varchar('location_name', { length: 200 }).notNull(),
    location_address: varchar('location_address', { length: 500 }),
    location_level: int('location_level').notNull(),
    location_type: varchar('location_type', { length: 50 }).notNull(), // FARM, SHED, AREA, SECTION, PEN, SILO etc.
    parent_location_id: varchar('parent_location_id', { length: 36 }),
    area_size: decimal('area_size', { precision: 18, scale: 4 }),
    area_unit: varchar('area_unit', { length: 10 }),
    max_capacity: decimal('max_capacity', { precision: 18, scale: 4 }),
    capacity_uom: varchar('capacity_uom', { length: 20 }),
    current_count: decimal('current_count', { precision: 18, scale: 4 })
      .default('0.00')
      .notNull(),
    gps_latitude: decimal('gps_latitude', { precision: 10, scale: 8 }),
    gps_longitude: decimal('gps_longitude', { precision: 11, scale: 8 }),
    storage_type: varchar('storage_type', { length: 30 }),
    // The silo or store's own name-number, as the Location Master templates carry
    // it: MULTIPLIER writes MGH1 against each grower house, Porta writes PSL FS -
    // 01 and STORE. storage_type says which kind it is; this says which one.
    storage_name: varchar('storage_name', { length: 100 }),
    // Whether feed is delivered to this location in bags rather than blown into a
    // silo. Both templates carry it per location, and the breed lifecycle sheets
    // read it: a stage's feed is "bagged" at MFH and "Bulk" at MSL.
    feed_in_bags: boolean('feed_in_bags'),
    is_quarantine_zone: boolean('is_quarantine_zone').default(false).notNull(),
    // Maximum feed capacity of this Silo in KG. Required when location_type = SILO.
    silo_capacity_kg: decimal('silo_capacity_kg', { precision: 12, scale: 2 }),
    // Alert when silo stock covers less than this many days of consumption. Required when location_type = SILO.
    silo_reorder_days: int('silo_reorder_days'),
    // Mandatory empty days between batches at this location for biosecurity.
    downtime_days_required: int('downtime_days_required'),
    last_cleaned_date: date('last_cleaned_date', { mode: 'string' }),
    last_disinfected_date: date('last_disinfected_date', { mode: 'string' }),
    is_active: boolean('is_active').default(true).notNull(),
    status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
    created_by: varchar('created_by', { length: 36 }),
    updated_by: varchar('updated_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { mode: 'string' }),
    extension_config: json('extension_config'),
  },
  (table) => ({
    uqScopedCode: uniqueIndex('uq_location_master_scope_code').on(
      table.tenant_id,
      sql`(coalesce(${table.company_id}, ''))`,
      table.location_code,
    ),
    parentLocationFk: foreignKey({
      columns: [table.parent_location_id],
      foreignColumns: [table.location_id],
      name: 'loc_master_parent_loc_id_fk',
    }).onDelete('restrict'),
    farmFk: foreignKey({
      columns: [table.farm_id],
      foreignColumns: [locationMaster.location_id],
      name: 'loc_master_farm_id_fk',
    }).onDelete('restrict'),
    shedFk: foreignKey({
      columns: [table.shed_id],
      foreignColumns: [locationMaster.location_id],
      name: 'loc_master_shed_id_fk',
    }).onDelete('restrict'),
    uqLocationCode: uniqueIndex('uq_location_master_tenant_company_code').on(
      table.tenant_id,
      table.company_id,
      table.location_code,
    ),
  }),
);

// ==========================================
// DRIZZLE SCHEMA RELATIONSHIPS
// ==========================================

export const companyMasterRelations = relations(
  companyMaster,
  ({ one, many }) => ({
    addresses: many(companyAddress),
    contacts: many(companyContacts),
    fiscal: one(companyFiscal, {
      fields: [companyMaster.company_id],
      references: [companyFiscal.company_id],
    }),
    modules: many(companyModules),
    users: many(userMaster),
    roles: many(roleMaster),
    languages: many(companyLanguageConfig),
    currencies: many(companyCurrencyConfig),
  }),
);

export const companyAddressRelations = relations(companyAddress, ({ one }) => ({
  company: one(companyMaster, {
    fields: [companyAddress.company_id],
    references: [companyMaster.company_id],
  }),
}));

export const companyContactsRelations = relations(
  companyContacts,
  ({ one }) => ({
    company: one(companyMaster, {
      fields: [companyContacts.company_id],
      references: [companyMaster.company_id],
    }),
  }),
);

export const companyFiscalRelations = relations(companyFiscal, ({ one }) => ({
  company: one(companyMaster, {
    fields: [companyFiscal.company_id],
    references: [companyMaster.company_id],
  }),
}));

export const companyModulesRelations = relations(companyModules, ({ one }) => ({
  company: one(companyMaster, {
    fields: [companyModules.company_id],
    references: [companyMaster.company_id],
  }),
}));

export const userMasterRelations = relations(userMaster, ({ one, many }) => ({
  company: one(companyMaster, {
    fields: [userMaster.company_id],
    references: [companyMaster.company_id],
  }),
  roleAssignments: many(userRoleAssignment),
}));

export const roleMasterRelations = relations(roleMaster, ({ one, many }) => ({
  company: one(companyMaster, {
    fields: [roleMaster.company_id],
    references: [companyMaster.company_id],
  }),
  permissions: many(rolePermissions),
  assignments: many(userRoleAssignment),
}));

export const rolePermissionsRelations = relations(
  rolePermissions,
  ({ one }) => ({
    role: one(roleMaster, {
      fields: [rolePermissions.role_id],
      references: [roleMaster.role_id],
    }),
  }),
);

export const userRoleAssignmentRelations = relations(
  userRoleAssignment,
  ({ one }) => ({
    user: one(userMaster, {
      fields: [userRoleAssignment.user_id],
      references: [userMaster.user_id],
    }),
    role: one(roleMaster, {
      fields: [userRoleAssignment.role_id],
      references: [roleMaster.role_id],
    }),
  }),
);

export const userCompanyAssignmentsRelations = relations(
  userCompanyAssignments,
  ({ one }) => ({
    user: one(userMaster, {
      fields: [userCompanyAssignments.user_id],
      references: [userMaster.user_id],
    }),
    company: one(companyMaster, {
      fields: [userCompanyAssignments.company_id],
      references: [companyMaster.company_id],
    }),
  }),
);

export const itemCategoryMasterRelations = relations(
  itemCategoryMaster,
  ({ one, many }) => ({
    parent: one(itemCategoryMaster, {
      fields: [itemCategoryMaster.parent_category_id],
      references: [itemCategoryMaster.category_id],
      relationName: 'parentCategory',
    }),
    items: many(itemMaster),
  }),
);

export const itemMasterRelations = relations(itemMaster, ({ one, many }) => ({
  nob: one(nobMaster, {
    fields: [itemMaster.nob_id],
    references: [nobMaster.nob_id],
  }),
  lob: one(lobMaster, {
    fields: [itemMaster.lob_id],
    references: [lobMaster.lob_id],
  }),
  category: one(itemCategoryMaster, {
    fields: [itemMaster.category_id],
    references: [itemCategoryMaster.category_id],
  }),
  attributes: many(itemAttributeValues),
}));

export const itemAttributeMasterRelations = relations(
  itemAttributeMaster,
  ({ many }) => ({
    values: many(itemAttributeValues),
  }),
);

export const itemAttributeValuesRelations = relations(
  itemAttributeValues,
  ({ one }) => ({
    item: one(itemMaster, {
      fields: [itemAttributeValues.item_id],
      references: [itemMaster.item_id],
    }),
    attribute: one(itemAttributeMaster, {
      fields: [itemAttributeValues.attribute_id],
      references: [itemAttributeMaster.attribute_id],
    }),
  }),
);

export const speciesMasterRelations = relations(speciesMaster, ({ many }) => ({
  breeds: many(breedMaster),
}));

export const breedMasterRelations = relations(breedMaster, ({ one }) => ({
  nob: one(nobMaster, {
    fields: [breedMaster.nob_id],
    references: [nobMaster.nob_id],
  }),
  lob: one(lobMaster, {
    fields: [breedMaster.lob_id],
    references: [lobMaster.lob_id],
  }),
  species: one(speciesMaster, {
    fields: [breedMaster.species_id],
    references: [speciesMaster.species_id],
  }),
}));

export const locationMasterRelations = relations(locationMaster, ({ one }) => ({
  nob: one(nobMaster, {
    fields: [locationMaster.nob_id],
    references: [nobMaster.nob_id],
  }),
  lob: one(lobMaster, {
    fields: [locationMaster.lob_id],
    references: [lobMaster.lob_id],
  }),
  warehouse: one(locationMaster, {
    fields: [locationMaster.warehouse_id],
    references: [locationMaster.location_id],
    relationName: 'location_warehouse',
  }),
  parent: one(locationMaster, {
    fields: [locationMaster.parent_location_id],
    references: [locationMaster.location_id],
    relationName: 'parentLocation',
  }),
}));

export const operationalAreaMasterRelations = relations(
  operationalAreaMaster,
  ({ one, many }) => ({
    company: one(companyMaster, {
      fields: [operationalAreaMaster.company_id],
      references: [companyMaster.company_id],
    }),
    farm: one(locationMaster, {
      fields: [operationalAreaMaster.farm_id],
      references: [locationMaster.location_id],
    }),
    nob: one(nobMaster, {
      fields: [operationalAreaMaster.nob_id],
      references: [nobMaster.nob_id],
    }),
    lob: one(lobMaster, {
      fields: [operationalAreaMaster.lob_id],
      references: [lobMaster.lob_id],
    }),
    userAssignments: many(userOperationalAreaAssignment),
    batches: many(batchHeader),
  }),
);

export const userOperationalAreaAssignmentRelations = relations(
  userOperationalAreaAssignment,
  ({ one }) => ({
    user: one(userMaster, {
      fields: [userOperationalAreaAssignment.user_id],
      references: [userMaster.user_id],
    }),
    operationalArea: one(operationalAreaMaster, {
      fields: [userOperationalAreaAssignment.area_id],
      references: [operationalAreaMaster.area_id],
    }),
    company: one(companyMaster, {
      fields: [userOperationalAreaAssignment.company_id],
      references: [companyMaster.company_id],
    }),
  }),
);

export const supplierMaster = mysqlTable(
  'supplier_master',
  {
    supplier_id: varchar('supplier_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 }).references(
      () => companyMaster.company_id,
      { onDelete: 'restrict' },
    ),
    // NOB/LOB on every master: selectable at company scope, hidden and auto-filled
    // from the active operational area at operational scope (enforceMasterRequest).
    // Nullable — NULL means the record is shared across every business vertical.
    nob_id: varchar('nob_id', { length: 36 }).references(
      () => nobMaster.nob_id,
      { onDelete: 'restrict' },
    ),
    lob_id: varchar('lob_id', { length: 36 }).references(
      () => lobMaster.lob_id,
      { onDelete: 'restrict' },
    ),
    supplier_code: varchar('supplier_code', { length: 255 }).notNull(),
    supplier_name: varchar('supplier_name', { length: 150 }).notNull(),
    email: varchar('email', { length: 200 }),
    phone: varchar('phone', { length: 30 }),
    tax_number: varchar('tax_number', { length: 50 }),
    payment_terms: varchar('payment_terms', { length: 50 }), // e.g. COD, NET30
    address_line1: varchar('address_line1', { length: 255 }),
    city: varchar('city', { length: 100 }),
    state: varchar('state', { length: 100 }),
    country: varchar('country', { length: 100 }),
    pincode: varchar('pincode', { length: 20 }),
    // Piggery-specific fields below — nullable/additive, unused by generic suppliers.
    vendor_type: varchar('vendor_type', { length: 30 })
      .default('GENERAL')
      .notNull(), // ANIMAL_SUPPLIER, BREEDING_FARM, SEMEN_SUPPLIER, FEED_SUPPLIER, MEDICINE_SUPPLIER, EQUIPMENT_SUPPLIER, SERVICES, GENERAL
    is_approved: boolean('is_approved').default(false).notNull(),
    approved_by: varchar('approved_by', { length: 36 }).references(
      () => userMaster.user_id,
      { onDelete: 'restrict' },
    ),
    approved_at: timestamp('approved_at', { mode: 'string' }),
    health_cert_url: varchar('health_cert_url', { length: 500 }), // required for ANIMAL_SUPPLIER — checked at GRN post
    breeding_farm_code: varchar('breeding_farm_code', { length: 50 }), // required for ANIMAL_SUPPLIER / BREEDING_FARM
    // Ciphertext only — see encryption.service.ts. Never read back in plaintext over the API.
    bank_account_no_enc: text('bank_account_no_enc'),
    bank_ifsc: varchar('bank_ifsc', { length: 20 }),
    credit_limit: decimal('credit_limit', { precision: 18, scale: 4 }),
    is_active: boolean('is_active').default(true).notNull(),
    status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
    created_by: varchar('created_by', { length: 36 }),
    updated_by: varchar('updated_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { mode: 'string' }),
    extension_config: json('extension_config'),
  },
  (table) => [
    uniqueIndex('uq_supplier_master_scope_code').on(
      table.tenant_id,
      sql`(coalesce(${table.company_id}, ''))`,
      table.supplier_code,
    ),
  ],
);

export const supplierMasterRelations = relations(supplierMaster, ({ one }) => ({
  company: one(companyMaster, {
    fields: [supplierMaster.company_id],
    references: [companyMaster.company_id],
  }),
}));

export const customerMaster = mysqlTable(
  'customer_master',
  {
    customer_id: varchar('customer_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 }).references(
      () => companyMaster.company_id,
      { onDelete: 'restrict' },
    ),
    // NOB/LOB on every master: selectable at company scope, hidden and auto-filled
    // from the active operational area at operational scope (enforceMasterRequest).
    // Nullable — NULL means the record is shared across every business vertical.
    nob_id: varchar('nob_id', { length: 36 }).references(
      () => nobMaster.nob_id,
      { onDelete: 'restrict' },
    ),
    lob_id: varchar('lob_id', { length: 36 }).references(
      () => lobMaster.lob_id,
      { onDelete: 'restrict' },
    ),
    customer_code: varchar('customer_code', { length: 255 }).notNull(),
    customer_name: varchar('customer_name', { length: 150 }).notNull(),
    email: varchar('email', { length: 200 }),
    mobile: varchar('mobile', { length: 30 }).notNull(),
    tax_number: varchar('tax_number', { length: 50 }),
    credit_limit: decimal('credit_limit', { precision: 18, scale: 4 }),
    address_line1: varchar('address_line1', { length: 255 }),
    city: varchar('city', { length: 100 }),
    state: varchar('state', { length: 100 }),
    country: varchar('country', { length: 100 }),
    pincode: varchar('pincode', { length: 20 }),
    is_active: boolean('is_active').default(true).notNull(),
    status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
    created_by: varchar('created_by', { length: 36 }),
    updated_by: varchar('updated_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { mode: 'string' }),
    extension_config: json('extension_config'),
  },
  (table) => [
    uniqueIndex('uq_customer_master_scope_code').on(
      table.tenant_id,
      sql`(coalesce(${table.company_id}, ''))`,
      table.customer_code,
    ),
  ],
);

export const customerMasterRelations = relations(customerMaster, ({ one }) => ({
  company: one(companyMaster, {
    fields: [customerMaster.company_id],
    references: [companyMaster.company_id],
  }),
}));

export const resourceMaster = mysqlTable(
  'resource_master',
  {
    resource_id: varchar('resource_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 }),
    resource_code: varchar('resource_code', { length: 255 }).notNull(),
    resource_name: varchar('resource_name', { length: 150 }).notNull(),
    resource_type: varchar('resource_type', { length: 30 }).notNull(), // LABOR, EQUIPMENT, VEHICLE
    nob_id: varchar('nob_id', { length: 36 }), // NOB scope (null = available across all NOBs)
    lob_id: varchar('lob_id', { length: 36 }), // LOB scope (null = not LOB-restricted)
    resource_sub_type: varchar('resource_sub_type', { length: 50 }), // PERMANENT/CONTRACT/DAILY (labor); OWNED/LEASED/RENTED (equipment)
    employee_id: varchar('employee_id', { length: 50 }), // HR employee ID (manpower resources only)
    designation: varchar('designation', { length: 100 }), // Job title (manpower resources only)
    capacity: decimal('capacity', { precision: 18, scale: 4 }),
    capacity_uom: varchar('capacity_uom', { length: 20 }),
    unit: varchar('unit', { length: 20 }),
    cost_rate: decimal('cost_rate', { precision: 18, scale: 4 }),
    asset_code: varchar('asset_code', { length: 50 }),
    asset_make: varchar('asset_make', { length: 100 }),
    asset_model: varchar('asset_model', { length: 100 }),
    asset_serial_no: varchar('asset_serial_no', { length: 100 }),
    purchase_date: date('purchase_date', { mode: 'string' }),
    warranty_expiry_date: date('warranty_expiry_date', { mode: 'string' }),
    maintenance_frequency_days: int('maintenance_frequency_days'),
    last_maintenance_date: date('last_maintenance_date', { mode: 'string' }),
    next_maintenance_date: date('next_maintenance_date', { mode: 'string' }),
    maintenance_cost_per_service: decimal('maintenance_cost_per_service', {
      precision: 18,
      scale: 4,
    }),
    maintenance_vendor: varchar('maintenance_vendor', { length: 200 }),
    // Master Template parity (P2).
    gl_cost_account: varchar('gl_cost_account', { length: 36 }),
    department: varchar('department', { length: 100 }),
    cost_element: varchar('cost_element', { length: 50 }),
    license_expiry: date('license_expiry', { mode: 'string' }),
    is_active: boolean('is_active').default(true).notNull(),
    status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
    created_by: varchar('created_by', { length: 36 }),
    updated_by: varchar('updated_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { mode: 'string' }),
    extension_config: json('extension_config'),
  },
  (table) => ({
    uqScopedCode: uniqueIndex('uq_resource_master_scope_code').on(
      table.tenant_id,
      sql`(coalesce(${table.company_id}, ''))`,
      table.resource_code,
    ),
    companyFk: foreignKey({
      columns: [table.company_id],
      foreignColumns: [companyMaster.company_id],
      name: 'res_master_company_id_fk',
    }).onDelete('restrict'),
    nobFk: foreignKey({
      columns: [table.nob_id],
      foreignColumns: [nobMaster.nob_id],
      name: 'res_master_nob_id_fk',
    }).onDelete('restrict'),
    lobFk: foreignKey({
      columns: [table.lob_id],
      foreignColumns: [lobMaster.lob_id],
      name: 'res_master_lob_id_fk',
    }).onDelete('restrict'),
  }),
);

export const resourceMaintenanceLog = mysqlTable(
  'resource_maintenance_log',
  {
    log_id: varchar('log_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 }).notNull(),
    resource_id: varchar('resource_id', { length: 36 }).notNull(),
    maintenance_date: date('maintenance_date', { mode: 'string' }).notNull(),
    maintenance_type: varchar('maintenance_type', { length: 50 }).notNull(), // PREVENTIVE, BREAKDOWN
    description: text('description'),
    cost: decimal('cost', { precision: 18, scale: 4 }),
    performed_by: varchar('performed_by', { length: 100 }),
    status: varchar('status', { length: 20 }).default('COMPLETED').notNull(),
    created_by: varchar('created_by', { length: 36 }),
    updated_by: varchar('updated_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { mode: 'string' }),
    extension_config: json('extension_config'),
  },
  (table) => ({
    companyFk: foreignKey({
      columns: [table.company_id],
      foreignColumns: [companyMaster.company_id],
      name: 'res_maint_log_company_id_fk',
    }).onDelete('restrict'),
    resourceFk: foreignKey({
      columns: [table.resource_id],
      foreignColumns: [resourceMaster.resource_id],
      name: 'res_maint_log_res_id_fk',
    }).onDelete('cascade'),
  }),
);

export const resourceMasterRelations = relations(
  resourceMaster,
  ({ one, many }) => ({
    company: one(companyMaster, {
      fields: [resourceMaster.company_id],
      references: [companyMaster.company_id],
    }),
    maintenanceLogs: many(resourceMaintenanceLog),
  }),
);

export const resourceMaintenanceLogRelations = relations(
  resourceMaintenanceLog,
  ({ one }) => ({
    resource: one(resourceMaster, {
      fields: [resourceMaintenanceLog.resource_id],
      references: [resourceMaster.resource_id],
    }),
  }),
);

export const reasonMaster = mysqlTable(
  'reason_master',
  {
    reason_id: varchar('reason_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 }).references(
      () => companyMaster.company_id,
      { onDelete: 'restrict' },
    ),
    // NOB/LOB on every master: selectable at company scope, hidden and auto-filled
    // from the active operational area at operational scope (enforceMasterRequest).
    // Nullable — NULL means the record is shared across every business vertical.
    nob_id: varchar('nob_id', { length: 36 }).references(
      () => nobMaster.nob_id,
      { onDelete: 'restrict' },
    ),
    lob_id: varchar('lob_id', { length: 36 }).references(
      () => lobMaster.lob_id,
      { onDelete: 'restrict' },
    ),
    reason_code: varchar('reason_code', { length: 255 }).notNull(),
    reason_name: varchar('reason_name', { length: 150 }).notNull(),
    category: varchar('category', { length: 20 }).notNull(),
    applicable_stages: json('applicable_stages').$type<string[] | null>(),
    mandatory_weight: boolean('mandatory_weight').default(false).notNull(),
    is_active: boolean('is_active').default(true).notNull(),
    status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
    created_by: varchar('created_by', { length: 36 }),
    updated_by: varchar('updated_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { mode: 'string' }),
  },
  (table) => [
    uniqueIndex('uq_reason_scope_code').on(
      table.tenant_id,
      sql`(coalesce(${table.company_id}, ''))`,
      table.reason_code,
    ),
  ],
);

/**
 * Named catalog of scheduler activities ("Morning Feed", "Booster Vaccine",
 * "Weekly Weigh") — so scheduler_line.activity_name is picked from a
 * consistent list instead of free text (which drifted: "Morning Feed" vs
 * "morning feed" vs "AM Feed" all meaning the same thing). company_id/nob_id/
 * lob_id are auto-resolved from the caller's workspace scope on create (see
 * masterScopeConditions/enforceMasterRequest) — null company_id means a
 * tenant-wide shared template, same convention as every other master here.
 */
export const activityMaster = mysqlTable(
  'activity_master',
  {
    activity_id: varchar('activity_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 }).references(
      () => companyMaster.company_id,
      { onDelete: 'restrict' },
    ),
    nob_id: varchar('nob_id', { length: 36 }).references(
      () => nobMaster.nob_id,
      { onDelete: 'restrict' },
    ),
    lob_id: varchar('lob_id', { length: 36 }).references(
      () => lobMaster.lob_id,
      { onDelete: 'restrict' },
    ),
    activity_code: varchar('activity_code', { length: 50 }).notNull(),
    activity_name: varchar('activity_name', { length: 200 }).notNull(),
    line_type: varchar('line_type', { length: 20 }).notNull(), // CONSUMPTION, OUTPUT, DESCRIPTIVE, OVERHEAD, RESOURCE, TRANSFER
    description: text('description'),
    // Tier-2 smart defaults — pre-fill a new scheduler_line when this activity is
    // picked; the line itself stays fully editable afterward, same relationship
    // item_master already has to a consumption line's qty/rate.
    default_item_id: varchar('default_item_id', { length: 36 }).references(
      () => itemMaster.item_id,
      { onDelete: 'restrict' },
    ),
    default_resource_id: varchar('default_resource_id', {
      length: 36,
    }).references(() => resourceMaster.resource_id, { onDelete: 'restrict' }),
    default_occurrence: varchar('default_occurrence', { length: 10 }), // DAILY, WEEKLY, MONTHLY, ONCE, CUSTOM
    default_qty_basis: varchar('default_qty_basis', { length: 20 }), // PER_HEAD, TOTAL_BATCH, PER_PEN, FIXED
    default_output_basis: varchar('default_output_basis', { length: 20 }), // PER_SOW, PER_PEN, PER_BATCH
    default_kpi_metric: varchar('default_kpi_metric', { length: 50 }),
    default_capture_per: varchar('default_capture_per', { length: 20 }), // AVERAGE, TOTAL, PER_HEAD
    default_overhead_category: varchar('default_overhead_category', {
      length: 30,
    }),
    default_gl_account: varchar('default_gl_account', { length: 20 }),
    default_is_mandatory: boolean('default_is_mandatory')
      .default(false)
      .notNull(),
    default_lot_required: boolean('default_lot_required')
      .default(false)
      .notNull(),
    is_active: boolean('is_active').default(true).notNull(),
    created_by: varchar('created_by', { length: 36 }),
    updated_by: varchar('updated_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('uq_activity_scope_code').on(
      table.tenant_id,
      sql`(coalesce(${table.company_id}, ''))`,
      sql`(coalesce(${table.lob_id}, ''))`,
      table.activity_code,
    ),
  ],
);

export const diseaseMaster = mysqlTable(
  'disease_master',
  {
    disease_id: varchar('disease_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 }).references(
      () => companyMaster.company_id,
      { onDelete: 'restrict' },
    ),
    // NOB/LOB on every master: selectable at company scope, hidden and auto-filled
    // from the active operational area at operational scope (enforceMasterRequest).
    // Nullable — NULL means the record is shared across every business vertical.
    nob_id: varchar('nob_id', { length: 36 }).references(
      () => nobMaster.nob_id,
      { onDelete: 'restrict' },
    ),
    lob_id: varchar('lob_id', { length: 36 }).references(
      () => lobMaster.lob_id,
      { onDelete: 'restrict' },
    ),
    disease_code: varchar('disease_code', { length: 255 }).notNull(),
    disease_name: varchar('disease_name', { length: 150 }).notNull(),
    scientific_name: varchar('scientific_name', { length: 150 }),
    symptoms: text('symptoms'),
    treatment_guideline: text('treatment_guideline'),
    is_active: boolean('is_active').default(true).notNull(),
    status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
    created_by: varchar('created_by', { length: 36 }),
    updated_by: varchar('updated_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { mode: 'string' }),
    extension_config: json('extension_config'),
  },
  (table) => [
    uniqueIndex('uq_disease_master_scope_code').on(
      table.tenant_id,
      sql`(coalesce(${table.company_id}, ''))`,
      table.disease_code,
    ),
  ],
);

export const diseaseMasterRelations = relations(diseaseMaster, ({ one }) => ({
  company: one(companyMaster, {
    fields: [diseaseMaster.company_id],
    references: [companyMaster.company_id],
  }),
}));

export const feedFormulaMaster = mysqlTable(
  'feed_formula_master',
  {
    formula_id: varchar('formula_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 }),
    // NOB/LOB on every master: selectable at company scope, hidden and auto-filled
    // from the active operational area at operational scope (enforceMasterRequest).
    // Nullable — NULL means the record is shared across every business vertical.
    nob_id: varchar('nob_id', { length: 36 }).references(
      () => nobMaster.nob_id,
      { onDelete: 'restrict' },
    ),
    lob_id: varchar('lob_id', { length: 36 }).references(
      () => lobMaster.lob_id,
      { onDelete: 'restrict' },
    ),
    formula_code: varchar('formula_code', { length: 255 }).notNull(),
    formula_name: varchar('formula_name', { length: 150 }).notNull(),
    target_item_id: varchar('target_item_id', { length: 36 }).notNull(),
    batch_size: decimal('batch_size', { precision: 18, scale: 4 }).notNull(),
    batch_unit: varchar('batch_unit', { length: 20 }).notNull(), // e.g. KG
    description: text('description'),
    is_active: boolean('is_active').default(true).notNull(),
    status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
    created_by: varchar('created_by', { length: 36 }),
    updated_by: varchar('updated_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { mode: 'string' }),
    extension_config: json('extension_config'),
  },
  (table) => ({
    uqScopedCode: uniqueIndex('uq_feed_formula_master_scope_code').on(
      table.tenant_id,
      sql`(coalesce(${table.company_id}, ''))`,
      table.formula_code,
    ),
    companyFk: foreignKey({
      columns: [table.company_id],
      foreignColumns: [companyMaster.company_id],
      name: 'feed_form_company_id_fk',
    }).onDelete('restrict'),
    targetItemFk: foreignKey({
      columns: [table.target_item_id],
      foreignColumns: [itemMaster.item_id],
      name: 'feed_form_target_item_id_fk',
    }).onDelete('restrict'),
  }),
);

export const feedFormulaIngredients = mysqlTable(
  'feed_formula_ingredients',
  {
    ingredient_id: varchar('ingredient_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 }),
    formula_id: varchar('formula_id', { length: 36 }).notNull(),
    item_id: varchar('item_id', { length: 36 }).notNull(), // raw ingredient item
    quantity: decimal('quantity', { precision: 18, scale: 4 }).notNull(),
    unit: varchar('unit', { length: 20 }).notNull(), // e.g. KG
    inclusion_pct: decimal('inclusion_pct', { precision: 6, scale: 2 }),
    loss_pct: decimal('loss_pct', { precision: 6, scale: 2 }),
    is_active: boolean('is_active').default(true).notNull(),
    status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
    created_by: varchar('created_by', { length: 36 }),
    updated_by: varchar('updated_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { mode: 'string' }),
    extension_config: json('extension_config'),
  },
  (table) => ({
    companyFk: foreignKey({
      columns: [table.company_id],
      foreignColumns: [companyMaster.company_id],
      name: 'feed_ingr_company_id_fk',
    }).onDelete('restrict'),
    formulaFk: foreignKey({
      columns: [table.formula_id],
      foreignColumns: [feedFormulaMaster.formula_id],
      name: 'feed_ingr_formula_id_fk',
    }).onDelete('cascade'),
    itemFk: foreignKey({
      columns: [table.item_id],
      foreignColumns: [itemMaster.item_id],
      name: 'feed_ingr_item_id_fk',
    }).onDelete('restrict'),
  }),
);

export const feedFormulaMasterRelations = relations(
  feedFormulaMaster,
  ({ one, many }) => ({
    company: one(companyMaster, {
      fields: [feedFormulaMaster.company_id],
      references: [companyMaster.company_id],
    }),
    targetItem: one(itemMaster, {
      fields: [feedFormulaMaster.target_item_id],
      references: [itemMaster.item_id],
    }),
    ingredients: many(feedFormulaIngredients),
  }),
);

export const feedFormulaIngredientsRelations = relations(
  feedFormulaIngredients,
  ({ one }) => ({
    company: one(companyMaster, {
      fields: [feedFormulaIngredients.company_id],
      references: [companyMaster.company_id],
    }),
    formula: one(feedFormulaMaster, {
      fields: [feedFormulaIngredients.formula_id],
      references: [feedFormulaMaster.formula_id],
    }),
    item: one(itemMaster, {
      fields: [feedFormulaIngredients.item_id],
      references: [itemMaster.item_id],
    }),
  }),
);

export const glAccountMaster = mysqlTable(
  'gl_account_master',
  {
    gl_account_id: varchar('gl_account_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 }),
    // NOB/LOB on every master: selectable at company scope, hidden and auto-filled
    // from the active operational area at operational scope (enforceMasterRequest).
    // Nullable — NULL means the record is shared across every business vertical.
    nob_id: varchar('nob_id', { length: 36 }).references(
      () => nobMaster.nob_id,
      { onDelete: 'restrict' },
    ),
    lob_id: varchar('lob_id', { length: 36 }).references(
      () => lobMaster.lob_id,
      { onDelete: 'restrict' },
    ),
    account_code: varchar('account_code', { length: 255 }).notNull(),
    account_name: varchar('account_name', { length: 150 }).notNull(),
    account_type: varchar('account_type', { length: 50 }).notNull(), // ASSET, LIABILITY, EQUITY, INCOME, EXPENSE
    parent_account_id: varchar('parent_account_id', { length: 36 }),
    is_sub_account: boolean('is_sub_account').default(false).notNull(),
    is_reconciliation: boolean('is_reconciliation').default(false).notNull(),
    is_active: boolean('is_active').default(true).notNull(),
    status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
    created_by: varchar('created_by', { length: 36 }),
    updated_by: varchar('updated_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { mode: 'string' }),
    extension_config: json('extension_config'),
  },
  (table) => ({
    uqScopedCode: uniqueIndex('uq_gl_account_master_scope_code').on(
      table.tenant_id,
      sql`(coalesce(${table.company_id}, ''))`,
      table.account_code,
    ),
    companyFk: foreignKey({
      columns: [table.company_id],
      foreignColumns: [companyMaster.company_id],
      name: 'gl_account_company_id_fk',
    }).onDelete('restrict'),
    parentAccountFk: foreignKey({
      columns: [table.parent_account_id],
      foreignColumns: [table.gl_account_id],
      name: 'gl_account_parent_id_fk',
    }).onDelete('restrict'),
    uqAccountCode: uniqueIndex('uq_gl_account_master_tenant_company_code').on(
      table.tenant_id,
      table.company_id,
      table.account_code,
    ),
  }),
);

export const glAccountMasterRelations = relations(
  glAccountMaster,
  ({ one, many }) => ({
    company: one(companyMaster, {
      fields: [glAccountMaster.company_id],
      references: [companyMaster.company_id],
    }),
    parentAccount: one(glAccountMaster, {
      fields: [glAccountMaster.parent_account_id],
      references: [glAccountMaster.gl_account_id],
      relationName: 'gl_account_hierarchy',
    }),
    subAccounts: many(glAccountMaster, {
      relationName: 'gl_account_hierarchy',
    }),
  }),
);

export const glMappingMaster = mysqlTable(
  'gl_mapping_master',
  {
    mapping_id: varchar('mapping_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 }),
    // Nullable by design: no numbering convention has been supplied for this master
    // yet, so no no_series_master row exists for it. A code may be typed manually
    // today; the moment a series is configured, NumberSeriesService.resolveOptionalCode()
    // starts generating one with no further code change. Existing rows keep NULL.
    mapping_code: varchar('mapping_code', { length: 255 }),
    item_category_id: varchar('item_category_id', { length: 36 }),
    // Additive lookup-key dimensions — the spec's full 6-dimensional gl_posting_setup model
    // (nob_id, lob_id, stage_id, transaction_type, posting_group/item_category, valuation_method).
    // NULL on any of these means "wildcard" — existing mappings created before this phase have
    // all five NULL and keep matching exactly what they matched before.
    nob_id: varchar('nob_id', { length: 36 }),
    lob_id: varchar('lob_id', { length: 36 }),
    stage_id: varchar('stage_id', { length: 36 }), // 6th dimension: production stage (NULL = any stage)
    valuation_method: varchar('valuation_method', { length: 30 }),
    transaction_type: varchar('transaction_type', { length: 50 }).notNull(), // PURCHASE, CONSUMPTION, OUTPUT, SALE, ADJUSTMENT, MORTALITY, etc.
    debit_gl_account_id: varchar('debit_gl_account_id', { length: 36 }),
    credit_gl_account_id: varchar('credit_gl_account_id', { length: 36 }),
    is_active: boolean('is_active').default(true).notNull(),
    status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
    created_by: varchar('created_by', { length: 36 }),
    updated_by: varchar('updated_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { mode: 'string' }),
    extension_config: json('extension_config'),
  },
  (table) => ({
    companyFk: foreignKey({
      columns: [table.company_id],
      foreignColumns: [companyMaster.company_id],
      name: 'gl_map_company_id_fk',
    }).onDelete('restrict'),
    categoryFk: foreignKey({
      columns: [table.item_category_id],
      foreignColumns: [itemCategoryMaster.category_id],
      name: 'gl_map_category_id_fk',
    }).onDelete('restrict'),
    nobFk: foreignKey({
      columns: [table.nob_id],
      foreignColumns: [nobMaster.nob_id],
      name: 'gl_map_nob_id_fk',
    }).onDelete('restrict'),
    lobFk: foreignKey({
      columns: [table.lob_id],
      foreignColumns: [lobMaster.lob_id],
      name: 'gl_map_lob_id_fk',
    }).onDelete('restrict'),
    stageFk: foreignKey({
      columns: [table.stage_id],
      foreignColumns: [stageMaster.stage_id],
      name: 'gl_map_stage_id_fk',
    }).onDelete('restrict'),
    valuationMethodFk: foreignKey({
      columns: [table.valuation_method],
      foreignColumns: [costingMethodConfig.method_code],
      name: 'gl_map_valuation_method_fk',
    }).onDelete('restrict'),
    debitGlFk: foreignKey({
      columns: [table.debit_gl_account_id],
      foreignColumns: [glAccountMaster.gl_account_id],
      name: 'gl_map_debit_gl_id_fk',
    }).onDelete('restrict'),
    creditGlFk: foreignKey({
      columns: [table.credit_gl_account_id],
      foreignColumns: [glAccountMaster.gl_account_id],
      name: 'gl_map_credit_gl_id_fk',
    }).onDelete('restrict'),
    scopeCode: uniqueIndex('uq_gl_mapping_master_scope_code').on(
      table.tenant_id,
      sql`(coalesce(${table.company_id}, ''))`,
      table.mapping_code,
    ),
  }),
);

export const glMappingMasterRelations = relations(
  glMappingMaster,
  ({ one }) => ({
    company: one(companyMaster, {
      fields: [glMappingMaster.company_id],
      references: [companyMaster.company_id],
    }),
    itemCategory: one(itemCategoryMaster, {
      fields: [glMappingMaster.item_category_id],
      references: [itemCategoryMaster.category_id],
    }),
    debitGlAccount: one(glAccountMaster, {
      fields: [glMappingMaster.debit_gl_account_id],
      references: [glAccountMaster.gl_account_id],
      relationName: 'debit_gl_relation',
    }),
    creditGlAccount: one(glAccountMaster, {
      fields: [glMappingMaster.credit_gl_account_id],
      references: [glAccountMaster.gl_account_id],
      relationName: 'credit_gl_relation',
    }),
  }),
);

export const costCenterMaster = mysqlTable(
  'cost_center_master',
  {
    cost_center_id: varchar('cost_center_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 }),
    // NOB/LOB on every master: selectable at company scope, hidden and auto-filled
    // from the active operational area at operational scope (enforceMasterRequest).
    // Nullable — NULL means the record is shared across every business vertical.
    nob_id: varchar('nob_id', { length: 36 }).references(
      () => nobMaster.nob_id,
      { onDelete: 'restrict' },
    ),
    lob_id: varchar('lob_id', { length: 36 }).references(
      () => lobMaster.lob_id,
      { onDelete: 'restrict' },
    ),
    cost_center_code: varchar('cost_center_code', { length: 255 }).notNull(),
    cost_center_name: varchar('cost_center_name', { length: 150 }).notNull(),
    cost_center_type: varchar('cost_center_type', { length: 50 }).notNull(), // DEPARTMENT, FARM, WAREHOUSE, PROJECT, OTHER
    parent_cost_center_id: varchar('parent_cost_center_id', { length: 36 }),
    is_active: boolean('is_active').default(true).notNull(),
    status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
    created_by: varchar('created_by', { length: 36 }),
    updated_by: varchar('updated_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { mode: 'string' }),
    extension_config: json('extension_config'),
  },
  (table) => ({
    uqScopedCode: uniqueIndex('uq_cost_center_master_scope_code').on(
      table.tenant_id,
      sql`(coalesce(${table.company_id}, ''))`,
      table.cost_center_code,
    ),
    companyFk: foreignKey({
      columns: [table.company_id],
      foreignColumns: [companyMaster.company_id],
      name: 'cost_center_company_id_fk',
    }).onDelete('restrict'),
    parentCostCenterFk: foreignKey({
      columns: [table.parent_cost_center_id],
      foreignColumns: [table.cost_center_id],
      name: 'cost_center_parent_id_fk',
    }).onDelete('restrict'),
    uqCostCenterCode: uniqueIndex(
      'uq_cost_center_master_tenant_company_code',
    ).on(table.tenant_id, table.company_id, table.cost_center_code),
  }),
);

export const costCenterMasterRelations = relations(
  costCenterMaster,
  ({ one, many }) => ({
    company: one(companyMaster, {
      fields: [costCenterMaster.company_id],
      references: [companyMaster.company_id],
    }),
    parentCostCenter: one(costCenterMaster, {
      fields: [costCenterMaster.parent_cost_center_id],
      references: [costCenterMaster.cost_center_id],
      relationName: 'cost_center_hierarchy',
    }),
    subCostCenters: many(costCenterMaster, {
      relationName: 'cost_center_hierarchy',
    }),
  }),
);

// ==========================================
// 10. FINANCE ENGINE (Phase 4)
// ==========================================

export const journalHeader = mysqlTable(
  'journal_header',
  {
    journal_id: varchar('journal_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 })
      .notNull()
      .references(() => companyMaster.company_id, { onDelete: 'restrict' }),
    journal_no: varchar('journal_no', { length: 50 }).notNull(),
    posting_date: date('posting_date', { mode: 'string' }).notNull(),
    source: varchar('source', { length: 10 }).notNull(), // MANUAL, SYSTEM
    source_document_type: varchar('source_document_type', { length: 30 }),
    source_document_no: varchar('source_document_no', { length: 50 }),
    source_ledger_id: varchar('source_ledger_id', { length: 36 }).references(
      () => inventoryLedger.ledger_id,
      { onDelete: 'restrict' },
    ),
    description: text('description'),
    status: varchar('status', { length: 20 }).default('DRAFT').notNull(), // DRAFT, POSTED, CANCELLED
    total_debit: decimal('total_debit', { precision: 18, scale: 4 })
      .default('0.0000')
      .notNull(),
    total_credit: decimal('total_credit', { precision: 18, scale: 4 })
      .default('0.0000')
      .notNull(),
    posted_at: timestamp('posted_at', { mode: 'string' }),
    posted_by: varchar('posted_by', { length: 36 }),
    created_by: varchar('created_by', { length: 36 }),
    updated_by: varchar('updated_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { mode: 'string' }),
  },
  (table) => [
    // Defense in depth alongside the row-locked generator in journal.service.ts —
    // a duplicate journal_no under concurrent inserts fails loudly instead of
    // silently corrupting the document sequence.
    uniqueIndex('uq_journal_header_tenant_company_no').on(
      table.tenant_id,
      table.company_id,
      table.journal_no,
    ),
  ],
);

export const journalLine = mysqlTable('journal_line', {
  line_id: varchar('line_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  journal_id: varchar('journal_id', { length: 36 })
    .notNull()
    .references(() => journalHeader.journal_id, { onDelete: 'cascade' }),
  line_no: int('line_no').notNull(),
  gl_account_id: varchar('gl_account_id', { length: 36 })
    .notNull()
    .references(() => glAccountMaster.gl_account_id, { onDelete: 'restrict' }),
  cost_center_id: varchar('cost_center_id', { length: 36 }).references(
    () => costCenterMaster.cost_center_id,
    { onDelete: 'restrict' },
  ),
  debit_amount: decimal('debit_amount', { precision: 18, scale: 4 })
    .default('0.0000')
    .notNull(),
  credit_amount: decimal('credit_amount', { precision: 18, scale: 4 })
    .default('0.0000')
    .notNull(),
  description: varchar('description', { length: 500 }),
  nob_id: varchar('nob_id', { length: 36 }).references(() => nobMaster.nob_id, {
    onDelete: 'restrict',
  }),
  lob_id: varchar('lob_id', { length: 36 }).references(() => lobMaster.lob_id, {
    onDelete: 'restrict',
  }),
});

export const journalHeaderRelations = relations(
  journalHeader,
  ({ one, many }) => ({
    company: one(companyMaster, {
      fields: [journalHeader.company_id],
      references: [companyMaster.company_id],
    }),
    sourceLedger: one(inventoryLedger, {
      fields: [journalHeader.source_ledger_id],
      references: [inventoryLedger.ledger_id],
    }),
    lines: many(journalLine),
  }),
);

export const journalLineRelations = relations(journalLine, ({ one }) => ({
  journal: one(journalHeader, {
    fields: [journalLine.journal_id],
    references: [journalHeader.journal_id],
  }),
  glAccount: one(glAccountMaster, {
    fields: [journalLine.gl_account_id],
    references: [glAccountMaster.gl_account_id],
  }),
  costCenter: one(costCenterMaster, {
    fields: [journalLine.cost_center_id],
    references: [costCenterMaster.cost_center_id],
  }),
}));

// ==========================================
// 11. PRODUCTION ENGINE (Phase 5) — STANDARD/FIFO batches only.
// Bio-asset (IAS41) batch accounting is a separate, deferred model.
// ==========================================

// Production lifecycle stages per NOB/LOB (e.g. piggery: QUARANTINE -> GILT_GROWER ->
// FLUSH_SERVICE -> ... -> DISPOSED). Self-referential next_stage_id/alt_next_stage_id
// define the default and conditional-fallback transition. batch_header.stage_id links
// to this opportunistically — see batch.service.ts transferStage().
export const stageMaster = mysqlTable(
  'stage_master',
  {
    stage_id: varchar('stage_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 }), // null = tenant-wide
    nob_id: varchar('nob_id', { length: 36 })
      .notNull()
      .references(() => nobMaster.nob_id, { onDelete: 'restrict' }),
    lob_id: varchar('lob_id', { length: 36 })
      .notNull()
      .references(() => lobMaster.lob_id, { onDelete: 'restrict' }),
    stage_code: varchar('stage_code', { length: 255 }).notNull(),
    stage_name: varchar('stage_name', { length: 100 }).notNull(),
    stage_category: varchar('stage_category', { length: 30 }).notNull(), // PRE_PRODUCTIVE, PRODUCTIVE, OUTPUT, DISPOSAL
    stage_sequence: int('stage_sequence').notNull(),
    typical_duration_days: int('typical_duration_days'),
    min_days_before_move: int('min_days_before_move').default(0).notNull(),
    transition_trigger: varchar('transition_trigger', { length: 20 }).notNull(), // AUTO_BY_DAY, MANUAL, EVENT_BASED, KPI_BASED
    auto_move_on_day: int('auto_move_on_day'),
    next_stage_id: varchar('next_stage_id', { length: 36 }),
    alt_next_stage_id: varchar('alt_next_stage_id', { length: 36 }),
    alt_trigger_condition: varchar('alt_trigger_condition', { length: 50 }),
    required_kpi_to_pass: json('required_kpi_to_pass'),
    data_entry_form: varchar('data_entry_form', { length: 20 })
      .default('STANDARD')
      .notNull(), // STANDARD, FARROWING, WEANING, SLAUGHTER
    scheduler_auto_create: boolean('scheduler_auto_create')
      .default(true)
      .notNull(),
    show_on_animal_card: boolean('show_on_animal_card').default(true).notNull(),
    icon_code: varchar('icon_code', { length: 30 }),
    stage_description: text('stage_description'),
    sort_order: int('sort_order'),
    is_system: boolean('is_system').default(false).notNull(),
    is_active: boolean('is_active').default(true).notNull(),
    created_by: varchar('created_by', { length: 36 }),
    updated_by: varchar('updated_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { mode: 'string' }),
    extension_config: json('extension_config'),
  },
  (table) => ({
    uqScopedCode: uniqueIndex('uq_stage_master_scope_code').on(
      table.tenant_id,
      sql`(coalesce(${table.company_id}, ''))`,
      table.lob_id,
      table.stage_code,
    ),
    nextStageFk: foreignKey({
      columns: [table.next_stage_id],
      foreignColumns: [table.stage_id],
      name: 'stage_master_next_stage_id_fk',
    }).onDelete('set null'),
    altNextStageFk: foreignKey({
      columns: [table.alt_next_stage_id],
      foreignColumns: [table.stage_id],
      name: 'stage_master_alt_next_stage_id_fk',
    }).onDelete('set null'),
    uqStageCode: uniqueIndex('uq_stage_master_tenant_company_lob_code').on(
      table.tenant_id,
      table.company_id,
      table.lob_id,
      table.stage_code,
    ),
  }),
);

// Per-breed, per-stage production standards — feed rate, ADG, FCR, mortality,
// expected output — for a period range within that stage. Drives scheduler
// auto-population and feed forecasting once those are built. stage_id is a real
// FK from the start (no legacy stage_name column to migrate away from, unlike
// batch_header.current_stage_code).
export const breedLifecycleStages = mysqlTable(
  'breed_lifecycle_stages',
  {
    lifecycle_id: varchar('lifecycle_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    // The only master that had no company_id — it was scoped indirectly through
    // its breed. Given directly so it scopes like every other master, and so its
    // unique key can carry company the way the other 22 already do.
    company_id: varchar('company_id', { length: 36 }).references(
      () => companyMaster.company_id,
      { onDelete: 'cascade' },
    ),
    // NOB/LOB on every master: selectable at company scope, hidden and auto-filled
    // from the active operational area at operational scope (enforceMasterRequest).
    // Nullable — NULL means the record is shared across every business vertical.
    nob_id: varchar('nob_id', { length: 36 }).references(
      () => nobMaster.nob_id,
      { onDelete: 'restrict' },
    ),
    lob_id: varchar('lob_id', { length: 36 }).references(
      () => lobMaster.lob_id,
      { onDelete: 'restrict' },
    ),
    // Nullable by design: no numbering convention has been supplied for this master
    // yet, so no no_series_master row exists for it. A code may be typed manually
    // today; the moment a series is configured, NumberSeriesService.resolveOptionalCode()
    // starts generating one with no further code change. Existing rows keep NULL.
    lifecycle_code: varchar('lifecycle_code', { length: 255 }),
    breed_id: varchar('breed_id', { length: 36 })
      .notNull()
      .references(() => breedMaster.breed_id, { onDelete: 'cascade' }),
    stage_id: varchar('stage_id', { length: 36 })
      .notNull()
      .references(() => stageMaster.stage_id, { onDelete: 'restrict' }),
    // TDD row 77: "Category, should be fetched as per the animal register data".
    // Mirrors animal_register.animal_type (SOW / GILT / BOAR / PIGLET /
    // COMMERCIAL_PIG), which is what standards actually vary by — a gilt and a sow
    // are both female and eat nothing alike. It carries sex implicitly, which is
    // why no separate sex column follows it.
    category: varchar('category', { length: 20 }),
    calc_unit: varchar('calc_unit', { length: 10 }).notNull(), // DAY, WEEK, MONTH
    period_from: int('period_from').notNull(),
    period_to: int('period_to').notNull(),
    // Breed Master Template, Lifecycle sheet: "Teats", mandatory. The per-animal
    // count lives on animal_register.no_of_teats; this is the standard for the
    // stage, which BBP §6 checks against — teat count below 15 hard-blocks gilt
    // selection, so the threshold has to be configurable per line and stage.
    std_teats: int('std_teats'),
    season_type: varchar('season_type', { length: 20 }),
    feed_item_id: varchar('feed_item_id', { length: 36 }).references(
      () => itemMaster.item_id,
      { onDelete: 'restrict' },
    ),
    feed_qty_per_head_per_day_kg: decimal('feed_qty_per_head_per_day_kg', {
      precision: 8,
      scale: 4,
    }),
    feed_wastage_pct: decimal('feed_wastage_pct', { precision: 5, scale: 2 }),
    std_body_weight_kg: decimal('std_body_weight_kg', {
      precision: 8,
      scale: 3,
    }),
    std_adg_gpd: decimal('std_adg_gpd', { precision: 8, scale: 2 }), // standard Average Daily Gain, grams/day
    std_fcr: decimal('std_fcr', { precision: 5, scale: 3 }),
    std_mortality_rate_pct: decimal('std_mortality_rate_pct', {
      precision: 5,
      scale: 3,
    }),
    output_item_id: varchar('output_item_id', { length: 36 }).references(
      () => itemMaster.item_id,
      { onDelete: 'restrict' },
    ),
    output_uom: varchar('output_uom', { length: 20 }),
    std_output_qty: decimal('std_output_qty', { precision: 10, scale: 3 }),
    medication_protocol: json('medication_protocol'),
    vaccination_protocol: json('vaccination_protocol'),
    resource_requirements: json('resource_requirements'),
    // TDD rows 97-99 asked for a lower limit, an upper limit and a severity, but
    // never said which metric they bound — scheduler.service refuses to guess for
    // exactly that reason. One unnamed pair per stage row cannot express "ADG below
    // 450 is a warning AND FCR above 3.1 is critical" either. So the three scalars
    // below are superseded by a list where every entry names its own metric and
    // carries its own alert: [{ metric, lower_limit, upper_limit, severity }].
    // The scalars stay for now — they are NULL on every row, and dropping columns
    // is a separate, destructive step.
    kpi_thresholds: json('kpi_thresholds'),
    kpi_lower_limit: decimal('kpi_lower_limit', { precision: 18, scale: 4 }),
    kpi_upper_limit: decimal('kpi_upper_limit', { precision: 18, scale: 4 }),
    alert_severity: varchar('alert_severity', { length: 10 }), // INFO, WARNING, CRITICAL
    notes: text('notes'),
    is_active: boolean('is_active').default(true).notNull(),
    created_by: varchar('created_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    // company_id is direct now rather than inherited through the breed, so the
    // scope key carries it the same way the other 22 masters do.
  },
  (table) => [
    uniqueIndex('uq_breed_lifecycle_stages_scope_code').on(
      table.tenant_id,
      sql`(coalesce(${table.company_id}, ''))`,
      table.lifecycle_code,
    ),
  ],
);

// Reusable, concurrency-safe business-code generator. generateNext() in
// number-series.service.ts locks a single row here (SELECT ... FOR UPDATE) rather
// than the range-lock generateBatchNo() in batch.service.ts currently does on
// batch_header directly — that call site is being migrated onto this table.
export const noSeriesMaster = mysqlTable(
  'no_series_master',
  {
    series_id: varchar('series_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 }), // null = tenant-wide
    nob_id: varchar('nob_id', { length: 36 }).references(
      () => nobMaster.nob_id,
      { onDelete: 'restrict' },
    ),
    lob_id: varchar('lob_id', { length: 36 }).references(
      () => lobMaster.lob_id,
      { onDelete: 'restrict' },
    ),
    series_code: varchar('series_code', { length: 30 }).notNull(),
    series_name: varchar('series_name', { length: 150 }).notNull(),
    document_type: varchar('document_type', { length: 50 }).notNull(),
    prefix: varchar('prefix', { length: 20 }),
    separator: varchar('separator', { length: 1 }).default('-').notNull(),
    seq_length: int('seq_length').notNull(),
    current_seq: bigint('current_seq', { mode: 'number' }).default(0).notNull(),
    last_generated_code: varchar('last_generated_code', { length: 255 }),
    reset_frequency: varchar('reset_frequency', { length: 20 })
      .default('NEVER')
      .notNull(), // YEARLY, MONTHLY, NEVER
    /**
     * The ordered parts of a generated code, before the sequence. Each entry is
     * either a field of the master being coded, or the token __PREFIX__ standing
     * for this series' own `prefix` — so prefix, one field, several fields, or any
     * mix of them, in whatever order the author wants. A field naming a related
     * record contributes that record's code; any other field contributes its own
     * value. Null or empty leaves the code exactly as it was before segments.
     */
    code_segments: json('code_segments'),
    /**
     * Where the prefix sits relative to the segments: START for BRD-LARGEWHITE-001,
     * END for FEED-STARTER-ITM-001. Only those two — anywhere else and the prefix
     * is buried mid-code where it identifies nothing. Ignored when no prefix is set.
     */
    prefix_position: varchar('prefix_position', { length: 10 })
      .default('END')
      .notNull(),
    /**
     * The separator before the sequence, when it differs from the one joining the
     * segments. Location is FARM-001/SHED-001/PEN-001 — "/" between path levels,
     * "-" before the number. Null falls back to `separator`, which is every series
     * that only ever needed one.
     */
    seq_separator: varchar('seq_separator', { length: 1 }),
    allow_manual: boolean('allow_manual').default(false).notNull(),
    is_active: boolean('is_active').default(true).notNull(),
    created_by: varchar('created_by', { length: 36 }),
    updated_by: varchar('updated_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { mode: 'string' }),
    extension_config: json('extension_config'),
  },
  (table) => ({
    uqScopedCode: uniqueIndex('uq_no_series_master_scope_code').on(
      table.tenant_id,
      sql`(coalesce(${table.company_id}, ''))`,
      table.series_code,
    ),
    uqSeriesCode: uniqueIndex('uq_no_series_master_tenant_company_code').on(
      table.tenant_id,
      table.company_id,
      table.series_code,
    ),
  }),
);

export const batchHeader = mysqlTable(
  'batch_header',
  {
    batch_id: varchar('batch_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 })
      .notNull()
      .references(() => companyMaster.company_id, { onDelete: 'restrict' }),
    batch_no: varchar('batch_no', { length: 50 }).notNull(),
    lob_id: varchar('lob_id', { length: 36 })
      .notNull()
      .references(() => lobMaster.lob_id, { onDelete: 'restrict' }),
    nob_id: varchar('nob_id', { length: 36 }).references(
      () => nobMaster.nob_id,
      { onDelete: 'restrict' },
    ),
    costing_method: varchar('costing_method', { length: 20 }).notNull(), // STANDARD, FIFO
    breed_id: varchar('breed_id', { length: 36 }).references(
      () => breedMaster.breed_id,
      { onDelete: 'restrict' },
    ),
    operational_area_id: varchar('operational_area_id', { length: 36 }),
    shed_id: varchar('shed_id', { length: 36 }),
    location_id: varchar('location_id', { length: 36 }),
    // Config lineage for the renew()/copy-forward flow (perpetual/seasonal LOBs
    // like orchards, apiaries) — distinct from batch_input_line.source_batch_id,
    // which tracks cost traceability. No FK constraint, same lightweight
    // pointer pattern as source_batch_id below.
    renewed_from_batch_id: varchar('renewed_from_batch_id', { length: 36 }),
    // The cohort this batch was split out of.
    //
    // When part of a batch is not ready to move on with the rest — sows that
    // failed a pregnancy scan, tail-enders short of weight — the ready animals
    // advance with the parent and the remainder are split into a child batch that
    // holds its own stage, schedule and pen. The child is a real batch, so data
    // entry, records, costing and KPI all work against it unchanged; this link is
    // what lets a report roll the two back together, and what "merge back" walks.
    // Deliberately no FK, matching renewed_from_batch_id above: a parent may be
    // closed and archived while the child is still running.
    parent_batch_id: varchar('parent_batch_id', { length: 36 }),
    // Current physical stage (e.g. SETTER_ROOM -> HATCHER_ROOM) — free text,
    // LOB-defined rather than a fixed enum, since stages vary per LOB. Distinct
    // from shed_id/location_id above (the batch's starting assignment); this is
    // the CURRENT sub-location, updated by transferStage(). History lives in
    // batch_stage_log.
    current_stage_code: varchar('current_stage_code', { length: 255 }),
    // Opportunistic link to stage_master when current_stage_code resolves to a real
    // seeded stage for this batch's LOB (see transferStage()). Nullable and additive —
    // current_stage_code stays authoritative for LOBs without Stage Master data.
    stage_id: varchar('stage_id', { length: 36 }),
    sub_location_id: varchar('sub_location_id', { length: 36 }),
    start_date: date('start_date', { mode: 'string' }).notNull(),
    expected_end_date: date('expected_end_date', { mode: 'string' }),
    actual_end_date: date('actual_end_date', { mode: 'string' }),
    status: varchar('status', { length: 20 }).default('DRAFT').notNull(), // DRAFT, ACTIVE, CLOSED, CANCELLED
    // BATCH_WISE: the whole batch moves through one stage at a time (today's
    // only behavior, unchanged). ANIMAL_WISE: animals in this batch each carry
    // their own current_stage_id/current_location_id and can diverge — the
    // batch itself has no single "current stage" in that mode.
    tracking_mode: varchar('tracking_mode', { length: 20 })
      .default('BATCH_WISE')
      .notNull(),
    opening_quantity: decimal('opening_quantity', {
      precision: 18,
      scale: 4,
    }).notNull(),
    uom: varchar('uom', { length: 20 }).notNull(),
    closing_quantity: decimal('closing_quantity', { precision: 18, scale: 4 }),
    total_cost: decimal('total_cost', { precision: 18, scale: 4 }),
    unit_cost: decimal('unit_cost', { precision: 18, scale: 6 }),
    remarks: text('remarks'),
    closed_at: timestamp('closed_at', { mode: 'string' }),
    closed_by: varchar('closed_by', { length: 36 }),
    created_by: varchar('created_by', { length: 36 }),
    updated_by: varchar('updated_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { mode: 'string' }),
  },
  (table) => ({
    shedFk: foreignKey({
      columns: [table.shed_id],
      foreignColumns: [locationMaster.location_id],
      name: 'batch_header_shed_id_fk',
    }).onDelete('restrict'),
    locationFk: foreignKey({
      columns: [table.location_id],
      foreignColumns: [locationMaster.location_id],
      name: 'batch_header_location_id_fk',
    }).onDelete('restrict'),
    stageFk: foreignKey({
      columns: [table.stage_id],
      foreignColumns: [stageMaster.stage_id],
      name: 'batch_header_stage_id_fk',
    }).onDelete('set null'),
    // Defense in depth alongside the row-locked generator in batch.service.ts —
    // a duplicate batch_no under concurrent inserts fails loudly instead of
    // silently corrupting the document sequence.
    uqBatchNo: uniqueIndex('uq_batch_header_tenant_company_no').on(
      table.tenant_id,
      table.company_id,
      table.batch_no,
    ),
  }),
);

export const batchInputLine = mysqlTable(
  'batch_input_line',
  {
    line_id: varchar('line_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    batch_id: varchar('batch_id', { length: 36 }).notNull(),
    line_no: int('line_no').notNull(),
    item_id: varchar('item_id', { length: 36 })
      .notNull()
      .references(() => itemMaster.item_id, { onDelete: 'restrict' }),
    // Traceability: set when this input is another batch's output (e.g. Hatching
    // sourced from Laying + Breeding batches), rather than a plain inventory item.
    source_batch_id: varchar('source_batch_id', { length: 36 }),
    quantity: decimal('quantity', { precision: 18, scale: 4 }).notNull(),
    uom: varchar('uom', { length: 20 }).notNull(),
    rate: decimal('rate', { precision: 18, scale: 6 }),
    amount: decimal('amount', { precision: 18, scale: 4 }),
  },
  (table) => ({
    batchFk: foreignKey({
      columns: [table.batch_id],
      foreignColumns: [batchHeader.batch_id],
      name: 'batch_input_line_batch_id_fk',
    }).onDelete('cascade'),
    sourceBatchFk: foreignKey({
      columns: [table.source_batch_id],
      foreignColumns: [batchHeader.batch_id],
      name: 'batch_input_line_source_fk',
    }).onDelete('restrict'),
  }),
);

export const batchTransaction = mysqlTable('batch_transaction', {
  transaction_id: varchar('transaction_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  batch_id: varchar('batch_id', { length: 36 })
    .notNull()
    .references(() => batchHeader.batch_id, { onDelete: 'cascade' }),
  transaction_date: date('transaction_date', { mode: 'string' }).notNull(),
  transaction_type: varchar('transaction_type', { length: 20 }).notNull(), // CONSUMPTION, MORTALITY, OUTPUT, OVERHEAD, OBSERVATION
  item_id: varchar('item_id', { length: 36 }).references(
    () => itemMaster.item_id,
    { onDelete: 'restrict' },
  ),
  resource_id: varchar('resource_id', { length: 36 }).references(
    () => resourceMaster.resource_id,
    { onDelete: 'restrict' },
  ),
  quantity: decimal('quantity', { precision: 18, scale: 4 }),
  uom: varchar('uom', { length: 20 }),
  rate: decimal('rate', { precision: 18, scale: 6 }),
  amount: decimal('amount', { precision: 18, scale: 4 }),
  remarks: varchar('remarks', { length: 500 }),
  ledger_id: varchar('ledger_id', { length: 36 }).references(
    () => inventoryLedger.ledger_id,
    { onDelete: 'restrict' },
  ),
  // Structured fields for OVERHEAD (labour) and OBSERVATION (weight/BCS) rows —
  // previously only encoded as free text in `remarks`, unqueryable.
  persons: int('persons'),
  hours: decimal('hours', { precision: 8, scale: 2 }),
  adg: decimal('adg', { precision: 10, scale: 4 }),
  bcs_score: decimal('bcs_score', { precision: 4, scale: 2 }),
  // Optional per-animal attribution — null means the row applies to the whole
  // batch (unchanged historical behaviour); set when a caller scoped the
  // entry to one or more specific animals in the batch.
  animal_id: varchar('animal_id', { length: 36 }).references(
    () => animalRegister.animal_id,
    { onDelete: 'set null' },
  ),
  // The farm_record this transaction was generated from. Nullable and SET NULL
  // on delete: costing reads this table directly and must survive a record
  // being voided — the column carries provenance, not a dependency.
  record_id: varchar('record_id', { length: 36 }).references(
    () => farmRecord.record_id,
    { onDelete: 'set null' },
  ),
  created_by: varchar('created_by', { length: 36 }),
  created_at: timestamp('created_at', { mode: 'string' })
    .defaultNow()
    .notNull(),
});

// Batch daily-log attachments (inspection photos, documents) — stored on
// local/system disk under UPLOADS_DIR, served from /uploads (see main.ts).
export const batchAttachment = mysqlTable('batch_attachment', {
  attachment_id: varchar('attachment_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  batch_id: varchar('batch_id', { length: 36 })
    .notNull()
    .references(() => batchHeader.batch_id, { onDelete: 'cascade' }),
  log_date: date('log_date', { mode: 'string' }).notNull(),
  file_name: varchar('file_name', { length: 255 }).notNull(),
  file_url: varchar('file_url', { length: 500 }).notNull(),
  mime_type: varchar('mime_type', { length: 100 }),
  attachment_type: varchar('attachment_type', { length: 20 })
    .default('IMAGE')
    .notNull(),
  uploaded_by: varchar('uploaded_by', { length: 36 }),
  created_at: timestamp('created_at', { mode: 'string' })
    .defaultNow()
    .notNull(),
});

export const batchOutputLine = mysqlTable('batch_output_line', {
  line_id: varchar('line_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  batch_id: varchar('batch_id', { length: 36 })
    .notNull()
    .references(() => batchHeader.batch_id, { onDelete: 'cascade' }),
  item_id: varchar('item_id', { length: 36 })
    .notNull()
    .references(() => itemMaster.item_id, { onDelete: 'restrict' }),
  output_type: varchar('output_type', { length: 20 }).default('MAIN').notNull(), // MAIN, BY_PRODUCT
  cost_split_pct: decimal('cost_split_pct', {
    precision: 6,
    scale: 2,
  }).notNull(),
  quantity: decimal('quantity', { precision: 18, scale: 4 }).notNull(),
  uom: varchar('uom', { length: 20 }).notNull(),
  computed_cost: decimal('computed_cost', { precision: 18, scale: 4 }),
  unit_cost: decimal('unit_cost', { precision: 18, scale: 6 }),
  warehouse_id: varchar('warehouse_id', { length: 36 }).references(
    () => locationMaster.location_id,
    { onDelete: 'restrict' },
  ),
});

// Append-only audit trail of batch_header.current_stage_code/sub_location_id
// transitions (transferStage()) — mirrors bio_asset_ledger's append-only
// pattern. No cost/GL impact; this is a physical/tracking event, not a cost
// event (matches spec: "sub-location transfer... No journal, location update").
export const batchStageLog = mysqlTable('batch_stage_log', {
  log_id: varchar('log_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  batch_id: varchar('batch_id', { length: 36 })
    .notNull()
    .references(() => batchHeader.batch_id, { onDelete: 'cascade' }),
  from_stage_code: varchar('from_stage_code', { length: 255 }),
  to_stage_code: varchar('to_stage_code', { length: 255 }).notNull(),
  from_location_id: varchar('from_location_id', { length: 36 }),
  to_location_id: varchar('to_location_id', { length: 36 }),
  transferred_at: timestamp('transferred_at', { mode: 'string' })
    .defaultNow()
    .notNull(),
  transferred_by: varchar('transferred_by', { length: 36 }),
  remarks: text('remarks'),
});

/**
 * Movement of livestock between batches — distinct from `batch_stage_log`,
 * which walks a batch through its own lifecycle (QUARANTINE → GILT_GROWER).
 * This is the A → B movement that happens when a cycle closes, or when a
 * subset of animals is moved out early. Transferred animals stay fully
 * operable: their `animal_register.current_batch_id` is repointed, so every
 * downstream entry screen picks them up under the destination batch.
 *
 * A transfer is a balance-sheet reclassification, never income — value moves
 * from the source batch's WIP to the destination's, and the posting logic
 * mirrors that rather than touching P&L.
 */
export const batchTransfer = mysqlTable('batch_transfer', {
  transfer_id: varchar('transfer_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
  company_id: varchar('company_id', { length: 36 })
    .notNull()
    .references(() => companyMaster.company_id, { onDelete: 'restrict' }),
  transfer_no: varchar('transfer_no', { length: 50 }).notNull(),
  from_batch_id: varchar('from_batch_id', { length: 36 })
    .notNull()
    .references(() => batchHeader.batch_id, { onDelete: 'restrict' }),
  to_batch_id: varchar('to_batch_id', { length: 36 })
    .notNull()
    .references(() => batchHeader.batch_id, { onDelete: 'restrict' }),
  transfer_date: date('transfer_date', { mode: 'string' }).notNull(),
  // FULL_BATCH moves every remaining animal and closes the source; PARTIAL
  // moves only the selected animals and leaves the source running.
  transfer_type: varchar('transfer_type', { length: 20 })
    .default('PARTIAL')
    .notNull(),
  head_count: decimal('head_count', { precision: 18, scale: 4 })
    .default('0.0000')
    .notNull(),
  transfer_value: decimal('transfer_value', { precision: 18, scale: 4 })
    .default('0.0000')
    .notNull(),
  reason: varchar('reason', { length: 100 }),
  remarks: text('remarks'),
  status: varchar('status', { length: 20 }).default('DRAFT').notNull(),
  posted_at: timestamp('posted_at', { mode: 'string' }),
  posted_by: varchar('posted_by', { length: 36 }),
  created_by: varchar('created_by', { length: 36 }),
  updated_by: varchar('updated_by', { length: 36 }),
  created_at: timestamp('created_at', { mode: 'string' })
    .defaultNow()
    .notNull(),
  updated_at: timestamp('updated_at', { mode: 'string' })
    .defaultNow()
    .onUpdateNow()
    .notNull(),
  deleted_at: timestamp('deleted_at', { mode: 'string' }),
});

/** One row per animal moved, carrying the book value it moved at. */
export const batchTransferLine = mysqlTable('batch_transfer_line', {
  line_id: varchar('line_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  transfer_id: varchar('transfer_id', { length: 36 })
    .notNull()
    .references(() => batchTransfer.transfer_id, { onDelete: 'cascade' }),
  line_no: int('line_no').notNull(),
  animal_id: varchar('animal_id', { length: 36 })
    .notNull()
    .references(() => animalRegister.animal_id, { onDelete: 'restrict' }),
  from_location_id: varchar('from_location_id', { length: 36 }),
  to_location_id: varchar('to_location_id', { length: 36 }),
  book_value: decimal('book_value', { precision: 18, scale: 4 })
    .default('0.0000')
    .notNull(),
  remarks: varchar('remarks', { length: 500 }),
});

export const batchTransferRelations = relations(
  batchTransfer,
  ({ one, many }) => ({
    fromBatch: one(batchHeader, {
      fields: [batchTransfer.from_batch_id],
      references: [batchHeader.batch_id],
      relationName: 'transferFromBatch',
    }),
    toBatch: one(batchHeader, {
      fields: [batchTransfer.to_batch_id],
      references: [batchHeader.batch_id],
      relationName: 'transferToBatch',
    }),
    lines: many(batchTransferLine),
  }),
);

export const batchTransferLineRelations = relations(
  batchTransferLine,
  ({ one }) => ({
    transfer: one(batchTransfer, {
      fields: [batchTransferLine.transfer_id],
      references: [batchTransfer.transfer_id],
    }),
    animal: one(animalRegister, {
      fields: [batchTransferLine.animal_id],
      references: [animalRegister.animal_id],
    }),
  }),
);

export const batchHeaderRelations = relations(batchHeader, ({ one, many }) => ({
  company: one(companyMaster, {
    fields: [batchHeader.company_id],
    references: [companyMaster.company_id],
  }),
  lob: one(lobMaster, {
    fields: [batchHeader.lob_id],
    references: [lobMaster.lob_id],
  }),
  breed: one(breedMaster, {
    fields: [batchHeader.breed_id],
    references: [breedMaster.breed_id],
  }),
  inputLines: many(batchInputLine),
  transactions: many(batchTransaction),
  outputLines: many(batchOutputLine),
}));

export const batchInputLineRelations = relations(batchInputLine, ({ one }) => ({
  batch: one(batchHeader, {
    fields: [batchInputLine.batch_id],
    references: [batchHeader.batch_id],
    relationName: 'batch_inputs',
  }),
  item: one(itemMaster, {
    fields: [batchInputLine.item_id],
    references: [itemMaster.item_id],
  }),
  sourceBatch: one(batchHeader, {
    fields: [batchInputLine.source_batch_id],
    references: [batchHeader.batch_id],
    relationName: 'batch_as_source',
  }),
}));

export const batchTransactionRelations = relations(
  batchTransaction,
  ({ one }) => ({
    batch: one(batchHeader, {
      fields: [batchTransaction.batch_id],
      references: [batchHeader.batch_id],
    }),
    item: one(itemMaster, {
      fields: [batchTransaction.item_id],
      references: [itemMaster.item_id],
    }),
    resource: one(resourceMaster, {
      fields: [batchTransaction.resource_id],
      references: [resourceMaster.resource_id],
    }),
    ledgerEntry: one(inventoryLedger, {
      fields: [batchTransaction.ledger_id],
      references: [inventoryLedger.ledger_id],
    }),
    mortalityDetail: one(batchMortalityDetail, {
      fields: [batchTransaction.transaction_id],
      references: [batchMortalityDetail.transaction_id],
    }),
    treatmentDetail: one(batchTreatmentDetail, {
      fields: [batchTransaction.transaction_id],
      references: [batchTreatmentDetail.transaction_id],
    }),
  }),
);

// ── Clinical detail ────────────────────────────────────────────────────────
// A death or a treatment is one batch_transaction (the quantity and the cost)
// plus the clinical narrative that goes with it. That narrative used to be
// packed into `remarks` as formatted free text and parsed back out by the UI,
// which meant it could not be queried, reported on, or validated. These are
// 1:1 extensions of the transaction, so an event is still a single row of
// cost — nothing is duplicated, and a transaction with no clinical detail
// (every historical row) simply has none.

export const batchMortalityDetail = mysqlTable(
  'batch_mortality_detail',
  {
    detail_id: varchar('detail_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    transaction_id: varchar('transaction_id', { length: 36 })
      .notNull()
      .unique(),
    // Where it happened — the pen, not the batch's current pen, which may since
    // have changed.
    location_id: varchar('location_id', { length: 36 }),
    cause_of_death: varchar('cause_of_death', { length: 200 }),
    post_mortem_notes: text('post_mortem_notes'),
    disposal_method: varchar('disposal_method', { length: 100 }),
    created_by: varchar('created_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    // Explicit names — the derived ones exceed MySQL's 64-character limit.
    txnFk: foreignKey({
      columns: [table.transaction_id],
      foreignColumns: [batchTransaction.transaction_id],
      name: 'bmd_transaction_id_fk',
    }).onDelete('cascade'),
    locationFk: foreignKey({
      columns: [table.location_id],
      foreignColumns: [locationMaster.location_id],
      name: 'bmd_location_id_fk',
    }).onDelete('restrict'),
  }),
);

export const batchTreatmentDetail = mysqlTable(
  'batch_treatment_detail',
  {
    detail_id: varchar('detail_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    transaction_id: varchar('transaction_id', { length: 36 })
      .notNull()
      .unique(),
    diagnosis: varchar('diagnosis', { length: 255 }),
    route: varchar('route', { length: 50 }), // IM, SUBCUTANEOUS, ORAL_IN_FEED, TOPICAL …
    // Days after this dose during which the animal may not enter the food chain.
    // Drives the slaughter withdrawal check and "active case" counts.
    withdrawal_days: int('withdrawal_days'),
    veterinarian: varchar('veterinarian', { length: 150 }),
    created_by: varchar('created_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    txnFk: foreignKey({
      columns: [table.transaction_id],
      foreignColumns: [batchTransaction.transaction_id],
      name: 'btd_transaction_id_fk',
    }).onDelete('cascade'),
  }),
);

export const batchMortalityDetailRelations = relations(
  batchMortalityDetail,
  ({ one }) => ({
    transaction: one(batchTransaction, {
      fields: [batchMortalityDetail.transaction_id],
      references: [batchTransaction.transaction_id],
    }),
    location: one(locationMaster, {
      fields: [batchMortalityDetail.location_id],
      references: [locationMaster.location_id],
    }),
  }),
);

export const batchTreatmentDetailRelations = relations(
  batchTreatmentDetail,
  ({ one }) => ({
    transaction: one(batchTransaction, {
      fields: [batchTreatmentDetail.transaction_id],
      references: [batchTransaction.transaction_id],
    }),
  }),
);

// ── Farm records ───────────────────────────────────────────────────────────
// The object a person creates, reads and corrects. A batch_transaction is its
// accounting consequence — still the costing substrate close(), WIP, variance
// and the GL read, which never learn that records exist.
//
// An entry scoped to selected animals used to be N unrelated transaction rows
// with no handle to edit as one thing. It is now one record with N members.
//
// Editing never mutates: a change writes the next version and marks the
// previous one SUPERSEDED, so posted history is never rewritten.

export const farmRecord = mysqlTable(
  'farm_record',
  {
    record_id: varchar('record_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 }).notNull(),
    batch_id: varchar('batch_id', { length: 36 }).notNull(),
    /** The day the entry applies to — not the day it was typed. */
    record_date: date('record_date', { mode: 'string' }).notNull(),
    // CONSUMPTION | MORTALITY | OVERHEAD | OBSERVATION | WEIGHT_ENTRY | OUTPUT
    record_type: varchar('record_type', { length: 20 }).notNull(),
    // BATCH = the whole cohort; ANIMALS = the members in farm_record_animal.
    scope: varchar('scope', { length: 10 }).notNull(),
    /** Stage the batch was in on record_date, captured so later moves don't rewrite history. */
    stage_code: varchar('stage_code', { length: 255 }),
    item_id: varchar('item_id', { length: 36 }),
    resource_id: varchar('resource_id', { length: 36 }),
    quantity: decimal('quantity', { precision: 18, scale: 4 }),
    uom: varchar('uom', { length: 20 }),
    rate: decimal('rate', { precision: 18, scale: 6 }),
    // Stored, not derived: a reversed record must keep the amount it actually
    // posted even if the item's rate has since changed.
    amount: decimal('amount', { precision: 18, scale: 4 }),
    remarks: text('remarks'),
    version: int('version').default(1).notNull(),
    status: varchar('status', { length: 12 }).default('ACTIVE').notNull(), // ACTIVE | SUPERSEDED | VOID
    supersedes_id: varchar('supersedes_id', { length: 36 }),
    superseded_by_id: varchar('superseded_by_id', { length: 36 }),
    created_by: varchar('created_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_by: varchar('updated_by', { length: 36 }),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    // Explicit and short: MySQL caps identifiers at 64 characters and Drizzle's
    // derived names for this table exceed it.
    companyFk: foreignKey({
      columns: [table.company_id],
      foreignColumns: [companyMaster.company_id],
      name: 'fr_company_fk',
    }).onDelete('restrict'),
    batchFk: foreignKey({
      columns: [table.batch_id],
      foreignColumns: [batchHeader.batch_id],
      name: 'fr_batch_fk',
    }).onDelete('cascade'),
    itemFk: foreignKey({
      columns: [table.item_id],
      foreignColumns: [itemMaster.item_id],
      name: 'fr_item_fk',
    }).onDelete('restrict'),
    resourceFk: foreignKey({
      columns: [table.resource_id],
      foreignColumns: [resourceMaster.resource_id],
      name: 'fr_resource_fk',
    }).onDelete('restrict'),
  }),
);

export const farmRecordAnimal = mysqlTable(
  'farm_record_animal',
  {
    line_id: varchar('line_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    record_id: varchar('record_id', { length: 36 }).notNull(),
    animal_id: varchar('animal_id', { length: 36 }).notNull(),
  },
  (table) => ({
    recordFk: foreignKey({
      columns: [table.record_id],
      foreignColumns: [farmRecord.record_id],
      name: 'fra_record_fk',
    }).onDelete('cascade'),
    animalFk: foreignKey({
      columns: [table.animal_id],
      foreignColumns: [animalRegister.animal_id],
      name: 'fra_animal_fk',
    }).onDelete('restrict'),
    // One animal appears at most once in a record.
    uniqueMember: uniqueIndex('fra_record_animal_uq').on(
      table.record_id,
      table.animal_id,
    ),
  }),
);

export const farmRecordRelations = relations(farmRecord, ({ one, many }) => ({
  batch: one(batchHeader, {
    fields: [farmRecord.batch_id],
    references: [batchHeader.batch_id],
  }),
  item: one(itemMaster, {
    fields: [farmRecord.item_id],
    references: [itemMaster.item_id],
  }),
  animals: many(farmRecordAnimal),
}));

export const farmRecordAnimalRelations = relations(
  farmRecordAnimal,
  ({ one }) => ({
    record: one(farmRecord, {
      fields: [farmRecordAnimal.record_id],
      references: [farmRecord.record_id],
    }),
    animal: one(animalRegister, {
      fields: [farmRecordAnimal.animal_id],
      references: [animalRegister.animal_id],
    }),
  }),
);

export const batchOutputLineRelations = relations(
  batchOutputLine,
  ({ one }) => ({
    batch: one(batchHeader, {
      fields: [batchOutputLine.batch_id],
      references: [batchHeader.batch_id],
    }),
    item: one(itemMaster, {
      fields: [batchOutputLine.item_id],
      references: [itemMaster.item_id],
    }),
    warehouse: one(locationMaster, {
      fields: [batchOutputLine.warehouse_id],
      references: [locationMaster.location_id],
    }),
  }),
);

// 11a. COSTING / VARIANCE ENGINE (Phase 7) — STANDARD batches only.
// Lightweight per-batch standards (no separate Parameter/Scheduler system).

export const batchStandard = mysqlTable('batch_standard', {
  standard_id: varchar('standard_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  batch_id: varchar('batch_id', { length: 36 })
    .notNull()
    .unique()
    .references(() => batchHeader.batch_id, { onDelete: 'cascade' }),
  std_output_quantity: decimal('std_output_quantity', {
    precision: 18,
    scale: 4,
  }),
  std_output_cost_per_unit: decimal('std_output_cost_per_unit', {
    precision: 18,
    scale: 6,
  }),
  std_overhead_rate_per_unit: decimal('std_overhead_rate_per_unit', {
    precision: 18,
    scale: 6,
  }),
  created_by: varchar('created_by', { length: 36 }),
  created_at: timestamp('created_at', { mode: 'string' })
    .defaultNow()
    .notNull(),
});

export const batchStandardConsumptionLine = mysqlTable(
  'batch_standard_consumption_line',
  {
    line_id: varchar('line_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    batch_id: varchar('batch_id', { length: 36 }).notNull(),
    item_id: varchar('item_id', { length: 36 }).notNull(),
    std_qty_per_unit_per_day: decimal('std_qty_per_unit_per_day', {
      precision: 18,
      scale: 8,
    }).notNull(),
    std_rate: decimal('std_rate', { precision: 18, scale: 6 }),
  },
  (table) => ({
    batchFk: foreignKey({
      columns: [table.batch_id],
      foreignColumns: [batchHeader.batch_id],
      name: 'bscl_batch_id_fk',
    }).onDelete('cascade'),
    itemFk: foreignKey({
      columns: [table.item_id],
      foreignColumns: [itemMaster.item_id],
      name: 'bscl_item_id_fk',
    }).onDelete('restrict'),
  }),
);

export const batchCostVariance = mysqlTable(
  'batch_cost_variance',
  {
    variance_id: varchar('variance_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    batch_id: varchar('batch_id', { length: 36 })
      .notNull()
      .references(() => batchHeader.batch_id, { onDelete: 'cascade' }),
    variance_type: varchar('variance_type', { length: 20 }).notNull(), // PRICE, USAGE, OUTPUT, OVERHEAD
    item_id: varchar('item_id', { length: 36 }).references(
      () => itemMaster.item_id,
      { onDelete: 'restrict' },
    ),
    std_value: decimal('std_value', { precision: 18, scale: 6 }).notNull(),
    actual_value: decimal('actual_value', {
      precision: 18,
      scale: 6,
    }).notNull(),
    variance_amount: decimal('variance_amount', {
      precision: 18,
      scale: 4,
    }).notNull(), // positive = unfavorable
    is_favorable: boolean('is_favorable').notNull(),
    dr_gl_account_id: varchar('dr_gl_account_id', { length: 36 }),
    cr_gl_account_id: varchar('cr_gl_account_id', { length: 36 }),
    journal_id: varchar('journal_id', { length: 36 }).references(
      () => journalHeader.journal_id,
      { onDelete: 'restrict' },
    ),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    drGlFk: foreignKey({
      columns: [table.dr_gl_account_id],
      foreignColumns: [glAccountMaster.gl_account_id],
      name: 'bcv_dr_gl_fk',
    }).onDelete('restrict'),
    crGlFk: foreignKey({
      columns: [table.cr_gl_account_id],
      foreignColumns: [glAccountMaster.gl_account_id],
      name: 'bcv_cr_gl_fk',
    }).onDelete('restrict'),
  }),
);

export const batchStandardRelations = relations(
  batchStandard,
  ({ one, many }) => ({
    batch: one(batchHeader, {
      fields: [batchStandard.batch_id],
      references: [batchHeader.batch_id],
    }),
    consumptionLines: many(batchStandardConsumptionLine),
  }),
);

export const batchStandardConsumptionLineRelations = relations(
  batchStandardConsumptionLine,
  ({ one }) => ({
    batch: one(batchHeader, {
      fields: [batchStandardConsumptionLine.batch_id],
      references: [batchHeader.batch_id],
    }),
    item: one(itemMaster, {
      fields: [batchStandardConsumptionLine.item_id],
      references: [itemMaster.item_id],
    }),
  }),
);

export const batchCostVarianceRelations = relations(
  batchCostVariance,
  ({ one }) => ({
    batch: one(batchHeader, {
      fields: [batchCostVariance.batch_id],
      references: [batchHeader.batch_id],
    }),
    item: one(itemMaster, {
      fields: [batchCostVariance.item_id],
      references: [itemMaster.item_id],
    }),
    journal: one(journalHeader, {
      fields: [batchCostVariance.journal_id],
      references: [journalHeader.journal_id],
    }),
  }),
);

// ==========================================
// 11b. PARAMETER / SCHEDULER / KPI ENGINE (Phase 6)
// Additive KPI-monitoring layer — hooks into batch_transaction inserts.
// Does not touch Phase 7's variance engine (batch_standard stays separate).
// ==========================================

export const parameterMaster = mysqlTable('parameter_master', {
  parameter_id: varchar('parameter_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
  company_id: varchar('company_id', { length: 36 }), // null = tenant-wide template
  nob_id: varchar('nob_id', { length: 36 }).references(() => nobMaster.nob_id, {
    onDelete: 'restrict',
  }),
  lob_id: varchar('lob_id', { length: 36 }).references(() => lobMaster.lob_id, {
    onDelete: 'restrict',
  }),
  parameter_code: varchar('parameter_code', { length: 50 }).notNull(),
  parameter_name: varchar('parameter_name', { length: 200 }).notNull(),
  parameter_type: varchar('parameter_type', { length: 20 }).notNull(), // CONSUMPTION, MORTALITY, OUTPUT, OVERHEAD, OBSERVATION
  item_id: varchar('item_id', { length: 36 }).references(
    () => itemMaster.item_id,
    { onDelete: 'restrict' },
  ),
  resource_id: varchar('resource_id', { length: 36 }).references(
    () => resourceMaster.resource_id,
    { onDelete: 'restrict' },
  ),
  default_uom: varchar('default_uom', { length: 20 }),
  qty_method: varchar('qty_method', { length: 20 }).notNull(), // PER_UNIT, PER_BATCH, MANUAL_AT_ENTRY
  default_qty_per_unit: decimal('default_qty_per_unit', {
    precision: 18,
    scale: 8,
  }),
  default_qty_per_batch: decimal('default_qty_per_batch', {
    precision: 18,
    scale: 4,
  }),
  description: text('description'),
  is_mandatory: boolean('is_mandatory').default(false).notNull(),
  is_active: boolean('is_active').default(true).notNull(),
  created_by: varchar('created_by', { length: 36 }),
  created_at: timestamp('created_at', { mode: 'string' })
    .defaultNow()
    .notNull(),
});

/**
 * One scheduler_header per (batch_id, stage_id) — auto-created by
 * BatchService.transferStage() the moment a batch resolves into a real
 * Stage Master row (see SchedulerHeaderService.createForStage()), carrying
 * that stage's scheduler_line rows for the daily data-entry screen. Replaces
 * the old scheduler_master template-per-batch model: there is no longer a
 * "pick a scheduler" step at batch creation — every stage a batch passes
 * through gets its own instance, sourced from breed_lifecycle_stages.
 */
export const schedulerHeader = mysqlTable(
  'scheduler_header',
  {
    scheduler_id: varchar('scheduler_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 })
      .notNull()
      .references(() => companyMaster.company_id, { onDelete: 'restrict' }),
    batch_id: varchar('batch_id', { length: 36 })
      .notNull()
      .references(() => batchHeader.batch_id, { onDelete: 'restrict' }),
    stage_id: varchar('stage_id', { length: 36 })
      .notNull()
      .references(() => stageMaster.stage_id, { onDelete: 'restrict' }),
    breed_id: varchar('breed_id', { length: 36 }).references(
      () => breedMaster.breed_id,
      { onDelete: 'restrict' },
    ),
    lob_id: varchar('lob_id', { length: 36 })
      .notNull()
      .references(() => lobMaster.lob_id, { onDelete: 'restrict' }),
    nob_id: varchar('nob_id', { length: 36 }).references(
      () => nobMaster.nob_id,
      { onDelete: 'restrict' },
    ),
    // Batch's sub_location_id (or location_id/shed_id fallback) at the moment this
    // stage started — a snapshot, not a live pointer, since the batch can move
    // again while this header stays the historical record of that stage's plan.
    // Shares location_master's own id space with farm/shed/warehouse_master
    // (location.service.ts's legacy-mirror insert), so this FK holds for a
    // shed_id fallback too, not only a "real" location_id.
    location_id: varchar('location_id', { length: 36 }).references(
      () => locationMaster.location_id,
      { onDelete: 'restrict' },
    ),
    data_entry_level: varchar('data_entry_level', { length: 10 })
      .default('SHED')
      .notNull(), // FARM, SHED, PEN
    scheduler_status: varchar('scheduler_status', { length: 20 })
      .default('DRAFT')
      .notNull(), // DRAFT, ACTIVE, COMPLETED, SUSPENDED
    effective_from: date('effective_from', { mode: 'string' }).notNull(),
    effective_to: date('effective_to', { mode: 'string' }),
    actual_end_date: date('actual_end_date', { mode: 'string' }),
    animal_count: decimal('animal_count', {
      precision: 14,
      scale: 4,
    }).notNull(),
    auto_generated: boolean('auto_generated').default(true).notNull(),
    approved_by: varchar('approved_by', { length: 36 }),
    approved_at: timestamp('approved_at', { mode: 'string' }),
    notes: text('notes'),
    extension_config: json('extension_config'),
    created_by: varchar('created_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    // "One scheduler_header per batch per stage" — the spec's own words.
    uqBatchStage: uniqueIndex('uq_scheduler_header_batch_stage').on(
      table.batch_id,
      table.stage_id,
    ),
  }),
);

/**
 * One row per parameter (feed, medicine, vaccine, KPI check, overhead cost,
 * resource booking, inter-batch transfer) captured on a scheduler_header's
 * daily data-entry screen. Which columns apply is governed entirely by
 * line_type — see the "LINE TYPE REFERENCE" sheet in
 * Master Templates/Schedule_master_template.xlsx, enforced in
 * scheduler-header.service.ts's per-type validation, not in the schema.
 *
 * Deliberately does NOT store uom/resource_name — the template marks those
 * CALC (auto-flow, read-only), so they're resolved via join to item_master/
 * resource_master at read time instead of duplicated here, where an edit to
 * the source master would otherwise silently drift. item_description is the
 * one exception: TDD explicitly calls it out as free-editable, not CALC.
 */
export const schedulerLine = mysqlTable(
  'scheduler_line',
  {
    line_id: varchar('line_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    scheduler_id: varchar('scheduler_id', { length: 36 }).notNull(),
    // Unique per scheduler_id (uqSchedulerLineSeq below) — the data-entry screen
    // groups rows by line_type first, then orders by this within that group.
    line_seq: int('line_seq').notNull(),
    line_type: varchar('line_type', { length: 20 }).notNull(), // CONSUMPTION, OUTPUT, DESCRIPTIVE, OVERHEAD, RESOURCE, TRANSFER
    activity_name: varchar('activity_name', { length: 200 }).notNull(),
    // Auto-flows from scheduler_header.stage_id — every line under one header
    // belongs to that header's single stage; stored redundantly (not just
    // derived via join) because the TDD names it as its own line-level field.
    stage_id: varchar('stage_id', { length: 36 }).references(
      () => stageMaster.stage_id,
      { onDelete: 'restrict' },
    ),
    occurrence: varchar('occurrence', { length: 10 })
      .default('DAILY')
      .notNull(), // DAILY, WEEKLY, MONTHLY, ONCE, CUSTOM
    start_day: int('start_day').default(1).notNull(),
    end_day: int('end_day'),
    day_of_week: int('day_of_week'), // 1=Monday..7=Sunday — required when occurrence = WEEKLY
    is_mandatory: boolean('is_mandatory').default(false).notNull(),
    source: varchar('source', { length: 10 }).default('AUTO').notNull(), // AUTO, MANUAL
    lifecycle_ref_id: varchar('lifecycle_ref_id', { length: 36 }),
    nob_id: varchar('nob_id', { length: 36 }),
    lob_id: varchar('lob_id', { length: 36 }),
    item_id: varchar('item_id', { length: 36 }).references(
      () => itemMaster.item_id,
      { onDelete: 'restrict' },
    ), // CONSUMPTION / OUTPUT
    // Free-editable, unlike uom/resource_name — pre-filled from item_master.item_name
    // when auto-generated, but the TDD explicitly wants this writable afterward.
    item_description: varchar('item_description', { length: 200 }),
    standard_qty: decimal('standard_qty', { precision: 18, scale: 6 }),
    qty_basis: varchar('qty_basis', { length: 20 }), // PER_HEAD, TOTAL_BATCH, PER_PEN, FIXED
    allow_qty_edit: boolean('allow_qty_edit').default(true).notNull(),
    lot_required: boolean('lot_required').default(false).notNull(),
    creates_inventory: boolean('creates_inventory').default(false).notNull(), // OUTPUT only
    output_lot_auto: boolean('output_lot_auto').default(true).notNull(), // OUTPUT only
    output_basis: varchar('output_basis', { length: 20 }), // PER_SOW, PER_PEN, PER_BATCH
    // TRANSFER only — posting this line auto-creates (or reuses) the destination
    // batch's scheduler_header for its current stage, instead of waiting on a
    // separate stage transition.
    auto_triggers_stage: boolean('auto_triggers_stage')
      .default(false)
      .notNull(),
    kpi_metric: varchar('kpi_metric', { length: 50 }), // DESCRIPTIVE only — BODY_WEIGHT, FCR, MORTALITY_COUNT, ...
    kpi_uom: varchar('kpi_uom', { length: 20 }),
    std_value: decimal('std_value', { precision: 18, scale: 4 }),
    lower_alert_limit: decimal('lower_alert_limit', {
      precision: 18,
      scale: 4,
    }),
    upper_alert_limit: decimal('upper_alert_limit', {
      precision: 18,
      scale: 4,
    }),
    alert_severity: varchar('alert_severity', { length: 10 }).default(
      'WARNING',
    ), // INFO, WARNING, CRITICAL
    capture_per: varchar('capture_per', { length: 20 }), // AVERAGE, TOTAL, PER_HEAD — DESCRIPTIVE only
    overhead_category: varchar('overhead_category', { length: 30 }), // OVERHEAD only
    gl_account: varchar('gl_account', { length: 20 }), // OVERHEAD / RESOURCE — gl_account_master.account_code
    estimated_cost: decimal('estimated_cost', { precision: 18, scale: 4 }),
    resource_id: varchar('resource_id', { length: 36 }).references(
      () => resourceMaster.resource_id,
      { onDelete: 'restrict' },
    ), // RESOURCE only
    is_active: boolean('is_active').default(true).notNull(),
    extension_config: json('extension_config'),
  },
  (table) => ({
    schedulerFk: foreignKey({
      columns: [table.scheduler_id],
      foreignColumns: [schedulerHeader.scheduler_id],
      name: 'scheduler_line_scheduler_id_fk',
    }).onDelete('cascade'),
    lifecycleFk: foreignKey({
      columns: [table.lifecycle_ref_id],
      foreignColumns: [breedLifecycleStages.lifecycle_id],
      name: 'scheduler_line_lifecycle_ref_fk',
    }).onDelete('set null'),
    uqSchedulerLineSeq: uniqueIndex('uq_scheduler_line_scheduler_seq').on(
      table.scheduler_id,
      table.line_seq,
    ),
  }),
);

/** Specific day numbers (from batch/stage start) a CUSTOM-occurrence line appears on
 * — e.g. a vaccination on day 7, 21 and 35. Replaces the xlsx's redundant
 * scheduler_line.custom_days JSONB column (the sheet defines both; this normalized,
 * queryable child table is the one kept). */
export const schedulerLineCustomDays = mysqlTable(
  'scheduler_line_custom_days',
  {
    custom_day_id: varchar('custom_day_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    line_id: varchar('line_id', { length: 36 })
      .notNull()
      .references(() => schedulerLine.line_id, { onDelete: 'cascade' }),
    day_number: int('day_number').notNull(),
    day_label: varchar('day_label', { length: 50 }),
    is_active: boolean('is_active').default(true).notNull(),
  },
  (table) => ({
    uqLineDay: uniqueIndex('uq_scheduler_line_custom_days_line_day').on(
      table.line_id,
      table.day_number,
    ),
  }),
);

/**
 * One row per (scheduler_line, entry_date) — what a farmer actually entered on the
 * daily data-entry screen, and what posting resulted from it. `posted`/`posting_reference`
 * record the outcome of BatchDailyDataService's per-line_type dispatch (see the "LINE TYPE
 * REFERENCE" sheet's "Posting Engine Action" column): CONSUMPTION/OUTPUT reference an
 * inventory_ledger row, OVERHEAD/RESOURCE a GL journal, TRANSFER the destination batch_id;
 * DESCRIPTIVE never posts (batch_daily_data is itself the record) but can still set
 * alert_triggered when the value breaches the line's lower/upper_alert_limit.
 */
export const batchDailyData = mysqlTable(
  'batch_daily_data',
  {
    entry_id: varchar('entry_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 }).notNull(),
    line_id: varchar('line_id', { length: 36 })
      .notNull()
      .references(() => schedulerLine.line_id, { onDelete: 'restrict' }),
    batch_id: varchar('batch_id', { length: 36 })
      .notNull()
      .references(() => batchHeader.batch_id, { onDelete: 'restrict' }),
    // Null for BATCH_WISE batches (unchanged historical meaning: the row applies
    // to the whole batch). Set for ANIMAL_WISE batches — the same nullable
    // per-row-attribution pattern batch_transaction.animal_id already uses.
    animal_id: varchar('animal_id', { length: 36 }).references(
      () => animalRegister.animal_id,
      { onDelete: 'set null' },
    ),
    entry_date: date('entry_date', { mode: 'string' }).notNull(),
    entered_value: decimal('entered_value', { precision: 18, scale: 6 }),
    entered_text: varchar('entered_text', { length: 500 }),
    lot_id: varchar('lot_id', { length: 36 }),
    lot_no: varchar('lot_no', { length: 80 }),
    resource_id: varchar('resource_id', { length: 36 }),
    posted: boolean('posted').default(false).notNull(),
    posting_reference: varchar('posting_reference', { length: 36 }), // inventory_ledger.ledger_id, journal_header.journal_id, or destination batch_id
    alert_triggered: boolean('alert_triggered').default(false).notNull(),
    alert_note: varchar('alert_note', { length: 500 }),
    remarks: varchar('remarks', { length: 500 }),
    created_by: varchar('created_by', { length: 36 }),
    updated_by: varchar('updated_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    // MySQL treats every NULL as distinct in a UNIQUE index, so a plain
    // UNIQUE(line_id, entry_date, animal_id) would silently stop enforcing
    // "one row per line/date for the whole batch" the moment animal_id is
    // nullable — multiple NULL-animal rows for the same (line_id, entry_date)
    // would no longer collide. The coalesce(...) expression substitutes a fixed
    // sentinel for NULL so the constraint still holds for BATCH_WISE rows,
    // while still letting distinct animals collide on their own real id for
    // ANIMAL_WISE rows. Same trick already used by reason_master/activity_master.
    uqLineDate: uniqueIndex('uq_batch_daily_data_line_date').on(
      table.line_id,
      table.entry_date,
      sql`(coalesce(${table.animal_id}, ''))`,
    ),
  }),
);

// ANIMAL_WISE only (see BatchDailyDataService/BatchService — Batch-wise has no
// day-lock today and this feature doesn't add one for it). One row per
// (batch, stage, date): LOCKED once "POST STAGE DATA" succeeds — every
// mandatory line for every animal currently in that stage on that date is
// filled — after which postEntry() refuses further writes against it.
// REOPENED is a direct, audit-logged, permissioned action (no automated
// ledger/GL/bio-asset reversal yet — the reopened entries are corrected by
// hand and reconciled the same way an unposted entry always was); it does not
// undo the underlying financial postings, so it's deliberately scoped smaller
// than a full reversal. The row is reused (not re-inserted) across a
// lock -> reopen -> lock cycle; audit_log already carries the full history of
// each transition.
export const batchDataEntryLock = mysqlTable(
  'batch_data_entry_lock',
  {
    lock_id: varchar('lock_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 }).notNull(),
    batch_id: varchar('batch_id', { length: 36 })
      .notNull()
      .references(() => batchHeader.batch_id, { onDelete: 'restrict' }),
    stage_id: varchar('stage_id', { length: 36 })
      .notNull()
      .references(() => stageMaster.stage_id, { onDelete: 'restrict' }),
    entry_date: date('entry_date', { mode: 'string' }).notNull(),
    status: varchar('status', { length: 10 }).notNull(), // LOCKED, REOPENED
    locked_by: varchar('locked_by', { length: 36 }),
    locked_at: timestamp('locked_at', { mode: 'string' }),
    reopened_by: varchar('reopened_by', { length: 36 }),
    reopened_at: timestamp('reopened_at', { mode: 'string' }),
    reopen_reason: varchar('reopen_reason', { length: 500 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    uqBatchStageDate: uniqueIndex(
      'uq_batch_data_entry_lock_batch_stage_date',
    ).on(table.batch_id, table.stage_id, table.entry_date),
  }),
);

export const notificationAlertLog = mysqlTable(
  'notification_alert_log',
  {
    alert_id: varchar('alert_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 })
      .notNull()
      .references(() => companyMaster.company_id, { onDelete: 'restrict' }),
    lob_id: varchar('lob_id', { length: 36 }).references(
      () => lobMaster.lob_id,
      { onDelete: 'restrict' },
    ),
    batch_id: varchar('batch_id', { length: 36 }).references(
      () => batchHeader.batch_id,
      { onDelete: 'cascade' },
    ),
    // References scheduler_line.line_id (loose pointer, no FK — same pattern as
    // transaction_id below). Named line_id rather than the old table's "spl_id"
    // now that scheduler_parameter_line no longer exists.
    line_id: varchar('line_id', { length: 36 }),
    transaction_id: varchar('transaction_id', { length: 36 }),
    alert_type: varchar('alert_type', { length: 40 })
      .default('KPI_DEVIATION')
      .notNull(),
    severity: varchar('severity', { length: 10 }).notNull(), // INFO, WARNING, CRITICAL
    title: varchar('title', { length: 200 }).notNull(),
    message: text('message').notNull(),
    activity_name: varchar('activity_name', { length: 200 }),
    kpi_mode: varchar('kpi_mode', { length: 10 }),
    expected_value: decimal('expected_value', { precision: 18, scale: 4 }),
    actual_value: decimal('actual_value', { precision: 18, scale: 4 }),
    deviation_amount: decimal('deviation_amount', { precision: 18, scale: 4 }),
    deviation_pct: decimal('deviation_pct', { precision: 8, scale: 2 }),
    kpi_min: decimal('kpi_min', { precision: 18, scale: 4 }),
    kpi_max: decimal('kpi_max', { precision: 18, scale: 4 }),
    is_read: boolean('is_read').default(false).notNull(),
    read_by: varchar('read_by', { length: 36 }),
    read_at: timestamp('read_at', { mode: 'string' }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    lineFk: foreignKey({
      columns: [table.line_id],
      foreignColumns: [schedulerLine.line_id],
      name: 'nal_line_id_fk',
    }).onDelete('restrict'),
    transactionFk: foreignKey({
      columns: [table.transaction_id],
      foreignColumns: [batchTransaction.transaction_id],
      name: 'nal_transaction_id_fk',
    }).onDelete('restrict'),
  }),
);

export const parameterMasterRelations = relations(
  parameterMaster,
  ({ one }) => ({
    item: one(itemMaster, {
      fields: [parameterMaster.item_id],
      references: [itemMaster.item_id],
    }),
    resource: one(resourceMaster, {
      fields: [parameterMaster.resource_id],
      references: [resourceMaster.resource_id],
    }),
  }),
);

export const schedulerHeaderRelations = relations(
  schedulerHeader,
  ({ one, many }) => ({
    batch: one(batchHeader, {
      fields: [schedulerHeader.batch_id],
      references: [batchHeader.batch_id],
    }),
    stage: one(stageMaster, {
      fields: [schedulerHeader.stage_id],
      references: [stageMaster.stage_id],
    }),
    breed: one(breedMaster, {
      fields: [schedulerHeader.breed_id],
      references: [breedMaster.breed_id],
    }),
    lines: many(schedulerLine),
  }),
);

export const schedulerLineRelations = relations(
  schedulerLine,
  ({ one, many }) => ({
    scheduler: one(schedulerHeader, {
      fields: [schedulerLine.scheduler_id],
      references: [schedulerHeader.scheduler_id],
    }),
    item: one(itemMaster, {
      fields: [schedulerLine.item_id],
      references: [itemMaster.item_id],
    }),
    resource: one(resourceMaster, {
      fields: [schedulerLine.resource_id],
      references: [resourceMaster.resource_id],
    }),
    lifecycleRef: one(breedLifecycleStages, {
      fields: [schedulerLine.lifecycle_ref_id],
      references: [breedLifecycleStages.lifecycle_id],
    }),
    customDays: many(schedulerLineCustomDays),
  }),
);

export const schedulerLineCustomDaysRelations = relations(
  schedulerLineCustomDays,
  ({ one }) => ({
    line: one(schedulerLine, {
      fields: [schedulerLineCustomDays.line_id],
      references: [schedulerLine.line_id],
    }),
  }),
);

export const batchDailyDataRelations = relations(batchDailyData, ({ one }) => ({
  line: one(schedulerLine, {
    fields: [batchDailyData.line_id],
    references: [schedulerLine.line_id],
  }),
  batch: one(batchHeader, {
    fields: [batchDailyData.batch_id],
    references: [batchHeader.batch_id],
  }),
}));

export const notificationAlertLogRelations = relations(
  notificationAlertLog,
  ({ one }) => ({
    batch: one(batchHeader, {
      fields: [notificationAlertLog.batch_id],
      references: [batchHeader.batch_id],
    }),
    schedulerLine: one(schedulerLine, {
      fields: [notificationAlertLog.line_id],
      references: [schedulerLine.line_id],
    }),
    transaction: one(batchTransaction, {
      fields: [notificationAlertLog.transaction_id],
      references: [batchTransaction.transaction_id],
    }),
  }),
);

// ==========================================
// 11c. QC / QR TRACEABILITY ENGINE
// Additive — reads batch_header/batch_input_line/batch_output_line for
// traceability, never writes to them. QC and QR generation are independent
// (a QR can exist with or without a linked QC record).
// ==========================================

export const qcParameterMaster = mysqlTable('qc_parameter_master', {
  param_id: varchar('param_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
  company_id: varchar('company_id', { length: 36 }), // null = tenant-wide template
  lob_id: varchar('lob_id', { length: 36 })
    .notNull()
    .references(() => lobMaster.lob_id, { onDelete: 'restrict' }),
  param_code: varchar('param_code', { length: 50 }).notNull(),
  param_name: varchar('param_name', { length: 100 }).notNull(),
  param_type: varchar('param_type', { length: 20 }).notNull(), // NUMERIC, BOOLEAN, GRADE
  uom: varchar('uom', { length: 20 }),
  min_value: decimal('min_value', { precision: 18, scale: 4 }),
  max_value: decimal('max_value', { precision: 18, scale: 4 }),
  pass_criteria: text('pass_criteria'),
  fail_criteria: text('fail_criteria'),
  grade_scale: json('grade_scale'), // GRADE type: { "A": "2.0-2.5kg", "B": "1.8-2.0kg" }
  is_mandatory: boolean('is_mandatory').default(true).notNull(),
  is_active: boolean('is_active').default(true).notNull(),
  created_by: varchar('created_by', { length: 36 }),
  created_at: timestamp('created_at', { mode: 'string' })
    .defaultNow()
    .notNull(),
});

export const qcBatchDetail = mysqlTable('qc_batch_detail', {
  qc_id: varchar('qc_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
  company_id: varchar('company_id', { length: 36 }).notNull(),
  source_batch_id: varchar('source_batch_id', { length: 36 })
    .notNull()
    .references(() => batchHeader.batch_id, { onDelete: 'restrict' }),
  output_line_id: varchar('output_line_id', { length: 36 }).references(
    () => batchOutputLine.line_id,
    { onDelete: 'restrict' },
  ),
  qc_date: date('qc_date', { mode: 'string' }).notNull(),
  inspector_id: varchar('inspector_id', { length: 36 }).references(
    () => userMaster.user_id,
    { onDelete: 'restrict' },
  ),
  total_qty_received: decimal('total_qty_received', {
    precision: 18,
    scale: 4,
  }).notNull(),
  pass_qty: decimal('pass_qty', { precision: 18, scale: 4 })
    .default('0.0000')
    .notNull(),
  fail_qty: decimal('fail_qty', { precision: 18, scale: 4 })
    .default('0.0000')
    .notNull(),
  hold_qty: decimal('hold_qty', { precision: 18, scale: 4 })
    .default('0.0000')
    .notNull(),
  grade_a_qty: decimal('grade_a_qty', { precision: 18, scale: 4 }),
  grade_b_qty: decimal('grade_b_qty', { precision: 18, scale: 4 }),
  grade_c_qty: decimal('grade_c_qty', { precision: 18, scale: 4 }),
  overall_result: varchar('overall_result', { length: 20 }).notNull(), // PASS, FAIL, CONDITIONAL
  disposition: varchar('disposition', { length: 30 }).notNull(), // ACCEPT, REJECT, REWORK, QUARANTINE, CONDITIONAL_ACCEPT
  qc_notes: text('qc_notes'),
  created_by: varchar('created_by', { length: 36 }),
  created_at: timestamp('created_at', { mode: 'string' })
    .defaultNow()
    .notNull(),
});

export const qcParamResult = mysqlTable('qc_param_result', {
  result_id: varchar('result_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  qc_id: varchar('qc_id', { length: 36 })
    .notNull()
    .references(() => qcBatchDetail.qc_id, { onDelete: 'cascade' }),
  param_id: varchar('param_id', { length: 36 })
    .notNull()
    .references(() => qcParameterMaster.param_id, { onDelete: 'restrict' }),
  actual_value: varchar('actual_value', { length: 200 }).notNull(),
  result_status: varchar('result_status', { length: 10 }).notNull(), // PASS, FAIL
  grade_assigned: varchar('grade_assigned', { length: 10 }),
  notes: text('notes'),
});

export const qrCodeMaster = mysqlTable('qr_code_master', {
  qr_id: varchar('qr_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
  company_id: varchar('company_id', { length: 36 }).notNull(),
  batch_id: varchar('batch_id', { length: 36 })
    .notNull()
    .references(() => batchHeader.batch_id, { onDelete: 'restrict' }),
  output_line_id: varchar('output_line_id', { length: 36 }).references(
    () => batchOutputLine.line_id,
    { onDelete: 'restrict' },
  ),
  qc_id: varchar('qc_id', { length: 36 }).references(
    () => qcBatchDetail.qc_id,
    { onDelete: 'restrict' },
  ),
  item_id: varchar('item_id', { length: 36 })
    .notNull()
    .references(() => itemMaster.item_id, { onDelete: 'restrict' }),
  lot_no: varchar('lot_no', { length: 100 }),
  pack_no: varchar('pack_no', { length: 50 }).notNull(),
  production_date: date('production_date', { mode: 'string' }).notNull(),
  expiry_date: date('expiry_date', { mode: 'string' }),
  net_weight: decimal('net_weight', { precision: 10, scale: 4 }).notNull(),
  gross_weight: decimal('gross_weight', { precision: 10, scale: 4 }),
  pack_uom: varchar('pack_uom', { length: 20 }).notNull(),
  warehouse_id: varchar('warehouse_id', { length: 36 }).references(
    () => locationMaster.location_id,
    { onDelete: 'restrict' },
  ),
  grade: varchar('grade', { length: 10 }),
  origin_batch_chain: json('origin_batch_chain'),
  breed: varchar('breed', { length: 100 }),
  qr_data: json('qr_data').notNull(),
  generated_at: timestamp('generated_at', { mode: 'string' })
    .defaultNow()
    .notNull(),
  generated_by: varchar('generated_by', { length: 36 }),
  is_voided: boolean('is_voided').default(false).notNull(),
});

export const qcParameterMasterRelations = relations(
  qcParameterMaster,
  ({ one }) => ({
    lob: one(lobMaster, {
      fields: [qcParameterMaster.lob_id],
      references: [lobMaster.lob_id],
    }),
  }),
);

export const qcBatchDetailRelations = relations(
  qcBatchDetail,
  ({ one, many }) => ({
    sourceBatch: one(batchHeader, {
      fields: [qcBatchDetail.source_batch_id],
      references: [batchHeader.batch_id],
    }),
    outputLine: one(batchOutputLine, {
      fields: [qcBatchDetail.output_line_id],
      references: [batchOutputLine.line_id],
    }),
    inspector: one(userMaster, {
      fields: [qcBatchDetail.inspector_id],
      references: [userMaster.user_id],
    }),
    paramResults: many(qcParamResult),
  }),
);

export const qcParamResultRelations = relations(qcParamResult, ({ one }) => ({
  qcBatch: one(qcBatchDetail, {
    fields: [qcParamResult.qc_id],
    references: [qcBatchDetail.qc_id],
  }),
  parameter: one(qcParameterMaster, {
    fields: [qcParamResult.param_id],
    references: [qcParameterMaster.param_id],
  }),
}));

export const qrCodeMasterRelations = relations(qrCodeMaster, ({ one }) => ({
  batch: one(batchHeader, {
    fields: [qrCodeMaster.batch_id],
    references: [batchHeader.batch_id],
  }),
  outputLine: one(batchOutputLine, {
    fields: [qrCodeMaster.output_line_id],
    references: [batchOutputLine.line_id],
  }),
  qcBatch: one(qcBatchDetail, {
    fields: [qrCodeMaster.qc_id],
    references: [qcBatchDetail.qc_id],
  }),
  item: one(itemMaster, {
    fields: [qrCodeMaster.item_id],
    references: [itemMaster.item_id],
  }),
  warehouse: one(locationMaster, {
    fields: [qrCodeMaster.warehouse_id],
    references: [locationMaster.location_id],
  }),
}));

export const auditLog = mysqlTable('audit_log', {
  audit_id: varchar('audit_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
  company_id: varchar('company_id', { length: 36 }).references(
    () => companyMaster.company_id,
    { onDelete: 'cascade' },
  ),
  user_id: varchar('user_id', { length: 36 }).references(
    () => userMaster.user_id,
    { onDelete: 'set null' },
  ),
  action: varchar('action', { length: 50 }).notNull(), // INSERT, UPDATE, DELETE, LOGIN, MFA_VERIFY, etc.
  entity_name: varchar('entity_name', { length: 100 }).notNull(), // e.g. company_master
  entity_id: varchar('entity_id', { length: 36 }).notNull(),
  old_values: json('old_values'),
  new_values: json('new_values'),
  ip_address: varchar('ip_address', { length: 50 }),
  user_agent: text('user_agent'),
  created_at: timestamp('created_at', { mode: 'string' })
    .defaultNow()
    .notNull(),
});

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  company: one(companyMaster, {
    fields: [auditLog.company_id],
    references: [companyMaster.company_id],
  }),
  user: one(userMaster, {
    fields: [auditLog.user_id],
    references: [userMaster.user_id],
  }),
}));

export const notificationLog = mysqlTable('notification_log', {
  log_id: varchar('log_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  company_id: varchar('company_id', { length: 36 })
    .notNull()
    .references(() => companyMaster.company_id, { onDelete: 'cascade' }),
  recipient: varchar('recipient', { length: 255 }).notNull(),
  channel: varchar('channel', { length: 20 }).notNull(),
  message: text('message').notNull(),
  status: varchar('status', { length: 20 }).default('PENDING').notNull(),
  error_message: text('error_message'),
  sent_at: timestamp('sent_at', { mode: 'string' }).defaultNow().notNull(),
});

export const notificationLogRelations = relations(
  notificationLog,
  ({ one }) => ({
    company: one(companyMaster, {
      fields: [notificationLog.company_id],
      references: [companyMaster.company_id],
    }),
  }),
);

// ==========================================
// 9. INVENTORY ENGINE (Phase 3)
// ==========================================

// Append-only movement log. Rows are never updated or soft-deleted — corrections
// are made via new offsetting entries, matching standard ERP ledger practice.
export const inventoryLedger = mysqlTable('inventory_ledger', {
  ledger_id: varchar('ledger_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
  company_id: varchar('company_id', { length: 36 })
    .notNull()
    .references(() => companyMaster.company_id, { onDelete: 'restrict' }),
  item_id: varchar('item_id', { length: 36 })
    .notNull()
    .references(() => itemMaster.item_id, { onDelete: 'restrict' }),
  item_code: varchar('item_code', { length: 255 }).notNull(), // denormalized snapshot at posting time
  item_description: varchar('item_description', { length: 200 }).notNull(),
  document_type: varchar('document_type', { length: 30 }).notNull(), // GOODS_RECEIPT, GOODS_ISSUE, TRANSFER, ADJUSTMENT
  document_no: varchar('document_no', { length: 50 }).notNull(),
  document_line_id: varchar('document_line_id', { length: 36 }),
  posting_date: date('posting_date', { mode: 'string' }).notNull(),
  external_reference_no: varchar('external_reference_no', { length: 50 }),
  entry_type: varchar('entry_type', { length: 20 }).notNull(), // POSITIVE, NEGATIVE, TRANSFER, OVERHEAD, DESCRIPTIVE
  transaction_type: varchar('transaction_type', { length: 30 }).notNull(), // PURCHASE, CONSUMPTION, OUTPUT, TRANSFER_SHIPMENT, TRANSFER_RECEIPT, SALES, VARIANCE_POSITIVE, VARIANCE_NEGATIVE
  quantity: decimal('quantity', { precision: 18, scale: 4 }).notNull(), // signed
  remaining_quantity: decimal('remaining_quantity', {
    precision: 18,
    scale: 4,
  }), // meaningful on POSITIVE entries only
  uom: varchar('uom', { length: 20 }).notNull(),
  uom_conversion_factor: decimal('uom_conversion_factor', {
    precision: 18,
    scale: 6,
  }),
  alternate_quantity: decimal('alternate_quantity', {
    precision: 18,
    scale: 4,
  }),
  rate: decimal('rate', { precision: 18, scale: 6 }),
  amount: decimal('amount', { precision: 18, scale: 4 }),
  lot_no: varchar('lot_no', { length: 50 }),
  serial_no: varchar('serial_no', { length: 100 }),
  expiry_date: date('expiry_date', { mode: 'string' }),
  batch_no: varchar('batch_no', { length: 50 }), // denormalized from batch_header.batch_no (Phase 5) for query convenience
  location_id: varchar('location_id', { length: 36 }).references(
    () => locationMaster.location_id,
    { onDelete: 'restrict' },
  ),
  warehouse_id: varchar('warehouse_id', { length: 36 }).references(
    () => locationMaster.location_id,
    { onDelete: 'restrict' },
  ),
  nob_id: varchar('nob_id', { length: 36 }).references(() => nobMaster.nob_id, {
    onDelete: 'restrict',
  }),
  lob_id: varchar('lob_id', { length: 36 }).references(() => lobMaster.lob_id, {
    onDelete: 'restrict',
  }),
  category_id: varchar('category_id', { length: 36 }).references(
    () => itemCategoryMaster.category_id,
    { onDelete: 'restrict' },
  ),
  created_by: varchar('created_by', { length: 36 }),
  created_at: timestamp('created_at', { mode: 'string' })
    .defaultNow()
    .notNull(),
});

// FIFO matching: which inbound (receipt) ledger rows an outbound (consumption)
// ledger row drew its quantity/cost from.
export const inventoryApplication = mysqlTable(
  'inventory_application',
  {
    application_id: varchar('application_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 })
      .notNull()
      .references(() => companyMaster.company_id, { onDelete: 'restrict' }),
    item_id: varchar('item_id', { length: 36 })
      .notNull()
      .references(() => itemMaster.item_id, { onDelete: 'restrict' }),
    inbound_ledger_id: varchar('inbound_ledger_id', { length: 36 }).notNull(),
    outbound_ledger_id: varchar('outbound_ledger_id', { length: 36 }).notNull(),
    applied_qty: decimal('applied_qty', { precision: 18, scale: 4 }).notNull(),
    applied_cost_amount: decimal('applied_cost_amount', {
      precision: 18,
      scale: 4,
    }).notNull(),
    application_date: date('application_date', { mode: 'string' }).notNull(),
    created_by: varchar('created_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    inboundLedgerFk: foreignKey({
      columns: [table.inbound_ledger_id],
      foreignColumns: [inventoryLedger.ledger_id],
      name: 'inv_app_inbound_ledger_fk',
    }).onDelete('restrict'),
    outboundLedgerFk: foreignKey({
      columns: [table.outbound_ledger_id],
      foreignColumns: [inventoryLedger.ledger_id],
      name: 'inv_app_outbound_ledger_fk',
    }).onDelete('restrict'),
  }),
);

// Living/biological asset value-change log (mortality, growth, fair-value
// adjustments, transformation). Auto-written by BIO_ASSET batch lifecycle
// events (activate/consume/mature/amortize/fair-value/dispose — Bio-Asset
// IAS41 batch accounting); batch_id links each row back to its batch_header.
export const bioAssetLedger = mysqlTable('bio_asset_ledger', {
  entry_id: varchar('entry_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
  company_id: varchar('company_id', { length: 36 })
    .notNull()
    .references(() => companyMaster.company_id, { onDelete: 'restrict' }),
  bio_asset_item_id: varchar('bio_asset_item_id', { length: 36 })
    .notNull()
    .references(() => itemMaster.item_id, { onDelete: 'restrict' }),
  entry_type: varchar('entry_type', { length: 30 }).notNull(), // ACQUISITION, CONSUMPTION, WRITEOFF, OVERHEAD, OVERHEAD_COST, GROWTH_ADJMT, MORTALITY, DEAD_PLANT, AMORTIZATION, FAIR_VALUE_ADJMT, TRANSFORMATION
  document_no: varchar('document_no', { length: 50 }),
  posting_date: date('posting_date', { mode: 'string' }).notNull(),
  asset_tracking_type: varchar('asset_tracking_type', { length: 10 }), // SERIAL, LOT
  lot_no: varchar('lot_no', { length: 50 }),
  asset_rfid_no: varchar('asset_rfid_no', { length: 100 }),
  batch_no: varchar('batch_no', { length: 50 }),
  batch_id: varchar('batch_id', { length: 36 }).references(
    () => batchHeader.batch_id,
    { onDelete: 'restrict' },
  ),
  animal_id: varchar('animal_id', { length: 36 }).references(
    () => animalRegister.animal_id,
    { onDelete: 'restrict' },
  ),
  stage: varchar('stage', { length: 50 }),
  status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
  quantity: decimal('quantity', { precision: 18, scale: 4 }),
  cost_amount: decimal('cost_amount', { precision: 18, scale: 4 }),
  cost_amount_each_unit: decimal('cost_amount_each_unit', {
    precision: 18,
    scale: 4,
  }),
  costing_method: varchar('costing_method', { length: 30 }), // COST_ACCUMULATION, AMORTIZED_COST, FAIR_VALUE
  nob_id: varchar('nob_id', { length: 36 }).references(() => nobMaster.nob_id, {
    onDelete: 'restrict',
  }),
  lob_id: varchar('lob_id', { length: 36 }).references(() => lobMaster.lob_id, {
    onDelete: 'restrict',
  }),
  created_by: varchar('created_by', { length: 36 }),
  created_at: timestamp('created_at', { mode: 'string' })
    .defaultNow()
    .notNull(),
});

export const batchBioAssetState = mysqlTable('batch_bio_asset_state', {
  state_id: varchar('state_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  batch_id: varchar('batch_id', { length: 36 })
    .notNull()
    .unique()
    .references(() => batchHeader.batch_id, { onDelete: 'cascade' }),
  stage: varchar('stage', { length: 20 }).default('PREMATURE').notNull(), // PREMATURE, MATURE
  current_quantity: decimal('current_quantity', {
    precision: 18,
    scale: 4,
  }).notNull(),
  nca_book_value: decimal('nca_book_value', { precision: 18, scale: 4 })
    .default('0.0000')
    .notNull(),
  residual_value_per_unit: decimal('residual_value_per_unit', {
    precision: 18,
    scale: 6,
  }),
  productive_life_months: int('productive_life_months'),
  monthly_amortization_rate: decimal('monthly_amortization_rate', {
    precision: 18,
    scale: 6,
  }),
  matured_at: date('matured_at', { mode: 'string' }),
  updated_at: timestamp('updated_at', { mode: 'string' })
    .defaultNow()
    .notNull(),
});

export const batchBioAssetStateRelations = relations(
  batchBioAssetState,
  ({ one }) => ({
    batch: one(batchHeader, {
      fields: [batchBioAssetState.batch_id],
      references: [batchHeader.batch_id],
    }),
  }),
);

export const goodsReceipt = mysqlTable('goods_receipt', {
  receipt_id: varchar('receipt_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
  company_id: varchar('company_id', { length: 36 })
    .notNull()
    .references(() => companyMaster.company_id, { onDelete: 'restrict' }),
  receipt_no: varchar('receipt_no', { length: 50 }).notNull(),
  posting_date: date('posting_date', { mode: 'string' }).notNull(),
  warehouse_id: varchar('warehouse_id', { length: 36 })
    .notNull()
    .references(() => locationMaster.location_id, { onDelete: 'restrict' }),
  supplier_id: varchar('supplier_id', { length: 36 }).references(
    () => supplierMaster.supplier_id,
    { onDelete: 'restrict' },
  ),
  external_reference_no: varchar('external_reference_no', { length: 50 }),
  remarks: text('remarks'),
  status: varchar('status', { length: 20 }).default('DRAFT').notNull(), // DRAFT, POSTED, CANCELLED
  posted_at: timestamp('posted_at', { mode: 'string' }),
  posted_by: varchar('posted_by', { length: 36 }),
  created_by: varchar('created_by', { length: 36 }),
  updated_by: varchar('updated_by', { length: 36 }),
  created_at: timestamp('created_at', { mode: 'string' })
    .defaultNow()
    .notNull(),
  updated_at: timestamp('updated_at', { mode: 'string' })
    .defaultNow()
    .notNull(),
  deleted_at: timestamp('deleted_at', { mode: 'string' }),
});

export const goodsReceiptLine = mysqlTable('goods_receipt_line', {
  line_id: varchar('line_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  receipt_id: varchar('receipt_id', { length: 36 })
    .notNull()
    .references(() => goodsReceipt.receipt_id, { onDelete: 'cascade' }),
  line_no: int('line_no').notNull(),
  item_id: varchar('item_id', { length: 36 })
    .notNull()
    .references(() => itemMaster.item_id, { onDelete: 'restrict' }),
  quantity: decimal('quantity', { precision: 18, scale: 4 }).notNull(),
  uom: varchar('uom', { length: 20 }).notNull(),
  rate: decimal('rate', { precision: 18, scale: 6 }),
  amount: decimal('amount', { precision: 18, scale: 4 }),
  lot_no: varchar('lot_no', { length: 50 }),
  serial_no: varchar('serial_no', { length: 100 }),
  expiry_date: date('expiry_date', { mode: 'string' }),
  remarks: varchar('remarks', { length: 500 }),
});

// Individual animal lifetime identity — permanent record from entry to disposal, never
// physically deleted (is_active=false + disposal_* fields mark disposal instead). Distinct
// from bio_asset_ledger/batch_bio_asset_state, which are batch/cohort-scoped, not per-animal —
// current_bio_asset_value/total_amortised/book_value here are plain columns (not derived from
// the ledger) until that ledger gets a per-animal dimension, a larger change than this table
// alone. current_stage_id is a real FK from the start (no legacy free-text column to preserve,
// unlike batch_header.current_stage_code).
export const animalRegister = mysqlTable(
  'animal_register',
  {
    animal_id: varchar('animal_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 })
      .notNull()
      .references(() => companyMaster.company_id, { onDelete: 'restrict' }),
    nob_id: varchar('nob_id', { length: 36 })
      .notNull()
      .references(() => nobMaster.nob_id, { onDelete: 'restrict' }),
    lob_id: varchar('lob_id', { length: 36 })
      .notNull()
      .references(() => lobMaster.lob_id, { onDelete: 'restrict' }),
    operational_area_id: varchar('operational_area_id', { length: 36 }),
    animal_code: varchar('animal_code', { length: 255 }).notNull(), // AUTO via no_series_master (ANIMAL_PIGGERY)
    animal_type: varchar('animal_type', { length: 20 }).notNull(), // SOW, BOAR, GILT, PIGLET, COMMERCIAL_PIG
    breed_id: varchar('breed_id', { length: 36 })
      .notNull()
      .references(() => breedMaster.breed_id, { onDelete: 'restrict' }),
    gender: char('gender', { length: 1 }).notNull(), // F, M
    dob: date('dob', { mode: 'string' }),
    // Animal Register Master Template column G, TDD row 12: computed from dob and
    // entry_date whenever dob is known, typed by hand only when it is not — an
    // imported animal with no birth record still has an age, and this column is
    // the only place it is written down. Nullable because the template marks it
    // Mandatory: NO, and because an import with neither a dob nor a stated age
    // has no honest value to store.
    age_at_entry_weeks: int('age_at_entry_weeks'),
    entry_type: varchar('entry_type', { length: 30 }).notNull(), // PURCHASED_IMPORTED, PURCHASED_LOCAL, BORN_ON_FARM, TRANSFERRED_IN
    entry_date: date('entry_date', { mode: 'string' }).notNull(),
    // Spec's "source_grn_id" — named to match this codebase's actual table (goods_receipt, not GRN).
    source_receipt_id: varchar('source_receipt_id', { length: 36 }).references(
      () => goodsReceipt.receipt_id,
      { onDelete: 'restrict' },
    ),
    source_batch_id: varchar('source_batch_id', { length: 36 }).references(
      () => batchHeader.batch_id,
      { onDelete: 'restrict' },
    ),
    item_id: varchar('item_id', { length: 36 })
      .notNull()
      .references(() => itemMaster.item_id, { onDelete: 'restrict' }),
    rfid_tag: varchar('rfid_tag', { length: 50 }),
    ear_tag: varchar('ear_tag', { length: 50 }),
    ear_tag_image_url: varchar('ear_tag_image_url', { length: 500 }), // URL only for now; direct upload moves to Cloudflare R2 later
    sire_animal_id: varchar('sire_animal_id', { length: 36 }),
    dam_animal_id: varchar('dam_animal_id', { length: 36 }),
    acquisition_cost: decimal('acquisition_cost', {
      precision: 18,
      scale: 4,
    }).notNull(),
    landing_cost: decimal('landing_cost', { precision: 18, scale: 4 }),
    total_opening_asset_value: decimal('total_opening_asset_value', {
      precision: 18,
      scale: 4,
    }).notNull(), // CALC at create
    current_stage_id: varchar('current_stage_id', { length: 36 }),
    current_batch_id: varchar('current_batch_id', { length: 36 }).references(
      () => batchHeader.batch_id,
      { onDelete: 'restrict' },
    ),
    current_location_id: varchar('current_location_id', {
      length: 36,
    }).references(() => locationMaster.location_id, { onDelete: 'restrict' }),
    parity_count: int('parity_count').default(0).notNull(),
    total_piglets_born_live: int('total_piglets_born_live')
      .default(0)
      .notNull(),
    total_piglets_weaned: int('total_piglets_weaned').default(0).notNull(),
    // Not ledger-derived in this phase — see file-level comment above.
    current_bio_asset_value: decimal('current_bio_asset_value', {
      precision: 18,
      scale: 4,
    }),
    total_amortised: decimal('total_amortised', { precision: 18, scale: 4 }),
    book_value: decimal('book_value', { precision: 18, scale: 4 }),
    residual_value: decimal('residual_value', { precision: 18, scale: 4 }),
    amortisation_monthly: decimal('amortisation_monthly', {
      precision: 18,
      scale: 4,
    }),
    productive_life_start: date('productive_life_start', { mode: 'string' }),
    expected_cull_date: date('expected_cull_date', { mode: 'string' }),
    // Master Template parity (P2) — BBP §6: no_of_teats < 15 is a hard block on gilt
    // selection regardless of TSI score, enforced in animal.service.ts.
    no_of_teats: int('no_of_teats'),
    tsi: decimal('tsi', { precision: 10, scale: 2 }),
    grading: varchar('grading', { length: 20 }),
    serial_number: varchar('serial_number', { length: 50 }),
    status: varchar('status', { length: 20 }).default('ACTIVE').notNull(), // ACTIVE, QUARANTINE, SICK, PREGNANT, LACTATING, DRY, CULLED, DEAD, SOLD, SLAUGHTERED
    disposal_date: date('disposal_date', { mode: 'string' }),
    disposal_type: varchar('disposal_type', { length: 20 }), // SOLD, SLAUGHTERED, DIED, TRANSFERRED
    disposal_value: decimal('disposal_value', { precision: 18, scale: 4 }),
    gain_loss_on_disposal: decimal('gain_loss_on_disposal', {
      precision: 18,
      scale: 4,
    }), // CALC at disposal
    notes: text('notes'),
    // Never physically deleted — is_active=false marks disposal, not a generic soft-delete.
    is_active: boolean('is_active').default(true).notNull(),
    created_by: varchar('created_by', { length: 36 }),
    updated_by: varchar('updated_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    sireFk: foreignKey({
      columns: [table.sire_animal_id],
      foreignColumns: [table.animal_id],
      name: 'animal_register_sire_animal_id_fk',
    }).onDelete('set null'),
    damFk: foreignKey({
      columns: [table.dam_animal_id],
      foreignColumns: [table.animal_id],
      name: 'animal_register_dam_animal_id_fk',
    }).onDelete('set null'),
    currentStageFk: foreignKey({
      columns: [table.current_stage_id],
      foreignColumns: [stageMaster.stage_id],
      name: 'animal_register_current_stage_id_fk',
    }).onDelete('set null'),
    uqAnimalCode: uniqueIndex('uq_animal_register_tenant_code').on(
      table.tenant_id,
      table.animal_code,
    ),
    uqRfidTag: uniqueIndex('uq_animal_register_tenant_rfid').on(
      table.tenant_id,
      table.rfid_tag,
    ),
  }),
);

/**
 * Append-only log of every batch/stage/location movement an animal makes —
 * the single source both the animal-detail HISTORY tab and the LOCATION
 * TRACEABILITY tab read (Rishi's decision, 2026-09-08: "Both read one
 * append-only animal_movement_log rather than two tables, so the two tabs
 * cannot disagree about the same move").
 *
 * animal_register.current_batch_id/current_stage_id/current_location_id are
 * CURRENT state only and get overwritten on every move — this table is where
 * "where has this animal been" actually lives. Never updated or deleted, only
 * inserted to; a later move never rewrites an earlier row.
 *
 * "LAST DATE" on the HISTORY tab is deliberately not a column here — it's the
 * previous row's event_date for the same animal, read at query time, so it
 * can never drift from this log.
 */
export const animalMovementLog = mysqlTable(
  'animal_movement_log',
  {
    movement_id: varchar('movement_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 }).references(
      () => companyMaster.company_id,
      { onDelete: 'restrict' },
    ),
    animal_id: varchar('animal_id', { length: 36 })
      .notNull()
      .references(() => animalRegister.animal_id, { onDelete: 'restrict' }),
    // PURCHASE, ASSIGN, TRANSFER, STAGE_CHANGE, RELOCATE, UNASSIGN, MORTALITY, OUTPUT, CULL
    movement_type: varchar('movement_type', { length: 20 }).notNull(),
    event_date: date('event_date', { mode: 'string' }).notNull(),
    from_batch_id: varchar('from_batch_id', { length: 36 }),
    to_batch_id: varchar('to_batch_id', { length: 36 }),
    from_stage_id: varchar('from_stage_id', { length: 36 }),
    to_stage_id: varchar('to_stage_id', { length: 36 }),
    from_location_id: varchar('from_location_id', { length: 36 }),
    to_location_id: varchar('to_location_id', { length: 36 }),
    // Source document's own number, e.g. batch_transfer.transfer_no — the
    // HISTORY tab's "ENTRY NO." column.
    entry_no: varchar('entry_no', { length: 50 }),
    reason: varchar('reason', { length: 200 }),
    remarks: text('remarks'),
    created_by: varchar('created_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('idx_animal_movement_log_animal').on(
      table.animal_id,
      table.event_date,
    ),
    // SET NULL, never RESTRICT/CASCADE — a movement row is history and must
    // survive its referenced batch/stage/location being deleted later, same
    // principle breeding_record/farrowing_record already apply to their own
    // batch_id.
    foreignKey({
      columns: [table.from_batch_id],
      foreignColumns: [batchHeader.batch_id],
      name: 'aml_from_batch_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.to_batch_id],
      foreignColumns: [batchHeader.batch_id],
      name: 'aml_to_batch_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.from_stage_id],
      foreignColumns: [stageMaster.stage_id],
      name: 'aml_from_stage_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.to_stage_id],
      foreignColumns: [stageMaster.stage_id],
      name: 'aml_to_stage_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.from_location_id],
      foreignColumns: [locationMaster.location_id],
      name: 'aml_from_location_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.to_location_id],
      foreignColumns: [locationMaster.location_id],
      name: 'aml_to_location_fk',
    }).onDelete('set null'),
  ],
);

// Purpose-built per-animal medication event log — not derived from the batch-scoped
// consumption ledger (inventory_ledger/batch_input_line have no animal_id dimension; see
// animal.service.ts's dispose() for the withdrawal-period check this exists to support).
export const animalMedicationLog = mysqlTable('animal_medication_log', {
  log_id: varchar('log_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
  company_id: varchar('company_id', { length: 36 })
    .notNull()
    .references(() => companyMaster.company_id, { onDelete: 'restrict' }),
  animal_id: varchar('animal_id', { length: 36 })
    .notNull()
    .references(() => animalRegister.animal_id, { onDelete: 'restrict' }),
  item_id: varchar('item_id', { length: 36 })
    .notNull()
    .references(() => itemMaster.item_id, { onDelete: 'restrict' }),
  administered_date: date('administered_date', { mode: 'string' }).notNull(),
  dose_qty: decimal('dose_qty', { precision: 18, scale: 4 }),
  uom: varchar('uom', { length: 20 }),
  administered_by: varchar('administered_by', { length: 200 }), // free text — a vet/handler, not necessarily a system user
  notes: text('notes'),
  created_by: varchar('created_by', { length: 36 }),
  created_at: timestamp('created_at', { mode: 'string' })
    .defaultNow()
    .notNull(),
});

export const inventoryLedgerRelations = relations(
  inventoryLedger,
  ({ one, many }) => ({
    item: one(itemMaster, {
      fields: [inventoryLedger.item_id],
      references: [itemMaster.item_id],
    }),
    location: one(locationMaster, {
      fields: [inventoryLedger.location_id],
      references: [locationMaster.location_id],
    }),
    warehouse: one(locationMaster, {
      fields: [inventoryLedger.warehouse_id],
      references: [locationMaster.location_id],
    }),
    inboundApplications: many(inventoryApplication, {
      relationName: 'inbound_ledger',
    }),
    outboundApplications: many(inventoryApplication, {
      relationName: 'outbound_ledger',
    }),
  }),
);

export const inventoryApplicationRelations = relations(
  inventoryApplication,
  ({ one }) => ({
    item: one(itemMaster, {
      fields: [inventoryApplication.item_id],
      references: [itemMaster.item_id],
    }),
    inboundLedger: one(inventoryLedger, {
      fields: [inventoryApplication.inbound_ledger_id],
      references: [inventoryLedger.ledger_id],
      relationName: 'inbound_ledger',
    }),
    outboundLedger: one(inventoryLedger, {
      fields: [inventoryApplication.outbound_ledger_id],
      references: [inventoryLedger.ledger_id],
      relationName: 'outbound_ledger',
    }),
  }),
);

export const bioAssetLedgerRelations = relations(bioAssetLedger, ({ one }) => ({
  item: one(itemMaster, {
    fields: [bioAssetLedger.bio_asset_item_id],
    references: [itemMaster.item_id],
  }),
  batch: one(batchHeader, {
    fields: [bioAssetLedger.batch_id],
    references: [batchHeader.batch_id],
  }),
  animal: one(animalRegister, {
    fields: [bioAssetLedger.animal_id],
    references: [animalRegister.animal_id],
  }),
}));

export const goodsReceiptRelations = relations(
  goodsReceipt,
  ({ one, many }) => ({
    company: one(companyMaster, {
      fields: [goodsReceipt.company_id],
      references: [companyMaster.company_id],
    }),
    warehouse: one(locationMaster, {
      fields: [goodsReceipt.warehouse_id],
      references: [locationMaster.location_id],
    }),
    supplier: one(supplierMaster, {
      fields: [goodsReceipt.supplier_id],
      references: [supplierMaster.supplier_id],
    }),
    lines: many(goodsReceiptLine),
  }),
);

export const goodsReceiptLineRelations = relations(
  goodsReceiptLine,
  ({ one }) => ({
    receipt: one(goodsReceipt, {
      fields: [goodsReceiptLine.receipt_id],
      references: [goodsReceipt.receipt_id],
    }),
    item: one(itemMaster, {
      fields: [goodsReceiptLine.item_id],
      references: [itemMaster.item_id],
    }),
  }),
);

export const goodsIssue = mysqlTable(
  'goods_issue',
  {
    issue_id: varchar('issue_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 })
      .notNull()
      .references(() => companyMaster.company_id, { onDelete: 'restrict' }),
    issue_no: varchar('issue_no', { length: 50 }).notNull(),
    posting_date: date('posting_date', { mode: 'string' }).notNull(),
    warehouse_id: varchar('warehouse_id', { length: 36 })
      .notNull()
      .references(() => locationMaster.location_id, { onDelete: 'restrict' }),
    cost_center_id: varchar('cost_center_id', { length: 36 }).references(
      () => costCenterMaster.cost_center_id,
      { onDelete: 'restrict' },
    ),
    remarks: text('remarks'),
    status: varchar('status', { length: 20 }).default('DRAFT').notNull(),
    posted_at: timestamp('posted_at', { mode: 'string' }),
    posted_by: varchar('posted_by', { length: 36 }),
    created_by: varchar('created_by', { length: 36 }),
    updated_by: varchar('updated_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { mode: 'string' }),
  },
  (table) => [
    // Defense in depth alongside the row-locked generator in goods-issue.service.ts —
    // a duplicate issue_no under concurrent inserts fails loudly instead of
    // silently corrupting the document sequence.
    uniqueIndex('uq_goods_issue_tenant_company_no').on(
      table.tenant_id,
      table.company_id,
      table.issue_no,
    ),
  ],
);

export const goodsIssueLine = mysqlTable('goods_issue_line', {
  line_id: varchar('line_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  issue_id: varchar('issue_id', { length: 36 })
    .notNull()
    .references(() => goodsIssue.issue_id, { onDelete: 'cascade' }),
  line_no: int('line_no').notNull(),
  item_id: varchar('item_id', { length: 36 })
    .notNull()
    .references(() => itemMaster.item_id, { onDelete: 'restrict' }),
  quantity: decimal('quantity', { precision: 18, scale: 4 }).notNull(),
  uom: varchar('uom', { length: 20 }).notNull(),
  remarks: varchar('remarks', { length: 500 }),
});

export const stockTransfer = mysqlTable(
  'stock_transfer',
  {
    transfer_id: varchar('transfer_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 })
      .notNull()
      .references(() => companyMaster.company_id, { onDelete: 'restrict' }),
    transfer_no: varchar('transfer_no', { length: 50 }).notNull(),
    posting_date: date('posting_date', { mode: 'string' }).notNull(),
    from_warehouse_id: varchar('from_warehouse_id', { length: 36 }).notNull(),
    to_warehouse_id: varchar('to_warehouse_id', { length: 36 }).notNull(),
    remarks: text('remarks'),
    status: varchar('status', { length: 20 }).default('DRAFT').notNull(),
    posted_at: timestamp('posted_at', { mode: 'string' }),
    posted_by: varchar('posted_by', { length: 36 }),
    created_by: varchar('created_by', { length: 36 }),
    updated_by: varchar('updated_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { mode: 'string' }),
  },
  (table) => ({
    fromWarehouseFk: foreignKey({
      columns: [table.from_warehouse_id],
      foreignColumns: [locationMaster.location_id],
      name: 'stock_transfer_from_warehouse_fk',
    }).onDelete('restrict'),
    toWarehouseFk: foreignKey({
      columns: [table.to_warehouse_id],
      foreignColumns: [locationMaster.location_id],
      name: 'stock_transfer_to_warehouse_fk',
    }).onDelete('restrict'),
    // Defense in depth alongside the row-locked generator in stock-transfer.service.ts —
    // a duplicate transfer_no under concurrent inserts fails loudly instead of
    // silently corrupting the document sequence.
    uqTransferNo: uniqueIndex('uq_stock_transfer_tenant_company_no').on(
      table.tenant_id,
      table.company_id,
      table.transfer_no,
    ),
  }),
);

export const stockTransferLine = mysqlTable('stock_transfer_line', {
  line_id: varchar('line_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  transfer_id: varchar('transfer_id', { length: 36 })
    .notNull()
    .references(() => stockTransfer.transfer_id, { onDelete: 'cascade' }),
  line_no: int('line_no').notNull(),
  item_id: varchar('item_id', { length: 36 })
    .notNull()
    .references(() => itemMaster.item_id, { onDelete: 'restrict' }),
  quantity: decimal('quantity', { precision: 18, scale: 4 }).notNull(),
  uom: varchar('uom', { length: 20 }).notNull(),
  remarks: varchar('remarks', { length: 500 }),
});

export const stockAdjustment = mysqlTable(
  'stock_adjustment',
  {
    adjustment_id: varchar('adjustment_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 })
      .notNull()
      .references(() => companyMaster.company_id, { onDelete: 'restrict' }),
    adjustment_no: varchar('adjustment_no', { length: 50 }).notNull(),
    posting_date: date('posting_date', { mode: 'string' }).notNull(),
    warehouse_id: varchar('warehouse_id', { length: 36 })
      .notNull()
      .references(() => locationMaster.location_id, { onDelete: 'restrict' }),
    reason: varchar('reason', { length: 200 }),
    remarks: text('remarks'),
    status: varchar('status', { length: 20 }).default('DRAFT').notNull(),
    posted_at: timestamp('posted_at', { mode: 'string' }),
    posted_by: varchar('posted_by', { length: 36 }),
    created_by: varchar('created_by', { length: 36 }),
    updated_by: varchar('updated_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { mode: 'string' }),
  },
  (table) => [
    // Defense in depth alongside the row-locked generator in stock-adjustment.service.ts —
    // a duplicate adjustment_no under concurrent inserts fails loudly instead of
    // silently corrupting the document sequence.
    uniqueIndex('uq_stock_adjustment_tenant_company_no').on(
      table.tenant_id,
      table.company_id,
      table.adjustment_no,
    ),
  ],
);

export const stockAdjustmentLine = mysqlTable(
  'stock_adjustment_line',
  {
    line_id: varchar('line_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    adjustment_id: varchar('adjustment_id', { length: 36 }).notNull(),
    line_no: int('line_no').notNull(),
    item_id: varchar('item_id', { length: 36 })
      .notNull()
      .references(() => itemMaster.item_id, { onDelete: 'restrict' }),
    quantity: decimal('quantity', { precision: 18, scale: 4 }).notNull(), // signed: positive = found stock, negative = missing/damaged
    uom: varchar('uom', { length: 20 }).notNull(),
    rate: decimal('rate', { precision: 18, scale: 6 }), // required only when quantity is positive (validated at DTO level)
    remarks: varchar('remarks', { length: 500 }),
  },
  (table) => ({
    adjustmentFk: foreignKey({
      columns: [table.adjustment_id],
      foreignColumns: [stockAdjustment.adjustment_id],
      name: 'stock_adj_line_adjustment_id_fk',
    }).onDelete('cascade'),
  }),
);

export const goodsIssueRelations = relations(goodsIssue, ({ one, many }) => ({
  company: one(companyMaster, {
    fields: [goodsIssue.company_id],
    references: [companyMaster.company_id],
  }),
  warehouse: one(locationMaster, {
    fields: [goodsIssue.warehouse_id],
    references: [locationMaster.location_id],
  }),
  costCenter: one(costCenterMaster, {
    fields: [goodsIssue.cost_center_id],
    references: [costCenterMaster.cost_center_id],
  }),
  lines: many(goodsIssueLine),
}));

export const goodsIssueLineRelations = relations(goodsIssueLine, ({ one }) => ({
  issue: one(goodsIssue, {
    fields: [goodsIssueLine.issue_id],
    references: [goodsIssue.issue_id],
  }),
  item: one(itemMaster, {
    fields: [goodsIssueLine.item_id],
    references: [itemMaster.item_id],
  }),
}));

export const stockTransferRelations = relations(
  stockTransfer,
  ({ one, many }) => ({
    company: one(companyMaster, {
      fields: [stockTransfer.company_id],
      references: [companyMaster.company_id],
    }),
    fromWarehouse: one(locationMaster, {
      fields: [stockTransfer.from_warehouse_id],
      references: [locationMaster.location_id],
      relationName: 'transfer_from_warehouse',
    }),
    toWarehouse: one(locationMaster, {
      fields: [stockTransfer.to_warehouse_id],
      references: [locationMaster.location_id],
      relationName: 'transfer_to_warehouse',
    }),
    lines: many(stockTransferLine),
  }),
);

export const stockTransferLineRelations = relations(
  stockTransferLine,
  ({ one }) => ({
    transfer: one(stockTransfer, {
      fields: [stockTransferLine.transfer_id],
      references: [stockTransfer.transfer_id],
    }),
    item: one(itemMaster, {
      fields: [stockTransferLine.item_id],
      references: [itemMaster.item_id],
    }),
  }),
);

export const stockAdjustmentRelations = relations(
  stockAdjustment,
  ({ one, many }) => ({
    company: one(companyMaster, {
      fields: [stockAdjustment.company_id],
      references: [companyMaster.company_id],
    }),
    warehouse: one(locationMaster, {
      fields: [stockAdjustment.warehouse_id],
      references: [locationMaster.location_id],
    }),
    lines: many(stockAdjustmentLine),
  }),
);

export const stockAdjustmentLineRelations = relations(
  stockAdjustmentLine,
  ({ one }) => ({
    adjustment: one(stockAdjustment, {
      fields: [stockAdjustmentLine.adjustment_id],
      references: [stockAdjustment.adjustment_id],
    }),
    item: one(itemMaster, {
      fields: [stockAdjustmentLine.item_id],
      references: [itemMaster.item_id],
    }),
  }),
);

// Piggery Breeding & Reproduction Tables per OneDrive_2_18-08-2026 Sheet 15_PIGGERY
export const breedingRecord = mysqlTable('breeding_record', {
  breeding_id: varchar('breeding_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
  company_id: varchar('company_id', { length: 36 }).references(
    () => companyMaster.company_id,
    { onDelete: 'restrict' },
  ),
  sow_animal_id: varchar('sow_animal_id', { length: 36 })
    .notNull()
    .references(() => animalRegister.animal_id, { onDelete: 'restrict' }),
  batch_id: varchar('batch_id', { length: 36 }).references(
    () => batchHeader.batch_id,
    { onDelete: 'set null' },
  ),
  mating_type: varchar('mating_type', { length: 20 }).notNull(), // AI, NATURAL_MATING
  boar_animal_id: varchar('boar_animal_id', { length: 36 }).references(
    () => animalRegister.animal_id,
    { onDelete: 'restrict' },
  ),
  semen_lot_id: varchar('semen_lot_id', { length: 36 }),
  semen_dose_qty: decimal('semen_dose_qty', { precision: 6, scale: 2 }).default(
    '1.00',
  ),
  mating_date: date('mating_date', { mode: 'string' }).notNull(),
  second_mating_date: date('second_mating_date', { mode: 'string' }),
  expected_farrowing_date: date('expected_farrowing_date', {
    mode: 'string',
  }).notNull(), // mating_date + 114 days
  preg_check_date: date('preg_check_date', { mode: 'string' }), // mating_date + 28 days
  preg_check_method: varchar('preg_check_method', { length: 20 }).default(
    'ULTRASOUND',
  ), // ULTRASOUND, RECTAL, VISUAL, NOT_CHECKED
  pregnancy_confirmed: boolean('pregnancy_confirmed'), // null = pending, true = confirmed, false = failed
  conception_result: varchar('conception_result', { length: 20 })
    .default('PENDING')
    .notNull(), // CONFIRMED, REPEAT, FAILED, PENDING
  parity_number: int('parity_number').notNull(),
  notes: text('notes'),
  created_by: varchar('created_by', { length: 36 }),
  created_at: timestamp('created_at', { mode: 'string' })
    .defaultNow()
    .notNull(),
  updated_at: timestamp('updated_at', { mode: 'string' })
    .defaultNow()
    .notNull(),
});

export const farrowingRecord = mysqlTable('farrowing_record', {
  farrow_id: varchar('farrow_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
  company_id: varchar('company_id', { length: 36 }).references(
    () => companyMaster.company_id,
    { onDelete: 'restrict' },
  ),
  sow_animal_id: varchar('sow_animal_id', { length: 36 })
    .notNull()
    .references(() => animalRegister.animal_id, { onDelete: 'restrict' }),
  breeding_id: varchar('breeding_id', { length: 36 }).references(
    () => breedingRecord.breeding_id,
    { onDelete: 'set null' },
  ),
  batch_id: varchar('batch_id', { length: 36 }).references(
    () => batchHeader.batch_id,
    { onDelete: 'set null' },
  ),
  farrowing_date: date('farrowing_date', { mode: 'string' }).notNull(),
  piglets_born_total: int('piglets_born_total').default(0).notNull(),
  piglets_born_live: int('piglets_born_live').default(0).notNull(),
  piglets_stillborn: int('piglets_stillborn').default(0).notNull(),
  piglets_mummified: int('piglets_mummified').default(0).notNull(),
  avg_birth_weight_kg: decimal('avg_birth_weight_kg', {
    precision: 6,
    scale: 3,
  }),
  total_litter_weight_kg: decimal('total_litter_weight_kg', {
    precision: 8,
    scale: 3,
  }),
  farrowing_status: varchar('farrowing_status', { length: 20 })
    .default('NORMAL')
    .notNull(), // NORMAL, ASSISTED, C_SECTION, COMPLICATIONS
  foster_received: int('foster_received').default(0).notNull(),
  fostered_out: int('fostered_out').default(0).notNull(),
  weaning_date: date('weaning_date', { mode: 'string' }),
  piglets_weaned: int('piglets_weaned').default(0).notNull(),
  avg_weaning_weight_kg: decimal('avg_weaning_weight_kg', {
    precision: 6,
    scale: 3,
  }),
  cost_per_piglet: decimal('cost_per_piglet', { precision: 18, scale: 4 }),
  parity_number: int('parity_number').notNull(),
  notes: text('notes'),
  created_by: varchar('created_by', { length: 36 }),
  created_at: timestamp('created_at', { mode: 'string' })
    .defaultNow()
    .notNull(),
  updated_at: timestamp('updated_at', { mode: 'string' })
    .defaultNow()
    .notNull(),
});

export const semenBatch = mysqlTable('semen_batch', {
  semen_batch_id: varchar('semen_batch_id', { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
  company_id: varchar('company_id', { length: 36 }).references(
    () => companyMaster.company_id,
    { onDelete: 'restrict' },
  ),
  boar_animal_id: varchar('boar_animal_id', { length: 36 })
    .notNull()
    .references(() => animalRegister.animal_id, { onDelete: 'restrict' }),
  boar_batch_id: varchar('boar_batch_id', { length: 36 }).references(
    () => batchHeader.batch_id,
    { onDelete: 'set null' },
  ),
  collection_date: date('collection_date', { mode: 'string' }).notNull(),
  period_from: date('period_from', { mode: 'string' }),
  period_to: date('period_to', { mode: 'string' }),
  amortisation_period: decimal('amortisation_period', {
    precision: 18,
    scale: 4,
  }).default('0.0000'),
  feed_cost_period: decimal('feed_cost_period', {
    precision: 18,
    scale: 4,
  }).default('0.0000'),
  drug_cost_period: decimal('drug_cost_period', {
    precision: 18,
    scale: 4,
  }).default('0.0000'),
  overhead_cost_period: decimal('overhead_cost_period', {
    precision: 18,
    scale: 4,
  }).default('0.0000'),
  running_cost_period: decimal('running_cost_period', {
    precision: 18,
    scale: 4,
  }).default('0.0000'),
  doses_collected: decimal('doses_collected', {
    precision: 10,
    scale: 2,
  }).notNull(),
  unit_cost_per_dose: decimal('unit_cost_per_dose', {
    precision: 18,
    scale: 6,
  }).default('0.000000'),
  doses_used_internal: decimal('doses_used_internal', {
    precision: 10,
    scale: 2,
  }).default('0.00'),
  doses_sold: decimal('doses_sold', { precision: 10, scale: 2 }).default(
    '0.00',
  ),
  output_item_id: varchar('output_item_id', { length: 36 }).references(
    () => itemMaster.item_id,
    { onDelete: 'set null' },
  ),
  inventory_posted: boolean('inventory_posted').default(false).notNull(),
  notes: text('notes'),
  created_by: varchar('created_by', { length: 36 }),
  created_at: timestamp('created_at', { mode: 'string' })
    .defaultNow()
    .notNull(),
  updated_at: timestamp('updated_at', { mode: 'string' })
    .defaultNow()
    .notNull(),
});

export const breedingRecordRelations = relations(
  breedingRecord,
  ({ one, many }) => ({
    company: one(companyMaster, {
      fields: [breedingRecord.company_id],
      references: [companyMaster.company_id],
    }),
    sow: one(animalRegister, {
      fields: [breedingRecord.sow_animal_id],
      references: [animalRegister.animal_id],
      relationName: 'sow_breedings',
    }),
    boar: one(animalRegister, {
      fields: [breedingRecord.boar_animal_id],
      references: [animalRegister.animal_id],
      relationName: 'boar_breedings',
    }),
    batch: one(batchHeader, {
      fields: [breedingRecord.batch_id],
      references: [batchHeader.batch_id],
    }),
    farrowings: many(farrowingRecord),
  }),
);

export const farrowingRecordRelations = relations(
  farrowingRecord,
  ({ one }) => ({
    company: one(companyMaster, {
      fields: [farrowingRecord.company_id],
      references: [companyMaster.company_id],
    }),
    sow: one(animalRegister, {
      fields: [farrowingRecord.sow_animal_id],
      references: [animalRegister.animal_id],
    }),
    breeding: one(breedingRecord, {
      fields: [farrowingRecord.breeding_id],
      references: [breedingRecord.breeding_id],
    }),
    batch: one(batchHeader, {
      fields: [farrowingRecord.batch_id],
      references: [batchHeader.batch_id],
    }),
  }),
);

export const semenBatchRelations = relations(semenBatch, ({ one }) => ({
  company: one(companyMaster, {
    fields: [semenBatch.company_id],
    references: [companyMaster.company_id],
  }),
  boar: one(animalRegister, {
    fields: [semenBatch.boar_animal_id],
    references: [animalRegister.animal_id],
  }),
  batch: one(batchHeader, {
    fields: [semenBatch.boar_batch_id],
    references: [batchHeader.batch_id],
  }),
  outputItem: one(itemMaster, {
    fields: [semenBatch.output_item_id],
    references: [itemMaster.item_id],
  }),
}));

/**
 * Per-operational-area operating configuration.
 *
 * The area's identity (name, code, parent farm, NOB/LOB) is NOT duplicated
 * here — that lives in `operational_area_master` and is read from there. This
 * table only holds the knobs an operator actually sets.
 *
 * The split between typed columns and `lob_config` is deliberate and is what
 * makes the screen work for LOBs that do not exist yet: costing method, feed
 * UOM, mortality and temperature thresholds mean the same thing for Piggery,
 * Dairy and Poultry, so they are real columns. Capacity is where LOBs diverge
 * (sow places and farrowing crates vs. milking points vs. brooder rings), so
 * it goes in `lob_config` and a new LOB ships without a migration.
 */
export const operationalAreaSettings = mysqlTable(
  'operational_area_settings',
  {
    setting_id: varchar('setting_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    // FKs declared below rather than inline: the auto-derived constraint names
    // ("operational_area_settings_area_id_operational_area_master_area_id_fk")
    // blow past MySQL's 64-character identifier limit.
    company_id: varchar('company_id', { length: 36 }).notNull(),
    area_id: varchar('area_id', { length: 36 }).notNull().unique(),
    costing_method: varchar('costing_method', { length: 20 })
      .default('STANDARD')
      .notNull(),
    default_feed_uom: varchar('default_feed_uom', { length: 20 })
      .default('KG')
      .notNull(),
    mortality_threshold_pct: decimal('mortality_threshold_pct', {
      precision: 6,
      scale: 3,
    }),
    temp_threshold_min: decimal('temp_threshold_min', {
      precision: 6,
      scale: 2,
    }),
    temp_threshold_max: decimal('temp_threshold_max', {
      precision: 6,
      scale: 2,
    }),
    // Requests at or below this quantity skip the approval queue entirely.
    auto_approve_ration_under_qty: decimal('auto_approve_ration_under_qty', {
      precision: 18,
      scale: 4,
    }),
    lob_config: json('lob_config'),
    created_by: varchar('created_by', { length: 36 }),
    updated_by: varchar('updated_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .onUpdateNow()
      .notNull(),
  },
  (table) => ({
    companyFk: foreignKey({
      columns: [table.company_id],
      foreignColumns: [companyMaster.company_id],
      name: 'oa_settings_company_fk',
    }).onDelete('cascade'),
    areaFk: foreignKey({
      columns: [table.area_id],
      foreignColumns: [operationalAreaMaster.area_id],
      name: 'oa_settings_area_fk',
    }).onDelete('cascade'),
  }),
);

/**
 * Operational approval queue — the requests an area lead has to sign off
 * (feed ration changes, goods receipts, stock transfers, stage closures,
 * veterinary disposals).
 *
 * `doc_type` stays a plain varchar rather than an enum so a future LOB can add
 * its own request kind without a migration; the UI decides which icon and
 * label a type gets.
 */
export const approvalRequest = mysqlTable(
  'approval_request',
  {
    request_id: varchar('request_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 })
      .notNull()
      .references(() => companyMaster.company_id, { onDelete: 'cascade' }),
    // Named explicitly — the derived name exceeds MySQL's 64-char limit.
    operational_area_id: varchar('operational_area_id', { length: 36 }),
    doc_type: varchar('doc_type', { length: 40 }).notNull(),
    doc_no: varchar('doc_no', { length: 50 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    requested_by: varchar('requested_by', { length: 36 }).references(
      () => userMaster.user_id,
      { onDelete: 'set null' },
    ),
    // Snapshot of who asked, kept alongside the FK: a request must still read
    // correctly years later even if that user is deleted or changes role.
    requestor_label: varchar('requestor_label', { length: 150 }),
    requestor_role: varchar('requestor_role', { length: 60 }),
    location_label: varchar('location_label', { length: 200 }),
    batch_id: varchar('batch_id', { length: 36 }).references(
      () => batchHeader.batch_id,
      { onDelete: 'set null' },
    ),
    urgency: varchar('urgency', { length: 10 }).default('MEDIUM').notNull(), // HIGH, MEDIUM, LOW
    item_or_stage: varchar('item_or_stage', { length: 200 }),
    requested_qty: varchar('requested_qty', { length: 100 }),
    uom: varchar('uom', { length: 20 }),
    cost_impact: decimal('cost_impact', { precision: 18, scale: 4 }),
    justification: text('justification'),
    status: varchar('status', { length: 20 }).default('PENDING').notNull(), // PENDING, APPROVED, REJECTED
    submitted_at: timestamp('submitted_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    decided_at: timestamp('decided_at', { mode: 'string' }),
    decided_by: varchar('decided_by', { length: 36 }).references(
      () => userMaster.user_id,
      { onDelete: 'set null' },
    ),
    decider_label: varchar('decider_label', { length: 150 }),
    rejection_reason: text('rejection_reason'),
    created_by: varchar('created_by', { length: 36 }),
    updated_by: varchar('updated_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .onUpdateNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { mode: 'string' }),
  },
  (table) => ({
    areaFk: foreignKey({
      columns: [table.operational_area_id],
      foreignColumns: [operationalAreaMaster.area_id],
      name: 'approval_request_area_fk',
    }).onDelete('set null'),
  }),
);

export const operationalAreaSettingsRelations = relations(
  operationalAreaSettings,
  ({ one }) => ({
    area: one(operationalAreaMaster, {
      fields: [operationalAreaSettings.area_id],
      references: [operationalAreaMaster.area_id],
    }),
    company: one(companyMaster, {
      fields: [operationalAreaSettings.company_id],
      references: [companyMaster.company_id],
    }),
  }),
);

export const approvalRequestRelations = relations(
  approvalRequest,
  ({ one }) => ({
    company: one(companyMaster, {
      fields: [approvalRequest.company_id],
      references: [companyMaster.company_id],
    }),
    area: one(operationalAreaMaster, {
      fields: [approvalRequest.operational_area_id],
      references: [operationalAreaMaster.area_id],
    }),
    batch: one(batchHeader, {
      fields: [approvalRequest.batch_id],
      references: [batchHeader.batch_id],
    }),
    requester: one(userMaster, {
      fields: [approvalRequest.requested_by],
      references: [userMaster.user_id],
      relationName: 'approval_requester',
    }),
    decider: one(userMaster, {
      fields: [approvalRequest.decided_by],
      references: [userMaster.user_id],
      relationName: 'approval_decider',
    }),
  }),
);

/**
 * Daily milk production.
 *
 * The Dairy screens were rendering invented numbers — eight named cows, four
 * feed lines and a bulk-tank reading, all hardcoded in the component — because
 * nothing in the database could hold a milk record. This is that table.
 *
 * One row per session (a herd's morning and evening milking are two rows), so
 * a day's total is a sum rather than a column that can disagree with its parts.
 * `animal_id` is null for a bulk/parlour record and set when a farm records
 * per-cow yields, which lets the same table serve both without a second one.
 */
export const milkProductionLog = mysqlTable(
  'milk_production_log',
  {
    log_id: varchar('log_id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
    company_id: varchar('company_id', { length: 36 })
      .notNull()
      .references(() => companyMaster.company_id, { onDelete: 'restrict' }),
    operational_area_id: varchar('operational_area_id', { length: 36 }),
    batch_id: varchar('batch_id', { length: 36 })
      .notNull()
      .references(() => batchHeader.batch_id, { onDelete: 'cascade' }),
    animal_id: varchar('animal_id', { length: 36 }).references(
      () => animalRegister.animal_id,
      { onDelete: 'set null' },
    ),
    log_date: date('log_date', { mode: 'string' }).notNull(),
    session: varchar('session', { length: 20 }).default('MORNING').notNull(), // MORNING, EVENING, BULK
    quantity_litres: decimal('quantity_litres', {
      precision: 18,
      scale: 3,
    }).notNull(),
    // Quality composition. Nullable because a farm may weigh milk daily but only
    // test composition when the bulk tank is collected.
    fat_pct: decimal('fat_pct', { precision: 6, scale: 3 }),
    snf_pct: decimal('snf_pct', { precision: 6, scale: 3 }),
    scc_count: int('scc_count'), // somatic cell count per mL
    bmc_temperature_c: decimal('bmc_temperature_c', { precision: 6, scale: 2 }),
    remarks: text('remarks'),
    recorded_by: varchar('recorded_by', { length: 36 }),
    created_at: timestamp('created_at', { mode: 'string' })
      .defaultNow()
      .notNull(),
    updated_at: timestamp('updated_at', { mode: 'string' })
      .defaultNow()
      .onUpdateNow()
      .notNull(),
    deleted_at: timestamp('deleted_at', { mode: 'string' }),
  },
  (table) => ({
    // One record per batch/animal/date/session — a double-submit of the morning
    // milking must fail loudly rather than double-count the day's yield.
    uqSession: uniqueIndex('uq_milk_log_batch_date_session_animal').on(
      table.batch_id,
      table.log_date,
      table.session,
      table.animal_id,
    ),
  }),
);

export const milkProductionLogRelations = relations(
  milkProductionLog,
  ({ one }) => ({
    batch: one(batchHeader, {
      fields: [milkProductionLog.batch_id],
      references: [batchHeader.batch_id],
    }),
    animal: one(animalRegister, {
      fields: [milkProductionLog.animal_id],
      references: [animalRegister.animal_id],
    }),
    company: one(companyMaster, {
      fields: [milkProductionLog.company_id],
      references: [companyMaster.company_id],
    }),
  }),
);
