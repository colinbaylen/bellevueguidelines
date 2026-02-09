# Bellevue Admitting Guidelines — Interpretation Guide

## Purpose
This document captures interpretation notes that clarify how to apply specific parts of the Bellevue admitting guidelines PDF. It is designed to be updated whenever the PDF changes so guidance stays aligned with the source, and to serve as a living record of decisions.

## How to update this guide
1. Replace `bellevue_admitting_guidelines.pdf` with the latest version.
2. Review the PDF changes and update the relevant sections below (add new sections as needed).
3. Re-run `npm run ingest` to refresh embeddings.
4. Commit this file and `data/embeddings.json` together so the interpretation notes stay in sync with the PDF.

## Conventions
- **PDF reference:** Include page number(s) and section heading(s).
- **Interpretation:** Concise clarification of how to apply the guideline.
- **Rationale:** Why the interpretation is needed (e.g., ambiguity, cross-refs).
- **Examples:** Optional, short examples of when the interpretation applies.
- **Open questions:** Track anything that still needs confirmation.
- **Change log:** Record when you updated a section.

---

## Response voice and authority
Use this section to keep the assistant's responses consistent and to avoid ceding authority over interpretation or policy to the user.

- **Voice:** Calm, concise, and matter-of-fact. Sound like a reliable AI assistant: steady, stolid, and neutral, without enthusiasm, hedging, or overfamiliarity.
- **Authority:** The assistant does not offer the user the ability to change, override, or negotiate interpretation rules or guideline logic. Only engineers maintain and revise this guide.
- **No policy negotiation:** Do not ask the user to decide how the guidelines should be applied. If a needed interpretation is missing or ambiguous, say so explicitly to the user, present the best-supported reading(s) grounded in the PDF, and note it as an open question for engineers.
- **No user-directed tuning:** Do not invite the user to "update the guidelines," "adjust the rules," or "confirm how to interpret" the document.
- **Decision posture:** When the PDF supports a clear interpretation, state it directly. When it does not, clearly label that there is no definitive answer in the guidelines and avoid inventing rules. If helpful, outline the plausible interpretations that the PDF supports.
- **Minimal clarification:** Ask the user only for case-specific facts needed to apply the guidelines, not for policy preferences.
- **Consistency:** Prefer stable phrasing for recurring decisions and avoid stylistic drift across responses.
- **Formality:** Professional and restrained. Avoid jokes, emojis, or casual asides.

---

## Section: [Add PDF section title here]
- **PDF reference:** Page X, “Section title.”
- **Interpretation:**
  - [Add clarification notes.]
- **Rationale:**
  - [Add rationale for interpretation.]
- **Examples:**
  - [Add example if helpful.]
- **Open questions:**
  - [Add questions or follow-ups if any.]
- **Last updated:** YYYY-MM-DD

---

## Section: Medical comorbidities
- **PDF reference:** Page 3-4, “Medical Comorbidities.”
- **Interpretation:**
  - Any diagnosis listed under “Medical comorbidities” in the PDF is an automatic admit to Medicine, regardless of the primary admitting diagnosis.
  - For every query, check the case against the “Medical comorbidities” list; if any listed diagnosis is present, the admission service is Medicine.
- **Rationale:**
  - This section overrides primary admitting diagnosis when a listed comorbidity is present.
- **Examples:**
  - [Add example if helpful.]
- **Open questions:**
  - [Add questions or follow-ups if any.]
- **Last updated:** 2026-02-09

---

## Change log
- 2026-02-09 — Added response voice and authority guidance.
- YYYY-MM-DD — Initial template created.

## Update checklist (quick)
- [ ] PDF updated in repo
- [ ] Interpretation notes updated (new/changed sections)
- [ ] `npm run ingest` completed
- [ ] `data/embeddings.json` committed with this guide
