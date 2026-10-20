ALTER TABLE `ideas` ADD `revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `ideas` ADD `analysis_stale` integer DEFAULT 0 NOT NULL;