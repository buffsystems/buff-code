export type FirstNavigationSample = {
  observedAtMs: number
  source: boolean
  destination: boolean
  content: boolean
  /** The location is already the destination's (its page is up, its transcript may still load). */
  route?: boolean
  pathname?: string
  center?: string
}

function category(sample: FirstNavigationSample) {
  if (sample.destination && !sample.source) return "destination"
  if (sample.source && !sample.destination) return "source"
  if (!sample.content) return "blank"
  // Since upstream stopped prefetching inactive tabs (#46762) and waits for a session's history
  // before building its cold timeline (#48223), an unvisited session shows its own title and
  // composer for a frame or two before its transcript: content, on the destination's route.
  if (sample.route) return "pending"
  return "unknown"
}

export function summarizeFirstNavigation(samples: FirstNavigationSample[]) {
  const categories = samples.map(category)
  const stable = categories.findIndex(
    (value, index) =>
      value === "destination" && categories[index + 1] === "destination" && categories[index + 2] === "destination",
  )
  return {
    samples: samples.length,
    firstDestinationObservedMs: samples[categories.indexOf("destination")]?.observedAtMs ?? null,
    stableDestinationObservedMs: stable === -1 ? null : samples[stable + 2]!.observedAtMs,
    sourceSamples: categories.filter((value) => value === "source").length,
    blankSamples: categories.filter((value) => value === "blank").length,
    unknownSamples: categories.filter((value) => value === "unknown").length,
    pendingSamples: categories.filter((value) => value === "pending").length,
    destinationSamples: categories.filter((value) => value === "destination").length,
  }
}
