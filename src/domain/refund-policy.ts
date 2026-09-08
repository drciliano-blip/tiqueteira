/**
 * Política de reembolso — benchmark, seções 2.1 a 2.3.
 *
 * Função pura, sem I/O. Aqui moram os prazos, e prazo errado em reembolso é
 * problema de consumidor, não bug de tela.
 *
 * As três regras que valem:
 *
 * 1. **Arrependimento legal** (CDC, art. 49): 7 dias corridos da compra,
 *    devolução integral, **taxa de conveniência incluída**. O mercado desconta
 *    a taxa; o entendimento do Procon-SP é que ela é serviço acessório à
 *    compra e cabe restituição integral. Devolver tudo custa pouco no volume
 *    real e elimina uma frente inteira de reclamação.
 *
 * 2. **Compra em cima da hora**: se, no momento da compra, faltavam 7 dias ou
 *    menos para o evento, o prazo não pode ir até depois da festa. O limite
 *    passa a ser 48 horas antes do início.
 *
 * 3. **Evento cancelado**: devolução integral sempre, independente de prazo.
 *    Quem não entregou o serviço foi o produtor.
 *
 * Fora dessas janelas, vale a política do evento — que hoje é não devolver.
 */
import { repartir } from '@/lib/money';
import type { Cents } from '@/lib/payments/types';

export type TipoReembolso =
  | 'arrependimento_legal'
  | 'politica_evento'
  | 'evento_cancelado'
  | 'chargeback'
  | 'outro';

export type ContextoReembolso = {
  compradoEm: Date;
  eventoInicio: Date;
  agora: Date;

  /** Janela de arrependimento, em dias corridos da compra. Padrão 7. */
  cancelamentoAteDiasCompra: number;
  /** Limite antes do início, quando a compra foi em cima da hora. Padrão 48. */
  cancelamentoAteHorasEvento: number;
  permiteReembolsoParcial: boolean;
  eventoCancelado: boolean;

  subtotalCentavos: Cents;
  convenienciaCentavos: Cents;
  totalCentavos: Cents;

  /** Quantos ingressos o pedido tem, e quantos se quer devolver. */
  ingressosNoPedido: number;
  ingressosParaReembolsar: number;
  /** Já devolvido antes, para não devolver duas vezes. */
  jaReembolsadoCentavos: Cents;
};

export type Decisao =
  | {
      permitido: true;
      tipo: TipoReembolso;
      valorCentavos: Cents;
      incluiConveniencia: boolean;
      explicacao: string;
    }
  | { permitido: false; explicacao: string };

const DIA = 24 * 60 * 60 * 1000;
const HORA = 60 * 60 * 1000;

/**
 * Até quando o comprador pode desistir.
 *
 * Devolve `null` quando a janela já passou no momento da compra — o que
 * acontece quando alguém compra a menos de 48h do evento. Nesse caso não há
 * arrependimento legal a exercer, e vale só a política do evento.
 */
export function prazoDeArrependimento(ctx: ContextoReembolso): Date | null {
  const setedias = new Date(ctx.compradoEm.getTime() + ctx.cancelamentoAteDiasCompra * DIA);
  const limiteEvento = new Date(
    ctx.eventoInicio.getTime() - ctx.cancelamentoAteHorasEvento * HORA,
  );

  // O menor dos dois: o prazo nunca passa da véspera do evento.
  const prazo = setedias < limiteEvento ? setedias : limiteEvento;

  return prazo > ctx.compradoEm ? prazo : null;
}

