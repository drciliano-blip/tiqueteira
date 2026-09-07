/**
 * CPF — normalização e validação de dígitos.
 *
 * Função pura. Validar aqui evita dois problemas caros: pedido que a PSP
 * recusa depois de já ter reservado estoque, e base de compradores suja que
 * inviabiliza o limite por CPF e a conferência de documento na porta.
 *
 * Isto valida o FORMATO e os dígitos verificadores. Não prova que o CPF
 * existe nem que pertence a quem digitou — para isso seria preciso consulta
 * externa, que tem custo e é decisão de negócio, não de código.
 */

/** Só dígitos. É assim que o CPF é guardado no banco. */
export function normalizarCpf(entrada: string): string {
  return entrada.replace(/\D/g, '');
}

function digito(base: string, pesoInicial: number): number {
  let soma = 0;
  for (let i = 0; i < base.length; i++) {
    soma += Number(base[i]) * (pesoInicial - i);
  }
  const resto = (soma * 10) % 11;
  return resto === 10 ? 0 : resto;
}

export function cpfValido(entrada: string): boolean {
  const cpf = normalizarCpf(entrada);
  if (cpf.length !== 11) return false;

  // 111.111.111-11 e afins passam no cálculo, mas não são CPF de ninguém.
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const d1 = digito(cpf.slice(0, 9), 10);
  if (d1 !== Number(cpf[9])) return false;

  const d2 = digito(cpf.slice(0, 10), 11);
  return d2 === Number(cpf[10]);
}

/** 12345678901 → 123.456.789-01 */
export function formatarCpf(entrada: string): string {
  const cpf = normalizarCpf(entrada);
  if (cpf.length !== 11) return entrada;
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}

/**
 * Mascarado para exibição: ***.456.789-**
 *
 * LGPD, princípio da necessidade: a portaria e o painel precisam distinguir
 * dois homônimos, não precisam do documento inteiro na tela.
 */
export function mascararCpf(entrada: string): string {
  const cpf = normalizarCpf(entrada);
  if (cpf.length !== 11) return '***';
  return `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`;
}
