// Whether files are being dragged over the window while a composer is mounted (#584), for the
// dropzone the session and draft screens draw over their surface, and what the model reads.

import { createStore } from "../../core/store"

export const dropState = createStore<{ active: boolean; input?: { image: boolean; pdf: boolean } }>({ active: false })
