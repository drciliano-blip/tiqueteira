/**
 * Cupons — plano, seção 7.
 *
 * O consumo do uso é um `UPDATE` condicional, pelo mesmo motivo do estoque:
 * um cupom de cem usos precisa parar em cem, e cem pessoas clicando ao mesmo
 * tempo é exatamente o cenário em que ler-para-depois-decidir passa de cem.
 * A diferença aqui é que o furo não some no relatório — ele aparece como
 * desconto que o produtor não autorizou.
 */
import 'server-only';

import { and, asc, eq, sql } from 'drizzle-orm';

import type { Database } from '@/db/client';
import { withTenant } from '@/db/client';
import { coupons } from '@/db/schema';
import {
  avaliarCupom,
  descontoDoCupom,
  normalizarCodigo,
  type EstadoCupom,
  type MotivoRecusaCupom,
} from '@/domain/cupom';

/** Aceita a conexão ou a transação em curso, como em `src/lib/inventory.ts`. */
type Executor = Pick<Database, 'execute'>;

export type CupomAplicado = {
  cupomId: string;
  codigo: string;
  descontoCentavos: number;
};

export type ResultadoCupom =
  | { ok: true; cupom: CupomAplicado }
  | { ok: false; motivo: MotivoRecusaCupom | 'inexistente'; explicacao: string };

const RECUSA = 'Cupom inválido ou expirado.';

/**
 * Confere o cupom **sem** consumir uso.
 *
 * Serve para a tela mostrar o desconto antes de o comprador decidir. Quem
 * consome é `consumirCupom`, na mesma transação do pedido — entre uma coisa e
 * outra o cupom pode esgotar, e é isso que o `UPDATE` condicional resolve.
 */
export async function conferirCupom(params: {
  tenantId: string;
  eventId: string;
  codigo: string;
  subtotalCentavos: number;
}): Promise<ResultadoCupom> {
  const codigo = normalizarCodigo(params.codigo);
  if (codigo.length === 0) {
    return { ok: false, motivo: 'inexistente', explicacao: RECUSA };
  }

  return withTenant(params.tenantId, async (tx) => {
    const [linha] = await tx
      .select({
        id: coupons.id,
        codigo: coupons.codigo,
        tipo: coupons.tipo,
        valor: coupons.valor,
        ativo: coupons.ativo,
        validoAte: coupons.validoAte,
        usosMaximos: coupons.usosMaximos,
        usosAtuais: coupons.usosAtuais,
        eventId: coupons.eventId,
      })
      .from(coupons)
      .where(and(eq(coupons.tenantId, params.tenantId), sql`upper(${coupons.codigo}) = ${codigo}`))
      .limit(1);

    if (!linha) return { ok: false as const, motivo: 'inexistente' as const, explicacao: RECUSA };

    const estado: EstadoCupom = {
      tipo: linha.tipo,
      valor: linha.valor,
      ativo: linha.ativo,
      validoAte: linha.validoAte,
      usosMaximos: linha.usosMaximos,
      usosAtuais: linha.usosAtuais,
      eventId: linha.eventId,
    };

    const avaliacao = avaliarCupom({ cupom: estado, eventId: params.eventId, agora: new Date() });
    if (!avaliacao.valido) {
      return { ok: false as const, motivo: avaliacao.motivo, explicacao: avaliacao.explicacao };
    }

    return {
      ok: true as const,
      cupom: {
        cupomId: linha.id,
        codigo: linha.codigo,
        descontoCentavos: descontoDoCupom(estado, params.subtotalCentavos),
      },
    };
  });
}

/**
 * Consome um uso, dentro da transação do pedido.
 *
 * Todas as condições moram no `WHERE`: se a linha não voltar, o cupom não
 * valia mais no instante do commit — esgotou, venceu ou foi desativado
 * enquanto o comprador escolhia. Ler antes e decidir depois deixaria passar
 * o centésimo primeiro uso de um cupom de cem.
 */
