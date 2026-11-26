import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateGlMappingDto, QueryGlMappingDto, UpdateGlMappingDto } from './gl-mapping.dto';

describe('GL Mapping DTO validation', () => {
  // Seeded NOB/LOB IDs (e.g. 50000000-5000-5000-5000-000000000002) are not RFC 4122 UUIDs;
  // @IsUUID() rejected them when creating/updating/querying in operational scope.
  const SEEDED_NOB_ID = '50000000-5000-5000-5000-000000000002';
  const SEEDED_LOB_ID = '60000000-6000-6000-6000-000000000007';

  it('accepts seeded NOB and LOB IDs on create, update, and query', async () => {
    const createErrors = await validate(
      plainToInstance(CreateGlMappingDto, {
        transaction_type: 'PURCHASE',
        nob_id: SEEDED_NOB_ID,
        lob_id: SEEDED_LOB_ID,
      }),
    );
    expect(createErrors).toHaveLength(0);

    const updateErrors = await validate(
      plainToInstance(UpdateGlMappingDto, {
        nob_id: SEEDED_NOB_ID,
        lob_id: SEEDED_LOB_ID,
      }),
    );
    expect(updateErrors).toHaveLength(0);

    const queryErrors = await validate(
      plainToInstance(QueryGlMappingDto, {
        nobId: SEEDED_NOB_ID,
        lobId: SEEDED_LOB_ID,
      }),
    );
    expect(queryErrors).toHaveLength(0);
  });
});

