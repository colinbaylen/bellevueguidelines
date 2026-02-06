const chatEl = document.getElementById("chat");
const formEl = document.getElementById("composer");
const inputEl = document.getElementById("input");
const ghostEl = document.getElementById("ghost-text");
const inlineSourceEl = document.getElementById("inline-source");

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

  const flushList = () => {
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      html += "<div class=\"spacer\"></div>";
      return;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${bulletMatch[1]}</li>`;
      return;
    }

    flushList();

    if (trimmed.endsWith(":") && trimmed.length <= 80) {
      html += `<div class="heading">${trimmed}</div>`;
    } else {
      html += `<div>${trimmed}</div>`;
    }
  });

  flushList();

  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  return html;
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages })
    });

    if (!res.ok) {
      const err = await res.json();
      hideThinking();
      addMessage("assistant", `Error: ${err.error || "Request failed"}`);
    } else {
      const data = await res.json();
      hideThinking();
      addAssistantMessage(data.answer || "No response.");
    }
  } catch (err) {
    hideThinking();
    addMessage("assistant", "Network error. Check the server.");
  } finally {
    formEl.querySelector("button").disabled = false;
  }
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
