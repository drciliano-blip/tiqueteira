import { describe, expect, it } from 'vitest';

import {
  apontaParaNos,
  baseDoTenant,
  ehHostDaPlataforma,
  ehHostname,
  instrucaoDeDns,
  normalizarDominio,
  validarDominio,
} from '@/domain/dominio';

const CANONICO = ['yourticket.com.br'];

/**
 * O roteamento por hostname é a peça mais perigosa desta feature: um erro
 * aqui não quebra uma tela, quebra o site inteiro para todo mundo. Por isso
 * os testes insistem no lado conservador — na dúvida, não reescreve.
 */

describe('slug ou hostname', () => {
  it('slug de produtor nunca tem ponto', () => {
    expect(ehHostname('complexo-jussara')).toBe(false);
    expect(ehHostname('acasa')).toBe(false);
  });

  it('hostname sempre tem', () => {
    expect(ehHostname('ingressos.acasa.com.br')).toBe(true);
  });
});

describe('baseDoTenant', () => {
  it('no domínio da plataforma, o link leva o slug', () => {
    expect(baseDoTenant('acasa')).toBe('/acasa');
  });

  it('no domínio do produtor, o link não leva nada', () => {
    // Montar link com o slug aqui mostraria o nosso nome na barra de
    // endereço — exatamente o que o produtor paga para não ver.
    expect(baseDoTenant('ingressos.acasa.com.br')).toBe('');
  });
});

describe('ehHostDaPlataforma', () => {
  it('reconhece o domínio canônico, com e sem porta', () => {
    expect(ehHostDaPlataforma('yourticket.com.br', CANONICO)).toBe(true);
    expect(ehHostDaPlataforma('YOURTICKET.COM.BR:443', CANONICO)).toBe(true);
  });

  it('reconhece desenvolvimento', () => {
    expect(ehHostDaPlataforma('localhost:3000', CANONICO)).toBe(true);
    expect(ehHostDaPlataforma('127.0.0.1:3000', CANONICO)).toBe(true);
  });

  it('reconhece a Vercel, inclusive pré-visualização', () => {
    expect(ehHostDaPlataforma('tiqueteira.vercel.app', CANONICO)).toBe(true);
    expect(ehHostDaPlataforma('tiqueteira-git-abc-eu.vercel.app', CANONICO)).toBe(true);
  });

  it('não confunde domínio de produtor com o nosso', () => {
    expect(ehHostDaPlataforma('ingressos.acasa.com.br', CANONICO)).toBe(false);
  });

  it('não cai em domínio que só TERMINA parecido', () => {
    // `falsotiqueteira.com.br` não é `tiqueteira.com.br`.
    expect(ehHostDaPlataforma('falsoyourticket.com.br', CANONICO)).toBe(false);
  });
});

describe('normalizarDominio', () => {
  it('aguenta o que o produtor cola no campo', () => {
    expect(normalizarDominio('  HTTPS://Ingressos.ACasa.com.br/eventos  ')).toBe(
      'ingressos.acasa.com.br',
    );
  });

  it('tira porta e ponto final', () => {
    expect(normalizarDominio('acasa.com.br:443')).toBe('acasa.com.br');
    expect(normalizarDominio('acasa.com.br.')).toBe('acasa.com.br');
  });
});

describe('validarDominio', () => {
  it('aceita subdomínio comum', () => {
    expect(validarDominio('ingressos.acasa.com.br', CANONICO)).toEqual({
      valido: true,
      dominio: 'ingressos.acasa.com.br',
    });
  });

  it('recusa vazio', () => {
    expect(validarDominio('   ', CANONICO)).toMatchObject({ motivo: 'vazio' });
  });

  it('recusa nome sem ponto', () => {
    expect(validarDominio('acasa', CANONICO)).toMatchObject({ motivo: 'sem_ponto' });
  });

  it('recusa IP', () => {
    // Certificado é emitido para um nome, não para um número.
    expect(validarDominio('192.168.0.1', CANONICO)).toMatchObject({ motivo: 'ip' });
  });

  it('recusa caractere inválido', () => {
    expect(validarDominio('a casa.com.br', CANONICO)).toMatchObject({ motivo: 'formato' });
    expect(validarDominio('-acasa.com.br', CANONICO)).toMatchObject({ motivo: 'formato' });
  });

  it('recusa o domínio da própria plataforma', () => {
    // Um produtor apontando um subdomínio nosso para si mesmo sequestraria a
    // plataforma para quem acessasse por ali.
    expect(validarDominio('yourticket.com.br', CANONICO)).toMatchObject({
      motivo: 'nosso_dominio',
    });
    expect(validarDominio('qualquer.yourticket.com.br', CANONICO)).toMatchObject({
      motivo: 'nosso_dominio',
    });
    expect(validarDominio('produtor.vercel.app', CANONICO)).toMatchObject({
      motivo: 'nosso_dominio',
    });
  });
});

