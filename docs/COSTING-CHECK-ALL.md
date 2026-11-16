# Checking all of costing in one command

To see what it would do (changes nothing):

```bash
pnpm check:costing
```

To run everything (a few minutes):

```bash
pnpm check:costing --apply
```

To run only some scenarios, the one you want left in the database last:

```bash
pnpm check:costing --apply --only=costing-fv,costing-conv
```

To skip the unit tests:

```bash
pnpm check:costing --apply --skip-tests
```

**Every scenario rebuilds the demo database (nf_devco).** It is dropped and recreated, as `pnpm seed:*` does, and anything made by hand in it is lost. When the run
finishes the database holds the **last** scenario run; put the one you want to keep last in `--only`. To keep nf_devco, point `DATABASE_HOST` / `DATABASE_PORT` at another
local MySQL (the rebuild refuses anything that is not local).

## What it runs

1. **Unit tests**, no database: the costing rules, services, migrations and seed wiring (API); the Costing Runs and FA Conversion screens with the API mocked (web).
2. **Six scenarios.** Each is rebuilt from nothing, seeded through the application's own services, and read back from MySQL. The checker recomputes every figure from
   the rows themselves (dates, ledger, rates, journals), never from numbers copied out of a run.

| Scenario | Seed | Checker | What it proves |
|---|---|---|---|
| `costing-test` | `pnpm seed:costing-test` | `verify-costing-test.ts` | A herd's whole life: eight animals, capitalise then expense, batch runs, mating and litter cost, mortality, a reversal |
| `costing-two` | `pnpm seed:costing-two` | `verify-costing-two.ts` | The smallest hand-checkable case: a sow and a boar over six months |
| `costing-fv` | `pnpm seed:costing-fv` | `verify-costing-fv.ts` | Fair value: rates by date, a loss then a gain, the refusal with no rate, a reversed and re-run month |
| `costing-freq` | `pnpm seed:costing-freq` | `verify-costing-freq.ts` | Quarterly, monthly (actual days, auto-post) and yearly items through the scheduler's `tick()`, and the notices Finance gets |
| `costing-conv` | `pnpm seed:costing-conv` | `verify-costing-conv.ts` | A culled breeding animal becomes inventory only through a Finance-approved request |
| `project-full` | `pnpm seed:project` | `verify-project-full.ts` | The whole project: 20 animals from the GRN, two parities, semen, AI, litters, gilts, monthly runs (see `docs/PROJECT-FULL-SEED.md`) |

Each seed can be run alone, and each checker re-run alone (`pnpm verify:costing-two`, ...). The scenarios are separate on purpose: each gives the catalog's sow, gilt or boar
item its own terms (amortised, fair value, quarterly...), so each needs a database of its own; `demo/costing-scenarios.ts` is the one list of what each runs.

## Reading the report

One line per stage with checks passed / total, then **WHAT FAILED** with each failing check in full, and a total. It exits 1 when any stage failed or produced no result
(a rebuild that stopped before its checks counts as a failure, not as nothing).

## What this does not cover

- The 02:00 clock firing the scheduler (the seed goes in through `tick()`, which the clock calls).
- The web screens in a real browser: they are covered by their specs and were looked at by hand.
- Business Central: there is no integration yet.
