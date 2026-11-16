import { boarResultIssues, BoarResultInput, lotTotals } from './semen-boar-result.rules';

const code = (id: string) => id.toUpperCase();
const r = (boar: string, over: Partial<BoarResultInput> = {}): BoarResultInput => ({ boar_animal_id: boar, doses: 40, ...over });

describe('boarResultIssues', () => {
  it('accepts one accepted result per lot boar', () => {
    expect(boarResultIssues([r('a'), r('b')], ['a', 'b'], code)).toEqual([]);
  });

  it('wants a result for every boar in the lot, and not two for one boar', () => {
    expect(boarResultIssues([r('a')], ['a', 'b'], code)).toEqual(['B is in the lot but has no result.']);
    expect(boarResultIssues([r('a'), r('a')], ['a'], code)).toEqual(['A has two results; give each boar one.']);
  });

  it('wants whole doses of at least 1 from an accepted boar', () => {
    expect(boarResultIssues([r('a', { doses: 0 })], ['a'], code)).toContain('A: doses must be a whole number, at least 1.');
    expect(boarResultIssues([r('a', { doses: 10.5 })], ['a'], code)).toContain('A: doses must be a whole number, at least 1.');
    expect(boarResultIssues([r('a', { doses: null })], ['a'], code)).toContain('A: doses must be a whole number, at least 1.');
  });

  it('lets a boar outside the lot give a rejected ejaculate, with a reason', () => {
    expect(boarResultIssues([r('a'), r('x', { accepted: false, doses: null, reject_reason: 'discoloured' })], ['a'], code)).toEqual([]);
    expect(boarResultIssues([r('a'), r('x', { accepted: false })], ['a'], code)).toEqual(['X: say why the ejaculate was rejected.']);
    expect(boarResultIssues([r('a'), r('x', { accepted: false, reject_reason: '  ' })], ['a'], code)).toEqual(['X: say why the ejaculate was rejected.']);
  });

  it('does not let a rejected boar stay in the lot, nor an accepted one stand outside it', () => {
    const rejectedInLot = boarResultIssues([r('a'), r('b', { accepted: false, reject_reason: 'x' })], ['a', 'b'], code);
    expect(rejectedInLot).toEqual(["B's ejaculate was rejected, so he is not in the lot; name him in the results only."]);
    expect(boarResultIssues([r('a'), r('z')], ['a'], code)).toEqual(["Z has an accepted result but is not one of the lot's boars."]);
  });

  it('needs at least one accepted boar', () => {
    const issues = boarResultIssues([r('x', { accepted: false, reject_reason: 'bad' })], [], code);
    expect(issues).toEqual(["At least one boar's ejaculate must be accepted into the lot."]);
  });
});

describe('lotTotals', () => {
  it('adds up the doses and volume of the accepted boars only', () => {
    const t = lotTotals([r('a', { doses: 40, volume_ml: 200.5 }), r('b', { doses: 30, volume_ml: 150.25 }), r('x', { accepted: false, doses: 99, volume_ml: 999 })]);
    expect(t).toEqual({ doses: 70, volume_ml: 350.75 });
  });

  it('gives no volume unless every accepted boar gave one: a partial sum would read as the whole', () => {
    expect(lotTotals([r('a', { volume_ml: 200 }), r('b')]).volume_ml).toBeNull();
    expect(lotTotals([]).volume_ml).toBeNull();
  });
});
