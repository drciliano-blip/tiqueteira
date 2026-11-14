CREATE TYPE "public"."solicitacao_status" AS ENUM('aberta', 'devolvida', 'recusada');--> statement-breakpoint
CREATE TYPE "public"."solicitacao_tipo" AS ENUM('evento_nao_realizado', 'servico_nao_prestado', 'servico_diferente_do_ofertado', 'reclamacao_procedente');--> statement-breakpoint
CREATE TABLE "solicitacoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"tipo" "solicitacao_tipo" NOT NULL,
	"relato" text NOT NULL,
	"status" "solicitacao_status" DEFAULT 'aberta' NOT NULL,
	"resposta" text,
	"refund_id" uuid,
	"respondido_por" uuid,
	"respondido_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "solicitacoes_relato_ck" CHECK (length("solicitacoes"."relato") >= 15),
	CONSTRAINT "solicitacoes_resposta_ck" CHECK ("solicitacoes"."status" <> 'recusada' or length(coalesce("solicitacoes"."resposta", '')) >= 15)
);
--> statement-breakpoint
ALTER TABLE "solicitacoes" ADD CONSTRAINT "solicitacoes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitacoes" ADD CONSTRAINT "solicitacoes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitacoes" ADD CONSTRAINT "solicitacoes_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitacoes" ADD CONSTRAINT "solicitacoes_respondido_por_users_id_fk" FOREIGN KEY ("respondido_por") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "solicitacoes_tenant_status_idx" ON "solicitacoes" USING btree ("tenant_id","status","criado_em");--> statement-breakpoint
CREATE INDEX "solicitacoes_order_idx" ON "solicitacoes" USING btree ("order_id");