function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function assertProviderAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object' || Array.isArray(adapter)) {
    throw new Error('Provider adapter must be an object.');
  }

  if (!isNonEmptyString(adapter.providerId)) {
    throw new Error('Provider adapter must include a non-empty providerId.');
  }

  if (typeof adapter.execute !== 'function') {
    throw new Error(`Provider adapter ${adapter.providerId} must expose an execute function.`);
  }

  return {
    providerId: adapter.providerId.trim(),
    execute: adapter.execute,
  };
}

export function resolveFetchImplementation(fetchImplementation) {
  const effectiveFetch = fetchImplementation ?? globalThis.fetch;

  if (typeof effectiveFetch !== 'function') {
    throw new Error('A fetch implementation is required to execute provider adapters.');
  }

  return effectiveFetch;
}

export async function parseJsonResponse(response, description) {
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${description} did not return valid JSON: ${error.message}`);
  }
}

export async function parseTextResponse(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
