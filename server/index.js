import fs from "fs";
import path from "path";
import crypto from "crypto";
import express from "express";
import OpenAI from "openai";

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.resolve("./data/embeddings.json");
const LOG_DIR = path.resolve("./data/logs");
const ALL_QUERIES_LOG = path.resolve(LOG_DIR, "queries.jsonl");
const AMBIGUOUS_LOG = path.resolve(LOG_DIR, "ambiguous.jsonl");
const FEEDBACK_LOG = path.resolve(LOG_DIR, "feedback.jsonl");
const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-5";
const AMBIGUITY_SENTENCE = "The guidelines do not provide a clear answer.";
const AMBIGUITY_REGEX = /the guidelines do not provide a clear answer\./i;
const SOURCES_TTL_MS = 10 * 60 * 1000;
const sourcesCache = new Map();
const SOURCE_MD = path.resolve("./docs/bellevue_admitting_guidelines.md");

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.resolve("./public")));

let embeddingsCache = null;

function loadEmbeddings() {
  if (!fs.existsSync(DATA_FILE)) return null;
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  embeddingsCache = JSON.parse(raw);
  return embeddingsCache;
}

function extractChunkNumber(id) {
  const match = /chunk-(\d+)/i.exec(id || "");
  return match ? Number(match[1]) : null;
}

function isHeadingLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("●") || trimmed.startsWith("-") || trimmed.startsWith("*")) return false;
  if (/[.!?]$/.test(trimmed)) return false;
  if (trimmed.length < 3 || trimmed.length > 80) return false;
  if (!/[A-Za-z]/.test(trimmed)) return false;
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount > 12) return false;
  return true;
}

function buildTextIndex(records) {
  const ordered = [...records].sort((a, b) => {
    const na = extractChunkNumber(a.id) ?? Number.MAX_SAFE_INTEGER;
    const nb = extractChunkNumber(b.id) ?? Number.MAX_SAFE_INTEGER;
    if (na === nb) return 0;
    return na - nb;
  });

  const chunkPositions = new Map();
  let cursor = 0;
  const parts = [];

  ordered.forEach((record, idx) => {
    const text = record.text || "";
    chunkPositions.set(record.id, { start: cursor, end: cursor + text.length });
    parts.push(text);
    cursor += text.length;
    if (idx < ordered.length - 1) {
      parts.push("\n");
      cursor += 1;
    }
  });

  const fullText = parts.join("");
  const headings = [];
  let lineStart = 0;
  const lines = fullText.split("\n");
  lines.forEach((line) => {
    if (isHeadingLine(line)) {
      headings.push({ start: lineStart, text: line.trim() });
    }
    lineStart += line.length + 1;
  });

  return { fullText, headings, chunkPositions };
}

function extractSectionFromMarkdown(markdown, heading) {
  const lines = markdown.split(/\n/);
  const headingRegex = new RegExp(`^#{1,6}\\s+${heading}\\s*$`, "i");
  const nextHeadingRegex = /^#{1,6}\s+/;
  let inSection = false;
  const sectionLines = [];

  for (const line of lines) {
    if (headingRegex.test(line.trim())) {
      inSection = true;
      sectionLines.push(line.trim());
      continue;
    }
    if (inSection && nextHeadingRegex.test(line.trim())) {
      break;
    }
    if (inSection) sectionLines.push(line);
  }

  return sectionLines.join("\n").trim();
}

