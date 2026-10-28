import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzip, zip } from "./zip";
import { bytes, paragraphsXml, replaceToken, utf8, xmlEscape } from "./xml";

const here = path.dirname(fileURLToPath(import.meta.url));
export const TEMPLATE_PATH = path.resolve(here, "../../assets/Modele-V21.potm");

export const TECHNIQUE_CODES = ["TH", "PM", "MF", "CE", "TA", "COL", "IR"] as const;
export type TechniqueCode = (typeof TECHNIQUE_CODES)[number];

export const TECHNIQUE_LABELS: Record<TechniqueCode, string> = {
  TH: "Testeur d’humidité",
  PM: "Test de pression au manomètre digital",
  MF: "Machine à fumée",
  CE: "Caméra endoscopique et détection de conduites",
  TA: "Test d’aspersion",
  COL: "Colorants",
  IR: "Caméra infrarouge (thermographie)",
};

export type PhotoRole = "contexte" | "constat";

export type PhotoInput = {
  bytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png";
  role: PhotoRole;
  caption?: string;
};

export type RapportInput = {
  numeroDossier: string;
  lieu: string;
  pourQui: string;
  signale: string;
  constate: string;
  dateIntervention: string;
  nom?: string;
  siegeSocial?: string;
  numeroReference?: string;
  numeroSinistre?: string;
  conclusion?: string;
  titreConstat?: string;
  techniques: TechniqueCode[];
  photos: PhotoInput[];
};

type Pkg = Map<string, Uint8Array>;

type Placeholder = {
  type: string;
  idx: string;
  x?: string;
  y?: string;
  cx?: string;
  cy?: string;
};

const SLIDE_NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

function getText(pkg: Pkg, name: string): string {
  const data = pkg.get(name);
  if (!data) throw new Error(`Pièce manquante dans le modèle : ${name}`);
  return utf8(data);
}

function setText(pkg: Pkg, name: string, xml: string): void {
  pkg.set(name, bytes(xml));
}

function layoutPath(n: number): string {
  return `ppt/slideLayouts/slideLayout${n}.xml`;
}

function parsePlaceholders(layoutXml: string): Placeholder[] {
  const out: Placeholder[] = [];
  const blocks = layoutXml.matchAll(/<p:(?:sp|pic)\b[\s\S]*?<\/p:(?:sp|pic)>/g);
  for (const match of blocks) {
    const block = match[0];
    const ph = block.match(/<p:ph\b([^>]*)\/?>/);
    if (!ph) continue;
    const attrs = ph[1] ?? "";
    const type = attrs.match(/\btype="([^"]+)"/)?.[1] ?? "body";
    const idx = attrs.match(/\bidx="([^"]+)"/)?.[1] ?? "0";
    const off = block.match(/<a:off x="([^"]+)" y="([^"]+)"/);
    const ext = block.match(/<a:ext cx="([^"]+)" cy="([^"]+)"/);
    out.push({
      type,
      idx,
      x: off?.[1],
      y: off?.[2],
      cx: ext?.[1],
      cy: ext?.[2],
    });
  }
  return out;
}

function detectImage(data: Uint8Array): { ext: "jpeg" | "png"; mime: "image/jpeg" | "image/png" } {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { ext: "jpeg", mime: "image/jpeg" };
  }
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47
  ) {
    return { ext: "png", mime: "image/png" };
  }
  throw new Error("Photo : formats acceptés JPEG et PNG uniquement");
}

function nextMediaIndex(pkg: Pkg): number {
  let max = 0;
  for (const name of pkg.keys()) {
    const m = name.match(/^ppt\/media\/image(\d+)\./);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

function addMedia(pkg: Pkg, photo: PhotoInput): { target: string; contentType: string } {
  const kind = detectImage(photo.bytes);
  const idx = nextMediaIndex(pkg);
  pkg.set(`ppt/media/image${idx}.${kind.ext}`, photo.bytes);
  return { target: `../media/image${idx}.${kind.ext}`, contentType: kind.mime };
}

function bodyShape(id: number, idx: string, lines: string[]): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Texte ${id}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="${idx}"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphsXml(lines)}</p:txBody></p:sp>`;
}

function emptyPicShape(id: number, idx: string): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Image ${id}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="pic" sz="quarter" idx="${idx}"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="fr-FR"/></a:p></p:txBody></p:sp>`;
}

