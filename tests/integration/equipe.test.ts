/**
 * Equipe do produtor.
 *
 * O que esta suíte protege é o acesso à porta. Quem tem papel de portaria
 * pode liberar entrada, e cada pessoa que entra sem pagar é um ingresso a
 * menos vendido — então tirar alguém da equipe precisa derrubar o aparelho
 * dela junto, e o escopo de evento precisa mesmo prender.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { createSession, papelNoTenant, resolveSession } from '@/lib/auth';
import {
  adicionarNaEquipe,
  derrubarSessoes,
  equipeDoTenant,
  removerDaEquipe,
  senhaTemporaria,
  trocarSenha,
} from '@/lib/equipe';

const DIRECT_URL = process.env.DIRECT_URL;
if (!DIRECT_URL) throw new Error('DIRECT_URL é obrigatória');

const donoSql = postgres(DIRECT_URL, { max: 2, prepare: false });
const dono = drizzle(donoSql);

let tenantId: string;
let outroTenantId: string;
let venueId: string;
let eventoA: string;
let eventoB: string;
let sufixo: string;

const emails: string[] = [];
function email(nome: string): string {
  const e = `${nome}-${sufixo}@equipe.local`;
  emails.push(e);
  return e;
}

async function criarEvento(slug: string): Promise<string> {
  const linhas = (await dono.execute(sql`
    insert into events (tenant_id, venue_id, slug, titulo, data_inicio, data_fim,
                        capacidade, status)
    values (${tenantId}, ${venueId}, ${slug + '-' + sufixo}, ${'Evento ' + slug},
            now() + interval '2 days', now() + interval '2 days 6 hours', 500, 'publicado')
    returning id
  `)) as unknown as { id: string }[];
  return linhas[0]!.id;
}

beforeAll(async () => {
  sufixo = Date.now().toString(36);

  const t = (await dono.execute(sql`
    insert into tenants (slug, nome, email)
    values (${'equipe-' + sufixo}, 'Casa da Equipe', ${'casa-' + sufixo + '@equipe.local'})
    returning id
  `)) as unknown as { id: string }[];
  tenantId = t[0]!.id;

  const o = (await dono.execute(sql`
    insert into tenants (slug, nome, email)
    values (${'vizinha-' + sufixo}, 'Casa Vizinha', ${'vizinha-' + sufixo + '@equipe.local'})
    returning id
  `)) as unknown as { id: string }[];
  outroTenantId = o[0]!.id;

  const v = (await dono.execute(sql`
    insert into venues (tenant_id, nome, capacidade_maxima)
    values (${tenantId}, 'Galpão', 500) returning id
  `)) as unknown as { id: string }[];
  venueId = v[0]!.id;

  eventoA = await criarEvento('a');
  eventoB = await criarEvento('b');
});

afterAll(async () => {
  await dono.execute(sql`delete from memberships where tenant_id in (${tenantId}, ${outroTenantId})`);
  await dono.execute(sql`delete from events where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from venues where tenant_id = ${tenantId}`);
  await dono.execute(sql`delete from tenants where id in (${tenantId}, ${outroTenantId})`);
  for (const e of emails) {
    await dono.execute(sql`delete from users where lower(email) = ${e.toLowerCase()}`);
  }
  await donoSql.end();
});

// ---------------------------------------------------------------------------

describe('senha temporária', () => {
  it('não usa caractere que se confunde ao ditar por telefone', () => {
    // Quem digita isto é a pessoa da portaria, no escuro, com fila atrás e
    // alguém ditando. Cada caractere ambíguo vira uma tentativa perdida.
    for (let i = 0; i < 200; i++) {
      expect(senhaTemporaria()).not.toMatch(/[0O1lI]/);
    }
  });

  it('vem em blocos legíveis e não se repete', () => {
    const s = senhaTemporaria();
    expect(s).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const muitas = new Set(Array.from({ length: 200 }, () => senhaTemporaria()));
    expect(muitas.size).toBe(200);
  });
});

describe('adicionar', () => {
  it('cria a conta e devolve a senha uma vez', async () => {
    const r = await adicionarNaEquipe({
      tenantId,
      nome: 'Rita Portaria',
      email: email('rita'),
      role: 'portaria',
      eventoId: eventoA,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inesperado');
    expect(r.jaExistia).toBe(false);
    expect(r.senha).toMatch(/^[A-Z2-9]{4}-/);
  });

  it('reaproveita quem já tem conta, sem trocar a senha dela', async () => {
    const e = email('paulo');
    await adicionarNaEquipe({ tenantId, nome: 'Paulo', email: e, role: 'operador', eventoId: null });

    // A mesma pessoa, agora também na portaria de outro evento.
    const r = await adicionarNaEquipe({
      tenantId,
      nome: 'Paulo',
      email: e,
      role: 'portaria',
      eventoId: eventoB,
    });

    expect(r).toMatchObject({ ok: true, jaExistia: true, senha: null });
  });

  it('recusa o mesmo acesso duas vezes', async () => {
    const e = email('duplicada');
    await adicionarNaEquipe({ tenantId, nome: 'Dupla', email: e, role: 'portaria', eventoId: eventoA });

    const r = await adicionarNaEquipe({
      tenantId,
      nome: 'Dupla',
      email: e,
      role: 'portaria',
      eventoId: eventoA,
    });

    expect(r).toMatchObject({ ok: false });
  });

  it('normaliza o e-mail, para não criar duas contas da mesma pessoa', async () => {
    const e = email('maiuscula');
    await adicionarNaEquipe({ tenantId, nome: 'Ana', email: e.toUpperCase(), role: 'operador', eventoId: null });

    const r = await adicionarNaEquipe({
      tenantId,
      nome: 'Ana',
      email: e,
      role: 'portaria',
      eventoId: eventoA,
    });

    expect(r).toMatchObject({ ok: true, jaExistia: true });
  });
});

describe('escopo de evento', () => {
  it('portaria presa a um evento não vale no outro', async () => {
    const e = email('escopada');
    await adicionarNaEquipe({ tenantId, nome: 'Escopada', email: e, role: 'portaria', eventoId: eventoA });

    const [pessoa] = (await dono.execute(sql`
      select id from users where lower(email) = ${e.toLowerCase()}
    `)) as unknown as { id: string }[];

    const sessao = await createSession({ userId: pessoa!.id, tenantId });
    const ctx = await resolveSession(sessao.token);
    if (!ctx) throw new Error('sessão não resolveu');

    expect(papelNoTenant(ctx, tenantId, eventoA)).toBe('portaria');
    expect(papelNoTenant(ctx, tenantId, eventoB)).toBeNull();
    // E não vale nada na casa vizinha.
    expect(papelNoTenant(ctx, outroTenantId, eventoA)).toBeNull();
  });
});

describe('tirar o acesso', () => {
  it('remover derruba os aparelhos de quem não tem mais vínculo', async () => {
    const e = email('demitida');
    await adicionarNaEquipe({ tenantId, nome: 'Demitida', email: e, role: 'portaria', eventoId: eventoA });

    const [pessoa] = (await dono.execute(sql`
      select id from users where lower(email) = ${e.toLowerCase()}
    `)) as unknown as { id: string }[];

    const sessao = await createSession({ userId: pessoa!.id, tenantId });
    expect(await resolveSession(sessao.token)).not.toBeNull();

    const equipe = await equipeDoTenant(tenantId);
    const alvo = equipe.find((p) => p.email === e.toLowerCase());
    expect(alvo?.sessoesAtivas).toBe(1);

    expect(await removerDaEquipe(tenantId, alvo!.membershipId)).toBe(true);

    // O celular da portaria dela não pode continuar logado.
    expect(await resolveSession(sessao.token)).toBeNull();
  });

  it('quem ainda tem outro vínculo continua conectado', async () => {
    // Tirar alguém da portaria de um evento não pode derrubá-lo do painel.
    const e = email('dois-vinculos');
    await adicionarNaEquipe({ tenantId, nome: 'Dois', email: e, role: 'operador', eventoId: null });
    await adicionarNaEquipe({ tenantId, nome: 'Dois', email: e, role: 'portaria', eventoId: eventoA });

    const [pessoa] = (await dono.execute(sql`
      select id from users where lower(email) = ${e.toLowerCase()}
    `)) as unknown as { id: string }[];

    const sessao = await createSession({ userId: pessoa!.id, tenantId });

    const equipe = await equipeDoTenant(tenantId);
    const vinculoPortaria = equipe.find(
      (p) => p.email === e.toLowerCase() && p.role === 'portaria',
    );

    await removerDaEquipe(tenantId, vinculoPortaria!.membershipId);

    expect(await resolveSession(sessao.token)).not.toBeNull();
  });

  it('desconectar tira o aparelho sem tirar o acesso', async () => {
    // Celular perdido no meio da festa: a pessoa continua na equipe.
    const e = email('perdeu-o-celular');
    await adicionarNaEquipe({ tenantId, nome: 'Perdeu', email: e, role: 'portaria', eventoId: eventoA });

    const [pessoa] = (await dono.execute(sql`
      select id from users where lower(email) = ${e.toLowerCase()}
    `)) as unknown as { id: string }[];

    const sessao = await createSession({ userId: pessoa!.id, tenantId });
    const equipe = await equipeDoTenant(tenantId);
    const alvo = equipe.find((p) => p.email === e.toLowerCase());

    expect(await derrubarSessoes(tenantId, alvo!.membershipId)).toBe(1);
    expect(await resolveSession(sessao.token)).toBeNull();

    // Continua na equipe: pode entrar de novo com a senha dela.
    const aindaNaEquipe = await equipeDoTenant(tenantId);
    expect(aindaNaEquipe.some((p) => p.email === e.toLowerCase())).toBe(true);
  });

  it('trocar a senha derruba o que estava aberto', async () => {
    const e = email('trocou');
    await adicionarNaEquipe({ tenantId, nome: 'Trocou', email: e, role: 'portaria', eventoId: eventoA });

    const [pessoa] = (await dono.execute(sql`
      select id from users where lower(email) = ${e.toLowerCase()}
    `)) as unknown as { id: string }[];

    const sessao = await createSession({ userId: pessoa!.id, tenantId });
    const equipe = await equipeDoTenant(tenantId);
    const alvo = equipe.find((p) => p.email === e.toLowerCase());

    const nova = await trocarSenha(tenantId, alvo!.membershipId);
    expect(nova).toMatch(/^[A-Z2-9]{4}-/);
    expect(await resolveSession(sessao.token)).toBeNull();
  });

  it('não deixa a casa vizinha mexer na minha equipe', async () => {
    const e = email('minha');
    await adicionarNaEquipe({ tenantId, nome: 'Minha', email: e, role: 'portaria', eventoId: eventoA });

    const equipe = await equipeDoTenant(tenantId);
    const alvo = equipe.find((p) => p.email === e.toLowerCase());

    expect(await removerDaEquipe(outroTenantId, alvo!.membershipId)).toBe(false);
    expect(await trocarSenha(outroTenantId, alvo!.membershipId)).toBeNull();
    expect(await derrubarSessoes(outroTenantId, alvo!.membershipId)).toBeNull();
  });
});

describe('listagem', () => {
  it('mostra o evento a que o acesso de portaria está preso', async () => {
    const e = email('listada');
    await adicionarNaEquipe({ tenantId, nome: 'Listada', email: e, role: 'portaria', eventoId: eventoB });

    const equipe = await equipeDoTenant(tenantId);
    const alvo = equipe.find((p) => p.email === e.toLowerCase() && p.eventoId === eventoB);

    expect(alvo?.eventoTitulo).toBe('Evento b');
  });

  it('não vaza a equipe da casa vizinha', async () => {
    const e = email('vizinha-gente');
    await adicionarNaEquipe({
      tenantId: outroTenantId,
      nome: 'Da Vizinha',
      email: e,
      role: 'operador',
      eventoId: null,
    });

    const minha = await equipeDoTenant(tenantId);
    expect(minha.some((p) => p.email === e.toLowerCase())).toBe(false);
  });
});
