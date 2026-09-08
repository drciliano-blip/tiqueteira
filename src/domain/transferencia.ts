/**
 * Regras de transferência de titularidade — plano, seção 23.3.
 *
 * Função pura. A mecânica é sempre a mesma: **cancela o ingresso original e
 * emite um novo**, com QR distinto. O print antigo morre no ato, e é isso que
 * faz a transferência funcionar de verdade — sem invalidar o anterior, ela
 * seria só um campo de nome mudando de valor.
 *
 * A regra inegociável está em `avisoDeReembolso`: se houver devolução depois,
 * o dinheiro volta para **quem pagou**, nunca para o titular atual. Sem isso,
 * a transferência vira mecanismo de fraude — bastaria transferir para si
 * mesmo e pedir reembolso.
 */

export type ConfiguracaoTransferencia = {
  permiteTransferencia: boolean;
  transferenciaAteHoras: number;
  maxTransferenciasPorIngresso: number;
  /** Meia-entrada transferida exigiria o novo titular comprovar o direito. */
  transferenciaPermiteMeia: boolean;
};

export type EstadoIngresso = {
  status: string;
  transferenciasCount: number;
  /** `inteira`, `meia`, `cortesia`, `pcd`, `idoso`. */
  tipo: string;
};

export type ContextoTransferencia = {
  configuracao: ConfiguracaoTransferencia;
  ingresso: EstadoIngresso;
  eventoInicio: Date;
  eventoStatus: string;
  agora: Date;
};

export type MotivoRecusa =
  | 'desativada'
  | 'ingresso_invalido'
  | 'ja_usado'
  | 'limite_atingido'
  | 'fora_do_prazo'
  | 'evento_encerrado'
  | 'meia_nao_transferivel';

export type Avaliacao =
  | { permitido: true; prazoFinal: Date; transferenciasRestantes: number }
  | { permitido: false; motivo: MotivoRecusa; explicacao: string };

const HORA = 60 * 60 * 1000;

export function prazoDeTransferencia(ctx: ContextoTransferencia): Date {
  return new Date(ctx.eventoInicio.getTime() - ctx.configuracao.transferenciaAteHoras * HORA);
}

export function avaliarTransferencia(ctx: ContextoTransferencia): Avaliacao {
  const { configuracao: cfg, ingresso } = ctx;

  if (!cfg.permiteTransferencia) {
    return {
      permitido: false,
      motivo: 'desativada',
      explicacao: 'O produtor deste evento não permite transferência de ingresso.',
    };
  }

  if (ctx.eventoStatus === 'cancelado' || ctx.eventoStatus === 'encerrado') {
    return {
      permitido: false,
      motivo: 'evento_encerrado',
      explicacao: 'Este evento não está mais ativo.',
    };
  }

  if (ingresso.status === 'usado') {
    return {
      permitido: false,
      motivo: 'ja_usado',
      explicacao: 'Este ingresso já foi usado na entrada.',
    };
  }

  if (ingresso.status !== 'valido') {
    return {
      permitido: false,
      motivo: 'ingresso_invalido',
      explicacao: 'Este ingresso não está mais válido.',
    };
  }

  /**
   * Meia-entrada e gratuidade não se transferem por padrão: o direito é da
   * pessoa, não do ingresso. Passar adiante sem comprovação transformaria a
   * cota legal em desconto negociável.
   */
  const beneficiado = ingresso.tipo === 'meia' || ingresso.tipo === 'pcd' || ingresso.tipo === 'idoso';
  if (beneficiado && !cfg.transferenciaPermiteMeia) {
    return {
      permitido: false,
      motivo: 'meia_nao_transferivel',
      explicacao:
        'Ingressos de meia-entrada e gratuidade não podem ser transferidos: o direito é de quem comprova, na entrada.',
    };
  }

  if (ingresso.transferenciasCount >= cfg.maxTransferenciasPorIngresso) {
    return {
      permitido: false,
      motivo: 'limite_atingido',
      explicacao:
        cfg.maxTransferenciasPorIngresso === 1
          ? 'Este ingresso já foi transferido uma vez, que é o limite deste evento.'
          : `Este ingresso já atingiu o limite de ${cfg.maxTransferenciasPorIngresso} transferências.`,
    };
  }

  const prazoFinal = prazoDeTransferencia(ctx);
  if (ctx.agora > prazoFinal) {
    return {
      permitido: false,
      motivo: 'fora_do_prazo',
      explicacao: `A transferência é permitida até ${cfg.transferenciaAteHoras}h antes do evento, e esse prazo já passou.`,
    };
  }

  return {
    permitido: true,
    prazoFinal,
    transferenciasRestantes: cfg.maxTransferenciasPorIngresso - ingresso.transferenciasCount,
  };
}

/**
 * O aviso que precisa aparecer ANTES de confirmar.
 *
 * Não é texto de rodapé: é a regra que impede a transferência de virar porta
 * de fraude, e o comprador tem de tomar a decisão sabendo disso.
 */
export const AVISO_DE_REEMBOLSO =
  'Se houver reembolso depois, o dinheiro volta para você, que pagou — nunca para quem recebeu o ingresso.';
