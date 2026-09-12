import type {ReactNode} from "react";

const inlinePattern = /(!\[[^\]\n]*\]\([^\n)]+\)|`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g;

function inlineMarkdown(source: string, keyPrefix: string, resolveImage?: (source: string) => string): ReactNode[] {
  const output: ReactNode[] = [];
  let offset = 0;
  let tokenIndex = 0;
  for (const match of source.matchAll(inlinePattern)) {
    const index = match.index ?? 0;
    if (index > offset) output.push(source.slice(offset, index));
    const token = match[0];
    const key = `${keyPrefix}-${tokenIndex++}`;
    if (token.startsWith("![")) {
      const image = token.match(/^!\[([^\]]*)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)$/);
      const src = image && resolveImage ? resolveImage(image[2]) : "";
      if (image && src) output.push(<img key={key} src={src} alt={image[1]} loading="lazy" decoding="async" referrerPolicy="no-referrer" />);
      else if (image?.[1]) output.push(<span key={key}>{image[1]}</span>);
    } else if (token.startsWith("`")) {
      output.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**") || token.startsWith("__")) {
      output.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else {
      const link = token.match(/^\[([^\]]+)]\((https?:\/\/[^\s)]+)\)$/);
      if (link) output.push(<a key={key} href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a>);
      else output.push(token);
    }
    offset = index + token.length;
  }
  if (offset < source.length) output.push(source.slice(offset));
  return output;
}

function isBlockStart(line: string): boolean {
  return /^\s*$|^\s*```|^\s{0,3}#{1,6}\s+|^\s*[-*+•]\s+|^\s*\d+\.\s+|^\s*>\s?|^\s*(?:\*{3,}|-{3,}|_{3,})\s*$/.test(line);
}

export function CliffMarkdown({source, resolveImage}: {source: string; resolveImage?: (source: string) => string}) {
  const lines = String(source || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    const fence = line.match(/^\s*```([\w-]*)\s*$/);
    if (fence) {
      const values: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) values.push(lines[index++]);
      if (index < lines.length) index += 1;
      blocks.push(<pre key={`block-${blocks.length}`}><code data-language={fence[1] || undefined}>{values.join("\n")}</code></pre>);
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
    if (heading) {
      const key = `block-${blocks.length}`;
      const content = inlineMarkdown(heading[2].trim(), key, resolveImage);
      const level = Math.min(4, heading[1].length + 1);
      if (level === 2) blocks.push(<h2 key={key}>{content}</h2>);
      else if (level === 3) blocks.push(<h3 key={key}>{content}</h3>);
      else blocks.push(<h4 key={key}>{content}</h4>);
      index += 1;
      continue;
    }

    const unordered = line.match(/^\s*[-*+•]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (unordered || ordered) {
      const items: ReactNode[] = [];
      const matcher = ordered ? /^\s*\d+\.\s+(.+)$/ : /^\s*[-*+•]\s+(.+)$/;
      while (index < lines.length) {
        const item = lines[index].match(matcher);
        if (!item) break;
        const key = `block-${blocks.length}-item-${items.length}`;
        items.push(<li key={key}>{inlineMarkdown(item[1].trim(), key, resolveImage)}</li>);
        index += 1;
      }
      const key = `block-${blocks.length}`;
      blocks.push(ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>);
      continue;
    }

    if (/^\s*>/.test(line)) {
      const values: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) values.push(lines[index++].replace(/^\s*>\s?/, ""));
      const key = `block-${blocks.length}`;
      blocks.push(<blockquote key={key}>{inlineMarkdown(values.join(" "), key, resolveImage)}</blockquote>);
      continue;
    }

    if (/^\s*(?:\*{3,}|-{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(<hr key={`block-${blocks.length}`} />);
      index += 1;
      continue;
    }

    const values = [line.trim()];
    index += 1;
    while (index < lines.length && !isBlockStart(lines[index])) values.push(lines[index++].trim());
    const key = `block-${blocks.length}`;
    blocks.push(<p key={key}>{inlineMarkdown(values.join(" "), key, resolveImage)}</p>);
  }
  return <div className="cliff-message-content">{blocks}</div>;
}
