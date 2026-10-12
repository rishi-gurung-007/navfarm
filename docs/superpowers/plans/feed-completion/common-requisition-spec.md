# Common requisition — Rishi's field and button list (4 Oct 2026, verbatim)

Source: Rishi in chat, 4 Oct 2026. This governs the common (Item / Fixed Asset / Service) requisition
together with decisions.md (1 Oct "approval precedes release", 4 Oct admin and one-page rulings).

```
REQUISITION HEADER:
  Purchase Requisition No. (No. Series required)
  Purchase Requisition Date
  Main / Farm Location (from Location setup)
  Requester User ID
  Requester Name
  Requester Department (auto from User Setup)
  Sender Department (user selects)
  Requisition Type: Fixed Asset / Item / Service
    (FA and Service: Description + Qty only; Item: selected on subform)
  Status: Open / Released
  Purpose: Store / Purchase (Option Field)
  From Sub-Location (if Purpose = Store)
  To Sub-Location (if Purpose = Store)
  Direct Transfer (Checkbox — user needs right in User Setup to tick)
  Remarks

REQUISITION SUB-FORM LINE:
  Line No.
  Item No.
  Item Description
  Fixed Asset or Service Description
  Qty
  From Location (auto from header)
  To Location (auto from header)
  Qty to Ship
  Qty Shipped
  Qty to Receive
  Qty Received
  Remaining to Receive = Qty Shipped − Qty Received
  Balance to Ship = Qty − Qty Shipped

BUTTONS ON HEADER:
  Release Button: Status Open → Released
    If Purpose = Purchase: PR synced to BC → BC creates PO
    If Purpose = Store: internal Transfer only — no BC sync
  Transfer Shipment Button:
    Done by sender department user
    Validation: user dept (from User Setup) must match From Sub-Location dimension
    If Direct Transfer = True: Shipment + Receipt posted together
  Transfer Receipt Button:
    Done by requester user at To Sub-Location
    Validation: user dept must match To Sub-Location dimension

ITEM TRACKING BUTTON (on Sub-Form Line):
  Opens Lot/Serial assignment page
  If Lot or Serial tracked: MANDATORY before Transfer Shipment post
  On Transfer Receipt: Serial/Lot auto-populated from Shipment automatically

VALIDATION: Dimension tagged on Location — used for Transfer Shipment/Receipt buttons
VALIDATION: User Setup defines department — enforced on both buttons
NAVFarm registers: Item Ledger + Value Entry on Transfer Shipment/Receipt
```
