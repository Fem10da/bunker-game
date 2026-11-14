interface RealtimeCallbacks {
  readonly onConnectionChange: (connected: boolean) => void;
  readonly onStateChange: () => void;
}

export interface RealtimeSubscription {
  readonly close: () => void;
  readonly supported: boolean;
}

function subscribeToUpdates(
  path: string,
  callbacks: RealtimeCallbacks
): RealtimeSubscription {
  if (typeof EventSource !== "function") {
    callbacks.onConnectionChange(false);
    return {
      close: () => undefined,
      supported: false
    };
  }

  const source = new EventSource(path);
  const connected = () => callbacks.onConnectionChange(true);
  const ready = () => {
    callbacks.onConnectionChange(true);
    callbacks.onStateChange();
  };
  const disconnected = () => callbacks.onConnectionChange(false);
  const stateChanged = () => callbacks.onStateChange();

  source.addEventListener("open", connected);
  source.addEventListener("ready", ready);
  source.addEventListener("error", disconnected);
  source.addEventListener("state_changed", stateChanged);

  return {
    close: () => {
      source.removeEventListener("open", connected);
      source.removeEventListener("ready", ready);
      source.removeEventListener("error", disconnected);
      source.removeEventListener("state_changed", stateChanged);
      source.close();
    },
    supported: true
  };
}

export function subscribeToLobbyUpdates(
  code: string,
  callbacks: RealtimeCallbacks
): RealtimeSubscription {
  return subscribeToUpdates(
    `/api/realtime/${encodeURIComponent(code)}`,
    callbacks
  );
}

export function subscribeToPublicScreenUpdates(
  code: string,
  callbacks: RealtimeCallbacks
): RealtimeSubscription {
  return subscribeToUpdates(
    `/api/screens/${encodeURIComponent(code)}/realtime`,
    callbacks
  );
}
