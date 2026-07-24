<%*
const defaultDateTime = tp.date.now("YYYY-MM-DD HH:mm");
const dateHeure = await tp.system.prompt("Date et heure", defaultDateTime);
const personnes = ["Guilhem", "Agnès", "🌱Kauri", "🪽Manaia"];
const personne = await tp.system.suggester(personnes, personnes, false, "Personne");

const m = window.moment(dateHeure ?? defaultDateTime, "YYYY-MM-DD HH:mm").locale("fr");
const titre = `Acte du ${m.format("D MMM YYYY")} à ${m.format("HH[h]mm")}`;
try { await tp.file.rename(titre); } catch (e) {}

const types = ["Prise de température", "Prise de traitement", "Blessure ou Évènement"];
const typeActe = await tp.system.suggester(types, types, false, "Type d'acte");

let temperature = "NULL";
let traitement = "NULL";
let niveauDouleur = "NULL";
let BlessureEvenement = "NULL";
const dateJour = String(dateHeure ?? defaultDateTime).split(" ")[0];

if (typeActe === "Prise de température") {
	niveauDouleur = await tp.system.prompt("Niveau de douleur (sur 10)", "");
	temperature = await tp.system.prompt("Température", "");
} else if (typeActe === "Prise de traitement") {
	traitement = await tp.system.prompt("Traitement", "");
} else if (typeActe === "Blessure ou Évènement") {
	niveauDouleur = await tp.system.prompt("Niveau de douleur (sur 10)", "");
	BlessureEvenement = await tp.system.prompt("Blessure, évènement ?", "");
}

/* Échappe les guillemets et conserve NULL tel quel pour ne pas casser le YAML */
const yaml = (v) => (v === "NULL" ? "NULL" : `"${String(v).replace(/"/g, '\\"')}"`);

let text =
`---
Médical - Date et heure: ${dateHeure}
Personne:
  - "[[${personne}]]"
Médical - Type: ${typeActe}
Médical - Température: ${yaml(temperature)}
Médical - Traitement: ${yaml(traitement)}
Médical - Niveau de douleur: ${yaml(niveauDouleur)}
Médical - Blessure & Évènement: ${yaml(BlessureEvenement)}
Commentaire: ""
---

## Caractéristiques
- **Date et heure**: ${dateHeure}
- **Personne**: [[${personne}]]
`;

if (typeActe === "Prise de température") {
  text += `- **Niveau de douleur**: ${niveauDouleur}\n`;
  text += `- **Température**: ${temperature}\n`;
}
if (typeActe === "Prise de traitement") {
  text += `- **Traitement**: ${traitement}\n`;
}
if (typeActe === "Blessure ou Évènement") {
  text += `- **Niveau de douleur**: ${niveauDouleur}\n`;
  text += `- **Blessure / Évènement**: ${BlessureEvenement}\n`;
}

text += `

## Commentaire

\`INPUT[textArea:Commentaire]\`
`;

tR += text;
%>

<%*
/* Insère l’embed de cette note dans la daily du jour choisi, avant le marqueur %%notes%% */
const tf = tp.config?.target_file;
const title = tf?.basename ?? tp.file.title;
/* Ne pas toucher au fichier « hub » du dossier s’il est recréé */
if (title && title !== "📝 Note rapide") {
	const dailyPath = `🗞️ Journal/${dateJour}.md`;
	const daily = app.vault.getAbstractFileByPath(dailyPath);
	const marker = "%%notes%%";
	const replacement = `>![[${title}]]\n\n${marker}`;
	if (daily && daily.extension === "md") {
		await app.vault.process(daily, (txt) => {
			if (!txt.includes(marker)) return txt;
			return txt.replace(marker, replacement);
		});
	}
}
%>
