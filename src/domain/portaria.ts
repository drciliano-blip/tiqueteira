/**
 * Máquina de estado da porta — plano, seções 12 e 24, e ADR-011.
 *
 * Função pura: decide se um QR lido pode entrar, sair, ou é recusado — e, na
 * recusa, **por quê, com hora e nome**. Essa distinção não é preciosismo. Na
 * porta a discussão nunca é "pode ou não pode": é "eu não entrei ainda" com
 * uma fila de trinta pessoas atrás. Quem resolve isso é a frase que a tela
 * mostra ao segurança, não o booleano.
 *
 * A regra que sustenta o resto: **quem está dentro não entra de novo**. Sem
 * ela, controlar saída viraria a brecha que o controle de entrada existe para
 * fechar — bastaria uma pessoa marcar saída para o mesmo QR liberar outra.
 */
import { hora } from '@/lib/datas';

export type Movimento = 'entrada' | 'saida';

export type PoliticaPortaria = {
  /** A portaria registra saída? Desligado, o evento se comporta como antes. */
  controlaSaida: boolean;
  /** Quem saiu pode voltar com o mesmo ingresso? */
  permiteReentrada: boolean;
};

export type EstadoNaPorta = {
  /** `valido`, `usado`, `cancelado` ou `transferido`. */
  status: string;
  /** Está na casa agora. */
  dentro: boolean;
  entradasCount: number;
  ultimaEntradaEm: Date | null;
  ultimaSaidaEm: Date | null;
};

export type ContextoPorta = {
  movimento: Movimento;
  estado: EstadoNaPorta;
  politica: PoliticaPortaria;
};

export type MotivoRecusaPorta =
  | 'cancelado'
  | 'transferido'
  | 'ja_entrou'
  | 'nao_esta_dentro'
  | 'reentrada_bloqueada'
  | 'saida_nao_controlada';

export type DecisaoPorta =
  | { permitido: true; movimento: Movimento; reentrada: boolean }
  | { permitido: false; motivo: MotivoRecusaPorta; explicacao: string };

function recusa(motivo: MotivoRecusaPorta, explicacao: string): DecisaoPorta {
  return { permitido: false, motivo, explicacao };
}

export function avaliarMovimento(ctx: ContextoPorta): DecisaoPorta {
  const { estado, politica } = ctx;

  /**
   * Sair é sempre permitido a quem está dentro, inclusive com ingresso
   * cancelado no meio da festa. Reembolso ou chargeback às 23h não podem
   * prender ninguém lá dentro, e um contador que nunca zera é pior que um
   * contador com uma saída a mais.
   */
  if (ctx.movimento === 'saida') {
    if (!politica.controlaSaida) {
      return recusa(
        'saida_nao_controlada',
        'Este evento não registra saída. Ligue o controle de saída no cadastro do evento.',
      );
    }

    if (!estado.dentro) {
      return recusa(
        'nao_esta_dentro',
        estado.ultimaSaidaEm
          ? `Esta pessoa já saiu às ${hora(estado.ultimaSaidaEm)}.`
          : 'Esta pessoa não consta como tendo entrado.',
      );
    }

    return { permitido: true, movimento: 'saida', reentrada: false };
  }

  // Entrada.
  if (estado.status === 'cancelado') {
    return recusa('cancelado', 'Este ingresso foi cancelado.');
  }

  if (estado.status === 'transferido') {
    return recusa(
      'transferido',
      'Este ingresso foi transferido. O QR válido está com o novo titular.',
    );
  }

  if (estado.dentro) {
    return recusa(
      'ja_entrou',
      estado.ultimaEntradaEm
        ? `Já entrou às ${hora(estado.ultimaEntradaEm)} e está na casa.`
        : 'Este ingresso já foi usado na entrada.',
    );
  }

  if (estado.status !== 'valido' && estado.entradasCount > 0) {
    // Já entrou alguma vez e não está dentro: ou saiu, ou o evento nem
    // registra saída e o ingresso ficou marcado como usado.
    if (!politica.controlaSaida) {
      return recusa('ja_entrou', 'Este ingresso já foi usado na entrada.');
    }

    if (!politica.permiteReentrada) {
      return recusa(
        'reentrada_bloqueada',
        estado.ultimaSaidaEm
          ? `Saiu às ${hora(estado.ultimaSaidaEm)}. Este evento não permite voltar.`
          : 'Este evento não permite voltar depois da saída.',
      );
    }

    return { permitido: true, movimento: 'entrada', reentrada: true };
  }

  if (estado.status !== 'valido') {
    // Status estranho sem entrada registrada: não inventa liberação.
    return recusa('ja_entrou', 'Este ingresso não está válido para entrada.');
  }

  return { permitido: true, movimento: 'entrada', reentrada: false };
}

export type NumerosDaCasa = {
  emitidos: number;
  /** Já entraram alguma vez. */
  entraram: number;
  /** Estão na casa agora. */
  dentro: number;
  sairam: number;
};

/**
 * O número que importa na porta é **quem está dentro**, não quem já passou.
 * É ele que responde à pergunta do bombeiro e à do produtor às duas da manhã.
 */
export function contarNaCasa(n: Omit<NumerosDaCasa, 'sairam'>): NumerosDaCasa {
  return { ...n, sairam: Math.max(0, n.entraram - n.dentro) };
}
