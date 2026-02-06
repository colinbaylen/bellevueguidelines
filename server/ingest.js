import fs from "fs";
import path from "path";
import pdfParse from "pdf-parse";
import OpenAI from "openai";

const SOURCE_PDF = path.resolve("./bellevue_admitting_guidelines.pdf");
const OUT_FILE = path.resolve("./data/embeddings.json");
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-large";
const CHUNK_SIZE = 1000; // chars
const CHUNK_OVERLAP = 150; // chars
const BATCH_SIZE = 96;

function normalize(text) {
  return text
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .trim();
}

function chunkText(text) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(i + CHUNK_SIZE, text.length);
    const slice = text.slice(i, end);
    chunks.push(slice);
    if (end === text.length) break;
    i = end - CHUNK_OVERLAP;
  }
  return chunks;
}

function ensureOpenAIKey() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("Missing OPENAI_API_KEY in environment.");
    process.exit(1);
  }
}

async function main() {
  ensureOpenAIKey();

  if (!fs.existsSync(SOURCE_PDF)) {
    console.error(`PDF not found at ${SOURCE_PDF}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(SOURCE_PDF);
  const parsed = await pdfParse(buffer);
  const text = normalize(parsed.text || "");
  if (!text) {
    console.error("No text extracted from PDF.");
    process.exit(1);
  }

  const chunks = chunkText(text);
  const client = new OpenAI();
  const records = [];

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const res = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch
    });

    for (let j = 0; j < res.data.length; j += 1) {
      const idx = i + j;
      records.push({
        id: `chunk-${idx + 1}`,
        text: batch[j],
        embedding: res.data[j].embedding
      });
    }

    console.log(`Embedded ${Math.min(i + BATCH_SIZE, chunks.length)}/${chunks.length}`);
  }

  const payload = {
    source: path.basename(SOURCE_PDF),
    model: EMBEDDING_MODEL,
    createdAt: new Date().toISOString(),
    count: records.length,
    records
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
  console.log(`Saved embeddings to ${OUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
