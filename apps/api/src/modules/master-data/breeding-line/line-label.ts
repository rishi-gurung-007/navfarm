import { inArray } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../../../core/database/schema';

/**
 * A row of a breeding-line master names its line by a breed id, which a list cannot show. This adds the line as people say it
 * (its code, and name when it differs) and "Company default" for the row with no breed.
 */
export async function withLineLabels<T extends { breed_id: string | null }>(
  db: MySql2Database<typeof schema>,
  rows: T[],
  noBreedLabel = 'Company default',
): Promise<(T & { breed_code: string | null; breed_name: string | null; line_label: string })[]> {
  const ids = [...new Set(rows.map((r) => r.breed_id).filter((id): id is string => !!id))];
  const breeds = ids.length
    ? await db
        .select({ id: schema.breedMaster.breed_id, code: schema.breedMaster.breed_code, name: schema.breedMaster.breed_name })
        .from(schema.breedMaster)
        .where(inArray(schema.breedMaster.breed_id, ids))
    : [];
  return rows.map((r) => {
    const breed = breeds.find((b) => b.id === r.breed_id);
    const code = breed?.code ?? null;
    const name = breed?.name ?? null;
    return {
      ...r,
      breed_code: code,
      breed_name: name,
      line_label: r.breed_id ? (code && name && name !== code ? `${code} — ${name}` : (code ?? name ?? 'Unknown line')) : noBreedLabel,
    };
  });
}
