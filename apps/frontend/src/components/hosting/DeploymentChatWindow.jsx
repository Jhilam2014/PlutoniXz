import { useState } from "react";

export default function DeploymentChatWindow({ messages, onSend }) {
  const [message, setMessage] = useState("");
  function submit(event) {
    event.preventDefault();
    if (!message.trim()) return;
    onSend(message.trim());
    setMessage("");
  }
  return (
    <section className="hosting-chat">
      <ol>
        {(messages || []).map((item) => (
          <li key={item.id} className={item.role}>
            <strong>{item.role === "assistant" ? "Deployment assistant" : "You"}</strong>
            <p>{item.content}</p>
          </li>
        ))}
      </ol>
      <form onSubmit={submit}>
        <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Reply to the deployment assistant..." />
        <button type="submit">Send</button>
      </form>
    </section>
  );
}
