CREATE TABLE `observations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`observed_at` integer NOT NULL,
	`feed_timestamp` integer NOT NULL,
	`trip_id` text NOT NULL,
	`route_id` text NOT NULL,
	`direction_id` integer NOT NULL,
	`stop_id` text NOT NULL,
	`predicted_time` integer NOT NULL,
	`delay_seconds` integer,
	`vehicle_id` text,
	`vehicle_lat` real,
	`vehicle_lon` real
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_observations_unique_sample` ON `observations` (`observed_at`,`trip_id`,`stop_id`,`predicted_time`);--> statement-breakpoint
CREATE INDEX `idx_observations_direction_time` ON `observations` (`direction_id`,`observed_at`);
--> statement-breakpoint
PRAGMA optimize;
