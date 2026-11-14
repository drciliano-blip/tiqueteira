'use client';

import { useActionState } from 'react';

import { salvarConfiguracoes, type EstadoConfiguracao } from './acoes';

type Valores = {
  nome: string;
  razaoSocial: string;
  cnpj: string;
  email: string;
  telefone: string;
  corAcento: string;
  logoUrl: string;
  pixelMetaId: string;
  googleAnalyticsId: string;
};

const CAMPO =
  'mt-1.5 w-full rounded-botao border border-line bg-base px-3 py-2.5 text-sm focus:border-accent focus:outline-none disabled:opacity-60';

export function FormularioConfiguracoes({
  tenantId,
  inicial,
  podeEditar,
}: {
  tenantId: string;
  inicial: Valores;
  podeEditar: boolean;
}) {
  const [estado, enviar, enviando] = useActionState<EstadoConfiguracao, FormData>(
    salvarConfiguracoes.bind(null, tenantId),
    {},
  );

  return (
    <form action={enviar} className="space-y-8">
      <fieldset disabled={!podeEditar} className="space-y-4">
        <legend className="font-titulo font-bold">Sua casa</legend>
        <Campo nome="nome" rotulo="Nome que o público vê" valor={inicial.nome} obrigatorio />
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo nome="razaoSocial" rotulo="Razão social" valor={inicial.razaoSocial} />
          <Campo nome="cnpj" rotulo="CNPJ" valor={inicial.cnpj} placeholder="00.000.000/0000-00" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            nome="email"
            rotulo="E-mail para avisos"
            valor={inicial.email}
            tipo="email"
            obrigatorio
            ajuda="Repasses e solicitações de compradores chegam aqui."
          />
          <Campo nome="telefone" rotulo="Telefone" valor={inicial.telefone} placeholder="(11) 90000-0000" />
        </div>
      </fieldset>

      <fieldset disabled={!podeEditar} className="space-y-4">
        <legend className="font-titulo font-bold">Marca</legend>
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <div>
            <label htmlFor="corAcento" className="block text-sm font-medium">
              Cor de destaque
            </label>
            <input
              id="corAcento"
              name="corAcento"
              type="color"
              defaultValue={inicial.corAcento}
              className="mt-1.5 h-11 w-full cursor-pointer rounded-botao border border-line bg-base p-1"
            />
          </div>
          <Campo
            nome="logoUrl"
            rotulo="Endereço da logo"
            valor={inicial.logoUrl}
            placeholder="https://…"
            ajuda="Imagem quadrada, de preferência PNG com fundo transparente."
          />
        </div>
      </fieldset>

      <fieldset disabled={!podeEditar} className="space-y-4">
        <legend className="font-titulo font-bold">Medição de campanha</legend>
        <p className="text-sm text-muted">
          Para saber quanto cada anúncio vendeu. Os scripts só carregam nas suas páginas.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo nome="pixelMetaId" rotulo="Pixel da Meta" valor={inicial.pixelMetaId} placeholder="123456789012345" />
          <Campo
            nome="googleAnalyticsId"
            rotulo="Google Analytics"
            valor={inicial.googleAnalyticsId}
            placeholder="G-XXXXXXX"
          />
        </div>
      </fieldset>

      {estado.erro && (
        <p role="alert" className="rounded-botao border border-perigo/40 bg-perigo/10 px-3 py-2.5 text-sm text-perigo">
          {estado.erro}
        </p>
      )}
      {estado.ok && (
        <p role="status" className="rounded-botao border border-sucesso/40 bg-sucesso/10 px-3 py-2.5 text-sm text-sucesso">
          Configurações salvas.
        </p>
      )}

      {podeEditar ? (
        <button
          type="submit"
          disabled={enviando}
          className="rounded-botao bg-accent px-5 py-2.5 text-sm font-semibold text-accent-txt disabled:opacity-60"
        >
          {enviando ? 'Salvando…' : 'Salvar'}
        </button>
      ) : (
        <p className="text-sm text-faint">Só dono ou administrador altera estes dados.</p>
      )}
    </form>
  );
}

function Campo({
  nome,
  rotulo,
  valor,
  tipo = 'text',
  placeholder,
  ajuda,
  obrigatorio,
}: {
  nome: string;
  rotulo: string;
  valor: string;
  tipo?: string;
  placeholder?: string;
  ajuda?: string;
  obrigatorio?: boolean;
}) {
  return (
    <div>
      <label htmlFor={nome} className="block text-sm font-medium">
        {rotulo}
      </label>
      <input
        id={nome}
        name={nome}
        type={tipo}
        defaultValue={valor}
        placeholder={placeholder}
        required={obrigatorio}
        className={CAMPO}
      />
      {ajuda && <p className="mt-1 text-xs text-faint">{ajuda}</p>}
    </div>
  );
}
