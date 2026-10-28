import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import {
  generateRapportPptx,
  TECHNIQUE_CODES,
  todayParis,
  type PhotoInput,
  type PhotoRole,
  type TechniqueCode,
} from "../lib/pptx";

const Technique = z.enum(TECHNIQUE_CODES);

const Photo = z.object({
  path: z
    .string()
    .optional()
    .describe("Chemin de la photo dans l’espace de travail de la session, ou chemin absolu."),
  bytesBase64: z
    .string()
    .optional()
    .describe("Contenu JPEG/PNG encodé en base64, si le fichier n’est pas encore sur disque."),
  role: z.enum(["contexte", "constat"]).describe("contexte = page Contexte ; constat = pages photos d’investigation."),
  caption: z.string().optional(),
});

const Input = z.object({
  numeroDossier: z.string().min(1).describe("N° de dossier / n° de rapport."),
  lieu: z.string().min(1).describe("Adresse ou lieu du chantier."),
  pourQui: z.string().min(1).describe("Mandataire / gestionnaire / donneur d’ordre."),
  signale: z.string().min(1).describe("Ce qui a été signalé (désordre, fuite, sinistre)."),
  constate: z.string().min(1).describe("Ce qui a été constaté sur place."),
  dateIntervention: z
    .string()
    .optional()
    .describe("Date d’intervention au format JJ/MM/AAAA. Défaut : aujourd’hui (Europe/Paris)."),
  nom: z.string().optional().describe("Nom affiché sur la page de garde (occupant, site)."),
  siegeSocial: z.string().optional(),
  numeroReference: z.string().optional(),
  numeroSinistre: z.string().optional(),
  conclusion: z
    .string()
    .optional()
    .describe("Texte de la slide Conclusion. Défaut : le constat."),
  titreConstat: z.string().optional(),
  techniques: z
    .array(Technique)
    .optional()
    .describe("Techniques réellement utilisées. Les autres restent à NON."),
  photos: z.array(Photo).optional(),
});

function safeFilePart(value: string): string {
  const cleaned = value.replace(/[^\p{L}\p{N}_.-]+/gu, "-").replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 40) || "dossier";
}

function sniffMime(data: Uint8Array): "image/jpeg" | "image/png" {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return "image/png";
  }
  throw new Error("Photo : formats acceptés JPEG et PNG uniquement");
}

async function readPhotoBytes(
  photo: z.infer<typeof Photo>,
  workspaceDir: string | undefined,
  files: {
    readBytes: (p: string) => Promise<Uint8Array | undefined>;
  },
): Promise<Uint8Array> {
  if (photo.bytesBase64) {
    return Uint8Array.from(Buffer.from(photo.bytesBase64, "base64"));
  }
  if (!photo.path) {
    throw new Error("Chaque photo doit fournir path ou bytesBase64");
  }
  const candidates = [
    photo.path,
    workspaceDir ? path.resolve(workspaceDir, photo.path) : undefined,
  ].filter((p): p is string => Boolean(p));

  const { readFile } = await import("node:fs/promises");
  for (const candidate of candidates) {
    try {
      return new Uint8Array(await readFile(candidate));
    } catch {
      // try next
    }
  }
  const hosted = await files.readBytes(photo.path);
  if (hosted) return hosted;
  throw new Error(`Photo introuvable : ${photo.path}`);
}

export default defineTool({
  description: prompt`
    Génère le PowerPoint d’expertise de recherche de fuite (modèle ARF V21).
    À appeler seulement quand le numéro de dossier, le lieu, le mandataire,
    le signalement et le constat sont connus (saisis ou confirmés).
    Les photos JPEG/PNG du workspace sont optionnelles mais fortement recommandées.
  `,
  inputSchema: Input,
  effect: "write",
  dryRunResult: ({ numeroDossier }) => ({
    generated: false,
    fileName: `Rapport-${safeFilePart(numeroDossier)}.pptx`,
  }),
  async execute(input, ctx) {
    const dateIntervention = input.dateIntervention?.trim() || todayParis();
    const photos: PhotoInput[] = [];
    for (const photo of input.photos ?? []) {
      const data = await readPhotoBytes(photo, ctx.workspaceDir, ctx.host.files);
      photos.push({
        bytes: data,
        mimeType: sniffMime(data),
        role: photo.role as PhotoRole,
        caption: photo.caption,
      });
    }

    const pptx = generateRapportPptx({
      numeroDossier: input.numeroDossier.trim(),
      lieu: input.lieu.trim(),
      pourQui: input.pourQui.trim(),
      signale: input.signale.trim(),
      constate: input.constate.trim(),
      dateIntervention,
      nom: input.nom,
      siegeSocial: input.siegeSocial,
      numeroReference: input.numeroReference,
      numeroSinistre: input.numeroSinistre,
      conclusion: input.conclusion,
      titreConstat: input.titreConstat,
      techniques: (input.techniques ?? []) as TechniqueCode[],
      photos,
    });

    const fileName = `Rapport-${safeFilePart(input.numeroDossier)}.pptx`;
    const relativePath = path.posix.join("rapports", fileName);
    let workspacePath: string | undefined;
    if (ctx.workspaceDir) {
      const absDir = path.join(ctx.workspaceDir, "rapports");
      await mkdir(absDir, { recursive: true });
      const absFile = path.join(absDir, fileName);
      await writeFile(absFile, pptx);
      workspacePath = absFile;
    }
    try {
      await ctx.host.files.write(relativePath, pptx);
    } catch {
      await ctx.host.files.write(relativePath, pptx, { scope: "deployment" });
    }

    let artifactId: string | undefined;
    try {
      const artifact = await ctx.artifacts.tag({
        kind: "rapport-pptx",
        key: `rapport:${input.numeroDossier.trim()}`,
        title: `Rapport ${input.numeroDossier.trim()}`,
        data: {
          numeroDossier: input.numeroDossier.trim(),
          fileName,
          path: relativePath,
          slideHint: "page de garde, contexte, techniques, constat, conclusion",
        },
        contents: pptx,
        contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      });
      artifactId = artifact.id;
    } catch {
      // Direct tool calls may have no session to attribute.
    }

    return {
      generated: true,
      fileName,
      path: relativePath,
      workspacePath,
      bytes: pptx.byteLength,
      photos: photos.length,
      artifactId,
      dateIntervention,
    };
  },
});
