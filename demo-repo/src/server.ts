import { createServer } from "node:http";
import { handle } from "./app";
import { createStore } from "./store";

const store = createStore();
const clock = () => new Date();
const port = Number(process.env.PORT ?? 4000);

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");

  let body: unknown;
  try {
    body = raw ? JSON.parse(raw) : undefined;
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid_json", message: "Body is not valid JSON." }));
    return;
  }

  const header = req.headers["x-member-id"];
  const response = handle(store, clock, {
    method: req.method ?? "GET",
    url: req.url ?? "/",
    actorId: typeof header === "string" ? header : null,
    body,
  });
  res.writeHead(response.status, { "content-type": "application/json" });
  res.end(JSON.stringify(response.body));
}).listen(port, "127.0.0.1", () => {
  console.log(`Roomly listening on http://127.0.0.1:${port}`);
});