export function avaliarReembolso(ctx: ContextoReembolso): Decisao {
  if (ctx.ingressosParaReembolsar <= 0) {
    return { permitido: false, explicacao: 'Nenhum ingresso selecionado.' };
  }
  if (ctx.ingressosParaReembolsar > ctx.ingressosNoPedido) {
    return { permitido: false, explicacao: 'O pedido não tem tantos ingressos.' };
  }

  const parcial = ctx.ingressosParaReembolsar < ctx.ingressosNoPedido;

  if (parcial && !ctx.permiteReembolsoParcial && !ctx.eventoCancelado) {
    return {
      permitido: false,
      explicacao: 'Este evento não permite devolver parte do pedido.',
    };
  }

  const restante = ctx.totalCentavos - ctx.jaReembolsadoCentavos;
  if (restante <= 0) {
    return { permitido: false, explicacao: 'Este pedido já foi reembolsado por completo.' };
  }

  /**
   * Rateio por ingresso, com o resíduo distribuído — sem isso, devolver 1 de
   * 3 ingressos de um pedido de R$ 100 perderia um centavo em algum lugar.
   */
  const partes = repartir(
    ctx.totalCentavos,
    Array.from({ length: ctx.ingressosNoPedido }, () => 1),
  );
  const bruto = partes
    .slice(0, ctx.ingressosParaReembolsar)
    .reduce((a: number, b: number) => a + b, 0);

  const valorCentavos = Math.min(bruto, restante);

  // Evento cancelado devolve tudo, sempre. Prazo aqui não faz sentido: quem
  // deixou de entregar foi o produtor.
  if (ctx.eventoCancelado) {
    return {
      permitido: true,
      tipo: 'evento_cancelado',
      valorCentavos,
      incluiConveniencia: true,
      explicacao: 'Evento cancelado: devolução integral, taxa incluída.',
    };
  }

  const prazo = prazoDeArrependimento(ctx);

  if (prazo && ctx.agora <= prazo) {
    return {
      permitido: true,
      tipo: 'arrependimento_legal',
      valorCentavos,
      incluiConveniencia: true,
      explicacao: 'Dentro do prazo de arrependimento: devolução integral, taxa incluída.',
    };
  }

  /**
   * Fora do prazo legal, o evento manda. Hoje a política padrão é não
   * devolver — e a tela precisa dizer isso com clareza, porque sumir com o
   * botão sem explicar é o que gera reclamação.
   */
  if (ctx.agora > ctx.eventoInicio) {
    return { permitido: false, explicacao: 'O evento já aconteceu.' };
  }

  return {
    permitido: false,
    explicacao: prazo
      ? `O prazo para cancelar terminou em ${prazo.toLocaleDateString('pt-BR', {
          timeZone: 'America/Sao_Paulo',
        })}.`
      : 'A compra foi feita perto demais do evento para haver cancelamento.',
  };
}

/**
 * Reembolso decidido pelo produtor ou pelo suporte, fora da regra automática.
 *
 * Existe porque a vida acontece: erro de digitação no nome, cobrança em
 * duplicidade, cortesia mal emitida. Não passa pelos prazos, mas passa pelo
 * `audit_log` — quem autorizou fica registrado.
 */
export function reembolsoManual(
  ctx: Pick<
    ContextoReembolso,
    'totalCentavos' | 'jaReembolsadoCentavos' | 'ingressosNoPedido' | 'ingressosParaReembolsar'
  >,
): Decisao {
  const restante = ctx.totalCentavos - ctx.jaReembolsadoCentavos;
  if (restante <= 0) {
    return { permitido: false, explicacao: 'Este pedido já foi reembolsado por completo.' };
  }
  if (ctx.ingressosParaReembolsar <= 0 || ctx.ingressosParaReembolsar > ctx.ingressosNoPedido) {
    return { permitido: false, explicacao: 'Quantidade inválida.' };
  }

  const partes = repartir(
    ctx.totalCentavos,
    Array.from({ length: ctx.ingressosNoPedido }, () => 1),
  );
  const bruto = partes
    .slice(0, ctx.ingressosParaReembolsar)
    .reduce((a: number, b: number) => a + b, 0);

  return {
    permitido: true,
    tipo: 'outro',
    valorCentavos: Math.min(bruto, restante),
    incluiConveniencia: true,
    explicacao: 'Reembolso autorizado manualmente.',
  };
}
