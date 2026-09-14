/**
 * Domínio próprio do produtor — plano, seção 20 (prompt 24), e ADR-017.
 *
 * É a peça que sustenta o argumento nº 1 do Caminho A: o produtor mantém a
 * própria marca. Sem ela, a URL continua dizendo o nosso nome, e "white-label"
 * vira conversa de reunião.
 *
 * **O truque que evita duplicar rotas inteiras:** slug de produtor nunca tem
 * ponto — o `slugify` do cadastro remove tudo que não é letra, número ou
 * hífen. Então um parâmetro de rota com ponto é, sem ambiguidade, um hostname.
 * O proxy reescreve `/e/festa` para `/casa.com.br/e/festa`, e a mesma rota
 * `[tenantSlug]` atende os dois casos.
 *
 * Função pura: não resolve DNS nem consulta banco. Quem faz isso é
 * `src/lib/dominios.ts`.
 */

/** Slug é sem ponto; hostname tem. É só isso que distingue os dois. */
export function ehHostname(parametro: string): boolean {
  return parametro.includes('.');
}

/**
 * Prefixo dos links internos da vitrine.
 *
 * No domínio da plataforma, os links levam o slug: `/acasa/e/festa`. No
 * domínio do produtor, não levam nada: `/e/festa`. Montar link com o slug no
 * domínio próprio mostraria o nosso nome na barra de endereço — que é
 * exatamente o que o produtor está pagando para não ver.
 */
export function baseDoTenant(parametro: string): string {
  return ehHostname(parametro) ? '' : `/${parametro}`;
}

/**
 * Hosts que NUNCA são domínio de produtor.
 *
 * Errar para o lado de não reescrever é barato: o site funciona pelo caminho
 * normal. Errar para o outro lado derruba a plataforma inteira, porque toda
 * requisição passaria a procurar um tenant que não existe.
 */
export function ehHostDaPlataforma(host: string, hostCanonico: string): boolean {
  const limpo = semPorta(host);

  if (limpo === semPorta(hostCanonico)) return true;
  if (limpo === 'localhost' || limpo === '127.0.0.1' || limpo === '[::1]') return true;

  // Pré-visualizações e o domínio de produção da Vercel.
  if (limpo.endsWith('.vercel.app')) return true;

  return false;
}

function semPorta(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, '');
}

/**
 * Normaliza o que o produtor digitou no campo.
 *
 * Ele vai colar `https://ingressos.acasa.com.br/` com barra no fim, ou digitar
 * com espaço, ou com maiúscula. Nada disso é erro dele: é o campo que tem que
 * aceitar.
 */
export function normalizarDominio(bruto: string): string {
  return bruto
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
}

export type MotivoDominioInvalido =
  | 'vazio'
  | 'formato'
  | 'sem_ponto'
  | 'nosso_dominio'
  | 'ip';

export type ValidacaoDominio =
  | { valido: true; dominio: string }
  | { valido: false; motivo: MotivoDominioInvalido; explicacao: string };

/** `ingressos.acasa.com.br` — letras, números, hífen e ponto. */
const FORMATO = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function validarDominio(bruto: string, hostCanonico: string): ValidacaoDominio {
  const dominio = normalizarDominio(bruto);

  if (dominio.length === 0) {
    return { valido: false, motivo: 'vazio', explicacao: 'Informe o domínio.' };
  }

  if (/^\d+\.\d+\.\d+\.\d+$/.test(dominio)) {
    return {
      valido: false,
      motivo: 'ip',
      explicacao: 'Endereço IP não serve: o certificado é emitido para um nome.',
    };
  }

  if (!dominio.includes('.')) {
    return {
      valido: false,
      motivo: 'sem_ponto',
      explicacao: 'Faltou o domínio completo, com ponto. Ex.: ingressos.suacasa.com.br',
    };
  }

  if (!FORMATO.test(dominio) || dominio.length > 253) {
    return {
      valido: false,
      motivo: 'formato',
      explicacao: 'Use só letras, números, hífen e ponto.',
    };
  }

  /**
   * Um produtor apontando um subdomínio nosso para si mesmo sequestraria a
   * plataforma para quem acessasse por ali.
   */
  const canonico = normalizarDominio(hostCanonico);
  if (dominio === canonico || dominio.endsWith('.' + canonico) || dominio.endsWith('.vercel.app')) {
    return {
      valido: false,
      motivo: 'nosso_dominio',
      explicacao: 'Este domínio é da plataforma. Use um domínio seu.',
    };
  }

  return { valido: true, dominio };
}

/**
 * O que o produtor precisa cadastrar no provedor de DNS dele.
 *
 * CNAME não é permitido na raiz de um domínio — é regra do próprio DNS, não
 * limitação nossa. Por isso a instrução muda conforme ele tenha escolhido
 * subdomínio ou raiz, e a da raiz avisa que vai precisar de ALIAS/ANAME, que
 * nem todo provedor tem (o Registro.br não tem).
 */
export type InstrucaoDns = {
  tipo: 'CNAME' | 'ALIAS';
  nome: string;
  valor: string;
  aviso: string | null;
};

export function instrucaoDeDns(dominio: string, alvo: string): InstrucaoDns {
  const partes = dominio.split('.');
  // `acasa.com.br` tem 3 partes e é raiz; `ingressos.acasa.com.br` tem 4.
  const ehRaiz = partes.length <= 2 || (partes.length === 3 && dominio.endsWith('.com.br'));

  if (ehRaiz) {
    return {
      tipo: 'ALIAS',
      nome: '@',
      valor: alvo,
      aviso:
        'CNAME não é permitido na raiz de um domínio — é regra do DNS. ' +
        'Seu provedor precisa oferecer ALIAS ou ANAME (a Cloudflare oferece; ' +
        'o Registro.br não). O caminho mais simples é usar um subdomínio, ' +
        'como ingressos.' + dominio + '.',
    };
  }

  return {
    tipo: 'CNAME',
    nome: partes[0]!,
    valor: alvo,
    aviso: null,
  };
}

/**
 * O CNAME encontrado aponta para nós?
 *
 * Compara sem distinguir maiúscula e sem o ponto final que servidores de DNS
 * costumam devolver — `cname.vercel-dns.com.` e `cname.vercel-dns.com` são o
 * mesmo registro, e reprovar por causa do ponto seria suporte inventado.
 */
export function apontaParaNos(encontrados: readonly string[], alvo: string): boolean {
  const esperado = normalizarDominio(alvo);
  return encontrados.some((e) => normalizarDominio(e) === esperado);
}
