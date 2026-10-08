-- A scheduler line's quantity is either per head (the standard x animals) or per batch (the standard is the
-- whole stage's). PER_PEN and FIXED were offered but never behaved differently from per batch, so they are
-- retired: any line or activity default still carrying one reads as per batch, which is how it was computed.
UPDATE `scheduler_line` SET `qty_basis` = 'TOTAL_BATCH' WHERE `qty_basis` IN ('PER_PEN', 'FIXED');
--> statement-breakpoint
UPDATE `activity_master` SET `default_qty_basis` = 'TOTAL_BATCH' WHERE `default_qty_basis` IN ('PER_PEN', 'FIXED');
