# Phase 1 access-foundation verification — 14 September 2026

This report closes the work recovered from two interrupted Claude sessions. It
records what was actually executed; it does not turn verification fixtures into
client data or settle any open Triple C decision.

## Automated gate

| Check | Result |
|---|---|
| `pnpm nx test api --runInBand --watchman=false` | 79 suites, 876 tests passed |
| `pnpm nx typecheck api` | passed |
| `pnpm nx test web --runInBand --watchman=false` | 24 suites, 156 tests passed |
| `pnpm nx run-many -t typecheck -p web web-e2e` | both passed |
| `pnpm nx build api` | passed; existing Express dynamic-dependency warning |
| `git diff --check` | passed |

The new tests render the Drizzle SQL where practical, so removing company, LOB
or farm predicates makes them fail. The controller ratchet still ensures every
operational controller is either scoped or has a truthful exemption, but it is
not treated as a substitute for service tests.

## Explicit verification fixture

`db-probe-farm-scope-users` is read-only by default, writes then rolls back with
`--verify`, and commits only with `--apply`. Default and verify modes were read
and confirmed before apply. Every created/repurposed record is labelled `DEMO
VERIFICATION`; Phase 3's demo rebuild may remove it.

MySQL after apply:

| User/batch | Farm |
|---|---|
| `user@triplec.local`, `PIG-BAT-2026-0001` (`fa4fe023-730d-4beb-bd0c-2a186e8612bf`) | MUL100 / Grasmere (`cc43a7ef-0721-43fc-8331-39396108fc63`) |
| `verification.por100@triplec.local`, `PIG-BAT-2026-0002` (`85586f23-0879-441b-a837-f5de25118463`) | POR100 / Kintyre (`124d3aba-f844-41d3-bd87-72883bf4c8eb`) |

## Live access checks

The API was rebuilt and restarted on port 2877 before the final read probes.

| Caller/action | Observed result |
|---|---|
| Grasmere standard user lists batches | 200; only `PIG-BAT-2026-0001` |
| Same user sends Kintyre as active farm | 403 |
| Same user omits operational area | 400, select an operational area first |
| Company admin selects Kintyre | 200; only `PIG-BAT-2026-0002` |
| Operational admin lists inventory ledger without farm selection | 200; 21 rows at probe time |
| Grasmere user lists approvals | only requests for `PIG-BAT-2026-0001` |
| Grasmere user tries a lifecycle close | 403 insufficient permission |
| Grasmere user submits a valid-shaped receipt for the other farm | 403; MySQL showed no unexpected receipt |

Only one company exists in this development tenant. Cross-company isolation is
therefore verified by SQL-rendering/unit tests, not by pretending a second
company is client data.

## Live write and database proof

- A prior missing day (2026-09-13) remained visible, while a descriptive
  zero-mortality entry for 2026-09-14 posted successfully. MySQL entry
  `a7314302-289c-4481-b4cd-ffdc23f00cc6` preserves the `DEMO VERIFICATION`
  remark.
- Operational admin posted receipt `GR-000006`
  (`970e1f73-aa1c-4563-9a28-b63c01cab313`) for 100 KG of the existing Pig Feed
  item, exact lot `DEMO-VERIFICATION-20260914`. MySQL shows ledger
  `c64e4fac-03d6-4322-b354-607d3a93651d`, positive 100, remaining 99.
- The Grasmere worker then posted a real 1 KG batch consumption
  (`8180e3e1-57d0-4852-9667-b33c2fd8c646`) from that exact lot. MySQL shows
  outbound ledger `a078a235-af22-4776-80d2-14800ae99e87`, negative 1, tied to
  `PIG-BAT-2026-0001`.
- FIFO application `156cc128-cebe-4cc3-b98f-541ef04f2be6` links those inbound
  and outbound ledgers with applied quantity 1 and cost amount 1. This is the
  live proof that the private internal post-write ledger loader works while the
  public ledger remains scoped.

## Review closure

The first independent review found real holes in medication, animal alternate
routes, scheduler generation, bio-asset ledger, company-admin boundaries,
inventory creates, LOB joins, user farm assignment and attachments. Each was
fixed before this gate. Later review rounds found and closed destination-
warehouse validation, transactional cross-farm scheduling, missing company-
header fallback, transferable-animal disclosure and exact secondary-reference
scope. The final independent reviewer verdict was **Ready**.
