CREATE TYPE "public"."external_payment" AS ENUM('dinheiro', 'debito', 'credito', 'cortesia', 'outro');--> statement-breakpoint
CREATE TYPE "public"."guest_entry_type" AS ENUM('cortesia', 'desconto');--> statement-breakpoint
CREATE TYPE "public"."refund_type" AS ENUM('arrependimento_legal', 'politica_evento', 'evento_cancelado', 'chargeback', 'outro');--> statement-breakpoint
CREATE TYPE "public"."sales_channel" AS ENUM('online', 'pdv', 'lista');--> statement-breakpoint
CREATE TABLE "buyer_access_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"usado_em" timestamp with time zone,
	"ip" text,
	"user_agent" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_splits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"provider_recipient_id" text NOT NULL,
	"participacao_bps" integer NOT NULL,
	"arca_com_estorno" boolean DEFAULT true NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_splits_participacao_ck" CHECK ("event_splits"."participacao_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "guest_list_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"guest_list_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"cpf" text,
	"telefone" text,
	"tipo" "guest_entry_type" DEFAULT 'cortesia' NOT NULL,
	"ticket_id" uuid,
	"usado_em" timestamp with time zone,
	"checked_in_by" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guest_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"promoter_nome" text,
	"promoter_user_id" uuid,
	"cota" integer NOT NULL,
	"ticket_type_id" uuid,
	"valido_ate" timestamp with time zone,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_lists_cota_ck" CHECK ("guest_lists"."cota" >= 0)
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "cancelamento_ate_dias_compra" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "cancelamento_ate_horas_evento" integer DEFAULT 48 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "permite_reembolso_parcial" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "cancelamento_produtor_ate_horas_pos" integer DEFAULT 48 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "cor_acento" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "canal" "sales_channel" DEFAULT 'online' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "metodo_externo" "external_payment";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pdv_operador_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "utm_source" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "utm_medium" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "utm_campaign" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "utm_content" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "utm_term" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "ticket_id" uuid;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "tipo" "refund_type" DEFAULT 'politica_evento' NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "inclui_conveniencia" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "cor_acento" text DEFAULT '#5B4BFF' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "taxa_absorvida_pelo_produtor" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "taxa_minima_centavos" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "juros_parcelamento_absorvidos" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "pixel_meta_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "google_analytics_id" text;--> statement-breakpoint
ALTER TABLE "event_splits" ADD CONSTRAINT "event_splits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_splits" ADD CONSTRAINT "event_splits_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_list_entries" ADD CONSTRAINT "guest_list_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_list_entries" ADD CONSTRAINT "guest_list_entries_guest_list_id_guest_lists_id_fk" FOREIGN KEY ("guest_list_id") REFERENCES "public"."guest_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_list_entries" ADD CONSTRAINT "guest_list_entries_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_list_entries" ADD CONSTRAINT "guest_list_entries_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_list_entries" ADD CONSTRAINT "guest_list_entries_checked_in_by_users_id_fk" FOREIGN KEY ("checked_in_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_lists" ADD CONSTRAINT "guest_lists_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_lists" ADD CONSTRAINT "guest_lists_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_lists" ADD CONSTRAINT "guest_lists_promoter_user_id_users_id_fk" FOREIGN KEY ("promoter_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_lists" ADD CONSTRAINT "guest_lists_ticket_type_id_ticket_types_id_fk" FOREIGN KEY ("ticket_type_id") REFERENCES "public"."ticket_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "buyer_access_tokens_hash_key" ON "buyer_access_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "buyer_access_tokens_email_idx" ON "buyer_access_tokens" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "buyer_access_tokens_expira_idx" ON "buyer_access_tokens" USING btree ("expira_em") WHERE usado_em is null;--> statement-breakpoint
CREATE UNIQUE INDEX "event_splits_event_recipient_key" ON "event_splits" USING btree ("event_id","provider_recipient_id");--> statement-breakpoint
CREATE INDEX "event_splits_tenant_idx" ON "event_splits" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "guest_list_entries_lista_idx" ON "guest_list_entries" USING btree ("guest_list_id");--> statement-breakpoint
CREATE INDEX "guest_list_entries_event_idx" ON "guest_list_entries" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "guest_list_entries_nome_idx" ON "guest_list_entries" USING btree ("event_id",lower("nome"));--> statement-breakpoint
CREATE INDEX "guest_lists_event_idx" ON "guest_lists" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "guest_lists_tenant_idx" ON "guest_lists" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_pdv_operador_id_users_id_fk" FOREIGN KEY ("pdv_operador_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_canal_idx" ON "orders" USING btree ("event_id","canal");--> statement-breakpoint
CREATE INDEX "orders_utm_idx" ON "orders" USING btree ("event_id","utm_source");--> statement-breakpoint
CREATE INDEX "refunds_ticket_idx" ON "refunds" USING btree ("ticket_id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_canal_ck" CHECK (("orders"."canal" = 'online' and "orders"."metodo_externo" is null)
          or ("orders"."canal" <> 'online' and "orders"."provider_transaction_id" is null));--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_taxa_minima_ck" CHECK ("tenants"."taxa_minima_centavos" >= 0);