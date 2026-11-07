import { logDiagnostic } from './diagnosticEvents'

const MAX_ARG_CHARS = 160

let installed = false

function stringifyArg(value: unknown): string {
  if (value instanceof Error) {
    return value.message || value.name
  }
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function truncate(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? text
  if (firstLine.length <= MAX_ARG_CHARS) return firstLine
  return `${firstLine.slice(0, MAX_ARG_CHARS - 1)}…`
}

function messageFromArgs(args: unknown[]): string {
  if (args.length === 0) return '(no message)'
  return truncate(args.map(stringifyArg).join(' '))
}

/** Capture console.error + uncaught errors into the diagnostic event stream. */
export function installDiagnosticCapture(): void {
  if (installed) return
  installed = true

  const originalError = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    originalError(...args)
    try {
      logDiagnostic('console', messageFromArgs(args), undefined, 'error')
    } catch {
      /* never break the host console */
    }
  }

  if (typeof window === 'undefined') return

  window.addEventListener('error', (event) => {
    const message =
      event.error instanceof Error ? event.error.message || event.error.name : event.message || 'uncaught error'
    logDiagnostic(
      'runtime',
      truncate(message),
      {
        source: event.filename || undefined,
        line: event.lineno || undefined,
        col: event.colno || undefined,
      },
      'error',
    )
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const message = reason instanceof Error ? reason.message || reason.name : truncate(stringifyArg(reason))
    logDiagnostic('runtime', `unhandledrejection: ${truncate(message)}`, undefined, 'error')
  })
}
