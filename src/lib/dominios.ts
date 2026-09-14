/**
 * Domínio próprio do produtor — ADR-018.
 *
 * A verificação por DNS é o que separa "escrevi um domínio no campo" de "este
 * domínio é meu". Sem ela, qualquer pessoa digitaria o domínio de outro
 * produtor no próprio cadastro e passaria a servir a vitrine alheia — ou, pior,
 * apontaria um domínio que não controla para nós e nos deixaria servindo
 * conteúdo num endereço de terceiro.
 *
 * O que prova posse é o CNAME: só quem tem acesso ao painel de DNS do domínio
 * consegue criar o registro apontando para nós.
 */
import 'server-only';

import { promises as dns } from 'node:dns';

import { and, eq, ne } from 'drizzle-orm';

import { serviceDb } from '@/db/client';
import { tenants } from '@/db/schema';
import {
  apontaParaNos,
  instrucaoDeDns,
  validarDominio,
  type InstrucaoDns,
} from '@/domain/dominio';
import { invalidarCachePublico, invalidarDominio } from '@/lib/cache-publico';
import { env } from '@/lib/env';
import { OPERADOR } from '@/lib/operador';

/**
 * Para onde o produtor aponta o CNAME.
 *
 * Na Vercel é sempre este endereço, para qualquer projeto. Fica aqui como
 * constante e não como variável de ambiente porque mudá-lo quebraria todos os
 * domínios já verificados — é decisão de infraestrutura, não configuração.
 */
export const ALVO_CNAME = 'cname.vercel-dns.com';

/** Ver `ehHostDaPlataforma`: o domínio institucional entra junto da variável. */
function hostsDaPlataforma(): string[] {
  return [new URL(env().NEXT_PUBLIC_APP_URL).host, OPERADOR.dominio];
}

export type EstadoDominio = {
  dominio: string | null;
  verificado: boolean;
  instrucao: InstrucaoDns | null;
  alvo: string;
};

export async function dominioDoTenant(tenantId: string): Promise<EstadoDominio> {
  const [linha] = await serviceDb()
    .select({
      dominio: tenants.dominioCustomizado,
      verificado: tenants.dominioVerificado,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  const dominio = linha?.dominio ?? null;

  return {
    dominio,
    verificado: linha?.verificado ?? false,
    instrucao: dominio ? instrucaoDeDns(dominio, ALVO_CNAME) : null,
    alvo: ALVO_CNAME,
  };
}

export type ResultadoDominio =
  | { ok: true; estado: EstadoDominio }
  | { ok: false; erro: string };

/**
 * Grava o domínio. **Sempre como não verificado.**
 *
 * Trocar o domínio derruba a verificação anterior, e tem que derrubar: o
 * registro de DNS do domínio novo ainda não existe, e manter o selo de
 * verificado faria a plataforma servir a vitrine num endereço que ninguém
 * provou controlar.
 */
export async function definirDominio(
  tenantId: string,
  bruto: string,
): Promise<ResultadoDominio> {
  const validacao = validarDominio(bruto, hostsDaPlataforma());
  if (!validacao.valido) return { ok: false, erro: validacao.explicacao };

  const { dominio } = validacao;

  const anterior = (await dominioDoTenant(tenantId)).dominio;

  const [emUso] = await serviceDb()
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.dominioCustomizado, dominio), ne(tenants.id, tenantId)))
    .limit(1);

  if (emUso) {
    return { ok: false, erro: 'Este domínio já está em uso por outro produtor.' };
  }

  await serviceDb()
    .update(tenants)
    .set({ dominioCustomizado: dominio, dominioVerificado: false, atualizadoEm: new Date() })
    .where(eq(tenants.id, tenantId));

  invalidarCachePublico(tenantId);
  invalidarDominio(anterior, dominio);

  return { ok: true, estado: await dominioDoTenant(tenantId) };
}

export async function removerDominio(tenantId: string): Promise<EstadoDominio> {
  const anterior = (await dominioDoTenant(tenantId)).dominio;

  await serviceDb()
    .update(tenants)
    .set({ dominioCustomizado: null, dominioVerificado: false, atualizadoEm: new Date() })
    .where(eq(tenants.id, tenantId));

  invalidarCachePublico(tenantId);
  invalidarDominio(anterior);

  return dominioDoTenant(tenantId);
}

export type Verificacao =
  | { verificado: true }
  | {
      verificado: false;
      motivo: 'sem_dominio' | 'sem_registro' | 'aponta_para_outro' | 'dns_falhou';
      explicacao: string;
      encontrado: string[];
    };

/**
 * Consulta o DNS de verdade e confere se o CNAME aponta para nós.
 *
 * Propagação de DNS leva de minutos a horas, então "ainda não" é a resposta
 * normal logo depois do cadastro — e a mensagem precisa dizer isso, senão o
 * produtor acha que errou e mexe no registro que já estava certo.
 */
export async function verificarDominio(tenantId: string): Promise<Verificacao> {
  const estado = await dominioDoTenant(tenantId);

  if (!estado.dominio) {
    return {
      verificado: false,
      motivo: 'sem_dominio',
      explicacao: 'Cadastre o domínio primeiro.',
      encontrado: [],
    };
  }

  let encontrado: string[] = [];

  try {
    encontrado = await dns.resolveCname(estado.dominio);
  } catch (e) {
    const codigo = (e as NodeJS.ErrnoException).code;

    // `ENODATA` e `ENOTFOUND` são o caso normal enquanto o DNS não propagou.
    if (codigo === 'ENODATA' || codigo === 'ENOTFOUND') {
      return {
        verificado: false,
        motivo: 'sem_registro',
        explicacao:
          'Ainda não encontrei o registro. Propagação de DNS leva de alguns ' +
          'minutos a algumas horas — se você acabou de criar, espere e tente de novo.',
        encontrado: [],
      };
    }

    return {
      verificado: false,
      motivo: 'dns_falhou',
      explicacao: 'Não consegui consultar o DNS agora. Tente de novo em instantes.',
      encontrado: [],
    };
  }

  if (!apontaParaNos(encontrado, ALVO_CNAME)) {
    return {
      verificado: false,
      motivo: 'aponta_para_outro',
      explicacao: `Encontrei o registro, mas ele aponta para outro lugar. Deve apontar para ${ALVO_CNAME}.`,
      encontrado,
    };
  }

  await serviceDb()
    .update(tenants)
    .set({ dominioVerificado: true, atualizadoEm: new Date() })
    .where(eq(tenants.id, tenantId));

  invalidarCachePublico(tenantId);
  invalidarDominio(estado.dominio);

  return { verificado: true };
}