function buildSourceText(item, index) {
  const pos = index.chunkPositions.get(item.id);
  if (!pos) return item?.text || "";
  const { fullText, headings } = index;
  const chunkStart = pos.start;
  const chunkEnd = pos.end;

  let sectionStart = 0;
  let sectionEnd = fullText.length;

  for (let i = headings.length - 1; i >= 0; i -= 1) {
    if (headings[i].start <= chunkStart) {
      sectionStart = headings[i].start;
      break;
    }
  }

  for (let i = 0; i < headings.length; i += 1) {
    if (headings[i].start > chunkEnd) {
      sectionEnd = headings[i].start;
      break;
    }
  }

  const section = fullText.slice(sectionStart, sectionEnd).trim();
  if (section.length <= 6000) return section;
  return section.slice(0, 6000);
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

function logFeedback(payload) {
  const entry = {
    timestamp: new Date().toISOString(),
    ...payload
  };
  appendLogLine(FEEDBACK_LOG, entry);
}

function storeSources(sources) {
  const id = crypto.randomUUID();
  const expiresAt = Date.now() + SOURCES_TTL_MS;
  sourcesCache.set(id, { sources, expiresAt });
  setTimeout(() => {
    sourcesCache.delete(id);
  }, SOURCES_TTL_MS);
  return id;
}

app.get("/api/health", (_req, res) => {
  const ready = !!loadEmbeddings();
  res.json({ ok: true, embeddingsReady: ready });
});

app.get("/testing", (_req, res) => {
  res.sendFile(path.resolve("./public/testing.html"));
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
    const anchorQueries = [
      "Medical Comorbidities list of diagnoses admitted to medicine regardless of primary admitting diagnosis"
    ];
    const embed = await client.embeddings.create({
      model: db.model,
      input: [lastUser.content, ...anchorQueries]
    });
    const tEmbedMs = Date.now() - tEmbedStart;

    const tSimStart = Date.now();
    const top = topKSimilar(embed.data[0].embedding, db.records, 5);
    const combined = new Map();
    top.forEach((item) => combined.set(item.id, item));
    anchorQueries.forEach((_, idx) => {
      const anchorEmbedding = embed.data[idx + 1]?.embedding;
      if (!anchorEmbedding) return;
      const anchorTop = topKSimilar(anchorEmbedding, db.records, 2);
      anchorTop.forEach((item) => {
        if (!combined.has(item.id)) combined.set(item.id, item);
      });
    });
    const merged = Array.from(combined.values());
    const textIndex = buildTextIndex(db.records);
    const sources = merged.map((item, index) => ({
      id: index + 1,
      text: buildSourceText(item, textIndex)
    }));
    const sourcesId = storeSources(sources);
    const tSimMs = Date.now() - tSimStart;
    const context = merged
      .map((t, i) => `[Source ${i + 1}]\n${t.text}`)
      .join("\n\n");

    const recent = messages.slice(-6);

    const input = [
      {
        role: "system",
        content:
          "You are an ER admitting guidelines assistant. Answer questions using ONLY the provided guidelines context. You MUST check the Medical Comorbidities section; if any listed diagnosis is present, the admission service is Medicine regardless of the primary diagnosis. If the guidelines do not answer the question, you MUST say: \"The guidelines do not provide a clear answer.\" Then briefly explain what is missing or ambiguous and, if possible, provide the best-supported interpretation(s) grounded in the guidelines. Do not ask the user to change or interpret the guidelines. Provide a concise recommendation. Add inline citations in the form [Source N] immediately after the sentence they support. Do not add a Sources section. The final line of your response MUST be: \"If any diagnosis on the Medical Comorbidities list is present, admit to Medicine regardless of primary diagnosis.\""
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
      res.setHeader("X-Sources-Id", sourcesId);
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
    res.setHeader("X-Sources-Id", sourcesId);
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

app.get("/api/sources/:id", (req, res) => {
  const entry = sourcesCache.get(req.params.id);
  if (!entry || entry.expiresAt < Date.now()) {
    if (entry) sourcesCache.delete(req.params.id);
    return res.status(404).json({ error: "Sources not found" });
  }
  return res.json({ sources: entry.sources });
});

app.get("/api/medical-comorbidities", (req, res) => {
  try {
    if (!fs.existsSync(SOURCE_MD)) {
      return res.status(404).json({ error: "Markdown not found" });
    }
    const markdown = fs.readFileSync(SOURCE_MD, "utf8");
    const section = extractSectionFromMarkdown(markdown, "Medical Comorbidities");
    if (!section) {
      return res.status(404).json({ error: "Section not found" });
    }
    return res.json({ section });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unknown error" });
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

app.post("/api/feedback", (req, res) => {
  try {
    const payload = req.body || {};
    if (!payload || typeof payload !== "object") {
      return res.status(400).json({ error: "feedback payload required" });
    }
    logFeedback(payload);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
