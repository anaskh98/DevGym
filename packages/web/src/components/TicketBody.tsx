import { parseBlocks } from "../lib/markdown";

/** Renders a ticket's Markdown body as headings, lists and paragraphs. */
export function TicketBody({ body }: { body: string }) {
  return (
    <div className="ticket-body">
      {parseBlocks(body).map((block, index) => {
        if (block.type === "heading") return <h3 key={index}>{block.text}</h3>;
        if (block.type === "list") {
          return (
            <ul key={index}>
              {block.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          );
        }
        return <p key={index}>{block.text}</p>;
      })}
    </div>
  );
}
