# Génération du rapport V21

## Quand l’utiliser

Dès qu’il faut remplir ou appeler `generer_rapport` (photos classées, champs confirmés, choix de techniques).

## Structure du .pptx (modèle V21, portrait ~A4)

1. **Page de garde** (layout 1) — n° de rapport, date, nom, lieu, mandataire, siège, n° de référence, n° de sinistre.
2. **Contexte** (layout 2 / 3 / 4 selon 1, 2 ou 3 photos) — texte « Signalement / Constat » + photos `role=contexte`.
3. **Techniques utilisées** (layout 5) — tableau OUI/NON. Codes :
   - `TH` testeur d’humidité
   - `PM` manomètre digital
   - `MF` machine à fumée
   - `CE` caméra endoscopique
   - `TA` test d’aspersion
   - `COL` colorants
   - `IR` caméra infrarouge
   N’envoie dans `techniques` que celles **effectivement utilisées**. Les autres restent à NON.
4. **Constat** — grilles photo (layouts 7, 6, 11, 13, 15 selon 2, 3, 4, 5, 7 photos). Titre par défaut : `CONSTAT`.
5. **Conclusion** (layout 17) — `conclusion` si fourni, sinon le constat.

Le fichier de sortie est un `.pptx` (macros VBA du .potm retirées). Le pied de page du masque reprend `Dossier n° … / Date d’intervention …`.

## Appel outil

`generer_rapport` avec au minimum : `numeroDossier`, `lieu`, `pourQui`, `signale`, `constate`. Photos : `{ path, role, caption? }`.

Après succès, cite `workspacePath` et `fileName` à l’utilisateur. Ne régénère pas sans demande si le fichier existe déjà pour le même dossier, sauf correction.
