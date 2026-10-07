import { Problem } from '../errors.js';

export type ResponsePath = (string | number)[];
export class ResponseFieldProblem extends Problem {
  constructor(
    public path: ResponsePath,
    public cause: Problem,
    /** The only valid value for this path, so the repair loop can apply it without a model call. */
    public forced?: { value: unknown }
  ) {
    super(cause.status, cause.code, cause.message);
  }
}
/** Independent invalid fields can be corrected together without widening their paths. */
export class ResponseFieldProblems extends ResponseFieldProblem {
  constructor(public problems: readonly ResponseFieldProblem[]) {
    super(problems[0]!.path, problems[0]!.cause);
    this.message = problems
      .map((problem) => `${problem.path.join('.')}: ${problem.message}`)
      .join('; ');
  }
}
export function atResponseField<T>(path: ResponsePath, work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof ResponseFieldProblem) throw error;
    if (error instanceof Problem) throw new ResponseFieldProblem(path, error);
    throw error;
  }
}
