# Ensaio geral — evento fantasma

Fase 1.5 do plano. Acontece **antes** de existir PSP, e não produz código: produz
conhecimento operacional. O que se aprende aqui muda o produto.

A regra do ensaio é uma só: **não facilite para o sistema**. Ensaio em que tudo
dá certo não ensinou nada. O objetivo é encontrar os problemas agora, no
escritório, com café — e não na porta, com fila e sem sinal.

---

## Antes de começar

```
pnpm ensaio     # monta o evento fantasma e gera a folha de QRs
pnpm dev        # sobe o sistema
```

O comando imprime os endereços e as senhas. Ele pode ser rodado quantas vezes
for preciso: cada execução apaga o ensaio anterior e monta um novo.

**O que separar:**

- [ ] **Dois celulares diferentes** para a portaria. Um deles o mais velho e
      lento que existir na casa — é esse que vai ficar com a pessoa da porta.
- [ ] `ensaio/ingressos.html` **impresso e recortado**. Metade do ensaio
      precisa acontecer em papel: na fila real, metade das pessoas chega com
      print, e print amassado, dobrado e fotocopiado lê diferente de tela.
- [ ] Um ambiente onde dê para **apagar a luz**.
- [ ] Pelo menos **três pessoas**: uma na porta, uma na fila, uma cronometrando
      e anotando.

---

## Parte 1 — O produtor monta um evento do zero

Não use o evento que o comando gerou. **Crie outro, do começo**, como um
produtor faria. É aqui que aparece o campo mal explicado, o rótulo ambíguo e a
validação que impede alguém de salvar sem dizer por quê.

- [ ] Cadastrar um espaço, com capacidade
- [ ] Criar um evento e publicá-lo
- [ ] Criar dois lotes, um deles com meia-entrada
- [ ] Tentar criar um lote **maior que a capacidade do espaço** — tem que ser
      recusado, com uma frase que explique
- [ ] Ligar o **controle de saída** e a **reentrada**
- [ ] Criar uma **lista de convidados** com cota pequena (3 nomes) e colar
      **cinco** nomes de uma vez — os dois que sobram precisam ser recusados
      nominalmente
- [ ] Colar um nome que **já está na lista** — tem que ser recusado como
      duplicado, mesmo escrito com caixa e espaçamento diferentes

**Anote:** quanto tempo levou do zero até o evento publicado. Se passou de dez
minutos, o cadastro está complicado demais.

---

## Parte 2 — A compra, feita de verdade

Compre pelo site, como comprador, sem atalho pelo banco.

- [ ] Comprar **um** ingresso com Pix
- [ ] Comprar **quatro** de uma vez, com nomes diferentes
- [ ] Comprar pelo **celular**, não pelo computador
- [ ] Abrir o checkout e **deixar expirar** sem pagar — o estoque tem que
      voltar
- [ ] Conferir se o ingresso chegou por e-mail, e **abrir o e-mail no celular**
- [ ] Abrir a área do comprador pelo **link mágico**, sem senha

**Anote:** o e-mail caiu no spam? O QR aparece inteiro na tela do celular sem
precisar rolar? Dá para achar o ingresso em menos de dez segundos?

---

## Parte 3 — A porta

A parte que importa. Faça **na ordem**, e cronometre.

### Entrada

- [ ] Ler dez QRs **em papel**, um atrás do outro, cronometrando
- [ ] Ler dez QRs **na tela do celular**, com o brilho no mínimo
- [ ] **Apagar a luz** e ler mais cinco
- [ ] Ler um QR de **tela rachada** ou com película suja, se houver
- [ ] Ler um QR **fotocopiado** ou com a impressão fraca

**Meta:** menos de três segundos por pessoa. Acima de cinco, a fila não anda.

### As recusas

Cada uma tem que dizer **por quê**, com hora e nome. "Não autorizado" não
resolve discussão na porta.

- [ ] Ler o **mesmo QR duas vezes** — a segunda diz "já entrou às HH:MM"
- [ ] Ler um QR **de outro evento** (o seed tem outros eventos)
- [ ] Escrever um QR **à mão** num papel e tentar ler — tem que dar "inválido"
- [ ] Reembolsar um ingresso pelo painel e **tentar entrar com ele**