function picShape(
  id: number,
  idx: string,
  rid: string,
  geom: Placeholder | undefined,
  caption: string,
): string {
  const xfrm =
    geom?.x && geom.y && geom.cx && geom.cy
      ? `<a:xfrm><a:off x="${geom.x}" y="${geom.y}"/><a:ext cx="${geom.cx}" cy="${geom.cy}"/></a:xfrm>`
      : "";
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Photo ${id}" descr="${xmlEscape(caption)}"/><p:cNvPicPr><a:picLocks noChangeAspect="0"/></p:cNvPicPr><p:nvPr><p:ph type="pic" sz="quarter" idx="${idx}"/></p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

function slideXml(shapes: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${SLIDE_NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

function slideRels(layoutN: number, images: { rid: string; target: string }[]): string {
  const rels = [
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout${layoutN}.xml"/>`,
    ...images.map(
      (img) =>
        `<Relationship Id="${img.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${img.target}"/>`,
    ),
  ];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`;
}

function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines : ["—"];
}

function contextLayout(n: number): number {
  if (n <= 1) return 2;
  if (n === 2) return 3;
  return 4;
}

function constatChunks(photos: PhotoInput[]): { layout: number; photos: PhotoInput[] }[] {
  const chunks: { layout: number; photos: PhotoInput[] }[] = [];
  let rest = photos;
  while (rest.length) {
    if (rest.length >= 7) {
      chunks.push({ layout: 15, photos: rest.slice(0, 7) });
      rest = rest.slice(7);
    } else if (rest.length === 6) {
      chunks.push({ layout: 15, photos: rest });
      rest = [];
    } else if (rest.length === 5) {
      chunks.push({ layout: 13, photos: rest });
      rest = [];
    } else if (rest.length === 4) {
      chunks.push({ layout: 11, photos: rest });
      rest = [];
    } else if (rest.length === 3) {
      chunks.push({ layout: 6, photos: rest });
      rest = [];
    } else {
      chunks.push({ layout: 7, photos: rest });
      rest = [];
    }
  }
  return chunks;
}

function buildPhotoSlide(
  pkg: Pkg,
  layoutN: number,
  title: string,
  photos: PhotoInput[],
  extraBodies?: { idx: string; lines: string[] }[],
): { xml: string; rels: string } {
  const layoutXml = getText(pkg, layoutPath(layoutN));
  const placeholders = parsePlaceholders(layoutXml);
  const picPhs = placeholders.filter((p) => p.type === "pic");
  const bodyPhs = placeholders.filter((p) => p.type === "body");
  const images: { rid: string; target: string }[] = [];
  const shapes: string[] = [];
  let id = 2;

  const extraByIdx = new Map((extraBodies ?? []).map((b) => [b.idx, b.lines]));
  for (const body of bodyPhs) {
    const lines = extraByIdx.get(body.idx) ?? [title];
    shapes.push(bodyShape(id++, body.idx, lines));
  }

  picPhs.forEach((ph, i) => {
    const photo = photos[i];
    if (!photo) {
      shapes.push(emptyPicShape(id++, ph.idx));
      return;
    }
    const media = addMedia(pkg, photo);
    const rid = `rId${images.length + 2}`;
    images.push({ rid, target: media.target });
    shapes.push(picShape(id++, ph.idx, rid, ph, photo.caption ?? title));
  });

  return { xml: slideXml(shapes), rels: slideRels(layoutN, images) };
}

function stripVba(pkg: Pkg): void {
  pkg.delete("ppt/vbaProject.bin");
  let rels = getText(pkg, "ppt/_rels/presentation.xml.rels");
  rels = rels.replace(
    /<Relationship[^>]*Target="vbaProject\.bin"[^>]*\/>/,
    "",
  );
  setText(pkg, "ppt/_rels/presentation.xml.rels", rels);

  let types = getText(pkg, "[Content_Types].xml");
  types = types.replace(
    'application/vnd.ms-powerpoint.template.macroEnabled.main+xml',
    "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
  );
  types = types.replace(
    /<Default Extension="bin" ContentType="application\/vnd\.ms-office\.vbaProject"\/>/,
    "",
  );
  setText(pkg, "[Content_Types].xml", types);
}

function applyTokens(pkg: Pkg, input: RapportInput): void {
  const contexte = `Signalement :\n${input.signale}\n\nConstat :\n${input.constate}`;
  for (const [name, data] of [...pkg.entries()]) {
    if (!name.endsWith(".xml")) continue;
    let xml = utf8(data);
    xml = replaceToken(xml, "{{NumRapport}}", input.numeroDossier);
    xml = replaceToken(xml, "{{DateIntervention}}", input.dateIntervention);
    xml = replaceToken(xml, "{{Contexte}}", contexte);
    xml = xml.replaceAll("JJ/MM/AAAA", xmlEscape(input.dateIntervention));
    xml = xml.replace(/N° de rapport\r?\n0000/g, `N° de rapport\n${xmlEscape(input.numeroDossier)}`);
    pkg.set(name, bytes(xml));
  }
}

function applyTechniques(pkg: Pkg, used: TechniqueCode[]): void {
  const set = new Set(used);
  const flags = TECHNIQUE_CODES.map((code) => set.has(code));
  let xml = getText(pkg, layoutPath(5));
  let i = 0;
  xml = xml.replace(/<a:t>NON<\/a:t>/g, (m) => {
    if (i < flags.length && flags[i]) {
      i += 1;
      return "<a:t>OUI</a:t>";
    }
    i += 1;
    return m;
  });
  i = 0;
  xml = xml.replace(/<a:srgbClr val="7F7F7F"\/>/g, (m) => {
    if (i < flags.length && flags[i]) {
      i += 1;
      return '<a:srgbClr val="2E7D32"/>';
    }
    i += 1;
    return m;
  });
  setText(pkg, layoutPath(5), xml);
}

function writeSlide(
  pkg: Pkg,
  n: number,
  xml: string,
  rels: string,
): void {
  setText(pkg, `ppt/slides/slide${n}.xml`, xml);
  setText(pkg, `ppt/slides/_rels/slide${n}.xml.rels`, rels);
  let types = getText(pkg, "[Content_Types].xml");
  const part = `/ppt/slides/slide${n}.xml`;
  if (!types.includes(`PartName="${part}"`)) {
    types = types.replace(
      "</Types>",
      `<Override PartName="${part}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`,
    );
    setText(pkg, "[Content_Types].xml", types);
  }
}

function rebuildPresentation(pkg: Pkg, slideCount: number): void {
  let pres = getText(pkg, "ppt/presentation.xml");
  const ids = Array.from({ length: slideCount }, (_, i) => {
    const sldId = 300 + i;
    const rId = 40 + i;
    return `<p:sldId id="${sldId}" r:id="rId${rId}"/>`;
  }).join("");
  pres = pres.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, `<p:sldIdLst>${ids}</p:sldIdLst>`);
  setText(pkg, "ppt/presentation.xml", pres);

  let rels = getText(pkg, "ppt/_rels/presentation.xml.rels");
  rels = rels.replace(
    /<Relationship[^>]*Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/slide"[^>]*\/>/g,
    "",
  );
  const slideRelsXml = Array.from({ length: slideCount }, (_, i) => {
    const rId = 40 + i;
    return `<Relationship Id="rId${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`;
  }).join("");
  rels = rels.replace("</Relationships>", `${slideRelsXml}</Relationships>`);
  setText(pkg, "ppt/_rels/presentation.xml.rels", rels);

  for (const name of [...pkg.keys()]) {
    const m = name.match(/^ppt\/slides\/slide(\d+)\.xml$/);
    if (m && Number(m[1]) > slideCount) {
      pkg.delete(name);
      pkg.delete(`ppt/slides/_rels/slide${m[1]}.xml.rels`);
    }
  }
}

