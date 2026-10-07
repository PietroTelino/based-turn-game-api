# Publicação na AWS

O jogo inteiro roda em **uma máquina EC2**: a API (Node), o banco (PostgreSQL)
e o site (arquivos servidos pelo nginx). Na frente dela fica o **CloudFront**,
que dá o endereço `https://....cloudfront.net` com HTTPS.

```
jogador ──HTTPS──> CloudFront ──HTTP──> EC2 (Ubuntu 24.04)
                                         ├─ nginx :80
                                         │    ├─ /api/*  -> API em Node :3333
                                         │    └─ o resto -> site (/var/www/based-turn-game/current)
                                         └─ PostgreSQL :5432 (só a própria máquina alcança)
```

O site e a API ficam no mesmo endereço, então o app chama a API por um caminho
relativo (`VITE_API_URL=/api`) e não há CORS entre domínios.

A cada `push` na `main`, o GitHub Actions de cada repositório testa, compila e
publica na máquina.

## Arquivos

| Arquivo | Para que serve |
| --- | --- |
| `deploy/aws/infra.yaml` | Template do CloudFormation: grupo de segurança, máquina, IP fixo e CloudFront. |
| `deploy/server/setup-server.sh` | Roda uma vez dentro da máquina: instala Node, PostgreSQL e nginx, cria o banco, gera as senhas e a chave de deploy. |
| `deploy/server/deploy-api.sh` | Publica uma versão da API. Quem roda é o workflow. |
| `.github/workflows/deploy.yml` | Testa, compila, empacota e publica a API. |
| `deploy/deploy-app.sh` e `.github/workflows/deploy.yml` (repositório do app) | O mesmo, para o site. |

## Primeira vez

1. **Ponha os workflows no lugar e envie tudo para o GitHub.** Nos dois
   repositórios, se o arquivo `deploy/github-workflow.yml` ainda existir,
   mova-o para `.github/workflows/deploy.yml` (o GitHub só enxerga workflows
   nessa pasta). Depois, `git push`. O script de preparação da máquina é
   baixado do GitHub, e os workflows rodam, mas só testam e compilam enquanto
   os secrets não existem.
2. **Crie a stack.** Console da AWS, na região escolhida (N. Virginia,
   `us-east-1`, é a mais barata) > CloudFormation > *Create stack* > *Upload a
   template file* > `deploy/aws/infra.yaml`. Pode manter os parâmetros como
   estão. Leva uns 10 minutos, quase tudo por causa do CloudFront.
3. **Anote as saídas** (aba *Outputs*): `SiteUrl` é o endereço do jogo,
   `ServerIp` é o IP da máquina e `SetupCommand` é o comando do próximo passo.
4. **Prepare a máquina.** EC2 > *Instances* > `based-turn-game` > *Connect* >
   *EC2 Instance Connect* > *Connect*. No terminal que abrir, cole o
   `SetupCommand`. No fim ele mostra três valores.
5. **Cadastre os três secrets nos dois repositórios** (Settings > Secrets and
   variables > Actions): `DEPLOY_HOST`, `DEPLOY_KNOWN_HOSTS` e
   `DEPLOY_SSH_KEY`, com os valores que o passo 4 mostrou.
6. **Publique.** Aba *Actions* de cada repositório > o workflow de deploy >
   *Run workflow*. Primeiro a API, depois o app.
7. **Crie o administrador** (opcional), de volta no terminal da máquina:
   `sudo btg-create-admin`.

Abra o `SiteUrl`: o jogo está no ar.

## Dia a dia

Publicar é dar `git push` na `main`. Se a versão nova da API não responder em
`/api/health`, a anterior volta sozinha e o workflow fica vermelho.

Dentro da máquina (EC2 > Connect):

```bash
sudo journalctl -u based-turn-game-api -f        # log da API ao vivo
sudo systemctl status based-turn-game-api        # está rodando?
sudo systemctl restart based-turn-game-api       # reiniciar
sudo nano /etc/based-turn-game/api.env           # o ".env" de produção (reinicie depois)
ls /opt/based-turn-game/api/releases             # versões guardadas (as 3 últimas)
```

### Cópia do banco

Uma cópia é feita todo dia às 03:15 (horário de Brasília) em
`/var/backups/based-turn-game`, guardando 7 dias. Ela fica **na própria
máquina**: protege de um erro de migração, não da perda da máquina. Antes de
qualquer mudança arriscada, baixe uma cópia para o seu computador.

```bash
# Fazer uma cópia agora
sudo -u postgres pg_dump based_turn_game | gzip > ~/banco-$(date +%F).sql.gz

# Restaurar uma cópia (apaga o que está no banco!)
sudo systemctl stop based-turn-game-api
sudo -u postgres dropdb based_turn_game
sudo -u postgres createdb --owner btg based_turn_game
gunzip -c ~/banco-2026-10-07.sql.gz | sudo -u postgres psql -q based_turn_game
sudo systemctl start based-turn-game-api
```

### E-mail de "esqueci a senha"

Sai desligado (`EMAIL_ENABLED=false`): o link aparece só no log da API. Para
ligar, preencha as variáveis `EMAIL_*` em `/etc/based-turn-game/api.env` com os
dados de um serviço de SMTP e reinicie a API.

## Custo e como desligar

Na região N. Virginia, em valores aproximados de outubro de 2026: a máquina
`t3.micro` custa cerca de US$ 7,60 por mês, o disco de 20 GB US$ 1,60 e o IP
público US$ 3,65. O uso de CloudFront de um jogo pequeno fica em centavos. Dá
perto de **US$ 13 por mês**, pagos pelo crédito da conta nova enquanto ele
durar. Em São Paulo a máquina é mais cara.

Para parar de pagar: CloudFormation > a stack > *Delete*. Isso apaga a
máquina **e o banco**. Faça uma cópia antes, se quiser guardar os dados.

Não use *Update* na stack: uma atualização pode recriar a máquina. Para mudar
o tamanho dela, pare a instância no console do EC2, troque o tipo e ligue de
novo; o IP fixo continua o mesmo.

## O que fica de fora

- **Domínio próprio.** O endereço é o do CloudFront. Para usar um domínio:
  certificado no ACM (região `us-east-1`), *Alternate domain name* na
  distribuição, um registro CNAME no DNS e o novo endereço em `FRONTEND_URL`.
- **Limite de tentativas de login.** A API não limita requisições por IP.
- **Alta disponibilidade.** É uma máquina só: se ela cair, o jogo cai.
