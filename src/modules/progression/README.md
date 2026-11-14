# Módulo de progressão

Ouro, diamantes, personagens desbloqueados, conquistas e loja.

- **Personagens iniciais** (todo jogador tem): Piromante, Cavaleiro, Sacerdote, Bárbaro, Criomante e Arqueiro.
- Os outros são desbloqueados por uma **conquista** ou comprados na **loja** (ouro ou diamantes).
- **Ouro**: ganho no fim de cada batalha (fora o treino) e nas conquistas. **Diamantes**: o recurso pago; por enquanto vêm de conquistas raras e do administrador.
- Conquistas, preços e o ouro das batalhas ficam em `progression.catalog.ts`.
- As conquistas são conferidas quando uma batalha acaba e quando a tela pede o progresso (quem já jogava recebe o que já tinha feito).
- Batalha contra a IA e salas só aceitam personagens desbloqueados (`CHARACTER_LOCKED`). Na ranqueada a seleção usa todos os personagens.

| Método | Rota | O que faz |
| --- | --- | --- |
| GET | `/api/progression` | Saldo, personagens, conquistas com progresso e a loja. |
| POST | `/api/progression/shop` | `{ characterId, currency: "gold" \| "diamonds" }`: compra. |
| GET | `/api/progression/battles/:id` | O ouro e as conquistas que o jogador ganhou naquela batalha. |
| POST | `/api/progression/users/:id/grant` | `{ gold, diamonds }` (administrador): dá ou tira recursos. |

Depois de atualizar, rode `npx prisma migrate deploy` (ou `migrate dev`) e `npx prisma generate`.