function coverSlide(input: RapportInput): { xml: string; rels: string } {
  const nom = input.nom?.trim() || "—";
  const lieu = input.lieu.trim();
  const mandataire = input.pourQui.trim();
  const siege = input.siegeSocial?.trim() || "—";
  const ref = input.numeroReference?.trim()
    ? `N° de référence : ${input.numeroReference.trim()}`
    : "N° de référence : —";
  const sinistre = input.numeroSinistre?.trim()
    ? `N° de sinistre : ${input.numeroSinistre.trim()}`
    : "N° de sinistre : —";
  const xml = slideXml([
    bodyShape(2, "10", [nom, lieu]),
    bodyShape(3, "11", [mandataire, siege, ref, sinistre]),
  ]);
  return { xml, rels: slideRels(1, []) };
}

export function todayParis(): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
}

export function generateRapportPptx(input: RapportInput, templatePath = TEMPLATE_PATH): Uint8Array {
  const pkg = unzip(readFileSync(templatePath));
  stripVba(pkg);
  applyTokens(pkg, input);
  applyTechniques(pkg, input.techniques);

  const contexteAll = input.photos.filter((p) => p.role === "contexte");
  const contextePhotos = contexteAll.slice(0, 3);
  const constatPhotos = [
    ...contexteAll.slice(3),
    ...input.photos.filter((p) => p.role === "constat"),
  ];
  const contexteText = splitLines(
    `Signalement :\n${input.signale}\n\nConstat :\n${input.constate}`,
  );
  const conclusionText = splitLines(input.conclusion?.trim() || input.constate);
  const titreConstat = input.titreConstat?.trim() || "CONSTAT";

  const slides: { xml: string; rels: string }[] = [];
  slides.push(coverSlide(input));

  const ctxLayout = contextLayout(contextePhotos.length);
  slides.push(
    buildPhotoSlide(pkg, ctxLayout, "CONTEXTE", contextePhotos, [
      { idx: "10", lines: contexteText },
    ]),
  );

  slides.push({
    xml: slideXml([]),
    rels: slideRels(5, []),
  });

  for (const chunk of constatChunks(constatPhotos)) {
    slides.push(buildPhotoSlide(pkg, chunk.layout, titreConstat, chunk.photos));
  }

  slides.push({
    xml: slideXml([bodyShape(2, "10", conclusionText)]),
    rels: slideRels(17, []),
  });

  slides.forEach((slide, i) => writeSlide(pkg, i + 1, slide.xml, slide.rels));
  rebuildPresentation(pkg, slides.length);

  let app = getText(pkg, "docProps/app.xml");
  app = app.replace(/<Slides>\d+<\/Slides>/, `<Slides>${slides.length}</Slides>`);
  setText(pkg, "docProps/app.xml", app);

  let core = getText(pkg, "docProps/core.xml");
  core = core.replace(
    /<dc:title>.*<\/dc:title>/,
    `<dc:title>Rapport ${xmlEscape(input.numeroDossier)}</dc:title>`,
  );
  setText(pkg, "docProps/core.xml", core);

  return zip(pkg);
}

export { detectImage };
