import type { SessionMessageUser, SessionPromptInput } from "@opencode/client/promise"

/**
 * «Повторить» у отказа хода (#458): то же сообщение человека ещё раз. Вложения в сохранённом
 * сообщении лежат содержимым, а отправляются адресом — здесь одно превращается в другое.
 */
export function retryInput(sessionID: string, message: SessionMessageUser): SessionPromptInput {
  return {
    sessionID,
    text: message.text,
    files: message.files?.map((file) => ({
      uri: `data:${file.mime};base64,${file.data}`,
      name: file.name,
      description: file.description,
      mention: file.mention,
    })),
    agents: message.agents,
    skills: message.skills,
    metadata: message.metadata,
  }
}
