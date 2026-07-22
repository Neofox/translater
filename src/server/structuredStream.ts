export async function consumeStructuredStream<T>(input: {
  textStream: AsyncIterable<string>
  output: PromiseLike<T>
  onDelta: (delta: string) => void
  onFirstToken: () => void
}): Promise<T> {
  let sawFirstToken = false
  for await (const delta of input.textStream) {
    if (!sawFirstToken) {
      sawFirstToken = true
      input.onFirstToken()
    }
    input.onDelta(delta)
  }
  return await input.output
}
