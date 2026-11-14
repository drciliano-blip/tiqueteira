import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { formatarCnpj } from '@/domain/cpf';
import { produtor } from '@/lib/admin';
import { salvarKyc, salvarTaxas } from '../../acoes';
import { CAMPO_ADMIN, FormAcao, Motivo } from '../../form-acao';

export const metadata: Metadata = { title: 'Produtor' };
export const dynamic = 'force-dynamic';

const pct = (bps: number) => (bps / 100).toFixed(2).replace('.', ',').replace(/,00$/, '');
const reais = (c: number) => (c / 100).toFixed(2).replace('.', ',');

export default async function Produtor({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  if (!z.uuid().safeParse(tenantId).success) notFound();
  const r = await produtor(tenantId);
  if (!r) notFound();
  const t = r.tenant;

  return (
    <>
      <Link href="/admin/produtores" className="text-sm text-muted">
        ← Produtores
      </Link>
      <h1 className="mt-3 font-titulo text-xl font-bold">{t.nome}</h1>
      <p className="text-sm text-muted">
        <Link href={`/${t.slug}`} className="hover:text-txt">
          /{t.slug}
        </Link>{' '}
        · {t.email}
        {t.cnpj ? ` · CNPJ ${formatarCnpj(t.cnpj)}` : ''}
        {t.razaoSocial ? ` · ${t.razaoSocial}` : ''}
      </p>

      <section className="mt-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-faint">Equipe</h2>
        <ul className="mt-2 text-sm">
          {r.equipe.map((m) => (
            <li key={`${m.email}`}>
              {m.nome as string} · {m.email as string} <span className="text-faint">({m.role as string})</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="rounded-cartao border border-line p-4">
          <h2 className="font-titulo font-bold">Condições comerciais</h2>
          <p className="mt-1 text-xs text-faint">
            Valem só para pedidos novos: cada pedido já gravou as taxas que cobrou.
          </p>
          <div className="mt-4">
            <FormAcao acao={salvarTaxas.bind(null, t.id)} botao="Salvar condições">
              <div className="grid grid-cols-2 gap-3">
                <Campo nome="taxaConvenienciaBps" rotulo="Conveniência (%)" valor={pct(t.taxaConvenienciaBps)} />
                <Campo nome="taxaMinimaCentavos" rotulo="Conveniência mínima (R$)" valor={reais(t.taxaMinimaCentavos)} />
                <Campo nome="comissaoBps" rotulo="Comissão (%)" valor={pct(t.comissaoBps)} />
                <Campo nome="taxaFixaCentavos" rotulo="Taxa fixa por ingresso (R$)" valor={reais(t.taxaFixaCentavos)} />
                <Campo nome="reservaCartaoBps" rotulo="Reserva no cartão (%)" valor={pct(t.reservaCartaoBps)} />
                <Campo nome="reservaPixBps" rotulo="Reserva no Pix (%)" valor={pct(t.reservaPixBps)} />
                <Campo nome="diasLiberacaoEvento" rotulo="Principal: dias úteis" valor={String(t.diasLiberacaoEvento)} />
                <Campo nome="diasLiberacaoReserva" rotulo="Reserva: dias" valor={String(t.diasLiberacaoReserva)} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="taxaAbsorvidaPeloProdutor" defaultChecked={t.taxaAbsorvidaPeloProdutor} />
                O produtor absorve a conveniência (comprador paga o preço de face)
              </label>
              <Motivo />
            </FormAcao>
          </div>
        </section>

        <section className="rounded-cartao border border-line p-4">
          <h2 className="font-titulo font-bold">Cadastro de recebimento</h2>
          <p className="mt-1 text-sm text-muted">
            Situação atual: <strong>{t.kycStatus}</strong>
            {t.providerRecipientId ? ` · recebedor ${t.providerRecipientId}` : ' · sem recebedor na PSP'}
          </p>
          <p className="mt-1 text-xs text-faint">
            Normalmente muda sozinho, pelo aviso da operadora. Use só para corrigir à mão.
          </p>
          <div className="mt-4">
            <FormAcao acao={salvarKyc.bind(null, t.id)} botao="Alterar situação" perigo>
              <select name="kyc" defaultValue={t.kycStatus} className={CAMPO_ADMIN}>
                <option value="pendente">Sem cadastro</option>
                <option value="em_analise">Em análise</option>
                <option value="aprovado">Aprovado</option>
                <option value="reprovado">Reprovado</option>
                <option value="suspenso">Suspenso</option>
              </select>
              <Motivo />
            </FormAcao>
          </div>
        </section>
      </div>
    </>
  );
}

function Campo({ nome, rotulo, valor }: { nome: string; rotulo: string; valor: string }) {
  return (
    <label className="block text-sm">
      {rotulo}
      <input name={nome} defaultValue={valor} inputMode="decimal" required className={CAMPO_ADMIN} />
    </label>
  );
}
