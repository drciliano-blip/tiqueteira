import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { assinarSessaoComprador, lerSessaoComprador } from '@/lib/buyer-session';

const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres';
const OUTRO = 'outro-segredo-com-mais-de-32-caracteres-aq';

describe('sessão do comprador', () => {
  it('vai e volta com o mesmo e-mail', () => {
    const cookie = assinarSessaoComprador('Carla@Exemplo.com.br', SEGREDO);
    expect(lerSessaoComprador(cookie, SEGREDO)).toBe('carla@exemplo.com.br');
  });

  it('recusa cookie assinado com outro segredo', () => {
    const cookie = assinarSessaoComprador('carla@exemplo.com.br', OUTRO);
    expect(lerSessaoComprador(cookie, SEGREDO)).toBeNull();
  });

  it('recusa troca do e-mail no cookie', () => {
    // É o ataque óbvio: editar o cookie para ver o ingresso de outra pessoa.
    const cookie = assinarSessaoComprador('carla@exemplo.com.br', SEGREDO);
    const partes = cookie.split('.');
    const outroEmail = Buffer.from('vitima@exemplo.com.br', 'utf8').toString('base64url');
    const forjado = `${outroEmail}.${partes[1]}.${partes[2]}`;

    expect(lerSessaoComprador(forjado, SEGREDO)).toBeNull();
  });

  it('recusa prorrogação da validade', () => {
    const cookie = assinarSessaoComprador('carla@exemplo.com.br', SEGREDO);
    const partes = cookie.split('.');
    const futuro = Date.now() + 10 * 365 * 24 * 3600 * 1000;

    expect(lerSessaoComprador(`${partes[0]}.${futuro}.${partes[2]}`, SEGREDO)).toBeNull();
  });

  it('recusa cookie vencido', () => {
    const emailB64 = Buffer.from('carla@exemplo.com.br', 'utf8').toString('base64url');
    const passado = Date.now() - 1000;
    const dados = `${emailB64}.${passado}`;
    // Assinatura legítima, mas a data já passou.
    const assinatura = createHmac('sha256', SEGREDO).update(dados).digest('base64url');

    expect(lerSessaoComprador(`${dados}.${assinatura}`, SEGREDO)).toBeNull();
  });

  it('recusa lixo', () => {
    for (const lixo of ['', 'abc', 'a.b', 'a.b.c.d', '..']) {
      expect(lerSessaoComprador(lixo, SEGREDO)).toBeNull();
    }
    expect(lerSessaoComprador(undefined, SEGREDO)).toBeNull();
  });
});
