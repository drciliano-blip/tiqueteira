import type { Metadata } from 'next';
import { Suspense } from 'react';

import { Cabecalho } from '@/components/cabecalho';
import { Rodape } from '@/components/rodape';
import { OPERADOR } from '@/lib/operador';

export const metadata: Metadata = {
  title: 'Termos de uso',
  description: 'Condições de uso da plataforma Tiqueteira.',
};

/**
 * Termos de uso — RASCUNHO.
 *
 * Este texto NÃO substitui redação jurídica. Ele existe por dois motivos:
 * tirar o link quebrado do rodapé, e servir de esqueleto para o advogado
 * trabalhar em cima — é mais rápido revisar do que começar do zero.
 *
 * O que está aqui reflete decisões já tomadas no produto (prazos, reembolso,
 * transferência), então a revisão jurídica deve confirmar, não inventar.
 */
export default function Termos() {
  return (
    <div className="flex min-h-dvh flex-col">
      <Suspense fallback={<div className="h-16 border-b border-line" />}>
        <Cabecalho comBusca={false} comCategorias={false} />
      </Suspense>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12">
        <p className="rounded-botao border border-alerta/40 bg-alerta/10 px-4 py-3 text-sm text-alerta">
          Rascunho. Este texto ainda passará por revisão jurídica antes do lançamento.
        </p>

        <h1 className="mt-8 text-2xl font-bold">Termos de uso</h1>
        <p className="mt-2 text-sm text-faint">Última atualização: 8 de setembro de 2026.</p>

        <div className="prosa mt-8 space-y-8 text-muted">
          <section>
            <h2 className="font-titulo text-lg font-bold text-txt">1. Quem somos</h2>
            <p className="mt-2">
              A Tiqueteira é uma plataforma de intermediação de venda de ingressos operada por{' '}
              <strong className="text-txt">{OPERADOR.razaoSocial}</strong>, inscrita no CNPJ sob o
              nº {OPERADOR.cnpjFormatado}.
            </p>
            <p className="mt-3">
              Atuamos como intermediários entre você e o produtor do evento. Quem organiza,
              realiza e responde pelo evento é o produtor; nós fornecemos a tecnologia de venda,
              emissão e validação do ingresso.
            </p>
          </section>

          <section>
            <h2 className="font-titulo text-lg font-bold text-txt">2. O ingresso</h2>
            <p className="mt-2">
              O ingresso é pessoal e dá direito a <strong className="text-txt">uma entrada</strong>{' '}
              no evento. O código QR pode ser copiado, mas vale uma única vez: quem apresentar
              primeiro entra, e as leituras seguintes são recusadas.
            </p>
            <p className="mt-3">
              Em eventos com ingresso nominal, o nome do titular é conferido na entrada, e pode
              ser exigido documento oficial com foto.
            </p>
          </section>

          <section>
            <h2 className="font-titulo text-lg font-bold text-txt">3. Preço e taxa</h2>
            <p className="mt-2">
              O preço do ingresso é definido pelo produtor. A taxa de conveniência remunera a
              plataforma e é sempre exibida de forma destacada antes da conclusão da compra,
              nunca embutida no preço sem aviso.
            </p>
          </section>

          <section>
            <h2 className="font-titulo text-lg font-bold text-txt">4. Cancelamento e reembolso</h2>
            <p className="mt-2">
              Você pode desistir da compra em até{' '}
              <strong className="text-txt">7 dias corridos</strong>, conforme o artigo 49 do
              Código de Defesa do Consumidor, e receber a devolução integral do valor pago,{' '}
              <strong className="text-txt">taxa de conveniência incluída</strong>.
            </p>
            <p className="mt-3">
              Se faltarem 7 dias ou menos para o evento, o pedido de cancelamento deve ser feito
              até 48 horas antes do início.
            </p>
            <p className="mt-3">
              O reembolso pode ser de um ingresso específico, sem cancelar o pedido inteiro, e é
              feito na mesma forma de pagamento usada na compra.
            </p>
            <p className="mt-3">
              Se o evento for cancelado pelo produtor, a devolução é feita automaticamente, sem
              necessidade de solicitação.
            </p>
          </section>

          <section>
            <h2 className="font-titulo text-lg font-bold text-txt">5. Transferência</h2>
            <p className="mt-2">
              Quando o produtor permitir, o ingresso pode ser transferido pela plataforma até 24
              horas antes do evento. O ingresso original é cancelado no ato e um novo é emitido
              no nome de quem vai.
            </p>
            <p className="mt-3">
              <strong className="text-txt">
                Havendo reembolso posterior, o valor volta para quem pagou
              </strong>{' '}
              — não para o titular atual. Transferência é autorização de uso, não cessão do
              pedido.
            </p>
          </section>

          <section>
            <h2 className="font-titulo text-lg font-bold text-txt">6. Meia-entrada e gratuidade</h2>
            <p className="mt-2">
              Quando oferecidas, a meia-entrada e as gratuidades legais seguem a Lei nº
              12.933/2013 e a legislação aplicável. O direito é comprovado na entrada, mediante
              documento. Sem comprovação, o acesso pode ser condicionado ao pagamento da
              diferença.
            </p>
          </section>

          <section>
            <h2 className="font-titulo text-lg font-bold text-txt">7. Uso indevido</h2>
            <p className="mt-2">
              É vedada a revenda de ingressos com sobrepreço e o uso de meios automatizados para
              compra. Indícios de fraude podem levar ao cancelamento do ingresso e à retenção de
              valores, sem prejuízo das medidas cabíveis.
            </p>
          </section>

          <section>
            <h2 className="font-titulo text-lg font-bold text-txt">8. Responsabilidade</h2>
            <p className="mt-2">
              A realização do evento, sua programação, horário, local e condições são de
              responsabilidade do produtor. A plataforma responde pelo que está sob seu controle:
              a venda, a emissão e a validação do ingresso.
            </p>
          </section>

          <section>
            <h2 className="font-titulo text-lg font-bold text-txt">9. Contato</h2>
            <p className="mt-2">
              Dúvidas e solicitações podem ser enviadas para{' '}
              <a href={`mailto:${OPERADOR.email}`} className="text-accent">
                {OPERADOR.email}
              </a>
              .
            </p>
          </section>
        </div>
      </main>

      <Rodape />
    </div>
  );
}
