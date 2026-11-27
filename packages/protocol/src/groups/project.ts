import { Project } from "@opencode/schema/project"
import { Schema, Struct } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { HttpApiSchema } from "effect/unstable/httpapi"
import { ConflictError, ProjectNotFoundError } from "../errors.js"

const root = "/api/project"
const UpdatePayload = Schema.Struct(Struct.omit(Project.UpdateInput.fields, ["projectID"]))

export const ProjectGroup = HttpApiGroup.make("server.project")
  .add(
    HttpApiEndpoint.get("project.list", root, {
      success: Schema.Array(Project.Info),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "project.list",
        summary: "List projects",
        description: "List known projects.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("project.update", `${root}/:projectID`, {
      params: { projectID: Project.ID },
      payload: UpdatePayload,
      success: Project.Info,
      error: ProjectNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "project.update",
        summary: "Update project",
        description: "Update the project canonical directory, display metadata, and workspace commands.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("project.remove", `${root}/:projectID`, {
      params: { projectID: Project.ID },
      success: HttpApiSchema.NoContent,
      error: [ProjectNotFoundError, ConflictError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "project.remove",
        summary: "Remove project",
        description:
          "Forget a project that has no sessions left. Its directory is not touched; a project with sessions answers a conflict.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "project",
      description: "Project routes.",
    }),
  )
