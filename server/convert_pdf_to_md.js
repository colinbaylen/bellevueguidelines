import fs from "fs";
import path from "path";
import pdf from "pdf-parse";

const inputPath = path.resolve("./bellevue_admitting_guidelines.pdf");
const outputPath = path.resolve("./docs/bellevue_admitting_guidelines.md");

function isHeading(line) {
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

function normalizeLine(line) {
  return line
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();
}

function mergeLines(lines) {
  const out = [];
  let buffer = "";
  let inBullet = false;

  const flush = () => {
    if (buffer.trim()) out.push(buffer.trim());
    buffer = "";
    inBullet = false;
  };

  for (const raw of lines) {
    const line = normalizeLine(raw);
    if (!line) {
      flush();
      continue;
    }

    if (/^\d+$/.test(line)) {
      flush();
      continue;
    }

    const isBulletStart = line.startsWith("●") || line.startsWith("-") || line.startsWith("*");
    if (isBulletStart) {
      flush();
      inBullet = true;
      buffer = line;
      continue;
    }

    if (inBullet) {
      buffer = `${buffer} ${line}`;
      continue;
    }

    if (isHeading(line)) {
      flush();
      out.push(line);
      continue;
    }

    if (!buffer) {
      buffer = line;
      continue;
    }

    if (/[,-]$/.test(buffer) || !/[.!?]$/.test(buffer)) {
      buffer = `${buffer} ${line}`;
    } else {
      flush();
      buffer = line;
    }
  }

  flush();
  return out;
}

function renderMarkdown(lines) {
  const md = [];
  let seenFirstHeading = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (isHeading(line)) {
      if (!seenFirstHeading) {
        md.push(`# ${line}`);
        seenFirstHeading = true;
      } else {
        md.push(`## ${line}`);
      }
      continue;
    }

    if (line.startsWith("●")) {
      md.push(`- ${line.slice(1).trim()}`);
      continue;
    }

    if (line.startsWith("-") || line.startsWith("*")) {
      md.push(`- ${line.slice(1).trim()}`);
      continue;
    }

    md.push(line);
  }

  return md.join("\n\n") + "\n";
}

async function run() {
  const data = fs.readFileSync(inputPath);
  const parsed = await pdf(data);
  const raw = parsed.text || "";
  const lines = raw.split(/\r?\n/);
  const merged = mergeLines(lines);
  const markdown = renderMarkdown(merged);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, markdown, "utf8");
  console.log(`Wrote ${outputPath}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
