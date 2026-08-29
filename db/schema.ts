import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const observations = sqliteTable('observations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  observedAt: integer('observed_at').notNull(),
  feedTimestamp: integer('feed_timestamp').notNull(),
  tripId: text('trip_id').notNull(),
  routeId: text('route_id').notNull(),
  directionId: integer('direction_id').notNull(),
  stopId: text('stop_id').notNull(),
  predictedTime: integer('predicted_time').notNull(),
  delaySeconds: integer('delay_seconds'),
  vehicleId: text('vehicle_id'),
  vehicleLat: real('vehicle_lat'),
  vehicleLon: real('vehicle_lon'),
}, (table) => [
  uniqueIndex('idx_observations_unique_sample').on(table.observedAt, table.tripId, table.stopId, table.predictedTime),
  index('idx_observations_direction_time').on(table.directionId, table.observedAt),
]);
