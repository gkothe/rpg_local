export class Problem extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}
export const conflict = (message: string) => new Problem(409, 'conflict', message);
