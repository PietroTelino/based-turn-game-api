#!/usr/bin/env bash
#
# Prepara uma máquina Ubuntu 24.04 para rodar o Based Turn Game inteiro:
# a API (Node), o banco (PostgreSQL) e o site (nginx).
#
# Roda uma vez, como root, dentro da máquina:
#
#   sudo bash setup-server.sh https://dxxxxxxxxxxxx.cloudfront.net
#
# O endereço é o do site (a saída "SiteUrl" da stack do CloudFormation).
#
# Pode rodar de novo sem medo: o banco, as senhas e a chave de deploy que já
# existem são mantidos; o endereço do site, o nginx e o serviço são regravados.
# Para trocar a chave de deploy (a que o GitHub usa), acrescente --nova-chave.
#
# No fim, o script mostra os três valores que vão nos "secrets" dos dois
# repositórios no GitHub.
set -euo pipefail

APP=based-turn-game
RUN_USER=btg                 # usuário que roda a API e recebe os deploys
DB_NAME=based_turn_game
DB_USER=btg
API_PORT=3333
NODE_MAJOR=22

API_DIR=/opt/$APP/api        # releases/<id> e o link "current"
WEB_DIR=/var/www/$APP        # idem, para o site
ETC_DIR=/etc/$APP
ENV_FILE=$ETC_DIR/api.env    # o ".env" de produção
BACKUP_DIR=/var/backups/$APP
SERVICE=$APP-api

say() { printf '\n==> %s\n' "$*"; }
fail() { printf '\nERRO: %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- argumentos
SITE_URL=""
NEW_KEY=0

for arg in "$@"; do
    case "$arg" in
        --nova-chave) NEW_KEY=1 ;;
        https://*) SITE_URL="${arg%/}" ;;
        *) fail "Argumento desconhecido: $arg" ;;
    esac
done

