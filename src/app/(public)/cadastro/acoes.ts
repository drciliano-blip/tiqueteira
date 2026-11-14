'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { serviceDb } from '@/db/client';
import { auditLog, memberships, tenants, users } from '@/db/schema';
import { createSession, hashPassword, SESSION_TTL_MS } from '@/lib/auth';
import { mensagemDeEspera, registrarTentativa } from '@/lib/rate-limit';
import { setSessionCookie } from '@/lib/session-cookie';

export type EstadoCadastro = { erro?: string };

const Cadastro = z.object({
  casa: z.string().trim().min(2, 'Informe o nome da casa ou da produtora.').max(80),
  nome: z
    .string()
    .trim()
    .min(3, 'Informe seu nome completo.')
    .max(120)
    .refine((n) => n.includes(' '), 'Informe nome e sobrenome.'),
  email: z.email('Informe um e-mail válido.').max(160),
  telefone: z
    .string()
    .transform((t) => t.replace(/\D/g, ''))
    .refine((t) => t.length >= 10 && t.length <= 11, 'Telefone inválido.'),
  senha: z
    .string()
    .min(10, 'A senha precisa de pelo menos 10 caracteres.')
    .max(200),
  termos: z.literal('on', 'É preciso aceitar os termos de uso.'),
});

const ROTAS_DO_SISTEMA = new Set([
  'admin', 'api', 'cadastro', 'checkout', 'como-funciona', 'e', 'entrar', 'ingresso',
  'meus-ingressos', 'painel', 'portaria', 'privacidade', 'publique', 'termos',
]);

function slugify(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Cadastro do produtor — Caminho A, argumento nº 3 (ADR-017, ADR-024).
 *
 * Cria usuário, conta e vínculo de dono numa transação só, entra direto no
 * painel e deixa o resto para a lista de primeiros passos. Taxas e prazos
 * nascem dos padrões do banco e são revistos pela plataforma.
 */
export async function cadastrarProdutor(
  _anterior: EstadoCadastro,
  formData: FormData,
): Promise<EstadoCadastro> {
  const dados = Cadastro.safeParse(Object.fromEntries(formData));
  if (!dados.success) return { erro: dados.error.issues[0]?.message ?? 'Confira os dados.' };
  const v = dados.data;

  const cab = await headers();
  const ip = cab.get('x-forwarded-for')?.split(',')[0]?.trim() ?? cab.get('x-real-ip') ?? 'sem-ip';
  const limite = await registrarTentativa('cadastro', ip);
  if (!limite.permitido) return { erro: mensagemDeEspera(limite.esperarSegundos) };

  const db = serviceDb();
  const [existe] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${v.email})`)
    .limit(1);
  if (existe) return { erro: 'Já existe uma conta com este e-mail. Entre pelo painel.' };

  const senhaHash = await hashPassword(v.senha);

  // Slug livre: o nome, ou o nome com um número. Nome que coincide com uma
  // rota do sistema deixaria a vitrine inalcançável — ganha um sufixo.
  let base = slugify(v.casa) || 'produtor';
  if (ROTAS_DO_SISTEMA.has(base)) base = `${base}-eventos`;
  const ocupados = (await db.execute(sql`
    select slug from tenants where slug = ${base} or slug like ${`${base}-%`}
  `)) as unknown as { slug: string }[];
  const usados = new Set(ocupados.map((o) => o.slug));
  let slug = base;
  for (let n = 2; usados.has(slug); n++) slug = `${base}-${n}`;

  const usuarioId = await db.transaction(async (tx) => {
    const [u] = await tx
      .insert(users)
      .values({ email: v.email, nome: v.nome, senhaHash })
      .returning({ id: users.id });
    const [t] = await tx
      .insert(tenants)
      .values({ slug, nome: v.casa, email: v.email, telefone: v.telefone })
      .returning({ id: tenants.id });
    await tx.insert(memberships).values({ userId: u!.id, tenantId: t!.id, role: 'owner' });
    await tx.insert(auditLog).values({
      tenantId: t!.id,
      userId: u!.id,
      acao: 'conta_criada',
      entidade: 'tenants',
      entidadeId: t!.id,
      depois: { slug, origem: 'cadastro', termosAceitosEm: new Date().toISOString() },
      ip,
      userAgent: cab.get('user-agent'),
    });
    return u!.id;
  });

  const sessao = await createSession({
    userId: usuarioId,
    ttlMs: SESSION_TTL_MS.painel,
    ipAddress: ip,
    userAgent: cab.get('user-agent'),
  });
  await setSessionCookie(sessao.token, sessao.expiraEm);

  redirect('/painel');
}
