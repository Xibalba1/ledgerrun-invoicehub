// Structured, single-line JSON logs on the pipeline's critical path — the
// observability the PRD asks for ("observable workflow state transitions").
type Fields = Record<string, unknown>;

function emit(level: string, msg: string, fields: Fields) {
  const line = { t: new Date().toISOString(), level, msg, ...fields };
  process.stdout.write(JSON.stringify(line) + "\n");
}

export const log = {
  info: (msg: string, fields: Fields = {}) => emit("info", msg, fields),
  warn: (msg: string, fields: Fields = {}) => emit("warn", msg, fields),
  error: (msg: string, fields: Fields = {}) => emit("error", msg, fields),
};

/** Run `fn`, log its duration, and return [result, elapsedMs]. */
export async function timed<T>(stage: string, fields: Fields, fn: () => Promise<T>): Promise<[T, number]> {
  const start = performance.now();
  try {
    const result = await fn();
    const ms = Math.round(performance.now() - start);
    log.info(`stage.${stage}`, { ...fields, ms });
    return [result, ms];
  } catch (err) {
    const ms = Math.round(performance.now() - start);
    log.error(`stage.${stage}.failed`, { ...fields, ms, err: String(err) });
    throw err;
  }
}
