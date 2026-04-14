import type { ApiResponse } from "@/lib/contracts";

class ApiClient {
  async request<T>(input: string, init?: RequestInit): Promise<T> {
    const response = await fetch(input, {
      credentials: "include",
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
      ...init,
    });

    const payload = await response.json() as ApiResponse<T>;
    if (!payload.ok) {
      throw new Error(payload.error.message);
    }

    return payload.data;
  }

  get<T>(input: string): Promise<T> {
    return this.request<T>(input);
  }

  post<T>(input: string, body?: unknown): Promise<T> {
    return this.request<T>(input, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  patch<T>(input: string, body: unknown): Promise<T> {
    return this.request<T>(input, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }
}

export const api = new ApiClient();
