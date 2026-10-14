# Inferbase Build Guides

The code behind the [Inferbase build guides](https://inferbase.ai/solutions): complete, runnable
applications for the systems teams most often build on a language model API, one folder each.

Every application talks to [Inferbase](https://inferbase.ai), an OpenAI-compatible API that routes
each request to the best model for it on quality, cost and latency, and returns the reason with the
answer. The code uses the standard OpenAI SDK with a different base URL, so what you learn here
carries over to any OpenAI-compatible endpoint.

Each guide on the site explains the architecture, the routing policy, the security choices and what
was measured. This repository holds the code you can clone, run and change.

## The guides

| Guide | Folder | Status |
|---|---|---|
| [Customer support assistant](https://inferbase.ai/solutions/customer-support-assistant) | [`customer-support-agent`](./customer-support-agent) | Runs today; it powers the Copilot on [inferbase.ai](https://inferbase.ai) |
| [RAG over a knowledge base](https://inferbase.ai/solutions/rag-knowledge-base) | `rag-knowledge-base` | Code on the guide page, Python and TypeScript; full app coming |
| [Coding agents](https://inferbase.ai/solutions/coding-agents) | `coding-agent` | Code on the guide page; full app coming |
| [Document extraction to JSON](https://inferbase.ai/solutions/document-extraction) | `document-extraction` | Code on the guide page; full app coming |
| [Agents with tools and MCP](https://inferbase.ai/solutions/agents-with-tools-and-mcp) | `tool-agent` | Code on the guide page; full app coming |
| [Voice agent](https://inferbase.ai/solutions/voice-agent) | `voice-agent` | Code on the guide page; full app coming |

The snippets on each guide page were run against the live API on the date the page states. Watch
the repository to hear when a folder lands.

## Getting started

You need:

- **Node.js 22** for the applications in this repository.
- **An Inferbase API key.** [Create an account](https://inferbase.ai/register), then make a key on
  the [API keys](https://inferbase.ai/api-keys) page. Give it a daily spend cap before you put
  anything on a public site.

Then pick a folder and run it:

```bash
git clone https://github.com/InferbaseAI/inferbase-build-guides.git
cd inferbase-build-guides/customer-support-agent
cp .env.example .env.local      # set INFERBASE_API_KEY
npm install
npm run index                   # one-time: builds the search index from the docs
npm run dev                     # http://localhost:3000
```

Each folder's README covers its own settings, how to adapt it to your data, how to evaluate it, and
how to deploy it.

## How to use this repository

- **Start from a guide, not from the code.** The guide says why each piece is there and which
  settings matter; the folder is the result. Read its architecture and policy sections first.
- **Copy a folder into your own project.** Each one is self-contained, with its own `package.json`,
  tests and license, and nothing in it depends on the rest of the repository.
- **Change the model choice in your policy, not in the code.** The applications send
  `model: "auto"`, and your [routing policy](https://inferbase.ai/docs/policies/create-a-routing-policy)
  decides which models may answer and what to optimise for. Name a model when you need to pin one.
- **Check your changes with the evaluation.** Folders that have one run it with `npm run eval`. Run
  it after every change to the prompt, the data or the policy.

To try a request before writing any code, the [Playground](https://inferbase.ai/playground) runs the
same API in the browser and shows the routing decision for each answer. The
[API reference](https://inferbase.ai/docs/api) lists every endpoint.

## Questions and contributions

Open an issue for a bug, a question, or a guide you would like to see. Pull requests that fix a bug
or make a guide clearer are welcome; please keep each folder self-contained.

## License

Apache-2.0. See [LICENSE](./LICENSE).
