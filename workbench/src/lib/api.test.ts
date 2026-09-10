import {describe, expect, it} from "vitest";
import {bootstrapSessionToken, sessionToken, TOKEN_KEY} from "./api";

function memoryStorage(initial = "") {
  let value = initial;
  return {getItem: (key: string) => key === TOKEN_KEY ? value : null, setItem: (key: string, next: string) => { if (key === TOKEN_KEY) value = next; }};
}

describe("per-tab bearer bootstrap", () => {
  it("stores the fragment token before removing it from browser history", () => {
    const events: string[] = []; const storage = memoryStorage();
    const wrapped = {getItem: storage.getItem, setItem: (key: string, value: string) => { events.push(`store:${value}`); storage.setItem(key, value); }};
    const token = bootstrapSessionToken(
      {hash: "#token=private-session-token", pathname: "/", search: "?view=workbench"},
      wrapped,
      {replaceState: (_data, _unused, url) => events.push(`history:${String(url)}`)},
    );
    expect(token).toBe("private-session-token");
    expect(events).toEqual(["store:private-session-token", "history:/?view=workbench"]);
    expect(sessionToken(storage)).toBe("private-session-token");
  });

  it("retains a prior tab token when a clean URL reloads", () => {
    const storage = memoryStorage("retained-token");
    expect(bootstrapSessionToken({hash: "", pathname: "/", search: ""}, storage, {replaceState: () => undefined})).toBe("retained-token");
  });
});
