/**
 * Identificação do operador da plataforma — ADR-020 (substitui a ADR-010).
 *
 * Fica num único lugar porque aparece em vários: termos de uso, política de
 * privacidade, nota fiscal, cadastro na PSP e rodapé. Espalhar o CNPJ pelo
 * código garante que um dia um deles fique desatualizado.
 */
export const OPERADOR = {
  razaoSocial: 'YOUR TICKET LTDA',
  nomeFantasia: 'YourTicket',
  cnpj: '69700606000136',
  cnpjFormatado: '69.700.606/0001-36',
  /**
   * Endereço da sede, como consta no comprovante de inscrição do CNPJ.
   * Site de venda ao consumidor precisa exibir endereço físico do fornecedor.
   */
  endereco: 'Rua Barra Funda, 1071, Barra Funda, São Paulo/SP, CEP 01152-000',
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
