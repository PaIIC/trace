CREATE TABLE `idea_versions` (
	`idea_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`revision` integer NOT NULL,
	`archived_at` text NOT NULL,
	`snapshot` text NOT NULL,
	PRIMARY KEY(`idea_id`, `revision`),
	FOREIGN KEY (`idea_id`) REFERENCES `ideas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idea_versions_owner_idx` ON `idea_versions` (`owner_id`);--> statement-breakpoint
ALTER TABLE `ideas` ADD `restored_from_revision` integer;--> statement-breakpoint
ALTER TABLE `ideas` ADD `restore_request_id` text;