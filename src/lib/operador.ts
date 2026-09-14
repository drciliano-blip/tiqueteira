/**
 * Identificação do operador da plataforma — ADR-010.
 *
 * Fica num único lugar porque aparece em vários: termos de uso, política de
 * privacidade, nota fiscal, cadastro na PSP e rodapé. Espalhar o CNPJ pelo
 * código garante que um dia um deles fique desatualizado.
 */
export const OPERADOR = {
  razaoSocial: 'CR ADMINISTRACAO E PARTICIPACOES LTDA',
  nomeFantasia: 'YourTicket',
  cnpj: '47301164000112',
  cnpjFormatado: '47.301.164/0001-12',
  /** Domínio canônico da plataforma. */
  dominio: 'yourticket.com.br',
  email: 'contato@yourticket.com.br',
  /**
   * Máximo de 22 caracteres — limite do descritor na fatura do cartão.
   *
   * Precisa ser o nome que o comprador reconhece. Nome desconhecido na
   * fatura é uma das causas mais comuns de contestação de cartão, e
   * contestação custa mais que a venda (ADR-010).
   */
  descritorFatura: 'YOURTICKET',
} as const;
