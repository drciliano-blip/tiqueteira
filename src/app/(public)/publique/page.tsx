import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import { Cabecalho } from '@/components/cabecalho';
import { Rodape } from '@/components/rodape';

export const metadata: Metadata = {
  title: 'Publique seu evento',
  description:
    'Venda ingressos com repasse rápido, taxa transparente e controle de portaria de verdade.',
};

const DIFERENCIAIS = [
  {
    titulo: 'O dinheiro é seu, e vai direto para você',
    texto:
      'A plataforma não guarda o seu faturamento em conta nenhuma. O pagamento é dividido na hora da venda, pelo processador, e o seu saldo já nasce no seu nome.',
  },
  {
    titulo: 'Repasse a partir de D+2 úteis',
    texto:
      'A maior parte cai dois dias úteis depois do evento. Uma reserva menor fica retida até a janela de contestação de cartão fechar — é o que evita você receber hoje e ter de devolver daqui a três meses.',
  },
  {
    titulo: 'Divida entre sócios automaticamente',
    texto:
      'Casa, produtor parceiro e artista podem receber cada um a sua parte na própria venda. Ninguém precisa confiar em ninguém para repassar depois.',
  },
  {
    titulo: 'Portaria que funciona sem internet',
    texto:
      'O celular baixa a lista assinada antes de abrir os portões e valida no local. Ingresso repetido é barrado com a hora e o nome de quem passou primeiro.',
  },
  {
    titulo: 'Lista de convidados no sistema',
    texto:
      'Cota por promoter, busca por nome na porta e contagem de quem entrou. A lista sai do papel e do grupo de WhatsApp.',
  },
  {
    titulo: 'Taxa transparente, do seu jeito',
    texto:
      'Você escolhe repassar a taxa ao comprador ou absorver no preço. Nos dois casos ela aparece discriminada no checkout, como manda o Código de Defesa do Consumidor.',
  },
];

export default function Publique() {
  return (
    <div className="flex min-h-dvh flex-col">
      <Suspense fallback={<div className="h-16 border-b border-line" />}>
        <Cabecalho comBusca={false} />
      </Suspense>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
          Para produtores
        </p>
        <h1 className="mt-3 max-w-2xl text-2xl font-bold leading-tight sm:text-3xl">
          Venda seus ingressos sem abrir mão do controle
        </h1>
        <p className="prosa mt-4 text-muted">
          Feito para casa noturna e produtor de festa: venda antecipada, bilheteria na porta,
          lista de convidados e repasse rápido, tudo no mesmo lugar.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/entrar?cadastro=1"
            className="rounded-botao bg-accent px-6 py-3 font-semibold text-accent-txt"
          >
            Quero vender
          </Link>
          <Link
            href="/"
            className="rounded-botao border border-line-forte px-6 py-3 font-medium transition hover:border-accent hover:text-accent"
          >
            Ver eventos à venda
          </Link>
        </div>

        <ul className="mt-14 grid gap-x-8 gap-y-10 sm:grid-cols-2">
          {DIFERENCIAIS.map((d) => (
            <li key={d.titulo}>
              <h2 className="font-titulo text-base font-bold">{d.titulo}</h2>
              <p className="prosa mt-2 text-sm text-muted">{d.texto}</p>
            </li>
          ))}
        </ul>

        <section className="mt-16 rounded-cartao border border-line bg-raised px-6 py-8">
          <h2 className="font-titulo text-lg font-bold">Como funciona a taxa</h2>
          <p className="prosa mt-2 text-sm text-muted">
            A taxa é combinada com você e configurada por evento — não é a mesma para todo mundo,
            e não fica escondida no código. No checkout, o comprador vê o preço do ingresso e a
            taxa em linhas separadas.
          </p>
          <p className="prosa mt-3 text-sm text-muted">
            Se o comprador desistir dentro dos 7 dias que a lei garante, devolvemos tudo, taxa
            incluída. É a posição mais segura para você e para nós.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="font-titulo text-lg font-bold">Ainda em construção</h2>
          <p className="prosa mt-2 text-sm text-muted">
            A plataforma está em desenvolvimento e opera hoje em ambiente de testes, com
            pagamento simulado. Os primeiros eventos reais serão do próprio grupo — se algo
            falhar, o prejuízo é de casa, não do cliente.
          </p>
        </section>
      </main>

      <Rodape />
    </div>
  );
}