### Saída e reentrada

- [ ] Trocar o aparelho para **modo saída** e registrar a saída de alguém
- [ ] **Recarregar a página** — o aparelho tem que continuar em modo saída
- [ ] Voltar para entrada e **readmitir** a mesma pessoa
- [ ] Tentar registrar **saída de quem não entrou**
- [ ] Tentar **entrar de novo sem ter saído** — tem que ser recusado
- [ ] Conferir o contador: ele mostra quem está **dentro**, e diminui na saída

### Sem rede

Este é o teste que mais ensina.

- [ ] Abrir a portaria **com** rede, esperar a lista baixar
- [ ] Colocar o celular em **modo avião**
- [ ] Ler dez QRs — tem que continuar funcionando
- [ ] Ler o **mesmo QR duas vezes offline** — a segunda tem que ser barrada
- [ ] Comprar um ingresso novo **enquanto o celular está offline**, e tentar
      entrar com ele — tem que dizer "não está na lista", e sugerir tentar de
      novo com rede
- [ ] **Tirar do modo avião** e conferir que as entradas sobem sozinhas
- [ ] Conferir que o contador do painel bate com quantas pessoas entraram

### Dois portões ao mesmo tempo

- [ ] Dois celulares, **os dois online**, lendo o mesmo QR ao mesmo tempo —
      só um pode liberar
- [ ] Dois celulares, **os dois offline**, lendo o mesmo QR — os dois vão
      liberar, e isso é esperado. Depois de sincronizar, o painel tem que
      **mostrar que houve duplicidade**. É o limite honesto da tecnologia:
      offline, sem rede entre os aparelhos, nada impede o furo — o que o
      sistema faz é registrar

### Busca por nome

- [ ] Buscar alguém pelo **primeiro nome**
- [ ] Buscar **sem acento** um nome que tem acento
- [ ] Buscar um dos dois **homônimos** — o CPF parcial tem que distinguir
- [ ] Buscar pelo **código** do ingresso

### Lista de convidados

- [ ] Liberar um convidado pela lista — o ingresso é emitido e a entrada
      registrada de uma vez
- [ ] Tentar liberar o **mesmo nome de novo**
- [ ] **Desativar a lista** pelo painel e tentar liberar outro nome
- [ ] Tentar liberar alguém marcado como **desconto** — tem que mandar para a
      bilheteria, não emitir cortesia
- [ ] Colocar o celular **offline** e tentar usar a lista — tem que avisar que
      a lista precisa de rede, e não falhar em silêncio

---

## Parte 4 — Transferência de titularidade

- [ ] Transferir um ingresso para outra pessoa pela área do comprador
- [ ] Conferir que o **QR antigo parou de funcionar** na porta
- [ ] Conferir que o **QR novo** funciona
- [ ] Tentar transferir **duas vezes** o mesmo ingresso
- [ ] Tentar transferir um ingresso **já usado**

---

## Parte 5 — Depois

- [ ] Conferir o **painel de vendas**: os números batem com o que aconteceu?
- [ ] Conferir `/painel/saude`
- [ ] Conferir a **curva da noite**: a que horas entrou mais gente?

---

## Folha de anotação

Copie e preencha durante o ensaio. O que não for anotado na hora não vai ser
lembrado depois.

| # | O que aconteceu | Onde | Gravidade | O que fazer |
|---|---|---|---|---|
| 1 | | | trava a porta / atrasa / incomoda | |
| 2 | | | | |
| 3 | | | | |

**Números para anotar:**

- Tempo médio por pessoa na leitura: ____ s
- Pior tempo: ____ s
- Leituras que precisaram de segunda tentativa: ____ de ____
- Tempo do zero ao evento publicado: ____ min
- Quantas vezes alguém precisou perguntar "e agora?": ____

**A última pergunta, e a mais importante:** a pessoa que vai ficar na porta no
dia conseguiu operar sozinha, sem ninguém explicando ao lado? Se não, o
problema é da tela, não dela.
