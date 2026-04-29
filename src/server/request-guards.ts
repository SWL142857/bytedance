import type http from "node:http";

const LOOPBACK_RANGES = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];

export function isLoopbackAddress(remoteAddress: string | undefined): boolean {
  return LOOPBACK_RANGES.includes(remoteAddress ?? "");
}

export function isLocalRequest(req: http.IncomingMessage): boolean {
  return isLoopbackAddress(req.socket.remoteAddress);
}

export function requireJsonContentType(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const raw = req.headers["content-type"] ?? "";
  const mediaType = raw.split(";")[0]?.trim().toLowerCase() ?? "";
  if (mediaType !== "application/json") {
    res.writeHead(415, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "不支持的媒体类型" }));
    return false;
  }
  return true;
}

const MAX_BODY_BYTES = 4096;

export function parseJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    let overflowed = false;
    req.on("data", (chunk: Buffer) => {
      if (overflowed) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        overflowed = true;
        reject(new Error("Request body too large"));
        return;
      }
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          reject(new Error("Invalid JSON body"));
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}
