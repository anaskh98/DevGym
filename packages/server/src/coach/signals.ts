// Signal rules: one-line patterns in added code that show a ladder item, for or against.
// The ladder says which items use a signal and whether it counts for or against; here is only how to spot it.
// Regex rules miss things and sometimes hit wrongly. The examples below are tested, and the developer can disagree.
import type { LineRule } from "../rules/engine.js";

export interface SignalExample {
  file: string;
  line: string;
}
export interface SignalRule extends LineRule {
  /** What the signal means, in plain words. Used to word questions; never shows code. */
  meaning: string;
  examples: { hit: SignalExample[]; miss: SignalExample[] };
}

const CODE = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py", ".go", ".java", ".kt", ".cs", ".rb", ".php"] as const;
const WEB = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".vue", ".svelte"] as const;

const ts = (line: string): SignalExample => ({ file: "src/pay.ts", line });
const py = (line: string): SignalExample => ({ file: "app/pay.py", line });
const go = (line: string): SignalExample => ({ file: "pay/pay.go", line });
const java = (line: string): SignalExample => ({ file: "src/Pay.java", line });
const tsx = (line: string): SignalExample => ({ file: "web/Orders.tsx", line });

export const SIGNALS: readonly SignalRule[] = [
  {
    id: "err.empty-catch",
    meaning: "an error is caught and then ignored",
    pattern: /\bcatch\s*(\([^)]*\))?\s*\{\s*\}|^\s*except\b[^:]*:\s*pass\s*$|\bif\s+err\s*!=\s*nil\s*\{\s*\}/,
    extensions: CODE,
    examples: {
      hit: [ts("} catch (e) {}"), ts("try { save(); } catch {}"), py("except Exception: pass"), go("if err != nil {}"), java("} catch (IOException e) { }")],
      miss: [ts("} catch (e) { log.error(e); throw e; }"), py("except ValueError: return None"), ts("promise.catch(() => {})")],
    },
  },
  {
    id: "err.timeout-set",
    meaning: "a time limit is set on a call to something outside",
    pattern:
      /AbortSignal\.timeout\(|\btimeout\s*[:=]\s*\d|context\.WithTimeout\(|\.timeout\(\s*Duration|\b(connect|read|request|socket)Timeout\s*[:=(]\s*\d|\.Timeout\s*=\s*TimeSpan/i,
    unless: /\btimeout\s*[:=]\s*0\b/i,
    extensions: CODE,
    examples: {
      hit: [
        ts("const res = await fetch(url, { signal: AbortSignal.timeout(5000) });"),
        ts("const client = axios.create({ timeout: 3000 });"),
        py("r = requests.post(url, json=body, timeout=5)"),
        go("ctx, cancel := context.WithTimeout(ctx, 5*time.Second)"),
      ],
      miss: [ts("// timeout: 5000"), ts("const res = await fetch(url);"), ts("axios.create({ timeout: 0 })")],
    },
  },
  {
    id: "err.retry-backoff",
    meaning: "a failed call is retried with backoff or jitter",
    pattern: /(retr(y|ies|yable)|attempt)\w*.*(backoff|jitter|exponential)|(backoff|jitter|exponential)\w*.*(retr(y|ies)|attempt)/i,
    extensions: CODE,
    examples: {
      hit: [
        ts('await retry(charge, { retries: 3, backoff: "exponential" });'),
        java("@Retryable(maxAttempts = 3, backoff = @Backoff(delay = 200))"),
        py("@retry(wait=wait_exponential(min=1), stop=stop_after_attempt(3))"),
      ],
      miss: [ts("retries++;"), ts("const backoffMs = 200;"), ts("for (let attempt = 0; attempt < 3; attempt++) {")],
    },
  },
  {
    id: "err.error-cause",
    meaning: "a new error keeps the error that caused it",
    pattern:
      /\{\s*cause\s*:|\{\s*cause\s*\}|\braise\s+\w+(\(.*\))?\s+from\s+\w+|fmt\.Errorf\(.*%w|new\s+\w*(Exception|Error)\([^)]*,\s*(e|err|ex|error|cause)\s*\)/,
    extensions: CODE,
    examples: {
      hit: [
        ts('throw new PaymentError("charge failed", { cause: err });'),
        py('raise ChargeError("failed") from exc'),
        go('return fmt.Errorf("charge: %w", err)'),
        java('throw new RuntimeException("charge failed", e);'),
      ],
      miss: [ts('throw new Error("charge failed");'), py('raise ChargeError("failed")')],
    },
  },
  {
    id: "err.rethrow-message-only",
    meaning: "an error is thrown again with only its message, so its cause and stack are lost",
    pattern: /throw\s+new\s+Error\(\s*(e|err|error|ex)(\.message)?\s*\)|throw\s+new\s+\w*Exception\(\s*\w+\.getMessage\(\)\s*\)/,
    extensions: CODE,
    examples: {
      hit: [ts("throw new Error(e.message);"), ts("throw new Error(err)"), java("throw new RuntimeException(e.getMessage());")],
      miss: [ts('throw new Error("bad input");'), ts("throw new Error(err.message, { cause: err });")],
    },
  },
  {
    id: "err.error-leak",
    meaning: "raw error details are sent to the client",
    pattern: /\.(json|send)\(\s*(err|error|e|ex)(\.stack)?\s*\)|\.send\(\s*\w+\.stack\s*\)/,
    extensions: CODE,
    examples: {
      hit: [ts("res.status(500).json(err);"), ts("res.send(err.stack);"), ts("return res.status(500).send(error)")],
      miss: [ts('res.status(500).json({ error: "Something went wrong" });'), ts("res.json(result);")],
    },
  },
  {
    id: "fetch.console-only",
    meaning: "a failed request is only logged or ignored, so the user sees nothing",
    pattern: /\.catch\(\s*(console\.\w+\s*\)|\(\s*\w*\s*\)\s*=>\s*(\{\s*\}|console\.\w+\(\s*\w*\s*\)\s*\)))/,
    extensions: WEB,
    examples: {
      hit: [tsx("fetch(url).then((r) => r.json()).catch(console.error);"), tsx("load().catch(() => {});"), tsx("load().catch((e) => console.log(e));")],
      miss: [tsx("load().catch((e) => setError(e));"), tsx("load().catch(handleError);")],
    },
  },
  {
    id: "fetch.res-ok-check",
    meaning: "the response status is checked before the data is used",
    pattern: /!\s*(res|response|resp|r)\.ok\b|\b(res|response|resp|r)\.ok\s*(\)|&&|\?)|\.status\s*>=\s*400|\.status\s*<\s*200/,
    extensions: WEB,
    examples: {
      hit: [tsx("if (!res.ok) throw new Error(`HTTP ${res.status}`);"), tsx("if (response.status >= 400) {"), tsx("return r.ok ? r.json() : null;")],
      miss: [tsx("const data = await res.json();"), tsx("setState({ ok: true });")],
    },
  },
  {
    id: "fetch.abort-controller",
    meaning: "a request can be cancelled when it is no longer needed",
    pattern: /new\s+AbortController\(\)|\bsignal\s*:\s*\w+(\.signal)?/,
    extensions: WEB,
    examples: {
      hit: [tsx("const controller = new AbortController();"), tsx("fetch(url, { signal: controller.signal })")],
      miss: [tsx("const signals = [];"), tsx('emitter.on("signal", onSignal);')],
    },
  },
  {
    id: "fetch.loading-state",
    meaning: "the screen shows that data is still loading",
    pattern: /\b(isLoading|isPending|isFetching)\b|\bsetLoading\(|\bstatus\s*===?\s*['"](loading|pending)['"]/,
    extensions: WEB,
    examples: {
      hit: [tsx("const { data, isLoading } = useQuery({ queryKey: ['orders'], queryFn });"), tsx("setLoading(true);"), tsx('if (status === "loading") return <Spinner />;')],
      miss: [tsx("const loaded = true;"), tsx("loadUser();")],
    },
  },
  {
    id: "fetch.error-boundary",
    meaning: "a broken part of the screen is caught and replaced with a fallback",
    pattern: /\bErrorBoundary\b|\bcomponentDidCatch\b|\bgetDerivedStateFromError\b/,
    extensions: WEB,
    examples: {
      hit: [tsx("<ErrorBoundary fallback={<Oops />}>"), tsx("componentDidCatch(error, info) {")],
      miss: [tsx("<Boundary>"), tsx('import { ErrorBoundary } from "react-error-boundary";')],
    },
  },
  // Exposure signals: they show the developer had the chance to use a skill, not that they used it well.
  {
    id: "io.outside-call",
    meaning: "a call to an outside service",
    pattern: /\bfetch\(|\baxios(\.\w+)?\(|\bgot\(|\bhttps?\.(request|get)\(|\brequests\.(get|post|put|patch|delete)\(|\b(RestTemplate|WebClient|HttpClient)\b|\bhttp\.(Get|Post|Do)\(/,
    extensions: CODE,
    examples: {
      hit: [ts("const res = await fetch(url);"), ts("const r = await axios.get(url);"), py("r = requests.post(url, json=body)"), go("resp, err := http.Get(url)")],
      miss: [ts("const fetched = true;"), ts("refetch();")],
    },
  },
  {
    id: "io.db-query",
    meaning: "a database query",
    pattern: /\.(query|execute|findOne|findUnique|findMany|findById|findAll|aggregate|insertOne|updateOne)\(|\bSELECT\s+.+\s+FROM\b/i,
    extensions: CODE,
    examples: {
      hit: [ts('const rows = await db.query("SELECT 1");'), ts("const user = await prisma.user.findUnique({ where: { id } });"), ts("const u = await User.findById(id);")],
      miss: [ts("const item = items.find((x) => x.id === id);"), ts("const q = query;")],
    },
  },
  {
    id: "err.try-catch",
    meaning: "code that catches an error",
    pattern: /\btry\s*\{|^\s*try\s*:?\s*$|\bcatch\s*(\(|\{)|^\s*except\b/,
    extensions: CODE,
    examples: {
      hit: [ts("  try {"), ts("} catch (e) {"), py("try:"), py("except ValueError:")],
      miss: [ts("const tryAgain = 1;"), ts("retry();")],
    },
  },
  {
    id: "err.throw",
    meaning: "code that raises an error",
    pattern: /\bthrow\s+\w|\braise\s+\w|\bpanic\(|\berrors\.New\(|\bfmt\.Errorf\(/,
    extensions: CODE,
    examples: {
      hit: [ts('throw new Error("bad input");'), py('raise ValueError("bad input")'), go('return fmt.Errorf("charge: %w", err)')],
      miss: [ts("const thrown = false;"), ts("const throwaway = 1;")],
    },
  },
  {
    id: "api.request-body",
    meaning: "code that reads input from a request",
    pattern: /\breq\.(body|query|params)\b|@(RequestBody|RequestParam|PathVariable|Body|Query|Param)\(|\brequest\.(json|form|args)\b|\bc\.(Bind|ShouldBind)\w*\(/,
    extensions: CODE,
    examples: {
      hit: [ts("const { name } = req.body;"), java("public User create(@RequestBody() UserDto dto) {"), py("data = request.json")],
      miss: [ts('const body = "x";'), ts("request();")],
    },
  },
  {
    id: "fetch.request",
    meaning: "a request for server data from the screen",
    pattern: /\bfetch\(|\buse(Query|SWR|Mutation)\(|\baxios(\.\w+)?\(|\bthis\.http\.(get|post|put|delete)\b/,
    extensions: WEB,
    examples: {
      hit: [tsx('const res = await fetch("/api/orders");'), tsx('const { data } = useQuery({ queryKey: ["o"], queryFn });'), tsx('return this.http.get<Order[]>("/api/orders");')],
      miss: [tsx("const fetched = 1;"), tsx("refetch();")],
    },
  },
];

const BY_ID = new Map(SIGNALS.map((s) => [s.id, s]));

export function signalById(id: string): SignalRule | undefined {
  return BY_ID.get(id);
}
