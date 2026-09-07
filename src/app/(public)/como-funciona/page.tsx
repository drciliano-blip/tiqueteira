import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import { Cabecalho } from '@/components/cabecalho';
import { Rodape } from '@/components/rodape';

export const metadata: Metadata = {
  title: 'Como funciona',
  description:
    'Como comprar, receber e usar seu ingresso — e como funciona para quem vende pela plataforma.',
};

const COMPRADOR = [
  {
    titulo: 'Escolha os ingressos',
    texto:
      'Na página do evento você vê cada lote com o preço e a taxa em linhas separadas. Nada de valor que só aparece no fim.',
  },
  {
    titulo: 'Seus lugares ficam guardados por 10 minutos',
    texto:
      'Assim que você clica em comprar, os ingressos saem da venda e ficam reservados no seu nome enquanto você preenche os dados. A contagem fica visível na tela.',
  },
  {
    titulo: 'Pague com Pix ou cartão',
    texto:
      'No Pix, a tela reconhece o pagamento sozinha — você não precisa clicar em "já paguei". Não é preciso criar conta em momento nenhum.',
  },
  {
    titulo: 'O ingresso chega por e-mail',
    texto:
      'Em PDF, com um QR assinado. Se apagar o e-mail, é só entrar em Meus ingressos e pedir um link de acesso: sem senha, sem cadastro.',
  },
  {
    titulo: 'Na porta, é só apresentar o QR',
    texto:
      'A portaria lê e libera. Em evento com ingresso nominal, também confere o documento — por isso o nome no ingresso precisa ser o de quem vai entrar.',
  },
];

const DUVIDAS = [
  {
    p: 'Posso desistir da compra?',
    r: 'Sim. Você tem 7 dias corridos a partir da compra para cancelar e receber tudo de volta, taxa de conveniência incluída. Se o evento for antes disso, o limite é 48 horas antes de começar.',
  },
  {
    p: 'Comprei 4 ingressos e preciso devolver só 1. Dá?',
    r: 'Dá. Diferente da maior parte do mercado, aqui o reembolso pode ser de um ingresso só, sem cancelar o pedido inteiro.',
  },
  {
    p: 'Posso passar o ingresso para outra pessoa?',
    r: 'Pode, pela própria plataforma, até 24 horas antes do evento. O ingresso antigo é cancelado na hora e um novo é emitido no nome de quem vai — o print antigo não passa mais na porta. Importante: se houver reembolso depois, o dinheiro volta para quem pagou, não para o titular novo.',
  },
  {
    p: 'E se o evento for cancelado?',
    r: 'O reembolso é feito pela plataforma, automaticamente, para a mesma forma de pagamento usada na compra. Você não precisa pedir.',
  },
  {
    p: 'O Pix expirou e eu paguei mesmo assim. E agora?',
    r: 'O valor é devolvido automaticamente e você é avisado. Os ingressos já tinham voltado para a venda quando a reserva venceu.',
  },
  {
    p: 'Por que existe taxa de conveniência?',
    r: 'É o que paga a plataforma: emissão do ingresso, processamento do pagamento, controle de portaria e suporte. Ela aparece sempre discriminada, nunca embutida no preço sem aviso.',
  },
];

const PRODUTOR = [
  {
    titulo: 'O dinheiro não passa por nós',
    texto:
      'O pagamento é dividido na hora da venda, dentro do processador licenciado. Sua parte já nasce no seu nome — a plataforma não guarda faturamento de ninguém em conta própria.',
  },
  {
    titulo: 'Repasse a partir de D+2 úteis',
    texto:
      'A maior parte cai dois dias úteis depois do evento. Uma reserva menor fica retida até a janela de contestação de cartão fechar, para você não receber hoje e ter de devolver depois.',
  },
  {
    titulo: 'Você acompanha tudo pelo painel',
    texto:
      'Vendidos, faturamento, líquido a receber e a data prevista do próximo repasse, sempre na tela.',
  },
];

export default function ComoFunciona() {
  return (
    <div className="flex min-h-dvh flex-col">
      <Suspense fallback={<div className="h-16 border-b border-line" />}>
        <Cabecalho comBusca={false} />
      </Suspense>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
        <h1 className="text-2xl font-bold leading-tight">Como funciona</h1>
        <p className="prosa mt-3 text-muted">
          Da escolha do ingresso até a entrada no evento, e o que acontece se algo mudar de
          planos.
        </p>

        <section className="mt-12">
          <h2 className="font-titulo text-lg font-bold">Para quem compra</h2>
          <ol className="mt-5 space-y-6">
            {COMPRADOR.map((passo, i) => (
              <li key={passo.titulo} className="flex gap-4">
                <span
                  aria-hidden
                  className="tabular grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line-forte text-sm font-semibold"
                >
                  {i + 1}
                </span>
                <div>
                  <h3 className="font-semibold">{passo.titulo}</h3>
                  <p className="prosa mt-1 text-sm text-muted">{passo.texto}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-14">
          <h2 className="font-titulo text-lg font-bold">Dúvidas frequentes</h2>
          <dl className="mt-5 divide-y divide-line overflow-hidden rounded-cartao border border-line">
            {DUVIDAS.map((d) => (
              <div key={d.p} className="px-4 py-4">
                <dt className="font-medium">{d.p}</dt>
                <dd className="prosa mt-1.5 text-sm text-muted">{d.r}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mt-14">
          <h2 className="font-titulo text-lg font-bold">Para quem vende</h2>
          <ul className="mt-5 space-y-6">
            {PRODUTOR.map((item) => (
              <li key={item.titulo}>
                <h3 className="font-semibold">{item.titulo}</h3>
                <p className="prosa mt-1 text-sm text-muted">{item.texto}</p>
              </li>
            ))}
          </ul>

          <Link
            href="/publique"
            className="mt-8 inline-block rounded-botao bg-accent px-5 py-3 font-semibold text-accent-txt"
          >
            Publique seu evento
          </Link>
        </section>
      </main>

      <Rodape />
    </div>
  );
}
