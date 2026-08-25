/**
 * Tests for curl -D/--dump-header
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Bash } from "../../../Bash.js";

const originalFetch = global.fetch;

const mockFetch = vi.fn(async (_url: string, _options?: RequestInit) => {
  return new Response('{"ok":true}', {
    status: 200,
    statusText: "OK",
    headers: {
      "content-type": "application/json",
      "x-custom": "yes",
    },
  });
});

beforeAll(() => {
  global.fetch = mockFetch as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

const createEnv = () =>
  new Bash({
    network: { allowedUrlPrefixes: ["https://api.example.com"] },
  });

describe("curl -D/--dump-header", () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  it("writes headers to a file with -D", async () => {
    const env = createEnv();
    const result = await env.exec(
      "curl -s -D /tmp/headers.txt -o /tmp/body.json https://api.example.com/test",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");

    const headers = await env.exec("cat /tmp/headers.txt");
    expect(headers.stdout).toBe(
      "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\nx-custom: yes\r\n\r\n",
    );

    const body = await env.exec("cat /tmp/body.json");
    expect(body.stdout).toBe('{"ok":true}');
  });

  it("accepts --dump-header FILE", async () => {
    const env = createEnv();
    const result = await env.exec(
      "curl -s --dump-header /tmp/h2.txt https://api.example.com/test",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('{"ok":true}');

    const headers = await env.exec("cat /tmp/h2.txt");
    expect(headers.stdout).toBe(
      "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\nx-custom: yes\r\n\r\n",
    );
  });

  it("accepts attached -Dfile form", async () => {
    const env = createEnv();
    const result = await env.exec(
      "curl -s -D/tmp/h3.txt -o /dev/null https://api.example.com/test",
    );
    expect(result.exitCode).toBe(0);

    const headers = await env.exec("cat /tmp/h3.txt");
    expect(headers.stdout).toContain("x-custom: yes");
  });

  it("writes headers to stdout with -D -", async () => {
    const env = createEnv();
    const result = await env.exec(
      "curl -s -D - -o /tmp/body-only.json https://api.example.com/test",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\nx-custom: yes\r\n\r\n",
    );
    expect(result.stderr).toBe("");

    const body = await env.exec("cat /tmp/body-only.json");
    expect(body.stdout).toBe('{"ok":true}');
  });

  it("prepends headers before the body with -D - and no -o", async () => {
    const env = createEnv();
    const result = await env.exec("curl -s -D - https://api.example.com/test");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      'HTTP/1.1 200 OK\r\ncontent-type: application/json\r\nx-custom: yes\r\n\r\n{"ok":true}',
    );
  });

  it("rejects missing -D argument", async () => {
    const env = createEnv();
    const result = await env.exec("curl -s -D");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("curl: option -D: requires parameter\n");
    expect(result.stdout).toBe("");
  });

  it("rejects blank -D argument", async () => {
    const env = createEnv();
    const result = await env.exec("curl -s -D '' https://api.example.com/test");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      "curl: option -D: blank argument where content is expected\n",
    );
  });
});
