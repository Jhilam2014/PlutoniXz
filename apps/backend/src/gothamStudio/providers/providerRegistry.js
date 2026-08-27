import { GothamStudioError, normalizeProviderId, publicProviderMetadata } from "../domain.js";

export class ProviderRegistry {
  constructor(providers = []) {
    this.providers = new Map();
    providers.forEach((provider) => this.register(provider));
  }

  register(provider) {
    const id = normalizeProviderId(provider?.id);
    if (!id || typeof provider?.submitJob !== "function" || typeof provider?.getJob !== "function") {
      throw new GothamStudioError("Invalid ML execution provider registration.", { code: "invalid_provider_registration", status: 500 });
    }
    if (this.providers.has(id)) {
      throw new GothamStudioError(`ML execution provider ${id} is already registered.`, { code: "duplicate_provider", status: 409 });
    }
    this.providers.set(id, provider);
    return provider;
  }

  get(id) {
    const provider = this.providers.get(normalizeProviderId(id));
    if (!provider) throw new GothamStudioError("Unknown ML execution provider.", { code: "unknown_provider", status: 404 });
    return provider;
  }

  list() {
    return [...this.providers.values()].map((provider) => {
      const configuration = provider.configurationStatus();
      return publicProviderMetadata({
        id: provider.id,
        label: provider.label,
        status: configuration.status,
        configured: configuration.configured,
        metadata: configuration.metadata || {},
        capabilities: provider.capabilities()
      });
    });
  }
}
