CREATE TABLE `sync_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `shop_id` text NOT NULL,
  `platform` text NOT NULL,
  `scope` text NOT NULL,
  `source_total` integer DEFAULT 0 NOT NULL,
  `processed` integer DEFAULT 0 NOT NULL,
  `status` text DEFAULT 'completed' NOT NULL,
  `detail` text DEFAULT '' NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sync_runs_shop_created` ON `sync_runs` (`shop_id`,`created_at`);
