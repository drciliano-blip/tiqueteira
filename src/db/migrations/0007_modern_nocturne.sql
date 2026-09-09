ALTER TABLE "orders" DROP CONSTRAINT "orders_comprador_ck";--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_comprador_ck" CHECK ("orders"."status" = 'draft'
          or ("orders"."canal" <> 'online' and "orders"."comprador_nome" is not null)
          or ("orders"."comprador_nome" is not null
              and "orders"."comprador_email" is not null and "orders"."comprador_cpf" is not null));