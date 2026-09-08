/**
 * Limite de tentativas — plano, seção 14.
 *
 * O teste que importa é o da concorrência: em serverless, várias requisições
 * chegam ao mesmo tempo em processos diferentes. Se a contagem não for atômica
 * no banco, todas leem o mesmo valor e todas passam — que é exatamente o
 * cenário do ataque.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import {
  limparTentativas,
  mensagemDeEspera,
  registrarTentativa,
  REGRAS,
} from '@/lib/rate-limit';

const DIRECT_URL = process.env.DIRECT_URL;
if (!DIRECT_URL) throw new Error('DIRECT_URL é obrigatória');

const conexao = postgres(DIRECT_URL, { max: 2, prepare: false });
const db = drizzle(conexao);

let sufixo: string;

beforeEach(() => {
  sufixo = `t${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
});

afterAll(async () => {
  await db.execute(sql`delete from rate_limits where chave like ${'%t17%'}`);
  await conexao.end();
});

describe('contagem', () => {
  it('permite até o limite e recusa depois', async () => {
    const alvo = `${sufixo}@teste.local`;
    const { limite } = REGRAS.login;

    for (let i = 1; i <= limite; i++) {
      const r = await registrarTentativa('login', alvo);
      expect(r.permitido, `tentativa ${i}`).toBe(true);
      expect(r.restantes).toBe(limite - i);
    }

    const excedente = await registrarTentativa('login', alvo);
    expect(excedente.permitido).toBe(false);
    expect(excedente.esperarSegundos).toBeGreaterThan(0);
  });

  it('conta separado por identificador', async () => {
    await registrarTentativa('login', `a-${sufixo}`);
    const outro = await registrarTentativa('login', `b-${sufixo}`);
    expect(outro.restantes).toBe(REGRAS.login.limite - 1);
  });

  it('conta separado por ação', async () => {
    const alvo = `${sufixo}@teste.local`;
    await registrarTentativa('login', alvo);
    const pedido = await registrarTentativa('criarPedido', alvo);
    expect(pedido.restantes).toBe(REGRAS.criarPedido.limite - 1);
  });

  it('login bem-sucedido zera a contagem', async () => {
    const alvo = `${sufixo}@teste.local`;
    await registrarTentativa('login', alvo);
    await registrarTentativa('login', alvo);

    await limparTentativas('login', alvo);

    const depois = await registrarTentativa('login', alvo);
    expect(depois.restantes).toBe(REGRAS.login.limite - 1);
  });

  it('não diferencia maiúsculas — senão trocar a caixa fura o limite', async () => {
    const alvo = `Ana-${sufixo}@Teste.Local`;
    await registrarTentativa('login', alvo);
    const r = await registrarTentativa('login', alvo.toLowerCase());
    expect(r.restantes).toBe(REGRAS.login.limite - 2);
  });
});

describe('concorrência', () => {
  it('20 tentativas simultâneas não furam o limite', async () => {
    /**
     * O cenário real do ataque: várias requisições ao mesmo tempo, em
     * processos diferentes. Com leitura seguida de escrita, todas leriam o
     * mesmo contador e todas passariam.
     */
    const alvo = `simultaneo-${sufixo}`;
    const { limite } = REGRAS.criarPedido;

    const resultados = await Promise.all(
      Array.from({ length: 20 }, () => registrarTentativa('criarPedido', alvo)),
    );

    const permitidas = resultados.filter((r) => r.permitido).length;
    expect(permitidas).toBe(limite);
  });
});

describe('mensagem', () => {
  it('fala em minutos, sem expor o mecanismo', () => {
    expect(mensagemDeEspera(30)).toContain('1 minuto');
    expect(mensagemDeEspera(600)).toContain('10 minutos');
    expect(mensagemDeEspera(0)).toContain('1 minuto');
  });
});