[[ $EUID -eq 0 ]] || fail "Rode com sudo: sudo bash setup-server.sh https://SEU-ENDERECO"
[[ "$SITE_URL" =~ ^https://[A-Za-z0-9.-]+$ ]] \
    || fail "Informe o endereço do site, por exemplo: sudo bash setup-server.sh https://d1234abcd.cloudfront.net"

# O postgres não consegue entrar em /root; evita avisos nos comandos "sudo -u postgres".
cd /

# -------------------------------------------------------- memória de reserva
# A máquina pequena tem 1 GB. O arquivo de troca evita que o "npm ci" de um
# deploy derrube a API por falta de memória.
if ! swapon --show | grep -q .; then
    say "Criando 2 GB de memória de troca"
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile > /dev/null
    swapon /swapfile
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ------------------------------------------------------------------ pacotes
say "Instalando nginx, PostgreSQL e Node $NODE_MAJOR"
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a
apt-get update -y
apt-get install -y ca-certificates curl gnupg openssl nginx postgresql

if ! command -v node > /dev/null || [[ "$(node -v)" != v${NODE_MAJOR}.* ]]; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y nodejs
fi

# --------------------------------------------------------- usuário e pastas
say "Criando o usuário $RUN_USER e as pastas"
id "$RUN_USER" > /dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$RUN_USER"

install -d -o "$RUN_USER" -g "$RUN_USER" -m 755 "/opt/$APP" "$API_DIR" "$API_DIR/releases" "$WEB_DIR" "$WEB_DIR/releases"
install -d -o root -g "$RUN_USER" -m 750 "$ETC_DIR"

# -------------------------------------------------- banco e arquivo de ambiente
systemctl enable --now postgresql

if [[ ! -f "$ENV_FILE" ]]; then
    say "Criando o banco $DB_NAME e gerando as senhas"
    DB_PASSWORD="$(openssl rand -hex 24)"

    if [[ "$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER'")" != 1 ]]; then
        sudo -u postgres psql -v ON_ERROR_STOP=1 -qc "CREATE ROLE $DB_USER LOGIN"
    fi

    # A senha vai pela entrada do psql, e não pela linha de comando.
    printf "ALTER ROLE %s PASSWORD '%s';\n" "$DB_USER" "$DB_PASSWORD" \
        | sudo -u postgres psql -v ON_ERROR_STOP=1 -q

    if [[ "$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'")" != 1 ]]; then
        sudo -u postgres createdb --owner "$DB_USER" "$DB_NAME"
    fi

    # Só o root e o usuário da API leem este arquivo.
    ( umask 027
      cat > "$ENV_FILE" <<EOF
# Ambiente de produção da API. Gerado por setup-server.sh.
# Depois de mudar algo aqui: sudo systemctl restart $SERVICE

PORT=$API_PORT

DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD

JWT_SECRET=$(openssl rand -hex 48)
JWT_EXPIRES_IN_SECONDS=900
JWT_REFRESH_SECRET=$(openssl rand -hex 48)
JWT_REFRESH_EXPIRES_IN_SECONDS=604800

# Sem servidor de e-mail, o link de "esqueci a senha" não chega ao jogador
# (ele aparece só no log da API). Para ligar: EMAIL_ENABLED=true e preencha
# EMAIL_HOST, EMAIL_PORT, EMAIL_SECURE, EMAIL_USER, EMAIL_PASSWORD e EMAIL_FROM.
EMAIL_ENABLED=false

# O endereço do site: vai nos links enviados por e-mail e na regra de CORS.
FRONTEND_URL=$SITE_URL

# CloudFront + nginx ficam na frente da API: são 2 proxies até o jogador.
TRUST_PROXY=2
EOF
    )
else
    say "Mantendo o banco e as senhas que já existem; atualizando o endereço do site"
    sed -i "s|^FRONTEND_URL=.*|FRONTEND_URL=$SITE_URL|" "$ENV_FILE"
fi

chown root:"$RUN_USER" "$ENV_FILE"
chmod 640 "$ENV_FILE"

# ----------------------------------------------------------- serviço da API
say "Registrando o serviço $SERVICE"
cat > "/etc/systemd/system/$SERVICE.service" <<EOF
[Unit]
Description=Based Turn Game - API
After=network.target postgresql.service
Wants=postgresql.service

[Service]
User=$RUN_USER
Group=$RUN_USER
WorkingDirectory=$API_DIR/current
EnvironmentFile=$ENV_FILE
Environment=NODE_ENV=production
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE" > /dev/null 2>&1

# O deploy precisa reiniciar a API, e só isso.
echo "$RUN_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart $SERVICE" > "/etc/sudoers.d/$APP"
chmod 440 "/etc/sudoers.d/$APP"
visudo -cf "/etc/sudoers.d/$APP" > /dev/null

# -------------------------------------------------------------------- nginx
say "Configurando o nginx"
cat > "/etc/nginx/sites-available/$APP" <<EOF
# Based Turn Game: o site e a API no mesmo endereço. Gerado por setup-server.sh.
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    root $WEB_DIR/current;
    index index.html;
    server_tokens off;

    # As requisições da API são JSON pequeno.
    client_max_body_size 1m;

    gzip on;
    gzip_proxied any;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/css text/javascript application/javascript application/json image/svg+xml;

    # /api/... vai para a API em Node, na mesma máquina.
    location /api/ {
        proxy_pass http://127.0.0.1:$API_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 30s;
    }

    # O Vite põe um hash no nome destes arquivos: podem ficar em cache por um ano.
    location /assets/ {
        try_files \$uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    # O resto é o app de página única: qualquer rota devolve o index.html, sem cache,
    # para que uma publicação nova apareça na hora.
    location / {
        try_files \$uri /index.html;
        add_header Cache-Control "no-cache";
    }
}
EOF

ln -sfn "/etc/nginx/sites-available/$APP" "/etc/nginx/sites-enabled/$APP"
rm -f /etc/nginx/sites-enabled/default

# Enquanto o site não é publicado, uma página dizendo que o servidor está de pé.
if [[ ! -e "$WEB_DIR/current" ]]; then
    install -d -o "$RUN_USER" -g "$RUN_USER" -m 755 "$WEB_DIR/releases/inicial"
    cat > "$WEB_DIR/releases/inicial/index.html" <<'EOF'
<!doctype html>
<html lang="pt-BR">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Based Turn Game</title>
    </head>
    <body style="font-family: sans-serif; text-align: center; padding-top: 4rem">
        <h1>Servidor pronto</h1>
        <p>O jogo ainda não foi publicado. Rode o deploy do site no GitHub.</p>
    </body>
</html>
EOF
    chown "$RUN_USER":"$RUN_USER" "$WEB_DIR/releases/inicial/index.html"
    ln -sfn "$WEB_DIR/releases/inicial" "$WEB_DIR/current"
    chown -h "$RUN_USER":"$RUN_USER" "$WEB_DIR/current"
fi

nginx -t
systemctl enable nginx > /dev/null 2>&1
systemctl reload nginx || systemctl restart nginx

# Se a API já está publicada (o script está rodando de novo), ela relê o ambiente.
if [[ -e "$API_DIR/current" ]]; then
    systemctl restart "$SERVICE"
fi

# ------------------------------------------------------- cópia diária do banco
say "Agendando a cópia diária do banco (guarda 7 dias em $BACKUP_DIR)"
install -d -o postgres -g postgres -m 750 "$BACKUP_DIR"
cat > "/etc/cron.d/$APP-backup" <<EOF
# Cópia diária do banco do Based Turn Game, às 06:15 UTC (03:15 de Brasília). Guarda 7 dias.
15 6 * * * postgres pg_dump $DB_NAME | gzip > $BACKUP_DIR/$DB_NAME-\$(date +\\%F).sql.gz && find $BACKUP_DIR -name '*.sql.gz' -mtime +7 -delete
EOF
chmod 644 "/etc/cron.d/$APP-backup"

# ------------------------------------------- comando para criar o administrador
cat > /usr/local/bin/btg-create-admin <<EOF
#!/usr/bin/env bash
# Cria o usuário administrador (GOD) do jogo, usando o seed do próprio projeto.
# Rode depois do primeiro deploy da API: sudo btg-create-admin
set -euo pipefail

[[ \$EUID -eq 0 ]] || { echo "Rode com sudo: sudo btg-create-admin" >&2; exit 1; }
[[ -e $API_DIR/current ]] || { echo "A API ainda não foi publicada. Rode o deploy dela primeiro." >&2; exit 1; }

read -r -p "E-mail do administrador: " GOD_EMAIL
read -r -s -p "Senha (mínimo 8 caracteres): " GOD_PASSWORD; echo
read -r -s -p "Repita a senha: " GOD_PASSWORD_AGAIN; echo

[[ "\$GOD_PASSWORD" == "\$GOD_PASSWORD_AGAIN" ]] || { echo "As senhas não são iguais." >&2; exit 1; }
[[ \${#GOD_PASSWORD} -ge 8 ]] || { echo "A senha precisa de pelo menos 8 caracteres." >&2; exit 1; }

export GOD_EMAIL GOD_PASSWORD
cd $API_DIR/current
sudo -H --preserve-env=GOD_EMAIL,GOD_PASSWORD -u $RUN_USER bash -c 'set -a; . $ENV_FILE; set +a; npm run --silent seed'
EOF
chmod 755 /usr/local/bin/btg-create-admin

# ------------------------------------------------------------ chave de deploy
SSH_DIR=/home/$RUN_USER/.ssh
install -d -o "$RUN_USER" -g "$RUN_USER" -m 700 "$SSH_DIR"
DEPLOY_KEY=""

if [[ ! -s "$SSH_DIR/authorized_keys" || $NEW_KEY -eq 1 ]]; then
    say "Gerando a chave de deploy"
    KEY_TMP="$(mktemp -d)"
    ssh-keygen -q -t ed25519 -N '' -C "deploy-$APP" -f "$KEY_TMP/key"
    install -o "$RUN_USER" -g "$RUN_USER" -m 600 "$KEY_TMP/key.pub" "$SSH_DIR/authorized_keys"
    DEPLOY_KEY="$(cat "$KEY_TMP/key")"
    # A chave privada não fica guardada na máquina: ela só aparece agora, na tela.
    rm -rf "$KEY_TMP"
fi

# -------------------------------------------------------------------- resumo
imds() {
    local token
    token="$(curl -fsS -m 3 -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')" || return 1
    curl -fsS -m 3 -H "X-aws-ec2-metadata-token: $token" "http://169.254.169.254/latest/meta-data/$1"
}

PUBLIC_IP="$(imds public-ipv4 2> /dev/null || true)"
HOST_KEY="$(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub 2> /dev/null || true)"

[[ -n "$PUBLIC_IP" ]] || PUBLIC_IP='(não consegui ler o IP: use a saída "ServerIp" da stack do CloudFormation)'
[[ -n "$HOST_KEY" ]] || HOST_KEY='(não consegui ler: rode  cat /etc/ssh/ssh_host_ed25519_key.pub  e use os dois primeiros campos)'

cat <<EOF

======================================================================
 Servidor pronto.  Site: $SITE_URL
======================================================================

Cadastre estes três "secrets" nos DOIS repositórios do GitHub
(Settings > Secrets and variables > Actions > New repository secret):

1) DEPLOY_HOST
$PUBLIC_IP

2) DEPLOY_KNOWN_HOSTS
btg-server $HOST_KEY

3) DEPLOY_SSH_KEY
EOF

if [[ -n "$DEPLOY_KEY" ]]; then
    cat <<EOF
Copie o bloco inteiro abaixo, da linha BEGIN até a linha END. Ele não fica
guardado na máquina: se perder, rode de novo com --nova-chave.

$DEPLOY_KEY
EOF
else
    cat <<EOF
(a chave de deploy já tinha sido criada numa execução anterior. Para gerar
outra, rode este script de novo acrescentando --nova-chave e cadastre a nova.)
EOF
fi

cat <<EOF

Depois: rode o deploy da API e o do site no GitHub (aba Actions) e, com a
API no ar, crie o administrador com:  sudo btg-create-admin
======================================================================
EOF
