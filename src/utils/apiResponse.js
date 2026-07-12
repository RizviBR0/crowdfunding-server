export const sendSuccess = (response, statusCode, data, meta) => {
  const body = {
    success: true,
    data,
  };

  if (meta) {
    body.meta = meta;
  }

  return response.status(statusCode).json(body);
};

export const sendError = (response, error) => {
  const body = {
    success: false,
    error: {
      code: error.code,
      message: error.message,
    },
  };

  if (error.details) {
    body.error.details = error.details;
  }

  return response.status(error.statusCode).json(body);
};
