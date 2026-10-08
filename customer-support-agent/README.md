# Customer support agent

A support chat for your product that answers from your documentation, cites its sources, hands
off to a person when it should, and shows beside every answer which model Inferbase routed it to,
why, and what it cost.

One API key. No vector database, no cloud console, no model list to maintain.

- **Answers from your docs.** `npm run index` reads your `llms-full.txt`, splits it into passages
  and embeds them through Inferbase. Each question retrieves the closest passages, and the answer
  cites them as [1], [2].
- **Routed per request.** The app sends `model: "auto"`. Your Inferbase routing policy decides
  which model answers each question, on quality, cost and latency, with fallbacks. Change the
  objective or the allowed models in the policy, not in this code.
- **A receipt under every answer.** The model chosen, the task it was classified as, the margin
  over the runner-up, the routing time, the cost and the documents used. Inferbase streams the
  routing decision as the first event of every answer; this app reads it.
- **Handoff to a person.** When someone asks for a human, is frustrated, or needs their account,
  the model ends its answer with a marker and the chat opens a form that emails the conversation to
  your support inbox, with the visitor as the reply-to.
- **Safe to put on a public site.** Per-visitor rate limits, an optional Cloudflare Turnstile check
  on the first message, length limits, short answers, and the guardrails and daily spend cap you
  set on the API key in Inferbase.
- **Embeds anywhere.** One script tag adds a launcher to your site; the chat runs in a frame on its
  own origin.

## Run it

```bash
cp .env.example .env.local     # add INFERBASE_API_KEY
npm install
npm run index                  # build data/index.json from your docs
npm run dev                    # http://localhost:3000
```

The defaults index Inferbase's own documentation. Point `DOCS_SOURCE_URL` at your site's
`llms-full.txt` (and `DOCS_SOURCE_PREFIX` at your docs path) to make it yours.

## Set up the API key in Inferbase

The app is a customer of the API like any other, so its safety settings live on its key:

1. **Create a key for this app** (API keys page). Give it a **daily spend cap**: a public chat
   box is an open endpoint, and the cap stops a runaway the same day.
2. **Attach a routing policy** with the objective you want (for example `balanced`) and the models
   you allow.
3. **Name a guardrail policy** in that routing policy, with prompt-injection checks on the input.
   A message that trips it is refused before any model sees it, and the visitor is asked to
   rephrase.

Requests from the app are labelled `X-Inferbase-Source: support-agent` (set `INFERBASE_SOURCE`
to change it), so they are easy to find in your logs.

## Add it to your site

```html
<script src="https://YOUR-DEPLOYMENT/embed.js" data-label="Ask a question" async></script>
```

Set `FRAME_ANCESTORS=https://your-site.com` on the deployment so your site may frame it. Raise the
launcher above a cookie banner with `data-bottom="96"`.

## Check the answers

```bash
npm run eval -- --retrieval-only   # does each question find the right page (embeddings only)
npm run eval                       # full answers: facts, refusals off-topic, handoff
```

The questions are in `evals/questions.json`. Replace them with real questions your customers ask,
each with the page that answers it. Run the evaluation after every change to the docs, the prompt
or the routing policy.

## How it works

```
browser ── POST /api/chat ──▶ limits, Turnstile, validation
                              │
                              ├─ embed the question ──────────▶ Inferbase /v1/embeddings
                              ├─ top passages from data/index.json (in memory)
                              └─ chat, streamed, model "auto" ─▶ Inferbase /v1/chat/completions
                                     routing event ─┐              (policy, guardrails, fallbacks)
browser ◀── NDJSON: sources, routing, text, usage ◀─┘
```

| File | What it does |
|---|---|
| `lib/inferbase.ts` | The OpenAI SDK pointed at Inferbase: the whole integration |
| `lib/docs.ts` | Splits an llms-full.txt into passages |
| `lib/retrieval.ts` | Loads the index, embeds the question, returns numbered sources |
| `lib/prompt.ts` | The system prompt: answer from the passages, cite, refuse off-topic, hand off |
| `lib/events.ts` | Reads Inferbase's routing and usage events from the stream |
| `lib/rate-limit.ts` | Per-visitor limits (in memory; implement `Limiter` on Redis for several instances) |
| `app/api/chat/route.ts` | One answer, streamed |
| `app/api/handoff/route.ts` | Emails the conversation to your support inbox |
| `public/embed.js` | The launcher for your site |

## Limits worth knowing

- The rate limiter counts per server instance. On serverless or several instances, back it with a
  shared store. The daily spend cap on the key is the limit that holds regardless.
- Retrieval is in memory, which suits a documentation site (hundreds to a few thousand passages).
  For a much larger corpus, move the vectors to a vector store; the rest of the app is unchanged.
- Answers are generated. The prompt keeps them to the passages and the evaluation checks them,
  but they can still be wrong; the chat says so.

## License

Apache-2.0.
