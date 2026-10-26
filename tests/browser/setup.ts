import 'vitest-browser-react'
import '../../src/styles.css'
import { beforeEach } from 'vitest'

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem('ui-lang', 'en')
})
