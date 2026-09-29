export class AppError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string) {
    super(`${entity} not found`, 404);
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

export class PaymentRequiredError extends Error {
  statusCode = 402;
  constructor(msg: string) {
    super(msg);
    this.name = "PaymentRequiredError";
  }
}

export class ServiceUnavailableError extends Error {
  statusCode = 503;
  constructor(msg: string) {
    super(msg);
    this.name = "ServiceUnavailableError";
  }
}

