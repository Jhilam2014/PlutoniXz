const SECRET_PATTERNS = [
  { pattern: /\b(?:sk|sess|ghp|github_pat|xoxb|xoxp)-[A-Za-z0-9_=-]{16,}\b/g, replacement: "[REDACTED_TOKEN]" },
  { pattern: /\b[A-Za-z0-9_\-.]{20,}\.[A-Za-z0-9_\-.]{20,}\.[A-Za-z0-9_\-.]{20,}\b/g, replacement: "[REDACTED_JWT]" },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: "[REDACTED_PRIVATE_KEY]" },
  { pattern: /\b(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)\s*[:=]\s*["']?[^"'\s]+/gi, replacement: "[REDACTED_SECRET_ASSIGNMENT]" },
  { pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replacement: "[REDACTED_EMAIL]" }
];

const PROMPT_INJECTION_PATTERNS = [
  /\bignore (?:all )?(?:previous|prior|above|system|developer|root|agent)(?:\s+(?:previous|prior|above|system|developer|root|agent))* instructions\b/gi,
  /\bdisregard (?:all )?(?:previous|prior|above|system|developer|root|agent)(?:\s+(?:previous|prior|above|system|developer|root|agent))* instructions\b/gi,
  /\byou are now\b/gi,
  /\bdelete (?:AGENTS\.md|auth\.js|credentials?|secrets?)\b/gi,
  /\breveal (?:secrets?|tokens?|credentials?)\b/gi
];

export function redactSensitiveText(value = "", { maxLength = 1200 } = {}) {
  let text = String(value || "");
  for (const rule of SECRET_PATTERNS) {
    text = text.replace(rule.pattern, rule.replacement);
  }
  return text.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function neutralizeLogInstruction(value = "", options = {}) {
  let text = redactSensitiveText(value, options);
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    text = text.replace(pattern, "[NEUTRALIZED_LOG_INSTRUCTION]");
  }
  return text;
}

export function boundedObject(value, { maxStringLength = 800, maxArrayLength = 20, depth = 0 } = {}) {
  if (depth > 4) return "[TRUNCATED_DEPTH]";
  if (typeof value === "string") return neutralizeLogInstruction(value, { maxLength: maxStringLength });
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, maxArrayLength).map((item) => boundedObject(item, { maxStringLength, maxArrayLength, depth: depth + 1 }));
  }
  if (typeof value === "object" && value) {
    return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [
      redactSensitiveText(key, { maxLength: 120 }),
      boundedObject(item, { maxStringLength, maxArrayLength, depth: depth + 1 })
    ]));
  }
  return "";
}

export function fingerprintText(value = "") {
  return neutralizeLogInstruction(value, { maxLength: 260 })
    .toLowerCase()
    .replace(/\b[0-9a-f]{8,}\b/g, "[id]")
    .replace(/\b\d{2,}\b/g, "[n]")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasPromptInjection(value = "") {
  return PROMPT_INJECTION_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(String(value || ""));
  });
}
