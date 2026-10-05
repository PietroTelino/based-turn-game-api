# Módulo de estatísticas

Os personagens mais usados: pelo próprio jogador e no jogo todo. A rota exige
login (`Authorization: Bearer <accessToken>`).

```
GET /api/stats/characters
```

```json
{
    "mine": { "teams": 12, "characters": [{ "characterId": "barbaro", "picks": 9, "share": 0.75 }] },
    "global": { "teams": 340, "characters": [{ "characterId": "sacerdote", "picks": 210, "share": 0.62 }] }
}
```

- `mine` conta os times que quem pediu montou; `global`, os de todos os
  jogadores somados. A lista do jogo traz só as contagens: nenhum jogador é
  identificado.
- `picks` é em quantos times o personagem entrou e `share` é a fração dos
  times (`teams`). As listas vêm do mais usado para o menos usado, e só com
  quem foi usado ao menos uma vez.
- Contam os times montados por jogadores, contra a IA, nas salas e na
  ranqueada. O time sorteado para a IA e a batalha de treino não entram.

## De onde vêm os números

Da tabela `battle_picks` (model `BattlePick`): uma linha por personagem, por
jogador, por batalha. Quem grava é o módulo de batalhas, ao criar cada uma.

As batalhas que já existiam antes de essa tabela ser criada entram com:

```bash
npm run stats:backfill
```

O comando lê o time de cada batalha antiga do estado gravado
(`picks-from-state.ts`) e pode rodar mais de uma vez: batalha que já tem as
escolhas gravadas é pulada. Numa batalha antiga em que um personagem foi
erguido como Guerreiro Esqueleto, esse personagem fica de fora, porque o
estado não guarda mais quem ele era.

## Arquivos

| Arquivo | Para que serve |
| --- | --- |
| `stats.service.ts` | Monta as duas listas a partir das contagens. |
| `stats.repository.ts` | A contagem, com o Prisma. |
| `picks-from-state.ts` | Lê os personagens de uma batalha antiga do estado gravado. |
| `backfill.ts` | O comando `npm run stats:backfill`. |
| `tests/` | Testes do serviço e da leitura das batalhas antigas. |
