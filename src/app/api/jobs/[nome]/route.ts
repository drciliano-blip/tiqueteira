import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

import { concluirJob, falharJob, reservarJobs, type NomeJob } from '@/lib/jobs';
import { reembolsarPedidosDoEvento, type PayloadCancelamento } from '@/jobs/cancelar-evento';
import { enviarIngressos, type PayloadEnvio } from '@/jobs/enviar-ingressos';
import { conciliarPedidos } from '@/jobs/conciliacao';
import { reembolsarPagamentosAtrasados } from '@/jobs/reembolso-atrasado';
import { devolverPedidosExpirados } from '@/jobs/expirar-reservas';
import { env } from '@/lib/env';

/**
 * Worker das tarefas em fila — plano, seção 13.
 *
 * Chamado pelo agendador da Vercel (ver vercel.json) e protegido por segredo.
 * Sem a proteção, qualquer um dispararia o processamento da fila de fora.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const NOMES: NomeJob[] = [
  'enviar-ingressos',
  'expirar-reservas',
  'reembolso-automatico',
  'pagamento-atrasado',
  'conciliacao',
];

/** Comparação em tempo constante: `===` vaza o prefixo acertado pelo tempo. */
function segredoConfere(recebido: string | null, esperado: string): boolean {
  if (!recebido) return false;
  const a = Buffer.from(recebido, 'utf8');
  const b = Buffer.from(esperado, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ nome: string }> },
): Promise<NextResponse> {
  const { nome } = await params;

  const cabecalho = request.headers.get('authorization');
  const token = cabecalho?.startsWith('Bearer ') ? cabecalho.slice(7) : null;

  if (!segredoConfere(token, env().JOB_SECRET)) {
    return NextResponse.json({ erro: 'não autorizado' }, { status: 401 });
  }

  if (!NOMES.includes(nome as NomeJob)) {
    return NextResponse.json({ erro: 'tarefa desconhecida' }, { status: 404 });
  }

  // Expiração de reserva não usa fila: é uma varredura, e enfileirar uma
  // tarefa por reserva vencida seria mais caro que a própria varredura.
  if (nome === 'expirar-reservas') {
    const resultado = await devolverPedidosExpirados();
    return NextResponse.json(resultado);
  }

  /**
   * Varredura, não fila: procurar os pedidos pagos sem ingresso é uma
   * consulta só, e enfileirar uma tarefa por pedido custaria mais que ela.
   */
  if (nome === 'pagamento-atrasado') {
    const detalhe = await reembolsarPagamentosAtrasados();
    return NextResponse.json({ detalhe });
  }

  if (nome === 'conciliacao') {
    const relatorio = await conciliarPedidos();
    if (relatorio.divergencias.length > 0) {
      console.error('[conciliacao] divergências', relatorio.divergencias);
    }
    return NextResponse.json(relatorio);
  }

  const pendentes = await reservarJobs(nome as NomeJob);
  const relatorio: { id: string; ok: boolean; detalhe: string }[] = [];

  for (const job of pendentes) {
    try {
      let detalhe = 'sem ação';

      if (job.nome === 'enviar-ingressos') {
        detalhe = await enviarIngressos(
          job.payload as PayloadEnvio,
          env().TICKET_HMAC_SECRET,
          env().NEXT_PUBLIC_APP_URL,
        );
      } else if (job.nome === 'reembolso-automatico') {
        detalhe = await reembolsarPedidosDoEvento(job.payload as PayloadCancelamento);
      }

      await concluirJob(job.id);
      relatorio.push({ id: job.id, ok: true, detalhe });
    } catch (e) {
      const erro = e instanceof Error ? e.message : String(e);
      await falharJob(job.id, erro, job.tentativas);
      relatorio.push({ id: job.id, ok: false, detalhe: erro });
    }
  }

  return NextResponse.json({ processados: relatorio.length, relatorio });
}

/**
 * O agendador da Vercel chama por GET. Aceita os dois métodos, com a mesma
 * checagem de segredo.
 */
export async function GET(
  request: Request,
  contexto: { params: Promise<{ nome: string }> },
): Promise<NextResponse> {
  return POST(request, contexto);
}
