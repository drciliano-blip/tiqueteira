# Tiqueteira — Contexto do Projeto

@AGENTS.md

Leia também `docs/plano.md`. Ele é a especificação; este arquivo é o resumo
operacional. Decisões tomadas durante a construção ficam em `docs/decisoes.md`.

## O que é
Marketplace de ingressos multi-tenant. O operador é [CNPJ do grupo — a definir].
Produtores vendem ingressos dos próprios eventos. O operador cobra conveniência
e/ou comissão.

## Regras invioláveis

1. A plataforma NUNCA custodia dinheiro. Todo pagamento usa split na PSP.
   Se uma implementação exigir que o valor transite por conta do operador
   antes do repasse, PARE e sinalize.
2. Status de pagamento só muda por webhook verificado e idempotente.
   Nunca por retorno de frontend.
3. Toda query tem tenant_id. RLS ativa em todas as tabelas.
4. Valores monetários em CENTAVOS (integer). Nunca float, nunca decimal
   em JavaScript.
5. Taxas e percentuais são configuração no banco, nunca constante no código.
   Todo pedido grava snapshot dos percentuais aplicados.
6. Toda operação que altera estado externo recebe idempotencyKey da aplicação.
7. Transição de estado só através da máquina de estado em src/domain/.

## Stack
Next.js 16 App Router, TypeScript strict, Postgres (Supabase), Drizzle ORM,
Tailwind v4, Zod v4, Vitest, Vercel.

> Next.js 16 tem breaking changes em relação a versões anteriores. Antes de
> escrever código de rota, Server Action ou middleware, consulte
> `node_modules/next/dist/docs/`.

## Convenções
- Server Actions para mutação; Route Handlers para webhook e jobs
- Zod em toda entrada, inclusive params de rota
- Datas em UTC no banco, America/Sao_Paulo na exibição
- Mensagens ao usuário em pt-BR
- src/domain/ é puro: não importa banco, rede nem SDK
- Testes antes do código em: pagamento, split, webhook, repasse, estoque
- Nomes de tabela e coluna em português (o domínio é em português);
  nomes de arquivo, função e variável em inglês

## Comandos
```
pnpm dev            # servidor de desenvolvimento
pnpm build          # build de produção
pnpm lint           # eslint
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest (unit + integração)
pnpm test:unit      # só unitários, sem banco
pnpm db:generate    # gera migration a partir do schema
pnpm db:migrate     # aplica migrations
pnpm db:push        # empurra schema direto (só dev)
pnpm db:studio      # drizzle studio
pnpm db:seed        # popula dados de desenvolvimento
```

## Como trabalhar
- Um domínio por sessão. PR pequeno.
- Antes de alterar a interface PaymentProvider, pergunte.
- Bug de dinheiro: escreva o teste de regressão antes da correção.
- Toda decisão de arquitetura vira uma entrada em `docs/decisoes.md`.
