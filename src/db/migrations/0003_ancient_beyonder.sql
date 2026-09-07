CREATE TYPE "public"."event_category" AS ENUM('festa', 'show', 'teatro', 'stand_up', 'esporte', 'gastronomia', 'curso', 'infantil', 'outro');--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "categoria" "event_category" DEFAULT 'festa' NOT NULL;--> statement-breakpoint
CREATE INDEX "events_categoria_idx" ON "events" USING btree ("categoria","data_inicio");