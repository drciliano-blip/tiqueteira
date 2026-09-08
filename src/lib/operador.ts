/**
 * Identificação do operador da plataforma — ADR-010.
 *
 * Fica num único lugar porque aparece em vários: termos de uso, política de
 * privacidade, nota fiscal, cadastro na PSP e rodapé. Espalhar o CNPJ pelo
 * código garante que um dia um deles fique desatualizado.
 */
export const OPERADOR = {
  razaoSocial: 'CR ADMINISTRACAO E PARTICIPACOES LTDA',
  nomeFantasia: 'Tiqueteira',
  cnpj: '47301164000112',
  cnpjFormatado: '47.301.164/0001-12',
  email: 'contato@tiqueteira.app',
  /** Máximo de 22 caracteres — limite do descritor na fatura do cartão. */
  descritorFatura: 'TIQUETEIRA',
} as const;