describe('instrucaoDeDns', () => {
  it('manda CNAME para subdomínio, com o nome certo', () => {
    const i = instrucaoDeDns('ingressos.acasa.com.br', 'cname.vercel-dns.com');
    expect(i).toMatchObject({ tipo: 'CNAME', nome: 'ingressos', valor: 'cname.vercel-dns.com' });
    expect(i.aviso).toBeNull();
  });

  it('avisa que CNAME na raiz não existe', () => {
    // Regra do DNS, não limitação nossa. Sem esse aviso o produtor tenta,
    // falha, e o suporte vira nosso.
    const i = instrucaoDeDns('acasa.com.br', 'cname.vercel-dns.com');
    expect(i.tipo).toBe('ALIAS');
    expect(i.aviso).toContain('ingressos.acasa.com.br');
  });

  it('trata .com igual a .com.br na detecção de raiz', () => {
    expect(instrucaoDeDns('acasa.com', 'alvo').tipo).toBe('ALIAS');
    expect(instrucaoDeDns('ingressos.acasa.com', 'alvo').tipo).toBe('CNAME');
  });
});

describe('apontaParaNos', () => {
  it('aceita o ponto final que o DNS devolve', () => {
    // `cname.vercel-dns.com.` e `cname.vercel-dns.com` são o mesmo registro.
    // Reprovar por causa do ponto seria suporte inventado.
    expect(apontaParaNos(['cname.vercel-dns.com.'], 'cname.vercel-dns.com')).toBe(true);
  });

  it('ignora caixa', () => {
    expect(apontaParaNos(['CNAME.Vercel-DNS.com'], 'cname.vercel-dns.com')).toBe(true);
  });

  it('recusa quando aponta para outro lugar', () => {
    expect(apontaParaNos(['outra-coisa.com'], 'cname.vercel-dns.com')).toBe(false);
  });

  it('recusa quando não há registro nenhum', () => {
    expect(apontaParaNos([], 'cname.vercel-dns.com')).toBe(false);
  });
});

describe('www', () => {
  it('www do domínio canônico é a plataforma, não um produtor', () => {
    // Sem isto, quem digita `www.` cai na busca por um produtor com esse
    // domínio e leva 404 — sem ter como saber que o problema foi o `www`.
    expect(ehHostDaPlataforma('www.yourticket.com.br', CANONICO)).toBe(true);
  });

  it('funciona também quando o canônico é que tem www', () => {
    expect(ehHostDaPlataforma('yourticket.com.br', ['www.yourticket.com.br'])).toBe(true);
  });

  it('reconhece qualquer host da lista, não só o primeiro', () => {
    // É o que torna a virada de DNS um não-evento: a variável ainda aponta
    // para o endereço antigo, e o domínio novo já é reconhecido como nosso.
    const duasFontes = ['tiqueteira.vercel.app', 'yourticket.com.br'];
    expect(ehHostDaPlataforma('yourticket.com.br', duasFontes)).toBe(true);
    expect(ehHostDaPlataforma('tiqueteira.vercel.app', duasFontes)).toBe(true);
    expect(ehHostDaPlataforma('acasa.com.br', duasFontes)).toBe(false);
  });

  it('não confunde www de outro domínio', () => {
    expect(ehHostDaPlataforma('www.acasa.com.br', CANONICO)).toBe(false);
  });
});
