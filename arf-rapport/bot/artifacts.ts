import { defineArtifacts } from "@grok/agent-sdk/artifacts";
import * as z from "zod/v4";

export default defineArtifacts({
  kinds: {
    "rapport-pptx": {
      description: "Rapport d’expertise de recherche de fuite au format PowerPoint (modèle V21).",
      schema: z.object({
        numeroDossier: z.string(),
        fileName: z.string(),
        path: z.string(),
        slideHint: z.string().optional(),
      }),
    },
  },
});
