import { describe, expect, it } from 'vitest';

import {
  avaliarConvidado,
  separarNomes,
  situacaoDaCota,
  type ConfiguracaoLista,
} from '@/domain/lista-convidados';

const LISTA: ConfiguracaoLista = { ativo: true, cota: 50, validoAte: null };
const AGORA = new Date('2026-09-10T02:00:00Z'); // 23h de 9/9 em São Paulo

describe('avaliarConvidado', () => {
  it('deixa entrar o nome de cortesia que ainda não usou', () => {
    expect(
      avaliarConvidado({
        lista: LISTA,
        entrada: { tipo: 'cortesia', usadoEm: null },
        agora: AGORA,
      }),
    ).toEqual({ permitido: true });
  });

  it('barra o segundo a chegar com o mesmo nome', () => {
    const d = avaliarConvidado({
      lista: LISTA,
      entrada: { tipo: 'cortesia', usadoEm: new Date('2026-09-10T01:30:00Z') },
      agora: AGORA,
    });
    expect(d).toMatchObject({ permitido: false, motivo: 'ja_entrou' });
    if (d.permitido) throw new Error('inesperado');
    expect(d.explicacao).toContain('22h30');
  });

  it('barra depois do horário da lista, dizendo até que horas valia', () => {
    const d = avaliarConvidado({
      lista: { ...LISTA, validoAte: new Date('2026-09-10T01:00:00Z') },
      entrada: { tipo: 'cortesia', usadoEm: null },
      agora: AGORA,
    });
    expect(d).toMatchObject({ permitido: false, motivo: 'lista_encerrada' });
    if (d.permitido) throw new Error('inesperado');
    expect(d.explicacao).toContain('22h00');
  });

  it('barra lista desativada', () => {
    expect(
      avaliarConvidado({
        lista: { ...LISTA, ativo: false },
        entrada: { tipo: 'cortesia', usadoEm: null },
        agora: AGORA,
      }),
    ).toMatchObject({ permitido: false, motivo: 'lista_desativada' });
  });

  it('não emite cortesia para quem tem desconto', () => {
    // Preço menor ainda é venda. Emitir cortesia aqui furaria a bilheteria
    // pelo caminho mais silencioso possível.
    expect(
      avaliarConvidado({
        lista: LISTA,
        entrada: { tipo: 'desconto', usadoEm: null },
        agora: AGORA,
      }),
    ).toMatchObject({ permitido: false, motivo: 'nao_e_cortesia' });
  });
});

describe('situacaoDaCota', () => {
  it('conta vagas sobre nomes, não sobre quem entrou', () => {
    expect(situacaoDaCota(50, 30)).toEqual({ cota: 50, nomes: 30, vagas: 20, cheia: false });
  });

  it('não devolve vaga negativa quando a cota foi reduzida depois', () => {
    expect(situacaoDaCota(10, 15)).toMatchObject({ vagas: 0, cheia: true });
  });
});

describe('separarNomes', () => {
  it('aceita o que cabe e explica o que ficou de fora', () => {
    const r = separarNomes(['Ana Lima', 'Bruno Sá', 'Caio Reis'], ['ana lima'], 1);

    expect(r.aceitos).toEqual(['Bruno Sá']);
    expect(r.recusados).toEqual([
      { nome: 'Ana Lima', motivo: 'duplicado' },
      { nome: 'Caio Reis', motivo: 'sem_cota' },
    ]);
  });

  it('normaliza espaço e caixa antes de comparar', () => {
    const r = separarNomes(['  marina   costa '], ['Marina Costa'], 10);
    expect(r.aceitos).toEqual([]);
    expect(r.recusados[0]).toMatchObject({ motivo: 'duplicado' });
  });

  it('pega duplicata dentro da própria colagem', () => {
    const r = separarNomes(['Ana Lima', 'ANA LIMA'], [], 10);
    expect(r.aceitos).toEqual(['Ana Lima']);
    expect(r.recusados).toHaveLength(1);
  });

  it('ignora linha em branco sem reclamar', () => {
    // Colagem do WhatsApp vem cheia de linha vazia. Reclamar de cada uma
    // faria o promoter desistir do sistema.
    const r = separarNomes(['Ana Lima', '', '   ', '\n'], [], 10);
    expect(r.aceitos).toEqual(['Ana Lima']);
    expect(r.recusados).toEqual([]);
  });

  it('recusa nome de uma letra', () => {
    const r = separarNomes(['J'], [], 10);
    expect(r.recusados).toEqual([{ nome: 'J', motivo: 'vazio' }]);
  });
});
