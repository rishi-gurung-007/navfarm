CREATE TABLE `feed_requisition_transfer` (
  `link_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `requisition_id` varchar(36) NOT NULL,
  `transfer_id` varchar(36) NOT NULL,
  `bin_assignment_id` varchar(36) NOT NULL,
  `created_by` varchar(36),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `feed_requisition_transfer_link_id` PRIMARY KEY(`link_id`),
  CONSTRAINT `uq_feed_req_transfer_transfer` UNIQUE(`transfer_id`),
  CONSTRAINT `uq_feed_req_transfer_pair` UNIQUE(`requisition_id`,`transfer_id`),
  CONSTRAINT `feed_req_transfer_requisition_fk` FOREIGN KEY (`requisition_id`) REFERENCES `requisition`(`requisition_id`) ON DELETE cascade,
  CONSTRAINT `feed_req_transfer_transfer_fk` FOREIGN KEY (`transfer_id`) REFERENCES `stock_transfer`(`transfer_id`) ON DELETE restrict,
  CONSTRAINT `feed_req_transfer_assignment_fk` FOREIGN KEY (`bin_assignment_id`) REFERENCES `bin_diet_assignment`(`assignment_id`) ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_feed_req_transfer_tenant_requisition` ON `feed_requisition_transfer` (`tenant_id`,`requisition_id`);
--> statement-breakpoint
CREATE INDEX `idx_feed_req_transfer_assignment` ON `feed_requisition_transfer` (`bin_assignment_id`);
