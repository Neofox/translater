import 'vitest-browser-react'
import '../../src/styles.css'
import { beforeEach, expect } from 'vitest'

beforeEach(async () => {
  // Vite can finish the test-module import before WebKit applies its CSS link.
  // Geometry checks must observe the actual app stylesheet, not browser defaults.
  await expect
    .poll(
      () =>
        getComputedStyle(document.documentElement)
          .getPropertyValue('--color-bg')
          .trim(),
      { timeout: 10000 },
    )
    .not.toBe('')
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem('ui-lang', 'en')
})
