// The session screen's transcript and composer arrive together (#584), as they do in the Solid
// window, where both are one module. Loaded apart, a composer that came in after the transcript
// took its height from the timeline: the rows jumped under a reader, or under a dragging finger.
// Both slots wait for both modules, so their lazy boundaries resolve in the same render.

type ScreenModules = [typeof import("./timeline/screen"), typeof import("./composer/session-composer")]

export function loadScreenModules(): Promise<ScreenModules> {
  return Promise.all([import("./timeline/screen"), import("./composer/session-composer")])
}
