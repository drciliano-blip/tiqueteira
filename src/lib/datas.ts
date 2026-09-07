/**
 * Datas para exibição.
 *
 * O banco guarda tudo em UTC; a tela mostra em America/Sao_Paulo. A conversão
 * acontece só aqui, e o fuso é explícito em toda formatação — sem isso, o
 * servidor da Vercel (que roda em UTC) mostraria "meia-noite de sábado" para
 * uma festa que começa às 21h de sexta.
 */
export const FUSO = 'America/Sao_Paulo';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "sáb, 7 de out" */
export function dataCurta(d: Date): string {
  return cap(
    new Intl.DateTimeFormat('pt-BR', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: FUSO,
    }).format(d),
  ).replace(/\.$/, '');
}

/** "Sábado, 7 de outubro de 2026" */
export function dataLonga(d: Date): string {
  return cap(
    new Intl.DateTimeFormat('pt-BR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: FUSO,
    }).format(d),
  );
}

/** "23h00" */
export function hora(d: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: FUSO,
  })
    .format(d)
    .replace(':', 'h');
}

/** Partes soltas, para o selo de data do card. */
export function selo(d: Date): { dia: string; mes: string } {
  const f = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('pt-BR', { ...opts, timeZone: FUSO }).format(d);
  return { dia: f({ day: '2-digit' }), mes: f({ month: 'short' }).replace('.', '').toUpperCase() };
}

/** Contagem regressiva legível: "8 dias", "3 horas", "12 minutos". */
export function faltam(ate: Date, agora = new Date()): string {
  const ms = ate.getTime() - agora.getTime();
  if (ms <= 0) return 'encerrado';

  const minutos = Math.floor(ms / 60_000);
  if (minutos < 60) return `${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`;

  const horas = Math.floor(minutos / 60);
  if (horas < 48) return `${horas} ${horas === 1 ? 'hora' : 'horas'}`;

  const dias = Math.floor(horas / 24);
  return `${dias} ${dias === 1 ? 'dia' : 'dias'}`;
}
