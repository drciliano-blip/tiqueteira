/**
 * Fila de tarefas — plano, seção 5.
 *
 * Serverless tem tempo limite, e a operadora reentrega o webhook se a resposta
 * demorar. Então nada de trabalho pesado dentro do handler: o webhook grava a
 * tarefa e responde 200 em milissegundos; quem envia e-mail é o worker.
 *
 * A fila é uma tabela do próprio banco, não um serviço externo. Para o volume
 * de uma casa noturna isso basta, e tem uma vantagem que serviço externo não
 * dá: a tarefa entra na MESMA transação que confirmou o pagamento. Ou os dois
 * acontecem, ou nenhum — não existe pedido pago sem e-mail enfileirado.
 */
import 'server-only';

import { and, eq, lte, or, sql } from 'drizzle-orm';

import { serviceDb, type Database } from '@/db/client';
import { jobs } from '@/db/schema';

export type NomeJob =
  | 'enviar-ingressos'
  | 'expirar-reservas'
  | 'reembolso-automatico'
  | 'pagamento-atrasado';

export type EnfileirarInput = {
  nome: NomeJob;
  payload?: Record<string, unknown>;
  tenantId?: string | null;
  /** Deduplica: a mesma tarefa não entra duas vezes na fila. */
  dedupeKey?: string;
  atrasoSegundos?: number;
};

export async function enfileirar(
  exec: Pick<Database, 'insert'>,
  input: EnfileirarInput,
): Promise<void> {
  await exec
    .insert(jobs)
    .values({
      nome: input.nome,
      tenantId: input.tenantId ?? null,
      payload: input.payload ?? {},
      dedupeKey: input.dedupeKey ?? null,
      proximaTentativaEm: new Date(Date.now() + (input.atrasoSegundos ?? 0) * 1000),
    })
    .onConflictDoNothing();
}

export type JobPendente = {
  id: string;
  nome: string;
  payload: Record<string, unknown>;
  tentativas: number;
  maxTentativas: number;
};

/**
 * Pega tarefas para processar.
 *
 * `for update skip locked` é o que permite mais de um worker rodando ao mesmo
 * tempo sem que dois peguem a mesma tarefa — e sem que um fique esperando o
 * outro. Sem isso, dois cron simultâneos enviariam o ingresso em duplicidade.
 */
export async function reservarJobs(nome: NomeJob, limite = 20): Promise<JobPendente[]> {
  const db = serviceDb();

  const linhas = (await db.execute(sql`
    with proximos as (
      select id from jobs
       where nome = ${nome}
         and status in ('pending', 'failed')
         and proxima_tentativa_em <= now()
         and tentativas < max_tentativas
       order by proxima_tentativa_em
       limit ${limite}
       for update skip locked
    )
    update jobs j
       set status = 'running', tentativas = j.tentativas + 1
      from proximos p
     where j.id = p.id
    returning j.id, j.nome, j.payload, j.tentativas, j.max_tentativas
  `)) as unknown as {
    id: string;
    nome: string;
    payload: Record<string, unknown>;
    tentativas: number;
    max_tentativas: number;
  }[];

  return linhas.map((l) => ({
    id: l.id,
    nome: l.nome,
    payload: l.payload ?? {},
    tentativas: l.tentativas,
    maxTentativas: l.max_tentativas,
  }));
}

export async function concluirJob(id: string): Promise<void> {
  await serviceDb()
    .update(jobs)
    .set({ status: 'succeeded', concluidoEm: new Date(), ultimoErro: null })
    .where(eq(jobs.id, id));
}

/**
 * Marca falha e agenda a retentativa com espera crescente: 1min, 2, 4, 8, 16.
 * Esgotadas as tentativas, vira `dead` — e aí precisa de gente olhando, não de
 * mais uma tentativa automática.
 */
export async function falharJob(id: string, erro: string, tentativas: number): Promise<void> {
  const esperaMinutos = Math.min(2 ** Math.max(0, tentativas - 1), 30);

  await serviceDb()
    .update(jobs)
    .set({
      status: sql`case when ${jobs.tentativas} >= ${jobs.maxTentativas} then 'dead'::job_status else 'failed'::job_status end`,
      ultimoErro: erro.slice(0, 2000),
      proximaTentativaEm: new Date(Date.now() + esperaMinutos * 60_000),
    })
    .where(eq(jobs.id, id));
}

/** Para o painel de saúde: o que está travado merece alerta. */
export async function resumoDaFila(): Promise<{
  pendentes: number;
  falhando: number;
  mortos: number;
}> {
  const [linha] = await serviceDb()
    .select({
      pendentes: sql<number>`count(*) filter (where ${jobs.status} = 'pending')`,
      falhando: sql<number>`count(*) filter (where ${jobs.status} = 'failed')`,
      mortos: sql<number>`count(*) filter (where ${jobs.status} = 'dead')`,
    })
    .from(jobs)
    .where(
      or(
        eq(jobs.status, 'pending'),
        eq(jobs.status, 'failed'),
        eq(jobs.status, 'dead'),
        and(eq(jobs.status, 'running'), lte(jobs.proximaTentativaEm, new Date())),
      ),
    );

  return {
    pendentes: Number(linha?.pendentes ?? 0),
    falhando: Number(linha?.falhando ?? 0),
    mortos: Number(linha?.mortos ?? 0),
  };
}
