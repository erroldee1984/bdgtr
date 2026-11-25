/** An HTTP response from the bdgtr API that wasn't 2xx (or "not signed in"). */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(`API ${status}: ${code}`);
    this.name = 'ApiError';
  }
}
