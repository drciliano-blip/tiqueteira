/**
 * Sincronização das passagens feitas offline — plano, seção 12, e ADR-011.
 *
 * O que sobe daqui é o **livro da porta**, não o estado do ingresso: cada
 * linha é "este QR passou neste sentido nesta hora". O estado corrente é
 * recalculado a partir do livro depois da inserção.
 *
 * Essa inversão é o que faz a sincronização tolerar o mundo real. Dois
 * aparelhos sobem em ordens diferentes, um deles fica três horas sem rede e
 * sobe a noite inteira de uma vez, a aba é recarregada e a fila é reenviada:
 * em todos os casos o resultado final é o mesmo, porque o livro é ordenado
 * por quando o fato aconteceu, não por quando chegou.
 *
 * **O lote inteiro vira dois comandos, não dois por movimento.** Um aparelho
 * que passou a noite offline sobe centenas de passagens de uma vez; com uma
 * ida ao banco por movimento, essa subida levaria minutos e seguraria a
 * conexão o tempo todo — justamente quando os outros portões precisam dela.
 * Aqui o custo é praticamente o mesmo para um movimento ou para quinhentos.
 *
 * A idempotência vem da chave natural (ingresso, tipo, hora) com
 * `on conflict do nothing`. Sem ela, reenviar a fila inflaria o contador —
 * e o contador é exatamente o número que o produtor confere no dia seguinte.
 *
 * O limite continua honesto: offline, dois portões sem comunicação deixam o
 * mesmo QR passar duas vezes. Nada resolve isso do lado do aparelho. O que a
 * sincronização dá é o registro de que aconteceu, para a operação saber.
 */
import 'server-only';

import { sql } from 'drizzle-orm';

import { withTenant } from '@/db/client';
import type { Movimento } from '@/domain/portaria';

export type MovimentoOffline = {
  tokenHash: string;
  tipo: Movimento;
  em: string;
  deviceId?: string | undefined;
};

export type ResumoSincronizacao = {
  /** Passagens novas, efetivamente gravadas. */
  processadas: number;
  /** Já tinham subido antes: reenvio da fila, ou outro portão. */
  duplicados: number;
  /** QR que não pertence a este evento. */
  invalidos: number;
};

export async function sincronizarMovimentos(
  ctx: { tenantId: string; eventId: string; userId: string },
  movimentos: readonly MovimentoOffline[],
): Promise<ResumoSincronizacao> {
  if (movimentos.length === 0) return { processadas: 0, duplicados: 0, invalidos: 0 };

  const lote = JSON.stringify(
    movimentos.map((m) => ({
      token_hash: m.tokenHash,
      tipo: m.tipo,
      em: m.em,
      device_id: m.deviceId ?? null,
    })),
  );

  return withTenant(ctx.tenantId, async (tx) => {
    /**
     * Comando 1: resolve os ingressos e grava o livro, tudo de uma vez.
     *
     * `on conflict do nothing` faz a distinção que importa: o que voltou de
     * `inserido` é passagem nova; o que estava em `resolvido` e não voltou já
     * tinha subido antes.
     */
    const contagens = (await tx.execute(sql`
      with recebido as (
        select *
          from jsonb_to_recordset(${lote}::jsonb)
            as x(token_hash text, tipo text, em timestamptz, device_id text)
      ),
      resolvido as (
        select t.id as ticket_id, r.tipo::movimento_tipo as tipo, r.em, r.device_id
          from recebido r
          join tickets t
            on t.token_hash = r.token_hash
           and t.event_id = ${ctx.eventId}
      ),
      inserido as (
        insert into ticket_movimentos
          (tenant_id, event_id, ticket_id, tipo, em, operador_id, device_id, origem)
        select ${ctx.tenantId}, ${ctx.eventId}, ticket_id, tipo, em,
               ${ctx.userId}, device_id, 'offline'
          from resolvido
        on conflict do nothing
        returning ticket_id
      )
      select
        (select count(*) from recebido)  as recebidos,
        (select count(*) from resolvido) as resolvidos,
        (select count(*) from inserido)  as inseridos
    `)) as unknown as { recebidos: number; resolvidos: number; inseridos: number }[];

    const c = contagens[0]!;
    const inseridos = Number(c.inseridos);

    /**
     * Comando 2: reconstrói o estado dos ingressos tocados a partir do livro
     * inteiro de cada um — e não incrementando o que chegou. É o que faz a
     * chegada fora de ordem convergir: quem manda é o movimento mais recente
     * pelo horário do FATO, não pelo horário da subida.
     */
    if (inseridos > 0) {
      await tx.execute(sql`
        update tickets t
           set entradas_count    = m.entradas,
               ultima_entrada_em = m.ultima_entrada,
               ultima_saida_em   = m.ultima_saida,
               checked_in_em     = least(coalesce(t.checked_in_em, m.primeira_entrada),
                                         m.primeira_entrada),
               checked_in_by     = coalesce(t.checked_in_by, ${ctx.userId}),
               status = case when m.entradas > 0 and t.status = 'valido' then 'usado'
                             else t.status end,
               dentro = (m.ultimo_tipo = 'entrada') and m.entradas > 0,
               atualizado_em = now()
          from (
            select ticket_id,
                   count(*) filter (where tipo = 'entrada')              as entradas,
                   max(em)  filter (where tipo = 'entrada')              as ultima_entrada,
                   min(em)  filter (where tipo = 'entrada')              as primeira_entrada,
                   max(em)  filter (where tipo = 'saida')                as ultima_saida,
                   (array_agg(tipo order by em desc, criado_em desc))[1] as ultimo_tipo
              from ticket_movimentos
             where ticket_id in (
                     select tk.id
                       from tickets tk
                       join jsonb_to_recordset(${lote}::jsonb) as x(token_hash text)
                         on tk.token_hash = x.token_hash
                      where tk.event_id = ${ctx.eventId}
                   )
             group by ticket_id
          ) m
         where t.id = m.ticket_id
      `);
    }

    return {
      processadas: inseridos,
      duplicados: Number(c.resolvidos) - inseridos,
      invalidos: Number(c.recebidos) - Number(c.resolvidos),
    };
  });
}
