export class NotFoundError extends Error {
  statusCode = 404;
  constructor(entity: string) {
    super(`${entity} not found`);
    this.name = "NotFoundError";
  }
}

export class ForbiddenError extends Error {
  statusCode = 403;
  constructor() {
    super("Forbidden");
    this.name = "ForbiddenError";
  }
}

export class ValidationError extends Error {
  statusCode = 422;
  constructor(msg: string) {
    super(msg);
    this.name = "ValidationError";
  }
}

export class ConflictError extends Error {
  statusCode = 409;
  constructor(msg: string) {
    super(msg);
    this.name = "ConflictError";
  }
}
