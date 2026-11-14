import { describe, expect, it, vi } from "vitest";

import { createRealtimeHub, formatRealtimeEvent } from "./realtime-hub.js";

describe("realtime hub", () => {
  it("publishes monotonic revisions only to the selected lobby", () => {
    const hub = createRealtimeHub();
    const firstLobby = vi.fn();
    const secondLobby = vi.fn();
    const unsubscribe = hub.subscribe("K7M4Q2", firstLobby);
    hub.subscribe("OTHER1", secondLobby);

    expect(hub.publish("K7M4Q2")).toEqual({
      code: "K7M4Q2",
      revision: 1,
      type: "state_changed"
    });
    expect(hub.publish("K7M4Q2")).toMatchObject({ revision: 2 });
    expect(firstLobby).toHaveBeenCalledTimes(2);
    expect(secondLobby).not.toHaveBeenCalled();

    unsubscribe();
    hub.publish("K7M4Q2");
    expect(firstLobby).toHaveBeenCalledTimes(2);
  });

  it("isolates a broken subscriber and validates lobby codes", () => {
    const hub = createRealtimeHub();
    const healthy = vi.fn();
    hub.subscribe("K7M4Q2", () => {
      throw new Error("closed stream");
    });
    hub.subscribe("K7M4Q2", healthy);

    expect(() => hub.publish("K7M4Q2")).not.toThrow();
    expect(healthy).toHaveBeenCalledOnce();
    expect(() => hub.publish("bad-code")).toThrow("lobby code");
    expect(() => hub.subscribe("", healthy)).toThrow("lobby code");
  });

  it("formats a safe server-sent event", () => {
    expect(
      formatRealtimeEvent({
        code: "K7M4Q2",
        revision: 7,
        type: "state_changed"
      })
    ).toBe(
      'id: 7\nevent: state_changed\ndata: {"code":"K7M4Q2","revision":7,"type":"state_changed"}\n\n'
    );
  });
});
