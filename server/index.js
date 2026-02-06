import fs from "fs";
import path from "path";
import express from "express";
import OpenAI from "openai";

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.resolve("./data/embeddings.json");
const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-5";

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

app.get("/api/health", (_req, res) => {
  const ready = !!loadEmbeddings();
  res.json({ ok: true, embeddingsReady: ready });
});

app.post("/api/chat", async (req, res) => {
  try {
    ensureOpenAIKey();
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages array required" });
    }

    const db = embeddingsCache || loadEmbeddings();
    if (!db) {
      return res.status(400).json({ error: "Embeddings not found. Run npm run ingest." });
    }

    const client = new OpenAI();
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) {
      return res.status(400).json({ error: "No user message provided." });
    }

    const embed = await client.embeddings.create({
      model: db.model,
      input: lastUser.content
    });

    const top = topKSimilar(embed.data[0].embedding, db.records, 5);
    const context = top
      .map((t, i) => `[Source ${i + 1}]\n${t.text}`)
      .join("\n\n");

    const recent = messages.slice(-6);

    const response = await client.responses.create({
      model: CHAT_MODEL,
      input: [
        {
          role: "system",
          content:
            "You are an ER admitting guidelines assistant. Answer questions using ONLY the provided guidelines context. If the guidelines do not answer the question, say so and ask for clarification. Provide a concise recommendation and include a short Sources section listing the source numbers used."
        },
        {
          role: "user",
          content: `Guidelines context:\n\n${context}`
        },
        ...recent
      ]
    });

    const outputText = response.output_text || "";
    res.json({
      answer: outputText
    });
  } catch (err) {
    console.error(err);
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
