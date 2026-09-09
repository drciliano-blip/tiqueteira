/**
 * Evento fantasma — Fase 1.5 do plano.
 *
 *   pnpm ensaio
 *
 * Monta o palco do ensaio geral: um evento fictício com ingressos já emitidos,
 * uma lista de convidados, e uma folha de QRs para imprimir. Depois disso, o
 * trabalho é físico — está escrito em `docs/ensaio.md`.
 *
 * Por que isto existe separado do `db:seed`: o seed produz dados feios de
 * propósito, para o desenvolvimento encontrar bug. O ensaio produz **uma noite
 * plausível**, porque o que ele testa não é o código — é a operação. Celular
 * lento, tela rachada, luz baixa, fila atrás, e a rede da casa caindo na hora
 * errada. Nada disso aparece em teste automatizado, e tudo isso aparece na
 * porta.
 *
 * Conecta pela URL DIRETA com o papel dono do schema, ignorando RLS. É
 * aceitável aqui pelo mesmo motivo que no seed: é ferramenta de bancada, não
 * caminho de produção.
 */
import { mkdir, writeFile } from 'node:fs/promises';

import { config } from 'dotenv';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import QRCode from 'qrcode';

import { hashPassword } from '@/lib/auth';
import { emitirTicket } from '@/lib/tickets';
import * as schema from './schema';

config({ path: '.env.local' });

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('Defina DIRECT_URL em .env.local');

const segredo = process.env.TICKET_HMAC_SECRET;
if (!segredo) throw new Error('Defina TICKET_HMAC_SECRET em .env.local');

const sql = postgres(url, { max: 1, prepare: false });
const db = drizzle(sql, { schema });

const SENHA = 'tiqueteira-dev-123';
const SLUG = 'ensaio';
const QUANTOS = 50;

/** Data no horário civil de São Paulo (UTC-3). */
function emSaoPaulo(diasAFrente: number, horaLocal: number): Date {
  const d = new Date(Date.now() + diasAFrente * 86_400_000);
  const dia = d.toISOString().slice(0, 10);
  return new Date(`${dia}T${String(horaLocal).padStart(2, '0')}:00:00-03:00`);
}

/**
 * Nomes com acento, nome composto, sobrenome comprido e dois homônimos.
 * Ensaio com "Fulano 1, Fulano 2" esconde exatamente os problemas que
 * aparecem na porta: o operador que não acha o nome porque digitou sem
 * acento, e os dois Silva que só o CPF distingue.
 */
const NOMES = [
  'Ana Beatriz Gonçalves', 'Bruno Sá', 'Carla Souza', 'Diego Martins',
  'Elisa Prado', 'Fábio Nunes', 'Gabriela Lima', 'Henrique Alves',
  'Isabela Rocha', 'João Pedro Dias', 'Karina Melo', 'Lucas Ferraz',
  'Marina Costa', 'Nelson Braga', 'Olívia Campos', 'Paulo Mendes',
  'Renata Vieira', 'Sérgio Antunes', 'Tatiane Ribeiro', 'Ulisses Barros',
  'Vanessa Kühn', 'William Sant’Anna', 'Yara D’Ávila', 'Zeca Albuquerque',
  'Maria Silva', 'Maria Silva', 'André Luiz de Oliveira Filho', 'Bianca Reis',
  'Caio Nascimento', 'Débora Xavier',
] as const;

function nomeDe(i: number): string {
  const base = NOMES[i % NOMES.length]!;
  return i < NOMES.length ? base : `${base} ${Math.floor(i / NOMES.length) + 1}`;
}

function cpfDe(i: number): string {
  return String(20000000000 + i * 7919).slice(0, 11);
}