export async function consumirCupom(
  exec: Executor,
  params: { tenantId: string; eventId: string; codigo: string; subtotalCentavos: number },
): Promise<ResultadoCupom> {
  const codigo = normalizarCodigo(params.codigo);
  if (codigo.length === 0) {
    return { ok: false, motivo: 'inexistente', explicacao: RECUSA };
  }

  const linhas = (await exec.execute(sql`
    update coupons
       set usos_atuais = usos_atuais + 1, atualizado_em = now()
     where tenant_id = ${params.tenantId}
       and upper(codigo) = ${codigo}
       and ativo = true
       and (event_id is null or event_id = ${params.eventId})
       and (valido_ate is null or valido_ate > now())
       and (usos_maximos is null or usos_atuais < usos_maximos)
    returning id, codigo, tipo, valor
  `)) as unknown as {
    id: string;
    codigo: string;
    tipo: 'pct' | 'valor';
    valor: number;
  }[];

  const linha = linhas[0];
  if (!linha) return { ok: false, motivo: 'inexistente', explicacao: RECUSA };

  return {
    ok: true,
    cupom: {
      cupomId: linha.id,
      codigo: linha.codigo,
      descontoCentavos: descontoDoCupom(
        {
          tipo: linha.tipo,
          valor: linha.valor,
          ativo: true,
          validoAte: null,
          usosMaximos: null,
          usosAtuais: 0,
          eventId: null,
        },
        params.subtotalCentavos,
      ),
    },
  };
}

/**
 * Devolve o uso de um cupom.
 *
 * Chamado quando a reserva expira sem pagamento. Sem isso, um cupom de cem
 * usos se esgotaria com carrinhos abandonados — e o produtor descobriria na
 * noite do evento, quando o desconto que ele prometeu parou de funcionar.
 */
export async function devolverCupom(exec: Executor, cupomId: string): Promise<void> {
  await exec.execute(sql`
    update coupons
       set usos_atuais = greatest(0, usos_atuais - 1), atualizado_em = now()
     where id = ${cupomId}
  `);
}

// ---------------------------------------------------------------------------
// Painel do produtor
// ---------------------------------------------------------------------------

export type CupomDoPainel = {
  id: string;
  codigo: string;
  tipo: 'pct' | 'valor';
  valor: number;
  usosMaximos: number | null;
  usosAtuais: number;
  validoAte: Date | null;
  ativo: boolean;
  eventId: string | null;
};

export async function cuponsDoTenant(
  tenantId: string,
  eventId?: string,
): Promise<CupomDoPainel[]> {
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: coupons.id,
        codigo: coupons.codigo,
        tipo: coupons.tipo,
        valor: coupons.valor,
        usosMaximos: coupons.usosMaximos,
        usosAtuais: coupons.usosAtuais,
        validoAte: coupons.validoAte,
        ativo: coupons.ativo,
        eventId: coupons.eventId,
      })
      .from(coupons)
      .where(
        eventId
          ? and(
              eq(coupons.tenantId, tenantId),
              sql`(${coupons.eventId} is null or ${coupons.eventId} = ${eventId})`,
            )
          : eq(coupons.tenantId, tenantId),
      )
      .orderBy(asc(coupons.codigo)),
  );
}

export async function criarCupom(params: {
  tenantId: string;
  eventId: string | null;
  codigo: string;
  tipo: 'pct' | 'valor';
  valor: number;
  usosMaximos: number | null;
  validoAte: Date | null;
}): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  const codigo = normalizarCodigo(params.codigo);
  if (codigo.length < 3) return { ok: false, erro: 'O código precisa de ao menos 3 caracteres.' };

  try {
    const id = await withTenant(params.tenantId, async (tx) => {
      const [criado] = await tx
        .insert(coupons)
        .values({
          tenantId: params.tenantId,
          eventId: params.eventId,
          codigo,
          tipo: params.tipo,
          valor: params.valor,
          usosMaximos: params.usosMaximos,
          validoAte: params.validoAte,
        })
        .returning({ id: coupons.id });

      return criado!.id;
    });

    return { ok: true, id };
  } catch {
    // A unique é por produtor: o mesmo código pode existir em outra casa.
    return { ok: false, erro: 'Já existe um cupom com esse código.' };
  }
}

export async function alternarCupom(
  tenantId: string,
  cupomId: string,
  ativo: boolean,
): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx
      .update(coupons)
      .set({ ativo, atualizadoEm: new Date() })
      .where(and(eq(coupons.id, cupomId), eq(coupons.tenantId, tenantId))),
  );
}
