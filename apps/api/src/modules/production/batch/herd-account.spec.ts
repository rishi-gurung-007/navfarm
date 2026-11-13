import { herdCarryingAccount, pigletLotAccount } from './herd-account';

describe('the account a herd is carried in', () => {
  const herd = {
    batch_id: 'b-1',
    company_id: 'comp-1',
    nob_id: 'nob-1',
    lob_id: 'lob-1',
  };
  // The farrowing that made the batch, if one did.
  const dbWith = (farrowings: object[]) =>
    ({
      select: jest.fn(() => ({
        from: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn().mockResolvedValue(farrowings),
          })),
        })),
      })),
    }) as any;
  const glWith = (mapped: Record<string, string>) => ({
    mappedAccount: jest.fn(
      async (_tenant: string, _company: string, type: string, side: string) =>
        mapped[`${type}:${side}`],
    ),
  });
  const both = {
    'BIO_LITTER_BIRTH:debit': 'acct-weaners',
    'BIO_MORTALITY_PREMATURE:credit': 'acct-premature',
  };

  it("a farrowing's piglet lot is carried where its birth cost went: the BIO_LITTER_BIRTH debit", async () => {
    const gl = glWith(both);
    await expect(
      herdCarryingAccount(dbWith([{ id: 'f-1' }]), gl, herd, 'PREMATURE', 't-1'),
    ).resolves.toBe('acct-weaners');
    expect(gl.mappedAccount).toHaveBeenCalledWith('t-1', 'comp-1', 'BIO_LITTER_BIRTH', 'debit', {
      nobId: 'nob-1',
      lobId: 'lob-1',
    });
  });

  it('any other pre-mature herd is carried in the pre-mature account (the pre-mature mortality credit)', async () => {
    await expect(
      herdCarryingAccount(dbWith([]), glWith(both), herd, 'PREMATURE', 't-1'),
    ).resolves.toBe('acct-premature');
  });

  it('a piglet lot whose birth was not journalled (no BIO_LITTER_BIRTH mapping) is in the pre-mature account', async () => {
    await expect(
      herdCarryingAccount(
        dbWith([{ id: 'f-1' }]),
        glWith({ 'BIO_MORTALITY_PREMATURE:credit': 'acct-premature' }),
        herd,
        'PREMATURE',
        't-1',
      ),
    ).resolves.toBe('acct-premature');
  });

  it("a mature herd is in no one account here: each posting keeps its mapping's", async () => {
    await expect(
      herdCarryingAccount(dbWith([]), glWith(both), herd, 'MATURE', 't-1'),
    ).resolves.toBeUndefined();
  });

  it('pigletLotAccount reads no mapping for a batch no farrowing made', async () => {
    const gl = glWith(both);
    await expect(pigletLotAccount(dbWith([]), gl, herd, 't-1')).resolves.toBeUndefined();
    expect(gl.mappedAccount).not.toHaveBeenCalled();
  });
});
