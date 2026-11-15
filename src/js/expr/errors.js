// Error type for anything wrong with a user's expression. `start`/`end` are
// character offsets into the source text (end exclusive) when known.
export class ExprError extends Error {
  constructor(message, start = -1, end = -1) {
    super(message);
    this.name = 'ExprError';
    this.start = start;
    this.end = end;
  }
}
