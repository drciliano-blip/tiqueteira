-- ===========================================================================
-- Row Level Security — Tiqueteira
-- ===========================================================================
-- Rodar SEMPRE depois de `pnpm db:migrate`, pela conexão DIRETA (DIRECT_URL),
-- com o papel `postgres`. É idempotente: pode rodar quantas vezes precisar.
--
-- Desenho:
--   postgres            → dono do schema. Roda migrations. Não é usado pela app.
--   tiqueteira_app      → papel da aplicação. SUBMETIDO ao RLS.
--                         Enxerga só o tenant de `app.tenant_id`.
--   tiqueteira_service  → jobs e webhooks. BYPASSRLS explícito e auditado.
--                         Chega antes de sabermos o tenant (webhook da PSP).
--
-- O `FORCE ROW LEVEL SECURITY` é essencial: sem ele, o dono da tabela ignora
-- as políticas, e o teste de isolamento passaria sem provar nada.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Contexto do tenant
-- ---------------------------------------------------------------------------

create schema if not exists app;

/**
 * Tenant ativo da conexão. Nulo quando não definido — e política com nulo
 * nunca casa, então o padrão é "não vê nada", não "vê tudo".
 */
create or replace function app.current_tenant_id() returns uuid
  language sql stable
  set search_path = pg_catalog, public
as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

comment on function app.current_tenant_id() is
  'Tenant da conexão atual. Definido por set_config(''app.tenant_id'', ..., true) dentro da transação.';

-- ---------------------------------------------------------------------------
-- 2. Papéis
-- ---------------------------------------------------------------------------
-- Troque as senhas antes de rodar. Elas vão para DATABASE_URL e
-- SERVICE_DATABASE_URL no .env.local — nunca para o repositório.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'tiqueteira_app') then
    create role tiqueteira_app login password 'TROQUE_ESTA_SENHA_APP' nobypassrls;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'tiqueteira_service') then
    create role tiqueteira_service login password 'TROQUE_ESTA_SENHA_SERVICE' bypassrls;
  end if;
end
$$;

grant usage on schema public to tiqueteira_app, tiqueteira_service;
grant usage on schema app    to tiqueteira_app, tiqueteira_service;
grant execute on function app.current_tenant_id() to tiqueteira_app, tiqueteira_service;

grant select, insert, update, delete on all tables    in schema public to tiqueteira_app, tiqueteira_service;
grant usage, select                  on all sequences in schema public to tiqueteira_app, tiqueteira_service;

alter default privileges in schema public
  grant select, insert, update, delete on tables to tiqueteira_app, tiqueteira_service;
alter default privileges in schema public
  grant usage, select on sequences to tiqueteira_app, tiqueteira_service;

-- ---------------------------------------------------------------------------
-- 3. Política de isolamento nas tabelas com tenant_id
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
  tabelas text[] := array[
    'venues', 'events', 'ticket_types', 'coupons',
    'orders', 'order_items', 'reservations', 'tickets',
    'payouts', 'refunds', 'chargebacks', 'memberships'
  ];
begin
  foreach t in array tabelas loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force  row level security', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format($p$
      create policy tenant_isolation on public.%I
        as permissive for all
        to tiqueteira_app
        using      (tenant_id = app.current_tenant_id())
        with check (tenant_id = app.current_tenant_id())
    $p$, t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. audit_log — leitura do próprio tenant, escrita só por serviço
-- ---------------------------------------------------------------------------
-- Trilha de auditoria que a aplicação pode reescrever não é trilha de
-- auditoria. O papel da app lê; só o serviço grava.

alter table public.audit_log enable row level security;
alter table public.audit_log force  row level security;

drop policy if exists audit_log_leitura_tenant on public.audit_log;
create policy audit_log_leitura_tenant on public.audit_log
  as permissive for select
  to tiqueteira_app
  using (tenant_id = app.current_tenant_id());

revoke insert, update, delete on public.audit_log from tiqueteira_app;

-- ---------------------------------------------------------------------------
-- 5. Tabelas de infraestrutura — só o papel de serviço
-- ---------------------------------------------------------------------------
-- `users` e `sessions`: o login acontece ANTES de existir um tenant, então
--   não há política de tenant que faça sentido. O caminho de autenticação usa
--   a conexão de serviço.
-- `webhook_events` e `jobs`: o webhook da PSP chega sem contexto de tenant.
--
-- RLS ligada sem nenhuma política = ninguém passa, exceto BYPASSRLS.
-- O revoke é a segunda tranca.

do $$
declare
  t text;
  tabelas text[] := array['users', 'sessions', 'webhook_events', 'jobs', 'tenants'];
begin
  foreach t in array tabelas loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force  row level security', t);
    execute format('revoke all on public.%I from tiqueteira_app', t);
  end loop;
end
$$;

-- `tenants` precisa ser legível pela app para a vitrine pública e para o
-- painel do produtor — mas só a própria linha.
grant select on public.tenants to tiqueteira_app;
drop policy if exists tenants_self on public.tenants;
create policy tenants_self on public.tenants
  as permissive for select
  to tiqueteira_app
  using (id = app.current_tenant_id());

-- ---------------------------------------------------------------------------
-- 6. Conferência
-- ---------------------------------------------------------------------------
-- Lista o que ficou de fora. O resultado esperado é ZERO linhas.

-- select c.relname
--   from pg_class c
--   join pg_namespace n on n.oid = c.relnamespace
--  where n.nspname = 'public'
--    and c.relkind = 'r'
--    and (c.relrowsecurity = false or c.relforcerowsecurity = false);
