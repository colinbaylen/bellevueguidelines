# Admitting Guidelines Assistant

Single-page web app that answers ER admission questions using the Bellevue admitting guidelines PDF.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Set your API key (and optionally models):

```bash
export OPENAI_API_KEY="your_key_here"
export OPENAI_CHAT_MODEL="gpt-5"
export OPENAI_EMBEDDING_MODEL="text-embedding-3-large"
```

3. Build embeddings from the PDF:

```bash
npm run ingest
```

4. Start the server:

```bash
npm start
```

Open `http://localhost:3000`.

## Deploy to Render

1. Run `npm run ingest` locally and commit `data/embeddings.json`.
2. Push the repo to GitHub.
3. In Render, create a new Web Service from the repo.
4. Render will use `render.yaml` automatically. Set the `OPENAI_API_KEY` in the Render dashboard.

## Notes
- The ingest step reads `bellevue_admitting_guidelines.pdf` in the project root and fetches the phone directory sheet (override with `CONTACTS_SHEET_URL`).
- Embeddings are stored in `data/embeddings.json`.
- If the PDF changes, re-run `npm run ingest`.

## Interpretation guide
- Maintain interpretation notes in `docs/admission-guidelines-interpretation.md` and update it alongside PDF changes (see the checklist in that guide).
