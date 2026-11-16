# Big Brain (AI assistant)

Big Brain is the assistant on the right side of the window. It always sees the open document,
including unsaved edits, and answers through a model provider you choose. Nothing is configured
out of the box, and the document text is sent to that provider only when you ask Big Brain a
question. With a local provider such as Ollama, nothing leaves your computer.

- Works with DeepSeek, OpenAI, Anthropic, OpenRouter, a local Ollama, or any OpenAI- or
  Anthropic-compatible endpoint
- Select any text to reveal **Ask Big Brain**; the selection is attached alongside the full file
- Streaming Markdown answers with an expandable **Thinking** disclosure and an **Actions** trace
- Private web search through Google, Bing, DuckDuckGo, Mojeek or SearXNG, with retries,
  proxy/Tor routing and provider fallback
- Per-message token usage, plus chat totals and cost when the gateway reports it
- Chats are saved under `~/.markdowneditor/chats`, named by the model, and can be renamed or deleted
- Large documents are sent as an outline; Big Brain reads and searches the parts it needs, and
  can search and read the other Markdown files of the open folder
- **About you** notes and a **Memory** of lasting preferences personalize every chat

## Adding a provider

**Settings → Big Brain → Add model provider.**

- **Third-party model provider**: pick DeepSeek, OpenAI, Anthropic, OpenRouter, Ollama, or
  Command Code and paste its API key (Ollama needs none). The model list is fetched from the
  provider.
- **Custom model API**: for any other endpoint. Enter a lowercase **Provider ID** (permanent:
  chats and saved keys refer to it), the base URL, the API protocol (`openai-completions` or
  `anthropic-messages`), a key, and model ids, or leave the models empty to fetch them.

## Choosing a model

Pick the model, and its reasoning effort where it has one, from the menu in Big Brain's header. The
choice becomes the default for new chats; each chat remembers its own.

## API keys

Keys are stored in the operating system's keychain (Secret Service on Linux, Keychain on macOS,
Credential Manager on Windows). If no keychain is running, the key goes to
`~/.markdowneditor/credentials.json`, readable by you only, and Settings says so. The webview
never receives a key, only whether one exists and its last four characters. Requests are made by
the Rust backend. An environment variable (`DEEPSEEK_API_KEY`, `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `CMD_API_KEY`) overrides the stored key for one run.

## providers.json

The same settings live in `~/.markdowneditor/providers.json` and can be edited by hand. Fields
follow [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness): `api`, `baseURL`,
`apiKeyEnv`, `reasoning` (default effort), `headers`, `compat`, and `models`. A model may declare
its own effort levels; a model with none shows no effort menu.

```json
{
  "providers": {
    "my-gateway": {
      "api": "openai-completions",
      "baseURL": "https://gateway.example/v1",
      "apiKeyEnv": "GATEWAY_API_KEY",
      "models": [
        { "id": "legacy-chat" },
        { "id": "my-reasoner", "reasoningEfforts": { "off": null, "high": "high", "max": "max" } }
      ]
    }
  }
}
```

An entry for a built-in id (`deepseek`, `openai`, `anthropic`, `openrouter`, `ollama`,
`commandcode`) overrides that provider field by field. `compat` switches: `maxTokensField`,
`thinkingFormat: "deepseek"`, `reasoningFormat: "openrouter"`, `toolChoice: false`.

## Private web search

Big Brain can call a `web_search` tool when an answer needs current information. Toggle it from the
model menu in Big Brain's header. Searches are **proxy-only by default**: without an explicit proxy,
Big Brain tries Tor at `socks5h://127.0.0.1:9050`; if Tor is not running, search fails instead of
falling back to your real IP. Direct search is opt-in from **Settings → Big Brain** and is clearly
marked as non-private.

Providers are tried in order, with retries and proxy/user-agent rotation. CAPTCHA, consent and
JS-challenge pages are detected and skipped. Search queries and snippets are sent to
the selected model provider as part of the model request; the search engine only sees the proxy/Tor route.

Search settings live in `~/.markdown-viewer-app/config.json`:

```json
{
  "search": {
    "enabled": true,
    "providers": ["google", "bing", "duckduckgo", "mojeek", "searx"],
    "searxUrl": "http://127.0.0.1:8080",
    "proxy": "socks5h://127.0.0.1:9050",
    "proxies": [],
    "allowDirect": false,
    "useTor": true,
    "retries": 1,
    "maxResults": 5,
    "timeoutMs": 8000,
    "totalTimeoutMs": 30000
  }
}
```

- `proxy` / `proxies`: HTTP(S) or SOCKS proxies; multiple proxies rotate between retries.
  Prefer `socks5h://` so DNS is resolved by the proxy/Tor, not locally.
- `allowDirect`: when no proxy is configured, use a direct connection (reveals your IP).
- `useTor`: fall back to `socks5h://127.0.0.1:9050` when no proxy is configured and direct is off.
- `providers`: any order of `google`, `bing`, `duckduckgo`, `mojeek`, `searx`.
  `searx` requires `searxUrl`; a self-hosted instance is the most reliable private option.
- `retries`: extra attempts per provider (capped at 3); each retry rotates the proxy and user agent.

## Context, chats, and memory

**Context.** A document up to 60,000 characters is sent whole; a larger one is sent as a heading
outline with line numbers, and Big Brain fetches ranges with its `read_document` / `search_document`
tools. With a folder open it also gets `list_files`, `search_files`, and `read_file`, limited to
that folder's Markdown files. Long chats are folded into a summary once they pass about 48,000
characters. The prompt is ordered so the provider's prefix cache keeps hitting between turns.

**Chats** persist as JSON at `~/.markdowneditor/chats/<date>/<id>.json`, including messages,
reasoning, actions, and token/cost usage. Stored reasoning is never replayed to the model.

**Personalization and memory.** Settings → Big Brain has an **About you** box that is included in every
chat, and a **Memory** switch. With memory on, Big Brain saves lasting facts and preferences you mention
(you get a toast each time) and you can delete any of them in Settings. Both live in
`~/.markdowneditor/memory.json` (mode 0600) and are sent to the selected provider with your questions.
