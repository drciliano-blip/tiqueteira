CREATE TABLE "rate_limits" (
	"chave" text PRIMARY KEY NOT NULL,
	"janela_inicio" timestamp with time zone DEFAULT now() NOT NULL,
	"contador" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "rate_limits_janela_idx" ON "rate_limits" USING btree ("janela_inicio");