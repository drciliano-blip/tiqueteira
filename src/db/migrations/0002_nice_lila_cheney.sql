ALTER TABLE "orders" ALTER COLUMN "comprador_nome" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "comprador_email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "comprador_cpf" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_comprador_ck" CHECK ("orders"."status" = 'draft' or ("orders"."comprador_nome" is not null
          and "orders"."comprador_email" is not null and "orders"."comprador_cpf" is not null));