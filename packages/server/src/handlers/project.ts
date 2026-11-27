import { Project } from "@opencode/core/project"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Effect, RcMap } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { ConflictError, ProjectNotFoundError } from "@opencode/protocol/errors"

export const ProjectHandler = HttpApiBuilder.group(Api, "server.project", (handlers) =>
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    return handlers
      .handle("project.list", () => Project.Service.use((project) => project.list()))
      .handle("project.update", (ctx) =>
        Project.Service.use((project) =>
          project.update({ ...ctx.payload, projectID: ctx.params.projectID }).pipe(
            Effect.mapError(
              () =>
                new ProjectNotFoundError({
                  projectID: ctx.params.projectID,
                  message: `Project not found: ${ctx.params.projectID}`,
                }),
            ),
          ),
        ),
      )
      .handle("project.remove", (ctx) =>
        Project.Service.use((project) =>
          Effect.gen(function* () {
            const known = (yield* project.list()).find((item) => item.id === ctx.params.projectID)
            yield* project.remove(ctx.params.projectID)
            // Каталоги проекта, уже открытые сервером, помнят его: без этого папка, заведённая заново
            // под тем же именем, получила бы проект, которого в базе больше нет (#969).
            if (!known) return
            const refs = Array.from(yield* RcMap.keys(locations.rcMap)).filter(
              (ref) => ref.directory === known.canonical || ref.directory.startsWith(`${known.canonical}/`),
            )
            yield* Effect.forEach(refs, (ref) => locations.invalidate(ref), { discard: true })
          }).pipe(
            Effect.catchTags({
              "Project.NotFoundError": () =>
                new ProjectNotFoundError({
                  projectID: ctx.params.projectID,
                  message: `Project not found: ${ctx.params.projectID}`,
                }),
              "Project.InUseError": (error) =>
                new ConflictError({
                  message: `Project still has ${error.sessions} session(s): move or delete them first`,
                  resource: ctx.params.projectID,
                }),
            }),
          ),
        ),
      )
  }),
)
