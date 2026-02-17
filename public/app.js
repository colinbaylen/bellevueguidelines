const chatEl = document.getElementById("chat");
const formEl = document.getElementById("composer");
const inputEl = document.getElementById("input");
const ghostEl = document.getElementById("ghost-text");
const inlineSourceEl = document.getElementById("inline-source");
const versionSwitchEl = document.getElementById("version-switch");
const sourceStore = new WeakMap();

const messages = [];
let thinkingEl = null;
let suggestionTimer = null;
let suggestionIndex = 0;

const suggestionSamples = [
  "Who does a patient with cellulitis and an abscess get admitted to?",
  "Head bleed plus abdominal injury plus humerus fracture: which service?",
  "Isolated traumatic subdural hematoma: neurosurgery or trauma?",
  "Septic arthritis of a native joint: who admits?",
  "Post-op complication after general surgery: which service?",
  "Ophthalmology consult with facial trauma: who admits?"
];

function bindVersionSwitch() {
  if (!versionSwitchEl) return;
  versionSwitchEl.addEventListener("change", (event) => {
    const value = event.target.value;
    if (value === "testing") {
      window.location.assign("/testing");
    } else {
      window.location.assign("/");
    }
  });
}

function addMessage(role, content) {
  messages.push({ role, content });
  const row = document.createElement("div");
  row.className = `message ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = content;
  row.appendChild(bubble);
  chatEl.appendChild(row);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatAssistantText(content) {
  const escaped = escapeHtml(content);
  const lines = escaped.split(/\n/);
  let html = "";
  let inList = false;
  const caveatText =
    "If any diagnosis on the Medical Comorbidities list is present, admit to Medicine regardless of primary diagnosis.";

  const flushList = () => {
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      html += "<div class=\"spacer\"></div>";
      return;
    }

    const bulletMatch = trimmed.match(/^(?:[-*]|[•●])\s+(.*)$/);
    if (bulletMatch) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${bulletMatch[1]}</li>`;
      return;
    }

    flushList();

    const nextLine = (lines[index + 1] || "").trim();
    const nextIsBullet = /^(?:[-*]|[•●])\s+/.test(nextLine);
    const looksLikeHeading =
      trimmed.length <= 80 && !/[.!?]$/.test(trimmed) && /[A-Za-z]/.test(trimmed);

    if ((trimmed.endsWith(":") && trimmed.length <= 80) || (nextIsBullet && looksLikeHeading)) {
      const headingClass = nextIsBullet ? "heading heading-with-list" : "heading";
      html += `<div class="${headingClass}">${trimmed}</div>`;
    } else {
      if (trimmed === caveatText) {
        html += `<div>${trimmed}</div><div><a href="#" class="inline-caveat-link">List of Medical Comorbidities</a></div>`;
      } else {
        html += `<div>${trimmed}</div>`;
      }
    }
  });

  flushList();

  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\[Source\s+(\d+)\]/gi, "<sup class=\"source-sup\" data-source=\"$1\">$1</sup>");
  return html;
}

function remapCitations(text) {
  const map = new Map();
  const orderedIds = [];
  const content = text.replace(/\[Source\s+(\d+)\]/gi, (_match, rawId) => {
    const id = Number(rawId);
    if (!map.has(id)) {
      map.set(id, map.size + 1);
      orderedIds.push(id);
    }
    return `[Source ${map.get(id)}]`;
  });
  return { content, citationMap: map, citedIds: orderedIds };
}

function formatSourceText(content) {
  const escaped = escapeHtml(content);
  const lines = escaped.split(/\n/);
  let html = "";
  let listLevel = 0;

  const closeLists = (targetLevel = 0) => {
    while (listLevel > targetLevel) {
      html += "</ul>";
      listLevel -= 1;
    }
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      closeLists(0);
      html += "<div class=\"spacer\"></div>";
      return;
    }

    const headingMatch = trimmed.match(/^#{1,6}\s+(.*)$/);
    if (headingMatch) {
      closeLists(0);
      html += `<div class="heading">${headingMatch[1]}</div>`;
      return;
    }

    const bulletMatch = line.match(/^(\s*)(?:[-*]|[•●])\s+(.*)$/);
    if (bulletMatch) {
      const indent = bulletMatch[1]?.replace(/\t/g, "  ").length || 0;
      const level = Math.max(1, Math.floor(indent / 2) + 1);
      if (level > listLevel) {
        while (listLevel < level) {
          html += "<ul>";
          listLevel += 1;
        }
      } else if (level < listLevel) {
        closeLists(level);
      }
      html += `<li>${bulletMatch[2]}</li>`;
      return;
    }

    closeLists(0);
    html += `<div>${trimmed}</div>`;
  });

  closeLists(0);
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  return html;
}

