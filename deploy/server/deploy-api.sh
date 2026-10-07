#!/usr/bin/env bash
#
# Publica uma versão da API na máquina. Quem roda é o GitHub Actions
# (.github/workflows/deploy.yml): ele copia o pacote e este script para a
# máquina e executa, pelo SSH, como o usuário "btg":
#
#   bash deploy-api.sh /tmp/pacote.tgz 20261007120000-abc1234
#
# O pacote já vem compilado (pasta dist). Aqui a versão é instalada numa pasta
# própria, as migrações do banco são aplicadas e só então a API é reiniciada na
# versão nova. Se ela não responder, a versão anterior volta sozinha.
set -euo pipefail

TARBALL="${1:?Informe o pacote (.tgz)}"
RELEASE_ID="${2:?Informe o identificador da versão}"

# Os caminhos podem ser trocados pelo ambiente; é o que os testes do script usam.
API_DIR="${BTG_API_DIR:-/opt/based-turn-game/api}"
ENV_FILE="${BTG_ENV_FILE:-/etc/based-turn-game/api.env}"
SERVICE=based-turn-game-api
KEEP=3                       # quantas versões ficam guardadas na máquina

RELEASE="$API_DIR/releases/$RELEASE_ID"
SWITCHED=0

say() { printf '\n==> %s\n' "$*"; }

# Se algo falhar antes da troca, a versão pela metade é apagada e a que está
# no ar continua como estava.
cleanup() {
    local status=$?
    rm -f "$TARBALL"
    if [[ $status -ne 0 && $SWITCHED -eq 0 ]]; then
        rm -rf "$RELEASE"
        echo "Deploy interrompido: a versão que estava no ar não foi alterada." >&2
    fi
}
trap cleanup EXIT

restart_api() {
    sudo -n /usr/bin/systemctl restart "$SERVICE"
}

# Espera a API responder em /api/health (que também confere o banco).
wait_healthy() {
    local attempt
    for attempt in $(seq 1 30); do
        if curl -fs -o /dev/null --max-time 3 "http://127.0.0.1:${PORT:-3333}/api/health"; then
            return 0
        fi
        sleep 1
    done
    return 1
}

say "Instalando a versão $RELEASE_ID"
rm -rf "$RELEASE"
mkdir -p "$RELEASE"
tar -xzf "$TARBALL" -C "$RELEASE"
cd "$RELEASE"

# As mesmas variáveis que a API usa (banco, porta): o Prisma precisa delas.
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

# Com as dependências de desenvolvimento: o Prisma (migrações) e o ts-node
# (seed do administrador) estão entre elas.
npm ci --no-audit --no-fund
npx prisma generate

say "Aplicando as migrações do banco"
npx prisma migrate deploy

PREVIOUS="$(readlink -f "$API_DIR/current" 2> /dev/null || true)"

say "Trocando para a versão nova e reiniciando a API"
ln -sfn "$RELEASE" "$API_DIR/current.new"
mv -T "$API_DIR/current.new" "$API_DIR/current"
SWITCHED=1
restart_api

if ! wait_healthy; then
    echo "A versão nova não respondeu em /api/health." >&2

    if [[ -n "$PREVIOUS" && -d "$PREVIOUS" && "$PREVIOUS" != "$RELEASE" ]]; then
        echo "Voltando para a versão anterior ($(basename "$PREVIOUS"))." >&2
        ln -sfn "$PREVIOUS" "$API_DIR/current.new"
        mv -T "$API_DIR/current.new" "$API_DIR/current"
        restart_api
        rm -rf "$RELEASE"
        echo "Atenção: as migrações do banco já aplicadas não são desfeitas." >&2
    fi

    echo "Veja o motivo com: sudo journalctl -u $SERVICE -n 50" >&2
    exit 1
fi

# Guarda só as últimas versões (os nomes começam pela data, então a ordem
# alfabética é a ordem do tempo). A que está no ar nunca é apagada.
CURRENT="$(readlink -f "$API_DIR/current")"
ls -1 "$API_DIR/releases" | sort | head -n -"$KEEP" | while read -r old; do
    [[ "$API_DIR/releases/$old" == "$CURRENT" ]] || rm -rf "${API_DIR:?}/releases/$old"
done

say "Pronto: a API está no ar na versão $RELEASE_ID"
