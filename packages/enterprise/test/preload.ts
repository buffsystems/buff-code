// Buff: без настроенного хранилища тесты идут против S3 в памяти (`fixture/s3.ts`), а не облака.
import { startMemoryS3 } from "./fixture/s3"

if (!process.env.OPENCODE_STORAGE_ADAPTER) {
  const s3 = startMemoryS3()
  process.env.OPENCODE_STORAGE_ADAPTER = "s3"
  process.env.OPENCODE_STORAGE_ENDPOINT = s3.endpoint
  process.env.OPENCODE_STORAGE_BUCKET = "opencode-unit"
  process.env.OPENCODE_STORAGE_ACCESS_KEY_ID = "unit"
  process.env.OPENCODE_STORAGE_SECRET_ACCESS_KEY = "unit"
}
