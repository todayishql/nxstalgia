// Tiện ích cho route handlers: trả JSON và bắt lỗi thống nhất.
export function json(data, status = 200) {
  return Response.json(data, { status });
}

// Bọc handler async: tự bắt lỗi -> trả {error} với status phù hợp.
// Lỗi auth ném ra có err.status = 401.
export function handle(fn) {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      const status = e.status || (e.name === 'ValidationError' ? 400 : 500);
      if (status >= 500) console.error(e);
      return json({ error: e.message || 'Lỗi máy chủ' }, status);
    }
  };
}
