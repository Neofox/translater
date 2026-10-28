import { createServerFn } from '@tanstack/react-start'
import {
  getCookie,
  getRequestHeader,
  setResponseHeader,
} from '@tanstack/react-start/server'
import { PREFERENCES_COOKIE, readPreferencesCookie } from '../lib/preferences'

export const getPreferences = createServerFn({ method: 'GET' }).handler(() => {
  setResponseHeader('Cache-Control', 'private, no-store')
  return readPreferencesCookie(
    getCookie(PREFERENCES_COOKIE),
    getRequestHeader('accept-language'),
  )
})
