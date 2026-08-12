import { useEffect } from "react";

const selectableSelector = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "label",
  "[role='button']",
  "[role='link']",
  "[data-ui-id]",
  "[data-testid]",
  "header",
  "nav",
  "main",
  "section",
  "article",
  "aside",
  "footer",
  "h1",
  "h2",
  "h3",
  "p",
  "li",
  "span"
].join(",");

function slug(value) {
  return String(value || "element")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36) || "element";
}

function describeElement(element) {
  const explicitId = element.getAttribute("data-ui-id") || element.id || element.getAttribute("data-testid");
  const label =
    element.getAttribute("aria-label") ||
    element.getAttribute("title") ||
    element.textContent?.replace(/\s+/g, " ").trim().slice(0, 80) ||
    element.getAttribute("placeholder") ||
    element.tagName.toLowerCase();
  if (!element.dataset.plutonixUiId) {
    const all = Array.from(document.querySelectorAll(selectableSelector));
    const index = Math.max(1, all.indexOf(element) + 1);
    element.dataset.plutonixUiId = explicitId ? slug(explicitId) : `ui-${element.tagName.toLowerCase()}-${slug(label)}-${index}`;
  }
  return {
    id: element.dataset.plutonixUiId,
    tag: element.tagName.toLowerCase(),
    label,
    classes: element.className && typeof element.className === "string" ? element.className : ""
  };
}

export default function PlutoniXReferenceBridge() {
  useEffect(() => {
    let enabled = false;
    let hoverElement = null;
    let externallyHighlightedElement = null;
    const selectedElements = new Set();
    const style = document.createElement("style");
    style.textContent = `
      .plutonix-reference-hover {
        outline: 0 !important;
        border-radius: 10px !important;
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.28), 0 0 0 7px rgba(20, 184, 166, 0.16) !important;
        animation: plutonix-reference-glow 1.1s ease-in-out infinite !important;
        cursor: crosshair !important;
      }
      .plutonix-reference-selected {
        outline: 0 !important;
        border-radius: 10px !important;
        box-shadow: 0 0 0 3px rgba(34, 211, 238, 0.32), 0 0 0 9px rgba(59, 130, 246, 0.16), 0 0 26px rgba(139, 92, 246, 0.26) !important;
        animation: plutonix-reference-selected-glow 1.25s ease-in-out infinite !important;
      }
      .plutonix-reference-external-highlight {
        outline: 0 !important;
        border-radius: 10px !important;
        box-shadow: 0 0 0 3px #ef4444, 0 0 0 6px #f59e0b, 0 0 0 9px #eab308, 0 0 0 12px #22c55e, 0 0 0 15px #06b6d4, 0 0 0 18px #6366f1, 0 0 0 21px #ec4899 !important;
        animation: plutonix-reference-rainbow 1.15s linear infinite !important;
      }
      .plutonix-reference-mode * {
        cursor: crosshair !important;
      }
      @keyframes plutonix-reference-glow {
        0%, 100% { box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.25), 0 0 0 7px rgba(20, 184, 166, 0.12); }
        50% { box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.42), 0 0 0 11px rgba(20, 184, 166, 0.2); }
      }
      @keyframes plutonix-reference-selected-glow {
        0%, 100% { box-shadow: 0 0 0 3px rgba(34, 211, 238, 0.3), 0 0 0 9px rgba(59, 130, 246, 0.13), 0 0 22px rgba(139, 92, 246, 0.22); }
        50% { box-shadow: 0 0 0 4px rgba(34, 211, 238, 0.48), 0 0 0 13px rgba(59, 130, 246, 0.2), 0 0 32px rgba(236, 72, 153, 0.26); }
      }
      @keyframes plutonix-reference-rainbow {
        0%, 100% { filter: hue-rotate(0deg) saturate(1.25); transform: translateZ(0) scale(1); }
        50% { filter: hue-rotate(160deg) saturate(1.55); transform: translateZ(0) scale(1.015); }
      }
    `;
    document.head.appendChild(style);

    const clearHover = () => {
      hoverElement?.classList.remove("plutonix-reference-hover");
      hoverElement = null;
    };

    const clearExternalHighlight = () => {
      externallyHighlightedElement?.classList.remove("plutonix-reference-external-highlight");
      externallyHighlightedElement = null;
    };

    const elementForReference = (reference) => {
      const referenceId = String(reference?.id || "");
      if (!referenceId) return null;
      return Array.from(document.querySelectorAll(selectableSelector)).find((element) => describeElement(element).id === referenceId) || null;
    };

    const setMode = (nextEnabled) => {
      enabled = nextEnabled;
      document.documentElement.classList.toggle("plutonix-reference-mode", enabled);
      if (!enabled) clearHover();
    };

    const targetForEvent = (event) => {
      if (!enabled) return null;
      return event.target?.closest?.(selectableSelector);
    };

    const onMouseOver = (event) => {
      const target = targetForEvent(event);
      if (!target || target === hoverElement) return;
      clearHover();
      hoverElement = target;
      hoverElement.classList.add("plutonix-reference-hover");
    };

    const onClick = (event) => {
      const target = targetForEvent(event);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      selectedElements.add(target);
      target.classList.add("plutonix-reference-selected");
      clearHover();
      const reference = describeElement(target);
      window.parent?.postMessage({ type: "plutonix-ui-reference-selected", reference }, "*");
    };

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setMode(false);
        window.parent?.postMessage({ type: "plutonix-ui-reference-cancelled" }, "*");
      }
    };

    const onMessage = (event) => {
      if (event.data?.type === "plutonix-reference-mode") setMode(Boolean(event.data.enabled));
      if (event.data?.type === "plutonix-reference-highlight") {
        clearExternalHighlight();
        if (!event.data.active) return;
        externallyHighlightedElement = elementForReference(event.data.reference);
        externallyHighlightedElement?.classList.add("plutonix-reference-external-highlight");
      }
    };

    window.addEventListener("message", onMessage);
    document.addEventListener("mouseover", onMouseOver, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      setMode(false);
      clearExternalHighlight();
      selectedElements.forEach((element) => element.classList.remove("plutonix-reference-selected"));
      selectedElements.clear();
      style.remove();
      window.removeEventListener("message", onMessage);
      document.removeEventListener("mouseover", onMouseOver, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  return null;
}
