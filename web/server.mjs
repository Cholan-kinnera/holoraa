import http from "node:http";
import next from "next";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "127.0.0.1";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port, turbopack: dev });
const handle = app.getRequestHandler();

// Resolve backend target for realtime proxy
function getBackendTarget() {
  const apiUrl = process.env.HOLORAA_API_URL || "http://127.0.0.1:8080";
  try {
    const u = new URL(apiUrl);
    return {
      hostname: u.hostname || "127.0.0.1",
      port: parseInt(u.port || (u.protocol === "https:" ? "443" : "80"), 10),
    };
  } catch {
    return { hostname: "127.0.0.1", port: 8080 };
  }
}

// Build allowed origins set for strict CSRF / origin check
function getAllowedOrigins() {
  const allowed = new Set();
  const configured = process.env.HOLORAA_ALLOWED_ORIGINS || "";
  for (const part of configured.split(",")) {
    const trimmed = part.trim().toLowerCase().replace(/\/+$/, "");
    if (trimmed) {
      allowed.add(trimmed);
    }
  }
  // Standard local fallbacks if not explicitly provided
  allowed.add(`http://localhost:${port}`);
  allowed.add(`http://127.0.0.1:${port}`);
  return allowed;
}

const allowedOrigins = getAllowedOrigins();
const backendTarget = getBackendTarget();

await app.prepare();

const server = http.createServer((req, res) => {
  handle(req, res);
});

// Single upgrade listener handling both realtime WebSocket proxy and Next.js HMR
server.on("upgrade", (req, clientSocket, head) => {
  const parsedUrl = new URL(req.url || "/", "http://localhost");

  // If this is not the realtime WebSocket, delegate to Next.js upgrade handler
  if (parsedUrl.pathname !== "/v1/realtime/ws") {
    const upgradeHandler = app.getUpgradeHandler();
    if (typeof upgradeHandler === "function") {
      upgradeHandler(req, clientSocket, head);
    } else {
      clientSocket.destroy();
    }
    return;
  }

  // Strict Origin validation for realtime upgrade
  const rawOrigin = req.headers.origin;
  if (!rawOrigin || typeof rawOrigin !== "string") {
    clientSocket.write(
      "HTTP/1.1 403 Forbidden\r\n" +
        "Content-Type: text/plain\r\n" +
        "Connection: close\r\n\r\n" +
        "Forbidden: Missing Origin header\n"
    );
    clientSocket.destroy();
    return;
  }

  const normalizedOrigin = rawOrigin.trim().toLowerCase().replace(/\/+$/, "");
  if (!allowedOrigins.has(normalizedOrigin)) {
    clientSocket.write(
      "HTTP/1.1 403 Forbidden\r\n" +
        "Content-Type: text/plain\r\n" +
        "Connection: close\r\n\r\n" +
        "Forbidden: Untrusted Origin\n"
    );
    clientSocket.destroy();
    return;
  }

  // Forward the upgrade request to the Go backend
  // Preserve raw Origin, Sec-WebSocket-Protocol, Sec-WebSocket-Key, Sec-WebSocket-Version, etc.
  const proxyHeaders = {
    ...req.headers,
    host: `${backendTarget.hostname}:${backendTarget.port}`,
  };

  const proxyReq = http.request({
    hostname: backendTarget.hostname,
    port: backendTarget.port,
    path: req.url,
    method: "GET",
    headers: proxyHeaders,
  });

  // 10s handshake timeout
  proxyReq.setTimeout(10000, () => {
    proxyReq.destroy(new Error("Realtime proxy handshake timeout"));
  });

  proxyReq.on("upgrade", (backendRes, backendSocket, backendHead) => {
    if (backendRes.statusCode !== 101) {
      clientSocket.write(
        `HTTP/1.1 ${backendRes.statusCode || 502} ${backendRes.statusMessage || "Bad Gateway"}\r\n` +
          "Connection: close\r\n\r\n"
      );
      clientSocket.destroy();
      backendSocket.destroy();
      return;
    }

    // Forward 101 Switching Protocols response headers to client
    let statusLine = `HTTP/1.1 101 Switching Protocols\r\n`;
    for (const [key, value] of Object.entries(backendRes.headers)) {
      if (Array.isArray(value)) {
        for (const v of value) {
          statusLine += `${key}: ${v}\r\n`;
        }
      } else if (value !== undefined) {
        statusLine += `${key}: ${value}\r\n`;
      }
    }
    statusLine += "\r\n";

    clientSocket.write(statusLine);

    if (backendHead && backendHead.length > 0) {
      clientSocket.write(backendHead);
    }
    if (head && head.length > 0) {
      backendSocket.write(head);
    }

    // Bidirectional pipe with cleanup
    backendSocket.pipe(clientSocket);
    clientSocket.pipe(backendSocket);

    const cleanup = () => {
      if (!clientSocket.destroyed) clientSocket.destroy();
      if (!backendSocket.destroyed) backendSocket.destroy();
    };

    clientSocket.on("error", cleanup);
    backendSocket.on("error", cleanup);
    clientSocket.on("close", cleanup);
    backendSocket.on("close", cleanup);
  });

  proxyReq.on("response", (res) => {
    // If backend returns a non-upgrade HTTP response (e.g., 400 Bad Request)
    let statusLine = `HTTP/1.1 ${res.statusCode || 502} ${res.statusMessage || "Bad Gateway"}\r\n`;
    for (const [key, value] of Object.entries(res.headers)) {
      if (Array.isArray(value)) {
        for (const v of value) {
          statusLine += `${key}: ${v}\r\n`;
        }
      } else if (value !== undefined) {
        statusLine += `${key}: ${value}\r\n`;
      }
    }
    statusLine += "\r\n";

    clientSocket.write(statusLine);
    res.pipe(clientSocket);
    res.on("end", () => {
      clientSocket.destroy();
    });
  });

  proxyReq.on("error", () => {
    if (!clientSocket.destroyed) {
      clientSocket.write(
        "HTTP/1.1 502 Bad Gateway\r\n" +
          "Content-Type: text/plain\r\n" +
          "Connection: close\r\n\r\n" +
          "Realtime backend unavailable\n"
      );
      clientSocket.destroy();
    }
  });

  proxyReq.end();
});

server.listen(port, hostname, () => {
  console.log(`> Holoraa ready on http://${hostname}:${port}`);
});
