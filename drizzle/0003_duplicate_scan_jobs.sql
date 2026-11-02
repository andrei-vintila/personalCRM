CREATE TABLE `duplicate_candidates` (
	`contact_a` text NOT NULL,
	`contact_b` text NOT NULL,
	`score` real NOT NULL,
	`confidence` text NOT NULL,
	`reasons` text NOT NULL,
	PRIMARY KEY(`contact_a`, `contact_b`),
	FOREIGN KEY (`contact_a`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_b`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `duplicate_candidates_score_idx` ON `duplicate_candidates` (`score`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`name` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`error` text,
	`fingerprint` text,
	`result` text
);
