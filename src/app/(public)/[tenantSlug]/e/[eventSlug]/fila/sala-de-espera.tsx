'use client';

import { useEffect, useState } from 'react';

/**
 * Sala de espera.
 *
 * A tela existe para uma coisa só: fazer a pessoa **ficar**. Quem não sabe
 * onde está recarrega a página — e vinte mil pessoas recarregando é
 * exatamente a carga que a fila foi criada para evitar. Por isso a posição é
 * grande, a estimativa é honesta (some quando não há ritmo medido) e o texto
 * diz explicitamente para não recarregar.
 *
 * O intervalo entre uma pergunta e outra vem do servidor: quem está em décimo
 * pergunta a cada três segundos, quem está em dez mil pergunta a cada
 * quarenta e cinco.
 */

type Estado =
  | { situacao: 'carregando' }
  | { situacao: 'sem_fila' }
  | { situacao: 'sem_lugar' }
  | { situacao: 'admitido' }
  | {
      situacao: 'aguardando';
      numero: number;
      pessoasNaFrente: number;
      esperaMinutos: number | null;
      proximaConsultaSegundos: number;
    }
  | { situacao: 'erro' };

export function SalaDeEspera({
  eventId,
  destino,
  evento,
}: {
  eventId: string;
  /** Para onde ir quando chegar a vez. */
  destino: string;
  evento: string;
}) {
  const [estado, setEstado] = useState<Estado>({ situacao: 'carregando' });

  /**
   * Um laço só, cancelável, em vez de um `setTimeout` que se reagenda.
   *
   * A diferença importa aqui: com reagendamento é fácil ficarem dois relógios
   * vivos depois de uma reconexão, e aí a mesma pessoa passa a perguntar o
   * dobro de vezes. Numa fila de vinte mil, esse tipo de vazamento é o que
   * derruba o sistema que a fila protege.
   */
  useEffect(() => {
    let ativo = true;
    let relogio: ReturnType<typeof setTimeout> | undefined;

    const dormir = (ms: number) =>
      new Promise<void>((resolver) => {
        relogio = setTimeout(resolver, ms);
      });

    async function acompanhar() {
      // A primeira chamada pega senha; as seguintes só perguntam.
      let metodo: 'GET' | 'POST' = 'POST';

      while (ativo) {
        try {
          const resposta = await fetch(`/api/fila/${eventId}`, {
            method: metodo,
            cache: 'no-store',
          });
          if (!resposta.ok) throw new Error('falhou');

          const dados = (await resposta.json()) as Estado;
          if (!ativo) return;

          if (dados.situacao === 'admitido' || dados.situacao === 'sem_fila') {
            window.location.href = destino;
            return;
          }

          if (dados.situacao === 'sem_lugar') {
            // Perdeu a janela ou nunca teve senha: pega outra e recomeça.
            metodo = 'POST';
            await dormir(300);
            continue;
          }

          setEstado(dados);
          metodo = 'GET';

          await dormir(
            dados.situacao === 'aguardando' ? dados.proximaConsultaSegundos * 1000 : 5000,
          );
        } catch {
          if (!ativo) return;
          // Rede oscilando numa abertura de vendas é o esperado, não a exceção.
          setEstado({ situacao: 'erro' });
          metodo = 'GET';
          await dormir(5000);
        }
      }
    }

    void acompanhar();

    return () => {
      ativo = false;
      if (relogio) clearTimeout(relogio);
    };
  }, [eventId, destino]);

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-lg flex-1 flex-col items-center justify-center px-4 py-12 text-center">
      <p className="text-sm text-muted">{evento}</p>

      {estado.situacao === 'aguardando' ? (
        <>
          <p className="mt-6 text-sm uppercase tracking-wide text-faint">
            {estado.pessoasNaFrente === 0 ? 'Você é o próximo' : 'Pessoas na sua frente'}
          </p>

          {estado.pessoasNaFrente > 0 && (
            <p className="tabular mt-2 font-titulo text-6xl font-black">
              {estado.pessoasNaFrente.toLocaleString('pt-BR')}
            </p>
          )}

          <p className="mt-4 text-sm text-muted">
            {estado.esperaMinutos === null
              ? 'Calculando o tempo de espera…'
              : estado.esperaMinutos === 0
                ? 'Sua vez está chegando agora.'
                : `Cerca de ${estado.esperaMinutos} minuto${estado.esperaMinutos === 1 ? '' : 's'}.`}
          </p>

          <div
            className="mt-8 h-1 w-full max-w-xs overflow-hidden rounded-full bg-line"
            role="progressbar"
            aria-label="Lugar na fila"
          >
            <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" />
          </div>

          <p className="prosa mt-8 text-sm text-muted">
            <strong>Não recarregue e não feche esta página.</strong> Seu lugar está guardado
            aqui. Quando chegar a sua vez, você entra sozinho.
          </p>

          <p className="tabular mt-6 text-xs text-faint">Sua senha: {estado.numero}</p>
        </>
      ) : estado.situacao === 'erro' ? (
        <>
          <p className="mt-6 font-titulo text-xl font-bold">Perdi o contato</p>
          <p className="mt-3 text-sm text-muted">
            Continuo tentando daqui. Seu lugar na fila não se perde — não feche a página.
          </p>
        </>
      ) : (
        <>
          <p className="mt-6 font-titulo text-xl font-bold">Entrando na fila…</p>
          <p className="mt-3 text-sm text-muted">Um instante.</p>
        </>
      )}
    </main>
  );
}
