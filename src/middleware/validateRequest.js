export const validateRequest = (schema) => (request, response, next) => {
  const result = schema.safeParse({
    body: request.body,
    params: request.params,
    query: request.query,
    headers: request.headers,
  });

  if (!result.success) {
    next(result.error);
    return;
  }

  request.validated = result.data;
  next();
};
