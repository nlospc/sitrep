CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_kind` text NOT NULL,
	`entity_id` text NOT NULL,
	`field` text NOT NULL,
	`old_value` text,
	`new_value` text NOT NULL,
	`proposal_id` text NOT NULL,
	`actor` text NOT NULL,
	`timestamp` text NOT NULL,
	FOREIGN KEY (`proposal_id`) REFERENCES `proposals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `captures` (
	`id` text PRIMARY KEY NOT NULL,
	`raw_text` text NOT NULL,
	`type_hint` text,
	`mentioned_refs` text NOT NULL,
	`is_batch` integer NOT NULL,
	`captured_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`enqueued_at` text NOT NULL,
	`completed_at` text,
	`result` text
);
--> statement-breakpoint
CREATE TABLE `milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`project_ref` text NOT NULL,
	`name` text NOT NULL,
	`planned_date` text NOT NULL,
	`current_date` text NOT NULL,
	`last_signal_at` text NOT NULL,
	FOREIGN KEY (`project_ref`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`priority` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`deep_link` text,
	`created_at` text NOT NULL,
	`read_at` text
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`channel` text NOT NULL,
	`raw_text` text NOT NULL,
	`captured_at` text NOT NULL,
	`extraction_type` text NOT NULL,
	`target_refs` text NOT NULL,
	`payload` text NOT NULL,
	`confidence` real NOT NULL,
	`risk_class` text NOT NULL,
	`state` text NOT NULL,
	`resolved_by` text,
	`resolved_at` text,
	`edit_diff` text
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`project_ref` text NOT NULL,
	`milestone_ref` text,
	`owner` text,
	`due_date` text,
	`priority` text NOT NULL,
	`state` text NOT NULL,
	FOREIGN KEY (`project_ref`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`milestone_ref`) REFERENCES `milestones`(`id`) ON UPDATE no action ON DELETE no action
);
