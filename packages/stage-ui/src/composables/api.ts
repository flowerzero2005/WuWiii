import { SERVER_URL } from '../libs/auth'
import { createApiClient } from '../libs/http-client'

export const client = createApiClient(SERVER_URL)
