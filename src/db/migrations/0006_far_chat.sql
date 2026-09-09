CREATE TYPE "public"."movimento_tipo" AS ENUM('entrada', 'saida');--> statement-breakpoint
CREATE TABLE "ticket_movimentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"tipo" "movimento_tipo" NOT NULL,
	"em" timestamp with time zone DEFAULT now() NOT NULL,
	"operador_id" uuid,
	"device_id" text,
	"origem" text DEFAULT 'online' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "controla_saida" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "permite_reentrada" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "dentro" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "ultima_entrada_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "ultima_saida_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "entradas_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_movimentos" ADD CONSTRAINT "ticket_movimentos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_movimentos" ADD CONSTRAINT "ticket_movimentos_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_movimentos" ADD CONSTRAINT "ticket_movimentos_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_movimentos" ADD CONSTRAINT "ticket_movimentos_operador_id_users_id_fk" FOREIGN KEY ("operador_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_movimentos_dedupe_key" ON "ticket_movimentos" USING btree ("ticket_id","tipo","em");--> statement-breakpoint
CREATE INDEX "ticket_movimentos_event_idx" ON "ticket_movimentos" USING btree ("event_id","em");--> statement-breakpoint
CREATE INDEX "ticket_movimentos_ticket_idx" ON "ticket_movimentos" USING btree ("ticket_id","em");--> statement-breakpoint
CREATE INDEX "tickets_dentro_idx" ON "tickets" USING btree ("event_id") WHERE dentro;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_entradas_ck" CHECK ("tickets"."entradas_count" >= 0);--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_dentro_ck" CHECK ((not "tickets"."dentro") or "tickets"."entradas_count" > 0);--> statement-breakpoint
-- Retrocompatibilidade: quem já entrou antes desta migration continua contando
-- como quem entrou. `dentro` fica falso de propósito — evento que não
-- controlava saída não tem como saber quem ficou, e a máquina de estado já
-- barra a segunda leitura pelo `entradas_count`.
UPDATE "tickets" SET "entradas_count" = 1, "ultima_entrada_em" = "checked_in_em"
 WHERE "status" = 'usado' AND "checked_in_em" IS NOT NULL;
