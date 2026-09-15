import { beforeEach, describe, expect, it } from "vitest";
import { useDbUpdateStore } from "./dbUpdateStore";

describe("dbUpdateStore", () => {
  beforeEach(() => useDbUpdateStore.setState({ runs: {} }));

  it("keeps runs per version and reports the run that exited", () => {
    const s = useDbUpdateStore.getState();
    s.begin("19", "all", null);
    s.begin("18", "eq_base", null);
    s.event("19", { event: "start", database: "v19_a", index: 1, total: 1, log: "/l.log" });
    const exited = useDbUpdateStore.getState().exited("19", 0);
    expect(exited?.phase).toBe("finished");
    expect(useDbUpdateStore.getState().runs["18"].phase).toBe("running");
  });

  it("returns undefined when an unknown version exits", () => {
    expect(useDbUpdateStore.getState().exited("17", 0)).toBeUndefined();
  });

  it("attaches unknown running versions without touching known runs", () => {
    const s = useDbUpdateStore.getState();
    s.begin("19", "all", null);
    s.attach(["19", "18"]);
    const runs = useDbUpdateStore.getState().runs;
    expect(runs["19"].detailsLost).toBe(false);
    expect(runs["18"].detailsLost).toBe(true);
  });

  it("clears the restart config exactly once and dismisses a run", () => {
    const s = useDbUpdateStore.getState();
    s.begin("19", "all", { version: "19", database: "v19_a" });
    s.clearRestart("19");
    expect(useDbUpdateStore.getState().runs["19"].restartServer).toBeNull();
    s.dismiss("19");
    expect(useDbUpdateStore.getState().runs["19"]).toBeUndefined();
  });
});