async function main() {
  console.log('Montando o ensaio…\n');

  // ---------------------------------------------------------------------
  // Palco limpo a cada execução: o ensaio é descartável por natureza.
  // ---------------------------------------------------------------------
  const [existente] = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, SLUG))
    .limit(1);

  if (existente) {
    console.log('Limpando o ensaio anterior…');
    const t = existente.id;
    await db.execute(`delete from ticket_movimentos  where tenant_id = '${t}'`);
    await db.execute(`delete from guest_list_entries where tenant_id = '${t}'`);
    await db.execute(`delete from guest_lists        where tenant_id = '${t}'`);
    await db.execute(`delete from tickets            where tenant_id = '${t}'`);
    await db.execute(`delete from reservations       where tenant_id = '${t}'`);
    await db.execute(`delete from order_items        where tenant_id = '${t}'`);
    await db.execute(`delete from orders             where tenant_id = '${t}'`);
    await db.execute(`delete from ticket_types       where tenant_id = '${t}'`);
    await db.execute(`delete from events             where tenant_id = '${t}'`);
    await db.execute(`delete from venues             where tenant_id = '${t}'`);
    await db.execute(`delete from memberships        where tenant_id = '${t}'`);
    await db.execute(`delete from tenants            where id        = '${t}'`);
  }

  // ---------------------------------------------------------------------
  const [tenant] = await db
    .insert(schema.tenants)
    .values({
      slug: SLUG,
      nome: 'Casa do Ensaio',
      email: 'ensaio@tiqueteira.local',
      taxaConvenienciaBps: 1000,
      comissaoBps: 500,
      taxaFixaCentavos: 100,
    })
    .returning();

  const senhaHash = await hashPassword(SENHA);

  const usuarios = await db
    .insert(schema.users)
    .values([
      { email: 'produtor@ensaio.local', nome: 'Produtor do Ensaio', senhaHash },
      { email: 'portaria@ensaio.local', nome: 'Portaria do Ensaio', senhaHash },
    ])
    .onConflictDoNothing()
    .returning();

  const produtor =
    usuarios.find((u) => u.email === 'produtor@ensaio.local') ??
    (await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, 'produtor@ensaio.local'))
      .limit(1))[0]!;

  const portaria =
    usuarios.find((u) => u.email === 'portaria@ensaio.local') ??
    (await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, 'portaria@ensaio.local'))
      .limit(1))[0]!;

  await db.insert(schema.memberships).values([
    { userId: produtor.id, tenantId: tenant!.id, role: 'owner' },
    { userId: portaria.id, tenantId: tenant!.id, role: 'portaria' },
  ]);

  const [venue] = await db
    .insert(schema.venues)
    .values({
      tenantId: tenant!.id,
      nome: 'Galpão do Ensaio',
      endereco: 'Rua de Teste, 100',
      cidade: 'São Paulo',
      uf: 'SP',
      capacidadeMaxima: 120,
    })
    .returning();

  /**
   * O evento é **amanhã**, não hoje: assim a transferência de titularidade
   * (que exige 24h de antecedência por padrão) pode ser testada de verdade.
   * Ensaio com evento hoje esconde justamente esse caminho.
   */
  const [evento] = await db
    .insert(schema.events)
    .values({
      tenantId: tenant!.id,
      venueId: venue!.id,
      slug: 'ensaio-geral',
      titulo: 'Ensaio Geral — Evento Fantasma',
      descricao:
        'Evento de teste interno. Não é venda real. Serve para provar a porta, ' +
        'o QR, a lista de convidados e a transferência antes de existir PSP.',
      dataInicio: emSaoPaulo(1, 22),
      dataFim: emSaoPaulo(2, 4),
      capacidade: 120,
      status: 'publicado',
      ingressoNominal: true,
      exigeDocumentoEntrada: false,
      controlaSaida: true,
      permiteReentrada: true,
      permiteTransferencia: true,
      transferenciaAteHoras: 2,
    })
    .returning();

  const lotes = await db
    .insert(schema.ticketTypes)
    .values([
      {
        tenantId: tenant!.id,
        eventId: evento!.id,
        nome: 'Pista',
        precoCentavos: 6000,
        quantidadeTotal: 80,
        vendasInicio: emSaoPaulo(-7, 10),
        vendasFim: emSaoPaulo(1, 23),
        ordem: 0,
      },
      {
        tenantId: tenant!.id,
        eventId: evento!.id,
        nome: 'Camarote',
        precoCentavos: 12000,
        quantidadeTotal: 20,
        vendasInicio: emSaoPaulo(-7, 10),
        vendasFim: emSaoPaulo(1, 23),
        ordem: 1,
      },
    ])
    .returning();

  // ---------------------------------------------------------------------
  // Ingressos já vendidos
  // ---------------------------------------------------------------------
  const emitidos: {
    nome: string;
    cpf: string;
    codigo: string;
    token: string;
    lote: string;
  }[] = [];

  for (let i = 0; i < QUANTOS; i++) {
    // Um camarote a cada cinco: a porta precisa ver lotes diferentes na tela.
    const lote = i % 5 === 0 ? lotes[1]! : lotes[0]!;
    const nome = nomeDe(i);
    const cpf = cpfDe(i);

    const subtotal = lote.precoCentavos;
    const conveniencia = Math.round((subtotal * tenant!.taxaConvenienciaBps) / 10000);
    const comissao = Math.round((subtotal * tenant!.comissaoBps) / 10000);
    const total = subtotal + conveniencia;
    const valorOperador = Math.min(conveniencia + comissao + tenant!.taxaFixaCentavos, total);

    const [pedido] = await db
      .insert(schema.orders)
      .values({
        tenantId: tenant!.id,
        eventId: evento!.id,
        numero: i + 1,
        compradorNome: nome,
        compradorEmail: `convidado${i}@ensaio.local`,
        compradorCpf: cpf,
        subtotalCentavos: subtotal,
        convenienciaCentavos: conveniencia,
        totalCentavos: total,
        valorProdutorCentavos: total - valorOperador,
        valorOperadorCentavos: valorOperador,
        taxaConvenienciaBpsSnapshot: tenant!.taxaConvenienciaBps,
        comissaoBpsSnapshot: tenant!.comissaoBps,
        metodo: i % 3 === 0 ? 'credit_card' : 'pix',
        status: 'paid',
        pagoEm: new Date(),
        providerTransactionId: `ensaio_tx_${i}`,
        idempotencyKey: `ensaio_${evento!.id}_${i}`,
      })
      .returning();

    await db.insert(schema.orderItems).values({
      tenantId: tenant!.id,
      orderId: pedido!.id,
      ticketTypeId: lote.id,
      quantidade: 1,
      precoUnitarioCentavosSnapshot: lote.precoCentavos,
    });

    const emitido = emitirTicket(segredo!);

    await db.insert(schema.tickets).values({
      tenantId: tenant!.id,
      orderId: pedido!.id,
      ticketTypeId: lote.id,
      eventId: evento!.id,
      codigo: emitido.codigo,
      tokenHash: emitido.tokenHash,
      titularNome: nome,
      titularCpf: cpf,
      titularEmail: `convidado${i}@ensaio.local`,
      status: 'valido',
    });

    emitidos.push({ nome, cpf, codigo: emitido.codigo, token: emitido.token, lote: lote.nome });
  }

  // O estoque precisa refletir o que foi emitido, senão o painel mente.
  for (const lote of lotes) {
    const vendidos = emitidos.filter((e) => e.lote === lote.nome).length;
    await db
      .update(schema.ticketTypes)
      .set({ quantidadeVendida: vendidos })
      .where(eq(schema.ticketTypes.id, lote.id));
  }

  // ---------------------------------------------------------------------
  // Lista de convidados
  // ---------------------------------------------------------------------
  const [lista] = await db
    .insert(schema.guestLists)
    .values({
      tenantId: tenant!.id,
      eventId: evento!.id,
      nome: 'Lista do Rafael',
      promoterNome: 'Rafael Nunes',
      cota: 10,
      ticketTypeId: lotes[0]!.id,
      validoAte: emSaoPaulo(2, 1),
      ativo: true,
    })
    .returning();

  const convidados = [
    'Amanda Freitas', 'Bernardo Ítalo', 'Camila Ruiz', 'Danilo Pacheco',
    'Eduarda Sampaio', 'Felipe Aragão', 'Giovana Peixoto', 'Heitor Mancini',
  ];

  await db.insert(schema.guestListEntries).values(
    convidados.map((nome) => ({
      tenantId: tenant!.id,
      guestListId: lista!.id,
      eventId: evento!.id,
      nome,
      tipo: 'cortesia' as const,
    })),
  );

  // ---------------------------------------------------------------------
  // Folha de QRs para imprimir
  // ---------------------------------------------------------------------
  await mkdir('ensaio', { recursive: true });

  const cartoes = await Promise.all(
    emitidos.map(async (e, i) => {
      const qr = await QRCode.toDataURL(e.token, { margin: 1, width: 300 });
      return `
    <div class="ingresso">
      <img src="${qr}" alt="QR do ingresso ${e.codigo}" />
      <p class="nome">${i + 1}. ${e.nome}</p>
      <p class="dados">${e.lote} · ${e.codigo}</p>
      <p class="dados">CPF ***${e.cpf.slice(3, 9)}**</p>
    </div>`;
    }),
  );

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Ensaio Geral — ${QUANTOS} ingressos</title>
<style>
  @page { margin: 10mm; }
  body { font-family: system-ui, sans-serif; margin: 0; color: #111; }
  h1 { font-size: 16pt; margin: 0 0 2mm; }
  .aviso { font-size: 9pt; color: #555; margin: 0 0 6mm; max-width: 170mm; }
  .folha { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6mm; }
  .ingresso { border: 1px solid #ccc; border-radius: 3mm; padding: 3mm; text-align: center;
              break-inside: avoid; }
  .ingresso img { width: 100%; max-width: 45mm; height: auto; }
  .nome { font-size: 10pt; font-weight: 700; margin: 2mm 0 0; }
  .dados { font-size: 8pt; color: #555; margin: 0.5mm 0 0; }
</style>
</head>
<body>
  <h1>Ensaio Geral — Evento Fantasma</h1>
  <p class="aviso">
    ${QUANTOS} ingressos de teste. Imprima esta folha e recorte: metade do ensaio
    precisa acontecer em papel, porque na fila real metade das pessoas chega com
    print, e print amassado, dobrado e fotocopiado lê diferente de tela.
    Deixe alguns QRs só na tela do celular, com brilho baixo.
  </p>
  <div class="folha">${cartoes.join('')}</div>
</body>
</html>`;

  await writeFile('ensaio/ingressos.html', html, 'utf8');

  // Os tokens em texto, para quem quiser testar sem imprimir.
  await writeFile(
    'ensaio/tokens.txt',
    emitidos.map((e, i) => `${i + 1}\t${e.nome}\t${e.codigo}\t${e.token}`).join('\n'),
    'utf8',
  );

  // ---------------------------------------------------------------------
  console.log('Pronto.\n');
  console.log(`  Evento:    ${evento!.titulo}`);
  console.log(`  Quando:    amanhã, 22h`);
  console.log(`  Ingressos: ${QUANTOS} emitidos, ${convidados.length} na lista de convidados`);
  console.log('');
  console.log('  Página pública:  /' + SLUG + '/e/ensaio-geral');
  console.log('  Portaria:        /portaria/' + evento!.id);
  console.log('  Listas:          /painel/eventos/' + evento!.id + '/listas');
  console.log('');
  console.log('  Produtor: produtor@ensaio.local / ' + SENHA);
  console.log('  Portaria: portaria@ensaio.local / ' + SENHA);
  console.log('');
  console.log('  Para imprimir: ensaio/ingressos.html');
  console.log('  Roteiro:       docs/ensaio.md');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
