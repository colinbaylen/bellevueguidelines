import fs from "fs";
import path from "path";
import OpenAI from "openai";

const SOURCE_MD = path.resolve("./docs/bellevue_admitting_guidelines.md");
const OUT_FILE = path.resolve("./data/embeddings.json");
const SHEET_URL =
  process.env.CONTACTS_SHEET_URL ||
  "https://docs.google.com/spreadsheets/d/1tqfNcfaLdLMZo6UHPH7ePoEFTKhNcp-wIGo1T3-i7fA/export?format=tsv";
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-large";
const CHUNK_SIZE = 1200; // chars
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

function splitSections(markdown) {
  const lines = markdown.split(/\n/);
  const sections = [];
  let current = [];

  const flush = () => {
    if (!current.length) return;
    sections.push(normalize(current.join("\n")));
    current = [];
  };

  lines.forEach((line) => {
    if (/^#{1,6}\s+/.test(line)) {
      flush();
      current.push(line.trim());
      return;
    }
    current.push(line);
  });

  flush();
  return sections.filter(Boolean);
}

function chunkSections(sections) {
  const chunks = [];
  let buffer = "";

  const flush = () => {
    if (buffer.trim()) chunks.push(buffer.trim());
    buffer = "";
  };

  sections.forEach((section) => {
    if (!section) return;
    if (section.length <= CHUNK_SIZE) {
      if (!buffer) {
        buffer = section;
      } else if (buffer.length + 2 + section.length <= CHUNK_SIZE) {
        buffer = `${buffer}\n\n${section}`;
      } else {
        flush();
        buffer = section;
      }
      return;
    }

    flush();
    const paragraphs = section.split(/\n{2,}/);
    paragraphs.forEach((para) => {
      const trimmed = para.trim();
      if (!trimmed) return;
      if (trimmed.length <= CHUNK_SIZE) {
        if (!buffer) {
          buffer = trimmed;
        } else if (buffer.length + 2 + trimmed.length <= CHUNK_SIZE) {
          buffer = `${buffer}\n\n${trimmed}`;
        } else {
          flush();
          buffer = trimmed;
        }
      } else {
        let i = 0;
        while (i < trimmed.length) {
          const end = Math.min(i + CHUNK_SIZE, trimmed.length);
          chunks.push(trimmed.slice(i, end));
          if (end === trimmed.length) break;
          i = end - CHUNK_OVERLAP;
        }
      }
    });
  });

  flush();
  return chunks;
}

function ensureOpenAIKey() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("Missing OPENAI_API_KEY in environment.");
    process.exit(1);
  }
}

async function fetchSheetText() {
  const res = await fetch(SHEET_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch sheet (${res.status} ${res.statusText}).`);
  }
  const raw = await res.text();
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    throw new Error("No data found in the contacts sheet.");
  }
  return `Phone directory:\n${lines.join("\n")}`;
}

async function main() {
  ensureOpenAIKey();

  if (!fs.existsSync(SOURCE_MD)) {
    console.error(`Markdown not found at ${SOURCE_MD}`);
    process.exit(1);
  }

  const rawMarkdown = fs.readFileSync(SOURCE_MD, "utf8");
  const text = normalize(rawMarkdown || "");
  if (!text) {
    console.error("No text found in markdown file.");
    process.exit(1);
  }

  const sheetText = await fetchSheetText();
  const combined = [text, sheetText].join("\n\n");
  const sections = splitSections(combined);
  const chunks = chunkSections(sections);
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
    source: path.basename(SOURCE_MD),
    model: EMBEDDING_MODEL,
    createdAt: new Date().toISOString(),
    count: records.length,
    records
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
  console.log(`Saved embeddings to ${OUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
