# Cronômetro de Dominação

Cronômetro de pontos de dominação para airsoft, em tempo real, com vários celulares.

| Tela | Endereço | Quem usa |
| --- | --- | --- |
| **Admin** | `/admin` | Só quem tem a senha. Controla a partida, os pontos, as equipes e as regras. |
| **Celular de ponto** | `/` | Cada jogador ou árbitro em um ponto. Fica fixo no ponto que o admin atribuir. |
| **Placar** | `/placar` | Só para acompanhar. Não controla nada. |

## Como funciona

1. O admin abre `/admin` e entra com a senha.
2. Cada celular abre o endereço principal (`/`). Ele aparece na lista **Aparelhos conectados** do admin, que escolhe o ponto de cada um ou usa **Criar um ponto para cada aparelho sem ponto**.
3. O admin inicia a partida. Para tomar um ponto, o jogador segura o botão da sua equipe naquele ponto pelo tempo definido para ele.
4. O placar, o admin e todos os celulares se atualizam na hora, e um aviso falado anuncia cada captura.

Só o admin muda nomes, cores, duração, pontos, regras de pontuação e a **correção do árbitro** (trocar o dono de um ponto sem contar captura).

Pontuação de cada ponto: `capturas × pontos por captura + segundos de posse ÷ segundos por ponto`. As regras são separadas por ponto, então um ponto pode valer mais que outro. Em caso de empate, vence quem teve mais tempo de posse.

## Rodar no computador

Precisa do Node.js 18 ou mais novo. Não há nada para instalar.

```
ADMIN_PASSWORD=minhasenha npm start
```

Abra `http://localhost:3000/admin`. Para os celulares na mesma rede Wi-Fi, use o endereço do computador, por exemplo `http://192.168.0.10:3000`.
Sem `ADMIN_PASSWORD`, o servidor cria uma senha temporária e mostra no terminal.

Testes: `npm test`.

## Colocar na internet (Render, plano gratuito)

1. Envie esta pasta para um repositório no GitHub.
2. Em [render.com](https://render.com), escolha **New → Blueprint** e aponte para o repositório. O arquivo `render.yaml` já tem tudo configurado.
3. Quando pedir, informe o valor de `ADMIN_PASSWORD`. Use uma senha própria e não repita senhas de outros serviços.
4. Ao terminar, o Render mostra o endereço do site, no formato `https://nome.onrender.com`.

Cuidados com o plano gratuito:

- O serviço dorme depois de 15 minutos sem tráfego e leva cerca de 1 minuto para acordar. Abra o `/admin` alguns minutos antes do jogo. Durante a partida, as telas abertas fazem um toque a cada 4 minutos para evitar que durma.
- Os arquivos não são guardados quando o serviço reinicia ou dorme. Nesse caso nomes, cores, pontos e aparelhos voltam ao padrão e a partida zera. Se precisar guardar, um disco persistente exige plano pago.
- O Render avisa que o plano gratuito não é para produção. Para um jogo entre amigos, serve.

Qualquer hospedagem que rode Node.js também serve: o comando é `npm start` e o endereço de teste de saúde é `/healthz`.

## Mudar os sons

Edite `public/sounds-config.js`. Lá você muda os bipes, as frases faladas (usando `{ponto}` e `{equipe}`), o volume e em quais telas cada som toca. Para usar arquivos de áudio, coloque-os em `public/sounds/` e escreva o caminho em `file`. Os detalhes estão nos comentários do arquivo.

O **apito de contagem** ("pi pi pi") toca enquanto a partida roda e vai acelerando conforme o fim se aproxima. Por padrão ele toca nos celulares de ponto e no placar, não no admin, e começa a acelerar no último minuto. No bloco `tick` do mesmo arquivo você muda o tom, o ritmo, quando começa a acelerar, só tocar nos últimos minutos, ou desliga com `enabled: false`.

Os navegadores só liberam o som depois de um toque na tela, por isso cada aparelho tem o botão **Ativar som**. Cada pessoa pode ligar ou desligar o som no próprio aparelho.

## Segurança

- A senha fica só no servidor (variável `ADMIN_PASSWORD`) e nunca no código. Depois do login o navegador recebe uma chave que vale 24 horas.
- Há limite de tentativas de senha: 5 erros bloqueiam por 1 minuto.
- Os celulares de ponto não têm nenhuma ação de administrador. Eles só conseguem capturar o ponto atribuído ao próprio aparelho.
- Um jogador que mexa no navegador pode capturar sem segurar o botão pelo tempo todo. Para um jogo entre amigos isso basta. Se precisar de mais rigor, dá para fazer o servidor medir o tempo de segurar.

## Arquivos

- `game.js`: regras do jogo (sem rede).
- `server.js`: servidor, API, tempo real e senha do admin.
- `public/`: as telas (`admin`, `index` e `placar`), `common.js`, `styles.css` e `sounds-config.js`.
- `test/`: testes das regras.
