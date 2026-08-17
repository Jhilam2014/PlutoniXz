function firstText(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() || "";
}

// Runtime status events are not model turns. Keeping their message separate
// prevents a failure reason from being displayed as both a request and reply.
export function runtimeEventTranscript(event = {}) {
  const inputLog = firstText(event.agentInput, event.instruction, event.sourceInstruction);
  const responseLog = firstText(event.agentResponse, event.outputTail, event.result?.message);
  const message = firstText(event.message);
  const statusLog = message && message !== inputLog && message !== responseLog ? message : "";
  return { inputLog, responseLog, statusLog };
}
