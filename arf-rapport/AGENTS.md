# arf-rapport

Agent SDK (`@grok/agent-sdk`) : rapports PowerPoint d’expertise de recherche de fuite (modèle V21). Prompt : `bot/instructions.md`.

## Loop

```bash
npx @grok/agent-sdk validate --dir .
npx @grok/agent-sdk info --dir . --json
npx @grok/agent-sdk tool call generer_rapport --dir . --input '{"numeroDossier":"2401","lieu":"12 rue Test, Montpellier","pourQui":"Cabinet Dupont","signale":"Tache au plafond","constate":"Humidité en pied de cloison"}' --json
npx tsc --noEmit -p .
npx @grok/agent-sdk run --dir . --message "Peux-tu me faire un rapport d’expertise ?"
npx @grok/agent-sdk eval --dir .
```

Node, jamais Bun. `serve` uniquement ce dossier.

## Layout

- `bot/tools/generer_rapport.ts` — génération `.pptx`
- `bot/lib/pptx.ts` — clone OOXML du modèle `assets/Modele-V21.potm`
- `bot/skills/generation-rapport.md` — mapping des layouts V21
- `evals/smoke.eval.ts` — l’agent n’invente pas un rapport à vide
