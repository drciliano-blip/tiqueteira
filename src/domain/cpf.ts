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

/** Só dígitos, 14 posições. */
export function normalizarCnpj(entrada: string): string {
  return entrada.replace(/\D/g, '');
}

/** CNPJ numérico com dígitos verificadores conferidos. */
export function cnpjValido(entrada: string): boolean {
  const d = normalizarCnpj(entrada);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const nums = [...d].map(Number);
  const dv = (base: number[], pesos: number[]) => {
    const soma = base.reduce((a, n, i) => a + n * pesos[i]!, 0) % 11;
    return soma < 2 ? 0 : 11 - soma;
  };
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const p2 = [6, ...p1];
  return dv(nums.slice(0, 12), p1) === nums[12] && dv(nums.slice(0, 13), p2) === nums[13];
}

export function formatarCnpj(entrada: string): string {
  const d = normalizarCnpj(entrada);
  if (d.length !== 14) return entrada;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
