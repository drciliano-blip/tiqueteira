/**
 * Fila virtual — ADR-014.
 *
 * A regra de ouro deste arquivo: **a consulta da fila precisa ser barata**.
 * Vinte mil pessoas perguntando "já é minha vez?" a cada poucos segundos é
 * carga de sobra para derrubar exatamente o sistema que a fila protege. Por
 * isso a posição sai de uma marca d'água guardada na linha do evento —
 * comparar dois inteiros — e não de um `count` sobre a fila.
 *
 * O avanço da fila é oportunista: acontece dentro da própria consulta, mas no
 * máximo uma vez a cada poucos segundos por evento. Sem cron, sem job, sem
 * mais uma peça para dar errado às duas da manhã.
 */
import 'server-only';

import { randomBytes, createHash } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import { serviceDb, withTenant } from '@/db/client';
import { events, filaVirtual } from '@/db/schema';
import {
  intervaloDeConsultaSegundos,
  ritmoObservado,
  situacaoNaFila,
  type SituacaoFila,
} from '@/domain/fila';

/** De quanto em quanto tempo, no máximo, a fila anda. */
const INTERVALO_AVANCO_SEGUNDOS = 3;

export function novoTokenDeFila(): string {
  return randomBytes(32).toString('base64url');
}

function hash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export type EstadoDoEvento = {
  tenantId: string;
  filaAtiva: boolean;
  capacidade: number;
  janelaMinutos: number;
  ultimoNumero: number;
  chamadosAte: number;
  marcaAnterior: number;
  avancadaEm: Date | null;
};

export async function estadoDaFila(eventId: string): Promise<EstadoDoEvento | null> {
  const [e] = await serviceDb()
    .select({
      tenantId: events.tenantId,
      filaAtiva: events.filaAtiva,
      capacidade: events.filaCapacidade,
      janelaMinutos: events.filaJanelaMinutos,
      ultimoNumero: events.filaUltimoNumero,
      chamadosAte: events.filaChamadosAte,
      marcaAnterior: events.filaMarcaAnterior,
      avancadaEm: events.filaAvancadaEm,
    })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);

  return e ?? null;
}

/**
 * Faz a fila andar, se já passou tempo suficiente desde a última vez.
 *
 * Tudo num comando só, pelo mesmo motivo de sempre (ADR-013): o `UPDATE`
 * tranca a linha do evento, e essa linha é a mais disputada do evento inteiro
 * durante uma abertura. Cada ida ao banco com a tranca na mão é somada à
 * espera de toda a fila.
 *
 * A condição de tempo mora no `WHERE`: se duas requisições tentarem avançar
 * ao mesmo tempo, uma passa e a outra não encontra a linha — sem erro, sem
 * fila dupla, sem precisar de lock explícito.
 */
export async function avancarFila(eventId: string): Promise<void> {
  await serviceDb().execute(sql`
    with ocupando as (
      select count(*)::int as total
        from fila_virtual
       where event_id = ${eventId}
         and status = 'admitido'
         and expira_em > now()
    ),
    avanco as (
      update events e
         set fila_marca_anterior = e.fila_chamados_ate,
             fila_chamados_ate = least(
               e.fila_ultimo_numero,
               e.fila_chamados_ate + greatest(0, e.fila_capacidade - o.total)
             ),
             fila_avancada_em = now()
        from ocupando o
       where e.id = ${eventId}
         and e.fila_ativa
         and (
           e.fila_avancada_em is null
           or e.fila_avancada_em < now() - make_interval(secs => ${INTERVALO_AVANCO_SEGUNDOS})
         )
         and e.fila_chamados_ate < e.fila_ultimo_numero
      returning e.fila_chamados_ate, e.fila_janela_minutos
    )
    update fila_virtual f
       set status = 'admitido',
           admitido_em = now(),
           expira_em = now() + make_interval(mins => a.fila_janela_minutos)
      from avanco a
     where f.event_id = ${eventId}
       and f.status = 'aguardando'
       and f.numero <= a.fila_chamados_ate
  `);
}

export type Lugar = {
  token: string;
  numero: number;
};

/**
 * Entra na fila e recebe um número.
 *
 * Um comando só: o contador do evento sobe e a linha da fila nasce junto. É a
 * operação mais disputada de uma abertura de vendas — 20 mil pessoas passam
 * por aqui em poucos minutos, todas mexendo na mesma linha do evento.
 */
export async function entrarNaFila(
  eventId: string,
  tenantId: string,
): Promise<Lugar | null> {
  const token = novoTokenDeFila();

  const linhas = (await withTenant(tenantId, (tx) =>
    tx.execute(sql`
      with numerado as (
        update events
           set fila_ultimo_numero = fila_ultimo_numero + 1
         where id = ${eventId} and fila_ativa
        returning fila_ultimo_numero as numero
      )
      insert into fila_virtual (tenant_id, event_id, token_hash, numero)
      select ${tenantId}, ${eventId}, ${hash(token)}, numero from numerado
      returning numero
    `),
  )) as unknown as { numero: number }[];

  const linha = linhas[0];
  return linha ? { token, numero: Number(linha.numero) } : null;
}

