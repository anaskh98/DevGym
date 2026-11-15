/**
 * A small, safe reader for ticket bodies: headings, bullet lists and
 * paragraphs. It returns data, never HTML, so nothing in a ticket can inject
 * markup into the page.
 */
export type Block =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "list"; items: string[] }
  | { type: "paragraph"; text: string };

export function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", text: paragraph.join(" ") });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({ type: "list", items: list });
      list = null;
    }
  };

  for (const raw of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    const bullet = /^[-*]\s+(.+)$/.exec(line);

    if (!line) {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min((heading[1] as string).length, 3) as 1 | 2 | 3;
      blocks.push({ type: "heading", level, text: heading[2] as string });
    } else if (bullet) {
      flushParagraph();
      list ??= [];
      list.push(bullet[1] as string);
    } else if (list) {
      // A wrapped line continues the last bullet.
      list[list.length - 1] = `${list[list.length - 1]} ${line}`;
    } else {
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}
