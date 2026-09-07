import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import QRCode from 'qrcode';

import { TemaTenant } from '@/components/tema-tenant';
import { ingressoPorCodigo } from '@/lib/buyer-queries';
import { COOKIE_COMPRADOR, lerSessaoComprador } from '@/lib/buyer-session';
import { dataLonga, hora } from '@/lib/datas';
import { env } from '@/lib/env';
import { emitirTicket } from '@/lib/tickets';

export const metadata: Metadata = {
  title: 'Ingresso',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ codigo: string }> };

export default async function Ingresso({ params }: Props) {
  const { codigo } = await params;

  // Formato do código: quatro caracteres, hífen, quatro caracteres.
  if (!/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/.test(codigo)) notFound();

  const ingresso = await ingressoPorCodigo(codigo);
  if (!ingresso) notFound();

  /**
   * Quem pode ver o QR.
   *
   * O código é curto e legível — ele é feito para ser ditado na porta, não
   * para ser segredo. Por isso a tela só mostra o QR para quem provou ser o
   * comprador pelo e-mail. Sem isso, tentar códigos ao acaso acabaria
   * encontrando ingresso válido de outra pessoa.
   */
  const store = await cookies();
  const emailSessao = lerSessaoComprador(store.get(COOKIE_COMPRADOR)?.value, env().AUTH_SECRET);

  const autorizado =
    emailSessao !== null &&
    ingresso.compradorEmail !== null &&
    emailSessao.toLowerCase() === ingresso.compradorEmail.toLowerCase();

  const valido = ingresso.status === 'valido';

  const qr = autorizado && valido
    ? await QRCode.toDataURL(emitirTicket(env().TICKET_HMAC_SECRET, ingresso.codigo).token, {
        margin: 1,
        width: 640,
      })
    : null;

  return (
    <>
      <TemaTenant corAcento={ingresso.corAcento} />

      <div className="flex min-h-dvh flex-col">
        <main className="mx-auto w-full max-w-md flex-1 px-4 py-8">
          <p className="text-xs uppercase tracking-[0.14em] text-accent">{ingresso.tenantNome}</p>
          <h1 className="mt-2 font-titulo text-xl font-bold leading-tight">
            {ingresso.eventoTitulo}
          </h1>
          <p className="tabular mt-1.5 text-sm text-muted">
            {dataLonga(ingresso.eventoInicio)}, às {hora(ingresso.eventoInicio)}
          </p>
          <p className="mt-0.5 text-sm text-faint">
            {ingresso.venueNome}
            {ingresso.cidade ? ` · ${ingresso.cidade}` : ''}
          </p>
          {ingresso.venueEndereco && (
            <p className="text-sm text-faint">{ingresso.venueEndereco}</p>
          )}

          <section className="mt-6 rounded-cartao border border-line bg-raised p-5 text-center">
            {qr ? (
              <>
                {/* Fundo branco e brilho alto: leitor erra em QR invertido. */}
                <div className="inline-block rounded-lg bg-white p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qr}
                    alt={`QR do ingresso ${ingresso.codigo}`}
                    className="h-56 w-56"
                  />
                </div>
                <p className="tabular mt-4 text-xl font-bold tracking-widest">
                  {ingresso.codigo}
                </p>
              </>
            ) : (
              <div className="py-6">
                <p className="tabular text-2xl font-bold tracking-widest">{ingresso.codigo}</p>

                {!valido ? (
                  <p className="prosa mx-auto mt-4 text-sm text-muted">
                    {ingresso.status === 'usado'
                      ? `Este ingresso já foi usado${
                          ingresso.checkedInEm ? ` às ${hora(ingresso.checkedInEm)}` : ''
                        }.`
                      : ingresso.status === 'transferido'
                        ? 'Este ingresso foi transferido. Um novo foi emitido para o novo titular.'
                        : 'Este ingresso foi cancelado.'}
                  </p>
                ) : (
                  <>
                    <p className="prosa mx-auto mt-4 text-sm text-muted">
                      Para ver o QR, entre com o e-mail usado na compra.
                    </p>
                    <Link
                      href="/meus-ingressos"
                      className="mt-5 inline-block rounded-botao bg-accent px-5 py-3 font-semibold text-accent-txt"
                    >
                      Acessar meus ingressos
                    </Link>
                  </>
                )}
              </div>
            )}
          </section>

          <dl className="mt-5 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-faint">Titular</dt>
              <dd className="font-medium">{ingresso.titular}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-faint">Tipo</dt>
              <dd>{ingresso.lote}</dd>
            </div>
          </dl>

          {ingresso.eventoNominal && valido && (
            <p className="prosa mt-6 rounded-botao border border-alerta/40 bg-alerta/10 px-4 py-3 text-sm text-alerta">
              {ingresso.eventoDocumento
                ? 'Leve documento com foto: a portaria confere o nome do titular na entrada.'
                : 'Ingresso nominal — o nome do titular fica registrado na entrada.'}
            </p>
          )}

          <p className="prosa mt-6 text-xs text-faint">
            Este QR vale uma entrada. Se for copiado, quem chegar primeiro entra e os demais são
            barrados — por isso, se precisar repassar, use a transferência na área de ingressos.
          </p>

          <Link
            href="/meus-ingressos"
            className="mt-6 inline-block text-sm text-muted transition hover:text-txt"
          >
            ← Todos os meus ingressos
          </Link>
        </main>
      </div>
    </>
  );
}
