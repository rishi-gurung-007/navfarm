import * as mysql from 'mysql2/promise';
import { randomUUID } from 'crypto';

const DB = process.env.TENANT_DB_NAME || 'tenant_devco';

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DATABASE_HOST || '127.0.0.1',
    port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root',
    password: process.env.DATABASE_PASSWORD || '',
    database: DB,
  });

  try {
    const [companyRows]: any = await conn.execute(
      `SELECT company_id, tenant_id FROM company_master LIMIT 1`
    );
    if (!companyRows.length) {
      console.log('No company found.');
      return;
    }
    const { company_id, tenant_id } = companyRows[0];

    const [warehouseRows]: any = await conn.execute(
      `SELECT location_id FROM location_master WHERE location_type = 'FARM' LIMIT 1`
    );
    const warehouse_id = warehouseRows[0]?.location_id || null;

    const [nobLobRows]: any = await conn.execute(
      `SELECT nob_id, lob_id FROM lob_master WHERE lob_name LIKE '%Pig%' LIMIT 1`
    );
    const nob_id = nobLobRows[0]?.nob_id || null;
    const lob_id = nobLobRows[0]?.lob_id || null;

    const [items]: any = await conn.execute(
      `SELECT item_id, item_code, item_name, uom_primary, category_id, standard_cost 
       FROM item_master 
       WHERE item_code LIKE 'ICAT-004%' OR item_code LIKE 'ICAT-005%'`
    );

    console.log(`Found ${items.length} items to seed inventory for.`);

    let inserted = 0;
    for (const item of items) {
      const isFeed = item.item_code.startsWith('ICAT-004');
      const qty = isFeed ? 50000 : 500;
      const rate = Number(item.standard_cost) || (isFeed ? 35 : 200);
      const amount = qty * rate;

      await conn.execute(
        `INSERT INTO inventory_ledger (
          ledger_id, tenant_id, company_id, item_id, item_code, item_description,
          document_type, document_no, posting_date, entry_type, transaction_type,
          quantity, remaining_quantity, uom, rate, amount,
          warehouse_id, nob_id, lob_id, category_id, created_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          'OPENING_STOCK', 'INIT-STOCK-2026', '2026-01-01', 'POSITIVE', 'OPENING_BALANCE',
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, NOW()
        )`,
        [
          randomUUID(),
          tenant_id,
          company_id,
          item.item_id,
          item.item_code,
          item.item_name,
          qty,
          qty,
          item.uom_primary || 'KG',
          rate,
          amount,
          warehouse_id,
          nob_id,
          lob_id,
          item.category_id,
        ]
      );
      inserted++;
    }

    console.log(`Successfully seeded ${inserted} inventory ledger stock layers for feeds and medicines.`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
