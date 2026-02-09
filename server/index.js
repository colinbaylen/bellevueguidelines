import fs from "fs";
import path from "path";
import express from "express";
import OpenAI from "openai";

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.resolve("./data/embeddings.json");
const LOG_DIR = path.resolve("./data/logs");
const ALL_QUERIES_LOG = path.resolve(LOG_DIR, "queries.jsonl");
const AMBIGUOUS_LOG = path.resolve(LOG_DIR, "ambiguous.jsonl");
const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-5";
const AMBIGUITY_SENTENCE = "The guidelines do not provide a clear answer.";
const AMBIGUITY_REGEX = /the guidelines do not provide a clear answer\./i;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.resolve("./public")));

let embeddingsCache = null;

function loadEmbeddings() {
  if (!fs.existsSync(DATA_FILE)) return null;
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  embeddingsCache = JSON.parse(raw);
  return embeddingsCache;
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function topKSimilar(queryEmbedding, records, k = 5) {
  const scored = records.map((r) => ({
    id: r.id,
    text: r.text,
    score: cosineSimilarity(queryEmbedding, r.embedding)
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

function ensureOpenAIKey() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY in environment.");
  }
}

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function appendLogLine(filePath, payload) {
  ensureLogDir();
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf8");
}

function logQuery({ query, ambiguous, reason, pdfRefs }) {
  const entry = {
    timestamp: new Date().toISOString(),
    query,
    ambiguous: !!ambiguous
  };
  if (reason) entry.reason = reason;
  if (Array.isArray(pdfRefs) && pdfRefs.length > 0) entry.pdf_refs = pdfRefs;
  appendLogLine(ALL_QUERIES_LOG, entry);
  if (entry.ambiguous) {
    appendLogLine(AMBIGUOUS_LOG, entry);
  }
}

app.get("/api/health", (_req, res) => {
  const ready = !!loadEmbeddings();
  res.json({ ok: true, embeddingsReady: ready });
});

app.post("/api/chat", async (req, res) => {
  const tStart = Date.now();
  try {
    ensureOpenAIKey();
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages array required" });
    }

    const tLoadStart = Date.now();
    const db = embeddingsCache || loadEmbeddings();
    const tLoadMs = Date.now() - tLoadStart;
    if (!db) {
      return res.status(400).json({ error: "Embeddings not found. Run npm run ingest." });
    }

    const client = new OpenAI();
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) {
      return res.status(400).json({ error: "No user message provided." });
    }

    const tEmbedStart = Date.now();
    const embed = await client.embeddings.create({
      model: db.model,
      input: lastUser.content
    });
    const tEmbedMs = Date.now() - tEmbedStart;

    const tSimStart = Date.now();
    const top = topKSimilar(embed.data[0].embedding, db.records, 5);
    const tSimMs = Date.now() - tSimStart;
    const context = top
      .map((t, i) => `[Source ${i + 1}]\n${t.text}`)
      .join("\n\n");

    const recent = messages.slice(-6);

    const input = [
      {
        role: "system",
        content:
          "You are an ER admitting guidelines assistant. Answer questions using ONLY the provided guidelines context. If the guidelines do not answer the question, you MUST say: \"The guidelines do not provide a clear answer.\" Then briefly explain what is missing or ambiguous and, if possible, provide the best-supported interpretation(s) grounded in the guidelines. Do not ask the user to change or interpret the guidelines. Provide a concise recommendation and include a short Sources section listing the source numbers used."
      },
      {
        role: "user",
        content: `Guidelines context:\n\n${context}`
      },
      ...recent
    ];

    const tRespStart = Date.now();
    const wantsStream =
      req.headers["x-stream"] === "1" ||
      (typeof req.headers.accept === "string" && req.headers.accept.includes("text/plain"));

    if (wantsStream) {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      if (typeof res.flushHeaders === "function") res.flushHeaders();

      const stream = await client.responses.create({
        model: CHAT_MODEL,
        input,
        stream: true
      });

      let streamedText = "";
      for await (const event of stream) {
        if (event.type === "response.output_text.delta" && event.delta) {
          streamedText += event.delta;
          res.write(event.delta);
        }
      }

      const ambiguous = AMBIGUITY_REGEX.test(streamedText);
      logQuery({
        query: lastUser.content,
        ambiguous,
        reason: ambiguous ? AMBIGUITY_SENTENCE : undefined
      });

      const tRespMs = Date.now() - tRespStart;
      const tTotalMs = Date.now() - tStart;
      console.log(
        `[timing] total=${tTotalMs}ms load=${tLoadMs}ms embed=${tEmbedMs}ms sim=${tSimMs}ms respond=${tRespMs}ms records=${db.records?.length || 0}`
      );
      res.end();
      return;
    }

    const response = await client.responses.create({
      model: CHAT_MODEL,
      input
    });
    const tRespMs = Date.now() - tRespStart;

    const outputText = response.output_text || "";
    const ambiguous = AMBIGUITY_REGEX.test(outputText);
    logQuery({
      query: lastUser.content,
      ambiguous,
      reason: ambiguous ? AMBIGUITY_SENTENCE : undefined
    });
    const tTotalMs = Date.now() - tStart;
    console.log(
      `[timing] total=${tTotalMs}ms load=${tLoadMs}ms embed=${tEmbedMs}ms sim=${tSimMs}ms respond=${tRespMs}ms records=${db.records?.length || 0}`
    );
    res.json({ answer: outputText });
  } catch (err) {
    console.error(err);
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(500).json({ error: err.message || "Unknown error" });
  }
});

app.post("/api/reindex", async (_req, res) => {
  // Simple reload in case embeddings file changed.
  try {
    const reloaded = loadEmbeddings();
    res.json({ ok: true, count: reloaded?.count || 0 });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
