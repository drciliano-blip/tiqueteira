/**
 * Teste de carga da abertura de vendas.
 *
 *   node scripts/teste-de-carga.mjs --url https://tiqueteira.vercel.app \
 *        --evento /complexo-jussara/e/baile-do-jussara-2026 --usuarios 200
 *
 * Simula o que realmente acontece numa abertura: muita gente abrindo a página
 * do evento ao mesmo tempo, e uma fração menor clicando em comprar.
 *
 * O objetivo não é "passar" — é DESCOBRIR ONDE QUEBRA, com número. O gargalo
 * esperado é o banco: o plano atual tem 15 conexões ao Postgres e teto de 200
 * clientes no pooler. Saber a partir de quantos acessos simultâneos a coisa
 * degrada é o que permite escolher o tamanho do banco com informação em vez
 * de palpite.
 *
 * NÃO rode contra produção durante venda real.
 */

const argumentos = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  argumentos.set(process.argv[i]?.replace(/^--/, ''), process.argv[i + 1]);
}

const BASE = argumentos.get('url') ?? 'http://localhost:3000';
const CAMINHO = argumentos.get('evento') ?? '/';
const USUARIOS = Number(argumentos.get('usuarios') ?? 100);
const RODADAS = Number(argumentos.get('rodadas') ?? 3);

/** Percentis contam mais que a média: a média esconde a cauda que dói. */
function percentil(valores, p) {
  if (valores.length === 0) return 0;
  const ordenados = [...valores].sort((a, b) => a - b);
  const indice = Math.min(ordenados.length - 1, Math.floor((p / 100) * ordenados.length));
  return Math.round(ordenados[indice]);
}

async function medir(url) {
  const inicio = performance.now();
  try {
    const resposta = await fetch(url, {
      headers: { 'cache-control': 'no-cache' },
      redirect: 'manual',
    });
    // Consome o corpo: sem isso, o tempo medido ignora a transferência.
    await resposta.arrayBuffer();
    return { ms: performance.now() - inicio, status: resposta.status };
  } catch (e) {
    return { ms: performance.now() - inicio, status: 0, erro: String(e).slice(0, 80) };
  }
}

async function rodada(numero) {
  const url = `${BASE}${CAMINHO}`;
  const inicio = performance.now();

  const resultados = await Promise.all(
    Array.from({ length: USUARIOS }, () => medir(url)),
  );

  const duracao = performance.now() - inicio;
  const tempos = resultados.map((r) => r.ms);
  const ok = resultados.filter((r) => r.status >= 200 && r.status < 400).length;
  const erros = resultados.filter((r) => r.status === 0 || r.status >= 500);

  console.log(
    [
      `rodada ${numero}`,
      `${ok}/${USUARIOS} ok`,
      `p50 ${percentil(tempos, 50)}ms`,
      `p95 ${percentil(tempos, 95)}ms`,
      `p99 ${percentil(tempos, 99)}ms`,
      `pior ${Math.round(Math.max(...tempos))}ms`,
      `${Math.round((USUARIOS / duracao) * 1000)} req/s`,
    ].join(' · '),
  );

  if (erros.length > 0) {
    const amostra = erros.slice(0, 3).map((e) => e.erro ?? `HTTP ${e.status}`);
    console.log(`  ${erros.length} falhas — ${[...new Set(amostra)].join(' | ')}`);
  }

  return { ok, erros: erros.length, p95: percentil(tempos, 95) };
}

console.log(`Alvo: ${BASE}${CAMINHO}`);
console.log(`${USUARIOS} acessos simultâneos, ${RODADAS} rodadas\n`);

const totais = [];
for (let i = 1; i <= RODADAS; i++) {
  totais.push(await rodada(i));
  // Pausa entre rodadas: mede o comportamento com o pool já aquecido, e não
  // só o primeiro impacto.
  if (i < RODADAS) await new Promise((r) => setTimeout(r, 2000));
}

const falhas = totais.reduce((a, t) => a + t.erros, 0);
const piorP95 = Math.max(...totais.map((t) => t.p95));

console.log('\n--- veredito ---');
console.log(`falhas totais: ${falhas}`);
console.log(`pior p95: ${piorP95}ms`);

if (falhas > 0) {
  console.log('\nHouve falha. Antes de abrir vendas grandes:');
  console.log('  1. aumente o tamanho do banco no Supabase');
  console.log('  2. confira o limite de conexões do pooler');
} else if (piorP95 > 2000) {
  console.log('\nSem falha, mas lento. 2s de p95 já perde comprador.');
} else {
  console.log('\nAguenta esta carga.');
}
