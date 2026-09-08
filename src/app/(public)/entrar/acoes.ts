'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { serviceDb } from '@/db/client';
import { users } from '@/db/schema';
import { createSession, SESSION_TTL_MS, verifyPassword } from '@/lib/auth';
import { limparTentativas, mensagemDeEspera, registrarTentativa } from '@/lib/rate-limit';
import { setSessionCookie } from '@/lib/session-cookie';

/**
 * Login por e-mail e senha — produtor, operador e admin.
 *
 * O comprador NÃO passa por aqui: ele compra sem conta e acessa os ingressos
 * por link mágico (benchmark, seção 3). Senha só existe onde a conta é
 * permanente e o risco é outro.
 */

const Credenciais = z.object({
  email: z.email('Informe um e-mail válido.'),
  senha: z.string().min(1, 'Informe a senha.'),
});

export type EstadoLogin = { erro?: string };

export async function entrarComSenha(
  _anterior: EstadoLogin,
  formData: FormData,
): Promise<EstadoLogin> {
  const dados = Credenciais.safeParse({
    email: formData.get('email'),
    senha: formData.get('senha'),
  });

  if (!dados.success) {
    return { erro: dados.error.issues[0]?.message ?? 'Dados inválidos.' };
  }

  const cabecalhosLimite = await headers();
  const ipLimite =
    cabecalhosLimite.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    cabecalhosLimite.get('x-real-ip') ??
    'sem-ip';

  /**
   * Duas contagens: por e-mail e por origem. Só a primeira deixaria o
   * atacante variar o e-mail; só a segunda puniria a rede compartilhada de
   * um escritório inteiro.
   */
  for (const alvo of [dados.data.email, ipLimite]) {
    const limite = await registrarTentativa('login', alvo);
    if (!limite.permitido) {
      return { erro: mensagemDeEspera(limite.esperarSegundos) };
    }
  }

  const db = serviceDb();
  const [usuario] = await db
    .select({
      id: users.id,
      senhaHash: users.senhaHash,
      status: users.status,
    })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${dados.data.email})`)
    .limit(1);

  /**
   * Mensagem única para e-mail inexistente e senha errada. Diferenciar as duas
   * entrega ao atacante a lista de quem tem conta — e essa lista é o primeiro
   * passo de qualquer ataque de credencial.
   */
  const GENERICO = { erro: 'E-mail ou senha incorretos.' };

  if (!usuario?.senhaHash) {
    // Verificação falsa para gastar o mesmo tempo de um login real: sem isto,
    // a diferença de tempo de resposta revela quais e-mails existem.
    await verifyPassword(
      '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0$0000000000000000000000000000000000000000000',
      dados.data.senha,
    );
    return GENERICO;
  }

  const confere = await verifyPassword(usuario.senhaHash, dados.data.senha);
  if (!confere) return GENERICO;
  if (usuario.status !== 'ativo') {
    return { erro: 'Esta conta está bloqueada. Fale com o suporte.' };
  }

  const cabecalhos = await headers();
  const sessao = await createSession({
    userId: usuario.id,
    ttlMs: SESSION_TTL_MS.painel,
    ipAddress:
      cabecalhos.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      cabecalhos.get('x-real-ip'),
    userAgent: cabecalhos.get('user-agent'),
  });

  // Login certo zera a contagem: quem lembrou a senha não fica de castigo.
  await limparTentativas('login', dados.data.email);

  await setSessionCookie(sessao.token, sessao.expiraEm);
  await db.update(users).set({ ultimoLoginEm: new Date() }).where(eq(users.id, usuario.id));

  redirect('/painel');
}

export async function sair(): Promise<void> {
  const { clearSessionCookie, readSessionToken } = await import('@/lib/session-cookie');
  const { revokeSession } = await import('@/lib/auth');

  const token = await readSessionToken();
  if (token) await revokeSession(token);
  await clearSessionCookie();

  redirect('/');
}
