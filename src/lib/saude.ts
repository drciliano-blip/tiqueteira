/**
 * Saúde da operação — plano, seção 17.
 *
 * Os alertas obrigatórios do plano, medidos de verdade:
 *
 * - webhook com assinatura inválida
 * - job falhando três vezes
 * - pedido aguardando pagamento há mais de 24h (webhook perdido)
 * - divergência entre a soma dos splits e o total
 * - repasse falhando
 *
 * Sem esta tela, uma falha de madrugada só aparece quando o produtor liga
 * perguntando do dinheiro dele.
 */
import 'server-only';

import { desc, gte, sql } from 'drizzle-orm';

import { serviceDb } from '@/db/client';
import { jobs, orders, payouts, webhookEvents } from '@/db/schema';

export type Gravidade = 'ok' | 'atencao' | 'critico';

export type Sinal = {
  chave: string;
  titulo: string;
  valor: number;
  gravidade: Gravidade;
  /** O que fazer quando o número não é zero. */
  acao: string;
};

export type Saude = {
  sinais: Sinal[];
  ultimosWebhooks: {
    id: string;
    tipo: string;
    assinaturaValida: boolean;
    recebidoEm: Date;
    processadoEm: Date | null;
    erro: string | null;
  }[];
  filaTravada: {
    id: string;
    nome: string;
    tentativas: number;
    ultimoErro: string | null;
    proximaTentativaEm: Date;
  }[];
};

export async function medirSaude(): Promise<Saude> {
  const db = serviceDb();

  const [webhook] = await db
    .select({
      invalidos: sql<number>`count(*) filter (where ${webhookEvents.assinaturaValida} = false)`,
      naoProcessados: sql<number>`count(*) filter (
        where ${webhookEvents.assinaturaValida} = true
          and ${webhookEvents.processadoEm} is null
      )`,
    })
    .from(webhookEvents)
    .where(gte(webhookEvents.recebidoEm, sql`now() - interval '24 hours'`));

  const [fila] = await db
    .select({
      falhando: sql<number>`count(*) filter (where ${jobs.status} = 'failed')`,
      mortos: sql<number>`count(*) filter (where ${jobs.status} = 'dead')`,
      presos: sql<number>`count(*) filter (
        where ${jobs.status} = 'running'
          and ${jobs.criadoEm} < now() - interval '15 minutes'
      )`,
    })
    .from(jobs);

  const [pedidos] = await db
    .select({
      orfaos: sql<number>`count(*) filter (
        where ${orders.status} = 'awaiting_payment'
          and ${orders.criadoEm} < now() - interval '24 hours'
      )`,
      /**
       * Invariante de dinheiro: a soma das parcelas tem de bater com o total.
       * O CHECK do banco já impede gravar errado; esta contagem existe para o
       * caso de alguém desabilitar a restrição numa migration futura.
       */
      splitQuebrado: sql<number>`count(*) filter (
        where ${orders.valorProdutorCentavos} + ${orders.valorOperadorCentavos}
              <> ${orders.totalCentavos}
      )`,
      pagosSemIngresso: sql<number>`count(*) filter (
        where ${orders.status} = 'paid'
          and not exists (select 1 from tickets t where t.order_id = ${orders.id})
      )`,
    })
    .from(orders);

  const [repasse] = await db
    .select({ falhando: sql<number>`count(*) filter (where ${payouts.status} = 'failed')` })
    .from(payouts);

  const n = (v: unknown) => Number(v ?? 0);

  const sinais: Sinal[] = [
    {
      chave: 'webhook_invalido',
      titulo: 'Webhooks com assinatura inválida (24h)',
      valor: n(webhook?.invalidos),
      gravidade: n(webhook?.invalidos) > 0 ? 'critico' : 'ok',
      acao: 'Confira se o segredo do webhook mudou na PSP. Se não mudou, é sondagem externa.',
    },
    {
      chave: 'webhook_pendente',
      titulo: 'Webhooks recebidos e não processados',
      valor: n(webhook?.naoProcessados),
      gravidade: n(webhook?.naoProcessados) > 0 ? 'atencao' : 'ok',
      acao: 'Veja o erro no registro. A operadora reentrega sozinha em caso de 500.',
    },
    {
      chave: 'pedidos_orfaos',
      titulo: 'Pedidos aguardando pagamento há mais de 24h',
      valor: n(pedidos?.orfaos),
      gravidade: n(pedidos?.orfaos) > 0 ? 'atencao' : 'ok',
      acao: 'Provável webhook perdido. Consulte a transação na PSP e concilie.',
    },
    {
      chave: 'pago_sem_ingresso',
      titulo: 'Pedidos pagos sem ingresso emitido',
      valor: n(pedidos?.pagosSemIngresso),
      gravidade: n(pedidos?.pagosSemIngresso) > 0 ? 'atencao' : 'ok',
      acao: 'Pix pago após a expiração. A devolução automática roda a cada 5 minutos.',
    },
    {
      chave: 'split_quebrado',
      titulo: 'Pedidos com split que não fecha',
      valor: n(pedidos?.splitQuebrado),
      gravidade: n(pedidos?.splitQuebrado) > 0 ? 'critico' : 'ok',
      acao: 'Pare as vendas e investigue: dinheiro está sendo calculado errado.',
    },
    {
      chave: 'jobs_mortos',
      titulo: 'Tarefas que esgotaram as tentativas',
      valor: n(fila?.mortos),
      gravidade: n(fila?.mortos) > 0 ? 'critico' : 'ok',
      acao: 'Ninguém vai tentar de novo sozinho. Corrija a causa e reenfileire.',
    },
    {
      chave: 'jobs_falhando',
      titulo: 'Tarefas em retentativa',
      valor: n(fila?.falhando),
      gravidade: n(fila?.falhando) > 2 ? 'atencao' : 'ok',
      acao: 'Acompanhe. Se não zerar sozinho em uma hora, algo está quebrado.',
    },
    {
      chave: 'jobs_presos',
      titulo: 'Tarefas presas em execução',
      valor: n(fila?.presos),
      gravidade: n(fila?.presos) > 0 ? 'atencao' : 'ok',
      acao: 'O processo morreu no meio. Elas voltam para a fila na próxima rodada.',
    },
    {
      chave: 'repasse_falhando',
      titulo: 'Repasses com falha',
      valor: n(repasse?.falhando),
      gravidade: n(repasse?.falhando) > 0 ? 'critico' : 'ok',
      acao: 'O produtor não recebeu. É o tipo de problema que ele descobre antes de nós.',
    },
  ];

  const ultimosWebhooks = await db
    .select({
      id: webhookEvents.id,
      tipo: webhookEvents.tipo,
      assinaturaValida: webhookEvents.assinaturaValida,
      recebidoEm: webhookEvents.recebidoEm,
      processadoEm: webhookEvents.processadoEm,
      erro: webhookEvents.erro,
    })
    .from(webhookEvents)
    .orderBy(desc(webhookEvents.recebidoEm))
    .limit(15);

  const filaTravada = await db
    .select({
      id: jobs.id,
      nome: jobs.nome,
      tentativas: jobs.tentativas,
      ultimoErro: jobs.ultimoErro,
      proximaTentativaEm: jobs.proximaTentativaEm,
    })
    .from(jobs)
    .where(sql`${jobs.status} in ('failed', 'dead')`)
    .orderBy(desc(jobs.criadoEm))
    .limit(15);

  return { sinais, ultimosWebhooks, filaTravada };
}
