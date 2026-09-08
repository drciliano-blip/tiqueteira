import type { Metadata } from 'next';
import { Suspense } from 'react';

import { Cabecalho } from '@/components/cabecalho';
import { Rodape } from '@/components/rodape';
import { OPERADOR } from '@/lib/operador';

export const metadata: Metadata = {
  title: 'Política de privacidade',
  description: 'Como a Tiqueteira trata os dados de quem compra ingresso.',
};

/**
 * Política de privacidade — RASCUNHO.
 *
 * Descreve o tratamento que o sistema realmente faz hoje, não um texto
 * genérico. Precisa de revisão jurídica, mas parte do que está implementado —
 * é assim que política de privacidade deixa de ser ficção.
 *
 * O ponto sensível está na seção 4: entregar a base de compradores ao produtor
 * é compartilhamento de dado pessoal e precisa estar previsto aqui e no
 * contrato, senão não pode acontecer.
 */
export default function Privacidade() {
  return (
    <div className="flex min-h-dvh flex-col">
      <Suspense fallback={<div className="h-16 border-b border-line" />}>
        <Cabecalho comBusca={false} comCategorias={false} />
      </Suspense>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12">
        <p className="rounded-botao border border-alerta/40 bg-alerta/10 px-4 py-3 text-sm text-alerta">
          Rascunho. Este texto ainda passará por revisão jurídica antes do lançamento.
        </p>

        <h1 className="mt-8 text-2xl font-bold">Política de privacidade</h1>
        <p className="mt-2 text-sm text-faint">Última atualização: 8 de setembro de 2026.</p>

        <div className="prosa mt-8 space-y-8 text-muted">
          <section>
            <h2 className="font-titulo text-lg font-bold text-txt">1. Quem trata seus dados</h2>
            <p className="mt-2">
              <strong className="text-txt">{OPERADOR.razaoSocial}</strong>, CNPJ{' '}
              {OPERADOR.cnpjFormatado}, operadora da plataforma Tiqueteira.
            </p>
          </section>

          <section>
            <h2 className="font-titulo text-lg font-bold text-txt">2. O que coletamos</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5">
              <li>
                <strong className="text-txt">Nome, e-mail e CPF</strong> — informados na compra.
                O CPF é necessário para emitir o ingresso nominal, aplicar limite por comprador e
                permitir a conferência na entrada.
              </li>
              <li>
                <strong className="text-txt">Telefone</strong> — opcional, usado apenas para
                contato sobre a compra.
              </li>
              <li>
                <strong className="text-txt">Endereço de IP e navegador</strong> — registrados no
                pedido, para prevenção de fraude.
              </li>
              <li>
                <strong className="text-txt">Registro de entrada no evento</strong> — data, hora e
                qual operador validou seu ingresso.
              </li>
            </ul>
            <p className="mt-3">
              Não coletamos dados de cartão. Eles vão direto para o processador de pagamento
              licenciado, sem passar pelos nossos servidores.
            </p>
          </section>

          <section>
            <h2 className="font-titulo text-lg font-bold text-txt">3. Por que tratamos</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5">
              <li>Executar o contrato de compra e emitir o ingresso.</li>
              <li>Cumprir obrigações legais, como emissão de nota fiscal e meia-entrada.</li>
              <li>
                Prevenir fraude e revenda irregular — interesse legítimo, e é o que protege quem
                comprou de verdade.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="font-titulo text-lg font-bold text-txt">4. Com quem compartilhamos</h2>
            <p className="mt-2">
              <strong className="text-txt">Com o produtor do evento:</strong> nome, e-mail e CPF de
              quem comprou ingresso para o evento dele. O produtor precisa desses dados para
              operar a portaria e responder pelo evento, e passa a ser responsável pelo uso que
              fizer deles.
            </p>
            <p className="mt-3">
              <strong className="text-txt">Com o processador de pagamento:</strong> os dados
              necessários para processar a cobrança.
            </p>
            <p className="mt-3">Não vendemos dados pessoais a ninguém.</p>
          </section>

          <section>
            <h2 className="font-titulo text-lg font-bold text-txt">5. Por quanto tempo</h2>
            <p className="mt-2">
              Dados do pedido e do ingresso são mantidos pelo prazo necessário ao cumprimento de
              obrigações fiscais e à defesa em eventual questionamento, o que na prática significa
              cinco anos após o evento.
            </p>
          </section>

          <section>
            <h2 className="font-titulo text-lg font-bold text-txt">6. Seus direitos</h2>
            <p className="mt-2">
              A Lei nº 13.709/2018 garante a você confirmar a existência de tratamento, acessar,
              corrigir, solicitar a exclusão dos dados que não precisamos manter por obrigação
              legal, e saber com quem compartilhamos.
            </p>
            <p className="mt-3">
              Para exercer qualquer um deles, escreva para{' '}
              <a href={`mailto:${OPERADOR.email}`} className="text-accent">
                {OPERADOR.email}
              </a>
              . Respondemos em até 15 dias.
            </p>
          </section>

          <section>
            <h2 className="font-titulo text-lg font-bold text-txt">7. Segurança</h2>
            <p className="mt-2">
              O acesso aos dados é isolado por produtor no próprio banco de dados, e não apenas
              por filtro na aplicação. Senhas são guardadas com algoritmo próprio para isso, e
              nunca em texto legível. O código do ingresso é assinado, e guardamos apenas a
              verificação — não o código em si.
            </p>
          </section>

          <section>
            <h2 className="font-titulo text-lg font-bold text-txt">8. Cookies</h2>
            <p className="mt-2">
              Usamos apenas cookies necessários ao funcionamento: manter você conectado ao painel
              ou à sua área de ingressos. Não usamos cookies de publicidade.
            </p>
          </section>
        </div>
      </main>

      <Rodape />
    </div>
  );
}
