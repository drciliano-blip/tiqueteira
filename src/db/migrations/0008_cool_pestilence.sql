CREATE TYPE "public"."fila_status" AS ENUM('aguardando', 'admitido', 'expirado');--> statement-breakpoint
CREATE TABLE "fila_virtual" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"numero" bigint NOT NULL,
	"status" "fila_status" DEFAULT 'aguardando' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"admitido_em" timestamp with time zone,
	"expira_em" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "fila_ativa" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "fila_capacidade" integer DEFAULT 200 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "fila_janela_minutos" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "fila_ultimo_numero" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "fila_chamados_ate" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "fila_marca_anterior" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "fila_avancada_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fila_virtual" ADD CONSTRAINT "fila_virtual_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fila_virtual" ADD CONSTRAINT "fila_virtual_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fila_virtual_token_key" ON "fila_virtual" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "fila_virtual_evento_numero_key" ON "fila_virtual" USING btree ("event_id","numero");--> statement-breakpoint
CREATE INDEX "fila_virtual_ocupando_idx" ON "fila_virtual" USING btree ("event_id","expira_em") WHERE status = 'admitido';