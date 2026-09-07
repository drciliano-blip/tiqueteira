CREATE TYPE "public"."chargeback_status" AS ENUM('aberto', 'contestado', 'ganho', 'perdido');--> statement-breakpoint
CREATE TYPE "public"."cota_meia_base" AS ENUM('total_evento', 'por_tipo');--> statement-breakpoint
CREATE TYPE "public"."coupon_type" AS ENUM('pct', 'valor');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('rascunho', 'publicado', 'esgotado', 'encerrado', 'cancelado', 'adiado');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."kyc_status" AS ENUM('pendente', 'em_analise', 'aprovado', 'reprovado', 'suspenso');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'admin', 'operador', 'portaria');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('draft', 'awaiting_payment', 'paid', 'partially_refunded', 'refunded', 'expired', 'canceled', 'chargeback');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('pix', 'credit_card');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('scheduled', 'processing', 'released', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."payout_tranche" AS ENUM('principal', 'reserva');--> statement-breakpoint
CREATE TYPE "public"."refund_reason" AS ENUM('buyer_request', 'event_canceled', 'event_postponed', 'duplicate', 'fraud', 'other');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('requested', 'processing', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."reservation_release_reason" AS ENUM('paga', 'expirada', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('ativo', 'suspenso', 'inativo');--> statement-breakpoint
CREATE TYPE "public"."ticket_kind" AS ENUM('inteira', 'meia', 'cortesia', 'pcd', 'idoso');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('valido', 'usado', 'cancelado', 'transferido');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ativo', 'inativo', 'bloqueado');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"user_id" uuid,
	"acao" text NOT NULL,
	"entidade" text NOT NULL,
	"entidade_id" uuid,
	"antes" jsonb,
	"depois" jsonb,
	"ip" text,
	"user_agent" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chargebacks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"valor_centavos" integer NOT NULL,
	"status" chargeback_status DEFAULT 'aberto' NOT NULL,
	"provider_dispute_id" text,
	"aberto_em" timestamp with time zone DEFAULT now() NOT NULL,
	"resolvido_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chargebacks_valor_ck" CHECK ("chargebacks"."valor_centavos" > 0)
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid,
	"codigo" text NOT NULL,
	"tipo" "coupon_type" NOT NULL,
	"valor" integer NOT NULL,
	"usos_maximos" integer,
	"usos_atuais" integer DEFAULT 0 NOT NULL,
	"valido_ate" timestamp with time zone,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_valor_ck" CHECK ("coupons"."valor" > 0),
	CONSTRAINT "coupons_usos_ck" CHECK ("coupons"."usos_atuais" >= 0),
	CONSTRAINT "coupons_pct_ck" CHECK ("coupons"."tipo" <> 'pct' or "coupons"."valor" <= 10000)
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"venue_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"titulo" text NOT NULL,
	"descricao" text,
	"imagem_url" text,
	"data_inicio" timestamp with time zone NOT NULL,
	"data_fim" timestamp with time zone NOT NULL,
	"classificacao_etaria" integer DEFAULT 18 NOT NULL,
	"capacidade" integer NOT NULL,
	"status" "event_status" DEFAULT 'rascunho' NOT NULL,
	"politica_reembolso" text,
	"permite_cancelamento_ate_horas" integer DEFAULT 48 NOT NULL,
	"ingresso_nominal" boolean DEFAULT true NOT NULL,
	"exige_documento_entrada" boolean DEFAULT false NOT NULL,
	"permite_transferencia" boolean DEFAULT true NOT NULL,
	"transferencia_ate_horas" integer DEFAULT 24 NOT NULL,
	"max_transferencias_por_ingresso" integer DEFAULT 1 NOT NULL,
	"taxa_transferencia_centavos" integer DEFAULT 0 NOT NULL,
	"transferencia_permite_meia" boolean DEFAULT false NOT NULL,
	"cota_meia_bps" integer DEFAULT 4000 NOT NULL,
	"cota_meia_base" "cota_meia_base" DEFAULT 'total_evento' NOT NULL,
	"cancelado_em" timestamp with time zone,
	"cancelado_motivo" text,
	"settled_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_periodo_ck" CHECK ("events"."data_fim" > "events"."data_inicio"),
	CONSTRAINT "events_capacidade_ck" CHECK ("events"."capacidade" > 0),
	CONSTRAINT "events_cota_meia_ck" CHECK ("events"."cota_meia_bps" between 0 and 10000),
	CONSTRAINT "events_taxa_transferencia_ck" CHECK ("events"."taxa_transferencia_centavos" >= 0)
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"tenant_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"tentativas" integer DEFAULT 0 NOT NULL,
	"max_tentativas" integer DEFAULT 5 NOT NULL,
	"proxima_tentativa_em" timestamp with time zone DEFAULT now() NOT NULL,
	"ultimo_erro" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"concluido_em" timestamp with time zone,
	CONSTRAINT "jobs_tentativas_ck" CHECK ("jobs"."tentativas" >= 0)
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"evento_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"ticket_type_id" uuid NOT NULL,
	"quantidade" integer NOT NULL,
	"preco_unitario_centavos_snapshot" integer NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_quantidade_ck" CHECK ("order_items"."quantidade" > 0),
	CONSTRAINT "order_items_preco_ck" CHECK ("order_items"."preco_unitario_centavos_snapshot" >= 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"numero" integer NOT NULL,
	"comprador_nome" text NOT NULL,
	"comprador_email" text NOT NULL,
	"comprador_cpf" text NOT NULL,
	"comprador_telefone" text,
	"subtotal_centavos" integer NOT NULL,
	"conveniencia_centavos" integer DEFAULT 0 NOT NULL,
	"desconto_centavos" integer DEFAULT 0 NOT NULL,
	"total_centavos" integer NOT NULL,
	"valor_produtor_centavos" integer NOT NULL,
	"valor_operador_centavos" integer NOT NULL,
	"taxa_conveniencia_bps_snapshot" integer NOT NULL,
	"comissao_bps_snapshot" integer NOT NULL,
	"taxa_fixa_centavos_snapshot" integer DEFAULT 0 NOT NULL,
	"cupom_id" uuid,
	"metodo" "payment_method",
	"parcelas" integer,
	"status" "order_status" DEFAULT 'draft' NOT NULL,
	"provider_transaction_id" text,
	"idempotency_key" text NOT NULL,
	"expires_em" timestamp with time zone,
	"pago_em" timestamp with time zone,
	"cancelado_em" timestamp with time zone,
	"ip_address" text,
	"user_agent" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_subtotal_ck" CHECK ("orders"."subtotal_centavos" >= 0),
	CONSTRAINT "orders_conveniencia_ck" CHECK ("orders"."conveniencia_centavos" >= 0),
	CONSTRAINT "orders_desconto_ck" CHECK ("orders"."desconto_centavos" >= 0),
	CONSTRAINT "orders_total_ck" CHECK ("orders"."total_centavos" >= 0),
	CONSTRAINT "orders_split_ck" CHECK ("orders"."valor_produtor_centavos" + "orders"."valor_operador_centavos" = "orders"."total_centavos"),
	CONSTRAINT "orders_total_composicao_ck" CHECK ("orders"."total_centavos" = "orders"."subtotal_centavos" + "orders"."conveniencia_centavos" - "orders"."desconto_centavos"),
	CONSTRAINT "orders_parcelas_ck" CHECK ("orders"."parcelas" is null or "orders"."parcelas" between 1 and 12)
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"tranche" "payout_tranche" NOT NULL,
	"metodo" "payment_method" NOT NULL,
	"bruto_centavos" integer NOT NULL,
	"reembolsos_centavos" integer DEFAULT 0 NOT NULL,
	"chargebacks_centavos" integer DEFAULT 0 NOT NULL,
	"comissao_centavos" integer DEFAULT 0 NOT NULL,
	"retido_centavos" integer DEFAULT 0 NOT NULL,
	"liberado_centavos" integer DEFAULT 0 NOT NULL,
	"status" "payout_status" DEFAULT 'scheduled' NOT NULL,
	"data_prevista" timestamp with time zone NOT NULL,
	"data_efetiva" timestamp with time zone,
	"provider_payout_id" text,
	"idempotency_key" text NOT NULL,
	"ultimo_erro" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payouts_bruto_ck" CHECK ("payouts"."bruto_centavos" >= 0),
	CONSTRAINT "payouts_retido_ck" CHECK ("payouts"."retido_centavos" >= 0),
	CONSTRAINT "payouts_liberado_ck" CHECK ("payouts"."liberado_centavos" is not null)
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"motivo" "refund_reason" NOT NULL,
	"observacao" text,
	"valor_centavos" integer NOT NULL,
	"status" "refund_status" DEFAULT 'requested' NOT NULL,
	"provider_refund_id" text,
	"idempotency_key" text NOT NULL,
	"solicitado_por" uuid,
	"solicitado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"concluido_em" timestamp with time zone,
	"ultimo_erro" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_valor_ck" CHECK ("refunds"."valor_centavos" > 0)
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ticket_type_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"quantidade" integer NOT NULL,
	"expires_em" timestamp with time zone NOT NULL,
	"liberada" boolean DEFAULT false NOT NULL,
	"liberada_em" timestamp with time zone,
	"liberada_motivo" "reservation_release_reason",
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_quantidade_ck" CHECK ("reservations"."quantidade" > 0),
	CONSTRAINT "reservations_liberada_ck" CHECK (("reservations"."liberada" = false and "reservations"."liberada_em" is null and "reservations"."liberada_motivo" is null)
          or ("reservations"."liberada" = true and "reservations"."liberada_em" is not null and "reservations"."liberada_motivo" is not null))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"tenant_id" uuid,
	"scope_event_id" uuid,
	"expira_em" timestamp with time zone NOT NULL,
	"revogada_em" timestamp with time zone,
	"ip_address" text,
	"user_agent" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"nome" text NOT NULL,
	"razao_social" text,
	"cnpj" text,
	"email" text NOT NULL,
	"telefone" text,
	"provider_recipient_id" text,
	"kyc_status" "kyc_status" DEFAULT 'pendente' NOT NULL,
	"status" "tenant_status" DEFAULT 'ativo' NOT NULL,
	"taxa_conveniencia_bps" integer DEFAULT 1000 NOT NULL,
	"comissao_bps" integer DEFAULT 0 NOT NULL,
	"taxa_fixa_centavos" integer DEFAULT 0 NOT NULL,
	"reserva_pix_bps" integer DEFAULT 0 NOT NULL,
	"reserva_cartao_bps" integer DEFAULT 2000 NOT NULL,
	"dias_liberacao_evento" integer DEFAULT 2 NOT NULL,
	"dias_liberacao_reserva" integer DEFAULT 35 NOT NULL,
	"dominio_customizado" text,
	"dominio_verificado" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_taxa_conveniencia_ck" CHECK ("tenants"."taxa_conveniencia_bps" between 0 and 10000),
	CONSTRAINT "tenants_comissao_ck" CHECK ("tenants"."comissao_bps" between 0 and 10000),
	CONSTRAINT "tenants_taxa_fixa_ck" CHECK ("tenants"."taxa_fixa_centavos" >= 0),
	CONSTRAINT "tenants_reserva_pix_ck" CHECK ("tenants"."reserva_pix_bps" between 0 and 10000),
	CONSTRAINT "tenants_reserva_cartao_ck" CHECK ("tenants"."reserva_cartao_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "ticket_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"descricao" text,
	"preco_centavos" integer NOT NULL,
	"tipo" "ticket_kind" DEFAULT 'inteira' NOT NULL,
	"consome_cota_meia" boolean DEFAULT false NOT NULL,
	"quantidade_total" integer NOT NULL,
	"quantidade_vendida" integer DEFAULT 0 NOT NULL,
	"quantidade_reservada" integer DEFAULT 0 NOT NULL,
	"lote" integer DEFAULT 1 NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL,
	"vendas_inicio" timestamp with time zone NOT NULL,
	"vendas_fim" timestamp with time zone NOT NULL,
	"limite_por_pedido" integer DEFAULT 6 NOT NULL,
	"limite_por_cpf" integer,
	"exige_documento" boolean DEFAULT false NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_types_preco_ck" CHECK ("ticket_types"."preco_centavos" >= 0),
	CONSTRAINT "ticket_types_total_ck" CHECK ("ticket_types"."quantidade_total" >= 0),
	CONSTRAINT "ticket_types_vendida_ck" CHECK ("ticket_types"."quantidade_vendida" >= 0),
	CONSTRAINT "ticket_types_reservada_ck" CHECK ("ticket_types"."quantidade_reservada" >= 0),
	CONSTRAINT "ticket_types_estoque_ck" CHECK ("ticket_types"."quantidade_vendida" + "ticket_types"."quantidade_reservada" <= "ticket_types"."quantidade_total"),
	CONSTRAINT "ticket_types_janela_ck" CHECK ("ticket_types"."vendas_fim" > "ticket_types"."vendas_inicio"),
	CONSTRAINT "ticket_types_limite_pedido_ck" CHECK ("ticket_types"."limite_por_pedido" > 0)
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"ticket_type_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"codigo" text NOT NULL,
	"token_hash" text NOT NULL,
	"titular_nome" text NOT NULL,
	"titular_cpf" text,
	"titular_email" text,
	"status" "ticket_status" DEFAULT 'valido' NOT NULL,
	"checked_in_em" timestamp with time zone,
	"checked_in_by" uuid,
	"checked_in_device_id" text,
	"documento_conferido" boolean DEFAULT false NOT NULL,
	"transferido_de_ticket_id" uuid,
	"transferencias_count" integer DEFAULT 0 NOT NULL,
	"cancelado_em" timestamp with time zone,
	"cancelado_motivo" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_transferencias_ck" CHECK ("tickets"."transferencias_count" >= 0),
	CONSTRAINT "tickets_checkin_ck" CHECK (("tickets"."status" <> 'usado') or ("tickets"."checked_in_em" is not null))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"nome" text NOT NULL,
	"senha_hash" text,
	"status" "user_status" DEFAULT 'ativo' NOT NULL,
	"email_verificado_em" timestamp with time zone,
	"ultimo_login_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"endereco" text,
	"cidade" text,
	"uf" text,
	"capacidade_maxima" integer NOT NULL,
	"observacoes" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venues_capacidade_ck" CHECK ("venues"."capacidade_maxima" > 0)
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"tipo" text NOT NULL,
	"payload_raw" text NOT NULL,
	"headers" jsonb,
	"assinatura_valida" boolean NOT NULL,
	"recebido_em" timestamp with time zone DEFAULT now() NOT NULL,
	"processado_em" timestamp with time zone,
	"erro" text,
	"tentativas" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chargebacks" ADD CONSTRAINT "chargebacks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chargebacks" ADD CONSTRAINT "chargebacks_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_evento_id_events_id_fk" FOREIGN KEY ("evento_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_ticket_type_id_ticket_types_id_fk" FOREIGN KEY ("ticket_type_id") REFERENCES "public"."ticket_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cupom_id_coupons_id_fk" FOREIGN KEY ("cupom_id") REFERENCES "public"."coupons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_solicitado_por_users_id_fk" FOREIGN KEY ("solicitado_por") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_ticket_type_id_ticket_types_id_fk" FOREIGN KEY ("ticket_type_id") REFERENCES "public"."ticket_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_scope_event_id_events_id_fk" FOREIGN KEY ("scope_event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_ticket_type_id_ticket_types_id_fk" FOREIGN KEY ("ticket_type_id") REFERENCES "public"."ticket_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_checked_in_by_users_id_fk" FOREIGN KEY ("checked_in_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_transferido_de_ticket_id_tickets_id_fk" FOREIGN KEY ("transferido_de_ticket_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_tenant_idx" ON "audit_log" USING btree ("tenant_id","criado_em");--> statement-breakpoint
CREATE INDEX "audit_log_entidade_idx" ON "audit_log" USING btree ("entidade","entidade_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chargebacks_provider_dispute_key" ON "chargebacks" USING btree ("provider_dispute_id");--> statement-breakpoint
CREATE INDEX "chargebacks_order_idx" ON "chargebacks" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "chargebacks_tenant_idx" ON "chargebacks" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_tenant_codigo_key" ON "coupons" USING btree ("tenant_id",upper("codigo"));--> statement-breakpoint
CREATE UNIQUE INDEX "events_tenant_slug_key" ON "events" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "events_tenant_status_idx" ON "events" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "events_data_inicio_idx" ON "events" USING btree ("data_inicio");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_key" ON "jobs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "jobs_fila_idx" ON "jobs" USING btree ("proxima_tentativa_em") WHERE status in ('pending', 'failed');--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_user_tenant_evento_key" ON "memberships" USING btree ("user_id","tenant_id","evento_id");--> statement-breakpoint
CREATE INDEX "memberships_tenant_idx" ON "memberships" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_tenant_numero_key" ON "orders" USING btree ("tenant_id","numero");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_idempotency_key" ON "orders" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_provider_transaction_key" ON "orders" USING btree ("provider_transaction_id");--> statement-breakpoint
CREATE INDEX "orders_event_status_idx" ON "orders" USING btree ("event_id","status");--> statement-breakpoint
CREATE INDEX "orders_tenant_idx" ON "orders" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "orders_cpf_idx" ON "orders" USING btree ("event_id","comprador_cpf");--> statement-breakpoint
CREATE INDEX "orders_expires_idx" ON "orders" USING btree ("expires_em") WHERE status = 'awaiting_payment';--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_idempotency_key" ON "payouts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_event_tranche_metodo_key" ON "payouts" USING btree ("event_id","tranche","metodo");--> statement-breakpoint
CREATE INDEX "payouts_status_data_idx" ON "payouts" USING btree ("status","data_prevista");--> statement-breakpoint
CREATE INDEX "payouts_tenant_idx" ON "payouts" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_idempotency_key" ON "refunds" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "refunds_order_idx" ON "refunds" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "refunds_status_idx" ON "refunds" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reservations_expires_idx" ON "reservations" USING btree ("expires_em") WHERE liberada = false;--> statement-breakpoint
CREATE INDEX "reservations_order_idx" ON "reservations" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "reservations_ticket_type_idx" ON "reservations" USING btree ("ticket_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expira_idx" ON "sessions" USING btree ("expira_em") WHERE revogada_em is null;--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_dominio_key" ON "tenants" USING btree ("dominio_customizado");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_cnpj_key" ON "tenants" USING btree ("cnpj");--> statement-breakpoint
CREATE INDEX "ticket_types_event_idx" ON "ticket_types" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "ticket_types_tenant_idx" ON "ticket_types" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_codigo_key" ON "tickets" USING btree ("codigo");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_token_hash_key" ON "tickets" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "tickets_event_status_idx" ON "tickets" USING btree ("event_id","status");--> statement-breakpoint
CREATE INDEX "tickets_order_idx" ON "tickets" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "tickets_titular_cpf_idx" ON "tickets" USING btree ("event_id","titular_cpf");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "venues_tenant_idx" ON "venues" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_provider_event_key" ON "webhook_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "webhook_events_pendentes_idx" ON "webhook_events" USING btree ("recebido_em") WHERE processado_em is null;