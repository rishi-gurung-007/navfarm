# Lot and serial tracked consumption under FIFO costing — 8 Oct 2026

Costing stays FIFO. The user's selection decides which layers a consumption uses:
a lot-tracked item draws from the ticked lot(s), oldest receipt first inside each lot;
a serial-tracked item draws each picked serial from the receipt that holds it, at that receipt's cost.
Remaining stock value stays correct because it is always the sum of what is left in each layer.

Defaults used where the client has not decided (record in decisions.md; change on Rishi's word):
expired medicine/vaccine blocked, expired feed warned; suggestion order = earliest expiry then oldest receipt;
anyone may override the suggestion, the entry carries an audit mark; an item's tracking type may change
only with no stock on hand and no draft documents. Backdated consumption, batch consumption with no
location, and base-unit conversion are NOT part of this plan (need a business decision).

## Phases (each ends with tests and a read-back in MySQL)
1. Serial integrity — consumed serials leave the list; exact (not substring) serial match; each serial costed at its own receipt.
2. Lot picker — scoped to the location the entry draws from; shows quantity, unit cost, expiry, receipt date; pre-selects the suggested lot; "not FIFO" mark.
3. Multi-lot — tick several lots; used in turn; one ledger entry per lot; split and cost preview; short selection refused before posting; animal-wise days all-or-nothing.
4. Source and errors — silo short -> remainder from the farm store; errors name item, lot/serial, location, quantity; seed stocks the store with every scheduler item.
5. Tracking change — allowed only at zero stock and with no draft documents; locked screen explains why.
6. Expiry rules, override audit mark, BIO_HARVEST ledger filter option.
