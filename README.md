# Devine l'ATH
Jeu : devine l'ATH (market cap max) de coins Solana.

Ce dépôt ne contient que les données du jeu. Un robot (GitHub Actions, toutes les heures) ajoute de nouveaux coins, leurs logos, leurs paires de trading, le partage des fees et le tweet (ou le compte X) associé à chaque coin.
Le jeu lui-même est publié sur claude.ai et republié toutes les 4 h avec ces données.

- `coins.json` : les coins (nom, ticker, ATH, courbe, holders…)
- `artifact/` : page du jeu, logos, tweets, traductions, adresses des contrats
