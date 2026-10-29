import { Agent, setGlobalDispatcher } from 'undici'

// Node 26's fetch multiplexes every request over one HTTP/2 connection, and
// AI Gateway caps concurrent streams per connection: past ~16 in-flight evals
// each new request queued behind a finished one (TTFT grew to 80s+ and long
// waits ended as client-closed 499s). A plain HTTP/1.1 pool keeps every
// request independent. Evals only; production runs Node 22 at low concurrency.
setGlobalDispatcher(new Agent({ allowH2: false, connections: 64 }))
