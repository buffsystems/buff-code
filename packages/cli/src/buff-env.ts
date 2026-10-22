// Buff (#510): свои имена переменных окружения (BUFF_X) — до того, как любой модуль прочтёт
// апстримные (OPENCODE_X). Поэтому этот модуль импортируется в точке входа первым.
import { BuffEnv } from "@opencode/schema/buff-env"

Object.assign(process.env, BuffEnv.aliases(process.env))
