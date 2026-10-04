import { Problem } from '../errors.js';

export type ResponsePath = (string | number)[];
export class ResponseFieldProblem extends Problem {
  constructor(
    public path: ResponsePath,
    public cause: Problem
  ) {
    super(cause.status, cause.code, cause.message);
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
