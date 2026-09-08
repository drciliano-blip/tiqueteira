/**
 * Limite de tentativas — plano, seção 14.
 *
 * Protege quatro pontos, cada um por um motivo diferente:
 *
 * - **Login**: ataque de credencial em série. Sem limite, o Argon2 encarece
 *   cada tentativa, mas não impede milhares delas.
 * - **Criação de pedido**: um script pode reservar todo o estoque de um lote
 *   e derrubar a venda sem pagar nada — é o ataque mais barato contra uma
 *   bilheteria, e o mais fácil de executar.
 * - **Link de acesso**: sem limite, vira ferramenta de envio de e-mail em
 *   massa contra endereços de terceiros.
 * - **Validação de cupom**: descobrir código por tentativa e erro.
 *
 * A contagem é atômica no banco, numa única instrução. Ler o contador e
 * depois gravar criaria exatamente a janela que o atacante precisa.
 */
import 'server-only';

import { sql } from 'drizzle-orm';

import { serviceDb } from '@/db/client';

export type Regra = { limite: number; janelaSegundos: number };

/**
 * Números escolhidos para não incomodar quem é honesto.
 * Um comprador legítimo erra a senha três vezes, não trinta.
 */
export const REGRAS = {
  login: { limite: 8, janelaSegundos: 900 },
  criarPedido: { limite: 12, janelaSegundos: 300 },
  linkAcesso: { limite: 5, janelaSegundos: 900 },
  cupom: { limite: 20, janelaSegundos: 300 },
} as const satisfies Record<string, Regra>;

export type Acao = keyof typeof REGRAS;

export type ResultadoLimite = {
  permitido: boolean;
  restantes: number;
  /** Segundos até a janela reabrir. Serve para dizer ao usuário quanto esperar. */
  esperarSegundos: number;
};

/**
 * Registra uma tentativa e diz se ela pode prosseguir.
 *
 * A instrução faz tudo de uma vez: cria a chave se não existir, reinicia a
 * contagem se a janela venceu, e incrementa caso contrário.
 */
export async function registrarTentativa(
  acao: Acao,
  identificador: string,
): Promise<ResultadoLimite> {
  const regra = REGRAS[acao];
  const chave = `${acao}:${identificador.toLowerCase().slice(0, 180)}`;
  const janela = `${regra.janelaSegundos} seconds`;

  const linhas = (await serviceDb().execute(sql`
    insert into rate_limits (chave, janela_inicio, contador)
    values (${chave}, now(), 1)
    on conflict (chave) do update
      set contador = case
            when rate_limits.janela_inicio < now() - ${sql.raw(`interval '${janela}'`)}
            then 1
            else rate_limits.contador + 1
          end,
          janela_inicio = case
            when rate_limits.janela_inicio < now() - ${sql.raw(`interval '${janela}'`)}
            then now()
            else rate_limits.janela_inicio
          end
    returning contador,
      extract(epoch from (janela_inicio + ${sql.raw(`interval '${janela}'`)} - now()))::int as faltam
  `)) as unknown as { contador: number; faltam: number }[];

  const linha = linhas[0];
  const contador = Number(linha?.contador ?? 1);
  const faltam = Math.max(0, Number(linha?.faltam ?? regra.janelaSegundos));

  return {
    permitido: contador <= regra.limite,
    restantes: Math.max(0, regra.limite - contador),
    esperarSegundos: faltam,
  };
}

/** Zera a contagem — usado quando o login dá certo. */
export async function limparTentativas(acao: Acao, identificador: string): Promise<void> {
  const chave = `${acao}:${identificador.toLowerCase().slice(0, 180)}`;
  await serviceDb().execute(sql`delete from rate_limits where chave = ${chave}`);
}

/** Higiene: apaga janelas encerradas há mais de um dia. */
export async function limparJanelasAntigas(): Promise<void> {
  await serviceDb().execute(
    sql`delete from rate_limits where janela_inicio < now() - interval '1 day'`,
  );
}

/** Mensagem pronta, em minutos, para não expor o mecanismo. */
export function mensagemDeEspera(segundos: number): string {
  const minutos = Math.max(1, Math.ceil(segundos / 60));
  return `Muitas tentativas. Tente de novo em ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}.`;
}
