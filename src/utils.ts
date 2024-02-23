export function serializeError(error: any) {
  if (error instanceof Error) {
    const errorObject = {
      ...(error.message && {
        message: JSON.stringify(error.message),
      }),
      ...(error.stack && { stack: error.stack }),
    };
    return JSON.stringify(errorObject);
  } else {
    return JSON.stringify(error);
  }
}
