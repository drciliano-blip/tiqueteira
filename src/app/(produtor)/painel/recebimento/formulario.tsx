'use client';

import { useActionState, useState } from 'react';

import { salvarRecebimento, type EstadoRecebimento } from './acoes';

const CAMPO =
  'mt-1.5 w-full rounded-botao border border-line bg-base px-3 py-2.5 text-sm focus:border-accent focus:outline-none';

export function FormularioRecebimento({
  tenantId,
  jaCadastrado,
  inicial,
}: {
  tenantId: string;
  jaCadastrado: boolean;
  inicial: { legalName: string; document: string; email: string; phone: string; tradeName: string };
}) {
  const [tipo, setTipo] = useState<'cnpj' | 'cpf'>(inicial.document.length === 11 ? 'cpf' : 'cnpj');
  const [estado, enviar, enviando] = useActionState<EstadoRecebimento, FormData>(
    salvarRecebimento.bind(null, tenantId),
    {},
  );

  if (estado.ok) {
    return (
      <p role="status" className="rounded-botao border border-sucesso/40 bg-sucesso/10 px-3 py-2.5 text-sm text-sucesso">
        Dados enviados à operadora. A situação do cadastro aparece no alto desta página.
      </p>
    );
  }

  return (
    <form action={enviar} className="space-y-6">
      <input type="hidden" name="tradeName" value={inicial.tradeName} />
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold">Titular</legend>
        <div className="flex gap-4 text-sm">
          {(['cnpj', 'cpf'] as const).map((t) => (
            <label key={t} className="flex items-center gap-2">
              <input
                type="radio"
                name="documentType"
                value={t}
                checked={tipo === t}
                onChange={() => setTipo(t)}
                className="h-4 w-4"
              />
              {t === 'cnpj' ? 'Empresa (CNPJ)' : 'Pessoa física (CPF)'}
            </label>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo nome="legalName" rotulo={tipo === 'cnpj' ? 'Razão social' : 'Nome completo'} valor={inicial.legalName} />
          <Campo nome="document" rotulo={tipo === 'cnpj' ? 'CNPJ' : 'CPF'} valor={inicial.document} />
          <Campo nome="email" rotulo="E-mail" valor={inicial.email} tipo="email" />
          <Campo nome="phone" rotulo="Telefone" valor={inicial.phone} />
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold">Endereço</legend>
        <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
          <Campo nome="street" rotulo="Rua" />
          <Campo nome="number" rotulo="Número" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo nome="complement" rotulo="Complemento" opcional />
          <Campo nome="neighborhood" rotulo="Bairro" />
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_5rem_9rem]">
          <Campo nome="city" rotulo="Cidade" />
          <Campo nome="state" rotulo="UF" />
          <Campo nome="zipCode" rotulo="CEP" />
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold">Conta bancária</legend>
        <p className="text-xs text-faint">
          A conta precisa estar no nome do {tipo === 'cnpj' ? 'CNPJ' : 'CPF'} acima. Conta de
          terceiro é recusada pela operadora.
        </p>
        <div className="grid gap-4 sm:grid-cols-[7rem_1fr_5rem]">
          <Campo nome="bankCode" rotulo="Banco" placeholder="341" />
          <Campo nome="branch" rotulo="Agência" />
          <Campo nome="branchDigit" rotulo="Dígito" opcional />
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_5rem_10rem]">
          <Campo nome="account" rotulo="Conta" />
          <Campo nome="accountDigit" rotulo="Dígito" />
          <div>
            <label htmlFor="accountType" className="block text-sm font-medium">
              Tipo
            </label>
            <select id="accountType" name="accountType" className={CAMPO}>
              <option value="checking">Corrente</option>
              <option value="savings">Poupança</option>
            </select>
          </div>
        </div>
      </fieldset>

      {estado.erro && (
        <p role="alert" className="rounded-botao border border-perigo/40 bg-perigo/10 px-3 py-2.5 text-sm text-perigo">
          {estado.erro}
        </p>
      )}

      <button
        type="submit"
        disabled={enviando}
        className="rounded-botao bg-accent px-5 py-2.5 text-sm font-semibold text-accent-txt disabled:opacity-60"
      >
        {enviando ? 'Enviando…' : jaCadastrado ? 'Trocar conta' : 'Enviar para a operadora'}
      </button>
    </form>
  );
}

function Campo({
  nome,
  rotulo,
  valor = '',
  tipo = 'text',
  placeholder,
  opcional,
}: {
  nome: string;
  rotulo: string;
  valor?: string;
  tipo?: string;
  placeholder?: string;
  opcional?: boolean;
}) {
  return (
    <div>
      <label htmlFor={nome} className="block text-sm font-medium">
        {rotulo}
        {opcional && <span className="font-normal text-faint"> (opcional)</span>}
      </label>
      <input
        id={nome}
        name={nome}
        type={tipo}
        defaultValue={valor}
        placeholder={placeholder}
        required={!opcional}
        className={CAMPO}
      />
    </div>
  );
}
