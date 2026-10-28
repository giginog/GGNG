export function xmlEscape(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("\r\n", "&#xA;")
    .replaceAll("\n", "&#xA;")
    .replaceAll("\r", "&#xA;");
}

export function utf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

export function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function paragraphsXml(lines: string[]): string {
  const parts = lines.map((l) => l.trim()).filter(Boolean);
  const safe = parts.length ? parts : ["—"];
  return safe
    .map(
      (line) =>
        `<a:p><a:r><a:rPr lang="fr-FR" dirty="0"/><a:t>${xmlEscape(line)}</a:t></a:r></a:p>`,
    )
    .join("");
}

export function replaceToken(haystack: string, token: string, value: string): string {
  return haystack.split(token).join(xmlEscape(value));
}
