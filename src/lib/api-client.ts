export async function api(
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
): Promise<unknown> {
  const response = await fetch(path, {
    method,
    headers: {
      'X-EmDash-Request': '1',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data
        ? JSON.stringify(data.error)
        : 'Request failed';
    throw new Error(message);
  }
  return data;
}
