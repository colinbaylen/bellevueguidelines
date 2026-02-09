const chatEl = document.getElementById("chat");
const formEl = document.getElementById("composer");
const inputEl = document.getElementById("input");
const ghostEl = document.getElementById("ghost-text");
const versionSwitchEl = document.getElementById("version-switch");
const submitFeedbackEl = document.getElementById("feedback-submit");
const feedbackStatusEl = document.getElementById("feedback-status");

const scoreAccuracyEl = document.getElementById("score-accuracy");
const scoreSafetyEl = document.getElementById("score-safety");
const scoreUsefulnessEl = document.getElementById("score-usefulness");
const scoreClarityEl = document.getElementById("score-clarity");
const wouldUseEl = document.getElementById("would-use");
const feedbackNotesEl = document.getElementById("feedback-notes");
const tagInputs = Array.from(document.querySelectorAll(".tag-grid input[type='checkbox']"));

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
      messages.push({ role: "assistant", content: raw });
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

function resetFeedbackForm() {
  scoreAccuracyEl.value = "";
  scoreSafetyEl.value = "";
  scoreUsefulnessEl.value = "";
  scoreClarityEl.value = "";
  wouldUseEl.value = "";
  feedbackNotesEl.value = "";
  tagInputs.forEach((input) => {
    input.checked = false;
  });
}

async function submitFeedback() {
  feedbackStatusEl.textContent = "";
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");

  if (!lastUser || !lastAssistant) {
    feedbackStatusEl.textContent = "Submit a prompt and response before sending feedback.";
    feedbackStatusEl.className = "feedback-status warning";
    return;
  }

  const tags = tagInputs.filter((input) => input.checked).map((input) => input.value);

  const payload = {
    view: "testing",
    scores: {
      accuracy: scoreAccuracyEl.value || null,
      safety: scoreSafetyEl.value || null,
      usefulness: scoreUsefulnessEl.value || null,
      clarity: scoreClarityEl.value || null
    },
    would_use: wouldUseEl.value || null,
    tags,
    notes: feedbackNotesEl.value.trim() || null,
    prompt: lastUser.content,
    response: lastAssistant.content,
    recent_messages: messages.slice(-6)
  };

  try {
    submitFeedbackEl.disabled = true;
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Request failed" }));
      feedbackStatusEl.textContent = err.error || "Feedback failed.";
      feedbackStatusEl.className = "feedback-status warning";
      return;
    }

    feedbackStatusEl.textContent = "Feedback submitted. Thank you.";
    feedbackStatusEl.className = "feedback-status success";
    resetFeedbackForm();
  } catch (err) {
    feedbackStatusEl.textContent = "Network error while submitting feedback.";
    feedbackStatusEl.className = "feedback-status warning";
  } finally {
    submitFeedbackEl.disabled = false;
  }
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
      const stream = createAssistantStream({
        onFirstChunk: () => hideThinking(),
        delayMs: 35
      });
      if (!res.body) {
        const text = await res.text();
        stream.append(text || "No response.");
        stream.finalize();
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        stream.append(decoder.decode(value, { stream: true }));
      }
      stream.finalize();
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

submitFeedbackEl.addEventListener("click", submitFeedback);

bindVersionSwitch();
startSuggestionRotation();
