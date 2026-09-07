/**
 * Fábrica e registro de PSP — plano, seção 9.2, regra 5.
 *
 * Duas responsabilidades, ambas de inicialização:
 *   1. escolher o adaptador conforme PAYMENT_PROVIDER;
 *   2. conferir que ele tem as capacidades que o produto exige, e falhar
 *      ruidosamente se não tiver.
 *
 * O segundo ponto é o que evita a pior falha possível: descobrir que a PSP não
 * segura saldo condicional só no dia do primeiro repasse, com o dinheiro do
 * produtor já dentro dela.
 */
import { FakeProvider } from './fake';
import type { PaymentProvider, ProviderCapabilities } from './types';

/**
 * O que o produto não abre mão.
 *
 * `conditionalRelease` sustenta a reserva de garantia (plano, seção 3.4) —
 * sem ela, ou a plataforma libera 100% na hora e come o chargeback, ou passa a
 * custodiar dinheiro, o que a regra nº 1 proíbe.
 *
 * `absoluteSplitAmounts` porque o cálculo de taxa é nosso e chega em centavos
 * fechados; PSP que só aceita percentual reintroduz arredondamento fora do
 * nosso controle.
 */
export const CAPACIDADES_EXIGIDAS = [
  'conditionalRelease',
  'absoluteSplitAmounts',
  'pixRefundApi',
  'chargebackWebhook',
] as const satisfies readonly (keyof ProviderCapabilities)[];

export class ProviderCapabilityError extends Error {
  constructor(
    readonly providerName: string,
    readonly faltando: readonly string[],
  ) {
    super(
      `PSP "${providerName}" não atende ao exigido pelo produto: ${faltando.join(', ')}. ` +
        'Ver docs/plano.md, seção 9.2. Não suba assim.',
    );
    this.name = 'ProviderCapabilityError';
  }
}

export function conferirCapacidades(provider: PaymentProvider): void {
  const faltando = CAPACIDADES_EXIGIDAS.filter((c) => provider.capabilities[c] !== true);
  if (faltando.length > 0) {
    throw new ProviderCapabilityError(provider.name, faltando);
  }
  if (provider.capabilities.maxCardInstallments < 1) {
    throw new ProviderCapabilityError(provider.name, ['maxCardInstallments']);
  }
}

let instancia: PaymentProvider | null = null;

export function criarProvider(
  nome: string,
  opcoes: { webhookSecret?: string; producao?: boolean } = {},
): PaymentProvider {
  const producao = opcoes.producao ?? process.env.NODE_ENV === 'production';

  if (nome === 'fake') {
    // Regra do plano, seção 15. Vale mesmo com o resto do ambiente correto.
    if (producao) {
      throw new Error(
        'PAYMENT_PROVIDER=fake é proibido em produção. Configure a PSP real antes de subir.',
      );
    }
    const p = new FakeProvider(opcoes.webhookSecret ?? 'fake-webhook-secret');
    conferirCapacidades(p);
    return p;
  }

  throw new Error(
    `PSP desconhecida: "${nome}". Adaptadores disponíveis: fake. ` +
      'O adaptador real entra na Fase 2 — ver docs/plano.md, seção 19.',
  );
}

/** Instância única do processo. */
export function getPaymentProvider(): PaymentProvider {
  if (!instancia) {
    instancia = criarProvider(process.env.PAYMENT_PROVIDER ?? 'fake', {
      ...(process.env.PAYMENT_WEBHOOK_SECRET
        ? { webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET }
        : {}),
    });
  }
  return instancia;
}

/** Só para teste: descarta a instância memorizada. */
export function resetPaymentProvider(): void {
  instancia = null;
}
