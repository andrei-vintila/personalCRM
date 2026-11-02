CREATE TABLE `duplicate_dismissals` (
	`contact_a` text NOT NULL,
	`contact_b` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`contact_a`, `contact_b`),
	FOREIGN KEY (`contact_a`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_b`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
