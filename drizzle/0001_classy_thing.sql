CREATE TABLE `ai_connections` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`model` text NOT NULL,
	`encrypted_key` text NOT NULL,
	`key_hint` text NOT NULL,
	`updated_at` text NOT NULL
);
