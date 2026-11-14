// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  subscribeToLobbyUpdates,
  subscribeToPublicScreenUpdates
} from "./realtime.js";

class FakeEventSource extends EventTarget {
  static readonly instances: FakeEventSource[] = [];
  readonly url: string;
  closed = false;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }
}

afterEach(() => {
  FakeEventSource.instances.length = 0;
  vi.unstubAllGlobals();
});

describe("lobby realtime client", () => {
  it("reports connection changes and state notifications", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const onConnectionChange = vi.fn();
    const onStateChange = vi.fn();

    const subscription = subscribeToLobbyUpdates("K7M4Q2", {
      onConnectionChange,
      onStateChange
    });
    const source = FakeEventSource.instances[0];
    if (source === undefined) {
      throw new Error("Expected EventSource to be created");
    }

    expect(subscription.supported).toBe(true);
    expect(source.url).toBe("/api/realtime/K7M4Q2");
    source.dispatchEvent(new Event("open"));
    source.dispatchEvent(new MessageEvent("ready"));
    source.dispatchEvent(new MessageEvent("state_changed"));
    source.dispatchEvent(new Event("error"));

    expect(onConnectionChange.mock.calls).toEqual([
      [true],
      [true],
      [false]
    ]);
    expect(onStateChange).toHaveBeenCalledTimes(2);

    subscription.close();
    expect(source.closed).toBe(true);
  });

  it("keeps polling available when EventSource is unsupported", () => {
    vi.stubGlobal("EventSource", undefined);
    const onConnectionChange = vi.fn();

    const subscription = subscribeToLobbyUpdates("K7M4Q2", {
      onConnectionChange,
      onStateChange: vi.fn()
    });

    expect(subscription.supported).toBe(false);
    expect(onConnectionChange).toHaveBeenCalledWith(false);
    expect(() => subscription.close()).not.toThrow();
  });

  it("opens a separate public stream for the shared display", () => {
    vi.stubGlobal("EventSource", FakeEventSource);

    subscribeToPublicScreenUpdates("K7M4Q2", {
      onConnectionChange: vi.fn(),
      onStateChange: vi.fn()
    });

    expect(FakeEventSource.instances[0]?.url).toBe(
      "/api/screens/K7M4Q2/realtime"
    );
  });
});
