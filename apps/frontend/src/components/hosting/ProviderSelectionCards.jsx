import CloudServiceIcon from "./CloudServiceIcon.jsx";

export default function ProviderSelectionCards({ providers, selectedProvider, onSelect }) {
  return (
    <div className="provider-card-grid">
      {providers.map((provider) => (
        <button key={provider.id} className={selectedProvider === provider.id ? "active" : ""} onClick={() => onSelect(provider.id)} type="button">
          <span className="provider-card-head">
            <CloudServiceIcon providerId={provider.id} />
            <strong>{provider.name}</strong>
          </span>
          <span>{provider.bestFor}</span>
          <small>{provider.recommendation}</small>
        </button>
      ))}
    </div>
  );
}
