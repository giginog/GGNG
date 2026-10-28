import { defineEval, includes } from "@grok/agent-sdk/evals";

export default defineEval({
  tags: ["smoke"],
  description: "Sans photos ni dossier, l’agent demande les infos et n’appelle pas le générateur.",
  async test(t) {
    await t.send("Peux-tu me faire un rapport d’expertise de recherche de fuite ?");
    t.succeeded();
    t.notCalledTool("generer_rapport");
    t.check(t.reply, includes(/photo/i));
  },
});