function splitSourcesBlock(text) {
  const lines = text.split(/\n/);
  let startIndex = -1;

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (/^sources\s*:?\s*$/i.test(line) || /^sources\s*:/i.test(line)) {
      startIndex = i;
      break;
    }
  }

  if (startIndex === -1) {
    return { content: text.trimEnd(), ids: [] };
  }

  const headerLine = lines[startIndex].trim();
  let sourcesText = "";
  if (/^sources\s*:/i.test(headerLine)) {
    sourcesText = headerLine.replace(/^sources\s*:\s*/i, "");
  }

  if (startIndex + 1 < lines.length) {
    const rest = lines.slice(startIndex + 1).join("\n");
    sourcesText = sourcesText ? `${sourcesText}\n${rest}` : rest;
  }

  const content = lines.slice(0, startIndex).join("\n").trimEnd();
  return { content, ids: [] };
}

function ensureSourceModal() {
  if (document.getElementById("source-modal")) return;
  const overlay = document.createElement("div");
  overlay.id = "source-modal";
  overlay.className = "source-modal";
  overlay.innerHTML = `
    <div class="source-modal-content" role="dialog" aria-modal="true" aria-labelledby="source-modal-title">
      <div class="source-modal-header">
        <div class="source-modal-title" id="source-modal-title">Source</div>
        <button class="source-modal-close" type="button">Close</button>
      </div>
      <div class="source-modal-body" id="source-modal-body"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.classList.remove("is-visible");
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  overlay.querySelector(".source-modal-close").addEventListener("click", close);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
}

function openSourceModal(source) {
  ensureSourceModal();
  const overlay = document.getElementById("source-modal");
  const titleEl = overlay.querySelector(".source-modal-title");
  const bodyEl = overlay.querySelector(".source-modal-body");
  titleEl.textContent = `Source ${source.displayId}`;
  bodyEl.innerHTML = formatSourceText(source.text || "");
  overlay.classList.add("is-visible");
}

function renderSources(row, sources) {
  if (!row || !Array.isArray(sources) || sources.length === 0) return;
  const bubble = row.querySelector(".bubble");
  if (!bubble) return;
  const citationMap = bubble.__citationMap;
  const citedIds = bubble.__citedIds;
  if (!citationMap || !Array.isArray(citedIds) || citedIds.length === 0) return;
  const byId = new Map(sources.map((source) => [source.id, source]));
  const filtered = citedIds
    .map((id) => {
      const src = byId.get(id);
      if (!src) return null;
      return { ...src, displayId: citationMap.get(id) };
    })
    .filter(Boolean)
    .sort((a, b) => a.displayId - b.displayId);
  if (filtered.length === 0) return;

  const container = document.createElement("div");
  container.className = "sources";

  const title = document.createElement("div");
  title.className = "sources-title";
  title.textContent = "Sources";

  const list = document.createElement("div");
  list.className = "sources-list";

  filtered.forEach((source) => {
    const link = document.createElement("a");
    link.className = "source-link";
    link.href = "#";
    link.textContent = `Source ${source.displayId}`;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      openSourceModal(source);
    });
    list.appendChild(link);
  });

  container.appendChild(title);
  container.appendChild(list);
  row.appendChild(container);
  sourceStore.set(row, filtered);
}

async function openComorbiditiesModal() {
  try {
    const res = await fetch("/api/medical-comorbidities");
    if (!res.ok) return;
    const data = await res.json();
    ensureSourceModal();
    const overlay = document.getElementById("source-modal");
    const titleEl = overlay.querySelector(".source-modal-title");
    const bodyEl = overlay.querySelector(".source-modal-body");
    titleEl.textContent = "Medical Comorbidities";
    bodyEl.innerHTML = formatSourceText(data.section || "");
    overlay.classList.add("is-visible");
  } catch {
    // no-op
  }
}
function addAssistantMessage(content) {
  messages.push({ role: "assistant", content });
  const row = document.createElement("div");
  row.className = "message assistant";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = formatAssistantText(content);
  row.appendChild(bubble);
  chatEl.appendChild(row);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function createAssistantStream({ onFirstChunk, delayMs = 35 } = {}) {
  let row = null;
  let bubble = null;
  let raw = "";
  let buffer = "";
  let flushTimer = null;
  let sawFirstChunk = false;

  const ensureRow = () => {
    if (row) return;
    row = document.createElement("div");
    row.className = "message assistant";
    bubble = document.createElement("div");
    bubble.className = "bubble";
    row.appendChild(bubble);
    chatEl.appendChild(row);
    chatEl.scrollTop = chatEl.scrollHeight;
  };

  const flush = () => {
    flushTimer = null;
    if (!buffer) return;
    if (!sawFirstChunk) {
      sawFirstChunk = true;
      if (typeof onFirstChunk === "function") onFirstChunk();
      ensureRow();
    }
    raw += buffer;
    buffer = "";
    if (bubble) {
      bubble.innerHTML = formatAssistantText(raw);
      chatEl.scrollTop = chatEl.scrollHeight;
    }
  };

  return {
    append(delta) {
      buffer += delta;
      if (!flushTimer) {
        flushTimer = setTimeout(flush, delayMs);
      }
    },
    finalize() {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (buffer) flush();
      const { content } = splitSourcesBlock(raw);
      const remapped = remapCitations(content);
      raw = remapped.content;
      if (bubble) {
        bubble.innerHTML = formatAssistantText(raw);
        bubble.__citationMap = remapped.citationMap;
        bubble.__citedIds = remapped.citedIds;
      }
      messages.push({ role: "assistant", content: raw });
      return { row };
    }
  };
}

function showThinking() {
  if (thinkingEl) return;
  const row = document.createElement("div");
  row.className = "message assistant";
  const bubble = document.createElement("div");
  bubble.className = "bubble thinking";
  bubble.textContent = "Consulting guidelines...";
  row.appendChild(bubble);
  chatEl.appendChild(row);
  chatEl.scrollTop = chatEl.scrollHeight;
  thinkingEl = row;
}

function hideThinking() {
  if (!thinkingEl) return;
  thinkingEl.remove();
  thinkingEl = null;
}

function showGhost(text) {
  ghostEl.textContent = text;
  ghostEl.classList.remove("is-exit");
  ghostEl.classList.add("is-visible");
}

function hideGhost() {
  ghostEl.classList.remove("is-visible");
  ghostEl.classList.add("is-exit");
}

function rotateGhost() {
  if (document.activeElement === inputEl || inputEl.value.trim().length > 0) {
    ghostEl.classList.remove("is-visible");
    return;
  }

  hideGhost();
  setTimeout(() => {
    suggestionIndex = (suggestionIndex + 1) % suggestionSamples.length;
    showGhost(suggestionSamples[suggestionIndex]);
  }, 300);
}

function startSuggestionRotation() {
  showGhost(suggestionSamples[suggestionIndex]);
  suggestionTimer = setInterval(rotateGhost, 4200);
}


formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;

  addMessage("user", text);
  inputEl.value = "";
  formEl.querySelector("button").disabled = true;
  showThinking();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/plain",
        "X-Stream": "1"
      },
      body: JSON.stringify({ messages })
    });

    if (!res.ok) {
      let err;
      try {
        err = await res.json();
      } catch {
        err = { error: await res.text() };
      }
      hideThinking();
      addMessage("assistant", `Error: ${err.error || "Request failed"}`);
    } else {
      const sourcesId = res.headers.get("X-Sources-Id");
      const stream = createAssistantStream({
        onFirstChunk: () => hideThinking(),
        delayMs: 35
      });
      if (!res.body) {
        const text = await res.text();
        stream.append(text || "No response.");
        const result = stream.finalize();
        if (sourcesId && result?.row) {
          const sourcesRes = await fetch(`/api/sources/${encodeURIComponent(sourcesId)}`);
          if (sourcesRes.ok) {
            const data = await sourcesRes.json();
            renderSources(result.row, data.sources || []);
          }
        }
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        stream.append(decoder.decode(value, { stream: true }));
      }
      const result = stream.finalize();
      if (sourcesId && result?.row) {
        const sourcesRes = await fetch(`/api/sources/${encodeURIComponent(sourcesId)}`);
        if (sourcesRes.ok) {
          const data = await sourcesRes.json();
          renderSources(result.row, data.sources || []);
        }
      }
    }
  } catch (err) {
    hideThinking();
    addMessage("assistant", "Network error. Check the server.");
  } finally {
    formEl.querySelector("button").disabled = false;
  }
});

chatEl.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.classList.contains("inline-caveat-link")) {
    event.preventDefault();
    openComorbiditiesModal();
    return;
  }
  if (!target.classList.contains("source-sup")) return;
  const sourceId = Number(target.dataset.source);
  if (!sourceId) return;
  const row = target.closest(".message.assistant");
  if (!row) return;
  const sources = sourceStore.get(row);
  if (!sources) return;
  const source = sources.find((item) => item.displayId === sourceId);
  if (source) openSourceModal(source);
});

inputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    formEl.requestSubmit();
  }
});

inputEl.addEventListener("focus", () => {
  if (!inputEl.value.trim()) {
    showGhost(suggestionSamples[suggestionIndex]);
  }
});

inputEl.addEventListener("blur", () => {
  if (!inputEl.value.trim()) {
    showGhost(suggestionSamples[suggestionIndex]);
  }
});

inputEl.addEventListener("input", () => {
  if (inputEl.value.trim()) {
    ghostEl.classList.remove("is-visible");
  } else {
    showGhost(suggestionSamples[suggestionIndex]);
  }
});

startSuggestionRotation();
bindVersionSwitch();
