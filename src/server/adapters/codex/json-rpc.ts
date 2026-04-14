export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params: unknown;
};

export type JsonRpcSuccess = {
  id: string | number;
  result: unknown;
};

export type JsonRpcError = {
  id: string | number | null;
  error: {
    code: number;
    message: string;
  };
};

export type JsonRpcNotification = {
  method: string;
  params: unknown;
};

export type JsonRpcServerRequest = {
  id: string | number;
  method: string;
  params: unknown;
};

export type JsonRpcMessage =
  | JsonRpcSuccess
  | JsonRpcError
  | JsonRpcNotification
  | JsonRpcServerRequest;

export function isJsonRpcSuccess(message: JsonRpcMessage): message is JsonRpcSuccess {
  return "id" in message && "result" in message;
}

export function isJsonRpcError(message: JsonRpcMessage): message is JsonRpcError {
  return "error" in message;
}

export function isJsonRpcServerRequest(message: JsonRpcMessage): message is JsonRpcServerRequest {
  return "id" in message && "method" in message && !("result" in message) && !("error" in message);
}

export function isJsonRpcNotification(message: JsonRpcMessage): message is JsonRpcNotification {
  return "method" in message && !("id" in message);
}
