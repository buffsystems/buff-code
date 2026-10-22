import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { serviceCommand } from "./service-command"

const command = ["/opt/buff/opencode-cli", "serve", "--service"]

describe("serviceCommand", () => {
  test("macOS and Windows spawn the service as it is", () => {
    expect(serviceCommand(command, "darwin")).toEqual(command)
    expect(serviceCommand(command, "win32")).toEqual(command)
  })

  test("Linux without bash spawns it as it is", () => {
    expect(serviceCommand(command, "linux", "/nonexistent/bash")).toEqual(command)
  })

  test.if(process.platform === "linux" && existsSync("/bin/bash"))(
    "on Linux the service gets no descriptor of its parent beyond stdio, under its own pid",
    () => {
      // The parent (as Electron's main process does) holds descriptors without close-on-exec: 7 and
      // 12 here. The wrapped command lists what the exec'd process has open and prints its pid's parent.
      const probe = ["/bin/sh", "-c", 'ls /proc/$$/fd; echo "ppid $PPID"']
      const [bash, ...args] = serviceCommand(probe, "linux")
      const parent = `exec 7</etc/hostname; exec 12</etc/hostname; echo "self $$"; exec "$@"`
      const result = spawnSync("/bin/bash", ["-c", parent, "parent", bash!, ...args], {
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
      })
      expect(result.status).toBe(0)
      const lines = result.stdout.trim().split("\n")
      const self = lines.find((line) => line.startsWith("self "))?.slice(5)
      const descriptors = lines.filter((line) => /^\d+$/.test(line)).map(Number)
      // 0-2 are stdio; ls opens one more to read the directory.
      expect(descriptors.filter((fd) => fd > 2).length).toBeLessThanOrEqual(1)
      expect(descriptors).not.toContain(7)
      expect(descriptors).not.toContain(12)
      // exec all the way down: the probe's parent is the process that spawned the wrapper.
      expect(lines).toContain(`ppid ${process.pid}`)
      expect(self).toBeDefined()
      expect(result.stderr).toBe("")
    },
  )
})