export type ConsultaFila =
  | { situacao: 'sem_fila' }
  | { situacao: 'sem_lugar' }
  | { situacao: 'admitido'; expiraEm: Date | null }
  | {
      situacao: 'aguardando';
      numero: number;
      pessoasNaFrente: number;
      esperaMinutos: number | null;
      proximaConsultaSegundos: number;
    };

/**
 * Onde a pessoa está agora.
 *
 * Duas leituras baratas e, no máximo a cada poucos segundos, um avanço. Nada
 * aqui percorre a fila inteira.
 */
export async function consultarFila(
  eventId: string,
  token: string | undefined,
): Promise<ConsultaFila> {
  const estado = await estadoDaFila(eventId);
  if (!estado || !estado.filaAtiva) return { situacao: 'sem_fila' };
  if (!token) return { situacao: 'sem_lugar' };

  await avancarFila(eventId);

  const depois = (await estadoDaFila(eventId)) ?? estado;

  const [lugar] = await withTenant(depois.tenantId, (tx) =>
    tx
      .select({
        numero: filaVirtual.numero,
        status: filaVirtual.status,
        expiraEm: filaVirtual.expiraEm,
      })
      .from(filaVirtual)
      .where(and(eq(filaVirtual.tokenHash, hash(token)), eq(filaVirtual.eventId, eventId)))
      .limit(1),
  );

  if (!lugar) return { situacao: 'sem_lugar' };

  /**
   * A janela de quem foi chamado pode ter vencido. Nesse caso a pessoa perdeu
   * a vez e volta para o fim — é duro, mas a alternativa é a vaga ficar presa
   * a quem abandonou a aba, e aí a fila para de andar para todo mundo.
   */
  if (lugar.status === 'admitido' && lugar.expiraEm && lugar.expiraEm <= new Date()) {
    return { situacao: 'sem_lugar' };
  }

  const situacao: SituacaoFila = situacaoNaFila(
    { numero: Number(lugar.numero), chamadosAte: depois.chamadosAte },
    depois.avancadaEm
      ? ritmoObservado({
          chamadosAte: depois.chamadosAte,
          marcaAnterior: depois.marcaAnterior,
          segundosDesdeAnterior: Math.max(
            1,
            (Date.now() - depois.avancadaEm.getTime()) / 1000,
          ),
        })
      : null,
  );

  if (situacao.situacao === 'admitido') {
    return { situacao: 'admitido', expiraEm: lugar.expiraEm };
  }

  return {
    situacao: 'aguardando',
    numero: Number(lugar.numero),
    pessoasNaFrente: situacao.pessoasNaFrente,
    esperaMinutos: situacao.esperaMinutos,
    proximaConsultaSegundos: intervaloDeConsultaSegundos(situacao.pessoasNaFrente),
  };
}

/**
 * A pessoa tem vez agora?
 *
 * Usado como porteiro da compra. Fila desligada devolve `true`: nenhum evento
 * pequeno paga o preço de uma peça que existe para festival.
 */
export async function temVez(eventId: string, token: string | undefined): Promise<boolean> {
  const estado = await estadoDaFila(eventId);
  if (!estado || !estado.filaAtiva) return true;
  if (!token) return false;

  const [lugar] = await withTenant(estado.tenantId, (tx) =>
    tx
      .select({ status: filaVirtual.status, expiraEm: filaVirtual.expiraEm })
      .from(filaVirtual)
      .where(and(eq(filaVirtual.tokenHash, hash(token)), eq(filaVirtual.eventId, eventId)))
      .limit(1),
  );

  if (!lugar || lugar.status !== 'admitido') return false;
  return !lugar.expiraEm || lugar.expiraEm > new Date();
}

/**
 * Consome a vez ao criar o pedido.
 *
 * A vez morre no uso: sem isso, quem foi chamado uma vez compraria a noite
 * inteira sem voltar para a fila — que é precisamente o cambista com script
 * que a fila existe para atrapalhar.
 */
export async function consumirVez(
  eventId: string,
  tenantId: string,
  token: string | undefined,
): Promise<void> {
  if (!token) return;

  await withTenant(tenantId, (tx) =>
    tx.execute(sql`
      update fila_virtual
         set status = 'expirado', expira_em = now()
       where event_id = ${eventId} and token_hash = ${hash(token)} and status = 'admitido'
    `),
  );
}

/** Nome do cookie da vez. Um por evento: cada fila é a sua. */
export function cookieDaFila(eventId: string): string {
  return `fila_${eventId.replaceAll('-', '')}`;
}
