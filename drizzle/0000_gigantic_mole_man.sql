CREATE TABLE `ideas` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`bookmarked` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`analysis` text,
	`analysis_model` text,
	`analyzed_at` text,
	`analysis_started_at` text,
	`analysis_job` text,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `ideas_owner_created_idx` ON `ideas` (`owner_id`,`created_at`);