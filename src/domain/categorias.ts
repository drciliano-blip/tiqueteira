/**
 * Categorias de evento.
 *
 * Módulo puro, sem I/O, de propósito: esta lista é usada tanto no servidor
 * (consulta) quanto no navegador (formulário e filtros). Se morasse junto das
 * consultas, o formulário arrastaria o driver do Postgres para o pacote do
 * cliente — que foi exatamente o erro que este arquivo corrige.
 */
export const CATEGORIAS = [
  { valor: 'festa', rotulo: 'Festas' },
  { valor: 'show', rotulo: 'Shows' },
  { valor: 'teatro', rotulo: 'Teatro' },
  { valor: 'stand_up', rotulo: 'Stand-up' },
  { valor: 'esporte', rotulo: 'Esporte' },
  { valor: 'gastronomia', rotulo: 'Gastronomia' },
  { valor: 'curso', rotulo: 'Cursos' },
  { valor: 'infantil', rotulo: 'Infantil' },
  { valor: 'outro', rotulo: 'Outros' },
] as const;

export type Categoria = (typeof CATEGORIAS)[number]['valor'];

export function rotuloDaCategoria(valor: string): string {
  return CATEGORIAS.find((c) => c.valor === valor)?.rotulo ?? valor;
}
